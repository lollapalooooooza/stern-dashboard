"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter, ComposedChart, Area } from "recharts";
import { TrendingUp, TrendingDown, DollarSign, BarChart3, Shield, AlertTriangle, FileText, Settings, Home, Briefcase, Activity, Target, ChevronDown, ChevronRight, Plus, Trash2, Search, Download, Upload, RefreshCw, Edit3, Check, AlertCircle, CheckCircle, Printer, Loader2 } from "lucide-react";

// ═══════════════════════════════════════════════
// FINANCIAL CALCULATION UTILITIES
// ═══════════════════════════════════════════════
const calc = {
  positionValue: (shares, price) => shares * price,
  pnlDollar: (current, buy, shares) => (current - buy) * shares,
  pnlPercent: (current, buy) => buy !== 0 ? (current - buy) / buy : 0,
  portfolioWeight: (posVal, totalVal) => totalVal !== 0 ? posVal / totalVal : 0,
  activeWeight: (portW, benchW) => portW - benchW,
  portfolioReturn: (holdings) => holdings.reduce((s, h) => s + (h.weight || 0) * (h.weeklyReturn || 0), 0),
  factorExposure: (holdings, key) => holdings.reduce((s, h) => s + (h.weight || 0) * (h[key] || 0), 0),
  factorContribution: (exp, ret) => exp * ret,
  alpha: (ret, contribs) => ret - contribs.reduce((s, c) => s + c, 0),
  portfolioBeta: (holdings) => holdings.reduce((s, h) => s + (h.weight || 0) * (h.marketBeta || 0), 0),
  riskContribution: (w, beta, pBeta) => pBeta !== 0 ? (w * beta) / pBeta : 0,
  systematicVol: (pBeta, bVol) => Math.abs(pBeta) * bVol,
  idiosyncraticVol: (pVol, sVol) => Math.sqrt(Math.max(pVol * pVol - sVol * sVol, 0)),
  trackingError: (pBeta, bVol, iVol) => Math.sqrt(Math.pow(pBeta - 1, 2) * bVol * bVol + iVol * iVol),
  dailyVaR95: (v) => (v / Math.sqrt(252)) * 1.645,
  dailyVaR99: (v) => (v / Math.sqrt(252)) * 2.326,
  weeklyVaR95: (v) => (v / Math.sqrt(252)) * 1.645 * Math.sqrt(5),
  weeklyVaR99: (v) => (v / Math.sqrt(252)) * 2.326 * Math.sqrt(5),
  complianceStatus: (cur, lim) => { const r = lim !== 0 ? cur / lim : 0; return r > 1.0 ? "BREACH" : r > 0.85 ? "WARNING" : "OK"; },
  utilization: (cur, lim) => lim !== 0 ? cur / lim : 0,
};

// ═══════════════════════════════════════════════
// FORMATTING HELPERS
// ═══════════════════════════════════════════════
const fmt = {
  pct: (v, d = 2) => v != null ? `${(v * 100).toFixed(d)}%` : "—",
  usd: (v) => v != null ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—",
  usdExact: (v) => v != null ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—",
  num: (v, d = 2) => v != null ? Number(v).toFixed(d) : "—",
  date: (d) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—",
  shares: (v) => v != null ? Number(v).toFixed(3) : "—",
};
const statusBg = (s) => s === "BREACH" ? "#ef4444" : s === "WARNING" ? "#f59e0b" : "#10b981";

// ═══════════════════════════════════════════════
// THEME COLORS
// ═══════════════════════════════════════════════
const THEME_COLORS = { "Benchmark": "#1e293b", "AI-Industrial": "#2563eb", "Digital Infra": "#7c3aed", "Experientials": "#0891b2", "Security": "#dc2626", "Silver Economy": "#ec4899", "Nuclear": "#d97706", "Payments": "#059669", "Waste": "#84cc16", "Battery": "#f97316", "Legacy Software": "#6366f1", "Adtech": "#14b8a6" };
const CHART_COLORS = ["#1e3a5f", "#2563eb", "#7c3aed", "#dc2626", "#059669", "#d97706", "#0891b2", "#ec4899", "#84cc16", "#f97316", "#6366f1", "#14b8a6"];
const getThemeColor = (theme, i) => THEME_COLORS[theme] || CHART_COLORS[i % CHART_COLORS.length];

