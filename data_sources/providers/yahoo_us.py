"""
yahoo_us.py — Yahoo Finance, US equities / ETFs / indices.
Discovers symbols via Yahoo search, filtered to US-listed instruments.
"""

from . import _yahoo_common as y

_DEFAULT = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "AMD",
    "NFLX", "INTC", "JPM", "DIS", "BA", "COIN", "SPY", "QQQ",
]

# Yahoo exchange display values that we treat as "US".
_US_EXCH = {"NMS", "NYQ", "NGM", "ASE", "PCX", "BATS", "NCM", "NASDAQ", "NYSE"}


def _is_us(q):
    sym = q.get("symbol", "") or ""
    if "." in sym and not sym.startswith("^"):
        return False                       # exclude foreign-suffixed (e.g. .NS, .L)
    qt = q.get("quoteType")
    if qt not in ("EQUITY", "ETF", "INDEX"):
        return False
    exch = q.get("exchange")
    # accept known US exchanges, or indices (^...) which Yahoo tags variously
    return exch in _US_EXCH or sym.startswith("^") or qt == "ETF"


def search(query):
    return y.search(query, _is_us)


SOURCE = {
    "name": "yahoo_us",
    "label": "Yahoo Finance (US Stocks)",
    "asset_type": "equity",
    "timeframes": y.TIMEFRAMES,
    "default_symbols": _DEFAULT,
    "capabilities": {"search": True, "realtime": False},
    "realtime": {"type": "poll", "interval": 5000},
    "history": y.history,
    "quote": y.quote,
    "search": search,
}
