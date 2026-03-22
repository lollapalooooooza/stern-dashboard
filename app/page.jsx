"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import dynamic from 'next/dynamic';
const CatalystPage = dynamic(() => import('./catalyst/CatalystPage'), { ssr: false });
import {
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Area
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, BarChart3, Shield, AlertTriangle,
  FileText, Settings, Home, Briefcase, Activity, Target, ChevronDown,
  ChevronRight, Plus, Trash2, Search, Download, Upload, RefreshCw,
  Edit3, Check, Save, AlertCircle, CheckCircle, Printer, Loader2, Newspaper,
  PenLine, ExternalLink, X, LogOut, ArrowRightLeft, MessageCircle, Edit2
} from "lucide-react";

const calc = {
  pnlDollar: (cp, bp, s) => (cp - bp) * s,
  pnlPercent: (cp, bp) => (bp !== 0 ? (cp - bp) / bp : 0),
  portfolioBeta: (h) => h.reduce((s, x) => s + (x.weight || 0) * (x.marketBeta || 0), 0),
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

// Helper function for market hours check
function isMarketHours() {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const h = et.getHours(), m = et.getMinutes();
  return (h > 9 || (h === 9 && m >= 30)) && h < 16;
}

// ═══════════════════════════════════════════════════════════════════
// DATABASE HOOK — group-aware, auto-fetches prices on load
// ═══════════════════════════════════════════════════════════════════

function useDatabase(group) {
  const [holdings, setHL] = useState([]);
  const [settings, setSL] = useState({ benchmarkVol:0.122, portfolioVol:0.168, riskFreeRate:0.045, spyWeeklyReturn:-0.01508, iveWeeklyReturn:0.005, mtumWeeklyReturn:0.008, warningThreshold:0.85, stopLossWarningBuffer:0.05, limits:{ dailyVaR95:0.025, trackingError:0.06, betaDeviation:0.3, systematicVol:0.2, maxStockWeight:0.08, spyWeight:0.5 } });
  const [weeklyHistory, setWL] = useState([]);
  const [report, setRL] = useState("");
  const [reportMeta, setRML] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [priceLoading, setPL] = useState(false);
  const [lastPriceUpdate, setLPU] = useState(null);
  const [lastRefreshTime, setLastRefreshTime] = useState(null);

  useEffect(() => {
    setLoaded(false);
    (async () => {
      try {
        const [hR,sR,wR,rR] = await Promise.all([
          fetch(`/api/holdings?group=${group}`).then(r=>r.json()).catch(()=>({holdings:[]})),
          fetch(`/api/settings?group=${group}`).then(r=>r.json()).catch(()=>({settings:{}})),
          fetch(`/api/history?group=${group}`).then(r=>r.json()).catch(()=>({history:[]})),
          fetch(`/api/report?group=${group}`).then(r=>r.json()).catch(()=>({content:"",meta:{}})),
        ]);
        if (hR.holdings?.length) setHL(hR.holdings);
        else setHL([]);
        if (sR.settings && Object.keys(sR.settings).length) setSL(sR.settings);
        if (wR.history?.length) setWL(wR.history);
        else setWL([]);
        if (rR.content) setRL(rR.content); else setRL("");
        if (rR.meta) setRML(rR.meta); else setRML({});
      } catch (e) { console.error("DB load:", e); }
      setLoaded(true);
    })();
  }, [group]);

  // Auto-fetch prices on load
  useEffect(() => {
    if (!loaded || holdings.length === 0) return;
    const activeCount = holdings.filter(h => h.status === "active" && h.ticker !== "SPY").length;
    if (activeCount === 0) return;
    (async () => {
      setPL(true);
      try {
        const r = await fetch("/api/prices", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ group }) });
        const d = await r.json();
        if (d.count > 0 && d.dbUpdated) {
          const fresh = await fetch(`/api/holdings?group=${group}`).then(r=>r.json());
          if (fresh.holdings?.length) setHL(fresh.holdings);
          setLPU(`${new Date().toLocaleTimeString()} (${d.count})`);
          setLastRefreshTime(new Date());
        }
      } catch (e) { console.warn("Auto price:", e.message); }
      setPL(false);
    })();
  }, [loaded, group]);

  // Auto-refresh every 15 minutes during market hours
  useEffect(() => {
    if (!loaded) return;
    const interval = setInterval(() => {
      if (isMarketHours()) {
        (async () => {
          try {
            const r = await fetch("/api/prices", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ group }) });
            const d = await r.json();
            if (d.count > 0 && d.dbUpdated) {
              const fresh = await fetch(`/api/holdings?group=${group}`).then(r=>r.json());
              if (fresh.holdings?.length) setHL(fresh.holdings);
              setLastRefreshTime(new Date());
            }
          } catch (e) { console.warn("Periodic refresh:", e.message); }
        })();
      }
    }, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loaded, group]);

  // Refresh on visibility change if >5 minutes since last refresh
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && lastRefreshTime) {
        const now = new Date();
        const diff = (now - lastRefreshTime) / (1000 * 60);
        if (diff > 5 && isMarketHours()) {
          (async () => {
            try {
              const r = await fetch("/api/prices", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ group }) });
              const d = await r.json();
              if (d.count > 0 && d.dbUpdated) {
                const fresh = await fetch(`/api/holdings?group=${group}`).then(r=>r.json());
                if (fresh.holdings?.length) setHL(fresh.holdings);
                setLastRefreshTime(new Date());
              }
            } catch (e) { console.warn("Visibility refresh:", e.message); }
          })();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [lastRefreshTime, group]);

  const setHoldings = useCallback(async (newH) => {
    setHL(newH);
    try { await fetch("/api/holdings", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ holdings:newH, group }) }); } catch {}
  }, [group]);

  const setSettings = useCallback(async (newS) => {
    setSL(newS);
    try { await fetch("/api/settings", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ settings:newS, group }) }); } catch {}
  }, [group]);

  const setWeeklyHistory = useCallback(async (newW) => {
    setWL(newW);
    try { await fetch("/api/history", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ history:newW, group }) }); } catch {}
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
        const fresh = await fetch(`/api/holdings?group=${group}`).then(r=>r.json());
        if (fresh.holdings?.length) setHL(fresh.holdings);
        setLPU(`${new Date().toLocaleTimeString()} (${d.count})`);
        setLastRefreshTime(new Date());
      } else alert("No prices returned. Yahoo may be blocking.");
    } catch (e) { alert("Price error: " + e.message); }
    setPL(false);
  }, [group]);

  return { loaded, holdings, settings, weeklyHistory, report, reportMeta, setHoldings, setSettings, setWeeklyHistory, setReport, setReportMeta, priceLoading, lastPriceUpdate, refreshPrices, lastRefreshTime };
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

