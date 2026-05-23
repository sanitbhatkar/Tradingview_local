/* ======================================================================
   pane.js — one chart pane, with an explicit lifecycle
   ----------------------------------------------------------------------
   A Pane owns its chart, dropdowns, the symbol search picker, realtime
   wiring, ticker and the set of active indicators. Key robustness
   properties:
     * destroy() tears down EVERYTHING (timers, observers, websocket sub,
       chart) so removed panes leave nothing running (#3 lifecycle).
     * `destroyed` guards every async callback so a late fetch/poll/socket
       message can't touch a disposed chart (#22 defensive programming).
     * resize is debounced to avoid relayout storms (#10).
   ====================================================================== */

import { SOURCES, saveState } from "./state.js";
import { fetchHistory, fetchQuote } from "./api.js";
import { sanitizeBar } from "./validate.js";
import { HL } from "./hyperliquid.js";
import { DEF_BY_ID } from "./indicatorRegistry.js";
import { addIndicator, refreshIndicators } from "./indicatorEngine.js";
import { buildPanel, syncPanelChecks, togglePanel } from "./indicatorPanel.js";
import { attachSymbolPicker } from "./symbolSearch.js";
import { updateTicker, setTicker } from "./ticker.js";
import { debounce } from "./util.js";

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

export class Pane {
  constructor(cfg) {
    const tpl = document.getElementById("paneTemplate");
    const node = tpl.content.firstElementChild.cloneNode(true);
    document.getElementById("grid").appendChild(node);

    this.node = node;
    this.selSource = node.querySelector(".sel-source");
    this.symbolInput = node.querySelector(".sel-symbol-input");
    this.symbolResults = node.querySelector(".symbol-results");
    this.selTf = node.querySelector(".sel-timeframe");
    this.chartEl = node.querySelector(".chart");
    this.indBtn = node.querySelector(".indicators");
    this.panelEl = node.querySelector(".indicator-panel");

    const { chart, series } = makeChart(this.chartEl);
    this.chart = chart;
    this.series = series;

    // state
    this.source = null; this.symbol = null; this.timeframe = null;
    this.candles = []; this.refOpen = null; this.prevPrice = null; this.lastBar = null;
    this.hlUnsub = null; this.pollTimer = null; this.refetchTimer = null; this.flashTimer = null;
    this.instances = new Map(); this.activeIndicators = []; this.lowerOrder = []; this.markerSets = {};
    this.destroyed = false;

    // source dropdown
    SOURCES.forEach(s => this.selSource.add(new Option(s.label, s.name)));

    // debounced resize (#10)
    this.ro = new ResizeObserver(debounce(() => {
      if (this.destroyed) return;
      this.chart.resize(this.chartEl.clientWidth, this.chartEl.clientHeight);
    }, 80));
    this.ro.observe(this.chartEl);

    // listeners
    this.selSource.onchange = () => { this.fillSymbolTf(); this.applyPane(); };
    this.selTf.onchange     = () => { this.timeframe = this.selTf.value; this.reloadPane(); saveState(); };
    this.indBtn.onclick = (e) => { e.stopPropagation(); togglePanel(this); };
    this.panelEl.onclick = (e) => e.stopPropagation();

    // initial config (restored or sensible default)
    const defaultSrc = (cfg && cfg.source) || SOURCES[0].name;
    this.selSource.value = SOURCES.some(s => s.name === defaultSrc) ? defaultSrc : SOURCES[0].name;
    this.source = this.selSource.value;
    this.fillSymbolTf(cfg);
    buildPanel(this);
    attachSymbolPicker(this);

    // indicators are created lazily once candles arrive (in reloadPane)
    this.savedIndicators = (cfg && Array.isArray(cfg.indicators)) ? cfg.indicators : [];

    this.applyPane();
  }

  // Populate timeframes and set the current symbol (curated default unless
  // a saved config restores one). The symbol box itself is a search picker.
  fillSymbolTf(cfg) {
    const src = SOURCES.find(s => s.name === this.selSource.value);
    this.selTf.innerHTML = "";
    src.timeframes.forEach(tf => this.selTf.add(new Option(tf, tf)));
    const wantTf = (cfg && cfg.timeframe && src.timeframes.includes(cfg.timeframe)) ? cfg.timeframe : src.timeframes[0];
    this.selTf.value = wantTf;

    const defaults = src.symbols || [];
    const wantSym = (cfg && cfg.symbol) ? cfg.symbol : (defaults[0] || "");
    this.symbol = wantSym;
    if (this.symbolInput) this.symbolInput.value = wantSym;
  }

