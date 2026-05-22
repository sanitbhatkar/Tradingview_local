"""
data_source.py
==============
The single, swappable data layer for the multi-chart dashboard.

Every broker / data provider is described by ONE function that returns a dict:

    {
        "name":       "hyperliquid",          # internal id (no spaces)
        "label":      "Hyperliquid (Crypto)", # shown in the UI dropdown
        "timeframes": ["1m", "5m", ...],       # selectable intervals
        "symbols":    ["BTC", "ETH", ...],     # selectable symbols
        "history":    fn(symbol, timeframe) -> [ {time, open, high, low, close}, ... ],
        "quote":      fn(symbol)            -> {"price": float},
        "realtime":   {"type": "...", ...},    # how the FRONTEND streams live ticks
    }

To add a new broker (Alpaca, Binance, Zerodha, Polygon, ...):
    1. write   def my_broker(): return { ... }   following the contract above
    2. add it to the list inside _register_all_sources()
That's the whole job. The Flask backend and the browser pick it up automatically.

----------------------------------------------------------------------
Windows hardening (learned the hard way):
  * Antivirus products (AVG, Avast, Kaspersky, ...) re-sign every HTTPS
    connection with their own root CA. Python's bundled CA list does not
    trust that root, so requests fail with CERTIFICATE_VERIFY_FAILED.
    Fix: truststore.inject_into_ssl() makes Python's stdlib SSL use the
    OS trust store, and we also export the Windows store to a temp PEM and
    point CURL_CA_BUNDLE / SSL_CERT_FILE at it (curl_cffi ignores the
    stdlib patch).
  * Yahoo rate-limits plain-Python clients (HTTP 429). Fix: curl_cffi with
    impersonate="chrome" sends a real Chrome TLS fingerprint, and we hit
    Yahoo's v8 chart API directly instead of the yfinance wrapper.
----------------------------------------------------------------------
"""

import os
import sys
import ssl
import time
import atexit
import tempfile

# ---------------------------------------------------------------------------
# TLS / certificate hardening  (must run before any HTTPS call is made)
# ---------------------------------------------------------------------------

def _inject_os_trust_store():
    """Make Python's stdlib SSL trust whatever the OS trusts (incl. AV roots)."""
    try:
        import truststore
        truststore.inject_into_ssl()
    except Exception as exc:  # truststore missing or unsupported -> carry on
        print(f"[data_source] truststore not active: {exc}")


def _export_windows_certs_for_curl():
    """
    curl_cffi uses its own bundled CA list and ignores truststore. On Windows
    we dump the OS root + intermediate stores to a temp PEM and tell curl_cffi
    (via env vars) to use it, so AV-intercepted TLS still verifies.
    """
    if sys.platform != "win32":
        return
    try:
        pem_blocks = []
        for store_name in ("ROOT", "CA"):
            try:
                for cert_bytes, enc_type, _trust in ssl.enum_certificates(store_name):
                    if enc_type == "x509_asn":
                        pem_blocks.append(ssl.DER_cert_to_PEM_cert(cert_bytes))
            except Exception:
                pass
        if not pem_blocks:
            return
        fd, path = tempfile.mkstemp(prefix="winca_", suffix=".pem")
        with os.fdopen(fd, "w") as fh:
            fh.write("\n".join(pem_blocks))
        os.environ["CURL_CA_BUNDLE"] = path
        os.environ.setdefault("SSL_CERT_FILE", path)
        atexit.register(lambda: os.path.exists(path) and os.remove(path))
        print(f"[data_source] exported {len(pem_blocks)} Windows certs -> {path}")
    except Exception as exc:
        print(f"[data_source] Windows cert export skipped: {exc}")


_inject_os_trust_store()
_export_windows_certs_for_curl()

# ---------------------------------------------------------------------------
# HTTP session  (Chrome-impersonating curl_cffi, falls back to requests)
# ---------------------------------------------------------------------------

try:
    from curl_cffi import requests as _http
    _SESSION = _http.Session(impersonate="chrome")
    _USING_CFFI = True
except Exception as exc:  # pragma: no cover - fallback path
    import requests as _http
    _SESSION = _http.Session()
    _SESSION.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    _USING_CFFI = False
    print(f"[data_source] curl_cffi unavailable, using plain requests: {exc}")