// ═══════════════════════════════════════════════
// REAL PORTFOLIO DATA FROM EXCEL
// ═══════════════════════════════════════════════
const createSampleHoldings = () => [
  // === BENCHMARK ===
  { id:"b1", ticker:"^GSPC", company:"S&P 500 Index", theme:"Benchmark", subTheme:"Benchmark", buyPrice:100, currentPrice:100, entryDate:"2026-01-01", exitDate:"", shares:1, benchmarkWeight:0.4352, stopLossPct:0.0308, stopLossPrice:96.92, status:"active", notes:"Core benchmark allocation", marketBeta:1.0, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.007697, alphaAnn:0 },
  // === AI-INDUSTRIAL (active) ===
  { id:"1", ticker:"BABA", company:"Alibaba Group", theme:"AI-Industrial", subTheme:"AI Infra", buyPrice:156.90, currentPrice:156.90, entryDate:"2025-12-03", exitDate:"", shares:30, benchmarkWeight:0, stopLossPct:0.1109, stopLossPrice:88.91, status:"active", notes:"AI cloud + commerce", marketBeta:1.0311, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.027721, alphaAnn:-0.1053 },
  { id:"2", ticker:"BE", company:"Bloom Energy", theme:"AI-Industrial", subTheme:"AI Infra", buyPrice:100.02, currentPrice:100.02, entryDate:"2025-12-03", exitDate:"", shares:48, benchmarkWeight:0, stopLossPct:0.2674, stopLossPrice:73.26, status:"active", notes:"Fuel cells for data centers", marketBeta:2.0783, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.066838, alphaAnn:0.4091 },
  { id:"3", ticker:"CSIQ", company:"Canadian Solar", theme:"AI-Industrial", subTheme:"AI Infra", buyPrice:24.39, currentPrice:24.39, entryDate:"2025-12-03", exitDate:"", shares:197, benchmarkWeight:0, stopLossPct:0.1907, stopLossPrice:80.93, status:"active", notes:"Solar manufacturing", marketBeta:1.4982, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.047669, alphaAnn:-0.1325 },
  { id:"4", ticker:"GOOG", company:"Alphabet Inc", theme:"AI-Industrial", subTheme:"AI Infra", buyPrice:314.89, currentPrice:314.89, entryDate:"2025-12-03", exitDate:"", shares:15, benchmarkWeight:0, stopLossPct:0.0555, stopLossPrice:94.45, status:"active", notes:"AI/Cloud platform", marketBeta:1.2486, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.013869, alphaAnn:0.1053 },
  { id:"5", ticker:"IREN", company:"Iris Energy", theme:"AI-Industrial", subTheme:"AI Infra", buyPrice:42.18, currentPrice:42.18, entryDate:"2025-12-03", exitDate:"", shares:114, benchmarkWeight:0, stopLossPct:0.2963, stopLossPrice:70.37, status:"active", notes:"Bitcoin mining / AI data center", marketBeta:2.4774, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.074066, alphaAnn:0.5341 },
  { id:"6", ticker:"LITE", company:"Lumentum Holdings", theme:"AI-Industrial", subTheme:"AI Infra", buyPrice:289.04, currentPrice:289.04, entryDate:"2025-12-03", exitDate:"", shares:16, benchmarkWeight:0, stopLossPct:0.2574, stopLossPrice:74.26, status:"active", notes:"Photonics / optical networking", marketBeta:1.7228, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.064357, alphaAnn:0.3233 },
  { id:"7", ticker:"NBIS", company:"Nebius Group", theme:"AI-Industrial", subTheme:"AI Infra", buyPrice:93.06, currentPrice:93.06, entryDate:"2025-12-03", exitDate:"", shares:52, benchmarkWeight:0, stopLossPct:0.2542, stopLossPrice:74.58, status:"active", notes:"AI infrastructure", marketBeta:2.7506, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.063562, alphaAnn:1.382 },
  { id:"8", ticker:"NVDA", company:"NVIDIA Corp", theme:"AI-Industrial", subTheme:"AI Infra", buyPrice:179.87, currentPrice:179.87, entryDate:"2025-12-03", exitDate:"", shares:27, benchmarkWeight:0, stopLossPct:0.0942, stopLossPrice:90.58, status:"active", notes:"AI compute leader", marketBeta:2.1792, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.023562, alphaAnn:0.4031 },
  { id:"9", ticker:"RDDT", company:"Reddit Inc", theme:"AI-Industrial", subTheme:"AI Infra", buyPrice:220.47, currentPrice:220.47, entryDate:"2025-12-03", exitDate:"", shares:22, benchmarkWeight:0, stopLossPct:0.10, stopLossPrice:90.0, status:"active", notes:"Social platform + data licensing", marketBeta:1.5, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.03, alphaAnn:0 },
  { id:"10", ticker:"TSLA", company:"Tesla Inc", theme:"AI-Industrial", subTheme:"AI Infra", buyPrice:438.28, currentPrice:438.28, entryDate:"2025-12-03", exitDate:"", shares:11, benchmarkWeight:0, stopLossPct:0.0897, stopLossPrice:91.03, status:"active", notes:"AI/Autonomy + Energy", marketBeta:2.031, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.022425, alphaAnn:0.0681 },
  { id:"11", ticker:"TSM", company:"Taiwan Semiconductor", theme:"AI-Industrial", subTheme:"AI Infra", buyPrice:287.96, currentPrice:287.96, entryDate:"2025-12-03", exitDate:"", shares:17, benchmarkWeight:0, stopLossPct:0.0936, stopLossPrice:90.64, status:"active", notes:"Foundry monopoly", marketBeta:1.3729, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.023402, alphaAnn:0.1279 },
  // === BATTERY (active) ===
  { id:"12", ticker:"BE", company:"Bloom Energy (Battery)", theme:"Battery", subTheme:"Battery", buyPrice:110.77, currentPrice:110.77, entryDate:"2025-12-08", exitDate:"", shares:0.222, benchmarkWeight:0, stopLossPct:0.2674, stopLossPrice:73.26, status:"active", notes:"Batteries allocation", marketBeta:2.0783, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.066838, alphaAnn:0.4091 },
  { id:"13", ticker:"CSIQ", company:"Canadian Solar (Battery)", theme:"Battery", subTheme:"Battery", buyPrice:23.77, currentPrice:23.77, entryDate:"2025-12-08", exitDate:"", shares:336.56, benchmarkWeight:0, stopLossPct:0.1907, stopLossPrice:80.93, status:"active", notes:"Batteries allocation", marketBeta:1.4982, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.047669, alphaAnn:-0.1325 },
  // === DIGITAL INFRA (active) ===
  { id:"14", ticker:"APLD", company:"Applied Digital", theme:"Digital Infra", subTheme:"Digital Infra", buyPrice:29.18, currentPrice:29.18, entryDate:"2026-02-05", exitDate:"", shares:277.587, benchmarkWeight:0, stopLossPct:0.3118, stopLossPrice:68.82, status:"active", notes:"AI data center developer", marketBeta:2.5483, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.077962, alphaAnn:1.0202 },
  { id:"15", ticker:"AWK", company:"American Water Works", theme:"Digital Infra", subTheme:"Digital Infra", buyPrice:128.52, currentPrice:128.52, entryDate:"2025-12-08", exitDate:"", shares:62.247, benchmarkWeight:0, stopLossPct:0.0614, stopLossPrice:93.86, status:"active", notes:"Water utility", marketBeta:0.3706, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.015345, alphaAnn:0.004 },
  { id:"16", ticker:"CIEN", company:"Ciena Corp", theme:"Digital Infra", subTheme:"Digital Infra", buyPrice:209.12, currentPrice:209.12, entryDate:"2025-12-08", exitDate:"", shares:39.255, benchmarkWeight:0, stopLossPct:0.1925, stopLossPrice:80.75, status:"active", notes:"Optical networking", marketBeta:1.4642, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.048134, alphaAnn:0.2747 },
  { id:"17", ticker:"DBRG", company:"DigitalBridge Group", theme:"Digital Infra", subTheme:"Digital Infra", buyPrice:14.66, currentPrice:14.66, entryDate:"2025-12-08", exitDate:"", shares:545.702, benchmarkWeight:0, stopLossPct:0.0076, stopLossPrice:99.24, status:"active", notes:"Digital infra investment manager", marketBeta:1.6145, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.001892, alphaAnn:-0.164 },
  { id:"18", ticker:"DLR", company:"Digital Realty Trust", theme:"Digital Infra", subTheme:"Digital Infra", buyPrice:163.00, currentPrice:163.00, entryDate:"2025-12-08", exitDate:"", shares:49.079, benchmarkWeight:0, stopLossPct:0.061, stopLossPrice:93.90, status:"active", notes:"Data center REIT", marketBeta:0.8944, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.015262, alphaAnn:0.0184 },
  { id:"19", ticker:"EQIX", company:"Equinix Inc", theme:"Digital Infra", subTheme:"Digital Infra", buyPrice:741.51, currentPrice:741.51, entryDate:"2025-12-08", exitDate:"", shares:10.788, benchmarkWeight:0, stopLossPct:0.0867, stopLossPrice:91.33, status:"active", notes:"Global colocation REIT", marketBeta:0.8582, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.02168, alphaAnn:0.0398 },
  { id:"20", ticker:"NEE", company:"NextEra Energy", theme:"Digital Infra", subTheme:"Digital Infra", buyPrice:82.12, currentPrice:82.12, entryDate:"2025-12-08", exitDate:"", shares:97.423, benchmarkWeight:0, stopLossPct:0.0546, stopLossPrice:94.54, status:"active", notes:"Renewables + regulated utility", marketBeta:0.5693, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.013638, alphaAnn:0.0391 },
  { id:"21", ticker:"PWR", company:"Quanta Services", theme:"Digital Infra", subTheme:"Digital Infra", buyPrice:465.62, currentPrice:465.62, entryDate:"2025-12-08", exitDate:"", shares:17.181, benchmarkWeight:0, stopLossPct:0.0971, stopLossPrice:90.29, status:"active", notes:"Infrastructure services", marketBeta:1.1946, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.02427, alphaAnn:0.2842 },
  { id:"22", ticker:"VRT", company:"Vertiv Holdings", theme:"Digital Infra", subTheme:"Digital Infra", buyPrice:184.17, currentPrice:184.17, entryDate:"2025-12-08", exitDate:"", shares:43.438, benchmarkWeight:0, stopLossPct:0.1909, stopLossPrice:80.91, status:"active", notes:"Power/cooling for data centers", marketBeta:2.0728, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.047727, alphaAnn:0.4279 },
  { id:"23", ticker:"XYL", company:"Xylem Inc", theme:"Digital Infra", subTheme:"Digital Infra", buyPrice:139.22, currentPrice:139.22, entryDate:"2025-12-08", exitDate:"", shares:57.462, benchmarkWeight:0, stopLossPct:0.0838, stopLossPrice:91.62, status:"active", notes:"Water technology", marketBeta:1.023, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.020948, alphaAnn:-0.0457 },
  // === EXPERIENTIALS (active) ===
  { id:"24", ticker:"MAR", company:"Marriott International", theme:"Experientials", subTheme:"Experientials", buyPrice:297.33, currentPrice:297.33, entryDate:"2025-12-04", exitDate:"", shares:26.906, benchmarkWeight:0, stopLossPct:0.0822, stopLossPrice:91.78, status:"active", notes:"Hotel operator", marketBeta:1.0889, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.02055, alphaAnn:0.0638 },
  { id:"25", ticker:"H", company:"Hyatt Hotels", theme:"Experientials", subTheme:"Experientials", buyPrice:156.13, currentPrice:156.13, entryDate:"2025-12-04", exitDate:"", shares:51.239, benchmarkWeight:0, stopLossPct:0.1024, stopLossPrice:89.76, status:"active", notes:"Luxury hotels", marketBeta:1.2043, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.025588, alphaAnn:0.0144 },
  { id:"26", ticker:"RCL", company:"Royal Caribbean", theme:"Experientials", subTheme:"Experientials", buyPrice:260.22, currentPrice:260.22, entryDate:"2025-12-04", exitDate:"", shares:30.743, benchmarkWeight:0, stopLossPct:0.1622, stopLossPrice:83.78, status:"active", notes:"Cruise operator", marketBeta:1.6401, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.040545, alphaAnn:0.1404 },
  { id:"27", ticker:"NCLH", company:"Norwegian Cruise Line", theme:"Experientials", subTheme:"Experientials", buyPrice:18.68, currentPrice:18.68, entryDate:"2025-12-04", exitDate:"", shares:428.38, benchmarkWeight:0, stopLossPct:0.1772, stopLossPrice:82.28, status:"active", notes:"Cruise operator", marketBeta:1.8897, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.044295, alphaAnn:-0.1535 },
  { id:"28", ticker:"ABNB", company:"Airbnb Inc", theme:"Experientials", subTheme:"Experientials", buyPrice:119.96, currentPrice:119.96, entryDate:"2025-12-04", exitDate:"", shares:66.686, benchmarkWeight:0, stopLossPct:0.0932, stopLossPrice:90.68, status:"active", notes:"Travel platform", marketBeta:1.5518, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.023289, alphaAnn:-0.1612 },
  { id:"29", ticker:"LYV", company:"Live Nation", theme:"Experientials", subTheme:"Experientials", buyPrice:138.12, currentPrice:138.12, entryDate:"2025-12-04", exitDate:"", shares:57.919, benchmarkWeight:0, stopLossPct:0.0798, stopLossPrice:92.02, status:"active", notes:"Live entertainment", marketBeta:1.1232, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.019962, alphaAnn:0.03 },
  { id:"30", ticker:"MSGE", company:"MSG Entertainment", theme:"Experientials", subTheme:"Experientials", buyPrice:50.76, currentPrice:50.76, entryDate:"2025-12-04", exitDate:"", shares:157.591, benchmarkWeight:0, stopLossPct:0.0769, stopLossPrice:92.31, status:"active", notes:"Entertainment venues", marketBeta:0.9214, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.019227, alphaAnn:0.1147 },
  { id:"31", ticker:"DIS", company:"Walt Disney Co", theme:"Experientials", subTheme:"Experientials", buyPrice:104.76, currentPrice:104.76, entryDate:"2025-12-04", exitDate:"", shares:76.365, benchmarkWeight:0, stopLossPct:0.0822, stopLossPrice:91.78, status:"active", notes:"Media + parks", marketBeta:1.0264, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.020541, alphaAnn:-0.2225 },
  { id:"32", ticker:"TKO", company:"TKO Group", theme:"Experientials", subTheme:"Experientials", buyPrice:197.32, currentPrice:197.32, entryDate:"2025-12-04", exitDate:"", shares:40.542, benchmarkWeight:0, stopLossPct:0.0951, stopLossPrice:90.49, status:"active", notes:"WWE + UFC", marketBeta:0.6319, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.023773, alphaAnn:0.2411 },
  // === SECURITY (active) ===
  { id:"33", ticker:"MSI", company:"Motorola Solutions", theme:"Security", subTheme:"Security", buyPrice:367.47, currentPrice:367.47, entryDate:"2025-11-24", exitDate:"", shares:22, benchmarkWeight:0, stopLossPct:0.0626, stopLossPrice:93.74, status:"active", notes:"Public safety tech", marketBeta:0.7641, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.015645, alphaAnn:0.1293 },
  { id:"34", ticker:"OSIS", company:"OSI Systems", theme:"Security", subTheme:"Security", buyPrice:254.66, currentPrice:254.66, entryDate:"2025-11-24", exitDate:"", shares:32, benchmarkWeight:0, stopLossPct:0.1102, stopLossPrice:88.98, status:"active", notes:"Security screening", marketBeta:0.89, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.027554, alphaAnn:0.1375 },
  { id:"35", ticker:"RTX", company:"RTX Corp", theme:"Security", subTheme:"Security", buyPrice:172.14, currentPrice:172.14, entryDate:"2025-11-24", exitDate:"", shares:47, benchmarkWeight:0, stopLossPct:0.07, stopLossPrice:93.0, status:"active", notes:"Defense & aerospace", marketBeta:0.6002, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.017508, alphaAnn:0.1784 },
  { id:"36", ticker:"ALRM", company:"Alarm.com Holdings", theme:"Security", subTheme:"Security", buyPrice:52.71, currentPrice:52.71, entryDate:"2026-12-11", exitDate:"", shares:151.773, benchmarkWeight:0, stopLossPct:0.0813, stopLossPrice:91.87, status:"active", notes:"Smart home security", marketBeta:1.1112, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.02032, alphaAnn:-0.1864 },
  // === NUCLEAR (active) ===
  { id:"37", ticker:"BWXT", company:"BWX Technologies", theme:"Nuclear", subTheme:"Nuclear", buyPrice:169.54, currentPrice:169.54, entryDate:"2025-11-21", exitDate:"", shares:47.186, benchmarkWeight:0, stopLossPct:0.1257, stopLossPrice:87.43, status:"active", notes:"Nuclear components", marketBeta:0.8344, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.031436, alphaAnn:0.1909 },
  { id:"38", ticker:"GE", company:"GE Aerospace", theme:"Nuclear", subTheme:"Nuclear", buyPrice:285.48, currentPrice:285.48, entryDate:"2025-11-21", exitDate:"", shares:28.022, benchmarkWeight:0, stopLossPct:0.0883, stopLossPrice:91.17, status:"active", notes:"Aerospace + energy", marketBeta:1.0686, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.022074, alphaAnn:0.22 },
  { id:"39", ticker:"EXC", company:"Exelon Corp", theme:"Nuclear", subTheme:"Nuclear", buyPrice:45.63, currentPrice:45.63, entryDate:"2025-11-21", exitDate:"", shares:175.334, benchmarkWeight:0, stopLossPct:0.0579, stopLossPrice:94.21, status:"active", notes:"Nuclear utility", marketBeta:0.3488, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.014465, alphaAnn:0.1184 },
  // === SILVER ECONOMY (active) ===
  { id:"40", ticker:"WELL", company:"Welltower Inc", theme:"Silver Economy", subTheme:"Silver", buyPrice:205.20, currentPrice:205.20, entryDate:"2025-12-04", exitDate:"", shares:26.763, benchmarkWeight:0, stopLossPct:0.0522, stopLossPrice:94.78, status:"active", notes:"Senior housing REIT", marketBeta:0.5695, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.013059, alphaAnn:0.1893 },
  { id:"41", ticker:"VTR", company:"Ventas Inc", theme:"Silver Economy", subTheme:"Silver", buyPrice:80.72, currentPrice:80.72, entryDate:"2025-12-04", exitDate:"", shares:66.1, benchmarkWeight:0, stopLossPct:0.0446, stopLossPrice:95.54, status:"active", notes:"Healthcare REIT", marketBeta:0.5882, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.011159, alphaAnn:0.0706 },
  { id:"42", ticker:"ADUS", company:"Addus HomeCare", theme:"Silver Economy", subTheme:"Silver", buyPrice:110.61, currentPrice:110.61, entryDate:"2025-12-04", exitDate:"", shares:48.255, benchmarkWeight:0, stopLossPct:0.0993, stopLossPrice:90.07, status:"active", notes:"Home health services", marketBeta:0.7223, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.024816, alphaAnn:-0.0147 },
  { id:"43", ticker:"EHAB", company:"Enhabit Home Health", theme:"Silver Economy", subTheme:"Silver", buyPrice:9.49, currentPrice:9.49, entryDate:"2025-12-04", exitDate:"", shares:562.325, benchmarkWeight:0, stopLossPct:0.1591, stopLossPrice:84.09, status:"active", notes:"Home health & hospice", marketBeta:0.7115, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.039765, alphaAnn:-0.1331 },
  { id:"44", ticker:"LLY", company:"Eli Lilly", theme:"Silver Economy", subTheme:"Silver", buyPrice:993.65, currentPrice:993.65, entryDate:"2025-12-04", exitDate:"", shares:4.026, benchmarkWeight:0, stopLossPct:0.1156, stopLossPrice:88.44, status:"active", notes:"GLP-1 leader", marketBeta:0.5889, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.028908, alphaAnn:0.3007 },
  { id:"45", ticker:"ABBV", company:"AbbVie Inc", theme:"Silver Economy", subTheme:"Silver", buyPrice:223.04, currentPrice:223.04, entryDate:"2025-12-04", exitDate:"", shares:17.937, benchmarkWeight:0, stopLossPct:0.0721, stopLossPrice:92.79, status:"active", notes:"Immunology + oncology", marketBeta:0.3403, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.018021, alphaAnn:0.1762 },
  { id:"46", ticker:"AMGN", company:"Amgen Inc", theme:"Silver Economy", subTheme:"Silver", buyPrice:316.88, currentPrice:316.88, entryDate:"2025-12-04", exitDate:"", shares:12.623, benchmarkWeight:0, stopLossPct:0.087, stopLossPrice:91.30, status:"active", notes:"Biotech", marketBeta:0.4466, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.021758, alphaAnn:0.0998 },
  { id:"47", ticker:"DXCM", company:"DexCom Inc", theme:"Silver Economy", subTheme:"Silver", buyPrice:65.30, currentPrice:65.30, entryDate:"2025-12-04", exitDate:"", shares:67.425, benchmarkWeight:0, stopLossPct:0.088, stopLossPrice:91.20, status:"active", notes:"CGM devices", marketBeta:1.15, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.022002, alphaAnn:-0.0832 },
  { id:"48", ticker:"ABT", company:"Abbott Laboratories", theme:"Silver Economy", subTheme:"Silver", buyPrice:121.51, currentPrice:121.51, entryDate:"2025-12-04", exitDate:"", shares:32.919, benchmarkWeight:0, stopLossPct:0.077, stopLossPrice:92.30, status:"active", notes:"Medical devices", marketBeta:0.5424, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.019255, alphaAnn:-0.0377 },
  { id:"49", ticker:"MDT", company:"Medtronic PLC", theme:"Silver Economy", subTheme:"Silver", buyPrice:100.53, currentPrice:100.53, entryDate:"2025-12-04", exitDate:"", shares:39.8, benchmarkWeight:0, stopLossPct:0.056, stopLossPrice:94.40, status:"active", notes:"Med devices", marketBeta:0.5601, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.014008, alphaAnn:-0.0689 },
  { id:"50", ticker:"SYK", company:"Stryker Corp", theme:"Silver Economy", subTheme:"Silver", buyPrice:351.47, currentPrice:351.47, entryDate:"2025-12-04", exitDate:"", shares:11.38, benchmarkWeight:0, stopLossPct:0.0596, stopLossPrice:94.04, status:"active", notes:"Orthopedic devices", marketBeta:0.8485, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.014912, alphaAnn:0.0168 },
  { id:"51", ticker:"TNL", company:"Travel + Leisure", theme:"Silver Economy", subTheme:"Silver", buyPrice:68.34, currentPrice:68.34, entryDate:"2025-12-04", exitDate:"", shares:78.193, benchmarkWeight:0, stopLossPct:0.0779, stopLossPrice:92.21, status:"active", notes:"Vacation ownership", marketBeta:1.3504, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.019483, alphaAnn:-0.035 },
  { id:"52", ticker:"EXPE", company:"Expedia (Silver)", theme:"Silver Economy", subTheme:"Silver", buyPrice:258.17, currentPrice:258.17, entryDate:"2025-12-04", exitDate:"", shares:10.07, benchmarkWeight:0, stopLossPct:0.1766, stopLossPrice:82.34, status:"active", notes:"OTA Silver allocation", marketBeta:1.4094, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.044155, alphaAnn:0.0042 },
  // === PAYMENTS (active) ===
  { id:"53", ticker:"V", company:"Visa Inc", theme:"Payments", subTheme:"Payments", buyPrice:324.60, currentPrice:324.60, entryDate:"2025-12-04", exitDate:"", shares:24.645, benchmarkWeight:0, stopLossPct:0.0639, stopLossPrice:93.61, status:"active", notes:"Payment network", marketBeta:0.8606, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.015981, alphaAnn:-0.0041 },
  { id:"54", ticker:"MA", company:"Mastercard Inc", theme:"Payments", subTheme:"Payments", buyPrice:542.53, currentPrice:542.53, entryDate:"2025-12-04", exitDate:"", shares:14.745, benchmarkWeight:0, stopLossPct:0.0678, stopLossPrice:93.22, status:"active", notes:"Payment network", marketBeta:0.9493, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.016953, alphaAnn:-0.0189 },
  { id:"55", ticker:"AXP", company:"American Express", theme:"Payments", subTheme:"Payments", buyPrice:346.855, currentPrice:346.855, entryDate:"2026-01-30", exitDate:"", shares:12.914, benchmarkWeight:0, stopLossPct:0.0909, stopLossPrice:90.91, status:"active", notes:"Financial services", marketBeta:1.1963, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.022735, alphaAnn:0.0417 },
  // === WASTE (active) ===
  { id:"56", ticker:"CLH", company:"Clean Harbors", theme:"Waste", subTheme:"Waste", buyPrice:235.64, currentPrice:235.64, entryDate:"2025-12-10", exitDate:"", shares:33.949, benchmarkWeight:0, stopLossPct:0.0592, stopLossPrice:94.08, status:"active", notes:"Hazardous waste", marketBeta:0.9139, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.014807, alphaAnn:0.1556 },
  { id:"57", ticker:"DAR", company:"Darling Ingredients", theme:"Waste", subTheme:"Waste", buyPrice:33.15, currentPrice:33.15, entryDate:"2025-12-10", exitDate:"", shares:227.599, benchmarkWeight:0, stopLossPct:0.0625, stopLossPrice:93.75, status:"active", notes:"Rendering/recycling", marketBeta:1.0588, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.015635, alphaAnn:-0.1227 },
  { id:"58", ticker:"RSG", company:"Republic Services", theme:"Waste", subTheme:"Waste", buyPrice:208.71, currentPrice:208.71, entryDate:"2025-12-10", exitDate:"", shares:38.33, benchmarkWeight:0, stopLossPct:0.0419, stopLossPrice:95.81, status:"active", notes:"Waste hauling", marketBeta:0.433, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.010465, alphaAnn:0.1507 },
  { id:"59", ticker:"TTEK", company:"Tetra Tech", theme:"Waste", subTheme:"Waste", buyPrice:33.52, currentPrice:33.52, entryDate:"2025-12-10", exitDate:"", shares:238.664, benchmarkWeight:0, stopLossPct:0.1312, stopLossPrice:86.88, status:"active", notes:"Environmental consulting", marketBeta:0.914, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.032806, alphaAnn:0.0056 },
  { id:"60", ticker:"WM", company:"Waste Management", theme:"Waste", subTheme:"Waste", buyPrice:209.10, currentPrice:209.10, entryDate:"2025-12-10", exitDate:"", shares:38.259, benchmarkWeight:0, stopLossPct:0.0466, stopLossPrice:95.34, status:"active", notes:"Largest US waste hauler", marketBeta:0.3746, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.011646, alphaAnn:0.126 },
  { id:"61", ticker:"PCT", company:"PureCycle Technologies", theme:"Waste", subTheme:"Waste", buyPrice:9.11, currentPrice:9.11, entryDate:"2025-12-10", exitDate:"2026-03-02", shares:877.722, benchmarkWeight:0, stopLossPct:0.2335, stopLossPrice:76.65, status:"exited", notes:"Plastics recycling - EXITED", marketBeta:1.8738, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.058381, alphaAnn:-0.0376 },
  { id:"62", ticker:"PESI", company:"Perma-Fix Environmental", theme:"Waste", subTheme:"Waste", buyPrice:14.43, currentPrice:14.43, entryDate:"2025-12-10", exitDate:"2026-02-24", shares:554.4, benchmarkWeight:0, stopLossPct:0.1354, stopLossPrice:86.46, status:"exited", notes:"Nuclear waste - EXITED", marketBeta:0.734, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.033844, alphaAnn:0.2019 },
  // === LEGACY SOFTWARE (active) ===
  { id:"63", ticker:"SNOW", company:"Snowflake Inc", theme:"Legacy Software", subTheme:"Legacy Software", buyPrice:159.69, currentPrice:159.69, entryDate:"2026-02-24", exitDate:"", shares:50.096, benchmarkWeight:0, stopLossPct:0.12, stopLossPrice:88.0, status:"active", notes:"Cloud data platform", marketBeta:1.8, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.04, alphaAnn:0 },
  { id:"64", ticker:"RDDT", company:"Reddit (Legacy SW)", theme:"Legacy Software", subTheme:"Legacy Software", buyPrice:141.65, currentPrice:141.65, entryDate:"2026-02-24", exitDate:"", shares:56.477, benchmarkWeight:0, stopLossPct:0.12, stopLossPrice:88.0, status:"active", notes:"Social platform", marketBeta:1.5, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.035, alphaAnn:0 },
  { id:"65", ticker:"NOW", company:"ServiceNow", theme:"Legacy Software", subTheme:"Legacy Software", buyPrice:102.945, currentPrice:102.945, entryDate:"2026-02-24", exitDate:"", shares:77.711, benchmarkWeight:0, stopLossPct:0.10, stopLossPrice:90.0, status:"active", notes:"IT workflow automation", marketBeta:1.3, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.025, alphaAnn:0 },
];

