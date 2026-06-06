import React, { useEffect, useState, useMemo } from "react";
import BacktestPanel from "./backtest-panel.jsx";
import MarketLabPanel from "./market-lab-panel.jsx";
import { probeYahooBridge } from "./yahoo-bridge-client.js";

// ─── DATA SOURCES ─────────────────────────────────────────────────────────────
// Price/correlation data now uses Yahoo Finance adjusted closes (Adj Close).
// Method: yfinance daily data -> month-end adjusted closes for charting,
// and daily return correlation matrix for pairwise analysis.
// Range: 2019-01-01 to latest available trading day.

// ─── REDESIGNED 10 ETFs FOR LOW CORRELATION ──────────────────────────────────
const ETFS = [
  {
    id: 0, ticker: "SPY", name: "SPDR S&P 500 ETF Trust",
    exchange: "NYSE", leverage: "1x", region: "🇺🇸 US", sector: "US Broad Market",
    expense: "0.09%", aum: "$570B", color: "#3b82f6",
    corr_group: "US Equity",
    why_short: "Benchmark anchor — largest, most liquid ETF on earth.",
    why_full: "SPY is the universal benchmark. Including it is methodologically essential — every other ETF's correlation is measured relative to this baseline. It represents the US large-cap equity factor, the single most dominant global risk factor. Without it, the correlation matrix lacks a reference point.",
    risk: "Low",
    basePrice: 290,
    seed: [268, 321, 258, 373, 477, 383, 479, 590, 682, 692, 681, 650],
  },
  {
    id: 1, ticker: "EZU", name: "iShares MSCI Eurozone ETF",
    exchange: "NYSE", leverage: "1x", region: "🇪🇺 Europe", sector: "Eurozone Equities",
    expense: "0.51%", aum: "$9.2B", color: "#f59e0b",
    corr_group: "Europe Equity",
    why_short: "Eurozone equities — driven by ECB policy, EUR/USD, and different macro cycles.",
    why_full: "EZU tracks 10 Eurozone nations (France, Germany, Italy, Spain etc.) and is driven by entirely different macro forces than SPY: ECB monetary policy, EUR/USD exchange rate, European fiscal policy, and energy import costs. It outperformed US benchmarks by ~37% in 2025 as the 'Sell America' trade accelerated. Its P/E of ~17.8x versus SPY's ~29x provides fundamental divergence that reduces correlation structurally.",
    risk: "Medium",
    basePrice: 38,
    seed: [38, 42, 31, 40, 48, 37, 44, 48, 66, 68, 65, 63],
  },
  {
    id: 2, ticker: "INDA", name: "iShares MSCI India ETF",
    exchange: "NYSE", leverage: "1x", region: "🇮🇳 India", sector: "India Equities",
    expense: "0.61%", aum: "$6.1B", color: "#f97316",
    corr_group: "EM Asia Equity",
    why_short: "India's domestically-driven economy with low US market linkage.",
    why_full: "India's equity market is primarily driven by domestic consumption, demographic growth, and RBI policy — not US tech earnings. INDA has historically shown correlation to SPY of ~0.55–0.65, well below US sector ETFs (typically 0.85+). India's economic cycle is structurally decoupled: it benefits from 'China+1' supply chain shifts, a young population (median age 28), and expanding middle class. Essential for any serious global correlation study.",
    risk: "Medium-High",
    basePrice: 32,
    seed: [32, 37, 27, 40, 49, 38, 45, 52, 48, 51, 50, 50],
  },
  {
    id: 3, ticker: "KWEB", name: "KraneShares CSI China Internet ETF",
    exchange: "NYSE", leverage: "1x", region: "🇨🇳 China", sector: "China Tech/Internet",
    expense: "0.69%", aum: "$5.8B", color: "#ef4444",
    corr_group: "China Equity",
    why_short: "China internet — driven by PBOC policy and regulatory cycles, not US Fed.",
    why_full: "KWEB tracks Alibaba, Tencent, Meituan, JD.com — companies whose valuations are driven by Chinese regulatory policy, PBOC stimulus, and domestic consumption, not the US Fed or S&P earnings. KWEB collapsed 80%+ during China's 2021–2022 regulatory crackdown while US markets were near all-time highs — a textbook demonstration of low/negative correlation during stress events. This uncorrelated crash-and-recovery cycle makes it invaluable for correlation analysis.",
    risk: "High",
    basePrice: 50,
    seed: [50, 62, 45, 75, 88, 22, 27, 22, 35, 38, 36, 35],
  },
  {
    id: 4, ticker: "EWH", name: "iShares MSCI Hong Kong ETF",
    exchange: "NYSE", leverage: "1x", region: "🇭🇰 Hong Kong", sector: "HK Equities",
    expense: "0.50%", aum: "$0.9B", color: "#ec4899",
    corr_group: "HK Equity",
    why_short: "HKD peg creates unique interest rate dynamics distinct from all other markets.",
    why_full: "EWH is structurally unique: Hong Kong's currency peg to the USD forces HKMA to mirror Fed rates, yet HK equities respond primarily to China macro signals, property market stress, and geopolitical risk. This creates a split correlation — moderate linkage to USD rates, but weak linkage to US equity fundamentals. Heavy in financials, real estate, and utilities, sectors with very different earnings drivers from US tech-heavy SPY.",
    risk: "Medium-High",
    basePrice: 22,
    seed: [22, 23, 18, 19, 21, 17, 18, 18, 20, 21, 20, 20],
  },
  {
    id: 5, ticker: "GLD", name: "SPDR Gold Shares",
    exchange: "NYSE", leverage: "1x", region: "🌍 Global", sector: "Gold / Commodities",
    expense: "0.40%", aum: "$85B", color: "#fbbf24",
    corr_group: "Commodities",
    why_short: "Gold is the definitive safe-haven — historically near-zero or negative equity correlation.",
    why_full: "Gold's correlation to equities has averaged near zero over 20 years, and turns negative during equity crashes — making it the only major asset class that reliably diversifies in crisis conditions. GLD's price is driven by real interest rates, USD strength, central bank demand, and geopolitical risk — entirely orthogonal to corporate earnings. In 2025, gold surged to all-time highs while US equities were volatile. This counter-cyclical behaviour is irreplaceable in a correlation matrix.",
    risk: "Low-Medium",
    basePrice: 125,
    seed: [121, 145, 169, 169, 168, 165, 190, 243, 383, 509, 460, 424],
  },
  {
    id: 6, ticker: "TLT", name: "iShares 20+ Year Treasury Bond ETF",
    exchange: "NASDAQ", leverage: "1x", region: "🇺🇸 US", sector: "Long-Duration Bonds",
    expense: "0.15%", aum: "$58B", color: "#06b6d4",
    corr_group: "Fixed Income",
    why_short: "Long-duration bonds — negatively correlated to equities in risk-off events.",
    why_full: "TLT represents the pure interest rate factor. During equity selloffs, institutional capital traditionally rotates into Treasuries, producing negative correlation. TLT is driven exclusively by Fed policy expectations, inflation data, and sovereign risk — completely separate from equity earnings. From 2019–2020, TLT surged 40%+ while equities crashed. Note: the correlation regime shifted in 2022 (both fell as the Fed hiked), making TLT a fascinating case study in regime-dependent correlation — essential for any rigorous analysis.",
    risk: "Medium",
    basePrice: 140,
    seed: [122, 142, 148, 148, 145, 99, 94, 96, 92, 95, 92, 90],
  },
  {
    id: 7, ticker: "DBC", name: "Invesco DB Commodity Index Tracking Fund",
    exchange: "NYSE", leverage: "1x", region: "🌍 Global", sector: "Multi-Commodity",
    expense: "0.85%", aum: "$1.8B", color: "#10b981",
    corr_group: "Commodities",
    why_short: "Broad commodity basket — driven by supply/demand and inflation, not corporate earnings.",
    why_full: "DBC tracks a diversified basket of 14 commodities including crude oil, natural gas, gold, silver, corn, wheat, and copper. Commodity returns are driven by physical supply/demand, weather, geopolitics, and inflation expectations — entirely different drivers from financial asset returns. DBC's correlation to SPY is typically 0.3–0.5, and to TLT near zero or negative. It provides the real assets / inflation factor that financial instruments cannot replicate.",
    risk: "Medium-High",
    basePrice: 14,
    seed: [14.6, 14.8, 11, 15.2, 21.5, 25.8, 22.5, 24.6, 25.5, 28, 28, 27],
  },
  {
    id: 8, ticker: "VNQ", name: "Vanguard Real Estate ETF",
    exchange: "NYSE", leverage: "1x", region: "🇺🇸 US", sector: "US REITs",
    expense: "0.12%", aum: "$35B", color: "#a78bfa",
    corr_group: "Real Assets",
    why_short: "REITs behave like a hybrid — equity upside but bond-like interest rate sensitivity.",
    why_full: "VNQ sits at the intersection of equity and fixed income: it has equity characteristics (dividends, earnings growth) but is highly sensitive to interest rates like bonds. This makes its correlation to both SPY and TLT moderate but distinct — it forms its own unique cluster in a correlation matrix. REITs also have direct exposure to physical real estate cash flows (rents), which are driven by supply/demand for space, not financial market sentiment.",
    risk: "Medium",
    basePrice: 88,
    seed: [87, 96, 74, 93, 109, 81, 82, 85, 86, 88, 86, 85],
  },
  {
    id: 9, ticker: "EWJ", name: "iShares MSCI Japan ETF",
    exchange: "NYSE", leverage: "1x", region: "🇯🇵 Japan", sector: "Japan Equities",
    expense: "0.50%", aum: "$9.8B", color: "#84cc16",
    corr_group: "Asia Developed",
    why_short: "Japan: unique BOJ ultra-loose policy, weak yen cycle, and corporate governance reform.",
    why_full: "Japan is structurally the most unique developed market: the Bank of Japan maintained negative interest rates until 2024 while every other central bank hiked aggressively — creating a yen-carry-trade dynamic that is entirely country-specific. EWJ is driven by JPY/USD exchange rate, BOJ yield curve control policy, and Japan's corporate governance reforms (Nikkei 225 hit 34-year highs in 2024). EWJ had a total return of 38.81% in the past year (stockanalysis.com). Japan has low economic correlation to both the US and China, making it an ideal diversifier in a global correlation matrix.",
    risk: "Medium",
    basePrice: 52,
    seed: [54, 57, 52, 60, 67, 57, 66, 69, 74, 76, 74, 72],
  },
];

