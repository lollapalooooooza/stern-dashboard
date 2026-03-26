// lib/db.js — Turso (libSQL) cloud database
import { createClient } from "@libsql/client";

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
  const all = [["b1", "SPY", "S&P 500 ETF (Benchmark)", "Benchmark", "Benchmark", 585, 585, "2025-11-17", "", 650.47, 0.4629, 0.031, "active", "Core 46.29%", 1, 0, 0, -0.015, 380528, 0, 0, 0, 0, 0, 0], ["a1", "DIS", "Walt Disney (Adtech)", "Adtech", "Adtech", 105.8, 49.76, "2025-11-17", "", 78, 0, 0.082, "active", "Media", 1.026, 0, 0, 0, 3882, -118, 0, 0, 0, 0, 0], ["1", "BABA", "Alibaba Group", "AI-Industrial", "AI-Industrial", 156.9, 132.64, "2025-12-03", "", 30, 0, 0.111, "active", "AI cloud", 1.031, 0, 0, 0, 3979, -728, 0, 0, 0, 0, 0], ["2", "BE", "Bloom Energy", "AI-Industrial", "AI-Industrial", 100.02, 58.18, "2025-12-03", "", 48, 0, 0.267, "active", "Fuel cells", 2.078, 0, 0, 0, 2793, 946, 0, 0, 0, 0, 0], ["3", "CSIQ", "Canadian Solar", "AI-Industrial", "AI-Industrial", 24.39, 8.38, "2025-12-03", "", 197, 0, 0.191, "active", "Solar", 1.498, 0, 0, 0, 1650, -753, 0, 0, 0, 0, 0], ["4", "GOOG", "Alphabet Inc", "AI-Industrial", "AI-Industrial", 314.89, 306.01, "2025-12-03", "", 15, 0, 0.056, "active", "AI/Cloud", 1.249, 0, 0, 0, 4590, -133, 0, 0, 0, 0, 0], ["5", "IREN", "Iris Energy", "AI-Industrial", "AI-Industrial", 42.18, 38.84, "2025-12-03", "", 114, 0, 0.296, "active", "AI DC", 2.477, 0, 0, 0, 4428, -381, 0, 0, 0, 0, 0], ["6", "LITE", "Lumentum", "AI-Industrial", "AI-Industrial", 289.04, 640.69, "2025-12-03", "", 16, 0, 0.257, "active", "Photonics", 1.723, 0, 0, 0, 10251, 5620, 0, 0, 0, 0, 0], ["7", "NBIS", "Nebius Group", "AI-Industrial", "AI-Industrial", 93.06, 94.94, "2025-12-03", "", 52, 0, 0.254, "active", "AI infra", 2.751, 0, 0, 0, 4937, 98, 0, 0, 0, 0, 0], ["8", "NVDA", "NVIDIA", "AI-Industrial", "AI-Industrial", 179.87, 182.65, "2025-12-03", "", 27, 0, 0.094, "active", "AI compute", 2.179, 0, 0, 0, 4932, 75, 0, 0, 0, 0, 0], ["9", "TSLA", "Tesla", "AI-Industrial", "AI-Industrial", 438.28, 398.68, "2025-12-03", "", 11, 0, 0.09, "active", "AI/EV", 2.031, 0, 0, 0, 4385, -436, 0, 0, 0, 0, 0], ["10", "TSM", "Taiwan Semi", "AI-Industrial", "AI-Industrial", 287.96, 348.7, "2025-12-03", "", 17, 0, 0.094, "active", "Foundry", 1.373, 0, 0, 0, 5928, 1033, 0, 0, 0, 0, 0], ["11", "BE", "Bloom Energy (Bat)", "Battery", "Battery", 110.77, 168.52, "2025-12-08", "", 26.73, 0, 0.267, "active", "Battery", 2.078, 0, 0, 0, 4504, 1526, 0, 0, 0, 0, 0], ["12", "CSIQ", "Canadian Solar (Bat)", "Battery", "Battery", 23.77, 4.9, "2025-12-08", "", 336.56, 0, 0.191, "active", "Battery", 1.498, 0, 0, 0, 1650, -753, 0, 0, 0, 0, 0], ["14", "APLD", "Applied Digital", "Digital Infra", "Digital Infra", 29.18, 27.03, "2026-02-05", "", 277.587, 0, 0.312, "active", "AI DC", 2.548, 0, 0, 0, 7503, -597, 0, 0, 0, 0, 0], ["15", "AWK", "American Water", "Digital Infra", "Digital Infra", 128.52, 137.73, "2025-12-08", "", 62.247, 0, 0.061, "active", "Water", 0.371, 0, 0, 0, 8573, 573, 0, 0, 0, 0, 0], ["16", "CIEN", "Ciena Corp", "Digital Infra", "Digital Infra", 209.12, 310.43, "2025-12-08", "", 39.255, 0, 0.193, "active", "Optical", 1.464, 0, 0, 0, 12186, 4186, 0, 0, 0, 0, 0], ["17", "DBRG", "DigitalBridge", "Digital Infra", "Digital Infra", 14.66, 15.38, "2025-12-08", "", 545.702, 0, 0.008, "active", "Infra mgr", 1.615, 0, 0, 0, 8393, 393, 0, 0, 0, 0, 0], ["18", "DLR", "Digital Realty", "Digital Infra", "Digital Infra", 163, 179.65, "2025-12-08", "", 49.079, 0, 0.061, "active", "DC REIT", 0.894, 0, 0, 0, 8817, 817, 0, 0, 0, 0, 0], ["19", "EQIX", "Equinix", "Digital Infra", "Digital Infra", 741.51, 944.91, "2025-12-08", "", 10.788, 0, 0.087, "active", "Colo", 0.858, 0, 0, 0, 10194, 2194, 0, 0, 0, 0, 0], ["20", "NEE", "NextEra", "Digital Infra", "Digital Infra", 82.12, 92.01, "2025-12-08", "", 97.423, 0, 0.055, "active", "Renewables", 0.569, 0, 0, 0, 8964, 964, 0, 0, 0, 0, 0], ["21", "PWR", "Quanta", "Digital Infra", "Digital Infra", 465.62, 568.04, "2025-12-08", "", 17.181, 0, 0.097, "active", "Infra", 1.195, 0, 0, 0, 9759, 1760, 0, 0, 0, 0, 0], ["22", "VRT", "Vertiv", "Digital Infra", "Digital Infra", 184.17, 264.35, "2025-12-08", "", 43.438, 0, 0.191, "active", "DC cooling", 2.073, 0, 0, 0, 11483, 3483, 0, 0, 0, 0, 0], ["23", "XYL", "Xylem", "Digital Infra", "Digital Infra", 139.22, 123.52, "2025-12-08", "", 57.462, 0, 0.084, "active", "Water tech", 1.023, 0, 0, 0, 7098, -902, 0, 0, 0, 0, 0], ["24", "ABNB", "Airbnb", "Experientials", "Experientials", 119.96, 134.03, "2025-12-04", "", 66.686, 0, 0.093, "active", "Travel", 1.552, 0, 0, 0, 8938, 938, 0, 0, 0, 0, 0], ["25", "DIS", "Disney (Exp)", "Experientials", "Experientials", 104.76, 50.83, "2025-12-04", "", 76.365, 0, 0.082, "active", "Parks", 1.026, 0, 0, 0, 3882, -118, 0, 0, 0, 0, 0], ["26", "H", "Hyatt Hotels", "Experientials", "Experientials", 156.13, 155.72, "2025-12-04", "", 51.239, 0, 0.102, "active", "Hotels", 1.204, 0, 0, 0, 7979, -21, 0, 0, 0, 0, 0], ["27", "LYV", "Live Nation", "Experientials", "Experientials", 138.12, 165.8, "2025-12-04", "", 57.919, 0, 0.08, "active", "Entertainment", 1.123, 0, 0, 0, 9603, 1603, 0, 0, 0, 0, 0], ["28", "MAR", "Marriott", "Experientials", "Experientials", 297.33, 328.86, "2025-12-04", "", 26.906, 0, 0.082, "active", "Hotels", 1.089, 0, 0, 0, 8848, 848, 0, 0, 0, 0, 0], ["29", "MSGE", "MSG Entertain", "Experientials", "Experientials", 50.76, 58.85, "2025-12-04", "", 157.591, 0, 0.077, "active", "Venues", 0.921, 0, 0, 0, 9274, 1274, 0, 0, 0, 0, 0], ["30", "NCLH", "Norwegian Cruise", "Experientials", "Experientials", 18.68, 20.71, "2025-12-04", "", 428.38, 0, 0.177, "active", "Cruise", 1.89, 0, 0, 0, 8872, 872, 0, 0, 0, 0, 0], ["31", "RCL", "Royal Caribbean", "Experientials", "Experientials", 260.22, 290.55, "2025-12-04", "", 30.743, 0, 0.162, "active", "Cruise", 1.64, 0, 0, 0, 8932, 932, 0, 0, 0, 0, 0], ["32", "TKO", "TKO Group", "Experientials", "Experientials", 197.32, 204.07, "2025-12-04", "", 40.542, 0, 0.095, "active", "WWE+UFC", 0.632, 0, 0, 0, 8273, 274, 0, 0, 0, 0, 0], ["33", "BWXT", "BWX Tech", "Nuclear", "Nuclear", 169.54, 200.39, "2025-11-21", "", 47.186, 0, 0.126, "active", "Nuclear", 0.834, 0, 0, 0, 9456, 1456, 0, 0, 0, 0, 0], ["34", "EXC", "Exelon", "Nuclear", "Nuclear", 45.63, 49.14, "2025-11-21", "", 175.334, 0, 0.058, "active", "Utility", 0.349, 0, 0, 0, 8616, 616, 0, 0, 0, 0, 0], ["35", "GE", "GE Aerospace", "Nuclear", "Nuclear", 285.48, 321.93, "2025-11-21", "", 28.022, 0, 0.088, "active", "Aerospace", 1.069, 0, 0, 0, 9021, 1021, 0, 0, 0, 0, 0], ["36", "AXP", "Amex", "Payments", "Payments", 346.855, 305.35, "2026-01-30", "", 12.914, 0, 0.091, "active", "Finance", 1.196, 0, 0, 0, 3944, -535, 0, 0, 0, 0, 0], ["37", "MA", "Mastercard", "Payments", "Payments", 542.53, 517.67, "2025-12-04", "", 14.745, 0, 0.068, "active", "Payments", 0.949, 0, 0, 0, 7634, -366, 0, 0, 0, 0, 0], ["38", "V", "Visa", "Payments", "Payments", 324.6, 315.97, "2025-12-04", "", 24.645, 0, 0.064, "active", "Payments", 0.861, 0, 0, 0, 7787, -213, 0, 0, 0, 0, 0], ["39", "ALRM", "Alarm.com", "Security", "Security", 52.71, 49.58, "2025-12-11", "", 151.773, 0, 0.081, "active", "Security", 1.111, 0, 0, 0, 7525, -475, 0, 0, 0, 0, 0], ["40", "MSI", "Motorola Sol", "Security", "Security", 367.47, 458.03, "2025-11-24", "", 22, 0, 0.063, "active", "Safety", 0.764, 0, 0, 0, 10077, 1992, 0, 0, 0, 0, 0], ["41", "OSIS", "OSI Systems", "Security", "Security", 254.66, 282.16, "2025-11-24", "", 32, 0, 0.11, "active", "Screening", 0.89, 0, 0, 0, 9029, 880, 0, 0, 0, 0, 0], ["42", "RTX", "RTX Corp", "Security", "Security", 172.14, 208.23, "2025-11-24", "", 47, 0, 0.07, "active", "Defense", 0.6, 0, 0, 0, 9787, 1696, 0, 0, 0, 0, 0], ["43", "ABBV", "AbbVie", "Silver Economy", "Silver", 223.04, 227.42, "2025-12-04", "", 17.937, 0, 0.072, "active", "Immunology", 0.34, 0, 0, 0, 4080, 69, 0, 0, 0, 0, 0], ["44", "ABT", "Abbott Labs", "Silver Economy", "Silver", 121.51, 112.64, "2025-12-04", "", 32.919, 0, 0.077, "active", "Med devices", 0.542, 0, 0, 0, 3708, -303, 0, 0, 0, 0, 0], ["45", "ADUS", "Addus HomeCare", "Silver Economy", "Silver", 110.61, 102.87, "2025-12-04", "", 48.255, 0, 0.099, "active", "Home health", 0.722, 0, 0, 0, 4964, -394, 0, 0, 0, 0, 0], ["46", "AMGN", "Amgen", "Silver Economy", "Silver", 316.88, 377.06, "2025-12-04", "", 12.623, 0, 0.087, "active", "Biotech", 0.447, 0, 0, 0, 4758, 728, 0, 0, 0, 0, 0], ["47", "DXCM", "DexCom", "Silver Economy", "Silver", 65.3, 68.74, "2025-12-04", "", 67.425, 0, 0.088, "active", "CGM", 1.15, 0, 0, 0, 4635, 235, 0, 0, 0, 0, 0], ["48", "EHAB", "Enhabit Health", "Silver Economy", "Silver", 9.49, 13.66, "2025-12-04", "", 562.325, 0, 0.159, "active", "Home health", 0.712, 0, 0, 0, 7681, 2353, 0, 0, 0, 0, 0], ["49", "LLY", "Eli Lilly", "Silver Economy", "Silver", 993.65, 1008.38, "2025-12-04", "", 4.026, 0, 0.116, "active", "GLP-1", 0.589, 0, 0, 0, 4060, 51, 0, 0, 0, 0, 0], ["50", "MDT", "Medtronic", "Silver Economy", "Silver", 100.53, 91.34, "2025-12-04", "", 39.8, 0, 0.056, "active", "Med devices", 0.56, 0, 0, 0, 3635, -374, 0, 0, 0, 0, 0], ["51", "SYK", "Stryker", "Silver Economy", "Silver", 351.47, 365.93, "2025-12-04", "", 11.38, 0, 0.06, "active", "Ortho", 0.849, 0, 0, 0, 4164, 151, 0, 0, 0, 0, 0], ["52", "TNL", "Travel+Leisure", "Silver Economy", "Silver", 68.34, 71.47, "2025-12-04", "", 78.193, 0, 0.078, "active", "Vacation", 1.35, 0, 0, 0, 5588, 260, 0, 0, 0, 0, 0], ["53", "VTR", "Ventas", "Silver Economy", "Silver", 80.72, 86.18, "2025-12-04", "", 66.1, 0, 0.045, "active", "HC REIT", 0.588, 0, 0, 0, 5698, 361, 0, 0, 0, 0, 0], ["54", "WELL", "Welltower", "Silver Economy", "Silver", 205.2, 207.78, "2025-12-04", "", 26.763, 0, 0.052, "active", "Senior", 0.57, 0, 0, 0, 5558, 60, 0, 0, 0, 0, 0], ["55", "CLH", "Clean Harbors", "Waste", "Waste", 235.64, 285.9, "2025-12-10", "", 33.949, 0, 0.059, "active", "Haz waste", 0.914, 0, 0, 0, 9706, 1706, 0, 0, 0, 0, 0], ["56", "DAR", "Darling Ingred", "Waste", "Waste", 33.15, 51.93, "2025-12-10", "", 227.599, 0, 0.063, "active", "Rendering", 1.059, 0, 0, 0, 11817, 3817, 0, 0, 0, 0, 0], ["57", "RSG", "Republic Svc", "Waste", "Waste", 208.71, 230.14, "2025-12-10", "", 38.33, 0, 0.042, "active", "Hauling", 0.433, 0, 0, 0, 8821, 821, 0, 0, 0, 0, 0], ["58", "TTEK", "Tetra Tech", "Waste", "Waste", 33.52, 35.14, "2025-12-10", "", 238.664, 0, 0.131, "active", "Environmental", 0.914, 0, 0, 0, 8387, 387, 0, 0, 0, 0, 0], ["59", "WM", "Waste Mgmt", "Waste", "Waste", 209.1, 246.52, "2025-12-10", "", 38.259, 0, 0.047, "active", "Hauler", 0.375, 0, 0, 0, 9431, 1431, 0, 0, 0, 0, 0], ["60", "NOW", "ServiceNow", "Legacy Software", "Legacy Software", 102.945, 121.92, "2026-02-24", "", 77.711, 0, 0.1, "active", "IT", 1.3, 0, 0, 0, 9475, 1475, 0, 0, 0, 0, 0], ["61", "RDDT", "Reddit", "Legacy Software", "Legacy Software", 141.65, 138.86, "2026-02-24", "", 56.477, 0, 0.12, "active", "Social", 1.5, 0, 0, 0, 7842, -1644, 0, 0, 0, 0, 0], ["62", "SNOW", "Snowflake", "Legacy Software", "Legacy Software", 159.69, 182.85, "2026-02-24", "", 50.096, 0, 0.12, "active", "Cloud", 1.8, 0, 0, 0, 9160, 1160, 0, 0, 0, 0, 0], ["ex1", "NFLX", "NFLX (Exited)", "Adtech", "Adtech", 110.77, 80.94, "2025-11-17", "2026-02-05", 74, 0, 0, "exited", "Realized: -$2,208", 1, 0, 0, 0, 5989.19, -2207.79, 80.94, 8196.98, 5989.19, -2207.79, -0.269], ["ex2", "DIS", "DIS (Exited Ad)", "Adtech", "Adtech", 105.8, 105.27, "2025-11-17", "2026-02-05", 78, 0, 0, "exited", "Realized: -$42", 1, 0, 0, 0, 8210.67, -41.73, 105.27, 8252.4, 8210.67, -41.73, -0.005], ["ex3", "PSKY", "PSKY (Exited)", "Adtech", "Adtech", 15.72, 10.5, "2025-11-17", "2026-02-05", 526, 0, 0, "exited", "Realized: -$2,745", 1, 0, 0, 0, 5523.54, -2745.18, 10.5, 8268.72, 5523.54, -2745.18, -0.332], ["ex4", "SPOT", "SPOT (Exited)", "Adtech", "Adtech", 632.89, 4.08, "2025-11-17", "2026-02-05", 13, 0, 0, "exited", "Realized: -$2,921", 1, 0, 0, 0, 5306.86, -2920.71, 4.08, 8227.57, 5306.86, -2920.71, -0.355], ["ex5", "FOX", "FOX (Exited)", "Adtech", "Adtech", 58.98, 58.89, "2025-12-02", "2026-02-05", 136, 0, 0, "exited", "Realized: -$13", 1, 0, 0, 0, 8008.36, -12.92, 58.89, 8021.28, 8008.36, -12.92, -0.002], ["ex6", "ROKU", "ROKU (Exited)", "Adtech", "Adtech", 99.09, 84.29, "2025-11-17", "2026-02-05", 82, 0, 0, "exited", "Realized: -$1,214", 1, 0, 0, 0, 6911.79, -1213.59, 84.29, 8125.38, 6911.79, -1213.59, -0.149], ["ex7", "DV", "DV (Exited)", "Adtech", "Adtech", 10.48, 9.42, "2025-11-17", "2026-02-05", 792, 0, 0, "exited", "Realized: -$843", 1, 0, 0, 0, 7456.68, -843.48, 9.42, 8300.16, 7456.68, -843.48, -0.102], ["ex8", "TTD", "TTD (Exited)", "Adtech", "Adtech", 41.84, 26.12, "2025-11-17", "2026-02-05", 197, 0, 0, "exited", "Realized: -$3,098", 1, 0, 0, 0, 5144.66, -3097.82, 26.12, 8242.48, 5144.66, -3097.82, -0.376], ["ex9", "APP", "APP (Exited Ad)", "Adtech", "Adtech", 554.12, 373.62, "2025-11-17", "2026-02-05", 15, 0, 0, "exited", "Realized: -$2,708", 1, 0, 0, 0, 5604.23, -2707.57, 373.62, 8311.8, 5604.23, -2707.57, -0.326], ["ex10", "U", "U (Exited)", "Adtech", "Adtech", 44.93, 22.92, "2025-12-02", "2026-02-05", 179, 0, 0, "exited", "Realized: -$3,940", 1, 0, 0, 0, 4102.5, -3939.97, 22.92, 8042.47, 4102.5, -3939.97, -0.49], ["ex11", "EOSE", "EOSE (Exited)", "Batteries", "Batteries", 12.94, 11.23, "2025-11-21", "2026-02-05", 618.476, 0, 0, "exited", "Realized: -$1,059", 1, 0, 0, 0, 6941.39, -1058.6, 11.23, 7999.99, 6941.39, -1058.6, -0.132], ["ex12", "ENPH", "ENPH (Exited)", "Batteries", "Batteries", 26.16, 47.25, "2025-11-21", "2026-02-05", 305.809, 0, 0, "exited", "Realized: +$6,448", 1, 0, 0, 0, 14447.98, 6448, 47.25, 7999.98, 14447.98, 6448, 0.806], ["ex13", "STEM", "STEM (Exited)", "Batteries", "Batteries", 13.78, 11.91, "2025-11-21", "2026-02-05", 580.76, 0, 0, "exited", "Realized: -$1,083", 1, 0, 0, 0, 6917.21, -1082.8, 11.91, 8000.01, 6917.21, -1082.8, -0.135], ["ex14", "MVST", "MVST (Exited)", "Batteries", "Batteries", 3.67, 2.39, "2025-12-08", "2026-02-05", 2177.166, 0, 0, "exited", "Realized: -$2,807", 1, 0, 0, 0, 5192.55, -2807.45, 2.39, 8000, 5192.55, -2807.45, -0.351], ["ex15", "ENS", "ENS (Exited)", "Batteries", "Batteries", 147.01, 159.22, "2025-12-08", "2026-02-05", 54.417, 0, 0, "exited", "Realized: +$664", 1, 0, 0, 0, 8664.27, 664.41, 159.22, 7999.86, 8664.27, 664.41, 0.083], ["ex16", "SEDG", "SEDG (Exited)", "Batteries", "Batteries", 30.34, 33.2, "2025-12-08", "2026-02-05", 263.678, 0, 0, "exited", "Realized: +$754", 1, 0, 0, 0, 8754.11, 754.12, 33.2, 7999.99, 8754.11, 754.12, 0.094], ["ex17", "CSIQ", "CSIQ (Exited Bat)", "Batteries", "Batteries", 23.77, 18.92, "2025-12-08", "2026-02-05", 336.56, 0, 0, "exited", "Realized: -$1,632", 1, 0, 0, 0, 6367.71, -1632.27, 18.92, 7999.98, 6367.71, -1632.27, -0.204], ["ex18", "YOU", "YOU (Exited)", "Security", "Security", 36.34, 33.37, "2025-11-24", "2026-02-10", 222.864, 0, 0, "exited", "Realized: -$664", 1, 0, 0, 0, 7435.86, -664.13, 33.37, 8099.99, 7435.86, -664.13, -0.082], ["ex19", "LDOS", "LDOS (Exited)", "Security", "Security", 186.85, 171.32, "2025-11-24", "2026-02-23", 43, 0, 0, "exited", "Realized: -$668", 1, 0, 0, 0, 7366.98, -667.57, 171.32, 8034.55, 7366.98, -667.57, -0.083], ["ex20", "EVLV", "EVLV (Exited)", "Security", "Security", 6.04, 5.62, "2025-11-24", "2026-02-10", 1335, 0, 0, "exited", "Realized: -$561", 1, 0, 0, 0, 7496.03, -561.41, 5.62, 8057.44, 7496.03, -561.41, -0.07], ["ex21", "CCJ", "CCJ (Exited)", "Nuclear", "Nuclear", 79.92, 110.15, "2025-11-21", "2026-02-05", 100.093, 0, 0, "exited", "Realized: +$3,025", 1, 0, 0, 0, 11025.24, 3025.31, 110.15, 7999.93, 11025.24, 3025.31, 0.378], ["ex22", "UEC", "UEC (Exited)", "Nuclear", "Nuclear", 10.66, 15.2, "2025-11-21", "2026-02-05", 750.821, 0, 0, "exited", "Realized: +$3,409", 1, 0, 0, 0, 11408.73, 3408.73, 15.2, 8000, 11408.73, 3408.73, 0.426], ["ex23", "UUUU", "UUUU (Exited)", "Nuclear", "Nuclear", 12.59, 20.1, "2025-11-21", "2026-02-05", 635.172, 0, 0, "exited", "Realized: +$4,764", 1, 0, 0, 0, 12763.79, 4763.8, 20.1, 7999.99, 12763.79, 4763.8, 0.596], ["ex24", "LEU", "LEU (Exited)", "Nuclear", "Nuclear", 236.04, 202.89, "2025-11-21", "2026-02-12", 33.893, 0, 0, "exited", "Realized: -$1,123", 1, 0, 0, 0, 6876.55, -1123.39, 202.89, 7999.94, 6876.55, -1123.39, -0.14], ["ex25", "CEG", "CEG (Exited Nuc)", "Nuclear", "Nuclear", 337.79, 245.44, "2025-11-21", "2026-02-05", 23.683, 0, 0, "exited", "Realized: -$2,187", 1, 0, 0, 0, 5812.76, -2187.22, 245.44, 7999.98, 5812.76, -2187.22, -0.273], ["ex26", "DKNG", "DKNG (Exited)", "Sports", "Sports", 29.52, 21.76, "2025-12-03", "2026-02-17", 507.97, 0, 0, "exited", "Realized: -$3,942", 1, 0, 0, 0, 11053.47, -3942.35, 21.76, 14995.82, 11053.47, -3942.35, -0.263], ["ex27", "FLUT", "FLUT (Exited)", "Sports", "Sports", 176.12, 126.13, "2025-12-03", "2026-02-17", 86.837, 0, 0, "exited", "Realized: -$4,341", 1, 0, 0, 0, 10952.75, -4341.23, 126.13, 15293.98, 10952.75, -4341.23, -0.284], ["ex28", "CHDN", "CHDN (Exited)", "Sports", "Sports", 111.21, 93.85, "2025-12-03", "2026-02-05", 71, 0, 0, "exited", "Realized: -$1,232", 1, 0, 0, 0, 6663.36, -1232.33, 93.85, 7895.69, 6663.36, -1232.33, -0.156], ["ex29", "MGM", "MGM (Exited)", "Sports", "Sports", 35.47, 34.06, "2025-12-03", "2026-02-17", 226, 0, 0, "exited", "Realized: -$318", 1, 0, 0, 0, 7697.56, -317.76, 34.06, 8015.32, 7697.56, -317.76, -0.04], ["ex30", "PENN", "PENN (Exited)", "Sports", "Sports", 14.64, 12.32, "2025-12-03", "2026-02-05", 547, 0, 0, "exited", "Realized: -$1,268", 1, 0, 0, 0, 6738.04, -1268.4, 12.32, 8006.44, 6738.04, -1268.4, -0.158], ["ex31", "SRAD", "SRAD (Exited)", "Sports", "Sports", 19.41, 16.59, "2025-12-03", "2026-02-17", 772.133, 0, 0, "exited", "Realized: -$2,175", 1, 0, 0, 0, 12809.69, -2175.36, 16.59, 14985.05, 12809.69, -2175.36, -0.145], ["ex32", "GENI", "GENI (Exited)", "Sports", "Sports", 11.06, 6.29, "2025-12-03", "2026-02-05", 726, 0, 0, "exited", "Realized: -$3,469", 1, 0, 0, 0, 4563.04, -3469.06, 6.29, 8032.1, 4563.04, -3469.06, -0.432], ["ex33", "MSGS", "MSGS (Exited)", "Sports", "Sports", 224.2, 276.3, "2025-12-03", "2026-02-05", 36, 0, 0, "exited", "Realized: +$1,876", 1, 0, 0, 0, 9946.8, 1875.72, 276.3, 8071.08, 9946.8, 1875.72, 0.232], ["ex34", "BKD", "BKD (Exited)", "Silver Economy", "Silver Economy", 10.59, 15.42, "2025-12-04", "2026-02-05", 336.343, 0, 0, "exited", "Realized: +$1,622", 1, 0, 0, 0, 5184.73, 1621.73, 15.42, 3563, 5184.73, 1621.73, 0.455], ["ex35", "ENSG", "ENSG (Exited)", "Silver Economy", "Silver Economy", 176.69, 197.36, "2025-12-04", "2026-02-05", 20.197, 0, 0, "exited", "Realized: +$417", 1, 0, 0, 0, 3986.04, 417.35, 197.36, 3568.69, 3986.04, 417.35, 0.117], ["ex36", "NHC", "NHC (Exited)", "Silver Economy", "Silver Economy", 135.25, 160.45, "2025-12-04", "2026-02-05", 26.395, 0, 0, "exited", "Realized: +$662", 1, 0, 0, 0, 4232.41, 662.46, 160.45, 3569.95, 4232.41, 662.46, 0.186], ["ex37", "NVO", "NVO (Exited)", "Silver Economy", "Silver Economy", 46.6, 43.46, "2025-12-04", "2026-02-05", 86.165, 0, 0, "exited", "Realized: -$279", 1, 0, 0, 0, 3736.13, -278.84, 43.46, 4014.97, 3736.13, -278.84, -0.07], ["ex38", "EXPE", "EXPE (Exited Silver)", "Silver Economy", "Silver Economy", 258.17, 197.81, "2025-12-04", "2026-02-24", 10.07, 0, 0, "exited", "Realized: -$608", 1, 0, 0, 0, 1991.95, -607.81, 197.81, 2599.76, 1991.95, -607.81, -0.234], ["ex39", "BKNG", "BKNG (Exited)", "Silver Economy", "Silver Economy", 5120.41, 4416.23, "2025-12-04", "2026-02-06", 1.034, 0, 0, "exited", "Realized: -$728", 1, 0, 0, 0, 4566.39, -728.11, 4416.23, 5294.5, 4566.39, -728.11, -0.138], ["ex40", "CEG", "CEG (Exited AI)", "AI-Industrial", "AI-Industrial", 357.31, 246.05, "2025-12-03", "2026-02-05", 13, 0, 0, "exited", "Realized: -$1,446", 1, 0, 0, 0, 3198.65, -1446.32, 246.05, 4644.97, 3198.65, -1446.32, -0.311], ["ex41", "CRDO", "CRDO (Exited)", "AI-Industrial", "AI-Industrial", 179.21, 97.46, "2025-12-03", "2026-02-05", 27, 0, 0, "exited", "Realized: -$2,207", 1, 0, 0, 0, 2631.42, -2207.24, 97.46, 4838.66, 2631.42, -2207.24, -0.456], ["ex42", "APP", "APP (Exited AI)", "AI-Industrial", "AI-Industrial", 656.03, 373.91, "2025-12-03", "2026-02-05", 7, 0, 0, "exited", "Realized: -$1,975", 1, 0, 0, 0, 2617.34, -1974.89, 373.91, 4592.23, 2617.34, -1974.89, -0.43], ["ex43", "TEM", "TEM (Exited)", "AI-Industrial", "AI-Industrial", 74.3, 52.16, "2025-12-03", "2026-02-05", 64, 0, 0, "exited", "Realized: -$1,417", 1, 0, 0, 0, 3338.02, -1416.86, 52.16, 4754.88, 3338.02, -1416.86, -0.298], ["ex44", "DUOL", "DUOL (Exited AI)", "AI-Industrial", "AI-Industrial", 184.44, 114.67, "2025-12-03", "2026-02-05", 26, 0, 0, "exited", "Realized: -$1,814", 1, 0, 0, 0, 2981.42, -1813.9, 114.67, 4795.32, 2981.42, -1813.9, -0.378], ["ex45", "RDDT", "RDDT (Exited AI)", "AI-Industrial", "AI-Industrial", 220.46, 152.89, "2025-12-03", "2026-02-05", 22, 0, 0, "exited", "Realized: -$1,487", 1, 0, 0, 0, 3363.58, -1486.65, 152.89, 4850.23, 3363.58, -1486.65, -0.306], ["ex46", "PLTR", "PLTR (Exited)", "AI-Industrial", "AI-Industrial", 171.03, 128.73, "2025-12-03", "2026-02-05", 28, 0, 0, "exited", "Realized: -$1,185", 1, 0, 0, 0, 3604.41, -1184.57, 128.73, 4788.98, 3604.41, -1184.57, -0.247], ["ex47", "EXPE", "EXPE (Exited Exp)", "Experientials", "Experientials", 260.03, 197.81, "2025-12-04", "2026-02-24", 30.765, 0, 0, "exited", "Realized: -$1,914", 1, 0, 0, 0, 6085.62, -1914.29, 197.81, 7999.91, 6085.62, -1914.29, -0.239], ["ex48", "PYPL", "PYPL (Exited)", "Digital Finance", "Digital Finance", 61.46, 39.67, "2025-12-04", "2026-02-06", 130.165, 0, 0, "exited", "Realized: -$2,837", 1, 0, 0, 0, 5162.99, -2836.95, 39.67, 7999.94, 5162.99, -2836.95, -0.355], ["ex49", "XYZ", "XYZ (Exited)", "Digital Finance", "Digital Finance", 63.03, 50.24, "2025-12-11", "2026-02-24", 126.921, 0, 0, "exited", "Realized: -$1,624", 1, 0, 0, 0, 6376.26, -1623.73, 50.24, 7999.99, 6376.26, -1623.73, -0.203], ["ex50", "FISV", "FISV (Exited)", "Digital Finance", "Digital Finance", 65.55, 58.53, "2025-12-04", "2026-02-24", 122.044, 0, 0, "exited", "Realized: -$857", 1, 0, 0, 0, 7143.23, -856.74, 58.53, 7999.97, 7143.23, -856.74, -0.107], ["ex51", "TOST", "TOST (Exited)", "Digital Finance", "Digital Finance", 35.02, 24.91, "2025-12-04", "2026-02-24", 228.454, 0, 0, "exited", "Realized: -$2,310", 1, 0, 0, 0, 5689.65, -2310.33, 24.91, 7999.98, 5689.65, -2310.33, -0.289], ["ex52", "AFRM", "AFRM (Exited)", "Digital Finance", "Digital Finance", 67.1, 49.73, "2025-12-04", "2026-02-17", 119.225, 0, 0, "exited", "Realized: -$2,070", 1, 0, 0, 0, 5929.77, -2070.23, 49.73, 8000, 5929.77, -2070.23, -0.259], ["ex53", "KLAR", "KLAR (Exited)", "Digital Finance", "Digital Finance", 31.05, 23.18, "2025-12-04", "2026-01-30", 257.648, 0, 0, "exited", "Realized: -$3,521", 1, 0, 0, 0, 4479.28, -3520.69, 23.18, 7999.97, 4479.28, -3520.69, -0.44], ["ex54", "MQ", "MQ (Exited)", "Digital Finance", "Digital Finance", 4.67, 4.13, "2025-12-04", "2026-02-24", 1714.861, 0, 0, "exited", "Realized: -$923", 1, 0, 0, 0, 7076.89, -923.11, 4.13, 8000, 7076.89, -923.11, -0.115], ["ex55", "MEG", "MEG (Exited)", "Waste", "Waste", 26.06, 21.31, "2025-12-10", "2026-01-20", 306.925, 0, 0, "exited", "Realized: -$1,458", 1, 0, 0, 0, 6541.55, -1458.44, 21.31, 7999.99, 6541.55, -1458.44, -0.182], ["ex56", "PCT", "PCT (Exited)", "Waste", "Waste", 9.11, 6.11, "2025-12-10", "2026-03-02", 877.722, 0, 0, "exited", "Realized: -$2,625", 1, 0, 0, 0, 5374.98, -2625.02, 6.11, 8000, 5374.98, -2625.02, -0.328], ["ex57", "PESI", "PESI (Exited)", "Waste", "Waste", 14.43, 12.92, "2025-12-10", "2026-02-24", 554.4, 0, 0, "exited", "Realized: -$837", 1, 0, 0, 0, 7162.85, -837.14, 12.92, 7999.99, 7162.85, -837.14, -0.105], ["ex58", "PNR", "PNR (Exited)", "Digital Infra", "Digital Infra", 104.31, 94.74, "2025-12-08", "2026-02-05", 76.694, 0, 0, "exited", "Realized: -$734", 1, 0, 0, 0, 7265.96, -733.99, 94.74, 7999.95, 7265.96, -733.99, -0.092], ["ex59", "MDB", "MDB (Exited)", "Legacy Software", "Legacy Software", 312.8, 255.42, "2026-02-24", "2026-03-03", 25.575, 0, 0, "exited", "Realized: -$1,467", 1, 0, 0, 0, 6532.44, -1467.3, 255.42, 7999.74, 6532.44, -1467.3, -0.183], ["ex60", "DUOL", "DUOL (Exited Leg)", "Legacy Software", "Legacy Software", 107.48, 92.06, "2026-02-24", "2026-02-27", 74.432, 0, 0, "exited", "Realized: -$1,148", 1, 0, 0, 0, 6852.21, -1147.74, 92.06, 7999.95, 6852.21, -1147.74, -0.143]];
  for (let i=0;i<all.length;i+=20) { await db.batch(all.slice(i,i+20).map(args=>({sql,args}))); }

  const sd = [["benchmarkVol","0.122"],["portfolioVol","0.168"],["riskFreeRate","0.045"],["spyWeeklyReturn","-0.01508"],["iveWeeklyReturn","0.005"],["mtumWeeklyReturn","0.008"],["warningThreshold","0.85"],["stopLossWarningBuffer","0.05"],["limits.dailyVaR95","0.025"],["limits.trackingError","0.06"],["limits.betaDeviation","0.30"],["limits.systematicVol","0.20"],["limits.maxStockWeight","0.08"],["limits.spyWeight","0.50"]];
  await db.batch(sd.map(([k,v])=>({sql:`INSERT OR REPLACE INTO ${s} (key,value) VALUES (?,?)`,args:[k,v]})));

  const wh = [["W1","2025-12-09",0.012,0.008,0.007,0.002,0.001,0.002],["W2","2025-12-16",-0.005,-0.003,-0.003,-0.001,0,-0.001],["W3","2025-12-23",0.008,0.006,0.005,0.001,0.001,0.001],["W4","2026-01-06",0.015,0.01,0.009,0.002,0.002,0.002],["W5","2026-01-13",-0.018,-0.012,-0.011,-0.003,-0.002,-0.002],["W6","2026-01-20",0.006,0.005,0.004,0.001,0.001,0],["W7","2026-02-03",-0.01,-0.008,-0.007,-0.001,-0.001,-0.001],["W8","2026-02-10",0.003,0.002,0.002,0,0.001,0],["W9","2026-02-24",-0.008,-0.006,-0.005,-0.001,-0.001,-0.001],["W10","2026-03-03",-0.016,-0.015,-0.013,-0.001,-0.001,-0.001]];
  await db.batch(wh.map(args=>({sql:`INSERT INTO ${w} (week,date,portfolioReturn,benchmarkReturn,marketContrib,valueContrib,momentumContrib,alpha) VALUES (?,?,?,?,?,?,?,?)`,args})));

  await db.batch([
    {sql:`INSERT OR REPLACE INTO ${r} (key,value) VALUES ('content',?)`,args:["# Weekly Report — Thematic\n\nPortfolio: $822K | 62 active + 60 exited | Realized PnL: -$62,091"]},
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