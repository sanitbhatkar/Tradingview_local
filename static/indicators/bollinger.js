import { smaArr, stdevArr, closes, line } from "./_lib.js";

// Bollinger Bands (period 20, 2 standard deviations).
function compute(c, p = 20, k = 2) {
  const cl = closes(c);
  const mid = smaArr(cl, p), sd = stdevArr(cl, p);
  const up = mid.map((m, i) => (m == null ? null : m + k * sd[i]));
  const lo = mid.map((m, i) => (m == null ? null : m - k * sd[i]));
  return { upper: line(c, up), middle: line(c, mid), lower: line(c, lo) };
}

export default {
  id: "bollinger",
  name: "Bollinger Bands (20, 2)",
  category: "Bands & Channels",
  swatch: "#b0b3b8",
  type: "overlayLines",
  styles: {
    upper:  { color: "#b0b3b8", width: 1 },
    middle: { color: "#b0b3b8", width: 1, style: 2 },
    lower:  { color: "#b0b3b8", width: 1 },
  },
  compute: c => compute(c, 20, 2),
};
