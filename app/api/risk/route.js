const HISTORY_RANGE = "6mo";
const HISTORY_INTERVAL = "1d";
const HISTORY_CACHE_TTL_MS = 15 * 60 * 1000;
const MIN_MULTI_FACTOR_OBS = 45;
const MIN_MARKET_ONLY_OBS = 15;
const FACTOR_SYMBOLS = ["SPY", "IVE", "MTUM"];

const historyCache = new Map();

function clampNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

function compoundReturns(values) {
  return values.reduce((nav, value) => nav * (1 + value), 1) - 1;
}

function dot(a, b) {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function invertMatrix(matrix) {
  const size = matrix.length;
  const augmented = matrix.map((row, rowIndex) => [
    ...row.map((value) => clampNumber(value)),
    ...Array.from({ length: size }, (_, columnIndex) => (rowIndex === columnIndex ? 1 : 0)),
  ]);

  for (let pivotIndex = 0; pivotIndex < size; pivotIndex += 1) {
    let pivotRow = pivotIndex;
    while (pivotRow < size && Math.abs(augmented[pivotRow][pivotIndex]) < 1e-12) pivotRow += 1;
    if (pivotRow === size) return null;
    if (pivotRow !== pivotIndex) {
      [augmented[pivotIndex], augmented[pivotRow]] = [augmented[pivotRow], augmented[pivotIndex]];
    }

    const pivotValue = augmented[pivotIndex][pivotIndex];
    for (let column = 0; column < augmented[pivotIndex].length; column += 1) {
      augmented[pivotIndex][column] /= pivotValue;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === pivotIndex) continue;
      const factor = augmented[row][pivotIndex];
      if (factor === 0) continue;
      for (let column = 0; column < augmented[row].length; column += 1) {
        augmented[row][column] -= factor * augmented[pivotIndex][column];
      }
    }
  }

  return augmented.map((row) => row.slice(size));
}

function multiplyMatrixVector(matrix, vector) {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

function runRegression(y, xRows, factorCount) {
  if (!y.length || y.length !== xRows.length) return null;
  const design = xRows.map((row) => [1, ...row]);
  const cols = design[0].length;
  const xtx = Array.from({ length: cols }, () => Array(cols).fill(0));
  const xty = Array(cols).fill(0);

  for (let rowIndex = 0; rowIndex < design.length; rowIndex += 1) {
    const row = design[rowIndex];
    for (let i = 0; i < cols; i += 1) {
      xty[i] += row[i] * y[rowIndex];
      for (let j = 0; j < cols; j += 1) {
        xtx[i][j] += row[i] * row[j];
      }
    }
  }

  const inverse = invertMatrix(xtx);
  if (!inverse) return null;

  const coefficients = multiplyMatrixVector(inverse, xty);
  const predicted = design.map((row) => dot(row, coefficients));
  const residuals = y.map((value, index) => value - predicted[index]);
  const meanY = mean(y);
  const ssTotal = y.reduce((sum, value) => sum + (value - meanY) ** 2, 0);
  const ssResidual = residuals.reduce((sum, value) => sum + value ** 2, 0);

  const factorCoefficients = Array.from({ length: factorCount }, (_, index) => coefficients[index + 1] || 0);
  return {
    alpha: coefficients[0] || 0,
    factors: factorCoefficients,
    predicted,
    residuals,
    rSquared: ssTotal > 0 ? 1 - ssResidual / ssTotal : 0,
    observations: y.length,
  };
}

function isoWeekLabel(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function createPriceSeries(chartResult, latestPrice) {
  const timestamps = chartResult?.timestamp || [];
  const close = chartResult?.indicators?.adjclose?.[0]?.adjclose || chartResult?.indicators?.quote?.[0]?.close || [];
  const rows = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const price = clampNumber(close[index], NaN);
    if (!Number.isFinite(price) || price <= 0) continue;
    const date = new Date(timestamps[index] * 1000).toISOString().slice(0, 10);
    rows.push({ date, price });
  }

  if (rows.length && latestPrice > 0) {
    rows[rows.length - 1] = { ...rows[rows.length - 1], price: latestPrice };
  }

  const deduped = [];
  for (const row of rows) {
    if (deduped.length && deduped[deduped.length - 1].date === row.date) deduped[deduped.length - 1] = row;
    else deduped.push(row);
  }
  return deduped;
}

function createReturnMap(priceSeries) {
  const returns = new Map();
  for (let index = 1; index < priceSeries.length; index += 1) {
    const prev = priceSeries[index - 1].price;
    const current = priceSeries[index].price;
    if (prev > 0 && current > 0) {
      returns.set(priceSeries[index].date, current / prev - 1);
    }
  }
  return returns;
}

async function fetchYahooQuotes(symbols) {
  const prices = {};
  if (!symbols.length) return prices;
  const joined = symbols.join(",");
  const endpoints = [
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(joined)}`,
    `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(joined)}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
      if (!response.ok) continue;
      const json = await response.json();
      for (const quote of json?.quoteResponse?.result || []) {
        if (quote.symbol && quote.regularMarketPrice > 0) {
          prices[quote.symbol] = quote.regularMarketPrice;
        }
      }
      if (Object.keys(prices).length) return prices;
    } catch {}
  }

  return prices;
}

