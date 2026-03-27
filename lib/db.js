// lib/db.js — Turso (libSQL) cloud database
import { createClient } from "@libsql/client";
import {
  THEMATIC_WORKBOOK_ACTIVE_ROWS,
  THEMATIC_WORKBOOK_DAILY_HISTORY,
  THEMATIC_WORKBOOK_EXITED_ROWS,
  THEMATIC_WORKBOOK_SUMMARY,
  THEMATIC_WORKBOOK_WEEKLY_HISTORY,
} from "./thematicWorkbookData.js";

const GROUPS = ["thematic", "opportunistic", "systematic", "bond"];
const THEMATIC_SEED_VERSION = "2026-03-25-balance-v1";

let _client = null;
function getClient() {
  if (!_client) {
    _client = createClient({
      url: process.env.TURSO_DATABASE_URL || "file:stern_local.db",
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });
  }
  return _client;
}

function tbl(group, name) {
  const g = GROUPS.includes(group) ? group : "thematic";
  return `${g}_${name}`;
}

function buildThematicSeedHoldings() {
  return [
    ...THEMATIC_WORKBOOK_ACTIVE_ROWS.map((row) => [...row]),
    ...THEMATIC_WORKBOOK_EXITED_ROWS.map((row) => [...row]),
  ];
}

