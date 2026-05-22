import { atrArr } from "./_lib.js";

// Supertrend (ATR period 10, multiplier 3). Two-colour line: green in an
// up-trend, red in a down-trend (rendered as two overlay series).
function compute(c, p = 10, mult = 3) {
  const atr = atrArr(c, p);
  const up = [], down = [];
  let trendUp = true, finalUpper = null, finalLower = null, prevST = null;
  for (let i = 0; i < c.length; i++) {
    if (atr[i] == null) continue;
    const hl2 = (c[i].high + c[i].low) / 2;
    const basicUpper = hl2 + mult * atr[i];
    const basicLower = hl2 - mult * atr[i];
    finalUpper = (finalUpper == null || basicUpper < finalUpper || c[i - 1].close > finalUpper) ? basicUpper : finalUpper;
    finalLower = (finalLower == null || basicLower > finalLower || c[i - 1].close < finalLower) ? basicLower : finalLower;
    if (prevST == null) trendUp = c[i].close >= hl2;
    else if (prevST === "upper" && c[i].close > finalUpper) trendUp = true;
    else if (prevST === "lower" && c[i].close < finalLower) trendUp = false;
    const st = trendUp ? finalLower : finalUpper;
    prevST = trendUp ? "lower" : "upper";
    if (trendUp) { up.push({ time: c[i].time, value: st }); down.push({ time: c[i].time }); }
    else { down.push({ time: c[i].time, value: st }); up.push({ time: c[i].time }); }
  }
  return { up, down };
}

export default {
  id: "supertrend",
  name: "Supertrend (10, 3)",
  category: "Trend",
  swatch: "#ab47bc",
  type: "overlayLines",
  styles: {
    up:   { color: "#26a69a", width: 2 },
    down: { color: "#ef5350", width: 2 },
  },
  compute: c => compute(c, 10, 3),
};