const createSampleSettings = () => ({
  benchmarkTicker: "^GSPC", benchmarkName: "S&P 500", benchmarkVol: 0.122, portfolioVol: 0.168,
  riskFreeRate: 0.045, spyWeeklyReturn: -0.01508, iveWeeklyReturn: 0.005, mtumWeeklyReturn: 0.008,
  limits: { dailyVaR95: 0.025, trackingError: 0.06, betaDeviation: 0.30, systematicVol: 0.20, maxStockWeight: 0.08, spyWeight: 0.50 },
  warningThreshold: 0.85, stopLossWarningBuffer: 0.05,
});

const createWeeklyHistory = () => [
  { week:"W1", date:"2025-12-09", portfolioReturn:0.012, benchmarkReturn:0.008, marketContrib:0.007, valueContrib:0.002, momentumContrib:0.001, alpha:0.002 },
  { week:"W2", date:"2025-12-16", portfolioReturn:-0.005, benchmarkReturn:-0.003, marketContrib:-0.003, valueContrib:-0.001, momentumContrib:0.0, alpha:-0.001 },
  { week:"W3", date:"2025-12-23", portfolioReturn:0.008, benchmarkReturn:0.006, marketContrib:0.005, valueContrib:0.001, momentumContrib:0.001, alpha:0.001 },
  { week:"W4", date:"2026-01-06", portfolioReturn:0.015, benchmarkReturn:0.010, marketContrib:0.009, valueContrib:0.002, momentumContrib:0.002, alpha:0.002 },
  { week:"W5", date:"2026-01-13", portfolioReturn:-0.018, benchmarkReturn:-0.012, marketContrib:-0.011, valueContrib:-0.003, momentumContrib:-0.002, alpha:-0.002 },
  { week:"W6", date:"2026-01-20", portfolioReturn:0.006, benchmarkReturn:0.005, marketContrib:0.004, valueContrib:0.001, momentumContrib:0.001, alpha:0.0 },
  { week:"W7", date:"2026-02-03", portfolioReturn:-0.010, benchmarkReturn:-0.008, marketContrib:-0.007, valueContrib:-0.001, momentumContrib:-0.001, alpha:-0.001 },
  { week:"W8", date:"2026-02-10", portfolioReturn:0.003, benchmarkReturn:0.002, marketContrib:0.002, valueContrib:0.0, momentumContrib:0.001, alpha:0.0 },
  { week:"W9", date:"2026-02-24", portfolioReturn:-0.008, benchmarkReturn:-0.006, marketContrib:-0.005, valueContrib:-0.001, momentumContrib:-0.001, alpha:-0.001 },
  { week:"W10", date:"2026-03-03", portfolioReturn:-0.016, benchmarkReturn:-0.015, marketContrib:-0.013, valueContrib:-0.001, momentumContrib:-0.001, alpha:-0.001 },
];

