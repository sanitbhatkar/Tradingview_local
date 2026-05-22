import { sma } from "./_lib.js";

// Simple Moving Average (50). Overlay on the price scale.
export default {
  id: "sma50",
  name: "SMA (50)",
  category: "Moving Averages",
  swatch: "#ff9800",
  type: "overlayLines",
  styles: { l: { color: "#ff9800", width: 2 } },
  compute: c => ({ l: sma(c, 50) }),
};
