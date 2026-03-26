// lib/db.js — Turso (libSQL) cloud database
import { createClient } from "@libsql/client";
import { THEMATIC_HOLDINGS } from "./thematicSeed.js";

const GROUPS = ["thematic", "opportunistic", "systematic", "bond"];

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

const _inited = {};
async function init(group) {
  const g = GROUPS.includes(group) ? group : "thematic";
  if (_inited[g]) return;
  const db = getClient();
  const h = tbl(g,"holdings"), s = tbl(g,"settings"), w = tbl(g,"weekly_history"), r = tbl(g,"report");
  await db.batch([
    `CREATE TABLE IF NOT EXISTS ${h} (id TEXT PRIMARY KEY, ticker TEXT NOT NULL, company TEXT NOT NULL, theme TEXT NOT NULL, subTheme TEXT DEFAULT '', buyPrice REAL NOT NULL, currentPrice REAL NOT NULL, entryDate TEXT DEFAULT '', exitDate TEXT DEFAULT '', shares REAL NOT NULL, benchmarkWeight REAL DEFAULT 0, stopLossPct REAL DEFAULT 0.1, status TEXT DEFAULT 'active', notes TEXT DEFAULT '', marketBeta REAL DEFAULT 1.0, valueBeta REAL DEFAULT 0, momentumBeta REAL DEFAULT 0, weeklyReturn REAL DEFAULT 0, currentValue REAL DEFAULT 0, pnlFromExcel REAL DEFAULT 0, sellPrice REAL DEFAULT 0, costBasis REAL DEFAULT 0, sellTotal REAL DEFAULT 0, realizedPnl REAL DEFAULT 0, realizedPnlPct REAL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS ${s} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS ${w} (id INTEGER PRIMARY KEY AUTOINCREMENT, week TEXT, date TEXT, portfolioReturn REAL DEFAULT 0, benchmarkReturn REAL DEFAULT 0, marketContrib REAL DEFAULT 0, valueContrib REAL DEFAULT 0, momentumContrib REAL DEFAULT 0, alpha REAL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS ${r} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  ]);
  const count = await db.execute(`SELECT COUNT(*) as c FROM ${h}`);
  if (count.rows[0].c === 0) {
    if (g === "thematic") await seedThematic(db, g);
    else await seedEmpty(db, g);
  }
  _inited[g] = true;
}

async function seedEmpty(db, group) {
  const s = tbl(group,"settings"), r = tbl(group,"report");
  const defs = [["benchmarkVol","0.12"],["portfolioVol","0.15"],["riskFreeRate","0.045"],["spyWeeklyReturn","0"],["iveWeeklyReturn","0"],["mtumWeeklyReturn","0"],["warningThreshold","0.85"],["stopLossWarningBuffer","0.05"],["limits.dailyVaR95","0.025"],["limits.trackingError","0.06"],["limits.betaDeviation","0.30"],["limits.systematicVol","0.20"],["limits.maxStockWeight","0.10"],["limits.spyWeight","0.60"]];
  const stmts = defs.map(([k,v])=>({sql:`INSERT OR REPLACE INTO ${s} (key,value) VALUES (?,?)`,args:[k,v]}));
  stmts.push({sql:`INSERT OR REPLACE INTO ${r} (key,value) VALUES ('content',?)`,args:["# Weekly Report\n\nNo report yet."]});
  stmts.push({sql:`INSERT OR REPLACE INTO ${r} (key,value) VALUES ('meta',?)`,args:["{}"]});
  await db.batch(stmts);
}

async function seedThematic(db, group) {
  const h = tbl(group,"holdings"), s = tbl(group,"settings"), w = tbl(group,"weekly_history"), r = tbl(group,"report");
  const sql = `INSERT OR REPLACE INTO ${h} (id,ticker,company,theme,subTheme,buyPrice,currentPrice,entryDate,exitDate,shares,benchmarkWeight,stopLossPct,status,notes,marketBeta,valueBeta,momentumBeta,weeklyReturn,currentValue,pnlFromExcel,sellPrice,costBasis,sellTotal,realizedPnl,realizedPnlPct) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  const all = THEMATIC_HOLDINGS;
  for (let i=0;i<all.length;i+=20) { await db.batch(all.slice(i,i+20).map(args=>({sql,args}))); }

  const sd = [["benchmarkVol","0.122"],["portfolioVol","0.168"],["riskFreeRate","0.045"],["spyWeeklyReturn","-0.01508"],["iveWeeklyReturn","0.005"],["mtumWeeklyReturn","0.008"],["warningThreshold","0.85"],["stopLossWarningBuffer","0.05"],["limits.dailyVaR95","0.025"],["limits.trackingError","0.06"],["limits.betaDeviation","0.30"],["limits.systematicVol","0.20"],["limits.maxStockWeight","0.08"],["limits.spyWeight","0.50"]];
  await db.batch(sd.map(([k,v])=>({sql:`INSERT OR REPLACE INTO ${s} (key,value) VALUES (?,?)`,args:[k,v]})));

  const wh = [["W1","2025-12-09",0.012,0.008,0.007,0.002,0.001,0.002],["W2","2025-12-16",-0.005,-0.003,-0.003,-0.001,0,-0.001],["W3","2025-12-23",0.008,0.006,0.005,0.001,0.001,0.001],["W4","2026-01-06",0.015,0.01,0.009,0.002,0.002,0.002],["W5","2026-01-13",-0.018,-0.012,-0.011,-0.003,-0.002,-0.002],["W6","2026-01-20",0.006,0.005,0.004,0.001,0.001,0],["W7","2026-02-03",-0.01,-0.008,-0.007,-0.001,-0.001,-0.001],["W8","2026-02-10",0.003,0.002,0.002,0,0.001,0],["W9","2026-02-24",-0.008,-0.006,-0.005,-0.001,-0.001,-0.001],["W10","2026-03-03",-0.016,-0.015,-0.013,-0.001,-0.001,-0.001]];
  await db.batch(wh.map(args=>({sql:`INSERT INTO ${w} (week,date,portfolioReturn,benchmarkReturn,marketContrib,valueContrib,momentumContrib,alpha) VALUES (?,?,?,?,?,?,?,?)`,args})));

  await db.batch([
    {sql:`INSERT OR REPLACE INTO ${r} (key,value) VALUES ('content',?)`,args:["# Weekly Report — Thematic\n\nPortfolio: $811K | 60 active + 61 exited | Total Return: -2.48%"]},
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
  return {benchmarkVol:parseFloat(f.benchmarkVol)||0.122,portfolioVol:parseFloat(f.portfolioVol)||0.168,riskFreeRate:parseFloat(f.riskFreeRate)||0.045,spyWeeklyReturn:parseFloat(f.spyWeeklyReturn)||0,iveWeeklyReturn:parseFloat(f.iveWeeklyReturn)||0,mtumWeeklyReturn:parseFloat(f.mtumWeeklyReturn)||0,warningThreshold:parseFloat(f.warningThreshold)||0.85,stopLossWarningBuffer:parseFloat(f.stopLossWarningBuffer)||0.05,limits:{dailyVaR95:parseFloat(f["limits.dailyVaR95"])||0.025,trackingError:parseFloat(f["limits.trackingError"])||0.06,betaDeviation:parseFloat(f["limits.betaDeviation"])||0.3,systematicVol:parseFloat(f["limits.systematicVol"])||0.2,maxStockWeight:parseFloat(f["limits.maxStockWeight"])||0.08,spyWeight:parseFloat(f["limits.spyWeight"])||0.5}};
}

export async function saveSettings(s, group) {
  await init(group);const t=tbl(group,"settings");
  const flat={benchmarkVol:String(s.benchmarkVol),portfolioVol:String(s.portfolioVol),riskFreeRate:String(s.riskFreeRate),spyWeeklyReturn:String(s.spyWeeklyReturn),iveWeeklyReturn:String(s.iveWeeklyReturn),mtumWeeklyReturn:String(s.mtumWeeklyReturn),warningThreshold:String(s.warningThreshold),stopLossWarningBuffer:String(s.stopLossWarningBuffer),"limits.dailyVaR95":String(s.limits.dailyVaR95),"limits.trackingError":String(s.limits.trackingError),"limits.betaDeviation":String(s.limits.betaDeviation),"limits.systematicVol":String(s.limits.systematicVol),"limits.maxStockWeight":String(s.limits.maxStockWeight),"limits.spyWeight":String(s.limits.spyWeight)};
  await getClient().batch(Object.entries(flat).map(([k,v])=>({sql:`INSERT OR REPLACE INTO ${t} (key,value) VALUES (?,?)`,args:[k,v]})));
}

export async function getWeeklyHistory(group) {
  await init(group);
  const res = await getClient().execute(`SELECT * FROM ${tbl(group,"weekly_history")} ORDER BY id`);
  return res.rows;
}

export async function saveWeeklyHistory(rows, group) {
  await init(group);const t=tbl(group,"weekly_history");
  await getClient().execute(`DELETE FROM ${t}`);
  if(rows.length>0){const stmts=rows.map(r=>({sql:`INSERT INTO ${t} (week,date,portfolioReturn,benchmarkReturn,marketContrib,valueContrib,momentumContrib,alpha) VALUES (?,?,?,?,?,?,?,?)`,args:[r.week,r.date,r.portfolioReturn,r.benchmarkReturn,r.marketContrib,r.valueContrib,r.momentumContrib,r.alpha]}));for(let i=0;i<stmts.length;i+=20)await getClient().batch(stmts.slice(i,i+20));}
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
  await db.batch([`DELETE FROM ${tbl(group,"holdings")}`,`DELETE FROM ${tbl(group,"settings")}`,`DELETE FROM ${tbl(group,"weekly_history")}`,`DELETE FROM ${tbl(group,"report")}`]);
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
