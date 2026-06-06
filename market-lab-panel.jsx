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

const STARTER_PACKS = [
  {
    id: "macro-core",
    title: "Macro Core",
    subtitle: "Recommended starter pack",
    description: "The fastest first test: equity beta, duration, gold and commodities in one professional cross-asset universe.",
    symbols: ["SPY", "TLT", "GLD", "DBC"],
    requiresBridge: false,
    backtest: {
      weightsPct: { SPY: 35, TLT: 35, GLD: 15, DBC: 15 },
      rebalance: "monthly",
      initialCapital: 100000,
    },
  },
  {
    id: "ai-platforms",
    title: "AI Platforms",
    subtitle: "Growth / semiconductor stack",
    description: "A concentrated technology research basket for testing momentum, benchmark linkage and concentration risk.",
    symbols: ["AAPL", "MSFT", "NVDA", "TSM"],
    requiresBridge: true,
    backtest: {
      weightsPct: { AAPL: 20, MSFT: 30, NVDA: 30, TSM: 20 },
      rebalance: "quarterly",
      initialCapital: 100000,
    },
  },
  {
    id: "global-diversifiers",
    title: "Global Diversifiers",
    subtitle: "Cross-region mixed drivers",
    description: "A broader regime-comparison set combining US equity, Japan, India, gold and Bitcoin.",
    symbols: ["SPY", "EWJ", "INDA", "GLD", "BTC-USD"],
    requiresBridge: true,
    backtest: {
      weightsPct: { SPY: 30, EWJ: 20, INDA: 20, GLD: 15, "BTC-USD": 15 },
      rebalance: "monthly",
      initialCapital: 100000,
    },
  },
];

const QUICK_SYMBOLS = ["AAPL", "MSFT", "NVDA", "TSM", "BTC-USD", "QQQ"];

