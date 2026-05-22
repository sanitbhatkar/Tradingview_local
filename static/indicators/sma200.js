import { sma } from "./_lib.js";

// Simple Moving Average (200). Overlay on the price scale.
export default {
  id: "sma200",
  name: "SMA (200)",
  category: "Moving Averages",
  swatch: "#ef5350",
  type: "overlayLines",
  styles: { l: { color: "#ef5350", width: 2 } },
  compute: c => ({ l: sma(c, 200) }),
};
