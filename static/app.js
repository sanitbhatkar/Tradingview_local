/* ======================================================================
   Multi-Chart Dashboard — frontend
   ----------------------------------------------------------------------
   * configurable 1/2/4/6/8 grid of Lightweight Charts panes
   * each pane independently picks source + symbol + timeframe + indicators
   * crypto streams over ONE shared, ref-counted Hyperliquid websocket
   * Yahoo polls /api/quote and refetches history
   * colour-coded ticker flashes green/red on every price change
   * INDICATORS panel: overlays on price + oscillators in stacked sub-panes
   * full layout + per-pane config + indicators persist in localStorage
   * live US (NYSE) + IN (NSE) market open/closed badges
   ====================================================================== */

const LS_KEY = "mcd:v1:state";

/* ---------------------------------------------------------------- state */
let SOURCES = [];
const PANES = [];
let STATE = loadState();

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY));
    if (s && s.count && Array.isArray(s.panes)) return s;
  } catch (_) {}
  return { count: 4, panes: [] };
}
function saveState() {
  STATE.count = PANES.length;
  STATE.panes = PANES.map(p => ({
    source: p.source, symbol: p.symbol, timeframe: p.timeframe,
    indicators: [...p.activeIndicators],
  }));
  localStorage.setItem(LS_KEY, JSON.stringify(STATE));
}

/* =====================================================================
   Indicator catalogue
   ---------------------------------------------------------------------
   Indicators are NOT defined here. Each lives in its own self-contained
   module under static/indicators/<name>.js and default-exports a def:

     { id, name, category, swatch, type, styles?, guides?, hasHist?,
       histFormat?, compute(candles) }

   where `type` is one of:
     overlayLines : one or more lines on the price scale
     lower        : lines (+ optional histogram) in a stacked sub-pane
     markers      : symbols on the candles (Parabolic SAR, Fair Value Gaps)
     priceLines   : horizontal levels (Pivot Points, Volume Profile)

   loadIndicators() asks the backend (/api/indicators) which module files
   exist, dynamically import()s each, and fills these two collections.
   To add an indicator: drop a file in static/indicators/ — that's it.
   ===================================================================== */
let INDICATOR_DEFS = [];          // [def, ...] sorted by category, name
const DEF_BY_ID = new Map();      // id -> def

async function loadIndicators() {
  let files = [];
  try {
    files = await (await fetch("/api/indicators")).json();
  } catch (e) {
    console.warn("could not list indicators", e);
    return;
  }
  const defs = [];
  await Promise.all(files.map(async (file) => {
    try {
      const mod = await import(`/static/indicators/${file}`);
      const def = mod.default;
      if (def && def.id && typeof def.compute === "function") {
        def._file = file;
        defs.push(def);
      } else {
        console.warn(`indicator "${file}" has no valid default export`);
      }
    } catch (e) {
      console.warn(`failed to load indicator "${file}"`, e);
    }
  }));
  defs.sort((a, b) =>
    (a.category || "").localeCompare(b.category || "") ||
    (a.name || a.id).localeCompare(b.name || b.id));
  INDICATOR_DEFS = defs;
  DEF_BY_ID.clear();
  defs.forEach(d => DEF_BY_ID.set(d.id, d));
  console.log(`loaded ${defs.length} indicators`);
}

/* =====================================================================
   Shared Hyperliquid websocket (multiplexed, ref-counted, auto-reconnect)
   ===================================================================== */
