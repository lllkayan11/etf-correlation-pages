import json
from pathlib import Path

import pandas as pd
import yfinance as yf


TICKERS = ["SPY", "EZU", "INDA", "KWEB", "EWH", "GLD", "TLT", "DBC", "VNQ", "EWJ"]
START = "2019-01-01"
END = None  # None means "up to latest available"
OUT_DIR = Path(__file__).resolve().parent


def fetch_and_save() -> None:
    raw = yf.download(
        TICKERS,
        start=START,
        end=END,
        interval="1d",
        auto_adjust=False,
        progress=False,
        group_by="ticker",
        threads=True,
    )

    adj = pd.DataFrame({ticker: raw[ticker]["Adj Close"] for ticker in TICKERS})
    adj = adj.dropna(how="all").sort_index()

    returns_common = adj.pct_change().dropna(how="all").dropna(how="any")
    corr = returns_common.corr().round(3)
    monthly = adj.resample("ME").last().dropna(how="all")

    monthly_payload = {}
    for ticker in TICKERS:
        series = monthly[ticker].dropna()
        monthly_payload[ticker] = [
            {"date": dt.strftime("%Y-%m"), "price": round(float(value), 2), "year": int(dt.year)}
            for dt, value in series.items()
        ]

    corr_payload = {
        "tickers": TICKERS,
        "start": START,
        "end": "latest",
        "trading_days_common": int(len(returns_common)),
        "monthly_points": int(len(monthly)),
        "corr_matrix": [[float(corr.loc[r, c]) for c in TICKERS] for r in TICKERS],
    }

    (OUT_DIR / "yahoo_etf_monthly.json").write_text(
        json.dumps(monthly_payload, ensure_ascii=False),
        encoding="utf-8",
    )
    (OUT_DIR / "yahoo_etf_corr.json").write_text(
        json.dumps(corr_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    fetch_and_save()
    print("Saved yahoo_etf_monthly.json and yahoo_etf_corr.json")