def _get_json(url, params=None, timeout=15):
    r = _SESSION.get(url, params=params, timeout=timeout)
    r.raise_for_status()
    return r.json()


def _post_json(url, payload, timeout=15):
    r = _SESSION.post(url, json=payload, timeout=timeout)
    r.raise_for_status()
    return r.json()


# ===========================================================================
# SOURCE 1 — Hyperliquid (live crypto)
# ===========================================================================
#
# History  : POST https://api.hyperliquid.xyz/info  {"type":"candleSnapshot",...}
# Quote    : POST https://api.hyperliquid.xyz/info  {"type":"allMids"}
# Realtime : the browser opens wss://api.hyperliquid.xyz/ws directly and
#            subscribes to the {"type":"candle", coin, interval} feed.

_HL_API = "https://api.hyperliquid.xyz/info"

_HL_INTERVAL_MS = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
}

# Sensible default universe in case the live meta fetch fails.
_HL_FALLBACK_SYMBOLS = [
    "BTC", "ETH", "SOL", "ARB", "AVAX", "BNB", "DOGE", "XRP",
    "LINK", "OP", "MATIC", "SUI", "APT", "LTC", "ATOM", "INJ",
]


def _hl_symbols():
    """Pull the full perp universe once; fall back to a curated list."""
    try:
        meta = _post_json(_HL_API, {"type": "meta"})
        names = [a["name"] for a in meta.get("universe", []) if not a.get("isDelisted")]
        # Keep the most liquid names near the top, then the rest alphabetically.
        head = [s for s in _HL_FALLBACK_SYMBOLS if s in names]
        tail = sorted(s for s in names if s not in head)
        return head + tail or _HL_FALLBACK_SYMBOLS
    except Exception as exc:
        print(f"[hyperliquid] meta fetch failed, using fallback: {exc}")
        return list(_HL_FALLBACK_SYMBOLS)


def hl_history(symbol, timeframe, bars=500):
    """Return up to `bars` candles as Lightweight-Charts rows (time in seconds)."""
    step = _HL_INTERVAL_MS.get(timeframe, _HL_INTERVAL_MS["5m"])
    end = int(time.time() * 1000)
    start = end - bars * step
    payload = {
        "type": "candleSnapshot",
        "req": {"coin": symbol, "interval": timeframe, "startTime": start, "endTime": end},
    }
    raw = _post_json(_HL_API, payload)
    rows = []
    for c in raw:
        rows.append({
            "time": int(c["t"]) // 1000,
            "open": float(c["o"]),
            "high": float(c["h"]),
            "low": float(c["l"]),
            "close": float(c["c"]),
            "volume": float(c.get("v") or 0),
        })
    rows.sort(key=lambda r: r["time"])
    return rows


def hl_quote(symbol):
    mids = _post_json(_HL_API, {"type": "allMids"})
    px = mids.get(symbol)
    return {"price": float(px) if px is not None else None}


def hyperliquid_source():
    return {
        "name": "hyperliquid",
        "label": "Hyperliquid (Crypto)",
        "timeframes": ["1m", "5m", "15m", "1h", "4h", "1d"],
        "symbols": _hl_symbols(),
        "history": hl_history,
        "quote": hl_quote,
        # Tells the frontend to stream live candles over Hyperliquid's websocket.
        "realtime": {
            "type": "hyperliquid_ws",
            "url": "wss://api.hyperliquid.xyz/ws",
        },
    }


# ===========================================================================
# SOURCES 2 & 3 — Yahoo Finance (India NSE + US), via the v8 chart API
# ===========================================================================
#
# History  : GET query1.finance.yahoo.com/v8/finance/chart/<symbol>
# Quote    : same endpoint, meta.regularMarketPrice (or last close)
# Realtime : no public stream -> the frontend POLLS /api/quote every few sec.

_YF_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"

# Yahoo interval names + the range that returns a useful number of bars.
_YF_TF = {
    "1m":  ("1m",  "7d"),
    "5m":  ("5m",  "60d"),
    "15m": ("15m", "60d"),
    "30m": ("30m", "60d"),
    "1h":  ("60m", "730d"),
    "1d":  ("1d",  "5y"),
}

_YF_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "1d"]

