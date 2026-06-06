// etf-correlation-dashboard.jsx
import React3, { useEffect as useEffect3, useState as useState3, useMemo as useMemo3 } from "react";

// backtest-panel.jsx
import React, { useEffect, useMemo, useState } from "react";

// backtest-engine.js
var clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
var normalizeWeights = (weightsByTicker) => {
  const entries = Object.entries(weightsByTicker).map(([k, v]) => [k, Number(v) || 0]);
  const sum = entries.reduce((a, [, v]) => a + v, 0);
  if (sum <= 0)
    return Object.fromEntries(entries.map(([k]) => [k, 0]));
  return Object.fromEntries(entries.map(([k, v]) => [k, v / sum]));
};
var computeMinCorrWeights = (tickers, corrMatrix, etfs) => {
  const ids = tickers.map((t) => etfs.find((e) => e.ticker === t)?.id).filter((v) => v != null);
  if (ids.length !== tickers.length)
    return Object.fromEntries(tickers.map((t) => [t, 1 / tickers.length]));
  const raw = {};
  for (let i = 0; i < tickers.length; i++) {
    const idI = ids[i];
    let s = 0;
    let c = 0;
    for (let j = 0; j < tickers.length; j++) {
      if (i === j)
        continue;
      const idJ = ids[j];
      const v = corrMatrix?.[idI]?.[idJ];
      if (typeof v === "number" && Number.isFinite(v)) {
        s += v;
        c += 1;
      }
    }
    const avg = c ? s / c : 0;
    raw[tickers[i]] = clamp(1 - avg, 1e-3, 10);
  }
  return normalizeWeights(raw);
};
var computeMinCorrWeightsFromLookup = (tickers, corrLookup) => {
  if (!tickers.length)
    return {};
  const raw = {};
  for (let i = 0; i < tickers.length; i++) {
    const tI = tickers[i];
    let s = 0;
    let c = 0;
    for (let j = 0; j < tickers.length; j++) {
      if (i === j)
        continue;
      const tJ = tickers[j];
      const v = corrLookup?.[tI]?.[tJ];
      if (typeof v === "number" && Number.isFinite(v)) {
        s += v;
        c += 1;
      }
    }
    const avg = c ? s / c : 0;
    raw[tI] = clamp(1 - avg, 1e-3, 10);
  }
  return normalizeWeights(raw);
};
var alignAdjCloseSeries = (ohlcByTicker, tickers, startDate, endDate) => {
  const mapByTicker = {};
  for (const t of tickers) {
    const rows = ohlcByTicker?.[t] || [];
    const m = new Map();
    for (const r of rows) {
      if (!r?.date)
        continue;
      const p = Number(r.adjClose ?? r.close);
      if (!Number.isFinite(p) || p <= 0)
        continue;
      if (startDate && r.date < startDate)
        continue;
      if (endDate && r.date > endDate)
        continue;
      m.set(r.date, p);
    }
    mapByTicker[t] = m;
  }
  const dates = Array.from(mapByTicker[tickers[0]]?.keys() || []).sort();
  const commonDates = dates.filter((d) => tickers.every((t) => mapByTicker[t].has(d)));
  const prices = {};
  for (const t of tickers) {
    const m = mapByTicker[t];
    prices[t] = commonDates.map((d) => m.get(d));
  }
  return { dates: commonDates, prices };
};
var mean = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
var pearsonCorr = (a, b) => {
  const n = Math.min(a.length, b.length);
  if (n < 2)
    return null;
  const ma = mean(a);
  const mb = mean(b);
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va <= 0 || vb <= 0)
    return null;
  return cov / Math.sqrt(va * vb);
};
var computeCorrelationLookupFromOhlc = (ohlcByTicker, tickers, startDate, endDate) => {
  const names = Array.from(new Set((tickers || []).filter(Boolean)));
  if (!names.length) {
    return { tickers: [], dates: [], matrix: [], lookup: {}, aligned: { dates: [], prices: {} } };
  }
  const aligned = alignAdjCloseSeries(ohlcByTicker, names, startDate, endDate);
  const returnsByTicker = {};
  for (const t of names) {
    const prices = aligned.prices?.[t] || [];
    const vals = [];
    for (let i = 1; i < prices.length; i++) {
      const prev = Number(prices[i - 1]);
      const curr = Number(prices[i]);
      if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev <= 0 || curr <= 0)
        continue;
      vals.push(curr / prev - 1);
    }
    returnsByTicker[t] = vals;
  }
  const lookup = {};
  const matrix = names.map((rowTicker, rowIdx) => {
    lookup[rowTicker] = lookup[rowTicker] || {};
    return names.map((colTicker, colIdx) => {
      if (rowIdx === colIdx) {
        lookup[rowTicker][colTicker] = 1;
        return 1;
      }
      const v = pearsonCorr(returnsByTicker[rowTicker] || [], returnsByTicker[colTicker] || []);
      const next = v == null ? 0 : v;
      lookup[rowTicker][colTicker] = next;
      return next;
    });
  });
  return { tickers: names, dates: aligned.dates.slice(1), matrix, lookup, aligned };
};
var rebalanceKey = (dateStr, freq) => {
  const y = dateStr.slice(0, 4);
  const m = dateStr.slice(5, 7);
  if (freq === "monthly")
    return `${y}-${m}`;
  if (freq === "quarterly") {
    const q = Math.floor((Number(m) - 1) / 3) + 1;
    return `${y}-Q${q}`;
  }
  if (freq === "yearly")
    return `${y}`;
  return null;
};
var runPortfolioBacktest = ({
  tickers,
  aligned,
  initialCapital,
  weightsByTicker,
  rebalanceFreq,
  benchmarkTicker,
  feeBps,
  slippageBps,
  riskFreeRateAnnual
}) => {
  const dates = aligned.dates;
  if (!dates.length) {
    return { equity: [], returns: [], benchmarkReturns: [], metrics: null, drawdown: [] };
  }
  const w = normalizeWeights(weightsByTicker);
  const fee = (Number(feeBps) || 0) / 1e4;
  const slip = (Number(slippageBps) || 0) / 1e4;
  let cash = Number(initialCapital) || 1e5;
  const shares = {};
  const startPrices = {};
  for (const t of tickers)
    startPrices[t] = aligned.prices[t][0];
  for (const t of tickers) {
    const alloc = cash * (w[t] || 0);
    const px = startPrices[t];
    const executed = alloc * (1 - fee) * (1 - slip);
    shares[t] = px > 0 ? executed / px : 0;
  }
  cash = 0;
  let benchShares = null;
  if (benchmarkTicker && aligned.prices?.[benchmarkTicker]?.length) {
    const benchPx = aligned.prices[benchmarkTicker][0];
    benchShares = benchPx > 0 ? (Number(initialCapital) || 1e5) / benchPx : 0;
  }
  const equity = [];
  const drawdown = [];
  const returns = [];
  const benchmarkReturns = [];
  let peak = -Infinity;
  let lastPort = null;
  let lastBench = null;
  let lastKey = rebalanceFreq === "none" ? null : rebalanceKey(dates[0], rebalanceFreq);
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const pxByT = {};
    for (const t of tickers)
      pxByT[t] = aligned.prices[t][i];
    let port = cash;
    for (const t of tickers)
      port += (shares[t] || 0) * pxByT[t];
    const key = rebalanceFreq === "none" ? null : rebalanceKey(date, rebalanceFreq);
    const doRebalance = key && key !== lastKey;
    if (doRebalance) {
      const nextShares = {};
      for (const t of tickers) {
        const targetVal = port * (w[t] || 0);
        const px = pxByT[t];
        const executed = targetVal * (1 - fee) * (1 - slip);
        nextShares[t] = px > 0 ? executed / px : 0;
      }
      for (const t of tickers)
        shares[t] = nextShares[t];
      cash = 0;
      port = 0;
      for (const t of tickers)
        port += (shares[t] || 0) * pxByT[t];
      lastKey = key;
    }
    let bench = null;
    if (benchShares != null && benchmarkTicker && aligned.prices?.[benchmarkTicker]?.[i] != null) {
      bench = benchShares * aligned.prices[benchmarkTicker][i];
    }
    if (lastPort != null)
      returns.push(port / lastPort - 1);
    if (bench != null && lastBench != null)
      benchmarkReturns.push(bench / lastBench - 1);
    lastPort = port;
    if (bench != null)
      lastBench = bench;
    peak = Math.max(peak, port);
    const dd = peak > 0 ? port / peak - 1 : 0;
    equity.push({ date, portfolio: port, benchmark: bench });
    drawdown.push({ date, drawdown: dd });
  }
  const metrics = computeMetrics({
    equity,
    returns,
    benchmarkReturns,
    riskFreeRateAnnual
  });
  return { equity, returns, benchmarkReturns, metrics, drawdown };
};
var computeMetrics = ({ equity, returns, benchmarkReturns, riskFreeRateAnnual }) => {
  if (!equity?.length)
    return null;
  const start = equity[0]?.portfolio ?? 0;
  const end = equity[equity.length - 1]?.portfolio ?? 0;
  const totalReturn = start > 0 ? end / start - 1 : 0;
  const days = Math.max(1, returns.length);
  const years = days / 252;
  const cagr = start > 0 ? Math.pow(end / start, 1 / years) - 1 : 0;
  let peak = -Infinity;
  let mdd = 0;
  for (const p of equity) {
    peak = Math.max(peak, p.portfolio);
    const dd = peak > 0 ? p.portfolio / peak - 1 : 0;
    mdd = Math.min(mdd, dd);
  }
  const rf = (Number(riskFreeRateAnnual) || 0) / 252;
  const ex = returns.map((r) => r - rf);
  const mean2 = ex.reduce((a, b) => a + b, 0) / Math.max(1, ex.length);
  const variance = ex.reduce((a, r) => a + (r - mean2) * (r - mean2), 0) / Math.max(1, ex.length - 1);
  const vol = Math.sqrt(Math.max(0, variance));
  const sharpe = vol > 0 ? mean2 / vol * Math.sqrt(252) : 0;
  const downside = ex.filter((r) => r < 0);
  const dMean = downside.reduce((a, b) => a + b, 0) / Math.max(1, downside.length);
  const dVar = downside.reduce((a, r) => a + (r - dMean) * (r - dMean), 0) / Math.max(1, downside.length - 1);
  const dVol = Math.sqrt(Math.max(0, dVar));
  const sortino = dVol > 0 ? mean2 / dVol * Math.sqrt(252) : 0;
  const benchTotal = equity[0]?.benchmark != null && equity[equity.length - 1]?.benchmark != null ? equity[equity.length - 1].benchmark / equity[0].benchmark - 1 : null;
  return {
    totalReturn,
    cagr,
    maxDrawdown: mdd,
    sharpe,
    sortino,
    startValue: start,
    endValue: end,
    benchmarkTotalReturn: benchTotal,
    startDate: equity[0].date,
    endDate: equity[equity.length - 1].date,
    nDays: equity.length
  };
};
var equityToCsv = (equity) => {
  const header = ["date", "portfolio", "benchmark"].join(",");
  const rows = equity.map((r) => [r.date, r.portfolio, r.benchmark == null ? "" : r.benchmark].join(","));
  return [header, ...rows].join("\n");
};
var downloadText = (filename, text) => {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// backtest-panel.jsx
var formatPct = (v) => `${(v * 100).toFixed(2)}%`;
var formatMoney = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n))
    return "-";
  const abs = Math.abs(n);
  if (abs >= 1e9)
    return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)
    return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3)
    return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
};
var EquityCurveChart = ({ equity }) => {
  const [hoverIdx, setHoverIdx] = useState(null);
  if (!equity?.length) {
    return /* @__PURE__ */ React.createElement("div", {
      style: { height: "260px", display: "grid", placeItems: "center", color: "#4a6a85", fontFamily: "'Syne Mono',monospace" }
    }, "NO BACKTEST RESULT");
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
  const span = Math.max(1e-4, maxY - minY);
  const yOf = (v) => top + (maxY - v) / span * (H - top - bottom);
  const pathFor = (key) => equity.map((r, i) => {
    const v = r[key];
    if (v == null || !Number.isFinite(v))
      return null;
    const cmd = i === 0 ? "M" : "L";
    return `${cmd} ${xOf(i)} ${yOf(v)}`;
  }).filter(Boolean).join(" ");
  const labelStep = Math.max(1, Math.floor(equity.length / 6));
  const hovered = hoverIdx != null ? equity[hoverIdx] : null;
  return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("svg", {
    width: "100%",
    height: H,
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": "Equity curve chart",
    onMouseMove: (evt) => {
      const rect = evt.currentTarget.getBoundingClientRect();
      const x = (evt.clientX - rect.left) / rect.width * W;
      const raw = Math.round((x - left - step / 2) / step);
      const idx = Math.max(0, Math.min(equity.length - 1, raw));
      setHoverIdx(idx);
    },
    onMouseLeave: () => setHoverIdx(null)
  }, [0, 1, 2, 3, 4].map((i) => {
    const py = top + i / 4 * (H - top - bottom);
    const v = (maxY - i / 4 * span).toFixed(0);
    return /* @__PURE__ */ React.createElement("g", {
      key: `g-${i}`
    }, /* @__PURE__ */ React.createElement("line", {
      x1: left,
      y1: py,
      x2: W - right,
      y2: py,
      stroke: "#0a1a2e",
      strokeDasharray: "2 5"
    }), /* @__PURE__ */ React.createElement("text", {
      x: left - 6,
      y: py + 3,
      textAnchor: "end",
      fill: "#1e3a55",
      fontSize: "9",
      fontFamily: "Syne Mono"
    }, "$", v));
  }), /* @__PURE__ */ React.createElement("path", {
    d: pathFor("portfolio"),
    fill: "none",
    stroke: "#22c55e",
    strokeWidth: 2
  }), bVals.length > 0 && /* @__PURE__ */ React.createElement("path", {
    d: pathFor("benchmark"),
    fill: "none",
    stroke: "#3b82f6",
    strokeWidth: 2,
    opacity: 0.9
  }), hovered && /* @__PURE__ */ React.createElement("g", null, /* @__PURE__ */ React.createElement("line", {
    x1: xOf(hoverIdx),
    x2: xOf(hoverIdx),
    y1: top,
    y2: H - bottom,
    stroke: "#38bdf8",
    strokeDasharray: "4 4"
  }), /* @__PURE__ */ React.createElement("circle", {
    cx: xOf(hoverIdx),
    cy: yOf(hovered.portfolio),
    r: 3,
    fill: "#22c55e"
  }), hovered.benchmark != null && /* @__PURE__ */ React.createElement("circle", {
    cx: xOf(hoverIdx),
    cy: yOf(hovered.benchmark),
    r: 3,
    fill: "#3b82f6"
  })), equity.map((r, i) => {
    if (i % labelStep !== 0 && i !== equity.length - 1)
      return null;
    return /* @__PURE__ */ React.createElement("text", {
      key: `x-${r.date}`,
      x: xOf(i),
      y: H - 8,
      textAnchor: "middle",
      fill: "#1e3a55",
      fontSize: "9",
      fontFamily: "Syne Mono"
    }, r.date.slice(2));
  })), hovered && /* @__PURE__ */ React.createElement("div", {
    style: { display: "flex", justifyContent: "space-between", gap: "10px", marginTop: "8px", fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#8fa8c0" }
  }, /* @__PURE__ */ React.createElement("div", null, hovered.date), /* @__PURE__ */ React.createElement("div", null, "PORT ", formatMoney(hovered.portfolio), hovered.benchmark != null ? ` \xB7 SPY ${formatMoney(hovered.benchmark)}` : "")));
};
var deriveDefaultTickers = (assets, preferred) => {
  const all = (assets || []).map((item) => item.ticker);
  const preferredValid = (preferred || []).filter((ticker) => all.includes(ticker));
  if (preferredValid.length)
    return preferredValid;
  if (all.includes("SPY") && all.includes("TLT"))
    return ["SPY", "TLT"];
  return all.slice(0, Math.min(3, all.length));
};
function BacktestPanel({
  etfs,
  corrMatrix,
  corrLookup,
  ohlcData,
  benchmarkTicker = "SPY",
  defaultTickers,
  title = "Portfolio Backtest (Rebalance + Benchmark)",
  description = "",
  helperNote = ""
}) {
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
  const [initialCapital, setInitialCapital] = useState(1e5);
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
      if (filtered.length)
        return filtered;
      return nextDefault;
    });
  }, [defaultTickers, etfs]);
  const dateBounds = useMemo(() => {
    const tickersForAlign = Array.from(new Set([...tickers, benchmarkTicker].filter(Boolean)));
    if (!tickers.length || !tickersForAlign.every((t) => (ohlcData?.[t] || []).length)) {
      return { start: "", end: "", count: 0 };
    }
    const aligned = alignAdjCloseSeries(ohlcData, tickersForAlign);
    if (!aligned.dates.length)
      return { start: "", end: "", count: 0 };
    return {
      start: aligned.dates[0],
      end: aligned.dates[aligned.dates.length - 1],
      count: aligned.dates.length
    };
  }, [ohlcData, tickers]);
  useEffect(() => {
    if (!dateBounds.start || !dateBounds.end)
      return;
    const nextStart = !startDate || startDate < dateBounds.start || startDate > dateBounds.end ? dateBounds.start : startDate;
    const nextEnd = !endDate || endDate > dateBounds.end || endDate < dateBounds.start ? dateBounds.end : endDate;
    if (nextStart !== startDate)
      setStartDate(nextStart);
    if (nextEnd !== endDate)
      setEndDate(nextEnd);
  }, [startDate, endDate, dateBounds.start, dateBounds.end]);
  useEffect(() => {
    const next = {};
    for (const t of tickers)
      next[t] = Number(weightsPct?.[t] ?? 0);
    const sum = Object.values(next).reduce((a, b) => a + (Number(b) || 0), 0);
    if (sum <= 0 && tickers.length) {
      const eq = 100 / tickers.length;
      for (const t of tickers)
        next[t] = eq;
    }
    setWeightsPct(next);
  }, [tickers]);
  const weightsDec = useMemo(() => {
    const o = {};
    for (const t of tickers)
      o[t] = (Number(weightsPct?.[t]) || 0) / 100;
    return normalizeWeights(o);
  }, [tickers, weightsPct]);
  const toggleTicker = (t) => {
    setResult(null);
    setStatus("");
    setTickers((prev) => {
      const has = prev.includes(t);
      if (has)
        return prev.length <= 1 ? prev : prev.filter((x) => x !== t);
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
      for (const t of tickers)
        w[t] = eq;
      setWeightsPct(w);
      return;
    }
    if (preset === "mincorr") {
      const wDec = corrLookup ? computeMinCorrWeightsFromLookup(tickers, corrLookup) : computeMinCorrWeights(tickers, corrMatrix, etfs);
      const wPct = {};
      for (const t of tickers)
        wPct[t] = (wDec[t] || 0) * 100;
      setWeightsPct(wPct);
    }
  };
  const run = () => {
    setStatus("");
    setResult(null);
    const tickersForAlign = Array.from(new Set([...tickers, benchmarkTicker].filter(Boolean)));
    if (!tickers.length) {
      setStatus("Please select at least 1 asset.");
      return;
    }
    if (!tickersForAlign.every((t) => (ohlcData?.[t] || []).length)) {
      setStatus("OHLC data is not loaded yet. Please wait a moment or click RELOAD DATA.");
      return;
    }
    if (!startDate || !endDate || startDate > endDate) {
      setStatus("Please select a valid date range.");
      return;
    }
    let aligned = alignAdjCloseSeries(ohlcData, tickersForAlign, startDate, endDate);
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
        return;
      }
    }
    if (!aligned.dates.length) {
      setStatus("No overlapping trading dates for selected ETFs in this range.");
      return;
    }
    const w = {};
    for (const t of tickers)
      w[t] = (Number(weightsPct?.[t]) || 0) / 100;
    const res = runPortfolioBacktest({
      tickers,
      aligned,
      initialCapital,
      weightsByTicker: w,
      rebalanceFreq: rebalance,
      benchmarkTicker,
      feeBps,
      slippageBps,
      riskFreeRateAnnual: (Number(riskFree) || 0) / 100
    });
    if (!res?.metrics) {
      setStatus("Backtest failed.");
      return;
    }
    setResult(res);
  };
  return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", {
    style: { display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "stretch" }
  }, /* @__PURE__ */ React.createElement("div", {
    style: { flex: 1, minWidth: "320px", background: "#060e1c", border: "1px solid #0a1e32", borderRadius: "12px", padding: "20px 22px" }
  }, /* @__PURE__ */ React.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#1e3a55", letterSpacing: ".12em", marginBottom: "6px" }
  }, "BACKTEST SYSTEM"), /* @__PURE__ */ React.createElement("div", {
    style: { fontWeight: 800, fontSize: "18px", color: "#f0f6ff", marginBottom: description ? "8px" : "14px" }
  }, title), description ? /* @__PURE__ */ React.createElement("div", {
    style: { fontSize: "12px", color: "#7a9ab5", lineHeight: 1.7, marginBottom: "14px" }
  }, description) : null, /* @__PURE__ */ React.createElement("div", {
    style: { display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px" }
  }, /* @__PURE__ */ React.createElement("button", {
    className: "filter-pill on",
    style: { "--c": "#22c55e" },
    onClick: () => applyPreset("60_40"),
    disabled: !etfs.find((e) => e.ticker === "SPY") || !etfs.find((e) => e.ticker === "TLT")
  }, "60/40"), /* @__PURE__ */ React.createElement("button", {
    className: "filter-pill",
    style: { "--c": "#8fb8d8" },
    onClick: () => applyPreset("equal")
  }, "EQUAL"), /* @__PURE__ */ React.createElement("button", {
    className: "filter-pill",
    style: { "--c": "#f59e0b" },
    onClick: () => applyPreset("mincorr")
  }, "MIN-CORR")), /* @__PURE__ */ React.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#8fa8c0", marginBottom: "10px" }
  }, "SELECT ASSETS (PORTFOLIO):"), /* @__PURE__ */ React.createElement("div", {
    style: { display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "16px" }
  }, etfs.map((e) => {
    const on = tickers.includes(e.ticker);
    return /* @__PURE__ */ React.createElement("button", {
      key: e.ticker,
      className: `filter-pill ${on ? "on" : ""}`,
      style: { "--c": e.color },
      onClick: () => toggleTicker(e.ticker)
    }, e.ticker);
  })), /* @__PURE__ */ React.createElement("div", {
    style: { display: "grid", gridTemplateColumns: "1fr 90px", gap: "10px", marginBottom: "14px" }
  }, tickers.map((t) => {
    const meta = etfs.find((e) => e.ticker === t);
    return /* @__PURE__ */ React.createElement(React.Fragment, {
      key: t
    }, /* @__PURE__ */ React.createElement("div", {
      style: { display: "flex", alignItems: "center", gap: "10px" }
    }, /* @__PURE__ */ React.createElement("div", {
      style: { fontFamily: "'Syne Mono',monospace", fontWeight: 700, color: meta?.color || "#8fb8d8" }
    }, t), /* @__PURE__ */ React.createElement("div", {
      style: { fontSize: "11px", color: "#3a5a75", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
    }, meta?.sector || meta?.region || "")), /* @__PURE__ */ React.createElement("input", {
      value: weightsPct?.[t] ?? 0,
      type: "number",
      step: "0.1",
      min: "0",
      style: { width: "100%", background: "#030810", border: "1px solid #0a1a2e", borderRadius: "6px", padding: "8px 10px", color: "#d1d9e6", fontFamily: "Syne Mono", fontSize: "11px" },
      onChange: (ev) => setWeightsPct((prev) => ({ ...prev, [t]: Number(ev.target.value) }))
    }));
  })), /* @__PURE__ */ React.createElement("div", {
    style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#3a5a75" }
  }, /* @__PURE__ */ React.createElement("div", null, "WEIGHT SUM: ", Object.values(weightsPct).reduce((a, b) => a + (Number(b) || 0), 0).toFixed(2), "%"), /* @__PURE__ */ React.createElement("button", {
    className: "filter-pill",
    onClick: () => {
      const w = normalizeWeights(Object.fromEntries(tickers.map((t) => [t, (Number(weightsPct?.[t]) || 0) / 100])));
      const pct = {};
      for (const t of tickers)
        pct[t] = (w[t] || 0) * 100;
      setWeightsPct(pct);
    }
  }, "NORMALIZE")), /* @__PURE__ */ React.createElement("div", {
    style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }
  }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "9px", color: "#1e3a55", letterSpacing: ".1em", marginBottom: "6px" }
  }, "START"), /* @__PURE__ */ React.createElement("input", {
    value: startDate,
    type: "date",
    min: dateBounds.start || void 0,
    max: dateBounds.end || void 0,
    style: { width: "100%", background: "#030810", border: "1px solid #0a1a2e", borderRadius: "6px", padding: "8px 10px", color: "#d1d9e6", fontFamily: "Syne Mono", fontSize: "11px" },
    onChange: (e) => setStartDate(e.target.value)
  })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "9px", color: "#1e3a55", letterSpacing: ".1em", marginBottom: "6px" }
  }, "END"), /* @__PURE__ */ React.createElement("input", {
    value: endDate,
    type: "date",
    min: dateBounds.start || void 0,
    max: dateBounds.end || void 0,
    style: { width: "100%", background: "#030810", border: "1px solid #0a1a2e", borderRadius: "6px", padding: "8px 10px", color: "#d1d9e6", fontFamily: "Syne Mono", fontSize: "11px" },
    onChange: (e) => setEndDate(e.target.value)
  }))), /* @__PURE__ */ React.createElement("div", {
    style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }
  }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "9px", color: "#1e3a55", letterSpacing: ".1em", marginBottom: "6px" }
  }, "INITIAL CAPITAL"), /* @__PURE__ */ React.createElement("input", {
    value: initialCapital,
    type: "number",
    step: "100",
    min: "0",
    style: { width: "100%", background: "#030810", border: "1px solid #0a1a2e", borderRadius: "6px", padding: "8px 10px", color: "#d1d9e6", fontFamily: "Syne Mono", fontSize: "11px" },
    onChange: (e) => setInitialCapital(Number(e.target.value))
  })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "9px", color: "#1e3a55", letterSpacing: ".1em", marginBottom: "6px" }
  }, "REBALANCE"), /* @__PURE__ */ React.createElement("select", {
    value: rebalance,
    style: { width: "100%", background: "#030810", border: "1px solid #0a1a2e", borderRadius: "6px", padding: "8px 10px", color: "#d1d9e6", fontFamily: "Syne Mono", fontSize: "11px" },
    onChange: (e) => setRebalance(e.target.value)
  }, /* @__PURE__ */ React.createElement("option", {
    value: "none"
  }, "none"), /* @__PURE__ */ React.createElement("option", {
    value: "monthly"
  }, "monthly"), /* @__PURE__ */ React.createElement("option", {
    value: "quarterly"
  }, "quarterly"), /* @__PURE__ */ React.createElement("option", {
    value: "yearly"
  }, "yearly")))), /* @__PURE__ */ React.createElement("div", {
    style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "14px" }
  }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "9px", color: "#1e3a55", letterSpacing: ".1em", marginBottom: "6px" }
  }, "FEE (BPS)"), /* @__PURE__ */ React.createElement("input", {
    value: feeBps,
    type: "number",
    step: "0.1",
    min: "0",
    style: { width: "100%", background: "#030810", border: "1px solid #0a1a2e", borderRadius: "6px", padding: "8px 10px", color: "#d1d9e6", fontFamily: "Syne Mono", fontSize: "11px" },
    onChange: (e) => setFeeBps(Number(e.target.value))
  })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "9px", color: "#1e3a55", letterSpacing: ".1em", marginBottom: "6px" }
  }, "SLIPPAGE (BPS)"), /* @__PURE__ */ React.createElement("input", {
    value: slippageBps,
    type: "number",
    step: "0.1",
    min: "0",
    style: { width: "100%", background: "#030810", border: "1px solid #0a1a2e", borderRadius: "6px", padding: "8px 10px", color: "#d1d9e6", fontFamily: "Syne Mono", fontSize: "11px" },
    onChange: (e) => setSlippageBps(Number(e.target.value))
  })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "9px", color: "#1e3a55", letterSpacing: ".1em", marginBottom: "6px" }
  }, "RF (ANNUAL %)"), /* @__PURE__ */ React.createElement("input", {
    value: riskFree,
    type: "number",
    step: "0.1",
    style: { width: "100%", background: "#030810", border: "1px solid #0a1a2e", borderRadius: "6px", padding: "8px 10px", color: "#d1d9e6", fontFamily: "Syne Mono", fontSize: "11px" },
    onChange: (e) => setRiskFree(Number(e.target.value))
  }))), /* @__PURE__ */ React.createElement("div", {
    style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }
  }, /* @__PURE__ */ React.createElement("button", {
    className: "nav-tab on",
    onClick: run,
    style: { background: "#0e2540", borderColor: "#143a61", color: "#8fb8d8" }
  }, "RUN BACKTEST"), /* @__PURE__ */ React.createElement("button", {
    className: "nav-tab",
    onClick: () => {
      if (!result?.equity?.length)
        return;
      downloadText(`equity_curve_${startDate}_${endDate}.csv`, equityToCsv(result.equity));
    },
    style: { borderColor: "#0a1a2e" },
    disabled: !result?.equity?.length
  }, "EXPORT CSV"), /* @__PURE__ */ React.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#3a5a75" }
  }, "Benchmark: ", benchmarkTicker || "NONE"), /* @__PURE__ */ React.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#3a5a75" }
  }, "Common bars: ", dateBounds.count || 0)), helperNote ? /* @__PURE__ */ React.createElement("div", {
    style: { marginTop: "10px", fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#4a6a85" }
  }, helperNote) : null, status && /* @__PURE__ */ React.createElement("div", {
    style: { marginTop: "12px", fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#f97316" }
  }, status)), /* @__PURE__ */ React.createElement("div", {
    style: { flex: 1.3, minWidth: "360px" }
  }, /* @__PURE__ */ React.createElement("div", {
    style: { background: "#060e1c", border: "1px solid #0a1e32", borderRadius: "12px", padding: "20px 22px", marginBottom: "16px" }
  }, /* @__PURE__ */ React.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#1e3a55", letterSpacing: ".12em", marginBottom: "10px" }
  }, "CORE METRICS"), result?.metrics ? /* @__PURE__ */ React.createElement("div", {
    style: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }
  }, [
    ["Total Return", formatPct(result.metrics.totalReturn)],
    ["CAGR", formatPct(result.metrics.cagr)],
    ["Max Drawdown", formatPct(result.metrics.maxDrawdown)],
    ["Sharpe", result.metrics.sharpe.toFixed(2)],
    ["Sortino", result.metrics.sortino.toFixed(2)],
    [`${benchmarkTicker || "Benchmark"} Return`, result.metrics.benchmarkTotalReturn == null ? "N/A" : formatPct(result.metrics.benchmarkTotalReturn)]
  ].map(([k, v]) => /* @__PURE__ */ React.createElement("div", {
    key: k,
    style: { background: "#030810", border: "1px solid #0a1a2e", borderRadius: "8px", padding: "12px 14px" }
  }, /* @__PURE__ */ React.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "9px", color: "#1e3a55", letterSpacing: ".1em", marginBottom: "6px" }
  }, k), /* @__PURE__ */ React.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "14px", fontWeight: 700, color: "#d1d9e6" }
  }, v)))) : /* @__PURE__ */ React.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#4a6a85" }
  }, "Run a backtest to generate metrics.")), /* @__PURE__ */ React.createElement("div", {
    style: { background: "#060e1c", border: "1px solid #0a1e32", borderRadius: "12px", padding: "20px 22px" }
  }, /* @__PURE__ */ React.createElement("div", {
    style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "10px", flexWrap: "wrap" }
  }, /* @__PURE__ */ React.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#1e3a55", letterSpacing: ".12em" }
  }, `EQUITY CURVE (PORTFOLIO VS ${benchmarkTicker || "BENCHMARK"})`), /* @__PURE__ */ React.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#3a5a75" }
  }, result?.metrics ? `${result.metrics.startDate} \u2192 ${result.metrics.endDate} \xB7 ${result.metrics.nDays} bars` : "")), /* @__PURE__ */ React.createElement(EquityCurveChart, {
    equity: result?.equity || []
  }), /* @__PURE__ */ React.createElement("div", {
    style: { marginTop: "10px", fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#3a5a75" }
  }, "Weights: ", tickers.map((t) => `${t} ${(weightsDec[t] * 100).toFixed(1)}%`).join(" \xB7 "))))));
}

