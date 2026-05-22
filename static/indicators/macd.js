import { emaArr, closes, line } from "./_lib.js";

// MACD (12, 26, 9): macd line, signal line, and a coloured histogram.
// Lower sub-pane (line series + histogram share the pane's scale).
function compute(c, fast = 12, slow = 26, signal = 9) {
  const cl = closes(c);
  const ef = emaArr(cl, fast), es = emaArr(cl, slow);
  const macdArr = ef.map((f, i) => (f == null || es[i] == null ? null : f - es[i]));
  const firstIdx = macdArr.findIndex(v => v != null);
  const sigArr = new Array(cl.length).fill(null);
  if (firstIdx >= 0) {
    const seg = macdArr.slice(firstIdx).map(v => (v == null ? 0 : v));
    const sigSeg = emaArr(seg, signal);
    for (let i = 0; i < sigSeg.length; i++) sigArr[firstIdx + i] = sigSeg[i];
  }
  const hist = [];
  for (let i = 0; i < c.length; i++) {
    if (macdArr[i] == null || sigArr[i] == null) continue;
    const v = macdArr[i] - sigArr[i];
    hist.push({ time: c[i].time, value: v, color: v >= 0 ? "rgba(38,166,154,0.6)" : "rgba(239,83,80,0.6)" });
  }
  return { macd: line(c, macdArr), signal: line(c, sigArr), hist };
}

export default {
  id: "macd",
  name: "MACD (12, 26, 9)",
  category: "Oscillators",
  swatch: "#29b6f6",
  type: "lower",
  hasHist: true,
  styles: { lines: { macd: { color: "#2962ff", width: 2 }, signal: { color: "#ff9800", width: 1 } } },
  compute: c => { const m = compute(c); return { lines: { macd: m.macd, signal: m.signal }, hist: m.hist }; },
};