const HL = {
  ws: null, ready: false, subs: new Map(), reconnectMs: 1000,

  url() {
    const s = SOURCES.find(x => x.realtime && x.realtime.type === "hyperliquid_ws");
    return (s && s.realtime.url) || "wss://api.hyperliquid.xyz/ws";
  },

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    setHlStatus("connecting");
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      this.ready = true; this.reconnectMs = 1000; setHlStatus("live");
      for (const key of this.subs.keys()) this._send("subscribe", key);
    };
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.channel !== "candle" || !msg.data) return;
      const d = msg.data;
      const entry = this.subs.get(`${d.s}|${d.i}`);
      if (!entry) return;
      const bar = {
        time: Math.floor(d.t / 1000),
        open: +d.o, high: +d.h, low: +d.l, close: +d.c, volume: +d.v || 0,
      };
      entry.handlers.forEach(fn => fn(bar));
    };
    ws.onclose = () => {
      this.ready = false; setHlStatus("down");
      setTimeout(() => this.connect(), this.reconnectMs);
      this.reconnectMs = Math.min(this.reconnectMs * 2, 15000);
    };
    ws.onerror = () => { try { ws.close(); } catch (_) {} };
  },

  _send(method, key) {
    if (!this.ws || this.ws.readyState !== 1) return;
    const [coin, interval] = key.split("|");
    this.ws.send(JSON.stringify({ method, subscription: { type: "candle", coin, interval } }));
  },

  subscribe(coin, interval, handler) {
    const key = `${coin}|${interval}`;
    let entry = this.subs.get(key);
    if (!entry) { entry = { refs: 0, handlers: new Set() }; this.subs.set(key, entry); this._send("subscribe", key); }
    entry.refs++; entry.handlers.add(handler);
    return () => this.unsubscribe(coin, interval, handler);
  },

  unsubscribe(coin, interval, handler) {
    const key = `${coin}|${interval}`;
    const entry = this.subs.get(key);
    if (!entry) return;
    entry.handlers.delete(handler); entry.refs--;
    if (entry.refs <= 0) { this._send("unsubscribe", key); this.subs.delete(key); }
  },
};

function setHlStatus(kind) {
  const el = document.getElementById("hlStatus");
  el.classList.remove("live", "down");
  if (kind === "live") { el.classList.add("live"); el.lastChild.textContent = " HL live"; }
  else if (kind === "down") { el.classList.add("down"); el.lastChild.textContent = " HL offline"; }
  else el.lastChild.textContent = " HL connecting";
}

/* =====================================================================
   Market status badges (NYSE + NSE), timezone-aware
   ===================================================================== */
function marketOpen(tz, openMin, closeMin) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t)?.value;
  const wd = get("weekday");
  let hh = parseInt(get("hour"), 10);
  if (hh === 24) hh = 0;                       // some engines emit 24 at midnight
  const mins = hh * 60 + parseInt(get("minute"), 10);
  const weekday = !["Sat", "Sun"].includes(wd);
  return weekday && mins >= openMin && mins < closeMin;
}

function setMarketBadge(id, open, label) {
  const el = document.getElementById(id);
  el.classList.remove("open", "closed");
  el.classList.add(open ? "open" : "closed");
  el.lastChild.textContent = ` ${label} ${open ? "open" : "closed"}`;
}

function updateMarketStatus() {
  setMarketBadge("usStatus", marketOpen("America/New_York", 9 * 60 + 30, 16 * 60), "US market");
  setMarketBadge("inStatus", marketOpen("Asia/Kolkata", 9 * 60 + 15, 15 * 60 + 30), "IN market");
}

/* =====================================================================
   Chart + pane
   ===================================================================== */
function makeChart(container) {
  const chart = LightweightCharts.createChart(container, {
    layout: { background: { color: "#131722" }, textColor: "#d1d4dc" },
    grid: { vertLines: { color: "rgba(42,46,57,0.5)" }, horzLines: { color: "rgba(42,46,57,0.5)" } },
    rightPriceScale: { borderColor: "#2a2e39", scaleMargins: { top: 0.08, bottom: 0.08 } },
    timeScale: { borderColor: "#2a2e39", timeVisible: true, secondsVisible: false },
    crosshair: { mode: 0 },
    autoSize: false,
  });
  const series = chart.addCandlestickSeries({
    upColor: "#26a69a", downColor: "#ef5350", borderVisible: false,
    wickUpColor: "#26a69a", wickDownColor: "#ef5350",
  });
  return { chart, series };
}

