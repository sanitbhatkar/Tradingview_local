import { rollingMax, rollingMin, line } from "./_lib.js";

// Donchian Channel (period 20): highest high / lowest low + midline.
function compute(c, p = 20) {
  const hi = rollingMax(c, p, "high"), lo = rollingMin(c, p, "low");
  const mid = hi.map((h, i) => (h == null ? null : (h + lo[i]) / 2));
  return { upper: line(c, hi), middle: line(c, mid), lower: line(c, lo) };
}

export default {
  id: "donchian",
  name: "Donchian Channel (20)",
  category: "Bands & Channels",
  swatch: "#26c6da",
  type: "overlayLines",
  styles: {
    upper:  { color: "#26c6da", width: 1 },
    middle: { color: "#26c6da", width: 1, style: 2 },
    lower:  { color: "#26c6da", width: 1 },
  },
  compute: c => compute(c, 20),
};
