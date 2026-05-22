// Parabolic SAR (step 0.02, max 0.2). Drawn as dots above/below price.
function psar(c, step = 0.02, max = 0.2) {
  if (c.length < 2) return [];
  const dots = [];
  let up = c[1].close >= c[0].close;
  let sar = up ? c[0].low : c[0].high;
  let ep = up ? c[0].high : c[0].low;
  let af = step;
  for (let i = 1; i < c.length; i++) {
    sar = sar + af * (ep - sar);
    if (up) {
      sar = Math.min(sar, c[i - 1].low, i >= 2 ? c[i - 2].low : c[i - 1].low);
      if (c[i].high > ep) { ep = c[i].high; af = Math.min(af + step, max); }
      if (c[i].low < sar) { up = false; sar = ep; ep = c[i].low; af = step; }
    } else {
      sar = Math.max(sar, c[i - 1].high, i >= 2 ? c[i - 2].high : c[i - 1].high);
      if (c[i].low < ep) { ep = c[i].low; af = Math.min(af + step, max); }
      if (c[i].high > sar) { up = true; sar = ep; ep = c[i].high; af = step; }
    }
    dots.push({ time: c[i].time, up });
  }
  return dots;
}

export default {
  id: "psar",
  name: "Parabolic SAR",
  category: "Trend",
  swatch: "#ffa726",
  type: "markers",
  compute: c => psar(c).map(d => ({
    time: d.time, position: d.up ? "belowBar" : "aboveBar", color: "#ffa726", shape: "circle",
  })),
};
