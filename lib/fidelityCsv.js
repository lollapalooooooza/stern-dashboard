import * as XLSX from "xlsx";

const HEADER_ALIASES = {
  symbol: ["symbol", "ticker", "security symbol"],
  description: ["description", "security description", "name"],
  quantity: ["quantity", "qty", "shares"],
  lastPrice: ["last price", "price", "mark price"],
  currentValue: ["current value", "market value", "value"],
  averageCost: ["average cost basis", "average cost", "avg cost basis", "avg cost"],
  costBasisTotal: ["cost basis total", "total cost basis", "cost basis"],
  percentOfAccount: ["percent of account", "% of account", "weight", "weights"],
  runDate: ["run date", "as of date", "date"],
};

const CASH_SYMBOLS = new Set(["SPAXX", "FDRXX", "FCASH", "CASH", "CORE"]);
const DEFAULT_THEME = "Unassigned";

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[%/$(),]/g, "")
    .replace(/\s+/g, " ");
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseCsv(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => parseCsvLine(line))
    .filter((row) => row.some((cell) => String(cell || "").trim() !== ""));
}

function normalizeRows(rows) {
  return (rows || [])
    .map((row) => row.map((cell) => {
      if (cell == null) return "";
      if (cell instanceof Date && !Number.isNaN(cell.getTime())) return cell.toISOString().slice(0, 10);
      return String(cell).trim();
    }))
    .filter((row) => row.some((cell) => String(cell || "").trim() !== ""));
}

function parseWorkbook(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = normalizeRows(XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: false }));
    if (detectHeaderIndex(rows) >= 0) return rows;
  }
  throw new Error("Could not find a Fidelity positions header row in this workbook.");
}

function detectHeaderIndex(rows) {
  return rows.findIndex((row) => {
    const normalized = row.map(normalizeHeader);
    const hasSymbol = normalized.includes("symbol") || normalized.includes("ticker") || normalized.includes("security symbol");
    const hasQuantity = normalized.includes("quantity") || normalized.includes("qty") || normalized.includes("shares");
    const hasValue = normalized.includes("current value") || normalized.includes("market value") || normalized.includes("value");
    return hasSymbol && (hasQuantity || hasValue);
  });
}

function rowToObject(headerRow, row) {
  const object = {};
  headerRow.forEach((header, index) => {
    object[normalizeHeader(header)] = row[index] ?? "";
  });
  return object;
}

function pickField(row, aliases) {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    if (row[key] != null && String(row[key]).trim() !== "") return row[key];
  }
  return "";
}