function parseWeekNumber(week) {
  const match = String(week || "").match(/^W(\d+)$/i);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function normalizeWeeklyHistory(rows) {
  const cleaned = rows
    .map((row, index) => ({
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

function weeklyHistorySignature(rows) {
  return JSON.stringify(rows.map((row) => [
    row.week,
    row.date,
    Number(row.portfolioReturn) || 0,
    Number(row.benchmarkReturn) || 0,
    Number(row.marketContrib) || 0,
    Number(row.valueContrib) || 0,
    Number(row.momentumContrib) || 0,
    Number(row.alpha) || 0,
  ]));
}

function normalizeDailyHistory(rows) {
  const cleaned = rows
    .map((row, index) => ({
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

function dailyHistorySignature(rows) {
  return JSON.stringify(rows.map((row) => [
    row.date,
    Number(row.portfolioValue) || 0,
    Number(row.benchmarkValue) || 0,
    Number(row.portfolioReturn) || 0,
    Number(row.benchmarkReturn) || 0,
    Number(row.marketContrib) || 0,
    Number(row.valueContrib) || 0,
    Number(row.momentumContrib) || 0,
    Number(row.alpha) || 0,
    row.sinceStart == null ? null : Number(row.sinceStart) || 0,
  ]));
}

async function writeWeeklyHistory(rows, group) {
  const t = tbl(group, "weekly_history");
  await getClient().execute(`DELETE FROM ${t}`);
  if (!rows.length) return;
  const stmts = rows.map((row) => ({
    sql: `INSERT INTO ${t} (week,date,portfolioReturn,benchmarkReturn,marketContrib,valueContrib,momentumContrib,alpha) VALUES (?,?,?,?,?,?,?,?)`,
    args: [
      row.week,
      row.date,
      row.portfolioReturn,
      row.benchmarkReturn,
      row.marketContrib,
      row.valueContrib,
      row.momentumContrib,
      row.alpha,
    ],
  }));
  for (let i = 0; i < stmts.length; i += 20) await getClient().batch(stmts.slice(i, i + 20));
}

async function writeDailyHistory(rows, group) {
  const t = tbl(group, "daily_history");
  await getClient().execute(`DELETE FROM ${t}`);
  if (!rows.length) return;
  const stmts = rows.map((row) => ({
    sql: `INSERT INTO ${t} (date,portfolioValue,benchmarkValue,portfolioReturn,benchmarkReturn,marketContrib,valueContrib,momentumContrib,alpha,sinceStart) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [
      row.date,
      row.portfolioValue,
      row.benchmarkValue,
      row.portfolioReturn,
      row.benchmarkReturn,
      row.marketContrib,
      row.valueContrib,
      row.momentumContrib,
      row.alpha,
      row.sinceStart,
    ],
  }));
  for (let i = 0; i < stmts.length; i += 20) await getClient().batch(stmts.slice(i, i + 20));
}

function summarizeSeedHoldings(rows) {
  const active = rows.filter((row) => row[12] === "active");
  const exited = rows.filter((row) => row[12] === "exited");
  const investedVal = active.reduce((sum, row) => sum + Number(row[9]) * Number(row[6]), 0);
  const unrealizedPnl = active.reduce((sum, row) => sum + (Number(row[6]) - Number(row[5])) * Number(row[9]), 0);
  const realizedPnl = exited.reduce((sum, row) => sum + Number(row[23] || row[19] || 0), 0);
  const totalCostBasis =
    active.reduce((sum, row) => sum + Number(row[9]) * Number(row[5]), 0) +
    exited.reduce((sum, row) => sum + Number(row[21] || (Number(row[9]) * Number(row[5]))), 0);
  return {
    activeCount: active.length,
    exitedCount: exited.length,
    totalVal: investedVal + Number(THEMATIC_WORKBOOK_SUMMARY.cashValue || 0),
    investedVal,
    totalReturnPct: totalCostBasis > 0 ? (unrealizedPnl + realizedPnl) / totalCostBasis : 0,
  };
}

async function ensureThematicSeed(db, group, holdingCount) {
  if (holdingCount === 0) {
    await seedThematic(db, group);
    return;
  }

  const settingsTable = tbl(group, "settings");
  const version = await db.execute({
    sql: `SELECT value FROM ${settingsTable} WHERE key = ?`,
    args: ["seedVersion"],
  });

  if (version.rows[0]?.value === THEMATIC_SEED_VERSION) return;

  await db.batch([
    `DELETE FROM ${tbl(group,"holdings")}`,
    `DELETE FROM ${settingsTable}`,
    `DELETE FROM ${tbl(group,"daily_history")}`,
    `DELETE FROM ${tbl(group,"weekly_history")}`,
    `DELETE FROM ${tbl(group,"report")}`,
  ]);
  await seedThematic(db, group);
}

const _inited = {};
async function init(group) {
  const g = GROUPS.includes(group) ? group : "thematic";
  if (_inited[g]) return;
  const db = getClient();
  const h = tbl(g,"holdings"), s = tbl(g,"settings"), d = tbl(g,"daily_history"), w = tbl(g,"weekly_history"), r = tbl(g,"report");
  await db.batch([
    `CREATE TABLE IF NOT EXISTS ${h} (id TEXT PRIMARY KEY, ticker TEXT NOT NULL, company TEXT NOT NULL, theme TEXT NOT NULL, subTheme TEXT DEFAULT '', buyPrice REAL NOT NULL, currentPrice REAL NOT NULL, entryDate TEXT DEFAULT '', exitDate TEXT DEFAULT '', shares REAL NOT NULL, benchmarkWeight REAL DEFAULT 0, stopLossPct REAL DEFAULT 0.1, status TEXT DEFAULT 'active', notes TEXT DEFAULT '', marketBeta REAL DEFAULT 1.0, valueBeta REAL DEFAULT 0, momentumBeta REAL DEFAULT 0, weeklyReturn REAL DEFAULT 0, currentValue REAL DEFAULT 0, pnlFromExcel REAL DEFAULT 0, sellPrice REAL DEFAULT 0, costBasis REAL DEFAULT 0, sellTotal REAL DEFAULT 0, realizedPnl REAL DEFAULT 0, realizedPnlPct REAL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS ${s} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS ${d} (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, portfolioValue REAL DEFAULT 0, benchmarkValue REAL DEFAULT 0, portfolioReturn REAL DEFAULT 0, benchmarkReturn REAL DEFAULT 0, marketContrib REAL DEFAULT 0, valueContrib REAL DEFAULT 0, momentumContrib REAL DEFAULT 0, alpha REAL DEFAULT 0, sinceStart REAL)`,
    `CREATE TABLE IF NOT EXISTS ${w} (id INTEGER PRIMARY KEY AUTOINCREMENT, week TEXT, date TEXT, portfolioReturn REAL DEFAULT 0, benchmarkReturn REAL DEFAULT 0, marketContrib REAL DEFAULT 0, valueContrib REAL DEFAULT 0, momentumContrib REAL DEFAULT 0, alpha REAL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS ${r} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  ]);
  const count = await db.execute(`SELECT COUNT(*) as c FROM ${h}`);
  const holdingCount = Number(count.rows[0]?.c || 0);
  if (g === "thematic") await ensureThematicSeed(db, g, holdingCount);
  else if (holdingCount === 0) await seedEmpty(db, g);
  _inited[g] = true;
}

async function seedEmpty(db, group) {
  const s = tbl(group,"settings"), r = tbl(group,"report");
  const defs = [["benchmarkVol","0.12"],["portfolioVol","0.15"],["riskFreeRate","0.045"],["spyWeeklyReturn","0"],["iveWeeklyReturn","0"],["mtumWeeklyReturn","0"],["cashBalance","0"],["warningThreshold","0.85"],["stopLossWarningBuffer","0.05"],["limits.dailyVaR95","0.025"],["limits.trackingError","0.06"],["limits.betaDeviation","0.30"],["limits.systematicVol","0.20"],["limits.maxStockWeight","0.10"],["limits.spyWeight","0.60"]];
  const stmts = defs.map(([k,v])=>({sql:`INSERT OR REPLACE INTO ${s} (key,value) VALUES (?,?)`,args:[k,v]}));
  stmts.push({sql:`INSERT OR REPLACE INTO ${r} (key,value) VALUES ('content',?)`,args:["# Weekly Report\n\nNo report yet."]});
  stmts.push({sql:`INSERT OR REPLACE INTO ${r} (key,value) VALUES ('meta',?)`,args:["{}"]});
  await db.batch(stmts);
}

async function seedThematic(db, group) {
  const h = tbl(group,"holdings"), s = tbl(group,"settings"), d = tbl(group,"daily_history"), w = tbl(group,"weekly_history"), r = tbl(group,"report");
  const sql = `INSERT OR REPLACE INTO ${h} (id,ticker,company,theme,subTheme,buyPrice,currentPrice,entryDate,exitDate,shares,benchmarkWeight,stopLossPct,status,notes,marketBeta,valueBeta,momentumBeta,weeklyReturn,currentValue,pnlFromExcel,sellPrice,costBasis,sellTotal,realizedPnl,realizedPnlPct) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  const all = buildThematicSeedHoldings();
  const summary = summarizeSeedHoldings(all);
  for (let i=0;i<all.length;i+=20) { await db.batch(all.slice(i,i+20).map(args=>({sql,args}))); }

  const sd = [
    ["benchmarkVol", String(THEMATIC_WORKBOOK_SUMMARY.benchmarkVol || 0.12)],
    ["portfolioVol", String(THEMATIC_WORKBOOK_SUMMARY.portfolioVol || 0.15)],
    ["riskFreeRate","0.045"],
    ["spyWeeklyReturn", String(THEMATIC_WORKBOOK_SUMMARY.spyWeeklyReturn || 0)],
    ["iveWeeklyReturn","0.005"],
    ["mtumWeeklyReturn","0.008"],
    ["cashBalance", String(THEMATIC_WORKBOOK_SUMMARY.cashValue || 0)],
    ["warningThreshold","0.85"],
    ["stopLossWarningBuffer","0.05"],
    ["limits.dailyVaR95","0.025"],
    ["limits.trackingError","0.06"],
    ["limits.betaDeviation","0.30"],
    ["limits.systematicVol","0.20"],
    ["limits.maxStockWeight","0.08"],
    ["limits.spyWeight","0.50"],
    ["seedVersion",THEMATIC_SEED_VERSION],
  ];
  await db.batch(sd.map(([k,v])=>({sql:`INSERT OR REPLACE INTO ${s} (key,value) VALUES (?,?)`,args:[k,v]})));

  const dh = THEMATIC_WORKBOOK_DAILY_HISTORY.map((row) => [
    row.date,
    row.portfolioValue,
    row.benchmarkValue,
    row.portfolioReturn,
    row.benchmarkReturn,
    row.marketContrib,
    row.valueContrib,
    row.momentumContrib,
    row.alpha,
    row.sinceStart,
  ]);
  await db.batch(dh.map(args=>({sql:`INSERT INTO ${d} (date,portfolioValue,benchmarkValue,portfolioReturn,benchmarkReturn,marketContrib,valueContrib,momentumContrib,alpha,sinceStart) VALUES (?,?,?,?,?,?,?,?,?,?)`,args})));

  const wh = THEMATIC_WORKBOOK_WEEKLY_HISTORY.map((row) => [
    row.week,
    row.date,
    row.portfolioReturn,
    row.benchmarkReturn,
    row.marketContrib,
    row.valueContrib,
    row.momentumContrib,
    row.alpha,
  ]);
  await db.batch(wh.map(args=>({sql:`INSERT INTO ${w} (week,date,portfolioReturn,benchmarkReturn,marketContrib,valueContrib,momentumContrib,alpha) VALUES (?,?,?,?,?,?,?,?)`,args})));

  await db.batch([
    {sql:`INSERT OR REPLACE INTO ${r} (key,value) VALUES ('content',?)`,args:[`# Weekly Report — Thematic\n\nPortfolio: $${Math.round(summary.totalVal / 1000)}K | ${summary.activeCount} active + ${summary.exitedCount} exited | Total Return: ${(summary.totalReturnPct * 100).toFixed(2)}%`]},
    {sql:`INSERT OR REPLACE INTO ${r} (key,value) VALUES ('meta',?)`,args:["{}"]},
  ]);
}
// ── CRUD (all async) ──

export async function getAllHoldings(group) {
  await init(group);
  const res = await getClient().execute(`SELECT * FROM ${tbl(group,"holdings")} ORDER BY status, theme, ticker`);
  return res.rows;
}

export async function upsertHolding(h, group) {
  await init(group);
  await getClient().execute({
    sql: `INSERT OR REPLACE INTO ${tbl(group,"holdings")} (id,ticker,company,theme,subTheme,buyPrice,currentPrice,entryDate,exitDate,shares,benchmarkWeight,stopLossPct,status,notes,marketBeta,valueBeta,momentumBeta,weeklyReturn,currentValue,pnlFromExcel,sellPrice,costBasis,sellTotal,realizedPnl,realizedPnlPct) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [h.id,h.ticker,h.company,h.theme,h.subTheme||"",h.buyPrice,h.currentPrice,h.entryDate||"",h.exitDate||"",h.shares,h.benchmarkWeight||0,h.stopLossPct||0.1,h.status||"active",h.notes||"",h.marketBeta||1,h.valueBeta||0,h.momentumBeta||0,h.weeklyReturn||0,h.currentValue||0,h.pnlFromExcel||0,h.sellPrice||0,h.costBasis||0,h.sellTotal||0,h.realizedPnl||0,h.realizedPnlPct||0]
  });
}

export async function deleteHolding(id, group) {
  await init(group);
  await getClient().execute({sql:`DELETE FROM ${tbl(group,"holdings")} WHERE id=?`,args:[id]});
}

export async function bulkUpdatePrices(updates, group) {
  await init(group);
  const stmts = updates.map(u=>({sql:`UPDATE ${tbl(group,"holdings")} SET currentPrice=?,currentValue=?,pnlFromExcel=? WHERE id=?`,args:[u.price,u.value,u.pnl,u.id]}));
  for (let i=0;i<stmts.length;i+=20) await getClient().batch(stmts.slice(i,i+20));
}

export async function getSettings(group) {
  await init(group);
  const res = await getClient().execute(`SELECT key,value FROM ${tbl(group,"settings")}`);
  const f={};for(const r of res.rows)f[r.key]=r.value;
  return {
    benchmarkVol:parseFloat(f.benchmarkVol)||0.122,
    portfolioVol:parseFloat(f.portfolioVol)||0.168,
    riskFreeRate:parseFloat(f.riskFreeRate)||0.045,
    spyWeeklyReturn:parseFloat(f.spyWeeklyReturn)||0,
    iveWeeklyReturn:parseFloat(f.iveWeeklyReturn)||0,
    mtumWeeklyReturn:parseFloat(f.mtumWeeklyReturn)||0,
    cashBalance:parseFloat(f.cashBalance)||0,
    warningThreshold:parseFloat(f.warningThreshold)||0.85,
    stopLossWarningBuffer:parseFloat(f.stopLossWarningBuffer)||0.05,
    limits:{
      dailyVaR95:parseFloat(f["limits.dailyVaR95"])||0.025,
      trackingError:parseFloat(f["limits.trackingError"])||0.06,
      betaDeviation:parseFloat(f["limits.betaDeviation"])||0.3,
      systematicVol:parseFloat(f["limits.systematicVol"])||0.2,
      maxStockWeight:parseFloat(f["limits.maxStockWeight"])||0.08,
      spyWeight:parseFloat(f["limits.spyWeight"])||0.5,
    },
  };
}

export async function saveSettings(s, group) {
  await init(group);const t=tbl(group,"settings");
  const flat={
    benchmarkVol:String(s.benchmarkVol),
    portfolioVol:String(s.portfolioVol),
    riskFreeRate:String(s.riskFreeRate),
    spyWeeklyReturn:String(s.spyWeeklyReturn),
    iveWeeklyReturn:String(s.iveWeeklyReturn),
    mtumWeeklyReturn:String(s.mtumWeeklyReturn),
    cashBalance:String(s.cashBalance || 0),
    warningThreshold:String(s.warningThreshold),
    stopLossWarningBuffer:String(s.stopLossWarningBuffer),
    "limits.dailyVaR95":String(s.limits.dailyVaR95),
    "limits.trackingError":String(s.limits.trackingError),
    "limits.betaDeviation":String(s.limits.betaDeviation),
    "limits.systematicVol":String(s.limits.systematicVol),
    "limits.maxStockWeight":String(s.limits.maxStockWeight),
    "limits.spyWeight":String(s.limits.spyWeight),
  };
  await getClient().batch(Object.entries(flat).map(([k,v])=>({sql:`INSERT OR REPLACE INTO ${t} (key,value) VALUES (?,?)`,args:[k,v]})));
}

export async function getWeeklyHistory(group) {
  await init(group);
  const res = await getClient().execute(`SELECT * FROM ${tbl(group,"weekly_history")} ORDER BY id`);
  const normalized = normalizeWeeklyHistory(res.rows);
  if (weeklyHistorySignature(res.rows) !== weeklyHistorySignature(normalized)) {
    await writeWeeklyHistory(normalized, group);
  }
  return normalized;
}

export async function saveWeeklyHistory(rows, group) {
  await init(group);
  await writeWeeklyHistory(normalizeWeeklyHistory(rows), group);
}

export async function getDailyHistory(group) {
  await init(group);
  const res = await getClient().execute(`SELECT * FROM ${tbl(group,"daily_history")} ORDER BY id`);
  const normalized = normalizeDailyHistory(res.rows);
  if (dailyHistorySignature(res.rows) !== dailyHistorySignature(normalized)) {
    await writeDailyHistory(normalized, group);
  }
  return normalized;
}

export async function saveDailyHistory(rows, group) {
  await init(group);
  await writeDailyHistory(normalizeDailyHistory(rows), group);
}

export async function getReport(group) {
  await init(group);const t=tbl(group,"report");
  const c=await getClient().execute({sql:`SELECT value FROM ${t} WHERE key='content'`,args:[]});
  const m=await getClient().execute({sql:`SELECT value FROM ${t} WHERE key='meta'`,args:[]});
  return {content:c.rows[0]?.value||"",meta:m.rows[0]?.value?JSON.parse(m.rows[0].value):{}};
}

export async function saveReport(content, meta, group) {
  await init(group);const t=tbl(group,"report");
  const stmts=[{sql:`INSERT OR REPLACE INTO ${t} (key,value) VALUES ('content',?)`,args:[content]}];
  if(meta)stmts.push({sql:`INSERT OR REPLACE INTO ${t} (key,value) VALUES ('meta',?)`,args:[JSON.stringify(meta)]});
  await getClient().batch(stmts);
}

export async function resetDatabase(group) {
  await init(group);const db=getClient();
  await db.batch([`DELETE FROM ${tbl(group,"holdings")}`,`DELETE FROM ${tbl(group,"settings")}`,`DELETE FROM ${tbl(group,"daily_history")}`,`DELETE FROM ${tbl(group,"weekly_history")}`,`DELETE FROM ${tbl(group,"report")}`]);
  _inited[group]=false;
  if(group==="thematic")await seedThematic(db,group);else await seedEmpty(db,group);
  _inited[group]=true;
}

// ─── Comments ───
let _commentsInited = false;
async function initComments() {
  if (_commentsInited) return;
  const db = getClient();
  await db.execute(`CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    page TEXT NOT NULL,
    grp TEXT NOT NULL DEFAULT 'thematic',
    username TEXT DEFAULT '',
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  _commentsInited = true;
}

export async function getComments(page, group) {
  await initComments();
  const db = getClient();
  const res = await db.execute({
    sql: `SELECT * FROM comments WHERE page = ? AND grp = ? ORDER BY created_at DESC`,
    args: [page, group || 'thematic'],
  });
  return res.rows;
}

export async function addComment(id, page, group, username, content) {
  await initComments();
  const db = getClient();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO comments (id, page, grp, username, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, page, group || 'thematic', username || '', content, now, now],
  });
}

export async function updateComment(id, content) {
  await initComments();
  const db = getClient();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE comments SET content = ?, updated_at = ? WHERE id = ?`,
    args: [content, now, id],
  });
}

export async function deleteComment(id) {
  await initComments();
  const db = getClient();
  await db.execute({ sql: `DELETE FROM comments WHERE id = ?`, args: [id] });
}

export { GROUPS };
