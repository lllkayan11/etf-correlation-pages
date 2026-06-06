import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  alignAdjCloseSeries,
  runPortfolioBacktest,
  computeMinCorrWeights,
  computeMinCorrWeightsFromLookup,
  normalizeWeights,
  equityToCsv,
  downloadText,
} from "./backtest-engine.js";

const formatPct = (v) => `${(v * 100).toFixed(2)}%`;
const formatMoney = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
};

const EquityCurveChart = ({ equity }) => {
  const [hoverIdx, setHoverIdx] = useState(null);
  if (!equity?.length) {
    return <div style={{height:"260px",display:"grid",placeItems:"center",color:"#4a6a85",fontFamily:"'Syne Mono',monospace"}}>NO BACKTEST RESULT</div>;
  }
  const W = 1100;
  const H = 270;
  const left = 56;
  const right = 12;
  const top = 12;
  const bottom = 28;
  const innerW = W - left - right;
  const step = innerW / Math.max(1, equity.length);
  const xOf = (i) => left + i * step + step / 2;

  const pVals = equity.map((r) => r.portfolio).filter((v) => Number.isFinite(v));
  const bVals = equity.map((r) => r.benchmark).filter((v) => v != null && Number.isFinite(v));
  const all = bVals.length ? pVals.concat(bVals) : pVals;
  const maxY = Math.max(...all);
  const minY = Math.min(...all);
  const span = Math.max(0.0001, maxY - minY);
  const yOf = (v) => top + ((maxY - v) / span) * (H - top - bottom);

  const pathFor = (key) => equity
    .map((r, i) => {
      const v = r[key];
      if (v == null || !Number.isFinite(v)) return null;
      const cmd = i === 0 ? "M" : "L";
      return `${cmd} ${xOf(i)} ${yOf(v)}`;
    })
    .filter(Boolean)
    .join(" ");

  const labelStep = Math.max(1, Math.floor(equity.length / 6));
  const hovered = hoverIdx != null ? equity[hoverIdx] : null;

  return (
    <div>
      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Equity curve chart"
        onMouseMove={(evt) => {
          const rect = evt.currentTarget.getBoundingClientRect();
          const x = ((evt.clientX - rect.left) / rect.width) * W;
          const raw = Math.round((x - left - step / 2) / step);
          const idx = Math.max(0, Math.min(equity.length - 1, raw));
          setHoverIdx(idx);
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {[0,1,2,3,4].map((i) => {
          const py = top + (i / 4) * (H - top - bottom);
          const v = (maxY - (i / 4) * span).toFixed(0);
          return (
            <g key={`g-${i}`}>
              <line x1={left} y1={py} x2={W - right} y2={py} stroke="#0a1a2e" strokeDasharray="2 5" />
              <text x={left - 6} y={py + 3} textAnchor="end" fill="#1e3a55" fontSize="9" fontFamily="Syne Mono">${v}</text>
            </g>
          );
        })}
        <path d={pathFor("portfolio")} fill="none" stroke="#22c55e" strokeWidth={2} />
        {bVals.length > 0 && <path d={pathFor("benchmark")} fill="none" stroke="#3b82f6" strokeWidth={2} opacity={0.9} />}

        {hovered && (
          <g>
            <line x1={xOf(hoverIdx)} x2={xOf(hoverIdx)} y1={top} y2={H - bottom} stroke="#38bdf8" strokeDasharray="4 4" />
            <circle cx={xOf(hoverIdx)} cy={yOf(hovered.portfolio)} r={3} fill="#22c55e" />
            {hovered.benchmark != null && <circle cx={xOf(hoverIdx)} cy={yOf(hovered.benchmark)} r={3} fill="#3b82f6" />}
          </g>
        )}

        {equity.map((r, i) => {
          if (i % labelStep !== 0 && i !== equity.length - 1) return null;
          return <text key={`x-${r.date}`} x={xOf(i)} y={H - 8} textAnchor="middle" fill="#1e3a55" fontSize="9" fontFamily="Syne Mono">{r.date.slice(2)}</text>;
        })}
      </svg>
      {hovered && (
        <div style={{display:"flex",justifyContent:"space-between",gap:"10px",marginTop:"8px",fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#8fa8c0"}}>
          <div>{hovered.date}</div>
          <div>PORT {formatMoney(hovered.portfolio)}{hovered.benchmark != null ? ` · SPY ${formatMoney(hovered.benchmark)}` : ""}</div>
        </div>
      )}
    </div>
  );
};

const deriveDefaultTickers = (assets, preferred) => {
  const all = (assets || []).map((item) => item.ticker);
  const preferredValid = (preferred || []).filter((ticker) => all.includes(ticker));
  if (preferredValid.length) return preferredValid;
  if (all.includes("SPY") && all.includes("TLT")) return ["SPY", "TLT"];
  return all.slice(0, Math.min(3, all.length));
};

export default function BacktestPanel({
  etfs,
  corrMatrix,
  corrLookup,
  ohlcData,
  benchmarkTicker = "SPY",
  defaultTickers,
  title = "Portfolio Backtest (Rebalance + Benchmark)",
  description = "",
  helperNote = "",
  autoRunRequest = null,
}) {
  const handledAutoRunIdRef = useRef(null);
  const [tickers, setTickers] = useState(() => deriveDefaultTickers(etfs, defaultTickers));
  const [weightsPct, setWeightsPct] = useState(() => {
    const initial = deriveDefaultTickers(etfs, defaultTickers);
    if (initial.length === 2 && initial.includes("SPY") && initial.includes("TLT")) {
      return { SPY: 60, TLT: 40 };
    }
    const eq = initial.length ? 100 / initial.length : 0;
    return Object.fromEntries(initial.map((ticker) => [ticker, eq]));
  });
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [initialCapital, setInitialCapital] = useState(100000);
  const [rebalance, setRebalance] = useState("monthly");
  const [feeBps, setFeeBps] = useState(0);
  const [slippageBps, setSlippageBps] = useState(0);
  const [riskFree, setRiskFree] = useState(0);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const available = new Set((etfs || []).map((item) => item.ticker));
    const nextDefault = deriveDefaultTickers(etfs, defaultTickers);
    setTickers((prev) => {
      const filtered = prev.filter((ticker) => available.has(ticker));
      if (filtered.length) return filtered;
      return nextDefault;
    });
  }, [defaultTickers, etfs]);

  const dateBounds = useMemo(() => {
    const tickersForAlign = Array.from(new Set([...tickers, benchmarkTicker].filter(Boolean)));
    if (!tickers.length || !tickersForAlign.every((t) => (ohlcData?.[t] || []).length)) {
      return { start: "", end: "", count: 0 };
    }
    const aligned = alignAdjCloseSeries(ohlcData, tickersForAlign);
    if (!aligned.dates.length) return { start: "", end: "", count: 0 };
    return {
      start: aligned.dates[0],
      end: aligned.dates[aligned.dates.length - 1],
      count: aligned.dates.length,
    };
  }, [ohlcData, tickers]);

  useEffect(() => {
    if (!dateBounds.start || !dateBounds.end) return;
    const nextStart = !startDate || startDate < dateBounds.start || startDate > dateBounds.end ? dateBounds.start : startDate;
    const nextEnd = !endDate || endDate > dateBounds.end || endDate < dateBounds.start ? dateBounds.end : endDate;
    if (nextStart !== startDate) setStartDate(nextStart);
    if (nextEnd !== endDate) setEndDate(nextEnd);
  }, [startDate, endDate, dateBounds.start, dateBounds.end]);

  useEffect(() => {
    const next = {};
    for (const t of tickers) next[t] = Number(weightsPct?.[t] ?? 0);
    const sum = Object.values(next).reduce((a, b) => a + (Number(b) || 0), 0);
    if (sum <= 0 && tickers.length) {
      const eq = 100 / tickers.length;
      for (const t of tickers) next[t] = eq;
    }
    setWeightsPct(next);
  }, [tickers]);

  const weightsDec = useMemo(() => {
    const o = {};
    for (const t of tickers) o[t] = (Number(weightsPct?.[t]) || 0) / 100;
    return normalizeWeights(o);
  }, [tickers, weightsPct]);

  const toggleTicker = (t) => {
    setResult(null);
    setStatus("");
    setTickers((prev) => {
      const has = prev.includes(t);
      if (has) return prev.length <= 1 ? prev : prev.filter((x) => x !== t);
      return [...prev, t];
    });
  };

  const applyPreset = (preset) => {
    setResult(null);
    setStatus("");
    if (preset === "60_40") {
      setTickers(["SPY", "TLT"]);
      setWeightsPct({ SPY: 60, TLT: 40 });
      return;
    }
    if (preset === "equal") {
      const eq = tickers.length ? 100 / tickers.length : 0;
      const w = {};
      for (const t of tickers) w[t] = eq;
      setWeightsPct(w);
      return;
    }
    if (preset === "mincorr") {
      const wDec = corrLookup
        ? computeMinCorrWeightsFromLookup(tickers, corrLookup)
        : computeMinCorrWeights(tickers, corrMatrix, etfs);
      const wPct = {};
      for (const t of tickers) wPct[t] = (wDec[t] || 0) * 100;
      setWeightsPct(wPct);
    }
  };

  const executeBacktest = ({
    nextTickers = tickers,
    nextWeightsPct = weightsPct,
    nextStartDate = startDate,
    nextEndDate = endDate,
    nextInitialCapital = initialCapital,
    nextRebalance = rebalance,
    nextFeeBps = feeBps,
    nextSlippageBps = slippageBps,
    nextRiskFree = riskFree,
  } = {}) => {
    setStatus("");
    setResult(null);
    const tickersForAlign = Array.from(new Set([...nextTickers, benchmarkTicker].filter(Boolean)));
    if (!nextTickers.length) {
      setStatus("Please select at least 1 asset.");
      return false;
    }
    if (!tickersForAlign.every((t) => (ohlcData?.[t] || []).length)) {
      setStatus("OHLC data is not loaded yet. Please wait a moment or click RELOAD DATA.");
      return false;
    }
    if (!nextStartDate || !nextEndDate || nextStartDate > nextEndDate) {
      setStatus("Please select a valid date range.");
      return false;
    }
    let aligned = alignAdjCloseSeries(ohlcData, tickersForAlign, nextStartDate, nextEndDate);
    if (!aligned.dates.length) {
      const fallback = alignAdjCloseSeries(ohlcData, tickersForAlign);
      if (fallback.dates.length) {
        const fallbackStart = fallback.dates[0];
        const fallbackEnd = fallback.dates[fallback.dates.length - 1];
        setStartDate(fallbackStart);
        setEndDate(fallbackEnd);
        aligned = fallback;
      } else {
        setStatus("No overlapping trading dates for selected ETFs and benchmark. Please click RELOAD DATA.");
        return false;
      }
    }
    if (!aligned.dates.length) {
      setStatus("No overlapping trading dates for selected ETFs in this range.");
      return false;
    }
    const w = {};
    for (const t of nextTickers) w[t] = (Number(nextWeightsPct?.[t]) || 0) / 100;
    const res = runPortfolioBacktest({
      tickers: nextTickers,
      aligned,
      initialCapital: nextInitialCapital,
      weightsByTicker: w,
      rebalanceFreq: nextRebalance,
      benchmarkTicker,
      feeBps: nextFeeBps,
      slippageBps: nextSlippageBps,
      riskFreeRateAnnual: (Number(nextRiskFree) || 0) / 100,
    });
    if (!res?.metrics) {
      setStatus("Backtest failed.");
      return false;
    }
    setResult(res);
    return true;
  };

  const run = () => executeBacktest();

  useEffect(() => {
    if (!autoRunRequest?.id || handledAutoRunIdRef.current === autoRunRequest.id) return;
    const nextTickers = (autoRunRequest.tickers || []).filter(Boolean);
    if (!nextTickers.length) return;
    if (!nextTickers.every((ticker) => (ohlcData?.[ticker] || []).length)) return;

    const weightsPctOverride = autoRunRequest.weightsPct || Object.fromEntries(
      nextTickers.map((ticker) => [ticker, 100 / nextTickers.length]),
    );
    const tickersForAlign = Array.from(new Set([...nextTickers, benchmarkTicker].filter(Boolean)));
    const aligned = alignAdjCloseSeries(ohlcData, tickersForAlign);
    if (!aligned.dates.length) return;

    const nextStart = autoRunRequest.startDate || aligned.dates[0];
    const nextEnd = autoRunRequest.endDate || aligned.dates[aligned.dates.length - 1];

    setTickers(nextTickers);
    setWeightsPct(weightsPctOverride);
    setInitialCapital(Number(autoRunRequest.initialCapital) || 100000);
    setRebalance(autoRunRequest.rebalance || "monthly");
    setFeeBps(Number(autoRunRequest.feeBps) || 0);
    setSlippageBps(Number(autoRunRequest.slippageBps) || 0);
    setRiskFree(Number(autoRunRequest.riskFree) || 0);
    setStartDate(nextStart);
    setEndDate(nextEnd);
    handledAutoRunIdRef.current = autoRunRequest.id;
    executeBacktest({
      nextTickers,
      nextWeightsPct: weightsPctOverride,
      nextStartDate: nextStart,
      nextEndDate: nextEnd,
      nextInitialCapital: Number(autoRunRequest.initialCapital) || 100000,
      nextRebalance: autoRunRequest.rebalance || "monthly",
      nextFeeBps: Number(autoRunRequest.feeBps) || 0,
      nextSlippageBps: Number(autoRunRequest.slippageBps) || 0,
      nextRiskFree: Number(autoRunRequest.riskFree) || 0,
    });
  }, [autoRunRequest, benchmarkTicker, ohlcData]);

  return (
    <div>
      <div style={{display:"flex",gap:"16px",flexWrap:"wrap",alignItems:"stretch"}}>
        <div style={{flex:1,minWidth:"320px",background:"#060e1c",border:"1px solid #0a1e32",borderRadius:"12px",padding:"20px 22px"}}>
          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#1e3a55",letterSpacing:".12em",marginBottom:"6px"}}>BACKTEST SYSTEM</div>
          <div style={{fontWeight:800,fontSize:"18px",color:"#f0f6ff",marginBottom:description ? "8px" : "14px"}}>{title}</div>
          {description ? (
            <div style={{fontSize:"12px",color:"#7a9ab5",lineHeight:1.7,marginBottom:"14px"}}>{description}</div>
          ) : null}

          <div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"14px"}}>
            <button
              className="filter-pill on"
              style={{"--c":"#22c55e"}}
              onClick={() => applyPreset("60_40")}
              disabled={!etfs.find((e) => e.ticker === "SPY") || !etfs.find((e) => e.ticker === "TLT")}
            >
              60/40
            </button>
            <button className="filter-pill" style={{"--c":"#8fb8d8"}} onClick={() => applyPreset("equal")}>EQUAL</button>
            <button className="filter-pill" style={{"--c":"#f59e0b"}} onClick={() => applyPreset("mincorr")}>MIN-CORR</button>
          </div>

          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#8fa8c0",marginBottom:"10px"}}>SELECT ASSETS (PORTFOLIO):</div>
          <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"16px"}}>
            {etfs.map((e) => {
              const on = tickers.includes(e.ticker);
              return (
                <button
                  key={e.ticker}
                  className={`filter-pill ${on ? "on" : ""}`}
                  style={{"--c": e.color}}
                  onClick={() => toggleTicker(e.ticker)}
                >
                  {e.ticker}
                </button>
              );
            })}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 90px",gap:"10px",marginBottom:"14px"}}>
            {tickers.map((t) => {
              const meta = etfs.find((e) => e.ticker === t);
              return (
                <React.Fragment key={t}>
                  <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                    <div style={{fontFamily:"'Syne Mono',monospace",fontWeight:700,color:meta?.color || "#8fb8d8"}}>{t}</div>
                    <div style={{fontSize:"11px",color:"#3a5a75",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{meta?.sector || meta?.region || ""}</div>
                  </div>
                  <input
                    value={weightsPct?.[t] ?? 0}
                    type="number"
                    step="0.1"
                    min="0"
                    style={{width:"100%",background:"#030810",border:"1px solid #0a1a2e",borderRadius:"6px",padding:"8px 10px",color:"#d1d9e6",fontFamily:"Syne Mono",fontSize:"11px"}}
                    onChange={(ev) => setWeightsPct((prev) => ({ ...prev, [t]: Number(ev.target.value) }))}
                  />
                </React.Fragment>
              );
            })}
          </div>

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"16px",fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#3a5a75"}}>
            <div>WEIGHT SUM: {Object.values(weightsPct).reduce((a,b)=>a+(Number(b)||0),0).toFixed(2)}%</div>
            <button
              className="filter-pill"
              onClick={() => {
                const w = normalizeWeights(Object.fromEntries(tickers.map((t) => [t, (Number(weightsPct?.[t]) || 0) / 100])));
                const pct = {};
                for (const t of tickers) pct[t] = (w[t] || 0) * 100;
                setWeightsPct(pct);
              }}
            >
              NORMALIZE
            </button>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"10px"}}>
            <div>
              <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"9px",color:"#1e3a55",letterSpacing:".1em",marginBottom:"6px"}}>START</div>
              <input
                value={startDate}
                type="date"
                min={dateBounds.start || undefined}
                max={dateBounds.end || undefined}
                style={{width:"100%",background:"#030810",border:"1px solid #0a1a2e",borderRadius:"6px",padding:"8px 10px",color:"#d1d9e6",fontFamily:"Syne Mono",fontSize:"11px"}}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"9px",color:"#1e3a55",letterSpacing:".1em",marginBottom:"6px"}}>END</div>
              <input
                value={endDate}
                type="date"
                min={dateBounds.start || undefined}
                max={dateBounds.end || undefined}
                style={{width:"100%",background:"#030810",border:"1px solid #0a1a2e",borderRadius:"6px",padding:"8px 10px",color:"#d1d9e6",fontFamily:"Syne Mono",fontSize:"11px"}}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"10px"}}>
            <div>
              <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"9px",color:"#1e3a55",letterSpacing:".1em",marginBottom:"6px"}}>INITIAL CAPITAL</div>
              <input
                value={initialCapital}
                type="number"
                step="100"
                min="0"
                style={{width:"100%",background:"#030810",border:"1px solid #0a1a2e",borderRadius:"6px",padding:"8px 10px",color:"#d1d9e6",fontFamily:"Syne Mono",fontSize:"11px"}}
                onChange={(e) => setInitialCapital(Number(e.target.value))}
              />
            </div>
            <div>
              <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"9px",color:"#1e3a55",letterSpacing:".1em",marginBottom:"6px"}}>REBALANCE</div>
              <select
                value={rebalance}
                style={{width:"100%",background:"#030810",border:"1px solid #0a1a2e",borderRadius:"6px",padding:"8px 10px",color:"#d1d9e6",fontFamily:"Syne Mono",fontSize:"11px"}}
                onChange={(e) => setRebalance(e.target.value)}
              >
                <option value="none">none</option>
                <option value="monthly">monthly</option>
                <option value="quarterly">quarterly</option>
                <option value="yearly">yearly</option>
              </select>
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"10px",marginBottom:"14px"}}>
            <div>
              <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"9px",color:"#1e3a55",letterSpacing:".1em",marginBottom:"6px"}}>FEE (BPS)</div>
              <input
                value={feeBps}
                type="number"
                step="0.1"
                min="0"
                style={{width:"100%",background:"#030810",border:"1px solid #0a1a2e",borderRadius:"6px",padding:"8px 10px",color:"#d1d9e6",fontFamily:"Syne Mono",fontSize:"11px"}}
                onChange={(e) => setFeeBps(Number(e.target.value))}
              />
            </div>
            <div>
              <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"9px",color:"#1e3a55",letterSpacing:".1em",marginBottom:"6px"}}>SLIPPAGE (BPS)</div>
              <input
                value={slippageBps}
                type="number"
                step="0.1"
                min="0"
                style={{width:"100%",background:"#030810",border:"1px solid #0a1a2e",borderRadius:"6px",padding:"8px 10px",color:"#d1d9e6",fontFamily:"Syne Mono",fontSize:"11px"}}
                onChange={(e) => setSlippageBps(Number(e.target.value))}
              />
            </div>
            <div>
              <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"9px",color:"#1e3a55",letterSpacing:".1em",marginBottom:"6px"}}>RF (ANNUAL %)</div>
              <input
                value={riskFree}
                type="number"
                step="0.1"
                style={{width:"100%",background:"#030810",border:"1px solid #0a1a2e",borderRadius:"6px",padding:"8px 10px",color:"#d1d9e6",fontFamily:"Syne Mono",fontSize:"11px"}}
                onChange={(e) => setRiskFree(Number(e.target.value))}
              />
            </div>
          </div>

          <div style={{display:"flex",gap:"10px",alignItems:"center",flexWrap:"wrap"}}>
            <button className="nav-tab on" onClick={run} style={{background:"#0e2540",borderColor:"#143a61",color:"#8fb8d8"}}>RUN BACKTEST</button>
            <button
              className="nav-tab"
              onClick={() => {
                if (!result?.equity?.length) return;
                downloadText(`equity_curve_${startDate}_${endDate}.csv`, equityToCsv(result.equity));
              }}
              style={{borderColor:"#0a1a2e"}}
              disabled={!result?.equity?.length}
            >
              EXPORT CSV
            </button>
            <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#3a5a75"}}>Benchmark: {benchmarkTicker || "NONE"}</div>
            <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#3a5a75"}}>Common bars: {dateBounds.count || 0}</div>
          </div>
          {helperNote ? (
            <div style={{marginTop:"10px",fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#4a6a85"}}>
              {helperNote}
            </div>
          ) : null}

          {status && (
            <div style={{marginTop:"12px",fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#f97316"}}>
              {status}
            </div>
          )}
        </div>

        <div style={{flex:1.3,minWidth:"360px"}}>
          <div style={{background:"#060e1c",border:"1px solid #0a1e32",borderRadius:"12px",padding:"20px 22px",marginBottom:"16px"}}>
            <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#1e3a55",letterSpacing:".12em",marginBottom:"10px"}}>CORE METRICS</div>
            {result?.metrics ? (
              <div style={{display:"grid",gridTemplateColumns:"repeat(3, 1fr)",gap:"10px"}}>
                {[
                  ["Total Return", formatPct(result.metrics.totalReturn)],
                  ["CAGR", formatPct(result.metrics.cagr)],
                  ["Max Drawdown", formatPct(result.metrics.maxDrawdown)],
                  ["Sharpe", result.metrics.sharpe.toFixed(2)],
                  ["Sortino", result.metrics.sortino.toFixed(2)],
                  [`${benchmarkTicker || "Benchmark"} Return`, result.metrics.benchmarkTotalReturn == null ? "N/A" : formatPct(result.metrics.benchmarkTotalReturn)],
                ].map(([k, v]) => (
                  <div key={k} style={{background:"#030810",border:"1px solid #0a1a2e",borderRadius:"8px",padding:"12px 14px"}}>
                    <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"9px",color:"#1e3a55",letterSpacing:".1em",marginBottom:"6px"}}>{k}</div>
                    <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"14px",fontWeight:700,color:"#d1d9e6"}}>{v}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#4a6a85"}}>Run a backtest to generate metrics.</div>
            )}
          </div>

          <div style={{background:"#060e1c",border:"1px solid #0a1e32",borderRadius:"12px",padding:"20px 22px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"12px",marginBottom:"10px",flexWrap:"wrap"}}>
              <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#1e3a55",letterSpacing:".12em"}}>{`EQUITY CURVE (PORTFOLIO VS ${benchmarkTicker || "BENCHMARK"})`}</div>
              <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#3a5a75"}}>
                {result?.metrics ? `${result.metrics.startDate} → ${result.metrics.endDate} · ${result.metrics.nDays} bars` : ""}
              </div>
            </div>
            <EquityCurveChart equity={result?.equity || []} />
            <div style={{marginTop:"10px",fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#3a5a75"}}>
              Weights: {tickers.map((t) => `${t} ${(weightsDec[t] * 100).toFixed(1)}%`).join(" · ")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
