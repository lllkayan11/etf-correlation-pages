# ETF Correlation Dashboard

An ETF and Yahoo market analysis dashboard with:

- correlation matrix analysis
- candlestick price charting
- portfolio backtesting
- dynamic Yahoo symbol search and import

## Overview

This project supports two usage modes:

1. `GitHub Pages` mode
   - best for the published 10-ETF dashboard
   - no local service required

2. `Local Yahoo Bridge` mode
   - best for searching any Yahoo-compatible symbol
   - required for dynamic imports such as `AAPL`, `TSLA`, `0700.HK`, `TSM`, `BTC-USD`
   - enables the `UNIVERSE LAB` workflow

## Project Files

- `etf-correlation-dashboard.jsx`: main app entry and tabs
- `market-lab-panel.jsx`: dynamic Yahoo universe search/import workflow
- `backtest-panel.jsx`: portfolio backtest UI
- `backtest-engine.js`: backtest and correlation engine
- `local_refresh_server.py`: local static server plus Yahoo bridge API
- `fetch_yahoo_etf_data.py`: refreshes the published ETF JSON data set
- `yahoo_etf_monthly.json`: published monthly prices
- `yahoo_etf_corr.json`: published ETF correlation matrix
- `yahoo_etf_ohlc.json`: published ETF OHLC data

## Online Usage

Published site:

- `https://lllkayan11.github.io/etf-correlation-pages/`

Online mode is ideal for:

- browsing the fixed 10-ETF dashboard
- viewing the published correlation matrix
- using the built-in ETF price chart and backtest tabs

Note:

- The `UNIVERSE LAB` feature is designed to work best with the local Yahoo bridge.
- If the site appears stale after a deployment, use a hard refresh: `Cmd + Shift + R`.

## Local Setup

### Prerequisites

- macOS or Linux
- Python 3.11+ recommended
- internet access for Yahoo data requests

Python packages used by this project:

- `yfinance`
- `pandas`

Install them if needed:

```bash
pip3 install yfinance pandas
```

## Start The App

From the project directory:

```bash
cd /Users/lkayan/Desktop/etf-correlation-pages
python3 local_refresh_server.py
```

Then open:

```text
http://127.0.0.1:8765/
```

This local server does three jobs at once:

- serves the dashboard files
- exposes `GET /api/search` for Yahoo symbol search
- exposes `GET /api/history` for Yahoo history import

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

## Refresh Published ETF Data

To regenerate the published ETF JSON files locally:

```bash
cd /Users/lkayan/Desktop/etf-correlation-pages
python3 fetch_yahoo_etf_data.py
```

This updates:

- `yahoo_etf_monthly.json`
- `yahoo_etf_corr.json`
- `yahoo_etf_ohlc.json`

## Backtest Notes

- Benchmark defaults to `SPY`
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

## Development Notes

When changing front-end source files, rebuild the published bundle:

```bash
python3 -m esbuild /Users/lkayan/Desktop/etf-correlation-pages/etf-correlation-dashboard.jsx \
  --bundle \
  --format=esm \
  --platform=browser \
  --target=es2020 \
  --loader:.jsx=jsx \
  --external:react \
  --external:react-dom/client \
  --outfile=/Users/lkayan/Desktop/etf-correlation-pages/app.compiled.v2.js
```

If the bundle is rebuilt, make sure the version parameters remain updated in:

- `app.bootstrap.js`
- `index.html`
