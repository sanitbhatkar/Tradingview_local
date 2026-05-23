"""
yahoo_in.py — Yahoo Finance, Indian (NSE/BSE) equities + indices.
Symbols are discovered live via Yahoo search; the default list is just a
convenient starting set shown before the user searches.
"""

from . import _yahoo_common as y

_DEFAULT = [
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
    "SBIN.NS", "ADANIPORTS.NS", "TATAMOTORS.NS", "AXISBANK.NS", "ITC.NS",
    "LT.NS", "BHARTIARTL.NS", "WIPRO.NS", "MARUTI.NS", "SUNPHARMA.NS",
    "^NSEI", "^BSESN",
]


def _is_india(q):
    sym = q.get("symbol", "") or ""
    if sym.endswith(".NS") or sym.endswith(".BO"):
        return True
    return q.get("exchange") in ("NSI", "BSE")


def search(query):
    return y.search(query, _is_india)


SOURCE = {
    "name": "yahoo_in",
    "label": "Yahoo Finance (India)",
    "asset_type": "equity",
    "timeframes": y.TIMEFRAMES,
    "default_symbols": _DEFAULT,
    "capabilities": {"search": True, "realtime": False},
    "realtime": {"type": "poll", "interval": 5000},
    "history": y.history,
    "quote": y.quote,
    "search": search,
}