// ═══════════════════════════════════════════════════════════════════
// NEWS FEED
// ═══════════════════════════════════════════════════════════════════

function NewsFeed({ tickers }) {
  return <div className="space-y-2">{(tickers || []).slice(0, 3).map((t, i) => <div key={i} className="p-2 bg-slate-50 rounded text-xs text-slate-600"><span className="font-bold">{t.ticker}:</span> {t.headline || "No news"}</div>)}</div>;
}

// ═══════════════════════════════════════════════════════════════════
// COMPUTEHOLDINGS
// ═══════════════════════════════════════════════════════════════════

function computeHoldings(holdings) {
  const active = holdings.filter(h => h.status === "active");
  const exited = holdings.filter(h => h.status === "exited");
  const totalVal = active.reduce((s, h) => s + (h.currentValue || h.shares * h.currentPrice), 0);
  const totalRealizedPnl = exited.reduce((s, h) => s + (h.realizedPnl || h.pnlFromExcel || 0), 0);
  const totalCostBasis = active.reduce((s, h) => s + h.shares * h.buyPrice, 0) + exited.reduce((s, h) => s + (h.costBasis || h.shares * h.buyPrice || 0), 0);
  const computed = active.map(h => {
    const pv = h.currentValue || h.shares * h.currentPrice;
    const w = totalVal > 0 ? pv / totalVal : 0;
    return { ...h, positionValue: pv, weight: w, pnlPercent: calc.pnlPercent(h.currentPrice, h.buyPrice), pnlDollar: h.pnlFromExcel || calc.pnlDollar(h.currentPrice, h.buyPrice, h.shares) };
  });
  return { totalVal, active, exited, computed, totalRealizedPnl, totalCostBasis };
}

// ═══════════════════════════════════════════════════════════════════
// OVERVIEW PAGE
// ═══════════════════════════════════════════════════════════════════

function OverviewPage({ holdings, settings, weeklyHistory }) {
  const { computed, totalVal, active: exitedCount, exited: exitedArray } = computeHoldings(holdings);
  const portfolioVal = totalVal;
  const gainLoss = computed.reduce((s, h) => s + (h.currentPrice - h.buyPrice) * h.shares, 0);
  const gainLossPct = portfolioVal > 0 ? gainLoss / (portfolioVal - gainLoss) : 0;
  const avgBeta = computed.filter(h => h.theme !== "Benchmark").reduce((s, h) => s + (h.weight || 0) * (h.marketBeta || 0), 0);
  const spyCount = computed.filter(h => h.ticker === "SPY").length;
  const benchmarkPct = computed.filter(h => h.theme === "Benchmark").reduce((s, h) => s + h.weight, 0);
  const topGain = [...computed].sort((a, b) => (b.currentPrice - b.buyPrice) / b.buyPrice - (a.currentPrice - a.buyPrice) / a.buyPrice)[0];
  const activeCount = computed.filter(h => h.status === "active").length;
  const spyPrice = computed.find(h => h.ticker === "SPY")?.currentPrice || 0;

  const themeData = useMemo(() => {
    const themes = {};
    computed.forEach(h => { if(!themes[h.theme]) themes[h.theme] = 0; themes[h.theme] += h.weight; });
    return Object.entries(themes).map(([theme, weight]) => ({name: theme, value: Math.round(weight * 100), fill: THEME_COLORS[theme] || "#64748b" })).sort((a, b) => b.value - a.value);
  }, [computed]);

  const statusData = useMemo(() => {
    const active = computed.filter(h => h.status === "active").length;
    const exited = computed.filter(h => h.status === "exited").length;
    return [{name: "Active", value: active, fill: "#10b981"}, {name: "Exited", value: exited, fill: "#94a3b8"}];
  }, [computed]);

  const historyData = useMemo(() => {
    return (weeklyHistory || []).map(w => ({ week: w.week || "—", return: (w.return || 0) * 100 })).slice(-52);
  }, [weeklyHistory]);

  return <div className="space-y-6">
    <SectionHeader title="Portfolio Overview" subtitle="Thematic allocation & returns"/>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard label="Portfolio Value" value={fmt.usd(portfolioVal)} color="text-slate-800" icon={DollarSign}/>
      <StatCard label="Gain/Loss" value={fmt.usd(gainLoss)} sub={fmt.pct(gainLossPct)} trend={gainLoss>=0?"up":"down"} color={gainLoss>=0?"text-emerald-600":"text-red-600"} icon={TrendingUp}/>
      <StatCard label="Avg Beta" value={fmt.num(avgBeta, 2)} color="text-blue-600" icon={BarChart3}/>
      <StatCard label="Holdings" value={activeCount} color="text-slate-700" icon={Briefcase}/>
    </div>
    <div className="grid md:grid-cols-2 gap-6">
      <Card className="p-6"><h3 className="font-bold text-slate-800 mb-4">Allocation by Theme</h3><ResponsiveContainer width="100%" height={300}><PieChart><Pie data={themeData} cx="50%" cy="50%" labelLine={false} label={({name, value}) => `${name}: ${value}%`} outerRadius={100} fill="#8884d8" dataKey="value">{themeData.map((e, i) => <Cell key={`cell-${i}`} fill={e.fill}/>)}</Pie></PieChart></ResponsiveContainer></Card>
      <Card className="p-6"><h3 className="font-bold text-slate-800 mb-4">Position Status</h3><ResponsiveContainer width="100%" height={300}><PieChart><Pie data={statusData} cx="50%" cy="50%" labelLine={false} label={({name, value}) => `${name}: ${value}`} outerRadius={100} fill="#8884d8" dataKey="value">{statusData.map((e, i) => <Cell key={`cell-${i}`} fill={e.fill}/>)}</Pie></PieChart></ResponsiveContainer></Card>
    </div>
    <Card className="p-6"><h3 className="font-bold text-slate-800 mb-4">Weekly Returns (52 Weeks)</h3><ResponsiveContainer width="100%" height={250}><LineChart data={historyData} margin={{top:5,right:30,left:0,bottom:5}}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="week" tick={{fontSize:11}} interval={Math.max(0,Math.floor(historyData.length/8)-1)}/><YAxis tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>fmt.pct(v/100)}/>}/><Line type="monotone" dataKey="return" stroke="#2563eb" dot={{fill:"#2563eb",r:4}} activeDot={{r:6}}/></LineChart></ResponsiveContainer></Card>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// HOLDINGS PAGE