_YF_IN_SYMBOLS = [
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
    "SBIN.NS", "ADANIPORTS.NS", "TATAMOTORS.NS", "AXISBANK.NS", "ITC.NS",
    "LT.NS", "BHARTIARTL.NS", "WIPRO.NS", "MARUTI.NS", "SUNPHARMA.NS",
    "HINDUNILVR.NS", "KOTAKBANK.NS", "BAJFINANCE.NS", "^NSEI", "^BSESN",
]

_YF_US_SYMBOLS = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "AMD",
    "NFLX", "INTC", "JPM", "DIS", "BA", "COIN", "SPY", "QQQ",
]


def _yf_history(symbol, timeframe, bars=None):
    interval, rng = _YF_TF.get(timeframe, _YF_TF["5m"])
    data = _get_json(
        _YF_CHART.format(symbol=symbol),
        params={"interval": interval, "range": rng, "includePrePost": "false"},
    )
    result = data["chart"]["result"][0]
    stamps = result.get("timestamp") or []
    quote = result["indicators"]["quote"][0]
    o, h, l, c = quote["open"], quote["high"], quote["low"], quote["close"]
    v = quote.get("volume") or [None] * len(stamps)
    rows = []
    for i, ts in enumerate(stamps):
        if None in (o[i], h[i], l[i], c[i]):
            continue  # skip gaps / holidays
        rows.append({
            "time": int(ts),
            "open": float(o[i]),
            "high": float(h[i]),
            "low": float(l[i]),
            "close": float(c[i]),
            "volume": float(v[i]) if i < len(v) and v[i] is not None else 0,
        })
    return rows


def _yf_quote(symbol):
    data = _get_json(
        _YF_CHART.format(symbol=symbol),
        params={"interval": "1m", "range": "1d"},
    )
    result = data["chart"]["result"][0]
    meta = result.get("meta", {})
    px = meta.get("regularMarketPrice")
    if px is None:
        closes = [v for v in result["indicators"]["quote"][0]["close"] if v is not None]
        px = closes[-1] if closes else None
    return {"price": float(px) if px is not None else None}


def yahoo_in_source():
    return {
        "name": "yahoo_in",
        "label": "Yahoo Finance (India)",
        "timeframes": _YF_TIMEFRAMES,
        "symbols": _YF_IN_SYMBOLS,
        "history": _yf_history,
        "quote": _yf_quote,
        "realtime": {"type": "poll", "interval": 5000},
    }


def yahoo_us_source():
    return {
        "name": "yahoo_us",
        "label": "Yahoo Finance (US Stocks)",
        "timeframes": _YF_TIMEFRAMES,
        "symbols": _YF_US_SYMBOLS,
        "history": _yf_history,
        "quote": _yf_quote,
        "realtime": {"type": "poll", "interval": 5000},
    }


# ===========================================================================
# Registry
# ===========================================================================

def _register_all_sources():
    """Add one line per broker here. Order = order shown in the UI."""
    return [
        hyperliquid_source(),
        yahoo_in_source(),
        yahoo_us_source(),
    ]


# Built once at import. Re-import / restart the server to refresh symbol lists.
_SOURCES = {s["name"]: s for s in _register_all_sources()}


def get_source(name):
    return _SOURCES.get(name)


def list_sources_meta():
    """Everything the frontend needs to build its dropdowns (no Python fns)."""
    meta = []
    for s in _SOURCES.values():
        meta.append({
            "name": s["name"],
            "label": s["label"],
            "timeframes": s["timeframes"],
            "symbols": s["symbols"],
            "realtime": s["realtime"],
        })
    return meta


if __name__ == "__main__":
    # Quick self-test:  python data_source.py
    print(f"curl_cffi active: {_USING_CFFI}")
    for m in list_sources_meta():
        print(f"  {m['name']:<12} {len(m['symbols'])} symbols, tf={m['timeframes']}")
    try:
        h = hl_history("BTC", "5m")
        print(f"  hyperliquid BTC 5m: {len(h)} candles, last close {h[-1]['close'] if h else 'n/a'}")
    except Exception as e:
        print(f"  hyperliquid test failed: {e}")
    try:
        q = _yf_quote("TCS.NS")
        print(f"  yahoo TCS.NS quote: {q}")
    except Exception as e:
        print(f"  yahoo test failed: {e}")