  applyPane() {
    this.source = this.selSource.value;
    this.timeframe = this.selTf.value;
    // this.symbol is set by fillSymbolTf / the symbol picker
    this.reloadPane();
    saveState();
  }

  async reloadPane() {
    this.teardownRealtime();
    this.refOpen = null; this.prevPrice = null; this.lastBar = null;

    const { source, symbol, timeframe } = this;
    setTicker(this, symbol, null, null, "");
    if (!symbol) return;                              // nothing selected yet

    let candles = [];
    try {
      candles = await fetchHistory(source, symbol, timeframe);
    } catch (e) {
      console.warn("[pane] history fetch failed", source, symbol, e);
    }
    if (this.destroyed) return;                       // pane removed mid-fetch (#22)
    // ignore a response that arrived after the user switched away
    if (source !== this.source || symbol !== this.symbol || timeframe !== this.timeframe) return;

    this.candles = candles;
    this.series.setData(candles);
    this.chart.timeScale().fitContent();
    if (candles.length) {
      this.refOpen = candles[0].open;
      this.lastBar = { ...candles[candles.length - 1] };
      updateTicker(this, this.lastBar.close);
    }

    if (this.savedIndicators && this.savedIndicators.length) {
      const want = this.savedIndicators; this.savedIndicators = [];
      want.forEach(id => { if (DEF_BY_ID.has(id) && !this.instances.has(id)) addIndicator(this, id, true); });
      syncPanelChecks(this);
    }
    refreshIndicators(this, false);

    const src = SOURCES.find(s => s.name === source);
    const rt = src && src.realtime ? src.realtime.type : null;
    if (rt === "hyperliquid_ws") this.wireHyperliquid();
    else if (rt === "poll")      this.wirePolling(src.realtime.interval || 5000);
  }

  teardownRealtime() {
    if (this.hlUnsub) { this.hlUnsub(); this.hlUnsub = null; }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.refetchTimer) { clearInterval(this.refetchTimer); this.refetchTimer = null; }
  }

  pushLiveBar(bar) {
    const arr = this.candles;
    if (!arr.length) { arr.push(bar); return; }
    const last = arr[arr.length - 1];
    if (bar.time === last.time) arr[arr.length - 1] = bar;
    else if (bar.time > last.time) arr.push(bar);     // ignore out-of-order/stale bars
  }

  wireHyperliquid() {
    const handler = (raw) => {
      if (this.destroyed) return;
      const bar = sanitizeBar(raw);
      if (!bar) return;
      this.lastBar = bar;
      this.pushLiveBar(bar);
      this.series.update(bar);
      updateTicker(this, bar.close);
      refreshIndicators(this, true);
    };
    this.hlUnsub = HL.subscribe(this.symbol, this.timeframe, handler);
    HL.connect();
  }

  wirePolling(intervalMs) {
    const poll = async () => {
      try {
        const j = await fetchQuote(this.source, this.symbol);
        if (this.destroyed || j.price == null || !this.lastBar) return;
        const b = this.lastBar;
        b.close = j.price; b.high = Math.max(b.high, j.price); b.low = Math.min(b.low, j.price);
        this.pushLiveBar({ ...b });
        this.series.update(b);
        updateTicker(this, j.price);
        refreshIndicators(this, true);
      } catch (_) {}
    };
    const refetch = async () => {
      try {
        const candles = await fetchHistory(this.source, this.symbol, this.timeframe);
        if (this.destroyed || !candles.length) return;
        this.candles = candles;
        this.series.setData(candles);
        this.refOpen = candles[0].open;
        this.lastBar = { ...candles[candles.length - 1] };
        refreshIndicators(this, false);
      } catch (_) {}
    };
    poll();
    this.pollTimer = setInterval(poll, intervalMs);
    this.refetchTimer = setInterval(refetch, 60000);
  }

  // Tear down everything this pane created. After this it touches nothing.
  destroy() {
    this.destroyed = true;
    this.teardownRealtime();
    clearTimeout(this.flashTimer);
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
    try { this.chart.remove(); } catch (_) {}
    this.instances.clear();
    this.node.remove();
  }
}