// ═══════════════════════════════════════════════════════════════════

function HoldingsPage({ holdings, setHoldings, settings, priceLoading, onRefreshPrices }) {
  const [filter, setF] = useState("all");
  const [editId, setEI] = useState(null);
  const [editSL, setESL] = useState({});
  const { computed } = computeHoldings(holdings);
  const filtered = filter === "all" ? computed : filter === "active" ? computed.filter(h => h.status === "active") : computed.filter(h => h.status === "exited");

  const updateHolding = useCallback(async (id, updates) => {
    const updated = holdings.map(h => h.id === id ? {...h, ...updates} : h);
    setHoldings(updated);
    try { await fetch(`/api/holdings/${id}`, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(updates) }); } catch(e) { console.error("Update error:", e); }
    setEI(null);
  }, [holdings, setHoldings]);

  return <div className="space-y-6">
    <SectionHeader title="Holdings" subtitle="Buy/hold/exit management">
      <button onClick={onRefreshPrices} disabled={priceLoading} className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50"><RefreshCw size={12} className={priceLoading?"animate-spin":""}/>Refresh Prices</button>
    </SectionHeader>
    <div className="flex items-center gap-2 flex-wrap">{["all", "active", "exited"].map(f => <TabButton key={f} active={filter === f} onClick={() => setF(f)}>{f === "all" ? "All" : f === "active" ? "Active" : "Exited"}</TabButton>)}</div>
    <Card className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-slate-50 border-b">{["Ticker", "Theme", "Status", "Shares", "Buy $", "Current $", "P&L", "%", "SL %", "Action"].map(h => <th key={h} className="py-2 px-3 text-left text-xs font-semibold text-slate-500 uppercase">{h}</th>)}</tr></thead><tbody>{filtered.map(h => <tr key={h.id} className={`border-b hover:bg-slate-50 ${h.status==="exited"?"bg-slate-50":""}`}><td className="py-2 px-3 font-semibold">{h.ticker}</td><td className="py-2 px-3"><ThemeBadge theme={h.theme}/></td><td className="py-2 px-3"><Badge status={h.status}/></td><td className="py-2 px-3">{fmt.shares(h.shares)}</td><td className="py-2 px-3">{fmt.usdExact(h.buyPrice)}</td><td className="py-2 px-3">{fmt.usdExact(h.currentPrice)}</td><td className="py-2 px-3 font-bold">{fmt.usd((h.currentPrice - h.buyPrice) * h.shares)}</td><td className="py-2 px-3">{fmt.pct((h.currentPrice - h.buyPrice) / h.buyPrice, 1)}</td><td className="py-2 px-3">{editId === h.id ? <input type="number" step="0.01" min="0" max="1" value={editSL[h.id] || h.stopLossPct} onChange={e => setESL({...editSL, [h.id]: parseFloat(e.target.value)})} className="w-12 px-2 py-1 border rounded text-xs"/> : fmt.pct(h.stopLossPct, 0)}</td><td className="py-2 px-3"><div className="flex items-center gap-1">{editId === h.id ? <><button onClick={() => updateHolding(h.id, {stopLossPct: editSL[h.id] || h.stopLossPct})} className="text-emerald-600 hover:text-emerald-700"><Check size={14}/></button><button onClick={() => setEI(null)} className="text-slate-400 hover:text-slate-600"><X size={14}/></button></> : <><button onClick={() => {setEI(h.id); setESL({[h.id]: h.stopLossPct});}} className="text-blue-600 hover:text-blue-700"><Edit3 size={14}/></button><button onClick={() => updateHolding(h.id, {status: h.status === "active" ? "exited" : "active"})} className="text-slate-400 hover:text-slate-600"><Trash2 size={14}/></button></>}</div></td></tr>)}</tbody></table></Card>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// RETURNS PAGE
