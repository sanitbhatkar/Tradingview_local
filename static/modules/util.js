/* ======================================================================
   util.js — tiny shared helpers, no dependencies
   ====================================================================== */

// Coalesce rapid calls (e.g. ResizeObserver storms) into one trailing call.
export function debounce(fn, ms = 80) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Price formatting with sensible decimals for the magnitude.
export function formatPrice(p) {
  if (p == null || !isFinite(p)) return "--";
  const abs = Math.abs(p);
  const dp = abs >= 1000 ? 2 : abs >= 1 ? 3 : 6;
  return p.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
