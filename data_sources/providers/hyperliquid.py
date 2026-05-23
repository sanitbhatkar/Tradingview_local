"""
hyperliquid.py — Hyperliquid perpetuals (live crypto).
History via candleSnapshot, quote via allMids, symbol discovery by filtering
the full perp universe (fetched lazily and cached, never at import).
"""

import time

from .._http import post_json
from ..base import TTLCache

_API = "https://api.hyperliquid.xyz/info"

_INTERVAL_MS = {
    "1m": 60_000, "5m": 300_000, "15m": 900_000,
    "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
}

# Curated, liquid names shown before the user searches (and a safe fallback
# if the universe fetch fails).
_DEFAULT = [
    "BTC", "ETH", "SOL", "ARB", "AVAX", "BNB", "DOGE", "XRP",
    "LINK", "OP", "MATIC", "SUI", "APT", "LTC", "ATOM", "INJ",
]

_universe_cache = TTLCache()


def _universe():
    """Full perp universe, fetched on demand and cached for 10 min (lazy #3)."""
    cached = _universe_cache.get("u")
    if cached is not None:
        return cached
    try:
        meta = post_json(_API, {"type": "meta"})
        names = [a["name"] for a in meta.get("universe", []) if not a.get("isDelisted")]
        if not names:
            names = list(_DEFAULT)
    except Exception as exc:
        print(f"[hyperliquid] universe fetch failed, using fallback: {exc}")
        names = list(_DEFAULT)
    _universe_cache.set("u", names, 600)
    return names


def history(symbol, timeframe, bars=500):
    step = _INTERVAL_MS.get(timeframe, _INTERVAL_MS["5m"])
    end = int(time.time() * 1000)
    start = end - bars * step
    raw = post_json(_API, {
        "type": "candleSnapshot",
        "req": {"coin": symbol, "interval": timeframe, "startTime": start, "endTime": end},
    })
    rows = []
    for c in raw:
        rows.append({
            "time": int(c["t"]) // 1000,
            "open": float(c["o"]), "high": float(c["h"]),
            "low": float(c["l"]), "close": float(c["c"]),
            "volume": float(c.get("v") or 0),
        })
    return rows


def quote(symbol):
    mids = post_json(_API, {"type": "allMids"})
    px = mids.get(symbol)
    return {"price": float(px) if px is not None else None}


def search(query):
    q = (query or "").strip().upper()
    names = _universe()
    if not q:
        return [{"symbol": n, "label": n, "exchange": "Hyperliquid"} for n in _DEFAULT]
    starts = [n for n in names if n.startswith(q)]
    contains = [n for n in names if q in n and n not in starts]
    return [{"symbol": n, "label": n, "exchange": "Hyperliquid"} for n in (starts + contains)[:30]]


SOURCE = {
    "name": "hyperliquid",
    "label": "Hyperliquid (Crypto)",
    "asset_type": "crypto",
    "timeframes": ["1m", "5m", "15m", "1h", "4h", "1d"],
    "default_symbols": _DEFAULT,
    "capabilities": {"search": True, "realtime": True},
    "realtime": {"type": "hyperliquid_ws", "url": "wss://api.hyperliquid.xyz/ws"},
    "history": history,
    "quote": quote,
    "search": search,
}
