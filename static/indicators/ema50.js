import { ema } from "./_lib.js";

// Exponential Moving Average (50). Overlay on the price scale.
export default {
  id: "ema50",
  name: "EMA (50)",
  category: "Moving Averages",
  swatch: "#ab47bc",
  type: "overlayLines",
  styles: { l: { color: "#ab47bc", width: 2 } },
  compute: c => ({ l: ema(c, 50) }),
};
