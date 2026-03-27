"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import dynamic from 'next/dynamic';
const CatalystPage = dynamic(() => import('./catalyst/CatalystPage'), { ssr: false });
const CommentPanel = dynamic(() => import('./components/CommentPanel'), { ssr: false });
import {
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Area
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, BarChart3, Shield, AlertTriangle,
  FileText, Settings, Home, Briefcase, Activity, Target, ChevronDown,
  ChevronRight, Plus, Trash2, Search, Download, Upload, RefreshCw,
  Edit3, Check, Save, AlertCircle, CheckCircle, Printer, Loader2, Newspaper,
  PenLine, ExternalLink, X, LogOut, ArrowRightLeft
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
  weeklyVaR95: (v) => (v / Math.sqrt(252)) * 1.645 * Math.sqrt(5),
  weeklyVaR99: (v) => (v / Math.sqrt(252)) * 2.326 * Math.sqrt(5),
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
};

const statusBg = (s) => s === "BREACH" ? "#ef4444" : s === "WARNING" ? "#f59e0b" : "#10b981";

const THEME_COLORS = {
  Benchmark:"#1e293b","AI-Industrial":"#2563eb","Digital Infra":"#7c3aed",Experientials:"#0891b2",
  Security:"#dc2626","Silver Economy":"#ec4899",Nuclear:"#d97706",Payments:"#059669",
  Waste:"#84cc16",Battery:"#f97316","Legacy Software":"#6366f1",Adtech:"#14b8a6",
  Sports:"#8b5cf6","Digital Finance":"#06b6d4",Batteries:"#f97316","Waste Management":"#84cc16",
};
const CHART_COLORS = ["#1e3a5f","#2563eb","#7c3aed","#dc2626","#059669","#d97706","#0891b2","#ec4899","#84cc16","#f97316","#6366f1","#14b8a6"];
const getThemeColor = (theme, i) => THEME_COLORS[theme] || CHART_COLORS[i % CHART_COLORS.length];

const GROUP_COLORS = { thematic:"#2563eb", opportunistic:"#7c3aed", systematic:"#059669", bond:"#d97706" };
const GROUP_LABELS = { thematic:"Thematic", opportunistic:"Opportunistic", systematic:"Systematic", bond:"Bond" };

const activePositionValue = (holding) => Number(holding.shares) * Number(holding.currentPrice);
const activePnlDollar = (holding) => calc.pnlDollar(Number(holding.currentPrice), Number(holding.buyPrice), Number(holding.shares));
const exitedPositionValue = (holding) => Number(holding.sellTotal) || Number(holding.currentValue) || Number(holding.shares) * Number(holding.sellPrice || holding.currentPrice);

function applyPricesToHoldings(holdings, prices) {
  if (!prices || Object.keys(prices).length === 0) return holdings;
  return holdings.map((holding) => {
    if (holding.status !== "active") return holding;
    const nextPrice = prices[holding.ticker];
    if (nextPrice == null) return holding;
    const currentPrice = Number(nextPrice);
    const currentValue = activePositionValue({ ...holding, currentPrice });
    const pnlFromExcel = activePnlDollar({ ...holding, currentPrice });
    return { ...holding, currentPrice, currentValue, pnlFromExcel };
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
          fetch(`/api/history?group=${group}`).then(r=>r.json()).catch(()=>({history:[]})),
          fetch(`/api/report?group=${group}`).then(r=>r.json()).catch(()=>({content:"",meta:{}})),
        ]);
        let nextHoldings = hR.holdings || [];
        const nextSettings = sR.settings && Object.keys(sR.settings).length ? sR.settings : { benchmarkVol:0.122, portfolioVol:0.168, riskFreeRate:0.045, spyWeeklyReturn:-0.01508, iveWeeklyReturn:0.005, mtumWeeklyReturn:0.008, cashBalance:0, warningThreshold:0.85, stopLossWarningBuffer:0.05, limits:{ dailyVaR95:0.025, trackingError:0.06, betaDeviation:0.3, systematicVol:0.2, maxStockWeight:0.08, spyWeight:0.5 } };
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
          if (pricePayload.count > 0) {
            nextHoldings = applyPricesToHoldings(nextHoldings, pricePayload.prices);
            if (pricePayload.dbUpdated) {
              const fresh = await fetch(`/api/holdings?group=${group}`).then((response) => response.json()).catch(() => ({ holdings: nextHoldings }));
              nextHoldings = fresh.holdings || nextHoldings;
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
    try { await fetch("/api/history", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ history:normalized, group }) }); } catch {}
  }, [group]);

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
      if (d.count > 0) {
        setHL((current) => applyPricesToHoldings(current, d.prices));
        if (d.dbUpdated) {
          const fresh = await fetch(`/api/holdings?group=${group}`).then(r=>r.json());
          setHL(fresh.holdings || []);
        }
        setLPU(formatPriceUpdateLabel(d));
      } else alert("No prices returned. Yahoo may be blocking.");
    } catch (e) { alert("Price error: " + e.message); }
    setPL(false);
  }, [group]);

  return { loaded, holdings, settings, weeklyHistory, report, reportMeta, setHoldings, setSettings, setWeeklyHistory, setReport, setReportMeta, priceLoading, lastPriceUpdate, refreshPrices };
}

