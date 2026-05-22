import { emaArr, atrArr, closes, line } from "./_lib.js";

// Keltner Channel: EMA(20) ± 1.5 * ATR(20).
function compute(c, p = 20, mult = 1.5) {
  const mid = emaArr(closes(c), p), atr = atrArr(c, p);
  const up = mid.map((m, i) => (m == null || atr[i] == null ? null : m + mult * atr[i]));
  const lo = mid.map((m, i) => (m == null || atr[i] == null ? null : m - mult * atr[i]));
  return { upper: line(c, up), middle: line(c, mid), lower: line(c, lo) };
}

export default {
  id: "keltner",
  name: "Keltner Channel (20, 1.5)",
  category: "Bands & Channels",
  swatch: "#ec407a",
  type: "overlayLines",
  styles: {
    upper:  { color: "#ec407a", width: 1 },
    middle: { color: "#ec407a", width: 1, style: 2 },
    lower:  { color: "#ec407a", width: 1 },
  },
  compute: c => compute(c, 20, 1.5),
};