// ═══════════════════════════════════════════════════════════════════

function ReturnsPage({ holdings, settings, weeklyHistory }) {
  const { computed } = computeHoldings(holdings);
  const totalReturn = computed.reduce((s, h) => s + (h.currentPrice - h.buyPrice) * h.shares, 0);
  const totalInvested = computed.reduce((s, h) => s + (h.buyPrice * h.shares), 0);
  const portfolioReturn = totalInvested > 0 ? totalReturn / totalInvested : 0;

  const historyData = useMemo(() => {
    return (weeklyHistory || []).map((w, idx) => ({
      week: w.week || `W${idx+1}`,
      portfolio: (w.return || 0) * 100,
      cumulative: (w.cumulative || 0) * 100
    })).slice(-52);
  }, [weeklyHistory]);

  const stats = useMemo(() => [
    { label: "Total Return", value: fmt.usd(totalReturn), color: totalReturn >= 0 ? "text-emerald-600" : "text-red-600" },
    { label: "Return %", value: fmt.pct(portfolioReturn), color: portfolioReturn >= 0 ? "text-emerald-600" : "text-red-600" },
    { label: "Invested", value: fmt.usd(totalInvested), color: "text-slate-700" },
    { label: "Sharpe", value: fmt.num(0.45, 2), color: "text-blue-600" }
  ], [totalReturn, portfolioReturn, totalInvested]);

  return <div className="space-y-6">
    <SectionHeader title="Returns Analysis" subtitle="Historical & forward-looking performance"/>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{stats.map((s, i) => <Card key={i} className="p-4"><p className="text-[10px] font-semibold text-slate-500 uppercase mb-1">{s.label}</p><p className={`text-lg font-bold ${s.color}`}>{s.value}</p></Card>)}</div>
    <Card className="p-6"><h3 className="font-bold text-slate-800 mb-4">Portfolio Returns</h3><ResponsiveContainer width="100%" height={350}><ComposedChart data={historyData} margin={{top:5,right:30,left:0,bottom:5}}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="week" tick={{fontSize:11}} interval={Math.max(0,Math.floor(historyData.length/8)-1)}/><YAxis yAxisId="left" tick={{fontSize:11}}/><YAxis yAxisId="right" orientation="right" tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>v.toFixed(2)+"%"}/>}/><Legend/><Area yAxisId="left" type="monotone" dataKey="portfolio" fill="#2563eb" stroke="#2563eb" fillOpacity={0.1}/><Line yAxisId="right" type="monotone" dataKey="cumulative" stroke="#10b981" strokeWidth={2} dot={{fill:"#10b981",r:3}} activeDot={{r:5}}/></ComposedChart></ResponsiveContainer></Card>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// RISK PAGE
// ═══════════════════════════════════════════════════════════════════