async function fetchHistory(symbol, latestPrice) {
  const cacheKey = symbol;
  const cached = historyCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < HISTORY_CACHE_TTL_MS) {
    return createPriceSeries(cached.raw, latestPrice);
  }

  const endpoints = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${HISTORY_INTERVAL}&range=${HISTORY_RANGE}&includePrePost=false&events=div,splits`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${HISTORY_INTERVAL}&range=${HISTORY_RANGE}&includePrePost=false&events=div,splits`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
      if (!response.ok) continue;
      const json = await response.json();
      const chartResult = json?.chart?.result?.[0];
      if (!chartResult?.timestamp?.length) continue;
      historyCache.set(cacheKey, { ts: Date.now(), raw: chartResult });
      return createPriceSeries(chartResult, latestPrice);
    } catch {}
  }

  return [];
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

function buildFactorRows(factorReturnMaps) {
  const hasStyleFactors = factorReturnMaps.value.size > 0 && factorReturnMaps.momentum.size > 0;
  const dates = [...factorReturnMaps.market.keys()]
    .filter((date) => !hasStyleFactors || (factorReturnMaps.value.has(date) && factorReturnMaps.momentum.has(date)))
    .sort();

  return dates.map((date) => ({
    date,
    market: factorReturnMaps.market.get(date),
    value: hasStyleFactors ? factorReturnMaps.value.get(date) : 0,
    momentum: hasStyleFactors ? factorReturnMaps.momentum.get(date) : 0,
  }));
}

function bucketByWeek(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const week = isoWeekLabel(row.date);
    if (!buckets.has(week)) buckets.set(week, []);
    buckets.get(week).push(row);
  }
  return [...buckets.entries()].map(([week, bucket]) => {
    const endDate = bucket[bucket.length - 1]?.date || "";
    const portfolioReturn = bucket.reduce((sum, row) => sum + row.actualReturn, 0);
    const predictedReturn = bucket.reduce((sum, row) => sum + row.predictedReturn, 0);
    const benchmarkReturn = bucket.reduce((sum, row) => sum + row.marketFactor, 0);
    const marketContrib = bucket.reduce((sum, row) => sum + row.marketContrib, 0);
    const valueContrib = bucket.reduce((sum, row) => sum + row.valueContrib, 0);
    const momentumContrib = bucket.reduce((sum, row) => sum + row.momentumContrib, 0);
    const alphaContrib = bucket.reduce((sum, row) => sum + row.alphaContrib, 0);
    const residualGap = portfolioReturn - predictedReturn;
    return {
      week,
      date: endDate,
      portfolioReturn,
      predictedReturn,
      benchmarkReturn,
      marketContrib,
      valueContrib,
      momentumContrib,
      alphaContrib,
      residualGap,
    };
  });
}

