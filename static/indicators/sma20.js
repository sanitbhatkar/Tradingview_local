import { sma } from "./_lib.js";

// Simple Moving Average (20). Overlay on the price scale.
export default {
  id: "sma20",
  name: "SMA (20)",
  category: "Moving Averages",
  swatch: "#2962ff",
  type: "overlayLines",
  styles: { l: { color: "#2962ff", width: 2 } },
  compute: c => ({ l: sma(c, 20) }),
};
