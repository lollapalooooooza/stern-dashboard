"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter, RadialBarChart, RadialBar, ComposedChart, Area } from "recharts";
import { TrendingUp, TrendingDown, DollarSign, BarChart3, Shield, AlertTriangle, FileText, Settings, Home, Briefcase, Activity, Target, ChevronDown, ChevronRight, Plus, Trash2, Search, Filter, Download, Upload, Save, RefreshCw, Edit3, Check, X, AlertCircle, CheckCircle, Info, Printer, Eye } from "lucide-react";

// ═══════════════════════════════════════════════
// FINANCIAL CALCULATION UTILITIES
// ═══════════════════════════════════════════════

const calc = {
  positionValue: (shares, price) => shares * price,
  pnlDollar: (current, buy, shares) => (current - buy) * shares,
  pnlPercent: (current, buy) => buy !== 0 ? (current - buy) / buy : 0,
  portfolioWeight: (posVal, totalVal) => totalVal !== 0 ? posVal / totalVal : 0,
  activeWeight: (portW, benchW) => portW - benchW,
  portfolioReturn: (holdings) => holdings.reduce((sum, h) => sum + (h.weight || 0) * (h.weeklyReturn || 0), 0),
  factorExposure: (holdings, factorKey) => holdings.reduce((sum, h) => sum + (h.weight || 0) * (h[factorKey] || 0), 0),
  factorContribution: (exposure, factorReturn) => exposure * factorReturn,
  alpha: (totalReturn, factorContributions) => totalReturn - factorContributions.reduce((s, c) => s + c, 0),
  portfolioBeta: (holdings) => holdings.reduce((sum, h) => sum + (h.weight || 0) * (h.marketBeta || 0), 0),
  riskContribution: (weight, beta, portBeta) => portBeta !== 0 ? (weight * beta) / portBeta : 0,
  systematicVol: (portBeta, benchVol) => Math.abs(portBeta) * benchVol,
  idiosyncraticVol: (portVol, sysVol) => Math.sqrt(Math.max(portVol * portVol - sysVol * sysVol, 0)),
  trackingError: (portBeta, benchVol, idioVol) => Math.sqrt(Math.pow(portBeta - 1, 2) * benchVol * benchVol + idioVol * idioVol),
  dailyVaR95: (annVol) => (annVol / Math.sqrt(252)) * 1.645,
  dailyVaR99: (annVol) => (annVol / Math.sqrt(252)) * 2.326,
  weeklyVaR95: (annVol) => (annVol / Math.sqrt(252)) * 1.645 * Math.sqrt(5),
  weeklyVaR99: (annVol) => (annVol / Math.sqrt(252)) * 2.326 * Math.sqrt(5),
  stopLossPrice: (buyPrice, stopPct) => buyPrice * (1 - stopPct),
  complianceStatus: (current, limit) => {
    const ratio = limit !== 0 ? current / limit : 0;
    if (ratio > 1.0) return "BREACH";
    if (ratio > 0.85) return "WARNING";
    return "OK";
  },
  utilization: (current, limit) => limit !== 0 ? current / limit : 0,
};

// ═══════════════════════════════════════════════
// FORMATTING HELPERS
// ═══════════════════════════════════════════════

const fmt = {
  pct: (v, d = 2) => v != null ? `${(v * 100).toFixed(d)}%` : "—",
  usd: (v) => v != null ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—",
  usdExact: (v) => v != null ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—",
  num: (v, d = 2) => v != null ? v.toFixed(d) : "—",
  date: (d) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—",
};

const statusColor = (s) => s === "BREACH" ? "text-red-600 bg-red-50 border-red-200" : s === "WARNING" ? "text-amber-600 bg-amber-50 border-amber-200" : "text-emerald-600 bg-emerald-50 border-emerald-200";
const statusBg = (s) => s === "BREACH" ? "#ef4444" : s === "WARNING" ? "#f59e0b" : "#10b981";

// ═══════════════════════════════════════════════
// THEME COLORS
// ═══════════════════════════════════════════════

const THEME_COLORS = {
  "Core": "#1e3a5f",
  "AI Infrastructure": "#2563eb",
  "Digital Infrastructure": "#7c3aed",
  "Cybersecurity": "#dc2626",
  "Waste Management": "#059669",
  "Nuclear Energy": "#d97706",
  "Defense Tech": "#64748b",
};
const CHART_COLORS = ["#1e3a5f", "#2563eb", "#7c3aed", "#dc2626", "#059669", "#d97706", "#64748b", "#0891b2", "#be185d", "#4338ca"];
const getThemeColor = (theme, i) => THEME_COLORS[theme] || CHART_COLORS[i % CHART_COLORS.length];

// ═══════════════════════════════════════════════
// SAMPLE DATA
// ═══════════════════════════════════════════════

const createSampleHoldings = () => [
  { id: "1", ticker: "SPY", company: "SPDR S&P 500 ETF", theme: "Core", subTheme: "Index", buyPrice: 540.00, currentPrice: 567.50, entryDate: "2024-09-15", exitDate: "", shares: 185, benchmarkWeight: 0.40, stopLossPct: 0.08, status: "active", notes: "Core satellite anchor", marketBeta: 1.00, valueBeta: 0.0, momentumBeta: 0.0, weeklyReturn: 0.012 },
  { id: "2", ticker: "NVDA", company: "NVIDIA Corp", theme: "AI Infrastructure", subTheme: "GPU/Chips", buyPrice: 875.00, currentPrice: 950.00, entryDate: "2024-10-01", exitDate: "", shares: 22, benchmarkWeight: 0.065, stopLossPct: 0.15, status: "active", notes: "AI compute leader", marketBeta: 1.65, valueBeta: -0.30, momentumBeta: 0.45, weeklyReturn: 0.025 },
  { id: "3", ticker: "AVGO", company: "Broadcom Inc", theme: "AI Infrastructure", subTheme: "Networking", buyPrice: 168.00, currentPrice: 185.50, entryDate: "2024-10-15", exitDate: "", shares: 65, benchmarkWeight: 0.02, stopLossPct: 0.12, status: "active", notes: "Custom ASIC + VMware", marketBeta: 1.35, valueBeta: 0.10, momentumBeta: 0.35, weeklyReturn: 0.018 },
  { id: "4", ticker: "EQIX", company: "Equinix Inc", theme: "Digital Infrastructure", subTheme: "Data Centers", buyPrice: 820.00, currentPrice: 890.00, entryDate: "2024-09-20", exitDate: "", shares: 12, benchmarkWeight: 0.005, stopLossPct: 0.10, status: "active", notes: "Global DC REIT", marketBeta: 0.85, valueBeta: 0.20, momentumBeta: 0.15, weeklyReturn: 0.008 },
  { id: "5", ticker: "DLR", company: "Digital Realty Trust", theme: "Digital Infrastructure", subTheme: "Data Centers", buyPrice: 142.00, currentPrice: 155.00, entryDate: "2024-10-05", exitDate: "", shares: 55, benchmarkWeight: 0.003, stopLossPct: 0.10, status: "active", notes: "Hyperscale DC exposure", marketBeta: 0.80, valueBeta: 0.25, momentumBeta: 0.10, weeklyReturn: 0.006 },
  { id: "6", ticker: "CRWD", company: "CrowdStrike Holdings", theme: "Cybersecurity", subTheme: "Endpoint", buyPrice: 290.00, currentPrice: 345.00, entryDate: "2024-09-25", exitDate: "", shares: 25, benchmarkWeight: 0.005, stopLossPct: 0.15, status: "active", notes: "XDR platform leader", marketBeta: 1.45, valueBeta: -0.40, momentumBeta: 0.30, weeklyReturn: 0.015 },
  { id: "7", ticker: "PANW", company: "Palo Alto Networks", theme: "Cybersecurity", subTheme: "Platform", buyPrice: 310.00, currentPrice: 335.00, entryDate: "2024-10-10", exitDate: "", shares: 20, benchmarkWeight: 0.004, stopLossPct: 0.12, status: "active", notes: "Platformization play", marketBeta: 1.30, valueBeta: -0.25, momentumBeta: 0.20, weeklyReturn: 0.010 },
  { id: "8", ticker: "WM", company: "Waste Management Inc", theme: "Waste Management", subTheme: "Hauling", buyPrice: 205.00, currentPrice: 218.00, entryDate: "2024-09-18", exitDate: "", shares: 40, benchmarkWeight: 0.004, stopLossPct: 0.08, status: "active", notes: "Defensive + pricing power", marketBeta: 0.70, valueBeta: 0.30, momentumBeta: 0.05, weeklyReturn: 0.004 },
  { id: "9", ticker: "RSG", company: "Republic Services", theme: "Waste Management", subTheme: "Hauling", buyPrice: 188.00, currentPrice: 196.00, entryDate: "2024-10-08", exitDate: "", shares: 35, benchmarkWeight: 0.003, stopLossPct: 0.08, status: "active", notes: "Sustainability focus", marketBeta: 0.65, valueBeta: 0.35, momentumBeta: 0.00, weeklyReturn: 0.003 },
  { id: "10", ticker: "CCJ", company: "Cameco Corp", theme: "Nuclear Energy", subTheme: "Uranium", buyPrice: 52.00, currentPrice: 58.50, entryDate: "2024-10-12", exitDate: "", shares: 120, benchmarkWeight: 0.001, stopLossPct: 0.15, status: "active", notes: "Uranium supply leader", marketBeta: 1.20, valueBeta: 0.15, momentumBeta: 0.25, weeklyReturn: 0.020 },
  { id: "11", ticker: "VST", company: "Vistra Corp", theme: "Nuclear Energy", subTheme: "Power Gen", buyPrice: 95.00, currentPrice: 112.00, entryDate: "2024-10-20", exitDate: "", shares: 55, benchmarkWeight: 0.002, stopLossPct: 0.12, status: "active", notes: "Nuclear + nat gas gen", marketBeta: 1.10, valueBeta: 0.20, momentumBeta: 0.40, weeklyReturn: 0.022 },
  { id: "12", ticker: "LMT", company: "Lockheed Martin", theme: "Defense Tech", subTheme: "Primes", buyPrice: 545.00, currentPrice: 510.00, entryDate: "2024-11-01", exitDate: "", shares: 10, benchmarkWeight: 0.005, stopLossPct: 0.10, status: "active", notes: "F-35 + Space", marketBeta: 0.60, valueBeta: 0.40, momentumBeta: -0.10, weeklyReturn: -0.008 },
];

