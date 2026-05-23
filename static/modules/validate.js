/* ======================================================================
   validate.js — defensive candle sanitization (#8)
   ----------------------------------------------------------------------
   The frontend should never trust raw payloads blindly. Bad data (NaNs,
   out-of-order timestamps, duplicates, missing fields) silently corrupts
   charts and indicators, so we clean it once at the boundary.
   ====================================================================== */

// Return a clean, ascending, de-duplicated array of OHLCV candles.
// Anything malformed is dropped rather than allowed to poison rendering.
export function sanitizeCandles(raw) {
  if (!Array.isArray(raw)) return [];

  const clean = [];
  for (const c of raw) {
    if (!c) continue;
    const time = +c.time;
    const open = +c.open, high = +c.high, low = +c.low, close = +c.close;
    const volume = Number.isFinite(+c.volume) ? +c.volume : 0;
    if (![time, open, high, low, close].every(Number.isFinite)) continue;  // drop NaN/missing
    clean.push({ time, open, high, low, close, volume });
  }

  clean.sort((a, b) => a.time - b.time);                  // enforce ordering

  const out = [];
  for (const c of clean) {
    if (out.length && out[out.length - 1].time === c.time) {
      out[out.length - 1] = c;                            // dedupe: keep latest for a timestamp
    } else {
      out.push(c);
    }
  }
  return out;
}

// Normalize a single live bar the same way (used by websocket/poll updates).
export function sanitizeBar(b) {
  if (!b) return null;
  const time = +b.time, open = +b.open, high = +b.high, low = +b.low, close = +b.close;
  const volume = Number.isFinite(+b.volume) ? +b.volume : 0;
  if (![time, open, high, low, close].every(Number.isFinite)) return null;
  return { time, open, high, low, close, volume };
}
