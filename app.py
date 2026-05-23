"""
app.py
======
Thin Flask backend for the multi-chart dashboard.

It does these jobs:
  1. serves the dashboard page + static assets
  2. tells the browser which data sources exist (/api/sources)
  3. lists the auto-discovered indicator modules (/api/indicators)
  4. proxies history + quotes so the browser never hits CORS walls
  5. dynamic symbol search across providers (/api/search)

Live crypto candles do NOT go through here -- the browser talks to
Hyperliquid's public websocket directly. This server only bridges the
request/response data sources (Yahoo) and symbol search.

Run:
    python app.py
    -> http://127.0.0.1:5000/
"""

import os

from flask import Flask, jsonify, request, render_template

import data_sources as ds

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/indicators")
def api_indicators():
    """
    Auto-discovery: list every indicator module in static/indicators/.
    Files whose name starts with "_" (shared libs) are skipped. Drop a new
    <name>.js in that folder and it shows up in the UI on next reload --
    no central registry to edit.
    """
    folder = os.path.join(app.static_folder, "indicators")
    files = []
    if os.path.isdir(folder):
        files = sorted(
            f for f in os.listdir(folder)
            if f.endswith(".js") and not f.startswith("_")
        )
    return jsonify(files)


@app.route("/api/sources")
def api_sources():
    """List of sources + their timeframes/default symbols/capabilities."""
    return jsonify(ds.list_sources_meta())


@app.route("/api/search")
def api_search():
    """Dynamic symbol search for one source: /api/search?source=&q="""
    source = request.args.get("source", "")
    query = request.args.get("q", "")
    try:
        return jsonify({"source": source, "query": query,
                        "results": ds.search_symbols(source, query)})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 404
    except Exception as exc:
        app.logger.exception("search failed")
        return jsonify({"error": str(exc)}), 502


@app.route("/api/history")
def api_history():
    """OHLC history for one (source, symbol, timeframe)."""
    source = request.args.get("source", "")
    symbol = request.args.get("symbol", "")
    timeframe = request.args.get("timeframe", "")
    try:
        rows = ds.get_history(source, symbol, timeframe)
        return jsonify({"source": source, "symbol": symbol,
                        "timeframe": timeframe, "candles": rows})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 404
    except Exception as exc:
        app.logger.exception("history failed")
        return jsonify({"error": str(exc)}), 502


@app.route("/api/quote")
def api_quote():
    """Latest price for one (source, symbol). Polled by non-streaming sources."""
    source = request.args.get("source", "")
    symbol = request.args.get("symbol", "")
    try:
        return jsonify({"source": source, "symbol": symbol, **ds.get_quote(source, symbol)})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 404
    except Exception as exc:
        app.logger.exception("quote failed")
        return jsonify({"error": str(exc)}), 502


if __name__ == "__main__":
    # threaded=True so concurrent /api/* polls from many panes don't block.
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
