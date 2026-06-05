export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const normalizeWeights = (weightsByTicker) => {
  const entries = Object.entries(weightsByTicker).map(([k, v]) => [k, Number(v) || 0]);
  const sum = entries.reduce((a, [, v]) => a + v, 0);
  if (sum <= 0) return Object.fromEntries(entries.map(([k]) => [k, 0]));
  return Object.fromEntries(entries.map(([k, v]) => [k, v / sum]));
};

export const computeMinCorrWeights = (tickers, corrMatrix, etfs) => {
  const ids = tickers.map((t) => etfs.find((e) => e.ticker === t)?.id).filter((v) => v != null);
  if (ids.length !== tickers.length) return Object.fromEntries(tickers.map((t) => [t, 1 / tickers.length]));
  const raw = {};
  for (let i = 0; i < tickers.length; i++) {
    const idI = ids[i];
    let s = 0;
    let c = 0;
    for (let j = 0; j < tickers.length; j++) {
      if (i === j) continue;
      const idJ = ids[j];
      const v = corrMatrix?.[idI]?.[idJ];
      if (typeof v === "number" && Number.isFinite(v)) {
        s += v;
        c += 1;
      }
    }
    const avg = c ? s / c : 0;
    raw[tickers[i]] = clamp(1 - avg, 0.001, 10);
  }
  return normalizeWeights(raw);
};

export const alignAdjCloseSeries = (ohlcByTicker, tickers, startDate, endDate) => {
  const mapByTicker = {};
  for (const t of tickers) {
    const rows = ohlcByTicker?.[t] || [];
    const m = new Map();
    for (const r of rows) {
      if (!r?.date) continue;
      const p = Number(r.adjClose ?? r.close);
      if (!Number.isFinite(p) || p <= 0) continue;
      if (startDate && r.date < startDate) continue;
      if (endDate && r.date > endDate) continue;
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

const rebalanceKey = (dateStr, freq) => {
  const y = dateStr.slice(0, 4);
  const m = dateStr.slice(5, 7);
  if (freq === "monthly") return `${y}-${m}`;
  if (freq === "quarterly") {
    const q = Math.floor((Number(m) - 1) / 3) + 1;
    return `${y}-Q${q}`;
  }
  if (freq === "yearly") return `${y}`;
  return null;
};

export const runPortfolioBacktest = ({
  tickers,
  aligned,
  initialCapital,
  weightsByTicker,
  rebalanceFreq,
  benchmarkTicker,
  feeBps,
  slippageBps,
  riskFreeRateAnnual,
}) => {
  const dates = aligned.dates;
  if (!dates.length) {
    return { equity: [], returns: [], benchmarkReturns: [], metrics: null, drawdown: [] };
  }

  const w = normalizeWeights(weightsByTicker);
  const fee = (Number(feeBps) || 0) / 10000;
  const slip = (Number(slippageBps) || 0) / 10000;

  let cash = Number(initialCapital) || 100000;
  const shares = {};
  const startPrices = {};
  for (const t of tickers) startPrices[t] = aligned.prices[t][0];
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
    benchShares = benchPx > 0 ? (Number(initialCapital) || 100000) / benchPx : 0;
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
    for (const t of tickers) pxByT[t] = aligned.prices[t][i];
    let port = cash;
    for (const t of tickers) port += (shares[t] || 0) * pxByT[t];

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
      for (const t of tickers) shares[t] = nextShares[t];
      cash = 0;
      port = 0;
      for (const t of tickers) port += (shares[t] || 0) * pxByT[t];
      lastKey = key;
    }

    let bench = null;
    if (benchShares != null && benchmarkTicker && aligned.prices?.[benchmarkTicker]?.[i] != null) {
      bench = benchShares * aligned.prices[benchmarkTicker][i];
    }

    if (lastPort != null) returns.push(port / lastPort - 1);
    if (bench != null && lastBench != null) benchmarkReturns.push(bench / lastBench - 1);
    lastPort = port;
    if (bench != null) lastBench = bench;

    peak = Math.max(peak, port);
    const dd = peak > 0 ? port / peak - 1 : 0;
    equity.push({ date, portfolio: port, benchmark: bench });
    drawdown.push({ date, drawdown: dd });
  }

  const metrics = computeMetrics({
    equity,
    returns,
    benchmarkReturns,
    riskFreeRateAnnual,
  });

  return { equity, returns, benchmarkReturns, metrics, drawdown };
};

export const computeMetrics = ({ equity, returns, benchmarkReturns, riskFreeRateAnnual }) => {
  if (!equity?.length) return null;
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
  const mean = ex.reduce((a, b) => a + b, 0) / Math.max(1, ex.length);
  const variance = ex.reduce((a, r) => a + (r - mean) * (r - mean), 0) / Math.max(1, ex.length - 1);
  const vol = Math.sqrt(Math.max(0, variance));
  const sharpe = vol > 0 ? (mean / vol) * Math.sqrt(252) : 0;

  const downside = ex.filter((r) => r < 0);
  const dMean = downside.reduce((a, b) => a + b, 0) / Math.max(1, downside.length);
  const dVar = downside.reduce((a, r) => a + (r - dMean) * (r - dMean), 0) / Math.max(1, downside.length - 1);
  const dVol = Math.sqrt(Math.max(0, dVar));
  const sortino = dVol > 0 ? (mean / dVol) * Math.sqrt(252) : 0;

  const benchTotal = equity[0]?.benchmark != null && equity[equity.length - 1]?.benchmark != null
    ? equity[equity.length - 1].benchmark / equity[0].benchmark - 1
    : null;

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
    nDays: equity.length,
  };
};

export const equityToCsv = (equity) => {
  const header = ["date", "portfolio", "benchmark"].join(",");
  const rows = equity.map((r) => [r.date, r.portfolio, r.benchmark == null ? "" : r.benchmark].join(","));
  return [header, ...rows].join("\n");
};

export const downloadText = (filename, text) => {
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
