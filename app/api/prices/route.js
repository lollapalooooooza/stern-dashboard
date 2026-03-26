// app/api/prices/route.js — ULTRA-FAST parallel Yahoo Finance with server cache
import { getAllHoldings, bulkUpdatePrices } from "@/lib/db";

// In-memory server cache: { prices, timestamp }
let priceCache = { prices: {}, ts: 0, tickers: [] };
const CACHE_TTL = 45_000; // 45 seconds — fresh enough for dashboard

async function fetchYahoo(tickers) {
  const prices = {};
  if (!tickers.length) return prices;
  const symbols = tickers.join(",");

  // RACE: first successful strategy wins immediately (no waiting for slow ones)
  const raceResult = await Promise.any([
    // Strategy 1: query1 endpoint (usually fastest)
    fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
      signal: AbortSignal.timeout(3500),
    }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    // Strategy 2: query2 endpoint (backup)
    fetch(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(3500),
    }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    // Strategy 3: cookie+crumb flow
    (async () => {
      const ck = await fetch("https://fc.yahoo.com", { redirect: "manual", signal: AbortSignal.timeout(2000) });
      const cookie = (ck.headers.get("set-cookie") || "").split(";")[0];
      if (!cookie) throw new Error("no cookie");
      const cr = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": "Mozilla/5.0", Cookie: cookie }, signal: AbortSignal.timeout(2000) });
      const crumb = await cr.text();
      if (!crumb || crumb.length > 50) throw new Error("bad crumb");
      const r = await fetch(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&crumb=${encodeURIComponent(crumb)}`, { headers: { "User-Agent": "Mozilla/5.0", Cookie: cookie }, signal: AbortSignal.timeout(3000) });
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })(),
  ]).catch(() => null);

  if (raceResult?.quoteResponse?.result) {
    for (const q of raceResult.quoteResponse.result) {
      if (q.symbol && q.regularMarketPrice > 0) prices[q.symbol] = q.regularMarketPrice;
    }
  }

  // Parallel individual chart fallback ONLY for missing (2.5s each, max 10)
  const missing = tickers.filter(t => !prices[t]);
  if (missing.length > 0 && missing.length <= 10) {
    await Promise.allSettled(missing.map(t =>
      fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=1d&range=1d`, {
        headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(2500),
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

    // Check server cache — return instantly if fresh
    const tickerKey = tickers.sort().join(",");
    const now = Date.now();
    if (priceCache.ts > 0 && (now - priceCache.ts) < CACHE_TTL && priceCache.tickers.join(",") === tickerKey) {
      const cached = priceCache.prices;
      const count = Object.keys(cached).length;
      // Background refresh if older than 20s
      if ((now - priceCache.ts) > 20_000) {
        fetchYahoo(tickers).then(freshPrices => {
          const freshCount = Object.keys(freshPrices).length;
          if (freshCount > 0) {
            priceCache = { prices: freshPrices, ts: Date.now(), tickers: tickers.sort() };
            // Async DB update
            const updates = [];
            for (const h of holdings) {
              if (freshPrices[h.ticker] !== undefined && h.status === "active") {
                const np = freshPrices[h.ticker], nv = h.shares * np, pnl = (np - h.buyPrice) * h.shares;
                updates.push({ id: h.id, price: np, value: nv, pnl });
              }
            }
            if (updates.length > 0) bulkUpdatePrices(updates, group).catch(() => {});
          }
        }).catch(() => {});
      }
      return Response.json({ prices: cached, count, requested: tickers.length, cached: true, ms: Date.now() - t0, updated: new Date(priceCache.ts).toISOString() });
    }

    const prices = await fetchYahoo(tickers);
    const count = Object.keys(prices).length;

    // Update server cache
    if (count > 0) {
      priceCache = { prices, ts: Date.now(), tickers: tickers.sort() };
    }

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