function createPane(cfg) {
  const tpl = document.getElementById("paneTemplate");
  const node = tpl.content.firstElementChild.cloneNode(true);
  document.getElementById("grid").appendChild(node);

  const selSource = node.querySelector(".sel-source");
  const selSymbol = node.querySelector(".sel-symbol");
  const selTf     = node.querySelector(".sel-timeframe");
  const chartEl   = node.querySelector(".chart");
  const indBtn    = node.querySelector(".indicators");
  const panelEl   = node.querySelector(".indicator-panel");

  const { chart, series } = makeChart(chartEl);

  const pane = {
    node, selSource, selSymbol, selTf, chartEl, indBtn, panelEl, chart, series,
    source: null, symbol: null, timeframe: null,
    candles: [], refOpen: null, prevPrice: null, lastBar: null,
    hlUnsub: null, pollTimer: null, refetchTimer: null, flashTimer: null,
    instances: new Map(), activeIndicators: [], lowerOrder: [], markerSets: {},
  };

  SOURCES.forEach(s => selSource.add(new Option(s.label, s.name)));

  const ro = new ResizeObserver(() => chart.resize(chartEl.clientWidth, chartEl.clientHeight));
  ro.observe(chartEl);
  pane.ro = ro;

  selSource.onchange = () => { fillSymbolTf(pane); applyPane(pane); };
  selSymbol.onchange = () => { pane.symbol = selSymbol.value; reloadPane(pane); saveState(); };
  selTf.onchange     = () => { pane.timeframe = selTf.value; reloadPane(pane); saveState(); };

  indBtn.onclick = (e) => { e.stopPropagation(); togglePanel(pane); };
  panelEl.onclick = (e) => e.stopPropagation();

  const defaultSrc = (cfg && cfg.source) || SOURCES[0].name;
  selSource.value = SOURCES.some(s => s.name === defaultSrc) ? defaultSrc : SOURCES[0].name;
  fillSymbolTf(pane, cfg);
  buildPanel(pane);

  // restore saved indicators (instances created lazily once candles arrive)
  pane.savedIndicators = (cfg && Array.isArray(cfg.indicators)) ? cfg.indicators : [];

  applyPane(pane);
  PANES.push(pane);
  return pane;
}

function fillSymbolTf(pane, cfg) {
  const src = SOURCES.find(s => s.name === pane.selSource.value);
  pane.selSymbol.innerHTML = "";
  src.symbols.forEach(sym => pane.selSymbol.add(new Option(sym, sym)));
  pane.selTf.innerHTML = "";
  src.timeframes.forEach(tf => pane.selTf.add(new Option(tf, tf)));
  const wantSym = (cfg && cfg.symbol && src.symbols.includes(cfg.symbol)) ? cfg.symbol : src.symbols[0];
  const wantTf  = (cfg && cfg.timeframe && src.timeframes.includes(cfg.timeframe)) ? cfg.timeframe : src.timeframes[0];
  pane.selSymbol.value = wantSym;
  pane.selTf.value = wantTf;
}

function applyPane(pane) {
  pane.source = pane.selSource.value;
  pane.symbol = pane.selSymbol.value;
  pane.timeframe = pane.selTf.value;
  reloadPane(pane);
  saveState();
}

/* ---- (re)load history + (re)wire realtime --------------------------- */
async function reloadPane(pane) {
  teardownRealtime(pane);
  pane.refOpen = null; pane.prevPrice = null; pane.lastBar = null;

  const { source, symbol, timeframe } = pane;
  setTicker(pane, symbol, null, null, "");

  let candles = [];
  try {
    const r = await fetch(`/api/history?source=${encodeURIComponent(source)}&symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`);
    const j = await r.json();
    candles = j.candles || [];
  } catch (e) { console.warn("history fetch failed", source, symbol, e); }

  pane.candles = candles;
  pane.series.setData(candles);
  pane.chart.timeScale().fitContent();
  if (candles.length) {
    pane.refOpen = candles[0].open;
    pane.lastBar = { ...candles[candles.length - 1] };
    updateTicker(pane, pane.lastBar.close);
  }

  // create any saved-but-not-yet-built indicators, then draw everything
  if (pane.savedIndicators && pane.savedIndicators.length) {
    const want = pane.savedIndicators; pane.savedIndicators = [];
    want.forEach(id => { if (DEF_BY_ID.has(id) && !pane.instances.has(id)) addIndicator(pane, id, true); });
    syncPanelChecks(pane);
  }
  refreshIndicators(pane, false);

  const src = SOURCES.find(s => s.name === source);
  const rt = src && src.realtime ? src.realtime.type : null;
  if (rt === "hyperliquid_ws") wireHyperliquid(pane);
  else if (rt === "poll")      wirePolling(pane, src.realtime.interval || 5000);
}

function teardownRealtime(pane) {
  if (pane.hlUnsub) { pane.hlUnsub(); pane.hlUnsub = null; }
  if (pane.pollTimer) { clearInterval(pane.pollTimer); pane.pollTimer = null; }
  if (pane.refetchTimer) { clearInterval(pane.refetchTimer); pane.refetchTimer = null; }
}

function pushLiveBar(pane, bar) {
  const arr = pane.candles;
  if (!arr.length) { arr.push(bar); return; }
  const last = arr[arr.length - 1];
  if (bar.time === last.time) arr[arr.length - 1] = bar;
  else if (bar.time > last.time) arr.push(bar);
}

