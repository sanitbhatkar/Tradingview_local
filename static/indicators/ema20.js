import { ema } from "./_lib.js";

// Exponential Moving Average (20). Overlay on the price scale.
export default {
  id: "ema20",
  name: "EMA (20)",
  category: "Moving Averages",
  swatch: "#26a69a",
  type: "overlayLines",
  styles: { l: { color: "#26a69a", width: 2 } },
  compute: c => ({ l: ema(c, 20) }),
};
