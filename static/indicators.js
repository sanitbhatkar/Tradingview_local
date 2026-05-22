/* ======================================================================
   indicators.js — pure technical-analysis math
   ----------------------------------------------------------------------
   Every function takes an array of candles:
       [{ time, open, high, low, close, volume }, ...]
   and returns plain data (arrays of {time, value} or simple objects).
   No charting here — rendering lives in app.js. This keeps the math
   testable and lets any indicator be plotted however the UI wants.
   ====================================================================== */

const IND = (() => {

  /* ---- small numeric helpers (operate on plain number arrays) -------- */

  // Simple moving average -> array aligned to input, nulls during warmup.
  function smaArr(vals, p) {
    const out = new Array(vals.length).fill(null);
    let sum = 0;
    for (let i = 0; i < vals.length; i++) {
      sum += vals[i];
      if (i >= p) sum -= vals[i - p];
      if (i >= p - 1) out[i] = sum / p;
    }
    return out;
  }

  // Exponential moving average, seeded with the first SMA value.
  function emaArr(vals, p) {
    const out = new Array(vals.length).fill(null);
    const k = 2 / (p + 1);
    let prev = null;
    for (let i = 0; i < vals.length; i++) {
      if (i < p - 1) continue;
      if (i === p - 1) {
        let s = 0;
        for (let j = 0; j < p; j++) s += vals[j];
        prev = s / p;
      } else {
        prev = vals[i] * k + prev * (1 - k);
      }
      out[i] = prev;
    }
    return out;
  }

  // Rolling standard deviation (population) over window p.
  function stdevArr(vals, p) {
    const out = new Array(vals.length).fill(null);
    for (let i = p - 1; i < vals.length; i++) {
      let mean = 0;
      for (let j = i - p + 1; j <= i; j++) mean += vals[j];
      mean /= p;
      let v = 0;
      for (let j = i - p + 1; j <= i; j++) v += (vals[j] - mean) ** 2;
      out[i] = Math.sqrt(v / p);
    }
    return out;
  }

  // Wilder's True Range + ATR.
  function atrArr(c, p) {
    const tr = new Array(c.length).fill(null);
    for (let i = 0; i < c.length; i++) {
      if (i === 0) { tr[i] = c[i].high - c[i].low; continue; }
      const pc = c[i - 1].close;
      tr[i] = Math.max(
        c[i].high - c[i].low,
        Math.abs(c[i].high - pc),
        Math.abs(c[i].low - pc)
      );
    }
    const out = new Array(c.length).fill(null);
    let prev = null;
    for (let i = 0; i < c.length; i++) {
      if (i < p) continue;
      if (i === p) {
        let s = 0;
        for (let j = 1; j <= p; j++) s += tr[j];
        prev = s / p;
      } else {
        prev = (prev * (p - 1) + tr[i]) / p;
      }
      out[i] = prev;
    }
    return out;
  }

  function rollingMax(c, p, key) {
    const out = new Array(c.length).fill(null);
    for (let i = p - 1; i < c.length; i++) {
      let m = -Infinity;
      for (let j = i - p + 1; j <= i; j++) m = Math.max(m, c[j][key]);
      out[i] = m;
    }
    return out;
  }
  function rollingMin(c, p, key) {
    const out = new Array(c.length).fill(null);
    for (let i = p - 1; i < c.length; i++) {
      let m = Infinity;
      for (let j = i - p + 1; j <= i; j++) m = Math.min(m, c[j][key]);
      out[i] = m;
    }
    return out;
  }

  // Pair an aligned value-array with candle times, dropping nulls.
  function line(candles, arr) {
    const out = [];
    for (let i = 0; i < candles.length; i++) {
      if (arr[i] != null && isFinite(arr[i])) out.push({ time: candles[i].time, value: arr[i] });
    }
    return out;
  }

  /* =================================================================
     Moving averages
     ================================================================= */
  const closes = c => c.map(x => x.close);

  const sma = (c, p) => line(c, smaArr(closes(c), p));
  const ema = (c, p) => line(c, emaArr(closes(c), p));

  // Volume-weighted average price (cumulative over the loaded window).
  function vwap(c) {
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

  /* =================================================================
     Bands & channels
     ================================================================= */
  function bollinger(c, p = 20, k = 2) {
    const cl = closes(c);
    const mid = smaArr(cl, p), sd = stdevArr(cl, p);
    const up = mid.map((m, i) => (m == null ? null : m + k * sd[i]));
    const lo = mid.map((m, i) => (m == null ? null : m - k * sd[i]));
    return { upper: line(c, up), middle: line(c, mid), lower: line(c, lo) };
  }

  function donchian(c, p = 20) {
    const hi = rollingMax(c, p, "high"), lo = rollingMin(c, p, "low");
    const mid = hi.map((h, i) => (h == null ? null : (h + lo[i]) / 2));
    return { upper: line(c, hi), middle: line(c, mid), lower: line(c, lo) };
  }

  function keltner(c, p = 20, mult = 1.5) {
    const mid = emaArr(closes(c), p), atr = atrArr(c, p);
    const up = mid.map((m, i) => (m == null || atr[i] == null ? null : m + mult * atr[i]));
    const lo = mid.map((m, i) => (m == null || atr[i] == null ? null : m - mult * atr[i]));
    return { upper: line(c, up), middle: line(c, mid), lower: line(c, lo) };
  }

  /* =================================================================
     Trend
     ================================================================= */
  // Parabolic SAR -> {dots:[{time,value,up}]} for marker rendering.
  function psar(c, step = 0.02, max = 0.2) {
    if (c.length < 2) return { dots: [] };
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
      dots.push({ time: c[i].time, value: sar, up });
    }
    return { dots };
  }

  // Supertrend -> two line arrays (up-trend / down-trend) for 2-colour plot.
  function supertrend(c, p = 10, mult = 3) {
    const atr = atrArr(c, p);
    const upSeg = [], downSeg = [];
    let trendUp = true, finalUpper = null, finalLower = null, prevST = null;
    for (let i = 0; i < c.length; i++) {
      if (atr[i] == null) continue;
      const hl2 = (c[i].high + c[i].low) / 2;
      let basicUpper = hl2 + mult * atr[i];
      let basicLower = hl2 - mult * atr[i];
      finalUpper = (finalUpper == null || basicUpper < finalUpper || c[i - 1].close > finalUpper) ? basicUpper : finalUpper;
      finalLower = (finalLower == null || basicLower > finalLower || c[i - 1].close < finalLower) ? basicLower : finalLower;
      if (prevST == null) { trendUp = c[i].close >= hl2; }
      else if (prevST === "upper" && c[i].close > finalUpper) trendUp = true;
      else if (prevST === "lower" && c[i].close < finalLower) trendUp = false;
      const st = trendUp ? finalLower : finalUpper;
      prevST = trendUp ? "lower" : "upper";
      const pt = { time: c[i].time, value: st };
      if (trendUp) { upSeg.push(pt); downSeg.push({ time: c[i].time }); }
      else { downSeg.push(pt); upSeg.push({ time: c[i].time }); }
    }
    return { up: upSeg, down: downSeg };
  }

  // Ichimoku Cloud (displaced where future bar times exist).
  function ichimoku(c, conv = 9, base = 26, spanB = 52, disp = 26) {
    const t = c.map(x => x.time);
    const hi = k => rollingMax(c, k, "high");
    const lo = k => rollingMin(c, k, "low");
    const h9 = hi(conv), l9 = lo(conv), h26 = hi(base), l26 = lo(base), h52 = hi(spanB), l52 = lo(spanB);
    const tenkan = h9.map((h, i) => (h == null ? null : (h + l9[i]) / 2));
    const kijun = h26.map((h, i) => (h == null ? null : (h + l26[i]) / 2));
    const senkouA = tenkan.map((tk, i) => (tk == null || kijun[i] == null ? null : (tk + kijun[i]) / 2));
    const senkouB = h52.map((h, i) => (h == null ? null : (h + l52[i]) / 2));
    // displace senkou forward, chikou backward — only where target time exists
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

  // Classic pivot points from the most recent completed "day".
  function pivots(c) {
    if (c.length < 2) return [];
    // group by calendar day (UTC) and take the last *completed* group
    const dayOf = ts => Math.floor(ts / 86400);
    let lastDay = dayOf(c[c.length - 1].time);
    let hi = -Infinity, lo = Infinity, close = null, count = 0;
    for (let i = c.length - 1; i >= 0; i--) {
      const d = dayOf(c[i].time);
      if (d === lastDay) continue;            // skip the in-progress day
      if (close === null) { lastDay = d; close = c[i].close; }
      if (d !== lastDay) break;
      hi = Math.max(hi, c[i].high); lo = Math.min(lo, c[i].low); count++;
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

  /* =================================================================
     Price action
     ================================================================= */
  // Fair Value Gaps (3-candle imbalance) -> markers on the gap candle.
  function fvg(c, limit = 25) {
    const out = [];
    for (let i = 2; i < c.length; i++) {
      if (c[i].low > c[i - 2].high) {                 // bullish gap
        out.push({ time: c[i].time, position: "belowBar", color: "#26a69a", shape: "arrowUp", text: "FVG" });
      } else if (c[i].high < c[i - 2].low) {          // bearish gap
        out.push({ time: c[i].time, position: "aboveBar", color: "#ef5350", shape: "arrowDown", text: "FVG" });
      }
    }
    return out.slice(-limit);
  }

  // Volume Profile -> Point of Control + Value Area High/Low as price levels.
  function volumeProfile(c, bins = 50, vaPct = 0.7) {
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
    // expand value area outward from POC until vaPct of volume covered
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

  /* =================================================================
     Volume
     ================================================================= */
  function volume(c) {
    return c.map(x => ({
      time: x.time,
      value: x.volume || 0,
      color: x.close >= x.open ? "rgba(38,166,154,0.5)" : "rgba(239,83,80,0.5)",
    }));
  }

  /* =================================================================
     Oscillators
     ================================================================= */
  function rsi(c, p = 14) {
    const cl = closes(c);
    const out = new Array(cl.length).fill(null);
    let avgG = 0, avgL = 0;
    for (let i = 1; i < cl.length; i++) {
      const ch = cl[i] - cl[i - 1];
      const g = Math.max(ch, 0), l = Math.max(-ch, 0);
      if (i <= p) { avgG += g; avgL += l; if (i === p) { avgG /= p; avgL /= p; out[i] = 100 - 100 / (1 + avgG / (avgL || 1e-9)); } }
      else { avgG = (avgG * (p - 1) + g) / p; avgL = (avgL * (p - 1) + l) / p; out[i] = 100 - 100 / (1 + avgG / (avgL || 1e-9)); }
    }
    return line(c, out);
  }

  function macd(c, fast = 12, slow = 26, signal = 9) {
    const cl = closes(c);
    const ef = emaArr(cl, fast), es = emaArr(cl, slow);
    const macdArr = ef.map((f, i) => (f == null || es[i] == null ? null : f - es[i]));
    // signal = EMA of macd over its valid region
    const valid = macdArr.map(v => (v == null ? 0 : v));
    const firstIdx = macdArr.findIndex(v => v != null);
    const sigArr = new Array(cl.length).fill(null);
    if (firstIdx >= 0) {
      const seg = valid.slice(firstIdx);
      const sigSeg = emaArr(seg, signal);
      for (let i = 0; i < sigSeg.length; i++) sigArr[firstIdx + i] = sigSeg[i];
    }
    const hist = macdArr.map((m, i) => {
      if (m == null || sigArr[i] == null) return null;
      return { v: m - sigArr[i] };
    });
    const histLine = [];
    for (let i = 0; i < c.length; i++) {
      if (hist[i]) histLine.push({
        time: c[i].time, value: hist[i].v,
        color: hist[i].v >= 0 ? "rgba(38,166,154,0.6)" : "rgba(239,83,80,0.6)",
      });
    }
    return { macd: line(c, macdArr), signal: line(c, sigArr), hist: histLine };
  }

  function stochastic(c, kP = 14, kSmooth = 3, dP = 3) {
    const hh = rollingMax(c, kP, "high"), ll = rollingMin(c, kP, "low");
    const rawK = c.map((x, i) => {
      if (hh[i] == null || ll[i] == null || hh[i] === ll[i]) return null;
      return (100 * (x.close - ll[i])) / (hh[i] - ll[i]);
    });
    const k = smaArr(rawK.map(v => (v == null ? 0 : v)), kSmooth)
      .map((v, i) => (rawK[i] == null ? null : v));
    const d = smaArr(k.map(v => (v == null ? 0 : v)), dP)
      .map((v, i) => (k[i] == null ? null : v));
    return { k: line(c, k), d: line(c, d) };
  }

  return {
    sma, ema, vwap,
    bollinger, donchian, keltner,
    psar, supertrend, ichimoku, pivots,
    fvg, volumeProfile, volume,
    rsi, macd, stochastic,
  };
})();
