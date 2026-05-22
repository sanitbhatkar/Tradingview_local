// Fair Value Gaps (3-candle imbalance). Marks the gap candle: bullish when
// low[i] > high[i-2], bearish when high[i] < low[i-2]. Shows the last 25.
function compute(c, limit = 25) {
  const out = [];
  for (let i = 2; i < c.length; i++) {
    if (c[i].low > c[i - 2].high) {
      out.push({ time: c[i].time, position: "belowBar", color: "#26a69a", shape: "arrowUp", text: "FVG" });
    } else if (c[i].high < c[i - 2].low) {
      out.push({ time: c[i].time, position: "aboveBar", color: "#ef5350", shape: "arrowDown", text: "FVG" });
    }
  }
  return out.slice(-limit);
}

export default {
  id: "fvg",
  name: "Fair Value Gaps",
  category: "Price Action",
  swatch: "#ffd54f",
  type: "markers",
  compute,
};