/* ---- crypto: live candles from the shared HL websocket -------------- */
function wireHyperliquid(pane) {
  const handler = (bar) => {
    pane.lastBar = bar;
    pushLiveBar(pane, bar);
    pane.series.update(bar);
    updateTicker(pane, bar.close);
    refreshIndicators(pane, true);
  };
  pane.hlUnsub = HL.subscribe(pane.symbol, pane.timeframe, handler);
  HL.connect();
}

/* ---- stocks: poll quote + periodic full-history refetch ------------- */
function wirePolling(pane, intervalMs) {
  const poll = async () => {
    try {
      const r = await fetch(`/api/quote?source=${encodeURIComponent(pane.source)}&symbol=${encodeURIComponent(pane.symbol)}`);
      const j = await r.json();
      if (j.price == null || !pane.lastBar) return;
      const b = pane.lastBar;
      b.close = j.price; b.high = Math.max(b.high, j.price); b.low = Math.min(b.low, j.price);
      pushLiveBar(pane, { ...b });
      pane.series.update(b);
      updateTicker(pane, j.price);
      refreshIndicators(pane, true);
    } catch (_) {}
  };
  const refetch = async () => {
    try {
      const r = await fetch(`/api/history?source=${encodeURIComponent(pane.source)}&symbol=${encodeURIComponent(pane.symbol)}&timeframe=${encodeURIComponent(pane.timeframe)}`);
      const j = await r.json();
      const candles = j.candles || [];
      if (candles.length) {
        pane.candles = candles;
        pane.series.setData(candles);
        pane.refOpen = candles[0].open;
        pane.lastBar = { ...candles[candles.length - 1] };
        refreshIndicators(pane, false);
      }
    } catch (_) {}
  };
  poll();
  pane.pollTimer = setInterval(poll, intervalMs);
  pane.refetchTimer = setInterval(refetch, 60000);
}

/* =====================================================================
   Indicators — panel UI (TradingView-style search)
   ===================================================================== */
function buildPanel(pane) {
  const p = pane.panelEl;
  p.innerHTML = "";

  const search = document.createElement("div");
  search.className = "ind-search";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Search indicators…";
  input.oninput = () => renderIndList(pane);
  input.onclick = (e) => e.stopPropagation();
  search.appendChild(input);
  p.appendChild(search);

  const list = document.createElement("div");
  list.className = "ind-list";
  p.appendChild(list);

  pane.panelInput = input;
  pane.panelList = list;
  renderIndList(pane);
}

function renderIndList(pane) {
  const list = pane.panelList;
  if (!list) return;
  const q = (pane.panelInput.value || "").trim().toLowerCase();
  list.innerHTML = "";

  const matches = INDICATOR_DEFS.filter(def =>
    !q ||
    (def.name || def.id).toLowerCase().includes(q) ||
    (def.category || "").toLowerCase().includes(q));

  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "ind-empty";
    empty.textContent = INDICATOR_DEFS.length ? "No matches" : "No indicators found";
    list.appendChild(empty);
    return;
  }

  let lastCat = null;
  matches.forEach(def => {
    if (def.category && def.category !== lastCat) {
      lastCat = def.category;
      const title = document.createElement("div");
      title.className = "ind-group-title";
      title.textContent = def.category;
      list.appendChild(title);
    }
    const active = pane.activeIndicators.includes(def.id);
    const row = document.createElement("label");
    row.className = "ind-row" + (active ? " active" : "");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.dataset.id = def.id; cb.checked = active;
    cb.onchange = () => {
      if (cb.checked) addIndicator(pane, def.id);
      else removeIndicator(pane, def.id);
      row.classList.toggle("active", cb.checked);
      saveState();
    };
    const sw = document.createElement("span");
    sw.className = "ind-swatch"; sw.style.background = def.swatch || "#787b86";
    const txt = document.createElement("span");
    txt.textContent = def.name || def.id;
    row.appendChild(cb); row.appendChild(sw); row.appendChild(txt);
    list.appendChild(row);
  });
}

function syncPanelChecks(pane) {
  renderIndList(pane);
}

function togglePanel(pane) {
  const willOpen = pane.panelEl.hidden;
  // close any other open panels first
  PANES.forEach(p => { if (p !== pane) { p.panelEl.hidden = true; p.indBtn.classList.remove("active"); } });
  pane.panelEl.hidden = !willOpen;
  pane.indBtn.classList.toggle("active", willOpen);
  if (willOpen && pane.panelInput) { pane.panelInput.value = ""; renderIndList(pane); setTimeout(() => pane.panelInput.focus(), 0); }
}

