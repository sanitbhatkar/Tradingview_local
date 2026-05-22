import { ema } from "./_lib.js";

// Exponential Moving Average (200). Overlay on the price scale.
export default {
  id: "ema200",
  name: "EMA (200)",
  category: "Moving Averages",
  swatch: "#ec407a",
  type: "overlayLines",
  styles: { l: { color: "#ec407a", width: 2 } },
  compute: c => ({ l: ema(c, 200) }),
};