// ═══════════════════════════════════════════════
// YAHOO FINANCE PRICE FETCHER
// ═══════════════════════════════════════════════
async function fetchYahooPrices(tickers) {
  const prices = {};
  const uniqueTickers = [...new Set(tickers)];
  // Use Yahoo Finance v8 API via CORS proxy
  for (const ticker of uniqueTickers) {
    try {
      const resp = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`);
      if (resp.ok) {
        const data = await resp.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (meta?.regularMarketPrice) {
          prices[ticker] = meta.regularMarketPrice;
        }
      }
    } catch (e) {
      console.warn(`Failed to fetch ${ticker}:`, e.message);
    }
  }
  return prices;
}

// ═══════════════════════════════════════════════
// STORAGE HOOK
// ═══════════════════════════════════════════════
function usePersistedState(key, defaultValue) {
  const [data, setData] = useState(defaultValue);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    (async () => {
      try { const r = await window.storage.get(key); if (r?.value) setData(JSON.parse(r.value)); } catch {}
      setLoaded(true);
    })();
  }, [key]);
  const save = useCallback(async (newData) => {
    setData(newData);
    try { await window.storage.set(key, JSON.stringify(newData)); } catch {}
  }, [key]);
  return [data, save, loaded];
}

// ═══════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════
const Card = ({ children, className = "" }) => <div className={`bg-white rounded-lg border border-slate-200 shadow-sm ${className}`}>{children}</div>;
const StatCard = ({ label, value, sub, icon: Icon, trend, color = "text-slate-700" }) => (
  <Card className="p-4"><div className="flex items-start justify-between"><div>
    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">{label}</p>
    <p className={`text-lg font-bold ${color}`}>{value}</p>
    {sub && <p className={`text-xs mt-0.5 ${trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-500" : "text-slate-500"}`}>{sub}</p>}
  </div>{Icon && <div className="p-2 bg-slate-50 rounded-lg"><Icon size={16} className="text-slate-400" /></div>}</div></Card>
);
const Badge = ({ status, small }) => {
  const c = status === "BREACH" ? "bg-red-100 text-red-700 border-red-200" : status === "WARNING" ? "bg-amber-100 text-amber-700 border-amber-200" : status === "active" ? "bg-emerald-100 text-emerald-700 border-emerald-200" : status === "exited" ? "bg-slate-100 text-slate-500 border-slate-200" : "bg-emerald-100 text-emerald-700 border-emerald-200";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${c} ${small ? "text-[10px] px-1.5" : ""}`}>{status}</span>;
};
const TabButton = ({ active, children, onClick }) => <button onClick={onClick} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${active ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{children}</button>;
const SectionHeader = ({ title, subtitle, children }) => (
  <div className="flex items-center justify-between mb-4"><div><h2 className="text-lg font-bold text-slate-800">{title}</h2>{subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}</div>{children && <div className="flex items-center gap-2">{children}</div>}</div>
);
const CustomTooltip = ({ active, payload, label, formatter }) => {
  if (!active || !payload) return null;
  return <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs"><p className="font-semibold text-slate-700 mb-1">{label}</p>
    {payload.map((p, i) => <p key={i} style={{ color: p.color }} className="flex justify-between gap-4"><span>{p.name}:</span><span className="font-medium">{formatter ? formatter(p.value) : typeof p.value === "number" && Math.abs(p.value) < 1 ? fmt.pct(p.value) : fmt.num(p.value)}</span></p>)}</div>;
};

// ═══════════════════════════════════════════════
// OVERVIEW PAGE
// ═══════════════════════════════════════════════
function OverviewPage({ holdings, settings, weeklyHistory }) {
  const active = holdings.filter(h => h.status === "active");
  const totalVal = active.reduce((s, h) => s + h.shares * h.currentPrice, 0);
  const computed = active.map(h => { const pv = h.shares * h.currentPrice; return { ...h, positionValue: pv, weight: pv / totalVal, pnlPercent: calc.pnlPercent(h.currentPrice, h.buyPrice), pnlDollar: calc.pnlDollar(h.currentPrice, h.buyPrice, h.shares) }; });
  const totalPnl = computed.reduce((s, h) => s + h.pnlDollar, 0);
  const totalReturn = totalVal > 0 ? totalPnl / (totalVal - totalPnl) : 0;
  const portBeta = calc.portfolioBeta(computed);
  const sysVol = calc.systematicVol(portBeta, settings.benchmarkVol);
  const idioVol = calc.idiosyncraticVol(settings.portfolioVol, sysVol);
  const te = calc.trackingError(portBeta, settings.benchmarkVol, idioVol);
  const dVar95 = calc.dailyVaR95(settings.portfolioVol);
  const themes = [...new Set(computed.map(h => h.theme))];
  const themeAlloc = themes.map((t, i) => ({ name: t, value: computed.filter(h => h.theme === t).reduce((s, h) => s + h.weight, 0), fill: getThemeColor(t, i) }));
  const topH = [...computed].sort((a, b) => b.weight - a.weight).slice(0, 10);
  const pnlH = [...computed].sort((a, b) => b.pnlDollar - a.pnlDollar);
  const cumData = weeklyHistory.map((w, i) => ({ week: w.week, portfolio: weeklyHistory.slice(0, i + 1).reduce((s, x) => s + x.portfolioReturn, 0), benchmark: weeklyHistory.slice(0, i + 1).reduce((s, x) => s + x.benchmarkReturn, 0) }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard label="Portfolio Value" value={fmt.usd(totalVal)} icon={DollarSign} />
        <StatCard label="Total Return" value={fmt.pct(totalReturn)} trend={totalReturn >= 0 ? "up" : "down"} color={totalReturn >= 0 ? "text-emerald-700" : "text-red-600"} icon={TrendingUp} />
        <StatCard label="Total PnL" value={fmt.usd(totalPnl)} trend={totalPnl >= 0 ? "up" : "down"} color={totalPnl >= 0 ? "text-emerald-700" : "text-red-600"} icon={BarChart3} />
        <StatCard label="Portfolio Beta" value={fmt.num(portBeta)} icon={Shield} />
        <StatCard label="Tracking Error" value={fmt.pct(te)} icon={Activity} />
        <StatCard label="Daily VaR 95%" value={fmt.pct(dVar95)} icon={AlertTriangle} />
        <StatCard label="Holdings" value={computed.length} icon={Briefcase} />
        <StatCard label="Themes" value={themes.length} icon={BarChart3} />
        <StatCard label="Ann. Volatility" value={fmt.pct(settings.portfolioVol)} icon={Activity} />
        <StatCard label="Sys Vol" value={fmt.pct(sysVol)} />
        <StatCard label="Idio Vol" value={fmt.pct(idioVol)} />
        <StatCard label="Benchmark Vol" value={fmt.pct(settings.benchmarkVol)} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Theme Allocation</h3>
          <ResponsiveContainer width="100%" height={260}><PieChart><Pie data={themeAlloc} cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={2} dataKey="value" label={({ name, value }) => `${name} ${fmt.pct(value, 1)}`} labelLine={false}>{themeAlloc.map((e, i) => <Cell key={i} fill={e.fill} />)}</Pie><Tooltip content={<CustomTooltip formatter={v => fmt.pct(v)} />} /></PieChart></ResponsiveContainer></Card>
        <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Top Holdings by Weight</h3>
          <ResponsiveContainer width="100%" height={260}><BarChart data={topH} layout="vertical" margin={{ left: 50 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis type="number" tickFormatter={v => fmt.pct(v, 1)} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="ticker" tick={{ fontSize: 10 }} width={45} /><Tooltip content={<CustomTooltip formatter={v => fmt.pct(v)} />} /><Bar dataKey="weight" fill="#1e3a5f" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></Card>
        <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Portfolio vs Benchmark (Cumulative)</h3>
          <ResponsiveContainer width="100%" height={260}><ComposedChart data={cumData}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="week" tick={{ fontSize: 11 }} /><YAxis tickFormatter={v => fmt.pct(v, 1)} tick={{ fontSize: 11 }} /><Tooltip content={<CustomTooltip formatter={v => fmt.pct(v)} />} /><Legend /><Area type="monotone" dataKey="portfolio" fill="#1e3a5f" fillOpacity={0.08} stroke="#1e3a5f" strokeWidth={2} name="Portfolio" /><Line type="monotone" dataKey="benchmark" stroke="#94a3b8" strokeWidth={2} name="S&P 500" strokeDasharray="5 5" dot={{ r: 2 }} /></ComposedChart></ResponsiveContainer></Card>
        <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">PnL by Holding (Top/Bottom)</h3>
          <ResponsiveContainer width="100%" height={260}><BarChart data={[...pnlH.slice(0, 5), ...pnlH.slice(-5)]}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="ticker" tick={{ fontSize: 9 }} /><YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} /><Tooltip content={<CustomTooltip formatter={v => fmt.usd(v)} />} /><Bar dataKey="pnlDollar" name="PnL $" radius={[4, 4, 0, 0]}>{[...pnlH.slice(0, 5), ...pnlH.slice(-5)].map((e, i) => <Cell key={i} fill={e.pnlDollar >= 0 ? "#059669" : "#dc2626"} />)}</Bar></BarChart></ResponsiveContainer></Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// HOLDINGS PAGE
// ═══════════════════════════════════════════════
function HoldingsPage({ holdings, setHoldings, settings, priceLoading, onRefreshPrices }) {
  const [search, setSearch] = useState("");
  const [themeFilter, setThemeFilter] = useState("All");
  const [sortKey, setSortKey] = useState("theme");
  const [sortDir, setSortDir] = useState(1);
  const [editingId, setEditingId] = useState(null);
  const themes = ["All", ...new Set(holdings.map(h => h.theme))];
  const totalVal = holdings.filter(h => h.status === "active").reduce((s, h) => s + h.shares * h.currentPrice, 0);

  const computed = useMemo(() => {
    let f = holdings.map(h => { const pv = h.shares * h.currentPrice; const w = h.status === "active" ? pv / totalVal : 0; return { ...h, positionValue: pv, weight: w, pnlPercent: calc.pnlPercent(h.currentPrice, h.buyPrice), pnlDollar: calc.pnlDollar(h.currentPrice, h.buyPrice, h.shares), activeWeight: w - (h.benchmarkWeight || 0) }; });
    if (themeFilter !== "All") f = f.filter(h => h.theme === themeFilter);
    if (search) { const s = search.toLowerCase(); f = f.filter(h => h.ticker.toLowerCase().includes(s) || h.company.toLowerCase().includes(s)); }
    f.sort((a, b) => { const va = a[sortKey], vb = b[sortKey]; if (typeof va === "string") return va.localeCompare(vb) * sortDir; return ((va || 0) - (vb || 0)) * sortDir; });
    return f;
  }, [holdings, themeFilter, search, sortKey, sortDir, totalVal]);

  const handleSort = (k) => { if (sortKey === k) setSortDir(-sortDir); else { setSortKey(k); setSortDir(1); } };
  const updateH = (id, f, v) => setHoldings(holdings.map(h => h.id === id ? { ...h, [f]: v } : h));
  const addH = () => { const nid = String(Date.now()); setHoldings([...holdings, { id:nid, ticker:"NEW", company:"New Holding", theme:"AI-Industrial", subTheme:"", buyPrice:100, currentPrice:100, entryDate:new Date().toISOString().split("T")[0], exitDate:"", shares:10, benchmarkWeight:0, stopLossPct:0.10, stopLossPrice:90, status:"active", notes:"", marketBeta:1.0, valueBeta:0, momentumBeta:0, weeklyReturn:0, vol2Y:0.02, alphaAnn:0 }]); setEditingId(nid); };

  const cols = [
    { key:"ticker", label:"Ticker", w:"w-16" }, { key:"company", label:"Company", w:"w-32" }, { key:"theme", label:"Theme", w:"w-24" },
    { key:"status", label:"Status", w:"w-16" }, { key:"buyPrice", label:"Buy $", w:"w-20", f:v=>fmt.usdExact(v) }, { key:"currentPrice", label:"Current $", w:"w-20", f:v=>fmt.usdExact(v) },
    { key:"shares", label:"Shares", w:"w-16", f:v=>fmt.shares(v) }, { key:"positionValue", label:"Value", w:"w-20", f:v=>fmt.usd(v) }, { key:"weight", label:"Weight", w:"w-16", f:v=>fmt.pct(v,1) },
    { key:"pnlPercent", label:"PnL %", w:"w-16", f:v=>fmt.pct(v) }, { key:"pnlDollar", label:"PnL $", w:"w-20", f:v=>fmt.usd(v) },
    { key:"marketBeta", label:"Beta", w:"w-14", f:v=>fmt.num(v) }, { key:"stopLossPct", label:"SL %", w:"w-14", f:v=>fmt.pct(v,0) },
  ];
  const editFields = ["ticker","company","theme","subTheme","buyPrice","currentPrice","shares","benchmarkWeight","stopLossPct","stopLossPrice","marketBeta","valueBeta","momentumBeta","weeklyReturn","status","entryDate","exitDate","notes"];
  const numFields = ["buyPrice","currentPrice","shares","benchmarkWeight","stopLossPct","stopLossPrice","marketBeta","valueBeta","momentumBeta","weeklyReturn"];

  return (
    <div className="space-y-4">
      <SectionHeader title="Portfolio Holdings" subtitle={`${computed.length} positions · ${fmt.usd(totalVal)} total value`}>
        <div className="flex items-center gap-2">
          <div className="relative"><Search size={14} className="absolute left-2 top-2 text-slate-400" /><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." className="pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-md w-36" /></div>
          <select value={themeFilter} onChange={e=>setThemeFilter(e.target.value)} className="px-2 py-1.5 text-sm border border-slate-200 rounded-md">{themes.map(t=><option key={t} value={t}>{t}</option>)}</select>
          <button onClick={onRefreshPrices} disabled={priceLoading} className="flex items-center gap-1 px-3 py-1.5 text-sm border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50">
            {priceLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Prices
          </button>
          <button onClick={addH} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-slate-800 text-white rounded-md hover:bg-slate-700"><Plus size={14} /> Add</button>
        </div>
      </SectionHeader>
      <Card className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="bg-slate-50 border-b border-slate-200">
            <th className="py-2 px-1.5 w-6"></th>
            {cols.map(c=><th key={c.key} className={`py-2 px-1.5 text-left font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700 ${c.w}`} onClick={()=>handleSort(c.key)}>{c.label}{sortKey===c.key?(sortDir===1?" ↑":" ↓"):""}</th>)}
            <th className="py-2 px-1.5 w-8"></th>
          </tr></thead>
          <tbody>{computed.map(h=>(
            <tr key={h.id} className={`border-b border-slate-100 hover:bg-blue-50/30 ${editingId===h.id?"bg-blue-50/50":""}`}>
              <td className="py-1 px-1.5"><button onClick={()=>setEditingId(editingId===h.id?null:h.id)} className="text-slate-400 hover:text-slate-600">{editingId===h.id?<Check size={12}/>:<Edit3 size={12}/>}</button></td>
              {cols.map(c=><td key={c.key} className="py-1 px-1.5">
                {editingId===h.id && editFields.includes(c.key) ? (
                  c.key==="status"?<select value={h[c.key]} onChange={e=>updateH(h.id,c.key,e.target.value)} className="text-xs py-0.5 border rounded">{["active","exited","watchlist"].map(o=><option key={o}>{o}</option>)}</select>:
                  <input type={numFields.includes(c.key)?"number":"text"} value={h[c.key]??""} onChange={e=>updateH(h.id,c.key,numFields.includes(c.key)?parseFloat(e.target.value)||0:e.target.value)} className="w-full px-1 py-0.5 text-xs border rounded" step="any"/>
                ) : (
                  c.key==="status"?<Badge status={h[c.key]} small/>:
                  c.key==="pnlPercent"||c.key==="pnlDollar"||c.key==="activeWeight"?<span className={h[c.key]>=0?"text-emerald-600 font-medium":"text-red-500 font-medium"}>{c.f?c.f(h[c.key]):h[c.key]}</span>:
                  <span className={c.key==="ticker"?"font-semibold text-slate-800":c.key==="theme"?"text-slate-600 font-medium":"text-slate-600"}>{c.f?c.f(h[c.key]):h[c.key]}</span>
                )}
              </td>)}
              <td className="py-1 px-1.5"><button onClick={()=>setHoldings(holdings.filter(x=>x.id!==h.id))} className="text-slate-300 hover:text-red-500"><Trash2 size={12}/></button></td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════
// RISK PAGE
// ═══════════════════════════════════════════════
function RiskPage({ holdings, settings, setSettings }) {
  const active = holdings.filter(h => h.status === "active");
  const totalVal = active.reduce((s, h) => s + h.shares * h.currentPrice, 0);
  const comp = active.map(h => { const pv = h.shares * h.currentPrice; return { ...h, weight: pv / totalVal, positionValue: pv }; });
  const portBeta = calc.portfolioBeta(comp);
  const stockOnly = (() => { const ns = comp.filter(h => h.ticker !== "^GSPC"); const w = ns.reduce((s, h) => s + h.weight, 0); return w > 0 ? ns.reduce((s, h) => s + (h.weight / w) * h.marketBeta, 0) : 0; })();
  const sysVol = calc.systematicVol(portBeta, settings.benchmarkVol);
  const idioVol = calc.idiosyncraticVol(settings.portfolioVol, sysVol);
  const te = calc.trackingError(portBeta, settings.benchmarkVol, idioVol);
  const dV95 = calc.dailyVaR95(settings.portfolioVol); const dV99 = calc.dailyVaR99(settings.portfolioVol);
  const wV95 = calc.weeklyVaR95(settings.portfolioVol); const wV99 = calc.weeklyVaR99(settings.portfolioVol);
  const themes = [...new Set(comp.map(h => h.theme))];
  const themeRisk = themes.map((t, i) => { const th = comp.filter(h => h.theme === t); const tw = th.reduce((s, h) => s + h.weight, 0); const tb = tw > 0 ? th.reduce((s, h) => s + h.weight * h.marketBeta, 0) / tw : 0; const wb = th.reduce((s, h) => s + h.weight * h.marketBeta, 0); const rc = portBeta > 0 ? wb / portBeta : 0; return { theme: t, weight: tw, avgBeta: tb, weightedBeta: wb, riskContrib: rc, fill: getThemeColor(t, i) }; });
  const maxSW = Math.max(...comp.map(h => h.weight)); const spyW = comp.find(h => h.ticker === "^GSPC")?.weight || 0;
  const checks = [
    { metric: "Daily VaR 95%", current: dV95, limit: settings.limits.dailyVaR95 },
    { metric: "Tracking Error", current: te, limit: settings.limits.trackingError },
    { metric: "Beta Deviation", current: Math.abs(portBeta - 1), limit: settings.limits.betaDeviation },
    { metric: "Systematic Vol", current: sysVol, limit: settings.limits.systematicVol },
    { metric: "Max Stock Weight", current: maxSW, limit: settings.limits.maxStockWeight },
    { metric: "S&P Weight", current: spyW, limit: settings.limits.spyWeight },
  ].map(c => ({ ...c, utilization: calc.utilization(c.current, c.limit), status: calc.complianceStatus(c.current, c.limit), headroom: c.limit - c.current }));

  return (
    <div className="space-y-6">
      <SectionHeader title="Risk Analytics" subtitle="Portfolio risk, VaR, compliance" />
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard label="Portfolio Beta" value={fmt.num(portBeta)} icon={Shield} />
        <StatCard label="Stock-Only Beta" value={fmt.num(stockOnly)} />
        <StatCard label="Tracking Error" value={fmt.pct(te)} />
        <StatCard label="Daily VaR 95%" value={fmt.pct(dV95)} icon={AlertTriangle} />
        <StatCard label="Daily VaR 99%" value={fmt.pct(dV99)} />
        <StatCard label="Weekly VaR 95%" value={fmt.pct(wV95)} />
        <StatCard label="Weekly VaR 99%" value={fmt.pct(wV99)} />
        <StatCard label="Systematic Vol" value={fmt.pct(sysVol)} />
        <StatCard label="Idio Vol" value={fmt.pct(idioVol)} />
        <StatCard label="Ann. Vol" value={fmt.pct(settings.portfolioVol)} />
        <StatCard label="Vol Ratio" value={fmt.num(settings.portfolioVol / settings.benchmarkVol)} />
        <StatCard label="S&P Weight" value={fmt.pct(spyW)} />
      </div>
      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Compliance Dashboard</h3>
        <table className="w-full text-sm"><thead><tr className="bg-slate-50 border-b border-slate-200">{["Metric","Current","Limit","Headroom","Utilization","Status"].map(h=><th key={h} className="py-2 px-3 text-left text-xs font-semibold text-slate-500 uppercase">{h}</th>)}</tr></thead>
          <tbody>{checks.map(c=><tr key={c.metric} className="border-b border-slate-100 hover:bg-slate-50"><td className="py-2 px-3 font-semibold text-slate-700">{c.metric}</td><td className="py-2 px-3">{fmt.pct(c.current)}</td><td className="py-2 px-3 text-slate-500">{fmt.pct(c.limit)}</td><td className="py-2 px-3">{fmt.pct(c.headroom)}</td>
            <td className="py-2 px-3"><div className="flex items-center gap-2"><div className="flex-1 bg-slate-100 rounded-full h-2 max-w-[120px]"><div className="h-2 rounded-full" style={{width:`${Math.min(c.utilization*100,100)}%`,backgroundColor:statusBg(c.status)}}/></div><span className="text-xs font-medium">{fmt.pct(c.utilization,0)}</span></div></td>
            <td className="py-2 px-3"><Badge status={c.status}/></td></tr>)}</tbody></table></Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Risk Contribution by Theme</h3>
          <ResponsiveContainer width="100%" height={280}><BarChart data={themeRisk}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="theme" tick={{fontSize:9}}/><YAxis tickFormatter={v=>fmt.pct(v,0)} tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>fmt.pct(v)}/>}/><Bar dataKey="riskContrib" name="Risk Contrib" radius={[4,4,0,0]}>{themeRisk.map((e,i)=><Cell key={i} fill={e.fill}/>)}</Bar></BarChart></ResponsiveContainer></Card>
        <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Theme Risk Profile</h3>
          <table className="w-full text-xs"><thead><tr className="border-b border-slate-200">{["Theme","Weight","Avg β","Wtd β","Risk %"].map(h=><th key={h} className="py-2 px-2 text-left font-semibold text-slate-500">{h}</th>)}</tr></thead>
            <tbody>{themeRisk.map(t=><tr key={t.theme} className="border-b border-slate-100"><td className="py-1.5 px-2 font-semibold">{t.theme}</td><td className="py-1.5 px-2">{fmt.pct(t.weight,1)}</td><td className="py-1.5 px-2">{fmt.num(t.avgBeta)}</td><td className="py-1.5 px-2">{fmt.num(t.weightedBeta,3)}</td><td className="py-1.5 px-2">{fmt.pct(t.riskContrib,1)}</td></tr>)}</tbody></table></Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// STOP-LOSS PAGE (with 4σ stop-loss from analysis)
// ═══════════════════════════════════════════════
function StopLossPage({ holdings, settings }) {
  const [filter, setFilter] = useState("all");
  const active = holdings.filter(h => h.status === "active");
  const data = active.map(h => {
    // Stop-loss price is relative to buy price using stopLossPct
    const slPrice = h.buyPrice * (1 - h.stopLossPct);
    const dist = h.buyPrice > 0 ? (h.currentPrice - slPrice) / h.currentPrice : 1;
    const pnl = calc.pnlPercent(h.currentPrice, h.buyPrice);
    const st = h.currentPrice <= slPrice ? "BREACH" : dist < settings.stopLossWarningBuffer ? "WARNING" : "OK";
    return { ...h, slPrice, distToSl: dist, pnlPct: pnl, alertStatus: st, action: st === "BREACH" ? "EXIT IMMEDIATELY" : st === "WARNING" ? "MONITOR CLOSELY" : "HOLD" };
  });
  const filtered = filter === "all" ? data : filter === "BREACH" ? data.filter(h => h.alertStatus === "BREACH") : filter === "WARNING" ? data.filter(h => h.alertStatus === "WARNING") : data.filter(h => h.theme === filter);
  const bc = data.filter(h => h.alertStatus === "BREACH").length; const wc = data.filter(h => h.alertStatus === "WARNING").length; const oc = data.filter(h => h.alertStatus === "OK").length;
  const themes = [...new Set(active.map(h => h.theme))];

  return (
    <div className="space-y-6">
      <SectionHeader title="Stop-Loss Monitoring" subtitle="4σ stop-loss framework from portfolio analysis" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Breached" value={bc} color={bc > 0 ? "text-red-600" : "text-emerald-600"} icon={AlertCircle} />
        <StatCard label="Warning" value={wc} color={wc > 0 ? "text-amber-600" : "text-emerald-600"} icon={AlertTriangle} />
        <StatCard label="OK" value={oc} color="text-emerald-600" icon={CheckCircle} />
        <StatCard label="Total Monitored" value={data.length} icon={Shield} />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {["all", "BREACH", "WARNING", ...themes].map(f => <TabButton key={f} active={filter === f} onClick={() => setFilter(f)}>{f === "all" ? "All" : f}</TabButton>)}
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm"><thead><tr className="bg-slate-50 border-b border-slate-200">{["Ticker","Theme","Buy $","Current $","SL %","SL Price","Distance","PnL %","Status","Action"].map(h=><th key={h} className="py-2 px-3 text-left text-xs font-semibold text-slate-500 uppercase">{h}</th>)}</tr></thead>
          <tbody>{filtered.sort((a, b) => a.distToSl - b.distToSl).map(h => (
            <tr key={h.id} className={`border-b border-slate-100 hover:bg-slate-50 ${h.alertStatus === "BREACH" ? "bg-red-50/50" : h.alertStatus === "WARNING" ? "bg-amber-50/30" : ""}`}>
              <td className="py-2 px-3 font-semibold">{h.ticker}</td><td className="py-2 px-3 text-slate-600">{h.theme}</td>
              <td className="py-2 px-3">{fmt.usdExact(h.buyPrice)}</td><td className="py-2 px-3">{fmt.usdExact(h.currentPrice)}</td>
              <td className="py-2 px-3">{fmt.pct(h.stopLossPct, 0)}</td><td className="py-2 px-3">{fmt.usdExact(h.slPrice)}</td>
              <td className="py-2 px-3"><div className="flex items-center gap-2"><div className="flex-1 bg-slate-100 rounded-full h-2 max-w-[80px]"><div className="h-2 rounded-full" style={{width:`${Math.max(0,Math.min(100,(1-h.distToSl/0.2)*100))}%`,backgroundColor:statusBg(h.alertStatus)}}/></div><span className="text-xs font-medium">{fmt.pct(h.distToSl,1)}</span></div></td>
              <td className={`py-2 px-3 font-medium ${h.pnlPct >= 0 ? "text-emerald-600" : "text-red-500"}`}>{fmt.pct(h.pnlPct)}</td>
              <td className="py-2 px-3"><Badge status={h.alertStatus} /></td>
              <td className="py-2 px-3 text-xs font-medium" style={{color:h.alertStatus==="BREACH"?"#dc2626":h.alertStatus==="WARNING"?"#d97706":"#64748b"}}>{h.action}</td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Position Risk Gauges</h3>
        <div className="space-y-2 max-h-[400px] overflow-y-auto">{data.sort((a,b)=>a.distToSl-b.distToSl).map(h=>(
          <div key={h.id} className="flex items-center gap-3"><span className="text-xs font-semibold w-12 text-slate-700">{h.ticker}</span><span className="text-[10px] text-slate-400 w-20 truncate">{h.theme}</span>
            <div className="flex-1 bg-slate-100 rounded-full h-2.5"><div className="h-2.5 rounded-full transition-all" style={{width:`${Math.max(5,Math.min(100,(1-h.distToSl/0.25)*100))}%`,backgroundColor:statusBg(h.alertStatus)}}/></div>
            <span className="text-xs font-medium w-14 text-right">{fmt.pct(h.distToSl,1)}</span><Badge status={h.alertStatus} small/></div>
        ))}</div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════
// RETURNS PAGE
// ═══════════════════════════════════════════════
function ReturnsPage({ holdings, settings, weeklyHistory }) {
  const active = holdings.filter(h => h.status === "active");
  const totalVal = active.reduce((s, h) => s + h.shares * h.currentPrice, 0);
  const comp = active.map(h => ({ ...h, weight: (h.shares * h.currentPrice) / totalVal }));
  const themes = [...new Set(comp.map(h => h.theme))];
  const basket = themes.map(t => { const b = comp.filter(h => h.theme === t); const bw = b.reduce((s, h) => s + h.weight, 0); const br = bw > 0 ? b.reduce((s, h) => s + h.weight * h.weeklyReturn, 0) / bw : 0; const me = bw > 0 ? b.reduce((s, h) => s + h.weight * h.marketBeta, 0) / bw : 0; const mc = me * settings.spyWeeklyReturn; const al = br - mc; return { theme: t, bw, br, me, mc, al }; });
  const pR = comp.reduce((s, h) => s + h.weight * h.weeklyReturn, 0);
  const pME = comp.reduce((s, h) => s + h.weight * h.marketBeta, 0);
  const pMC = pME * settings.spyWeeklyReturn;
  const pAl = pR - pMC;
  const exR = pR - settings.spyWeeklyReturn;
  const cumData = weeklyHistory.map((w, i) => ({ week: w.week, portfolio: weeklyHistory.slice(0, i + 1).reduce((s, x) => s + x.portfolioReturn, 0), benchmark: weeklyHistory.slice(0, i + 1).reduce((s, x) => s + x.benchmarkReturn, 0) }));
  const topTheme = [...basket].sort((a, b) => b.br * b.bw - a.br * a.bw)[0];
  const commentary = `Portfolio returned ${fmt.pct(pR)} this week vs benchmark ${fmt.pct(settings.spyWeeklyReturn)}, generating ${fmt.pct(exR)} excess return. Market beta contributed ${fmt.pct(pMC)}. ${topTheme ? `${topTheme.theme} was the leading theme at ${fmt.pct(topTheme.br)} return.` : ""} Portfolio alpha was ${fmt.pct(pAl)}.`;

  return (
    <div className="space-y-6">
      <SectionHeader title="Return Attribution" subtitle="Weekly factor decomposition" />
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard label="Portfolio Return" value={fmt.pct(pR)} trend={pR>=0?"up":"down"} color={pR>=0?"text-emerald-700":"text-red-600"} />
        <StatCard label="Benchmark" value={fmt.pct(settings.spyWeeklyReturn)} />
        <StatCard label="Excess Return" value={fmt.pct(exR)} trend={exR>=0?"up":"down"} color={exR>=0?"text-emerald-700":"text-red-600"} />
        <StatCard label="Market Contrib" value={fmt.pct(pMC)} />
        <StatCard label="Alpha" value={fmt.pct(pAl)} trend={pAl>=0?"up":"down"} color={pAl>=0?"text-emerald-700":"text-red-600"} />
        <StatCard label="Port β Exp" value={fmt.num(pME)} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Cumulative Return</h3>
          <ResponsiveContainer width="100%" height={260}><ComposedChart data={cumData}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="week" tick={{fontSize:11}}/><YAxis tickFormatter={v=>fmt.pct(v,1)} tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>fmt.pct(v)}/>}/><Legend/><Area type="monotone" dataKey="portfolio" fill="#1e3a5f" fillOpacity={0.08} stroke="#1e3a5f" strokeWidth={2} name="Portfolio"/><Line type="monotone" dataKey="benchmark" stroke="#94a3b8" strokeWidth={2} name="S&P 500" strokeDasharray="5 5"/></ComposedChart></ResponsiveContainer></Card>
        <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Weekly Attribution (Stacked)</h3>
          <ResponsiveContainer width="100%" height={260}><BarChart data={weeklyHistory}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="week" tick={{fontSize:11}}/><YAxis tickFormatter={v=>fmt.pct(v,1)} tick={{fontSize:11}}/><Tooltip content={<CustomTooltip formatter={v=>fmt.pct(v)}/>}/><Legend/><Bar dataKey="marketContrib" stackId="a" fill="#1e3a5f" name="Market"/><Bar dataKey="valueContrib" stackId="a" fill="#2563eb" name="Value"/><Bar dataKey="momentumContrib" stackId="a" fill="#7c3aed" name="Momentum"/><Bar dataKey="alpha" stackId="a" fill="#059669" name="Alpha"/></BarChart></ResponsiveContainer></Card>
      </div>
      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-3">Basket-Level Attribution</h3>
        <table className="w-full text-xs"><thead><tr className="bg-slate-50 border-b border-slate-200">{["Theme","Weight","Return","β Exp","Mkt Contrib","Alpha"].map(h=><th key={h} className="py-2 px-3 text-left font-semibold text-slate-500 uppercase">{h}</th>)}</tr></thead>
          <tbody>{basket.map(b=><tr key={b.theme} className="border-b border-slate-100 hover:bg-slate-50"><td className="py-2 px-3 font-semibold">{b.theme}</td><td className="py-2 px-3">{fmt.pct(b.bw,1)}</td><td className={`py-2 px-3 font-medium ${b.br>=0?"text-emerald-600":"text-red-500"}`}>{fmt.pct(b.br)}</td><td className="py-2 px-3">{fmt.num(b.me)}</td><td className="py-2 px-3">{fmt.pct(b.mc)}</td><td className={`py-2 px-3 font-medium ${b.al>=0?"text-emerald-600":"text-red-500"}`}>{fmt.pct(b.al)}</td></tr>)}</tbody></table></Card>
      <Card className="p-4"><h3 className="text-sm font-semibold text-slate-700 mb-2">Weekly Commentary</h3><p className="text-sm text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg border">{commentary}</p></Card>
    </div>
  );
}

// ═══════════════════════════════════════════════
// REPORT PAGE
// ═══════════════════════════════════════════════
function ReportPage({ holdings, settings }) {
  const active = holdings.filter(h => h.status === "active");
  const totalVal = active.reduce((s, h) => s + h.shares * h.currentPrice, 0);
  const comp = active.map(h => { const pv = h.shares * h.currentPrice; return { ...h, positionValue: pv, weight: pv / totalVal, pnlPercent: calc.pnlPercent(h.currentPrice, h.buyPrice), pnlDollar: calc.pnlDollar(h.currentPrice, h.buyPrice, h.shares) }; });
  const totalPnl = comp.reduce((s, h) => s + h.pnlDollar, 0);
  const portBeta = calc.portfolioBeta(comp);

  return (
    <div className="space-y-6">
      <SectionHeader title="Report Generation"><button onClick={()=>{setTimeout(()=>window.print(),300)}} className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-md hover:bg-slate-700 text-sm"><Printer size={16}/> Print / PDF</button></SectionHeader>
      <Card className="p-8 text-center"><div className="border-b-2 border-slate-800 pb-6 mb-6"><h1 className="text-2xl font-bold text-slate-800">NYU Stern Management Investment Fund</h1><h2 className="text-lg text-slate-600 mt-1">Thematic Investment Team — Portfolio Report</h2><p className="text-sm text-slate-500 mt-3">{new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</p></div></Card>
      <Card className="p-6"><h3 className="text-base font-bold text-slate-800 border-b pb-2 mb-4">Portfolio Overview</h3>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-4 text-center">{[{l:"Market Value",v:fmt.usd(totalVal)},{l:"Total PnL",v:fmt.usd(totalPnl)},{l:"Holdings",v:comp.length},{l:"Portfolio β",v:fmt.num(portBeta)},{l:"Daily VaR 95%",v:fmt.pct(calc.dailyVaR95(settings.portfolioVol))},{l:"Tracking Error",v:fmt.pct(calc.trackingError(portBeta,settings.benchmarkVol,calc.idiosyncraticVol(settings.portfolioVol,calc.systematicVol(portBeta,settings.benchmarkVol))))}].map(s=><div key={s.l}><p className="text-xs text-slate-500">{s.l}</p><p className="text-lg font-bold text-slate-800">{s.v}</p></div>)}</div></Card>
      <Card className="p-6"><h3 className="text-base font-bold text-slate-800 border-b pb-2 mb-4">Holdings Summary</h3>
        <table className="w-full text-xs"><thead><tr className="border-b border-slate-200">{["Ticker","Company","Theme","Weight","PnL %","Beta"].map(h=><th key={h} className="py-2 px-2 text-left font-semibold text-slate-500">{h}</th>)}</tr></thead>
          <tbody>{comp.sort((a,b)=>b.weight-a.weight).map(h=><tr key={h.id} className="border-b border-slate-100"><td className="py-1.5 px-2 font-semibold">{h.ticker}</td><td className="py-1.5 px-2 text-slate-600">{h.company}</td><td className="py-1.5 px-2">{h.theme}</td><td className="py-1.5 px-2">{fmt.pct(h.weight,1)}</td><td className={`py-1.5 px-2 ${h.pnlPercent>=0?"text-emerald-600":"text-red-500"}`}>{fmt.pct(h.pnlPercent)}</td><td className="py-1.5 px-2">{fmt.num(h.marketBeta)}</td></tr>)}</tbody></table></Card>
    </div>
  );
}

// ═══════════════════════════════════════════════
// SETTINGS PAGE
// ═══════════════════════════════════════════════
function SettingsPage({ settings, setSettings, holdings, setHoldings, weeklyHistory, setWeeklyHistory }) {
  const [showMethod, setShowMethod] = useState(false);
  const handleExport = () => { const d = JSON.stringify({holdings,settings,weeklyHistory},null,2); const b = new Blob([d],{type:"application/json"}); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href=u; a.download="stern_portfolio.json"; a.click(); URL.revokeObjectURL(u); };
  const handleImport = () => { const inp = document.createElement("input"); inp.type="file"; inp.accept=".json"; inp.onchange=e=>{ const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=ev=>{ try{const p=JSON.parse(ev.target.result);if(p.holdings)setHoldings(p.holdings);if(p.settings)setSettings(p.settings);if(p.weeklyHistory)setWeeklyHistory(p.weeklyHistory);}catch{alert("Invalid JSON");}}; r.readAsText(f);}; inp.click(); };
  const handleCSV = () => { const h=["ticker","company","theme","subTheme","buyPrice","currentPrice","shares","marketBeta","stopLossPct","status","entryDate"]; const csv=[h.join(","),...holdings.map(x=>h.map(k=>`"${x[k]??""}"`).join(","))].join("\n"); const b=new Blob([csv],{type:"text/csv"}); const u=URL.createObjectURL(b); const a=document.createElement("a"); a.href=u; a.download="holdings.csv"; a.click(); };
  const handleReset = () => { if(confirm("Reset to original data?")){ setHoldings(createSampleHoldings()); setSettings(createSampleSettings()); setWeeklyHistory(createWeeklyHistory()); }};

  return (
    <div className="space-y-6">
      <SectionHeader title="Settings & Assumptions" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-5"><h3 className="text-sm font-semibold text-slate-700 mb-4">Benchmark & Factor Inputs</h3>
          <div className="space-y-3">{[{l:"SPY Weekly Return",k:"spyWeeklyReturn"},{l:"Benchmark Vol",k:"benchmarkVol"},{l:"Portfolio Vol",k:"portfolioVol"},{l:"Risk-Free Rate",k:"riskFreeRate"},{l:"SL Warning Buffer",k:"stopLossWarningBuffer"}].map(p=>
            <div key={p.k} className="flex items-center gap-3"><label className="text-xs text-slate-500 w-36">{p.l}</label><input type="number" value={settings[p.k]} onChange={e=>setSettings({...settings,[p.k]:parseFloat(e.target.value)||0})} step="0.001" className="flex-1 px-2 py-1.5 text-sm border rounded"/></div>
          )}</div></Card>
        <Card className="p-5"><h3 className="text-sm font-semibold text-slate-700 mb-4">Compliance Limits</h3>
          <div className="space-y-3">{Object.entries(settings.limits).map(([k,v])=>
            <div key={k} className="flex items-center gap-3"><label className="text-xs text-slate-500 w-36 capitalize">{k.replace(/([A-Z])/g," $1")}</label><input type="number" value={v} onChange={e=>setSettings({...settings,limits:{...settings.limits,[k]:parseFloat(e.target.value)||0}})} step="0.01" className="flex-1 px-2 py-1.5 text-sm border rounded"/></div>
          )}</div></Card>
      </div>
      <Card className="p-5"><h3 className="text-sm font-semibold text-slate-700 mb-4">Data Management</h3>
        <div className="flex flex-wrap gap-3">
          <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-md text-sm"><Download size={14}/> Export JSON</button>
          <button onClick={handleImport} className="flex items-center gap-2 px-4 py-2 border rounded-md text-sm"><Upload size={14}/> Import JSON</button>
          <button onClick={handleCSV} className="flex items-center gap-2 px-4 py-2 border rounded-md text-sm"><Download size={14}/> Export CSV</button>
          <button onClick={handleReset} className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 rounded-md text-sm"><RefreshCw size={14}/> Reset Data</button>
        </div></Card>
      <Card className="p-5"><button onClick={()=>setShowMethod(!showMethod)} className="flex items-center gap-2 text-sm font-semibold text-slate-700">{showMethod?<ChevronDown size={16}/>:<ChevronRight size={16}/>} Methodology</button>
        {showMethod && <div className="mt-4 text-xs text-slate-600 space-y-1.5 bg-slate-50 p-4 rounded-lg leading-relaxed">
          <p><strong>Portfolio Beta:</strong> β_p = Σ(w_i × β_i)</p><p><strong>Risk Contribution:</strong> RC_i = (w_i × β_i) / β_p</p>
          <p><strong>Systematic Vol:</strong> σ_sys = β_p × σ_benchmark</p><p><strong>Idiosyncratic Vol:</strong> σ_idio = √(max(σ²_port − σ²_sys, 0))</p>
          <p><strong>Tracking Error:</strong> TE = √((β_p − 1)² × σ²_bench + σ²_idio)</p><p><strong>Daily VaR 95%:</strong> σ_ann / √252 × 1.645</p>
          <p><strong>Stop-Loss:</strong> 4σ framework — buyPrice × (1 − SL%)</p><p><strong>Compliance:</strong> BREACH if current/limit {">"} 100%, WARNING if {">"} 85%</p>
        </div>}</Card>
    </div>
  );
}

// ═══════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════
const NAV = [
  { id:"overview", label:"Overview", icon:Home }, { id:"holdings", label:"Holdings", icon:Briefcase },
  { id:"returns", label:"Returns", icon:TrendingUp }, { id:"risk", label:"Risk", icon:Shield },
  { id:"stoploss", label:"Stop-Loss", icon:AlertTriangle }, { id:"reports", label:"Reports", icon:FileText },
  { id:"settings", label:"Settings", icon:Settings },
];

export default function App() {
  const [page, setPage] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [holdings, setHoldings, hLoaded] = usePersistedState("stern-holdings-v2", createSampleHoldings());
  const [settings, setSettings, sLoaded] = usePersistedState("stern-settings-v2", createSampleSettings());
  const [weeklyHistory, setWeeklyHistory, wLoaded] = usePersistedState("stern-weekly-v2", createWeeklyHistory());
  const [priceLoading, setPriceLoading] = useState(false);
  const [lastPriceUpdate, setLastPriceUpdate] = useState(null);

  const refreshPrices = useCallback(async () => {
    setPriceLoading(true);
    try {
      const tickers = [...new Set(holdings.filter(h => h.status === "active" && h.ticker !== "^GSPC").map(h => h.ticker))];
      const prices = await fetchYahooPrices(tickers);
      if (Object.keys(prices).length > 0) {
        const updated = holdings.map(h => {
          if (prices[h.ticker] !== undefined) return { ...h, currentPrice: prices[h.ticker] };
          return h;
        });
        setHoldings(updated);
        setLastPriceUpdate(new Date().toLocaleTimeString());
      }
    } catch (e) { console.error("Price fetch error:", e); }
    setPriceLoading(false);
  }, [holdings, setHoldings]);

  if (!hLoaded || !sLoaded || !wLoaded) return (
    <div className="flex items-center justify-center h-screen bg-slate-50"><div className="text-center"><div className="w-8 h-8 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin mx-auto mb-3"></div><p className="text-sm text-slate-500">Loading portfolio...</p></div></div>
  );

  return (
    <div className="flex h-screen bg-slate-50 print:bg-white print:block" style={{ fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`@media print { .no-print { display: none !important; } } ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }`}</style>
      <div className={`no-print bg-white border-r border-slate-200 flex flex-col transition-all duration-200 ${sidebarOpen ? "w-48" : "w-14"}`}>
        <div className="p-3 border-b border-slate-200"><div className="flex items-center gap-2"><div className="w-8 h-8 bg-slate-800 rounded-lg flex items-center justify-center flex-shrink-0"><span className="text-white font-bold text-xs">S</span></div>{sidebarOpen && <div><p className="text-xs font-bold text-slate-800 truncate">NYU Stern MIF</p><p className="text-[10px] text-slate-500">Thematic Team</p></div>}</div></div>
        <nav className="flex-1 p-2 space-y-0.5">{NAV.map(n=><button key={n.id} onClick={()=>setPage(n.id)} className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition-all ${page===n.id?"bg-slate-800 text-white":"text-slate-600 hover:bg-slate-100"}`}><n.icon size={16} className="flex-shrink-0"/>{sidebarOpen && <span className="font-medium text-xs truncate">{n.label}</span>}</button>)}</nav>
        <div className="p-2 border-t border-slate-200"><button onClick={()=>setSidebarOpen(!sidebarOpen)} className="w-full text-center py-1.5 text-slate-400 hover:text-slate-600 text-xs">{sidebarOpen?"← Collapse":"→"}</button></div>
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="no-print bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
          <div><h1 className="text-lg font-bold text-slate-800">{NAV.find(n=>n.id===page)?.label}</h1><p className="text-xs text-slate-500">NYU Stern Management Investment Fund · Thematic Investment Team</p></div>
          <div className="flex items-center gap-3">
            {lastPriceUpdate && <span className="text-[10px] text-slate-400">Prices: {lastPriceUpdate}</span>}
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div><span className="text-xs text-slate-500">Auto-saved</span></div>
            <span className="text-xs text-slate-400">{new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6 print:p-0">
          {page === "overview" && <OverviewPage holdings={holdings} settings={settings} weeklyHistory={weeklyHistory} />}
          {page === "holdings" && <HoldingsPage holdings={holdings} setHoldings={setHoldings} settings={settings} priceLoading={priceLoading} onRefreshPrices={refreshPrices} />}
          {page === "returns" && <ReturnsPage holdings={holdings} settings={settings} weeklyHistory={weeklyHistory} />}
          {page === "risk" && <RiskPage holdings={holdings} settings={settings} setSettings={setSettings} />}
          {page === "stoploss" && <StopLossPage holdings={holdings} settings={settings} />}
          {page === "reports" && <ReportPage holdings={holdings} settings={settings} />}
          {page === "settings" && <SettingsPage settings={settings} setSettings={setSettings} holdings={holdings} setHoldings={setHoldings} weeklyHistory={weeklyHistory} setWeeklyHistory={setWeeklyHistory} />}
        </main>
      </div>
    </div>
  );
}