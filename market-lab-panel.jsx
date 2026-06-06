import React, { useEffect, useMemo, useState } from "react";
import BacktestPanel from "./backtest-panel.jsx";
import { computeCorrelationLookupFromOhlc } from "./backtest-engine.js";
import { fetchYahooHistory, probeYahooBridge, searchYahooSymbols } from "./yahoo-bridge-client.js";

const corrColor = (v) => {
  if (v >= 0.7) return "#f97316";
  if (v >= 0.3) return "#eab308";
  if (v >= 0) return "#22c55e";
  return "#3b82f6";
};

const corrBg = (v) => {
  if (v >= 0.7) return "rgba(249,115,22,.14)";
  if (v >= 0.3) return "rgba(234,179,8,.14)";
  if (v >= 0) return "rgba(34,197,94,.12)";
  return "rgba(59,130,246,.14)";
};

const colorFromTicker = (ticker) => {
  const palette = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#14b8a6", "#a855f7", "#f97316", "#06b6d4"];
  const code = (ticker || "").split("").reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return palette[code % palette.length];
};

const assetFromQuote = (quote, baseMap) => {
  const symbol = (quote?.symbol || "").toUpperCase();
  return baseMap?.[symbol] || {
    ticker: symbol,
    name: quote?.longname || quote?.shortname || symbol,
    region: quote?.exchDisp || quote?.exchange || "Yahoo",
    sector: quote?.typeDisp || quote?.quoteType || "Yahoo Asset",
    corr_group: quote?.typeDisp || quote?.quoteType || "CUSTOM",
    why_short: "Loaded from Yahoo local bridge.",
    why_full: "This asset was imported dynamically from Yahoo-compatible symbol search.",
    color: colorFromTicker(symbol),
    isCustom: true,
  };
};

const describeCorr = (v) => {
  if (v >= 0.7) return "High positive linkage. These assets have tended to move together strongly.";
  if (v >= 0.3) return "Moderate positive linkage. They share some common risk drivers but still diversify partially.";
  if (v >= 0) return "Low positive linkage. Diversification benefit is meaningful.";
  return "Negative linkage. This pair has historically offset each other during parts of the sample.";
};

