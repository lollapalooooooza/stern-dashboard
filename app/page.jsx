"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import dynamic from 'next/dynamic';
import { buildHoldingsFromFidelityFile } from "@/lib/fidelityCsv";
const CatalystPage = dynamic(() => import('./catalyst/CatalystPage'), { ssr: false });
const CommentPanel = dynamic(() => import('./components/CommentPanel'), { ssr: false });
import {
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Area
} from "recharts";
import {
  TrendingUp, DollarSign, BarChart3, Shield, AlertTriangle,
  FileText, Settings, Home, Briefcase, Activity, Plus, Trash2, Search, Download, Upload, RefreshCw,
  Edit3, Check, Save, AlertCircle, CheckCircle, Printer, Loader2, Newspaper,
  PenLine, X, LogOut, ArrowRightLeft
} from "lucide-react";

const calc = {
  pnlDollar: (cp, bp, s) => (cp - bp) * s,
  pnlPercent: (cp, bp) => (bp !== 0 ? (cp - bp) / bp : 0),
  holdingBeta: (holding) => {
    const marketBeta = Number(holding.marketBeta) || 0;
    const benchmarkWeight = Math.min(Math.max(Number(holding.benchmarkWeight) || 0, 0), 1);
    return 1 + (marketBeta - 1) * (1 - benchmarkWeight);
  },
  portfolioBeta: (h) => h.reduce((s, x) => s + (x.weight || 0) * calc.holdingBeta(x), 0),
  systematicVol: (pb, bv) => Math.abs(pb) * bv,
  idiosyncraticVol: (pv, sv) => Math.sqrt(Math.max(pv * pv - sv * sv, 0)),
  trackingError: (pb, bv, iv) => Math.sqrt(Math.pow(pb - 1, 2) * bv * bv + iv * iv),
  dailyVaR95: (v) => (v / Math.sqrt(252)) * 1.645,
  dailyVaR99: (v) => (v / Math.sqrt(252)) * 2.326,
  complianceStatus: (c, l) => { const r = l !== 0 ? c / l : 0; return r > 1 ? "BREACH" : r > 0.85 ? "WARNING" : "OK"; },
  utilization: (c, l) => (l !== 0 ? c / l : 0),
};

const fmt = {
  pct: (v, d = 2) => v != null ? `${(v * 100).toFixed(d)}%` : "—",
  usd: (v) => v != null ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—",
  usdExact: (v) => v != null ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—",
  num: (v, d = 2) => v != null ? Number(v).toFixed(d) : "—",
  shares: (v) => v != null ? Number(v).toFixed(3) : "—",
  date: (d) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—",
  shortDate: (d) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—",
};

const statusBg = (s) => s === "BREACH" ? "#ef4444" : s === "WARNING" ? "#f59e0b" : "#10b981";

const THEME_COLORS = {
  Benchmark:"#1e293b","AI-Industrial":"#2563eb","Digital Infra":"#7c3aed",Experientials:"#0891b2",
  Security:"#dc2626","Silver Economy":"#ec4899","Silver":"#ec4899",Nuclear:"#d97706",Payments:"#059669",
  Waste:"#84cc16",Battery:"#f97316","Legacy Software":"#6366f1",Adtech:"#14b8a6",
  "Water PFAS":"#0f766e",Banks:"#0f766e",War:"#9a3412","War?":"#9a3412",
  Sports:"#8b5cf6","Digital Finance":"#06b6d4",Batteries:"#f97316","Waste Management":"#84cc16",Cash:"#94a3b8",
};
const CHART_COLORS = ["#1e3a5f","#2563eb","#7c3aed","#dc2626","#059669","#d97706","#0891b2","#ec4899","#84cc16","#f97316","#6366f1","#14b8a6"];
const getThemeColor = (theme, i) => THEME_COLORS[theme] || CHART_COLORS[i % CHART_COLORS.length];

const GROUP_COLORS = { thematic:"#2563eb", opportunistic:"#7c3aed", systematic:"#059669", bond:"#d97706" };
const GROUP_LABELS = { thematic:"Thematic", opportunistic:"Opportunistic", systematic:"Systematic", bond:"Bond" };
const OVERVIEW_RANGE_OPTIONS = [
  { key: "1M", label: "1M" },
  { key: "3M", label: "3M" },
  { key: "6M", label: "6M" },
  { key: "YTD", label: "YTD" },
  { key: "1Y", label: "1Y" },
  { key: "SI", label: "Since Inception" },
  { key: "CUSTOM", label: "Custom" },
];
const HEATMAP_MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const BENCHMARK_OPTIONS = [{ value: "SP500", label: "S&P 500" }];

const hasMetricValue = (value) => value !== null && value !== undefined && value !== "";
const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const approxEqual = (left, right, epsilon = 0.005) => Math.abs(asNumber(left) - asNumber(right)) < epsilon;
const currentLocalDateIso = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const firstNumber = (...values) => {
  for (const value of values) {
    if (hasMetricValue(value)) return asNumber(value);
  }
  return 0;
};
const firstPositiveNumber = (...values) => {
  for (const value of values) {
    const numeric = asNumber(value, Number.NaN);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
};

const activePositionValue = (holding) => firstPositiveNumber(
  holding.currentValue,
  asNumber(holding.shares) * asNumber(holding.currentPrice),
);
const activePreviousClosePrice = (holding) => firstNumber(holding.previousClose, holding.currentPrice);
const activePreviousCloseValue = (holding) => asNumber(holding.shares) * activePreviousClosePrice(holding);
const activePnlDollar = (holding) => activePositionValue(holding) - holdingCostBasis(holding);
const exitedPositionValue = (holding) => firstPositiveNumber(
  holding.sellTotal,
  holding.currentValue,
  asNumber(holding.shares) * firstNumber(holding.sellPrice, holding.currentPrice),
);
const holdingCostBasis = (holding) => firstPositiveNumber(
  holding.costBasis,
  asNumber(holding.shares) * asNumber(holding.buyPrice),
);
const realizedPnlDollar = (holding) => {
  if (hasMetricValue(holding.realizedPnl) && !approxEqual(holding.realizedPnl, 0)) return asNumber(holding.realizedPnl);
  if (firstPositiveNumber(holding.sellTotal) > 0) return exitedPositionValue(holding) - holdingCostBasis(holding);
  if (hasMetricValue(holding.pnlFromExcel) && !approxEqual(holding.pnlFromExcel, 0)) return asNumber(holding.pnlFromExcel);
  return exitedPositionValue(holding) - holdingCostBasis(holding);
};
const realizedPnlPercent = (holding) => {
  const costBasis = holdingCostBasis(holding);
  if (hasMetricValue(holding.realizedPnlPct) && !approxEqual(holding.realizedPnlPct, 0) && costBasis > 0) return asNumber(holding.realizedPnlPct);
  return costBasis > 0 ? realizedPnlDollar(holding) / costBasis : 0;
};

function applyPricesToHoldings(holdings, prices) {
  if (!prices || Object.keys(prices).length === 0) return holdings;
  return holdings.map((holding) => {
    if (holding.status !== "active") return holding;
    const quote = prices[holding.ticker];
    if (quote == null) return holding;
    const currentPrice = typeof quote === "number" ? Number(quote) : Number(quote.price);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return holding;
    const previousCloseCandidate = typeof quote === "number" ? Number.NaN : Number(quote.previousClose);
    const previousClose = Number.isFinite(previousCloseCandidate) && previousCloseCandidate > 0
      ? previousCloseCandidate
      : (hasMetricValue(holding.previousClose) ? asNumber(holding.previousClose) : undefined);
    const currentValue = asNumber(holding.shares) * currentPrice;
    const pnlFromExcel = currentValue - holdingCostBasis(holding);
    return {
      ...holding,
      currentPrice,
      currentValue,
      pnlFromExcel,
      ...(previousClose !== undefined ? { previousClose } : {}),
    };
  });
}

function buildCumulativeReturnSeries(rows) {
  let portfolioNav = 1;
  let benchmarkNav = 1;
  return rows.map((row) => {
    portfolioNav *= 1 + (Number(row.portfolioReturn) || 0);
    benchmarkNav *= 1 + (Number(row.benchmarkReturn) || 0);
    return {
      week: row.week,
      date: row.date,
      portfolio: portfolioNav - 1,
      benchmark: benchmarkNav - 1,
      excess: portfolioNav / benchmarkNav - 1,
    };
  });
}

function parseWeekNumber(week) {
  const match = String(week || "").match(/^W(\d+)$/i);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

const THEMATIC_TRACKER_START_DATE = "2025-11-03";

function shouldResetTrackerStart(rows) {
  const hasStartOrAfter = rows.some((row) => row.date && row.date >= THEMATIC_TRACKER_START_DATE);
  const hasBefore = rows.some((row) => row.date && row.date < THEMATIC_TRACKER_START_DATE);
  return hasStartOrAfter && hasBefore;
}

function normalizeWeeklyHistoryRows(rows) {
  const cleaned = (rows || [])
    .map((row, index) => ({
      ...row,
      week: String(row.week || "").trim(),
      date: row.date ? String(row.date).slice(0, 10) : "",
      portfolioReturn: Number(row.portfolioReturn) || 0,
      benchmarkReturn: Number(row.benchmarkReturn) || 0,
      marketContrib: Number(row.marketContrib) || 0,
      valueContrib: Number(row.valueContrib) || 0,
      momentumContrib: Number(row.momentumContrib) || 0,
      alpha: Number(row.alpha) || 0,
      _index: index,
    }))
    .filter((row) => row.date || row.week);

  cleaned.sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return a.date.localeCompare(b.date);
    const weekDiff = parseWeekNumber(a.week) - parseWeekNumber(b.week);
    if (weekDiff !== 0) return weekDiff;
    return a._index - b._index;
  });

  const byKey = new Map();
  for (const row of cleaned) {
    const key = row.date || row.week || String(row._index);
    byKey.set(key, row);
  }

  const sorted = [...byKey.values()]
    .sort((a, b) => {
      if (a.date && b.date && a.date !== b.date) return a.date.localeCompare(b.date);
      const weekDiff = parseWeekNumber(a.week) - parseWeekNumber(b.week);
      if (weekDiff !== 0) return weekDiff;
      return a._index - b._index;
    });

  const resetToTrackerStart = shouldResetTrackerStart(sorted);
  const trimmed = resetToTrackerStart
    ? sorted.filter((row) => row.date && row.date >= THEMATIC_TRACKER_START_DATE)
    : sorted;
  const zeroIndexedWeeks = trimmed[0]?.date === THEMATIC_TRACKER_START_DATE
    || trimmed.some((row) => parseWeekNumber(row.week) === 0);
  const weekOffset = zeroIndexedWeeks ? 0 : 1;

  return trimmed.map((row, index) => ({
      week: `W${index + weekOffset}`,
      date: row.date,
      portfolioReturn: row.portfolioReturn,
      benchmarkReturn: row.benchmarkReturn,
      marketContrib: row.marketContrib,
      valueContrib: row.valueContrib,
      momentumContrib: row.momentumContrib,
      alpha: row.alpha,
    }));
}

function normalizeDailyHistoryRows(rows) {
  const cleaned = (rows || [])
    .map((row, index) => ({
      ...row,
      date: row.date ? String(row.date).slice(0, 10) : "",
      portfolioValue: Number(row.portfolioValue) || 0,
      benchmarkValue: Number(row.benchmarkValue) || 0,
      portfolioReturn: Number(row.portfolioReturn) || 0,
      benchmarkReturn: Number(row.benchmarkReturn) || 0,
      marketContrib: Number(row.marketContrib) || 0,
      valueContrib: Number(row.valueContrib) || 0,
      momentumContrib: Number(row.momentumContrib) || 0,
      alpha: Number(row.alpha) || 0,
      sinceStart: row.sinceStart == null ? null : Number(row.sinceStart) || 0,
      _index: index,
    }))
    .filter((row) => row.date);

  cleaned.sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a._index - b._index));
  const byDate = new Map();
  for (const row of cleaned) byDate.set(row.date, row);

  const sorted = [...byDate.values()]
    .sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a._index - b._index));
  const resetToTrackerStart = shouldResetTrackerStart(sorted);
  const trimmed = resetToTrackerStart
    ? sorted.filter((row) => row.date && row.date >= THEMATIC_TRACKER_START_DATE)
    : sorted;
  const trackerBaseline = trimmed[0]?.date === THEMATIC_TRACKER_START_DATE;
  const basePortfolioValue = trackerBaseline && trimmed[0]?.portfolioValue > 0 ? trimmed[0].portfolioValue : null;
  const baseBenchmarkValue = trackerBaseline && trimmed[0]?.benchmarkValue > 0 ? trimmed[0].benchmarkValue : null;

  return trimmed.map((row) => ({
      date: row.date,
      portfolioValue: row.portfolioValue,
      benchmarkValue: baseBenchmarkValue ? row.benchmarkValue / baseBenchmarkValue : row.benchmarkValue,
      portfolioReturn: row.portfolioReturn,
      benchmarkReturn: row.benchmarkReturn,
      marketContrib: row.marketContrib,
      valueContrib: row.valueContrib,
      momentumContrib: row.momentumContrib,
      alpha: row.alpha,
      sinceStart: basePortfolioValue ? row.portfolioValue / basePortfolioValue - 1 : row.sinceStart,
    }));
}

function buildLiveDailyHistoryRows(rows, liveSnapshot) {
  const normalized = normalizeDailyHistoryRows(rows);
  const liveValue = liveSnapshot && typeof liveSnapshot === "object"
    ? asNumber(liveSnapshot.portfolioValue, Number.NaN)
    : asNumber(liveSnapshot, Number.NaN);
  if (!normalized.length || !Number.isFinite(liveValue)) return normalized;

  const firstRow = normalized[0];
  const lastTrackedRow = normalized.at(-1);
  if (approxEqual(lastTrackedRow?.portfolioValue, liveValue)) {
    return normalized.map((row, index) => (
      index === normalized.length - 1
        ? {
            ...row,
            sinceStart: firstRow?.portfolioValue > 0 ? row.portfolioValue / firstRow.portfolioValue - 1 : row.sinceStart ?? 0,
          }
        : row
    ));
  }

  const liveDate = currentLocalDateIso();
  const sameDate = lastTrackedRow?.date === liveDate;
  const baseRow = sameDate ? normalized.at(-2) : lastTrackedRow;
  const fallbackPortfolioReturn = baseRow?.portfolioValue ? liveValue / baseRow.portfolioValue - 1 : 0;
  const portfolioReturn = Number.isFinite(liveSnapshot?.dailyReturn) ? liveSnapshot.dailyReturn : fallbackPortfolioReturn;
  const fallbackBenchmarkReturn = sameDate ? asNumber(lastTrackedRow?.benchmarkReturn) : 0;
  const benchmarkReturn = Number.isFinite(liveSnapshot?.benchmarkReturn) ? liveSnapshot.benchmarkReturn : fallbackBenchmarkReturn;
  const benchmarkBaseRow = sameDate ? normalized.at(-2) || lastTrackedRow : lastTrackedRow;
  const benchmarkValue = benchmarkBaseRow?.benchmarkValue
    ? benchmarkBaseRow.benchmarkValue * (1 + benchmarkReturn)
    : asNumber(lastTrackedRow?.benchmarkValue);
  const liveRow = {
    ...lastTrackedRow,
    date: sameDate ? lastTrackedRow.date : liveDate,
    portfolioValue: liveValue,
    portfolioReturn,
    benchmarkValue,
    benchmarkReturn,
    marketContrib: benchmarkReturn,
    alpha: portfolioReturn - benchmarkReturn,
    sinceStart: firstRow?.portfolioValue > 0 ? liveValue / firstRow.portfolioValue - 1 : 0,
  };

  return sameDate ? [...normalized.slice(0, -1), liveRow] : [...normalized, liveRow];
}

function addHistoryLabels(rows, view) {
  return rows.map((row) => ({
    ...row,
    label: view === "daily" ? fmt.shortDate(row.date) : row.week,
  }));
}

function compoundReturns(values) {
  return (values || []).reduce((nav, value) => nav * (1 + (Number(value) || 0)), 1) - 1;
}

function stdDev(values) {
  const cleaned = (values || []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (cleaned.length < 2) return 0;
  const mean = cleaned.reduce((sum, value) => sum + value, 0) / cleaned.length;
  const variance = cleaned.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (cleaned.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

function covariance(left, right) {
  const xs = (left || []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
  const ys = (right || []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
  const count = Math.min(xs.length, ys.length);
  if (count < 2) return 0;
  const x = xs.slice(0, count);
  const y = ys.slice(0, count);
  const meanX = x.reduce((sum, value) => sum + value, 0) / count;
  const meanY = y.reduce((sum, value) => sum + value, 0) / count;
  return x.reduce((sum, value, index) => sum + ((value - meanX) * (y[index] - meanY)), 0) / (count - 1);
}

function correlation(left, right) {
  const leftStd = stdDev(left);
  const rightStd = stdDev(right);
  if (leftStd === 0 || rightStd === 0) return 0;
  return covariance(left, right) / (leftStd * rightStd);
}

function annualizeReturn(totalReturn, periods) {
  if (!Number.isFinite(totalReturn) || periods <= 0) return 0;
  const base = 1 + totalReturn;
  if (base <= 0) return -1;
  return (base ** (252 / periods)) - 1;
}

function dateToIso(input) {
  if (!input) return "";
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftIsoDate(isoDate, { months = 0, years = 0, days = 0 } = {}) {
  const date = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  if (months) date.setMonth(date.getMonth() + months);
  if (years) date.setFullYear(date.getFullYear() + years);
  if (days) date.setDate(date.getDate() + days);
  return dateToIso(date);
}

function startOfYearIso(isoDate) {
  const date = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return `${date.getFullYear()}-01-01`;
}

function filterRowsByOverviewRange(rows, rangeKey, customRange = {}) {
  const normalized = (rows || []).filter((row) => row?.date).toSorted((left, right) => String(left.date).localeCompare(String(right.date)));
  if (!normalized.length) return [];
  const endDate = normalized.at(-1).date;
  let startDate = normalized[0].date;

  if (rangeKey === "1M") startDate = shiftIsoDate(endDate, { months: -1 });
  else if (rangeKey === "3M") startDate = shiftIsoDate(endDate, { months: -3 });
  else if (rangeKey === "6M") startDate = shiftIsoDate(endDate, { months: -6 });
  else if (rangeKey === "YTD") startDate = startOfYearIso(endDate);
  else if (rangeKey === "1Y") startDate = shiftIsoDate(endDate, { years: -1 });
  else if (rangeKey === "CUSTOM") {
    startDate = customRange.start ? dateToIso(customRange.start) : normalized[0].date;
    const customEnd = customRange.end ? dateToIso(customRange.end) : endDate;
    return normalized.filter((row) => row.date >= startDate && row.date <= customEnd);
  }

  return normalized.filter((row) => row.date >= startDate && row.date <= endDate);
}

function getPreviousComparableRows(allRows, currentRows) {
  const normalized = (allRows || []).filter((row) => row?.date).toSorted((left, right) => String(left.date).localeCompare(String(right.date)));
  if (!normalized.length || !currentRows?.length) return [];
  const startIndex = normalized.findIndex((row) => row.date === currentRows[0].date);
  if (startIndex <= 0) return [];
  const priorCount = currentRows.length;
  return normalized.slice(Math.max(0, startIndex - priorCount), startIndex);
}

function buildMonthlyReturnRows(rows) {
  const buckets = new Map();
  for (const row of rows || []) {
    if (!row?.date) continue;
    const year = Number(String(row.date).slice(0, 4));
    const monthIndex = Number(String(row.date).slice(5, 7)) - 1;
    const key = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        year,
        monthIndex,
        label: `${HEATMAP_MONTH_LABELS[monthIndex]} ${year}`,
        portfolioReturns: [],
        benchmarkReturns: [],
      });
    }
    const bucket = buckets.get(key);
    bucket.portfolioReturns.push(Number(row.portfolioReturn) || 0);
    bucket.benchmarkReturns.push(Number(row.benchmarkReturn) || 0);
  }
  return [...buckets.values()]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((bucket) => {
      const portfolioReturn = compoundReturns(bucket.portfolioReturns);
      const benchmarkReturn = compoundReturns(bucket.benchmarkReturns);
      return {
        year: bucket.year,
        monthIndex: bucket.monthIndex,
        label: bucket.label,
        portfolioReturn,
        benchmarkReturn,
        activeReturn: portfolioReturn - benchmarkReturn,
      };
    });
}

function buildMonthlyHeatmapMatrix(rows) {
  const months = buildMonthlyReturnRows(rows);
  const grouped = new Map();
  for (const month of months) {
    if (!grouped.has(month.year)) grouped.set(month.year, Array.from({ length: 12 }, () => null));
    grouped.get(month.year)[month.monthIndex] = month;
  }
  return [...grouped.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([year, monthsByYear]) => ({ year, months: monthsByYear }));
}

function buildRollingMetricSeries(rows, window, project) {
  const safeWindow = Math.max(3, window);
  return (rows || []).map((row, index) => {
    if (index + 1 < safeWindow) return null;
    const slice = rows.slice(index + 1 - safeWindow, index + 1);
    return { date: row.date, value: project(slice) };
  }).filter(Boolean);
}

function computeCaptureRatio(rows, direction) {
  const filtered = (rows || []).filter((row) => direction === "up" ? row.benchmarkReturn > 0 : row.benchmarkReturn < 0);
  if (!filtered.length) return null;
  const benchmarkCompound = compoundReturns(filtered.map((row) => row.benchmarkReturn));
  if (benchmarkCompound === 0) return null;
  const portfolioCompound = compoundReturns(filtered.map((row) => row.portfolioReturn));
  return portfolioCompound / benchmarkCompound;
}

function computeRangePerformanceStats(rows, riskFreeRate = 0.04) {
  const normalized = (rows || []).filter((row) => row?.date);
  if (!normalized.length) {
    return {
      totalReturn: 0,
      benchmarkReturn: 0,
      activeReturn: 0,
      annualizedReturn: 0,
      annualizedBenchmarkReturn: 0,
      annualizedVolatility: 0,
      trackingError: 0,
      sharpeRatio: null,
      informationRatio: null,
      maxDrawdown: 0,
      beta: null,
      alpha: null,
      correlation: null,
      downsideDeviation: 0,
      sortinoRatio: null,
      upCapture: null,
      downCapture: null,
      cumulativeData: [],
      drawdownSeries: [],
      rollingVolSeries: [],
      rollingTrackingErrorSeries: [],
    };
  }

  const totalReturn = compoundReturns(normalized.map((row) => row.portfolioReturn));
  const benchmarkReturn = compoundReturns(normalized.map((row) => row.benchmarkReturn));
  const activeReturn = totalReturn - benchmarkReturn;
  const annualizedReturn = annualizeReturn(totalReturn, normalized.length);
  const annualizedBenchmarkReturn = annualizeReturn(benchmarkReturn, normalized.length);
  const annualizedVolatility = stdDev(normalized.map((row) => row.portfolioReturn)) * Math.sqrt(252);
  const trackingError = stdDev(normalized.map((row) => (Number(row.portfolioReturn) || 0) - (Number(row.benchmarkReturn) || 0))) * Math.sqrt(252);
  const downsideDeviation = stdDev(normalized.map((row) => Math.min(Number(row.portfolioReturn) || 0, 0))) * Math.sqrt(252);
  const beta = (() => {
    const variance = covariance(normalized.map((row) => row.benchmarkReturn), normalized.map((row) => row.benchmarkReturn));
    if (variance === 0) return null;
    return covariance(normalized.map((row) => row.portfolioReturn), normalized.map((row) => row.benchmarkReturn)) / variance;
  })();
  const correlationToBenchmark = correlation(normalized.map((row) => row.portfolioReturn), normalized.map((row) => row.benchmarkReturn));
  const alpha = beta == null ? null : (annualizedReturn - (riskFreeRate + beta * (annualizedBenchmarkReturn - riskFreeRate)));
  const sharpeRatio = annualizedVolatility > 0 ? (annualizedReturn - riskFreeRate) / annualizedVolatility : null;
  const informationRatio = trackingError > 0 ? annualizeReturn(activeReturn, normalized.length) / trackingError : null;
  const sortinoRatio = downsideDeviation > 0 ? (annualizedReturn - riskFreeRate) / downsideDeviation : null;
  const cumulativeData = buildCumulativeReturnSeries(normalized).map((row, index) => ({
    ...row,
    date: normalized[index]?.date,
    active: row.portfolio - row.benchmark,
    label: fmt.shortDate(normalized[index]?.date),
  }));
  const drawdownSeries = buildReturnDrawdownSeries(normalized).map((row, index) => ({
    ...row,
    date: normalized[index]?.date,
    label: fmt.shortDate(normalized[index]?.date),
  }));
  const maxDrawdown = drawdownSeries.reduce((worst, row) => Math.min(worst, row.portfolioDrawdown), 0);
  const rollingVolSeries = buildRollingMetricSeries(normalized, Math.min(20, normalized.length), (slice) => stdDev(slice.map((row) => row.portfolioReturn)) * Math.sqrt(252));
  const rollingTrackingErrorSeries = buildRollingMetricSeries(normalized, Math.min(20, normalized.length), (slice) => stdDev(slice.map((row) => (Number(row.portfolioReturn) || 0) - (Number(row.benchmarkReturn) || 0))) * Math.sqrt(252));

  return {
    totalReturn,
    benchmarkReturn,
    activeReturn,
    annualizedReturn,
    annualizedBenchmarkReturn,
    annualizedVolatility,
    trackingError,
    sharpeRatio,
    informationRatio,
    maxDrawdown,
    beta,
    alpha,
    correlationToBenchmark,
    downsideDeviation,
    sortinoRatio,
    upCapture: computeCaptureRatio(normalized, "up"),
    downCapture: computeCaptureRatio(normalized, "down"),
    cumulativeData,
    drawdownSeries,
    rollingVolSeries,
    rollingTrackingErrorSeries,
  };
}

function buildConcentrationMetrics(activeStocks, nav, cashBalance) {
  const sorted = [...(activeStocks || [])].sort((left, right) => (right.weight || 0) - (left.weight || 0));
  const top5Weight = sorted.slice(0, 5).reduce((sum, holding) => sum + (holding.weight || 0), 0);
  const top10Weight = sorted.slice(0, 10).reduce((sum, holding) => sum + (holding.weight || 0), 0);
  const hhi = sorted.reduce((sum, holding) => sum + ((holding.weight || 0) ** 2), 0);
  const largest = sorted[0] || null;
  return {
    top5Weight,
    top10Weight,
    hhi,
    largestHolding: largest,
    cashWeight: nav > 0 ? cashBalance / nav : 0,
    activeCount: sorted.length,
  };
}

function toCsv(rows) {
  return rows.map((row) => row.map((cell) => {
    const value = cell == null ? "" : String(cell);
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(",")).join("\n");
}

function formatComparableDelta(current, previous, formatter) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const delta = current - previous;
  const sign = delta > 0 ? "+" : "";
  return `vs prior ${sign}${formatter(delta)}`;
}

function formatPriceUpdateLabel(payload) {
  const stamp = payload?.updated ? new Date(payload.updated) : new Date();
  return `${stamp.toLocaleTimeString()} (${payload?.count || 0})`;
}

// ═══════════════════════════════════════════════════════════════════
// DATABASE HOOK — group-aware snapshot state plus manual price refresh
// ═══════════════════════════════════════════════════════════════════

function useDatabase(group) {
  const [holdings, setHL] = useState([]);
  const [settings, setSL] = useState({ benchmarkVol:0.122, portfolioVol:0.168, riskFreeRate:0.045, spyWeeklyReturn:-0.01508, iveWeeklyReturn:0.005, mtumWeeklyReturn:0.008, cashBalance:0, warningThreshold:0.85, stopLossWarningBuffer:0.05, limits:{ dailyVaR95:0.025, trackingError:0.06, betaDeviation:0.3, systematicVol:0.2, maxStockWeight:0.08, spyWeight:0.5 } });
  const [dailyHistory, setDH] = useState([]);
  const [weeklyHistory, setWL] = useState([]);
  const [report, setRL] = useState("");
  const [reportMeta, setRML] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [priceLoading, setPL] = useState(false);
  const [lastPriceUpdate, setLPU] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setPL(true);
    setLPU(null);
    (async () => {
      try {
        const [hR,sR,wR,rR] = await Promise.all([
          fetch(`/api/holdings?group=${group}`).then(r=>r.json()).catch(()=>({holdings:[]})),
          fetch(`/api/settings?group=${group}`).then(r=>r.json()).catch(()=>({settings:{}})),
          fetch(`/api/history?group=${group}`).then(r=>r.json()).catch(()=>({history:[],dailyHistory:[]})),
          fetch(`/api/report?group=${group}`).then(r=>r.json()).catch(()=>({content:"",meta:{}})),
        ]);
        let nextHoldings = hR.holdings || [];
        const nextSettings = sR.settings && Object.keys(sR.settings).length ? sR.settings : { benchmarkVol:0.122, portfolioVol:0.168, riskFreeRate:0.045, spyWeeklyReturn:-0.01508, iveWeeklyReturn:0.005, mtumWeeklyReturn:0.008, cashBalance:0, warningThreshold:0.85, stopLossWarningBuffer:0.05, limits:{ dailyVaR95:0.025, trackingError:0.06, betaDeviation:0.3, systematicVol:0.2, maxStockWeight:0.08, spyWeight:0.5 } };
        const nextDailyHistory = normalizeDailyHistoryRows(wR.dailyHistory || []);
        const nextWeeklyHistory = normalizeWeeklyHistoryRows(wR.history || []);
        const nextReport = rR.content || "";
        const nextReportMeta = rR.meta || {};

        try {
          const priceResponse = await fetch("/api/prices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ group }),
          });
          const pricePayload = await priceResponse.json();
          if (!priceResponse.ok) throw new Error(pricePayload.error || "Price refresh failed");
          const liveQuotes = pricePayload.quotes || pricePayload.prices;
          if (pricePayload.count > 0) {
            nextHoldings = applyPricesToHoldings(nextHoldings, liveQuotes);
            if (pricePayload.dbUpdated) {
              const fresh = await fetch(`/api/holdings?group=${group}`).then((response) => response.json()).catch(() => ({ holdings: nextHoldings }));
              nextHoldings = applyPricesToHoldings(fresh.holdings || nextHoldings, liveQuotes);
            }
            if (!cancelled) setLPU(formatPriceUpdateLabel(pricePayload));
          }
        } catch (error) {
          console.error("Auto price refresh:", error);
        } finally {
          if (!cancelled) setPL(false);
        }

        if (cancelled) return;
        setHL(nextHoldings);
        setSL(nextSettings);
        setDH(nextDailyHistory);
        setWL(nextWeeklyHistory);
        setRL(nextReport);
        setRML(nextReportMeta);
      } catch (e) { console.error("DB load:", e); }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [group]);

  const setHoldings = useCallback(async (newH) => {
    setHL(newH);
    try { await fetch("/api/holdings", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ holdings:newH, group }) }); } catch {}
  }, [group]);

  const setSettings = useCallback(async (newS) => {
    setSL(newS);
    try { await fetch("/api/settings", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ settings:newS, group }) }); } catch {}
  }, [group]);

  const setWeeklyHistory = useCallback(async (newW) => {
    const normalized = normalizeWeeklyHistoryRows(newW);
    setWL(normalized);
    try { await fetch("/api/history", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ history:normalized, dailyHistory, group }) }); } catch {}
  }, [dailyHistory, group]);

  const setDailyHistory = useCallback(async (newD) => {
    const normalized = normalizeDailyHistoryRows(newD);
    setDH(normalized);
    try { await fetch("/api/history", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ history:weeklyHistory, dailyHistory:normalized, group }) }); } catch {}
  }, [group, weeklyHistory]);

  const setReport = useCallback(async (c) => {
    setRL(c);
    try { await fetch("/api/report", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ content:c, group }) }); } catch {}
  }, [group]);

  const setReportMeta = useCallback(async (m) => {
    setRML(m);
    try { await fetch("/api/report", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ content:report, meta:m, group }) }); } catch {}
  }, [group, report]);

  const refreshPrices = useCallback(async () => {
    setPL(true);
    try {
      const r = await fetch("/api/prices", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ group }) });
      const d = await r.json();
      const liveQuotes = d.quotes || d.prices;
      if (d.count > 0) {
        setHL((current) => applyPricesToHoldings(current, liveQuotes));
        if (d.dbUpdated) {
          const fresh = await fetch(`/api/holdings?group=${group}`).then(r=>r.json());
          setHL(applyPricesToHoldings(fresh.holdings || [], liveQuotes));
        }
        setLPU(formatPriceUpdateLabel(d));
      } else alert("No prices returned. Yahoo may be blocking.");
    } catch (e) { alert("Price error: " + e.message); }
    setPL(false);
  }, [group]);

  return { loaded, holdings, settings, dailyHistory, weeklyHistory, report, reportMeta, setHoldings, setSettings, setDailyHistory, setWeeklyHistory, setReport, setReportMeta, priceLoading, lastPriceUpdate, refreshPrices };
}

function buildRiskHoldingsPayload(holdings) {
  return holdings
    .filter((holding) => holding.status === "active" && holding.ticker)
    .map((holding) => ({
      id: holding.id,
      ticker: holding.ticker,
      theme: holding.theme,
      subTheme: holding.subTheme,
      currentPrice: holding.currentPrice,
      buyPrice: holding.buyPrice,
      shares: holding.shares,
      status: holding.status,
    }))
    .sort((left, right) => {
      const leftKey = `${left.ticker}|${left.id}|${left.theme}|${left.subTheme}`;
      const rightKey = `${right.ticker}|${right.id}|${right.theme}|${right.subTheme}`;
      return leftKey.localeCompare(rightKey);
    });
}

function buildRiskRequestKey(activeRiskHoldings) {
  return JSON.stringify(activeRiskHoldings.map((holding) => ([
    holding.id,
    holding.ticker,
    holding.currentPrice,
    holding.buyPrice,
    holding.shares,
    holding.theme,
    holding.subTheme,
  ])));
}

