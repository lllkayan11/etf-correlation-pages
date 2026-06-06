# ETF Correlation Dashboard

An ETF and Yahoo market analysis dashboard with:

- correlation matrix analysis
- candlestick price charting
- portfolio backtesting
- dynamic Yahoo symbol search and import

## What This Project Includes

This repository contains a browser-based research dashboard with two modes:

1. `Published ETF Dashboard`
   - works directly from GitHub Pages
   - focuses on the built-in 10-ETF universe
   - includes correlation matrix, charting, and backtesting

2. `Local Yahoo Bridge Mode`
   - runs locally through `local_refresh_server.py`
   - enables arbitrary Yahoo-compatible symbol search and import
   - powers the `UNIVERSE LAB` workflow for symbols such as `AAPL`, `TSLA`, `0700.HK`, `TSM`, and `BTC-USD`

## Project Structure

- `etf-correlation-dashboard.jsx`: main app entry and global layout
- `market-lab-panel.jsx`: dynamic Yahoo universe search/import workflow
- `backtest-panel.jsx`: portfolio backtest UI
- `backtest-engine.js`: backtest and correlation engine
- `yahoo-bridge-client.js`: browser client for the local Yahoo bridge
- `local_refresh_server.py`: local static server plus Yahoo bridge API
- `fetch_yahoo_etf_data.py`: refreshes the published ETF JSON data set
- `app.bootstrap.js`: runtime entry that loads the compiled bundle
- `app.compiled.v2.js`: compiled browser bundle used by the app
- `index.html`: top-level HTML entry used locally and on GitHub Pages
- `yahoo_etf_monthly.json`: published monthly prices
- `yahoo_etf_corr.json`: published ETF correlation matrix
- `yahoo_etf_ohlc.json`: published ETF OHLC data

## Dependencies And Setup

### Required Software

- `Python 3.10+` recommended
- `pip` for Python package installation
- internet access for Yahoo data requests

### Python Dependencies

This project uses the following Python packages:

- `pandas`
- `yfinance`

Install them with:

```bash
python3 -m pip install pandas yfinance
```

### Build Dependency

If you want to rebuild the front-end bundle after editing `.jsx` files, install `esbuild`:

```bash
python3 -m pip install esbuild
```

Notes:

- running the already-built app does not require rebuilding the bundle
- React is loaded in the browser via `importmap`, so there is no `package.json` or `npm install` step required for basic usage

## How To Run The Project

### Option 1: Use The Published Site

Open:

- `https://lllkayan11.github.io/etf-correlation-pages/`

Use this mode for:

- browsing the fixed 10-ETF dashboard
- viewing the published correlation matrix
- using the built-in ETF price chart and backtest tabs

Notes:

- `UNIVERSE LAB` is available online, but its arbitrary-symbol workflow works best when the local Yahoo bridge is running
- if the site appears stale after a deployment, use a hard refresh: `Cmd + Shift + R`

### Option 2: Run The Local App

This is the recommended mode for full functionality.

From the project directory:

```bash
cd /Users/lkayan/Desktop/etf-correlation-pages
python3 local_refresh_server.py
```

Then open:

```text
http://127.0.0.1:8765/
```

This local server does three jobs:

- serves the dashboard files
- exposes `GET /api/search` for Yahoo symbol search
- exposes `GET /api/history` for Yahoo history import

## First Local Run Checklist

1. Install Python dependencies:

```bash
python3 -m pip install pandas yfinance
```

2. Start the local server:

```bash
cd /Users/lkayan/Desktop/etf-correlation-pages
python3 local_refresh_server.py
```

3. Open the app:

```text
http://127.0.0.1:8765/
```

4. For the fastest first demo:
   - open `UNIVERSE LAB`
   - click `Macro Core`
   - click `LOAD + RUN`

## How To Compile The Front End

If you modify `etf-correlation-dashboard.jsx`, `market-lab-panel.jsx`, or `backtest-panel.jsx`, rebuild the bundle:

```bash
cd /Users/lkayan/Desktop/etf-correlation-pages
python3 -m esbuild etf-correlation-dashboard.jsx \
  --bundle \
  --format=esm \
  --platform=browser \
  --target=es2020 \
  --loader:.jsx=jsx \
  --external:react \
  --external:react-dom/client \
  --outfile=app.compiled.v2.js
```

After rebuilding:

- make sure the bundle import version in `app.bootstrap.js` is updated when needed
- make sure the `app.bootstrap.js` import version in `index.html` is updated when needed
- reload the browser with a hard refresh if you still see an older bundle

## How To Refresh The Published ETF Data

To regenerate the published ETF JSON files locally:

```bash
cd /Users/lkayan/Desktop/etf-correlation-pages
python3 fetch_yahoo_etf_data.py
```

This updates:

- `yahoo_etf_monthly.json`
- `yahoo_etf_corr.json`
- `yahoo_etf_ohlc.json`

## How To Use Universe Lab

1. Open `UNIVERSE LAB`
2. Search a Yahoo-compatible symbol or company name
3. Click `IMPORT` or type a symbol and click `ADD SYMBOL`
4. Wait for the symbol to load into the active universe
5. Use the imported asset in:
   - the dynamic correlation matrix
   - the portfolio backtest panel

Examples:

- `AAPL`
- `MSFT`
- `TSLA`
- `0700.HK`
- `TSM`
- `BTC-USD`

## How Dynamic Import Works

The app does not call Yahoo directly from the browser for dynamic search/backtest mode.

Instead, it uses `local_refresh_server.py` as a lightweight local bridge because:

- browser-side Yahoo requests are less reliable
- Yahoo rate limits can cause failures
- direct browser access can run into CORS and session issues

This local bridge is the recommended and most stable workflow for arbitrary-symbol analysis.

## Backtest Notes

- benchmark defaults to `SPY`
- `MIN-CORR` uses the currently loaded common-history universe
- date bounds automatically clamp to valid overlapping trading windows
- if a selected date range has no overlap, the UI falls back to the full common window

## Troubleshooting

### Universe Lab does not search or import

Make sure you opened the app from:

```text
http://127.0.0.1:8765/
```

and not only from GitHub Pages.

### `python3 local_refresh_server.py` fails immediately

Check that the required Python packages are installed:

```bash
python3 -m pip install pandas yfinance
```

### `python3 -m esbuild ...` fails

Install the build dependency:

```bash
python3 -m pip install esbuild
```

### The page looks outdated after deployment

Use:

```text
Cmd + Shift + R
```

If needed, reopen the site after a short delay so GitHub Pages cache can refresh.

### Yahoo symbol import fails

Possible causes:

- temporary Yahoo rate limiting
- unsupported or delisted symbol
- local network blocking Yahoo requests

Try again after a short wait or test a common symbol such as `AAPL`.
