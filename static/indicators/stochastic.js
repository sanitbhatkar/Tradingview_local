import { rollingMax, rollingMin, smaArr, line } from "./_lib.js";

// Stochastic Oscillator (14, 3, 3): %K (smoothed) and %D. Lower sub-pane,
// 0-100, with 80 / 20 guide levels.
function compute(c, kP = 14, kSmooth = 3, dP = 3) {
  const hh = rollingMax(c, kP, "high"), ll = rollingMin(c, kP, "low");
  const rawK = c.map((x, i) => {
    if (hh[i] == null || ll[i] == null || hh[i] === ll[i]) return null;
    return (100 * (x.close - ll[i])) / (hh[i] - ll[i]);
  });
  const k = smaArr(rawK.map(v => (v == null ? 0 : v)), kSmooth).map((v, i) => (rawK[i] == null ? null : v));
  const d = smaArr(k.map(v => (v == null ? 0 : v)), dP).map((v, i) => (k[i] == null ? null : v));
  return { k: line(c, k), d: line(c, d) };
}

export default {
  id: "stoch",
  name: "Stochastic (14, 3, 3)",
  category: "Oscillators",
  swatch: "#ff9800",
  type: "lower",
  styles: { lines: { k: { color: "#2962ff", width: 2 }, d: { color: "#ff9800", width: 1 } } },
  guides: [{ value: 80, color: "#3a3f4b" }, { value: 20, color: "#3a3f4b" }],
  compute: c => { const s = compute(c); return { lines: { k: s.k, d: s.d } }; },
};