function useRiskAnalytics(group, holdings) {
  const activeRiskHoldings = useMemo(() => buildRiskHoldingsPayload(holdings), [holdings]);
  const riskRequestKey = useMemo(() => buildRiskRequestKey(activeRiskHoldings), [activeRiskHoldings]);
  const [riskData, setRiskData] = useState(null);
  const [riskError, setRiskError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!activeRiskHoldings.length) {
      setRiskData(null);
      setRiskError(null);
      return () => { cancelled = true; };
    }

    setRiskError(null);
    (async () => {
      try {
        const response = await fetch("/api/risk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ group, holdings: activeRiskHoldings }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Risk analytics failed");
        if (!cancelled) {
          setRiskData({ ...data, requestKey: riskRequestKey });
          setRiskError(null);
        }
      } catch (error) {
        if (!cancelled) setRiskError(error.message || "Risk analytics failed");
      }
    })();

    return () => { cancelled = true; };
  }, [group, activeRiskHoldings, riskRequestKey]);

  const activeAnalytics = riskData?.requestKey === riskRequestKey ? riskData : null;

  return {
    analytics: activeAnalytics,
    staleAnalytics: activeAnalytics ? null : riskData,
    error: riskError,
    isLoading: activeRiskHoldings.length > 0 && !activeAnalytics && !riskError,
    isRefreshing: !!riskData && riskData.requestKey !== riskRequestKey,
  };
}

// ═══════════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════

const Card = ({ children, className = "" }) => <div className={`bg-white rounded-lg border border-slate-200 shadow-sm ${className}`}>{children}</div>;