export default function MarketLabPanel({ baseAssets, baseOhlcData, autoRunPackId }) {
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
  const [importingPack, setImportingPack] = useState("");
  const [autoRunRequest, setAutoRunRequest] = useState(null);
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

  const importSymbols = async (symbols, { replaceUniverse = false, packLabel = "" } = {}) => {
    const nextSymbols = Array.from(
      new Set((symbols || []).map((item) => (item || "").trim().toUpperCase()).filter(Boolean)),
    );
    if (!nextSymbols.length) return;
    setStatus("");
    setSelectedPair(null);
    const missingSymbols = nextSymbols.filter((symbol) => !(ohlcData?.[symbol] || []).length);
    if (missingSymbols.length && !bridgeReady) {
      setStatus("Local Yahoo bridge is required to import new symbols. Start local_refresh_server.py first.");
      setQuery("");
      return;
    }
    try {
      const nextAssetMap = {};
      const nextExtraOhlc = {};
      for (const nextSymbol of nextSymbols) {
        if ((ohlcData?.[nextSymbol] || []).length) continue;
        setImportingSymbol(nextSymbol);
        const payload = await fetchYahooHistory(nextSymbol, "10y");
        nextAssetMap[nextSymbol] = assetFromQuote(
          {
            symbol: nextSymbol,
            longname: payload?.meta?.name,
            shortname: payload?.meta?.shortName,
            exchange: payload?.meta?.exchange,
            exchDisp: payload?.meta?.exchange,
            quoteType: payload?.meta?.quoteType,
            typeDisp: payload?.meta?.quoteType,
          },
          baseAssetMap,
        );
        nextExtraOhlc[nextSymbol] = payload?.ohlc || [];
      }
      if (Object.keys(nextAssetMap).length) {
        setAssetMap((prev) => ({ ...prev, ...nextAssetMap }));
      }
      if (Object.keys(nextExtraOhlc).length) {
        setExtraOhlc((prev) => ({ ...prev, ...nextExtraOhlc }));
      }
      setUniverseTickers((prev) => (
        replaceUniverse ? nextSymbols : Array.from(new Set([...prev, ...nextSymbols]))
      ));
      setQuery("");
      setSearchResults([]);
      setStatus(
        packLabel
          ? `${packLabel} loaded: ${nextSymbols.join(", ")}`
          : `${nextSymbols.join(", ")} imported from Yahoo history.`,
      );
    } catch (error) {
      setStatus(error?.message || `Failed to import ${nextSymbols.join(", ")}.`);
    } finally {
      setImportingSymbol("");
    }
  };

  const importSymbol = async (symbol) => {
    const nextSymbol = (symbol || "").trim().toUpperCase();
    if (!nextSymbol) return;
    await importSymbols([nextSymbol]);
  };

  const loadStarterPack = async (pack) => {
    if (!pack) return;
    try {
      setImportingPack(pack.id);
      await importSymbols(pack.symbols, { replaceUniverse: true, packLabel: pack.title });
    } finally {
      setImportingPack("");
    }
  };

  const runStarterPack = async (pack) => {
    if (!pack) return;
    try {
      setImportingPack(`${pack.id}-run`);
      await importSymbols(pack.symbols, { replaceUniverse: true, packLabel: `${pack.title} ready for backtest` });
      setAutoRunRequest({
        id: `${pack.id}-${Date.now()}`,
        tickers: pack.symbols,
        weightsPct: pack.backtest?.weightsPct,
        rebalance: pack.backtest?.rebalance || "monthly",
        initialCapital: pack.backtest?.initialCapital || 100000,
      });
      setStatus(`${pack.title} loaded and default backtest started.`);
    } finally {
      setImportingPack("");
    }
  };

  useEffect(() => {
    if (!autoRunPackId) return;
    const packId = String(autoRunPackId).split("-").slice(0, -1).join("-") || String(autoRunPackId);
    const pack = STARTER_PACKS.find((item) => item.id === packId);
    if (!pack) return;
    runStarterPack(pack);
  }, [autoRunPackId]);

  const removeTicker = (ticker) => {
    if (universeTickers.length <= 2) return;
    setUniverseTickers((prev) => prev.filter((item) => item !== ticker));
    setSelectedPair(null);
  };

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1.25fr .75fr",gap:"14px",alignItems:"stretch",marginBottom:"16px"}}>
        <div className="terminal-card" style={{padding:"18px 20px"}}>
          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#1e3a55",letterSpacing:".12em",marginBottom:"6px"}}>FULL UNIVERSE MODE</div>
          <div style={{fontWeight:800,fontSize:"18px",color:"#f0f6ff",marginBottom:"8px"}}>Yahoo Search + Dynamic Correlation + Portfolio Backtest</div>
          <div style={{fontSize:"12px",color:"#7a9ab5",lineHeight:1.6,marginBottom:"12px"}}>
            Search or load a starter pack, then use the same universe for correlation analysis and portfolio backtesting.
          </div>
          <div style={{display:"flex",gap:"10px",flexWrap:"wrap",alignItems:"center",marginBottom:"14px"}}>
            <input
              value={query}
              placeholder="Search Apple / Tesla / 0700.HK / TSM / BTC-USD"
              style={{flex:1,minWidth:"260px",background:"#030810",border:"1px solid #12263b",borderRadius:"8px",padding:"11px 12px",color:"#d1d9e6",fontFamily:"Syne Mono",fontSize:"11px"}}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  importSymbol(query);
                }
              }}
            />
            <button
              className="nav-tab on"
              onClick={() => importSymbol(query)}
              disabled={!bridgeReady || !query.trim() || !!importingSymbol || !!importingPack}
              style={{background:"#0e2540",borderColor:"#143a61",color:"#8fb8d8"}}
            >
              {importingSymbol ? `IMPORTING ${importingSymbol}...` : "ADD SYMBOL"}
            </button>
          </div>
          <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"10px"}}>
            {QUICK_SYMBOLS.map((symbol) => (
              <button
                key={symbol}
                className="filter-pill"
                onClick={() => setQuery(symbol)}
                title={`Use ${symbol} as a search shortcut`}
              >
                {symbol}
              </button>
            ))}
          </div>
          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"9px",color:"#4a6a85",marginBottom:"8px"}}>
            Quick symbols help first-time users start without typing.
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

        <div className="terminal-card" style={{padding:"18px 20px"}}>
          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#1e3a55",letterSpacing:".12em",marginBottom:"10px"}}>UNIVERSE STATUS</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:"10px"}}>
            {[
              ["Loaded Assets", String(availableTickers.length)],
              ["Common Bars", String(corrData.dates.length || 0)],
              ["Search Mode", bridgeReady ? "ONLINE" : "OFFLINE"],
              ["Benchmark", "SPY"],
            ].map(([label, value]) => (
              <div key={label} className="terminal-card-soft" style={{padding:"12px 14px"}}>
                <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"9px",color:"#1e3a55",letterSpacing:".1em",marginBottom:"6px"}}>{label}</div>
                <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"14px",fontWeight:700,color:"#d1d9e6"}}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="terminal-card" style={{padding:"18px 20px",marginBottom:"16px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"12px",flexWrap:"wrap",marginBottom:"12px"}}>
          <div>
            <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#1e3a55",letterSpacing:".12em",marginBottom:"6px"}}>STARTER PACKS</div>
            <div style={{fontSize:"12px",color:"#7a9ab5",lineHeight:1.7}}>
              Professional example universes for first-time users. You can load the pack only, or load it and immediately run a default portfolio backtest.
            </div>
          </div>
          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#4a6a85"}}>
            Recommended first pack: `Macro Core`
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))",gap:"12px"}}>
          {STARTER_PACKS.map((pack) => {
            const disabled = !!importingSymbol || !!importingPack || (pack.requiresBridge && !bridgeReady);
            const isActive =
              pack.symbols.length === universeTickers.length &&
              pack.symbols.every((symbol) => universeTickers.includes(symbol));
            return (
              <div key={pack.id} className="terminal-card-soft" style={{padding:"14px 16px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:"10px",marginBottom:"6px"}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:"15px",color:"#f0f6ff"}}>{pack.title}</div>
                    <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"9px",color:"#8fb8d8",letterSpacing:".08em",marginTop:"3px"}}>
                      {pack.subtitle}
                    </div>
                  </div>
                  {isActive ? (
                    <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"9px",color:"#22c55e"}}>ACTIVE</div>
                  ) : null}
                </div>
                <div style={{fontSize:"12px",color:"#7a9ab5",lineHeight:1.6,marginBottom:"10px"}}>
                  {pack.description}
                </div>
                <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"12px"}}>
                  {pack.symbols.map((symbol) => (
                    <span
                      key={symbol}
                      style={{
                        fontFamily:"'Syne Mono',monospace",
                        fontSize:"9px",
                        color:assetMap[symbol]?.color || colorFromTicker(symbol),
                        border:`1px solid ${(assetMap[symbol]?.color || colorFromTicker(symbol))}33`,
                        borderRadius:"999px",
                        padding:"3px 7px",
                      }}
                    >
                      {symbol}
                    </span>
                  ))}
                </div>
                <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
                  <button
                    className="nav-tab"
                    onClick={() => loadStarterPack(pack)}
                    disabled={disabled}
                    style={isActive ? {background:"#0e2540",borderColor:"#1b3b2a",color:"#22c55e"} : {}}
                    title={pack.requiresBridge && !bridgeReady ? "Requires local Yahoo bridge" : "Replace current universe with this pack"}
                  >
                    {importingPack === pack.id ? "LOADING..." : "LOAD PACK"}
                  </button>
                  <button
                    className="nav-tab on"
                    onClick={() => runStarterPack(pack)}
                    disabled={disabled}
                    style={{background:"#0e2540",borderColor:"#143a61",color:"#8fb8d8"}}
                    title={pack.requiresBridge && !bridgeReady ? "Requires local Yahoo bridge" : "Load pack and immediately run the default backtest"}
                  >
                    {importingPack === `${pack.id}-run` ? "RUNNING..." : "LOAD + RUN"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {(searchBusy || searchResults.length > 0) && (
        <div className="terminal-card" style={{padding:"16px 18px",marginBottom:"18px"}}>
          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#8fa8c0",marginBottom:"12px"}}>{searchBusy ? "SEARCHING YAHOO..." : "SEARCH RESULTS"}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:"10px"}}>
            {searchResults.map((item) => {
              const symbol = item.symbol;
              const imported = !!ohlcData?.[symbol]?.length;
              return (
                <div key={symbol} className="terminal-card-soft" style={{padding:"12px 14px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:"10px",alignItems:"center",marginBottom:"6px"}}>
                    <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"13px",fontWeight:700,color:colorFromTicker(symbol)}}>{symbol}</div>
                    <button className="filter-pill" onClick={() => importSymbol(symbol)} disabled={!!importingSymbol || !!importingPack}>
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

      <div className="terminal-card" style={{padding:"16px 20px",marginBottom:"16px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"12px",flexWrap:"wrap",marginBottom:"10px"}}>
          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#8fa8c0"}}>ACTIVE UNIVERSE</div>
          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"9px",color:"#4a6a85"}}>
            Click a ticker to remove it from the current research set.
          </div>
        </div>
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

      <div className="terminal-card" style={{padding:"20px 22px",marginBottom:"18px",overflowX:"auto"}}>
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
          <div className="terminal-card-soft" style={{marginTop:"16px",padding:"16px 18px"}}>
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
        helperNote="Search, load a starter pack, or use LOAD + RUN above. SPY remains the default benchmark."
        autoRunRequest={autoRunRequest}
      />
    </div>
  );
}