function buildDrawdownSeries(dailyRows) {
  let actualNav = 1;
  let predictedNav = 1;
  let benchmarkNav = 1;
  let actualPeak = 1;
  let predictedPeak = 1;
  let benchmarkPeak = 1;

  return dailyRows.map((row, index) => {
    actualNav *= 1 + row.actualReturn;
    predictedNav *= 1 + row.predictedReturn;
    benchmarkNav *= 1 + row.marketFactor;
    actualPeak = Math.max(actualPeak, actualNav);
    predictedPeak = Math.max(predictedPeak, predictedNav);
    benchmarkPeak = Math.max(benchmarkPeak, benchmarkNav);
    return {
      date: row.date,
      week: row.date,
      actualDrawdown: actualNav / actualPeak - 1,
      predictedDrawdown: predictedNav / predictedPeak - 1,
      benchmarkDrawdown: benchmarkNav / benchmarkPeak - 1,
    };
  });
}

function summarizeDrawdowns(drawdownSeries) {
  const configs = [
    { label: "Actual", key: "actualDrawdown" },
    { label: "Regression", key: "predictedDrawdown" },
    { label: "Benchmark", key: "benchmarkDrawdown" },
  ];
  return configs.map((config) => {
    if (!drawdownSeries.length) return { label: config.label, worstDrawdown: 0, peakWeek: "—", troughWeek: "—", recoveryWeek: "—" };
    let peakIndex = 0;
    let peakValue = 0;
    let troughIndex = 0;
    let troughValue = 0;
    for (let index = 0; index < drawdownSeries.length; index += 1) {
      const value = drawdownSeries[index][config.key];
      if (value === 0) {
        peakIndex = index;
        peakValue = 0;
      }
      if (value < troughValue) {
        troughValue = value;
        troughIndex = index;
      }
    }
    let recoveryWeek = "Not yet";
    for (let index = troughIndex + 1; index < drawdownSeries.length; index += 1) {
      if (drawdownSeries[index][config.key] >= peakValue - 1e-9) {
        recoveryWeek = drawdownSeries[index].week;
        break;
      }
    }
    return {
      label: config.label,
      worstDrawdown: troughValue,
      peakWeek: drawdownSeries[peakIndex]?.week || "—",
      troughWeek: drawdownSeries[troughIndex]?.week || "—",
      recoveryWeek,
    };
  });
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const holdings = Array.isArray(body.holdings) ? body.holdings : [];
    const activeHoldings = holdings
      .filter((holding) => holding?.status === "active" && holding?.ticker)
      .map((holding) => ({
        ...holding,
        ticker: String(holding.ticker).toUpperCase(),
        currentPrice: clampNumber(holding.currentPrice, 0),
        buyPrice: clampNumber(holding.buyPrice, 0),
        shares: clampNumber(holding.shares, 0),
      }))
      .filter((holding) => holding.shares > 0);

    if (!activeHoldings.length) {
      return Response.json({
        metrics: null,
        themeRisk: [],
        subThemeRisk: [],
        weeklyAttribution: [],
        latestWeek: null,
        drawdownSeries: [],
        drawdownSummary: [],
      });
    }

    const symbols = [...new Set([...activeHoldings.map((holding) => holding.ticker), ...FACTOR_SYMBOLS])];
    const quotePrices = await fetchYahooQuotes(symbols);

    const histories = await mapWithConcurrency(symbols, 8, async (symbol) => {
      const holding = activeHoldings.find((item) => item.ticker === symbol);
      const latestPrice = clampNumber(holding?.currentPrice || quotePrices[symbol], 0);
      const priceSeries = await fetchHistory(symbol, latestPrice);
      return [symbol, priceSeries];
    });

    const historyMap = new Map(histories);
    const factorPriceSeries = {
      SPY: historyMap.get("SPY") || [],
      IVE: historyMap.get("IVE") || [],
      MTUM: historyMap.get("MTUM") || [],
    };

    const spyReturns = createReturnMap(factorPriceSeries.SPY);
    const iveReturns = createReturnMap(factorPriceSeries.IVE);
    const mtumReturns = createReturnMap(factorPriceSeries.MTUM);
    const factorReturnMaps = {
      market: spyReturns,
      value: new Map(),
      momentum: new Map(),
    };

    for (const [date, spyValue] of spyReturns.entries()) {
      if (iveReturns.has(date)) factorReturnMaps.value.set(date, iveReturns.get(date) - spyValue);
      if (mtumReturns.has(date)) factorReturnMaps.momentum.set(date, mtumReturns.get(date) - spyValue);
    }

    const factorRows = buildFactorRows(factorReturnMaps);
    const factorByDate = new Map(factorRows.map((row) => [row.date, row]));

    const totalValue = activeHoldings.reduce((sum, holding) => sum + holding.shares * holding.currentPrice, 0);
    const maxStockWeight = totalValue > 0 ? Math.max(...activeHoldings.map((holding) => (holding.shares * holding.currentPrice) / totalValue)) : 0;
    const spyWeight = totalValue > 0 ? activeHoldings.filter((holding) => holding.ticker === "SPY").reduce((sum, holding) => sum + holding.shares * holding.currentPrice, 0) / totalValue : 0;

    const holdingAnalytics = activeHoldings.map((holding) => {
      const currentValue = holding.shares * holding.currentPrice;
      const weight = totalValue > 0 ? currentValue / totalValue : 0;
      const returnMap = createReturnMap(historyMap.get(holding.ticker) || []);
      const alignedDates = factorRows.filter((row) => returnMap.has(row.date));
      const y = alignedDates.map((row) => returnMap.get(row.date));
      const x = alignedDates.map((row) => [row.market, row.value, row.momentum]);

      let regression = null;
      if (y.length >= MIN_MULTI_FACTOR_OBS) {
        regression = runRegression(y, x, 3);
      }
      if (!regression && y.length >= MIN_MARKET_ONLY_OBS) {
        const marketOnly = runRegression(y, alignedDates.map((row) => [row.market]), 1);
        if (marketOnly) {
          regression = {
            ...marketOnly,
            factors: [marketOnly.factors[0] || 0, 0, 0],
            predicted: marketOnly.predicted,
          };
        }
      }
      if (!regression) {
        regression = {
          alpha: mean(y),
          factors: [0, 0, 0],
          predicted: y.map(() => mean(y)),
          residuals: y.map((value) => value - mean(y)),
          rSquared: 0,
          observations: y.length,
        };
      }

      const daily = new Map();
      for (let index = 0; index < alignedDates.length; index += 1) {
        const factor = alignedDates[index];
        const actualReturn = y[index];
        const marketContrib = regression.factors[0] * factor.market;
        const valueContrib = regression.factors[1] * factor.value;
        const momentumContrib = regression.factors[2] * factor.momentum;
        const alphaContrib = regression.alpha;
        const predictedReturn = marketContrib + valueContrib + momentumContrib + alphaContrib;
        daily.set(factor.date, {
          actualReturn,
          predictedReturn,
          marketContrib,
          valueContrib,
          momentumContrib,
          alphaContrib,
        });
      }

      return {
        ...holding,
        currentValue,
        weight,
        marketBeta: regression.factors[0] || 0,
        valueBeta: regression.factors[1] || 0,
        momentumBeta: regression.factors[2] || 0,
        alphaDaily: regression.alpha || 0,
        rSquared: regression.rSquared || 0,
        observations: regression.observations || 0,
        daily,
      };
    });

    const portfolioDaily = [];
    for (const factor of factorRows) {
      const available = holdingAnalytics.filter((holding) => holding.daily.has(factor.date) && holding.weight > 0);
      if (!available.length) continue;
      const availableWeight = available.reduce((sum, holding) => sum + holding.weight, 0);
      const normalized = availableWeight > 0 ? 1 / availableWeight : 0;
      const row = {
        date: factor.date,
        marketFactor: factor.market,
        valueFactor: factor.value,
        momentumFactor: factor.momentum,
        actualReturn: 0,
        predictedReturn: 0,
        marketContrib: 0,
        valueContrib: 0,
        momentumContrib: 0,
        alphaContrib: 0,
      };

      for (const holding of available) {
        const weight = holding.weight * normalized;
        const day = holding.daily.get(factor.date);
        row.actualReturn += weight * day.actualReturn;
        row.predictedReturn += weight * day.predictedReturn;
        row.marketContrib += weight * day.marketContrib;
        row.valueContrib += weight * day.valueContrib;
        row.momentumContrib += weight * day.momentumContrib;
        row.alphaContrib += weight * day.alphaContrib;
      }
      row.residualGap = row.actualReturn - row.predictedReturn;
      portfolioDaily.push(row);
    }

    if (!portfolioDaily.length) {
      return Response.json({
        metrics: null,
        themeRisk: [],
        subThemeRisk: [],
        weeklyAttribution: [],
        latestWeek: null,
        drawdownSeries: [],
        drawdownSummary: [],
        updatedAt: new Date().toISOString(),
      });
    }

    const portfolioActual = portfolioDaily.map((row) => row.actualReturn);
    const portfolioPredicted = portfolioDaily.map((row) => row.predictedReturn);
    const actualVol = stdDev(portfolioActual) * Math.sqrt(252);
    const predictedVol = stdDev(portfolioPredicted) * Math.sqrt(252);
    const residualVol = stdDev(portfolioDaily.map((row) => row.residualGap)) * Math.sqrt(252);
    const trackingError = stdDev(portfolioDaily.map((row) => row.actualReturn - row.marketFactor)) * Math.sqrt(252);
    const portfolioBeta = holdingAnalytics.reduce((sum, holding) => sum + holding.weight * holding.marketBeta, 0);
    const portfolioValueBeta = holdingAnalytics.reduce((sum, holding) => sum + holding.weight * holding.valueBeta, 0);
    const portfolioMomentumBeta = holdingAnalytics.reduce((sum, holding) => sum + holding.weight * holding.momentumBeta, 0);
    const portfolioAlphaDaily = holdingAnalytics.reduce((sum, holding) => sum + holding.weight * holding.alphaDaily, 0);
    const actualMean = mean(portfolioActual);
    const ssTotal = portfolioActual.reduce((sum, value) => sum + (value - actualMean) ** 2, 0);
    const ssResidual = portfolioActual.reduce((sum, value, index) => sum + (value - portfolioPredicted[index]) ** 2, 0);
    const portfolioRSquared = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;

    const themeMap = {};
    for (const holding of holdingAnalytics) {
      const key = holding.theme || "Other";
      if (!themeMap[key]) {
        themeMap[key] = {
          theme: key,
          weight: 0,
          betaExposure: 0,
        };
      }
      themeMap[key].weight += holding.weight;
      themeMap[key].betaExposure += holding.weight * holding.marketBeta;
    }
    const themeRisk = Object.values(themeMap)
      .map((row) => ({
        theme: row.theme,
        weight: row.weight,
        avgBeta: row.weight > 0 ? row.betaExposure / row.weight : 0,
        riskContrib: portfolioBeta !== 0 ? row.betaExposure / portfolioBeta : 0,
        weightedRisk: row.weight > 0 && portfolioBeta !== 0 ? (row.betaExposure / portfolioBeta) / row.weight : 0,
      }))
      .sort((a, b) => b.weight - a.weight);

    const weeklyAttribution = bucketByWeek(portfolioDaily).slice(-16);
    const latestWeek = weeklyAttribution.at(-1) || null;
    const latestWeekDates = latestWeek ? portfolioDaily.filter((row) => isoWeekLabel(row.date) === latestWeek.week).map((row) => row.date) : [];

    const subThemeMap = {};
    for (const holding of holdingAnalytics) {
      const key = holding.subTheme || holding.theme || "Other";
      if (!subThemeMap[key]) {
        subThemeMap[key] = {
          subTheme: key,
          weight: 0,
          marketExposure: 0,
          valueExposure: 0,
          momentumExposure: 0,
          alphaExposure: 0,
          actualContribution: 0,
          predictedContribution: 0,
        };
      }
      const bucket = subThemeMap[key];
      bucket.weight += holding.weight;
      bucket.marketExposure += holding.weight * holding.marketBeta;
      bucket.valueExposure += holding.weight * holding.valueBeta;
      bucket.momentumExposure += holding.weight * holding.momentumBeta;
      bucket.alphaExposure += holding.weight * holding.alphaDaily * Math.max(latestWeekDates.length, 1);

      for (const date of latestWeekDates) {
        const day = holding.daily.get(date);
        if (!day) continue;
        bucket.actualContribution += holding.weight * day.actualReturn;
        bucket.predictedContribution += holding.weight * day.predictedReturn;
      }
    }

    const subThemeRisk = Object.values(subThemeMap)
      .map((row) => ({
        subTheme: row.subTheme,
        weight: row.weight,
        avgBeta: row.weight > 0 ? row.marketExposure / row.weight : 0,
        marketContrib: row.marketExposure * (latestWeek?.benchmarkReturn || 0),
        valueContrib: row.valueExposure * (Math.abs(portfolioValueBeta) > 1e-9 ? (latestWeek?.valueContrib || 0) / portfolioValueBeta : 0),
        momentumContrib: row.momentumExposure * (Math.abs(portfolioMomentumBeta) > 1e-9 ? (latestWeek?.momentumContrib || 0) / portfolioMomentumBeta : 0),
        alphaContrib: row.alphaExposure,
        predictedContribution: row.predictedContribution,
        actualContribution: row.actualContribution,
        residualGap: row.actualContribution - row.predictedContribution,
        predictedReturn: row.weight > 0 ? row.predictedContribution / row.weight : 0,
        actualReturn: row.weight > 0 ? row.actualContribution / row.weight : 0,
      }))
      .sort((a, b) => Math.abs(b.predictedContribution) - Math.abs(a.predictedContribution));

    const drawdownSeries = buildDrawdownSeries(portfolioDaily);
    const drawdownSummary = summarizeDrawdowns(drawdownSeries);

    return Response.json({
      updatedAt: new Date().toISOString(),
      metrics: {
        portfolioBeta,
        valueBeta: portfolioValueBeta,
        momentumBeta: portfolioMomentumBeta,
        alphaDaily: portfolioAlphaDaily,
        annualizedVol: actualVol,
        systematicVol: predictedVol,
        idiosyncraticVol: residualVol,
        trackingError,
        rSquared: portfolioRSquared,
        dailyVaR95: (actualVol / Math.sqrt(252)) * 1.645,
        dailyVaR99: (actualVol / Math.sqrt(252)) * 2.326,
        weeklyVaR95: (actualVol / Math.sqrt(252)) * 1.645 * Math.sqrt(5),
        weeklyVaR99: (actualVol / Math.sqrt(252)) * 2.326 * Math.sqrt(5),
        maxStockWeight,
        spyWeight,
        activeCount: activeHoldings.length,
        totalValue,
        observations: portfolioDaily.length,
      },
      themeRisk,
      subThemeRisk,
      weeklyAttribution,
      latestWeek,
      drawdownSeries,
      drawdownSummary,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
