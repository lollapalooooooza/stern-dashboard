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

  return [...byKey.values()]
    .sort((a, b) => {
      if (a.date && b.date && a.date !== b.date) return a.date.localeCompare(b.date);
      const weekDiff = parseWeekNumber(a.week) - parseWeekNumber(b.week);
      if (weekDiff !== 0) return weekDiff;
      return a._index - b._index;
    })
    .map((row, index) => ({
      week: `W${index + 1}`,
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

  return [...byDate.values()]
    .sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a._index - b._index))
    .map((row) => ({
      date: row.date,
      portfolioValue: row.portfolioValue,
      benchmarkValue: row.benchmarkValue,
      portfolioReturn: row.portfolioReturn,
      benchmarkReturn: row.benchmarkReturn,
      marketContrib: row.marketContrib,
      valueContrib: row.valueContrib,
      momentumContrib: row.momentumContrib,
      alpha: row.alpha,
      sinceStart: row.sinceStart,
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

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/x-python;charset=utf-8" });
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
    "# Auto-generated by Stern Dashboard Overview metric detail",
    `# ${description}`,
    "import json",
    "from math import fsum, sqrt",
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

const StatCard = ({ label, value, sub, icon: Icon, trend, color = "text-slate-700", tooltip, editable, onEdit, detail }) => {
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
    downloadTextFile(detail.pythonFileName, detail.pythonSource);
    setCopied("downloaded");
  };

  return (<>
    <div ref={cardRef} className="relative h-full" onMouseEnter={openDetail} onMouseLeave={closeDetail}>
    <Card className={`h-full p-4 hover:shadow-md transition-shadow ${(tooltip||editable||hasDetail)?"cursor-pointer":""} ${hasDetail ? "min-h-[7.75rem]" : "min-h-[7rem]"}`} onClick={handleCardClick}>
      <div className="flex h-full flex-col justify-between">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
            <p className={`text-lg font-bold ${color}`}>{value}</p>
            <p className={`mt-0.5 min-h-[1.5rem] text-xs ${trend==="up"?"text-emerald-600":trend==="down"?"text-red-500":"text-slate-500"}`}>{sub || " "}</p>
          </div>
          {Icon && <div className="rounded-lg bg-slate-50 p-2"><Icon size={16} className="text-slate-400" /></div>}
        </div>
        <div className="min-h-[1rem] pt-2">
          {hasDetail ? <p className="text-[10px] font-medium text-slate-400">Hover or click for formula</p> : null}
        </div>
      </div>
    </Card>
    {showDetail && <div className={`absolute top-full z-[90] mt-2 w-[min(30rem,calc(100vw-2rem))] ${detailSide === "left" ? "right-0" : "left-0"}`} onMouseEnter={openDetail} onMouseLeave={closeDetail}>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Overview Formula</p>
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
    latestTrackerDateLabel,
    portfolioStartValue,
    previousTotalVal,
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
      active_count: computed.length,
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
        `active_positions = ${computed.length}`,
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
      displayedValue: fmt.num(displayBeta),
      displayedSub: betaStatus,
      source: liveRiskMetrics ? "Displayed from the live /api/risk regression payload." : "Displayed from holdings-weighted adjusted beta fallback.",
      formula: [
        "display_beta = live_regression_beta if available else holdings_weighted_beta",
        "holdings_weighted_beta = Σ(weight_i × adjusted_beta_i)",
        "adjusted_beta_i = 1 + (market_beta_i - 1) × (1 - benchmark_weight_i)",
      ],
      inputs: [
        `live_regression_beta = ${liveRiskMetrics ? fmt.num(liveRiskMetrics.portfolioBeta, 4) : "not available"}`,
        `fallback_holdings_beta = ${fmt.num(localPortBeta, 4)}`,
        `observations = ${liveRiskMetrics?.observations || 0}`,
      ],
      calculation: [
        liveRiskMetrics ? `display_beta = live_regression_beta = ${fmt.num(displayBeta, 4)}` : `display_beta = fallback_holdings_beta = ${fmt.num(displayBeta, 4)}`,
        `fallback_holdings_beta = ${fmt.num(localPortBeta, 4)}`,
      ],
      notes: betaContributors,
      pythonFileName: "overview_portfolio_beta_check.py",
      pythonSource: buildPythonScript("Verify Overview portfolio beta display and fallback holdings beta", sharedPayload, [
        'def adjusted_beta(row):',
        '    return 1 + (row["market_beta"] - 1) * (1 - row["benchmark_weight"])',
        'fallback_holdings_beta = fsum(row["weight"] * adjusted_beta(row) for row in data["active_holdings"])',
        'live_regression_beta = None if data["live_risk_metrics"] is None else data["live_risk_metrics"]["portfolio_beta"]',
        'display_beta = live_regression_beta if live_regression_beta is not None else fallback_holdings_beta',
        'print({"display_beta": round(display_beta, 6), "live_regression_beta": None if live_regression_beta is None else round(live_regression_beta, 6), "fallback_holdings_beta": round(fallback_holdings_beta, 6)})',
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
      displayedValue: String(computed.length),
      displayedSub: `${exited.length} exited`,
      source: "Displayed from current holdings status flags.",
      formula: [
        "active_positions = count(holding.status == 'active')",
        "exited_positions = count(holding.status == 'exited')",
      ],
      inputs: [
        `active_positions = ${computed.length}`,
        `exited_positions = ${exited.length}`,
      ],
      calculation: [
        `active_positions = ${computed.length}`,
        `exited_positions = ${exited.length}`,
      ],
      notes: themeCounts,
      pythonFileName: "overview_active_positions_check.py",
      pythonSource: buildPythonScript("Count active and exited positions for the Overview card", sharedPayload, [
        'active_positions = len(data["active_holdings"])',
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

// ═══════════════════════════════════════════════════════════════════
// OVERVIEW
// ═══════════════════════════════════════════════════════════════════
function OverviewPage({ holdings, settings, weeklyHistory, dailyHistory, risk }) {
  const [returnView, setReturnView] = useState("weekly");
  const {
    totalVal,
    investedVal,
    previousTotalVal,
    cashBalance,
    computed,
    exited,
    totalRealizedPnl,
    totalUnrealizedPnl,
    activeCostBasis,
    realizedCostBasis,
    totalPnl,
    totalReturnPct,
    liveDailyReturn,
    liveBenchmarkReturn,
  } = computeHoldings(holdings, settings);
  const liveRiskMetrics = risk?.analytics?.metrics || null;
  const trackedDailyHistory = normalizeDailyHistoryRows(dailyHistory);
  const liveDailyHistory = buildLiveDailyHistoryRows(dailyHistory, {
    portfolioValue: totalVal,
    dailyReturn: liveDailyReturn,
    benchmarkReturn: liveBenchmarkReturn,
  });
  const analysisHistory = selectReturnHistory(returnView, weeklyHistory, liveDailyHistory);
  const bookSummary = summarizeActiveBook(computed, cashBalance, totalVal);
  const latestTrackedBalance = trackedDailyHistory.at(-1) || null;
  const liveLatestBalance = liveDailyHistory.at(-1) || null;
  const portfolioStartValue = trackedDailyHistory[0]?.portfolioValue ?? liveDailyHistory[0]?.portfolioValue ?? null;
  const overviewDailyReturn = liveDailyReturn ?? (liveLatestBalance?.portfolioReturn ?? null);
  const dailyReturnTrend = overviewDailyReturn == null ? undefined : (overviewDailyReturn >= 0 ? "up" : "down");
  const dailyReturnColor = overviewDailyReturn == null ? "text-slate-700" : (overviewDailyReturn >= 0 ? "text-emerald-700" : "text-red-600");
  const liveDailyBaseDate = previousTotalVal == null && liveDailyHistory.length > 1 ? liveDailyHistory.at(-2)?.date : null;
  const liveDailyBaseValue = previousTotalVal ?? (liveDailyHistory.length > 1 ? liveDailyHistory.at(-2)?.portfolioValue : latestTrackedBalance?.portfolioValue ?? null);
  const liveToTrackerGap = latestTrackedBalance ? totalVal - latestTrackedBalance.portfolioValue : null;
  const displayPortfolioValue = totalVal;
  const unrealizedPnlPct = displayPortfolioValue > 0 ? totalUnrealizedPnl / displayPortfolioValue : 0;
  const realizedPnlPct = displayPortfolioValue > 0 ? totalRealizedPnl / displayPortfolioValue : 0;
  const displayTotalReturnDollar = totalPnl;
  const displayTotalReturnPct = displayPortfolioValue > 0 ? totalPnl / displayPortfolioValue : totalReturnPct;
  const stocksOnly = computed.filter(h => h.theme!=="Benchmark");
  const localPortBeta = calc.portfolioBeta(computed);
  const localSysVol = calc.systematicVol(localPortBeta, settings.benchmarkVol);
  const localIdioVol = calc.idiosyncraticVol(settings.portfolioVol, localSysVol);
  const localTe = calc.trackingError(localPortBeta, settings.benchmarkVol, localIdioVol);
  const displayBeta = liveRiskMetrics?.portfolioBeta ?? localPortBeta;
  const displayTrackingError = liveRiskMetrics?.trackingError ?? localTe;
  const displayDailyVaR95 = liveRiskMetrics?.dailyVaR95 ?? calc.dailyVaR95(settings.portfolioVol);
  const displayAnnualizedVol = liveRiskMetrics?.annualizedVol ?? settings.portfolioVol;
  const displaySystematicVol = liveRiskMetrics?.systematicVol ?? localSysVol;
  const betaStatus = risk?.isLoading ? "Loading live regression..." : risk?.isRefreshing ? "Refreshing live regression..." : liveRiskMetrics ? `${liveRiskMetrics.observations}d live regression` : risk?.error ? "Risk analytics unavailable" : "Holdings-weighted fallback";
  const allocationLegend = [...bookSummary.portfolioAllocation].sort((a,b)=>b.value-a.value);
  const cumData = buildCumulativeReturnSeries(analysisHistory).map((row, index) => ({ ...row, label: returnView === "daily" ? fmt.shortDate(analysisHistory[index]?.date) : analysisHistory[index]?.week }));
  const pnlSorted = [...stocksOnly].sort((a,b)=>b.pnlDollar-a.pnlDollar);
  const pnlChart = [...pnlSorted.slice(0,5),...pnlSorted.slice(-5)];
  const tickers = stocksOnly.map(h=>h.ticker);
  const overviewDetails = buildOverviewStatDetails({
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
    latestTrackerDateLabel: latestTrackedBalance ? fmt.shortDate(latestTrackedBalance.date) : "",
    portfolioStartValue,
    previousTotalVal,
  });

  return <div className="space-y-6">
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
      <StatCard label="Portfolio Value" value={fmt.usdExact(totalVal)} icon={DollarSign} tooltip={`Live holdings + cash: ${fmt.usdExact(totalVal)}\nStock holdings: ${fmt.usdExact(bookSummary.stockValue)}\nBenchmark: ${fmt.usdExact(bookSummary.benchmarkValue)}\nCash: ${fmt.usdExact(cashBalance)}${latestTrackedBalance ? `\nTracker latest (${fmt.date(latestTrackedBalance.date)}): ${fmt.usdExact(latestTrackedBalance.portfolioValue)}\nLive - tracker gap: ${fmt.usdExact(liveToTrackerGap)}` : ""}`} detail={overviewDetails.portfolioValue} />
      <StatCard label="Daily Return" value={fmt.pct(overviewDailyReturn)} trend={dailyReturnTrend} color={dailyReturnColor} icon={ArrowRightLeft} tooltip={`Live holdings return versus ${previousTotalVal != null ? "previous close" : "latest tracked base"}\nCurrent live value: ${fmt.usdExact(totalVal)}${liveDailyBaseDate ? `\nBase date: ${fmt.date(liveDailyBaseDate)}` : ""}${liveDailyBaseValue != null ? `\nBase value: ${fmt.usdExact(liveDailyBaseValue)}` : ""}`} detail={overviewDetails.dailyReturn} />
      <StatCard label="Total Return" value={fmt.usdExact(displayTotalReturnDollar)} sub={fmt.pct(displayTotalReturnPct)} trend={displayTotalReturnDollar >= 0 ? "up" : "down"} color={displayTotalReturnDollar >= 0 ? "text-emerald-700" : "text-red-600"} icon={BarChart3} tooltip={`Realized + unrealized PnL: ${fmt.usdExact(totalPnl)}\nMeasured versus full portfolio value: ${fmt.usdExact(displayPortfolioValue)}${portfolioStartValue != null ? `\nInitial tracked balance: ${fmt.usdExact(portfolioStartValue)}` : ""}${latestTrackedBalance ? `\nLatest tracked balance: ${fmt.usdExact(latestTrackedBalance.portfolioValue)}` : ""}`} detail={overviewDetails.totalReturn} />
      <StatCard label="Unrealized PnL" value={fmt.usdExact(totalUnrealizedPnl)} sub={fmt.pct(unrealizedPnlPct)} trend={totalUnrealizedPnl >= 0 ? "up" : "down"} color={totalUnrealizedPnl >= 0 ? "text-emerald-700" : "text-red-600"} icon={TrendingUp} tooltip={`Open-position PnL from active holdings\nCost basis: ${fmt.usdExact(activeCostBasis)}\nCurrent active value: ${fmt.usdExact(investedVal)}\nPercent is measured versus full portfolio value: ${fmt.usdExact(displayPortfolioValue)}`} detail={overviewDetails.unrealizedPnl} />
      <StatCard label="Realized PnL" value={fmt.usdExact(totalRealizedPnl)} sub={fmt.pct(realizedPnlPct)} trend={totalRealizedPnl >= 0 ? "up" : "down"} color={totalRealizedPnl >= 0 ? "text-emerald-700" : "text-red-600"} icon={LogOut} tooltip={`${exited.length} exited positions\nExited cost basis: ${fmt.usdExact(realizedCostBasis)}\nPercent is measured versus full portfolio value: ${fmt.usdExact(displayPortfolioValue)}`} detail={overviewDetails.realizedPnl} />
      <StatCard label="Portfolio Beta" value={fmt.num(displayBeta)} sub={betaStatus} icon={Shield} tooltip={liveRiskMetrics ? `Live regression beta versus SPY using Yahoo daily history.\nObservations: ${liveRiskMetrics.observations}` : "Fallback to holdings-weighted beta because live regression is not available."} detail={overviewDetails.portfolioBeta}/>
      <StatCard label="Tracking Error" value={fmt.pct(displayTrackingError)} icon={Activity} detail={overviewDetails.trackingError}/>
      <StatCard label="Daily VaR 95%" value={fmt.pct(displayDailyVaR95)} icon={AlertTriangle} detail={overviewDetails.dailyVar95}/>
      <StatCard label="Active" value={computed.length} icon={Briefcase} sub={`${exited.length} exited`} detail={overviewDetails.active}/>
      <StatCard label="Themes" value={bookSummary.stockThemeCount} icon={BarChart3} detail={overviewDetails.themes}/>
      <StatCard label="Ann. Vol" value={fmt.pct(displayAnnualizedVol)} detail={overviewDetails.annualizedVol}/>
      <StatCard label="Systematic Vol" value={fmt.pct(displaySystematicVol)} detail={overviewDetails.systematicVol}/>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Portfolio Allocation</h3>
        <div className="flex items-center gap-4">
          <ResponsiveContainer width="55%" height={260}><PieChart><Pie data={bookSummary.portfolioAllocation} cx="50%" cy="50%" innerRadius={50} outerRadius={95} paddingAngle={2} dataKey="value" labelLine={false}>{bookSummary.portfolioAllocation.map((e,i)=><Cell key={i} fill={e.fill} stroke="#fff" strokeWidth={2}/>)}</Pie><Tooltip content={<CustomTooltip formatter={v=>fmt.pct(v)}/>}/></PieChart></ResponsiveContainer>
          <div className="w-[45%] space-y-1.5 max-h-[260px] overflow-y-auto pr-1">{allocationLegend.map((t,i)=><div key={i} className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm flex-shrink-0" style={{backgroundColor:t.fill}}/><span className="text-xs text-slate-700 flex-1 truncate">{t.name}</span><span className="text-xs font-semibold text-slate-800 tabular-nums">{fmt.pct(t.value,1)}</span></div>)}</div>
        </div></Card>
      <NewsFeed tickers={tickers}/>
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Cumulative Return</h3>
          <div className="flex items-center gap-2">
            <TabButton active={returnView==="weekly"} onClick={()=>setReturnView("weekly")}>Weekly</TabButton>
            <TabButton active={returnView==="daily"} onClick={()=>setReturnView("daily")}>Daily (20D)</TabButton>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}><ComposedChart data={cumData}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="label" tick={{fontSize:11}}/><YAxis tickFormatter={v=>fmt.pct(v,1)} tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>fmt.pct(v)}/>}/><Legend/><Area type="monotone" dataKey="portfolio" fill="#1e3a5f" fillOpacity={0.08} stroke="#1e3a5f" strokeWidth={2} name="Portfolio"/><Line type="monotone" dataKey="benchmark" stroke="#94a3b8" strokeWidth={2} name="S&P 500" strokeDasharray="5 5"/></ComposedChart></ResponsiveContainer>
      </Card>
      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">PnL by Holding (Top/Bottom 5)</h3>
        <ResponsiveContainer width="100%" height={260}><BarChart data={pnlChart}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="ticker" tick={{fontSize:9}}/><YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>fmt.usd(v)}/>}/><Bar dataKey="pnlDollar" name="PnL $" radius={[4,4,0,0]}>{pnlChart.map((e,i)=><Cell key={i} fill={e.pnlDollar>=0?"#059669":"#dc2626"}/>)}</Bar></BarChart></ResponsiveContainer></Card>
    </div>
    {exited.length > 0 && <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Realized P&L Summary ({exited.length} exits = {fmt.usd(totalRealizedPnl)})</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <div className="bg-emerald-50 rounded-lg p-3 text-center"><p className="text-xs text-emerald-600">Winners</p><p className="text-lg font-bold text-emerald-700">{exited.filter(h=>h.pnlDollar>0).length}</p></div>
        <div className="bg-red-50 rounded-lg p-3 text-center"><p className="text-xs text-red-600">Losers</p><p className="text-lg font-bold text-red-700">{exited.filter(h=>h.pnlDollar<0).length}</p></div>
        <div className="bg-emerald-50 rounded-lg p-3 text-center"><p className="text-xs text-emerald-600">Gains</p><p className="text-lg font-bold text-emerald-700">{fmt.usd(exited.filter(h=>h.pnlDollar>0).reduce((s,h)=>s+h.pnlDollar,0))}</p></div>
        <div className="bg-red-50 rounded-lg p-3 text-center"><p className="text-xs text-red-600">Losses</p><p className="text-lg font-bold text-red-700">{fmt.usd(exited.filter(h=>h.pnlDollar<0).reduce((s,h)=>s+h.pnlDollar,0))}</p></div>
      </div></Card>}
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

  const holdingsSnapshot = useMemo(() => computeHoldings(holdings, settings), [holdings, settings]);
  const {
    totalVal,
    cashBalance,
    computed: activeComputed,
    exited,
    totalRealizedPnl,
    active,
  } = holdingsSnapshot;
  const bookSummary = summarizeActiveBook(activeComputed, cashBalance, totalVal);
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

  const activeCount = active.length;
  const exitedCount = exited.length;
  const benchmarkTotal = bookSummary.benchmarkValue;
  const stockTotal = bookSummary.stockValue;
  const portfolioTotal = bookSummary.portfolioTotal;
  const sectionTotals = bookSummary.stockThemeTotals;
  const trackedDailyHistory = useMemo(() => normalizeDailyHistoryRows(dailyHistory), [dailyHistory]);
  const latestTrackedBalance = trackedDailyHistory.at(-1) || null;
  const liveToTrackerGap = latestTrackedBalance ? portfolioTotal - latestTrackedBalance.portfolioValue : null;
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
          <p className="text-xs text-slate-500">{activeCount} active holdings + {fmt.usdExact(cashBalance)} cash</p>
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

function ReturnsPage({ holdings, weeklyHistory, dailyHistory, settings }) {
  const [returnView, setReturnView] = useState("weekly");
  const { computed, exited, totalVal, liveDailyReturn, liveBenchmarkReturn } = computeHoldings(holdings, settings);
  const liveDailyHistory = buildLiveDailyHistoryRows(dailyHistory, {
    portfolioValue: totalVal,
    dailyReturn: liveDailyReturn,
    benchmarkReturn: liveBenchmarkReturn,
  });
  const activeStocks = computed.filter((holding) => holding.theme !== "Benchmark");
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

  const historyRows = selectReturnHistory(returnView, weeklyHistory, liveDailyHistory);
  const chartData = addHistoryLabels(historyRows, returnView).map((row) => ({
    ...row,
    excessReturn: (Number(row.portfolioReturn) || 0) - (Number(row.benchmarkReturn) || 0),
    explainedReturn: Number(row.marketContrib || 0),
    selectionReturn: Number(row.alpha || 0),
  }));
  const cumulativeData = buildCumulativeReturnSeries(historyRows).map((row, index) => ({ ...row, label: chartData[index]?.label }));
  const cumulativePortfolio = cumulativeData.length ? cumulativeData[cumulativeData.length - 1].portfolio : 0;
  const cumulativeBenchmark = cumulativeData.length ? cumulativeData[cumulativeData.length - 1].benchmark : 0;
  const excessReturn = cumulativePortfolio - cumulativeBenchmark;
  const bestPeriod = chartData.length ? [...chartData].sort((a, b) => b.portfolioReturn - a.portfolioReturn)[0] : null;
  const worstPeriod = chartData.length ? [...chartData].sort((a, b) => a.portfolioReturn - b.portfolioReturn)[0] : null;
  const historyTable = [...chartData].reverse();
  const hitRate = chartData.length ? chartData.filter((row) => row.portfolioReturn > 0).length / chartData.length : 0;
  const drawdownSeries = buildReturnDrawdownSeries(chartData);
  const portfolioDrawdown = summarizeReturnDrawdown(drawdownSeries, "portfolioDrawdown");
  const benchmarkDrawdown = summarizeReturnDrawdown(drawdownSeries, "benchmarkDrawdown");
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
    { factor: "Alpha", contribution: lastWeek.alphaContrib },
    { factor: "Residual Gap", contribution: lastWeek.residualGap },
  ] : [];
  const dominantFactor = factorRows.filter((row) => row.factor !== "Residual Gap").length
    ? [...factorRows.filter((row) => row.factor !== "Residual Gap")].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))[0]
    : null;
  const largestSubTheme = topSubThemes[0] || null;
  const worstWeek = weeklyAttribution.reduce((worst, row) => (!worst || row.portfolioReturn < worst.portfolioReturn ? row : worst), null);

  return <div className="space-y-6">
    <SectionHeader title="Risk Analytics" subtitle={metrics ? `Live Yahoo regression · ${metrics.observations} daily observations` : "Live Yahoo regression"}>
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
        <StatCard label="Portfolio β" value={fmt.num(metrics.portfolioBeta)} icon={Shield} tooltip="Live regression beta versus SPY using Yahoo daily history."/>
        <StatCard label="Tracking Error" value={fmt.pct(metrics.trackingError)}/>
        <StatCard label="Daily VaR 95%" value={fmt.pct(metrics.dailyVaR95)} icon={AlertTriangle}/>
        <StatCard label="Daily VaR 99%" value={fmt.pct(metrics.dailyVaR99)}/>
        <StatCard label="Systematic Vol" value={fmt.pct(metrics.systematicVol)}/>
        <StatCard label="Idiosyncratic Vol" value={fmt.pct(metrics.idiosyncraticVol)}/>
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
        {weeklyAttribution.length > 0 && <div className="mt-4"><ResponsiveContainer width="100%" height={320}><ComposedChart data={weeklyAttribution}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="week" tick={{fontSize:11}}/><YAxis tickFormatter={v=>fmt.pct(v,1)} tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>fmt.pct(v)}/>}/><Legend/><Bar dataKey="marketContrib" stackId="a" fill="#1e3a5f" name="Market"/><Bar dataKey="valueContrib" stackId="a" fill="#2563eb" name="Value"/><Bar dataKey="momentumContrib" stackId="a" fill="#7c3aed" name="Momentum"/><Bar dataKey="alphaContrib" stackId="a" fill="#059669" name="Alpha"/><Bar dataKey="residualGap" stackId="a" fill="#f97316" name="Gap"/><Line type="monotone" dataKey="portfolioReturn" stroke="#0f172a" strokeWidth={2.5} name="Actual"/><Line type="monotone" dataKey="predictedReturn" stroke="#2563eb" strokeWidth={2} strokeDasharray="5 5" name="Predicted"/></ComposedChart></ResponsiveContainer></div>}
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
  const active=holdings.filter(h=>h.status==="active"&&h.theme!=="Benchmark");
  const data=active.map(h=>{const sl=h.buyPrice*(1-h.stopLossPct);const dist=h.currentPrice>0?(h.currentPrice-sl)/h.currentPrice:1;const st=h.currentPrice<=sl?"BREACH":dist<settings.stopLossWarningBuffer?"WARNING":"OK";return{...h,slPrice:sl,distToSl:dist,alertStatus:st};});
  const filtered=filter==="all"?data:filter==="BREACH"?data.filter(h=>h.alertStatus==="BREACH"):filter==="WARNING"?data.filter(h=>h.alertStatus==="WARNING"):data.filter(h=>h.theme===filter);
  const bc=data.filter(h=>h.alertStatus==="BREACH").length;const wc=data.filter(h=>h.alertStatus==="WARNING").length;
  const themes=[...new Set(active.map(h=>h.theme))];

  return <div className="space-y-6">
    <SectionHeader title="Stop-Loss Monitoring" subtitle="4σ framework"/>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3"><StatCard label="Breached" value={bc} color={bc>0?"text-red-600":"text-emerald-600"} icon={AlertCircle}/><StatCard label="Warning" value={wc} color={wc>0?"text-amber-600":"text-emerald-600"} icon={AlertTriangle}/><StatCard label="OK" value={data.length-bc-wc} color="text-emerald-600" icon={CheckCircle}/><StatCard label="Monitored" value={data.length} icon={Shield}/></div>
    <div className="flex items-center gap-2 flex-wrap">{["all","BREACH","WARNING",...themes].map(f=><TabButton key={f} active={filter===f} onClick={()=>setF(f)}>{f==="all"?"All":f}</TabButton>)}</div>
    <Card className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-slate-50 border-b">{["Ticker","Theme","Buy $","Current $","SL %","SL Price","Distance","Status"].map(h=><th key={h} className="py-2 px-3 text-left text-xs font-semibold text-slate-500 uppercase">{h}</th>)}</tr></thead>
    <tbody>{filtered.sort((a,b)=>a.distToSl-b.distToSl).map(h=><tr key={h.id} className={`border-b hover:bg-slate-50 ${h.alertStatus==="BREACH"?"bg-red-50/50":h.alertStatus==="WARNING"?"bg-amber-50/30":""}`}><td className="py-2 px-3 font-semibold text-slate-800">{h.ticker}</td><td className="py-2 px-3"><ThemeBadge theme={h.theme}/></td><td className="py-2 px-3">{fmt.usdExact(h.buyPrice)}</td><td className="py-2 px-3">{fmt.usdExact(h.currentPrice)}</td><td className="py-2 px-3">{fmt.pct(h.stopLossPct,0)}</td><td className="py-2 px-3">{fmt.usdExact(h.slPrice)}</td><td className="py-2 px-3"><div className="flex items-center gap-2"><div className="flex-1 bg-slate-100 rounded-full h-2 max-w-[80px]"><div className="h-2 rounded-full" style={{width:`${Math.max(0,Math.min(100,(1-h.distToSl/0.3)*100))}%`,backgroundColor:statusBg(h.alertStatus)}}/></div><span className="text-xs font-medium">{fmt.pct(h.distToSl,1)}</span></div></td><td className="py-2 px-3"><Badge status={h.alertStatus}/></td></tr>)}</tbody></table></Card>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// TEAM REPORT — save, upload, google doc
// ═══════════════════════════════════════════════════════════════════
function TeamReportPage({ holdings, settings, report, setReport, reportMeta, setReportMeta }) {
  const {totalVal,computed,totalRealizedPnl}=computeHoldings(holdings, settings);const pb=calc.portfolioBeta(computed);
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
      <div className="grid grid-cols-4 gap-4 text-center">{[{l:"Value",v:fmt.usd(totalVal)},{l:"β",v:fmt.num(pb)},{l:"Active",v:computed.length},{l:"Realized PnL",v:fmt.usd(totalRealizedPnl)}].map(s=><div key={s.l} className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-500">{s.l}</p><p className="text-lg font-bold text-slate-800">{s.v}</p></div>)}</div></Card>
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
        <div className="px-3 py-[13px] border-b"><div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{backgroundColor:GROUP_COLORS[group]}}><span className="text-white font-bold text-xs">{group[0].toUpperCase()}</span></div>{sidebarOpen && <div className="min-w-0"><p className="text-xs font-bold text-slate-800 truncate">NYU Stern MIF</p><p className="text-[10px] text-slate-500">{GROUP_LABELS[group]} Team</p></div>}</div></div>

        {/* Group Switcher */}
        {sidebarOpen && <div className="p-2 border-b"><p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-2 mb-1">Group</p>
          <div className="grid grid-cols-2 gap-1">{Object.entries(GROUP_LABELS).map(([k,v])=><button key={k} onClick={()=>setGroup(k)} className={`px-2 py-1.5 text-[10px] font-semibold rounded-md transition-all ${group===k?"text-white shadow-sm":"text-slate-600 hover:bg-slate-100"}`} style={group===k?{backgroundColor:GROUP_COLORS[k]}:{}}>{v}</button>)}</div>
        </div>}

        <nav className="flex-1 p-2 space-y-0.5">{NAV.map(item=><button key={item.id} onClick={()=>setPage(item.id)} className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all ${page===item.id?"bg-slate-800 text-white shadow-sm":"text-slate-600 hover:bg-slate-100"}`}><item.icon size={16} className="flex-shrink-0"/>{sidebarOpen && <span className="font-medium text-xs truncate">{item.label}</span>}</button>)}</nav>
        <div className="p-2 border-t"><button onClick={()=>setSO(!sidebarOpen)} className="w-full py-2 text-slate-400 hover:text-slate-600 text-xs">{sidebarOpen?"← Collapse":"→"}</button></div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {page!=="catalyst" && (
        <header className="no-print bg-white border-b px-6 py-3 flex items-center justify-between">
          <div><h1 className="text-lg font-bold text-slate-800">{NAV.find(n=>n.id===page)?.label}</h1><p className="text-xs text-slate-500">NYU Stern MIF · <span className="font-semibold" style={{color:GROUP_COLORS[group]}}>{GROUP_LABELS[group]}</span> · DB-backed</p></div>
          <div className="flex items-center gap-3">
            {db.priceLoading && <span className="text-xs text-blue-600 flex items-center gap-1"><Loader2 size={12} className="animate-spin"/> Updating...</span>}
            {db.lastPriceUpdate && <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">Prices: {db.lastPriceUpdate}</span>}
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"/><span className="text-xs text-slate-500">DB</span></div>
          </div>
        </header>
        )}
        <main className={`flex-1 min-h-0 ${page==='catalyst'?'overflow-hidden p-0 bg-[#0f1117]':'overflow-y-auto p-6'} print:p-0`}>
          {page==="overview" && <OverviewPage holdings={db.holdings} settings={db.settings} weeklyHistory={db.weeklyHistory} dailyHistory={db.dailyHistory} risk={risk}/>}
          {page==="holdings" && <HoldingsPage holdings={db.holdings} setHoldings={db.setHoldings} settings={db.settings} setSettings={db.setSettings} dailyHistory={db.dailyHistory} priceLoading={db.priceLoading} onRefreshPrices={db.refreshPrices}/>}
          {page==="returns" && <ReturnsPage holdings={db.holdings} settings={db.settings} weeklyHistory={db.weeklyHistory} dailyHistory={db.dailyHistory}/>}
          {page==="risk" && <RiskPage settings={db.settings} risk={risk}/>}
          {page==="stoploss" && <StopLossPage holdings={db.holdings} settings={db.settings}/>}
          {page==="report" && <TeamReportPage holdings={db.holdings} settings={db.settings} report={db.report} setReport={db.setReport} reportMeta={db.reportMeta} setReportMeta={db.setReportMeta}/>}
          {page==="settings" && <SettingsPage settings={db.settings} setSettings={db.setSettings} holdings={db.holdings} setHoldings={db.setHoldings} dailyHistory={db.dailyHistory} setDailyHistory={db.setDailyHistory} weeklyHistory={db.weeklyHistory} setWeeklyHistory={db.setWeeklyHistory} group={group}/>}
          {page==="catalyst" && <CatalystPage holdings={db.holdings}/>}
        </main>
      </div>
      {page!=="catalyst" && <CommentPanel page={page} group={group}/>}
    </div>
  );
}
