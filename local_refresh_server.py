import json
import subprocess
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pandas as pd
import yfinance as yf


ROOT_DIR = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8765
SEARCH_CACHE_TTL = 15 * 60
HISTORY_CACHE_TTL = 12 * 60 * 60
SEARCH_CACHE = {}
HISTORY_CACHE = {}


def json_response(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def make_monthly_payload(hist: pd.DataFrame):
    monthly = hist["Adj Close"].dropna().resample("ME").last()
    return [
        {
            "date": dt.strftime("%Y-%m"),
            "price": round(float(value), 2),
            "year": int(dt.year),
        }
        for dt, value in monthly.items()
    ]


def make_ohlc_payload(hist: pd.DataFrame):
    clean = hist[["Open", "High", "Low", "Close", "Adj Close", "Volume"]].dropna(how="any")
    return [
        {
            "date": dt.strftime("%Y-%m-%d"),
            "open": round(float(row["Open"]), 4),
            "high": round(float(row["High"]), 4),
            "low": round(float(row["Low"]), 4),
            "close": round(float(row["Close"]), 4),
            "adjClose": round(float(row["Adj Close"]), 4),
            "volume": int(row["Volume"]),
        }
        for dt, row in clean.iterrows()
    ]


def cached_get(store, key, ttl):
    row = store.get(key)
    if not row:
        return None
    if time.time() - row["ts"] > ttl:
        store.pop(key, None)
        return None
    return row["value"]


def cached_set(store, key, value):
    store[key] = {"ts": time.time(), "value": value}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            json_response(
                self,
                200,
                {
                    "ok": True,
                    "service": "local-yahoo-bridge",
                    "search_cache_size": len(SEARCH_CACHE),
                    "history_cache_size": len(HISTORY_CACHE),
                },
            )
            return
        if parsed.path == "/api/search":
            params = parse_qs(parsed.query)
            query = (params.get("query", [""])[0] or "").strip()
            limit = max(1, min(20, int(params.get("limit", ["8"])[0] or 8)))
            if len(query) < 1:
                json_response(self, 200, {"ok": True, "results": []})
                return
            cache_key = f"{query.lower()}::{limit}"
            cached = cached_get(SEARCH_CACHE, cache_key, SEARCH_CACHE_TTL)
            if cached is None:
                search = yf.Search(query, max_results=limit)
                seen = set()
                rows = []
                for item in search.quotes or []:
                    symbol = (item.get("symbol") or "").upper()
                    if not symbol or symbol in seen:
                        continue
                    seen.add(symbol)
                    rows.append(
                        {
                            "symbol": symbol,
                            "shortname": item.get("shortname") or item.get("longname") or symbol,
                            "longname": item.get("longname") or item.get("shortname") or symbol,
                            "quoteType": item.get("quoteType") or item.get("typeDisp") or "UNKNOWN",
                            "typeDisp": item.get("typeDisp") or item.get("quoteType") or "Unknown",
                            "exchange": item.get("exchange") or item.get("exchDisp") or "Yahoo",
                            "exchDisp": item.get("exchDisp") or item.get("exchange") or "Yahoo",
                            "sectorDisp": item.get("sectorDisp"),
                            "isYahooFinance": bool(item.get("isYahooFinance", True)),
                        }
                    )
                    if len(rows) >= limit:
                        break
                cached = rows
                cached_set(SEARCH_CACHE, cache_key, cached)
            json_response(self, 200, {"ok": True, "results": cached})
            return
        if parsed.path == "/api/history":
            params = parse_qs(parsed.query)
            symbol = (params.get("symbol", [""])[0] or "").strip().upper()
            period = (params.get("period", ["10y"])[0] or "10y").strip()
            if not symbol:
                json_response(self, 400, {"ok": False, "message": "Missing symbol."})
                return
            cache_key = f"{symbol}::{period}"
            cached = cached_get(HISTORY_CACHE, cache_key, HISTORY_CACHE_TTL)
            if cached is None:
                ticker = yf.Ticker(symbol)
                hist = ticker.history(period=period, interval="1d", auto_adjust=False)
                if hist is None or hist.empty:
                    json_response(self, 404, {"ok": False, "message": f"No Yahoo history found for {symbol}."})
                    return
                meta = ticker.history_metadata or {}
                cached = {
                    "ok": True,
                    "symbol": symbol,
                    "meta": {
                        "symbol": meta.get("symbol") or symbol,
                        "name": meta.get("longName") or meta.get("shortName") or symbol,
                        "shortName": meta.get("shortName") or meta.get("longName") or symbol,
                        "quoteType": meta.get("instrumentType") or "UNKNOWN",
                        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName") or "Yahoo",
                        "currency": meta.get("currency") or "",
                        "timezone": meta.get("exchangeTimezoneName") or meta.get("timezone") or "",
                    },
                    "monthly": make_monthly_payload(hist),
                    "ohlc": make_ohlc_payload(hist),
                }
                cached_set(HISTORY_CACHE, cache_key, cached)
            json_response(self, 200, cached)
            return
        super().do_GET()

    def do_POST(self):
        if self.path != "/refresh-yahoo":
            self.send_error(404, "Not Found")
            return
        try:
            subprocess.run(
                ["python3", str(ROOT_DIR / "fetch_yahoo_etf_data.py")],
                check=True,
                cwd=str(ROOT_DIR),
                capture_output=True,
                text=True,
            )
            payload = {"ok": True, "message": "Yahoo data refreshed."}
            body = json.dumps(payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except subprocess.CalledProcessError as exc:
            payload = {"ok": False, "message": exc.stderr[-800:] if exc.stderr else str(exc)}
            body = json.dumps(payload).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Serving {ROOT_DIR} on http://{HOST}:{PORT}")
    print("POST /refresh-yahoo to regenerate local Yahoo data JSON files.")
    print("GET /api/search?query=... and /api/history?symbol=... expose Yahoo search/history for the app.")
    server.serve_forever()