// click anywhere else closes open panels
document.addEventListener("click", () => {
  PANES.forEach(p => { p.panelEl.hidden = true; p.indBtn.classList.remove("active"); });
});

/* =====================================================================
   Indicators — create / draw / remove
   ===================================================================== */
function addIndicator(pane, id, silent) {
  if (pane.instances.has(id)) return;
  const def = DEF_BY_ID.get(id);
  if (!def) return;
  const inst = createInst(pane, def);
  pane.instances.set(id, inst);
  pane.activeIndicators.push(id);
  if (!silent) drawInst(pane, inst);
  if (!silent) syncPanelChecks(pane);
}

function removeIndicator(pane, id) {
  const inst = pane.instances.get(id);
  if (!inst) return;
  removeInst(pane, inst);
  pane.instances.delete(id);
  pane.activeIndicators = pane.activeIndicators.filter(x => x !== id);
  syncPanelChecks(pane);
}

function createInst(pane, def) {
  const chart = pane.chart;
  const lineOpts = st => ({
    color: st.color, lineWidth: st.width || 2, lineStyle: st.style || 0,
    lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
  });

  if (def.type === "overlayLines") {
    const lineSeries = {};
    Object.entries(def.styles).forEach(([name, st]) => {
      lineSeries[name] = chart.addLineSeries({ ...lineOpts(st), priceScaleId: "right" });
    });
    return { def, type: "overlay", lineSeries };
  }

  if (def.type === "lower") {
    const scaleId = "lower_" + def.id;
    const lines = (def.styles && def.styles.lines) || {};
    const lineSeries = {};
    Object.entries(lines).forEach(([name, st]) => {
      lineSeries[name] = chart.addLineSeries({ ...lineOpts(st), priceScaleId: scaleId });
    });
    let hist = null;
    if (def.hasHist) {
      hist = chart.addHistogramSeries({
        priceScaleId: scaleId, priceFormat: def.histFormat || undefined,
        lastValueVisible: false, priceLineVisible: false,
      });
    }
    const inst = { def, type: "lower", scaleId, lineSeries, hist };
    // guide levels (e.g. RSI 70/30)
    const host = Object.values(lineSeries)[0] || hist;
    if (def.guides && host) {
      inst.guideLines = def.guides.map(g =>
        host.createPriceLine({ price: g.value, color: g.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: false }));
    }
    pane.lowerOrder.push(def.id);
    relayoutScales(pane);
    return inst;
  }

  if (def.type === "markers")    return { def, type: "markers" };
  if (def.type === "priceLines") return { def, type: "priceLines", priceLines: [] };
  return { def, type: "noop" };
}

function drawInst(pane, inst) {
  const c = pane.candles;
  if (!c || !c.length) return;
  const def = inst.def;

  if (inst.type === "overlay") {
    const r = def.compute(c) || {};
    Object.keys(inst.lineSeries).forEach(name => inst.lineSeries[name].setData(r[name] || []));
  } else if (inst.type === "lower") {
    const r = def.compute(c) || {};
    Object.keys(inst.lineSeries).forEach(name => inst.lineSeries[name].setData((r.lines && r.lines[name]) || []));
    if (inst.hist) inst.hist.setData(r.hist || []);
  } else if (inst.type === "markers") {
    pane.markerSets[def.id] = def.compute(c) || [];
    updatePaneMarkers(pane);
  } else if (inst.type === "priceLines") {
    inst.priceLines.forEach(pl => pane.series.removePriceLine(pl));
    inst.priceLines = (def.compute(c) || []).map(pl =>
      pane.series.createPriceLine({ price: pl.price, color: pl.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: pl.title }));
  }
}

function removeInst(pane, inst) {
  const chart = pane.chart;
  if (inst.type === "overlay") {
    Object.values(inst.lineSeries).forEach(s => chart.removeSeries(s));
  } else if (inst.type === "lower") {
    Object.values(inst.lineSeries).forEach(s => chart.removeSeries(s));
    if (inst.hist) chart.removeSeries(inst.hist);
    pane.lowerOrder = pane.lowerOrder.filter(id => id !== inst.def.id);
    relayoutScales(pane);
  } else if (inst.type === "markers") {
    delete pane.markerSets[inst.def.id];
    updatePaneMarkers(pane);
  } else if (inst.type === "priceLines") {
    inst.priceLines.forEach(pl => pane.series.removePriceLine(pl));
  }
}