const createSampleSettings = () => ({
  benchmarkTicker: "SPY",
  benchmarkName: "S&P 500",
  benchmarkVol: 0.16,
  portfolioVol: 0.19,
  riskFreeRate: 0.052,
  spyWeeklyReturn: 0.012,
  iveWeeklyReturn: 0.008,
  mtumWeeklyReturn: 0.015,
  limits: {
    dailyVaR95: 0.025,
    trackingError: 0.06,
    betaDeviation: 0.30,
    systematicVol: 0.20,
    maxStockWeight: 0.08,
    spyWeight: 0.50,
  },
  warningThreshold: 0.85,
  stopLossWarningBuffer: 0.03,
});

const createWeeklyHistory = () => [
  { week: "W1", date: "2024-10-07", portfolioReturn: 0.015, benchmarkReturn: 0.012, marketContrib: 0.010, valueContrib: 0.002, momentumContrib: 0.001, alpha: 0.002 },
  { week: "W2", date: "2024-10-14", portfolioReturn: -0.008, benchmarkReturn: -0.005, marketContrib: -0.005, valueContrib: -0.001, momentumContrib: -0.001, alpha: -0.001 },
  { week: "W3", date: "2024-10-21", portfolioReturn: 0.022, benchmarkReturn: 0.018, marketContrib: 0.016, valueContrib: 0.002, momentumContrib: 0.003, alpha: 0.001 },
  { week: "W4", date: "2024-10-28", portfolioReturn: 0.005, benchmarkReturn: 0.008, marketContrib: 0.007, valueContrib: 0.001, momentumContrib: -0.001, alpha: -0.002 },
  { week: "W5", date: "2024-11-04", portfolioReturn: 0.018, benchmarkReturn: 0.010, marketContrib: 0.009, valueContrib: 0.003, momentumContrib: 0.004, alpha: 0.002 },
  { week: "W6", date: "2024-11-11", portfolioReturn: 0.012, benchmarkReturn: 0.011, marketContrib: 0.010, valueContrib: 0.001, momentumContrib: 0.002, alpha: -0.001 },
  { week: "W7", date: "2024-11-18", portfolioReturn: -0.003, benchmarkReturn: 0.002, marketContrib: 0.002, valueContrib: -0.002, momentumContrib: -0.001, alpha: -0.002 },
  { week: "W8", date: "2024-11-25", portfolioReturn: 0.010, benchmarkReturn: 0.007, marketContrib: 0.006, valueContrib: 0.001, momentumContrib: 0.002, alpha: 0.001 },
];

// ═══════════════════════════════════════════════
// STORAGE HOOK
// ═══════════════════════════════════════════════

function usePersistedState(key, defaultValue) {
  const [data, setData] = useState(defaultValue);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const result = await window.storage.get(key);
        if (result && result.value) {
          setData(JSON.parse(result.value));
        }
      } catch (e) {
        // key not found, use default
      }
      setLoaded(true);
    })();
  }, [key]);

  const save = useCallback(async (newData) => {
    setData(newData);
    try {
      await window.storage.set(key, JSON.stringify(newData));
    } catch (e) {
      console.error("Storage save error:", e);
    }
  }, [key]);

  return [data, save, loaded];
}

// ═══════════════════════════════════════════════
// REUSABLE UI COMPONENTS
// ═══════════════════════════════════════════════

const Card = ({ children, className = "", onClick }) => (
  <div className={`bg-white rounded-lg border border-slate-200 shadow-sm ${className}`} onClick={onClick}>{children}</div>
);

const StatCard = ({ label, value, sub, icon: Icon, trend, color = "text-slate-700" }) => (
  <Card className="p-4">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">{label}</p>
        <p className={`text-xl font-bold ${color}`}>{value}</p>
        {sub && <p className={`text-xs mt-1 ${trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-500" : "text-slate-500"}`}>{sub}</p>}
      </div>
      {Icon && <div className="p-2 bg-slate-50 rounded-lg"><Icon size={18} className="text-slate-400" /></div>}
    </div>
  </Card>
);