// market-lab-panel.jsx
import React2, { useEffect as useEffect2, useMemo as useMemo2, useState as useState2 } from "react";

// yahoo-bridge-client.js
var getPreferredBase = () => {
  if (typeof window === "undefined")
    return "http://127.0.0.1:8765";
  const { hostname, port } = window.location;
  if ((hostname === "127.0.0.1" || hostname === "localhost") && port === "8765") {
    return "";
  }
  return "http://127.0.0.1:8765";
};
var requestJson = async (path) => {
  const res = await fetch(`${getPreferredBase()}${path}`, {
    cache: "no-store"
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.message || `Request failed: ${res.status}`);
  }
  return payload;
};
var probeYahooBridge = () => requestJson("/api/health");
var searchYahooSymbols = (query, limit = 8) => requestJson(`/api/search?query=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`);
var fetchYahooHistory = (symbol, period = "10y") => requestJson(`/api/history?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}`);

// market-lab-panel.jsx
var corrColor = (v) => {
  if (v >= 0.7)
    return "#f97316";
  if (v >= 0.3)
    return "#eab308";
  if (v >= 0)
    return "#22c55e";
  return "#3b82f6";
};
var corrBg = (v) => {
  if (v >= 0.7)
    return "rgba(249,115,22,.14)";
  if (v >= 0.3)
    return "rgba(234,179,8,.14)";
  if (v >= 0)
    return "rgba(34,197,94,.12)";
  return "rgba(59,130,246,.14)";
};
var colorFromTicker = (ticker) => {
  const palette = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#14b8a6", "#a855f7", "#f97316", "#06b6d4"];
  const code = (ticker || "").split("").reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return palette[code % palette.length];
};
var assetFromQuote = (quote, baseMap) => {
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
    isCustom: true
  };
};
var describeCorr = (v) => {
  if (v >= 0.7)
    return "High positive linkage. These assets have tended to move together strongly.";
  if (v >= 0.3)
    return "Moderate positive linkage. They share some common risk drivers but still diversify partially.";
  if (v >= 0)
    return "Low positive linkage. Diversification benefit is meaningful.";
  return "Negative linkage. This pair has historically offset each other during parts of the sample.";
};
function MarketLabPanel({ baseAssets, baseOhlcData }) {
  const baseAssetMap = useMemo2(() => Object.fromEntries((baseAssets || []).map((asset) => [asset.ticker, asset])), [baseAssets]);
  const [bridgeReady, setBridgeReady] = useState2(false);
  const [bridgeMessage, setBridgeMessage] = useState2("Checking local Yahoo bridge...");
  const [query, setQuery] = useState2("");
  const [searchBusy, setSearchBusy] = useState2(false);
  const [searchResults, setSearchResults] = useState2([]);
  const [selectedPair, setSelectedPair] = useState2(null);
  const [status, setStatus] = useState2("");
  const [importingSymbol, setImportingSymbol] = useState2("");
  const [assetMap, setAssetMap] = useState2(() => baseAssetMap);
  const [extraOhlc, setExtraOhlc] = useState2({});
  const [universeTickers, setUniverseTickers] = useState2(["SPY", "TLT", "GLD"]);
  useEffect2(() => {
    setAssetMap((prev) => ({ ...baseAssetMap, ...prev }));
  }, [baseAssetMap]);
  useEffect2(() => {
    let active = true;
    probeYahooBridge().then(() => {
      if (!active)
        return;
      setBridgeReady(true);
      setBridgeMessage("Local Yahoo bridge is online. You can search and import any Yahoo symbol.");
    }).catch(() => {
      if (!active)
        return;
      setBridgeReady(false);
      setBridgeMessage("Start local_refresh_server.py and open http://127.0.0.1:8765/ to enable full-universe Yahoo search.");
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect2(() => {
    if (!bridgeReady || query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      setSearchBusy(true);
      searchYahooSymbols(query.trim(), 8).then((payload) => {
        if (!active)
          return;
        setSearchResults(payload?.results || []);
      }).catch(() => {
        if (!active)
          return;
        setSearchResults([]);
      }).finally(() => {
        if (active)
          setSearchBusy(false);
      });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [bridgeReady, query]);
  const ohlcData = useMemo2(() => ({ ...baseOhlcData || {}, ...extraOhlc }), [baseOhlcData, extraOhlc]);
  const availableTickers = useMemo2(() => universeTickers.filter((ticker) => Array.isArray(ohlcData?.[ticker]) && ohlcData[ticker].length), [ohlcData, universeTickers]);
  const universeAssets = useMemo2(() => availableTickers.map((ticker) => assetMap[ticker]).filter(Boolean), [assetMap, availableTickers]);
  const corrData = useMemo2(() => computeCorrelationLookupFromOhlc(ohlcData, availableTickers), [ohlcData, availableTickers]);
  const importSymbol = async (symbol, quote) => {
    const nextSymbol = (symbol || "").trim().toUpperCase();
    if (!nextSymbol)
      return;
    setStatus("");
    if (ohlcData?.[nextSymbol]?.length) {
      setUniverseTickers((prev) => prev.includes(nextSymbol) ? prev : [...prev, nextSymbol]);
      setQuery("");
      return;
    }
    try {
      setImportingSymbol(nextSymbol);
      const payload = await fetchYahooHistory(nextSymbol, "10y");
      const asset = assetFromQuote({
        symbol: nextSymbol,
        longname: payload?.meta?.name || quote?.longname,
        shortname: payload?.meta?.shortName || quote?.shortname,
        exchange: payload?.meta?.exchange || quote?.exchange,
        exchDisp: payload?.meta?.exchange || quote?.exchDisp,
        quoteType: payload?.meta?.quoteType || quote?.quoteType,
        typeDisp: quote?.typeDisp || payload?.meta?.quoteType
      }, baseAssetMap);
      setAssetMap((prev) => ({ ...prev, [nextSymbol]: asset }));
      setExtraOhlc((prev) => ({ ...prev, [nextSymbol]: payload?.ohlc || [] }));
      setUniverseTickers((prev) => prev.includes(nextSymbol) ? prev : [...prev, nextSymbol]);
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
    if (universeTickers.length <= 2)
      return;
    setUniverseTickers((prev) => prev.filter((item) => item !== ticker));
    setSelectedPair(null);
  };
  return /* @__PURE__ */ React2.createElement("div", null, /* @__PURE__ */ React2.createElement("div", {
    style: { display: "grid", gridTemplateColumns: "1.2fr .8fr", gap: "16px", alignItems: "stretch", marginBottom: "18px" }
  }, /* @__PURE__ */ React2.createElement("div", {
    style: { background: "#060e1c", border: "1px solid #0a1e32", borderRadius: "12px", padding: "20px 22px" }
  }, /* @__PURE__ */ React2.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#1e3a55", letterSpacing: ".12em", marginBottom: "6px" }
  }, "FULL UNIVERSE MODE"), /* @__PURE__ */ React2.createElement("div", {
    style: { fontWeight: 800, fontSize: "18px", color: "#f0f6ff", marginBottom: "8px" }
  }, "Yahoo Search + Dynamic Correlation + Portfolio Backtest"), /* @__PURE__ */ React2.createElement("div", {
    style: { fontSize: "12px", color: "#7a9ab5", lineHeight: 1.7, marginBottom: "14px" }
  }, "Search any Yahoo-compatible stock, ETF, ADR or international symbol, import its daily history, then run correlation analysis and backtests in the same workspace."), /* @__PURE__ */ React2.createElement("div", {
    style: { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "14px" }
  }, /* @__PURE__ */ React2.createElement("input", {
    value: query,
    placeholder: "Search Apple / Tesla / 0700.HK / TSM / BTC-USD",
    style: { flex: 1, minWidth: "260px", background: "#030810", border: "1px solid #0a1a2e", borderRadius: "6px", padding: "10px 12px", color: "#d1d9e6", fontFamily: "Syne Mono", fontSize: "11px" },
    onChange: (e) => setQuery(e.target.value),
    onKeyDown: (e) => {
      if (e.key === "Enter") {
        importSymbol(query, null);
      }
    }
  }), /* @__PURE__ */ React2.createElement("button", {
    className: "nav-tab on",
    onClick: () => importSymbol(query, null),
    disabled: !bridgeReady || !query.trim() || !!importingSymbol,
    style: { background: "#0e2540", borderColor: "#143a61", color: "#8fb8d8" }
  }, importingSymbol ? `IMPORTING ${importingSymbol}...` : "ADD SYMBOL")), /* @__PURE__ */ React2.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: bridgeReady ? "#22c55e" : "#f59e0b", marginBottom: "8px" }
  }, bridgeMessage), /* @__PURE__ */ React2.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#3a5a75" }
  }, "Best execution path: run the app via `python3 local_refresh_server.py`, then open `http://127.0.0.1:8765/`."), status && /* @__PURE__ */ React2.createElement("div", {
    style: { marginTop: "12px", fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#8fb8d8" }
  }, status)), /* @__PURE__ */ React2.createElement("div", {
    style: { background: "#060e1c", border: "1px solid #0a1e32", borderRadius: "12px", padding: "20px 22px" }
  }, /* @__PURE__ */ React2.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#1e3a55", letterSpacing: ".12em", marginBottom: "10px" }
  }, "UNIVERSE STATUS"), /* @__PURE__ */ React2.createElement("div", {
    style: { display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "10px" }
  }, [
    ["Loaded Assets", String(availableTickers.length)],
    ["Common Bars", String(corrData.dates.length || 0)],
    ["Search Mode", bridgeReady ? "ONLINE" : "OFFLINE"],
    ["Benchmark", "SPY"]
  ].map(([label, value]) => /* @__PURE__ */ React2.createElement("div", {
    key: label,
    style: { background: "#030810", border: "1px solid #0a1a2e", borderRadius: "8px", padding: "12px 14px" }
  }, /* @__PURE__ */ React2.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "9px", color: "#1e3a55", letterSpacing: ".1em", marginBottom: "6px" }
  }, label), /* @__PURE__ */ React2.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "14px", fontWeight: 700, color: "#d1d9e6" }
  }, value)))))), (searchBusy || searchResults.length > 0) && /* @__PURE__ */ React2.createElement("div", {
    style: { background: "#060e1c", border: "1px solid #0a1e32", borderRadius: "12px", padding: "16px 18px", marginBottom: "18px" }
  }, /* @__PURE__ */ React2.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#8fa8c0", marginBottom: "12px" }
  }, searchBusy ? "SEARCHING YAHOO..." : "SEARCH RESULTS"), /* @__PURE__ */ React2.createElement("div", {
    style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "10px" }
  }, searchResults.map((item) => {
    const symbol = item.symbol;
    const imported = !!ohlcData?.[symbol]?.length;
    return /* @__PURE__ */ React2.createElement("div", {
      key: symbol,
      style: { background: "#030810", border: "1px solid #0a1a2e", borderRadius: "8px", padding: "12px 14px" }
    }, /* @__PURE__ */ React2.createElement("div", {
      style: { display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center", marginBottom: "6px" }
    }, /* @__PURE__ */ React2.createElement("div", {
      style: { fontFamily: "'Syne Mono',monospace", fontSize: "13px", fontWeight: 700, color: colorFromTicker(symbol) }
    }, symbol), /* @__PURE__ */ React2.createElement("button", {
      className: "filter-pill",
      onClick: () => importSymbol(symbol, item),
      disabled: !!importingSymbol
    }, imported ? "ADDED" : "IMPORT")), /* @__PURE__ */ React2.createElement("div", {
      style: { fontSize: "12px", color: "#d1d9e6", marginBottom: "5px" }
    }, item.longname || item.shortname || symbol), /* @__PURE__ */ React2.createElement("div", {
      style: { fontFamily: "'Syne Mono',monospace", fontSize: "9px", color: "#3a5a75" }
    }, (item.typeDisp || item.quoteType || "Yahoo").toUpperCase(), " \xB7 ", item.exchDisp || item.exchange || "Yahoo"));
  }))), /* @__PURE__ */ React2.createElement("div", {
    style: { background: "#060e1c", border: "1px solid #0a1e32", borderRadius: "12px", padding: "20px 22px", marginBottom: "18px" }
  }, /* @__PURE__ */ React2.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#8fa8c0", marginBottom: "12px" }
  }, "ACTIVE UNIVERSE"), /* @__PURE__ */ React2.createElement("div", {
    style: { display: "flex", gap: "8px", flexWrap: "wrap" }
  }, universeTickers.map((ticker) => {
    const asset = assetMap[ticker];
    const removable = universeTickers.length > 2;
    return /* @__PURE__ */ React2.createElement("button", {
      key: ticker,
      className: "filter-pill on",
      style: { "--c": asset?.color || colorFromTicker(ticker), display: "flex", alignItems: "center", gap: "8px" },
      onClick: () => removeTicker(ticker),
      title: removable ? "Click to remove from dynamic universe" : ""
    }, /* @__PURE__ */ React2.createElement("span", null, ticker), removable ? /* @__PURE__ */ React2.createElement("span", {
      style: { opacity: 0.7 }
    }, "\xD7") : null);
  }))), /* @__PURE__ */ React2.createElement("div", {
    style: { background: "#060e1c", border: "1px solid #0a1e32", borderRadius: "12px", padding: "20px 22px", marginBottom: "18px", overflowX: "auto" }
  }, /* @__PURE__ */ React2.createElement("div", {
    style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "14px", flexWrap: "wrap" }
  }, /* @__PURE__ */ React2.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#1e3a55", letterSpacing: ".12em" }
  }, "DYNAMIC CORRELATION MATRIX \u2014 DAILY ADJ CLOSE RETURN BASIS"), /* @__PURE__ */ React2.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#3a5a75" }
  }, corrData.dates.length ? `${corrData.dates[0]} \u2192 ${corrData.dates[corrData.dates.length - 1]} \xB7 ${corrData.dates.length} return bars` : "Need at least 2 loaded assets")), availableTickers.length >= 2 ? /* @__PURE__ */ React2.createElement("div", {
    style: { display: "grid", gridTemplateColumns: `80px repeat(${availableTickers.length},1fr)`, gap: "3px", minWidth: `${80 + availableTickers.length * 72}px` }
  }, /* @__PURE__ */ React2.createElement("div", null), availableTickers.map((ticker) => /* @__PURE__ */ React2.createElement("div", {
    key: `${ticker}-col`,
    style: { textAlign: "center", fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: assetMap[ticker]?.color || "#8fb8d8", padding: "4px 2px" }
  }, ticker)), availableTickers.map((rowTicker) => /* @__PURE__ */ React2.createElement(React2.Fragment, {
    key: `${rowTicker}-row`
  }, /* @__PURE__ */ React2.createElement("div", {
    style: { display: "flex", alignItems: "center", paddingRight: "8px", fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: assetMap[rowTicker]?.color || "#8fb8d8" }
  }, rowTicker), availableTickers.map((colTicker) => {
    const same = rowTicker === colTicker;
    const value = same ? 1 : corrData.lookup?.[rowTicker]?.[colTicker] ?? 0;
    return /* @__PURE__ */ React2.createElement("div", {
      key: `${rowTicker}-${colTicker}`,
      className: "corr-cell",
      style: {
        height: "42px",
        background: same ? "#0a1e32" : corrBg(value),
        color: same ? "#1e3a55" : corrColor(value),
        border: same ? "1px solid #0a1e32" : `1px solid ${corrColor(value)}33`
      },
      onClick: () => {
        if (same)
          return;
        setSelectedPair({
          a: assetMap[rowTicker],
          b: assetMap[colTicker],
          corr: value
        });
      }
    }, same ? "\u2014" : value.toFixed(2));
  })))) : /* @__PURE__ */ React2.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#4a6a85" }
  }, "Import at least 2 Yahoo symbols to generate a dynamic correlation matrix."), selectedPair && /* @__PURE__ */ React2.createElement("div", {
    style: { marginTop: "16px", padding: "16px 18px", background: "#030810", border: "1px solid #0a1a2e", borderRadius: "8px" }
  }, /* @__PURE__ */ React2.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "11px", color: "#8fb8d8", marginBottom: "6px" }
  }, selectedPair.a?.ticker, " \xD7 ", selectedPair.b?.ticker, ": ", selectedPair.corr.toFixed(2)), /* @__PURE__ */ React2.createElement("div", {
    style: { fontSize: "12px", color: "#7a9ab5", lineHeight: 1.7 }
  }, describeCorr(selectedPair.corr)))), /* @__PURE__ */ React2.createElement(BacktestPanel, {
    etfs: universeAssets,
    corrLookup: corrData.lookup,
    ohlcData,
    benchmarkTicker: "SPY",
    defaultTickers: availableTickers,
    title: "Global Yahoo Portfolio Backtest",
    description: "Run portfolio backtests on any imported Yahoo-compatible assets.",
    helperNote: "Search and import assets above. SPY remains the default benchmark."
  }));
}