function refreshIndicators(pane, liveOnly) {
  if (!pane.candles || !pane.candles.length) return;
  pane.instances.forEach(inst => {
    if (liveOnly && (inst.type === "markers" || inst.type === "priceLines")) return;
    drawInst(pane, inst);
  });
}

// merge markers from every active marker-indicator, sorted by time
function updatePaneMarkers(pane) {
  const all = [];
  Object.values(pane.markerSets).forEach(set => set.forEach(m => all.push(m)));
  all.sort((a, b) => a.time - b.time);
  pane.series.setMarkers(all);
}

// divide the lower 40% of the chart among active sub-pane indicators
function relayoutScales(pane) {
  const ids = pane.lowerOrder;
  const n = ids.length;
  if (n === 0) {
    pane.chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: 0.08 } });
    return;
  }
  pane.chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.05, bottom: 0.40 } });
  const zoneTop = 0.60, zoneH = 0.40, each = zoneH / n, gap = 0.012;
  ids.forEach((id, i) => {
    const top = zoneTop + i * each + gap;
    const bottom = (n - 1 - i) * each + gap;
    pane.chart.priceScale("lower_" + id).applyOptions({ scaleMargins: { top, bottom } });
  });
}

/* =====================================================================
   Ticker bar (flash green/red on every price change)
   ===================================================================== */
function updateTicker(pane, price) {
  if (price == null) return;
  const dir = pane.prevPrice == null ? 0 : Math.sign(price - pane.prevPrice);
  pane.prevPrice = price;
  let chgStr = "";
  if (pane.refOpen) {
    const diff = price - pane.refOpen, pct = (diff / pane.refOpen) * 100, sign = diff >= 0 ? "+" : "";
    chgStr = `${sign}${diff.toFixed(2)} (${sign}${pct.toFixed(2)}%)`;
  }
  setTicker(pane, pane.symbol, price, dir, chgStr);
}

function setTicker(pane, sym, price, dir, chgStr) {
  const t = pane.node.querySelector(".ticker");
  pane.node.querySelector(".ticker-sym").textContent = sym;
  pane.node.querySelector(".ticker-price").textContent = price == null ? "--" : formatPrice(price);
  pane.node.querySelector(".ticker-chg").textContent = chgStr || "";
  if (dir === 0 || dir == null) return;
  t.classList.remove("ticker-up", "ticker-down");
  t.classList.add(dir > 0 ? "ticker-up" : "ticker-down");
  clearTimeout(pane.flashTimer);
  pane.flashTimer = setTimeout(() => t.classList.remove("ticker-up", "ticker-down"), 600);
}

function formatPrice(p) {
  const abs = Math.abs(p);
  const dp = abs >= 1000 ? 2 : abs >= 1 ? 3 : 6;
  return p.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/* =====================================================================
   Grid management
   ===================================================================== */
function destroyPane(pane) {
  teardownRealtime(pane);
  clearTimeout(pane.flashTimer);
  if (pane.ro) pane.ro.disconnect();
  pane.chart.remove();
  pane.node.remove();
}

function setGridLayout(count) {
  document.getElementById("grid").className = `grid grid-${count}`;
}

function rebuildGrid(count) {
  while (PANES.length) destroyPane(PANES.pop());
  setGridLayout(count);
  const saved = STATE.panes || [];
  for (let i = 0; i < count; i++) createPane(saved[i] || defaultPaneConfig(i));
  saveState();
}

function defaultPaneConfig(i) {
  const src = SOURCES[i % SOURCES.length];
  return { source: src.name, symbol: src.symbols[0], timeframe: src.timeframes[0], indicators: [] };
}

/* =====================================================================
   Boot
   ===================================================================== */
async function boot() {
  const res = await fetch("/api/sources");
  SOURCES = await res.json();
  if (!SOURCES.length) {
    document.getElementById("grid").innerHTML =
      '<p style="padding:24px;color:#787b86">No data sources available. Is the backend running?</p>';
    return;
  }

  // discover + dynamically import all indicator modules before building panes
  await loadIndicators();

  updateMarketStatus();
  setInterval(updateMarketStatus, 30000);

  const countSel = document.getElementById("chartCount");
  countSel.value = String(STATE.count || 4);
  countSel.onchange = () => rebuildGrid(parseInt(countSel.value, 10));

  HL.connect();
  rebuildGrid(parseInt(countSel.value, 10));
}

boot();
