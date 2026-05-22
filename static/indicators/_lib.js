/* ======================================================================
   _lib.js — shared technical-analysis primitives
   ----------------------------------------------------------------------
   Indicator modules import the small building blocks they need from here.
   Files whose name starts with "_" are IGNORED by the auto-discovery
   endpoint, so this never shows up as a selectable indicator.

   Candle shape used everywhere:
       { time, open, high, low, close, volume }
   "Arr" helpers return number[] aligned to the input (null during warmup).
   `line()` pairs such an array with candle times, dropping nulls, ready
   to hand straight to a Lightweight Charts line series.
   ====================================================================== */

export const closes = c => c.map(x => x.close);

// Pair an aligned value-array with candle times, dropping nulls/NaN.
export function line(candles, arr) {
  const out = [];
  for (let i = 0; i < candles.length; i++) {
    const v = arr[i];
    if (v != null && isFinite(v)) out.push({ time: candles[i].time, value: v });
  }
  return out;
}

// Simple moving average over a number array.
export function smaArr(vals, p) {
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
export function emaArr(vals, p) {
  const out = new Array(vals.length).fill(null);
  const k = 2 / (p + 1);
  let prev = null;
  for (let i = 0; i < vals.length; i++) {
    if (i < p - 1) continue;
    if (i === p - 1) {
      let s = 0; for (let j = 0; j < p; j++) s += vals[j];
      prev = s / p;
    } else {
      prev = vals[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

// Rolling population standard deviation.
export function stdevArr(vals, p) {
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

// Wilder's Average True Range.
export function atrArr(c, p) {
  const tr = new Array(c.length).fill(null);
  for (let i = 0; i < c.length; i++) {
    if (i === 0) { tr[i] = c[i].high - c[i].low; continue; }
    const pc = c[i - 1].close;
    tr[i] = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - pc), Math.abs(c[i].low - pc));
  }
  const out = new Array(c.length).fill(null);
  let prev = null;
  for (let i = 0; i < c.length; i++) {
    if (i < p) continue;
    if (i === p) { let s = 0; for (let j = 1; j <= p; j++) s += tr[j]; prev = s / p; }
    else prev = (prev * (p - 1) + tr[i]) / p;
    out[i] = prev;
  }
  return out;
}

export function rollingMax(c, p, key) {
  const out = new Array(c.length).fill(null);
  for (let i = p - 1; i < c.length; i++) {
    let m = -Infinity;
    for (let j = i - p + 1; j <= i; j++) m = Math.max(m, c[j][key]);
    out[i] = m;
  }
  return out;
}

export function rollingMin(c, p, key) {
  const out = new Array(c.length).fill(null);
  for (let i = p - 1; i < c.length; i++) {
    let m = Infinity;
    for (let j = i - p + 1; j <= i; j++) m = Math.min(m, c[j][key]);
    out[i] = m;
  }
  return out;
}

// Convenience wrappers returning chart-ready {time,value} arrays.
export const sma = (c, p) => line(c, smaArr(closes(c), p));
export const ema = (c, p) => line(c, emaArr(closes(c), p));