export default function MarketLabPanel({ baseAssets, baseOhlcData }) {
  const baseAssetMap = useMemo(
    () => Object.fromEntries((baseAssets || []).map((asset) => [asset.ticker, asset])),
    [baseAssets],
  );
  const [bridgeReady, setBridgeReady] = useState(false);
  const [bridgeMessage, setBridgeMessage] = useState("Checking local Yahoo bridge...");
  const [query, setQuery] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [selectedPair, setSelectedPair] = useState(null);
  const [status, setStatus] = useState("");
  const [importingSymbol, setImportingSymbol] = useState("");
  const [assetMap, setAssetMap] = useState(() => baseAssetMap);
  const [extraOhlc, setExtraOhlc] = useState({});
  const [universeTickers, setUniverseTickers] = useState(["SPY", "TLT", "GLD"]);

  useEffect(() => {
    setAssetMap((prev) => ({ ...baseAssetMap, ...prev }));
  }, [baseAssetMap]);

  useEffect(() => {
    let active = true;
    probeYahooBridge()
      .then(() => {
        if (!active) return;
        setBridgeReady(true);
        setBridgeMessage("Local Yahoo bridge is online. You can search and import any Yahoo symbol.");
      })
      .catch(() => {
        if (!active) return;
        setBridgeReady(false);
        setBridgeMessage("Start local_refresh_server.py and open http://127.0.0.1:8765/ to enable full-universe Yahoo search.");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!bridgeReady || query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      setSearchBusy(true);
      searchYahooSymbols(query.trim(), 8)
        .then((payload) => {
          if (!active) return;
          setSearchResults(payload?.results || []);
        })
        .catch(() => {
          if (!active) return;
          setSearchResults([]);
        })
        .finally(() => {
          if (active) setSearchBusy(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [bridgeReady, query]);

  const ohlcData = useMemo(() => ({ ...(baseOhlcData || {}), ...extraOhlc }), [baseOhlcData, extraOhlc]);
  const availableTickers = useMemo(
    () => universeTickers.filter((ticker) => Array.isArray(ohlcData?.[ticker]) && ohlcData[ticker].length),
    [ohlcData, universeTickers],
  );
  const universeAssets = useMemo(
    () => availableTickers.map((ticker) => assetMap[ticker]).filter(Boolean),
    [assetMap, availableTickers],
  );
  const corrData = useMemo(
    () => computeCorrelationLookupFromOhlc(ohlcData, availableTickers),
    [ohlcData, availableTickers],
  );

  const importSymbol = async (symbol, quote) => {
    const nextSymbol = (symbol || "").trim().toUpperCase();
    if (!nextSymbol) return;
    setStatus("");
    if (ohlcData?.[nextSymbol]?.length) {
      setUniverseTickers((prev) => (prev.includes(nextSymbol) ? prev : [...prev, nextSymbol]));
      setQuery("");
      return;
    }
    try {
      setImportingSymbol(nextSymbol);
      const payload = await fetchYahooHistory(nextSymbol, "10y");
      const asset = assetFromQuote(
        {
          symbol: nextSymbol,
          longname: payload?.meta?.name || quote?.longname,
          shortname: payload?.meta?.shortName || quote?.shortname,
          exchange: payload?.meta?.exchange || quote?.exchange,
          exchDisp: payload?.meta?.exchange || quote?.exchDisp,
          quoteType: payload?.meta?.quoteType || quote?.quoteType,
          typeDisp: quote?.typeDisp || payload?.meta?.quoteType,
        },
        baseAssetMap,
      );
      setAssetMap((prev) => ({ ...prev, [nextSymbol]: asset }));
      setExtraOhlc((prev) => ({ ...prev, [nextSymbol]: payload?.ohlc || [] }));
      setUniverseTickers((prev) => (prev.includes(nextSymbol) ? prev : [...prev, nextSymbol]));
      setQuery("");
      setSearchResults([]);
      setStatus(`${nextSymbol} imported from Yahoo history.`);
    } catch (error) {
      setStatus(error?.message || `Failed to import ${nextSymbol}.`);
    } finally {
      setImportingSymbol("");
    }
  };

  const removeTicker = (ticker) => {
    if (universeTickers.length <= 2) return;
    setUniverseTickers((prev) => prev.filter((item) => item !== ticker));
    setSelectedPair(null);
  };

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1.2fr .8fr",gap:"16px",alignItems:"stretch",marginBottom:"18px"}}>
        <div style={{background:"#060e1c",border:"1px solid #0a1e32",borderRadius:"12px",padding:"20px 22px"}}>
          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#1e3a55",letterSpacing:".12em",marginBottom:"6px"}}>FULL UNIVERSE MODE</div>
          <div style={{fontWeight:800,fontSize:"18px",color:"#f0f6ff",marginBottom:"8px"}}>Yahoo Search + Dynamic Correlation + Portfolio Backtest</div>
          <div style={{fontSize:"12px",color:"#7a9ab5",lineHeight:1.7,marginBottom:"14px"}}>
            Search any Yahoo-compatible stock, ETF, ADR or international symbol, import its daily history, then run correlation analysis and backtests in the same workspace.
          </div>
          <div style={{display:"flex",gap:"10px",flexWrap:"wrap",alignItems:"center",marginBottom:"14px"}}>
            <input
              value={query}
              placeholder="Search Apple / Tesla / 0700.HK / TSM / BTC-USD"
              style={{flex:1,minWidth:"260px",background:"#030810",border:"1px solid #0a1a2e",borderRadius:"6px",padding:"10px 12px",color:"#d1d9e6",fontFamily:"Syne Mono",fontSize:"11px"}}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  importSymbol(query, null);
                }
              }}
            />
            <button
              className="nav-tab on"
              onClick={() => importSymbol(query, null)}
              disabled={!bridgeReady || !query.trim() || !!importingSymbol}
              style={{background:"#0e2540",borderColor:"#143a61",color:"#8fb8d8"}}
            >
              {importingSymbol ? `IMPORTING ${importingSymbol}...` : "ADD SYMBOL"}
            </button>
          </div>
          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:bridgeReady ? "#22c55e" : "#f59e0b",marginBottom:"8px"}}>
            {bridgeMessage}
          </div>
          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#3a5a75"}}>
            Best execution path: run the app via `python3 local_refresh_server.py`, then open `http://127.0.0.1:8765/`.
          </div>
          {status && (
            <div style={{marginTop:"12px",fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#8fb8d8"}}>
              {status}
            </div>
          )}
        </div>

        <div style={{background:"#060e1c",border:"1px solid #0a1e32",borderRadius:"12px",padding:"20px 22px"}}>
          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#1e3a55",letterSpacing:".12em",marginBottom:"10px"}}>UNIVERSE STATUS</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:"10px"}}>
            {[
              ["Loaded Assets", String(availableTickers.length)],
              ["Common Bars", String(corrData.dates.length || 0)],
              ["Search Mode", bridgeReady ? "ONLINE" : "OFFLINE"],
              ["Benchmark", "SPY"],
            ].map(([label, value]) => (
              <div key={label} style={{background:"#030810",border:"1px solid #0a1a2e",borderRadius:"8px",padding:"12px 14px"}}>
                <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"9px",color:"#1e3a55",letterSpacing:".1em",marginBottom:"6px"}}>{label}</div>
                <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"14px",fontWeight:700,color:"#d1d9e6"}}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {(searchBusy || searchResults.length > 0) && (
        <div style={{background:"#060e1c",border:"1px solid #0a1e32",borderRadius:"12px",padding:"16px 18px",marginBottom:"18px"}}>
          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#8fa8c0",marginBottom:"12px"}}>{searchBusy ? "SEARCHING YAHOO..." : "SEARCH RESULTS"}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:"10px"}}>
            {searchResults.map((item) => {
              const symbol = item.symbol;
              const imported = !!ohlcData?.[symbol]?.length;
              return (
                <div key={symbol} style={{background:"#030810",border:"1px solid #0a1a2e",borderRadius:"8px",padding:"12px 14px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:"10px",alignItems:"center",marginBottom:"6px"}}>
                    <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"13px",fontWeight:700,color:colorFromTicker(symbol)}}>{symbol}</div>
                    <button className="filter-pill" onClick={() => importSymbol(symbol, item)} disabled={!!importingSymbol}>
                      {imported ? "ADDED" : "IMPORT"}
                    </button>
                  </div>
                  <div style={{fontSize:"12px",color:"#d1d9e6",marginBottom:"5px"}}>{item.longname || item.shortname || symbol}</div>
                  <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"9px",color:"#3a5a75"}}>
                    {(item.typeDisp || item.quoteType || "Yahoo").toUpperCase()} · {item.exchDisp || item.exchange || "Yahoo"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{background:"#060e1c",border:"1px solid #0a1e32",borderRadius:"12px",padding:"20px 22px",marginBottom:"18px"}}>
        <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#8fa8c0",marginBottom:"12px"}}>ACTIVE UNIVERSE</div>
        <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
          {universeTickers.map((ticker) => {
            const asset = assetMap[ticker];
            const removable = universeTickers.length > 2;
            return (
              <button
                key={ticker}
                className="filter-pill on"
                style={{"--c": asset?.color || colorFromTicker(ticker), display:"flex",alignItems:"center",gap:"8px"}}
                onClick={() => removeTicker(ticker)}
                title={removable ? "Click to remove from dynamic universe" : ""}
              >
                <span>{ticker}</span>
                {removable ? <span style={{opacity:0.7}}>×</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{background:"#060e1c",border:"1px solid #0a1e32",borderRadius:"12px",padding:"20px 22px",marginBottom:"18px",overflowX:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"12px",marginBottom:"14px",flexWrap:"wrap"}}>
          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#1e3a55",letterSpacing:".12em"}}>
            DYNAMIC CORRELATION MATRIX — DAILY ADJ CLOSE RETURN BASIS
          </div>
          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#3a5a75"}}>
            {corrData.dates.length ? `${corrData.dates[0]} → ${corrData.dates[corrData.dates.length - 1]} · ${corrData.dates.length} return bars` : "Need at least 2 loaded assets"}
          </div>
        </div>

        {availableTickers.length >= 2 ? (
          <div style={{display:"grid",gridTemplateColumns:`80px repeat(${availableTickers.length},1fr)`,gap:"3px",minWidth:`${80 + availableTickers.length * 72}px`}}>
            <div />
            {availableTickers.map((ticker) => (
              <div key={`${ticker}-col`} style={{textAlign:"center",fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:assetMap[ticker]?.color || "#8fb8d8",padding:"4px 2px"}}>
                {ticker}
              </div>
            ))}
            {availableTickers.map((rowTicker) => (
              <React.Fragment key={`${rowTicker}-row`}>
                <div style={{display:"flex",alignItems:"center",paddingRight:"8px",fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:assetMap[rowTicker]?.color || "#8fb8d8"}}>
                  {rowTicker}
                </div>
                {availableTickers.map((colTicker) => {
                  const same = rowTicker === colTicker;
                  const value = same ? 1 : corrData.lookup?.[rowTicker]?.[colTicker] ?? 0;
                  return (
                    <div
                      key={`${rowTicker}-${colTicker}`}
                      className="corr-cell"
                      style={{
                        height:"42px",
                        background:same ? "#0a1e32" : corrBg(value),
                        color:same ? "#1e3a55" : corrColor(value),
                        border:same ? "1px solid #0a1e32" : `1px solid ${corrColor(value)}33`,
                      }}
                      onClick={() => {
                        if (same) return;
                        setSelectedPair({
                          a: assetMap[rowTicker],
                          b: assetMap[colTicker],
                          corr: value,
                        });
                      }}
                    >
                      {same ? "—" : value.toFixed(2)}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        ) : (
          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#4a6a85"}}>
            Import at least 2 Yahoo symbols to generate a dynamic correlation matrix.
          </div>
        )}

        {selectedPair && (
          <div style={{marginTop:"16px",padding:"16px 18px",background:"#030810",border:"1px solid #0a1a2e",borderRadius:"8px"}}>
            <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"11px",color:"#8fb8d8",marginBottom:"6px"}}>
              {selectedPair.a?.ticker} × {selectedPair.b?.ticker}: {selectedPair.corr.toFixed(2)}
            </div>
            <div style={{fontSize:"12px",color:"#7a9ab5",lineHeight:1.7}}>{describeCorr(selectedPair.corr)}</div>
          </div>
        )}
      </div>

      <BacktestPanel
        etfs={universeAssets}
        corrLookup={corrData.lookup}
        ohlcData={ohlcData}
        benchmarkTicker="SPY"
        defaultTickers={availableTickers}
        title="Global Yahoo Portfolio Backtest"
        description="Run portfolio backtests on any imported Yahoo-compatible assets."
        helperNote="Search and import assets above. SPY remains the default benchmark."
      />
    </div>
  );
}
