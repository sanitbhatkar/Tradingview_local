/* ======================================================================
   indicatorEngine.js — turn indicator defs into chart series
   ----------------------------------------------------------------------
   Owns the create / draw / remove lifecycle for an indicator on a pane,
   the stacked lower-pane scale layout, and marker merging. Every compute
   + draw is wrapped so one misbehaving indicator can't crash the render
   loop or the websocket feed (#7 error isolation).

   A pane is expected to provide: chart, series, candles, instances(Map),
   activeIndicators(Array), lowerOrder(Array), markerSets(Object),
   destroyed(bool).
   ====================================================================== */

import { DEF_BY_ID } from "./indicatorRegistry.js";

export function addIndicator(pane, id, silent) {
  if (!pane || pane.destroyed) return;
  if (pane.instances.has(id)) return;
  const def = DEF_BY_ID.get(id);
  if (!def) return;
  let inst;
  try {
    inst = createInst(pane, def);
  } catch (e) {
    console.warn(`[indicator] "${id}" failed to initialise`, e);
    return;
  }
  pane.instances.set(id, inst);
  pane.activeIndicators.push(id);
  if (!silent) safeDraw(pane, inst);
}

export function removeIndicator(pane, id) {
  if (!pane) return;
  const inst = pane.instances.get(id);
  if (!inst) return;
  try { removeInst(pane, inst); } catch (e) { console.warn(`[indicator] "${id}" cleanup error`, e); }
  pane.instances.delete(id);
  pane.activeIndicators = pane.activeIndicators.filter(x => x !== id);
}

// Redraw active indicators. liveOnly skips the static ones (markers/levels)
// that only need recomputing on a full history reload.
export function refreshIndicators(pane, liveOnly) {
  if (!pane || pane.destroyed) return;
  if (!pane.candles || !pane.candles.length) return;
  pane.instances.forEach(inst => {
    if (liveOnly && (inst.type === "markers" || inst.type === "priceLines")) return;
    safeDraw(pane, inst);
  });
}

// --- internals ---------------------------------------------------------

function safeDraw(pane, inst) {
  try {
    drawInst(pane, inst);
  } catch (e) {
    // Isolate the failure: log once, leave other indicators untouched.
    if (!inst._errored) {
      console.warn(`[indicator] "${inst.def.id}" draw error (isolated)`, e);
      inst._errored = true;
    }
  }
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

// Merge markers from every active marker-indicator, sorted by time.
function updatePaneMarkers(pane) {
  const all = [];
  Object.values(pane.markerSets).forEach(set => set.forEach(m => all.push(m)));
  all.sort((a, b) => a.time - b.time);
  pane.series.setMarkers(all);
}

// Divide the lower 40% of the chart among active sub-pane indicators.
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
