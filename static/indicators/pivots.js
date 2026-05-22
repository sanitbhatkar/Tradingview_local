// Classic Pivot Points from the most recent completed "day" (UTC grouping).
// Drawn as horizontal price levels: P, R1-R3, S1-S3.
function compute(c) {
  if (c.length < 2) return [];
  const dayOf = ts => Math.floor(ts / 86400);
  let lastDay = dayOf(c[c.length - 1].time);
  let hi = -Infinity, lo = Infinity, close = null;
  for (let i = c.length - 1; i >= 0; i--) {
    const d = dayOf(c[i].time);
    if (d === lastDay) continue;            // skip the in-progress day
    if (close === null) { lastDay = d; close = c[i].close; }
    if (d !== lastDay) break;
    hi = Math.max(hi, c[i].high); lo = Math.min(lo, c[i].low);
  }
  if (close === null || !isFinite(hi)) {     // fall back to whole window
    hi = Math.max(...c.map(x => x.high));
    lo = Math.min(...c.map(x => x.low));
    close = c[c.length - 1].close;
  }
  const P = (hi + lo + close) / 3;
  return [
    { price: P, color: "#b0b3b8", title: "P" },
    { price: 2 * P - lo, color: "#26a69a", title: "R1" },
    { price: P + (hi - lo), color: "#26a69a", title: "R2" },
    { price: hi + 2 * (P - lo), color: "#26a69a", title: "R3" },
    { price: 2 * P - hi, color: "#ef5350", title: "S1" },
    { price: P - (hi - lo), color: "#ef5350", title: "S2" },
    { price: lo - 2 * (hi - P), color: "#ef5350", title: "S3" },
  ];
}

export default {
  id: "pivots",
  name: "Pivot Points",
  category: "Trend",
  swatch: "#b0b3b8",
  type: "priceLines",
  compute,
};
