"""
base.py — provider contract, normalization, caching, isolation
==============================================================
Cross-cutting helpers every provider benefits from:
  * TTLCache         small in-memory cache (#7) to spare external APIs
  * normalize_candles canonical candle schema, time in seconds (#6)
  * validate_source  light provider contract check (#5)
  * safe_call        exception-isolating call wrapper (#4)
Leading concern: keep providers thin and consistent.
"""

import math
import time


# ---------------------------------------------------------------------------
# Tiny TTL cache
# ---------------------------------------------------------------------------
class TTLCache:
    def __init__(self):
        self._d = {}

    def get(self, key):
        entry = self._d.get(key)
        if not entry:
            return None
        value, expires = entry
        if time.time() > expires:
            self._d.pop(key, None)
            return None
        return value

    def set(self, key, value, ttl):
        self._d[key] = (value, time.time() + ttl)


# ---------------------------------------------------------------------------
# Canonical candle schema
# ---------------------------------------------------------------------------
# Lightweight Charts expects ascending, unique, numeric candles with the time
# in UNIX *seconds*. We enforce that here so a misbehaving provider can't
# silently corrupt a chart (the classic ms-vs-seconds bug).
def normalize_candles(rows):
    out = []
    for r in rows or []:
        try:
            t = int(r["time"])
            o = float(r["open"]); h = float(r["high"])
            l = float(r["low"]);  c = float(r["close"])
            v = float(r.get("volume") or 0)
        except (KeyError, TypeError, ValueError):
            continue
        if t <= 0:
            continue
        if not all(math.isfinite(x) for x in (o, h, l, c, v)):
            continue                  # drop NaN / inf values
        # guard against a provider handing back milliseconds
        if t > 10_000_000_000:        # ~ year 2286 in seconds => clearly ms
            t //= 1000
        out.append({"time": t, "open": o, "high": h, "low": l, "close": c, "volume": v})

    out.sort(key=lambda x: x["time"])
    deduped = []
    for r in out:
        if deduped and deduped[-1]["time"] == r["time"]:
            deduped[-1] = r              # keep the latest for a timestamp
        else:
            deduped.append(r)
    return deduped


# ---------------------------------------------------------------------------
# Provider contract
# ---------------------------------------------------------------------------
_REQUIRED = ("name", "label", "timeframes", "history", "quote")

def validate_source(s):
    """Return (ok, reason). A failing provider is skipped, not fatal (#4)."""
    if not isinstance(s, dict):
        return False, "SOURCE is not a dict"
    for k in _REQUIRED:
        if k not in s:
            return False, f"missing required key '{k}'"
    if not callable(s["history"]) or not callable(s["quote"]):
        return False, "history/quote must be callable"
    if not isinstance(s["timeframes"], (list, tuple)) or not s["timeframes"]:
        return False, "timeframes must be a non-empty list"
    return True, ""


def safe_call(fn, *args, **kwargs):
    """Run a provider callable, isolating exceptions. Returns (ok, value|error)."""
    try:
        return True, fn(*args, **kwargs)
    except Exception as exc:
        return False, str(exc)
