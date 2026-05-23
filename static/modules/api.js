/* ======================================================================
   api.js — all backend calls in one place (#15: decouple data from UI)
   ----------------------------------------------------------------------
   Thin wrappers over the Flask endpoints. History is sanitized here so
   the rest of the app only ever sees clean candles.
   ====================================================================== */

import { sanitizeCandles } from "./validate.js";

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

export const fetchSources = () => getJSON("/api/sources");

export const fetchIndicatorList = () => getJSON("/api/indicators");

export async function fetchHistory(source, symbol, timeframe) {
  const q = `source=${encodeURIComponent(source)}&symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`;
  const j = await getJSON(`/api/history?${q}`);
  return sanitizeCandles(j.candles || []);
}

export async function fetchQuote(source, symbol) {
  const q = `source=${encodeURIComponent(source)}&symbol=${encodeURIComponent(symbol)}`;
  const j = await getJSON(`/api/quote?${q}`);
  return j;  // { source, symbol, price }
}