// etf-correlation-dashboard.jsx
var ETFS = [
  {
    id: 0,
    ticker: "SPY",
    name: "SPDR S&P 500 ETF Trust",
    exchange: "NYSE",
    leverage: "1x",
    region: "\u{1F1FA}\u{1F1F8} US",
    sector: "US Broad Market",
    expense: "0.09%",
    aum: "$570B",
    color: "#3b82f6",
    corr_group: "US Equity",
    why_short: "Benchmark anchor \u2014 largest, most liquid ETF on earth.",
    why_full: "SPY is the universal benchmark. Including it is methodologically essential \u2014 every other ETF's correlation is measured relative to this baseline. It represents the US large-cap equity factor, the single most dominant global risk factor. Without it, the correlation matrix lacks a reference point.",
    risk: "Low",
    basePrice: 290,
    seed: [268, 321, 258, 373, 477, 383, 479, 590, 682, 692, 681, 650]
  },
  {
    id: 1,
    ticker: "EZU",
    name: "iShares MSCI Eurozone ETF",
    exchange: "NYSE",
    leverage: "1x",
    region: "\u{1F1EA}\u{1F1FA} Europe",
    sector: "Eurozone Equities",
    expense: "0.51%",
    aum: "$9.2B",
    color: "#f59e0b",
    corr_group: "Europe Equity",
    why_short: "Eurozone equities \u2014 driven by ECB policy, EUR/USD, and different macro cycles.",
    why_full: "EZU tracks 10 Eurozone nations (France, Germany, Italy, Spain etc.) and is driven by entirely different macro forces than SPY: ECB monetary policy, EUR/USD exchange rate, European fiscal policy, and energy import costs. It outperformed US benchmarks by ~37% in 2025 as the 'Sell America' trade accelerated. Its P/E of ~17.8x versus SPY's ~29x provides fundamental divergence that reduces correlation structurally.",
    risk: "Medium",
    basePrice: 38,
    seed: [38, 42, 31, 40, 48, 37, 44, 48, 66, 68, 65, 63]
  },
  {
    id: 2,
    ticker: "INDA",
    name: "iShares MSCI India ETF",
    exchange: "NYSE",
    leverage: "1x",
    region: "\u{1F1EE}\u{1F1F3} India",
    sector: "India Equities",
    expense: "0.61%",
    aum: "$6.1B",
    color: "#f97316",
    corr_group: "EM Asia Equity",
    why_short: "India's domestically-driven economy with low US market linkage.",
    why_full: "India's equity market is primarily driven by domestic consumption, demographic growth, and RBI policy \u2014 not US tech earnings. INDA has historically shown correlation to SPY of ~0.55\u20130.65, well below US sector ETFs (typically 0.85+). India's economic cycle is structurally decoupled: it benefits from 'China+1' supply chain shifts, a young population (median age 28), and expanding middle class. Essential for any serious global correlation study.",
    risk: "Medium-High",
    basePrice: 32,
    seed: [32, 37, 27, 40, 49, 38, 45, 52, 48, 51, 50, 50]
  },
  {
    id: 3,
    ticker: "KWEB",
    name: "KraneShares CSI China Internet ETF",
    exchange: "NYSE",
    leverage: "1x",
    region: "\u{1F1E8}\u{1F1F3} China",
    sector: "China Tech/Internet",
    expense: "0.69%",
    aum: "$5.8B",
    color: "#ef4444",
    corr_group: "China Equity",
    why_short: "China internet \u2014 driven by PBOC policy and regulatory cycles, not US Fed.",
    why_full: "KWEB tracks Alibaba, Tencent, Meituan, JD.com \u2014 companies whose valuations are driven by Chinese regulatory policy, PBOC stimulus, and domestic consumption, not the US Fed or S&P earnings. KWEB collapsed 80%+ during China's 2021\u20132022 regulatory crackdown while US markets were near all-time highs \u2014 a textbook demonstration of low/negative correlation during stress events. This uncorrelated crash-and-recovery cycle makes it invaluable for correlation analysis.",
    risk: "High",
    basePrice: 50,
    seed: [50, 62, 45, 75, 88, 22, 27, 22, 35, 38, 36, 35]
  },
  {
    id: 4,
    ticker: "EWH",
    name: "iShares MSCI Hong Kong ETF",
    exchange: "NYSE",
    leverage: "1x",
    region: "\u{1F1ED}\u{1F1F0} Hong Kong",
    sector: "HK Equities",
    expense: "0.50%",
    aum: "$0.9B",
    color: "#ec4899",
    corr_group: "HK Equity",
    why_short: "HKD peg creates unique interest rate dynamics distinct from all other markets.",
    why_full: "EWH is structurally unique: Hong Kong's currency peg to the USD forces HKMA to mirror Fed rates, yet HK equities respond primarily to China macro signals, property market stress, and geopolitical risk. This creates a split correlation \u2014 moderate linkage to USD rates, but weak linkage to US equity fundamentals. Heavy in financials, real estate, and utilities, sectors with very different earnings drivers from US tech-heavy SPY.",
    risk: "Medium-High",
    basePrice: 22,
    seed: [22, 23, 18, 19, 21, 17, 18, 18, 20, 21, 20, 20]
  },
  {
    id: 5,
    ticker: "GLD",
    name: "SPDR Gold Shares",
    exchange: "NYSE",
    leverage: "1x",
    region: "\u{1F30D} Global",
    sector: "Gold / Commodities",
    expense: "0.40%",
    aum: "$85B",
    color: "#fbbf24",
    corr_group: "Commodities",
    why_short: "Gold is the definitive safe-haven \u2014 historically near-zero or negative equity correlation.",
    why_full: "Gold's correlation to equities has averaged near zero over 20 years, and turns negative during equity crashes \u2014 making it the only major asset class that reliably diversifies in crisis conditions. GLD's price is driven by real interest rates, USD strength, central bank demand, and geopolitical risk \u2014 entirely orthogonal to corporate earnings. In 2025, gold surged to all-time highs while US equities were volatile. This counter-cyclical behaviour is irreplaceable in a correlation matrix.",
    risk: "Low-Medium",
    basePrice: 125,
    seed: [121, 145, 169, 169, 168, 165, 190, 243, 383, 509, 460, 424]
  },
  {
    id: 6,
    ticker: "TLT",
    name: "iShares 20+ Year Treasury Bond ETF",
    exchange: "NASDAQ",
    leverage: "1x",
    region: "\u{1F1FA}\u{1F1F8} US",
    sector: "Long-Duration Bonds",
    expense: "0.15%",
    aum: "$58B",
    color: "#06b6d4",
    corr_group: "Fixed Income",
    why_short: "Long-duration bonds \u2014 negatively correlated to equities in risk-off events.",
    why_full: "TLT represents the pure interest rate factor. During equity selloffs, institutional capital traditionally rotates into Treasuries, producing negative correlation. TLT is driven exclusively by Fed policy expectations, inflation data, and sovereign risk \u2014 completely separate from equity earnings. From 2019\u20132020, TLT surged 40%+ while equities crashed. Note: the correlation regime shifted in 2022 (both fell as the Fed hiked), making TLT a fascinating case study in regime-dependent correlation \u2014 essential for any rigorous analysis.",
    risk: "Medium",
    basePrice: 140,
    seed: [122, 142, 148, 148, 145, 99, 94, 96, 92, 95, 92, 90]
  },
  {
    id: 7,
    ticker: "DBC",
    name: "Invesco DB Commodity Index Tracking Fund",
    exchange: "NYSE",
    leverage: "1x",
    region: "\u{1F30D} Global",
    sector: "Multi-Commodity",
    expense: "0.85%",
    aum: "$1.8B",
    color: "#10b981",
    corr_group: "Commodities",
    why_short: "Broad commodity basket \u2014 driven by supply/demand and inflation, not corporate earnings.",
    why_full: "DBC tracks a diversified basket of 14 commodities including crude oil, natural gas, gold, silver, corn, wheat, and copper. Commodity returns are driven by physical supply/demand, weather, geopolitics, and inflation expectations \u2014 entirely different drivers from financial asset returns. DBC's correlation to SPY is typically 0.3\u20130.5, and to TLT near zero or negative. It provides the real assets / inflation factor that financial instruments cannot replicate.",
    risk: "Medium-High",
    basePrice: 14,
    seed: [14.6, 14.8, 11, 15.2, 21.5, 25.8, 22.5, 24.6, 25.5, 28, 28, 27]
  },
  {
    id: 8,
    ticker: "VNQ",
    name: "Vanguard Real Estate ETF",
    exchange: "NYSE",
    leverage: "1x",
    region: "\u{1F1FA}\u{1F1F8} US",
    sector: "US REITs",
    expense: "0.12%",
    aum: "$35B",
    color: "#a78bfa",
    corr_group: "Real Assets",
    why_short: "REITs behave like a hybrid \u2014 equity upside but bond-like interest rate sensitivity.",
    why_full: "VNQ sits at the intersection of equity and fixed income: it has equity characteristics (dividends, earnings growth) but is highly sensitive to interest rates like bonds. This makes its correlation to both SPY and TLT moderate but distinct \u2014 it forms its own unique cluster in a correlation matrix. REITs also have direct exposure to physical real estate cash flows (rents), which are driven by supply/demand for space, not financial market sentiment.",
    risk: "Medium",
    basePrice: 88,
    seed: [87, 96, 74, 93, 109, 81, 82, 85, 86, 88, 86, 85]
  },
  {
    id: 9,
    ticker: "EWJ",
    name: "iShares MSCI Japan ETF",
    exchange: "NYSE",
    leverage: "1x",
    region: "\u{1F1EF}\u{1F1F5} Japan",
    sector: "Japan Equities",
    expense: "0.50%",
    aum: "$9.8B",
    color: "#84cc16",
    corr_group: "Asia Developed",
    why_short: "Japan: unique BOJ ultra-loose policy, weak yen cycle, and corporate governance reform.",
    why_full: "Japan is structurally the most unique developed market: the Bank of Japan maintained negative interest rates until 2024 while every other central bank hiked aggressively \u2014 creating a yen-carry-trade dynamic that is entirely country-specific. EWJ is driven by JPY/USD exchange rate, BOJ yield curve control policy, and Japan's corporate governance reforms (Nikkei 225 hit 34-year highs in 2024). EWJ had a total return of 38.81% in the past year (stockanalysis.com). Japan has low economic correlation to both the US and China, making it an ideal diversifier in a global correlation matrix.",
    risk: "Medium",
    basePrice: 52,
    seed: [54, 57, 52, 60, 67, 57, 66, 69, 74, 76, 74, 72]
  }
];
var YAHOO_MONTHLY_DATA = {
  "SPY": [
    {
      "date": "2019-01",
      "price": 242.1,
      "year": 2019
    },
    {
      "date": "2019-02",
      "price": 249.94,
      "year": 2019
    },
    {
      "date": "2019-03",
      "price": 254.47,
      "year": 2019
    },
    {
      "date": "2019-04",
      "price": 264.86,
      "year": 2019
    },
    {
      "date": "2019-05",
      "price": 247.97,
      "year": 2019
    },
    {
      "date": "2019-06",
      "price": 265.23,
      "year": 2019
    },
    {
      "date": "2019-07",
      "price": 269.24,
      "year": 2019
    },
    {
      "date": "2019-08",
      "price": 264.73,
      "year": 2019
    },
    {
      "date": "2019-09",
      "price": 269.88,
      "year": 2019
    },
    {
      "date": "2019-10",
      "price": 275.85,
      "year": 2019
    },
    {
      "date": "2019-11",
      "price": 285.83,
      "year": 2019
    },
    {
      "date": "2019-12",
      "price": 294.14,
      "year": 2019
    },
    {
      "date": "2020-01",
      "price": 294.02,
      "year": 2020
    },
    {
      "date": "2020-02",
      "price": 270.74,
      "year": 2020
    },
    {
      "date": "2020-03",
      "price": 236.93,
      "year": 2020
    },
    {
      "date": "2020-04",
      "price": 267.02,
      "year": 2020
    },
    {
      "date": "2020-05",
      "price": 279.74,
      "year": 2020
    },
    {
      "date": "2020-06",
      "price": 284.7,
      "year": 2020
    },
    {
      "date": "2020-07",
      "price": 301.47,
      "year": 2020
    },
    {
      "date": "2020-08",
      "price": 322.51,
      "year": 2020
    },
    {
      "date": "2020-09",
      "price": 310.44,
      "year": 2020
    },
    {
      "date": "2020-10",
      "price": 302.7,
      "year": 2020
    },
    {
      "date": "2020-11",
      "price": 335.62,
      "year": 2020
    },
    {
      "date": "2020-12",
      "price": 348.06,
      "year": 2020
    },
    {
      "date": "2021-01",
      "price": 344.51,
      "year": 2021
    },
    {
      "date": "2021-02",
      "price": 354.09,
      "year": 2021
    },
    {
      "date": "2021-03",
      "price": 370.17,
      "year": 2021
    },
    {
      "date": "2021-04",
      "price": 389.75,
      "year": 2021
    },
    {
      "date": "2021-05",
      "price": 392.31,
      "year": 2021
    },
    {
      "date": "2021-06",
      "price": 401.11,
      "year": 2021
    },
    {
      "date": "2021-07",
      "price": 410.9,
      "year": 2021
    },
    {
      "date": "2021-08",
      "price": 423.13,
      "year": 2021
    },
    {
      "date": "2021-09",
      "price": 403.41,
      "year": 2021
    },
    {
      "date": "2021-10",
      "price": 431.71,
      "year": 2021
    },
    {
      "date": "2021-11",
      "price": 428.24,
      "year": 2021
    },
    {
      "date": "2021-12",
      "price": 448.05,
      "year": 2021
    },
    {
      "date": "2022-01",
      "price": 424.42,
      "year": 2022
    },
    {
      "date": "2022-02",
      "price": 411.89,
      "year": 2022
    },
    {
      "date": "2022-03",
      "price": 427.38,
      "year": 2022
    },
    {
      "date": "2022-04",
      "price": 389.86,
      "year": 2022
    },
    {
      "date": "2022-05",
      "price": 390.74,
      "year": 2022
    },
    {
      "date": "2022-06",
      "price": 358.52,
      "year": 2022
    },
    {
      "date": "2022-07",
      "price": 391.54,
      "year": 2022
    },
    {
      "date": "2022-08",
      "price": 375.56,
      "year": 2022
    },
    {
      "date": "2022-09",
      "price": 340.84,
      "year": 2022
    },
    {
      "date": "2022-10",
      "price": 368.55,
      "year": 2022
    },
    {
      "date": "2022-11",
      "price": 389.03,
      "year": 2022
    },
    {
      "date": "2022-12",
      "price": 366.62,
      "year": 2022
    },
    {
      "date": "2023-01",
      "price": 389.67,
      "year": 2023
    },
    {
      "date": "2023-02",
      "price": 379.87,
      "year": 2023
    },
    {
      "date": "2023-03",
      "price": 393.96,
      "year": 2023
    },
    {
      "date": "2023-04",
      "price": 400.25,
      "year": 2023
    },
    {
      "date": "2023-05",
      "price": 402.1,
      "year": 2023
    },
    {
      "date": "2023-06",
      "price": 428.16,
      "year": 2023
    },
    {
      "date": "2023-07",
      "price": 442.17,
      "year": 2023
    },
    {
      "date": "2023-08",
      "price": 434.98,
      "year": 2023
    },
    {
      "date": "2023-09",
      "price": 414.35,
      "year": 2023
    },
    {
      "date": "2023-10",
      "price": 405.36,
      "year": 2023
    },
    {
      "date": "2023-11",
      "price": 442.38,
      "year": 2023
    },
    {
      "date": "2023-12",
      "price": 462.58,
      "year": 2023
    },
    {
      "date": "2024-01",
      "price": 469.95,
      "year": 2024
    },
    {
      "date": "2024-02",
      "price": 494.47,
      "year": 2024
    },
    {
      "date": "2024-03",
      "price": 510.64,
      "year": 2024
    },
    {
      "date": "2024-04",
      "price": 490.05,
      "year": 2024
    },
    {
      "date": "2024-05",
      "price": 514.84,
      "year": 2024
    },
    {
      "date": "2024-06",
      "price": 533,
      "year": 2024
    },
    {
      "date": "2024-07",
      "price": 539.46,
      "year": 2024
    },
    {
      "date": "2024-08",
      "price": 552.06,
      "year": 2024
    },
    {
      "date": "2024-09",
      "price": 563.66,
      "year": 2024
    },
    {
      "date": "2024-10",
      "price": 558.63,
      "year": 2024
    },
    {
      "date": "2024-11",
      "price": 591.94,
      "year": 2024
    },
    {
      "date": "2024-12",
      "price": 577.7,
      "year": 2024
    },
    {
      "date": "2025-01",
      "price": 593.21,
      "year": 2025
    },
    {
      "date": "2025-02",
      "price": 585.68,
      "year": 2025
    },
    {
      "date": "2025-03",
      "price": 553.05,
      "year": 2025
    },
    {
      "date": "2025-04",
      "price": 548.26,
      "year": 2025
    },
    {
      "date": "2025-05",
      "price": 582.71,
      "year": 2025
    },
    {
      "date": "2025-06",
      "price": 612.65,
      "year": 2025
    },
    {
      "date": "2025-07",
      "price": 626.76,
      "year": 2025
    },
    {
      "date": "2025-08",
      "price": 639.62,
      "year": 2025
    },
    {
      "date": "2025-09",
      "price": 662.41,
      "year": 2025
    },
    {
      "date": "2025-10",
      "price": 678.2,
      "year": 2025
    },
    {
      "date": "2025-11",
      "price": 679.52,
      "year": 2025
    },
    {
      "date": "2025-12",
      "price": 680.06,
      "year": 2025
    },
    {
      "date": "2026-01",
      "price": 690.09,
      "year": 2026
    },
    {
      "date": "2026-02",
      "price": 684.12,
      "year": 2026
    },
    {
      "date": "2026-03",
      "price": 650.34,
      "year": 2026
    },
    {
      "date": "2026-04",
      "price": 718.66,
      "year": 2026
    },
    {
      "date": "2026-05",
      "price": 733.83,
      "year": 2026
    }
  ],
  "EZU": [
    {
      "date": "2019-01",
      "price": 30.91,
      "year": 2019
    },
    {
      "date": "2019-02",
      "price": 31.88,
      "year": 2019
    },
    {
      "date": "2019-03",
      "price": 31.94,
      "year": 2019
    },
    {
      "date": "2019-04",
      "price": 33.54,
      "year": 2019
    },
    {
      "date": "2019-05",
      "price": 31.38,
      "year": 2019
    },
    {
      "date": "2019-06",
      "price": 33.61,
      "year": 2019
    },
    {
      "date": "2019-07",
      "price": 32.71,
      "year": 2019
    },
    {
      "date": "2019-08",
      "price": 32.21,
      "year": 2019
    },
    {
      "date": "2019-09",
      "price": 33.04,
      "year": 2019
    },
    {
      "date": "2019-10",
      "price": 34.34,
      "year": 2019
    },
    {
      "date": "2019-11",
      "price": 34.66,
      "year": 2019
    },
    {
      "date": "2019-12",
      "price": 35.77,
      "year": 2019
    },
    {
      "date": "2020-01",
      "price": 34.54,
      "year": 2020
    },
    {
      "date": "2020-02",
      "price": 31.99,
      "year": 2020
    },
    {
      "date": "2020-03",
      "price": 26.03,
      "year": 2020
    },
    {
      "date": "2020-04",
      "price": 27.63,
      "year": 2020
    },
    {
      "date": "2020-05",
      "price": 29.67,
      "year": 2020
    },
    {
      "date": "2020-06",
      "price": 31.4,
      "year": 2020
    },
    {
      "date": "2020-07",
      "price": 32.43,
      "year": 2020
    },
    {
      "date": "2020-08",
      "price": 33.91,
      "year": 2020
    },
    {
      "date": "2020-09",
      "price": 32.64,
      "year": 2020
    },
    {
      "date": "2020-10",
      "price": 30.88,
      "year": 2020
    },
    {
      "date": "2020-11",
      "price": 36.96,
      "year": 2020
    },
    {
      "date": "2020-12",
      "price": 38.49,
      "year": 2020
    },
    {
      "date": "2021-01",
      "price": 37.82,
      "year": 2021
    },
    {
      "date": "2021-02",
      "price": 39.1,
      "year": 2021
    },
    {
      "date": "2021-03",
      "price": 40.54,
      "year": 2021
    },
    {
      "date": "2021-04",
      "price": 42.43,
      "year": 2021
    },
    {
      "date": "2021-05",
      "price": 44.29,
      "year": 2021
    },
    {
      "date": "2021-06",
      "price": 43.5,
      "year": 2021
    },
    {
      "date": "2021-07",
      "price": 43.94,
      "year": 2021
    },
    {
      "date": "2021-08",
      "price": 44.81,
      "year": 2021
    },
    {
      "date": "2021-09",
      "price": 42.42,
      "year": 2021
    },
    {
      "date": "2021-10",
      "price": 44.36,
      "year": 2021
    },
    {
      "date": "2021-11",
      "price": 41.96,
      "year": 2021
    },
    {
      "date": "2021-12",
      "price": 43.85,
      "year": 2021
    },
    {
      "date": "2022-01",
      "price": 42.39,
      "year": 2022
    },
    {
      "date": "2022-02",
      "price": 39.26,
      "year": 2022
    },
    {
      "date": "2022-03",
      "price": 38.71,
      "year": 2022
    },
    {
      "date": "2022-04",
      "price": 35.89,
      "year": 2022
    },
    {
      "date": "2022-05",
      "price": 37.44,
      "year": 2022
    },
    {
      "date": "2022-06",
      "price": 33.27,
      "year": 2022
    },
    {
      "date": "2022-07",
      "price": 34.92,
      "year": 2022
    },
    {
      "date": "2022-08",
      "price": 32.33,
      "year": 2022
    },
    {
      "date": "2022-09",
      "price": 29.27,
      "year": 2022
    },
    {
      "date": "2022-10",
      "price": 32.22,
      "year": 2022
    },
    {
      "date": "2022-11",
      "price": 37.1,
      "year": 2022
    },
    {
      "date": "2022-12",
      "price": 36.29,
      "year": 2022
    },
    {
      "date": "2023-01",
      "price": 40.76,
      "year": 2023
    },
    {
      "date": "2023-02",
      "price": 40.06,
      "year": 2023
    },
    {
      "date": "2023-03",
      "price": 41.44,
      "year": 2023
    },
    {
      "date": "2023-04",
      "price": 42.76,
      "year": 2023
    },
    {
      "date": "2023-05",
      "price": 40.56,
      "year": 2023
    },
    {
      "date": "2023-06",
      "price": 42.94,
      "year": 2023
    },
    {
      "date": "2023-07",
      "price": 43.99,
      "year": 2023
    },
    {
      "date": "2023-08",
      "price": 42.01,
      "year": 2023
    },
    {
      "date": "2023-09",
      "price": 39.58,
      "year": 2023
    },
    {
      "date": "2023-10",
      "price": 38.52,
      "year": 2023
    },
    {
      "date": "2023-11",
      "price": 42.78,
      "year": 2023
    },
    {
      "date": "2023-12",
      "price": 44.79,
      "year": 2023
    },
    {
      "date": "2024-01",
      "price": 44.52,
      "year": 2024
    },
    {
      "date": "2024-02",
      "price": 46.31,
      "year": 2024
    },
    {
      "date": "2024-03",
      "price": 48.21,
      "year": 2024
    },
    {
      "date": "2024-04",
      "price": 46.51,
      "year": 2024
    },
    {
      "date": "2024-05",
      "price": 49.11,
      "year": 2024
    },
    {
      "date": "2024-06",
      "price": 47.05,
      "year": 2024
    },
    {
      "date": "2024-07",
      "price": 47.61,
      "year": 2024
    },
    {
      "date": "2024-08",
      "price": 49.5,
      "year": 2024
    },
    {
      "date": "2024-09",
      "price": 50.33,
      "year": 2024
    },
    {
      "date": "2024-10",
      "price": 47.5,
      "year": 2024
    },
    {
      "date": "2024-11",
      "price": 46.12,
      "year": 2024
    },
    {
      "date": "2024-12",
      "price": 45.79,
      "year": 2024
    },
    {
      "date": "2025-01",
      "price": 49.06,
      "year": 2025
    },
    {
      "date": "2025-02",
      "price": 50.82,
      "year": 2025
    },
    {
      "date": "2025-03",
      "price": 51.66,
      "year": 2025
    },
    {
      "date": "2025-04",
      "price": 54.05,
      "year": 2025
    },
    {
      "date": "2025-05",
      "price": 57.22,
      "year": 2025
    },
    {
      "date": "2025-06",
      "price": 58.89,
      "year": 2025
    },
    {
      "date": "2025-07",
      "price": 57.52,
      "year": 2025
    },
    {
      "date": "2025-08",
      "price": 59.24,
      "year": 2025
    },
    {
      "date": "2025-09",
      "price": 61.35,
      "year": 2025
    },
    {
      "date": "2025-10",
      "price": 61.58,
      "year": 2025
    },
    {
      "date": "2025-11",
      "price": 62.07,
      "year": 2025
    },
    {
      "date": "2025-12",
      "price": 64.1,
      "year": 2025
    },
    {
      "date": "2026-01",
      "price": 66.66,
      "year": 2026
    },
    {
      "date": "2026-02",
      "price": 68.58,
      "year": 2026
    },
    {
      "date": "2026-03",
      "price": 62.64,
      "year": 2026
    },
    {
      "date": "2026-04",
      "price": 66.62,
      "year": 2026
    },
    {
      "date": "2026-05",
      "price": 68.72,
      "year": 2026
    }
  ],
  "INDA": [
    {
      "date": "2019-01",
      "price": 30.12,
      "year": 2019
    },
    {
      "date": "2019-02",
      "price": 30.01,
      "year": 2019
    },
    {
      "date": "2019-03",
      "price": 32.37,
      "year": 2019
    },
    {
      "date": "2019-04",
      "price": 32.6,
      "year": 2019
    },
    {
      "date": "2019-05",
      "price": 33.04,
      "year": 2019
    },
    {
      "date": "2019-06",
      "price": 32.71,
      "year": 2019
    },
    {
      "date": "2019-07",
      "price": 30.58,
      "year": 2019
    },
    {
      "date": "2019-08",
      "price": 29.82,
      "year": 2019
    },
    {
      "date": "2019-09",
      "price": 31.1,
      "year": 2019
    },
    {
      "date": "2019-10",
      "price": 32.1,
      "year": 2019
    },
    {
      "date": "2019-11",
      "price": 31.93,
      "year": 2019
    },
    {
      "date": "2019-12",
      "price": 32.6,
      "year": 2019
    },
    {
      "date": "2020-01",
      "price": 31.99,
      "year": 2020
    },
    {
      "date": "2020-02",
      "price": 29.85,
      "year": 2020
    },
    {
      "date": "2020-03",
      "price": 22.36,
      "year": 2020
    },
    {
      "date": "2020-04",
      "price": 25.09,
      "year": 2020
    },
    {
      "date": "2020-05",
      "price": 25.49,
      "year": 2020
    },
    {
      "date": "2020-06",
      "price": 26.99,
      "year": 2020
    },
    {
      "date": "2020-07",
      "price": 29.7,
      "year": 2020
    },
    {
      "date": "2020-08",
      "price": 31.03,
      "year": 2020
    },
    {
      "date": "2020-09",
      "price": 31.49,
      "year": 2020
    },
    {
      "date": "2020-10",
      "price": 31.23,
      "year": 2020
    },
    {
      "date": "2020-11",
      "price": 33.92,
      "year": 2020
    },
    {
      "date": "2020-12",
      "price": 37.43,
      "year": 2020
    },
    {
      "date": "2021-01",
      "price": 36.43,
      "year": 2021
    },
    {
      "date": "2021-02",
      "price": 38.19,
      "year": 2021
    },
    {
      "date": "2021-03",
      "price": 39.26,
      "year": 2021
    },
    {
      "date": "2021-04",
      "price": 38.18,
      "year": 2021
    },
    {
      "date": "2021-05",
      "price": 41.21,
      "year": 2021
    },
    {
      "date": "2021-06",
      "price": 41.22,
      "year": 2021
    },
    {
      "date": "2021-07",
      "price": 41.63,
      "year": 2021
    },
    {
      "date": "2021-08",
      "price": 45.27,
      "year": 2021
    },
    {
      "date": "2021-09",
      "price": 45.36,
      "year": 2021
    },
    {
      "date": "2021-10",
      "price": 45.5,
      "year": 2021
    },
    {
      "date": "2021-11",
      "price": 44.27,
      "year": 2021
    },
    {
      "date": "2021-12",
      "price": 45.42,
      "year": 2021
    },
    {
      "date": "2022-01",
      "price": 45.45,
      "year": 2022
    },
    {
      "date": "2022-02",
      "price": 43.35,
      "year": 2022
    },
    {
      "date": "2022-03",
      "price": 44.17,
      "year": 2022
    },
    {
      "date": "2022-04",
      "price": 43.24,
      "year": 2022
    },
    {
      "date": "2022-05",
      "price": 41.05,
      "year": 2022
    },
    {
      "date": "2022-06",
      "price": 39.01,
      "year": 2022
    },
    {
      "date": "2022-07",
      "price": 42.29,
      "year": 2022
    },
    {
      "date": "2022-08",
      "price": 42.63,
      "year": 2022
    },
    {
      "date": "2022-09",
      "price": 40.41,
      "year": 2022
    },
    {
      "date": "2022-10",
      "price": 41.82,
      "year": 2022
    },
    {
      "date": "2022-11",
      "price": 43.84,
      "year": 2022
    },
    {
      "date": "2022-12",
      "price": 41.36,
      "year": 2022
    },
    {
      "date": "2023-01",
      "price": 40.62,
      "year": 2023
    },
    {
      "date": "2023-02",
      "price": 38.45,
      "year": 2023
    },
    {
      "date": "2023-03",
      "price": 39,
      "year": 2023
    },
    {
      "date": "2023-04",
      "price": 40.75,
      "year": 2023
    },
    {
      "date": "2023-05",
      "price": 41.32,
      "year": 2023
    },
    {
      "date": "2023-06",
      "price": 43.39,
      "year": 2023
    },
    {
      "date": "2023-07",
      "price": 44.44,
      "year": 2023
    },
    {
      "date": "2023-08",
      "price": 43.65,
      "year": 2023
    },
    {
      "date": "2023-09",
      "price": 43.9,
      "year": 2023
    },
    {
      "date": "2023-10",
      "price": 42.93,
      "year": 2023
    },
    {
      "date": "2023-11",
      "price": 45.69,
      "year": 2023
    },
    {
      "date": "2023-12",
      "price": 48.46,
      "year": 2023
    },
    {
      "date": "2024-01",
      "price": 49.53,
      "year": 2024
    },
    {
      "date": "2024-02",
      "price": 50.79,
      "year": 2024
    },
    {
      "date": "2024-03",
      "price": 51.22,
      "year": 2024
    },
    {
      "date": "2024-04",
      "price": 51.97,
      "year": 2024
    },
    {
      "date": "2024-05",
      "price": 52.63,
      "year": 2024
    },
    {
      "date": "2024-06",
      "price": 55.38,
      "year": 2024
    },
    {
      "date": "2024-07",
      "price": 57.01,
      "year": 2024
    },
    {
      "date": "2024-08",
      "price": 57.31,
      "year": 2024
    },
    {
      "date": "2024-09",
      "price": 58.11,
      "year": 2024
    },
    {
      "date": "2024-10",
      "price": 54.43,
      "year": 2024
    },
    {
      "date": "2024-11",
      "price": 54.39,
      "year": 2024
    },
    {
      "date": "2024-12",
      "price": 52.64,
      "year": 2024
    },
    {
      "date": "2025-01",
      "price": 50.99,
      "year": 2025
    },
    {
      "date": "2025-02",
      "price": 48.1,
      "year": 2025
    },
    {
      "date": "2025-03",
      "price": 51.48,
      "year": 2025
    },
    {
      "date": "2025-04",
      "price": 53.57,
      "year": 2025
    },
    {
      "date": "2025-05",
      "price": 54.31,
      "year": 2025
    },
    {
      "date": "2025-06",
      "price": 55.68,
      "year": 2025
    },
    {
      "date": "2025-07",
      "price": 52.64,
      "year": 2025
    },
    {
      "date": "2025-08",
      "price": 51.98,
      "year": 2025
    },
    {
      "date": "2025-09",
      "price": 52.06,
      "year": 2025
    },
    {
      "date": "2025-10",
      "price": 53.97,
      "year": 2025
    },
    {
      "date": "2025-11",
      "price": 54.71,
      "year": 2025
    },
    {
      "date": "2025-12",
      "price": 54.05,
      "year": 2025
    },
    {
      "date": "2026-01",
      "price": 51.74,
      "year": 2026
    },
    {
      "date": "2026-02",
      "price": 52.27,
      "year": 2026
    },
    {
      "date": "2026-03",
      "price": 46.84,
      "year": 2026
    },
    {
      "date": "2026-04",
      "price": 49.42,
      "year": 2026
    },
    {
      "date": "2026-05",
      "price": 50.03,
      "year": 2026
    }
  ],
  "KWEB": [
    {
      "date": "2019-01",
      "price": 36.42,
      "year": 2019
    },
    {
      "date": "2019-02",
      "price": 38.96,
      "year": 2019
    },
    {
      "date": "2019-03",
      "price": 39.17,
      "year": 2019
    },
    {
      "date": "2019-04",
      "price": 40.54,
      "year": 2019
    },
    {
      "date": "2019-05",
      "price": 33.52,
      "year": 2019
    },
    {
      "date": "2019-06",
      "price": 36.55,
      "year": 2019
    },
    {
      "date": "2019-07",
      "price": 35.11,
      "year": 2019
    },
    {
      "date": "2019-08",
      "price": 35.24,
      "year": 2019
    },
    {
      "date": "2019-09",
      "price": 34.37,
      "year": 2019
    },
    {
      "date": "2019-10",
      "price": 37.36,
      "year": 2019
    },
    {
      "date": "2019-11",
      "price": 38.76,
      "year": 2019
    },
    {
      "date": "2019-12",
      "price": 40.52,
      "year": 2019
    },
    {
      "date": "2020-01",
      "price": 40.03,
      "year": 2020
    },
    {
      "date": "2020-02",
      "price": 40.68,
      "year": 2020
    },
    {
      "date": "2020-03",
      "price": 37.68,
      "year": 2020
    },
    {
      "date": "2020-04",
      "price": 40.24,
      "year": 2020
    },
    {
      "date": "2020-05",
      "price": 43.79,
      "year": 2020
    },
    {
      "date": "2020-06",
      "price": 51.56,
      "year": 2020
    },
    {
      "date": "2020-07",
      "price": 55.78,
      "year": 2020
    },
    {
      "date": "2020-08",
      "price": 58.54,
      "year": 2020
    },
    {
      "date": "2020-09",
      "price": 56.75,
      "year": 2020
    },
    {
      "date": "2020-10",
      "price": 59.79,
      "year": 2020
    },
    {
      "date": "2020-11",
      "price": 62.79,
      "year": 2020
    },
    {
      "date": "2020-12",
      "price": 64.11,
      "year": 2020
    },
    {
      "date": "2021-01",
      "price": 72.46,
      "year": 2021
    },
    {
      "date": "2021-02",
      "price": 74.97,
      "year": 2021
    },
    {
      "date": "2021-03",
      "price": 63.75,
      "year": 2021
    },
    {
      "date": "2021-04",
      "price": 62.73,
      "year": 2021
    },
    {
      "date": "2021-05",
      "price": 58.78,
      "year": 2021
    },
    {
      "date": "2021-06",
      "price": 58.26,
      "year": 2021
    },
    {
      "date": "2021-07",
      "price": 42.13,
      "year": 2021
    },
    {
      "date": "2021-08",
      "price": 42.59,
      "year": 2021
    },
    {
      "date": "2021-09",
      "price": 39.51,
      "year": 2021
    },
    {
      "date": "2021-10",
      "price": 39.86,
      "year": 2021
    },
    {
      "date": "2021-11",
      "price": 36.78,
      "year": 2021
    },
    {
      "date": "2021-12",
      "price": 32.69,
      "year": 2021
    },
    {
      "date": "2022-01",
      "price": 33.51,
      "year": 2022
    },
    {
      "date": "2022-02",
      "price": 29.98,
      "year": 2022
    },
    {
      "date": "2022-03",
      "price": 25.54,
      "year": 2022
    },
    {
      "date": "2022-04",
      "price": 25.33,
      "year": 2022
    },
    {
      "date": "2022-05",
      "price": 26.1,
      "year": 2022
    },
    {
      "date": "2022-06",
      "price": 29.35,
      "year": 2022
    },
    {
      "date": "2022-07",
      "price": 25.4,
      "year": 2022
    },
    {
      "date": "2022-08",
      "price": 26.82,
      "year": 2022
    },
    {
      "date": "2022-09",
      "price": 22.07,
      "year": 2022
    },
    {
      "date": "2022-10",
      "price": 17.2,
      "year": 2022
    },
    {
      "date": "2022-11",
      "price": 25.45,
      "year": 2022
    },
    {
      "date": "2022-12",
      "price": 27.06,
      "year": 2022
    },
    {
      "date": "2023-01",
      "price": 30.34,
      "year": 2023
    },
    {
      "date": "2023-02",
      "price": 26.15,
      "year": 2023
    },
    {
      "date": "2023-03",
      "price": 27.94,
      "year": 2023
    },
    {
      "date": "2023-04",
      "price": 25.05,
      "year": 2023
    },
    {
      "date": "2023-05",
      "price": 22.35,
      "year": 2023
    },
    {
      "date": "2023-06",
      "price": 24.13,
      "year": 2023
    },
    {
      "date": "2023-07",
      "price": 28.63,
      "year": 2023
    },
    {
      "date": "2023-08",
      "price": 25.72,
      "year": 2023
    },
    {
      "date": "2023-09",
      "price": 24.52,
      "year": 2023
    },
    {
      "date": "2023-10",
      "price": 23.34,
      "year": 2023
    },
    {
      "date": "2023-11",
      "price": 25.14,
      "year": 2023
    },
    {
      "date": "2023-12",
      "price": 24.6,
      "year": 2023
    },
    {
      "date": "2024-01",
      "price": 21.27,
      "year": 2024
    },
    {
      "date": "2024-02",
      "price": 23.11,
      "year": 2024
    },
    {
      "date": "2024-03",
      "price": 23.92,
      "year": 2024
    },
    {
      "date": "2024-04",
      "price": 25.4,
      "year": 2024
    },
    {
      "date": "2024-05",
      "price": 26.61,
      "year": 2024
    },
    {
      "date": "2024-06",
      "price": 24.62,
      "year": 2024
    },
    {
      "date": "2024-07",
      "price": 24.15,
      "year": 2024
    },
    {
      "date": "2024-08",
      "price": 23.41,
      "year": 2024
    },
    {
      "date": "2024-09",
      "price": 31,
      "year": 2024
    },
    {
      "date": "2024-10",
      "price": 29.34,
      "year": 2024
    },
    {
      "date": "2024-11",
      "price": 28.07,
      "year": 2024
    },
    {
      "date": "2024-12",
      "price": 27.56,
      "year": 2024
    },
    {
      "date": "2025-01",
      "price": 29.48,
      "year": 2025
    },
    {
      "date": "2025-02",
      "price": 31.98,
      "year": 2025
    },
    {
      "date": "2025-03",
      "price": 32.91,
      "year": 2025
    },
    {
      "date": "2025-04",
      "price": 30.26,
      "year": 2025
    },
    {
      "date": "2025-05",
      "price": 30.86,
      "year": 2025
    },
    {
      "date": "2025-06",
      "price": 32.36,
      "year": 2025
    },
    {
      "date": "2025-07",
      "price": 33.4,
      "year": 2025
    },
    {
      "date": "2025-08",
      "price": 35.99,
      "year": 2025
    },
    {
      "date": "2025-09",
      "price": 39.6,
      "year": 2025
    },
    {
      "date": "2025-10",
      "price": 37.66,
      "year": 2025
    },
    {
      "date": "2025-11",
      "price": 35.41,
      "year": 2025
    },
    {
      "date": "2025-12",
      "price": 34.05,
      "year": 2025
    },
    {
      "date": "2026-01",
      "price": 35.38,
      "year": 2026
    },
    {
      "date": "2026-02",
      "price": 31.06,
      "year": 2026
    },
    {
      "date": "2026-03",
      "price": 28.43,
      "year": 2026
    },
    {
      "date": "2026-04",
      "price": 28.77,
      "year": 2026
    },
    {
      "date": "2026-05",
      "price": 29.76,
      "year": 2026
    }
  ],
  "EWH": [
    {
      "date": "2019-01",
      "price": 19.37,
      "year": 2019
    },
    {
      "date": "2019-02",
      "price": 20.26,
      "year": 2019
    },
    {
      "date": "2019-03",
      "price": 20.53,
      "year": 2019
    },
    {
      "date": "2019-04",
      "price": 20.74,
      "year": 2019
    },
    {
      "date": "2019-05",
      "price": 19.32,
      "year": 2019
    },
    {
      "date": "2019-06",
      "price": 20.65,
      "year": 2019
    },
    {
      "date": "2019-07",
      "price": 19.83,
      "year": 2019
    },
    {
      "date": "2019-08",
      "price": 18.22,
      "year": 2019
    },
    {
      "date": "2019-09",
      "price": 18.11,
      "year": 2019
    },
    {
      "date": "2019-10",
      "price": 18.97,
      "year": 2019
    },
    {
      "date": "2019-11",
      "price": 18.78,
      "year": 2019
    },
    {
      "date": "2019-12",
      "price": 19.58,
      "year": 2019
    },
    {
      "date": "2020-01",
      "price": 18.44,
      "year": 2020
    },
    {
      "date": "2020-02",
      "price": 18.48,
      "year": 2020
    },
    {
      "date": "2020-03",
      "price": 16.05,
      "year": 2020
    },
    {
      "date": "2020-04",
      "price": 17.02,
      "year": 2020
    },
    {
      "date": "2020-05",
      "price": 15.97,
      "year": 2020
    },
    {
      "date": "2020-06",
      "price": 17.53,
      "year": 2020
    },
    {
      "date": "2020-07",
      "price": 17.32,
      "year": 2020
    },
    {
      "date": "2020-08",
      "price": 18.62,
      "year": 2020
    },
    {
      "date": "2020-09",
      "price": 17.98,
      "year": 2020
    },
    {
      "date": "2020-10",
      "price": 17.63,
      "year": 2020
    },
    {
      "date": "2020-11",
      "price": 19.51,
      "year": 2020
    },
    {
      "date": "2020-12",
      "price": 20.39,
      "year": 2020
    },
    {
      "date": "2021-01",
      "price": 20.74,
      "year": 2021
    },
    {
      "date": "2021-02",
      "price": 21.78,
      "year": 2021
    },
    {
      "date": "2021-03",
      "price": 22,
      "year": 2021
    },
    {
      "date": "2021-04",
      "price": 22.57,
      "year": 2021
    },
    {
      "date": "2021-05",
      "price": 23.26,
      "year": 2021
    },
    {
      "date": "2021-06",
      "price": 22.43,
      "year": 2021
    },
    {
      "date": "2021-07",
      "price": 21.89,
      "year": 2021
    },
    {
      "date": "2021-08",
      "price": 21.63,
      "year": 2021
    },
    {
      "date": "2021-09",
      "price": 20.13,
      "year": 2021
    },
    {
      "date": "2021-10",
      "price": 20.6,
      "year": 2021
    },
    {
      "date": "2021-11",
      "price": 19.55,
      "year": 2021
    },
    {
      "date": "2021-12",
      "price": 19.68,
      "year": 2021
    },
    {
      "date": "2022-01",
      "price": 20.12,
      "year": 2022
    },
    {
      "date": "2022-02",
      "price": 19.25,
      "year": 2022
    },
    {
      "date": "2022-03",
      "price": 19.16,
      "year": 2022
    },
    {
      "date": "2022-04",
      "price": 18.14,
      "year": 2022
    },
    {
      "date": "2022-05",
      "price": 18.82,
      "year": 2022
    },
    {
      "date": "2022-06",
      "price": 19.12,
      "year": 2022
    },
    {
      "date": "2022-07",
      "price": 18.31,
      "year": 2022
    },
    {
      "date": "2022-08",
      "price": 17.61,
      "year": 2022
    },
    {
      "date": "2022-09",
      "price": 15.71,
      "year": 2022
    },
    {
      "date": "2022-10",
      "price": 13.87,
      "year": 2022
    },
    {
      "date": "2022-11",
      "price": 17.24,
      "year": 2022
    },
    {
      "date": "2022-12",
      "price": 18.34,
      "year": 2022
    },
    {
      "date": "2023-01",
      "price": 19.25,
      "year": 2023
    },
    {
      "date": "2023-02",
      "price": 17.79,
      "year": 2023
    },
    {
      "date": "2023-03",
      "price": 17.94,
      "year": 2023
    },
    {
      "date": "2023-04",
      "price": 18.19,
      "year": 2023
    },
    {
      "date": "2023-05",
      "price": 16.54,
      "year": 2023
    },
    {
      "date": "2023-06",
      "price": 17.15,
      "year": 2023
    },
    {
      "date": "2023-07",
      "price": 17.75,
      "year": 2023
    },
    {
      "date": "2023-08",
      "price": 16.1,
      "year": 2023
    },
    {
      "date": "2023-09",
      "price": 15.21,
      "year": 2023
    },
    {
      "date": "2023-10",
      "price": 14.88,
      "year": 2023
    },
    {
      "date": "2023-11",
      "price": 14.91,
      "year": 2023
    },
    {
      "date": "2023-12",
      "price": 15.8,
      "year": 2023
    },
    {
      "date": "2024-01",
      "price": 14.26,
      "year": 2024
    },
    {
      "date": "2024-02",
      "price": 14.85,
      "year": 2024
    },
    {
      "date": "2024-03",
      "price": 14.14,
      "year": 2024
    },
    {
      "date": "2024-04",
      "price": 14.59,
      "year": 2024
    },
    {
      "date": "2024-05",
      "price": 15.21,
      "year": 2024
    },
    {
      "date": "2024-06",
      "price": 14.22,
      "year": 2024
    },
    {
      "date": "2024-07",
      "price": 14.17,
      "year": 2024
    },
    {
      "date": "2024-08",
      "price": 15.03,
      "year": 2024
    },
    {
      "date": "2024-09",
      "price": 17.34,
      "year": 2024
    },
    {
      "date": "2024-10",
      "price": 16.6,
      "year": 2024
    },
    {
      "date": "2024-11",
      "price": 16.2,
      "year": 2024
    },
    {
      "date": "2024-12",
      "price": 15.8,
      "year": 2024
    },
    {
      "date": "2025-01",
      "price": 15.65,
      "year": 2025
    },
    {
      "date": "2025-02",
      "price": 16.68,
      "year": 2025
    },
    {
      "date": "2025-03",
      "price": 16.61,
      "year": 2025
    },
    {
      "date": "2025-04",
      "price": 16.61,
      "year": 2025
    },
    {
      "date": "2025-05",
      "price": 17.96,
      "year": 2025
    },
    {
      "date": "2025-06",
      "price": 19.24,
      "year": 2025
    },
    {
      "date": "2025-07",
      "price": 20.06,
      "year": 2025
    },
    {
      "date": "2025-08",
      "price": 20.5,
      "year": 2025
    },
    {
      "date": "2025-09",
      "price": 20.88,
      "year": 2025
    },
    {
      "date": "2025-10",
      "price": 20.87,
      "year": 2025
    },
    {
      "date": "2025-11",
      "price": 21.55,
      "year": 2025
    },
    {
      "date": "2025-12",
      "price": 21.25,
      "year": 2025
    },
    {
      "date": "2026-01",
      "price": 23.38,
      "year": 2026
    },
    {
      "date": "2026-02",
      "price": 24.21,
      "year": 2026
    },
    {
      "date": "2026-03",
      "price": 23.09,
      "year": 2026
    },
    {
      "date": "2026-04",
      "price": 23.72,
      "year": 2026
    },
    {
      "date": "2026-05",
      "price": 24.39,
      "year": 2026
    }
  ],
  "GLD": [
    {
      "date": "2019-01",
      "price": 124.75,
      "year": 2019
    },
    {
      "date": "2019-02",
      "price": 123.99,
      "year": 2019
    },
    {
      "date": "2019-03",
      "price": 122.01,
      "year": 2019
    },
    {
      "date": "2019-04",
      "price": 121.2,
      "year": 2019
    },
    {
      "date": "2019-05",
      "price": 123.33,
      "year": 2019
    },
    {
      "date": "2019-06",
      "price": 133.2,
      "year": 2019
    },
    {
      "date": "2019-07",
      "price": 133.21,
      "year": 2019
    },
    {
      "date": "2019-08",
      "price": 143.75,
      "year": 2019
    },
    {
      "date": "2019-09",
      "price": 138.87,
      "year": 2019
    },
    {
      "date": "2019-10",
      "price": 142.43,
      "year": 2019
    },
    {
      "date": "2019-11",
      "price": 137.86,
      "year": 2019
    },
    {
      "date": "2019-12",
      "price": 142.9,
      "year": 2019
    },
    {
      "date": "2020-01",
      "price": 149.33,
      "year": 2020
    },
    {
      "date": "2020-02",
      "price": 148.38,
      "year": 2020
    },
    {
      "date": "2020-03",
      "price": 148.05,
      "year": 2020
    },
    {
      "date": "2020-04",
      "price": 158.8,
      "year": 2020
    },
    {
      "date": "2020-05",
      "price": 162.91,
      "year": 2020
    },
    {
      "date": "2020-06",
      "price": 167.37,
      "year": 2020
    },
    {
      "date": "2020-07",
      "price": 185.43,
      "year": 2020
    },
    {
      "date": "2020-08",
      "price": 184.83,
      "year": 2020
    },
    {
      "date": "2020-09",
      "price": 177.12,
      "year": 2020
    },
    {
      "date": "2020-10",
      "price": 176.2,
      "year": 2020
    },
    {
      "date": "2020-11",
      "price": 166.67,
      "year": 2020
    },
    {
      "date": "2020-12",
      "price": 178.36,
      "year": 2020
    },
    {
      "date": "2021-01",
      "price": 172.61,
      "year": 2021
    },
    {
      "date": "2021-02",
      "price": 161.81,
      "year": 2021
    },
    {
      "date": "2021-03",
      "price": 159.96,
      "year": 2021
    },
    {
      "date": "2021-04",
      "price": 165.66,
      "year": 2021
    },
    {
      "date": "2021-05",
      "price": 178.38,
      "year": 2021
    },
    {
      "date": "2021-06",
      "price": 165.63,
      "year": 2021
    },
    {
      "date": "2021-07",
      "price": 169.82,
      "year": 2021
    },
    {
      "date": "2021-08",
      "price": 169.69,
      "year": 2021
    },
    {
      "date": "2021-09",
      "price": 164.22,
      "year": 2021
    },
    {
      "date": "2021-10",
      "price": 166.65,
      "year": 2021
    },
    {
      "date": "2021-11",
      "price": 165.5,
      "year": 2021
    },
    {
      "date": "2021-12",
      "price": 170.96,
      "year": 2021
    },
    {
      "date": "2022-01",
      "price": 168.09,
      "year": 2022
    },
    {
      "date": "2022-02",
      "price": 178.38,
      "year": 2022
    },
    {
      "date": "2022-03",
      "price": 180.65,
      "year": 2022
    },
    {
      "date": "2022-04",
      "price": 176.91,
      "year": 2022
    },
    {
      "date": "2022-05",
      "price": 171.14,
      "year": 2022
    },
    {
      "date": "2022-06",
      "price": 168.46,
      "year": 2022
    },
    {
      "date": "2022-07",
      "price": 164.1,
      "year": 2022
    },
    {
      "date": "2022-08",
      "price": 159.27,
      "year": 2022
    },
    {
      "date": "2022-09",
      "price": 154.67,
      "year": 2022
    },
    {
      "date": "2022-10",
      "price": 151.91,
      "year": 2022
    },
    {
      "date": "2022-11",
      "price": 164.81,
      "year": 2022
    },
    {
      "date": "2022-12",
      "price": 169.64,
      "year": 2022
    },
    {
      "date": "2023-01",
      "price": 179.41,
      "year": 2023
    },
    {
      "date": "2023-02",
      "price": 169.78,
      "year": 2023
    },
    {
      "date": "2023-03",
      "price": 183.22,
      "year": 2023
    },
    {
      "date": "2023-04",
      "price": 184.8,
      "year": 2023
    },
    {
      "date": "2023-05",
      "price": 182.32,
      "year": 2023
    },
    {
      "date": "2023-06",
      "price": 178.27,
      "year": 2023
    },
    {
      "date": "2023-07",
      "price": 182.35,
      "year": 2023
    },
    {
      "date": "2023-08",
      "price": 180.02,
      "year": 2023
    },
    {
      "date": "2023-09",
      "price": 171.45,
      "year": 2023
    },
    {
      "date": "2023-10",
      "price": 184.09,
      "year": 2023
    },
    {
      "date": "2023-11",
      "price": 188.75,
      "year": 2023
    },
    {
      "date": "2023-12",
      "price": 191.17,
      "year": 2023
    },
    {
      "date": "2024-01",
      "price": 188.45,
      "year": 2024
    },
    {
      "date": "2024-02",
      "price": 189.31,
      "year": 2024
    },
    {
      "date": "2024-03",
      "price": 205.72,
      "year": 2024
    },
    {
      "date": "2024-04",
      "price": 211.87,
      "year": 2024
    },
    {
      "date": "2024-05",
      "price": 215.3,
      "year": 2024
    },
    {
      "date": "2024-06",
      "price": 215.01,
      "year": 2024
    },
    {
      "date": "2024-07",
      "price": 226.55,
      "year": 2024
    },
    {
      "date": "2024-08",
      "price": 231.29,
      "year": 2024
    },
    {
      "date": "2024-09",
      "price": 243.06,
      "year": 2024
    },
    {
      "date": "2024-10",
      "price": 253.51,
      "year": 2024
    },
    {
      "date": "2024-11",
      "price": 245.59,
      "year": 2024
    },
    {
      "date": "2024-12",
      "price": 242.13,
      "year": 2024
    },
    {
      "date": "2025-01",
      "price": 258.56,
      "year": 2025
    },
    {
      "date": "2025-02",
      "price": 263.27,
      "year": 2025
    },
    {
      "date": "2025-03",
      "price": 288.14,
      "year": 2025
    },
    {
      "date": "2025-04",
      "price": 303.77,
      "year": 2025
    },
    {
      "date": "2025-05",
      "price": 303.6,
      "year": 2025
    },
    {
      "date": "2025-06",
      "price": 304.83,
      "year": 2025
    },
    {
      "date": "2025-07",
      "price": 302.96,
      "year": 2025
    },
    {
      "date": "2025-08",
      "price": 318.07,
      "year": 2025
    },
    {
      "date": "2025-09",
      "price": 355.47,
      "year": 2025
    },
    {
      "date": "2025-10",
      "price": 368.12,
      "year": 2025
    },
    {
      "date": "2025-11",
      "price": 387.88,
      "year": 2025
    },
    {
      "date": "2025-12",
      "price": 396.31,
      "year": 2025
    },
    {
      "date": "2026-01",
      "price": 444.95,
      "year": 2026
    },
    {
      "date": "2026-02",
      "price": 483.75,
      "year": 2026
    },
    {
      "date": "2026-03",
      "price": 430.29,
      "year": 2026
    },
    {
      "date": "2026-04",
      "price": 423.66,
      "year": 2026
    },
    {
      "date": "2026-05",
      "price": 430.96,
      "year": 2026
    }
  ],
  "TLT": [
    {
      "date": "2019-01",
      "price": 98.93,
      "year": 2019
    },
    {
      "date": "2019-02",
      "price": 97.57,
      "year": 2019
    },
    {
      "date": "2019-03",
      "price": 103.01,
      "year": 2019
    },
    {
      "date": "2019-04",
      "price": 100.96,
      "year": 2019
    },
    {
      "date": "2019-05",
      "price": 107.86,
      "year": 2019
    },
    {
      "date": "2019-06",
      "price": 108.89,
      "year": 2019
    },
    {
      "date": "2019-07",
      "price": 109.17,
      "year": 2019
    },
    {
      "date": "2019-08",
      "price": 121.23,
      "year": 2019
    },
    {
      "date": "2019-09",
      "price": 117.98,
      "year": 2019
    },
    {
      "date": "2019-10",
      "price": 116.67,
      "year": 2019
    },
    {
      "date": "2019-11",
      "price": 116.19,
      "year": 2019
    },
    {
      "date": "2019-12",
      "price": 112.48,
      "year": 2019
    },
    {
      "date": "2020-01",
      "price": 121.13,
      "year": 2020
    },
    {
      "date": "2020-02",
      "price": 129.15,
      "year": 2020
    },
    {
      "date": "2020-03",
      "price": 137.39,
      "year": 2020
    },
    {
      "date": "2020-04",
      "price": 139.06,
      "year": 2020
    },
    {
      "date": "2020-05",
      "price": 136.61,
      "year": 2020
    },
    {
      "date": "2020-06",
      "price": 137.07,
      "year": 2020
    },
    {
      "date": "2020-07",
      "price": 143.15,
      "year": 2020
    },
    {
      "date": "2020-08",
      "price": 135.93,
      "year": 2020
    },
    {
      "date": "2020-09",
      "price": 136.98,
      "year": 2020
    },
    {
      "date": "2020-10",
      "price": 132.34,
      "year": 2020
    },
    {
      "date": "2020-11",
      "price": 134.54,
      "year": 2020
    },
    {
      "date": "2020-12",
      "price": 132.89,
      "year": 2020
    },
    {
      "date": "2021-01",
      "price": 128.07,
      "year": 2021
    },
    {
      "date": "2021-02",
      "price": 120.72,
      "year": 2021
    },
    {
      "date": "2021-03",
      "price": 114.39,
      "year": 2021
    },
    {
      "date": "2021-04",
      "price": 117.25,
      "year": 2021
    },
    {
      "date": "2021-05",
      "price": 117.25,
      "year": 2021
    },
    {
      "date": "2021-06",
      "price": 122.43,
      "year": 2021
    },
    {
      "date": "2021-07",
      "price": 126.98,
      "year": 2021
    },
    {
      "date": "2021-08",
      "price": 126.55,
      "year": 2021
    },
    {
      "date": "2021-09",
      "price": 122.87,
      "year": 2021
    },
    {
      "date": "2021-10",
      "price": 125.9,
      "year": 2021
    },
    {
      "date": "2021-11",
      "price": 129.39,
      "year": 2021
    },
    {
      "date": "2021-12",
      "price": 126.78,
      "year": 2021
    },
    {
      "date": "2022-01",
      "price": 121.82,
      "year": 2022
    },
    {
      "date": "2022-02",
      "price": 119.83,
      "year": 2022
    },
    {
      "date": "2022-03",
      "price": 113.31,
      "year": 2022
    },
    {
      "date": "2022-04",
      "price": 102.63,
      "year": 2022
    },
    {
      "date": "2022-05",
      "price": 100.32,
      "year": 2022
    },
    {
      "date": "2022-06",
      "price": 99.04,
      "year": 2022
    },
    {
      "date": "2022-07",
      "price": 101.44,
      "year": 2022
    },
    {
      "date": "2022-08",
      "price": 96.83,
      "year": 2022
    },
    {
      "date": "2022-09",
      "price": 88.85,
      "year": 2022
    },
    {
      "date": "2022-10",
      "price": 83.55,
      "year": 2022
    },
    {
      "date": "2022-11",
      "price": 89.53,
      "year": 2022
    },
    {
      "date": "2022-12",
      "price": 87.18,
      "year": 2022
    },
    {
      "date": "2023-01",
      "price": 93.85,
      "year": 2023
    },
    {
      "date": "2023-02",
      "price": 89.29,
      "year": 2023
    },
    {
      "date": "2023-03",
      "price": 93.61,
      "year": 2023
    },
    {
      "date": "2023-04",
      "price": 93.93,
      "year": 2023
    },
    {
      "date": "2023-05",
      "price": 91.1,
      "year": 2023
    },
    {
      "date": "2023-06",
      "price": 91.3,
      "year": 2023
    },
    {
      "date": "2023-07",
      "price": 88.97,
      "year": 2023
    },
    {
      "date": "2023-08",
      "price": 86.18,
      "year": 2023
    },
    {
      "date": "2023-09",
      "price": 79.33,
      "year": 2023
    },
    {
      "date": "2023-10",
      "price": 74.99,
      "year": 2023
    },
    {
      "date": "2023-11",
      "price": 82.43,
      "year": 2023
    },
    {
      "date": "2023-12",
      "price": 89.59,
      "year": 2023
    },
    {
      "date": "2024-01",
      "price": 87.58,
      "year": 2024
    },
    {
      "date": "2024-02",
      "price": 85.61,
      "year": 2024
    },
    {
      "date": "2024-03",
      "price": 86.28,
      "year": 2024
    },
    {
      "date": "2024-04",
      "price": 80.71,
      "year": 2024
    },
    {
      "date": "2024-05",
      "price": 83.04,
      "year": 2024
    },
    {
      "date": "2024-06",
      "price": 84.55,
      "year": 2024
    },
    {
      "date": "2024-07",
      "price": 87.62,
      "year": 2024
    },
    {
      "date": "2024-08",
      "price": 89.47,
      "year": 2024
    },
    {
      "date": "2024-09",
      "price": 91.26,
      "year": 2024
    },
    {
      "date": "2024-10",
      "price": 86.28,
      "year": 2024
    },
    {
      "date": "2024-11",
      "price": 87.99,
      "year": 2024
    },
    {
      "date": "2024-12",
      "price": 82.38,
      "year": 2024
    },
    {
      "date": "2025-01",
      "price": 82.79,
      "year": 2025
    },
    {
      "date": "2025-02",
      "price": 87.5,
      "year": 2025
    },
    {
      "date": "2025-03",
      "price": 86.45,
      "year": 2025
    },
    {
      "date": "2025-04",
      "price": 85.27,
      "year": 2025
    },
    {
      "date": "2025-05",
      "price": 82.53,
      "year": 2025
    },
    {
      "date": "2025-06",
      "price": 84.73,
      "year": 2025
    },
    {
      "date": "2025-07",
      "price": 83.77,
      "year": 2025
    },
    {
      "date": "2025-08",
      "price": 83.78,
      "year": 2025
    },
    {
      "date": "2025-09",
      "price": 86.79,
      "year": 2025
    },
    {
      "date": "2025-10",
      "price": 87.98,
      "year": 2025
    },
    {
      "date": "2025-11",
      "price": 88.22,
      "year": 2025
    },
    {
      "date": "2025-12",
      "price": 85.88,
      "year": 2025
    },
    {
      "date": "2026-01",
      "price": 85.85,
      "year": 2026
    },
    {
      "date": "2026-02",
      "price": 89.83,
      "year": 2026
    },
    {
      "date": "2026-03",
      "price": 86.03,
      "year": 2026
    },
    {
      "date": "2026-04",
      "price": 85.31,
      "year": 2026
    },
    {
      "date": "2026-05",
      "price": 86.08,
      "year": 2026
    }
  ],
  "DBC": [
    {
      "date": "2019-01",
      "price": 13.29,
      "year": 2019
    },
    {
      "date": "2019-02",
      "price": 13.67,
      "year": 2019
    },
    {
      "date": "2019-03",
      "price": 13.62,
      "year": 2019
    },
    {
      "date": "2019-04",
      "price": 13.78,
      "year": 2019
    },
    {
      "date": "2019-05",
      "price": 12.96,
      "year": 2019
    },
    {
      "date": "2019-06",
      "price": 13.47,
      "year": 2019
    },
    {
      "date": "2019-07",
      "price": 13.32,
      "year": 2019
    },
    {
      "date": "2019-08",
      "price": 12.7,
      "year": 2019
    },
    {
      "date": "2019-09",
      "price": 12.88,
      "year": 2019
    },
    {
      "date": "2019-10",
      "price": 13.13,
      "year": 2019
    },
    {
      "date": "2019-11",
      "price": 13.11,
      "year": 2019
    },
    {
      "date": "2019-12",
      "price": 13.88,
      "year": 2019
    },
    {
      "date": "2020-01",
      "price": 12.69,
      "year": 2020
    },
    {
      "date": "2020-02",
      "price": 11.84,
      "year": 2020
    },
    {
      "date": "2020-03",
      "price": 9.79,
      "year": 2020
    },
    {
      "date": "2020-04",
      "price": 9.48,
      "year": 2020
    },
    {
      "date": "2020-05",
      "price": 10.25,
      "year": 2020
    },
    {
      "date": "2020-06",
      "price": 10.71,
      "year": 2020
    },
    {
      "date": "2020-07",
      "price": 11.26,
      "year": 2020
    },
    {
      "date": "2020-08",
      "price": 11.78,
      "year": 2020
    },
    {
      "date": "2020-09",
      "price": 11.36,
      "year": 2020
    },
    {
      "date": "2020-10",
      "price": 11.01,
      "year": 2020
    },
    {
      "date": "2020-11",
      "price": 12.13,
      "year": 2020
    },
    {
      "date": "2020-12",
      "price": 12.79,
      "year": 2020
    },
    {
      "date": "2021-01",
      "price": 13.22,
      "year": 2021
    },
    {
      "date": "2021-02",
      "price": 14.56,
      "year": 2021
    },
    {
      "date": "2021-03",
      "price": 14.45,
      "year": 2021
    },
    {
      "date": "2021-04",
      "price": 15.58,
      "year": 2021
    },
    {
      "date": "2021-05",
      "price": 16.18,
      "year": 2021
    },
    {
      "date": "2021-06",
      "price": 16.75,
      "year": 2021
    },
    {
      "date": "2021-07",
      "price": 16.97,
      "year": 2021
    },
    {
      "date": "2021-08",
      "price": 16.69,
      "year": 2021
    },
    {
      "date": "2021-09",
      "price": 17.56,
      "year": 2021
    },
    {
      "date": "2021-10",
      "price": 18.58,
      "year": 2021
    },
    {
      "date": "2021-11",
      "price": 16.95,
      "year": 2021
    },
    {
      "date": "2021-12",
      "price": 18.08,
      "year": 2021
    },
    {
      "date": "2022-01",
      "price": 19.51,
      "year": 2022
    },
    {
      "date": "2022-02",
      "price": 20.77,
      "year": 2022
    },
    {
      "date": "2022-03",
      "price": 22.68,
      "year": 2022
    },
    {
      "date": "2022-04",
      "price": 23.95,
      "year": 2022
    },
    {
      "date": "2022-05",
      "price": 25.06,
      "year": 2022
    },
    {
      "date": "2022-06",
      "price": 23.18,
      "year": 2022
    },
    {
      "date": "2022-07",
      "price": 22.72,
      "year": 2022
    },
    {
      "date": "2022-08",
      "price": 22.38,
      "year": 2022
    },
    {
      "date": "2022-09",
      "price": 20.81,
      "year": 2022
    },
    {
      "date": "2022-10",
      "price": 21.86,
      "year": 2022
    },
    {
      "date": "2022-11",
      "price": 22.18,
      "year": 2022
    },
    {
      "date": "2022-12",
      "price": 21.58,
      "year": 2022
    },
    {
      "date": "2023-01",
      "price": 21.77,
      "year": 2023
    },
    {
      "date": "2023-02",
      "price": 20.8,
      "year": 2023
    },
    {
      "date": "2023-03",
      "price": 20.78,
      "year": 2023
    },
    {
      "date": "2023-04",
      "price": 20.62,
      "year": 2023
    },
    {
      "date": "2023-05",
      "price": 19.3,
      "year": 2023
    },
    {
      "date": "2023-06",
      "price": 19.87,
      "year": 2023
    },
    {
      "date": "2023-07",
      "price": 21.6,
      "year": 2023
    },
    {
      "date": "2023-08",
      "price": 21.53,
      "year": 2023
    },
    {
      "date": "2023-09",
      "price": 21.85,
      "year": 2023
    },
    {
      "date": "2023-10",
      "price": 21.46,
      "year": 2023
    },
    {
      "date": "2023-11",
      "price": 20.93,
      "year": 2023
    },
    {
      "date": "2023-12",
      "price": 20.24,
      "year": 2023
    },
    {
      "date": "2024-01",
      "price": 20.51,
      "year": 2024
    },
    {
      "date": "2024-02",
      "price": 20.2,
      "year": 2024
    },
    {
      "date": "2024-03",
      "price": 21.1,
      "year": 2024
    },
    {
      "date": "2024-04",
      "price": 21.44,
      "year": 2024
    },
    {
      "date": "2024-05",
      "price": 21.37,
      "year": 2024
    },
    {
      "date": "2024-06",
      "price": 21.33,
      "year": 2024
    },
    {
      "date": "2024-07",
      "price": 20.74,
      "year": 2024
    },
    {
      "date": "2024-08",
      "price": 20.31,
      "year": 2024
    },
    {
      "date": "2024-09",
      "price": 20.45,
      "year": 2024
    },
    {
      "date": "2024-10",
      "price": 20.75,
      "year": 2024
    },
    {
      "date": "2024-11",
      "price": 20.33,
      "year": 2024
    },
    {
      "date": "2024-12",
      "price": 20.68,
      "year": 2024
    },
    {
      "date": "2025-01",
      "price": 21.25,
      "year": 2025
    },
    {
      "date": "2025-02",
      "price": 21.28,
      "year": 2025
    },
    {
      "date": "2025-03",
      "price": 21.77,
      "year": 2025
    },
    {
      "date": "2025-04",
      "price": 19.9,
      "year": 2025
    },
    {
      "date": "2025-05",
      "price": 20.2,
      "year": 2025
    },
    {
      "date": "2025-06",
      "price": 21.1,
      "year": 2025
    },
    {
      "date": "2025-07",
      "price": 21.72,
      "year": 2025
    },
    {
      "date": "2025-08",
      "price": 21.49,
      "year": 2025
    },
    {
      "date": "2025-09",
      "price": 21.8,
      "year": 2025
    },
    {
      "date": "2025-10",
      "price": 22.14,
      "year": 2025
    },
    {
      "date": "2025-11",
      "price": 22.31,
      "year": 2025
    },
    {
      "date": "2025-12",
      "price": 22.36,
      "year": 2025
    },
    {
      "date": "2026-01",
      "price": 24.43,
      "year": 2026
    },
    {
      "date": "2026-02",
      "price": 25.1,
      "year": 2026
    },
    {
      "date": "2026-03",
      "price": 28.95,
      "year": 2026
    },
    {
      "date": "2026-04",
      "price": 31.1,
      "year": 2026
    },
    {
      "date": "2026-05",
      "price": 30.21,
      "year": 2026
    }
  ],
  "VNQ": [
    {
      "date": "2019-01",
      "price": 63.48,
      "year": 2019
    },
    {
      "date": "2019-02",
      "price": 63.93,
      "year": 2019
    },
    {
      "date": "2019-03",
      "price": 66.62,
      "year": 2019
    },
    {
      "date": "2019-04",
      "price": 66.51,
      "year": 2019
    },
    {
      "date": "2019-05",
      "price": 66.61,
      "year": 2019
    },
    {
      "date": "2019-06",
      "price": 67.64,
      "year": 2019
    },
    {
      "date": "2019-07",
      "price": 68.79,
      "year": 2019
    },
    {
      "date": "2019-08",
      "price": 71.37,
      "year": 2019
    },
    {
      "date": "2019-09",
      "price": 72.75,
      "year": 2019
    },
    {
      "date": "2019-10",
      "price": 73.57,
      "year": 2019
    },
    {
      "date": "2019-11",
      "price": 72.61,
      "year": 2019
    },
    {
      "date": "2019-12",
      "price": 73.17,
      "year": 2019
    },
    {
      "date": "2020-01",
      "price": 74.06,
      "year": 2020
    },
    {
      "date": "2020-02",
      "price": 68.86,
      "year": 2020
    },
    {
      "date": "2020-03",
      "price": 55.51,
      "year": 2020
    },
    {
      "date": "2020-04",
      "price": 60.48,
      "year": 2020
    },
    {
      "date": "2020-05",
      "price": 61.53,
      "year": 2020
    },
    {
      "date": "2020-06",
      "price": 63.02,
      "year": 2020
    },
    {
      "date": "2020-07",
      "price": 65.32,
      "year": 2020
    },
    {
      "date": "2020-08",
      "price": 65.61,
      "year": 2020
    },
    {
      "date": "2020-09",
      "price": 63.86,
      "year": 2020
    },
    {
      "date": "2020-10",
      "price": 61.94,
      "year": 2020
    },
    {
      "date": "2020-11",
      "price": 67.93,
      "year": 2020
    },
    {
      "date": "2020-12",
      "price": 69.79,
      "year": 2020
    },
    {
      "date": "2021-01",
      "price": 69.82,
      "year": 2021
    },
    {
      "date": "2021-02",
      "price": 72.21,
      "year": 2021
    },
    {
      "date": "2021-03",
      "price": 75.93,
      "year": 2021
    },
    {
      "date": "2021-04",
      "price": 81.9,
      "year": 2021
    },
    {
      "date": "2021-05",
      "price": 82.56,
      "year": 2021
    },
    {
      "date": "2021-06",
      "price": 84.73,
      "year": 2021
    },
    {
      "date": "2021-07",
      "price": 88.48,
      "year": 2021
    },
    {
      "date": "2021-08",
      "price": 90.39,
      "year": 2021
    },
    {
      "date": "2021-09",
      "price": 85.25,
      "year": 2021
    },
    {
      "date": "2021-10",
      "price": 91.33,
      "year": 2021
    },
    {
      "date": "2021-11",
      "price": 89.41,
      "year": 2021
    },
    {
      "date": "2021-12",
      "price": 98.08,
      "year": 2021
    },
    {
      "date": "2022-01",
      "price": 89.82,
      "year": 2022
    },
    {
      "date": "2022-02",
      "price": 86.7,
      "year": 2022
    },
    {
      "date": "2022-03",
      "price": 92.13,
      "year": 2022
    },
    {
      "date": "2022-04",
      "price": 88.36,
      "year": 2022
    },
    {
      "date": "2022-05",
      "price": 84.22,
      "year": 2022
    },
    {
      "date": "2022-06",
      "price": 77.95,
      "year": 2022
    },
    {
      "date": "2022-07",
      "price": 84.66,
      "year": 2022
    },
    {
      "date": "2022-08",
      "price": 79.57,
      "year": 2022
    },
    {
      "date": "2022-09",
      "price": 69.33,
      "year": 2022
    },
    {
      "date": "2022-10",
      "price": 71.76,
      "year": 2022
    },
    {
      "date": "2022-11",
      "price": 76.17,
      "year": 2022
    },
    {
      "date": "2022-12",
      "price": 72.34,
      "year": 2022
    },
    {
      "date": "2023-01",
      "price": 79.86,
      "year": 2023
    },
    {
      "date": "2023-02",
      "price": 75.18,
      "year": 2023
    },
    {
      "date": "2023-03",
      "price": 73.56,
      "year": 2023
    },
    {
      "date": "2023-04",
      "price": 73.79,
      "year": 2023
    },
    {
      "date": "2023-05",
      "price": 70.86,
      "year": 2023
    },
    {
      "date": "2023-06",
      "price": 74.85,
      "year": 2023
    },
    {
      "date": "2023-07",
      "price": 76.38,
      "year": 2023
    },
    {
      "date": "2023-08",
      "price": 73.8,
      "year": 2023
    },
    {
      "date": "2023-09",
      "price": 68.44,
      "year": 2023
    },
    {
      "date": "2023-10",
      "price": 65.96,
      "year": 2023
    },
    {
      "date": "2023-11",
      "price": 73.93,
      "year": 2023
    },
    {
      "date": "2023-12",
      "price": 80.91,
      "year": 2023
    },
    {
      "date": "2024-01",
      "price": 76.82,
      "year": 2024
    },
    {
      "date": "2024-02",
      "price": 78.34,
      "year": 2024
    },
    {
      "date": "2024-03",
      "price": 79.86,
      "year": 2024
    },
    {
      "date": "2024-04",
      "price": 73.52,
      "year": 2024
    },
    {
      "date": "2024-05",
      "price": 76.87,
      "year": 2024
    },
    {
      "date": "2024-06",
      "price": 78.31,
      "year": 2024
    },
    {
      "date": "2024-07",
      "price": 84.53,
      "year": 2024
    },
    {
      "date": "2024-08",
      "price": 88.94,
      "year": 2024
    },
    {
      "date": "2024-09",
      "price": 91.85,
      "year": 2024
    },
    {
      "date": "2024-10",
      "price": 88.77,
      "year": 2024
    },
    {
      "date": "2024-11",
      "price": 92.55,
      "year": 2024
    },
    {
      "date": "2024-12",
      "price": 84.8,
      "year": 2024
    },
    {
      "date": "2025-01",
      "price": 86.2,
      "year": 2025
    },
    {
      "date": "2025-02",
      "price": 89.39,
      "year": 2025
    },
    {
      "date": "2025-03",
      "price": 87.08,
      "year": 2025
    },
    {
      "date": "2025-04",
      "price": 84.95,
      "year": 2025
    },
    {
      "date": "2025-05",
      "price": 85.9,
      "year": 2025
    },
    {
      "date": "2025-06",
      "price": 86.5,
      "year": 2025
    },
    {
      "date": "2025-07",
      "price": 86.57,
      "year": 2025
    },
    {
      "date": "2025-08",
      "price": 89.58,
      "year": 2025
    },
    {
      "date": "2025-09",
      "price": 89.64,
      "year": 2025
    },
    {
      "date": "2025-10",
      "price": 87.44,
      "year": 2025
    },
    {
      "date": "2025-11",
      "price": 89.56,
      "year": 2025
    },
    {
      "date": "2025-12",
      "price": 87.55,
      "year": 2025
    },
    {
      "date": "2026-01",
      "price": 89.84,
      "year": 2026
    },
    {
      "date": "2026-02",
      "price": 94.68,
      "year": 2026
    },
    {
      "date": "2026-03",
      "price": 88.7,
      "year": 2026
    },
    {
      "date": "2026-04",
      "price": 96.33,
      "year": 2026
    },
    {
      "date": "2026-05",
      "price": 97.09,
      "year": 2026
    }
  ],
  "EWJ": [
    {
      "date": "2019-01",
      "price": 46.55,
      "year": 2019
    },
    {
      "date": "2019-02",
      "price": 46.62,
      "year": 2019
    },
    {
      "date": "2019-03",
      "price": 46.93,
      "year": 2019
    },
    {
      "date": "2019-04",
      "price": 47.53,
      "year": 2019
    },
    {
      "date": "2019-05",
      "price": 45.22,
      "year": 2019
    },
    {
      "date": "2019-06",
      "price": 47.24,
      "year": 2019
    },
    {
      "date": "2019-07",
      "price": 47.04,
      "year": 2019
    },
    {
      "date": "2019-08",
      "price": 46.67,
      "year": 2019
    },
    {
      "date": "2019-09",
      "price": 49.11,
      "year": 2019
    },
    {
      "date": "2019-10",
      "price": 50.79,
      "year": 2019
    },
    {
      "date": "2019-11",
      "price": 51.44,
      "year": 2019
    },
    {
      "date": "2019-12",
      "price": 51.88,
      "year": 2019
    },
    {
      "date": "2020-01",
      "price": 50.58,
      "year": 2020
    },
    {
      "date": "2020-02",
      "price": 46.38,
      "year": 2020
    },
    {
      "date": "2020-03",
      "price": 43.26,
      "year": 2020
    },
    {
      "date": "2020-04",
      "price": 45.33,
      "year": 2020
    },
    {
      "date": "2020-05",
      "price": 48.53,
      "year": 2020
    },
    {
      "date": "2020-06",
      "price": 48.48,
      "year": 2020
    },
    {
      "date": "2020-07",
      "price": 47.96,
      "year": 2020
    },
    {
      "date": "2020-08",
      "price": 51.22,
      "year": 2020
    },
    {
      "date": "2020-09",
      "price": 52.14,
      "year": 2020
    },
    {
      "date": "2020-10",
      "price": 51.41,
      "year": 2020
    },
    {
      "date": "2020-11",
      "price": 56.84,
      "year": 2020
    },
    {
      "date": "2020-12",
      "price": 59.87,
      "year": 2020
    },
    {
      "date": "2021-01",
      "price": 59.37,
      "year": 2021
    },
    {
      "date": "2021-02",
      "price": 60.46,
      "year": 2021
    },
    {
      "date": "2021-03",
      "price": 60.72,
      "year": 2021
    },
    {
      "date": "2021-04",
      "price": 59.75,
      "year": 2021
    },
    {
      "date": "2021-05",
      "price": 60.78,
      "year": 2021
    },
    {
      "date": "2021-06",
      "price": 60.3,
      "year": 2021
    },
    {
      "date": "2021-07",
      "price": 59.91,
      "year": 2021
    },
    {
      "date": "2021-08",
      "price": 61.07,
      "year": 2021
    },
    {
      "date": "2021-09",
      "price": 62.72,
      "year": 2021
    },
    {
      "date": "2021-10",
      "price": 61.07,
      "year": 2021
    },
    {
      "date": "2021-11",
      "price": 59.22,
      "year": 2021
    },
    {
      "date": "2021-12",
      "price": 60.57,
      "year": 2021
    },
    {
      "date": "2022-01",
      "price": 57.96,
      "year": 2022
    },
    {
      "date": "2022-02",
      "price": 56.93,
      "year": 2022
    },
    {
      "date": "2022-03",
      "price": 55.73,
      "year": 2022
    },
    {
      "date": "2022-04",
      "price": 51.21,
      "year": 2022
    },
    {
      "date": "2022-05",
      "price": 52.1,
      "year": 2022
    },
    {
      "date": "2022-06",
      "price": 48.25,
      "year": 2022
    },
    {
      "date": "2022-07",
      "price": 51.28,
      "year": 2022
    },
    {
      "date": "2022-08",
      "price": 48.94,
      "year": 2022
    },
    {
      "date": "2022-09",
      "price": 44.61,
      "year": 2022
    },
    {
      "date": "2022-10",
      "price": 45.66,
      "year": 2022
    },
    {
      "date": "2022-11",
      "price": 50.96,
      "year": 2022
    },
    {
      "date": "2022-12",
      "price": 49.83,
      "year": 2022
    },
    {
      "date": "2023-01",
      "price": 53.7,
      "year": 2023
    },
    {
      "date": "2023-02",
      "price": 51.2,
      "year": 2023
    },
    {
      "date": "2023-03",
      "price": 53.72,
      "year": 2023
    },
    {
      "date": "2023-04",
      "price": 53.86,
      "year": 2023
    },
    {
      "date": "2023-05",
      "price": 54.32,
      "year": 2023
    },
    {
      "date": "2023-06",
      "price": 57.05,
      "year": 2023
    },
    {
      "date": "2023-07",
      "price": 58.45,
      "year": 2023
    },
    {
      "date": "2023-08",
      "price": 56.81,
      "year": 2023
    },
    {
      "date": "2023-09",
      "price": 55.57,
      "year": 2023
    },
    {
      "date": "2023-10",
      "price": 54.34,
      "year": 2023
    },
    {
      "date": "2023-11",
      "price": 57.7,
      "year": 2023
    },
    {
      "date": "2023-12",
      "price": 59.94,
      "year": 2023
    },
    {
      "date": "2024-01",
      "price": 61.88,
      "year": 2024
    },
    {
      "date": "2024-02",
      "price": 64.6,
      "year": 2024
    },
    {
      "date": "2024-03",
      "price": 66.68,
      "year": 2024
    },
    {
      "date": "2024-04",
      "price": 62.87,
      "year": 2024
    },
    {
      "date": "2024-05",
      "price": 64.46,
      "year": 2024
    },
    {
      "date": "2024-06",
      "price": 64.25,
      "year": 2024
    },
    {
      "date": "2024-07",
      "price": 66.82,
      "year": 2024
    },
    {
      "date": "2024-08",
      "price": 67.76,
      "year": 2024
    },
    {
      "date": "2024-09",
      "price": 67.35,
      "year": 2024
    },
    {
      "date": "2024-10",
      "price": 64.09,
      "year": 2024
    },
    {
      "date": "2024-11",
      "price": 65.61,
      "year": 2024
    },
    {
      "date": "2024-12",
      "price": 64.16,
      "year": 2024
    },
    {
      "date": "2025-01",
      "price": 65.32,
      "year": 2025
    },
    {
      "date": "2025-02",
      "price": 65.47,
      "year": 2025
    },
    {
      "date": "2025-03",
      "price": 65.56,
      "year": 2025
    },
    {
      "date": "2025-04",
      "price": 68.3,
      "year": 2025
    },
    {
      "date": "2025-05",
      "price": 70.87,
      "year": 2025
    },
    {
      "date": "2025-06",
      "price": 72.27,
      "year": 2025
    },
    {
      "date": "2025-07",
      "price": 70.96,
      "year": 2025
    },
    {
      "date": "2025-08",
      "price": 75.46,
      "year": 2025
    },
    {
      "date": "2025-09",
      "price": 77.32,
      "year": 2025
    },
    {
      "date": "2025-10",
      "price": 80.44,
      "year": 2025
    },
    {
      "date": "2025-11",
      "price": 80.02,
      "year": 2025
    },
    {
      "date": "2025-12",
      "price": 80.74,
      "year": 2025
    },
    {
      "date": "2026-01",
      "price": 85.72,
      "year": 2026
    },
    {
      "date": "2026-02",
      "price": 92.37,
      "year": 2026
    },
    {
      "date": "2026-03",
      "price": 84.44,
      "year": 2026
    },
    {
      "date": "2026-04",
      "price": 89.1,
      "year": 2026
    },
    {
      "date": "2026-05",
      "price": 91.68,
      "year": 2026
    }
  ]
};
var CORR_MATRIX = [
  [
    1,
    0.814,
    0.648,
    0.43,
    0.55,
    0.114,
    -0.135,
    0.318,
    0.758,
    0.74
  ],
  [
    0.814,
    1,
    0.658,
    0.48,
    0.611,
    0.203,
    -0.087,
    0.281,
    0.679,
    0.769
  ],
  [
    0.648,
    0.658,
    1,
    0.344,
    0.486,
    0.116,
    -0.122,
    0.192,
    0.57,
    0.57
  ],
  [
    0.43,
    0.48,
    0.344,
    1,
    0.653,
    0.134,
    -0.03,
    0.184,
    0.281,
    0.413
  ],
  [
    0.55,
    0.611,
    0.486,
    0.653,
    1,
    0.178,
    -0.102,
    0.286,
    0.457,
    0.531
  ],
  [
    0.114,
    0.203,
    0.116,
    0.134,
    0.178,
    1,
    0.23,
    0.285,
    0.153,
    0.218
  ],
  [
    -0.135,
    -0.087,
    -0.122,
    -0.03,
    -0.102,
    0.23,
    1,
    -0.162,
    0.02,
    -0.046
  ],
  [
    0.318,
    0.281,
    0.192,
    0.184,
    0.286,
    0.285,
    -0.162,
    1,
    0.238,
    0.25
  ],
  [
    0.758,
    0.679,
    0.57,
    0.281,
    0.457,
    0.153,
    0.02,
    0.238,
    1,
    0.579
  ],
  [
    0.74,
    0.769,
    0.57,
    0.413,
    0.531,
    0.218,
    -0.046,
    0.25,
    0.579,
    1
  ]
];
var corrColor2 = (v) => {
  if (v >= 0.9)
    return "#dc2626";
  if (v >= 0.7)
    return "#f97316";
  if (v >= 0.5)
    return "#eab308";
  if (v >= 0.3)
    return "#84cc16";
  if (v >= 0.1)
    return "#22c55e";
  if (v >= -0.05)
    return "#06b6d4";
  return "#3b82f6";
};
var corrBg2 = (v) => {
  if (v >= 0.9)
    return "rgba(220,38,38,0.25)";
  if (v >= 0.7)
    return "rgba(249,115,22,0.2)";
  if (v >= 0.5)
    return "rgba(234,179,8,0.18)";
  if (v >= 0.3)
    return "rgba(132,204,18,0.15)";
  if (v >= 0.1)
    return "rgba(34,197,94,0.12)";
  if (v >= -0.05)
    return "rgba(6,182,212,0.12)";
  return "rgba(59,130,246,0.18)";
};
var getPairExplanation = (a, b, corr) => {
  const pair = [a.ticker, b.ticker].sort().join("-");
  const custom = {
    "EZU-SPY": "Strong linkage (0.72) due to interconnected Western economies, shared global banking systems, and synchronized broad risk-on/off capital flows. However, ECB and Fed policy divergences prevent a perfect correlation.",
    "INDA-SPY": "Moderate linkage (0.58). India's growth is largely domestic and demographic-driven, making it somewhat insulated from US economic shocks, though global liquidity still impacts it.",
    "KWEB-SPY": "Low correlation (0.42). Chinese internet stocks are dictated by Beijing's regulatory environment and PBOC stimulus, often moving independently or inversely to US tech.",
    "EWH-SPY": "Low/Moderate correlation (0.45). Hong Kong pegs its currency to the USD (importing Fed rates), but its economy is deeply tied to mainland China's cycle.",
    "GLD-SPY": "Near-zero correlation (0.02). Gold is a non-yielding real asset. It responds to real interest rates and systemic fear, acting as a structural diversifier to corporate earnings.",
    "SPY-TLT": "Negative correlation (-0.15). The classic 60/40 portfolio anchor. When growth shocks hit equities (SPY), capital flees to the safety of US Treasuries (TLT), driving their prices up.",
    "DBC-SPY": "Low correlation (0.30). Commodities rely on physical supply/demand and inflation. While late-cycle economic booms lift both, stagflation hurts SPY but boosts DBC.",
    "SPY-VNQ": "Strong correlation (0.68). US Real Estate investment trusts (VNQ) are equities. They rely on US economic health and consumer spending, though their heavy debt makes them more rate-sensitive than SPY.",
    "EWJ-SPY": "Moderate/Strong correlation (0.62). Japan is a major US trade partner. However, the BOJ's historical zero-interest-rate policy and the Yen carry trade introduce unique divergences.",
    "GLD-TLT": "Low positive (0.18). Both are safe havens that benefit from falling real interest rates, but gold also acts as an inflation hedge, whereas inflation destroys Treasury bond (TLT) returns.",
    "DBC-TLT": "Negative correlation (-0.12). The inflation trade. Rising commodities (DBC) signal inflation, forcing the Fed to raise rates, which crushes long-duration bond prices (TLT).",
    "KWEB-TLT": "Near zero (-0.05). Chinese tech is completely disconnected from US long-term treasury yields, driven instead by domestic credit and regulatory cycles.",
    "INDA-KWEB": "Low correlation (0.40). Despite both being 'Emerging Markets', India benefits from the 'China+1' supply chain relocation, meaning they often experience divergent capital flows.",
    "EWJ-KWEB": "Low correlation (0.38). Japan and China have very different monetary policies and economic structures, making them excellent diversifiers within Asia.",
    "EWH-KWEB": "Moderate correlation (0.52). Hong Kong equities are heavily influenced by mainland China's macro environment, hence the strongest correlation KWEB has with any other regional ETF.",
    "DBC-GLD": "Moderate correlation (0.38). Both are priced in USD and function as real assets/inflation hedges, but DBC is driven by industrial cycles (oil/copper) while GLD is driven by monetary factors.",
    "EZU-VNQ": "Moderate correlation (0.55). Global liquidity lifts all boats, but European equities and US real estate have entirely different fundamental drivers."
  };
  if (custom[pair])
    return custom[pair];
  const aType = a.corr_group;
  const bType = b.corr_group;
  let relation = "";
  if (aType.includes("Equity") && bType.includes("Equity")) {
    relation = `Both are equities, meaning they share baseline global risk sentiment. However, their regional differences (${a.region} vs ${b.region}) and distinct central bank cycles limit their correlation.`;
  } else if ((aType.includes("Fixed Income") || bType.includes("Fixed Income")) && (aType.includes("Equity") || bType.includes("Equity"))) {
    relation = `Equities and Fixed Income typically exhibit low or negative correlation. Bonds act as a shock absorber when equity markets decline.`;
  } else if (aType.includes("Commodities") || bType.includes("Commodities") || a.ticker === "GLD" || b.ticker === "GLD") {
    relation = `Commodities/Gold are driven by physical supply/demand and inflation expectations, whereas financial assets are driven by future cash flows and interest rates.`;
  } else {
    relation = `Their distinct asset classifications (${aType} vs ${bType}) inherently reduce their linkage.`;
  }
  if (corr >= 0.6)
    return `Strong correlation (${corr.toFixed(2)}). ${relation} The high linkage indicates that global macroeconomic factors overwhelm their regional differences.`;
  if (corr >= 0.3)
    return `Moderate correlation (${corr.toFixed(2)}). ${relation} They provide reasonable diversification benefits while still sharing some broad market beta.`;
  if (corr >= 0)
    return `Weak correlation (${corr.toFixed(2)}). ${relation} This pair is highly effective for portfolio diversification as they react to completely different market catalysts.`;
  return `Negative correlation (${corr.toFixed(2)}). ${relation} This inverse relationship provides powerful downside protection during structural market shifts.`;
};
function generatePriceData(etf) {
  return YAHOO_MONTHLY_DATA[etf.ticker] || [];
}
var DEFAULT_CORR_MATRIX = CORR_MATRIX;
var LOCAL_MONTHLY_URL = "./yahoo_etf_monthly.json";
var LOCAL_CORR_URL = "./yahoo_etf_corr.json";
var LOCAL_OHLC_URL = "./yahoo_etf_ohlc.json";
var RANGE_OPTIONS = [
  { id: "1M", label: "1M", days: 31 },
  { id: "3M", label: "3M", days: 92 },
  { id: "3Y", label: "3Y", days: 1096 },
  { id: "ALL", label: "ALL", days: null }
];
var filterOhlcByRange = (rows, rangeId) => {
  if (!rows?.length)
    return [];
  const option = RANGE_OPTIONS.find((r) => r.id === rangeId) || RANGE_OPTIONS[RANGE_OPTIONS.length - 1];
  if (!option.days)
    return rows;
  const latest = new Date(`${rows[rows.length - 1].date}T00:00:00Z`);
  const startTs = latest.getTime() - option.days * 24 * 60 * 60 * 1e3;
  return rows.filter((r) => new Date(`${r.date}T00:00:00Z`).getTime() >= startTs);
};
var calcMA = (rows, period) => {
  const out = new Array(rows.length).fill(null);
  if (rows.length < period)
    return out;
  let rolling = 0;
  for (let i = 0; i < rows.length; i++) {
    rolling += rows[i].close;
    if (i >= period)
      rolling -= rows[i - period].close;
    if (i >= period - 1)
      out[i] = rolling / period;
  }
  return out;
};
var calcRSI = (rows, period = 14) => {
  const out = new Array(rows.length).fill(null);
  if (rows.length <= period)
    return out;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = rows[i].close - rows[i - 1].close;
    if (diff >= 0)
      gainSum += diff;
    else
      lossSum += -diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < rows.length; i++) {
    const diff = rows[i].close - rows[i - 1].close;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
};
var CandlestickChart = ({ data }) => {
  const [hoverIdx, setHoverIdx] = useState3(null);
  if (!data?.length) {
    return /* @__PURE__ */ React3.createElement("div", {
      style: { height: "380px", display: "grid", placeItems: "center", color: "#4a6a85", fontFamily: "'Syne Mono',monospace" }
    }, "NO OHLC DATA");
  }
  const ma5 = useMemo3(() => calcMA(data, 5), [data]);
  const ma20 = useMemo3(() => calcMA(data, 20), [data]);
  const rsi14 = useMemo3(() => calcRSI(data, 14), [data]);
  const W = 1100;
  const H = 452;
  const left = 56;
  const right = 12;
  const priceTop = 12;
  const priceBottom = 236;
  const volumeTop = 252;
  const volumeBottom = 314;
  const rsiTop = 332;
  const rsiBottom = 412;
  const axisBottom = 442;
  const highs = data.map((d) => d.high);
  const lows = data.map((d) => d.low);
  const maxPrice = Math.max(...highs);
  const minPrice = Math.min(...lows);
  const span = Math.max(1e-4, maxPrice - minPrice);
  const yPrice = (v) => priceTop + (maxPrice - v) / span * (priceBottom - priceTop);
  const maxVol = Math.max(...data.map((d) => d.volume), 1);
  const yVol = (v) => volumeBottom - v / maxVol * (volumeBottom - volumeTop);
  const yRsi = (v) => rsiTop + (100 - v) / 100 * (rsiBottom - rsiTop);
  const innerW = W - left - right;
  const step = innerW / Math.max(data.length, 1);
  const bodyW = Math.max(1, Math.min(10, step * 0.62));
  const labelStep = Math.max(1, Math.floor(data.length / 6));
  const xOf = (idx) => left + idx * step + step / 2;
  const maPath = (values) => values.map((v, i) => v == null ? null : `${i === 0 || values[i - 1] == null ? "M" : "L"} ${xOf(i)} ${yPrice(v)}`).filter(Boolean).join(" ");
  const fmtVol = (v) => {
    if (v >= 1e9)
      return `${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6)
      return `${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e3)
      return `${(v / 1e3).toFixed(1)}K`;
    return `${v}`;
  };
  const hovered = hoverIdx != null ? data[hoverIdx] : null;
  const hoveredMa5 = hoverIdx != null ? ma5[hoverIdx] : null;
  const hoveredMa20 = hoverIdx != null ? ma20[hoverIdx] : null;
  const hoveredRsi = hoverIdx != null ? rsi14[hoverIdx] : null;
  return /* @__PURE__ */ React3.createElement("div", null, /* @__PURE__ */ React3.createElement("svg", {
    width: "100%",
    height: H,
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": "OHLC candlestick chart",
    onMouseMove: (evt) => {
      const rect = evt.currentTarget.getBoundingClientRect();
      const x = (evt.clientX - rect.left) / rect.width * W;
      const raw = Math.round((x - left - step / 2) / step);
      const idx = Math.max(0, Math.min(data.length - 1, raw));
      setHoverIdx(idx);
    },
    onMouseLeave: () => setHoverIdx(null)
  }, [0, 1, 2, 3, 4].map((i) => {
    const py = priceTop + i / 4 * (priceBottom - priceTop);
    const p = (maxPrice - i / 4 * span).toFixed(2);
    return /* @__PURE__ */ React3.createElement("g", {
      key: `pgrid-${i}`
    }, /* @__PURE__ */ React3.createElement("line", {
      x1: left,
      y1: py,
      x2: W - right,
      y2: py,
      stroke: "#0a1a2e",
      strokeDasharray: "2 5"
    }), /* @__PURE__ */ React3.createElement("text", {
      x: left - 6,
      y: py + 3,
      textAnchor: "end",
      fill: "#1e3a55",
      fontSize: "9",
      fontFamily: "Syne Mono"
    }, "$", p));
  }), [0, 1].map((i) => {
    const py = volumeTop + i / 1 * (volumeBottom - volumeTop);
    const p = i === 0 ? fmtVol(maxVol) : "0";
    return /* @__PURE__ */ React3.createElement("g", {
      key: `vgrid-${i}`
    }, /* @__PURE__ */ React3.createElement("line", {
      x1: left,
      y1: py,
      x2: W - right,
      y2: py,
      stroke: "#0a1a2e"
    }), /* @__PURE__ */ React3.createElement("text", {
      x: left - 6,
      y: py + 3,
      textAnchor: "end",
      fill: "#1e3a55",
      fontSize: "9",
      fontFamily: "Syne Mono"
    }, p));
  }), [70, 50, 30].map((level) => {
    const py = yRsi(level);
    return /* @__PURE__ */ React3.createElement("g", {
      key: `rsi-${level}`
    }, /* @__PURE__ */ React3.createElement("line", {
      x1: left,
      y1: py,
      x2: W - right,
      y2: py,
      stroke: level === 50 ? "#0a1a2e" : "#1f2937",
      strokeDasharray: "3 4"
    }), /* @__PURE__ */ React3.createElement("text", {
      x: left - 6,
      y: py + 3,
      textAnchor: "end",
      fill: level === 50 ? "#1e3a55" : "#4b5563",
      fontSize: "9",
      fontFamily: "Syne Mono"
    }, level));
  }), /* @__PURE__ */ React3.createElement("path", {
    d: maPath(ma5),
    fill: "none",
    stroke: "#f59e0b",
    strokeWidth: 1.2
  }), /* @__PURE__ */ React3.createElement("path", {
    d: maPath(ma20),
    fill: "none",
    stroke: "#60a5fa",
    strokeWidth: 1.2
  }), /* @__PURE__ */ React3.createElement("path", {
    d: rsi14.map((v, i) => v == null ? null : `${i === 0 || rsi14[i - 1] == null ? "M" : "L"} ${xOf(i)} ${yRsi(v)}`).filter(Boolean).join(" "),
    fill: "none",
    stroke: "#a78bfa",
    strokeWidth: 1.4
  }), data.map((d, i) => {
    const x = xOf(i);
    const up = d.close >= d.open;
    const color = up ? "#22c55e" : "#ef4444";
    const yOpen = yPrice(d.open);
    const yClose = yPrice(d.close);
    const bodyTop = Math.min(yOpen, yClose);
    const bodyHeight = Math.max(1, Math.abs(yOpen - yClose));
    return /* @__PURE__ */ React3.createElement("g", {
      key: d.date
    }, /* @__PURE__ */ React3.createElement("line", {
      x1: x,
      x2: x,
      y1: yPrice(d.high),
      y2: yPrice(d.low),
      stroke: color,
      strokeWidth: 1
    }), /* @__PURE__ */ React3.createElement("rect", {
      x: x - bodyW / 2,
      y: bodyTop,
      width: bodyW,
      height: bodyHeight,
      fill: up ? `${color}AA` : color,
      stroke: color,
      strokeWidth: 1
    }), /* @__PURE__ */ React3.createElement("rect", {
      x: x - bodyW / 2,
      y: yVol(d.volume),
      width: bodyW,
      height: Math.max(1, volumeBottom - yVol(d.volume)),
      fill: up ? "#14532d" : "#7f1d1d",
      opacity: 0.8
    }));
  }), hovered && /* @__PURE__ */ React3.createElement("g", null, /* @__PURE__ */ React3.createElement("line", {
    x1: xOf(hoverIdx),
    x2: xOf(hoverIdx),
    y1: priceTop,
    y2: rsiBottom,
    stroke: "#38bdf8",
    strokeDasharray: "4 4"
  }), /* @__PURE__ */ React3.createElement("line", {
    x1: left,
    x2: W - right,
    y1: yPrice(hovered.close),
    y2: yPrice(hovered.close),
    stroke: "#1d4ed8",
    strokeDasharray: "4 4",
    opacity: 0.7
  }), hoveredRsi != null && /* @__PURE__ */ React3.createElement("line", {
    x1: left,
    x2: W - right,
    y1: yRsi(hoveredRsi),
    y2: yRsi(hoveredRsi),
    stroke: "#7c3aed",
    strokeDasharray: "4 4",
    opacity: 0.65
  })), data.map((d, i) => {
    if (i % labelStep !== 0 && i !== data.length - 1)
      return null;
    return /* @__PURE__ */ React3.createElement("text", {
      key: `x-${d.date}`,
      x: xOf(i),
      y: axisBottom,
      textAnchor: "middle",
      fill: "#1e3a55",
      fontSize: "9",
      fontFamily: "Syne Mono"
    }, d.date.slice(2));
  })), /* @__PURE__ */ React3.createElement("div", {
    style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginTop: "8px", fontFamily: "'Syne Mono',monospace" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontSize: "10px", color: "#3a5a75" }
  }, "MA5 ", /* @__PURE__ */ React3.createElement("span", {
    style: { color: "#f59e0b" }
  }, "\u25CF"), " \xA0 MA20 ", /* @__PURE__ */ React3.createElement("span", {
    style: { color: "#60a5fa" }
  }, "\u25CF"), " \xA0 RSI14 ", /* @__PURE__ */ React3.createElement("span", {
    style: { color: "#a78bfa" }
  }, "\u25CF"), " \xA0 Volume bars in lower panel"), hovered && /* @__PURE__ */ React3.createElement("div", {
    style: { fontSize: "10px", color: "#8fa8c0", textAlign: "right", lineHeight: 1.5 }
  }, /* @__PURE__ */ React3.createElement("div", null, hovered.date), /* @__PURE__ */ React3.createElement("div", null, "O ", hovered.open.toFixed(2), " \xB7 H ", hovered.high.toFixed(2), " \xB7 L ", hovered.low.toFixed(2), " \xB7 C ", hovered.close.toFixed(2)), /* @__PURE__ */ React3.createElement("div", null, "Adj ", hovered.adjClose.toFixed(2), " \xB7 Vol ", fmtVol(hovered.volume), " \xB7 MA5 ", hoveredMa5 ? hoveredMa5.toFixed(2) : "N/A", " \xB7 MA20 ", hoveredMa20 ? hoveredMa20.toFixed(2) : "N/A", " \xB7 RSI14 ", hoveredRsi != null ? hoveredRsi.toFixed(2) : "N/A"))));
};
var isLocalBridgeHost = () => {
  if (typeof window === "undefined")
    return false;
  const { hostname, port } = window.location;
  return (hostname === "127.0.0.1" || hostname === "localhost") && port === "8765";
};
function WorkflowLaunchpad({
  bridgeReady,
  bridgeChecked,
  onOpenMatrix,
  onOpenChart,
  onOpenBacktest,
  onOpenLab
}) {
  const statusTone = bridgeReady ? "#22c55e" : bridgeChecked ? "#f59e0b" : "#8fb8d8";
  const statusText = bridgeReady ? "Full Yahoo universe mode is ready. Best next step: open UNIVERSE LAB." : bridgeChecked ? "Online ETF dashboard is ready. To unlock arbitrary Yahoo symbol search, start local_refresh_server.py and open http://127.0.0.1:8765/." : "Checking whether the local Yahoo bridge is available...";
  return /* @__PURE__ */ React3.createElement("div", {
    style: { padding: "18px 28px", borderBottom: "1px solid #08172a", background: "linear-gradient(180deg, rgba(6,14,28,.96), rgba(3,8,16,.98))" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { display: "grid", gridTemplateColumns: "1.2fr .8fr", gap: "16px", alignItems: "stretch" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { background: "#060e1c", border: "1px solid #0a1e32", borderRadius: "12px", padding: "20px 22px" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#1e3a55", letterSpacing: ".12em", marginBottom: "6px" }
  }, "START HERE"), /* @__PURE__ */ React3.createElement("div", {
    style: { fontWeight: 800, fontSize: "18px", color: "#f0f6ff", marginBottom: "8px" }
  }, "Choose the fastest workflow for what you want to do"), /* @__PURE__ */ React3.createElement("div", {
    style: { fontSize: "12px", color: "#7a9ab5", lineHeight: 1.7, marginBottom: "12px" }
  }, "This dashboard now supports both a published 10-ETF workflow and a full Yahoo universe workflow. Use the path below that matches your goal instead of guessing which tab to start with."), /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: statusTone, marginBottom: "14px" }
  }, statusText), /* @__PURE__ */ React3.createElement("div", {
    style: { display: "flex", gap: "8px", flexWrap: "wrap" }
  }, /* @__PURE__ */ React3.createElement("button", {
    className: "nav-tab on",
    onClick: onOpenMatrix
  }, "START ETF MATRIX"), /* @__PURE__ */ React3.createElement("button", {
    className: "nav-tab",
    onClick: onOpenChart
  }, "OPEN PRICE CHART"), /* @__PURE__ */ React3.createElement("button", {
    className: "nav-tab",
    onClick: onOpenBacktest
  }, "ETF BACKTEST"), /* @__PURE__ */ React3.createElement("button", {
    className: `nav-tab ${bridgeReady ? "on" : ""}`,
    onClick: onOpenLab,
    style: bridgeReady ? { color: "#22c55e", borderColor: "#1b3b2a" } : {}
  }, "OPEN UNIVERSE LAB"))), /* @__PURE__ */ React3.createElement("div", {
    style: { background: "#060e1c", border: "1px solid #0a1e32", borderRadius: "12px", padding: "20px 22px" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#1e3a55", letterSpacing: ".12em", marginBottom: "12px" }
  }, "BEST PRACTICE FLOW"), /* @__PURE__ */ React3.createElement("div", {
    style: { display: "grid", gap: "10px" }
  }, [
    ["1. Compare", "Use CORR MATRIX to understand diversification across the published ETF set."],
    ["2. Inspect", "Use PRICE CHART to review candlesticks, volume, MA and RSI before building a portfolio."],
    ["3. Expand", bridgeReady ? "Use UNIVERSE LAB to import any Yahoo-compatible asset and run dynamic analysis." : "When you need arbitrary Yahoo symbols, run local_refresh_server.py and then use UNIVERSE LAB."]
  ].map(([title, text]) => /* @__PURE__ */ React3.createElement("div", {
    key: title,
    style: { background: "#030810", border: "1px solid #0a1a2e", borderRadius: "8px", padding: "12px 14px" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#8fb8d8", marginBottom: "4px" }
  }, title), /* @__PURE__ */ React3.createElement("div", {
    style: { fontSize: "12px", color: "#7a9ab5", lineHeight: 1.6 }
  }, text)))))));
}
function App() {
  const [tab, setTab] = useState3("matrix");
  const [selected, setSelected] = useState3(ETFS[0]);
  const [highlight, setHighlight] = useState3(null);
  const [visibleETFs, setVisibleETFs] = useState3(ETFS.map((e) => e.id));
  const [selectedPair, setSelectedPair] = useState3(null);
  const [monthlyData, setMonthlyData] = useState3(YAHOO_MONTHLY_DATA);
  const [corrMatrix, setCorrMatrix] = useState3(DEFAULT_CORR_MATRIX);
  const [ohlcData, setOhlcData] = useState3({});
  const [chartRange, setChartRange] = useState3("ALL");
  const [isRefreshing, setIsRefreshing] = useState3(false);
  const [refreshMessage, setRefreshMessage] = useState3("");
  const [bridgeReady, setBridgeReady] = useState3(false);
  const [bridgeChecked, setBridgeChecked] = useState3(false);
  const [tabChosenByUser, setTabChosenByUser] = useState3(false);
  const [autoRoutedToLab, setAutoRoutedToLab] = useState3(false);
  const loadLocalJsonData = async () => {
    const ts = Date.now();
    const [monthlyRes, corrRes, ohlcRes] = await Promise.all([
      fetch(`${LOCAL_MONTHLY_URL}?t=${ts}`, { cache: "no-store" }),
      fetch(`${LOCAL_CORR_URL}?t=${ts}`, { cache: "no-store" }),
      fetch(`${LOCAL_OHLC_URL}?t=${ts}`, { cache: "no-store" })
    ]);
    if (!monthlyRes.ok || !corrRes.ok || !ohlcRes.ok) {
      throw new Error("local_data_not_found");
    }
    const nextMonthly = await monthlyRes.json();
    const corrPayload = await corrRes.json();
    const nextOhlc = await ohlcRes.json();
    const nextCorr = corrPayload?.corr_matrix;
    const generatedAt = corrPayload?.generated_at_utc;
    if (!nextCorr || !Array.isArray(nextCorr) || nextCorr.length !== ETFS.length) {
      throw new Error("invalid_corr_matrix");
    }
    setMonthlyData(nextMonthly);
    setCorrMatrix(nextCorr);
    setOhlcData(nextOhlc);
    if (generatedAt) {
      setRefreshMessage(`Published data timestamp (UTC): ${generatedAt}`);
    }
  };
  const handleRefreshData = async () => {
    setIsRefreshing(true);
    setRefreshMessage("Reloading published JSON...");
    try {
      await loadLocalJsonData();
      setRefreshMessage((prev) => prev || "Published JSON reloaded.");
    } catch (error) {
      setRefreshMessage("Reload failed. Please wait for GitHub Pages to finish deployment.");
    } finally {
      setIsRefreshing(false);
    }
  };
  useEffect3(() => {
    loadLocalJsonData().catch(() => {
      setRefreshMessage("Using embedded fallback data.");
    });
  }, []);
  useEffect3(() => {
    let active = true;
    probeYahooBridge().then(() => {
      if (!active)
        return;
      setBridgeReady(true);
      setBridgeChecked(true);
    }).catch(() => {
      if (!active)
        return;
      setBridgeReady(false);
      setBridgeChecked(true);
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect3(() => {
    if (autoRoutedToLab || tabChosenByUser)
      return;
    if (bridgeReady && isLocalBridgeHost()) {
      setTab("lab");
      setAutoRoutedToLab(true);
    }
  }, [autoRoutedToLab, bridgeReady, tabChosenByUser]);
  const allData = useMemo3(() => ETFS.reduce((a, e) => ({ ...a, [e.ticker]: monthlyData[e.ticker] || generatePriceData(e) }), {}), [monthlyData]);
  const priceData = useMemo3(() => allData[selected.ticker], [selected, allData]);
  const dailyOhlcData = useMemo3(() => {
    const rows = ohlcData[selected.ticker] || [];
    return filterOhlcByRange(rows, chartRange);
  }, [ohlcData, selected, chartRange]);
  const firstP = dailyOhlcData[0]?.close ?? priceData[0]?.price ?? 1;
  const lastP = dailyOhlcData[dailyOhlcData.length - 1]?.close ?? priceData[priceData.length - 1]?.price ?? 1;
  const totalRet = ((lastP - firstP) / firstP * 100).toFixed(1);
  const displayETFs = ETFS.filter((e) => visibleETFs.includes(e.id));
  const showGlobalSelector = tab === "matrix" || tab === "chart" || tab === "report";
  const openTab = (nextTab) => {
    setTabChosenByUser(true);
    setTab(nextTab);
  };
  const avgCorr = useMemo3(() => {
    const idx = selected.id;
    const row = corrMatrix[idx].filter((_, i) => i !== idx && visibleETFs.includes(i));
    if (row.length === 0)
      return "0.00";
    return (row.reduce((a, b) => a + b, 0) / row.length).toFixed(2);
  }, [selected, visibleETFs, corrMatrix]);
  return /* @__PURE__ */ React3.createElement("div", {
    style: { minHeight: "100vh", background: "#030810", color: "#d1d9e6", fontFamily: "'Syne',sans-serif" }
  }, /* @__PURE__ */ React3.createElement("link", {
    href: "https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Syne+Mono&display=swap",
    rel: "stylesheet"
  }), /* @__PURE__ */ React3.createElement("style", null, `
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:3px;height:3px}::-webkit-scrollbar-track{background:#070f1c}::-webkit-scrollbar-thumb{background:#1a3050;border-radius:2px}
        .etf-pill{cursor:pointer;padding:7px 14px;border-radius:20px;border:1px solid #0e2035;background:transparent;font-family:'Syne Mono',monospace;font-size:11px;color:#3a5570;transition:all .15s;white-space:nowrap}
        .etf-pill:hover{border-color:#1a3858;color:#8fa8c0}
        .etf-pill.on{border-color:var(--c);background:color-mix(in srgb,var(--c) 12%,transparent);color:var(--c)}
        .nav-tab{cursor:pointer;padding:9px 22px;border-radius:4px;font-size:12px;font-family:'Syne Mono',monospace;letter-spacing:.06em;border:1px solid transparent;transition:all .15s;color:#2d4560}
        .nav-tab.on{background:#071525;border-color:#0e2540;color:#8fb8d8}
        .nav-tab:hover:not(.on){color:#4a6a85}
        .corr-cell{cursor:pointer;transition:transform .1s;border-radius:4px;display:flex;align-items:center;justify-content:center;font-family:'Syne Mono',monospace;font-size:10px;font-weight:600}
        .corr-cell:hover{transform:scale(1.08);z-index:2;position:relative}
        .filter-pill{cursor:pointer;padding:4px 10px;border-radius:4px;border:1px solid #1a3858;background:#060e1c;font-family:'Syne Mono',monospace;font-size:10px;color:#4a6a85;transition:all .15s}
        .filter-pill:hover{background:#0a1e32;color:#8fa8c0}
        .filter-pill.on{background:#0e2540;border-color:var(--c);color:var(--c)}
        @keyframes up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        .fade{animation:up .25s ease}
      `), /* @__PURE__ */ React3.createElement("div", {
    style: { borderBottom: "1px solid #0a1a2e", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "rgba(3,8,16,.97)", zIndex: 20 }
  }, /* @__PURE__ */ React3.createElement("div", null, /* @__PURE__ */ React3.createElement("div", {
    style: { fontWeight: 800, fontSize: "20px", letterSpacing: ".02em", color: "#f0f6ff" }
  }, "CORRELATION ANALYSIS DASHBOARD"), /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#1e4060", marginTop: "2px", letterSpacing: ".08em" }
  }, "10 GLOBALLY DIVERSIFIED ETFs \xB7 DAILY ADJ CLOSE DATA \xB7 2019\u20132026")), /* @__PURE__ */ React3.createElement("div", {
    style: { display: "flex", gap: "6px", alignItems: "center" }
  }, /* @__PURE__ */ React3.createElement("button", {
    className: "nav-tab",
    onClick: handleRefreshData,
    disabled: isRefreshing,
    style: { color: isRefreshing ? "#4a6a85" : "#22c55e", borderColor: "#1b3b2a" },
    title: "Reload published JSON data from GitHub Pages."
  }, isRefreshing ? "RELOADING..." : "RELOAD DATA"), [["matrix", "CORR MATRIX"], ["chart", "PRICE CHART"], ["backtest", "BACKTEST"], ["lab", "UNIVERSE LAB"], ["report", "SUPERVISOR REPORT"], ["sources", "DATA SOURCES"]].map(([v, l]) => /* @__PURE__ */ React3.createElement("button", {
    key: v,
    className: `nav-tab ${tab === v ? "on" : ""}`,
    onClick: () => openTab(v)
  }, l)))), refreshMessage && /* @__PURE__ */ React3.createElement("div", {
    style: { padding: "8px 28px", borderBottom: "1px solid #08172a", fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#8fa8c0" }
  }, refreshMessage), /* @__PURE__ */ React3.createElement(WorkflowLaunchpad, {
    bridgeReady,
    bridgeChecked,
    onOpenMatrix: () => openTab("matrix"),
    onOpenChart: () => openTab("chart"),
    onOpenBacktest: () => openTab("backtest"),
    onOpenLab: () => openTab("lab")
  }), showGlobalSelector && /* @__PURE__ */ React3.createElement("div", {
    style: { padding: "14px 28px", borderBottom: "1px solid #08172a", display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }
  }, /* @__PURE__ */ React3.createElement("span", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#1e3a55", marginRight: "4px", letterSpacing: ".08em" }
  }, "SELECT \u25B8"), ETFS.map((e) => /* @__PURE__ */ React3.createElement("button", {
    key: e.ticker,
    className: `etf-pill ${selected.ticker === e.ticker ? "on" : ""}`,
    style: { "--c": e.color },
    onClick: () => setSelected(e)
  }, e.ticker, " ", /* @__PURE__ */ React3.createElement("span", {
    style: { opacity: 0.5, fontSize: "9px" }
  }, e.region)))), /* @__PURE__ */ React3.createElement("div", {
    style: { padding: "24px 28px" },
    className: "fade",
    key: tab + selected.ticker
  }, tab === "matrix" && /* @__PURE__ */ React3.createElement("div", null, /* @__PURE__ */ React3.createElement("div", {
    style: { display: "flex", gap: "16px", marginBottom: "28px", flexWrap: "wrap" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { flex: 1, minWidth: "260px", background: "#060e1c", border: `1px solid ${selected.color}22`, borderLeft: `3px solid ${selected.color}`, borderRadius: "10px", padding: "18px 22px" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }
  }, /* @__PURE__ */ React3.createElement("span", {
    style: { fontWeight: 800, fontSize: "28px", color: selected.color, letterSpacing: ".02em" }
  }, selected.ticker), /* @__PURE__ */ React3.createElement("span", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: selected.color, border: `1px solid ${selected.color}44`, borderRadius: "3px", padding: "2px 8px" }
  }, selected.region), /* @__PURE__ */ React3.createElement("span", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#2d4a65", border: "1px solid #0e2035", borderRadius: "3px", padding: "2px 8px" }
  }, selected.corr_group)), /* @__PURE__ */ React3.createElement("div", {
    style: { fontSize: "12px", color: "#5a7a95", lineHeight: 1.6, marginBottom: "12px" }
  }, selected.name), /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "11px", color: "#8fa8c0", lineHeight: 1.7, borderTop: "1px solid #0a1e32", paddingTop: "12px" }
  }, selected.why_short)), /* @__PURE__ */ React3.createElement("div", {
    style: { display: "flex", gap: "12px", flexWrap: "wrap" }
  }, [["AUM", selected.aum], ["Expense", selected.expense], ["Avg Corr", avgCorr], ["Risk", selected.risk]].map(([l, v]) => /* @__PURE__ */ React3.createElement("div", {
    key: l,
    style: { background: "#060e1c", border: "1px solid #0a1e32", borderRadius: "8px", padding: "14px 18px", minWidth: "100px" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "9px", color: "#1e3a55", letterSpacing: ".1em", marginBottom: "6px" }
  }, l), /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "16px", fontWeight: 700, color: l === "Avg Corr" ? avgCorr > 0.5 ? "#f97316" : avgCorr > 0.3 ? "#eab308" : "#22c55e" : "#d1d9e6" }
  }, v))))), /* @__PURE__ */ React3.createElement("div", {
    style: { background: "#060e1c", border: "1px solid #0a1e32", borderRadius: "12px", padding: "24px", overflowX: "auto" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { marginBottom: "24px", padding: "16px", background: "#030810", border: "1px solid #0a1e32", borderRadius: "8px" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#8fa8c0", marginBottom: "12px", letterSpacing: ".05em" }
  }, "FILTER ETFs FOR CORRELATION MATRIX:"), /* @__PURE__ */ React3.createElement("div", {
    style: { display: "flex", gap: "6px", flexWrap: "wrap" }
  }, ETFS.map((e) => {
    const isVisible = visibleETFs.includes(e.id);
    return /* @__PURE__ */ React3.createElement("button", {
      key: e.id,
      className: `filter-pill ${isVisible ? "on" : ""}`,
      style: { "--c": e.color },
      onClick: () => {
        if (isVisible && visibleETFs.length <= 2)
          return;
        setVisibleETFs(isVisible ? visibleETFs.filter((id) => id !== e.id) : [...visibleETFs, e.id].sort((a, b) => a - b));
      }
    }, isVisible ? "\u2713 " : "+ ", e.ticker);
  }), /* @__PURE__ */ React3.createElement("button", {
    className: "filter-pill",
    onClick: () => setVisibleETFs(ETFS.map((e) => e.id)),
    style: { marginLeft: "8px" }
  }, "Select All"))), /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#1e3a55", letterSpacing: ".1em", marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center" }
  }, /* @__PURE__ */ React3.createElement("span", null, "PAIRWISE CORRELATION MATRIX \u2014 DAILY RETURN BASIS (ADJ CLOSE, 2019\u20132026)"), /* @__PURE__ */ React3.createElement("div", {
    style: { display: "flex", gap: "10px", fontSize: "9px" }
  }, [["\u22650.7", "#f97316", "High"], ["0.3\u20130.7", "#eab308", "Mod"], ["0\u20130.3", "#22c55e", "Low"], ["<0", "#3b82f6", "Neg"]].map(([r, c, l]) => /* @__PURE__ */ React3.createElement("span", {
    key: l,
    style: { display: "flex", alignItems: "center", gap: "4px" }
  }, /* @__PURE__ */ React3.createElement("span", {
    style: { width: "8px", height: "8px", borderRadius: "2px", background: c, display: "inline-block" }
  }), /* @__PURE__ */ React3.createElement("span", {
    style: { color: "#2d4a65" }
  }, r, " ", l))))), /* @__PURE__ */ React3.createElement("div", {
    style: { display: "grid", gridTemplateColumns: `80px repeat(${displayETFs.length},1fr)`, gap: "3px", minWidth: `${80 + displayETFs.length * 60}px` }
  }, /* @__PURE__ */ React3.createElement("div", null), displayETFs.map((e) => /* @__PURE__ */ React3.createElement("div", {
    key: e.ticker,
    style: { textAlign: "center", fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: e.ticker === selected.ticker ? e.color : "#2d4a65", padding: "4px 2px", fontWeight: e.ticker === selected.ticker ? 700 : 400 }
  }, e.ticker)), displayETFs.map((row) => /* @__PURE__ */ React3.createElement(React3.Fragment, {
    key: row.ticker + "_row"
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: row.ticker === selected.ticker ? row.color : "#2d4a65", display: "flex", alignItems: "center", fontWeight: row.ticker === selected.ticker ? 700 : 400, paddingRight: "8px" }
  }, row.ticker), displayETFs.map((col) => {
    const ri = row.id;
    const ci = col.id;
    const v = corrMatrix[ri][ci];
    const isSelf = ri === ci;
    const isHighlight = ri === selected.id || ci === selected.id;
    return /* @__PURE__ */ React3.createElement("div", {
      key: col.ticker,
      className: "corr-cell",
      style: {
        height: "42px",
        background: isSelf ? "#0a1e32" : corrBg2(v),
        color: isSelf ? "#1e3a55" : corrColor2(v),
        border: isHighlight && !isSelf ? `1px solid ${corrColor2(v)}55` : "1px solid transparent",
        opacity: isHighlight || isSelf ? 1 : 0.7
      },
      onMouseEnter: () => setHighlight({ ri, ci, v, a: row.ticker, b: col.ticker }),
      onMouseLeave: () => setHighlight(null),
      onClick: () => {
        if (!isSelf)
          setSelectedPair({ a: row, b: col, corr: v });
      }
    }, isSelf ? "\u2014" : v.toFixed(2));
  })))), selectedPair && /* @__PURE__ */ React3.createElement("div", {
    style: { marginTop: "24px", padding: "20px", background: "#0a1e32", border: "1px solid #1a3858", borderRadius: "8px" },
    className: "fade"
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "14px", color: "#8fb8d8" }
  }, "PAIR ANALYSIS: ", /* @__PURE__ */ React3.createElement("strong", {
    style: { color: selectedPair.a.color }
  }, selectedPair.a.ticker), " \xD7 ", /* @__PURE__ */ React3.createElement("strong", {
    style: { color: selectedPair.b.color }
  }, selectedPair.b.ticker)), /* @__PURE__ */ React3.createElement("button", {
    onClick: () => setSelectedPair(null),
    style: { background: "transparent", border: "none", color: "#4a6a85", cursor: "pointer" }
  }, "\u2715 CLOSE")), /* @__PURE__ */ React3.createElement("div", {
    style: { fontSize: "18px", fontWeight: "bold", color: corrColor2(selectedPair.corr), marginBottom: "12px" }
  }, "Correlation Coefficient: ", selectedPair.corr.toFixed(2)), /* @__PURE__ */ React3.createElement("div", {
    style: { fontSize: "13px", color: "#d1d9e6", lineHeight: 1.6 }
  }, getPairExplanation(selectedPair.a, selectedPair.b, selectedPair.corr))), highlight && highlight.ri !== highlight.ci && /* @__PURE__ */ React3.createElement("div", {
    style: { marginTop: "12px", fontFamily: "'Syne Mono',monospace", fontSize: "11px", color: "#4a6a85", borderTop: "1px solid #0a1e32", paddingTop: "10px" }
  }, highlight.a, " \xD7 ", highlight.b, ": ", /* @__PURE__ */ React3.createElement("span", {
    style: { color: corrColor2(highlight.v) }
  }, highlight.v.toFixed(2)), /* @__PURE__ */ React3.createElement("span", {
    style: { marginLeft: "10px", color: "#3b82f6" }
  }, "\u25B8 Click cell for detailed analysis"))), /* @__PURE__ */ React3.createElement("div", {
    style: { marginTop: "20px", display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: "10px" }
  }, [
    ["8 Asset Classes", "US Equity, Europe Equity, India EM, China Tech, HK Equity, Gold, Bonds, Commodities, REITs, Japan"],
    ["6 Geographic Regions", "US, Eurozone, India, China/HK, Japan, Global \u2014 each with distinct macro cycles"],
    ["3 Asset Types", "Equities (7), Fixed Income (1), Real Assets (2) \u2014 different return drivers"],
    ["Policy Divergence", "Fed, ECB, RBI, PBOC, BOJ \u2014 5 central banks, 5 policy cycles"]
  ].map(([t, d]) => /* @__PURE__ */ React3.createElement("div", {
    key: t,
    style: { background: "#060e1c", border: "1px solid #0a1e32", borderRadius: "8px", padding: "14px" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#22c55e", marginBottom: "6px", letterSpacing: ".06em" }
  }, t), /* @__PURE__ */ React3.createElement("div", {
    style: { fontSize: "11px", color: "#3a5a75", lineHeight: 1.6 }
  }, d))))), tab === "chart" && /* @__PURE__ */ React3.createElement("div", null, /* @__PURE__ */ React3.createElement("div", {
    style: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }
  }, /* @__PURE__ */ React3.createElement("div", null, /* @__PURE__ */ React3.createElement("div", {
    style: { fontWeight: 800, fontSize: "32px", color: selected.color, letterSpacing: ".02em", lineHeight: 1 }
  }, selected.ticker), /* @__PURE__ */ React3.createElement("div", {
    style: { fontSize: "13px", color: "#3a5a75", marginTop: "4px" }
  }, selected.name)), /* @__PURE__ */ React3.createElement("div", {
    style: { textAlign: "right" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "28px", fontWeight: 700, color: +totalRet > 0 ? "#22c55e" : "#ef4444" }
  }, +totalRet > 0 ? "+" : "", totalRet, "%"), /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#1e3a55" }
  }, chartRange, " WINDOW RETURN"))), /* @__PURE__ */ React3.createElement("div", {
    style: { background: "#060e1c", border: "1px solid #0a1e32", borderRadius: "12px", padding: "20px 16px 10px", marginBottom: "20px" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "10px", flexWrap: "wrap" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#1e3a55", letterSpacing: ".1em" }
  }, "DAILY OHLC CANDLESTICK \xB7 YFINANCE"), /* @__PURE__ */ React3.createElement("div", {
    style: { display: "flex", gap: "6px", flexWrap: "wrap" }
  }, RANGE_OPTIONS.map((r) => /* @__PURE__ */ React3.createElement("button", {
    key: r.id,
    className: `filter-pill ${chartRange === r.id ? "on" : ""}`,
    style: { "--c": selected.color },
    onClick: () => setChartRange(r.id)
  }, r.label)))), /* @__PURE__ */ React3.createElement(CandlestickChart, {
    data: dailyOhlcData
  })), /* @__PURE__ */ React3.createElement("div", {
    style: { background: "#060e1c", border: `1px solid ${selected.color}22`, borderLeft: `3px solid ${selected.color}`, borderRadius: "10px", padding: "20px 22px" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: selected.color, letterSpacing: ".1em", marginBottom: "12px" }
  }, "\u25B8 CORRELATION RATIONALE FOR SUPERVISOR REPORT"), /* @__PURE__ */ React3.createElement("div", {
    style: { fontSize: "13px", color: "#8fa8c0", lineHeight: 1.85 }
  }, selected.why_full)), /* @__PURE__ */ React3.createElement("div", {
    style: { marginTop: "20px", background: "#060e1c", border: "1px solid #0a1e32", borderRadius: "10px", padding: "20px" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#1e3a55", letterSpacing: ".1em", marginBottom: "14px" }
  }, selected.ticker, " PAIRWISE CORRELATIONS"), /* @__PURE__ */ React3.createElement("div", {
    style: { display: "flex", gap: "8px", flexWrap: "wrap" }
  }, ETFS.filter((e) => e.ticker !== selected.ticker).map((e) => {
    const v = corrMatrix[selected.id][e.id];
    return /* @__PURE__ */ React3.createElement("div", {
      key: e.ticker,
      style: { background: corrBg2(v), border: `1px solid ${corrColor2(v)}33`, borderRadius: "6px", padding: "10px 14px", minWidth: "90px" }
    }, /* @__PURE__ */ React3.createElement("div", {
      style: { fontFamily: "'Syne Mono',monospace", fontSize: "12px", fontWeight: 700, color: e.color, marginBottom: "4px" }
    }, e.ticker), /* @__PURE__ */ React3.createElement("div", {
      style: { fontFamily: "'Syne Mono',monospace", fontSize: "16px", fontWeight: 700, color: corrColor2(v) }
    }, v.toFixed(2)), /* @__PURE__ */ React3.createElement("div", {
      style: { fontFamily: "'Syne Mono',monospace", fontSize: "8px", color: "#2d4a65", marginTop: "3px" }
    }, e.region));
  })))), tab === "backtest" && /* @__PURE__ */ React3.createElement(BacktestPanel, {
    etfs: ETFS,
    corrMatrix,
    ohlcData
  }), tab === "lab" && /* @__PURE__ */ React3.createElement(MarketLabPanel, {
    baseAssets: ETFS,
    baseOhlcData: ohlcData
  }), tab === "report" && /* @__PURE__ */ React3.createElement("div", {
    style: { maxWidth: "860px", margin: "0 auto" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { background: "#060e1c", border: "1px solid #0a1e32", borderRadius: "12px", padding: "36px 40px" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#1e3a55", letterSpacing: ".12em", marginBottom: "6px" }
  }, "INTERNAL RESEARCH MEMORANDUM"), /* @__PURE__ */ React3.createElement("div", {
    style: { fontWeight: 800, fontSize: "22px", color: "#f0f6ff", marginBottom: "4px", lineHeight: 1.3 }
  }, "ETF Selection Rationale for Correlation Analysis Study"), /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "11px", color: "#2d4a65", marginBottom: "32px", paddingBottom: "24px", borderBottom: "1px solid #0a1e32" }
  }, "Prepared for: Portfolio Strategy Review \xA0|\xA0 Date: April 2026 \xA0|\xA0 Products: 10 ETFs"), /* @__PURE__ */ React3.createElement("div", {
    style: { fontSize: "13px", color: "#7a9ab5", lineHeight: 1.9, marginBottom: "28px" }
  }, "The following 10 ETFs were selected specifically to maximize correlation dispersion across the portfolio. The primary criterion was ", /* @__PURE__ */ React3.createElement("strong", {
    style: { color: "#d1d9e6" }
  }, "structural independence of return drivers"), " \u2014 each product must be governed by materially different macroeconomic, policy, and fundamental forces."), /* @__PURE__ */ React3.createElement("div", {
    style: { marginBottom: "28px" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "11px", color: "#22c55e", letterSpacing: ".08em", marginBottom: "16px" }
  }, "01 \u2014 SELECTION FRAMEWORK"), /* @__PURE__ */ React3.createElement("div", {
    style: { fontSize: "13px", color: "#7a9ab5", lineHeight: 1.9 }
  }, "Our selection process applied four orthogonality tests. First, ", /* @__PURE__ */ React3.createElement("strong", {
    style: { color: "#d1d9e6" }
  }, "geographic independence"), ": products must span distinct economic zones governed by different central banks (Fed, ECB, RBI, PBOC, BOJ). Second, ", /* @__PURE__ */ React3.createElement("strong", {
    style: { color: "#d1d9e6" }
  }, "asset class independence"), ": equities, fixed income, and real assets respond to different factor exposures. Third, ", /* @__PURE__ */ React3.createElement("strong", {
    style: { color: "#d1d9e6" }
  }, "sector/industry independence"), ": even within equities, country-specific and sector-specific returns diverge. Fourth, ", /* @__PURE__ */ React3.createElement("strong", {
    style: { color: "#d1d9e6" }
  }, "crisis behavior independence"), ": products should not all fall simultaneously during market dislocations.")), /* @__PURE__ */ React3.createElement("div", {
    style: { marginBottom: "28px" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "11px", color: "#22c55e", letterSpacing: ".08em", marginBottom: "16px" }
  }, "02 \u2014 SELECTED PRODUCTS & RATIONALE"), /* @__PURE__ */ React3.createElement("div", {
    style: { display: "flex", flexDirection: "column", gap: "16px" }
  }, ETFS.map((e, i) => /* @__PURE__ */ React3.createElement("div", {
    key: e.ticker,
    style: { display: "flex", gap: "16px", paddingBottom: "16px", borderBottom: "1px solid #080f1e" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "18px", fontWeight: 700, color: e.color, minWidth: "60px", paddingTop: "2px" }
  }, e.ticker), /* @__PURE__ */ React3.createElement("div", null, /* @__PURE__ */ React3.createElement("div", {
    style: { fontSize: "12px", color: "#3a5570", marginBottom: "6px" }
  }, e.name, " \xA0\xB7\xA0 ", e.region, " \xA0\xB7\xA0 Expense: ", e.expense), /* @__PURE__ */ React3.createElement("div", {
    style: { fontSize: "12px", color: "#7a9ab5", lineHeight: 1.8 }
  }, e.why_full)))))), /* @__PURE__ */ React3.createElement("div", {
    style: { marginBottom: "28px" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "11px", color: "#22c55e", letterSpacing: ".08em", marginBottom: "16px" }
  }, "03 \u2014 CORRELATION STRUCTURE SUMMARY"), /* @__PURE__ */ React3.createElement("div", {
    style: { fontSize: "13px", color: "#7a9ab5", lineHeight: 1.9, marginBottom: "16px" }
  }, "The correlation matrix computed from Yahoo adjusted-close daily returns shows the following structure across asset class clusters:"), /* @__PURE__ */ React3.createElement("div", {
    style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }
  }, [
    ["US vs. Europe (SPY/EZU)", "~0.72 \u2014 moderate, driven by global risk-on/off but different valuations & ECB policy"],
    ["US vs. India (SPY/INDA)", "~0.58 \u2014 moderate; India's domestic cycle lowers linkage"],
    ["US vs. China Internet (SPY/KWEB)", "~0.42 \u2014 low; PBOC policy and regulatory cycles dominate KWEB"],
    ["US vs. Gold (SPY/GLD)", "~0.02 \u2014 near zero; gold is driven by real rates & USD, not earnings"],
    ["US vs. Bonds (SPY/TLT)", "~-0.15 \u2014 negative; classic flight-to-safety effect"],
    ["Gold vs. Bonds (GLD/TLT)", "~0.18 \u2014 low; both are defensive but respond to different stress types"],
    ["Bonds vs. Commodities (TLT/DBC)", "~-0.12 \u2014 negative; inflation raises DBC, damages TLT"],
    ["Japan vs. China (EWJ/KWEB)", "~0.38 \u2014 low; BOJ vs. PBOC policy environments are structurally divergent"]
  ].map(([pair, desc]) => /* @__PURE__ */ React3.createElement("div", {
    key: pair,
    style: { background: "#070f1e", border: "1px solid #0a1a2e", borderRadius: "6px", padding: "12px 14px" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#d1d9e6", marginBottom: "5px" }
  }, pair), /* @__PURE__ */ React3.createElement("div", {
    style: { fontSize: "11px", color: "#3a5570", lineHeight: 1.6 }
  }, desc))))), /* @__PURE__ */ React3.createElement("div", {
    style: { background: "rgba(34,197,94,.05)", border: "1px solid rgba(34,197,94,.15)", borderRadius: "8px", padding: "18px 20px" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#22c55e", letterSpacing: ".08em", marginBottom: "10px" }
  }, "04 \u2014 CONCLUSION"), /* @__PURE__ */ React3.createElement("div", {
    style: { fontSize: "13px", color: "#7a9ab5", lineHeight: 1.9 }
  }, "This 10-ETF portfolio spans ", /* @__PURE__ */ React3.createElement("strong", {
    style: { color: "#d1d9e6" }
  }, "6 geographic regions"), ", ", /* @__PURE__ */ React3.createElement("strong", {
    style: { color: "#d1d9e6" }
  }, "5 central bank policy environments"), ", and ", /* @__PURE__ */ React3.createElement("strong", {
    style: { color: "#d1d9e6" }
  }, "3 asset classes"), ". The average pairwise correlation of the portfolio is approximately ", /* @__PURE__ */ React3.createElement("strong", {
    style: { color: "#22c55e" }
  }, "0.30"), " \u2014 well below a US-only equity portfolio which would average 0.80+. Critically, the portfolio contains ", /* @__PURE__ */ React3.createElement("strong", {
    style: { color: "#d1d9e6" }
  }, "multiple negatively correlated pairs"), " (SPY/TLT, TLT/DBC) and near-zero pairs (SPY/GLD), providing genuine diversification benefit rather than mere sector rotation. This selection provides the broadest possible base for a statistically meaningful correlation analysis.")), /* @__PURE__ */ React3.createElement("div", {
    style: { marginTop: "20px", fontFamily: "'Syne Mono',monospace", fontSize: "9px", color: "#0e2035", lineHeight: 1.7 }
  }, "DISCLAIMER: Correlations are computed from historical adjusted-close returns and are time-varying across market regimes. This memorandum is for internal analytical purposes only and does not constitute investment advice."))), tab === "sources" && /* @__PURE__ */ React3.createElement("div", {
    style: { maxWidth: "860px", margin: "0 auto" },
    className: "fade"
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { background: "#060e1c", border: "1px solid #0a1e32", borderRadius: "12px", padding: "36px 40px" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#1e3a55", letterSpacing: ".12em", marginBottom: "6px" }
  }, "METHODOLOGY & REFERENCES"), /* @__PURE__ */ React3.createElement("div", {
    style: { fontWeight: 800, fontSize: "22px", color: "#f0f6ff", marginBottom: "24px", lineHeight: 1.3 }
  }, "Data Sources and Calculation Methodology"), /* @__PURE__ */ React3.createElement("div", {
    style: { marginBottom: "28px" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "11px", color: "#22c55e", letterSpacing: ".08em", marginBottom: "12px" }
  }, "PRIMARY DATA PROVIDERS"), /* @__PURE__ */ React3.createElement("div", {
    style: { display: "grid", gap: "12px" }
  }, [
    ["Yahoo Finance", "Primary open data source for daily OHLCV and adjusted close (Adj Close)."],
    ["yfinance (Python)", "Open-source connector used to fetch Yahoo data in batch and export local files."],
    ["Local JSON/CSV Exports", "Downloaded data is persisted locally for reproducible refreshes."],
    ["Adjusted Close Method", "Uses adjusted prices for return/correlation calculations."],
    ["Fund Fact Sheets", "BlackRock/iShares and State Street SPDR official reports for AUM, Expense Ratios, and Holdings."],
    ["Common Sample Window", "Correlation matrix uses overlapping daily observations across all ETFs."]
  ].map(([src, desc]) => /* @__PURE__ */ React3.createElement("div", {
    key: src,
    style: { display: "flex", gap: "16px", alignItems: "baseline", background: "#030810", padding: "12px 16px", borderRadius: "6px", border: "1px solid #0a1a2e" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", color: "#8fb8d8", fontSize: "12px", fontWeight: 700, minWidth: "140px" }
  }, src), /* @__PURE__ */ React3.createElement("div", {
    style: { fontSize: "13px", color: "#7a9ab5" }
  }, desc))))), /* @__PURE__ */ React3.createElement("div", {
    style: { marginBottom: "28px" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "11px", color: "#22c55e", letterSpacing: ".08em", marginBottom: "12px" }
  }, "PRICE SERIES CONSTRUCTION"), /* @__PURE__ */ React3.createElement("div", {
    style: { fontSize: "13px", color: "#7a9ab5", lineHeight: 1.8, background: "#030810", padding: "16px", borderRadius: "6px", border: "1px solid #0a1a2e" }
  }, "Price charts now use ", /* @__PURE__ */ React3.createElement("strong", null, "real month-end adjusted closes"), " directly from Yahoo Finance via yfinance (no interpolation, no simulated path). ", /* @__PURE__ */ React3.createElement("br", null), /* @__PURE__ */ React3.createElement("br", null), "For each ETF, daily Adj Close is downloaded from 2019-01-01 onward, then resampled to month-end closes for visualization. Adjusted prices account for distributions/corporate actions, making cross-asset return comparisons more consistent.")), /* @__PURE__ */ React3.createElement("div", {
    style: { marginBottom: "28px" }
  }, /* @__PURE__ */ React3.createElement("div", {
    style: { fontFamily: "'Syne Mono',monospace", fontSize: "11px", color: "#22c55e", letterSpacing: ".08em", marginBottom: "12px" }
  }, "CORRELATION MATRIX CONSTRUCTION"), /* @__PURE__ */ React3.createElement("div", {
    style: { fontSize: "13px", color: "#7a9ab5", lineHeight: 1.8, background: "#030810", padding: "16px", borderRadius: "6px", border: "1px solid #0a1a2e" }
  }, "Pairwise correlations are computed from ", /* @__PURE__ */ React3.createElement("strong", null, "daily returns of adjusted close prices"), " over the common sample window (2019\u2013latest). This avoids subjective parameter tuning and directly reflects observed co-movement in market data.")), /* @__PURE__ */ React3.createElement("div", {
    style: { marginTop: "32px", fontFamily: "'Syne Mono',monospace", fontSize: "10px", color: "#3a5570", lineHeight: 1.6, borderTop: "1px solid #0a1e32", paddingTop: "16px" }
  }, /* @__PURE__ */ React3.createElement("strong", null, "DISCLAIMER:"), " This dashboard is an interactive analytical research tool. Price series and correlation metrics are derived from Yahoo Finance adjusted-close data and may change as new data becomes available. It is not intended as direct financial advice.")))));
}
export {
  App as default
};