function downloadFile(filename, content, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copyPlainText(content) {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(content);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function buildPythonScript(description, payload, bodyLines) {
  const payloadJson = JSON.stringify(payload, null, 2);
  return [
    "# Auto-generated by Stern Dashboard metric detail",
    `# ${description}`,
    "import json",
    "from math import fsum, sqrt",
    "from statistics import stdev",
    "",
    `data = json.loads(r'''${payloadJson}''')`,
    "",
    ...bodyLines,
    "",
  ].join("\n");
}

function formatDetailForClipboard(detail) {
  const sections = [
    [`Metric`, [`${detail.title}: ${detail.displayedValue}${detail.displayedSub ? ` (${detail.displayedSub})` : ""}`]],
    detail.source ? [`Source`, [detail.source]] : null,
    detail.formula?.length ? [`Formula`, detail.formula] : null,
    detail.inputs?.length ? [`Current Inputs`, detail.inputs] : null,
    detail.calculation?.length ? [`Calculation`, detail.calculation] : null,
    detail.notes?.length ? [`Notes`, detail.notes] : null,
  ].filter(Boolean);
  return sections
    .map(([title, lines]) => `${title}\n${lines.map((line) => `- ${line}`).join("\n")}`)
    .join("\n\n");
}

function CalculationDetailButton({ detail }) {
  const [open, setOpen] = useState(false);
  const [copiedState, setCopiedState] = useState("");

  useEffect(() => {
    if (!copiedState) return undefined;
    const timer = setTimeout(() => setCopiedState(""), 1500);
    return () => clearTimeout(timer);
  }, [copiedState]);

  if (!detail) return null;

  const handleCopyDetail = async () => {
    try {
      await copyPlainText(formatDetailForClipboard(detail));
      setCopiedState("details");
    } catch {
      setCopiedState("copy failed");
    }
  };

  const handleCopyPython = async () => {
    try {
      await copyPlainText(detail.pythonSource);
      setCopiedState("python");
    } catch {
      setCopiedState("copy failed");
    }
  };

  const handleDownloadPython = () => {
    downloadFile(detail.pythonFileName, detail.pythonSource, "text/x-python;charset=utf-8");
    setCopiedState("downloaded");
  };

  return <>
    <button onClick={() => setOpen(true)} className="px-2.5 py-1.5 text-[11px] font-medium rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50">Detail</button>
    {open && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={() => setOpen(false)}>
      <div className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Calculation Detail</p>
              <h3 className="mt-1 text-sm font-bold text-slate-900">{detail.title}</h3>
              <p className="mt-1 text-lg font-bold text-slate-900">{detail.displayedValue}</p>
              {detail.displayedSub && <p className="text-xs text-slate-500 mt-0.5">{detail.displayedSub}</p>}
              {detail.source && <p className="text-[11px] text-slate-500 mt-2">{detail.source}</p>}
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={16}/></button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={handleCopyDetail} className="px-2.5 py-1.5 text-[11px] font-medium rounded-md border border-slate-300 text-slate-700 hover:bg-white">Copy Details</button>
            <button onClick={handleCopyPython} className="px-2.5 py-1.5 text-[11px] font-medium rounded-md border border-slate-300 text-slate-700 hover:bg-white">Copy .py</button>
            <button onClick={handleDownloadPython} className="px-2.5 py-1.5 text-[11px] font-medium rounded-md bg-slate-800 text-white hover:bg-slate-700">Download .py</button>
            {copiedState && <span className="inline-flex items-center px-2 py-1 text-[11px] rounded-md bg-emerald-50 text-emerald-700">{copiedState}</span>}
          </div>
        </div>
        <div className="max-h-[calc(85vh-8rem)] overflow-y-auto p-4 space-y-3">
          {detail.formula?.length > 0 && <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Formula</p>
            <div className="space-y-1 font-mono text-[11px] leading-5 text-slate-700">{detail.formula.map((line) => <p key={line}>{line}</p>)}</div>
          </div>}
          {detail.inputs?.length > 0 && <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Current Inputs</p>
            <div className="space-y-1 font-mono text-[11px] leading-5 text-slate-700">{detail.inputs.map((line) => <p key={line}>{line}</p>)}</div>
          </div>}
          {detail.calculation?.length > 0 && <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Calculation</p>
            <div className="space-y-1 font-mono text-[11px] leading-5 text-slate-700">{detail.calculation.map((line) => <p key={line}>{line}</p>)}</div>
          </div>}
          {detail.notes?.length > 0 && <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Notes</p>
            <div className="space-y-1 text-[11px] leading-5 text-slate-600">{detail.notes.map((line) => <p key={line}>{line}</p>)}</div>
          </div>}
        </div>
      </div>
    </div>}
  </>;
}

function MiniSparkline({ values = [], color = "#1e3a5f" }) {
  const cleaned = (values || []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (cleaned.length < 2) return <div className="h-8 rounded-lg bg-slate-50"/>;
  const min = Math.min(...cleaned);
  const max = Math.max(...cleaned);
  const range = max - min || 1;
  const points = cleaned.map((value, index) => {
    const x = (index / (cleaned.length - 1)) * 100;
    const y = 100 - (((value - min) / range) * 100);
    return `${x},${y}`;
  }).join(" ");
  return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-8 w-full">
    <polyline fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" points={points}/>
  </svg>;
}

const StatCard = ({ label, value, sub, icon: Icon, trend, color = "text-slate-700", tooltip, editable, onEdit, detail, compact = false, delta, sparklineData, sparklineColor, footerLabel }) => {
  const [show, setShow] = useState(false);
  const [ev, setEv] = useState("");
  const [hoverOpen, setHoverOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [copiedState, setCopiedState] = useState("");
  const [detailSide, setDetailSide] = useState("right");
  const cardRef = useRef(null);
  const openTimerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const copiedTimerRef = useRef(null);
  const hasDetail = !!detail;
  const showDetail = hasDetail && (hoverOpen || pinned);

  const clearHoverTimers = () => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  };

  const setCopied = (value) => {
    setCopiedState(value);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedState(""), 1400);
  };

  useEffect(() => () => {
    clearHoverTimers();
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);

  useEffect(() => {
    if (!showDetail || !cardRef.current || typeof window === "undefined") return undefined;
    const updatePlacement = () => {
      const rect = cardRef.current.getBoundingClientRect();
      const panelWidth = Math.min(480, window.innerWidth - 32);
      const overflowsRight = rect.left + panelWidth > window.innerWidth - 16;
      setDetailSide(overflowsRight ? "left" : "right");
    };
    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    return () => window.removeEventListener("resize", updatePlacement);
  }, [showDetail]);

  const openDetail = () => {
    if (!hasDetail) return;
    clearHoverTimers();
    openTimerRef.current = setTimeout(() => setHoverOpen(true), 100);
  };

  const closeDetail = () => {
    if (!hasDetail) return;
    clearHoverTimers();
    if (!pinned) closeTimerRef.current = setTimeout(() => setHoverOpen(false), 120);
  };

  const handleCardClick = () => {
    if (hasDetail) {
      clearHoverTimers();
      setPinned((current) => {
        const next = !current;
        setHoverOpen(next);
        return next;
      });
      return;
    }
    if (tooltip || editable) {
      setEv(typeof value==="string"?value.replace(/[^0-9.\-]/g,""):String(value));
      setShow(true);
    }
  };

  const handleCopyDetail = async (event) => {
    event.stopPropagation();
    try {
      await copyPlainText(formatDetailForClipboard(detail));
      setCopied("details");
    } catch {
      setCopied("copy failed");
    }
  };

  const handleCopyPython = async (event) => {
    event.stopPropagation();
    try {
      await copyPlainText(detail.pythonSource);
      setCopied("python");
    } catch {
      setCopied("copy failed");
    }
  };

  const handleDownloadPython = (event) => {
    event.stopPropagation();
    downloadFile(detail.pythonFileName, detail.pythonSource, "text/x-python;charset=utf-8");
    setCopied("downloaded");
  };

  return (<>
    <div ref={cardRef} className="relative h-full" onMouseEnter={openDetail} onMouseLeave={closeDetail}>
    <Card className={`h-full ${compact ? "p-3" : "p-4"} hover:shadow-md transition-shadow ${(tooltip||editable||hasDetail)?"cursor-pointer":""} ${compact ? "min-h-[5.5rem]" : hasDetail ? "min-h-[7.75rem]" : "min-h-[7rem]"}`} onClick={handleCardClick}>
      <div className="flex h-full flex-col justify-between">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
            <p className={`${compact ? "text-base" : "text-lg"} font-bold ${color}`}>{value}</p>
            <p className={`mt-0.5 ${compact ? "min-h-[1rem]" : "min-h-[1.5rem]"} text-xs ${trend==="up"?"text-emerald-600":trend==="down"?"text-red-500":"text-slate-500"}`}>{sub || " "}</p>
          </div>
          {Icon && <div className={`rounded-lg bg-slate-50 ${compact ? "p-1.5" : "p-2"}`}><Icon size={compact ? 14 : 16} className="text-slate-400" /></div>}
        </div>
        <div className={`${compact ? "min-h-[0.25rem] pt-1" : "min-h-[1rem] pt-2"} space-y-2`}>
          {sparklineData?.length > 1 ? <MiniSparkline values={sparklineData} color={sparklineColor || (trend === "down" ? "#dc2626" : "#1e3a5f")}/> : null}
          {(delta || footerLabel || hasDetail) ? <div className="flex items-center justify-between gap-2">
            <p className={`text-[10px] font-medium ${delta ? (delta.startsWith("-") ? "text-red-500" : "text-emerald-600") : "text-slate-400"}`}>{delta || (hasDetail ? "Hover or click for formula" : " ")}</p>
            {footerLabel ? <span className="text-[10px] text-slate-400">{footerLabel}</span> : null}
          </div> : null}
        </div>
      </div>
    </Card>
    {showDetail && <div className={`absolute top-full z-[90] mt-2 w-[min(30rem,calc(100vw-2rem))] ${detailSide === "left" ? "right-0" : "left-0"}`} onMouseEnter={openDetail} onMouseLeave={closeDetail}>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{detail.sectionLabel || "Overview Formula"}</p>
              <h3 className="mt-1 text-sm font-bold text-slate-900">{detail.title}</h3>
              <p className={`mt-1 text-lg font-bold ${color}`}>{detail.displayedValue}</p>
              {detail.displayedSub && <p className="text-xs text-slate-500 mt-0.5">{detail.displayedSub}</p>}
              {detail.source && <p className="text-[11px] text-slate-500 mt-2">{detail.source}</p>}
            </div>
            <button onClick={(event)=>{event.stopPropagation(); setPinned(false); setHoverOpen(false);}} className="text-slate-400 hover:text-slate-600">
              <X size={16}/>
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={handleCopyDetail} className="px-2.5 py-1.5 text-[11px] font-medium rounded-md border border-slate-300 text-slate-700 hover:bg-white">Copy Details</button>
            <button onClick={handleCopyPython} className="px-2.5 py-1.5 text-[11px] font-medium rounded-md border border-slate-300 text-slate-700 hover:bg-white">Copy .py</button>
            <button onClick={handleDownloadPython} className="px-2.5 py-1.5 text-[11px] font-medium rounded-md bg-slate-800 text-white hover:bg-slate-700">Download .py</button>
            {copiedState && <span className="inline-flex items-center px-2 py-1 text-[11px] rounded-md bg-emerald-50 text-emerald-700">{copiedState}</span>}
          </div>
        </div>
        <div className="max-h-[28rem] overflow-y-auto p-4 space-y-3">
          {detail.formula?.length > 0 && <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Formula</p>
            <div className="space-y-1 font-mono text-[11px] leading-5 text-slate-700">
              {detail.formula.map((line)=><p key={line}>{line}</p>)}
            </div>
          </div>}
          {detail.inputs?.length > 0 && <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Current Inputs</p>
            <div className="space-y-1 font-mono text-[11px] leading-5 text-slate-700">
              {detail.inputs.map((line)=><p key={line}>{line}</p>)}
            </div>
          </div>}
          {detail.calculation?.length > 0 && <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Calculation</p>
            <div className="space-y-1 font-mono text-[11px] leading-5 text-slate-700">
              {detail.calculation.map((line)=><p key={line}>{line}</p>)}
            </div>
          </div>}
          {detail.notes?.length > 0 && <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">Notes</p>
            <div className="space-y-1 text-[11px] leading-5 text-slate-600">
              {detail.notes.map((line)=><p key={line}>{line}</p>)}
            </div>
          </div>}
        </div>
      </div>
    </div>}
    </div>
    {show && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={()=>setShow(false)}>
      <div className="bg-white rounded-xl shadow-2xl border p-6 w-full max-w-sm mx-4" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-bold text-slate-800">{label}</h3><button onClick={()=>setShow(false)} className="text-slate-400 hover:text-slate-600"><X size={18}/></button></div>
        <p className={`text-2xl font-bold ${color} mb-2`}>{value}</p>
        {tooltip && <div className="mb-4 p-3 bg-slate-50 rounded-lg"><p className="text-xs text-slate-500 font-medium mb-1">Details</p><p className="text-sm text-slate-700 whitespace-pre-wrap">{tooltip}</p></div>}
        {editable && onEdit && <div className="mb-4"><p className="text-xs text-slate-500 mb-1">Edit Value</p><div className="flex gap-2"><input type="number" step="any" value={ev} onChange={e=>setEv(e.target.value)} className="flex-1 px-3 py-2 text-sm border rounded-lg" /><button onClick={()=>{onEdit(parseFloat(ev)||0);setShow(false);}} className="px-4 py-2 bg-slate-800 text-white text-sm rounded-lg">Save</button></div></div>}
        <button onClick={()=>setShow(false)} className="w-full py-2 text-sm text-slate-500 border rounded-lg">Close</button>
      </div>
    </div>}
  </>);
};

const Badge = ({ status, small }) => {
  const cls = status==="BREACH"?"bg-red-100 text-red-700 border-red-200":status==="WARNING"?"bg-amber-100 text-amber-700 border-amber-200":status==="active"?"bg-emerald-100 text-emerald-700 border-emerald-200":status==="exited"?"bg-slate-100 text-slate-600 border-slate-300":"bg-emerald-100 text-emerald-700 border-emerald-200";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${cls} ${small?"text-[10px] px-1.5":""}`}>{status}</span>;
};

const ThemeBadge = ({ theme }) => {
  const c = THEME_COLORS[theme] || "#64748b";
  return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold" style={{backgroundColor:c+"18",color:c,border:`1px solid ${c}33`}}><span className="w-2 h-2 rounded-full flex-shrink-0" style={{backgroundColor:c}}/>{theme}</span>;
};

const TabButton = ({active,children,onClick}) => <button onClick={onClick} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${active?"bg-slate-800 text-white shadow-sm":"text-slate-600 hover:bg-slate-100"}`}>{children}</button>;

const SectionHeader = ({title,subtitle,children}) => <div className="flex items-center justify-between mb-4"><div><h2 className="text-lg font-bold text-slate-800">{title}</h2>{subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}</div>{children && <div className="flex items-center gap-2">{children}</div>}</div>;

function OverviewHeaderBar({ range, setRange, customRange, setCustomRange, relativeView, setRelativeView, benchmark, setBenchmark, lastPriceUpdate, onExportCsv, onExportPdf, benchmarkOptions }) {
  return <Card className="p-4">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Overview Control Bar</p>
        <h3 className="mt-1 text-xl font-bold text-slate-900">Overview</h3>
        <p className="mt-1 text-sm text-slate-500">Institutional performance, benchmark-relative attribution, and risk monitoring in one screen.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {lastPriceUpdate && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Updated {lastPriceUpdate}</span>}
        <button onClick={onExportCsv} className="flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"><Download size={12}/> CSV</button>
        <button onClick={onExportPdf} className="flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"><Printer size={12}/> PDF</button>
      </div>
    </div>
    <div className="mt-4 grid gap-3 xl:grid-cols-[1.2fr_0.85fr_0.75fr]">
      <div className="rounded-2xl border border-slate-200 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Date Range</p>
        <div className="flex flex-wrap gap-1.5">
          {OVERVIEW_RANGE_OPTIONS.map((option) => <button key={option.key} onClick={() => setRange(option.key)} className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${range === option.key ? "bg-slate-800 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{option.label}</button>)}
        </div>
        {range === "CUSTOM" && <div className="mt-3 grid grid-cols-2 gap-2">
          <input type="date" value={customRange.start} onChange={(event) => setCustomRange((current) => ({ ...current, start: event.target.value }))} className="rounded-md border border-slate-300 px-3 py-2 text-xs"/>
          <input type="date" value={customRange.end} onChange={(event) => setCustomRange((current) => ({ ...current, end: event.target.value }))} className="rounded-md border border-slate-300 px-3 py-2 text-xs"/>
        </div>}
      </div>
      <div className="rounded-2xl border border-slate-200 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Benchmark &amp; View</p>
        <div className="flex flex-col gap-2">
          <select value={benchmark} onChange={(event) => setBenchmark(event.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-700">
            {benchmarkOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-1">
            <button onClick={() => setRelativeView(false)} className={`rounded px-3 py-1.5 text-xs font-medium ${!relativeView ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>Absolute</button>
            <button onClick={() => setRelativeView(true)} className={`rounded px-3 py-1.5 text-xs font-medium ${relativeView ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}>Relative</button>
          </div>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">View Context</p>
        <p className="text-sm font-medium text-slate-800">{benchmarkOptions.find((option) => option.value === benchmark)?.label || "Benchmark"}</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">{relativeView ? "Charts and heatmap emphasize active return and spread versus benchmark." : "Charts show absolute portfolio and benchmark paths with benchmark-relative context in the tooltip."}</p>
      </div>
    </div>
  </Card>;
}

function MonthlyReturnHeatmap({ matrix, relativeView }) {
  const [hovered, setHovered] = useState(null);
  const activeValue = hovered ? (relativeView ? hovered.activeReturn : hovered.portfolioReturn) : null;
  return <Card className="p-4">
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        <h4 className="text-sm font-semibold text-slate-700">Monthly Return Heatmap</h4>
        <p className="text-xs text-slate-500">{relativeView ? "Active return by month" : "Portfolio return by month"} with benchmark context on hover.</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 min-w-[12rem]">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{hovered ? hovered.label : "Hover a month"}</p>
        <p className={`mt-1 text-base font-bold ${activeValue >= 0 ? "text-emerald-700" : "text-red-600"}`}>{hovered ? fmt.pct(relativeView ? hovered.activeReturn : hovered.portfolioReturn) : "—"}</p>
        <p className="text-[11px] text-slate-500">{hovered ? `Benchmark ${fmt.pct(hovered.benchmarkReturn)} · Active ${fmt.pct(hovered.activeReturn)}` : "Portfolio / benchmark / active return"}</p>
      </div>
    </div>
    <div className="overflow-x-auto">
      <div className="min-w-[44rem]">
        <div className="grid grid-cols-[5rem_repeat(12,minmax(0,1fr))] gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
          <div/>
          {HEATMAP_MONTH_LABELS.map((month) => <div key={month} className="px-2 py-1 text-center">{month}</div>)}
        </div>
        <div className="space-y-1">
          {matrix.map((row) => <div key={row.year} className="grid grid-cols-[5rem_repeat(12,minmax(0,1fr))] gap-1">
            <div className="flex items-center px-2 text-xs font-semibold text-slate-600">{row.year}</div>
            {row.months.map((month, index) => {
              const value = month ? (relativeView ? month.activeReturn : month.portfolioReturn) : null;
              const intensity = value == null ? 0 : Math.min(Math.abs(value) / 0.12, 1);
              const background = value == null
                ? "rgba(241,245,249,0.9)"
                : value >= 0
                  ? `rgba(5,150,105,${0.14 + intensity * 0.56})`
                  : `rgba(220,38,38,${0.14 + intensity * 0.56})`;
              return <button
                key={`${row.year}-${index}`}
                type="button"
                onMouseEnter={() => setHovered(month)}
                onFocus={() => setHovered(month)}
                onMouseLeave={() => setHovered(null)}
                onBlur={() => setHovered(null)}
                title={month ? `${month.label}: Portfolio ${fmt.pct(month.portfolioReturn)}, Benchmark ${fmt.pct(month.benchmarkReturn)}, Active ${fmt.pct(month.activeReturn)}` : "No data"}
                className="h-10 rounded-md border border-white/70 text-[11px] font-semibold text-slate-800"
                style={{ backgroundColor: background }}
              >
                {month ? fmt.pct(value, 1) : "—"}
              </button>;
            })}
          </div>)}
        </div>
      </div>
    </div>
  </Card>;
}

function PMInsightsPanel({ insights }) {
  if (!insights?.length) return null;
  return <Card className="p-4">
    <h4 className="text-sm font-semibold text-slate-700">PM Insights</h4>
    <p className="mt-1 text-xs text-slate-500">Generated from current performance, attribution, concentration, and risk diagnostics.</p>
    <ul className="mt-3 space-y-2">
      {insights.map((insight) => <li key={insight} className="flex items-start gap-2 text-sm leading-6 text-slate-700"><span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-400"/><span>{insight}</span></li>)}
    </ul>
  </Card>;
}

function PerformanceSummaryCard({ summary }) {
  const rows = [
    { label: "YTD Return", value: fmt.pct(summary.ytdReturn), tone: summary.ytdReturn >= 0 ? "text-emerald-700" : "text-red-600" },
    { label: "Since Inception", value: fmt.pct(summary.sinceInceptionReturn), tone: summary.sinceInceptionReturn >= 0 ? "text-emerald-700" : "text-red-600" },
    { label: "Best Month", value: summary.bestMonth ? `${summary.bestMonth.label} · ${fmt.pct(summary.bestMonth.portfolioReturn)}` : "—", tone: "text-slate-800" },
    { label: "Worst Month", value: summary.worstMonth ? `${summary.worstMonth.label} · ${fmt.pct(summary.worstMonth.portfolioReturn)}` : "—", tone: "text-slate-800" },
    { label: "Hit Rate", value: fmt.pct(summary.hitRate), tone: "text-slate-800" },
    { label: "Up Capture", value: summary.upCapture == null ? "—" : fmt.num(summary.upCapture, 2), tone: "text-slate-800" },
    { label: "Down Capture", value: summary.downCapture == null ? "—" : fmt.num(summary.downCapture, 2), tone: "text-slate-800" },
    { label: "Drawdown From Peak", value: fmt.pct(summary.currentDrawdown), tone: summary.currentDrawdown >= 0 ? "text-emerald-700" : "text-red-600" },
  ];
  return <Card className="p-4">
    <h4 className="text-sm font-semibold text-slate-700">Performance Summary</h4>
    <p className="mt-1 text-xs text-slate-500">YTD, since-inception, and capture stats from the current performance history.</p>
    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
      {rows.map((row) => <div key={row.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{row.label}</p>
        <p className={`mt-1 text-sm font-bold ${row.tone}`}>{row.value}</p>
      </div>)}
    </div>
  </Card>;
}

function HoldingsOverviewTable({ rows, search, setSearch, sortKey, sortDir, onSort, selectedTheme, clearTheme }) {
  const columns = [
    { key: "ticker", label: "Ticker" },
    { key: "company", label: "Company" },
    { key: "theme", label: "Theme" },
    { key: "weight", label: "Weight", format: (value) => fmt.pct(value, 1) },
    { key: "activeWeight", label: "Active Wt", format: (value) => fmt.pct(value, 1) },
    { key: "currentPrice", label: "Price", format: (value) => fmt.usdExact(value) },
    { key: "dailyReturn", label: "Daily %", format: (value) => fmt.pct(value, 1) },
    { key: "totalReturnPct", label: "Total Return %", format: (value) => fmt.pct(value, 1) },
    { key: "contributionToReturn", label: "Ctrb. Return", format: (value) => fmt.pct(value, 2) },
    { key: "riskContribution", label: "Ctrb. Risk", format: (value) => value == null ? "—" : fmt.pct(value, 2) },
    { key: "pnlDollar", label: "P/L", format: (value) => fmt.usd(value) },
    { key: "positionValue", label: "Market Value", format: (value) => fmt.usd(value) },
  ];
  return <Card className="p-5">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between mb-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-700">Holdings Overview Table</h3>
        <p className="text-xs text-slate-500">Filterable view of the live book with return and risk contribution columns.</p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-2 text-slate-400"/>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search holdings..." className="w-48 rounded-md border border-slate-300 py-1.5 pl-7 pr-3 text-sm"/>
        </div>
        {selectedTheme && <button onClick={clearTheme} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Clear theme filter</button>}
      </div>
    </div>
    <div className="max-h-[28rem] overflow-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[78rem] text-xs">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-slate-200 bg-slate-50">
            {columns.map((column) => <th key={column.key} onClick={() => onSort(column.key)} className="cursor-pointer px-3 py-2 text-left font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-700">{column.label}{sortKey === column.key ? (sortDir === 1 ? " ↑" : " ↓") : ""}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
            <td className="px-3 py-2 font-semibold text-slate-800">{row.ticker}</td>
            <td className="px-3 py-2 text-slate-600">{row.company}</td>
            <td className="px-3 py-2"><ThemeBadge theme={row.theme}/></td>
            <td className="px-3 py-2 text-slate-600">{fmt.pct(row.weight, 1)}</td>
            <td className={`px-3 py-2 font-medium ${row.activeWeight >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(row.activeWeight, 1)}</td>
            <td className="px-3 py-2 text-slate-600">{fmt.usdExact(row.currentPrice)}</td>
            <td className={`px-3 py-2 font-medium ${row.dailyReturn >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(row.dailyReturn, 1)}</td>
            <td className={`px-3 py-2 font-medium ${row.totalReturnPct >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(row.totalReturnPct, 1)}</td>
            <td className={`px-3 py-2 font-medium ${row.contributionToReturn >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(row.contributionToReturn, 2)}</td>
            <td className={`px-3 py-2 font-medium ${row.riskContribution >= 0 ? "text-emerald-600" : row.riskContribution < 0 ? "text-red-500" : "text-slate-500"}`}>{row.riskContribution == null ? "—" : fmt.pct(row.riskContribution, 2)}</td>
            <td className={`px-3 py-2 font-medium ${row.pnlDollar >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.usd(row.pnlDollar)}</td>
            <td className="px-3 py-2 font-medium text-slate-800">{fmt.usd(row.positionValue)}</td>
          </tr>)}
          {!rows.length && <tr><td colSpan={12} className="px-3 py-8 text-center text-sm text-slate-500">No holdings match the current filter.</td></tr>}
        </tbody>
      </table>
    </div>
  </Card>;
}

const CustomTooltip = ({active,payload,label,formatter}) => {
  if(!active||!payload) return null;
  return <div className="bg-white border rounded-lg shadow-lg p-3 text-xs"><p className="font-semibold text-slate-700 mb-1">{label}</p>{payload.map((p,i)=><p key={i} style={{color:p.color}} className="flex justify-between gap-4"><span>{p.name}:</span><span className="font-medium">{formatter?formatter(p.value):typeof p.value==="number"&&Math.abs(p.value)<1?fmt.pct(p.value):fmt.num(p.value)}</span></p>)}</div>;
};

function NewsFeed({ tickers }) {
  const [news,setNews]=useState([]);const [loading,setL]=useState(false);const [err,setE]=useState(null);
  const fetch_ = useCallback(async()=>{setL(true);setE(null);try{const r=await fetch("/api/news",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tickers:tickers.slice(0,15)})});if(r.ok){const d=await r.json();setNews(d.news||[]);if(!d.news?.length)setE("No news. Click refresh.");}else setE("Error.");}catch{setE("Cannot connect.");}setL(false);},[tickers]);
  useEffect(()=>{
    const timer = setTimeout(() => { void fetch_(); }, 0);
    return () => clearTimeout(timer);
  },[fetch_]);
  const sc=s=>s==="positive"?"text-emerald-600 bg-emerald-50":s==="negative"?"text-red-600 bg-red-50":"text-slate-600 bg-slate-50";
  return <Card className="p-4">
    <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2"><Newspaper size={16}/> News</h3><button onClick={fetch_} disabled={loading} className="flex items-center gap-1 px-2 py-1 text-xs border rounded-md hover:bg-slate-50 disabled:opacity-50">{loading?<Loader2 size={12} className="animate-spin"/>:<RefreshCw size={12}/>} Refresh</button></div>
    {loading && <div className="flex items-center justify-center py-8"><Loader2 size={20} className="animate-spin text-slate-400"/><span className="ml-2 text-sm text-slate-500">Fetching...</span></div>}
    {err && !loading && <p className="text-sm text-slate-500 py-4 text-center">{err}</p>}
    {!loading && news.length>0 && <div className="space-y-3 max-h-[320px] overflow-y-auto">{news.map((n,i)=><a key={i} href={n.link||"#"} target="_blank" rel="noopener noreferrer" className="block p-3 border border-slate-100 rounded-lg hover:bg-slate-50"><div className="flex items-start justify-between gap-2"><p className="text-sm font-medium text-slate-800">{n.title}</p><span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${sc(n.sentiment)}`}>{n.sentiment}</span></div><p className="text-xs text-slate-500 mt-1">{n.summary}</p><div className="flex items-center gap-2 mt-2">{n.tickers?.map(t=><span key={t} className="text-[10px] font-semibold bg-slate-100 px-1.5 py-0.5 rounded">{t}</span>)}</div></a>)}</div>}
  </Card>;
}

function computeHoldings(holdings, settings) {
  const active = holdings.filter(h => h.status === "active");
  const exited = holdings
    .filter(h => h.status === "exited")
    .map((holding) => {
      const costBasis = holdingCostBasis(holding);
      const pnlDollar = realizedPnlDollar(holding);
      return {
        ...holding,
        costBasis,
        positionValue: exitedPositionValue(holding),
        pnlDollar,
        pnlPercent: realizedPnlPercent(holding),
      };
    });
  const investedVal = active.reduce((s, h) => s + activePositionValue(h), 0);
  const cashBalance = asNumber(settings?.cashBalance);
  const totalVal = investedVal + cashBalance;
  const hasPreviousCloseSnapshot = active.some((holding) => hasMetricValue(holding.previousClose));
  const previousInvestedVal = hasPreviousCloseSnapshot ? active.reduce((s, h) => s + activePreviousCloseValue(h), 0) : null;
  const previousTotalVal = previousInvestedVal != null ? previousInvestedVal + cashBalance : null;
  const activeCostBasis = active.reduce((s, h) => s + holdingCostBasis(h), 0);
  const realizedCostBasis = exited.reduce((s, h) => s + h.costBasis, 0);
  const totalRealizedPnl = exited.reduce((s, h) => s + h.pnlDollar, 0);
  const computed = active.map(h => {
    const pv = activePositionValue(h);
    const w = totalVal > 0 ? pv / totalVal : 0;
    return {
      ...h,
      positionValue: pv,
      weight: w,
      effectiveBeta: calc.holdingBeta(h),
      pnlPercent: calc.pnlPercent(asNumber(h.currentPrice), asNumber(h.buyPrice)),
      pnlDollar: activePnlDollar(h),
    };
  });
  const totalUnrealizedPnl = computed.reduce((s, h) => s + h.pnlDollar, 0);
  const totalCostBasis = activeCostBasis + realizedCostBasis;
  const totalPnl = totalUnrealizedPnl + totalRealizedPnl;
  const totalReturnPct = totalCostBasis > 0 ? totalPnl / totalCostBasis : 0;
  const benchmarkHolding = computed.find((holding) => holding.theme === "Benchmark");
  const benchmarkPreviousValue = benchmarkHolding && hasMetricValue(benchmarkHolding.previousClose)
    ? activePreviousCloseValue(benchmarkHolding)
    : null;
  const liveDailyReturn = previousTotalVal > 0 ? totalVal / previousTotalVal - 1 : null;
  const liveBenchmarkReturn = benchmarkPreviousValue > 0 ? activePositionValue(benchmarkHolding) / benchmarkPreviousValue - 1 : null;
  return {
    totalVal,
    investedVal,
    previousInvestedVal,
    previousTotalVal,
    cashBalance,
    active,
    exited,
    computed,
    totalRealizedPnl,
    totalUnrealizedPnl,
    activeCostBasis,
    realizedCostBasis,
    totalCostBasis,
    totalPnl,
    totalReturnPct,
    liveDailyReturn,
    liveBenchmarkReturn,
  };
}

function summarizeActiveBook(computed, cashBalance, totalVal = null) {
  const grouped = computed.reduce((acc, holding) => {
    const key = holding.theme || "Other";
    if (!acc[key]) acc[key] = { theme: key, totalValue: 0, holdings: 0 };
    acc[key].totalValue += asNumber(holding.positionValue);
    acc[key].holdings += 1;
    return acc;
  }, {});
  const groupedValues = Object.values(grouped).sort((a, b) => b.totalValue - a.totalValue);
  const benchmarkValue = grouped.Benchmark?.totalValue || 0;
  const stockThemeTotals = groupedValues.filter((group) => group.theme !== "Benchmark");
  const stockValue = stockThemeTotals.reduce((sum, group) => sum + group.totalValue, 0);
  const totalActiveValue = stockValue + benchmarkValue;
  const portfolioTotal = totalVal ?? (totalActiveValue + cashBalance);
  const portfolioAllocation = groupedValues.map((group, index) => ({
    name: group.theme,
    value: portfolioTotal > 0 ? group.totalValue / portfolioTotal : 0,
    fill: getThemeColor(group.theme, index),
  }));
  if (cashBalance > 0 && portfolioTotal > 0) {
    portfolioAllocation.push({
      name: "Cash",
      value: cashBalance / portfolioTotal,
      fill: getThemeColor("Cash", portfolioAllocation.length),
    });
  }
  return {
    benchmarkValue,
    stockValue,
    totalActiveValue,
    portfolioTotal,
    stockThemeTotals,
    stockThemeCount: stockThemeTotals.length,
    portfolioAllocation,
  };
}

function selectReturnHistory(view, weeklyHistory, dailyHistoryRows) {
  if (view === "daily") return (dailyHistoryRows || []).slice(-20);
  return normalizeWeeklyHistoryRows(weeklyHistory);
}

function buildLiveBookSnapshot(holdings, settings, dailyHistory = []) {
  const holdingsSnapshot = computeHoldings(holdings, settings);
  const trackedDailyHistory = normalizeDailyHistoryRows(dailyHistory);
  const latestTrackedBalance = trackedDailyHistory.at(-1) || null;
  const fallbackBaseRow = trackedDailyHistory.length > 1 ? trackedDailyHistory.at(-2) : latestTrackedBalance;
  const previousNav = holdingsSnapshot.previousTotalVal ?? fallbackBaseRow?.portfolioValue ?? null;
  const previousNavDate = fallbackBaseRow?.date || latestTrackedBalance?.date || null;
  const dayPnl = previousNav > 0 ? holdingsSnapshot.totalVal - previousNav : null;
  const dayReturn = Number.isFinite(holdingsSnapshot.liveDailyReturn)
    ? holdingsSnapshot.liveDailyReturn
    : (previousNav > 0 ? holdingsSnapshot.totalVal / previousNav - 1 : null);
  const bookSummary = summarizeActiveBook(holdingsSnapshot.computed, holdingsSnapshot.cashBalance, holdingsSnapshot.totalVal);
  const activeStocks = holdingsSnapshot.computed.filter((holding) => holding.theme !== "Benchmark");

  return {
    ...holdingsSnapshot,
    nav: holdingsSnapshot.totalVal,
    stockValue: bookSummary.stockValue,
    benchmarkValue: bookSummary.benchmarkValue,
    portfolioTotal: bookSummary.portfolioTotal,
    activeStocks,
    activeStockCount: activeStocks.length,
    exitedCount: holdingsSnapshot.exited.length,
    trackedDailyHistory,
    latestTrackedBalance,
    previousNav,
    previousNavDate,
    dayPnl,
    dayReturn,
    benchmarkDayReturn: holdingsSnapshot.liveBenchmarkReturn,
    trackerStartValue: trackedDailyHistory[0]?.portfolioValue ?? null,
    liveToTrackerGap: latestTrackedBalance ? holdingsSnapshot.totalVal - latestTrackedBalance.portfolioValue : null,
    bookSummary,
  };
}

function buildHistoricalPerformanceSnapshot(weeklyHistory, dailyHistory, liveBookSnapshot, view = "weekly") {
  const liveDailyHistory = buildLiveDailyHistoryRows(dailyHistory, {
    portfolioValue: liveBookSnapshot?.nav,
    dailyReturn: liveBookSnapshot?.dayReturn,
    benchmarkReturn: liveBookSnapshot?.benchmarkDayReturn,
  });
  const historyRows = selectReturnHistory(view, weeklyHistory, liveDailyHistory);
  const chartData = addHistoryLabels(historyRows, view).map((row) => ({
    ...row,
    excessReturn: (Number(row.portfolioReturn) || 0) - (Number(row.benchmarkReturn) || 0),
    explainedReturn: Number(row.marketContrib || 0),
    selectionReturn: Number(row.alpha || 0),
  }));
  const cumulativeData = buildCumulativeReturnSeries(historyRows).map((row, index) => ({
    ...row,
    label: chartData[index]?.label,
  }));
  const cumulativePortfolio = cumulativeData.length ? cumulativeData[cumulativeData.length - 1].portfolio : 0;
  const cumulativeBenchmark = cumulativeData.length ? cumulativeData[cumulativeData.length - 1].benchmark : 0;
  const excessReturn = cumulativePortfolio - cumulativeBenchmark;
  const bestWorstSample = view === "weekly" && chartData.length > 5 ? chartData.slice(5) : chartData;
  const bestPeriod = bestWorstSample.length ? [...bestWorstSample].sort((a, b) => b.portfolioReturn - a.portfolioReturn)[0] : null;
  const worstPeriod = bestWorstSample.length ? [...bestWorstSample].sort((a, b) => a.portfolioReturn - b.portfolioReturn)[0] : null;
  const historyTable = [...chartData].reverse();
  const hitRate = chartData.length ? chartData.filter((row) => row.portfolioReturn > 0).length / chartData.length : 0;
  const drawdownSeries = buildReturnDrawdownSeries(chartData);
  const portfolioDrawdown = summarizeReturnDrawdown(drawdownSeries, "portfolioDrawdown");
  const benchmarkDrawdown = summarizeReturnDrawdown(drawdownSeries, "benchmarkDrawdown");
  const currentDrawdown = drawdownSeries.length ? drawdownSeries[drawdownSeries.length - 1].portfolioDrawdown : 0;

  return {
    view,
    liveDailyHistory,
    historyRows,
    chartData,
    cumulativeData,
    cumulativePortfolio,
    cumulativeBenchmark,
    excessReturn,
    bestPeriod,
    worstPeriod,
    historyTable,
    hitRate,
    drawdownSeries,
    portfolioDrawdown,
    benchmarkDrawdown,
    currentDrawdown,
    maxDrawdown: portfolioDrawdown.worstDrawdown,
    latestHistoryDate: historyRows.at(-1)?.date || null,
    periodCount: historyRows.length,
  };
}

function buildLiveRiskSnapshot(risk) {
  const analytics = risk?.analytics || null;
  const metrics = analytics?.metrics || null;
  const pending = !metrics && !risk?.error && (risk?.isLoading || risk?.isRefreshing);

  return {
    analytics,
    metrics,
    details: metrics ? buildRiskStatDetails(analytics) : {},
    beta: metrics?.portfolioBeta ?? null,
    trackingError: metrics?.trackingError ?? null,
    pending,
    available: !!metrics,
    updatedAt: metrics?.updatedAt || null,
    betaStatus: pending
      ? "Loading live regression..."
      : metrics
        ? `${metrics.betaObservations || metrics.observations}d 5Y market regression`
        : (risk?.error || "Live regression unavailable"),
    trackingErrorStatus: pending
      ? "Loading live regression..."
      : metrics
        ? "Annualized active risk vs SPY"
        : (risk?.error || "Live regression unavailable"),
  };
}

function buildStopLossSnapshot(holdings, settings) {
  const active = holdings.filter((holding) => holding.status === "active" && holding.theme !== "Benchmark");
  const rows = active.map((holding) => {
    const stopLossPrice = asNumber(holding.buyPrice) * (1 - asNumber(holding.stopLossPct));
    const distanceToStop = asNumber(holding.currentPrice) > 0
      ? (asNumber(holding.currentPrice) - stopLossPrice) / asNumber(holding.currentPrice)
      : 1;
    const alertStatus = asNumber(holding.currentPrice) <= stopLossPrice
      ? "BREACH"
      : distanceToStop < asNumber(settings?.stopLossWarningBuffer)
        ? "WARNING"
        : "OK";
    return {
      ...holding,
      slPrice: stopLossPrice,
      distToSl: distanceToStop,
      alertStatus,
    };
  });
  const breachedRows = rows.filter((row) => row.alertStatus === "BREACH");
  const warningRows = rows.filter((row) => row.alertStatus === "WARNING");
  const okRows = rows.filter((row) => row.alertStatus === "OK");

  return {
    active,
    rows,
    warningBuffer: asNumber(settings?.stopLossWarningBuffer),
    breachedCount: breachedRows.length,
    warningCount: warningRows.length,
    okCount: okRows.length,
    monitoredCount: rows.length,
    alertCount: breachedRows.length + warningRows.length,
    avgStopLossPct: rows.length ? rows.reduce((sum, row) => sum + (Number(row.stopLossPct) || 0), 0) / rows.length : 0,
    topAlerts: [...rows].sort((left, right) => left.distToSl - right.distToSl).slice(0, 8),
  };
}

function buildOverviewManagerStatDetails({ liveBookSnapshot, historicalPerformanceSnapshot, liveRiskSnapshot, stopLossSnapshot, lastPriceUpdate }) {
  const historyRowsPayload = historicalPerformanceSnapshot.historyRows.map((row) => ({
    week: row.week,
    date: row.date,
    portfolio_return: Number(asNumber(row.portfolioReturn).toFixed(8)),
    benchmark_return: Number(asNumber(row.benchmarkReturn).toFixed(8)),
  }));
  const liveBookPayload = {
    portfolio_nav: Number(asNumber(liveBookSnapshot.nav).toFixed(6)),
    stock_value: Number(asNumber(liveBookSnapshot.stockValue).toFixed(6)),
    benchmark_value: Number(asNumber(liveBookSnapshot.benchmarkValue).toFixed(6)),
    cash: Number(asNumber(liveBookSnapshot.cashBalance).toFixed(6)),
    previous_nav: liveBookSnapshot.previousNav == null ? null : Number(asNumber(liveBookSnapshot.previousNav).toFixed(6)),
    day_pnl: liveBookSnapshot.dayPnl == null ? null : Number(asNumber(liveBookSnapshot.dayPnl).toFixed(6)),
    day_return: liveBookSnapshot.dayReturn == null ? null : Number(asNumber(liveBookSnapshot.dayReturn).toFixed(8)),
    realized_pnl: Number(asNumber(liveBookSnapshot.totalRealizedPnl).toFixed(6)),
    unrealized_pnl: Number(asNumber(liveBookSnapshot.totalUnrealizedPnl).toFixed(6)),
    active_stock_count: liveBookSnapshot.activeStockCount,
    exited_count: liveBookSnapshot.exitedCount,
  };
  const historyPayload = {
    latest_date: historicalPerformanceSnapshot.latestHistoryDate,
    rows: historyRowsPayload,
  };
  const stopLossPayload = {
    warning_buffer: Number(asNumber(stopLossSnapshot.warningBuffer).toFixed(8)),
    monitored_count: stopLossSnapshot.monitoredCount,
    breached_count: stopLossSnapshot.breachedCount,
    warning_count: stopLossSnapshot.warningCount,
    rows: stopLossSnapshot.rows.map((row) => ({
      ticker: row.ticker,
      current_price: Number(asNumber(row.currentPrice).toFixed(6)),
      buy_price: Number(asNumber(row.buyPrice).toFixed(6)),
      stop_loss_pct: Number(asNumber(row.stopLossPct).toFixed(8)),
      stop_loss_price: Number(asNumber(row.slPrice).toFixed(6)),
      distance_to_stop: Number(asNumber(row.distToSl).toFixed(8)),
      alert_status: row.alertStatus,
    })),
  };

  return {
    portfolioNav: {
      sectionLabel: "Overview Formula",
      title: "Portfolio NAV",
      displayedValue: fmt.usdExact(liveBookSnapshot.nav),
      displayedSub: lastPriceUpdate ? `Live · ${lastPriceUpdate}` : "Live holdings snapshot",
      source: "Displayed from the live book snapshot after holdings are refreshed with current Yahoo prices and cash is added back to the book.",
      formula: [
        "portfolio_nav = stock_value + benchmark_value + cash",
      ],
      inputs: [
        `stock_value = ${fmt.usdExact(liveBookSnapshot.stockValue)}`,
        `benchmark_value = ${fmt.usdExact(liveBookSnapshot.benchmarkValue)}`,
        `cash = ${fmt.usdExact(liveBookSnapshot.cashBalance)}`,
      ],
      calculation: [
        `portfolio_nav = ${fmt.usdExact(liveBookSnapshot.stockValue)} + ${fmt.usdExact(liveBookSnapshot.benchmarkValue)} + ${fmt.usdExact(liveBookSnapshot.cashBalance)} = ${fmt.usdExact(liveBookSnapshot.nav)}`,
      ],
      notes: [
        `${liveBookSnapshot.activeStockCount} active stock holdings`,
        `${liveBookSnapshot.exitedCount} exited positions`,
        liveBookSnapshot.latestTrackedBalance ? `Tracker ${fmt.shortDate(liveBookSnapshot.latestTrackedBalance.date)} = ${fmt.usdExact(liveBookSnapshot.latestTrackedBalance.portfolioValue)}` : "No tracker balance available",
      ],
      pythonFileName: "overview_portfolio_nav_check.py",
      pythonSource: buildPythonScript("Recompute Overview portfolio NAV from stock, benchmark, and cash", liveBookPayload, [
        'portfolio_nav = data["stock_value"] + data["benchmark_value"] + data["cash"]',
        'print({"portfolio_nav": round(portfolio_nav, 2)})',
      ]),
    },
    dayPnl: {
      sectionLabel: "Overview Formula",
      title: "Day P&L",
      displayedValue: fmt.usdExact(liveBookSnapshot.dayPnl),
      displayedSub: `${fmt.pct(liveBookSnapshot.dayReturn)}${lastPriceUpdate ? ` · Live ${lastPriceUpdate}` : " · Live"}`,
      source: "Displayed from the live book snapshot by comparing the current portfolio NAV with the prior close portfolio NAV.",
      formula: [
        "day_pnl = current_portfolio_nav - prior_close_portfolio_nav",
        "day_return = day_pnl / prior_close_portfolio_nav",
      ],
      inputs: [
        `current_portfolio_nav = ${fmt.usdExact(liveBookSnapshot.nav)}`,
        `prior_close_portfolio_nav = ${fmt.usdExact(liveBookSnapshot.previousNav)}`,
        liveBookSnapshot.previousNavDate ? `base_date = ${fmt.date(liveBookSnapshot.previousNavDate)}` : "base_date = previous close snapshot",
      ],
      calculation: [
        `day_pnl = ${fmt.usdExact(liveBookSnapshot.nav)} - ${fmt.usdExact(liveBookSnapshot.previousNav)} = ${fmt.usdExact(liveBookSnapshot.dayPnl)}`,
        `day_return = ${fmt.usdExact(liveBookSnapshot.dayPnl)} / ${fmt.usdExact(liveBookSnapshot.previousNav)} = ${fmt.pct(liveBookSnapshot.dayReturn)}`,
      ],
      notes: [
        `Current unrealized PnL = ${fmt.usdExact(liveBookSnapshot.totalUnrealizedPnl)}`,
        `Current realized PnL = ${fmt.usdExact(liveBookSnapshot.totalRealizedPnl)}`,
        "Day move is separate from since-inception performance.",
      ],
      pythonFileName: "overview_day_pnl_check.py",
      pythonSource: buildPythonScript("Recompute Overview day P&L and day return from the live NAV base", liveBookPayload, [
        'prior_close_nav = data["previous_nav"] or 0.0',
        'day_pnl = data["portfolio_nav"] - prior_close_nav',
        'day_return = (day_pnl / prior_close_nav) if prior_close_nav else None',
        'print({"day_pnl": round(day_pnl, 2), "day_return": None if day_return is None else round(day_return, 6)})',
      ]),
    },
    sinceInceptionReturn: {
      sectionLabel: "Overview Formula",
      title: "Since-Inception Return",
      displayedValue: fmt.pct(historicalPerformanceSnapshot.cumulativePortfolio),
      displayedSub: historicalPerformanceSnapshot.latestHistoryDate ? `As of ${fmt.shortDate(historicalPerformanceSnapshot.latestHistoryDate)}` : "As of canonical weekly history",
      source: "Displayed from the canonical compounded weekly return history. This is the same cumulative series used by the Returns tab default view.",
      formula: [
        "portfolio_nav_0 = 1",
        "portfolio_nav_t = portfolio_nav_(t-1) × (1 + portfolio_return_t)",
        "since_inception_return = final_portfolio_nav - 1",
      ],
      inputs: [
        `history_periods = ${historicalPerformanceSnapshot.periodCount}`,
        historicalPerformanceSnapshot.historyRows[0]?.date ? `start_date = ${fmt.date(historicalPerformanceSnapshot.historyRows[0].date)}` : "start_date = unavailable",
        historicalPerformanceSnapshot.latestHistoryDate ? `latest_date = ${fmt.date(historicalPerformanceSnapshot.latestHistoryDate)}` : "latest_date = unavailable",
      ],
      calculation: [
        `compounded_portfolio_return = ${fmt.pct(historicalPerformanceSnapshot.cumulativePortfolio)}`,
      ],
      notes: [
        `Compounded benchmark return = ${fmt.pct(historicalPerformanceSnapshot.cumulativeBenchmark)}`,
        "This top-line return is intentionally historical and not derived from current realized + unrealized PnL.",
      ],
      pythonFileName: "overview_since_inception_return_check.py",
      pythonSource: buildPythonScript("Recompute Overview since-inception return from the canonical weekly return history", historyPayload, [
        'portfolio_nav = 1.0',
        'for row in data["rows"]:',
        '    portfolio_nav *= 1 + row["portfolio_return"]',
        'print({"since_inception_return": round(portfolio_nav - 1, 6), "periods": len(data["rows"])})',
      ]),
    },
    excessReturn: {
      sectionLabel: "Overview Formula",
      title: "Excess Return vs S&P 500",
      displayedValue: fmt.pct(historicalPerformanceSnapshot.excessReturn),
      displayedSub: historicalPerformanceSnapshot.latestHistoryDate ? `As of ${fmt.shortDate(historicalPerformanceSnapshot.latestHistoryDate)}` : "As of canonical weekly history",
      source: "Displayed as portfolio compounded return minus benchmark compounded return over the same canonical weekly history used by the Returns tab.",
      formula: [
        "portfolio_cumulative = Π(1 + portfolio_return_t) - 1",
        "benchmark_cumulative = Π(1 + benchmark_return_t) - 1",
        "excess_return = portfolio_cumulative - benchmark_cumulative",
      ],
      inputs: [
        `portfolio_cumulative = ${fmt.pct(historicalPerformanceSnapshot.cumulativePortfolio)}`,
        `benchmark_cumulative = ${fmt.pct(historicalPerformanceSnapshot.cumulativeBenchmark)}`,
        `history_periods = ${historicalPerformanceSnapshot.periodCount}`,
      ],
      calculation: [
        `excess_return = ${fmt.pct(historicalPerformanceSnapshot.cumulativePortfolio)} - ${fmt.pct(historicalPerformanceSnapshot.cumulativeBenchmark)} = ${fmt.pct(historicalPerformanceSnapshot.excessReturn)}`,
      ],
      notes: [
        "Overview and Returns use the same canonical weekly history for this number.",
      ],
      pythonFileName: "overview_excess_return_check.py",
      pythonSource: buildPythonScript("Recompute Overview excess return from the canonical weekly return history", historyPayload, [
        'portfolio_nav = 1.0',
        'benchmark_nav = 1.0',
        'for row in data["rows"]:',
        '    portfolio_nav *= 1 + row["portfolio_return"]',
        '    benchmark_nav *= 1 + row["benchmark_return"]',
        'portfolio_cumulative = portfolio_nav - 1',
        'benchmark_cumulative = benchmark_nav - 1',
        'print({"portfolio_cumulative": round(portfolio_cumulative, 6), "benchmark_cumulative": round(benchmark_cumulative, 6), "excess_return": round(portfolio_cumulative - benchmark_cumulative, 6)})',
      ]),
    },
    currentDrawdown: {
      sectionLabel: "Overview Formula",
      title: "Current Drawdown",
      displayedValue: fmt.pct(historicalPerformanceSnapshot.currentDrawdown),
      displayedSub: `Max DD ${fmt.pct(historicalPerformanceSnapshot.maxDrawdown)}${historicalPerformanceSnapshot.latestHistoryDate ? ` · As of ${fmt.shortDate(historicalPerformanceSnapshot.latestHistoryDate)}` : ""}`,
      source: "Displayed from the canonical weekly compounded return series by measuring the gap between the latest portfolio NAV path and its running peak.",
      formula: [
        "portfolio_nav_t = portfolio_nav_(t-1) × (1 + portfolio_return_t)",
        "running_peak_t = max(portfolio_nav_0 ... portfolio_nav_t)",
        "drawdown_t = portfolio_nav_t / running_peak_t - 1",
      ],
      inputs: [
        `current_drawdown = ${fmt.pct(historicalPerformanceSnapshot.currentDrawdown)}`,
        `max_drawdown = ${fmt.pct(historicalPerformanceSnapshot.maxDrawdown)}`,
        `peak_period = ${historicalPerformanceSnapshot.portfolioDrawdown.peakWeek}`,
        `trough_period = ${historicalPerformanceSnapshot.portfolioDrawdown.troughWeek}`,
      ],
      calculation: [
        `current_drawdown = latest_portfolio_nav / running_peak_nav - 1 = ${fmt.pct(historicalPerformanceSnapshot.currentDrawdown)}`,
        `max_drawdown = ${fmt.pct(historicalPerformanceSnapshot.maxDrawdown)} from ${historicalPerformanceSnapshot.portfolioDrawdown.peakWeek} to ${historicalPerformanceSnapshot.portfolioDrawdown.troughWeek}`,
      ],
      notes: [
        historicalPerformanceSnapshot.portfolioDrawdown.troughDate ? `Latest trough date = ${fmt.date(historicalPerformanceSnapshot.portfolioDrawdown.troughDate)}` : "No trough date available",
        `Benchmark max drawdown = ${fmt.pct(historicalPerformanceSnapshot.benchmarkDrawdown.worstDrawdown)}`,
      ],
      pythonFileName: "overview_current_drawdown_check.py",
      pythonSource: buildPythonScript("Recompute Overview current drawdown from the canonical weekly return history", historyPayload, [
        'portfolio_nav = 1.0',
        'running_peak = 1.0',
        'current_drawdown = 0.0',
        'max_drawdown = 0.0',
        'for row in data["rows"]:',
        '    portfolio_nav *= 1 + row["portfolio_return"]',
        '    running_peak = max(running_peak, portfolio_nav)',
        '    current_drawdown = portfolio_nav / running_peak - 1',
        '    max_drawdown = min(max_drawdown, current_drawdown)',
        'print({"current_drawdown": round(current_drawdown, 6), "max_drawdown": round(max_drawdown, 6)})',
      ]),
    },
    portfolioBeta: liveRiskSnapshot.details.portfolioBeta || null,
    trackingError: liveRiskSnapshot.details.trackingError || null,
    stopLossAlerts: {
      sectionLabel: "Overview Formula",
      title: "Stop-Loss Alerts",
      displayedValue: `${stopLossSnapshot.alertCount}`,
      displayedSub: `${stopLossSnapshot.breachedCount} breach · ${stopLossSnapshot.warningCount} warning`,
      source: "Displayed from the same active-position stop-loss engine used by the Stop-Loss tab. Benchmark positions are excluded.",
      formula: [
        "stop_loss_price_i = buy_price_i × (1 - stop_loss_pct_i)",
        "distance_to_stop_i = (current_price_i - stop_loss_price_i) / current_price_i",
        "if current_price_i <= stop_loss_price_i: BREACH",
        "elif distance_to_stop_i < warning_buffer: WARNING",
        "alerts = breach_count + warning_count",
      ],
      inputs: [
        `warning_buffer = ${fmt.pct(stopLossSnapshot.warningBuffer, 1)}`,
        `monitored_positions = ${stopLossSnapshot.monitoredCount}`,
        `breach_count = ${stopLossSnapshot.breachedCount}`,
        `warning_count = ${stopLossSnapshot.warningCount}`,
      ],
      calculation: [
        `alerts = ${stopLossSnapshot.breachedCount} + ${stopLossSnapshot.warningCount} = ${stopLossSnapshot.alertCount}`,
      ],
      notes: stopLossSnapshot.topAlerts.length
        ? stopLossSnapshot.topAlerts.map((row) => `${row.ticker}: ${row.alertStatus} at ${fmt.pct(row.distToSl, 1)} from stop`)
        : ["No monitored active stock positions."],
      pythonFileName: "overview_stop_loss_alerts_check.py",
      pythonSource: buildPythonScript("Recompute Overview stop-loss alerts from the monitored active positions", stopLossPayload, [
        'breach_count = sum(1 for row in data["rows"] if row["current_price"] <= row["stop_loss_price"])',
        'warning_count = sum(1 for row in data["rows"] if row["current_price"] > row["stop_loss_price"] and row["distance_to_stop"] < data["warning_buffer"])',
        'print({"breach_count": breach_count, "warning_count": warning_count, "alerts": breach_count + warning_count})',
      ]),
    },
  };
}

function buildOverviewStatDetails(context) {
  const {
    totalVal,
    cashBalance,
    computed,
    exited,
    investedVal,
    bookSummary,
    latestTrackedBalance,
    liveToTrackerGap,
    overviewDailyReturn,
    liveDailyBaseDate,
    liveDailyBaseValue,
    displayTotalReturnDollar,
    displayTotalReturnPct,
    totalPnl,
    totalUnrealizedPnl,
    unrealizedPnlPct,
    totalRealizedPnl,
    realizedPnlPct,
    activeCostBasis,
    realizedCostBasis,
    displayBeta,
    betaStatus,
    liveRiskMetrics,
    localPortBeta,
    displayTrackingError,
    localTe,
    displayDailyVaR95,
    displayAnnualizedVol,
    displaySystematicVol,
    localSysVol,
    betaPending,
    latestTrackerDateLabel,
    portfolioStartValue,
    previousTotalVal,
    activeStockCount,
  } = context;

  const activePayload = computed.map((holding) => ({
    ticker: holding.ticker,
    theme: holding.theme,
    shares: Number(asNumber(holding.shares).toFixed(6)),
    buy_price: Number(asNumber(holding.buyPrice).toFixed(6)),
    current_price: Number(asNumber(holding.currentPrice).toFixed(6)),
    current_value: Number(asNumber(holding.positionValue).toFixed(6)),
    cost_basis: Number(holdingCostBasis(holding).toFixed(6)),
    pnl_dollar: Number(asNumber(holding.pnlDollar).toFixed(6)),
    weight: Number(asNumber(holding.weight).toFixed(8)),
    benchmark_weight: Number(asNumber(holding.benchmarkWeight).toFixed(8)),
    market_beta: Number(asNumber(holding.marketBeta).toFixed(8)),
    adjusted_beta: Number(calc.holdingBeta(holding).toFixed(8)),
  }));
  const exitedPayload = exited.map((holding) => ({
    ticker: holding.ticker,
    theme: holding.theme,
    shares: Number(asNumber(holding.shares).toFixed(6)),
    cost_basis: Number(holdingCostBasis(holding).toFixed(6)),
    sell_total: Number(exitedPositionValue(holding).toFixed(6)),
    realized_pnl: Number(asNumber(holding.pnlDollar).toFixed(6)),
    exit_date: holding.exitDate || null,
  }));
  const themeCounts = bookSummary.stockThemeTotals
    .map((row) => `${row.theme}: ${row.holdings} holdings, ${fmt.usdExact(row.totalValue)}`)
    .slice(0, 8);
  const unrealizedContributors = [...computed]
    .sort((a, b) => Math.abs(asNumber(b.pnlDollar)) - Math.abs(asNumber(a.pnlDollar)))
    .slice(0, 6)
    .map((holding) => `${holding.ticker}: ${fmt.usdExact(holding.pnlDollar)} from ${fmt.usdExact(holding.positionValue)} - ${fmt.usdExact(holdingCostBasis(holding))}`);
  const realizedContributors = [...exited]
    .sort((a, b) => Math.abs(asNumber(b.pnlDollar)) - Math.abs(asNumber(a.pnlDollar)))
    .slice(0, 6)
    .map((holding) => `${holding.ticker}: ${fmt.usdExact(holding.pnlDollar)} on ${holding.exitDate || "no exit date"}`);
  const betaContributors = [...computed]
    .sort((a, b) => Math.abs((asNumber(b.weight) || 0) * calc.holdingBeta(b)) - Math.abs((asNumber(a.weight) || 0) * calc.holdingBeta(a)))
    .slice(0, 6)
    .map((holding) => `${holding.ticker}: ${fmt.pct(holding.weight, 2)} x ${fmt.num(calc.holdingBeta(holding), 4)} = ${fmt.num((holding.weight || 0) * calc.holdingBeta(holding), 4)}`);

  const sharedPayload = {
    active_holdings: activePayload,
    exited_holdings: exitedPayload,
    cash: Number(cashBalance.toFixed(6)),
    book_summary: {
      stock_value: Number(bookSummary.stockValue.toFixed(6)),
      benchmark_value: Number(bookSummary.benchmarkValue.toFixed(6)),
      active_count: activeStockCount,
      exited_count: exited.length,
      stock_theme_count: bookSummary.stockThemeCount,
    },
    tracker: latestTrackedBalance ? {
      latest_date: latestTrackedBalance.date,
      latest_value: Number(asNumber(latestTrackedBalance.portfolioValue).toFixed(6)),
      latest_gap: Number(asNumber(liveToTrackerGap).toFixed(6)),
      start_value: portfolioStartValue == null ? null : Number(asNumber(portfolioStartValue).toFixed(6)),
    } : null,
    base_snapshot: {
      date: liveDailyBaseDate || null,
      value: liveDailyBaseValue == null ? null : Number(asNumber(liveDailyBaseValue).toFixed(6)),
      daily_return: overviewDailyReturn == null ? null : Number(asNumber(overviewDailyReturn).toFixed(8)),
    },
    live_risk_metrics: liveRiskMetrics ? {
      portfolio_beta: Number(asNumber(liveRiskMetrics.portfolioBeta).toFixed(8)),
      tracking_error: Number(asNumber(liveRiskMetrics.trackingError).toFixed(8)),
      daily_var_95: Number(asNumber(liveRiskMetrics.dailyVaR95).toFixed(8)),
      annualized_vol: Number(asNumber(liveRiskMetrics.annualizedVol).toFixed(8)),
      systematic_vol: Number(asNumber(liveRiskMetrics.systematicVol).toFixed(8)),
      beta_observations: liveRiskMetrics.betaObservations || 0,
      beta_benchmark: liveRiskMetrics.betaBenchmark || "^GSPC",
      observations: liveRiskMetrics.observations || 0,
      updated_at: liveRiskMetrics.updatedAt || null,
    } : null,
    fallback_metrics: {
      holdings_beta: Number(asNumber(localPortBeta).toFixed(8)),
      tracking_error: Number(asNumber(localTe).toFixed(8)),
      annualized_vol: Number(asNumber(displayAnnualizedVol).toFixed(8)),
      systematic_vol: Number(asNumber(localSysVol).toFixed(8)),
    },
  };

  return {
    portfolioValue: {
      title: "Portfolio Value",
      displayedValue: fmt.usdExact(totalVal),
      displayedSub: latestTrackedBalance ? `${latestTrackerDateLabel} tracker ${fmt.usdExact(latestTrackedBalance.portfolioValue)}` : "",
      source: "Displayed from live holdings after the latest Yahoo Finance price refresh.",
      formula: [
        "portfolio_value = stock_holdings + benchmark + cash",
        "stock_holdings = Σ(active current_value where theme != Benchmark)",
      ],
      inputs: [
        `stock_holdings = ${fmt.usdExact(bookSummary.stockValue)}`,
        `benchmark = ${fmt.usdExact(bookSummary.benchmarkValue)}`,
        `cash = ${fmt.usdExact(cashBalance)}`,
        `active_stock_positions = ${activeStockCount}`,
      ],
      calculation: [
        `portfolio_value = ${fmt.usdExact(bookSummary.stockValue)} + ${fmt.usdExact(bookSummary.benchmarkValue)} + ${fmt.usdExact(cashBalance)}`,
        `portfolio_value = ${fmt.usdExact(totalVal)}`,
      ],
      notes: [
        ...(latestTrackedBalance ? [`Tracker snapshot (${fmt.date(latestTrackedBalance.date)}): ${fmt.usdExact(latestTrackedBalance.portfolioValue)}`, `Live - tracker gap: ${fmt.usdExact(liveToTrackerGap)}`] : []),
        ...themeCounts,
      ],
      pythonFileName: "overview_portfolio_value_check.py",
      pythonSource: buildPythonScript("Recompute Overview portfolio value from active holdings and cash", sharedPayload, [
        'stock_holdings = fsum(row["current_value"] for row in data["active_holdings"] if row["theme"] != "Benchmark")',
        'benchmark = fsum(row["current_value"] for row in data["active_holdings"] if row["theme"] == "Benchmark")',
        'cash = data["cash"]',
        'portfolio_value = stock_holdings + benchmark + cash',
        'print({"stock_holdings": round(stock_holdings, 2), "benchmark": round(benchmark, 2), "cash": round(cash, 2), "portfolio_value": round(portfolio_value, 2)})',
      ]),
    },
    dailyReturn: {
      title: "Daily Return",
      displayedValue: fmt.pct(overviewDailyReturn),
      displayedSub: liveDailyBaseDate ? `Base ${fmt.shortDate(liveDailyBaseDate)}` : "",
      source: "Displayed from live holdings versus the latest base snapshot used for the day-over-day move.",
      formula: [
        "daily_return = (current_portfolio_value - base_portfolio_value) / base_portfolio_value",
      ],
      inputs: [
        `current_portfolio_value = ${fmt.usdExact(totalVal)}`,
        `base_portfolio_value = ${fmt.usdExact(liveDailyBaseValue)}`,
        `base_date = ${liveDailyBaseDate ? fmt.date(liveDailyBaseDate) : "—"}`,
      ],
      calculation: [
        `daily_return = (${fmt.usdExact(totalVal)} - ${fmt.usdExact(liveDailyBaseValue)}) / ${fmt.usdExact(liveDailyBaseValue)}`,
        `daily_return = ${fmt.pct(overviewDailyReturn)}`,
      ],
      notes: [
        previousTotalVal != null ? "Base came from previous-close holdings snapshot." : "Base fell back to the latest tracked balance row.",
      ],
      pythonFileName: "overview_daily_return_check.py",
      pythonSource: buildPythonScript("Recompute Overview daily return from the live portfolio value and base snapshot", sharedPayload, [
        'current_portfolio_value = fsum(row["current_value"] for row in data["active_holdings"]) + data["cash"]',
        'base_portfolio_value = data["base_snapshot"]["value"]',
        'daily_return = (current_portfolio_value - base_portfolio_value) / base_portfolio_value if base_portfolio_value else None',
        'print({"current_portfolio_value": round(current_portfolio_value, 2), "base_portfolio_value": None if base_portfolio_value is None else round(base_portfolio_value, 2), "daily_return": round(daily_return, 6) if daily_return is not None else None})',
      ]),
    },
    totalReturn: {
      title: "Total Return",
      displayedValue: fmt.usdExact(displayTotalReturnDollar),
      displayedSub: fmt.pct(displayTotalReturnPct),
      source: "Displayed as realized PnL plus unrealized PnL, then divided by current portfolio value.",
      formula: [
        "total_return_$ = unrealized_pnl + realized_pnl",
        "total_return_% = total_return_$ / portfolio_value",
      ],
      inputs: [
        `unrealized_pnl = ${fmt.usdExact(totalUnrealizedPnl)}`,
        `realized_pnl = ${fmt.usdExact(totalRealizedPnl)}`,
        `portfolio_value = ${fmt.usdExact(totalVal)}`,
      ],
      calculation: [
        `total_return_$ = ${fmt.usdExact(totalUnrealizedPnl)} + ${fmt.usdExact(totalRealizedPnl)}`,
        `total_return_$ = ${fmt.usdExact(displayTotalReturnDollar)}`,
        `total_return_% = ${fmt.usdExact(displayTotalReturnDollar)} / ${fmt.usdExact(totalVal)} = ${fmt.pct(displayTotalReturnPct)}`,
      ],
      notes: [
        ...(portfolioStartValue != null ? [`Initial tracked balance: ${fmt.usdExact(portfolioStartValue)}`] : []),
        ...(latestTrackedBalance ? [`Latest tracker row: ${fmt.usdExact(latestTrackedBalance.portfolioValue)}`] : []),
      ],
      pythonFileName: "overview_total_return_check.py",
      pythonSource: buildPythonScript("Recompute Overview total return from active and exited holdings", sharedPayload, [
        'portfolio_value = fsum(row["current_value"] for row in data["active_holdings"]) + data["cash"]',
        'unrealized_pnl = fsum(row["current_value"] - row["cost_basis"] for row in data["active_holdings"])',
        'realized_pnl = fsum(row["realized_pnl"] for row in data["exited_holdings"])',
        'total_return_dollar = unrealized_pnl + realized_pnl',
        'total_return_pct = total_return_dollar / portfolio_value if portfolio_value else None',
        'print({"portfolio_value": round(portfolio_value, 2), "unrealized_pnl": round(unrealized_pnl, 2), "realized_pnl": round(realized_pnl, 2), "total_return_dollar": round(total_return_dollar, 2), "total_return_pct": round(total_return_pct, 6) if total_return_pct is not None else None})',
      ]),
    },
    unrealizedPnl: {
      title: "Unrealized PnL",
      displayedValue: fmt.usdExact(totalUnrealizedPnl),
      displayedSub: fmt.pct(unrealizedPnlPct),
      source: "Displayed from live active holdings only.",
      formula: [
        "unrealized_pnl = Σ(active current_value - active cost_basis)",
        "unrealized_pnl_% = unrealized_pnl / portfolio_value",
      ],
      inputs: [
        `active_current_value = ${fmt.usdExact(investedVal)}`,
        `active_cost_basis = ${fmt.usdExact(activeCostBasis)}`,
        `portfolio_value = ${fmt.usdExact(totalVal)}`,
      ],
      calculation: [
        `unrealized_pnl = ${fmt.usdExact(investedVal)} - ${fmt.usdExact(activeCostBasis)}`,
        `unrealized_pnl = ${fmt.usdExact(totalUnrealizedPnl)}`,
        `unrealized_pnl_% = ${fmt.usdExact(totalUnrealizedPnl)} / ${fmt.usdExact(totalVal)} = ${fmt.pct(unrealizedPnlPct)}`,
      ],
      notes: unrealizedContributors,
      pythonFileName: "overview_unrealized_pnl_check.py",
      pythonSource: buildPythonScript("Recompute Overview unrealized PnL from active holdings", sharedPayload, [
        'portfolio_value = fsum(row["current_value"] for row in data["active_holdings"]) + data["cash"]',
        'unrealized_pnl = fsum(row["current_value"] - row["cost_basis"] for row in data["active_holdings"])',
        'unrealized_pnl_pct = unrealized_pnl / portfolio_value if portfolio_value else None',
        'print({"portfolio_value": round(portfolio_value, 2), "unrealized_pnl": round(unrealized_pnl, 2), "unrealized_pnl_pct": round(unrealized_pnl_pct, 6) if unrealized_pnl_pct is not None else None})',
      ]),
    },
    realizedPnl: {
      title: "Realized PnL",
      displayedValue: fmt.usdExact(totalRealizedPnl),
      displayedSub: fmt.pct(realizedPnlPct),
      source: "Displayed from exited holdings only.",
      formula: [
        "realized_pnl = Σ(exited sell_total - exited cost_basis)",
        "realized_pnl_% = realized_pnl / portfolio_value",
      ],
      inputs: [
        `exited_cost_basis = ${fmt.usdExact(realizedCostBasis)}`,
        `portfolio_value = ${fmt.usdExact(totalVal)}`,
        `exited_positions = ${exited.length}`,
      ],
      calculation: [
        `realized_pnl = ${fmt.usdExact(totalRealizedPnl)}`,
        `realized_pnl_% = ${fmt.usdExact(totalRealizedPnl)} / ${fmt.usdExact(totalVal)} = ${fmt.pct(realizedPnlPct)}`,
      ],
      notes: realizedContributors,
      pythonFileName: "overview_realized_pnl_check.py",
      pythonSource: buildPythonScript("Recompute Overview realized PnL from exited holdings", sharedPayload, [
        'portfolio_value = fsum(row["current_value"] for row in data["active_holdings"]) + data["cash"]',
        'realized_pnl = fsum(row["realized_pnl"] for row in data["exited_holdings"])',
        'realized_pnl_pct = realized_pnl / portfolio_value if portfolio_value else None',
        'print({"portfolio_value": round(portfolio_value, 2), "realized_pnl": round(realized_pnl, 2), "realized_pnl_pct": round(realized_pnl_pct, 6) if realized_pnl_pct is not None else None})',
      ]),
    },
    portfolioBeta: {
      title: "Portfolio Beta",
      displayedValue: betaPending ? "—" : fmt.num(displayBeta),
      displayedSub: betaStatus,
      source: betaPending ? "Waiting for the live /api/risk regression so Overview matches the Risk and Report pages." : liveRiskMetrics ? "Displayed from the live /api/risk regression payload." : "Displayed from holdings-weighted adjusted beta fallback.",
      formula: [
        "display_beta = live_regression_beta if available else holdings_weighted_beta",
        "current_weight_i = current_value_i / active_total_value",
        "portfolio_return_t = Σ(current_weight_i × holding_return_i_t) / available_weight_t",
        "available_weight_t = Σ(current_weight_i for holdings with a valid return on day t)",
        "live_regression_beta = slope of OLS(portfolio_return_t ~ 1 + market_return_t) over the 5Y market window",
        "market_return_t = ^GSPC daily return",
        "holdings_weighted_beta = Σ(weight_i × adjusted_beta_i)",
        "adjusted_beta_i = 1 + (market_beta_i - 1) × (1 - benchmark_weight_i)",
      ],
      inputs: [
        `active_total_value = ${fmt.usdExact(investedVal)}`,
        `active_positions = ${activeStockCount}`,
        `live_regression_beta = ${liveRiskMetrics ? fmt.num(liveRiskMetrics.portfolioBeta, 4) : "not available"}`,
        `fallback_holdings_beta = ${fmt.num(localPortBeta, 4)}`,
        `beta_observations = ${liveRiskMetrics?.betaObservations || 0}`,
        `beta_benchmark = ${liveRiskMetrics?.betaBenchmark || "^GSPC"}`,
      ],
      calculation: [
        liveRiskMetrics ? `portfolio_return_t is rebuilt each day from live holdings weights across ${liveRiskMetrics.betaObservations || 0} aligned observations` : "portfolio_return_t could not be rebuilt from live returns, so the card falls back to holdings-weighted beta",
        liveRiskMetrics ? "days with partial price history are renormalized by available_weight_t instead of treating missing holdings as zero return" : "fallback path skips the live return-series regression",
        liveRiskMetrics ? `live_regression_beta = beta(portfolio_return_t, ${(liveRiskMetrics?.betaBenchmark || "^GSPC")}_return_t) = ${fmt.num(displayBeta, 4)}` : "live_regression_beta = not available",
        betaPending ? "display_beta = wait for live_regression_beta before rendering a final value" : liveRiskMetrics ? `display_beta = live_regression_beta = ${fmt.num(displayBeta, 4)}` : `display_beta = fallback_holdings_beta = ${fmt.num(displayBeta, 4)}`,
        `fallback_holdings_beta = ${fmt.num(localPortBeta, 4)}`,
      ],
      notes: [
        "Method choice: use the uploaded Python script's standard 5Y market-beta concept as the primary displayed beta.",
        "Implementation difference vs the uploaded Python file: the app renormalizes missing-history days so newer holdings do not shrink the early portfolio return series.",
        "The shorter multi-factor model is still used for attribution on the Risk page, but it does not override the Overview beta.",
        ...betaContributors,
      ],
      pythonFileName: "overview_portfolio_beta_check.py",
      pythonSource: buildPythonScript("Verify Overview portfolio beta display and fallback holdings beta", sharedPayload, [
        'def adjusted_beta(row):',
        '    return 1 + (row["market_beta"] - 1) * (1 - row["benchmark_weight"])',
        'fallback_holdings_beta = fsum(row["weight"] * adjusted_beta(row) for row in data["active_holdings"])',
        'live_regression_beta = None if data["live_risk_metrics"] is None else data["live_risk_metrics"]["portfolio_beta"]',
        'beta_observations = 0 if data["live_risk_metrics"] is None else data["live_risk_metrics"]["beta_observations"]',
        'display_beta = live_regression_beta if live_regression_beta is not None else fallback_holdings_beta',
        'print({"display_beta": round(display_beta, 6), "live_regression_beta": None if live_regression_beta is None else round(live_regression_beta, 6), "fallback_holdings_beta": round(fallback_holdings_beta, 6), "beta_observations": beta_observations})',
      ]),
    },
    trackingError: {
      title: "Tracking Error",
      displayedValue: fmt.pct(displayTrackingError),
      displayedSub: liveRiskMetrics ? "Live regression" : "Fallback formula",
      source: liveRiskMetrics ? "Displayed from live regression metrics." : "Displayed from the local holdings fallback formula.",
      formula: [
        "display_tracking_error = live_tracking_error if available else fallback_tracking_error",
        "fallback_tracking_error = sqrt((beta - 1)^2 × benchmark_vol^2 + idiosyncratic_vol^2)",
      ],
      inputs: [
        `live_tracking_error = ${liveRiskMetrics ? fmt.pct(liveRiskMetrics.trackingError) : "not available"}`,
        `fallback_tracking_error = ${fmt.pct(localTe)}`,
        `display_tracking_error = ${fmt.pct(displayTrackingError)}`,
      ],
      calculation: [
        liveRiskMetrics ? `display_tracking_error = live_tracking_error = ${fmt.pct(displayTrackingError)}` : `display_tracking_error = fallback_tracking_error = ${fmt.pct(displayTrackingError)}`,
      ],
      notes: [
        `Fallback beta input = ${fmt.num(localPortBeta, 4)}`,
        `Fallback systematic vol = ${fmt.pct(localSysVol)}`,
      ],
      pythonFileName: "overview_tracking_error_check.py",
      pythonSource: buildPythonScript("Verify Overview tracking error display and fallback", sharedPayload, [
        'live_tracking_error = None if data["live_risk_metrics"] is None else data["live_risk_metrics"]["tracking_error"]',
        'fallback_tracking_error = data["fallback_metrics"]["tracking_error"]',
        'display_tracking_error = live_tracking_error if live_tracking_error is not None else fallback_tracking_error',
        'print({"display_tracking_error": round(display_tracking_error, 6), "live_tracking_error": None if live_tracking_error is None else round(live_tracking_error, 6), "fallback_tracking_error": round(fallback_tracking_error, 6)})',
      ]),
    },
    dailyVar95: {
      title: "Daily VaR 95%",
      displayedValue: fmt.pct(displayDailyVaR95),
      displayedSub: liveRiskMetrics ? "Live regression" : "Fallback formula",
      source: liveRiskMetrics ? "Displayed from live regression metrics." : "Displayed from annualized volatility fallback.",
      formula: [
        "display_daily_var95 = live_daily_var95 if available else annualized_vol / sqrt(252) × 1.645",
      ],
      inputs: [
        `annualized_vol = ${fmt.pct(displayAnnualizedVol)}`,
        `live_daily_var95 = ${liveRiskMetrics ? fmt.pct(liveRiskMetrics.dailyVaR95) : "not available"}`,
      ],
      calculation: [
        liveRiskMetrics ? `display_daily_var95 = ${fmt.pct(displayDailyVaR95)}` : `display_daily_var95 = ${fmt.pct(displayAnnualizedVol)} / sqrt(252) × 1.645 = ${fmt.pct(displayDailyVaR95)}`,
      ],
      notes: [],
      pythonFileName: "overview_daily_var95_check.py",
      pythonSource: buildPythonScript("Verify Overview daily VaR 95% display", sharedPayload, [
        'live_annualized_vol = data["live_risk_metrics"]["annualized_vol"] if data["live_risk_metrics"] else None',
        'fallback_annualized_vol = data["fallback_metrics"]["annualized_vol"]',
        'annualized_vol = live_annualized_vol if live_annualized_vol is not None else fallback_annualized_vol',
        'live_daily_var95 = None if data["live_risk_metrics"] is None else data["live_risk_metrics"]["daily_var_95"]',
        'fallback_daily_var95 = (annualized_vol / sqrt(252)) * 1.645 if annualized_vol is not None else None',
        'display_daily_var95 = live_daily_var95 if live_daily_var95 is not None else fallback_daily_var95',
        'print({"display_daily_var95": None if display_daily_var95 is None else round(display_daily_var95, 6), "live_daily_var95": None if live_daily_var95 is None else round(live_daily_var95, 6), "fallback_daily_var95": None if fallback_daily_var95 is None else round(fallback_daily_var95, 6)})',
      ]),
    },
    active: {
      title: "Active Positions",
      displayedValue: String(activeStockCount),
      displayedSub: `${exited.length} exited`,
      source: "Displayed from current holdings status flags, excluding the benchmark row.",
      formula: [
        "active_positions = count(holding.status == 'active' and theme != 'Benchmark')",
        "exited_positions = count(holding.status == 'exited')",
      ],
      inputs: [
        `active_positions = ${activeStockCount}`,
        `exited_positions = ${exited.length}`,
      ],
      calculation: [
        `active_positions = ${activeStockCount}`,
        `exited_positions = ${exited.length}`,
      ],
      notes: themeCounts,
      pythonFileName: "overview_active_positions_check.py",
      pythonSource: buildPythonScript("Count active and exited positions for the Overview card", sharedPayload, [
        'active_positions = len([row for row in data["active_holdings"] if row["theme"] != "Benchmark"])',
        'exited_positions = len(data["exited_holdings"])',
        'print({"active_positions": active_positions, "exited_positions": exited_positions})',
      ]),
    },
    themes: {
      title: "Themes",
      displayedValue: String(bookSummary.stockThemeCount),
      displayedSub: "Active stock themes",
      source: "Displayed from the count of unique active non-benchmark themes.",
      formula: [
        "theme_count = count(unique(theme for active_holding if theme != 'Benchmark'))",
      ],
      inputs: [
        `theme_count = ${bookSummary.stockThemeCount}`,
      ],
      calculation: [
        `theme_count = ${bookSummary.stockThemeCount}`,
      ],
      notes: themeCounts,
      pythonFileName: "overview_theme_count_check.py",
      pythonSource: buildPythonScript("Count unique active non-benchmark themes", sharedPayload, [
        'themes = sorted({row["theme"] for row in data["active_holdings"] if row["theme"] != "Benchmark"})',
        'print({"theme_count": len(themes), "themes": themes})',
      ]),
    },
    annualizedVol: {
      title: "Annualized Volatility",
      displayedValue: fmt.pct(displayAnnualizedVol),
      displayedSub: liveRiskMetrics ? "Live regression" : "Settings fallback",
      source: liveRiskMetrics ? "Displayed from live regression metrics." : "Displayed from saved settings fallback.",
      formula: [
        "display_annualized_vol = live_annualized_vol if available else settings_portfolio_vol",
      ],
      inputs: [
        `live_annualized_vol = ${liveRiskMetrics ? fmt.pct(liveRiskMetrics.annualizedVol) : "not available"}`,
        `display_annualized_vol = ${fmt.pct(displayAnnualizedVol)}`,
      ],
      calculation: [
        liveRiskMetrics ? `display_annualized_vol = ${fmt.pct(displayAnnualizedVol)}` : `display_annualized_vol = settings_portfolio_vol = ${fmt.pct(displayAnnualizedVol)}`,
      ],
      notes: [],
      pythonFileName: "overview_annualized_vol_check.py",
      pythonSource: buildPythonScript("Verify Overview annualized volatility display", sharedPayload, [
        'live_annualized_vol = None if data["live_risk_metrics"] is None else data["live_risk_metrics"]["annualized_vol"]',
        'fallback_annualized_vol = data["fallback_metrics"]["annualized_vol"]',
        'display_annualized_vol = live_annualized_vol if live_annualized_vol is not None else fallback_annualized_vol',
        'print({"display_annualized_vol": round(display_annualized_vol, 6), "live_annualized_vol": None if live_annualized_vol is None else round(live_annualized_vol, 6), "fallback_annualized_vol": round(fallback_annualized_vol, 6)})',
      ]),
    },
    systematicVol: {
      title: "Systematic Volatility",
      displayedValue: fmt.pct(displaySystematicVol),
      displayedSub: liveRiskMetrics ? "Live regression" : "Fallback formula",
      source: liveRiskMetrics ? "Displayed from live regression metrics." : "Displayed from abs(beta) × benchmark vol fallback.",
      formula: [
        "display_systematic_vol = live_systematic_vol if available else abs(beta) × benchmark_vol",
      ],
      inputs: [
        `live_systematic_vol = ${liveRiskMetrics ? fmt.pct(liveRiskMetrics.systematicVol) : "not available"}`,
        `fallback_systematic_vol = ${fmt.pct(localSysVol)}`,
      ],
      calculation: [
        liveRiskMetrics ? `display_systematic_vol = ${fmt.pct(displaySystematicVol)}` : `display_systematic_vol = ${fmt.pct(localSysVol)}`,
      ],
      notes: [
        `fallback_beta = ${fmt.num(localPortBeta, 4)}`,
      ],
      pythonFileName: "overview_systematic_vol_check.py",
      pythonSource: buildPythonScript("Verify Overview systematic volatility display", sharedPayload, [
        'live_systematic_vol = None if data["live_risk_metrics"] is None else data["live_risk_metrics"]["systematic_vol"]',
        'fallback_systematic_vol = data["fallback_metrics"]["systematic_vol"]',
        'display_systematic_vol = live_systematic_vol if live_systematic_vol is not None else fallback_systematic_vol',
        'print({"display_systematic_vol": round(display_systematic_vol, 6), "live_systematic_vol": None if live_systematic_vol is None else round(live_systematic_vol, 6), "fallback_systematic_vol": round(fallback_systematic_vol, 6)})',
      ]),
    },
  };
}

function buildRiskStatDetails(analytics) {
  const metrics = analytics?.metrics;
  if (!metrics) return {};

  const holdingExposures = Array.isArray(analytics?.holdingExposures) ? analytics.holdingExposures : [];
  const dailySeries = Array.isArray(analytics?.dailySeries) ? analytics.dailySeries : [];
  const betaSeries = Array.isArray(analytics?.betaSeries) ? analytics.betaSeries : [];
  const observations = metrics.observations || dailySeries.length || 0;
  const betaObservations = metrics.betaObservations || betaSeries.length || observations;
  const annualizedVol = asNumber(metrics.annualizedVol);
  const topBetaContributors = [...holdingExposures]
    .sort((a, b) => Math.abs((asNumber(b.weight) || 0) * (asNumber(b.marketBeta) || 0)) - Math.abs((asNumber(a.weight) || 0) * (asNumber(a.marketBeta) || 0)))
    .slice(0, 6)
    .map((holding) => `${holding.ticker}: ${fmt.pct(holding.weight, 2)} x ${fmt.num(holding.marketBeta, 4)} = ${fmt.num((asNumber(holding.weight) || 0) * (asNumber(holding.marketBeta) || 0), 4)}`);
  const payload = {
    metrics: {
      portfolio_beta: Number(asNumber(metrics.portfolioBeta).toFixed(8)),
      tracking_error: Number(asNumber(metrics.trackingError).toFixed(8)),
      daily_var_95: Number(asNumber(metrics.dailyVaR95).toFixed(8)),
      daily_var_99: Number(asNumber(metrics.dailyVaR99).toFixed(8)),
      annualized_vol: Number(annualizedVol.toFixed(8)),
      systematic_vol: Number(asNumber(metrics.systematicVol).toFixed(8)),
      idiosyncratic_vol: Number(asNumber(metrics.idiosyncraticVol).toFixed(8)),
      value_beta: Number(asNumber(metrics.valueBeta).toFixed(8)),
      momentum_beta: Number(asNumber(metrics.momentumBeta).toFixed(8)),
      growth_beta: Number(asNumber(metrics.growthBeta).toFixed(8)),
      alpha_daily: Number(asNumber(metrics.alphaDaily).toFixed(8)),
      r_squared: Number(asNumber(metrics.rSquared).toFixed(8)),
      total_value: Number(asNumber(metrics.totalValue).toFixed(6)),
      spy_weight: Number(asNumber(metrics.spyWeight).toFixed(8)),
      active_count: metrics.activeCount || holdingExposures.length,
      beta_observations: betaObservations,
      beta_benchmark: metrics.betaBenchmark || "^GSPC",
      observations,
    },
    holding_exposures: holdingExposures.map((holding) => ({
      ticker: holding.ticker,
      theme: holding.theme,
      current_value: Number(asNumber(holding.currentValue).toFixed(6)),
      weight: Number(asNumber(holding.weight).toFixed(8)),
      market_beta: Number(asNumber(holding.marketBeta).toFixed(8)),
    })),
    beta_series: betaSeries.map((row) => ({
      date: row.date,
      portfolio_return: Number(asNumber(row.portfolioReturn).toFixed(8)),
      market_return: Number(asNumber(row.marketReturn).toFixed(8)),
    })),
    daily_series: dailySeries.map((row) => ({
      date: row.date,
      actual_return: Number(asNumber(row.actualReturn).toFixed(8)),
      predicted_return: Number(asNumber(row.predictedReturn).toFixed(8)),
      market_factor: Number(asNumber(row.marketFactor).toFixed(8)),
    })),
  };

  return {
    portfolioBeta: {
      sectionLabel: "Risk Formula",
      title: "Portfolio Beta",
      displayedValue: fmt.num(metrics.portfolioBeta),
      displayedSub: `${betaObservations}d 5Y market regression`,
      source: "Displayed from the live /api/risk beta regression built from reconstructed portfolio returns versus the S&P 500 market benchmark.",
      formula: [
        "portfolio_return_t = Σ(current_weight_i × holding_return_i_t) / available_weight_t",
        "portfolio_beta = Cov(portfolio_return_t, market_return_t) / Var(market_return_t)",
      ],
      inputs: [
        `active_total_value = ${fmt.usdExact(metrics.totalValue)}`,
        `active_positions = ${metrics.activeCount}`,
        `beta_observations = ${betaObservations}`,
        `beta_benchmark = ${metrics.betaBenchmark || "^GSPC"}`,
        `SPY_weight = ${fmt.pct(metrics.spyWeight)}`,
      ],
      calculation: [
        `portfolio_beta = regression_beta(portfolio_return, ${metrics.betaBenchmark || "^GSPC"}_return) = ${fmt.num(metrics.portfolioBeta, 4)}`,
        `value_beta = ${fmt.num(metrics.valueBeta, 4)}, momentum_beta = ${fmt.num(metrics.momentumBeta, 4)}, growth_beta = ${fmt.num(metrics.growthBeta, 4)}`,
      ],
      notes: [
        `alpha_daily = ${fmt.pct(metrics.alphaDaily)}`,
        `R² = ${fmt.pct(metrics.rSquared)}`,
        ...topBetaContributors,
      ],
      pythonFileName: "risk_portfolio_beta_check.py",
      pythonSource: buildPythonScript("Recompute Risk tab portfolio beta from the exported beta series", payload, [
        'series = data["beta_series"]',
        'market = [row["market_return"] for row in series]',
        'portfolio = [row["portfolio_return"] for row in series]',
        'market_mean = fsum(market) / len(market) if market else 0.0',
        'portfolio_mean = fsum(portfolio) / len(portfolio) if portfolio else 0.0',
        'covariance = fsum((m - market_mean) * (p - portfolio_mean) for p, m in zip(portfolio, market))',
        'variance = fsum((m - market_mean) ** 2 for m in market)',
        'portfolio_beta = covariance / variance if variance else None',
        'print({"observations": len(series), "portfolio_beta": None if portfolio_beta is None else round(portfolio_beta, 6)})',
      ]),
    },
    trackingError: {
      sectionLabel: "Risk Formula",
      title: "Tracking Error",
      displayedValue: fmt.pct(metrics.trackingError),
      displayedSub: "Annualized active risk vs SPY",
      source: "Displayed as the annualized standard deviation of portfolio daily excess return versus SPY over the live regression window.",
      formula: [
        "active_excess_t = portfolio_actual_return_t - benchmark_return_t",
        "tracking_error = stdev(active_excess_t) × sqrt(252)",
      ],
      inputs: [
        `observations = ${observations}`,
        `benchmark = SPY`,
        `tracking_error = ${fmt.pct(metrics.trackingError)}`,
      ],
      calculation: [
        `tracking_error = stdev(actual_return_t - benchmark_return_t) × sqrt(252)`,
        `tracking_error = ${fmt.pct(metrics.trackingError)}`,
      ],
      notes: [
        `portfolio_beta = ${fmt.num(metrics.portfolioBeta, 4)}`,
        `systematic_vol = ${fmt.pct(metrics.systematicVol)}`,
        `idiosyncratic_vol = ${fmt.pct(metrics.idiosyncraticVol)}`,
      ],
      pythonFileName: "risk_tracking_error_check.py",
      pythonSource: buildPythonScript("Recompute Risk tab tracking error from daily active return versus SPY", payload, [
        'active_excess = [row["actual_return"] - row["market_factor"] for row in data["daily_series"]]',
        'tracking_error = stdev(active_excess) * sqrt(252) if len(active_excess) > 1 else 0.0',
        'print({"observations": len(active_excess), "tracking_error": round(tracking_error, 6)})',
      ]),
    },
    dailyVar95: {
      sectionLabel: "Risk Formula",
      title: "Daily VaR 95%",
      displayedValue: fmt.pct(metrics.dailyVaR95),
      displayedSub: "1-day parametric VaR",
      source: "Displayed from current annualized volatility using a normal one-day 95% VaR approximation.",
      formula: [
        "daily_var_95 = (annualized_vol / sqrt(252)) × 1.645",
      ],
      inputs: [
        `annualized_vol = ${fmt.pct(metrics.annualizedVol)}`,
        "z_score_95 = 1.645",
      ],
      calculation: [
        `daily_var_95 = (${fmt.pct(metrics.annualizedVol)} / sqrt(252)) × 1.645`,
        `daily_var_95 = ${fmt.pct(metrics.dailyVaR95)}`,
      ],
      notes: [
        `observations = ${observations}`,
      ],
      pythonFileName: "risk_daily_var95_check.py",
      pythonSource: buildPythonScript("Recompute Risk tab daily VaR 95% from annualized volatility", payload, [
        'annualized_vol = data["metrics"]["annualized_vol"]',
        'daily_var_95 = (annualized_vol / sqrt(252)) * 1.645 if annualized_vol else 0.0',
        'print({"annualized_vol": round(annualized_vol, 6), "daily_var_95": round(daily_var_95, 6)})',
      ]),
    },
    dailyVar99: {
      sectionLabel: "Risk Formula",
      title: "Daily VaR 99%",
      displayedValue: fmt.pct(metrics.dailyVaR99),
      displayedSub: "1-day parametric VaR",
      source: "Displayed from current annualized volatility using a normal one-day 99% VaR approximation.",
      formula: [
        "daily_var_99 = (annualized_vol / sqrt(252)) × 2.326",
      ],
      inputs: [
        `annualized_vol = ${fmt.pct(metrics.annualizedVol)}`,
        "z_score_99 = 2.326",
      ],
      calculation: [
        `daily_var_99 = (${fmt.pct(metrics.annualizedVol)} / sqrt(252)) × 2.326`,
        `daily_var_99 = ${fmt.pct(metrics.dailyVaR99)}`,
      ],
      notes: [
        `observations = ${observations}`,
      ],
      pythonFileName: "risk_daily_var99_check.py",
      pythonSource: buildPythonScript("Recompute Risk tab daily VaR 99% from annualized volatility", payload, [
        'annualized_vol = data["metrics"]["annualized_vol"]',
        'daily_var_99 = (annualized_vol / sqrt(252)) * 2.326 if annualized_vol else 0.0',
        'print({"annualized_vol": round(annualized_vol, 6), "daily_var_99": round(daily_var_99, 6)})',
      ]),
    },
    systematicVol: {
      sectionLabel: "Risk Formula",
      title: "Systematic Volatility",
      displayedValue: fmt.pct(metrics.systematicVol),
      displayedSub: "Predicted factor volatility",
      source: "Displayed as the annualized volatility of the regression-predicted portfolio return series.",
      formula: [
        "predicted_return_t = market + value + momentum + growth + alpha",
        "systematic_vol = stdev(predicted_return_t) × sqrt(252)",
      ],
      inputs: [
        `observations = ${observations}`,
        `R² = ${fmt.pct(metrics.rSquared)}`,
        `systematic_vol = ${fmt.pct(metrics.systematicVol)}`,
      ],
      calculation: [
        "systematic_vol = stdev(predicted_return_t) × sqrt(252)",
        `systematic_vol = ${fmt.pct(metrics.systematicVol)}`,
      ],
      notes: [
        `portfolio_beta = ${fmt.num(metrics.portfolioBeta, 4)}`,
        `value_beta = ${fmt.num(metrics.valueBeta, 4)}`,
        `momentum_beta = ${fmt.num(metrics.momentumBeta, 4)}`,
        `growth_beta = ${fmt.num(metrics.growthBeta, 4)}`,
      ],
      pythonFileName: "risk_systematic_vol_check.py",
      pythonSource: buildPythonScript("Recompute Risk tab systematic volatility from predicted daily return series", payload, [
        'predicted = [row["predicted_return"] for row in data["daily_series"]]',
        'systematic_vol = stdev(predicted) * sqrt(252) if len(predicted) > 1 else 0.0',
        'print({"observations": len(predicted), "systematic_vol": round(systematic_vol, 6)})',
      ]),
    },
    idiosyncraticVol: {
      sectionLabel: "Risk Formula",
      title: "Idiosyncratic Volatility",
      displayedValue: fmt.pct(metrics.idiosyncraticVol),
      displayedSub: "Residual volatility",
      source: "Displayed as the annualized volatility of the residual between actual portfolio return and regression-predicted return.",
      formula: [
        "residual_t = actual_return_t - predicted_return_t",
        "idiosyncratic_vol = stdev(residual_t) × sqrt(252)",
      ],
      inputs: [
        `observations = ${observations}`,
        `annualized_vol = ${fmt.pct(annualizedVol)}`,
        `idiosyncratic_vol = ${fmt.pct(metrics.idiosyncraticVol)}`,
      ],
      calculation: [
        "idiosyncratic_vol = stdev(actual_return_t - predicted_return_t) × sqrt(252)",
        `idiosyncratic_vol = ${fmt.pct(metrics.idiosyncraticVol)}`,
      ],
      notes: [
        `systematic_vol = ${fmt.pct(metrics.systematicVol)}`,
        `unexplained share of total vol = ${annualizedVol > 0 ? fmt.pct(metrics.idiosyncraticVol / annualizedVol) : "—"}`,
      ],
      pythonFileName: "risk_idiosyncratic_vol_check.py",
      pythonSource: buildPythonScript("Recompute Risk tab idiosyncratic volatility from residual daily return series", payload, [
        'residual = [row["actual_return"] - row["predicted_return"] for row in data["daily_series"]]',
        'idiosyncratic_vol = stdev(residual) * sqrt(252) if len(residual) > 1 else 0.0',
        'print({"observations": len(residual), "idiosyncratic_vol": round(idiosyncratic_vol, 6)})',
      ]),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// OVERVIEW
// ═══════════════════════════════════════════════════════════════════
function OverviewPage({ holdings, settings, weeklyHistory, dailyHistory, risk, lastPriceUpdate }) {
  const [range, setRange] = useState("YTD");
  const [customRange, setCustomRange] = useState({ start: "", end: "" });
  const [relativeView, setRelativeView] = useState(false);
  const [benchmark, setBenchmark] = useState(BENCHMARK_OPTIONS[0]?.value || "SP500");
  const [selectedTheme, setSelectedTheme] = useState(null);
  const [holdingSearch, setHoldingSearch] = useState("");
  const [holdingSortKey, setHoldingSortKey] = useState("contributionToReturn");
  const [holdingSortDir, setHoldingSortDir] = useState(-1);

  const liveBookSnapshot = useMemo(
    () => buildLiveBookSnapshot(holdings, settings, dailyHistory),
    [holdings, settings, dailyHistory],
  );
  const dailyPerformanceSnapshot = useMemo(
    () => buildHistoricalPerformanceSnapshot(weeklyHistory, dailyHistory, liveBookSnapshot, "daily"),
    [weeklyHistory, dailyHistory, liveBookSnapshot],
  );
  const weeklyPerformanceSnapshot = useMemo(
    () => buildHistoricalPerformanceSnapshot(weeklyHistory, dailyHistory, liveBookSnapshot, "weekly"),
    [weeklyHistory, dailyHistory, liveBookSnapshot],
  );
  const liveRiskSnapshot = useMemo(() => buildLiveRiskSnapshot(risk), [risk]);
  const stopLossSnapshot = useMemo(() => buildStopLossSnapshot(holdings, settings), [holdings, settings]);
  const overviewDetails = useMemo(() => buildOverviewManagerStatDetails({
    liveBookSnapshot,
    historicalPerformanceSnapshot: weeklyPerformanceSnapshot,
    liveRiskSnapshot,
    stopLossSnapshot,
    lastPriceUpdate,
    settings,
  }), [liveBookSnapshot, weeklyPerformanceSnapshot, liveRiskSnapshot, stopLossSnapshot, lastPriceUpdate, settings]);

  const analytics = risk?.analytics || null;
  const liveRiskMetrics = liveRiskSnapshot.metrics;
  const riskFreeRate = asNumber(settings?.riskFreeRate, 0.04);
  const baseHistoryRows = dailyPerformanceSnapshot.liveDailyHistory?.length
    ? dailyPerformanceSnapshot.liveDailyHistory
    : weeklyPerformanceSnapshot.historyRows;
  const selectedRangeRows = useMemo(() => {
    const filtered = filterRowsByOverviewRange(baseHistoryRows, range, customRange);
    return filtered.length ? filtered : baseHistoryRows;
  }, [baseHistoryRows, range, customRange]);
  const previousComparableRows = useMemo(
    () => getPreviousComparableRows(baseHistoryRows, selectedRangeRows),
    [baseHistoryRows, selectedRangeRows],
  );
  const rangeStats = useMemo(
    () => computeRangePerformanceStats(selectedRangeRows, riskFreeRate),
    [selectedRangeRows, riskFreeRate],
  );
  const previousRangeStats = useMemo(
    () => previousComparableRows.length ? computeRangePerformanceStats(previousComparableRows, riskFreeRate) : null,
    [previousComparableRows, riskFreeRate],
  );
  const ytdRows = useMemo(
    () => {
      const filtered = filterRowsByOverviewRange(baseHistoryRows, "YTD");
      return filtered.length ? filtered : baseHistoryRows;
    },
    [baseHistoryRows],
  );
  const ytdStats = useMemo(() => computeRangePerformanceStats(ytdRows, riskFreeRate), [ytdRows, riskFreeRate]);
  const sinceInceptionStats = useMemo(
    () => computeRangePerformanceStats(baseHistoryRows, riskFreeRate),
    [baseHistoryRows, riskFreeRate],
  );
  const monthlyRows = useMemo(() => buildMonthlyReturnRows(selectedRangeRows), [selectedRangeRows]);
  const monthlyHeatmapMatrix = useMemo(() => buildMonthlyHeatmapMatrix(selectedRangeRows), [selectedRangeRows]);
  const bestMonth = monthlyRows.length
    ? [...monthlyRows].sort((left, right) => right.portfolioReturn - left.portfolioReturn)[0]
    : null;
  const worstMonth = monthlyRows.length
    ? [...monthlyRows].sort((left, right) => left.portfolioReturn - right.portfolioReturn)[0]
    : null;
  const monthHitRate = monthlyRows.length
    ? monthlyRows.filter((row) => row.portfolioReturn > 0).length / monthlyRows.length
    : 0;
  const concentrationMetrics = useMemo(
    () => buildConcentrationMetrics(liveBookSnapshot.activeStocks, liveBookSnapshot.nav, liveBookSnapshot.cashBalance),
    [liveBookSnapshot.activeStocks, liveBookSnapshot.nav, liveBookSnapshot.cashBalance],
  );
  const rollingSharpeSeries = useMemo(
    () => buildRollingMetricSeries(
      selectedRangeRows,
      Math.min(12, Math.max(selectedRangeRows.length, 3)),
      (slice) => computeRangePerformanceStats(slice, riskFreeRate).sharpeRatio ?? 0,
    ),
    [selectedRangeRows, riskFreeRate],
  );
  const rollingInformationRatioSeries = useMemo(
    () => buildRollingMetricSeries(
      selectedRangeRows,
      Math.min(12, Math.max(selectedRangeRows.length, 3)),
      (slice) => computeRangePerformanceStats(slice, riskFreeRate).informationRatio ?? 0,
    ),
    [selectedRangeRows, riskFreeRate],
  );

  const themeRiskRows = useMemo(
    () => ((analytics?.themeRisk || []).map((row, index) => ({
      ...row,
      fill: getThemeColor(row.theme, index),
    }))).sort((a, b) => asNumber(b.riskContrib) - asNumber(a.riskContrib)),
    [analytics],
  );
  const themeRiskMap = useMemo(
    () => new Map(themeRiskRows.map((row) => [row.theme, row])),
    [themeRiskRows],
  );
  const themeValueMap = useMemo(
    () => new Map(liveBookSnapshot.bookSummary.stockThemeTotals.map((row) => [row.theme, row.totalValue])),
    [liveBookSnapshot.bookSummary.stockThemeTotals],
  );
  const themeAttributionRows = useMemo(
    () => liveBookSnapshot.bookSummary.stockThemeTotals.map((row, index) => {
      const themeHoldings = liveBookSnapshot.activeStocks.filter((holding) => holding.theme === row.theme);
      const themePnl = themeHoldings.reduce((sum, holding) => sum + asNumber(holding.pnlDollar), 0);
      const benchmarkWeightEstimate = themeHoldings.reduce(
        (sum, holding) => sum + ((holding.weight || 0) * asNumber(holding.benchmarkWeight)),
        0,
      );
      const riskRow = themeRiskMap.get(row.theme);
      return {
        theme: row.theme,
        holdings: row.holdings,
        totalValue: row.totalValue,
        portfolioWeight: liveBookSnapshot.nav > 0 ? row.totalValue / liveBookSnapshot.nav : 0,
        activeWeight: (liveBookSnapshot.nav > 0 ? row.totalValue / liveBookSnapshot.nav : 0) - benchmarkWeightEstimate,
        benchmarkWeightEstimate,
        pnlDollar: themePnl,
        contributionToReturn: liveBookSnapshot.nav > 0 ? themePnl / liveBookSnapshot.nav : 0,
        totalReturnPct: row.totalValue > 0 ? themePnl / row.totalValue : 0,
        riskContrib: riskRow?.riskContrib ?? null,
        avgBeta: riskRow?.avgBeta ?? null,
        fill: getThemeColor(row.theme, index),
      };
    }).sort((left, right) => right.contributionToReturn - left.contributionToReturn),
    [liveBookSnapshot.bookSummary.stockThemeTotals, liveBookSnapshot.activeStocks, liveBookSnapshot.nav, themeRiskMap],
  );
  const riskContributionRows = selectedTheme
    ? themeRiskRows.filter((row) => row.theme === selectedTheme)
    : themeRiskRows.slice(0, 10);
  const returnAttributionRows = selectedTheme
    ? themeAttributionRows.filter((row) => row.theme === selectedTheme)
    : themeAttributionRows.slice(0, 10);
  const topRiskTheme = riskContributionRows[0] || themeRiskRows[0] || null;
  const topReturnTheme = returnAttributionRows[0] || themeAttributionRows[0] || null;

  const factorExposureRows = useMemo(() => {
    if (!liveRiskMetrics) return [];
    const latestWeek = analytics?.latestWeek || null;
    return [
      {
        factor: "Market",
        exposure: liveRiskMetrics.portfolioBeta,
        contribution: latestWeek?.marketContrib ?? null,
        note: "Beta vs S&P 500",
        fill: "#1e3a5f",
      },
      {
        factor: "Value",
        exposure: liveRiskMetrics.valueBeta,
        contribution: latestWeek?.valueContrib ?? null,
        note: "Style tilt",
        fill: "#2563eb",
      },
      {
        factor: "Momentum",
        exposure: liveRiskMetrics.momentumBeta,
        contribution: latestWeek?.momentumContrib ?? null,
        note: "Style tilt",
        fill: "#7c3aed",
      },
      {
        factor: "Growth",
        exposure: liveRiskMetrics.growthBeta,
        contribution: latestWeek?.growthContrib ?? null,
        note: "Style tilt",
        fill: "#0ea5e9",
      },
      {
        factor: "Alpha",
        exposure: liveRiskMetrics.alphaDaily != null ? liveRiskMetrics.alphaDaily * 252 : null,
        contribution: latestWeek?.alphaContrib ?? null,
        note: "Annualized model alpha",
        fill: "#059669",
      },
    ].filter((row) => row.exposure != null || row.contribution != null);
  }, [liveRiskMetrics, analytics]);
  const dominantFactor = factorExposureRows.length
    ? [...factorExposureRows]
      .filter((row) => row.factor !== "Alpha")
      .sort((left, right) => Math.abs(asNumber(right.contribution)) - Math.abs(asNumber(left.contribution)))[0]
    : null;

  const positionAttributionRows = useMemo(
    () => liveBookSnapshot.activeStocks.map((holding) => {
      const benchmarkWeightEstimate = (holding.weight || 0) * asNumber(holding.benchmarkWeight);
      const themeRisk = themeRiskMap.get(holding.theme);
      const themeValue = themeValueMap.get(holding.theme) || 0;
      const currentPrice = asNumber(holding.currentPrice);
      const previousClose = activePreviousClosePrice(holding);
      return {
        id: holding.id,
        ticker: holding.ticker,
        company: holding.company || "—",
        theme: holding.theme,
        weight: holding.weight || 0,
        activeWeight: (holding.weight || 0) - benchmarkWeightEstimate,
        currentPrice,
        dailyReturn: previousClose > 0 ? currentPrice / previousClose - 1 : 0,
        totalReturnPct: holdingCostBasis(holding) > 0 ? asNumber(holding.pnlDollar) / holdingCostBasis(holding) : 0,
        contributionToReturn: liveBookSnapshot.nav > 0 ? asNumber(holding.pnlDollar) / liveBookSnapshot.nav : 0,
        riskContribution: themeRisk?.riskContrib != null && themeValue > 0
          ? themeRisk.riskContrib * (asNumber(holding.positionValue) / themeValue)
          : null,
        pnlDollar: asNumber(holding.pnlDollar),
        positionValue: asNumber(holding.positionValue),
      };
    }),
    [liveBookSnapshot.activeStocks, liveBookSnapshot.nav, themeRiskMap, themeValueMap],
  );
  const attributionScopeRows = selectedTheme
    ? positionAttributionRows.filter((row) => row.theme === selectedTheme)
    : positionAttributionRows;
  const topContributors = [...attributionScopeRows]
    .sort((left, right) => right.contributionToReturn - left.contributionToReturn)
    .slice(0, 5)
    .map((row) => ({ ...row, bucket: "Top contributor" }));
  const topDetractors = [...attributionScopeRows]
    .sort((left, right) => left.contributionToReturn - right.contributionToReturn)
    .slice(0, 5)
    .map((row) => ({ ...row, bucket: "Top detractor" }));
  const positionAttributionTableRows = [...topContributors, ...topDetractors];
  const weakestOpenRows = [...attributionScopeRows]
    .sort((left, right) => left.contributionToReturn - right.contributionToReturn)
    .slice(0, 3);

  const holdingsOverviewRows = useMemo(() => {
    let rows = [...positionAttributionRows];
    if (selectedTheme) rows = rows.filter((row) => row.theme === selectedTheme);
    if (holdingSearch.trim()) {
      const needle = holdingSearch.trim().toLowerCase();
      rows = rows.filter((row) => (
        row.ticker.toLowerCase().includes(needle)
        || row.company.toLowerCase().includes(needle)
        || row.theme.toLowerCase().includes(needle)
      ));
    }
    rows.sort((left, right) => {
      const leftValue = left[holdingSortKey];
      const rightValue = right[holdingSortKey];
      if (typeof leftValue === "string" || typeof rightValue === "string") {
        return holdingSortDir * String(leftValue || "").localeCompare(String(rightValue || ""));
      }
      return holdingSortDir * (asNumber(leftValue) - asNumber(rightValue));
    });
    return rows;
  }, [positionAttributionRows, selectedTheme, holdingSearch, holdingSortKey, holdingSortDir]);

  const selectedRangeLabel = useMemo(() => {
    if (range === "CUSTOM") {
      if (customRange.start || customRange.end) {
        return `${customRange.start ? fmt.shortDate(customRange.start) : "Start"} - ${customRange.end ? fmt.shortDate(customRange.end) : "Latest"}`;
      }
      return "Custom range";
    }
    return OVERVIEW_RANGE_OPTIONS.find((option) => option.key === range)?.label || "Selected range";
  }, [range, customRange]);
  const selectionAsOf = selectedRangeRows.at(-1)?.date ? fmt.shortDate(selectedRangeRows.at(-1)?.date) : "latest history";
  const navSparkline = baseHistoryRows.map((row) => asNumber(row.portfolioValue)).filter((value) => value > 0);
  const totalReturnSparkline = rangeStats.cumulativeData.map((row) => row.portfolio);
  const activeReturnSparkline = rangeStats.cumulativeData.map((row) => row.active);
  const annualizedVolSparkline = rangeStats.rollingVolSeries.map((row) => row.value);
  const sharpeSparkline = rollingSharpeSeries.map((row) => row.value);
  const infoRatioSparkline = rollingInformationRatioSeries.map((row) => row.value);
  const maxDrawdownSparkline = rangeStats.drawdownSeries.map((row) => row.portfolioDrawdown);
  const trackingErrorSparkline = rangeStats.rollingTrackingErrorSeries.map((row) => row.value);
  const top5Weight = concentrationMetrics.top5Weight;
  const liveVolatility = liveRiskMetrics?.annualizedVol ?? rangeStats.annualizedVolatility;
  const liveTrackingError = liveRiskSnapshot.trackingError ?? rangeStats.trackingError;
  const liveBeta = liveRiskSnapshot.beta;
  const latestWeek = analytics?.latestWeek || null;

  const managerKpiPayload = useMemo(() => ({
    range_label: selectedRangeLabel,
    risk_free_rate: riskFreeRate,
    rows: selectedRangeRows.map((row) => ({
      date: row.date,
      portfolio_return: Number(asNumber(row.portfolioReturn).toFixed(8)),
      benchmark_return: Number(asNumber(row.benchmarkReturn).toFixed(8)),
    })),
    active_holdings: liveBookSnapshot.activeStocks.map((holding) => ({
      ticker: holding.ticker,
      theme: holding.theme,
      weight: Number(asNumber(holding.weight).toFixed(8)),
      benchmark_weight: Number(asNumber(holding.benchmarkWeight).toFixed(8)),
      position_value: Number(asNumber(holding.positionValue).toFixed(6)),
      pnl_dollar: Number(asNumber(holding.pnlDollar).toFixed(6)),
    })),
  }), [selectedRangeLabel, riskFreeRate, selectedRangeRows, liveBookSnapshot.activeStocks]);

  const selectedRangeDetails = useMemo(() => ({
    totalReturn: {
      sectionLabel: "Overview Range",
      title: "Total Return",
      displayedValue: fmt.pct(rangeStats.totalReturn),
      displayedSub: `${selectedRangeLabel} · Benchmark ${fmt.pct(rangeStats.benchmarkReturn)}`,
      source: "Compounded from the canonical performance history filtered by the selected Overview date range.",
      formula: [
        "total_return = Π(1 + portfolio_return_t) - 1",
        "benchmark_return = Π(1 + benchmark_return_t) - 1",
        "active_return = total_return - benchmark_return",
      ],
      inputs: [
        `range = ${selectedRangeLabel}`,
        `observations = ${selectedRangeRows.length}`,
        `benchmark_return = ${fmt.pct(rangeStats.benchmarkReturn)}`,
      ],
      calculation: [
        `total_return = ${fmt.pct(rangeStats.totalReturn)}`,
        `active_return = ${fmt.pct(rangeStats.activeReturn)}`,
      ],
      notes: [
        `Last history point = ${selectionAsOf}`,
      ],
      pythonFileName: "overview_total_return_check.py",
      pythonSource: buildPythonScript("Recompute selected-range total and active return from canonical history", managerKpiPayload, [
        'portfolio_nav = 1.0',
        'benchmark_nav = 1.0',
        'for row in data["rows"]:',
        '    portfolio_nav *= 1 + row["portfolio_return"]',
        '    benchmark_nav *= 1 + row["benchmark_return"]',
        'total_return = portfolio_nav - 1',
        'benchmark_return = benchmark_nav - 1',
        'active_return = total_return - benchmark_return',
        'print({"total_return": round(total_return, 6), "benchmark_return": round(benchmark_return, 6), "active_return": round(active_return, 6)})',
      ]),
    },
    activeReturn: {
      sectionLabel: "Overview Range",
      title: "Active Return",
      displayedValue: fmt.pct(rangeStats.activeReturn),
      displayedSub: `${selectedRangeLabel} vs benchmark`,
      source: "Calculated as compounded portfolio return minus compounded benchmark return over the selected range.",
      formula: [
        "active_return = total_return - benchmark_return",
      ],
      inputs: [
        `portfolio_return = ${fmt.pct(rangeStats.totalReturn)}`,
        `benchmark_return = ${fmt.pct(rangeStats.benchmarkReturn)}`,
      ],
      calculation: [
        `active_return = ${fmt.pct(rangeStats.totalReturn)} - ${fmt.pct(rangeStats.benchmarkReturn)} = ${fmt.pct(rangeStats.activeReturn)}`,
      ],
      notes: [
        `Information ratio = ${rangeStats.informationRatio == null ? "—" : fmt.num(rangeStats.informationRatio, 2)}`,
      ],
      pythonFileName: "overview_active_return_check.py",
      pythonSource: buildPythonScript("Recompute selected-range active return from total and benchmark return", managerKpiPayload, [
        'portfolio_nav = 1.0',
        'benchmark_nav = 1.0',
        'for row in data["rows"]:',
        '    portfolio_nav *= 1 + row["portfolio_return"]',
        '    benchmark_nav *= 1 + row["benchmark_return"]',
        'active_return = (portfolio_nav - 1) - (benchmark_nav - 1)',
        'print({"active_return": round(active_return, 6)})',
      ]),
    },
    maxDrawdown: {
      sectionLabel: "Overview Range",
      title: "Max Drawdown",
      displayedValue: fmt.pct(rangeStats.maxDrawdown),
      displayedSub: `${selectedRangeLabel} peak-to-trough`,
      source: "Calculated from the selected performance path by measuring the worst drop from any prior peak.",
      formula: [
        "nav_t = Π(1 + portfolio_return_t)",
        "drawdown_t = nav_t / max(nav_0..nav_t) - 1",
        "max_drawdown = min(drawdown_t)",
      ],
      inputs: [
        `range = ${selectedRangeLabel}`,
        `observations = ${selectedRangeRows.length}`,
      ],
      calculation: [
        `max_drawdown = ${fmt.pct(rangeStats.maxDrawdown)}`,
      ],
      notes: [
        `Current drawdown = ${fmt.pct(rangeStats.drawdownSeries.at(-1)?.portfolioDrawdown || 0)}`,
      ],
      pythonFileName: "overview_max_drawdown_check.py",
      pythonSource: buildPythonScript("Recompute selected-range max drawdown from canonical history", managerKpiPayload, [
        'nav = 1.0',
        'peak = 1.0',
        'worst = 0.0',
        'for row in data["rows"]:',
        '    nav *= 1 + row["portfolio_return"]',
        '    peak = max(peak, nav)',
        '    drawdown = nav / peak - 1',
        '    worst = min(worst, drawdown)',
        'print({"max_drawdown": round(worst, 6)})',
      ]),
    },
    top5Concentration: {
      sectionLabel: "Live Book",
      title: "Top 5 Holdings Concentration",
      displayedValue: fmt.pct(top5Weight, 1),
      displayedSub: `${concentrationMetrics.activeCount} active stocks`,
      source: "Calculated from live position weights in the current active stock book.",
      formula: [
        "top5_concentration = Σ(weight_i for 5 largest active stock positions)",
      ],
      inputs: [
        `active_stock_count = ${concentrationMetrics.activeCount}`,
        `largest_position = ${concentrationMetrics.largestHolding?.ticker || "—"} ${concentrationMetrics.largestHolding ? fmt.pct(concentrationMetrics.largestHolding.weight, 1) : "—"}`,
      ],
      calculation: [
        `top5_concentration = ${fmt.pct(top5Weight, 1)}`,
      ],
      notes: [
        `Top 10 concentration = ${fmt.pct(concentrationMetrics.top10Weight, 1)}`,
        `HHI = ${fmt.num(concentrationMetrics.hhi, 4)}`,
      ],
      pythonFileName: "overview_top5_concentration_check.py",
      pythonSource: buildPythonScript("Recompute top 5 holdings concentration from live active weights", managerKpiPayload, [
        'weights = sorted([row["weight"] for row in data["active_holdings"]], reverse=True)',
        'top5_concentration = sum(weights[:5])',
        'print({"top5_concentration": round(top5_concentration, 6)})',
      ]),
    },
  }), [rangeStats, selectedRangeLabel, selectedRangeRows.length, selectionAsOf, top5Weight, concentrationMetrics, managerKpiPayload]);

  const performanceSummary = {
    ytdReturn: ytdStats.totalReturn,
    sinceInceptionReturn: sinceInceptionStats.totalReturn,
    bestMonth,
    worstMonth,
    hitRate: monthHitRate,
    upCapture: rangeStats.upCapture,
    downCapture: rangeStats.downCapture,
    currentDrawdown: rangeStats.drawdownSeries.at(-1)?.portfolioDrawdown || 0,
  };
  const capitalStackRows = [
    {
      label: "Stocks",
      value: liveBookSnapshot.stockValue,
      share: liveBookSnapshot.nav > 0 ? liveBookSnapshot.stockValue / liveBookSnapshot.nav : 0,
      fill: "#2563eb",
      accent: "text-blue-700",
      bg: "bg-blue-50",
    },
    {
      label: "S&P 500",
      value: liveBookSnapshot.benchmarkValue,
      share: liveBookSnapshot.nav > 0 ? liveBookSnapshot.benchmarkValue / liveBookSnapshot.nav : 0,
      fill: "#0f172a",
      accent: "text-slate-800",
      bg: "bg-slate-100",
    },
    {
      label: "Cash",
      value: liveBookSnapshot.cashBalance,
      share: liveBookSnapshot.nav > 0 ? liveBookSnapshot.cashBalance / liveBookSnapshot.nav : 0,
      fill: "#94a3b8",
      accent: "text-slate-600",
      bg: "bg-slate-50",
    },
  ].filter((row) => row.value > 0 || row.label === "Cash");

  const pmInsights = [
    topReturnTheme
      ? `${topReturnTheme.theme} is the largest current return sleeve, contributing ${fmt.pct(topReturnTheme.contributionToReturn, 2)} of NAV return with ${fmt.pct(topReturnTheme.portfolioWeight, 1)} capital weight.`
      : null,
    topRiskTheme
      ? `${topRiskTheme.theme} is the largest live risk sleeve at ${fmt.pct(topRiskTheme.riskContrib, 1)} of modeled theme risk, so return leadership and risk leadership are${topReturnTheme?.theme === topRiskTheme.theme ? "" : " not"} coming from the same place.`
      : null,
    `${selectedRangeLabel} active return is ${fmt.pct(rangeStats.activeReturn)} with information ratio ${rangeStats.informationRatio == null ? "—" : fmt.num(rangeStats.informationRatio, 2)} and tracking error ${fmt.pct(liveTrackingError)}.`,
    `${fmt.pct(top5Weight, 1)} of NAV sits in the top 5 names and ${fmt.pct(concentrationMetrics.cashWeight, 1)} remains in cash.`,
    stopLossSnapshot.alertCount > 0
      ? `${stopLossSnapshot.alertCount} names are on stop-loss watch, including ${stopLossSnapshot.topAlerts.slice(0, 2).map((row) => row.ticker).join(" and ")}.`
      : "No names are currently inside the stop-loss breach or warning buffer.",
  ].filter(Boolean).slice(0, 5);

  const exportCsv = useCallback(() => {
    const rows = [
      ["Section", "Metric", "Value", "Context"],
      ["Overview KPI", "Portfolio NAV", fmt.usdExact(liveBookSnapshot.nav), lastPriceUpdate || "Live"],
      ["Overview KPI", "Total Return", fmt.pct(rangeStats.totalReturn), selectedRangeLabel],
      ["Overview KPI", "Active Return", fmt.pct(rangeStats.activeReturn), selectedRangeLabel],
      ["Overview KPI", "Annualized Volatility", fmt.pct(liveVolatility), liveRiskMetrics ? "Live risk model" : selectedRangeLabel],
      ["Overview KPI", "Sharpe Ratio", rangeStats.sharpeRatio == null ? "—" : fmt.num(rangeStats.sharpeRatio, 2), selectedRangeLabel],
      ["Overview KPI", "Information Ratio", rangeStats.informationRatio == null ? "—" : fmt.num(rangeStats.informationRatio, 2), selectedRangeLabel],
      ["Overview KPI", "Max Drawdown", fmt.pct(rangeStats.maxDrawdown), selectedRangeLabel],
      ["Overview KPI", "Tracking Error", fmt.pct(liveTrackingError), liveRiskSnapshot.trackingErrorStatus],
      ["Overview KPI", "Beta", liveBeta == null ? "—" : fmt.num(liveBeta, 2), liveRiskSnapshot.betaStatus],
      ["Overview KPI", "Top 5 Concentration", fmt.pct(top5Weight, 1), "Live book"],
      [""],
      ["Holding", "Ticker", "Theme", "Weight", "Active Weight", "Price", "Daily %", "Total Return %", "Contribution to Return", "Contribution to Risk", "P/L", "Market Value"],
      ...holdingsOverviewRows.map((row) => [
        "",
        row.ticker,
        row.theme,
        fmt.pct(row.weight, 4),
        fmt.pct(row.activeWeight, 4),
        fmt.usdExact(row.currentPrice),
        fmt.pct(row.dailyReturn, 4),
        fmt.pct(row.totalReturnPct, 4),
        fmt.pct(row.contributionToReturn, 6),
        row.riskContribution == null ? "—" : fmt.pct(row.riskContribution, 6),
        fmt.usdExact(row.pnlDollar),
        fmt.usdExact(row.positionValue),
      ]),
    ];
    downloadFile(`overview_export_${currentLocalDateIso()}.csv`, toCsv(rows), "text/csv;charset=utf-8");
  }, [liveBookSnapshot.nav, lastPriceUpdate, rangeStats, selectedRangeLabel, liveVolatility, liveRiskMetrics, liveTrackingError, liveRiskSnapshot, liveBeta, top5Weight, holdingsOverviewRows]);

  const handleHoldingSort = (key) => {
    if (holdingSortKey === key) {
      setHoldingSortDir((direction) => direction * -1);
      return;
    }
    setHoldingSortKey(key);
    setHoldingSortDir(["ticker", "company", "theme"].includes(key) ? 1 : -1);
  };

  return <div className="space-y-6">
    <OverviewHeaderBar
      range={range}
      setRange={setRange}
      customRange={customRange}
      setCustomRange={setCustomRange}
      relativeView={relativeView}
      setRelativeView={setRelativeView}
      benchmark={benchmark}
      setBenchmark={setBenchmark}
      lastPriceUpdate={lastPriceUpdate}
      onExportCsv={exportCsv}
      onExportPdf={() => window.print()}
      benchmarkOptions={BENCHMARK_OPTIONS}
    />

    <Card className="p-5">
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Top KPI Strip</p>
          <h3 className="mt-1 text-xl font-bold text-slate-900">Institutional summary, benchmark-relative by default</h3>
          <p className="mt-1 text-sm text-slate-500">The first row shows what happened, how much risk it required, and how concentrated the current book is.</p>
        </div>
        <div className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
          {selectedRangeLabel} · as of {selectionAsOf}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard
          label="Portfolio Value / NAV"
          value={fmt.usdExact(liveBookSnapshot.nav)}
          sub={`Stocks ${fmt.usd(liveBookSnapshot.stockValue)} · Benchmark ${fmt.usd(liveBookSnapshot.benchmarkValue)}`}
          delta={liveBookSnapshot.dayPnl == null ? null : `${liveBookSnapshot.dayPnl >= 0 ? "+" : ""}${fmt.usdExact(liveBookSnapshot.dayPnl)} day move`}
          sparklineData={navSparkline}
          icon={DollarSign}
          detail={overviewDetails.portfolioNav}
          footerLabel={lastPriceUpdate ? "Live" : ""}
        />
        <StatCard
          label="Total Return"
          value={fmt.pct(rangeStats.totalReturn)}
          sub={`Benchmark ${fmt.pct(rangeStats.benchmarkReturn)}`}
          trend={rangeStats.totalReturn >= 0 ? "up" : "down"}
          color={rangeStats.totalReturn >= 0 ? "text-emerald-700" : "text-red-600"}
          delta={previousRangeStats ? formatComparableDelta(rangeStats.totalReturn, previousRangeStats.totalReturn, (value) => fmt.pct(value, 1)) : null}
          sparklineData={totalReturnSparkline}
          icon={TrendingUp}
          detail={selectedRangeDetails.totalReturn}
          footerLabel={selectedRangeLabel}
        />
        <StatCard
          label="Active Return vs Benchmark"
          value={fmt.pct(rangeStats.activeReturn)}
          sub={`Alpha ${rangeStats.alpha == null ? "—" : fmt.pct(rangeStats.alpha, 1)}`}
          trend={rangeStats.activeReturn >= 0 ? "up" : "down"}
          color={rangeStats.activeReturn >= 0 ? "text-emerald-700" : "text-red-600"}
          delta={previousRangeStats ? formatComparableDelta(rangeStats.activeReturn, previousRangeStats.activeReturn, (value) => fmt.pct(value, 1)) : null}
          sparklineData={activeReturnSparkline}
          sparklineColor="#059669"
          icon={ArrowRightLeft}
          detail={selectedRangeDetails.activeReturn}
          footerLabel={selectedRangeLabel}
        />
        <StatCard
          label="Annualized Volatility"
          value={fmt.pct(liveVolatility)}
          sub={`Downside ${fmt.pct(rangeStats.downsideDeviation)}`}
          sparklineData={annualizedVolSparkline}
          icon={Activity}
          tooltip={"Annualized volatility measures the standard deviation of portfolio returns scaled by sqrt(252). Lower is better only if return is held constant. This card uses the live risk model when available and falls back to the selected history range otherwise."}
          footerLabel={liveRiskMetrics ? "Live risk" : selectedRangeLabel}
        />
        <StatCard
          label="Sharpe Ratio"
          value={rangeStats.sharpeRatio == null ? "—" : fmt.num(rangeStats.sharpeRatio, 2)}
          sub="Excess return per unit of vol"
          trend={rangeStats.sharpeRatio == null ? undefined : (rangeStats.sharpeRatio >= 0 ? "up" : "down")}
          color={rangeStats.sharpeRatio == null ? "text-slate-800" : (rangeStats.sharpeRatio >= 0 ? "text-emerald-700" : "text-red-600")}
          delta={previousRangeStats && previousRangeStats.sharpeRatio != null ? formatComparableDelta(rangeStats.sharpeRatio ?? 0, previousRangeStats.sharpeRatio, (value) => fmt.num(value, 2)) : null}
          sparklineData={sharpeSparkline}
          icon={BarChart3}
          tooltip={"Sharpe ratio = (annualized return - risk free rate) / annualized volatility. It answers how efficiently the fund converted risk into absolute return over the selected range."}
          footerLabel={selectedRangeLabel}
        />
        <StatCard
          label="Information Ratio"
          value={rangeStats.informationRatio == null ? "—" : fmt.num(rangeStats.informationRatio, 2)}
          sub="Active return per unit of TE"
          trend={rangeStats.informationRatio == null ? undefined : (rangeStats.informationRatio >= 0 ? "up" : "down")}
          color={rangeStats.informationRatio == null ? "text-slate-800" : (rangeStats.informationRatio >= 0 ? "text-emerald-700" : "text-red-600")}
          delta={previousRangeStats && previousRangeStats.informationRatio != null ? formatComparableDelta(rangeStats.informationRatio ?? 0, previousRangeStats.informationRatio, (value) => fmt.num(value, 2)) : null}
          sparklineData={infoRatioSparkline}
          icon={BarChart3}
          tooltip={"Information ratio = annualized active return / tracking error. It shows whether benchmark-relative outperformance is coming from repeatable skill or from taking more active risk."}
          footerLabel={selectedRangeLabel}
        />
        <StatCard
          label="Max Drawdown"
          value={fmt.pct(rangeStats.maxDrawdown)}
          sub={`Current ${fmt.pct(rangeStats.drawdownSeries.at(-1)?.portfolioDrawdown || 0)}`}
          trend={rangeStats.maxDrawdown >= 0 ? "up" : "down"}
          color={rangeStats.maxDrawdown >= 0 ? "text-emerald-700" : "text-red-600"}
          delta={previousRangeStats ? formatComparableDelta(rangeStats.maxDrawdown, previousRangeStats.maxDrawdown, (value) => fmt.pct(value, 1)) : null}
          sparklineData={maxDrawdownSparkline}
          sparklineColor="#dc2626"
          icon={AlertTriangle}
          detail={selectedRangeDetails.maxDrawdown}
          footerLabel={selectedRangeLabel}
        />
        <StatCard
          label="Tracking Error"
          value={fmt.pct(liveTrackingError)}
          sub={liveRiskSnapshot.trackingErrorStatus}
          sparklineData={trackingErrorSparkline}
          icon={Activity}
          detail={liveRiskSnapshot.details?.trackingError || overviewDetails.trackingError}
          footerLabel="Live risk"
        />
        <StatCard
          label="Beta vs Benchmark"
          value={liveBeta == null ? "—" : fmt.num(liveBeta)}
          sub={liveRiskSnapshot.betaStatus}
          icon={Shield}
          detail={liveRiskSnapshot.details?.portfolioBeta || overviewDetails.portfolioBeta}
          footerLabel="Live risk"
        />
        <StatCard
          label="Top 5 Holdings Concentration"
          value={fmt.pct(top5Weight, 1)}
          sub={`${concentrationMetrics.largestHolding?.ticker || "—"} is largest at ${concentrationMetrics.largestHolding ? fmt.pct(concentrationMetrics.largestHolding.weight, 1) : "—"}`}
          color={top5Weight > 0.4 ? "text-amber-700" : "text-slate-800"}
          icon={Briefcase}
          detail={selectedRangeDetails.top5Concentration}
          footerLabel="Live book"
        />
      </div>
    </Card>

    <div className="grid gap-4 xl:grid-cols-[1.5fr_0.95fr]">
      <div className="space-y-4">
        <Card className="p-5">
          <SectionHeader
            title="Performance Hero"
            subtitle={relativeView ? "Portfolio and benchmark path with active spread emphasis." : "Cumulative fund return against the benchmark with active spread overlaid."}
          >
            <div className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
              {benchmark === "SP500" ? "S&P 500 benchmark" : benchmark}
            </div>
          </SectionHeader>
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={rangeStats.cumulativeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
              <YAxis tickFormatter={(value) => fmt.pct(value, 1)} tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip formatter={(value) => fmt.pct(value)} />} />
              <Legend />
              <Area
                type="monotone"
                dataKey="active"
                fill={relativeView ? "#059669" : "#cbd5e1"}
                stroke={relativeView ? "#059669" : "#cbd5e1"}
                fillOpacity={relativeView ? 0.18 : 0.12}
                name="Active Spread"
              />
              <Line type="monotone" dataKey="portfolio" stroke="#1e3a5f" strokeWidth={2.5} name="Portfolio" dot={false} />
              <Line type="monotone" dataKey="benchmark" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 5" name="Benchmark" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Day P&amp;L</p>
              <p className={`mt-1 text-lg font-bold ${asNumber(liveBookSnapshot.dayPnl) >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmt.usdExact(liveBookSnapshot.dayPnl)}</p>
              <p className="text-xs text-slate-500">{fmt.pct(liveBookSnapshot.dayReturn)} today</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Benchmark Return</p>
              <p className={`mt-1 text-lg font-bold ${rangeStats.benchmarkReturn >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmt.pct(rangeStats.benchmarkReturn)}</p>
              <p className="text-xs text-slate-500">{selectedRangeLabel}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Current Drawdown</p>
              <p className={`mt-1 text-lg font-bold ${(rangeStats.drawdownSeries.at(-1)?.portfolioDrawdown || 0) >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmt.pct(rangeStats.drawdownSeries.at(-1)?.portfolioDrawdown || 0)}</p>
              <p className="text-xs text-slate-500">vs peak over {selectedRangeLabel}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Live Stop-Loss Alerts</p>
              <p className={`mt-1 text-lg font-bold ${stopLossSnapshot.alertCount > 0 ? "text-amber-700" : "text-emerald-700"}`}>{stopLossSnapshot.alertCount}</p>
              <p className="text-xs text-slate-500">{stopLossSnapshot.breachedCount} breach · {stopLossSnapshot.warningCount} warning</p>
            </div>
          </div>
        </Card>
        <MonthlyReturnHeatmap matrix={monthlyHeatmapMatrix} relativeView={relativeView} />
      </div>

      <div className="space-y-4">
        <PMInsightsPanel insights={pmInsights} />
        <PerformanceSummaryCard summary={performanceSummary} />
        <Card className="p-4">
          <h4 className="text-sm font-semibold text-slate-700">Current Book Snapshot</h4>
          <p className="mt-1 text-xs text-slate-500">Live capital stack, benchmark share, and immediate watch items.</p>
          <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-slate-100">
            {capitalStackRows.map((row) => (
              <div
                key={row.label}
                style={{ width: `${Math.max(row.share * 100, row.share > 0 ? 2 : 0)}%`, backgroundColor: row.fill }}
              />
            ))}
          </div>
          <div className="mt-4 space-y-3">
            {capitalStackRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.fill }} />
                  <span className="text-sm font-medium text-slate-700">{row.label}</span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-800">{fmt.usdExact(row.value)}</p>
                  <p className="text-xs text-slate-500">{fmt.pct(row.share, 1)} of NAV</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Open P&amp;L</p>
              <p className={`mt-1 text-lg font-bold ${liveBookSnapshot.totalUnrealizedPnl >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmt.usd(liveBookSnapshot.totalUnrealizedPnl)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Realized P&amp;L</p>
              <p className={`mt-1 text-lg font-bold ${liveBookSnapshot.totalRealizedPnl >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmt.usd(liveBookSnapshot.totalRealizedPnl)}</p>
            </div>
          </div>
          {weakestOpenRows.length > 0 && <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Weakest Live Contributors</p>
            <div className="mt-3 space-y-2">
              {weakestOpenRows.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 border border-slate-200">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800">{row.ticker}</span>
                      <ThemeBadge theme={row.theme} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{fmt.pct(row.weight, 1)} weight · {fmt.usd(row.positionValue)} market value</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-red-500">{fmt.pct(row.contributionToReturn, 2)}</p>
                    <p className="text-xs text-slate-500">{fmt.usd(row.pnlDollar)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>}
        </Card>
      </div>
    </div>

    <Card className="p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between mb-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Attribution Section</p>
          <h3 className="mt-1 text-xl font-bold text-slate-900">What is driving return and where the risk sits</h3>
          <p className="mt-1 text-sm text-slate-500">Theme, position, and factor views are linked so the book can be interrogated from multiple angles without leaving Overview.</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedTheme && <button onClick={() => setSelectedTheme(null)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Clear theme filter</button>}
          {selectedTheme && <ThemeBadge theme={selectedTheme} />}
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4 border-slate-200 shadow-none">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-700">Return Attribution by Theme</h4>
              <p className="text-xs text-slate-500">Open P&amp;L contribution to NAV return, sorted highest to lowest.</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Click a bar to filter</span>
          </div>
          {returnAttributionRows.length > 0 ? <ResponsiveContainer width="100%" height={320}>
            <BarChart layout="vertical" data={returnAttributionRows} margin={{ left: 12, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tickFormatter={(value) => fmt.pct(value, 1)} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="theme" width={92} tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip formatter={(value) => fmt.pct(value)} />} />
              <Bar dataKey="contributionToReturn" name="Contribution" radius={[0, 4, 4, 0]} onClick={(data) => setSelectedTheme(data?.theme || null)}>
                {returnAttributionRows.map((row) => <Cell key={row.theme} fill={row.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer> : <p className="py-10 text-sm text-slate-500">Theme attribution becomes visible after the live book finishes loading.</p>}
        </Card>

        <Card className="p-4 border-slate-200 shadow-none">
          <div className="mb-3">
            <h4 className="text-sm font-semibold text-slate-700">Return Attribution by Position</h4>
            <p className="text-xs text-slate-500">Top 5 contributors and bottom 5 detractors by contribution to current NAV return.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  {["Bucket", "Ticker", "Company", "Theme", "Weight", "Contribution", "Price Return", "Active Wt"].map((heading) => (
                    <th key={heading} className="px-2 py-2 text-left font-semibold uppercase tracking-wider text-slate-500">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positionAttributionTableRows.map((row) => (
                  <tr key={`${row.bucket}-${row.id}`} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-2 py-2 text-slate-500">{row.bucket}</td>
                    <td className="px-2 py-2 font-semibold text-slate-800">{row.ticker}</td>
                    <td className="px-2 py-2 text-slate-600">{row.company}</td>
                    <td className="px-2 py-2"><button type="button" onClick={() => setSelectedTheme(row.theme)}><ThemeBadge theme={row.theme} /></button></td>
                    <td className="px-2 py-2 text-slate-600">{fmt.pct(row.weight, 1)}</td>
                    <td className={`px-2 py-2 font-medium ${row.contributionToReturn >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(row.contributionToReturn, 2)}</td>
                    <td className={`px-2 py-2 font-medium ${row.totalReturnPct >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(row.totalReturnPct, 1)}</td>
                    <td className={`px-2 py-2 font-medium ${row.activeWeight >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(row.activeWeight, 1)}</td>
                  </tr>
                ))}
                {!positionAttributionTableRows.length && <tr><td colSpan={8} className="px-2 py-8 text-center text-sm text-slate-500">No holdings are available for the current theme filter.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-4 border-slate-200 shadow-none">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-700">Risk Contribution by Theme</h4>
              <p className="text-xs text-slate-500">Live modeled share of total theme risk from the current regression.</p>
            </div>
            {liveRiskSnapshot.updatedAt && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Live</span>}
          </div>
          {riskContributionRows.length > 0 ? <ResponsiveContainer width="100%" height={320}>
            <BarChart layout="vertical" data={riskContributionRows} margin={{ left: 12, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tickFormatter={(value) => fmt.pct(value, 1)} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="theme" width={92} tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip formatter={(value) => fmt.pct(value)} />} />
              <Bar dataKey="riskContrib" name="Risk Contribution" radius={[0, 4, 4, 0]} onClick={(data) => setSelectedTheme(data?.theme || null)}>
                {riskContributionRows.map((row) => <Cell key={row.theme} fill={row.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer> : <p className="py-10 text-sm text-slate-500">Risk contribution becomes available after the live regression completes.</p>}
        </Card>

        <Card className="p-4 border-slate-200 shadow-none">
          <div className="mb-3">
            <h4 className="text-sm font-semibold text-slate-700">Factor Exposure / Factor Contribution</h4>
            <p className="text-xs text-slate-500">Available factors from the live model. Unsupported style factors are hidden instead of guessed.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  {["Factor", "Exposure", "Latest Contribution", "Interpretation"].map((heading) => (
                    <th key={heading} className="px-2 py-2 text-left font-semibold uppercase tracking-wider text-slate-500">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {factorExposureRows.map((row) => (
                  <tr key={row.factor} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-2 py-2 font-medium text-slate-800">{row.factor}</td>
                    <td className="px-2 py-2 text-slate-600">{row.factor === "Alpha" ? fmt.pct(row.exposure) : fmt.num(row.exposure, 2)}</td>
                    <td className={`px-2 py-2 font-medium ${asNumber(row.contribution) >= 0 ? "text-emerald-600" : "text-red-500"}`}>{row.contribution == null ? "—" : fmt.pct(row.contribution, 2)}</td>
                    <td className="px-2 py-2 text-slate-500">{row.note}</td>
                  </tr>
                ))}
                {!factorExposureRows.length && <tr><td colSpan={4} className="px-2 py-8 text-center text-sm text-slate-500">Factor exposures appear after the live regression finishes.</td></tr>}
              </tbody>
            </table>
          </div>
          {dominantFactor && <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            Dominant live factor: <span className="font-semibold text-slate-900">{dominantFactor.factor}</span> contributed {fmt.pct(dominantFactor.contribution)} in the latest modeled period.
          </div>}
        </Card>
      </div>
    </Card>

    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="p-4">
        <h4 className="text-sm font-semibold text-slate-700">Concentration &amp; Diversification</h4>
        <p className="mt-1 text-xs text-slate-500">How tightly the current book is packed into its largest names.</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Holdings</p><p className="mt-1 text-lg font-bold text-slate-800">{concentrationMetrics.activeCount}</p></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Top 10 Weight</p><p className="mt-1 text-lg font-bold text-slate-800">{fmt.pct(concentrationMetrics.top10Weight, 1)}</p></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Top 5 Weight</p><p className="mt-1 text-lg font-bold text-slate-800">{fmt.pct(top5Weight, 1)}</p></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Cash Weight</p><p className="mt-1 text-lg font-bold text-slate-800">{fmt.pct(concentrationMetrics.cashWeight, 1)}</p></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Largest Position</p><p className="mt-1 text-base font-bold text-slate-800">{concentrationMetrics.largestHolding?.ticker || "—"}</p><p className="text-xs text-slate-500">{concentrationMetrics.largestHolding ? fmt.pct(concentrationMetrics.largestHolding.weight, 1) : "—"}</p></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">HHI</p><p className="mt-1 text-lg font-bold text-slate-800">{fmt.num(concentrationMetrics.hhi, 4)}</p><p className="text-xs text-slate-500">Turnover unavailable</p></div>
        </div>
      </Card>

      <Card className="p-4">
        <h4 className="text-sm font-semibold text-slate-700">Exposure Breakdown</h4>
        <p className="mt-1 text-xs text-slate-500">Theme-level weights and active weights. Sector, region, and market-cap breakdowns are hidden because the current dataset does not include them.</p>
        <div className="mt-4 max-h-[24rem] overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 bg-slate-50">
                {["Theme", "Weight", "Active Wt", "Benchmark Wt", "Holdings"].map((heading) => (
                  <th key={heading} className="px-3 py-2 text-left font-semibold uppercase tracking-wider text-slate-500">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {themeAttributionRows.map((row) => (
                <tr key={row.theme} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2"><button type="button" onClick={() => setSelectedTheme(row.theme)}><ThemeBadge theme={row.theme} /></button></td>
                  <td className="px-3 py-2 text-slate-600">{fmt.pct(row.portfolioWeight, 1)}</td>
                  <td className={`px-3 py-2 font-medium ${row.activeWeight >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(row.activeWeight, 1)}</td>
                  <td className="px-3 py-2 text-slate-500">{fmt.pct(row.benchmarkWeightEstimate, 1)}</td>
                  <td className="px-3 py-2 text-slate-500">{row.holdings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <h4 className="text-sm font-semibold text-slate-700">Risk Diagnostics</h4>
        <p className="mt-1 text-xs text-slate-500">Live risk where available, with range-based downside and drawdown context alongside it.</p>
        <div className="mt-4 space-y-3">
          {[
            ["Annualized Volatility", fmt.pct(liveVolatility), liveRiskMetrics ? "Live risk model" : selectedRangeLabel],
            ["Downside Deviation", fmt.pct(rangeStats.downsideDeviation), selectedRangeLabel],
            ["Beta", liveBeta == null ? "—" : fmt.num(liveBeta, 2), liveRiskSnapshot.betaStatus],
            ["Alpha", rangeStats.alpha == null ? "—" : fmt.pct(rangeStats.alpha), selectedRangeLabel],
            ["Tracking Error", fmt.pct(liveTrackingError), liveRiskSnapshot.trackingErrorStatus],
            ["Correlation", rangeStats.correlationToBenchmark == null ? "—" : fmt.num(rangeStats.correlationToBenchmark, 2), selectedRangeLabel],
            ["Max Drawdown", fmt.pct(rangeStats.maxDrawdown), selectedRangeLabel],
            ["Daily VaR 95%", liveRiskMetrics?.dailyVaR95 == null ? "—" : fmt.pct(liveRiskMetrics.dailyVaR95), "Live risk model"],
            ["Sortino Ratio", rangeStats.sortinoRatio == null ? "—" : fmt.num(rangeStats.sortinoRatio, 2), selectedRangeLabel],
          ].map(([label, value, context]) => (
            <div key={label} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div>
                <p className="text-sm font-medium text-slate-700">{label}</p>
                <p className="text-[11px] text-slate-500">{context}</p>
              </div>
              <p className="text-sm font-semibold text-slate-900">{value}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>

    <HoldingsOverviewTable
      rows={holdingsOverviewRows}
      search={holdingSearch}
      setSearch={setHoldingSearch}
      sortKey={holdingSortKey}
      sortDir={holdingSortDir}
      onSort={handleHoldingSort}
      selectedTheme={selectedTheme}
      clearTheme={() => setSelectedTheme(null)}
    />
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// HOLDINGS — active + exited, exit functionality, save
// ═══════════════════════════════════════════════════════════════════
function HoldingsPage({ holdings, setHoldings, settings, setSettings, dailyHistory, priceLoading, onRefreshPrices }) {
  const [search,setSearch]=useState("");const [themeFilter,setTF]=useState("All");const [statusFilter,setSF]=useState("all");
  const [sortKey,setSK]=useState("theme");const [sortDir,setSD]=useState(1);const [editingId,setEI]=useState(null);
  const [saveStatus,setSS]=useState(null);
  const [importStatus, setImportStatus] = useState(null);
  const fidelityInputRef = useRef(null);

  const handleSave = async () => { setSS("saving"); await setHoldings(holdings); setTimeout(()=>setSS("saved"),300); setTimeout(()=>setSS(null),2500); };

  const holdingsSnapshot = useMemo(() => buildLiveBookSnapshot(holdings, settings, dailyHistory), [holdings, settings, dailyHistory]);
  const {
    nav: totalVal,
    cashBalance,
    computed: activeComputed,
    exited,
    totalRealizedPnl,
    active,
    bookSummary,
    activeStockCount,
  } = holdingsSnapshot;
  const themes = ["All",...new Set(holdings.map(h=>h.theme))];
  const totalRealized = totalRealizedPnl;

  const displayRows = useMemo(()=>{
    let f = holdings.map(h=>{
      if (h.status==="exited") return {...h, positionValue:exitedPositionValue(h), weight:0, pnlPercent:realizedPnlPercent(h), pnlDollar:realizedPnlDollar(h)};
      const pv=activePositionValue(h); const w=h.status==="active"?pv/totalVal:0;
      return {...h,positionValue:pv,weight:w,pnlPercent:calc.pnlPercent(h.currentPrice,h.buyPrice),pnlDollar:activePnlDollar(h)};
    });
    if (statusFilter!=="all") f=f.filter(h=>h.status===statusFilter);
    if (themeFilter!=="All") f=f.filter(h=>h.theme===themeFilter);
    if (search){const s=search.toLowerCase();f=f.filter(h=>h.ticker.toLowerCase().includes(s)||h.company.toLowerCase().includes(s));}
    f.sort((a,b)=>{const va=a[sortKey],vb=b[sortKey];if(typeof va==="string")return va.localeCompare(vb)*sortDir;return((va||0)-(vb||0))*sortDir;});
    return f;
  },[holdings,themeFilter,statusFilter,search,sortKey,sortDir,totalVal]);

  const handleSort=(k)=>{if(sortKey===k)setSD(-sortDir);else{setSK(k);setSD(1);}};
  const updateH=(id,field,val)=>setHoldings(holdings.map(h=>(h.id===id?{...h,[field]:val}:h)));

  // Exit a position
  const exitPosition=(id)=>{
    const h = holdings.find(x=>x.id===id);
    if (!h || h.status==="exited") return;
    const sellPrice = h.currentPrice;
    const costBasis = h.buyPrice * h.shares;
    const sellTotal = sellPrice * h.shares;
    const realizedPnl = sellTotal - costBasis;
    const realizedPnlPct = costBasis > 0 ? realizedPnl / costBasis : 0;
    setHoldings(holdings.map(x=>x.id===id?{...x,status:"exited",exitDate:new Date().toISOString().split("T")[0],sellPrice,costBasis,sellTotal,realizedPnl,realizedPnlPct,currentPrice:sellPrice}:x));
  };

  const addH=()=>{const nid=String(Date.now());setHoldings([...holdings,{id:nid,ticker:"NEW",company:"New Holding",theme:"AI-Industrial",subTheme:"",buyPrice:100,currentPrice:100,entryDate:new Date().toISOString().split("T")[0],exitDate:"",shares:10,benchmarkWeight:0,stopLossPct:0.1,status:"active",notes:"",marketBeta:1,valueBeta:0,momentumBeta:0,weeklyReturn:0,currentValue:0,pnlFromExcel:0,sellPrice:0,costBasis:0,sellTotal:0,realizedPnl:0,realizedPnlPct:0}]);setEI(nid);};

  const cols = [
    {key:"ticker",label:"Ticker"},{key:"company",label:"Company"},{key:"theme",label:"Theme"},
    {key:"status",label:"Status"},{key:"buyPrice",label:"Buy $",f:v=>fmt.usdExact(v)},
    {key:"currentPrice",label:statusFilter==="exited"?"Sell $":"Current $",f:v=>fmt.usdExact(v)},
    {key:"shares",label:"Shares",f:v=>fmt.shares(v)},{key:"positionValue",label:"Value",f:v=>fmt.usd(v)},
    {key:"weight",label:"Weight",f:v=>fmt.pct(v,2)},{key:"pnlPercent",label:"PnL %",f:v=>fmt.pct(v)},
    {key:"pnlDollar",label:"PnL $",f:v=>fmt.usd(v)},
  ];
  const editableFields=["ticker","company","theme","buyPrice","currentPrice","shares","stopLossPct","marketBeta","status","entryDate","exitDate","notes"];
  const numericFields=["buyPrice","currentPrice","shares","stopLossPct","marketBeta"];

  const activeCount = activeStockCount;
  const exitedCount = exited.length;
  const benchmarkTotal = bookSummary.benchmarkValue;
  const stockTotal = bookSummary.stockValue;
  const portfolioTotal = bookSummary.portfolioTotal;
  const sectionTotals = bookSummary.stockThemeTotals;
  const latestTrackedBalance = holdingsSnapshot.latestTrackedBalance;
  const liveToTrackerGap = holdingsSnapshot.liveToTrackerGap;
  const importFidelityFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportStatus({ type: "loading", message: `Importing ${file.name}...` });
    try {
      const result = await buildHoldingsFromFidelityFile(file, holdings, { importDate: currentLocalDateIso() });
      await setHoldings(result.holdings);
      if (result.cashBalance != null && Math.abs(result.cashBalance - Number(settings.cashBalance || 0)) > 0.005) {
        await setSettings({ ...settings, cashBalance: result.cashBalance });
      }
      setImportStatus({
        type: "success",
        message: `Imported ${result.summary.activeCount} active positions, auto-exited ${result.summary.autoExitedCount}, and set cash to ${result.cashBalance != null ? fmt.usdExact(result.cashBalance) : fmt.usdExact(settings.cashBalance)}.`,
      });
    } catch (error) {
      setImportStatus({ type: "error", message: error?.message || "Fidelity file import failed." });
    } finally {
      event.target.value = "";
    }
  };

  return <div className="space-y-4">
    <SectionHeader title="Holdings" subtitle={`${activeCount} active · ${exitedCount} exited · Realized: ${fmt.usd(totalRealized)}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative"><Search size={14} className="absolute left-2 top-2 text-slate-400"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." className="pl-7 pr-3 py-1.5 text-sm border rounded-md w-32"/></div>
        <select value={themeFilter} onChange={e=>setTF(e.target.value)} className="px-2 py-1.5 text-sm border rounded-md">{themes.map(t=><option key={t}>{t}</option>)}</select>
        <div className="flex rounded-md border border-slate-200 overflow-hidden">{["all","active","exited"].map(s=><button key={s} onClick={()=>setSF(s)} className={`px-2.5 py-1.5 text-xs font-medium ${statusFilter===s?"bg-slate-800 text-white":"text-slate-600 hover:bg-slate-50"}`}>{s==="all"?"All":s==="active"?"Active":"Exited"}</button>)}</div>
        <input ref={fidelityInputRef} type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={importFidelityFile} className="hidden" />
        <button onClick={()=>fidelityInputRef.current?.click()} className="flex items-center gap-1 px-3 py-1.5 text-sm border border-emerald-200 text-emerald-700 rounded-md hover:bg-emerald-50"><Upload size={14}/> Fidelity CSV / XLSX</button>
        <button onClick={onRefreshPrices} disabled={priceLoading} className="flex items-center gap-1 px-3 py-1.5 text-sm border border-blue-200 text-blue-700 rounded-md hover:bg-blue-50 disabled:opacity-50">{priceLoading?<Loader2 size={14} className="animate-spin"/>:<RefreshCw size={14}/>} Prices</button>
        <button onClick={addH} className="flex items-center gap-1 px-3 py-1.5 text-sm border text-slate-700 rounded-md hover:bg-slate-50"><Plus size={14}/> Add</button>
        <button onClick={handleSave} className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-md font-medium ${saveStatus==="saved"?"bg-emerald-600 text-white":"bg-slate-800 text-white hover:bg-slate-700"}`}>{saveStatus==="saving"?<Loader2 size={14} className="animate-spin"/>:saveStatus==="saved"?<Check size={14}/>:<Save size={14}/>} {saveStatus==="saved"?"Saved!":"Save"}</button>
      </div>
    </SectionHeader>
    {importStatus && <Card className={`p-3 ${importStatus.type==="error"?"border-red-200 bg-red-50":importStatus.type==="success"?"border-emerald-200 bg-emerald-50":"border-blue-200 bg-blue-50"}`}>
      <div className="flex items-start gap-2">
        {importStatus.type==="error"?<AlertCircle size={16} className="mt-0.5 text-red-600"/>:importStatus.type==="success"?<CheckCircle size={16} className="mt-0.5 text-emerald-600"/>:<Loader2 size={16} className="mt-0.5 animate-spin text-blue-600"/>}
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wider ${importStatus.type==="error"?"text-red-700":importStatus.type==="success"?"text-emerald-700":"text-blue-700"}`}>Fidelity Import</p>
          <p className={`text-sm ${importStatus.type==="error"?"text-red-700":importStatus.type==="success"?"text-emerald-800":"text-blue-800"}`}>{importStatus.message}</p>
        </div>
      </div>
    </Card>}
    <Card className="overflow-x-auto"><table className="w-full text-xs">
      <thead><tr className="bg-slate-50 border-b">{cols.map(c=><th key={c.key} className="py-2 px-1.5 text-left font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700" onClick={()=>handleSort(c.key)}>{c.label}{sortKey===c.key?(sortDir===1?" ↑":" ↓"):""}</th>)}<th className="py-2 px-1.5 w-16">Actions</th></tr></thead>
      <tbody>{displayRows.map(h=><tr key={h.id} className={`border-b border-slate-100 hover:bg-blue-50/30 ${h.status==="exited"?"bg-slate-50/50 opacity-75":""} ${editingId===h.id?"bg-blue-50/50":""}`}>
        {cols.map(c=><td key={c.key} className="py-1 px-1.5">
          {editingId===h.id && editableFields.includes(c.key) ? (
            c.key==="status"?<select value={h[c.key]} onChange={e=>updateH(h.id,c.key,e.target.value)} className="text-xs py-0.5 border rounded">{["active","exited"].map(o=><option key={o}>{o}</option>)}</select>:
            <input type={numericFields.includes(c.key)?"number":"text"} value={h[c.key]??""} onChange={e=>updateH(h.id,c.key,numericFields.includes(c.key)?parseFloat(e.target.value)||0:e.target.value)} className="w-full px-1 py-0.5 text-xs border rounded" step="any"/>
          ) : (
            c.key==="status"?<Badge status={h[c.key]} small/>:
            c.key==="theme"?<ThemeBadge theme={h[c.key]}/>:
            c.key==="pnlPercent"||c.key==="pnlDollar"?<span className={h[c.key]>=0?"text-emerald-600 font-medium":"text-red-500 font-medium"}>{c.f?c.f(h[c.key]):h[c.key]}</span>:
            <span className={c.key==="ticker"?"font-semibold text-slate-800":"text-slate-600"}>{c.f?c.f(h[c.key]):h[c.key]}</span>
          )}
        </td>)}
        <td className="py-1 px-1.5"><div className="flex items-center gap-1">
          <button onClick={()=>setEI(editingId===h.id?null:h.id)} className="text-slate-400 hover:text-slate-600">{editingId===h.id?<Check size={12}/>:<Edit3 size={12}/>}</button>
          {h.status==="active" && <button onClick={()=>exitPosition(h.id)} className="text-amber-500 hover:text-amber-700" title="Exit position"><LogOut size={12}/></button>}
          <button onClick={()=>setHoldings(holdings.filter(x=>x.id!==h.id))} className="text-slate-300 hover:text-red-500"><Trash2 size={12}/></button>
        </div></td>
      </tr>)}</tbody>
    </table></Card>
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Active Holdings Summary</h3>
          <p className="text-xs text-slate-500">Shared live portfolio snapshot used in Overview, Holdings, and report summaries.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Portfolio Total</p>
          <p className="mt-1 text-lg font-bold text-slate-800">{fmt.usdExact(portfolioTotal)}</p>
          <p className="text-xs text-slate-500">{activeCount} active stock holdings + {fmt.usdExact(cashBalance)} cash</p>
          {latestTrackedBalance && <p className="mt-1 text-xs text-slate-500">Tracker {fmt.shortDate(latestTrackedBalance.date)}: {fmt.usdExact(latestTrackedBalance.portfolioValue)}{Math.abs(liveToTrackerGap || 0) > 0.005 ? ` · Live gap ${fmt.usdExact(liveToTrackerGap)}` : ""}</p>}
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">Stock Holdings</p>
          <p className="mt-1 text-lg font-bold text-blue-900">{fmt.usdExact(stockTotal)}</p>
          <p className="text-xs text-blue-700">{fmt.pct(portfolioTotal > 0 ? stockTotal / portfolioTotal : 0, 1)} of portfolio</p>
        </div>
        <div className="rounded-lg border border-slate-300 bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Benchmark (S&amp;P 500)</p>
          <p className="mt-1 text-lg font-bold text-slate-900">{fmt.usdExact(benchmarkTotal)}</p>
          <p className="text-xs text-slate-500">{fmt.pct(portfolioTotal > 0 ? benchmarkTotal / portfolioTotal : 0, 1)} of portfolio</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Cash</p>
          <p className="mt-1 text-lg font-bold text-slate-800">{fmt.usdExact(cashBalance)}</p>
          <p className="text-xs text-slate-500">{fmt.pct(portfolioTotal > 0 ? cashBalance / portfolioTotal : 0, 1)} of portfolio</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-2 py-2 text-left font-semibold uppercase tracking-wider text-slate-500">Section</th>
              <th className="px-2 py-2 text-right font-semibold uppercase tracking-wider text-slate-500">Holdings</th>
              <th className="px-2 py-2 text-right font-semibold uppercase tracking-wider text-slate-500">Total Value</th>
              <th className="px-2 py-2 text-right font-semibold uppercase tracking-wider text-slate-500">% of Stocks</th>
            </tr>
          </thead>
          <tbody>
            {sectionTotals.map((section)=>(
              <tr key={section.theme} className="border-b border-slate-100 last:border-b-0">
                <td className="px-2 py-2"><ThemeBadge theme={section.theme}/></td>
                <td className="px-2 py-2 text-right text-slate-600">{section.holdings}</td>
                <td className="px-2 py-2 text-right font-semibold text-slate-800">{fmt.usd(section.totalValue)}</td>
                <td className="px-2 py-2 text-right text-slate-600">{fmt.pct(stockTotal > 0 ? section.totalValue / stockTotal : 0, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// RETURNS — workbook-backed history, attribution, and drawdown analysis
// ═══════════════════════════════════════════════════════════════════
function buildReturnDrawdownSeries(rows) {
  let portfolioNav = 1;
  let benchmarkNav = 1;
  let portfolioPeak = 1;
  let benchmarkPeak = 1;
  return rows.map((row) => {
    portfolioNav *= 1 + (Number(row.portfolioReturn) || 0);
    benchmarkNav *= 1 + (Number(row.benchmarkReturn) || 0);
    portfolioPeak = Math.max(portfolioPeak, portfolioNav);
    benchmarkPeak = Math.max(benchmarkPeak, benchmarkNav);
    return {
      ...row,
      portfolioNav,
      benchmarkNav,
      portfolioDrawdown: portfolioNav / portfolioPeak - 1,
      benchmarkDrawdown: benchmarkNav / benchmarkPeak - 1,
    };
  });
}

function summarizeReturnDrawdown(drawdownSeries, key) {
  if (!drawdownSeries.length) return { worstDrawdown: 0, peakWeek: "—", troughWeek: "—" };
  let worst = drawdownSeries[0];
  let peakWeek = "Start";
  let peakLevel = 1;
  for (const row of drawdownSeries) {
    const navKey = key === "portfolioDrawdown" ? "portfolioNav" : "benchmarkNav";
    if (row[navKey] >= peakLevel) {
      peakLevel = row[navKey];
      peakWeek = row.label || row.week || fmt.shortDate(row.date);
    }
    if (row[key] < worst[key]) worst = { ...row, peakWeek };
  }
  return { worstDrawdown: worst[key], peakWeek: worst.peakWeek || "Start", troughWeek: worst.label || worst.week || fmt.shortDate(worst.date), troughDate: worst.date || "" };
}

function buildWeeklyContributionByGroup(rows, field) {
  const grouped = rows.reduce((acc, holding) => {
    const key = holding[field] || holding.theme || "Other";
    if (!acc[key]) acc[key] = { label: key, weight: 0, contribution: 0, pnl: 0 };
    acc[key].weight += holding.weight || 0;
    acc[key].contribution += (holding.weight || 0) * (Number(holding.weeklyReturn) || 0);
    acc[key].pnl += Number(holding.pnlDollar) || 0;
    return acc;
  }, {});
  return Object.values(grouped).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

const ATTRIBUTION_SHEET_FACTORS = [
  { key: "market", label: "S&P 500", betaKey: "portfolioBeta", returnKey: "marketFactorReturn" },
  { key: "value", label: "Value", betaKey: "valueBeta", returnKey: "valueFactorReturn" },
  { key: "momentum", label: "Momentum", betaKey: "momentumBeta", returnKey: "momentumFactorReturn" },
  { key: "growth", label: "Growth", betaKey: "growthBeta", returnKey: "growthFactorReturn" },
];

function buildAttributionSheetDetail(model, sheetKey) {
  const sheet = model?.[sheetKey];
  if (!model || !sheet) return null;
  const isExcess = sheetKey === "excess";
  const factorRows = model.factors.map((factor) => ({
    name: factor.label,
    beta: isExcess ? factor.excessBeta : factor.beta,
    factorReturn: factor.factorReturn,
    contribution: isExcess ? factor.excessContribution : factor.absoluteContribution,
  }));
  const payload = {
    period_label: model.periodLabel,
    total_return: sheet.totalReturn,
    benchmark_return: model.excess.benchmarkReturn,
    factors: factorRows,
  };

  return {
    title: isExcess ? "Excess Return Attribution Detail" : "Absolute Return Attribution Detail",
    displayedValue: `Imputed ${fmt.pct(sheet.imputedReturn)}`,
    displayedSub: `Idiosyncratic ${fmt.pct(sheet.idiosyncraticReturn)}`,
    source: "Built from the live factor betas and the current period factor returns shown in the table.",
    formula: [
      isExcess ? "excess_total_return = portfolio_return - benchmark_return" : "total_return = portfolio_return",
      isExcess ? "market_beta_excess = market_beta - 1" : "market_beta is unchanged in the absolute table",
      "factor_contribution_i = beta_i × factor_return_i",
      "imputed_return = Σ(factor_contribution_i)",
      isExcess ? "excess_idiosyncratic = excess_total_return - imputed_return" : "idiosyncratic_return = total_return - imputed_return",
    ],
    inputs: [
      `Period = ${model.periodLabel}`,
      `Displayed total return = ${fmt.pct(sheet.totalReturn)}`,
      ...(isExcess ? [`Benchmark return = ${fmt.pct(model.excess.benchmarkReturn)}`] : []),
      ...factorRows.map((row) => `${row.name}: beta ${fmt.num(row.beta, 4)}, factor return ${fmt.pct(row.factorReturn)}`),
    ],
    calculation: [
      ...factorRows.map((row) => `${row.name}: ${fmt.num(row.beta, 4)} × ${fmt.pct(row.factorReturn)} = ${fmt.pct(row.contribution)}`),
      `imputed_return = ${factorRows.map((row) => fmt.pct(row.contribution)).join(" + ")} = ${fmt.pct(sheet.imputedReturn)}`,
      `${isExcess ? "excess_" : ""}idiosyncratic_return = ${fmt.pct(sheet.totalReturn)} - ${fmt.pct(sheet.imputedReturn)} = ${fmt.pct(sheet.idiosyncraticReturn)}`,
    ],
    notes: [
      "The exported Python script reproduces the factor rows and totals shown on-screen.",
      isExcess ? "Only the market beta is adjusted by subtracting 1 in the excess table." : "All factor betas are used directly in the absolute table.",
    ],
    pythonFileName: isExcess ? "excess_return_attribution_detail.py" : "absolute_return_attribution_detail.py",
    pythonSource: buildPythonScript(`Recompute ${isExcess ? "excess" : "absolute"} return attribution detail`, payload, [
      'factors = data["factors"]',
      'rows = []',
      'for row in factors:',
      '    rows.append({',
      '        "factor": row["name"],',
      '        "beta": round(row["beta"], 6) if row["beta"] is not None else None,',
      '        "factor_return": round(row["factor_return"], 6) if row["factor_return"] is not None else None,',
      '        "contribution": round((row["beta"] or 0) * (row["factor_return"] or 0), 6),',
      '    })',
      'imputed = fsum(item["contribution"] for item in rows)',
      'result = {',
      '    "period": data["period_label"],',
      '    "table_rows": rows,',
      '    "total_return": round(data["total_return"], 6),',
      '    "benchmark_return": round(data["benchmark_return"], 6),',
      '    "imputed_return": round(imputed, 6),',
      '    "idiosyncratic_return": round(data["total_return"] - imputed, 6),',
      '}',
      'print(json.dumps(result, indent=2))',
    ]),
  };
}

function buildAttributionSheetModel(returnView, analytics) {
  const metrics = analytics?.metrics;
  const period = returnView === "daily" ? analytics?.latestDay : analytics?.latestWeek;
  if (!metrics || !period) return null;

  const totalReturn = asNumber(returnView === "daily" ? period.portfolioReturn : firstNumber(period.compoundedPortfolioReturn, period.portfolioReturn), Number.NaN);
  const benchmarkReturn = asNumber(returnView === "daily" ? period.benchmarkReturn : firstNumber(period.compoundedBenchmarkReturn, period.benchmarkReturn), Number.NaN);
  if (!Number.isFinite(totalReturn) || !Number.isFinite(benchmarkReturn)) return null;

  const factors = ATTRIBUTION_SHEET_FACTORS.map((factor) => {
    const beta = asNumber(metrics[factor.betaKey], Number.NaN);
    const factorReturn = asNumber(period[factor.returnKey], Number.NaN);
    const absoluteContribution = Number.isFinite(beta) && Number.isFinite(factorReturn) ? beta * factorReturn : null;
    const excessBeta = factor.key === "market" && Number.isFinite(beta) ? beta - 1 : beta;
    const excessContribution = Number.isFinite(excessBeta) && Number.isFinite(factorReturn) ? excessBeta * factorReturn : null;
    return {
      ...factor,
      beta: Number.isFinite(beta) ? beta : null,
      factorReturn: Number.isFinite(factorReturn) ? factorReturn : null,
      absoluteContribution,
      excessBeta: Number.isFinite(excessBeta) ? excessBeta : null,
      excessContribution,
    };
  });

  const absoluteImputedReturn = factors.reduce((sum, factor) => sum + (factor.absoluteContribution || 0), 0);
  const excessTotalReturn = totalReturn - benchmarkReturn;
  const excessImputedReturn = factors.reduce((sum, factor) => sum + (factor.excessContribution || 0), 0);
  const residualFromLiveModel = asNumber(period.alphaContrib) + asNumber(period.residualGap);

  const absoluteFormula = factors
    .filter((factor) => factor.absoluteContribution != null)
    .map((factor) => `${factor.label}: ${fmt.num(factor.beta, 2)} × ${fmt.pct(factor.factorReturn)} = ${fmt.pct(factor.absoluteContribution)}`);
  const excessFormula = factors
    .filter((factor) => factor.excessContribution != null)
    .map((factor) => `${factor.label}: ${fmt.num(factor.excessBeta, 2)} × ${fmt.pct(factor.factorReturn)} = ${fmt.pct(factor.excessContribution)}`);

  return {
    periodLabel: returnView === "daily" ? fmt.date(period.date) : `${period.week} · ${fmt.date(period.date)}`,
    periodKind: returnView === "daily" ? "daily" : "weekly",
    modelNote: "The logic is: take the period return, apply each factor beta to that factor's period return, sum those contributions into an imputed return, and treat the remaining difference as idiosyncratic return.",
    factors,
    absolute: {
      totalReturn,
      imputedReturn: absoluteImputedReturn,
      idiosyncraticReturn: totalReturn - absoluteImputedReturn,
      formulaLines: absoluteFormula,
    },
    excess: {
      totalReturn: excessTotalReturn,
      benchmarkReturn,
      imputedReturn: excessImputedReturn,
      idiosyncraticReturn: excessTotalReturn - excessImputedReturn,
      formulaLines: excessFormula,
    },
    residualFromLiveModel,
  };
}

function AttributionSheetTable({ title, periodLabel, totalLabel, betaLabel, sheet, factors, accentClass = "bg-amber-50", detail }) {
  return <Card className="p-4">
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <p className="text-xs text-slate-500">{periodLabel}</p>
      </div>
      <CalculationDetailButton detail={detail}/>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-slate-50">
            <th className="py-2 px-2 text-left font-semibold uppercase tracking-wider text-slate-500">Line Item</th>
            <th className="py-2 px-2 text-left font-semibold uppercase tracking-wider text-slate-500">Total Return</th>
            {factors.map((factor) => <th key={factor.key} className="py-2 px-2 text-left font-semibold uppercase tracking-wider text-slate-500">{factor.label}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-100">
            <td className="py-2 px-2 font-medium text-slate-700">{totalLabel}</td>
            <td className={`py-2 px-2 font-semibold ${sheet.totalReturn >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(sheet.totalReturn)}</td>
            {factors.map((factor) => <td key={factor.key} className="py-2 px-2 text-slate-300">—</td>)}
          </tr>
          <tr className="border-b border-slate-100">
            <td className="py-2 px-2 font-medium text-slate-700">{betaLabel}</td>
            <td className="py-2 px-2 text-slate-300">—</td>
            {factors.map((factor) => <td key={factor.key} className="py-2 px-2 font-medium text-slate-700">{fmt.num(factor.displayBeta)}</td>)}
          </tr>
          <tr className="border-b border-slate-100">
            <td className="py-2 px-2 font-medium text-slate-700">Factor Return</td>
            <td className="py-2 px-2 text-slate-300">—</td>
            {factors.map((factor) => <td key={factor.key} className={`py-2 px-2 font-medium ${factor.factorReturn >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(factor.factorReturn)}</td>)}
          </tr>
          <tr className={`border-b border-slate-100 ${accentClass}`}>
            <td className="py-2 px-2 font-semibold text-slate-800">Beta × Factor Return</td>
            <td className="py-2 px-2 text-slate-300">—</td>
            {factors.map((factor) => <td key={factor.key} className={`py-2 px-2 font-semibold ${factor.displayContribution >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmt.pct(factor.displayContribution)}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Imputed Return</p>
        <p className={`mt-1 text-lg font-bold ${sheet.imputedReturn >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmt.pct(sheet.imputedReturn)}</p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Idiosyncratic Return</p>
        <p className={`mt-1 text-lg font-bold ${sheet.idiosyncraticReturn >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmt.pct(sheet.idiosyncraticReturn)}</p>
      </div>
    </div>
  </Card>;
}

function ReturnsPage({ holdings, weeklyHistory, dailyHistory, settings, risk }) {
  const [returnView, setReturnView] = useState("weekly");
  const liveBookSnapshot = useMemo(
    () => buildLiveBookSnapshot(holdings, settings, dailyHistory),
    [holdings, settings, dailyHistory],
  );
  const performanceSnapshot = useMemo(
    () => buildHistoricalPerformanceSnapshot(weeklyHistory, dailyHistory, liveBookSnapshot, returnView),
    [weeklyHistory, dailyHistory, liveBookSnapshot, returnView],
  );
  const { computed, exited, nav: totalVal } = liveBookSnapshot;
  const activeStocks = liveBookSnapshot.activeStocks;
  const allHoldings = [
    ...computed.map((holding) => ({
      ...holding,
      deployedValue: holdingCostBasis(holding),
      activeValueForTheme: holding.positionValue,
      unrealizedPnl: holding.pnlDollar,
      realizedPnl: 0,
      weeklyContribution: (holding.weight || 0) * (Number(holding.weeklyReturn) || 0),
    })),
    ...exited.map((holding) => ({
      ...holding,
      deployedValue: holding.costBasis,
      activeValueForTheme: 0,
      unrealizedPnl: 0,
      realizedPnl: holding.pnlDollar,
      weeklyContribution: 0,
    })),
  ];
  const totalDeployed = allHoldings.reduce((sum, holding) => sum + (holding.deployedValue || 0), 0);
  const basket = [...new Set(allHoldings.map((holding) => holding.theme))]
    .map((theme) => {
      const themeHoldings = allHoldings.filter((holding) => holding.theme === theme);
      const deployed = themeHoldings.reduce((sum, holding) => sum + (holding.deployedValue || 0), 0);
      const activeValue = themeHoldings.reduce((sum, holding) => sum + (holding.activeValueForTheme || 0), 0);
      const unrealizedPnl = themeHoldings.reduce((sum, holding) => sum + (holding.unrealizedPnl || 0), 0);
      const realizedPnl = themeHoldings.reduce((sum, holding) => sum + (holding.realizedPnl || 0), 0);
      const pnl = unrealizedPnl + realizedPnl;
      return {
        theme,
        deployed,
        activeValue,
        unrealizedPnl,
        realizedPnl,
        pnl,
        contribution: totalDeployed > 0 ? pnl / totalDeployed : 0,
        returnPct: deployed > 0 ? pnl / deployed : 0,
        shareOfBook: totalVal > 0 ? activeValue / totalVal : 0,
      };
    })
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));

  const historyRows = performanceSnapshot.historyRows;
  const chartData = performanceSnapshot.chartData;
  const cumulativeData = performanceSnapshot.cumulativeData;
  const cumulativePortfolio = performanceSnapshot.cumulativePortfolio;
  const cumulativeBenchmark = performanceSnapshot.cumulativeBenchmark;
  const excessReturn = performanceSnapshot.excessReturn;
  const bestPeriod = performanceSnapshot.bestPeriod;
  const worstPeriod = performanceSnapshot.worstPeriod;
  const historyTable = performanceSnapshot.historyTable;
  const hitRate = performanceSnapshot.hitRate;
  const drawdownSeries = performanceSnapshot.drawdownSeries;
  const portfolioDrawdown = performanceSnapshot.portfolioDrawdown;
  const benchmarkDrawdown = performanceSnapshot.benchmarkDrawdown;
  const themeWeeklyAttribution = buildWeeklyContributionByGroup(activeStocks, "theme");
  const holdingDrivers = [...activeStocks]
    .map((holding) => ({
      ...holding,
      weeklyContribution: (holding.weight || 0) * (Number(holding.weeklyReturn) || 0),
    }))
    .sort((a, b) => Math.abs(b.weeklyContribution) - Math.abs(a.weeklyContribution));
  const periodNoun = returnView === "daily" ? "days" : "weeks";
  const comparisonTitle = returnView === "daily" ? "Daily Return Comparison" : "Weekly Return Comparison";
  const tableTitle = returnView === "daily" ? "Daily Return Table" : "Weekly Return Table";
  const attributionSheet = buildAttributionSheetModel(returnView, risk?.analytics);
  const absoluteSheetFactors = attributionSheet?.factors?.map((factor) => ({
    ...factor,
    displayBeta: factor.beta,
    displayContribution: factor.absoluteContribution,
  })) || [];
  const excessSheetFactors = attributionSheet?.factors?.map((factor) => ({
    ...factor,
    displayBeta: factor.excessBeta,
    displayContribution: factor.excessContribution,
  })) || [];
  const absoluteSheetDetail = attributionSheet ? buildAttributionSheetDetail(attributionSheet, "absolute") : null;
  const excessSheetDetail = attributionSheet ? buildAttributionSheetDetail(attributionSheet, "excess") : null;

  return <div className="space-y-6">
    <SectionHeader title="Returns" subtitle={`${returnView === "daily" ? "Workbook-backed daily history with live holdings refresh overlay" : "Workbook-backed weekly history"}, current attribution, and drawdown analysis across ${historyRows.length} ${periodNoun}`}>
      <div className="flex items-center gap-2">
        <TabButton active={returnView==="weekly"} onClick={()=>setReturnView("weekly")}>Weekly</TabButton>
        <TabButton active={returnView==="daily"} onClick={()=>setReturnView("daily")}>Daily (20D)</TabButton>
      </div>
    </SectionHeader>
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <StatCard label={returnView === "daily" ? "20D Return" : "Cumulative Return"} value={fmt.pct(cumulativePortfolio)} trend={cumulativePortfolio >= 0 ? "up" : "down"} color={cumulativePortfolio >= 0 ? "text-emerald-700" : "text-red-600"} tooltip={`Compounded from ${historyRows.length} reconstructed ${periodNoun}`} />
      <StatCard label="Benchmark" value={fmt.pct(cumulativeBenchmark)} />
      <StatCard label="Excess Return" value={fmt.pct(excessReturn)} trend={excessReturn >= 0 ? "up" : "down"} color={excessReturn >= 0 ? "text-emerald-700" : "text-red-600"} />
      <StatCard label="Hit Rate" value={fmt.pct(hitRate)} sub={`${chartData.filter((row) => row.portfolioReturn > 0).length}/${chartData.length || 0} up ${returnView === "daily" ? "days" : "weeks"}`} />
      <StatCard label={returnView === "daily" ? "Best Day" : "Best Week"} value={bestPeriod ? fmt.pct(bestPeriod.portfolioReturn) : "—"} sub={bestPeriod?.label || "—"} trend={bestPeriod && bestPeriod.portfolioReturn >= 0 ? "up" : "down"} color={bestPeriod && bestPeriod.portfolioReturn >= 0 ? "text-emerald-700" : "text-red-600"} />
      <StatCard label={returnView === "daily" ? "Worst Day" : "Worst Week"} value={worstPeriod ? fmt.pct(worstPeriod.portfolioReturn) : "—"} sub={worstPeriod?.label || "—"} trend="down" color="text-red-600" />
    </div>
    <div className="grid grid-cols-1 gap-4">
      {attributionSheet ? <Card className="p-4 bg-slate-50 border-slate-200">
        <h3 className="text-sm font-semibold text-slate-700">Workbook Attribution Example</h3>
        <p className="mt-2 text-sm text-slate-700 leading-6">
          Using this workbook-style attribution logic for <span className="font-semibold text-slate-900">{attributionSheet.periodLabel}</span>, the absolute imputed return is <span className="font-semibold text-slate-900">{fmt.pct(attributionSheet.absolute.imputedReturn)}</span>, so idiosyncratic return is <span className={`font-semibold ${attributionSheet.absolute.idiosyncraticReturn >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmt.pct(attributionSheet.absolute.idiosyncraticReturn)}</span>.
        </p>
        <p className="mt-3 text-sm text-slate-700 leading-6">
          For the excess sheet, the market beta is adjusted to <span className="font-mono text-slate-900">beta_market - 1</span> while the style factor betas stay unchanged. That produces an excess imputed return of <span className="font-semibold text-slate-900">{fmt.pct(attributionSheet.excess.imputedReturn)}</span> and an excess idiosyncratic return of <span className={`font-semibold ${attributionSheet.excess.idiosyncraticReturn >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmt.pct(attributionSheet.excess.idiosyncraticReturn)}</span>.
        </p>
        <div className="mt-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Absolute Example</p>
            <div className="space-y-1 font-mono text-[11px] leading-5 text-slate-700">
              {attributionSheet.absolute.formulaLines.map((line) => <p key={line}>{line}</p>)}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Excess Example</p>
            <div className="space-y-1 font-mono text-[11px] leading-5 text-slate-700">
              {attributionSheet.excess.formulaLines.map((line) => <p key={line}>{line}</p>)}
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">{attributionSheet.modelNote}</p>
      </Card> : <Card className="p-4">
        {risk?.isLoading || risk?.isRefreshing ? <div className="flex items-center gap-2 text-sm text-slate-600"><Loader2 size={16} className="animate-spin"/> Building the workbook-style attribution example from live regression data…</div> : <p className="text-sm text-slate-500">Workbook-style absolute and excess attribution becomes available once the live regression finishes.</p>}
      </Card>}
      {attributionSheet && <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <AttributionSheetTable
          title="Absolute Return Attribution"
          periodLabel={attributionSheet.periodLabel}
          totalLabel={attributionSheet.periodKind === "daily" ? "Portfolio Daily Return" : "Portfolio Weekly Return"}
          betaLabel="Portfolio Beta"
          sheet={attributionSheet.absolute}
          factors={absoluteSheetFactors}
          accentClass="bg-amber-50"
          detail={absoluteSheetDetail}
        />
        <AttributionSheetTable
          title="Excess Return Attribution"
          periodLabel={`${attributionSheet.periodLabel} · benchmark-relative`}
          totalLabel={attributionSheet.periodKind === "daily" ? "Portfolio Excess Return" : "Weekly Excess Return"}
          betaLabel="Beta (Market - 1)"
          sheet={attributionSheet.excess}
          factors={excessSheetFactors}
          accentClass="bg-blue-50"
          detail={excessSheetDetail}
        />
      </div>}
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Cumulative Return</h3><ResponsiveContainer width="100%" height={260}><ComposedChart data={cumulativeData}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="label" tick={{fontSize:11}}/><YAxis tickFormatter={v=>fmt.pct(v,1)} tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>fmt.pct(v)}/>}/><Legend/><Area type="monotone" dataKey="portfolio" fill="#1e3a5f" fillOpacity={0.08} stroke="#1e3a5f" strokeWidth={2} name="Portfolio"/><Line type="monotone" dataKey="benchmark" stroke="#94a3b8" strokeWidth={2} name="S&P 500" strokeDasharray="5 5"/></ComposedChart></ResponsiveContainer></Card>
      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">{comparisonTitle}</h3><ResponsiveContainer width="100%" height={260}><ComposedChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="label" tick={{fontSize:11}}/><YAxis tickFormatter={v=>fmt.pct(v,1)} tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>fmt.pct(v)}/>}/><Legend/><Bar dataKey="portfolioReturn" fill="#1e3a5f" name="Portfolio" radius={[4,4,0,0]}/><Line type="monotone" dataKey="benchmarkReturn" stroke="#94a3b8" strokeWidth={2} name="S&P 500"/><Line type="monotone" dataKey="excessReturn" stroke="#059669" strokeWidth={2} strokeDasharray="5 5" name="Excess"/></ComposedChart></ResponsiveContainer></Card>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Return Decomposition</h3><ResponsiveContainer width="100%" height={260}><ComposedChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="label" tick={{fontSize:11}}/><YAxis tickFormatter={v=>fmt.pct(v,1)} tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>fmt.pct(v)}/>}/><Legend/><Bar dataKey="explainedReturn" stackId="return" fill="#94a3b8" name="Benchmark"/><Bar dataKey="selectionReturn" stackId="return" fill="#059669" name="Selection / Alpha"/><Line type="monotone" dataKey="portfolioReturn" stroke="#1e3a5f" strokeWidth={2} name="Portfolio"/></ComposedChart></ResponsiveContainer></Card>
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Drawdown Analysis</h3>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Portfolio Max DD</p><p className="mt-1 text-lg font-bold text-slate-800">{fmt.pct(portfolioDrawdown.worstDrawdown)}</p><p className="text-xs text-slate-500">{portfolioDrawdown.peakWeek} to {portfolioDrawdown.troughWeek}</p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Benchmark Max DD</p><p className="mt-1 text-lg font-bold text-slate-800">{fmt.pct(benchmarkDrawdown.worstDrawdown)}</p><p className="text-xs text-slate-500">{benchmarkDrawdown.peakWeek} to {benchmarkDrawdown.troughWeek}</p></div>
        </div>
        <ResponsiveContainer width="100%" height={220}><LineChart data={drawdownSeries}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="label" tick={{fontSize:11}}/><YAxis tickFormatter={v=>fmt.pct(v,1)} tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>fmt.pct(v)}/>}/><Legend/><Line type="monotone" dataKey="portfolioDrawdown" stroke="#1e3a5f" strokeWidth={2} name="Portfolio DD"/><Line type="monotone" dataKey="benchmarkDrawdown" stroke="#94a3b8" strokeWidth={2} name="Benchmark DD"/></LineChart></ResponsiveContainer>
      </Card>
    </div>
    <div className="grid grid-cols-1 xl:grid-cols-[0.92fr_1.08fr] gap-4">
      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">{tableTitle}</h3>
        <div className="max-h-[360px] overflow-y-auto">
          <table className="w-full text-xs"><thead><tr className="bg-slate-50 border-b">{["Period","Date","Portfolio","Benchmark","Excess"].map(h=><th key={h} className="py-2 px-2 text-left font-semibold text-slate-500 uppercase">{h}</th>)}</tr></thead>
          <tbody>{historyTable.map((row)=><tr key={`${row.label}-${row.date}`} className="border-b border-slate-100 hover:bg-slate-50"><td className="py-2 px-2 font-medium text-slate-700">{row.label}</td><td className="py-2 px-2 text-slate-500">{fmt.date(row.date)}</td><td className={`py-2 px-2 font-medium ${row.portfolioReturn >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(row.portfolioReturn)}</td><td className={`py-2 px-2 font-medium ${row.benchmarkReturn >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(row.benchmarkReturn)}</td><td className={`py-2 px-2 font-medium ${row.excessReturn >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(row.excessReturn)}</td></tr>)}</tbody></table>
        </div>
      </Card>
      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Theme PnL Summary (Active + Exited)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs"><thead><tr className="bg-slate-50 border-b">{["Theme","Deployed","Active Value","Unrealized","Realized","Total PnL","Return","Book Share"].map(h=><th key={h} className="py-2 px-3 text-left font-semibold text-slate-500 uppercase">{h}</th>)}</tr></thead>
          <tbody>{basket.map((row)=><tr key={row.theme} className="border-b border-slate-100 hover:bg-slate-50"><td className="py-2 px-3"><ThemeBadge theme={row.theme}/></td><td className="py-2 px-3">{fmt.usd(row.deployed)}</td><td className="py-2 px-3">{fmt.usd(row.activeValue)}</td><td className={`py-2 px-3 font-medium ${row.unrealizedPnl >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.usd(row.unrealizedPnl)}</td><td className={`py-2 px-3 font-medium ${row.realizedPnl >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.usd(row.realizedPnl)}</td><td className={`py-2 px-3 font-medium ${row.pnl >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.usd(row.pnl)}</td><td className={`py-2 px-3 font-medium ${row.returnPct >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(row.returnPct)}</td><td className="py-2 px-3">{fmt.pct(row.shareOfBook, 1)}</td></tr>)}</tbody></table>
        </div>
      </Card>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Current Week Theme Attribution</h3><ResponsiveContainer width="100%" height={260}><BarChart data={themeWeeklyAttribution}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="label" tick={{fontSize:10}}/><YAxis tickFormatter={v=>fmt.pct(v,1)} tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>fmt.pct(v)}/>}/><Bar dataKey="contribution" name="Contribution" radius={[4,4,0,0]}>{themeWeeklyAttribution.map((row,index)=><Cell key={index} fill={getThemeColor(row.label, index)}/>)}</Bar></BarChart></ResponsiveContainer></Card>
      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Current Week Holding Drivers</h3>
        <div className="max-h-[300px] overflow-y-auto">
          <table className="w-full text-xs"><thead><tr className="bg-slate-50 border-b">{["Ticker","Theme","Weight","1W Return","1W Contrib","PnL $"].map(h=><th key={h} className="py-2 px-2 text-left font-semibold text-slate-500 uppercase">{h}</th>)}</tr></thead>
          <tbody>{holdingDrivers.slice(0,12).map((row)=><tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50"><td className="py-2 px-2 font-medium text-slate-700">{row.ticker}</td><td className="py-2 px-2"><ThemeBadge theme={row.theme}/></td><td className="py-2 px-2">{fmt.pct(row.weight,1)}</td><td className={`py-2 px-2 font-medium ${row.weeklyReturn >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(row.weeklyReturn)}</td><td className={`py-2 px-2 font-medium ${row.weeklyContribution >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(row.weeklyContribution,1)}</td><td className={`py-2 px-2 font-medium ${row.pnlDollar >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.usd(row.pnlDollar)}</td></tr>)}</tbody></table>
        </div>
      </Card>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// RISK
// ═══════════════════════════════════════════════════════════════════
function buildRegressionHistory(weeklyHistory) {
  return weeklyHistory.map((row) => {
    const portfolioReturn = Number(row.portfolioReturn) || 0;
    const benchmarkReturn = Number(row.benchmarkReturn) || 0;
    const marketContrib = Number(row.marketContrib) || 0;
    const valueContrib = Number(row.valueContrib) || 0;
    const momentumContrib = Number(row.momentumContrib) || 0;
    const reportedAlpha = Number(row.alpha) || 0;
    const predictedReturn = marketContrib + valueContrib + momentumContrib;
    const residualGap = portfolioReturn - predictedReturn;
    return {
      ...row,
      portfolioReturn,
      benchmarkReturn,
      marketContrib,
      valueContrib,
      momentumContrib,
      reportedAlpha,
      predictedReturn,
      residualGap,
    };
  });
}

function buildDrawdownSeries(regressionHistory) {
  let actualNav = 1;
  let predictedNav = 1;
  let benchmarkNav = 1;
  let actualPeakLevel = 1;
  let predictedPeakLevel = 1;
  let benchmarkPeakLevel = 1;
  let actualPeakWeek = "Start";
  let predictedPeakWeek = "Start";
  let benchmarkPeakWeek = "Start";
  let actualPeakDate = "";
  let predictedPeakDate = "";
  let benchmarkPeakDate = "";

  return regressionHistory.map((row) => {
    actualNav *= 1 + row.portfolioReturn;
    predictedNav *= 1 + row.predictedReturn;
    benchmarkNav *= 1 + row.benchmarkReturn;

    if (actualNav >= actualPeakLevel) {
      actualPeakLevel = actualNav;
      actualPeakWeek = row.week;
      actualPeakDate = row.date;
    }
    if (predictedNav >= predictedPeakLevel) {
      predictedPeakLevel = predictedNav;
      predictedPeakWeek = row.week;
      predictedPeakDate = row.date;
    }
    if (benchmarkNav >= benchmarkPeakLevel) {
      benchmarkPeakLevel = benchmarkNav;
      benchmarkPeakWeek = row.week;
      benchmarkPeakDate = row.date;
    }

    return {
      ...row,
      actualNavLevel: actualNav,
      predictedNavLevel: predictedNav,
      benchmarkNavLevel: benchmarkNav,
      actualPeakLevel,
      predictedPeakLevel,
      benchmarkPeakLevel,
      actualPeakWeek,
      predictedPeakWeek,
      benchmarkPeakWeek,
      actualPeakDate,
      predictedPeakDate,
      benchmarkPeakDate,
      actualDrawdown: actualNav / actualPeakLevel - 1,
      predictedDrawdown: predictedNav / predictedPeakLevel - 1,
      benchmarkDrawdown: benchmarkNav / benchmarkPeakLevel - 1,
    };
  });
}

function summarizeDrawdown(drawdownSeries, config) {
  const { drawdownKey, navKey, peakLevelKey, peakWeekKey, peakDateKey } = config;
  if (!drawdownSeries.length) {
    return { worstDrawdown: 0, peakWeek: "—", troughWeek: "—", recoveryWeek: "—" };
  }
  let worst = drawdownSeries[0];
  for (const row of drawdownSeries) {
    if (row[drawdownKey] < worst[drawdownKey]) worst = row;
  }
  const worstIndex = drawdownSeries.indexOf(worst);
  const recovery = drawdownSeries.slice(worstIndex + 1).find((row) => row[navKey] >= worst[peakLevelKey] - 1e-9);
  return {
    worstDrawdown: worst[drawdownKey],
    peakWeek: worst[peakWeekKey] || "Start",
    peakDate: worst[peakDateKey] || "",
    troughWeek: worst.week || "—",
    troughDate: worst.date || "",
    recoveryWeek: recovery?.week || "Not yet",
    recoveryDate: recovery?.date || "",
  };
}

function buildSubThemeRiskAttribution(computed, lastWeek) {
  if (!computed.length || !lastWeek) return [];

  const benchmarkReturn = Number(lastWeek.benchmarkReturn) || 0;
  const portfolioValueExposure = computed.reduce((s, h) => s + (h.weight || 0) * (Number(h.valueBeta) || 0), 0);
  const portfolioMomentumExposure = computed.reduce((s, h) => s + (h.weight || 0) * (Number(h.momentumBeta) || 0), 0);
  const valueFactorReturn = Math.abs(portfolioValueExposure) > 1e-9 ? (Number(lastWeek.valueContrib) || 0) / portfolioValueExposure : 0;
  const momentumFactorReturn = Math.abs(portfolioMomentumExposure) > 1e-9 ? (Number(lastWeek.momentumContrib) || 0) / portfolioMomentumExposure : 0;

  const grouped = computed.reduce((acc, holding) => {
    const key = holding.subTheme || holding.theme || "Other";
    if (!acc[key]) {
      acc[key] = {
        subTheme: key,
        weight: 0,
        marketExposure: 0,
        valueExposure: 0,
        momentumExposure: 0,
        actualContribution: 0,
      };
    }
    const weight = holding.weight || 0;
    acc[key].weight += weight;
    acc[key].marketExposure += weight * (holding.effectiveBeta || calc.holdingBeta(holding));
    acc[key].valueExposure += weight * (Number(holding.valueBeta) || 0);
    acc[key].momentumExposure += weight * (Number(holding.momentumBeta) || 0);
    acc[key].actualContribution += weight * (Number(holding.weeklyReturn) || 0);
    return acc;
  }, {});

  return Object.values(grouped)
    .map((row) => {
      const marketContrib = row.marketExposure * benchmarkReturn;
      const valueContrib = row.valueExposure * valueFactorReturn;
      const momentumContrib = row.momentumExposure * momentumFactorReturn;
      const predictedContribution = marketContrib + valueContrib + momentumContrib;
      const actualContribution = row.actualContribution;
      return {
        ...row,
        avgBeta: row.weight > 0 ? row.marketExposure / row.weight : 0,
        marketContrib,
        valueContrib,
        momentumContrib,
        predictedContribution,
        actualContribution,
        residualGap: actualContribution - predictedContribution,
        predictedReturn: row.weight > 0 ? predictedContribution / row.weight : 0,
        actualReturn: row.weight > 0 ? actualContribution / row.weight : 0,
      };
    })
    .sort((a, b) => Math.abs(b.predictedContribution) - Math.abs(a.predictedContribution));
}

function RiskPage({ settings, risk }) {
  const [showWeighted, setShowWeighted] = useState(false);
  const analytics = risk.analytics;
  const riskError = risk.error;
  const isLoading = risk.isLoading;
  const isRefreshing = risk.isRefreshing;
  const metrics = analytics?.metrics;
  const riskDetails = metrics ? buildRiskStatDetails(analytics) : {};
  const themeRisk = (analytics?.themeRisk || []).map((row, index) => ({ ...row, fill: getThemeColor(row.theme, index) }));
  const subThemeRisk = analytics?.subThemeRisk || [];
  const topSubThemes = subThemeRisk.slice(0, 10);
  const weeklyAttribution = analytics?.weeklyAttribution || [];
  const lastWeek = analytics?.latestWeek;
  const drawdownSeries = analytics?.drawdownSeries || [];
  const drawdownSummaries = analytics?.drawdownSummary || [];
  const checks = metrics ? [
    { metric: "Daily VaR 95%", current: metrics.dailyVaR95, limit: settings.limits.dailyVaR95 },
    { metric: "Tracking Error", current: metrics.trackingError, limit: settings.limits.trackingError },
    { metric: "Beta Deviation", current: Math.abs(metrics.portfolioBeta - 1), limit: settings.limits.betaDeviation },
    { metric: "Systematic Vol", current: metrics.systematicVol, limit: settings.limits.systematicVol },
    { metric: "Max Stock Weight", current: metrics.maxStockWeight, limit: settings.limits.maxStockWeight },
    { metric: "S&P Weight", current: metrics.spyWeight, limit: settings.limits.spyWeight },
  ].map((row) => ({ ...row, utilization: calc.utilization(row.current, row.limit), status: calc.complianceStatus(row.current, row.limit) })) : [];
  const factorRows = lastWeek ? [
    { factor: "Market", contribution: lastWeek.marketContrib },
    { factor: "Value", contribution: lastWeek.valueContrib },
    { factor: "Momentum", contribution: lastWeek.momentumContrib },
    { factor: "Growth", contribution: lastWeek.growthContrib },
    { factor: "Alpha", contribution: lastWeek.alphaContrib },
    { factor: "Residual Gap", contribution: lastWeek.residualGap },
  ] : [];
  const dominantFactor = factorRows.filter((row) => row.factor !== "Residual Gap").length
    ? [...factorRows.filter((row) => row.factor !== "Residual Gap")].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))[0]
    : null;
  const largestSubTheme = topSubThemes[0] || null;
  const worstWeek = weeklyAttribution.reduce((worst, row) => (!worst || row.portfolioReturn < worst.portfolioReturn ? row : worst), null);

  return <div className="space-y-6">
    <SectionHeader title="Risk Analytics" subtitle={metrics ? `5Y beta regression (${metrics.betaObservations || 0}d) · factor model (${metrics.observations}d)` : "Live Yahoo regression"}>
      <div className="flex items-center gap-2">
        {analytics?.updatedAt && <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-1 rounded">Updated {fmt.date(analytics.updatedAt)}</span>}
        {isRefreshing && <span className="text-[10px] text-blue-600 bg-blue-50 px-2 py-1 rounded">Refreshing live data...</span>}
      </div>
    </SectionHeader>

    {isLoading && <Card className="p-6"><div className="flex items-center gap-3 text-slate-600"><Loader2 size={18} className="animate-spin"/><span className="text-sm">Running live Yahoo regression and rebuilding risk analytics…</span></div></Card>}
    {riskError && <Card className="p-4"><p className="text-sm text-red-600">{riskError}</p></Card>}
    {analytics && !metrics && <Card className="p-4"><p className="text-sm text-slate-500">Not enough live price history was available to run the regression for this holdings set.</p></Card>}
    {analytics && metrics && <>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard label="Portfolio β" value={fmt.num(metrics.portfolioBeta)} icon={Shield} detail={riskDetails.portfolioBeta}/>
        <StatCard label="Tracking Error" value={fmt.pct(metrics.trackingError)} detail={riskDetails.trackingError}/>
        <StatCard label="Daily VaR 95%" value={fmt.pct(metrics.dailyVaR95)} icon={AlertTriangle} detail={riskDetails.dailyVar95}/>
        <StatCard label="Daily VaR 99%" value={fmt.pct(metrics.dailyVaR99)} detail={riskDetails.dailyVar99}/>
        <StatCard label="Systematic Vol" value={fmt.pct(metrics.systematicVol)} detail={riskDetails.systematicVol}/>
        <StatCard label="Idiosyncratic Vol" value={fmt.pct(metrics.idiosyncraticVol)} detail={riskDetails.idiosyncraticVol}/>
      </div>

      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Compliance</h3>
        <table className="w-full text-sm"><thead><tr className="bg-slate-50 border-b">{["Metric","Current","Limit","Utilization","Status"].map(h=><th key={h} className="py-2.5 px-3 text-left text-xs font-semibold text-slate-500 uppercase">{h}</th>)}</tr></thead>
        <tbody>{checks.map(c=><tr key={c.metric} className="border-b hover:bg-slate-50"><td className="py-2.5 px-3 font-semibold text-slate-700">{c.metric}</td><td className="py-2.5 px-3">{fmt.pct(c.current)}</td><td className="py-2.5 px-3 text-slate-500">{fmt.pct(c.limit)}</td><td className="py-2.5 px-3"><div className="flex items-center gap-2"><div className="flex-1 bg-slate-100 rounded-full h-2 max-w-[120px]"><div className="h-2 rounded-full" style={{width:`${Math.min(c.utilization*100,100)}%`,backgroundColor:statusBg(c.status)}}/></div><span className="text-xs font-medium">{fmt.pct(c.utilization,0)}</span></div></td><td className="py-2.5 px-3"><Badge status={c.status}/></td></tr>)}</tbody></table>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700">{showWeighted ? "Weighted Risk (Risk/Weight)" : "Risk by Theme"}</h3>
            <button onClick={()=>setShowWeighted(!showWeighted)} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-all ${showWeighted ? "bg-slate-800 text-white border-slate-800" : "text-slate-600 border-slate-300 hover:bg-slate-50"}`}>
              <ArrowRightLeft size={12}/> {showWeighted ? "Show Absolute" : "Show Risk/Weight"}
            </button>
          </div>
          <ResponsiveContainer width="100%" height={280}><BarChart data={themeRisk}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="theme" tick={{fontSize:9}}/><YAxis tickFormatter={v=>showWeighted?fmt.num(v):fmt.pct(v,0)} tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>showWeighted?fmt.num(v):fmt.pct(v)}/>}/><Bar dataKey={showWeighted?"weightedRisk":"riskContrib"} name={showWeighted?"Risk/Weight":"Risk %"} radius={[4,4,0,0]}>{themeRisk.map((row,index)=><Cell key={index} fill={row.fill}/>)}</Bar></BarChart></ResponsiveContainer>
        </Card>
        <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Theme Risk Profile</h3><table className="w-full text-xs"><thead><tr className="border-b">{["Theme","Weight","Avg β","Risk %","Risk/Weight"].map(h=><th key={h} className="py-2 px-2 text-left font-semibold text-slate-500">{h}</th>)}</tr></thead><tbody>{themeRisk.map(row=><tr key={row.theme} className="border-b border-slate-100"><td className="py-1.5 px-2"><ThemeBadge theme={row.theme}/></td><td className="py-1.5 px-2">{fmt.pct(row.weight,1)}</td><td className="py-1.5 px-2">{fmt.num(row.avgBeta)}</td><td className="py-1.5 px-2">{fmt.pct(row.riskContrib,1)}</td><td className="py-1.5 px-2 font-semibold">{fmt.num(row.weightedRisk)}</td></tr>)}</tbody></table></Card>
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">Past Week Risk Attribution</h3>
            <p className="text-xs text-slate-500">{lastWeek ? `${lastWeek.week} · ${fmt.date(lastWeek.date)}` : "Not enough live history yet"}</p>
          </div>
        </div>
        {lastWeek ? <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <StatCard label="Actual Return" value={fmt.pct(lastWeek.portfolioReturn)} trend={lastWeek.portfolioReturn>=0?"up":"down"} color={lastWeek.portfolioReturn>=0?"text-emerald-700":"text-red-600"}/>
            <StatCard label="Regression Predicted" value={fmt.pct(lastWeek.predictedReturn)} trend={lastWeek.predictedReturn>=0?"up":"down"} color={lastWeek.predictedReturn>=0?"text-emerald-700":"text-red-600"}/>
            <StatCard label="Model Gap" value={fmt.pct(lastWeek.residualGap)} trend={lastWeek.residualGap>=0?"up":"down"} color={lastWeek.residualGap>=0?"text-emerald-700":"text-red-600"}/>
            <StatCard label="Benchmark" value={fmt.pct(lastWeek.benchmarkReturn)}/>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_0.9fr] gap-4">
            <Card className="p-4 bg-slate-50 border-slate-200">
              <p className="text-sm text-slate-700 leading-6">
                The portfolio returned <span className="font-semibold text-slate-900">{fmt.pct(lastWeek.portfolioReturn)}</span> last week versus a regression-implied <span className="font-semibold text-slate-900">{fmt.pct(lastWeek.predictedReturn)}</span>, leaving a residual gap of <span className={`font-semibold ${lastWeek.residualGap >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmt.pct(lastWeek.residualGap)}</span>.
              </p>
              <p className="text-sm text-slate-700 leading-6 mt-3">
                {dominantFactor ? `The largest explained driver was ${dominantFactor.factor.toLowerCase()}, contributing ${fmt.pct(dominantFactor.contribution)}.` : "Regression attribution becomes available once enough daily history is aligned."} {largestSubTheme ? `Across the book, ${largestSubTheme.subTheme} carried the largest predicted sub-theme contribution at ${fmt.pct(largestSubTheme.predictedContribution)}.` : ""}
              </p>
            </Card>
            <Card className="p-4">
              <h4 className="text-sm font-semibold text-slate-700 mb-3">Last Week Factor Breakdown</h4>
              <table className="w-full text-xs"><thead><tr className="border-b">{["Factor","Contribution","Share of Prediction"].map(h=><th key={h} className="py-2 px-2 text-left font-semibold text-slate-500">{h}</th>)}</tr></thead>
              <tbody>{factorRows.map((row)=>{const share=lastWeek.predictedReturn!==0?row.contribution/lastWeek.predictedReturn:0;return <tr key={row.factor} className="border-b border-slate-100"><td className="py-2 px-2 text-slate-700 font-medium">{row.factor}</td><td className={`py-2 px-2 font-medium ${row.contribution>=0?"text-emerald-600":"text-red-500"}`}>{fmt.pct(row.contribution)}</td><td className="py-2 px-2">{row.factor==="Residual Gap"? "—" : fmt.pct(share)}</td></tr>;})}</tbody></table>
            </Card>
          </div>
        </> : <p className="text-sm text-slate-500">Not enough live history to calculate a weekly regression view yet.</p>}
        {weeklyAttribution.length > 0 && <div className="mt-4"><ResponsiveContainer width="100%" height={320}><ComposedChart data={weeklyAttribution}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="week" tick={{fontSize:11}}/><YAxis tickFormatter={v=>fmt.pct(v,1)} tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>fmt.pct(v)}/>}/><Legend/><Bar dataKey="marketContrib" stackId="a" fill="#1e3a5f" name="Market"/><Bar dataKey="valueContrib" stackId="a" fill="#2563eb" name="Value"/><Bar dataKey="momentumContrib" stackId="a" fill="#7c3aed" name="Momentum"/><Bar dataKey="growthContrib" stackId="a" fill="#0ea5e9" name="Growth"/><Bar dataKey="alphaContrib" stackId="a" fill="#059669" name="Alpha"/><Bar dataKey="residualGap" stackId="a" fill="#f97316" name="Gap"/><Line type="monotone" dataKey="portfolioReturn" stroke="#0f172a" strokeWidth={2.5} name="Actual"/><Line type="monotone" dataKey="predictedReturn" stroke="#2563eb" strokeWidth={2} strokeDasharray="5 5" name="Predicted"/></ComposedChart></ResponsiveContainer></div>}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Sub-Theme Weekly Risk Attribution</h3>
          {topSubThemes.length > 0 ? <ResponsiveContainer width="100%" height={320}><BarChart data={topSubThemes}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="subTheme" tick={{fontSize:10}} interval={0} angle={-20} textAnchor="end" height={70}/><YAxis tickFormatter={v=>fmt.pct(v,1)} tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>fmt.pct(v)}/>}/><Legend/><Bar dataKey="predictedContribution" fill="#1e3a5f" name="Predicted"/><Bar dataKey="actualContribution" fill="#059669" name="Actual"/></BarChart></ResponsiveContainer> : <p className="text-sm text-slate-500">No sub-theme attribution available yet.</p>}
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Sub-Theme Breakdown Table</h3>
          <div className="max-h-[320px] overflow-y-auto">
            <table className="w-full text-xs"><thead><tr className="border-b">{["Sub-Theme","Weight","Avg β","Predicted","Actual","Gap"].map(h=><th key={h} className="py-2 px-2 text-left font-semibold text-slate-500">{h}</th>)}</tr></thead>
            <tbody>{subThemeRisk.map((row)=><tr key={row.subTheme} className="border-b border-slate-100"><td className="py-2 px-2 text-slate-700 font-medium">{row.subTheme}</td><td className="py-2 px-2">{fmt.pct(row.weight,1)}</td><td className="py-2 px-2">{fmt.num(row.avgBeta)}</td><td className={`py-2 px-2 font-medium ${row.predictedContribution>=0?"text-emerald-600":"text-red-500"}`}>{fmt.pct(row.predictedContribution)}</td><td className={`py-2 px-2 font-medium ${row.actualContribution>=0?"text-emerald-600":"text-red-500"}`}>{fmt.pct(row.actualContribution)}</td><td className={`py-2 px-2 font-medium ${row.residualGap>=0?"text-emerald-600":"text-red-500"}`}>{fmt.pct(row.residualGap)}</td></tr>)}</tbody></table>
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Drawdown Analysis</h3>
        {drawdownSeries.length > 0 ? <>
          <ResponsiveContainer width="100%" height={320}><LineChart data={drawdownSeries}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="date" tick={{fontSize:11}}/><YAxis tickFormatter={v=>fmt.pct(v,1)} tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>fmt.pct(v)}/>}/><Legend/><Line type="monotone" dataKey="actualDrawdown" stroke="#0f172a" strokeWidth={2.5} name="Actual Drawdown"/><Line type="monotone" dataKey="predictedDrawdown" stroke="#059669" strokeWidth={2} strokeDasharray="5 5" name="Regression Drawdown"/><Line type="monotone" dataKey="benchmarkDrawdown" stroke="#94a3b8" strokeWidth={2} name="Benchmark Drawdown"/></LineChart></ResponsiveContainer>
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_0.9fr] gap-4 mt-4">
            <Card className="p-4 bg-slate-50 border-slate-200">
              <p className="text-sm text-slate-700 leading-6">
                The worst realized drawdown reached <span className="font-semibold text-red-600">{fmt.pct(drawdownSummaries.find((row)=>row.label==="Actual")?.worstDrawdown || 0)}</span>. The regression drawdown bottomed at <span className="font-semibold text-slate-900">{fmt.pct(drawdownSummaries.find((row)=>row.label==="Regression")?.worstDrawdown || 0)}</span>, so the stress gap was <span className={`font-semibold ${((drawdownSummaries.find((row)=>row.label==="Actual")?.worstDrawdown || 0) - (drawdownSummaries.find((row)=>row.label==="Regression")?.worstDrawdown || 0)) >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmt.pct((drawdownSummaries.find((row)=>row.label==="Actual")?.worstDrawdown || 0) - (drawdownSummaries.find((row)=>row.label==="Regression")?.worstDrawdown || 0))}</span>.
              </p>
              {worstWeek && <p className="text-sm text-slate-700 leading-6 mt-3">
                In the worst modeled week ({worstWeek.week}), market contributed {fmt.pct(worstWeek.marketContrib)}, value contributed {fmt.pct(worstWeek.valueContrib)}, momentum contributed {fmt.pct(worstWeek.momentumContrib)}, alpha contributed {fmt.pct(worstWeek.alphaContrib)}, and the unexplained gap was {fmt.pct(worstWeek.residualGap)}.
              </p>}
            </Card>
            <Card className="p-4">
              <h4 className="text-sm font-semibold text-slate-700 mb-3">Drawdown Breakdown Table</h4>
              <table className="w-full text-xs"><thead><tr className="border-b">{["Series","Worst DD","Peak","Trough","Recovery"].map(h=><th key={h} className="py-2 px-2 text-left font-semibold text-slate-500">{h}</th>)}</tr></thead>
              <tbody>{drawdownSummaries.map((row)=><tr key={row.label} className="border-b border-slate-100"><td className="py-2 px-2 text-slate-700 font-medium">{row.label}</td><td className={`py-2 px-2 font-medium ${row.worstDrawdown>=0?"text-emerald-600":"text-red-500"}`}>{fmt.pct(row.worstDrawdown)}</td><td className="py-2 px-2">{row.peakWeek}</td><td className="py-2 px-2">{row.troughWeek}</td><td className="py-2 px-2">{row.recoveryWeek}</td></tr>)}</tbody></table>
            </Card>
          </div>
        </> : <p className="text-sm text-slate-500">Drawdown analysis needs enough live return history.</p>}
      </Card>
    </>}
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// STOP-LOSS
// ═══════════════════════════════════════════════════════════════════
function StopLossPage({ holdings, settings }) {
  const [filter,setF]=useState("all");
  const stopLossSnapshot = useMemo(() => buildStopLossSnapshot(holdings, settings), [holdings, settings]);
  const active = stopLossSnapshot.active;
  const data = stopLossSnapshot.rows;
  const filtered=filter==="all"?data:filter==="BREACH"?data.filter(h=>h.alertStatus==="BREACH"):filter==="WARNING"?data.filter(h=>h.alertStatus==="WARNING"):data.filter(h=>h.theme===filter);
  const bc=stopLossSnapshot.breachedCount;const wc=stopLossSnapshot.warningCount;
  const themes=[...new Set(active.map(h=>h.theme))];
  const avgStopLossPct = stopLossSnapshot.avgStopLossPct;

  return <div className="space-y-6">
    <SectionHeader title="Stop-Loss Monitoring" subtitle="4σ framework"/>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3"><StatCard label="Breached" value={bc} color={bc>0?"text-red-600":"text-emerald-600"} icon={AlertCircle} compact/><StatCard label="Warning" value={wc} color={wc>0?"text-amber-600":"text-emerald-600"} icon={AlertTriangle} compact/><StatCard label="OK" value={data.length-bc-wc} color="text-emerald-600" icon={CheckCircle} compact/><StatCard label="Monitored" value={data.length} icon={Shield} compact/></div>
    <div className="flex items-center gap-2 flex-wrap">{["all","BREACH","WARNING",...themes].map(f=><TabButton key={f} active={filter===f} onClick={()=>setF(f)}>{f==="all"?"All":f}</TabButton>)}</div>
    <Card className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-slate-50 border-b">{["Ticker","Theme","Buy $","Current $","SL %","SL Price","Distance","Status"].map(h=><th key={h} className="py-2 px-3 text-left text-xs font-semibold text-slate-500 uppercase">{h}</th>)}</tr></thead>
    <tbody>{filtered.sort((a,b)=>a.distToSl-b.distToSl).map(h=><tr key={h.id} className={`border-b hover:bg-slate-50 ${h.alertStatus==="BREACH"?"bg-red-50/50":h.alertStatus==="WARNING"?"bg-amber-50/30":""}`}><td className="py-2 px-3 font-semibold text-slate-800">{h.ticker}</td><td className="py-2 px-3"><ThemeBadge theme={h.theme}/></td><td className="py-2 px-3">{fmt.usdExact(h.buyPrice)}</td><td className="py-2 px-3">{fmt.usdExact(h.currentPrice)}</td><td className="py-2 px-3">{fmt.pct(h.stopLossPct,0)}</td><td className="py-2 px-3">{fmt.usdExact(h.slPrice)}</td><td className="py-2 px-3"><div className="flex items-center gap-2"><div className="flex-1 bg-slate-100 rounded-full h-2 max-w-[80px]"><div className="h-2 rounded-full" style={{width:`${Math.max(0,Math.min(100,(1-h.distToSl/0.3)*100))}%`,backgroundColor:statusBg(h.alertStatus)}}/></div><span className="text-xs font-medium">{fmt.pct(h.distToSl,1)}</span></div></td><td className="py-2 px-3"><Badge status={h.alertStatus}/></td></tr>)}</tbody></table></Card>
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Stop-Loss Logic</h3>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">General Logic</p>
          <p className="text-sm text-slate-700 leading-6">Only active, non-benchmark holdings are monitored. Each position gets a stop-loss price from its entry price and stop-loss percent. The app then compares the live price to that stop level and classifies the name as <span className="font-semibold text-red-600">BREACH</span>, <span className="font-semibold text-amber-600">WARNING</span>, or <span className="font-semibold text-emerald-600">OK</span>.</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Steps</p>
          <div className="space-y-1 text-sm text-slate-700">
            <p>1. Start with each active holding&apos;s <span className="font-medium">buy price</span> and <span className="font-medium">stop-loss %</span>.</p>
            <p>2. Compute the stop-loss price.</p>
            <p>3. Measure how far the live price is above or below that stop level.</p>
            <p>4. Flag a breach if live price is at or below stop-loss price.</p>
            <p>5. If not breached, flag a warning when distance is below the warning buffer.</p>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Formulas</p>
          <div className="space-y-1 font-mono text-[11px] leading-5 text-slate-700">
            <p>stop_loss_price = buy_price × (1 - stop_loss_pct)</p>
            <p>distance_to_stop = (current_price - stop_loss_price) / current_price</p>
            <p>if current_price &lt;= stop_loss_price: BREACH</p>
            <p>elif distance_to_stop &lt; warning_buffer: WARNING</p>
            <p>else: OK</p>
          </div>
          <div className="mt-3 space-y-1 text-xs text-slate-500">
            <p>Current warning buffer: {fmt.pct(settings.stopLossWarningBuffer,1)}</p>
            <p>Average stop-loss % across monitored names: {fmt.pct(avgStopLossPct,1)}</p>
          </div>
        </div>
      </div>
    </Card>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// TEAM REPORT — save, upload, google doc
// ═══════════════════════════════════════════════════════════════════
function TeamReportPage({ holdings, settings, report, setReport, reportMeta, setReportMeta, risk }) {
  const liveBookSnapshot = useMemo(() => buildLiveBookSnapshot(holdings, settings), [holdings, settings]);
  const liveRiskSnapshot = useMemo(() => buildLiveRiskSnapshot(risk), [risk]);
  const totalVal = liveBookSnapshot.nav;
  const totalRealizedPnl = liveBookSnapshot.totalRealizedPnl;
  const reportBeta = liveRiskSnapshot.beta;
  const [ss,setSS]=useState(null);const [uf,setUF]=useState(null);const [gUrl,setGUrl]=useState(reportMeta?.docUrl||"");const [sUrl,setSUrl]=useState(reportMeta?.docUrl||"");const [showDoc,setSD]=useState(!!reportMeta?.docUrl);const [docEdit,setDE]=useState(!reportMeta?.docUrl);const [upEdit,setUE]=useState(!reportMeta?.uploadedFileName);const fr=useRef(null);

  const save=async()=>{setSS("saving");await setReport(report);await setReportMeta({...reportMeta,docUrl:sUrl||gUrl,uploadedFileName:uf?.name||reportMeta?.uploadedFileName});setTimeout(()=>setSS("saved"),300);setTimeout(()=>setSS(null),2500);};
  const onFile=e=>{const f=e.target.files?.[0];if(!f)return;setUF({name:f.name,url:URL.createObjectURL(f),type:f.type,size:(f.size/1024).toFixed(1)+" KB"});setUE(false);setReportMeta({...reportMeta,uploadedFileName:f.name});};
  const saveDoc=()=>{if(!gUrl)return;let u=gUrl;if(u.includes("/edit"))u=u.replace("/edit","/preview");else if(!u.includes("/preview")&&u.includes("docs.google.com"))u=u.replace(/\/?(\?.*)?$/,"/preview");setSUrl(u);setSD(true);setDE(false);setReportMeta({...reportMeta,docUrl:u});};

  return <div className="space-y-6">
    <SectionHeader title="Team Report">
      <div className="flex items-center gap-2">
        <button onClick={save} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium ${ss==="saved"?"bg-emerald-600 text-white":"bg-slate-800 text-white hover:bg-slate-700"}`}>{ss==="saving"?<Loader2 size={16} className="animate-spin"/>:ss==="saved"?<Check size={16}/>:<Save size={16}/>} {ss==="saved"?"Saved!":"Save All"}</button>
        <button onClick={()=>window.print()} className="flex items-center gap-2 px-4 py-2 border text-slate-700 rounded-md hover:bg-slate-50 text-sm"><Printer size={16}/> Print</button>
      </div>
    </SectionHeader>
    <Card className="p-6"><div className="border-b-2 border-slate-800 pb-4 mb-4 text-center"><h1 className="text-xl font-bold text-slate-800">NYU Stern MIF</h1><p className="text-sm text-slate-500 mt-1">{new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</p></div>
      <div className="grid grid-cols-4 gap-4 text-center">{[{l:"Value",v:fmt.usd(totalVal)},{l:"β",v:reportBeta == null ? "—" : fmt.num(reportBeta),sub:liveRiskSnapshot.betaStatus},{l:"Active",v:liveBookSnapshot.activeStockCount},{l:"Realized PnL",v:fmt.usd(totalRealizedPnl)}].map(s=><div key={s.l} className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-500">{s.l}</p><p className="text-lg font-bold text-slate-800">{s.v}</p>{s.sub?<p className="mt-1 text-[10px] text-slate-500">{s.sub}</p>:null}</div>)}</div></Card>
    <Card className="p-5"><h3 className="text-sm font-semibold text-slate-700 mb-3">Upload Document</h3>
      {upEdit?<div><input ref={fr} type="file" accept=".pdf,.doc,.docx" onChange={onFile} className="hidden"/><button onClick={()=>fr.current?.click()} className="flex items-center gap-2 px-4 py-3 border-2 border-dashed rounded-lg text-sm text-slate-600 hover:border-blue-400 w-full justify-center"><Upload size={18}/> Upload PDF / DOCX</button>
        {uf && <div className="mt-3 flex items-center gap-2"><div className="flex-1 p-2.5 bg-slate-50 rounded-lg flex items-center gap-2"><FileText size={16} className="text-blue-500"/><span className="text-sm font-medium truncate">{uf.name}</span></div><button onClick={()=>setUE(false)} className="px-3 py-2 bg-emerald-600 text-white text-xs rounded-md"><Save size={12}/></button></div>}
      </div>:uf?<div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg"><CheckCircle size={16} className="text-emerald-600"/><span className="text-sm font-medium">{uf.name}</span><button onClick={()=>setUE(true)} className="ml-auto text-xs text-slate-500 border rounded px-2 py-1">Change</button></div>:reportMeta?.uploadedFileName?<div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg"><FileText size={16} className="text-amber-500"/><span className="text-sm">{reportMeta.uploadedFileName}</span><button onClick={()=>setUE(true)} className="ml-auto text-xs border rounded px-2 py-1">Re-upload</button></div>:null}</Card>
    <Card className="p-5"><h3 className="text-sm font-semibold text-slate-700 mb-3">Google Doc</h3>
      {docEdit||!sUrl?<div className="flex gap-2"><input type="text" value={gUrl} onChange={e=>setGUrl(e.target.value)} placeholder="https://docs.google.com/document/d/..." className="flex-1 px-3 py-2.5 text-sm border rounded-lg"/><button onClick={saveDoc} disabled={!gUrl} className="px-4 py-2.5 bg-emerald-600 text-white text-sm rounded-lg disabled:opacity-50"><Save size={14}/></button></div>:
      <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg"><CheckCircle size={16} className="text-blue-600"/><a href={gUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-700 truncate flex-1">{gUrl}</a><button onClick={()=>setDE(true)} className="text-xs border rounded px-2 py-1">Edit</button></div>}</Card>
    {(uf||showDoc) && <Card className="p-4"><div className="border rounded-lg overflow-hidden bg-slate-50" style={{height:"600px"}}>{uf?.type==="application/pdf"?<iframe src={uf.url} className="w-full h-full"/>:showDoc&&!uf?<iframe src={sUrl} className="w-full h-full"/>:<div className="flex items-center justify-center h-full"><p className="text-slate-500">{uf?"Preview unavailable for this format":"Loading..."}</p></div>}</div></Card>}
    <Card className="p-6"><div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-slate-700">Report Draft</h3><button onClick={save} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-slate-800 text-white rounded-md"><Save size={12}/> Save</button></div>
      <textarea value={report} onChange={e=>setReport(e.target.value)} rows={18} className="w-full p-4 text-sm border rounded-lg font-mono" placeholder="Write report..."/>
    </Card>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// SETTINGS — with save
// ═══════════════════════════════════════════════════════════════════
function SettingsPage({ settings, setSettings, holdings, setHoldings, dailyHistory, setDailyHistory, weeklyHistory, setWeeklyHistory, group }) {
  const [showM,setSM]=useState(false);const [ss,setSS]=useState(null);
  const save=async()=>{setSS("saving");await setSettings(settings);setTimeout(()=>setSS("saved"),300);setTimeout(()=>setSS(null),2500);};
  const expJ=()=>{const d=JSON.stringify({holdings,settings,dailyHistory,weeklyHistory},null,2);const b=new Blob([d],{type:"application/json"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download=`stern_${group}_data.json`;a.click();};
  const impJ=()=>{const inp=document.createElement("input");inp.type="file";inp.accept=".json";inp.onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{try{const p=JSON.parse(ev.target.result);if(p.holdings)setHoldings(p.holdings);if(p.settings)setSettings(p.settings);if(p.dailyHistory)setDailyHistory(p.dailyHistory);if(p.weeklyHistory)setWeeklyHistory(p.weeklyHistory);}catch{alert("Invalid JSON");}};r.readAsText(f);};inp.click();};
  const reset=async()=>{if(!confirm(`Reset ${group} database?`))return;try{await fetch("/api/reset",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({group})});window.location.reload();}catch(e){alert("Reset failed: "+e.message);}};

  return <div className="space-y-6">
    <SectionHeader title="Settings" subtitle={`${group} group`}>
      <button onClick={save} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium ${ss==="saved"?"bg-emerald-600 text-white":"bg-slate-800 text-white hover:bg-slate-700"}`}>{ss==="saving"?<Loader2 size={16} className="animate-spin"/>:ss==="saved"?<Check size={16}/>:<Save size={16}/>} {ss==="saved"?"Saved!":"Save Settings"}</button>
    </SectionHeader>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="p-5"><h3 className="text-sm font-semibold text-slate-700 mb-4">Inputs</h3><div className="space-y-3">{[{l:"SPY Weekly Return",k:"spyWeeklyReturn"},{l:"Benchmark Vol",k:"benchmarkVol"},{l:"Portfolio Vol",k:"portfolioVol"},{l:"Risk-Free Rate",k:"riskFreeRate"},{l:"SL Warning Buffer",k:"stopLossWarningBuffer"}].map(p=><div key={p.k} className="flex items-center gap-3"><label className="text-xs text-slate-500 font-medium w-40">{p.l}</label><input type="number" value={settings[p.k]} onChange={e=>setSettings({...settings,[p.k]:parseFloat(e.target.value)||0})} step="0.001" className="flex-1 px-2 py-1.5 text-sm border rounded-md"/></div>)}</div></Card>
      <Card className="p-5"><h3 className="text-sm font-semibold text-slate-700 mb-4">Limits</h3><div className="space-y-3">{Object.entries(settings.limits||{}).map(([k,v])=><div key={k} className="flex items-center gap-3"><label className="text-xs text-slate-500 font-medium w-40 capitalize">{k.replace(/([A-Z])/g," $1")}</label><input type="number" value={v} onChange={e=>setSettings({...settings,limits:{...settings.limits,[k]:parseFloat(e.target.value)||0}})} step="0.01" className="flex-1 px-2 py-1.5 text-sm border rounded-md"/></div>)}</div></Card>
    </div>
    <Card className="p-5"><h3 className="text-sm font-semibold text-slate-700 mb-4">Data</h3><div className="flex flex-wrap gap-3"><button onClick={expJ} className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-md text-sm"><Download size={14}/> Export JSON</button><button onClick={impJ} className="flex items-center gap-2 px-4 py-2 border rounded-md text-sm"><Upload size={14}/> Import JSON</button><button onClick={reset} className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 rounded-md text-sm"><RefreshCw size={14}/> Reset {group}</button></div></Card>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN APP — group switcher + navigation
// ═══════════════════════════════════════════════════════════════════
const NAV = [
  {id:"overview",label:"Overview",icon:Home},{id:"holdings",label:"Holdings",icon:Briefcase},
  {id:"returns",label:"Returns",icon:TrendingUp},{id:"risk",label:"Risk",icon:Shield},
  {id:"stoploss",label:"Stop-Loss",icon:AlertTriangle},{id:"catalyst",label:"Catalyst",icon:Activity},
  {id:"report",label:"Report",icon:PenLine},{id:"settings",label:"Settings",icon:Settings},
];

export default function App() {
  const [group, setGroup] = useState("thematic");
  const [page, setPage] = useState("overview");
  const [sidebarOpen, setSO] = useState(true);
  const db = useDatabase(group);
  const risk = useRiskAnalytics(group, db.loaded ? db.holdings : []);

  if (!db.loaded) return <div className="flex items-center justify-center h-screen bg-slate-50"><div className="text-center"><div className="w-8 h-8 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin mx-auto mb-3"/><p className="text-sm text-slate-500">Loading {GROUP_LABELS[group]}...</p>{db.priceLoading && <p className="text-xs text-blue-500 mt-1">Fetching prices...</p>}</div></div>;

  return (
    <div className="flex h-screen bg-slate-50 print:bg-white print:block" style={{fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      <style>{`@media print{.no-print{display:none !important}} ::-webkit-scrollbar{width:6px} ::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px}`}</style>

      {/* Sidebar */}
      <div className={`no-print bg-white border-r flex flex-col transition-all duration-200 ${sidebarOpen?"w-52":"w-14"}`}>
        <div className="h-[78px] px-3 border-b flex items-center"><div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{backgroundColor:GROUP_COLORS[group]}}><span className="text-white font-bold text-xs">{group[0].toUpperCase()}</span></div>{sidebarOpen && <div className="min-w-0"><p className="text-xs font-bold text-slate-800 truncate">NYU Stern MIF</p><p className="text-[10px] text-slate-500">{GROUP_LABELS[group]} Team</p></div>}</div></div>

        {/* Group Switcher */}
        {sidebarOpen && <div className="p-2 border-b"><p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-2 mb-1">Group</p>
          <div className="grid grid-cols-2 gap-1">{Object.entries(GROUP_LABELS).map(([k,v])=><button key={k} onClick={()=>setGroup(k)} className={`px-2 py-1.5 text-[10px] font-semibold rounded-md transition-all ${group===k?"text-white shadow-sm":"text-slate-600 hover:bg-slate-100"}`} style={group===k?{backgroundColor:GROUP_COLORS[k]}:{}}>{v}</button>)}</div>
        </div>}

        <nav className="flex-1 p-2 space-y-0.5">{NAV.map(item=><button key={item.id} onClick={()=>setPage(item.id)} className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all ${page===item.id?"bg-slate-800 text-white shadow-sm":"text-slate-600 hover:bg-slate-100"}`}><item.icon size={16} className="flex-shrink-0"/>{sidebarOpen && <span className="font-medium text-xs truncate">{item.label}</span>}</button>)}</nav>
        {sidebarOpen && <div className="px-3 pb-2">
          <div className="rounded-lg bg-slate-100 px-3 py-2 text-[10px] leading-4 text-slate-600">
            <p className="font-medium text-slate-700">Designed by Bryan Wen</p>
            <p className="break-all">jw7895@stern.nyu.edu</p>
          </div>
        </div>}
        <div className="p-2 border-t"><button onClick={()=>setSO(!sidebarOpen)} className="w-full py-2 text-slate-400 hover:text-slate-600 text-xs">{sidebarOpen?"← Collapse":"→"}</button></div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {page!=="catalyst" && (
        <header className="no-print h-[78px] bg-white border-b px-6 flex items-center justify-between">
          <div><h1 className="text-lg font-bold text-slate-800">{NAV.find(n=>n.id===page)?.label}</h1><p className="text-xs text-slate-500">NYU Stern MIF · <span className="font-semibold" style={{color:GROUP_COLORS[group]}}>{GROUP_LABELS[group]}</span> · DB-backed</p></div>
          <div className="flex items-center gap-3">
            {db.priceLoading && <span className="text-xs text-blue-600 flex items-center gap-1"><Loader2 size={12} className="animate-spin"/> Updating...</span>}
            {db.lastPriceUpdate && <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">Prices: {db.lastPriceUpdate}</span>}
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"/><span className="text-xs text-slate-500">DB</span></div>
          </div>
        </header>
        )}
        <main className={`flex-1 min-h-0 ${page==='catalyst'?'overflow-hidden p-0 bg-[#0f1117]':'overflow-y-auto p-6'} print:p-0`}>
          {page==="overview" && <OverviewPage holdings={db.holdings} settings={db.settings} weeklyHistory={db.weeklyHistory} dailyHistory={db.dailyHistory} risk={risk} lastPriceUpdate={db.lastPriceUpdate}/>}
          {page==="holdings" && <HoldingsPage holdings={db.holdings} setHoldings={db.setHoldings} settings={db.settings} setSettings={db.setSettings} dailyHistory={db.dailyHistory} priceLoading={db.priceLoading} onRefreshPrices={db.refreshPrices}/>}
          {page==="returns" && <ReturnsPage holdings={db.holdings} settings={db.settings} weeklyHistory={db.weeklyHistory} dailyHistory={db.dailyHistory} risk={risk}/>}
          {page==="risk" && <RiskPage settings={db.settings} risk={risk}/>}
          {page==="stoploss" && <StopLossPage holdings={db.holdings} settings={db.settings}/>}
          {page==="report" && <TeamReportPage holdings={db.holdings} settings={db.settings} report={db.report} setReport={db.setReport} reportMeta={db.reportMeta} setReportMeta={db.setReportMeta} risk={risk}/>}
          {page==="settings" && <SettingsPage settings={db.settings} setSettings={db.setSettings} holdings={db.holdings} setHoldings={db.setHoldings} dailyHistory={db.dailyHistory} setDailyHistory={db.setDailyHistory} weeklyHistory={db.weeklyHistory} setWeeklyHistory={db.setWeeklyHistory} group={group}/>}
          {page==="catalyst" && <CatalystPage holdings={db.holdings}/>}
        </main>
      </div>
      {page!=="catalyst" && <CommentPanel page={page} group={group}/>}
    </div>
  );
}