// ═══════════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════

const Card = ({ children, className = "" }) => <div className={`bg-white rounded-lg border border-slate-200 shadow-sm ${className}`}>{children}</div>;

const StatCard = ({ label, value, sub, icon: Icon, trend, color = "text-slate-700", tooltip, editable, onEdit }) => {
  const [show, setShow] = useState(false);
  const [ev, setEv] = useState("");
  return (<>
    <Card className={`p-4 hover:shadow-md transition-shadow ${tooltip||editable?"cursor-pointer":""}`} onClick={() => { if(tooltip||editable){setEv(typeof value==="string"?value.replace(/[^0-9.\-]/g,""):String(value));setShow(true);} }}>
      <div className="flex items-start justify-between"><div>
        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">{label}</p>
        <p className={`text-lg font-bold ${color}`}>{value}</p>
        {sub && <p className={`text-xs mt-0.5 ${trend==="up"?"text-emerald-600":trend==="down"?"text-red-500":"text-slate-500"}`}>{sub}</p>}
      </div>{Icon && <div className="p-2 bg-slate-50 rounded-lg"><Icon size={16} className="text-slate-400" /></div>}</div>
    </Card>
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
  useEffect(()=>{fetch_();},[]);
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
  const exited = holdings.filter(h => h.status === "exited");
  const investedVal = active.reduce((s, h) => s + activePositionValue(h), 0);
  const cashBalance = Number(settings?.cashBalance) || 0;
  const totalVal = investedVal + cashBalance;
  const totalRealizedPnl = exited.reduce((s, h) => s + (h.realizedPnl || h.pnlFromExcel || 0), 0);
  // Total cost basis = all active at buy price + all exited cost basis (includes SPY)
  const totalCostBasis = active.reduce((s, h) => s + h.shares * h.buyPrice, 0) + exited.reduce((s, h) => s + (h.costBasis || h.shares * h.buyPrice || 0), 0);
  const computed = active.map(h => {
    const pv = activePositionValue(h);
    const w = totalVal > 0 ? pv / totalVal : 0;
    return { ...h, positionValue: pv, weight: w, effectiveBeta: calc.holdingBeta(h), pnlPercent: calc.pnlPercent(h.currentPrice, h.buyPrice), pnlDollar: activePnlDollar(h) };
  });
  return { totalVal, investedVal, cashBalance, active, exited, computed, totalRealizedPnl, totalCostBasis };
}

// ═══════════════════════════════════════════════════════════════════
// OVERVIEW
// ═══════════════════════════════════════════════════════════════════
function OverviewPage({ holdings, settings, weeklyHistory }) {
  const normalizedHistory = useMemo(() => normalizeWeeklyHistoryRows(weeklyHistory), [weeklyHistory]);
  const { totalVal, investedVal, cashBalance, computed, exited, totalRealizedPnl, totalCostBasis } = computeHoldings(holdings, settings);
  const unrealizedPnl = computed.reduce((s,h) => s+h.pnlDollar, 0);
  const activeCostBasis = computed.reduce((s,h) => s + Number(h.shares) * Number(h.buyPrice), 0);
  const realizedCostBasis = exited.reduce((s,h) => s + (Number(h.costBasis) || Number(h.shares) * Number(h.buyPrice) || 0), 0);
  const totalPnl = unrealizedPnl + totalRealizedPnl;
  const totalReturnPct = totalCostBasis > 0 ? totalPnl / totalCostBasis : 0;
  const benchH = computed.find(h => h.theme==="Benchmark");
  const stocksOnly = computed.filter(h => h.theme!=="Benchmark");
  const portBeta = calc.portfolioBeta(computed);
  const sysVol = calc.systematicVol(portBeta, settings.benchmarkVol);
  const idioVol = calc.idiosyncraticVol(settings.portfolioVol, sysVol);
  const te = calc.trackingError(portBeta, settings.benchmarkVol, idioVol);
  const themes = [...new Set(computed.map(h=>h.theme))];
  const themeAlloc = themes.map((t,i) => ({name:t,value:computed.filter(h=>h.theme===t).reduce((s,h)=>s+h.weight,0),fill:getThemeColor(t,i)}));
  const cumData = buildCumulativeReturnSeries(normalizedHistory);
  const pnlSorted = [...stocksOnly].sort((a,b)=>b.pnlDollar-a.pnlDollar);
  const pnlChart = [...pnlSorted.slice(0,5),...pnlSorted.slice(-5)];
  const tickers = stocksOnly.map(h=>h.ticker);
  const cumReturn = cumData.length ? cumData[cumData.length - 1].portfolio : 0;

  return <div className="space-y-6">
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
      <StatCard label="Portfolio Value" value={fmt.usd(totalVal)} icon={DollarSign} tooltip={`Stock holdings: ${fmt.usd(investedVal-(benchH?.positionValue||0))}\nBenchmark: ${fmt.usd(benchH?.positionValue||0)}\nCash: ${fmt.usd(cashBalance)}\nDerived from workbook snapshot and holdings prices`} />
      <StatCard label="Unrealized PnL" value={fmt.usd(unrealizedPnl)} sub={fmt.pct(activeCostBasis > 0 ? unrealizedPnl / activeCostBasis : 0)} trend={unrealizedPnl >= 0 ? "up" : "down"} color={unrealizedPnl >= 0 ? "text-emerald-700" : "text-red-600"} icon={TrendingUp} tooltip={`Open-position PnL from active holdings\nCost basis: ${fmt.usd(activeCostBasis)}\nInvested value: ${fmt.usd(investedVal)}`} /> 
      <StatCard label="Realized PnL" value={fmt.usd(totalRealizedPnl)} sub={fmt.pct(realizedCostBasis > 0 ? totalRealizedPnl / realizedCostBasis : 0)} trend={totalRealizedPnl >= 0 ? "up" : "down"} color={totalRealizedPnl >= 0 ? "text-emerald-700" : "text-red-600"} icon={LogOut} tooltip={`${exited.length} exited positions\nExited cost basis: ${fmt.usd(realizedCostBasis)}`} /> 
      <StatCard label="Total Return" value={fmt.usd(totalPnl)} sub={fmt.pct(totalReturnPct)} trend={totalPnl >= 0 ? "up" : "down"} color={totalPnl >= 0 ? "text-emerald-700" : "text-red-600"} icon={BarChart3} tooltip={`Unrealized + realized PnL\nTotal cost basis: ${fmt.usd(totalCostBasis)}\nCompounded return series: ${fmt.pct(cumReturn)}`} />
      <StatCard label="Portfolio Beta" value={fmt.num(portBeta)} icon={Shield} tooltip="β_p = Σ(w_i × adjusted β_i), where benchmark overlap pulls holding beta toward 1.00"/>
      <StatCard label="Tracking Error" value={fmt.pct(te)} icon={Activity}/>
      <StatCard label="Daily VaR 95%" value={fmt.pct(calc.dailyVaR95(settings.portfolioVol))} icon={AlertTriangle}/>
      <StatCard label="Active" value={computed.length} icon={Briefcase} sub={`${exited.length} exited`}/>
      <StatCard label="Themes" value={themes.length-1} icon={BarChart3}/>
      <StatCard label="Ann. Vol" value={fmt.pct(settings.portfolioVol)}/>
      <StatCard label="Systematic Vol" value={fmt.pct(sysVol)}/>
      <StatCard label="Weekly VaR 95%" value={fmt.pct(calc.weeklyVaR95(settings.portfolioVol))}/>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Theme Allocation</h3>
        <div className="flex items-center gap-4">
          <ResponsiveContainer width="55%" height={260}><PieChart><Pie data={themeAlloc} cx="50%" cy="50%" innerRadius={50} outerRadius={95} paddingAngle={2} dataKey="value" labelLine={false}>{themeAlloc.map((e,i)=><Cell key={i} fill={e.fill} stroke="#fff" strokeWidth={2}/>)}</Pie><Tooltip content={<CustomTooltip formatter={v=>fmt.pct(v)}/>}/></PieChart></ResponsiveContainer>
          <div className="w-[45%] space-y-1.5 max-h-[260px] overflow-y-auto pr-1">{themeAlloc.sort((a,b)=>b.value-a.value).map((t,i)=><div key={i} className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm flex-shrink-0" style={{backgroundColor:t.fill}}/><span className="text-xs text-slate-700 flex-1 truncate">{t.name}</span><span className="text-xs font-semibold text-slate-800 tabular-nums">{fmt.pct(t.value,1)}</span></div>)}</div>
        </div></Card>
      <NewsFeed tickers={tickers}/>
      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Cumulative Return</h3>
        <ResponsiveContainer width="100%" height={260}><ComposedChart data={cumData}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="week" tick={{fontSize:11}}/><YAxis tickFormatter={v=>fmt.pct(v,1)} tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>fmt.pct(v)}/>}/><Legend/><Area type="monotone" dataKey="portfolio" fill="#1e3a5f" fillOpacity={0.08} stroke="#1e3a5f" strokeWidth={2} name="Portfolio"/><Line type="monotone" dataKey="benchmark" stroke="#94a3b8" strokeWidth={2} name="S&P 500" strokeDasharray="5 5"/></ComposedChart></ResponsiveContainer></Card>
      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">PnL by Holding (Top/Bottom 5)</h3>
        <ResponsiveContainer width="100%" height={260}><BarChart data={pnlChart}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="ticker" tick={{fontSize:9}}/><YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>fmt.usd(v)}/>}/><Bar dataKey="pnlDollar" name="PnL $" radius={[4,4,0,0]}>{pnlChart.map((e,i)=><Cell key={i} fill={e.pnlDollar>=0?"#059669":"#dc2626"}/>)}</Bar></BarChart></ResponsiveContainer></Card>
    </div>
    {exited.length > 0 && <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Realized P&L Summary ({exited.length} exits = {fmt.usd(totalRealizedPnl)})</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <div className="bg-emerald-50 rounded-lg p-3 text-center"><p className="text-xs text-emerald-600">Winners</p><p className="text-lg font-bold text-emerald-700">{exited.filter(h=>(h.realizedPnl||h.pnlFromExcel)>0).length}</p></div>
        <div className="bg-red-50 rounded-lg p-3 text-center"><p className="text-xs text-red-600">Losers</p><p className="text-lg font-bold text-red-700">{exited.filter(h=>(h.realizedPnl||h.pnlFromExcel)<0).length}</p></div>
        <div className="bg-emerald-50 rounded-lg p-3 text-center"><p className="text-xs text-emerald-600">Gains</p><p className="text-lg font-bold text-emerald-700">{fmt.usd(exited.filter(h=>(h.realizedPnl||h.pnlFromExcel)>0).reduce((s,h)=>s+(h.realizedPnl||h.pnlFromExcel),0))}</p></div>
        <div className="bg-red-50 rounded-lg p-3 text-center"><p className="text-xs text-red-600">Losses</p><p className="text-lg font-bold text-red-700">{fmt.usd(exited.filter(h=>(h.realizedPnl||h.pnlFromExcel)<0).reduce((s,h)=>s+(h.realizedPnl||h.pnlFromExcel),0))}</p></div>
      </div></Card>}
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// HOLDINGS — active + exited, exit functionality, save
// ═══════════════════════════════════════════════════════════════════
function HoldingsPage({ holdings, setHoldings, settings, priceLoading, onRefreshPrices }) {
  const [search,setSearch]=useState("");const [themeFilter,setTF]=useState("All");const [statusFilter,setSF]=useState("all");
  const [sortKey,setSK]=useState("theme");const [sortDir,setSD]=useState(1);const [editingId,setEI]=useState(null);
  const [saveStatus,setSS]=useState(null);

  const handleSave = async () => { setSS("saving"); await setHoldings(holdings); setTimeout(()=>setSS("saved"),300); setTimeout(()=>setSS(null),2500); };

  const themes = ["All",...new Set(holdings.map(h=>h.theme))];
  const investedTotal = holdings.filter(h=>h.status==="active").reduce((s,h)=>s+activePositionValue(h),0);
  const cashBalance = Number(settings?.cashBalance) || 0;
  const totalVal = investedTotal + cashBalance;
  const totalRealized = holdings.filter(h=>h.status==="exited").reduce((s,h)=>s+(h.realizedPnl||h.pnlFromExcel||0),0);

  const computed = useMemo(()=>{
    let f = holdings.map(h=>{
      if (h.status==="exited") return {...h, positionValue:exitedPositionValue(h), weight:0, pnlPercent:h.realizedPnlPct||(h.costBasis>0?(h.realizedPnl||0)/h.costBasis:0), pnlDollar:h.realizedPnl||h.pnlFromExcel||0};
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

  const activeCount = holdings.filter(h=>h.status==="active").length;
  const exitedCount = holdings.filter(h=>h.status==="exited").length;
  const activeSummary = holdings
    .filter((h)=>h.status==="active")
    .map((h)=>({ ...h, positionValue: activePositionValue(h) }));
  const benchmarkTotal = activeSummary.filter((h)=>h.theme==="Benchmark").reduce((sum,h)=>sum+h.positionValue,0);
  const stockTotal = activeSummary.filter((h)=>h.theme!=="Benchmark").reduce((sum,h)=>sum+h.positionValue,0);
  const portfolioTotal = stockTotal + benchmarkTotal + cashBalance;
  const sectionTotals = Object.values(activeSummary.reduce((acc,h)=>{
    if (h.theme==="Benchmark") return acc;
    const key = h.theme;
    if (!acc[key]) acc[key] = { theme: key, totalValue: 0, holdings: 0 };
    acc[key].totalValue += h.positionValue;
    acc[key].holdings += 1;
    return acc;
  }, {})).sort((a,b)=>b.totalValue-a.totalValue);

  return <div className="space-y-4">
    <SectionHeader title="Holdings" subtitle={`${activeCount} active · ${exitedCount} exited · Realized: ${fmt.usd(totalRealized)}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative"><Search size={14} className="absolute left-2 top-2 text-slate-400"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." className="pl-7 pr-3 py-1.5 text-sm border rounded-md w-32"/></div>
        <select value={themeFilter} onChange={e=>setTF(e.target.value)} className="px-2 py-1.5 text-sm border rounded-md">{themes.map(t=><option key={t}>{t}</option>)}</select>
        <div className="flex rounded-md border border-slate-200 overflow-hidden">{["all","active","exited"].map(s=><button key={s} onClick={()=>setSF(s)} className={`px-2.5 py-1.5 text-xs font-medium ${statusFilter===s?"bg-slate-800 text-white":"text-slate-600 hover:bg-slate-50"}`}>{s==="all"?"All":s==="active"?"Active":"Exited"}</button>)}</div>
        <button onClick={onRefreshPrices} disabled={priceLoading} className="flex items-center gap-1 px-3 py-1.5 text-sm border border-blue-200 text-blue-700 rounded-md hover:bg-blue-50 disabled:opacity-50">{priceLoading?<Loader2 size={14} className="animate-spin"/>:<RefreshCw size={14}/>} Prices</button>
        <button onClick={addH} className="flex items-center gap-1 px-3 py-1.5 text-sm border text-slate-700 rounded-md hover:bg-slate-50"><Plus size={14}/> Add</button>
        <button onClick={handleSave} className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-md font-medium ${saveStatus==="saved"?"bg-emerald-600 text-white":"bg-slate-800 text-white hover:bg-slate-700"}`}>{saveStatus==="saving"?<Loader2 size={14} className="animate-spin"/>:saveStatus==="saved"?<Check size={14}/>:<Save size={14}/>} {saveStatus==="saved"?"Saved!":"Save"}</button>
      </div>
    </SectionHeader>
    <Card className="overflow-x-auto"><table className="w-full text-xs">
      <thead><tr className="bg-slate-50 border-b">{cols.map(c=><th key={c.key} className="py-2 px-1.5 text-left font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700" onClick={()=>handleSort(c.key)}>{c.label}{sortKey===c.key?(sortDir===1?" ↑":" ↓"):""}</th>)}<th className="py-2 px-1.5 w-16">Actions</th></tr></thead>
      <tbody>{computed.map(h=><tr key={h.id} className={`border-b border-slate-100 hover:bg-blue-50/30 ${h.status==="exited"?"bg-slate-50/50 opacity-75":""} ${editingId===h.id?"bg-blue-50/50":""}`}>
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
          <p className="text-xs text-slate-500">Portfolio, stock book, benchmark, and section totals from current active holdings.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Portfolio Total</p>
          <p className="mt-1 text-lg font-bold text-slate-800">{fmt.usd(portfolioTotal)}</p>
          <p className="text-xs text-slate-500">{activeCount} active holdings + {fmt.usd(cashBalance)} cash</p>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">Stock Holdings</p>
          <p className="mt-1 text-lg font-bold text-blue-900">{fmt.usd(stockTotal)}</p>
          <p className="text-xs text-blue-700">{fmt.pct(portfolioTotal > 0 ? stockTotal / portfolioTotal : 0, 1)} of active portfolio</p>
        </div>
        <div className="rounded-lg border border-slate-300 bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Benchmark (S&amp;P 500)</p>
          <p className="mt-1 text-lg font-bold text-slate-900">{fmt.usd(benchmarkTotal)}</p>
          <p className="text-xs text-slate-500">{fmt.pct(portfolioTotal > 0 ? benchmarkTotal / portfolioTotal : 0, 1)} of active portfolio</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Cash</p>
          <p className="mt-1 text-lg font-bold text-slate-800">{fmt.usd(cashBalance)}</p>
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
      peakWeek = row.week;
    }
    if (row[key] < worst[key]) worst = { ...row, peakWeek };
  }
  return { worstDrawdown: worst[key], peakWeek: worst.peakWeek || "Start", troughWeek: worst.week || "—", troughDate: worst.date || "" };
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

function ReturnsPage({ holdings, weeklyHistory, settings }) {
  const normalizedHistory = useMemo(() => normalizeWeeklyHistoryRows(weeklyHistory), [weeklyHistory]);
  const { computed, exited, totalVal } = computeHoldings(holdings, settings);
  const activeStocks = computed.filter((holding) => holding.theme !== "Benchmark");
  const allHoldings = [
    ...computed.map((holding) => ({
      ...holding,
      deployedValue: Number(holding.shares) * Number(holding.buyPrice),
      currentValueForTheme: holding.positionValue,
      weeklyContribution: (holding.weight || 0) * (Number(holding.weeklyReturn) || 0),
    })),
    ...exited.map((holding) => ({
      ...holding,
      deployedValue: Number(holding.costBasis) || Number(holding.shares) * Number(holding.buyPrice) || 0,
      currentValueForTheme: exitedPositionValue(holding),
      pnlDollar: Number(holding.realizedPnl) || Number(holding.pnlFromExcel) || 0,
      pnlPercent: Number(holding.realizedPnlPct) || ((Number(holding.costBasis) || 0) > 0 ? (Number(holding.realizedPnl) || 0) / Number(holding.costBasis) : 0),
      weeklyContribution: 0,
    })),
  ];
  const totalDeployed = allHoldings.reduce((sum, holding) => sum + (holding.deployedValue || 0), 0);
  const basket = [...new Set(allHoldings.map((holding) => holding.theme))]
    .map((theme) => {
      const themeHoldings = allHoldings.filter((holding) => holding.theme === theme);
      const deployed = themeHoldings.reduce((sum, holding) => sum + (holding.deployedValue || 0), 0);
      const currentValue = themeHoldings.reduce((sum, holding) => sum + (holding.currentValueForTheme || 0), 0);
      const pnl = themeHoldings.reduce((sum, holding) => sum + (holding.pnlDollar || 0), 0);
      return {
        theme,
        deployed,
        currentValue,
        pnl,
        contribution: totalDeployed > 0 ? pnl / totalDeployed : 0,
        returnPct: deployed > 0 ? pnl / deployed : 0,
        shareOfBook: totalVal > 0 ? currentValue / totalVal : 0,
      };
    })
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));

  const weeklyChartData = normalizedHistory.map((row) => ({
    ...row,
    excessReturn: (Number(row.portfolioReturn) || 0) - (Number(row.benchmarkReturn) || 0),
    explainedReturn: Number(row.marketContrib || 0),
    selectionReturn: Number(row.alpha || 0),
  }));
  const cumulativeData = buildCumulativeReturnSeries(normalizedHistory);
  const cumulativePortfolio = cumulativeData.length ? cumulativeData[cumulativeData.length - 1].portfolio : 0;
  const cumulativeBenchmark = cumulativeData.length ? cumulativeData[cumulativeData.length - 1].benchmark : 0;
  const excessReturn = cumulativePortfolio - cumulativeBenchmark;
  const bestWeek = weeklyChartData.length ? [...weeklyChartData].sort((a, b) => b.portfolioReturn - a.portfolioReturn)[0] : null;
  const worstWeek = weeklyChartData.length ? [...weeklyChartData].sort((a, b) => a.portfolioReturn - b.portfolioReturn)[0] : null;
  const weeklyTable = [...weeklyChartData].reverse();
  const hitRate = weeklyChartData.length ? weeklyChartData.filter((row) => row.portfolioReturn > 0).length / weeklyChartData.length : 0;
  const drawdownSeries = buildReturnDrawdownSeries(weeklyChartData);
  const portfolioDrawdown = summarizeReturnDrawdown(drawdownSeries, "portfolioDrawdown");
  const benchmarkDrawdown = summarizeReturnDrawdown(drawdownSeries, "benchmarkDrawdown");
  const themeWeeklyAttribution = buildWeeklyContributionByGroup(activeStocks, "theme");
  const holdingDrivers = [...activeStocks]
    .map((holding) => ({
      ...holding,
      weeklyContribution: (holding.weight || 0) * (Number(holding.weeklyReturn) || 0),
    }))
    .sort((a, b) => Math.abs(b.weeklyContribution) - Math.abs(a.weeklyContribution));

  return <div className="space-y-6">
    <SectionHeader title="Returns" subtitle={`Workbook-backed weekly history, current attribution, and drawdown analysis across ${normalizedHistory.length} weeks`} />
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <StatCard label="Cumulative Return" value={fmt.pct(cumulativePortfolio)} trend={cumulativePortfolio >= 0 ? "up" : "down"} color={cumulativePortfolio >= 0 ? "text-emerald-700" : "text-red-600"} tooltip={`Compounded from ${normalizedHistory.length} reconstructed weeks`} />
      <StatCard label="Benchmark" value={fmt.pct(cumulativeBenchmark)} />
      <StatCard label="Excess Return" value={fmt.pct(excessReturn)} trend={excessReturn >= 0 ? "up" : "down"} color={excessReturn >= 0 ? "text-emerald-700" : "text-red-600"} />
      <StatCard label="Hit Rate" value={fmt.pct(hitRate)} sub={`${weeklyChartData.filter((row) => row.portfolioReturn > 0).length}/${weeklyChartData.length || 0} up weeks`} />
      <StatCard label="Best Week" value={bestWeek ? fmt.pct(bestWeek.portfolioReturn) : "—"} sub={bestWeek?.week || "—"} trend={bestWeek && bestWeek.portfolioReturn >= 0 ? "up" : "down"} color={bestWeek && bestWeek.portfolioReturn >= 0 ? "text-emerald-700" : "text-red-600"} />
      <StatCard label="Worst Week" value={worstWeek ? fmt.pct(worstWeek.portfolioReturn) : "—"} sub={worstWeek?.week || "—"} trend="down" color="text-red-600" />
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Cumulative Return</h3><ResponsiveContainer width="100%" height={260}><ComposedChart data={cumulativeData}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="week" tick={{fontSize:11}}/><YAxis tickFormatter={v=>fmt.pct(v,1)} tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>fmt.pct(v)}/>}/><Legend/><Area type="monotone" dataKey="portfolio" fill="#1e3a5f" fillOpacity={0.08} stroke="#1e3a5f" strokeWidth={2} name="Portfolio"/><Line type="monotone" dataKey="benchmark" stroke="#94a3b8" strokeWidth={2} name="S&P 500" strokeDasharray="5 5"/></ComposedChart></ResponsiveContainer></Card>
      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Weekly Return Comparison</h3><ResponsiveContainer width="100%" height={260}><ComposedChart data={weeklyChartData}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="week" tick={{fontSize:11}}/><YAxis tickFormatter={v=>fmt.pct(v,1)} tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>fmt.pct(v)}/>}/><Legend/><Bar dataKey="portfolioReturn" fill="#1e3a5f" name="Portfolio" radius={[4,4,0,0]}/><Line type="monotone" dataKey="benchmarkReturn" stroke="#94a3b8" strokeWidth={2} name="S&P 500"/><Line type="monotone" dataKey="excessReturn" stroke="#059669" strokeWidth={2} strokeDasharray="5 5" name="Excess"/></ComposedChart></ResponsiveContainer></Card>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Return Decomposition</h3><ResponsiveContainer width="100%" height={260}><ComposedChart data={weeklyChartData}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="week" tick={{fontSize:11}}/><YAxis tickFormatter={v=>fmt.pct(v,1)} tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>fmt.pct(v)}/>}/><Legend/><Bar dataKey="explainedReturn" stackId="return" fill="#94a3b8" name="Benchmark"/><Bar dataKey="selectionReturn" stackId="return" fill="#059669" name="Selection / Alpha"/><Line type="monotone" dataKey="portfolioReturn" stroke="#1e3a5f" strokeWidth={2} name="Portfolio"/></ComposedChart></ResponsiveContainer></Card>
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Drawdown Analysis</h3>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Portfolio Max DD</p><p className="mt-1 text-lg font-bold text-slate-800">{fmt.pct(portfolioDrawdown.worstDrawdown)}</p><p className="text-xs text-slate-500">{portfolioDrawdown.peakWeek} to {portfolioDrawdown.troughWeek}</p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Benchmark Max DD</p><p className="mt-1 text-lg font-bold text-slate-800">{fmt.pct(benchmarkDrawdown.worstDrawdown)}</p><p className="text-xs text-slate-500">{benchmarkDrawdown.peakWeek} to {benchmarkDrawdown.troughWeek}</p></div>
        </div>
        <ResponsiveContainer width="100%" height={220}><LineChart data={drawdownSeries}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="week" tick={{fontSize:11}}/><YAxis tickFormatter={v=>fmt.pct(v,1)} tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>fmt.pct(v)}/>}/><Legend/><Line type="monotone" dataKey="portfolioDrawdown" stroke="#1e3a5f" strokeWidth={2} name="Portfolio DD"/><Line type="monotone" dataKey="benchmarkDrawdown" stroke="#94a3b8" strokeWidth={2} name="Benchmark DD"/></LineChart></ResponsiveContainer>
      </Card>
    </div>
    <div className="grid grid-cols-1 xl:grid-cols-[0.92fr_1.08fr] gap-4">
      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Weekly Return Table</h3>
        <div className="max-h-[360px] overflow-y-auto">
          <table className="w-full text-xs"><thead><tr className="bg-slate-50 border-b">{["Week","Date","Portfolio","Benchmark","Excess"].map(h=><th key={h} className="py-2 px-2 text-left font-semibold text-slate-500 uppercase">{h}</th>)}</tr></thead>
          <tbody>{weeklyTable.map((row)=><tr key={row.week} className="border-b border-slate-100 hover:bg-slate-50"><td className="py-2 px-2 font-medium text-slate-700">{row.week}</td><td className="py-2 px-2 text-slate-500">{fmt.date(row.date)}</td><td className={`py-2 px-2 font-medium ${row.portfolioReturn >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(row.portfolioReturn)}</td><td className={`py-2 px-2 font-medium ${row.benchmarkReturn >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(row.benchmarkReturn)}</td><td className={`py-2 px-2 font-medium ${row.excessReturn >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(row.excessReturn)}</td></tr>)}</tbody></table>
        </div>
      </Card>
      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Theme PnL Summary (Active + Exited)</h3>
        <table className="w-full text-xs"><thead><tr className="bg-slate-50 border-b">{["Theme","Deployed","Current Value","PnL $","Return","Book Share"].map(h=><th key={h} className="py-2 px-3 text-left font-semibold text-slate-500 uppercase">{h}</th>)}</tr></thead>
        <tbody>{basket.map((row)=><tr key={row.theme} className="border-b border-slate-100 hover:bg-slate-50"><td className="py-2 px-3"><ThemeBadge theme={row.theme}/></td><td className="py-2 px-3">{fmt.usd(row.deployed)}</td><td className="py-2 px-3">{fmt.usd(row.currentValue)}</td><td className={`py-2 px-3 font-medium ${row.pnl >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.usd(row.pnl)}</td><td className={`py-2 px-3 font-medium ${row.returnPct >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(row.returnPct)}</td><td className="py-2 px-3">{fmt.pct(row.shareOfBook, 1)}</td></tr>)}</tbody></table>
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

function RiskPage({ holdings, settings, group }) {
  const activeRiskHoldings = useMemo(() => holdings
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
    })), [holdings]);
  const riskRequestKey = useMemo(() => JSON.stringify(activeRiskHoldings.map((holding) => [
    holding.id,
    holding.ticker,
    holding.currentPrice,
    holding.buyPrice,
    holding.shares,
    holding.theme,
    holding.subTheme,
  ])), [activeRiskHoldings]);
  const [riskData, setRiskData] = useState(null);
  const [riskError, setRiskError] = useState(null);
  const [showWeighted, setShowWeighted] = useState(false);

  useEffect(() => {
    let cancelled = false;
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

  const analytics = riskData;
  const isLoading = !analytics && !riskError;
  const isRefreshing = !!analytics && analytics.requestKey !== riskRequestKey;
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
function SettingsPage({ settings, setSettings, holdings, setHoldings, weeklyHistory, setWeeklyHistory, group }) {
  const [showM,setSM]=useState(false);const [ss,setSS]=useState(null);
  const save=async()=>{setSS("saving");await setSettings(settings);setTimeout(()=>setSS("saved"),300);setTimeout(()=>setSS(null),2500);};
  const expJ=()=>{const d=JSON.stringify({holdings,settings,weeklyHistory},null,2);const b=new Blob([d],{type:"application/json"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download=`stern_${group}_data.json`;a.click();};
  const impJ=()=>{const inp=document.createElement("input");inp.type="file";inp.accept=".json";inp.onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{try{const p=JSON.parse(ev.target.result);if(p.holdings)setHoldings(p.holdings);if(p.settings)setSettings(p.settings);if(p.weeklyHistory)setWeeklyHistory(p.weeklyHistory);}catch{alert("Invalid JSON");}};r.readAsText(f);};inp.click();};
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
          {page==="overview" && <OverviewPage holdings={db.holdings} settings={db.settings} weeklyHistory={db.weeklyHistory}/>}
          {page==="holdings" && <HoldingsPage holdings={db.holdings} setHoldings={db.setHoldings} settings={db.settings} priceLoading={db.priceLoading} onRefreshPrices={db.refreshPrices}/>}
          {page==="returns" && <ReturnsPage holdings={db.holdings} settings={db.settings} weeklyHistory={db.weeklyHistory}/>}
          {page==="risk" && <RiskPage holdings={db.holdings} settings={db.settings} group={group}/>}
          {page==="stoploss" && <StopLossPage holdings={db.holdings} settings={db.settings}/>}
          {page==="report" && <TeamReportPage holdings={db.holdings} settings={db.settings} report={db.report} setReport={db.setReport} reportMeta={db.reportMeta} setReportMeta={db.setReportMeta}/>}
          {page==="settings" && <SettingsPage settings={db.settings} setSettings={db.setSettings} holdings={db.holdings} setHoldings={db.setHoldings} weeklyHistory={db.weeklyHistory} setWeeklyHistory={db.setWeeklyHistory} group={group}/>}
          {page==="catalyst" && <CatalystPage holdings={db.holdings}/>}
        </main>
      </div>
      {page!=="catalyst" && <CommentPanel page={page} group={group}/>}
    </div>
  );
}
