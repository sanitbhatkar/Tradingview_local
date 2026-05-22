// Volume-Weighted Average Price (cumulative over the loaded window).
// Self-contained; needs candle volume. Overlay on the price scale.
function compute(c) {
  const out = [];
  let pv = 0, vv = 0;
  for (const x of c) {
    const tp = (x.high + x.low + x.close) / 3;
    const vol = x.volume || 0;
    pv += tp * vol; vv += vol;
    if (vv > 0) out.push({ time: x.time, value: pv / vv });
  }
  return out;
}

export default {
  id: "vwap",
  name: "VWAP",
  category: "Moving Averages",
  swatch: "#ffd54f",
  type: "overlayLines",
  styles: { l: { color: "#ffd54f", width: 2 } },
  compute: c => ({ l: compute(c) }),
};
