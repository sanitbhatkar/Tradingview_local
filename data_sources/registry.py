"""
registry.py — auto-discover provider modules and expose a clean facade
======================================================================
Scans data_sources/providers/ for modules (skipping _-prefixed), validates
each module's SOURCE against the contract, and serves history/quote/search
through normalization + isolation. Adding a broker = drop a file in
providers/ — no central edit (#1). Discovery is lazy (#3): nothing runs
until the first call.
"""

import os
import importlib
import pkgutil

from . import providers
from .base import validate_source, normalize_candles

_SOURCES = None   # name -> SOURCE dict (built on first access)


def _discover():
    found = {}
    pkg_path = os.path.dirname(providers.__file__)
    for _, modname, _ispkg in pkgutil.iter_modules([pkg_path]):
        if modname.startswith("_"):
            continue
        try:
            mod = importlib.import_module(f"{providers.__name__}.{modname}")
        except Exception as exc:
            print(f"[registry] failed to import provider '{modname}': {exc}")
            continue
        src = getattr(mod, "SOURCE", None)
        ok, why = validate_source(src) if src is not None else (False, "no SOURCE export")
        if not ok:
            print(f"[registry] skipping provider '{modname}': {why}")
            continue
        found[src["name"]] = src
    print(f"[registry] discovered {len(found)} providers: {', '.join(sorted(found))}")
    return found


def _all():
    global _SOURCES
    if _SOURCES is None:
        _SOURCES = _discover()
    return _SOURCES


def get_source(name):
    return _all().get(name)


def list_sources_meta():
    """Serializable metadata for the frontend (no callables)."""
    meta = []
    for s in _all().values():
        meta.append({
            "name": s["name"],
            "label": s["label"],
            "asset_type": s.get("asset_type", "other"),
            "timeframes": s["timeframes"],
            "symbols": s.get("default_symbols", []),         # curated starting set
            "capabilities": s.get("capabilities", {}),
            "searchable": callable(s.get("search")),
            "realtime": s.get("realtime", {"type": "poll", "interval": 5000}),
        })
    return meta


def get_history(name, symbol, timeframe):
    s = get_source(name)
    if not s:
        raise ValueError(f"unknown source '{name}'")
    return normalize_candles(s["history"](symbol, timeframe))


def get_quote(name, symbol):
    s = get_source(name)
    if not s:
        raise ValueError(f"unknown source '{name}'")
    return s["quote"](symbol)


def search_symbols(name, query):
    s = get_source(name)
    if not s:
        raise ValueError(f"unknown source '{name}'")
    fn = s.get("search")
    if not callable(fn):
        # fallback: substring-filter the curated defaults
        q = (query or "").lower()
        return [{"symbol": sym, "label": sym, "exchange": ""}
                for sym in s.get("default_symbols", []) if q in sym.lower()]
    results = fn(query) or []
    # always guarantee something usable: fall back to defaults on empty result
    if not results and not (query or "").strip():
        return [{"symbol": sym, "label": sym, "exchange": ""}
                for sym in s.get("default_symbols", [])]
    return results
