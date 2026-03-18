// app/api/prices/route.js — FAST parallel Yahoo Finance
import { getAllHoldings, bulkUpdatePrices } from "@/lib/db";

async function fetchYahoo(tickers) {
  const prices = {};
  if (!tickers.length) return prices;
  const symbols = tickers.join(",");

  // Fire ALL 3 strategies simultaneously — first results win
  const results = await Promise.allSettled([
    fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
      signal: AbortSignal.timeout(5000),
    }).then(r => r.ok ? r.json() : null),
    fetch(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(5000),
    }).then(r => r.ok ? r.json() : null),
    (async () => {
      const ck = await fetch("https://fc.yahoo.com", { redirect: "manual", signal: AbortSignal.timeout(3000) });
      const cookie = (ck.headers.get("set-cookie") || "").split(";")[0];
      if (!cookie) return null;
      const cr = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": "Mozilla/5.0", Cookie: cookie }, signal: AbortSignal.timeout(3000) });
      const crumb = await cr.text();
      if (!crumb || crumb.length > 50) return null;
      const r = await fetch(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&crumb=${encodeURIComponent(crumb)}`, { headers: { "User-Agent": "Mozilla/5.0", Cookie: cookie }, signal: AbortSignal.timeout(5000) });
      return r.ok ? r.json() : null;
    })(),
  ]);

  for (const r of results) {
    if (r.status === "fulfilled" && r.value?.quoteResponse?.result) {
      for (const q of r.value.quoteResponse.result) {
        if (q.symbol && q.regularMarketPrice > 0 && !prices[q.symbol]) prices[q.symbol] = q.regularMarketPrice;
      }
    }
  }

  // Parallel individual chart fallback for missing (3s each)
  const missing = tickers.filter(t => !prices[t]);
  if (missing.length > 0 && missing.length <= 15) {
    await Promise.allSettled(missing.map(t =>
      fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=1d&range=1d`, {
        headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(3000),
      }).then(r => r.ok ? r.json() : null).then(d => { const p = d?.chart?.result?.[0]?.meta?.regularMarketPrice; if (p > 0) prices[t] = p; }).catch(() => {})
    ));
  }
  return prices;
}

export async function POST(request) {
  const t0 = Date.now();
  try {
    const body = await request.json().catch(() => ({}));
    const group = body.group || "thematic";
    const holdings = await getAllHoldings(group);
    const tickers = [...new Set(holdings.filter(h => h.status === "active" && h.ticker !== "SPY").map(h => h.ticker))];
    if (!tickers.length) return Response.json({ prices: {}, count: 0, ms: Date.now() - t0 });

    const prices = await fetchYahoo(tickers);
    const count = Object.keys(prices).length;

    if (count > 0) {
      const updates = [];
      for (const h of holdings) {
        if (prices[h.ticker] !== undefined && h.status === "active") {
          const np = prices[h.ticker], nv = h.shares * np, pnl = (np - h.buyPrice) * h.shares;
          updates.push({ id: h.id, price: np, value: nv, pnl });
        }
      }
      if (updates.length > 0) await bulkUpdatePrices(updates, group);
    }

    return Response.json({ prices, count, requested: tickers.length, dbUpdated: count > 0, ms: Date.now() - t0, updated: new Date().toISOString() });
  } catch (e) { return Response.json({ prices: {}, error: e.message, ms: Date.now() - t0 }, { status: 500 }); }
}

export async function GET() { return Response.json({ status: "ok" }); }