const Badge = ({ status, small }) => {
  const cls = status === "BREACH" ? "bg-red-100 text-red-700 border-red-200" :
    status === "WARNING" ? "bg-amber-100 text-amber-700 border-amber-200" :
    status === "active" ? "bg-emerald-100 text-emerald-700 border-emerald-200" :
    status === "exited" ? "bg-slate-100 text-slate-500 border-slate-200" :
    status === "watchlist" ? "bg-blue-100 text-blue-700 border-blue-200" :
    "bg-emerald-100 text-emerald-700 border-emerald-200";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${cls} ${small ? "text-[10px] px-1.5 py-0" : ""}`}>{status}</span>;
};

const TabButton = ({ active, children, onClick }) => (
  <button onClick={onClick} className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${active ? "bg-slate-800 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}>{children}</button>
);

const Input = ({ value, onChange, type = "text", className = "", ...props }) => (
  <input type={type} value={value ?? ""} onChange={e => onChange(type === "number" ? (e.target.value === "" ? "" : parseFloat(e.target.value)) : e.target.value)}
    className={`w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white ${className}`} {...props} />
);

const Select = ({ value, onChange, options, className = "" }) => (
  <select value={value} onChange={e => onChange(e.target.value)} className={`px-2 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white ${className}`}>
    {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
  </select>
);

const SectionHeader = ({ title, subtitle, children }) => (
  <div className="flex items-center justify-between mb-4">
    <div>
      <h2 className="text-lg font-bold text-slate-800">{title}</h2>
      {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
    </div>
    {children && <div className="flex items-center gap-2">{children}</div>}
  </div>
);

const CustomTooltip = ({ active, payload, label, formatter }) => {
  if (!active || !payload) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold text-slate-700 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="flex justify-between gap-4">
          <span>{p.name}:</span>
          <span className="font-medium">{formatter ? formatter(p.value) : typeof p.value === "number" && Math.abs(p.value) < 1 ? fmt.pct(p.value) : fmt.num(p.value)}</span>
        </p>
      ))}
    </div>
  );
};

// ═══════════════════════════════════════════════
// OVERVIEW PAGE
// ═══════════════════════════════════════════════

function OverviewPage({ holdings, settings, weeklyHistory }) {
  const computedHoldings = useMemo(() => {
    const totalVal = holdings.filter(h => h.status === "active").reduce((s, h) => s + h.shares * h.currentPrice, 0);
    return holdings.filter(h => h.status === "active").map(h => {
      const posVal = calc.positionValue(h.shares, h.currentPrice);
      const weight = calc.portfolioWeight(posVal, totalVal);
      const pnlP = calc.pnlPercent(h.currentPrice, h.buyPrice);
      const pnlD = calc.pnlDollar(h.currentPrice, h.buyPrice, h.shares);
      return { ...h, positionValue: posVal, weight, pnlPercent: pnlP, pnlDollar: pnlD };
    });
  }, [holdings]);

  const totalValue = computedHoldings.reduce((s, h) => s + h.positionValue, 0);
  const totalPnl = computedHoldings.reduce((s, h) => s + h.pnlDollar, 0);
  const totalReturn = totalValue > 0 ? totalPnl / (totalValue - totalPnl) : 0;
  const benchReturn = settings.spyWeeklyReturn * 8;
  const activeReturn = totalReturn - benchReturn;
  const portBeta = calc.portfolioBeta(computedHoldings);
  const sysVol = calc.systematicVol(portBeta, settings.benchmarkVol);
  const idioVol = calc.idiosyncraticVol(settings.portfolioVol, sysVol);
  const te = calc.trackingError(portBeta, settings.benchmarkVol, idioVol);
  const dVar95 = calc.dailyVaR95(settings.portfolioVol);
  const themes = [...new Set(computedHoldings.map(h => h.theme))];
  const stopAlerts = computedHoldings.filter(h => {
    const slPrice = calc.stopLossPrice(h.buyPrice, h.stopLossPct);
    return h.currentPrice <= slPrice * (1 + settings.stopLossWarningBuffer);
  }).length;

  const themeAllocation = themes.map((t, i) => ({
    name: t,
    value: computedHoldings.filter(h => h.theme === t).reduce((s, h) => s + h.weight, 0),
    fill: getThemeColor(t, i),
  }));

  const topHoldings = [...computedHoldings].sort((a, b) => b.weight - a.weight).slice(0, 8);
  const pnlByHolding = [...computedHoldings].sort((a, b) => b.pnlDollar - a.pnlDollar);

  const cumulativeData = weeklyHistory.map((w, i) => ({
    week: w.week,
    portfolio: weeklyHistory.slice(0, i + 1).reduce((s, x) => s + x.portfolioReturn, 0),
    benchmark: weeklyHistory.slice(0, i + 1).reduce((s, x) => s + x.benchmarkReturn, 0),
  }));

  const riskByTheme = themes.map((t, i) => {
    const themeH = computedHoldings.filter(h => h.theme === t);
    const rc = themeH.reduce((s, h) => s + calc.riskContribution(h.weight, h.marketBeta, portBeta), 0);
    return { name: t, value: rc, fill: getThemeColor(t, i) };
  });

  const waterfallData = [
    { name: "Market", value: weeklyHistory.reduce((s, w) => s + w.marketContrib, 0) },
    { name: "Value", value: weeklyHistory.reduce((s, w) => s + w.valueContrib, 0) },
    { name: "Momentum", value: weeklyHistory.reduce((s, w) => s + w.momentumContrib, 0) },
    { name: "Alpha", value: weeklyHistory.reduce((s, w) => s + w.alpha, 0) },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard label="Portfolio Value" value={fmt.usd(totalValue)} icon={DollarSign} />
        <StatCard label="Total Return" value={fmt.pct(totalReturn)} trend={totalReturn >= 0 ? "up" : "down"} color={totalReturn >= 0 ? "text-emerald-700" : "text-red-600"} icon={TrendingUp} />
        <StatCard label="Total PnL" value={fmt.usd(totalPnl)} trend={totalPnl >= 0 ? "up" : "down"} color={totalPnl >= 0 ? "text-emerald-700" : "text-red-600"} icon={BarChart3} />
        <StatCard label="Benchmark Return" value={fmt.pct(benchReturn)} icon={Activity} />
        <StatCard label="Active Return" value={fmt.pct(activeReturn)} trend={activeReturn >= 0 ? "up" : "down"} color={activeReturn >= 0 ? "text-emerald-700" : "text-red-600"} icon={Target} />
        <StatCard label="Portfolio Beta" value={fmt.num(portBeta)} icon={Shield} />
        <StatCard label="Tracking Error" value={fmt.pct(te)} icon={Activity} />
        <StatCard label="Daily VaR 95%" value={fmt.pct(dVar95)} icon={AlertTriangle} />
        <StatCard label="Holdings" value={computedHoldings.length} icon={Briefcase} />
        <StatCard label="Themes" value={themes.length} icon={BarChart3} />
        <StatCard label="Stop-Loss Alerts" value={stopAlerts} color={stopAlerts > 0 ? "text-amber-600" : "text-emerald-600"} icon={AlertCircle} />
        <StatCard label="Ann. Volatility" value={fmt.pct(settings.portfolioVol)} icon={Activity} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Theme Allocation</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={themeAllocation} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2} dataKey="value" label={({ name, value }) => `${name} ${fmt.pct(value, 1)}`} labelLine={false}>
                {themeAllocation.map((e, i) => <Cell key={i} fill={e.fill} />)}
              </Pie>
              <Tooltip content={<CustomTooltip formatter={v => fmt.pct(v)} />} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Top Holdings by Weight</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={topHoldings} layout="vertical" margin={{ left: 50 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tickFormatter={v => fmt.pct(v, 1)} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="ticker" tick={{ fontSize: 11 }} width={45} />
              <Tooltip content={<CustomTooltip formatter={v => fmt.pct(v)} />} />
              <Bar dataKey="weight" fill="#1e3a5f" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Portfolio vs Benchmark (Cumulative)</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={cumulativeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => fmt.pct(v, 1)} tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip formatter={v => fmt.pct(v)} />} />
              <Legend />
              <Line type="monotone" dataKey="portfolio" stroke="#1e3a5f" strokeWidth={2} name="Portfolio" dot={{ r: 3 }} />
              <Line type="monotone" dataKey="benchmark" stroke="#94a3b8" strokeWidth={2} name="Benchmark" strokeDasharray="5 5" dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">PnL by Holding</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={pnlByHolding}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="ticker" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip formatter={v => fmt.usd(v)} />} />
              <Bar dataKey="pnlDollar" name="PnL $" radius={[4, 4, 0, 0]}>
                {pnlByHolding.map((e, i) => <Cell key={i} fill={e.pnlDollar >= 0 ? "#059669" : "#dc2626"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Risk Contribution by Theme</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={riskByTheme}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => fmt.pct(v, 0)} tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip formatter={v => fmt.pct(v)} />} />
              <Bar dataKey="value" name="Risk Contribution" radius={[4, 4, 0, 0]}>
                {riskByTheme.map((e, i) => <Cell key={i} fill={e.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Return Attribution (Cumulative)</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={waterfallData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => fmt.pct(v, 1)} tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip formatter={v => fmt.pct(v)} />} />
              <Bar dataKey="value" name="Contribution" radius={[4, 4, 0, 0]}>
                {waterfallData.map((e, i) => <Cell key={i} fill={e.value >= 0 ? "#1e3a5f" : "#dc2626"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Stop-Loss Alert Summary</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200">
              {["Ticker", "Theme", "Price", "Stop Price", "Distance", "Status"].map(h => <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-slate-500 uppercase">{h}</th>)}
            </tr></thead>
            <tbody>
              {computedHoldings.map(h => {
                const slPrice = calc.stopLossPrice(h.buyPrice, h.stopLossPct);
                const dist = (h.currentPrice - slPrice) / h.currentPrice;
                const status = h.currentPrice <= slPrice ? "BREACH" : dist < settings.stopLossWarningBuffer ? "WARNING" : "OK";
                return (
                  <tr key={h.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-3 font-semibold">{h.ticker}</td>
                    <td className="py-2 px-3 text-slate-600">{h.theme}</td>
                    <td className="py-2 px-3">{fmt.usdExact(h.currentPrice)}</td>
                    <td className="py-2 px-3">{fmt.usdExact(slPrice)}</td>
                    <td className="py-2 px-3">{fmt.pct(dist)}</td>
                    <td className="py-2 px-3"><Badge status={status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════
// HOLDINGS PAGE
// ═══════════════════════════════════════════════

function HoldingsPage({ holdings, setHoldings, settings }) {
  const [search, setSearch] = useState("");
  const [themeFilter, setThemeFilter] = useState("All");
  const [sortKey, setSortKey] = useState("ticker");
  const [sortDir, setSortDir] = useState(1);
  const [editingId, setEditingId] = useState(null);

  const themes = ["All", ...new Set(holdings.map(h => h.theme))];
  const totalVal = holdings.filter(h => h.status === "active").reduce((s, h) => s + h.shares * h.currentPrice, 0);

  const computed = useMemo(() => {
    let filtered = holdings.map(h => {
      const posVal = calc.positionValue(h.shares, h.currentPrice);
      const weight = h.status === "active" ? calc.portfolioWeight(posVal, totalVal) : 0;
      return { ...h, positionValue: posVal, weight, pnlPercent: calc.pnlPercent(h.currentPrice, h.buyPrice), pnlDollar: calc.pnlDollar(h.currentPrice, h.buyPrice, h.shares), activeWeight: weight - (h.benchmarkWeight || 0) };
    });
    if (themeFilter !== "All") filtered = filtered.filter(h => h.theme === themeFilter);
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(h => h.ticker.toLowerCase().includes(s) || h.company.toLowerCase().includes(s));
    }
    filtered.sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      if (typeof va === "string") return va.localeCompare(vb) * sortDir;
      return ((va || 0) - (vb || 0)) * sortDir;
    });
    return filtered;
  }, [holdings, themeFilter, search, sortKey, sortDir, totalVal]);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(-sortDir);
    else { setSortKey(key); setSortDir(1); }
  };

  const updateHolding = (id, field, value) => {
    setHoldings(holdings.map(h => h.id === id ? { ...h, [field]: value } : h));
  };

  const addHolding = () => {
    const newId = String(Date.now());
    setHoldings([...holdings, { id: newId, ticker: "NEW", company: "New Holding", theme: "Core", subTheme: "", buyPrice: 100, currentPrice: 100, entryDate: new Date().toISOString().split("T")[0], exitDate: "", shares: 10, benchmarkWeight: 0, stopLossPct: 0.10, status: "active", notes: "", marketBeta: 1.0, valueBeta: 0, momentumBeta: 0, weeklyReturn: 0 }]);
    setEditingId(newId);
  };

  const deleteHolding = (id) => setHoldings(holdings.filter(h => h.id !== id));

  const columns = [
    { key: "ticker", label: "Ticker", w: "w-20" },
    { key: "company", label: "Company", w: "w-36" },
    { key: "theme", label: "Theme", w: "w-28" },
    { key: "status", label: "Status", w: "w-20" },
    { key: "buyPrice", label: "Buy", w: "w-20", fmt: v => fmt.usdExact(v) },
    { key: "currentPrice", label: "Current", w: "w-20", fmt: v => fmt.usdExact(v) },
    { key: "shares", label: "Shares", w: "w-16" },
    { key: "positionValue", label: "Value", w: "w-24", fmt: v => fmt.usd(v) },
    { key: "weight", label: "Weight", w: "w-18", fmt: v => fmt.pct(v, 1) },
    { key: "benchmarkWeight", label: "Bench Wt", w: "w-18", fmt: v => fmt.pct(v, 1) },
    { key: "activeWeight", label: "Active Wt", w: "w-18", fmt: v => fmt.pct(v, 1) },
    { key: "pnlPercent", label: "PnL %", w: "w-18", fmt: v => fmt.pct(v) },
    { key: "pnlDollar", label: "PnL $", w: "w-22", fmt: v => fmt.usd(v) },
    { key: "stopLossPct", label: "SL %", w: "w-16", fmt: v => fmt.pct(v, 0) },
    { key: "marketBeta", label: "Beta", w: "w-14", fmt: v => fmt.num(v) },
  ];

  const editableFields = ["ticker", "company", "theme", "subTheme", "buyPrice", "currentPrice", "shares", "benchmarkWeight", "stopLossPct", "marketBeta", "valueBeta", "momentumBeta", "weeklyReturn", "status", "entryDate", "exitDate", "notes"];
  const numericFields = ["buyPrice", "currentPrice", "shares", "benchmarkWeight", "stopLossPct", "marketBeta", "valueBeta", "momentumBeta", "weeklyReturn"];

  return (
    <div className="space-y-4">
      <SectionHeader title="Portfolio Holdings" subtitle={`${computed.length} positions · ${fmt.usd(totalVal)} total value`}>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-2.5 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ticker..." className="pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-md w-40 focus:outline-none focus:ring-1 focus:ring-slate-400" />
          </div>
          <Select value={themeFilter} onChange={setThemeFilter} options={themes} />
          <button onClick={addHolding} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-slate-800 text-white rounded-md hover:bg-slate-700"><Plus size={14} /> Add</button>
        </div>
      </SectionHeader>

      <Card className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="py-2.5 px-2 text-left w-8"></th>
              {columns.map(c => (
                <th key={c.key} className={`py-2.5 px-2 text-left font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700 ${c.w}`} onClick={() => handleSort(c.key)}>
                  {c.label} {sortKey === c.key ? (sortDir === 1 ? "↑" : "↓") : ""}
                </th>
              ))}
              <th className="py-2.5 px-2 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {computed.map(h => (
              <tr key={h.id} className={`border-b border-slate-100 hover:bg-blue-50/30 ${editingId === h.id ? "bg-blue-50/50" : ""}`}>
                <td className="py-1.5 px-2">
                  <button onClick={() => setEditingId(editingId === h.id ? null : h.id)} className="text-slate-400 hover:text-slate-600">
                    {editingId === h.id ? <Check size={13} /> : <Edit3 size={13} />}
                  </button>
                </td>
                {columns.map(c => (
                  <td key={c.key} className="py-1.5 px-2">
                    {editingId === h.id && editableFields.includes(c.key) ? (
                      c.key === "status" ?
                        <Select value={h[c.key]} onChange={v => updateHolding(h.id, c.key, v)} options={["active", "exited", "watchlist"]} className="text-xs py-1" /> :
                        <input type={numericFields.includes(c.key) ? "number" : "text"} value={h[c.key] ?? ""} onChange={e => updateHolding(h.id, c.key, numericFields.includes(c.key) ? parseFloat(e.target.value) || 0 : e.target.value)} className="w-full px-1 py-0.5 text-xs border border-slate-300 rounded bg-white" step="any" />
                    ) : (
                      c.key === "status" ? <Badge status={h[c.key]} small /> :
                      c.key === "pnlPercent" || c.key === "pnlDollar" || c.key === "activeWeight" ?
                        <span className={h[c.key] >= 0 ? "text-emerald-600 font-medium" : "text-red-500 font-medium"}>{c.fmt ? c.fmt(h[c.key]) : h[c.key]}</span> :
                        <span className={c.key === "ticker" ? "font-semibold text-slate-800" : "text-slate-600"}>{c.fmt ? c.fmt(h[c.key]) : h[c.key]}</span>
                    )}
                  </td>
                ))}
                <td className="py-1.5 px-2">
                  <button onClick={() => deleteHolding(h.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════
// RETURNS PAGE
// ═══════════════════════════════════════════════

function ReturnsPage({ holdings, settings, weeklyHistory, setWeeklyHistory }) {
  const activeHoldings = holdings.filter(h => h.status === "active");
  const totalVal = activeHoldings.reduce((s, h) => s + h.shares * h.currentPrice, 0);
  
  const computedHoldings = activeHoldings.map(h => {
    const posVal = h.shares * h.currentPrice;
    const weight = totalVal > 0 ? posVal / totalVal : 0;
    return { ...h, weight, positionValue: posVal };
  });

  const themes = [...new Set(computedHoldings.map(h => h.theme))];

  // Basket-level attribution
  const basketAttribution = themes.map(t => {
    const basket = computedHoldings.filter(h => h.theme === t);
    const basketWeight = basket.reduce((s, h) => s + h.weight, 0);
    const basketReturn = basketWeight > 0 ? basket.reduce((s, h) => s + h.weight * h.weeklyReturn, 0) / basketWeight : 0;
    const marketExp = basketWeight > 0 ? basket.reduce((s, h) => s + h.weight * h.marketBeta, 0) / basketWeight : 0;
    const valueExp = basketWeight > 0 ? basket.reduce((s, h) => s + h.weight * h.valueBeta, 0) / basketWeight : 0;
    const momExp = basketWeight > 0 ? basket.reduce((s, h) => s + h.weight * h.momentumBeta, 0) / basketWeight : 0;
    const marketContrib = marketExp * settings.spyWeeklyReturn;
    const valueContrib = valueExp * settings.iveWeeklyReturn;
    const momContrib = momExp * settings.mtumWeeklyReturn;
    const alpha = basketReturn - (marketContrib + valueContrib + momContrib);
    return { theme: t, basketWeight, basketReturn, marketExp, valueExp, momExp, marketContrib, valueContrib, momContrib, alpha };
  });

  // Portfolio-level
  const portReturn = computedHoldings.reduce((s, h) => s + h.weight * h.weeklyReturn, 0);
  const portMarketExp = computedHoldings.reduce((s, h) => s + h.weight * h.marketBeta, 0);
  const portValueExp = computedHoldings.reduce((s, h) => s + h.weight * h.valueBeta, 0);
  const portMomExp = computedHoldings.reduce((s, h) => s + h.weight * h.momentumBeta, 0);
  const portMarketContrib = portMarketExp * settings.spyWeeklyReturn;
  const portValueContrib = portValueExp * settings.iveWeeklyReturn;
  const portMomContrib = portMomExp * settings.mtumWeeklyReturn;
  const portAlpha = portReturn - (portMarketContrib + portValueContrib + portMomContrib);
  const excessReturn = portReturn - settings.spyWeeklyReturn;

  const cumulativeData = weeklyHistory.map((w, i) => ({
    week: w.week,
    portfolio: weeklyHistory.slice(0, i + 1).reduce((s, x) => s + x.portfolioReturn, 0),
    benchmark: weeklyHistory.slice(0, i + 1).reduce((s, x) => s + x.benchmarkReturn, 0),
  }));

  const bestPerformers = [...computedHoldings].sort((a, b) => b.weeklyReturn - a.weeklyReturn).slice(0, 5);
  const worstPerformers = [...computedHoldings].sort((a, b) => a.weeklyReturn - b.weeklyReturn).slice(0, 5);

  const waterfallData = [
    { name: "Market", value: portMarketContrib, fill: "#1e3a5f" },
    { name: "Value", value: portValueContrib, fill: "#2563eb" },
    { name: "Momentum", value: portMomContrib, fill: "#7c3aed" },
    { name: "Alpha", value: portAlpha, fill: portAlpha >= 0 ? "#059669" : "#dc2626" },
  ];

  const basketChartData = basketAttribution.map((b, i) => ({
    name: b.theme,
    return: b.basketReturn,
    weight: b.basketWeight,
    fill: getThemeColor(b.theme, i),
  }));

  // Auto-commentary
  const topTheme = basketAttribution.sort((a, b) => b.basketReturn * b.basketWeight - a.basketReturn * a.basketWeight)[0];
  const lagTheme = basketAttribution.sort((a, b) => a.basketReturn * a.basketWeight - b.basketReturn * b.basketWeight)[0];
  const commentary = `Portfolio returned ${fmt.pct(portReturn)} this week vs benchmark ${fmt.pct(settings.spyWeeklyReturn)}, generating ${fmt.pct(excessReturn)} excess return. Performance was ${Math.abs(portMarketContrib) > Math.abs(portAlpha) ? "primarily driven by market beta exposure" : "driven by stock selection (alpha)"}. ${topTheme ? `${topTheme.theme} was the top contributing theme at ${fmt.pct(topTheme.basketReturn)} return.` : ""} ${lagTheme && lagTheme.theme !== topTheme?.theme ? `${lagTheme.theme} lagged with ${fmt.pct(lagTheme.basketReturn)} return.` : ""} Factor contributions: Market ${fmt.pct(portMarketContrib)}, Value ${fmt.pct(portValueContrib)}, Momentum ${fmt.pct(portMomContrib)}. Portfolio alpha was ${fmt.pct(portAlpha)}.`;

  return (
    <div className="space-y-6">
      <SectionHeader title="Return Attribution" subtitle="Weekly decomposition: Market · Value · Momentum · Alpha" />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard label="Portfolio Return" value={fmt.pct(portReturn)} trend={portReturn >= 0 ? "up" : "down"} color={portReturn >= 0 ? "text-emerald-700" : "text-red-600"} />
        <StatCard label="Benchmark Return" value={fmt.pct(settings.spyWeeklyReturn)} />
        <StatCard label="Excess Return" value={fmt.pct(excessReturn)} trend={excessReturn >= 0 ? "up" : "down"} color={excessReturn >= 0 ? "text-emerald-700" : "text-red-600"} />
        <StatCard label="Market Contrib" value={fmt.pct(portMarketContrib)} />
        <StatCard label="Value Contrib" value={fmt.pct(portValueContrib)} />
        <StatCard label="Alpha" value={fmt.pct(portAlpha)} trend={portAlpha >= 0 ? "up" : "down"} color={portAlpha >= 0 ? "text-emerald-700" : "text-red-600"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Cumulative Return vs Benchmark</h3>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={cumulativeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => fmt.pct(v, 1)} tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip formatter={v => fmt.pct(v)} />} />
              <Legend />
              <Area type="monotone" dataKey="portfolio" fill="#1e3a5f" fillOpacity={0.08} stroke="#1e3a5f" strokeWidth={2} name="Portfolio" />
              <Line type="monotone" dataKey="benchmark" stroke="#94a3b8" strokeWidth={2} name="Benchmark" strokeDasharray="5 5" dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Factor Contribution Waterfall</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={waterfallData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => fmt.pct(v, 2)} tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip formatter={v => fmt.pct(v)} />} />
              <Bar dataKey="value" name="Contribution" radius={[4, 4, 0, 0]}>
                {waterfallData.map((e, i) => <Cell key={i} fill={e.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Weekly Attribution (Stacked)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={weeklyHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => fmt.pct(v, 1)} tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip formatter={v => fmt.pct(v)} />} />
              <Legend />
              <Bar dataKey="marketContrib" stackId="a" fill="#1e3a5f" name="Market" />
              <Bar dataKey="valueContrib" stackId="a" fill="#2563eb" name="Value" />
              <Bar dataKey="momentumContrib" stackId="a" fill="#7c3aed" name="Momentum" />
              <Bar dataKey="alpha" stackId="a" fill="#059669" name="Alpha" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Basket/Theme Returns</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={basketChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => fmt.pct(v, 1)} tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip formatter={v => fmt.pct(v)} />} />
              <Bar dataKey="return" name="Basket Return" radius={[4, 4, 0, 0]}>
                {basketChartData.map((e, i) => <Cell key={i} fill={e.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Basket Attribution Table */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Basket-Level Attribution</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-50 border-b border-slate-200">
              {["Theme", "Weight", "Return", "Mkt Exp", "Val Exp", "Mom Exp", "Mkt Contrib", "Val Contrib", "Mom Contrib", "Alpha"].map(h => <th key={h} className="py-2 px-3 text-left font-semibold text-slate-500 uppercase">{h}</th>)}
            </tr></thead>
            <tbody>
              {basketAttribution.map(b => (
                <tr key={b.theme} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2 px-3 font-semibold text-slate-700">{b.theme}</td>
                  <td className="py-2 px-3">{fmt.pct(b.basketWeight, 1)}</td>
                  <td className={`py-2 px-3 font-medium ${b.basketReturn >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(b.basketReturn)}</td>
                  <td className="py-2 px-3">{fmt.num(b.marketExp)}</td>
                  <td className="py-2 px-3">{fmt.num(b.valueExp)}</td>
                  <td className="py-2 px-3">{fmt.num(b.momExp)}</td>
                  <td className="py-2 px-3">{fmt.pct(b.marketContrib)}</td>
                  <td className="py-2 px-3">{fmt.pct(b.valueContrib)}</td>
                  <td className="py-2 px-3">{fmt.pct(b.momContrib)}</td>
                  <td className={`py-2 px-3 font-medium ${b.alpha >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(b.alpha)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                <td className="py-2 px-3">Portfolio Total</td>
                <td className="py-2 px-3">100.0%</td>
                <td className={`py-2 px-3 ${portReturn >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(portReturn)}</td>
                <td className="py-2 px-3">{fmt.num(portMarketExp)}</td>
                <td className="py-2 px-3">{fmt.num(portValueExp)}</td>
                <td className="py-2 px-3">{fmt.num(portMomExp)}</td>
                <td className="py-2 px-3">{fmt.pct(portMarketContrib)}</td>
                <td className="py-2 px-3">{fmt.pct(portValueContrib)}</td>
                <td className="py-2 px-3">{fmt.pct(portMomContrib)}</td>
                <td className={`py-2 px-3 ${portAlpha >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(portAlpha)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Best/Worst */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-emerald-700 mb-3">Top Performers</h3>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-200">
              {["Ticker", "Theme", "Weight", "Return"].map(h => <th key={h} className="py-2 px-3 text-left font-semibold text-slate-500">{h}</th>)}
            </tr></thead>
            <tbody>{bestPerformers.map(h => (
              <tr key={h.id} className="border-b border-slate-100">
                <td className="py-1.5 px-3 font-semibold">{h.ticker}</td>
                <td className="py-1.5 px-3 text-slate-600">{h.theme}</td>
                <td className="py-1.5 px-3">{fmt.pct(h.weight, 1)}</td>
                <td className="py-1.5 px-3 text-emerald-600 font-medium">{fmt.pct(h.weeklyReturn)}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-red-600 mb-3">Bottom Performers</h3>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-200">
              {["Ticker", "Theme", "Weight", "Return"].map(h => <th key={h} className="py-2 px-3 text-left font-semibold text-slate-500">{h}</th>)}
            </tr></thead>
            <tbody>{worstPerformers.map(h => (
              <tr key={h.id} className="border-b border-slate-100">
                <td className="py-1.5 px-3 font-semibold">{h.ticker}</td>
                <td className="py-1.5 px-3 text-slate-600">{h.theme}</td>
                <td className="py-1.5 px-3">{fmt.pct(h.weight, 1)}</td>
                <td className={`py-1.5 px-3 font-medium ${h.weeklyReturn >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(h.weeklyReturn)}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      </div>

      {/* Commentary */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Weekly Commentary (Auto-Generated)</h3>
        <p className="text-sm text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200">{commentary}</p>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════
// RISK PAGE
// ═══════════════════════════════════════════════

function RiskPage({ holdings, settings, setSettings }) {
  const activeHoldings = holdings.filter(h => h.status === "active");
  const totalVal = activeHoldings.reduce((s, h) => s + h.shares * h.currentPrice, 0);
  const computedHoldings = activeHoldings.map(h => {
    const posVal = h.shares * h.currentPrice;
    const weight = totalVal > 0 ? posVal / totalVal : 0;
    return { ...h, weight, positionValue: posVal };
  });

  const portBeta = calc.portfolioBeta(computedHoldings);
  const stockOnlyBeta = (() => {
    const nonSpy = computedHoldings.filter(h => h.ticker !== "SPY");
    const nonSpyTotalW = nonSpy.reduce((s, h) => s + h.weight, 0);
    return nonSpyTotalW > 0 ? nonSpy.reduce((s, h) => s + (h.weight / nonSpyTotalW) * h.marketBeta, 0) : 0;
  })();

  const sysVol = calc.systematicVol(portBeta, settings.benchmarkVol);
  const idioVol = calc.idiosyncraticVol(settings.portfolioVol, sysVol);
  const te = calc.trackingError(portBeta, settings.benchmarkVol, idioVol);
  const dVaR95 = calc.dailyVaR95(settings.portfolioVol);
  const dVaR99 = calc.dailyVaR99(settings.portfolioVol);
  const wVaR95 = calc.weeklyVaR95(settings.portfolioVol);
  const wVaR99 = calc.weeklyVaR99(settings.portfolioVol);
  const volRatio = settings.benchmarkVol > 0 ? settings.portfolioVol / settings.benchmarkVol : 0;

  const themes = [...new Set(computedHoldings.map(h => h.theme))];
  const themeRisk = themes.map((t, i) => {
    const themeH = computedHoldings.filter(h => h.theme === t);
    const tWeight = themeH.reduce((s, h) => s + h.weight, 0);
    const tBeta = tWeight > 0 ? themeH.reduce((s, h) => s + h.weight * h.marketBeta, 0) / tWeight : 0;
    const tWeightedBeta = themeH.reduce((s, h) => s + h.weight * h.marketBeta, 0);
    const rc = portBeta > 0 ? tWeightedBeta / portBeta : 0;
    return { theme: t, weight: tWeight, avgBeta: tBeta, weightedBeta: tWeightedBeta, riskContrib: rc, fill: getThemeColor(t, i) };
  });

  const maxStockWeight = Math.max(...computedHoldings.map(h => h.weight));
  const spyWeight = computedHoldings.find(h => h.ticker === "SPY")?.weight || 0;

  const complianceChecks = [
    { metric: "Daily VaR 95%", current: dVaR95, limit: settings.limits.dailyVaR95 },
    { metric: "Tracking Error", current: te, limit: settings.limits.trackingError },
    { metric: "Beta Deviation", current: Math.abs(portBeta - 1), limit: settings.limits.betaDeviation },
    { metric: "Systematic Vol", current: sysVol, limit: settings.limits.systematicVol },
    { metric: "Max Stock Weight", current: maxStockWeight, limit: settings.limits.maxStockWeight },
    { metric: "SPY Weight", current: spyWeight, limit: settings.limits.spyWeight },
  ].map(c => ({ ...c, utilization: calc.utilization(c.current, c.limit), status: calc.complianceStatus(c.current, c.limit), headroom: c.limit - c.current }));

  const scatterData = computedHoldings.map(h => ({ ticker: h.ticker, weight: h.weight, beta: h.marketBeta, theme: h.theme }));

  const volSplitData = [
    { name: "Systematic", value: sysVol, fill: "#1e3a5f" },
    { name: "Idiosyncratic", value: idioVol, fill: "#94a3b8" },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader title="Risk Analytics" subtitle="Portfolio risk decomposition, VaR, and compliance monitoring" />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard label="Portfolio Beta" value={fmt.num(portBeta)} icon={Shield} />
        <StatCard label="Stock-Only Beta" value={fmt.num(stockOnlyBeta)} />
        <StatCard label="Tracking Error" value={fmt.pct(te)} icon={Activity} />
        <StatCard label="Daily VaR 95%" value={fmt.pct(dVaR95)} icon={AlertTriangle} />
        <StatCard label="Daily VaR 99%" value={fmt.pct(dVaR99)} />
        <StatCard label="Weekly VaR 95%" value={fmt.pct(wVaR95)} />
        <StatCard label="Weekly VaR 99%" value={fmt.pct(wVaR99)} />
        <StatCard label="Ann. Volatility" value={fmt.pct(settings.portfolioVol)} />
        <StatCard label="Systematic Vol" value={fmt.pct(sysVol)} />
        <StatCard label="Idiosyncratic Vol" value={fmt.pct(idioVol)} />
        <StatCard label="Vol Ratio" value={fmt.num(volRatio)} />
        <StatCard label="SPY Weight" value={fmt.pct(spyWeight)} />
      </div>

      {/* Compliance Dashboard */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Compliance Dashboard</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b border-slate-200">
              {["Metric", "Current", "Limit", "Headroom", "Utilization", "Status"].map(h => <th key={h} className="py-2.5 px-3 text-left text-xs font-semibold text-slate-500 uppercase">{h}</th>)}
            </tr></thead>
            <tbody>
              {complianceChecks.map(c => (
                <tr key={c.metric} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2.5 px-3 font-semibold text-slate-700">{c.metric}</td>
                  <td className="py-2.5 px-3">{fmt.pct(c.current)}</td>
                  <td className="py-2.5 px-3 text-slate-500">{fmt.pct(c.limit)}</td>
                  <td className="py-2.5 px-3">{fmt.pct(c.headroom)}</td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-100 rounded-full h-2 max-w-[120px]">
                        <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(c.utilization * 100, 100)}%`, backgroundColor: statusBg(c.status) }} />
                      </div>
                      <span className="text-xs font-medium">{fmt.pct(c.utilization, 0)}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3"><Badge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Risk Contribution by Theme</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={themeRisk}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="theme" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => fmt.pct(v, 0)} tick={{ fontSize: 11 }} />
              <Tooltip content={<CustomTooltip formatter={v => fmt.pct(v)} />} />
              <Bar dataKey="riskContrib" name="Risk Contribution" radius={[4, 4, 0, 0]}>
                {themeRisk.map((e, i) => <Cell key={i} fill={e.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Systematic vs Idiosyncratic Risk</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={volSplitData} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={3} dataKey="value" label={({ name, value }) => `${name}: ${fmt.pct(value, 1)}`}>
                {volSplitData.map((e, i) => <Cell key={i} fill={e.fill} />)}
              </Pie>
              <Tooltip content={<CustomTooltip formatter={v => fmt.pct(v)} />} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Weight vs Beta (by Holding)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="weight" name="Weight" tickFormatter={v => fmt.pct(v, 0)} tick={{ fontSize: 11 }} />
              <YAxis dataKey="beta" name="Beta" tick={{ fontSize: 11 }} />
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload;
                return <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-2 text-xs">
                  <p className="font-semibold">{d.ticker}</p>
                  <p>Weight: {fmt.pct(d.weight)}</p>
                  <p>Beta: {fmt.num(d.beta)}</p>
                  <p className="text-slate-500">{d.theme}</p>
                </div>;
              }} />
              <Scatter data={scatterData} fill="#1e3a5f">
                {scatterData.map((e, i) => <Cell key={i} fill={getThemeColor(e.theme, i)} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Theme Risk Profile</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-slate-200">
                {["Theme", "Weight", "Avg Beta", "Wtd Beta", "Risk Contrib"].map(h => <th key={h} className="py-2 px-2 text-left font-semibold text-slate-500">{h}</th>)}
              </tr></thead>
              <tbody>
                {themeRisk.map(t => (
                  <tr key={t.theme} className="border-b border-slate-100">
                    <td className="py-1.5 px-2 font-semibold">{t.theme}</td>
                    <td className="py-1.5 px-2">{fmt.pct(t.weight, 1)}</td>
                    <td className="py-1.5 px-2">{fmt.num(t.avgBeta)}</td>
                    <td className="py-1.5 px-2">{fmt.num(t.weightedBeta, 3)}</td>
                    <td className="py-1.5 px-2">{fmt.pct(t.riskContrib, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Editable Risk Parameters */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Risk Parameters (Editable)</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Benchmark Vol", key: "benchmarkVol" },
            { label: "Portfolio Vol", key: "portfolioVol" },
            { label: "VaR 95% Limit", key: "limits.dailyVaR95" },
            { label: "TE Limit", key: "limits.trackingError" },
            { label: "Beta Dev Limit", key: "limits.betaDeviation" },
            { label: "Sys Vol Limit", key: "limits.systematicVol" },
            { label: "Max Stock Wt Limit", key: "limits.maxStockWeight" },
            { label: "SPY Wt Limit", key: "limits.spyWeight" },
          ].map(p => {
            const isNested = p.key.includes(".");
            const val = isNested ? settings.limits[p.key.split(".")[1]] : settings[p.key];
            const onChange = (v) => {
              if (isNested) {
                const lk = p.key.split(".")[1];
                setSettings({ ...settings, limits: { ...settings.limits, [lk]: v } });
              } else {
                setSettings({ ...settings, [p.key]: v });
              }
            };
            return (
              <div key={p.key}>
                <label className="text-xs text-slate-500 font-medium">{p.label}</label>
                <Input type="number" value={val} onChange={onChange} step="0.01" className="mt-1" />
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════
// STOP-LOSS PAGE
// ═══════════════════════════════════════════════

function StopLossPage({ holdings, settings }) {
  const [filter, setFilter] = useState("all");
  const activeHoldings = holdings.filter(h => h.status === "active");

  const stopLossData = activeHoldings.map(h => {
    const slPrice = calc.stopLossPrice(h.buyPrice, h.stopLossPct);
    const distToSl = (h.currentPrice - slPrice) / h.currentPrice;
    const pnlPct = calc.pnlPercent(h.currentPrice, h.buyPrice);
    const status = h.currentPrice <= slPrice ? "BREACH" : distToSl < settings.stopLossWarningBuffer ? "WARNING" : "OK";
    const action = status === "BREACH" ? "EXIT IMMEDIATELY" : status === "WARNING" ? "MONITOR CLOSELY" : "HOLD";
    return { ...h, slPrice, distToSl, pnlPct, alertStatus: status, action };
  });

  const filtered = filter === "all" ? stopLossData :
    filter === "WARNING" ? stopLossData.filter(h => h.alertStatus === "WARNING") :
    filter === "BREACH" ? stopLossData.filter(h => h.alertStatus === "BREACH") :
    stopLossData.filter(h => h.theme === filter);

  const breachCount = stopLossData.filter(h => h.alertStatus === "BREACH").length;
  const warningCount = stopLossData.filter(h => h.alertStatus === "WARNING").length;
  const okCount = stopLossData.filter(h => h.alertStatus === "OK").length;
  const themes = [...new Set(activeHoldings.map(h => h.theme))];

  const scatterData = stopLossData.map(h => ({
    ticker: h.ticker,
    returnPct: h.pnlPct * 100,
    distToSl: h.distToSl * 100,
    status: h.alertStatus,
    theme: h.theme,
  }));

  return (
    <div className="space-y-6">
      <SectionHeader title="Stop-Loss Monitoring" subtitle="Position discipline and risk management alerts" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Breached" value={breachCount} color={breachCount > 0 ? "text-red-600" : "text-emerald-600"} icon={AlertCircle} />
        <StatCard label="Warning" value={warningCount} color={warningCount > 0 ? "text-amber-600" : "text-emerald-600"} icon={AlertTriangle} />
        <StatCard label="OK" value={okCount} color="text-emerald-600" icon={CheckCircle} />
        <StatCard label="Total Monitored" value={stopLossData.length} icon={Shield} />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {["all", "BREACH", "WARNING", ...themes].map(f => (
          <TabButton key={f} active={filter === f} onClick={() => setFilter(f)}>{f === "all" ? "All" : f}</TabButton>
        ))}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-50 border-b border-slate-200">
            {["Ticker", "Theme", "Buy Price", "Current", "SL %", "SL Price", "Distance", "PnL %", "Status", "Action"].map(h => <th key={h} className="py-2.5 px-3 text-left text-xs font-semibold text-slate-500 uppercase">{h}</th>)}
          </tr></thead>
          <tbody>
            {filtered.sort((a, b) => a.distToSl - b.distToSl).map(h => (
              <tr key={h.id} className={`border-b border-slate-100 hover:bg-slate-50 ${h.alertStatus === "BREACH" ? "bg-red-50/50" : h.alertStatus === "WARNING" ? "bg-amber-50/30" : ""}`}>
                <td className="py-2.5 px-3 font-semibold text-slate-800">{h.ticker}</td>
                <td className="py-2.5 px-3 text-slate-600">{h.theme}</td>
                <td className="py-2.5 px-3">{fmt.usdExact(h.buyPrice)}</td>
                <td className="py-2.5 px-3">{fmt.usdExact(h.currentPrice)}</td>
                <td className="py-2.5 px-3">{fmt.pct(h.stopLossPct, 0)}</td>
                <td className="py-2.5 px-3">{fmt.usdExact(h.slPrice)}</td>
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-100 rounded-full h-2 max-w-[80px]">
                      <div className="h-2 rounded-full" style={{ width: `${Math.max(0, Math.min(100, (1 - h.distToSl / 0.2) * 100))}%`, backgroundColor: statusBg(h.alertStatus) }} />
                    </div>
                    <span className="text-xs font-medium">{fmt.pct(h.distToSl, 1)}</span>
                  </div>
                </td>
                <td className={`py-2.5 px-3 font-medium ${h.pnlPct >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(h.pnlPct)}</td>
                <td className="py-2.5 px-3"><Badge status={h.alertStatus} /></td>
                <td className="py-2.5 px-3 text-xs font-medium" style={{ color: h.alertStatus === "BREACH" ? "#dc2626" : h.alertStatus === "WARNING" ? "#d97706" : "#64748b" }}>{h.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Return vs Distance to Stop-Loss</h3>
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="returnPct" name="Return %" tick={{ fontSize: 11 }} label={{ value: "Return %", position: "bottom", fontSize: 11 }} />
              <YAxis dataKey="distToSl" name="Distance %" tick={{ fontSize: 11 }} label={{ value: "Distance to SL %", angle: -90, position: "insideLeft", fontSize: 11 }} />
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload;
                return <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-2 text-xs">
                  <p className="font-semibold">{d.ticker}</p>
                  <p>Return: {d.returnPct.toFixed(1)}%</p>
                  <p>Distance: {d.distToSl.toFixed(1)}%</p>
                </div>;
              }} />
              <Scatter data={scatterData}>
                {scatterData.map((e, i) => <Cell key={i} fill={statusBg(e.status)} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Position Risk Gauge</h3>
          <div className="space-y-3 max-h-[280px] overflow-y-auto">
            {stopLossData.sort((a, b) => a.distToSl - b.distToSl).map(h => (
              <div key={h.id} className="flex items-center gap-3">
                <span className="text-xs font-semibold w-12 text-slate-700">{h.ticker}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-3">
                  <div className="h-3 rounded-full transition-all" style={{ width: `${Math.max(5, Math.min(100, (1 - h.distToSl / 0.25) * 100))}%`, backgroundColor: statusBg(h.alertStatus) }} />
                </div>
                <span className="text-xs font-medium w-14 text-right">{fmt.pct(h.distToSl, 1)}</span>
                <Badge status={h.alertStatus} small />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// REPORT PAGE
// ═══════════════════════════════════════════════

function ReportPage({ holdings, settings, weeklyHistory }) {
  const [generating, setGenerating] = useState(false);
  const reportRef = useRef(null);

  const activeHoldings = holdings.filter(h => h.status === "active");
  const totalVal = activeHoldings.reduce((s, h) => s + h.shares * h.currentPrice, 0);
  const computedHoldings = activeHoldings.map(h => {
    const posVal = h.shares * h.currentPrice;
    const weight = totalVal > 0 ? posVal / totalVal : 0;
    const pnlP = calc.pnlPercent(h.currentPrice, h.buyPrice);
    const pnlD = calc.pnlDollar(h.currentPrice, h.buyPrice, h.shares);
    return { ...h, positionValue: posVal, weight, pnlPercent: pnlP, pnlDollar: pnlD };
  });

  const totalPnl = computedHoldings.reduce((s, h) => s + h.pnlDollar, 0);
  const portBeta = calc.portfolioBeta(computedHoldings);
  const sysVol = calc.systematicVol(portBeta, settings.benchmarkVol);
  const idioVol = calc.idiosyncraticVol(settings.portfolioVol, sysVol);
  const te = calc.trackingError(portBeta, settings.benchmarkVol, idioVol);
  const dVaR95 = calc.dailyVaR95(settings.portfolioVol);
  const themes = [...new Set(computedHoldings.map(h => h.theme))];

  const handlePrint = () => {
    setGenerating(true);
    setTimeout(() => {
      window.print();
      setGenerating(false);
    }, 500);
  };

  return (
    <div className="space-y-6">
      <SectionHeader title="Report Generation" subtitle="One-click professional portfolio report">
        <button onClick={handlePrint} className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-md hover:bg-slate-700 text-sm font-medium">
          <Printer size={16} /> Print / Export PDF
        </button>
      </SectionHeader>

      <div ref={reportRef} className="print:block">
        {/* Cover */}
        <Card className="p-8 text-center mb-6 print:shadow-none print:border-0">
          <div className="border-b-2 border-slate-800 pb-6 mb-6">
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">NYU Stern Management Investment Fund</h1>
            <h2 className="text-lg text-slate-600 mt-1">Thematic Investment Team — Portfolio Report</h2>
            <p className="text-sm text-slate-500 mt-3">{new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
          </div>
        </Card>

        {/* Portfolio Overview */}
        <Card className="p-6 mb-4 print:shadow-none">
          <h3 className="text-base font-bold text-slate-800 border-b border-slate-200 pb-2 mb-4">Portfolio Overview</h3>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-4 text-center">
            {[
              { l: "Market Value", v: fmt.usd(totalVal) },
              { l: "Total PnL", v: fmt.usd(totalPnl) },
              { l: "Holdings", v: computedHoldings.length },
              { l: "Themes", v: themes.length },
              { l: "Portfolio Beta", v: fmt.num(portBeta) },
              { l: "Daily VaR 95%", v: fmt.pct(dVaR95) },
            ].map(s => (
              <div key={s.l}>
                <p className="text-xs text-slate-500">{s.l}</p>
                <p className="text-lg font-bold text-slate-800">{s.v}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* Holdings Summary */}
        <Card className="p-6 mb-4 print:shadow-none">
          <h3 className="text-base font-bold text-slate-800 border-b border-slate-200 pb-2 mb-4">Holdings Summary</h3>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-200">
              {["Ticker", "Company", "Theme", "Weight", "PnL %", "PnL $", "Beta"].map(h => <th key={h} className="py-2 px-2 text-left font-semibold text-slate-500">{h}</th>)}
            </tr></thead>
            <tbody>
              {computedHoldings.sort((a, b) => b.weight - a.weight).map(h => (
                <tr key={h.id} className="border-b border-slate-100">
                  <td className="py-1.5 px-2 font-semibold">{h.ticker}</td>
                  <td className="py-1.5 px-2 text-slate-600">{h.company}</td>
                  <td className="py-1.5 px-2">{h.theme}</td>
                  <td className="py-1.5 px-2">{fmt.pct(h.weight, 1)}</td>
                  <td className={`py-1.5 px-2 ${h.pnlPercent >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(h.pnlPercent)}</td>
                  <td className={`py-1.5 px-2 ${h.pnlDollar >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.usd(h.pnlDollar)}</td>
                  <td className="py-1.5 px-2">{fmt.num(h.marketBeta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Risk Summary */}
        <Card className="p-6 mb-4 print:shadow-none">
          <h3 className="text-base font-bold text-slate-800 border-b border-slate-200 pb-2 mb-4">Risk Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { l: "Portfolio Beta", v: fmt.num(portBeta) },
              { l: "Tracking Error", v: fmt.pct(te) },
              { l: "Systematic Vol", v: fmt.pct(sysVol) },
              { l: "Idiosyncratic Vol", v: fmt.pct(idioVol) },
              { l: "Daily VaR 95%", v: fmt.pct(dVaR95) },
              { l: "Weekly VaR 95%", v: fmt.pct(calc.weeklyVaR95(settings.portfolioVol)) },
              { l: "Ann. Volatility", v: fmt.pct(settings.portfolioVol) },
              { l: "Benchmark Vol", v: fmt.pct(settings.benchmarkVol) },
            ].map(s => (
              <div key={s.l} className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500">{s.l}</p>
                <p className="text-sm font-bold text-slate-800">{s.v}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* Stop-Loss Alerts */}
        <Card className="p-6 mb-4 print:shadow-none">
          <h3 className="text-base font-bold text-slate-800 border-b border-slate-200 pb-2 mb-4">Stop-Loss Alerts</h3>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-slate-200">
              {["Ticker", "Theme", "Current", "SL Price", "Distance", "Status"].map(h => <th key={h} className="py-2 px-2 text-left font-semibold text-slate-500">{h}</th>)}
            </tr></thead>
            <tbody>
              {computedHoldings.map(h => {
                const slP = calc.stopLossPrice(h.buyPrice, h.stopLossPct);
                const dist = (h.currentPrice - slP) / h.currentPrice;
                const status = h.currentPrice <= slP ? "BREACH" : dist < 0.03 ? "WARNING" : "OK";
                return (
                  <tr key={h.id} className="border-b border-slate-100">
                    <td className="py-1.5 px-2 font-semibold">{h.ticker}</td>
                    <td className="py-1.5 px-2">{h.theme}</td>
                    <td className="py-1.5 px-2">{fmt.usdExact(h.currentPrice)}</td>
                    <td className="py-1.5 px-2">{fmt.usdExact(slP)}</td>
                    <td className="py-1.5 px-2">{fmt.pct(dist, 1)}</td>
                    <td className="py-1.5 px-2"><Badge status={status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        {/* Methodology */}
        <Card className="p-6 print:shadow-none">
          <h3 className="text-base font-bold text-slate-800 border-b border-slate-200 pb-2 mb-4">Methodology & Assumptions</h3>
          <div className="text-xs text-slate-600 space-y-2 leading-relaxed">
            <p><strong>Portfolio Beta:</strong> β_p = Σ(w_i × β_i) — weighted sum of individual betas</p>
            <p><strong>Risk Contribution:</strong> RC_i = (w_i × β_i) / β_p</p>
            <p><strong>Systematic Vol:</strong> σ_sys = β_p × σ_benchmark</p>
            <p><strong>Idiosyncratic Vol:</strong> σ_idio = √(max(σ²_portfolio - σ²_systematic, 0))</p>
            <p><strong>Tracking Error:</strong> TE = √((β_p - 1)² × σ²_bench + σ²_idio)</p>
            <p><strong>Daily VaR 95%:</strong> σ_annual / √252 × 1.645</p>
            <p><strong>Weekly VaR:</strong> Daily VaR × √5</p>
            <p><strong>Return Attribution:</strong> Factor contribution = factor exposure × factor return; Alpha = total return - Σ(factor contributions)</p>
            <p><strong>Compliance:</strong> BREACH if current/limit {">"} 100%, WARNING if {">"} 85%, else OK</p>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// SETTINGS PAGE
// ═══════════════════════════════════════════════

function SettingsPage({ settings, setSettings, holdings, setHoldings, weeklyHistory, setWeeklyHistory }) {
  const [showMethodology, setShowMethodology] = useState(false);

  const handleExport = () => {
    const data = JSON.stringify({ holdings, settings, weeklyHistory }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "stern_portfolio_data.json"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json";
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target.result);
          if (parsed.holdings) setHoldings(parsed.holdings);
          if (parsed.settings) setSettings(parsed.settings);
          if (parsed.weeklyHistory) setWeeklyHistory(parsed.weeklyHistory);
        } catch (err) { alert("Invalid JSON file"); }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleReset = () => {
    if (confirm("Reset all data to sample defaults?")) {
      setHoldings(createSampleHoldings());
      setSettings(createSampleSettings());
      setWeeklyHistory(createWeeklyHistory());
    }
  };

  const handleCSVExport = () => {
    const headers = ["ticker", "company", "theme", "subTheme", "buyPrice", "currentPrice", "shares", "benchmarkWeight", "stopLossPct", "marketBeta", "valueBeta", "momentumBeta", "weeklyReturn", "status", "entryDate", "notes"];
    const csv = [headers.join(","), ...holdings.map(h => headers.map(k => `"${h[k] ?? ""}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "holdings.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <SectionHeader title="Settings & Assumptions" subtitle="Manage benchmark, factor inputs, and data persistence" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Benchmark Settings */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Benchmark & Factor Inputs</h3>
          <div className="space-y-3">
            {[
              { l: "Benchmark Ticker", k: "benchmarkTicker", type: "text" },
              { l: "Benchmark Name", k: "benchmarkName", type: "text" },
              { l: "SPY Weekly Return", k: "spyWeeklyReturn" },
              { l: "IVE Weekly Return", k: "iveWeeklyReturn" },
              { l: "MTUM Weekly Return", k: "mtumWeeklyReturn" },
              { l: "Benchmark Volatility", k: "benchmarkVol" },
              { l: "Portfolio Volatility", k: "portfolioVol" },
              { l: "Risk-Free Rate", k: "riskFreeRate" },
              { l: "SL Warning Buffer", k: "stopLossWarningBuffer" },
            ].map(p => (
              <div key={p.k} className="flex items-center gap-3">
                <label className="text-xs text-slate-500 font-medium w-40">{p.l}</label>
                <Input type={p.type || "number"} value={settings[p.k]} onChange={v => setSettings({ ...settings, [p.k]: v })} step="0.001" className="flex-1" />
              </div>
            ))}
          </div>
        </Card>

        {/* Compliance Limits */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Compliance Limits</h3>
          <div className="space-y-3">
            {Object.entries(settings.limits).map(([k, v]) => (
              <div key={k} className="flex items-center gap-3">
                <label className="text-xs text-slate-500 font-medium w-40 capitalize">{k.replace(/([A-Z])/g, " $1")}</label>
                <Input type="number" value={v} onChange={val => setSettings({ ...settings, limits: { ...settings.limits, [k]: val } })} step="0.01" className="flex-1" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Data Management */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Data Management</h3>
        <div className="flex flex-wrap gap-3">
          <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-md hover:bg-slate-700 text-sm"><Download size={14} /> Export JSON</button>
          <button onClick={handleImport} className="flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50 text-sm"><Upload size={14} /> Import JSON</button>
          <button onClick={handleCSVExport} className="flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50 text-sm"><Download size={14} /> Export CSV</button>
          <button onClick={handleReset} className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 rounded-md hover:bg-red-50 text-sm"><RefreshCw size={14} /> Reset to Sample Data</button>
        </div>
        <p className="text-xs text-slate-400 mt-3">Data is automatically saved and persists across sessions.</p>
      </Card>

      {/* Methodology */}
      <Card className="p-5">
        <button onClick={() => setShowMethodology(!showMethodology)} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          {showMethodology ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          Assumptions & Methodology
        </button>
        {showMethodology && (
          <div className="mt-4 text-xs text-slate-600 space-y-2 leading-relaxed bg-slate-50 p-4 rounded-lg">
            <p><strong>Position Value</strong> = shares × currentPrice</p>
            <p><strong>PnL $</strong> = (currentPrice − buyPrice) × shares</p>
            <p><strong>PnL %</strong> = (currentPrice − buyPrice) / buyPrice</p>
            <p><strong>Portfolio Weight</strong> = positionValue / totalPortfolioValue</p>
            <p><strong>Portfolio Return</strong> Rp = Σ(weight_i × return_i)</p>
            <p><strong>Active Return</strong> = portfolioReturn − benchmarkReturn</p>
            <p><strong>Factor Exposure</strong> β_basket = Σ(stock_weight_in_basket × stock_beta)</p>
            <p><strong>Factor Contribution</strong> = exposure × factorReturn</p>
            <p><strong>Alpha</strong> = return − Σ(factor contributions)</p>
            <p><strong>Portfolio Beta</strong> β_p = Σ(w_i × β_i)</p>
            <p><strong>Risk Contribution</strong> RC_i = (w_i × β_i) / β_p</p>
            <p><strong>Systematic Vol</strong> = β_p × benchmarkVol</p>
            <p><strong>Idiosyncratic Vol</strong> = √(max(portfolioVol² − systematicVol², 0))</p>
            <p><strong>Tracking Error</strong> = √((β_p − 1)² × benchmarkVol² + idioVol²)</p>
            <p><strong>Daily VaR 95%</strong> = annualVol / √252 × 1.645</p>
            <p><strong>Daily VaR 99%</strong> = annualVol / √252 × 2.326</p>
            <p><strong>Weekly VaR</strong> = dailyVaR × √5</p>
            <p><strong>Stop-Loss Price</strong> = buyPrice × (1 − stopLossPct)</p>
            <p><strong>Compliance</strong>: BREACH if current/limit {">"} 100%, WARNING if {">"} 85%, OK otherwise</p>
          </div>
        )}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: Home },
  { id: "holdings", label: "Holdings", icon: Briefcase },
  { id: "returns", label: "Returns", icon: TrendingUp },
  { id: "risk", label: "Risk", icon: Shield },
  { id: "stoploss", label: "Stop-Loss", icon: AlertTriangle },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "settings", label: "Settings", icon: Settings },
];

export default function App() {
  const [page, setPage] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [holdings, setHoldings, holdingsLoaded] = usePersistedState("stern-holdings", createSampleHoldings());
  const [settings, setSettings, settingsLoaded] = usePersistedState("stern-settings", createSampleSettings());
  const [weeklyHistory, setWeeklyHistory, historyLoaded] = usePersistedState("stern-weekly-history", createWeeklyHistory());

  const loaded = holdingsLoaded && settingsLoaded && historyLoaded;

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-sm text-slate-500">Loading portfolio data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 print:bg-white print:block" style={{ fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      `}</style>

      {/* Sidebar */}
      <div className={`no-print bg-white border-r border-slate-200 flex flex-col transition-all duration-200 ${sidebarOpen ? "w-52" : "w-14"}`}>
        <div className="p-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-slate-800 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-xs">S</span>
            </div>
            {sidebarOpen && (
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-800 truncate">NYU Stern MIF</p>
                <p className="text-[10px] text-slate-500">Thematic Team</p>
              </div>
            )}
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {NAV_ITEMS.map(item => (
            <button key={item.id} onClick={() => setPage(item.id)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all ${page === item.id ? "bg-slate-800 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}>
              <item.icon size={16} className="flex-shrink-0" />
              {sidebarOpen && <span className="font-medium truncate">{item.label}</span>}
            </button>
          ))}
        </nav>
        <div className="p-2 border-t border-slate-200">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="w-full flex items-center justify-center py-2 text-slate-400 hover:text-slate-600 text-xs">
            {sidebarOpen ? "← Collapse" : "→"}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="no-print bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-800">{NAV_ITEMS.find(n => n.id === page)?.label}</h1>
            <p className="text-xs text-slate-500">NYU Stern Management Investment Fund · Thematic Investment Team</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-xs text-slate-500">Auto-saved</span>
            </div>
            <span className="text-xs text-slate-400">{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-6 print:p-0">
          {page === "overview" && <OverviewPage holdings={holdings} settings={settings} weeklyHistory={weeklyHistory} />}
          {page === "holdings" && <HoldingsPage holdings={holdings} setHoldings={setHoldings} settings={settings} />}
          {page === "returns" && <ReturnsPage holdings={holdings} settings={settings} weeklyHistory={weeklyHistory} setWeeklyHistory={setWeeklyHistory} />}
          {page === "risk" && <RiskPage holdings={holdings} settings={settings} setSettings={setSettings} />}
          {page === "stoploss" && <StopLossPage holdings={holdings} settings={settings} />}
          {page === "reports" && <ReportPage holdings={holdings} settings={settings} weeklyHistory={weeklyHistory} />}
          {page === "settings" && <SettingsPage settings={settings} setSettings={setSettings} holdings={holdings} setHoldings={setHoldings} weeklyHistory={weeklyHistory} setWeeklyHistory={setWeeklyHistory} />}
        </main>
      </div>
    </div>
  );
}
