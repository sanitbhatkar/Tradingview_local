# Multi-Chart Dashboard

A local, TradingView-style dashboard: a configurable grid of live candlestick
charts. Live crypto streams over Hyperliquid's public websocket; Indian (NSE)
and US equities come from Yahoo Finance. Built with plain HTML/CSS/JS +
[Lightweight Charts](https://www.tradingview.com/lightweight-charts/) on the
front, a thin Flask backend on the back. No API keys, no deployment — it all
runs on `127.0.0.1`.

## Project layout

```
Finance_Plot/
├── app.py              # Flask backend: serves the page + /api/{sources,history,quote}
├── data_source.py      # the swappable data layer — one function per broker
├── requirements.txt
├── templates/
│   └── index.html      # dashboard shell + pane template
└── static/
    ├── style.css       # dark theme, responsive 1/2/4/6/8 grid, indicator panel
    ├── indicators.js   # pure technical-analysis math (no charting)
    └── app.js          # charts, shared HL websocket, polling, indicators, persistence
```

## Key design points

- **`data_source.py`** — each broker is one function returning a dict
  (`name`, `label`, `timeframes`, `symbols`, `history`, `quote`, `realtime`).
  Add a new broker = write one function and add it to `_register_all_sources()`.
  The backend and the browser pick it up automatically.
- **Shared Hyperliquid websocket** — the browser opens **one** websocket and
  multiplexes it by `(coin, interval)` with ref-counted subscribe/unsubscribe
  and exponential-backoff auto-reconnect (`static/app.js`, the `HL` object).
- **Yahoo has no public stream**, so a 5 s `/api/quote` poll folds the live
  price into the current candle while a 60 s `/api/history` refetch rolls in
  new bars correctly.
- **Windows hardening** in `data_source.py`:
  - `truststore.inject_into_ssl()` makes Python trust the OS cert store, so
    antivirus TLS interception (AVG, Avast, Kaspersky…) doesn't break HTTPS.
  - The Windows root/intermediate stores are exported to a temp PEM and fed to
    `curl_cffi` via `CURL_CA_BUNDLE` (curl_cffi ignores the stdlib patch).
  - `curl_cffi` with `impersonate="chrome"` sends a real Chrome TLS
    fingerprint, so Yahoo's v8 chart API doesn't rate-limit us (HTTP 429).
- **Grid layouts** — `1` full, `2` side-by-side, `4` = 2×2, `6` = 3×2,
  `8` = 4×2, with responsive fallbacks for narrow screens.
- **Persistence** — chart count + every pane's `(source, symbol, timeframe)`
  is saved in `localStorage` under `mcd:v1:state`, so a reload restores your
  exact layout.
- **Colour-coded ticker** flashes green/red (`.ticker-up` / `.ticker-down`) on
  every price change.
- **Market status badges** — the top bar shows live `HL live` plus `US market`
  (NYSE 09:30–16:00 ET) and `IN market` (NSE 09:15–15:30 IST) open/closed,
  computed timezone-aware in `app.js` (`updateMarketStatus`) and refreshed every
  30 s. (Holidays are not accounted for — hours only.)

## Indicators

Click **INDICATORS** on any pane to open the panel and tick what you want.
Indicators are per-pane, recompute live as candles update, and persist across
reloads. Overlays draw on the price scale; oscillators get their own stacked
sub-pane below the price (the lower 40 % of the chart is split evenly among
active oscillators). The math lives in `static/indicators.js`; rendering is
driven by the `INDICATOR_GROUPS` table in `static/app.js`.

| Category | Indicators |
| --- | --- |
| Moving Averages | SMA 20 / 50 / 200, EMA 20 / 50 / 200, VWAP |
| Bands & Channels | Bollinger (20, 2), Donchian (20), Keltner (20, 1.5) |
| Trend | Parabolic SAR, Supertrend (10, 3), Ichimoku Cloud, Pivot Points |
| Price Action | Fair Value Gaps, Volume Profile (POC / VAH / VAL) |
| Volume | Volume (colour-coded histogram) |
| Oscillators | RSI (14), MACD (12, 26, 9), Stochastic (14, 3, 3) |

**Add your own indicator:** write the math as a pure function in
`indicators.js` (takes `candles`, returns `{time, value}` arrays), then add one
entry to the relevant group in `INDICATOR_GROUPS` (`app.js`) describing how to
draw it (`overlayLines`, `lower`, `markers`, or `priceLines`). It appears in
every pane's panel automatically.

> Notes: Volume / VWAP / Volume Profile need volume data — Hyperliquid and Yahoo
> both supply it. Volume Profile and Pivot Points are drawn as horizontal levels
> (POC/VAH/VAL and P/R1–R3/S1–S3) rather than a full histogram, since
> Lightweight Charts has no native horizontal-volume primitive.

## Running it

Create a local conda environment (Python 3.10) inside the project folder, then
install and run:

```powershell
cd "D:\Finance_Plot"
conda create -p .\env python=3.10 -y
conda activate .\env
pip install -r requirements.txt
python app.py
```

Then open **http://127.0.0.1:5000/**.

> The `-p .\env` flag puts the environment in a local `env\` folder next to the
> code (rather than a named global env). On later runs you only need
> `conda activate .\env` then `python app.py`.

### Quick sanity check (optional)

```powershell
python data_source.py
```

This prints the registered sources and tries a live Hyperliquid + Yahoo fetch.

## Notes & limits

- No API keys, nothing leaves your machine except calls to Hyperliquid and
  Yahoo.
- Indian quotes only **tick during NSE market hours** (09:15–15:30 IST) — a
  Yahoo limitation, not a bug. Outside hours you'll see the last session's
  candles, static.
- Yahoo intraday history is range-limited (1 m ≈ 7 days, 5 m/15 m/30 m ≈ 60
  days). Daily goes back years.

## Adding another broker (Alpaca / Binance / Zerodha / Polygon …)

In `data_source.py`:

```python
def my_broker_source():
    return {
        "name": "mybroker",
        "label": "My Broker",
        "timeframes": ["1m", "5m", "1h", "1d"],
        "symbols": ["AAA", "BBB"],
        "history": lambda symbol, timeframe: [ {"time":..., "open":..., "high":..., "low":..., "close":...}, ... ],
        "quote":   lambda symbol: {"price": 123.45},
        "realtime": {"type": "poll", "interval": 5000},  # or a custom ws type
    }
```

then add `my_broker_source()` to the list in `_register_all_sources()`.
Restart the server and it appears in every pane's source dropdown.
