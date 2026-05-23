"""
data_sources — pluggable, auto-discovered market-data providers.

Public facade (used by app.py):
    get_source(name)
    list_sources_meta()
    get_history(name, symbol, timeframe)   # normalized candles
    get_quote(name, symbol)
    search_symbols(name, query)

To add a broker: drop a module in data_sources/providers/ that defines a
SOURCE dict (see existing providers). No edits here are required.
"""

from .registry import (
    get_source,
    list_sources_meta,
    get_history,
    get_quote,
    search_symbols,
)

__all__ = [
    "get_source", "list_sources_meta",
    "get_history", "get_quote", "search_symbols",
]