function parseNumber(value) {
  if (value == null) return null;
  const cleaned = String(value)
    .trim()
    .replace(/[$,%]/g, "")
    .replace(/,/g, "")
    .replace(/[()]/g, (match) => (match === "(" ? "-" : ""));
  if (!cleaned) return null;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

function parsePercent(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  const numeric = parseNumber(text);
  if (numeric == null) return null;
  return text.includes("%") || Math.abs(numeric) > 1 ? numeric / 100 : numeric;
}

function parseDateToIso(value) {
  if (!value) return "";
  const text = String(value).trim();
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return "";
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function isCashLikePosition(symbol, description) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const normalizedDescription = String(description || "").trim().toLowerCase();
  return (
    CASH_SYMBOLS.has(normalizedSymbol) ||
    normalizedDescription.includes("cash") ||
    normalizedDescription.includes("core account") ||
    normalizedDescription.includes("money market")
  );
}

function firstPositive(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
}

function fallbackCostBasis(holding) {
  const costBasis = firstPositive(holding.costBasis, holding.shares * holding.buyPrice);
  return costBasis > 0 ? costBasis : firstPositive(holding.currentValue, holding.shares * holding.currentPrice);
}

function existingHoldingMap(holdings) {
  const byTicker = new Map();
  for (const holding of holdings) {
    const key = String(holding.ticker || "").trim().toUpperCase();
    if (!key) continue;
    const current = byTicker.get(key);
    if (!current || current.status !== "active") byTicker.set(key, holding);
    if (holding.status === "active") byTicker.set(key, holding);
  }
  return byTicker;
}

function buildActiveHoldingFromCsv(position, existingHolding, importDate, index) {
  const symbol = position.symbol;
  const currentPrice = firstPositive(position.lastPrice, position.currentValue / position.quantity, existingHolding?.currentPrice);
  const shares = firstPositive(position.quantity, position.currentValue / currentPrice, existingHolding?.shares);
  const currentValue = firstPositive(position.currentValue, shares * currentPrice);
  const costBasis = firstPositive(position.costBasisTotal, position.averageCost * shares, fallbackCostBasis(existingHolding || {}));
  const buyPrice = shares > 0 ? firstPositive(position.averageCost, costBasis / shares, existingHolding?.buyPrice, currentPrice) : currentPrice;
  const theme = symbol === "SPY" ? "Benchmark" : (existingHolding?.theme || DEFAULT_THEME);
  const subTheme = symbol === "SPY" ? "Benchmark" : (existingHolding?.subTheme || theme);
  return {
    ...(existingHolding || {}),
    id: existingHolding?.id || `fidelity-${symbol}-${index}`,
    ticker: symbol,
    company: position.description || existingHolding?.company || symbol,
    theme,
    subTheme,
    buyPrice,
    currentPrice,
    entryDate: existingHolding?.entryDate || position.runDate || importDate,
    exitDate: "",
    shares,
    benchmarkWeight: Number(existingHolding?.benchmarkWeight || 0),
    stopLossPct: Number(existingHolding?.stopLossPct || 0.1),
    status: "active",
    notes: existingHolding?.notes || "Imported from Fidelity CSV",
    marketBeta: Number(existingHolding?.marketBeta || (symbol === "SPY" ? 1 : 1)),
    valueBeta: Number(existingHolding?.valueBeta || 0),
    momentumBeta: Number(existingHolding?.momentumBeta || 0),
    weeklyReturn: Number(existingHolding?.weeklyReturn || 0),
    currentValue,
    pnlFromExcel: currentValue - costBasis,
    sellPrice: 0,
    costBasis,
    sellTotal: 0,
    realizedPnl: 0,
    realizedPnlPct: 0,
  };
}

function buildExitedHolding(existingHolding, importDate) {
  const sellPrice = firstPositive(existingHolding.currentPrice, existingHolding.buyPrice);
  const sellTotal = firstPositive(existingHolding.currentValue, existingHolding.shares * sellPrice);
  const costBasis = fallbackCostBasis(existingHolding);
  const realizedPnl = sellTotal - costBasis;
  return {
    ...existingHolding,
    status: "exited",
    exitDate: importDate,
    sellPrice,
    costBasis,
    sellTotal,
    realizedPnl,
    realizedPnlPct: costBasis > 0 ? realizedPnl / costBasis : 0,
    currentPrice: sellPrice,
    currentValue: sellTotal,
    pnlFromExcel: realizedPnl,
  };
}

function buildHoldingsFromFidelityRows(rows, existingHoldings, options = {}) {
  const headerIndex = detectHeaderIndex(rows);
  if (headerIndex < 0) throw new Error("Could not find a Fidelity positions header row in this file.");

  const headerRow = rows[headerIndex];
  const records = rows.slice(headerIndex + 1).map((row) => rowToObject(headerRow, row));
  const importDate = options.importDate || new Date().toISOString().slice(0, 10);
  const byTicker = existingHoldingMap(existingHoldings);

  const importedPositions = [];
  let importedCashBalance = null;

  records.forEach((record, index) => {
    const symbol = String(pickField(record, HEADER_ALIASES.symbol)).trim().toUpperCase();
    const description = String(pickField(record, HEADER_ALIASES.description)).trim();
    const quantity = parseNumber(pickField(record, HEADER_ALIASES.quantity));
    const currentValue = parseNumber(pickField(record, HEADER_ALIASES.currentValue));
    const lastPrice = parseNumber(pickField(record, HEADER_ALIASES.lastPrice));
    const averageCost = parseNumber(pickField(record, HEADER_ALIASES.averageCost));
    const costBasisTotal = parseNumber(pickField(record, HEADER_ALIASES.costBasisTotal));
    const percentOfAccount = parsePercent(pickField(record, HEADER_ALIASES.percentOfAccount));
    const runDate = parseDateToIso(pickField(record, HEADER_ALIASES.runDate));

    if (!symbol && !description) return;
    if (isCashLikePosition(symbol, description)) {
      const cashValue = firstPositive(currentValue, quantity);
      if (cashValue > 0) importedCashBalance = cashValue;
      return;
    }
    if (!symbol) return;

    const shares = firstPositive(quantity, currentValue && lastPrice ? currentValue / lastPrice : 0);
    const value = firstPositive(currentValue, shares * lastPrice);
    if (shares <= 0 && value <= 0) return;

    importedPositions.push({
      symbol,
      description,
      quantity: shares,
      currentValue: value,
      lastPrice: firstPositive(lastPrice, value / shares),
      averageCost: firstPositive(averageCost, costBasisTotal && shares ? costBasisTotal / shares : 0),
      costBasisTotal: firstPositive(costBasisTotal, averageCost && shares ? averageCost * shares : 0),
      percentOfAccount,
      runDate,
      rowIndex: index,
    });
  });

  if (!importedPositions.length) throw new Error("The file did not contain any active positions to import.");

  const importedTickers = new Set(importedPositions.map((position) => position.symbol));
  const preservedExited = existingHoldings.filter((holding) => holding.status === "exited");
  const autoExited = existingHoldings
    .filter((holding) => holding.status === "active" && !importedTickers.has(String(holding.ticker || "").trim().toUpperCase()))
    .map((holding) => buildExitedHolding(holding, importDate));
  const nextActive = importedPositions.map((position, index) =>
    buildActiveHoldingFromCsv(position, byTicker.get(position.symbol), importDate, index)
  );
  const nextHoldings = [...nextActive, ...autoExited, ...preservedExited];

  return {
    holdings: nextHoldings,
    cashBalance: importedCashBalance,
    summary: {
      activeCount: nextActive.length,
      autoExitedCount: autoExited.length,
      preservedExitedCount: preservedExited.length,
      importedTickers: importedPositions.map((position) => position.symbol),
    },
  };
}

export function buildHoldingsFromFidelityCsv(csvText, existingHoldings, options = {}) {
  return buildHoldingsFromFidelityRows(parseCsv(csvText), existingHoldings, options);
}

export async function buildHoldingsFromFidelityFile(file, existingHoldings, options = {}) {
  const fileName = String(file?.name || "").toLowerCase();
  if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
    const arrayBuffer = await file.arrayBuffer();
    return buildHoldingsFromFidelityRows(parseWorkbook(arrayBuffer), existingHoldings, options);
  }
  const text = await file.text();
  return buildHoldingsFromFidelityRows(parseCsv(text), existingHoldings, options);
}