// ─── YAHOO ADJUSTED DATA ─────────────────────────────────────────────────────
// Generated via yfinance (Adj Close), see fetch_yahoo_etf_data.py
const YAHOO_MONTHLY_DATA = {
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
      "price": 533.0,
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
      "price": 39.0,
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
      "price": 31.0,
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
      "price": 22.0,
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

// Daily return correlation matrix from adjusted closes
const CORR_MATRIX = [
  [
    1.0,
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
    1.0,
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
    1.0,
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
    1.0,
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
    1.0,
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
    1.0,
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
    1.0,
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
    1.0,
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
    1.0,
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
    1.0
  ]
];

const corrColor = (v) => {
  if (v >= 0.9) return "#dc2626";
  if (v >= 0.7) return "#f97316";
  if (v >= 0.5) return "#eab308";
  if (v >= 0.3) return "#84cc16";
  if (v >= 0.1) return "#22c55e";
  if (v >= -0.05) return "#06b6d4";
  return "#3b82f6";
};
const corrBg = (v) => {
  if (v >= 0.9) return "rgba(220,38,38,0.25)";
  if (v >= 0.7) return "rgba(249,115,22,0.2)";
  if (v >= 0.5) return "rgba(234,179,8,0.18)";
  if (v >= 0.3) return "rgba(132,204,18,0.15)";
  if (v >= 0.1) return "rgba(34,197,94,0.12)";
  if (v >= -0.05) return "rgba(6,182,212,0.12)";
  return "rgba(59,130,246,0.18)";
};

const getPairExplanation = (a, b, corr) => {
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

  if (custom[pair]) return custom[pair];

  const aType = a.corr_group;
  const bType = b.corr_group;
  let relation = "";
  if (aType.includes("Equity") && bType.includes("Equity")) {
     relation = `Both are equities, meaning they share baseline global risk sentiment. However, their regional differences (${a.region} vs ${b.region}) and distinct central bank cycles limit their correlation.`;
  } else if ((aType.includes("Fixed Income") || bType.includes("Fixed Income")) && (aType.includes("Equity") || bType.includes("Equity"))) {
     relation = `Equities and Fixed Income typically exhibit low or negative correlation. Bonds act as a shock absorber when equity markets decline.`;
  } else if (aType.includes("Commodities") || bType.includes("Commodities") || a.ticker==="GLD" || b.ticker==="GLD") {
     relation = `Commodities/Gold are driven by physical supply/demand and inflation expectations, whereas financial assets are driven by future cash flows and interest rates.`;
  } else {
     relation = `Their distinct asset classifications (${aType} vs ${bType}) inherently reduce their linkage.`;
  }

  if (corr >= 0.6) return `Strong correlation (${corr.toFixed(2)}). ${relation} The high linkage indicates that global macroeconomic factors overwhelm their regional differences.`;
  if (corr >= 0.3) return `Moderate correlation (${corr.toFixed(2)}). ${relation} They provide reasonable diversification benefits while still sharing some broad market beta.`;
  if (corr >= 0) return `Weak correlation (${corr.toFixed(2)}). ${relation} This pair is highly effective for portfolio diversification as they react to completely different market catalysts.`;
  return `Negative correlation (${corr.toFixed(2)}). ${relation} This inverse relationship provides powerful downside protection during structural market shifts.`;
};

// Month-end adjusted close series from Yahoo Finance
function generatePriceData(etf) {
  return YAHOO_MONTHLY_DATA[etf.ticker] || [];
}

const DEFAULT_CORR_MATRIX = CORR_MATRIX;
const LOCAL_MONTHLY_URL = "./yahoo_etf_monthly.json";
const LOCAL_CORR_URL = "./yahoo_etf_corr.json";
const LOCAL_OHLC_URL = "./yahoo_etf_ohlc.json";
const RANGE_OPTIONS = [
  { id: "1M", label: "1M", days: 31 },
  { id: "3M", label: "3M", days: 92 },
  { id: "3Y", label: "3Y", days: 1096 },
  { id: "ALL", label: "ALL", days: null },
];

const filterOhlcByRange = (rows, rangeId) => {
  if (!rows?.length) return [];
  const option = RANGE_OPTIONS.find((r) => r.id === rangeId) || RANGE_OPTIONS[RANGE_OPTIONS.length - 1];
  if (!option.days) return rows;
  const latest = new Date(`${rows[rows.length - 1].date}T00:00:00Z`);
  const startTs = latest.getTime() - option.days * 24 * 60 * 60 * 1000;
  return rows.filter((r) => new Date(`${r.date}T00:00:00Z`).getTime() >= startTs);
};

const calcMA = (rows, period) => {
  const out = new Array(rows.length).fill(null);
  if (rows.length < period) return out;
  let rolling = 0;
  for (let i = 0; i < rows.length; i++) {
    rolling += rows[i].close;
    if (i >= period) rolling -= rows[i - period].close;
    if (i >= period - 1) out[i] = rolling / period;
  }
  return out;
};

const calcRSI = (rows, period = 14) => {
  const out = new Array(rows.length).fill(null);
  if (rows.length <= period) return out;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = rows[i].close - rows[i - 1].close;
    if (diff >= 0) gainSum += diff;
    else lossSum += -diff;
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

const CandlestickChart = ({ data }) => {
  const [hoverIdx, setHoverIdx] = useState(null);
  if (!data?.length) {
    return <div style={{height:"380px",display:"grid",placeItems:"center",color:"#4a6a85",fontFamily:"'Syne Mono',monospace"}}>NO OHLC DATA</div>;
  }

  const ma5 = useMemo(() => calcMA(data, 5), [data]);
  const ma20 = useMemo(() => calcMA(data, 20), [data]);
  const rsi14 = useMemo(() => calcRSI(data, 14), [data]);

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
  const span = Math.max(0.0001, maxPrice - minPrice);
  const yPrice = (v) => priceTop + ((maxPrice - v) / span) * (priceBottom - priceTop);
  const maxVol = Math.max(...data.map((d) => d.volume), 1);
  const yVol = (v) => volumeBottom - (v / maxVol) * (volumeBottom - volumeTop);
  const yRsi = (v) => rsiTop + ((100 - v) / 100) * (rsiBottom - rsiTop);

  const innerW = W - left - right;
  const step = innerW / Math.max(data.length, 1);
  const bodyW = Math.max(1, Math.min(10, step * 0.62));
  const labelStep = Math.max(1, Math.floor(data.length / 6));
  const xOf = (idx) => left + idx * step + step / 2;

  const maPath = (values) => values
    .map((v, i) => (v == null ? null : `${i === 0 || values[i - 1] == null ? "M" : "L"} ${xOf(i)} ${yPrice(v)}`))
    .filter(Boolean)
    .join(" ");

  const fmtVol = (v) => {
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return `${v}`;
  };

  const hovered = hoverIdx != null ? data[hoverIdx] : null;
  const hoveredMa5 = hoverIdx != null ? ma5[hoverIdx] : null;
  const hoveredMa20 = hoverIdx != null ? ma20[hoverIdx] : null;
  const hoveredRsi = hoverIdx != null ? rsi14[hoverIdx] : null;

  return (
    <div>
      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="OHLC candlestick chart"
        onMouseMove={(evt) => {
          const rect = evt.currentTarget.getBoundingClientRect();
          const x = ((evt.clientX - rect.left) / rect.width) * W;
          const raw = Math.round((x - left - step / 2) / step);
          const idx = Math.max(0, Math.min(data.length - 1, raw));
          setHoverIdx(idx);
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {[0,1,2,3,4].map((i) => {
          const py = priceTop + (i / 4) * (priceBottom - priceTop);
          const p = (maxPrice - (i / 4) * span).toFixed(2);
          return (
            <g key={`pgrid-${i}`}>
              <line x1={left} y1={py} x2={W - right} y2={py} stroke="#0a1a2e" strokeDasharray="2 5" />
              <text x={left - 6} y={py + 3} textAnchor="end" fill="#1e3a55" fontSize="9" fontFamily="Syne Mono">${p}</text>
            </g>
          );
        })}

        {[0,1].map((i) => {
          const py = volumeTop + (i / 1) * (volumeBottom - volumeTop);
          const p = i === 0 ? fmtVol(maxVol) : "0";
          return (
            <g key={`vgrid-${i}`}>
              <line x1={left} y1={py} x2={W - right} y2={py} stroke="#0a1a2e" />
              <text x={left - 6} y={py + 3} textAnchor="end" fill="#1e3a55" fontSize="9" fontFamily="Syne Mono">{p}</text>
            </g>
          );
        })}

        {[70,50,30].map((level) => {
          const py = yRsi(level);
          return (
            <g key={`rsi-${level}`}>
              <line x1={left} y1={py} x2={W - right} y2={py} stroke={level===50 ? "#0a1a2e" : "#1f2937"} strokeDasharray="3 4" />
              <text x={left - 6} y={py + 3} textAnchor="end" fill={level===50 ? "#1e3a55" : "#4b5563"} fontSize="9" fontFamily="Syne Mono">{level}</text>
            </g>
          );
        })}

        <path d={maPath(ma5)} fill="none" stroke="#f59e0b" strokeWidth={1.2} />
        <path d={maPath(ma20)} fill="none" stroke="#60a5fa" strokeWidth={1.2} />
        <path
          d={rsi14
            .map((v, i) => (v == null ? null : `${i === 0 || rsi14[i - 1] == null ? "M" : "L"} ${xOf(i)} ${yRsi(v)}`))
            .filter(Boolean)
            .join(" ")}
          fill="none"
          stroke="#a78bfa"
          strokeWidth={1.4}
        />

        {data.map((d, i) => {
          const x = xOf(i);
          const up = d.close >= d.open;
          const color = up ? "#22c55e" : "#ef4444";
          const yOpen = yPrice(d.open);
          const yClose = yPrice(d.close);
          const bodyTop = Math.min(yOpen, yClose);
          const bodyHeight = Math.max(1, Math.abs(yOpen - yClose));
          return (
            <g key={d.date}>
              <line x1={x} x2={x} y1={yPrice(d.high)} y2={yPrice(d.low)} stroke={color} strokeWidth={1} />
              <rect x={x - bodyW / 2} y={bodyTop} width={bodyW} height={bodyHeight} fill={up ? `${color}AA` : color} stroke={color} strokeWidth={1} />
              <rect x={x - bodyW / 2} y={yVol(d.volume)} width={bodyW} height={Math.max(1, volumeBottom - yVol(d.volume))} fill={up ? "#14532d" : "#7f1d1d"} opacity={0.8} />
            </g>
          );
        })}

        {hovered && (
          <g>
            <line x1={xOf(hoverIdx)} x2={xOf(hoverIdx)} y1={priceTop} y2={rsiBottom} stroke="#38bdf8" strokeDasharray="4 4" />
            <line x1={left} x2={W - right} y1={yPrice(hovered.close)} y2={yPrice(hovered.close)} stroke="#1d4ed8" strokeDasharray="4 4" opacity={0.7} />
            {hoveredRsi != null && <line x1={left} x2={W-right} y1={yRsi(hoveredRsi)} y2={yRsi(hoveredRsi)} stroke="#7c3aed" strokeDasharray="4 4" opacity={0.65} />}
          </g>
        )}

        {data.map((d, i) => {
          if (i % labelStep !== 0 && i !== data.length - 1) return null;
          return <text key={`x-${d.date}`} x={xOf(i)} y={axisBottom} textAnchor="middle" fill="#1e3a55" fontSize="9" fontFamily="Syne Mono">{d.date.slice(2)}</text>;
        })}
      </svg>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:"10px",marginTop:"8px",fontFamily:"'Syne Mono',monospace"}}>
        <div style={{fontSize:"10px",color:"#3a5a75"}}>MA5 <span style={{color:"#f59e0b"}}>●</span> &nbsp; MA20 <span style={{color:"#60a5fa"}}>●</span> &nbsp; RSI14 <span style={{color:"#a78bfa"}}>●</span> &nbsp; Volume bars in lower panel</div>
        {hovered && (
          <div style={{fontSize:"10px",color:"#8fa8c0",textAlign:"right",lineHeight:1.5}}>
            <div>{hovered.date}</div>
            <div>O {hovered.open.toFixed(2)} · H {hovered.high.toFixed(2)} · L {hovered.low.toFixed(2)} · C {hovered.close.toFixed(2)}</div>
            <div>Adj {hovered.adjClose.toFixed(2)} · Vol {fmtVol(hovered.volume)} · MA5 {hoveredMa5 ? hoveredMa5.toFixed(2) : "N/A"} · MA20 {hoveredMa20 ? hoveredMa20.toFixed(2) : "N/A"} · RSI14 {hoveredRsi != null ? hoveredRsi.toFixed(2) : "N/A"}</div>
          </div>
        )}
      </div>
    </div>
  );
};

const isLocalBridgeHost = () => {
  if (typeof window === "undefined") return false;
  const { hostname, port } = window.location;
  return (hostname === "127.0.0.1" || hostname === "localhost") && port === "8765";
};

const TUTORIAL_STORAGE_KEY = "etf_dashboard_onboarding_v1";

const getModeGuide = (tab, bridgeReady) => {
  if (tab === "matrix") {
    return {
      mode: "ETF Matrix Mode",
      next: "先看相关性高低，再决定哪些资产值得进入价格图或回测。",
    };
  }
  if (tab === "chart") {
    return {
      mode: "Price Inspection Mode",
      next: "观察趋势、波动和 RSI 后，再切到回测验证组合表现。",
    };
  }
  if (tab === "backtest") {
    return {
      mode: "Portfolio Backtest Mode",
      next: "先选组合与权重，再运行回测；如果要研究任意 Yahoo 标的，切到 UNIVERSE LAB。",
    };
  }
  if (tab === "lab") {
    return {
      mode: "Universe Lab Mode",
      next: bridgeReady
        ? "最快方式是直接点击 Starter Pack 的 LOAD + RUN。"
        : "先启动 local_refresh_server.py，再用 Starter Pack 或搜索导入任意 Yahoo 标的。",
    };
  }
  if (tab === "report") {
    return {
      mode: "Supervisor Report Mode",
      next: "看完总结后，回到 CORR MATRIX 或 UNIVERSE LAB 继续分析。",
    };
  }
  return {
    mode: "Data Source Mode",
    next: "确认数据口径后，回到 MATRIX、CHART 或 LAB 进入正式分析。",
  };
};

function OnboardingTutorial({
  open,
  bridgeReady,
  onClose,
  onStartMatrix,
  onStartLab,
  onStartPack,
}) {
  if (!open) return null;
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(3,8,16,.78)",backdropFilter:"blur(6px)",zIndex:60,display:"grid",placeItems:"center",padding:"24px"}}>
      <div style={{width:"min(980px, 100%)",background:"#060e1c",border:"1px solid #0a1e32",borderRadius:"16px",boxShadow:"0 20px 60px rgba(0,0,0,.45)",overflow:"hidden"}}>
        <div style={{padding:"22px 24px",borderBottom:"1px solid #0a1a2e",display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:"16px"}}>
          <div>
            <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#1e3a55",letterSpacing:".12em",marginBottom:"6px"}}>FIRST-TIME GUIDE</div>
            <div style={{fontWeight:800,fontSize:"22px",color:"#f0f6ff",marginBottom:"8px"}}>3 steps to start using the dashboard correctly</div>
            <div style={{fontSize:"12px",color:"#7a9ab5",lineHeight:1.7}}>
              This project now has two valid workflows: the published ETF dashboard and the local full-Yahoo research terminal. Choose one instead of exploring tabs blindly.
            </div>
          </div>
          <button className="nav-tab" onClick={onClose}>SKIP</button>
        </div>

        <div style={{padding:"22px 24px",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(250px,1fr))",gap:"14px"}}>
          <div style={{background:"#030810",border:"1px solid #0a1a2e",borderRadius:"12px",padding:"16px 18px"}}>
            <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#8fb8d8",marginBottom:"8px"}}>STEP 1 · QUICK ETF WORKFLOW</div>
            <div style={{fontWeight:700,fontSize:"16px",color:"#f0f6ff",marginBottom:"8px"}}>Start with the 10-ETF matrix</div>
            <div style={{fontSize:"12px",color:"#7a9ab5",lineHeight:1.7,marginBottom:"12px"}}>
              Best when you want a fast institutional overview of diversification, chart structure and portfolio behaviour using the curated ETF universe.
            </div>
            <button className="nav-tab on" onClick={onStartMatrix}>START ETF MATRIX</button>
          </div>

          <div style={{background:"#030810",border:"1px solid #0a1a2e",borderRadius:"12px",padding:"16px 18px"}}>
            <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#8fb8d8",marginBottom:"8px"}}>STEP 2 · FULL MARKET WORKFLOW</div>
            <div style={{fontWeight:700,fontSize:"16px",color:"#f0f6ff",marginBottom:"8px"}}>Use Universe Lab for any Yahoo symbol</div>
            <div style={{fontSize:"12px",color:"#7a9ab5",lineHeight:1.7,marginBottom:"12px"}}>
              Best when you want to search and test arbitrary stocks, ETFs, ADRs or crypto symbols. This works best with the local Yahoo bridge.
            </div>
            <button
              className={`nav-tab ${bridgeReady ? "on" : ""}`}
              onClick={onStartLab}
              style={bridgeReady ? {background:"#0e2540",borderColor:"#143a61",color:"#8fb8d8"} : {}}
            >
              OPEN UNIVERSE LAB
            </button>
          </div>

          <div style={{background:"#030810",border:"1px solid #0a1a2e",borderRadius:"12px",padding:"16px 18px"}}>
            <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#8fb8d8",marginBottom:"8px"}}>STEP 3 · RECOMMENDED FIRST ACTION</div>
            <div style={{fontWeight:700,fontSize:"16px",color:"#f0f6ff",marginBottom:"8px"}}>Run the recommended starter pack</div>
            <div style={{fontSize:"12px",color:"#7a9ab5",lineHeight:1.7,marginBottom:"12px"}}>
              If you want the fastest “show me something useful now” path, use `Macro Core` and run the default backtest immediately.
            </div>
            <button
              className="nav-tab on"
              onClick={onStartPack}
              disabled={!bridgeReady}
              style={{background:"#0e2540",borderColor:"#143a61",color:"#8fb8d8"}}
            >
              OPEN MACRO CORE FLOW
            </button>
            {!bridgeReady ? (
              <div style={{marginTop:"10px",fontFamily:"'Syne Mono',monospace",fontSize:"9px",color:"#f59e0b"}}>
                Start `local_refresh_server.py` first to use the full Yahoo workflow.
              </div>
            ) : null}
          </div>
        </div>

        <div style={{padding:"0 24px 22px 24px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:"10px",flexWrap:"wrap"}}>
          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#4a6a85"}}>
            You can reopen this tutorial anytime from the header via `HOW TO USE`.
          </div>
          <button className="nav-tab" onClick={onClose}>GOT IT</button>
        </div>
      </div>
    </div>
  );
}

function WorkflowLaunchpad({
  bridgeReady,
  bridgeChecked,
  tab,
  onOpenMatrix,
  onOpenChart,
  onOpenBacktest,
  onOpenLab,
  onShowTutorial,
}) {
  const statusTone = bridgeReady ? "#22c55e" : bridgeChecked ? "#f59e0b" : "#8fb8d8";
  const statusText = bridgeReady
    ? "Full Yahoo universe mode is ready. Best next step: open UNIVERSE LAB."
    : bridgeChecked
      ? "Online ETF dashboard is ready. To unlock arbitrary Yahoo symbol search, start local_refresh_server.py and open http://127.0.0.1:8765/."
      : "Checking whether the local Yahoo bridge is available...";
  const modeGuide = getModeGuide(tab, bridgeReady);

  return (
    <div style={{padding:"18px 28px",borderBottom:"1px solid #08172a",background:"linear-gradient(180deg, rgba(6,14,28,.96), rgba(3,8,16,.98))"}}>
      <div style={{display:"grid",gridTemplateColumns:"1.2fr .8fr",gap:"16px",alignItems:"stretch"}}>
        <div style={{background:"#060e1c",border:"1px solid #0a1e32",borderRadius:"12px",padding:"20px 22px"}}>
          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#1e3a55",letterSpacing:".12em",marginBottom:"6px"}}>START HERE</div>
          <div style={{fontWeight:800,fontSize:"18px",color:"#f0f6ff",marginBottom:"8px"}}>Choose the fastest workflow for what you want to do</div>
          <div style={{fontSize:"12px",color:"#7a9ab5",lineHeight:1.7,marginBottom:"12px"}}>
            This dashboard now supports both a published 10-ETF workflow and a full Yahoo universe workflow. Use the path below that matches your goal instead of guessing which tab to start with.
          </div>
          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:statusTone,marginBottom:"14px"}}>{statusText}</div>
          <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
            <button className="nav-tab on" onClick={onOpenMatrix}>START ETF MATRIX</button>
            <button className="nav-tab" onClick={onOpenChart}>OPEN PRICE CHART</button>
            <button className="nav-tab" onClick={onOpenBacktest}>ETF BACKTEST</button>
            <button
              className={`nav-tab ${bridgeReady ? "on" : ""}`}
              onClick={onOpenLab}
              style={bridgeReady ? {color:"#22c55e", borderColor:"#1b3b2a"} : {}}
            >
              OPEN UNIVERSE LAB
            </button>
            <button className="nav-tab" onClick={onShowTutorial}>HOW TO USE</button>
          </div>
        </div>

        <div style={{background:"#060e1c",border:"1px solid #0a1e32",borderRadius:"12px",padding:"20px 22px"}}>
          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#1e3a55",letterSpacing:".12em",marginBottom:"12px"}}>CURRENT MODE GUIDE</div>
          <div style={{display:"grid",gap:"10px"}}>
            {[
              ["Current", modeGuide.mode],
              ["Next Step", modeGuide.next],
              ["Best Practice", bridgeReady ? "For the fastest full workflow, open UNIVERSE LAB and click Macro Core → LOAD + RUN." : "For the fastest start, use the ETF matrix online. When you need arbitrary Yahoo symbols, start local_refresh_server.py first."],
            ].map(([title, text]) => (
              <div key={title} style={{background:"#030810",border:"1px solid #0a1a2e",borderRadius:"8px",padding:"12px 14px"}}>
                <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#8fb8d8",marginBottom:"4px"}}>{title}</div>
                <div style={{fontSize:"12px",color:"#7a9ab5",lineHeight:1.6}}>{text}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("matrix"); // matrix | chart | report | sources
  const [selected, setSelected] = useState(ETFS[0]);
  const [highlight, setHighlight] = useState(null);
  const [visibleETFs, setVisibleETFs] = useState(ETFS.map(e => e.id));
  const [selectedPair, setSelectedPair] = useState(null);
  const [monthlyData, setMonthlyData] = useState(YAHOO_MONTHLY_DATA);
  const [corrMatrix, setCorrMatrix] = useState(DEFAULT_CORR_MATRIX);
  const [ohlcData, setOhlcData] = useState({});
  const [chartRange, setChartRange] = useState("ALL");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const [bridgeReady, setBridgeReady] = useState(false);
  const [bridgeChecked, setBridgeChecked] = useState(false);
  const [tabChosenByUser, setTabChosenByUser] = useState(false);
  const [autoRoutedToLab, setAutoRoutedToLab] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [labAutoRunPackId, setLabAutoRunPackId] = useState(null);

  const loadLocalJsonData = async () => {
    const ts = Date.now();
    const [monthlyRes, corrRes, ohlcRes] = await Promise.all([
      fetch(`${LOCAL_MONTHLY_URL}?t=${ts}`, { cache: "no-store" }),
      fetch(`${LOCAL_CORR_URL}?t=${ts}`, { cache: "no-store" }),
      fetch(`${LOCAL_OHLC_URL}?t=${ts}`, { cache: "no-store" }),
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

  useEffect(() => {
    loadLocalJsonData().catch(() => {
      setRefreshMessage("Using embedded fallback data.");
    });
  }, []);

  useEffect(() => {
    let active = true;
    probeYahooBridge()
      .then(() => {
        if (!active) return;
        setBridgeReady(true);
        setBridgeChecked(true);
      })
      .catch(() => {
        if (!active) return;
        setBridgeReady(false);
        setBridgeChecked(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (autoRoutedToLab || tabChosenByUser) return;
    if (bridgeReady && isLocalBridgeHost()) {
      setTab("lab");
      setAutoRoutedToLab(true);
    }
  }, [autoRoutedToLab, bridgeReady, tabChosenByUser]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const seen = window.localStorage.getItem(TUTORIAL_STORAGE_KEY);
    if (!seen) {
      setShowTutorial(true);
    }
  }, []);

  const allData = useMemo(()=> ETFS.reduce((a,e)=>({...a,[e.ticker]:(monthlyData[e.ticker] || generatePriceData(e))}),{}), [monthlyData]);
  const priceData = useMemo(()=>allData[selected.ticker],[selected,allData]);
  const dailyOhlcData = useMemo(() => {
    const rows = ohlcData[selected.ticker] || [];
    return filterOhlcByRange(rows, chartRange);
  }, [ohlcData, selected, chartRange]);

  const firstP = dailyOhlcData[0]?.close ?? priceData[0]?.price ?? 1;
  const lastP = dailyOhlcData[dailyOhlcData.length-1]?.close ?? priceData[priceData.length-1]?.price ?? 1;
  const totalRet = (((lastP-firstP)/firstP)*100).toFixed(1);

  const displayETFs = ETFS.filter(e => visibleETFs.includes(e.id));
  const showGlobalSelector = tab === "matrix" || tab === "chart" || tab === "report";

  const openTab = (nextTab) => {
    setTabChosenByUser(true);
    setTab(nextTab);
  };

  const closeTutorial = () => {
    setShowTutorial(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TUTORIAL_STORAGE_KEY, "seen");
    }
  };

  const startMacroCoreFlow = () => {
    setTabChosenByUser(true);
    setLabAutoRunPackId(`macro-core-${Date.now()}`);
    setTab("lab");
    closeTutorial();
  };

  const avgCorr = useMemo(()=>{
    const idx = selected.id;
    const row = corrMatrix[idx].filter((_,i)=>i!==idx && visibleETFs.includes(i));
    if (row.length === 0) return "0.00";
    return (row.reduce((a,b)=>a+b,0)/row.length).toFixed(2);
  },[selected, visibleETFs, corrMatrix]);

  return (
    <div style={{minHeight:"100vh",background:"#030810",color:"#d1d9e6",fontFamily:"'Syne',sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Syne+Mono&display=swap" rel="stylesheet"/>
      <style>{`
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
      `}</style>

      {/* HEADER */}
      <div style={{borderBottom:"1px solid #0a1a2e",padding:"16px 28px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,background:"rgba(3,8,16,.97)",zIndex:20}}>
        <div>
          <div style={{fontWeight:800,fontSize:"20px",letterSpacing:".02em",color:"#f0f6ff"}}>CORRELATION ANALYSIS DASHBOARD</div>
          <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#1e4060",marginTop:"2px",letterSpacing:".08em"}}>10 GLOBALLY DIVERSIFIED ETFs · DAILY ADJ CLOSE DATA · 2019–2026</div>
        </div>
        <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
          <button
            className="nav-tab"
            onClick={() => setShowTutorial(true)}
            style={{borderColor:"#0a1a2e"}}
            title="Open first-time usage guide."
          >
            HOW TO USE
          </button>
          <button
            className="nav-tab"
            onClick={handleRefreshData}
            disabled={isRefreshing}
            style={{color:isRefreshing ? "#4a6a85" : "#22c55e", borderColor:"#1b3b2a"}}
            title="Reload published JSON data from GitHub Pages."
          >
            {isRefreshing ? "RELOADING..." : "RELOAD DATA"}
          </button>
          {[["matrix","CORR MATRIX"],["chart","PRICE CHART"],["backtest","BACKTEST"],["lab","UNIVERSE LAB"],["report","SUPERVISOR REPORT"],["sources","DATA SOURCES"]].map(([v,l])=>(
            <button key={v} className={`nav-tab ${tab===v?"on":""}`} onClick={()=>openTab(v)}>{l}</button>
          ))}
        </div>
      </div>
      {refreshMessage && (
        <div style={{padding:"8px 28px",borderBottom:"1px solid #08172a",fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#8fa8c0"}}>
          {refreshMessage}
        </div>
      )}

      <OnboardingTutorial
        open={showTutorial}
        bridgeReady={bridgeReady}
        onClose={closeTutorial}
        onStartMatrix={() => {
          openTab("matrix");
          closeTutorial();
        }}
        onStartLab={() => {
          openTab("lab");
          closeTutorial();
        }}
        onStartPack={startMacroCoreFlow}
      />

      <WorkflowLaunchpad
        bridgeReady={bridgeReady}
        bridgeChecked={bridgeChecked}
        tab={tab}
        onOpenMatrix={() => openTab("matrix")}
        onOpenChart={() => openTab("chart")}
        onOpenBacktest={() => openTab("backtest")}
        onOpenLab={() => openTab("lab")}
        onShowTutorial={() => setShowTutorial(true)}
      />

      {/* ETF SELECTOR */}
      {showGlobalSelector && (
        <div style={{padding:"14px 28px",borderBottom:"1px solid #08172a",display:"flex",gap:"8px",flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#1e3a55",marginRight:"4px",letterSpacing:".08em"}}>SELECT ▸</span>
          {ETFS.map(e=>(
            <button key={e.ticker} className={`etf-pill ${selected.ticker===e.ticker?"on":""}`} style={{"--c":e.color}} onClick={()=>setSelected(e)}>
              {e.ticker} <span style={{opacity:.5,fontSize:"9px"}}>{e.region}</span>
            </button>
          ))}
        </div>
      )}

      <div style={{padding:"24px 28px"}} className="fade" key={tab+selected.ticker}>

        {/* ══════════════════════════════ CORRELATION MATRIX ══════════════════════════════ */}
        {tab==="matrix" && (
          <div>
            {/* Selected ETF info */}
            <div style={{display:"flex",gap:"16px",marginBottom:"28px",flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:"260px",background:"#060e1c",border:`1px solid ${selected.color}22`,borderLeft:`3px solid ${selected.color}`,borderRadius:"10px",padding:"18px 22px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"10px"}}>
                  <span style={{fontWeight:800,fontSize:"28px",color:selected.color,letterSpacing:".02em"}}>{selected.ticker}</span>
                  <span style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:selected.color,border:`1px solid ${selected.color}44`,borderRadius:"3px",padding:"2px 8px"}}>{selected.region}</span>
                  <span style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#2d4a65",border:"1px solid #0e2035",borderRadius:"3px",padding:"2px 8px"}}>{selected.corr_group}</span>
                </div>
                <div style={{fontSize:"12px",color:"#5a7a95",lineHeight:1.6,marginBottom:"12px"}}>{selected.name}</div>
                <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"11px",color:"#8fa8c0",lineHeight:1.7,borderTop:"1px solid #0a1e32",paddingTop:"12px"}}>{selected.why_short}</div>
              </div>
              <div style={{display:"flex",gap:"12px",flexWrap:"wrap"}}>
                {[["AUM",selected.aum],["Expense",selected.expense],["Avg Corr",avgCorr],["Risk",selected.risk]].map(([l,v])=>(
                  <div key={l} style={{background:"#060e1c",border:"1px solid #0a1e32",borderRadius:"8px",padding:"14px 18px",minWidth:"100px"}}>
                    <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"9px",color:"#1e3a55",letterSpacing:".1em",marginBottom:"6px"}}>{l}</div>
                    <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"16px",fontWeight:700,color: l==="Avg Corr" ? (avgCorr>0.5?"#f97316":avgCorr>0.3?"#eab308":"#22c55e") : "#d1d9e6"}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Matrix */}
            <div style={{background:"#060e1c",border:"1px solid #0a1e32",borderRadius:"12px",padding:"24px",overflowX:"auto"}}>
              
              {/* ETF Filter for Matrix */}
              <div style={{marginBottom:"24px",padding:"16px",background:"#030810",border:"1px solid #0a1e32",borderRadius:"8px"}}>
                <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#8fa8c0",marginBottom:"12px",letterSpacing:".05em"}}>FILTER ETFs FOR CORRELATION MATRIX:</div>
                <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                  {ETFS.map(e=>{
                    const isVisible = visibleETFs.includes(e.id);
                    return (
                      <button 
                        key={e.id} 
                        className={`filter-pill ${isVisible ? "on" : ""}`}
                        style={{"--c":e.color}}
                        onClick={()=>{
                          if(isVisible && visibleETFs.length <= 2) return; // keep at least 2
                          setVisibleETFs(isVisible ? visibleETFs.filter(id=>id!==e.id) : [...visibleETFs, e.id].sort((a,b)=>a-b));
                        }}
                      >
                        {isVisible ? "✓ " : "+ "}{e.ticker}
                      </button>
                    )
                  })}
                  <button 
                    className="filter-pill" 
                    onClick={()=>setVisibleETFs(ETFS.map(e=>e.id))}
                    style={{marginLeft:"8px"}}
                  >
                    Select All
                  </button>
                </div>
              </div>

              <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#1e3a55",letterSpacing:".1em",marginBottom:"20px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span>PAIRWISE CORRELATION MATRIX — DAILY RETURN BASIS (ADJ CLOSE, 2019–2026)</span>
                <div style={{display:"flex",gap:"10px",fontSize:"9px"}}>
                  {[["≥0.7","#f97316","High"],["0.3–0.7","#eab308","Mod"],["0–0.3","#22c55e","Low"],["<0","#3b82f6","Neg"]].map(([r,c,l])=>(
                    <span key={l} style={{display:"flex",alignItems:"center",gap:"4px"}}>
                      <span style={{width:"8px",height:"8px",borderRadius:"2px",background:c,display:"inline-block"}}/>
                      <span style={{color:"#2d4a65"}}>{r} {l}</span>
                    </span>
                  ))}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:`80px repeat(${displayETFs.length},1fr)`,gap:"3px",minWidth:`${80 + displayETFs.length * 60}px`}}>
                {/* Header row */}
                <div/>
                {displayETFs.map(e=>(
                  <div key={e.ticker} style={{textAlign:"center",fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:e.ticker===selected.ticker?e.color:"#2d4a65",padding:"4px 2px",fontWeight:e.ticker===selected.ticker?700:400}}>{e.ticker}</div>
                ))}
                {/* Data rows */}
                {displayETFs.map((row)=>(
                  <React.Fragment key={row.ticker+"_row"}>
                    <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:row.ticker===selected.ticker?row.color:"#2d4a65",display:"flex",alignItems:"center",fontWeight:row.ticker===selected.ticker?700:400,paddingRight:"8px"}}>{row.ticker}</div>
                    {displayETFs.map((col)=>{
                      const ri = row.id;
                      const ci = col.id;
                      const v = corrMatrix[ri][ci];
                      const isSelf = ri===ci;
                      const isHighlight = ri===selected.id||ci===selected.id;
                      return (
                        <div key={col.ticker}
                          className="corr-cell"
                          style={{
                            height:"42px",
                            background: isSelf ? "#0a1e32" : corrBg(v),
                            color: isSelf ? "#1e3a55" : corrColor(v),
                            border: isHighlight&&!isSelf ? `1px solid ${corrColor(v)}55` : "1px solid transparent",
                            opacity: isHighlight||isSelf ? 1 : 0.7,
                          }}
                          onMouseEnter={()=>setHighlight({ri,ci,v,a:row.ticker,b:col.ticker})}
                          onMouseLeave={()=>setHighlight(null)}
                          onClick={()=> { if(!isSelf) setSelectedPair({a:row, b:col, corr:v}) }}
                        >
                          {isSelf ? "—" : v.toFixed(2)}
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
              
              {selectedPair && (
                <div style={{marginTop:"24px", padding:"20px", background:"#0a1e32", border:"1px solid #1a3858", borderRadius:"8px"}} className="fade">
                   <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"12px"}}>
                      <div style={{fontFamily:"'Syne Mono',monospace", fontSize:"14px", color:"#8fb8d8"}}>
                         PAIR ANALYSIS: <strong style={{color:selectedPair.a.color}}>{selectedPair.a.ticker}</strong> × <strong style={{color:selectedPair.b.color}}>{selectedPair.b.ticker}</strong>
                      </div>
                      <button onClick={()=>setSelectedPair(null)} style={{background:"transparent", border:"none", color:"#4a6a85", cursor:"pointer"}}>✕ CLOSE</button>
                   </div>
                   <div style={{fontSize:"18px", fontWeight:"bold", color:corrColor(selectedPair.corr), marginBottom:"12px"}}>
                      Correlation Coefficient: {selectedPair.corr.toFixed(2)}
                   </div>
                   <div style={{fontSize:"13px", color:"#d1d9e6", lineHeight:1.6}}>
                      {getPairExplanation(selectedPair.a, selectedPair.b, selectedPair.corr)}
                   </div>
                </div>
              )}

              {highlight&&highlight.ri!==highlight.ci&&(
                <div style={{marginTop:"12px",fontFamily:"'Syne Mono',monospace",fontSize:"11px",color:"#4a6a85",borderTop:"1px solid #0a1e32",paddingTop:"10px"}}>
                  {highlight.a} × {highlight.b}: <span style={{color:corrColor(highlight.v)}}>{highlight.v.toFixed(2)}</span>
                  <span style={{marginLeft:"10px", color:"#3b82f6"}}>▸ Click cell for detailed analysis</span>
                </div>
              )}
            </div>

            {/* Why this portfolio has low correlation */}
            <div style={{marginTop:"20px",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:"10px"}}>
              {[
                ["8 Asset Classes","US Equity, Europe Equity, India EM, China Tech, HK Equity, Gold, Bonds, Commodities, REITs, Japan"],
                ["6 Geographic Regions","US, Eurozone, India, China/HK, Japan, Global — each with distinct macro cycles"],
                ["3 Asset Types","Equities (7), Fixed Income (1), Real Assets (2) — different return drivers"],
                ["Policy Divergence","Fed, ECB, RBI, PBOC, BOJ — 5 central banks, 5 policy cycles"],
              ].map(([t,d])=>(
                <div key={t} style={{background:"#060e1c",border:"1px solid #0a1e32",borderRadius:"8px",padding:"14px"}}>
                  <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#22c55e",marginBottom:"6px",letterSpacing:".06em"}}>{t}</div>
                  <div style={{fontSize:"11px",color:"#3a5a75",lineHeight:1.6}}>{d}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══════════════════════════════ PRICE CHART ══════════════════════════════ */}
        {tab==="chart" && (
          <div>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:"20px",flexWrap:"wrap",gap:"12px"}}>
              <div>
                <div style={{fontWeight:800,fontSize:"32px",color:selected.color,letterSpacing:".02em",lineHeight:1}}>{selected.ticker}</div>
                <div style={{fontSize:"13px",color:"#3a5a75",marginTop:"4px"}}>{selected.name}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"28px",fontWeight:700,color:+totalRet>0?"#22c55e":"#ef4444"}}>{+totalRet>0?"+":""}{totalRet}%</div>
                <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#1e3a55"}}>{chartRange} WINDOW RETURN</div>
              </div>
            </div>

            <div style={{background:"#060e1c",border:"1px solid #0a1e32",borderRadius:"12px",padding:"20px 16px 10px",marginBottom:"20px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"12px",marginBottom:"10px",flexWrap:"wrap"}}>
                <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#1e3a55",letterSpacing:".1em"}}>DAILY OHLC CANDLESTICK · YFINANCE</div>
                <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                  {RANGE_OPTIONS.map((r) => (
                    <button
                      key={r.id}
                      className={`filter-pill ${chartRange===r.id?"on":""}`}
                      style={{"--c": selected.color}}
                      onClick={() => setChartRange(r.id)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              <CandlestickChart data={dailyOhlcData} />
            </div>

            {/* Why this ETF rationale */}
            <div style={{background:"#060e1c",border:`1px solid ${selected.color}22`,borderLeft:`3px solid ${selected.color}`,borderRadius:"10px",padding:"20px 22px"}}>
              <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:selected.color,letterSpacing:".1em",marginBottom:"12px"}}>▸ CORRELATION RATIONALE FOR SUPERVISOR REPORT</div>
              <div style={{fontSize:"13px",color:"#8fa8c0",lineHeight:1.85}}>{selected.why_full}</div>
            </div>

            {/* Correlations with this ETF */}
            <div style={{marginTop:"20px",background:"#060e1c",border:"1px solid #0a1e32",borderRadius:"10px",padding:"20px"}}>
              <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#1e3a55",letterSpacing:".1em",marginBottom:"14px"}}>{selected.ticker} PAIRWISE CORRELATIONS</div>
              <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
                {ETFS.filter(e=>e.ticker!==selected.ticker).map(e=>{
                  const v = corrMatrix[selected.id][e.id];
                  return (
                    <div key={e.ticker} style={{background:corrBg(v),border:`1px solid ${corrColor(v)}33`,borderRadius:"6px",padding:"10px 14px",minWidth:"90px"}}>
                      <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"12px",fontWeight:700,color:e.color,marginBottom:"4px"}}>{e.ticker}</div>
                      <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"16px",fontWeight:700,color:corrColor(v)}}>{v.toFixed(2)}</div>
                      <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"8px",color:"#2d4a65",marginTop:"3px"}}>{e.region}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {tab==="backtest" && (
          <BacktestPanel etfs={ETFS} corrMatrix={corrMatrix} ohlcData={ohlcData} />
        )}

        {tab==="lab" && (
          <MarketLabPanel baseAssets={ETFS} baseOhlcData={ohlcData} autoRunPackId={labAutoRunPackId} />
        )}

        {/* ══════════════════════════════ SUPERVISOR REPORT ══════════════════════════════ */}
        {tab==="report" && (
          <div style={{maxWidth:"860px",margin:"0 auto"}}>
            <div style={{background:"#060e1c",border:"1px solid #0a1e32",borderRadius:"12px",padding:"36px 40px"}}>
              <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#1e3a55",letterSpacing:".12em",marginBottom:"6px"}}>INTERNAL RESEARCH MEMORANDUM</div>
              <div style={{fontWeight:800,fontSize:"22px",color:"#f0f6ff",marginBottom:"4px",lineHeight:1.3}}>ETF Selection Rationale for Correlation Analysis Study</div>
              <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"11px",color:"#2d4a65",marginBottom:"32px",paddingBottom:"24px",borderBottom:"1px solid #0a1e32"}}>
                Prepared for: Portfolio Strategy Review &nbsp;|&nbsp; Date: April 2026 &nbsp;|&nbsp; Products: 10 ETFs
              </div>

              <div style={{fontSize:"13px",color:"#7a9ab5",lineHeight:1.9,marginBottom:"28px"}}>
                The following 10 ETFs were selected specifically to maximize correlation dispersion across the portfolio. The primary criterion was <strong style={{color:"#d1d9e6"}}>structural independence of return drivers</strong> — each product must be governed by materially different macroeconomic, policy, and fundamental forces.
              </div>

              <div style={{marginBottom:"28px"}}>
                <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"11px",color:"#22c55e",letterSpacing:".08em",marginBottom:"16px"}}>01 — SELECTION FRAMEWORK</div>
                <div style={{fontSize:"13px",color:"#7a9ab5",lineHeight:1.9}}>
                  Our selection process applied four orthogonality tests. First, <strong style={{color:"#d1d9e6"}}>geographic independence</strong>: products must span distinct economic zones governed by different central banks (Fed, ECB, RBI, PBOC, BOJ). Second, <strong style={{color:"#d1d9e6"}}>asset class independence</strong>: equities, fixed income, and real assets respond to different factor exposures. Third, <strong style={{color:"#d1d9e6"}}>sector/industry independence</strong>: even within equities, country-specific and sector-specific returns diverge. Fourth, <strong style={{color:"#d1d9e6"}}>crisis behavior independence</strong>: products should not all fall simultaneously during market dislocations.
                </div>
              </div>

              <div style={{marginBottom:"28px"}}>
                <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"11px",color:"#22c55e",letterSpacing:".08em",marginBottom:"16px"}}>02 — SELECTED PRODUCTS & RATIONALE</div>
                <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
                  {ETFS.map((e,i)=>(
                    <div key={e.ticker} style={{display:"flex",gap:"16px",paddingBottom:"16px",borderBottom:"1px solid #080f1e"}}>
                      <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"18px",fontWeight:700,color:e.color,minWidth:"60px",paddingTop:"2px"}}>{e.ticker}</div>
                      <div>
                        <div style={{fontSize:"12px",color:"#3a5570",marginBottom:"6px"}}>{e.name} &nbsp;·&nbsp; {e.region} &nbsp;·&nbsp; Expense: {e.expense}</div>
                        <div style={{fontSize:"12px",color:"#7a9ab5",lineHeight:1.8}}>{e.why_full}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{marginBottom:"28px"}}>
                <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"11px",color:"#22c55e",letterSpacing:".08em",marginBottom:"16px"}}>03 — CORRELATION STRUCTURE SUMMARY</div>
                <div style={{fontSize:"13px",color:"#7a9ab5",lineHeight:1.9,marginBottom:"16px"}}>
                  The correlation matrix computed from Yahoo adjusted-close daily returns shows the following structure across asset class clusters:
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
                  {[
                    ["US vs. Europe (SPY/EZU)","~0.72 — moderate, driven by global risk-on/off but different valuations & ECB policy"],
                    ["US vs. India (SPY/INDA)","~0.58 — moderate; India's domestic cycle lowers linkage"],
                    ["US vs. China Internet (SPY/KWEB)","~0.42 — low; PBOC policy and regulatory cycles dominate KWEB"],
                    ["US vs. Gold (SPY/GLD)","~0.02 — near zero; gold is driven by real rates & USD, not earnings"],
                    ["US vs. Bonds (SPY/TLT)","~-0.15 — negative; classic flight-to-safety effect"],
                    ["Gold vs. Bonds (GLD/TLT)","~0.18 — low; both are defensive but respond to different stress types"],
                    ["Bonds vs. Commodities (TLT/DBC)","~-0.12 — negative; inflation raises DBC, damages TLT"],
                    ["Japan vs. China (EWJ/KWEB)","~0.38 — low; BOJ vs. PBOC policy environments are structurally divergent"],
                  ].map(([pair,desc])=>(
                    <div key={pair} style={{background:"#070f1e",border:"1px solid #0a1a2e",borderRadius:"6px",padding:"12px 14px"}}>
                      <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#d1d9e6",marginBottom:"5px"}}>{pair}</div>
                      <div style={{fontSize:"11px",color:"#3a5570",lineHeight:1.6}}>{desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{background:"rgba(34,197,94,.05)",border:"1px solid rgba(34,197,94,.15)",borderRadius:"8px",padding:"18px 20px"}}>
                <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#22c55e",letterSpacing:".08em",marginBottom:"10px"}}>04 — CONCLUSION</div>
                <div style={{fontSize:"13px",color:"#7a9ab5",lineHeight:1.9}}>
                  This 10-ETF portfolio spans <strong style={{color:"#d1d9e6"}}>6 geographic regions</strong>, <strong style={{color:"#d1d9e6"}}>5 central bank policy environments</strong>, and <strong style={{color:"#d1d9e6"}}>3 asset classes</strong>. The average pairwise correlation of the portfolio is approximately <strong style={{color:"#22c55e"}}>0.30</strong> — well below a US-only equity portfolio which would average 0.80+. Critically, the portfolio contains <strong style={{color:"#d1d9e6"}}>multiple negatively correlated pairs</strong> (SPY/TLT, TLT/DBC) and near-zero pairs (SPY/GLD), providing genuine diversification benefit rather than mere sector rotation. This selection provides the broadest possible base for a statistically meaningful correlation analysis.
                </div>
              </div>

              <div style={{marginTop:"20px",fontFamily:"'Syne Mono',monospace",fontSize:"9px",color:"#0e2035",lineHeight:1.7}}>
                DISCLAIMER: Correlations are computed from historical adjusted-close returns and are time-varying across market regimes. This memorandum is for internal analytical purposes only and does not constitute investment advice.
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════ DATA SOURCES ══════════════════════════════ */}
        {tab==="sources" && (
          <div style={{maxWidth:"860px",margin:"0 auto"}} className="fade">
            <div style={{background:"#060e1c",border:"1px solid #0a1e32",borderRadius:"12px",padding:"36px 40px"}}>
              <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#1e3a55",letterSpacing:".12em",marginBottom:"6px"}}>METHODOLOGY & REFERENCES</div>
              <div style={{fontWeight:800,fontSize:"22px",color:"#f0f6ff",marginBottom:"24px",lineHeight:1.3}}>Data Sources and Calculation Methodology</div>
              
              <div style={{marginBottom:"28px"}}>
                <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"11px",color:"#22c55e",letterSpacing:".08em",marginBottom:"12px"}}>PRIMARY DATA PROVIDERS</div>
                <div style={{display:"grid",gap:"12px"}}>
                  {[
                    ["Yahoo Finance", "Primary open data source for daily OHLCV and adjusted close (Adj Close)."],
                    ["yfinance (Python)", "Open-source connector used to fetch Yahoo data in batch and export local files."],
                    ["Local JSON/CSV Exports", "Downloaded data is persisted locally for reproducible refreshes."],
                    ["Adjusted Close Method", "Uses adjusted prices for return/correlation calculations."],
                    ["Fund Fact Sheets", "BlackRock/iShares and State Street SPDR official reports for AUM, Expense Ratios, and Holdings."],
                    ["Common Sample Window", "Correlation matrix uses overlapping daily observations across all ETFs."]
                  ].map(([src, desc])=>(
                    <div key={src} style={{display:"flex", gap:"16px", alignItems:"baseline", background:"#030810", padding:"12px 16px", borderRadius:"6px", border:"1px solid #0a1a2e"}}>
                      <div style={{fontFamily:"'Syne Mono',monospace", color:"#8fb8d8", fontSize:"12px", fontWeight:700, minWidth:"140px"}}>{src}</div>
                      <div style={{fontSize:"13px", color:"#7a9ab5"}}>{desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{marginBottom:"28px"}}>
                <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"11px",color:"#22c55e",letterSpacing:".08em",marginBottom:"12px"}}>PRICE SERIES CONSTRUCTION</div>
                <div style={{fontSize:"13px",color:"#7a9ab5",lineHeight:1.8, background:"#030810", padding:"16px", borderRadius:"6px", border:"1px solid #0a1a2e"}}>
                  Price charts now use <strong>real month-end adjusted closes</strong> directly from Yahoo Finance via yfinance (no interpolation, no simulated path). <br/><br/>
                  For each ETF, daily Adj Close is downloaded from 2019-01-01 onward, then resampled to month-end closes for visualization. Adjusted prices account for distributions/corporate actions, making cross-asset return comparisons more consistent.
                </div>
              </div>

              <div style={{marginBottom:"28px"}}>
                <div style={{fontFamily:"'Syne Mono',monospace",fontSize:"11px",color:"#22c55e",letterSpacing:".08em",marginBottom:"12px"}}>CORRELATION MATRIX CONSTRUCTION</div>
                <div style={{fontSize:"13px",color:"#7a9ab5",lineHeight:1.8, background:"#030810", padding:"16px", borderRadius:"6px", border:"1px solid #0a1a2e"}}>
                  Pairwise correlations are computed from <strong>daily returns of adjusted close prices</strong> over the common sample window (2019–latest). This avoids subjective parameter tuning and directly reflects observed co-movement in market data.
                </div>
              </div>

              <div style={{marginTop:"32px",fontFamily:"'Syne Mono',monospace",fontSize:"10px",color:"#3a5570",lineHeight:1.6, borderTop:"1px solid #0a1e32", paddingTop:"16px"}}>
                <strong>DISCLAIMER:</strong> This dashboard is an interactive analytical research tool. Price series and correlation metrics are derived from Yahoo Finance adjusted-close data and may change as new data becomes available. It is not intended as direct financial advice.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
