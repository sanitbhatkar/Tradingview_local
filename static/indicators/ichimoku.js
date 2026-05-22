import { rollingMax, rollingMin, line } from "./_lib.js";

// Ichimoku Cloud (9, 26, 52, displacement 26). Five lines; senkou spans are
// displaced forward and chikou backward only where target bar times exist.
function compute(c, conv = 9, base = 26, spanB = 52, disp = 26) {
  const t = c.map(x => x.time);
  const hi = k => rollingMax(c, k, "high");
  const lo = k => rollingMin(c, k, "low");
  const h9 = hi(conv), l9 = lo(conv), h26 = hi(base), l26 = lo(base), h52 = hi(spanB), l52 = lo(spanB);
  const tenkan = h9.map((h, i) => (h == null ? null : (h + l9[i]) / 2));
  const kijun = h26.map((h, i) => (h == null ? null : (h + l26[i]) / 2));
  const senkouA = tenkan.map((tk, i) => (tk == null || kijun[i] == null ? null : (tk + kijun[i]) / 2));
  const senkouB = h52.map((h, i) => (h == null ? null : (h + l52[i]) / 2));
  const shiftFwd = (arr) => {
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] == null) continue;
      const j = i + disp;
      if (j < t.length) out.push({ time: t[j], value: arr[i] });
    }
    return out;
  };
  const chikou = [];
  for (let i = 0; i < c.length; i++) {
    const j = i - disp;
    if (j >= 0) chikou.push({ time: t[j], value: c[i].close });
  }
  return {
    tenkan: line(c, tenkan), kijun: line(c, kijun),
    senkouA: shiftFwd(senkouA), senkouB: shiftFwd(senkouB), chikou,
  };
}

export default {
  id: "ichimoku",
  name: "Ichimoku Cloud",
  category: "Trend",
  swatch: "#29b6f6",
  type: "overlayLines",
  styles: {
    tenkan:  { color: "#2962ff", width: 1 },
    kijun:   { color: "#ef5350", width: 1 },
    senkouA: { color: "#26a69a", width: 1 },
    senkouB: { color: "#ef5350", width: 1 },
    chikou:  { color: "#b0b3b8", width: 1, style: 2 },
  },
  compute: c => compute(c),
};
