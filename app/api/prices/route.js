import { getAllHoldings, bulkUpdatePrices } from "@/lib/db";

async function fetchYahooPrices(tickers) {
  const prices = {};

  // Strategy 1: Batch v7
  try {
    const symbols = tickers.join(",");
    for (const host of ["query1", "query2"]) {
      try {
        const resp = await fetch(`https://${host}.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`, {
          headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
          signal: AbortSignal.timeout(10000),
        });
        if (resp.ok) {
          const data = await resp.json();
          for (const q of data?.quoteResponse?.result || []) {
            if (q.symbol && q.regularMarketPrice > 0) prices[q.symbol] = q.regularMarketPrice;
          }
          if (Object.keys(prices).length > 0) return prices;
        }
      } catch {}
    }
  } catch {}

  // Strategy 2: Cookie + crumb
  try {
    const ck = await fetch("https://fc.yahoo.com", { redirect: "manual", signal: AbortSignal.timeout(5000) });
    const cookie = (ck.headers.get("set-cookie") || "").split(";")[0];
    const cr = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": "Mozilla/5.0", Cookie: cookie }, signal: AbortSignal.timeout(5000) });
    const crumb = await cr.text();
    if (crumb && crumb.length < 50) {
      const resp = await fetch(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(tickers.join(","))}&crumb=${encodeURIComponent(crumb)}`, {
        headers: { "User-Agent": "Mozilla/5.0", Cookie: cookie }, signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const data = await resp.json();
        for (const q of data?.quoteResponse?.result || []) {
          if (q.symbol && q.regularMarketPrice > 0) prices[q.symbol] = q.regularMarketPrice;
        }
        if (Object.keys(prices).length > 0) return prices;
      }
    }
  } catch {}

  // Strategy 3: Individual v8 chart
  const missing = tickers.filter(t => !prices[t]);
  for (const ticker of missing.slice(0, 20)) {
    try {
      const resp = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) {
        const data = await resp.json();
        const p = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (p > 0) prices[ticker] = p;
      }
    } catch {}
  }

  return prices;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const requestedTickers = body?.tickers;

    // Get all holdings from DB
    const holdings = getAllHoldings();
    const activeTickers = requestedTickers || [...new Set(holdings.filter(h => h.status === "active" && h.ticker !== "SPY").map(h => h.ticker))];

    if (activeTickers.length === 0) {
      return Response.json({ prices: {}, count: 0, message: "No active tickers" });
    }

    // Fetch live prices
    const prices = await fetchYahooPrices(activeTickers);
    const count = Object.keys(prices).length;

    // Write updated prices back to database
    if (count > 0) {
      const updates = [];
      for (const h of holdings) {
        if (prices[h.ticker] !== undefined && h.status === "active") {
          const newPrice = prices[h.ticker];
          const newValue = h.shares * newPrice;
          const newPnl = (newPrice - h.buyPrice) * h.shares;
          updates.push({ id: h.id, price: newPrice, value: newValue, pnl: newPnl });
        }
      }
      if (updates.length > 0) {
        bulkUpdatePrices(updates);
      }
    }

    return Response.json({
      prices,
      count,
      requested: activeTickers.length,
      dbUpdated: count > 0,
      updated: new Date().toISOString(),
    });
  } catch (e) {
    return Response.json({ prices: {}, error: e.message }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ status: "ok", usage: "POST { tickers: ['AAPL'] } or POST {} to fetch all active" });
}
