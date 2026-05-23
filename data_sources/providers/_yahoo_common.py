"""
_yahoo_common.py — shared Yahoo Finance logic (history / quote / search)
========================================================================
Both the India and US providers use Yahoo's public v8 chart API for
candles and its v1 search API for symbol discovery. They differ only in
how search results are filtered, so that predicate is passed in.

No network at import. Underscore prefix => not auto-discovered.
"""

from .._http import get_json
from ..base import TTLCache

_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
_SEARCH = "https://query2.finance.yahoo.com/v1/finance/search"

# Yahoo interval name + the range that yields a useful number of bars.
_TF = {
    "1m":  ("1m",  "7d"),
    "5m":  ("5m",  "60d"),
    "15m": ("15m", "60d"),
    "30m": ("30m", "60d"),
    "1h":  ("60m", "730d"),
    "1d":  ("1d",  "5y"),
}
TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "1d"]

_hist_cache = TTLCache()
_search_cache = TTLCache()


def history(symbol, timeframe):
    key = f"{symbol}|{timeframe}"
    cached = _hist_cache.get(key)
    if cached is not None:
        return cached
    interval, rng = _TF.get(timeframe, _TF["5m"])
    data = get_json(_CHART.format(symbol=symbol),
                    params={"interval": interval, "range": rng, "includePrePost": "false"})
    result = data["chart"]["result"][0]
    stamps = result.get("timestamp") or []
    q = result["indicators"]["quote"][0]
    o, h, l, c = q["open"], q["high"], q["low"], q["close"]
    v = q.get("volume") or [None] * len(stamps)
    rows = []
    for i, ts in enumerate(stamps):
        if None in (o[i], h[i], l[i], c[i]):
            continue
        rows.append({
            "time": int(ts), "open": float(o[i]), "high": float(h[i]),
            "low": float(l[i]), "close": float(c[i]),
            "volume": float(v[i]) if i < len(v) and v[i] is not None else 0,
        })
    _hist_cache.set(key, rows, 5)        # short TTL: dedupe burst reloads only
    return rows


def quote(symbol):
    data = get_json(_CHART.format(symbol=symbol), params={"interval": "1m", "range": "1d"})
    result = data["chart"]["result"][0]
    px = result.get("meta", {}).get("regularMarketPrice")
    if px is None:
        closes = [x for x in result["indicators"]["quote"][0]["close"] if x is not None]
        px = closes[-1] if closes else None
    return {"price": float(px) if px is not None else None}


# --- search (pure parse separated from fetch so it is unit-testable) -------

def parse_search(data, predicate):
    out = []
    for q in (data.get("quotes") or []):
        sym = q.get("symbol")
        if not sym or not predicate(q):
            continue
        label = q.get("shortname") or q.get("longname") or sym
        out.append({
            "symbol": sym,
            "label": label,
            "exchange": q.get("exchDisp") or q.get("exchange") or "",
        })
    return out


def search(query, predicate):
    q = (query or "").strip()
    if not q:
        return []
    key = q.lower()
    # Cache the RAW response (shared across providers); apply the per-provider
    # filter on every call so India/US don't collide on the same query.
    data = _search_cache.get(key)
    if data is None:
        try:
            data = get_json(_SEARCH, params={"q": q, "quotesCount": 25, "newsCount": 0})
        except Exception as exc:
            print(f"[yahoo] search failed for '{q}': {exc}")
            return []
        _search_cache.set(key, data, 300)
    return parse_search(data, predicate)
