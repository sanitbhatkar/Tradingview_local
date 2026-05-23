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
├── app.py              # Flask backend: page + /api/{sources,history,quote,indicators}
├── data_source.py      # the swappable data layer — one function per broker
├── requirements.txt
├── templates/
│   └── index.html      # dashboard shell + pane template
└── static/
    ├── style.css       # dark theme, responsive 1/2/4/6/8 grid, indicator search panel
    ├── app.js          # thin ES-module bootstrap (boot() wires everything)
    ├── modules/        # the frontend, split into focused ES modules
    │   ├── state.js          # SOURCES/PANES/STATE + versioned persistence
    │   ├── util.js           # debounce, price formatting
    │   ├── validate.js       # candle sanitization (NaN/order/dedupe)
    │   ├── api.js            # backend fetch wrappers
    │   ├── indicatorRegistry.js  # discover + dynamic-import indicator modules
    │   ├── hyperliquid.js    # shared ref-counted websocket
    │   ├── marketStatus.js   # NYSE/NSE open-closed badges
    │   ├── ticker.js         # colour-coded price bar
    │   ├── indicatorEngine.js    # create/draw/remove indicator series (error-isolated)
    │   ├── indicatorPanel.js     # TradingView-style search panel
    │   ├── pane.js           # Pane class (chart + realtime + lifecycle/destroy)
    │   └── grid.js           # build/reshape the pane grid
    └── indicators/     # one self-contained module per indicator (auto-discovered)
        ├── _lib.js     # shared TA primitives (SMA/EMA/ATR/…); _-prefixed = not an indicator
        ├── sma20.js    # …each file default-exports one indicator def
        ├── rsi.js
        └── …
```

The frontend is loaded as a single `<script type="module">` (`app.js`); the
browser resolves the `modules/` and `indicators/` imports natively, so there's
still no bundler or build step.

## Key design points

- **`data_source.py`** — each broker is one function returning a dict
  (`name`, `label`, `timeframes`, `symbols`, `history`, `quote`, `realtime`).
  Add a new broker = write one function and add it to `_register_all_sources()`.
  The backend and the browser pick it up automatically.
- **Shared Hyperliquid websocket** — the browser opens **one** websocket and
  multiplexes it by `(coin, interval)` with ref-counted subscribe/unsubscribe
  and exponential-backoff auto-reconnect (`static/modules/hyperliquid.js`, the
  `HL` object).
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
- **Persistence** — chart count + every pane's `(source, symbol, timeframe,
  indicators)` is saved in `localStorage` under `mcd:v2:state` (versioned, with
  a safe fallback if the stored layout is incompatible), so a reload restores
  your exact layout.
- **Colour-coded ticker** flashes green/red (`.ticker-up` / `.ticker-down`) on
  every price change.
- **Market status badges** — the top bar shows live `HL live` plus `US market`
  (NYSE 09:30–16:00 ET) and `IN market` (NSE 09:15–15:30 IST) open/closed,
  computed timezone-aware in `static/modules/marketStatus.js` and refreshed
  every 30 s. (Holidays are not accounted for — hours only.)

## Robustness notes

The frontend is defensive in a few deliberate places so it stays stable during
long live sessions:

- **Per-indicator error isolation** — a throwing indicator is caught and logged
  in `indicatorEngine.js`; it never breaks the render loop or the websocket feed.
- **Explicit pane lifecycle** — `Pane.destroy()` tears down timers, the resize
  observer, the websocket subscription and the chart, and a `destroyed` guard
  stops any late async callback (fetch/poll/socket) touching a disposed chart.
- **Candle sanitization** — `validate.js` drops NaN/missing fields, sorts by
  time and de-duplicates before anything is plotted.
- **Debounced resize** — chart resizes are coalesced to avoid relayout storms.
- **Versioned persistence** — see above; a stale/garbage saved layout can't
  crash startup.

## Indicators

Click **INDICATORS** on any pane to open the search panel, type to filter, and
tick what you want — TradingView-style. Indicators are per-pane, recompute live
as candles update, and persist across reloads. Overlays draw on the price scale;
oscillators get their own stacked sub-pane below the price (the lower 40 % of the
chart is split evenly among active oscillators).

| Category | Indicators |
| --- | --- |
| Moving Averages | SMA 20 / 50 / 200, EMA 20 / 50 / 200, VWAP |
| Bands & Channels | Bollinger (20, 2), Donchian (20), Keltner (20, 1.5) |
| Trend | Parabolic SAR, Supertrend (10, 3), Ichimoku Cloud, Pivot Points |
| Price Action | Fair Value Gaps, Volume Profile (POC / VAH / VAL) |
| Volume | Volume (colour-coded histogram) |
| Oscillators | RSI (14), MACD (12, 26, 9), Stochastic (14, 3, 3) |

### How the indicator system is wired (modular, auto-discovered)

Each indicator is **one self-contained ES module** in `static/indicators/`. On
load the backend's `/api/indicators` endpoint lists the folder, and the frontend
(`modules/indicatorRegistry.js`) dynamically `import()`s every file. There is
**no central registry** — adding an indicator means adding a file, nothing else.

A module default-exports a single object:

```js
// static/indicators/my_indicator.js
import { sma } from "./_lib.js";   // borrow shared primitives if useful

export default {
  id: "my_ind",                    // unique id (persisted in localStorage)
  name: "My Indicator (20)",       // searchable display name
  category: "Moving Averages",     // groups results in the search list
  swatch: "#2962ff",               // colour chip in the panel
  type: "overlayLines",            // overlayLines | lower | markers | priceLines
  styles: { l: { color: "#2962ff", width: 2 } },
  compute: (candles) => ({ l: sma(candles, 20) }),
};
```

The four `type` values cover every render shape:

- **`overlayLines`** — one or more lines on the price scale. `compute` returns
  `{ <styleName>: [{time, value}], … }`.
- **`lower`** — a stacked sub-pane below price. `compute` returns
  `{ lines: { <name>: [...] }, hist?: [{time, value, color}] }`. Add
  `guides: [{value, color}]` for reference levels (e.g. RSI 70/30).
- **`markers`** — symbols on the candles. `compute` returns an array of
  `{time, position, color, shape}`.
- **`priceLines`** — horizontal levels. `compute` returns `{price, color, title}[]`.

**To add an indicator:** drop a `.js` file in `static/indicators/`, restart the
server (so the folder is re-scanned), refresh the page — it appears in every
pane's search panel automatically. Shared maths (SMA, EMA, ATR, rolling
high/low, std-dev) live in `static/indicators/_lib.js`; files whose name starts
with `_` are skipped by discovery, so put helpers there.

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
