// Volume Profile -> Point of Control + Value Area High/Low, drawn as levels.
// (Lightweight Charts has no native horizontal-volume histogram, so we surface
//  the key price levels instead of the full distribution.)
function compute(c, bins = 50, vaPct = 0.7) {
  if (!c.length) return [];
  let lo = Infinity, hi = -Infinity, totVol = 0;
  for (const x of c) { lo = Math.min(lo, x.low); hi = Math.max(hi, x.high); }
  if (!(hi > lo)) return [];
  const w = (hi - lo) / bins;
  const buckets = new Array(bins).fill(0);
  for (const x of c) {
    const tp = (x.high + x.low + x.close) / 3;
    let b = Math.floor((tp - lo) / w); if (b >= bins) b = bins - 1; if (b < 0) b = 0;
    buckets[b] += x.volume || 0; totVol += x.volume || 0;
  }
  if (totVol <= 0) return [];
  let poc = 0; for (let i = 1; i < bins; i++) if (buckets[i] > buckets[poc]) poc = i;
  let loI = poc, hiI = poc, acc = buckets[poc];
  while (acc < totVol * vaPct && (loI > 0 || hiI < bins - 1)) {
    const below = loI > 0 ? buckets[loI - 1] : -1;
    const above = hiI < bins - 1 ? buckets[hiI + 1] : -1;
    if (above >= below) { hiI++; acc += Math.max(above, 0); }
    else { loI--; acc += Math.max(below, 0); }
  }
  const price = i => lo + (i + 0.5) * w;
  return [
    { price: price(poc), color: "#ffb74d", title: "POC" },
    { price: lo + (hiI + 1) * w, color: "#9575cd", title: "VAH" },
    { price: lo + loI * w, color: "#9575cd", title: "VAL" },
  ];
}

export default {
  id: "vp",
  name: "Volume Profile (POC/VA)",
  category: "Price Action",
  swatch: "#ffb74d",
  type: "priceLines",
  compute,
};
