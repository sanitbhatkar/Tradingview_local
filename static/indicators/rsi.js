import { closes, line } from "./_lib.js";

// Relative Strength Index (14), Wilder smoothing. Lower sub-pane, 0-100,
// with 70 / 30 guide levels.
function compute(c, p = 14) {
  const cl = closes(c);
  const out = new Array(cl.length).fill(null);
  let avgG = 0, avgL = 0;
  for (let i = 1; i < cl.length; i++) {
    const ch = cl[i] - cl[i - 1];
    const g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= p) {
      avgG += g; avgL += l;
      if (i === p) { avgG /= p; avgL /= p; out[i] = 100 - 100 / (1 + avgG / (avgL || 1e-9)); }
    } else {
      avgG = (avgG * (p - 1) + g) / p; avgL = (avgL * (p - 1) + l) / p;
      out[i] = 100 - 100 / (1 + avgG / (avgL || 1e-9));
    }
  }
  return line(c, out);
}

export default {
  id: "rsi",
  name: "RSI (14)",
  category: "Oscillators",
  swatch: "#ab47bc",
  type: "lower",
  styles: { lines: { rsi: { color: "#ab47bc", width: 2 } } },
  guides: [{ value: 70, color: "#3a3f4b" }, { value: 30, color: "#3a3f4b" }],
  compute: c => ({ lines: { rsi: compute(c, 14) } }),
};