function RiskPage({ holdings, settings }) {
  const { computed } = computeHoldings(holdings);
  const portfolioBeta = computed.reduce((s, h) => s + (h.weight || 0) * (h.marketBeta || 0), 0);
  const portfolioVol = settings.portfolioVol || 0.168;
  const systematicVol = calc.systematicVol(portfolioBeta, settings.benchmarkVol || 0.122);
  const idiovol = calc.idiosyncraticVol(portfolioVol, systematicVol);
  const trackingErr = calc.trackingError(portfolioBeta, settings.benchmarkVol || 0.122, idiovol);
  const dailyVar95 = calc.dailyVaR95(portfolioVol);
  const dailyVar99 = calc.dailyVaR99(portfolioVol);
  const weeklyVar95 = calc.weeklyVaR95(portfolioVol);
  const weeklyVar99 = calc.weeklyVaR99(portfolioVol);
  const betaDev = Math.abs(portfolioBeta - 1);
  const systStatus = systematicVol <= settings.limits.systematicVol ? "OK" : systematicVol > settings.limits.systematicVol * 1.2 ? "BREACH" : "WARNING";
  const betaStatus = betaDev <= settings.limits.betaDeviation ? "OK" : betaDev > settings.limits.betaDeviation * 1.2 ? "BREACH" : "WARNING";
  const trackStatus = trackingErr <= settings.limits.trackingError ? "OK" : trackingErr > settings.limits.trackingError * 1.2 ? "BREACH" : "WARNING";
  const varStatus = dailyVar95 <= settings.limits.dailyVaR95 ? "OK" : dailyVar95 > settings.limits.dailyVaR95 * 1.2 ? "BREACH" : "WARNING";
  const maxWeight = computed.reduce((m, h) => Math.max(m, h.weight || 0), 0);
  const concStatus = maxWeight <= settings.limits.maxStockWeight ? "OK" : maxWeight > settings.limits.maxStockWeight * 1.2 ? "BREACH" : "WARNING";

  const risks = [
    { label: "Systematic Vol", value: fmt.pct(systematicVol), limit: fmt.pct(settings.limits.systematicVol), status: systStatus },
    { label: "Idiosyncratic Vol", value: fmt.pct(idiovol), limit: "—", status: "OK" },
    { label: "Tracking Error", value: fmt.pct(trackingErr), limit: fmt.pct(settings.limits.trackingError), status: trackStatus },
    { label: "Beta Deviation", value: fmt.num(betaDev, 2), limit: fmt.num(settings.limits.betaDeviation, 2), status: betaStatus },
    { label: "Daily VaR (95%)", value: fmt.pct(dailyVar95), limit: fmt.pct(settings.limits.dailyVaR95), status: varStatus },
    { label: "Concentration", value: fmt.pct(maxWeight), limit: fmt.pct(settings.limits.maxStockWeight), status: concStatus },
  ];

  return <div className="space-y-6">
    <SectionHeader title="Risk Analysis" subtitle="Volatility, VaR, Beta, Concentration"/>
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <StatCard label="Portfolio Vol" value={fmt.pct(portfolioVol)} color="text-purple-600" icon={Shield}/>
      <StatCard label="Systematic Vol" value={fmt.pct(systematicVol)} color="text-blue-600" icon={BarChart3}/>
      <StatCard label="Idiosyncratic Vol" value={fmt.pct(idiovol)} color="text-amber-600" icon={Target}/>
      <StatCard label="Portfolio Beta" value={fmt.num(portfolioBeta, 2)} color={Math.abs(portfolioBeta-1)<0.2?"text-emerald-600":"text-orange-600"} icon={TrendingUp}/>
      <StatCard label="Tracking Error" value={fmt.pct(trackingErr)} color="text-slate-700" icon={BarChart3}/>
      <StatCard label="Max Weight" value={fmt.pct(maxWeight)} color={maxWeight<0.08?"text-emerald-600":"text-red-600"} icon={Briefcase}/>
    </div>
    <Card className="p-6">
      <h3 className="font-bold text-slate-800 mb-4">Risk Summary</h3>
      <div className="space-y-3">
        {risks.map((r, i) => {
          const limitStr = r.limit !== "—" ? `/ ${r.limit}` : "";
          return (
            <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-slate-50">
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-800">{r.label}</p>
                <p className="text-xs text-slate-500">{r.value} {limitStr}</p>
              </div>
              <Badge status={r.status}/>
            </div>
          );
        })}
      </div>
    </Card>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// ENHANCED STOP-LOSS PAGE
// ═══════════════════════════════════════════════════════════════════

function StopLossPage({ holdings, settings }) {
  const [filter, setF] = useState("all");
  const active = holdings.filter(h => h.status === "active" && h.theme !== "Benchmark");
  const data = active.map(h => {
    const sl = h.buyPrice * (1 - h.stopLossPct);
    const dist = h.currentPrice > 0 ? (h.currentPrice - sl) / h.currentPrice : 1;
    const st = h.currentPrice <= sl ? "BREACH" : dist < settings.stopLossWarningBuffer ? "WARNING" : "OK";
    return { ...h, slPrice: sl, distToSl: dist, alertStatus: st };
  });
  const filtered = filter === "all" ? data : filter === "BREACH" ? data.filter(h => h.alertStatus === "BREACH") : filter === "WARNING" ? data.filter(h => h.alertStatus === "WARNING") : data.filter(h => h.theme === filter);
  const bc = data.filter(h => h.alertStatus === "BREACH").length;
  const wc = data.filter(h => h.alertStatus === "WARNING").length;
  const themes = [...new Set(active.map(h => h.theme))];

  const getStatusIcon = (status) => {
    if (status === "BREACH") return <AlertCircle size={16} className="text-red-600" />;
    if (status === "WARNING") return <AlertTriangle size={16} className="text-amber-600" />;
    return <CheckCircle size={16} className="text-emerald-600" />;
  };

  const getProgressColor = (dist) => {
    if (dist < 0.05) return "#ef4444";
    if (dist < 0.15) return "#f59e0b";
    return "#10b981";
  };

  return <div className="space-y-6">
    <SectionHeader title="Stop-Loss Monitoring" subtitle="4σ framework" />

    <Card className="p-4 bg-blue-50 border-blue-200">
      <div className="flex items-start gap-3">
        <div className="w-5 h-5 rounded-full bg-blue-200 flex items-center justify-center text-xs font-bold text-blue-700">i</div>
        <div>
          <p className="text-sm font-semibold text-blue-900">Stop-Loss Formula</p>
          <p className="text-xs text-blue-800 mt-1">SL Price = Buy Price × (1 − SL%)</p>
          <p className="text-xs text-blue-700 mt-2">Each position has a stop-loss percentage that triggers protection when price falls below the calculated SL price.</p>
        </div>
      </div>
    </Card>

    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard label="Breached" value={bc} color={bc > 0 ? "text-red-600" : "text-emerald-600"} icon={AlertCircle} />
      <StatCard label="Warning" value={wc} color={wc > 0 ? "text-amber-600" : "text-emerald-600"} icon={AlertTriangle} />
      <StatCard label="OK" value={data.length - bc - wc} color="text-emerald-600" icon={CheckCircle} />
      <StatCard label="Monitored" value={data.length} icon={Shield} />
    </div>

    <div className="flex items-center gap-2 flex-wrap">
      {["all", "BREACH", "WARNING", ...themes].map(f => (
        <TabButton key={f} active={filter === f} onClick={() => setF(f)}>
          {f === "all" ? "All" : f}
        </TabButton>
      ))}
    </div>

    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b">
            {["Ticker", "Theme", "Buy $", "Current $", "SL %", "SL Price", "Distance", "Status"].map(h => (
              <th key={h} className="py-2 px-3 text-left text-xs font-semibold text-slate-500 uppercase">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.sort((a, b) => a.distToSl - b.distToSl).map(h => (
            <tr
              key={h.id}
              className={`border-b hover:bg-slate-50 ${
                h.alertStatus === "BREACH"
                  ? "bg-red-50/50"
                  : h.alertStatus === "WARNING"
                  ? "bg-amber-50/30"
                  : ""
              }`}
            >
              <td className="py-2 px-3 font-semibold text-slate-800">{h.ticker}</td>
              <td className="py-2 px-3">
                <ThemeBadge theme={h.theme} />
              </td>
              <td className="py-2 px-3">{fmt.usdExact(h.buyPrice)}</td>
              <td className="py-2 px-3">{fmt.usdExact(h.currentPrice)}</td>
              <td className="py-2 px-3">{fmt.pct(h.stopLossPct, 0)}</td>
              <td className="py-2 px-3">{fmt.usdExact(h.slPrice)}</td>
              <td className="py-2 px-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-slate-100 rounded-full h-3 max-w-[100px] overflow-hidden">
                    <div
                      className="h-3 rounded-full transition-all"
                      style={{
                        width: `${Math.max(0, Math.min(100, (1 - h.distToSl / 0.3) * 100))}%`,
                        backgroundColor: getProgressColor(h.distToSl),
                        background: `linear-gradient(90deg, #ef4444 0%, #f59e0b 50%, #10b981 100%)`
                      }}
                    />
                  </div>
                  <span className="text-xs font-medium whitespace-nowrap">{fmt.pct(h.distToSl, 1)}</span>
                </div>
              </td>
              <td className="py-2 px-3">
                <div className="flex items-center gap-2">
                  {getStatusIcon(h.alertStatus)}
                  <span className="text-xs font-semibold">{h.alertStatus}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// TEAM REPORT — save, upload, google doc
// ═══════════════════════════════════════════════════════════════════
function TeamReportPage({ holdings, settings, report, setReport, reportMeta, setReportMeta }) {
  const {totalVal,computed,totalRealizedPnl}=computeHoldings(holdings);const pb=calc.portfolioBeta(computed);
  const [ss,setSS]=useState(null);const [uf,setUF]=useState(null);const [gUrl,setGUrl]=useState(reportMeta?.docUrl||"");const [sUrl,setSUrl]=useState(reportMeta?.docUrl||"");const [showDoc,setSD]=useState(!!reportMeta?.docUrl);const [docEdit,setDE]=useState(!reportMeta?.docUrl);const [upEdit,setUE]=useState(!reportMeta?.uploadedFileName);const fr=useRef(null);

  const save=async()=>{setSS("saving");await setReport(report);await setReportMeta({...reportMeta,docUrl:sUrl||gUrl,uploadedFileName:uf?.name||reportMeta?.uploadedFileName});setTimeout(()=>setSS("saved"),300);setTimeout(()=>setSS(null),2500);};
  const onFile=e=>{const f=e.target.files?.[0];if(!f)return;setUF({name:f.name,url:URL.createObjectURL(f),type:f.type,size:(f.size/1024).toFixed(1)+" KB"});setUE(false);setReportMeta({...reportMeta,uploadedFileName:f.name});};
  const saveDoc=()=>{if(!gUrl)return;let u=gUrl;if(u.includes("/edit"))u=u.replace("/edit","/preview");else if(!u.includes("/preview")&&u.includes("docs.google.com"))u=u.replace(/\/?(\?.*)?$/,"/preview");setSUrl(u);setSD(true);setDE(false);setReportMeta({...reportMeta,docUrl:u});};

  return <div className="space-y-6">
    <SectionHeader title="Team Report">
      <div className="flex items-center gap-2">
        <button onClick={save} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium ${ss==="saved"?"bg-emerald-600 text-white":"bg-slate-800 text-white hover:bg-slate-700"}`}>
          {ss==="saving"?<Loader2 size={16} className="animate-spin"/>:ss==="saved"?<Check size={16}/>:<Save size={16}/>} {ss==="saved"?"Saved!":"Save All"}
        </button>
        <button onClick={()=>window.print()} className="flex items-center gap-2 px-4 py-2 border text-slate-700 rounded-md hover:bg-slate-50 text-sm"><Printer size={16}/> Print</button>
      </div>
    </SectionHeader>
    <Card className="p-6">
      <div className="border-b-2 border-slate-800 pb-4 mb-4 text-center">
        <h1 className="text-xl font-bold text-slate-800">NYU Stern MIF</h1>
        <p className="text-sm text-slate-500 mt-1">{new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</p>
      </div>
      <div className="grid grid-cols-4 gap-4 text-center">
        {[{l:"Value",v:fmt.usd(totalVal)},{l:"β",v:fmt.num(pb)},{l:"Active",v:computed.length},{l:"Realized PnL",v:fmt.usd(totalRealizedPnl)}].map(s=>(
          <div key={s.l} className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs text-slate-500">{s.l}</p>
            <p className="text-lg font-bold text-slate-800">{s.v}</p>
          </div>
        ))}
      </div>
    </Card>
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Upload Document</h3>
      {upEdit ? (
        <div>
          <input ref={fr} type="file" accept=".pdf,.doc,.docx" onChange={onFile} className="hidden"/>
          <button onClick={()=>fr.current?.click()} className="flex items-center gap-2 px-4 py-3 border-2 border-dashed rounded-lg text-sm text-slate-600 hover:border-blue-400 w-full justify-center">
            <Upload size={18}/> Upload PDF / DOCX
          </button>
          {uf && (
            <div className="mt-3 flex items-center gap-2">
              <div className="flex-1 p-2.5 bg-slate-50 rounded-lg flex items-center gap-2">
                <FileText size={16} className="text-blue-500"/>
                <span className="text-sm font-medium truncate">{uf.name}</span>
              </div>
              <button onClick={()=>setUE(false)} className="px-3 py-2 bg-emerald-600 text-white text-xs rounded-md"><Save size={12}/></button>
            </div>
          )}
        </div>
      ) : uf ? (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
          <CheckCircle size={16} className="text-emerald-600"/>
          <span className="text-sm font-medium">{uf.name}</span>
          <button onClick={()=>setUE(true)} className="ml-auto text-xs text-slate-500 border rounded px-2 py-1">Change</button>
        </div>
      ) : reportMeta?.uploadedFileName ? (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <FileText size={16} className="text-amber-500"/>
          <span className="text-sm">{reportMeta.uploadedFileName}</span>
          <button onClick={()=>setUE(true)} className="ml-auto text-xs border rounded px-2 py-1">Re-upload</button>
        </div>
      ) : null}
    </Card>
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Google Doc</h3>
      {docEdit || !sUrl ? (
        <div className="flex gap-2">
          <input type="text" value={gUrl} onChange={e=>setGUrl(e.target.value)} placeholder="https://docs.google.com/document/d/..." className="flex-1 px-3 py-2.5 text-sm border rounded-lg"/>
          <button onClick={saveDoc} disabled={!gUrl} className="px-4 py-2.5 bg-emerald-600 text-white text-sm rounded-lg disabled:opacity-50"><Save size={14}/></button>
        </div>
      ) : (
        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <CheckCircle size={16} className="text-blue-600"/>
          <a href={gUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-700 truncate flex-1">{gUrl}</a>
          <button onClick={()=>setDE(true)} className="text-xs border rounded px-2 py-1">Edit</button>
        </div>
      )}
    </Card>
    {(uf || showDoc) && (
      <Card className="p-4">
        <div className="border rounded-lg overflow-hidden bg-slate-50" style={{height:"600px"}}>
          {uf?.type==="application/pdf" ? (
            <iframe src={uf.url} className="w-full h-full"/>
          ) : showDoc && !uf ? (
            <iframe src={sUrl} className="w-full h-full"/>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-slate-500">{uf ? "Preview unavailable for this format" : "Loading..."}</p>
            </div>
          )}
        </div>
      </Card>
    )}
    <Card className="p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700">Report Draft</h3>
        <button onClick={save} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-slate-800 text-white rounded-md"><Save size={12}/> Save</button>
      </div>
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
  const expJ=()=>{
    const d=JSON.stringify({holdings,settings,weeklyHistory},null,2);
    const b=new Blob([d],{type:"application/json"});
    const u=URL.createObjectURL(b);
    const a=document.createElement("a");a.href=u;a.download=`stern_${group}_data.json`;a.click();
  };
  const impJ=()=>{
    const inp=document.createElement("input");inp.type="file";inp.accept=".json";
    inp.onchange=e=>{
      const f=e.target.files[0];if(!f)return;
      const r=new FileReader();
      r.onload=ev=>{
        try{const p=JSON.parse(ev.target.result);if(p.holdings)setHoldings(p.holdings);if(p.settings)setSettings(p.settings);if(p.weeklyHistory)setWeeklyHistory(p.weeklyHistory);}
        catch{alert("Invalid JSON");}
      };
      r.readAsText(f);
    };
    inp.click();
  };
  const reset=async()=>{
    if(!confirm(`Reset ${group} database?`))return;
    try{await fetch("/api/reset",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({group})});window.location.reload();}
    catch(e){alert("Reset failed: "+e.message);}
  };

  return <div className="space-y-6">
    <SectionHeader title="Settings" subtitle={`${group} group`}>
      <button onClick={save} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium ${ss==="saved"?"bg-emerald-600 text-white":"bg-slate-800 text-white hover:bg-slate-700"}`}>
        {ss==="saving"?<Loader2 size={16} className="animate-spin"/>:ss==="saved"?<Check size={16}/>:<Save size={16}/>} {ss==="saved"?"Saved!":"Save Settings"}
      </button>
    </SectionHeader>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Inputs</h3>
        <div className="space-y-3">
          {[{l:"SPY Weekly Return",k:"spyWeeklyReturn"},{l:"Benchmark Vol",k:"benchmarkVol"},{l:"Portfolio Vol",k:"portfolioVol"},{l:"Risk-Free Rate",k:"riskFreeRate"},{l:"SL Warning Buffer",k:"stopLossWarningBuffer"}].map(p=>(
            <div key={p.k} className="flex items-center gap-3">
              <label className="text-xs text-slate-500 font-medium w-40">{p.l}</label>
              <input type="number" value={settings[p.k]} onChange={e=>setSettings({...settings,[p.k]:parseFloat(e.target.value)||0})} step="0.001" className="flex-1 px-2 py-1.5 text-sm border rounded-md"/>
            </div>
          ))}
        </div>
      </Card>
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Limits</h3>
        <div className="space-y-3">
          {Object.entries(settings.limits||{}).map(([k,v])=>(
            <div key={k} className="flex items-center gap-3">
              <label className="text-xs text-slate-500 font-medium w-40 capitalize">{k.replace(/([A-Z])/g," $1")}</label>
              <input type="number" value={v} onChange={e=>setSettings({...settings,limits:{...settings.limits,[k]:parseFloat(e.target.value)||0}})} step="0.01" className="flex-1 px-2 py-1.5 text-sm border rounded-md"/>
            </div>
          ))}
        </div>
      </Card>
    </div>
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-slate-700 mb-4">Data</h3>
      <div className="flex flex-wrap gap-3">
        <button onClick={expJ} className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-md text-sm"><Download size={14}/> Export JSON</button>
        <button onClick={impJ} className="flex items-center gap-2 px-4 py-2 border rounded-md text-sm"><Upload size={14}/> Import JSON</button>
        <button onClick={reset} className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 rounded-md text-sm"><RefreshCw size={14}/> Reset {group}</button>
      </div>
    </Card>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// COMMENTS PANEL — FLOATING PANEL WITH CRUD
// ═══════════════════════════════════════════════════════════════════

function CommentsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [posting, setPosting] = useState(false);

  const fetchComments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/comments");
      const data = await res.json();
      setComments(data.comments || []);
    } catch (e) {
      console.warn("Failed to fetch comments:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchComments();
    }
  }, [isOpen, fetchComments]);

  const handlePostComment = async () => {
    if (!newComment.trim()) return;
    setPosting(true);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "Team", content: newComment })
      });
      if (res.ok) {
        setNewComment("");
        await fetchComments();
      }
    } catch (e) {
      console.error("Failed to post comment:", e);
    }
    setPosting(false);
  };

  const handleEditComment = async (id) => {
    if (!editText.trim()) return;
    try {
      const res = await fetch("/api/comments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, content: editText })
      });
      if (res.ok) {
        setEditingId(null);
        setEditText("");
        await fetchComments();
      }
    } catch (e) {
      console.error("Failed to edit comment:", e);
    }
  };

  const handleDeleteComment = async (id) => {
    try {
      const res = await fetch("/api/comments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
      if (res.ok) {
        await fetchComments();
      }
    } catch (e) {
      console.error("Failed to delete comment:", e);
    }
  };

  const getRelativeTime = (timestamp) => {
    if (!timestamp) return "now";
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "now";
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-lg hover:shadow-xl transition-shadow flex items-center justify-center"
        style={{ backgroundColor: "#667eea", color: "white" }}
      >
        <MessageCircle size={24} />
      </button>

      {isOpen && (
        <div className="fixed bottom-24 right-6 w-96 h-96 bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col z-50">
          <div className="flex items-center justify-between p-4 border-b">
            <h3 className="font-bold text-slate-800">Comments</h3>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-slate-600"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 size={16} className="animate-spin text-slate-400" />
              </div>
            ) : comments.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-8">No comments yet</p>
            ) : (
              comments.map(comment => (
                <div
                  key={comment.id}
                  className="p-3 rounded-lg bg-slate-50 border-l-4"
                  style={{ borderLeftColor: "#667eea" }}
                >
                  {editingId === comment.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        className="w-full p-2 text-xs border rounded resize-none focus:outline-none focus:ring-2 focus:ring-purple-400"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEditComment(comment.id)}
                          className="flex-1 px-2 py-1 text-xs bg-emerald-50 text-emerald-600 rounded hover:bg-emerald-100"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(null);
                            setEditText("");
                          }}
                          className="flex-1 px-2 py-1 text-xs bg-slate-100 text-slate-600 rounded hover:bg-slate-200"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between mb-1">
                        <p className="font-semibold text-sm text-slate-800">{comment.author}</p>
                        <div className="flex gap-1">
                          <button
                            onClick={() => {
                              setEditingId(comment.id);
                              setEditText(comment.content);
                            }}
                            className="text-slate-400 hover:text-blue-600"
                          >
                            <Edit2 size={12} />
                          </button>
                          <button
                            onClick={() => handleDeleteComment(comment.id)}
                            className="text-slate-400 hover:text-red-600"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-slate-700 mb-1">{comment.content}</p>
                      <p className="text-[10px] text-slate-500">{getRelativeTime(comment.timestamp)}</p>
                    </>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="p-4 border-t space-y-2">
            <textarea
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              placeholder="Add a comment..."
              className="w-full p-2 text-xs border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-400"
              rows={2}
            />
            <button
              onClick={handlePostComment}
              disabled={posting || !newComment.trim()}
              className="w-full px-3 py-2 text-xs font-medium text-white rounded-lg transition-all disabled:opacity-50"
              style={{ backgroundColor: "#667eea" }}
            >
              Post
            </button>
          </div>
        </div>
      )}
    </>
  );
}

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

  const formatLastRefreshTime = (time) => {
    if (!time) return null;
    const hours = time.getHours() % 12 || 12;
    const minutes = String(time.getMinutes()).padStart(2, "0");
    const ampm = time.getHours() >= 12 ? "PM" : "AM";
    return `${hours}:${minutes} ${ampm}`;
  };

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
            {db.lastRefreshTime && <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">Last refresh: {formatLastRefreshTime(db.lastRefreshTime)}</span>}
            {db.lastPriceUpdate && <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">Prices: {db.lastPriceUpdate}</span>}
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"/><span className="text-xs text-slate-500">DB</span></div>
          </div>
        </header>
        )}
        <main className={`flex-1 min-h-0 ${page==='catalyst'?'overflow-hidden p-0 bg-[#0f1117]':'overflow-y-auto p-6'} print:p-0`}>
          {page==="overview" && <OverviewPage holdings={db.holdings} settings={db.settings} weeklyHistory={db.weeklyHistory}/>}
          {page==="holdings" && <HoldingsPage holdings={db.holdings} setHoldings={db.setHoldings} settings={db.settings} priceLoading={db.priceLoading} onRefreshPrices={db.refreshPrices}/>}
          {page==="returns" && <ReturnsPage holdings={db.holdings} settings={db.settings} weeklyHistory={db.weeklyHistory}/>}
          {page==="risk" && <RiskPage holdings={db.holdings} settings={db.settings}/>}
          {page==="stoploss" && <StopLossPage holdings={db.holdings} settings={db.settings}/>}
          {page==="report" && <TeamReportPage holdings={db.holdings} settings={db.settings} report={db.report} setReport={db.setReport} reportMeta={db.reportMeta} setReportMeta={db.setReportMeta}/>}
          {page==="settings" && <SettingsPage settings={db.settings} setSettings={db.setSettings} holdings={db.holdings} setHoldings={db.setHoldings} weeklyHistory={db.weeklyHistory} setWeeklyHistory={db.setWeeklyHistory} group={group}/>}
          {page==="catalyst" && <CatalystPage holdings={db.holdings}/>}
        </main>
      </div>

      <CommentsPanel />
    </div>
  );
}
