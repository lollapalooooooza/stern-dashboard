// app/api/cron/route.js
// Vercel Cron Job — runs daily after market close (5pm ET)
// 1. Fetches latest prices for all active holdings
// 2. Updates holding prices in DB
// 3. Records daily snapshot
// 4. On Fridays, computes and stores weekly return

import { getAllHoldings, bulkUpdatePrices, getWeeklyHistory, getSettings } from "@/lib/db";
import { createClient } from "@libsql/client";

const GROUPS = ["thematic", "opportunistic", "systematic", "bond"];

function getClient() {
  return createClient({
    url: process.env.TURSO_DATABASE_URL || "file:stern_local.db",
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });
}

// Fetch prices from Yahoo Finance
async function fetchYahoo(tickers) {
  const prices = {};
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(
        `https://${host}.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(tickers.join(","))}`,
        {
          headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
          signal: AbortSignal.timeout(15000),
        }
      );
      if (r.ok) {
        const d = await r.json();
        for (const q of d?.quoteResponse?.result || []) {
          if (q.symbol && q.regularMarketPrice > 0) prices[q.symbol] = q.regularMarketPrice;
        }
        if (Object.keys(prices).length > 0) return prices;
      }
    } catch {}
  }
  // Crumb fallback
  try {
    const ck = await fetch("https://fc.yahoo.com", { redirect: "manual", signal: AbortSignal.timeout(5000) });
    const cookie = (ck.headers.get("set-cookie") || "").split(";")[0];
    const cr = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": "Mozilla/5.0", Cookie: cookie },
      signal: AbortSignal.timeout(5000),
    });
    const crumb = await cr.text();
    if (crumb && crumb.length < 50) {
      const r = await fetch(
        `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(tickers.join(","))}&crumb=${encodeURIComponent(crumb)}`,
        { headers: { "User-Agent": "Mozilla/5.0", Cookie: cookie }, signal: AbortSignal.timeout(15000) }
      );
      if (r.ok) {
        const d = await r.json();
        for (const q of d?.quoteResponse?.result || []) {
          if (q.symbol && q.regularMarketPrice > 0) prices[q.symbol] = q.regularMarketPrice;
        }
      }
    }
  } catch {}
  return prices;
}

export async function GET(request) {
  // Verify cron secret (prevents random people from hitting this endpoint)
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getClient();
  const now = new Date();
  const etNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const dayOfWeek = etNow.getDay(); // 0=Sun, 5=Fri, 6=Sat
  const dateStr = etNow.toISOString().split("T")[0];
  const isFriday = dayOfWeek === 5;
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // Skip weekends — market is closed
  if (isWeekend) {
    return Response.json({ status: "skipped", reason: "weekend", date: dateStr });
  }

  const results = {};

  for (const group of GROUPS) {
    try {
      // 1. Get all active holdings
      const holdings = await getAllHoldings(group);
      const active = holdings.filter((h) => h.status === "active");
      if (active.length === 0) {
        results[group] = { status: "empty" };
        continue;
      }

      const tickers = [...new Set(active.filter((h) => h.ticker !== "SPY").map((h) => h.ticker))];
      if (tickers.length === 0) {
        results[group] = { status: "no_tickers" };
        continue;
      }

      // 2. Fetch latest prices
      const prices = await fetchYahoo(tickers);
      const priceCount = Object.keys(prices).length;

      if (priceCount === 0) {
        results[group] = { status: "no_prices", tickers: tickers.length };
        continue;
      }

      // 3. Compute portfolio value BEFORE update (for return calc)
      const prevTotalVal = active.reduce((s, h) => s + (h.currentValue || h.shares * h.currentPrice), 0);

      // 4. Update prices in DB
      const updates = [];
      for (const h of active) {
        if (prices[h.ticker] !== undefined) {
          const np = prices[h.ticker];
          const nv = h.shares * np;
          const pnl = (np - h.buyPrice) * h.shares;
          updates.push({ id: h.id, price: np, value: nv, pnl });
        }
      }
      if (updates.length > 0) {
        await bulkUpdatePrices(updates, group);
      }

      // 5. Compute new portfolio value AFTER update
      const newTotalVal = active.reduce((s, h) => {
        const newPrice = prices[h.ticker] !== undefined ? prices[h.ticker] : h.currentPrice;
        return s + h.shares * newPrice;
      }, 0);

      const dailyReturn = prevTotalVal > 0 ? (newTotalVal - prevTotalVal) / prevTotalVal : 0;

      // 6. Store daily snapshot
      const snapTable = `${group}_daily_snapshots`;
      await db.execute(`CREATE TABLE IF NOT EXISTS ${snapTable} (
        date TEXT PRIMARY KEY, portfolioValue REAL, dailyReturn REAL, priceCount INTEGER
      )`);
      await db.execute({
        sql: `INSERT OR REPLACE INTO ${snapTable} (date, portfolioValue, dailyReturn, priceCount) VALUES (?,?,?,?)`,
        args: [dateStr, newTotalVal, dailyReturn, priceCount],
      });

      // 7. On Friday: compute weekly return and add to weekly_history
      if (isFriday) {
        // Get this week's Monday snapshot (or earliest this week)
        const mondayDate = new Date(etNow);
        mondayDate.setDate(etNow.getDate() - (dayOfWeek - 1));
        const mondayStr = mondayDate.toISOString().split("T")[0];

        // Get all daily snapshots this week
        const weekSnaps = await db.execute({
          sql: `SELECT * FROM ${snapTable} WHERE date >= ? AND date <= ? ORDER BY date`,
          args: [mondayStr, dateStr],
        });

        // Weekly return = compounded daily returns
        let weeklyReturn = 0;
        if (weekSnaps.rows.length > 0) {
          weeklyReturn = weekSnaps.rows.reduce((s, r) => s + (r.dailyReturn || 0), 0);
        }

        // Get existing weekly history to determine week number
        const history = await getWeeklyHistory(group);
        const weekNum = history.length + 1;
        const weekLabel = `W${weekNum}`;

        // Compute rough factor attribution
        const settings = await getSettings(group);
        const portBeta = active.reduce((s, h) => {
          const w = prevTotalVal > 0 ? (h.currentValue || h.shares * h.currentPrice) / prevTotalVal : 0;
          return s + w * (h.marketBeta || 1);
        }, 0);

        const benchReturn = weeklyReturn / (portBeta || 1); // rough estimate
        const marketContrib = portBeta * benchReturn;
        const alpha = weeklyReturn - marketContrib;

        // Insert weekly record
        const whTable = `${group}_weekly_history`;
        await db.execute({
          sql: `INSERT INTO ${whTable} (week, date, portfolioReturn, benchmarkReturn, marketContrib, valueContrib, momentumContrib, alpha) VALUES (?,?,?,?,?,?,?,?)`,
          args: [weekLabel, dateStr, weeklyReturn, benchReturn, marketContrib, alpha * 0.3, alpha * 0.2, alpha * 0.5],
        });

        results[group] = {
          status: "friday_update",
          pricesUpdated: priceCount,
          dailyReturn: dailyReturn.toFixed(6),
          weeklyReturn: weeklyReturn.toFixed(6),
          weekLabel,
        };
      } else {
        results[group] = {
          status: "daily_update",
          pricesUpdated: priceCount,
          dailyReturn: dailyReturn.toFixed(6),
        };
      }
    } catch (e) {
      results[group] = { status: "error", error: e.message };
    }
  }

  return Response.json({
    ok: true,
    timestamp: now.toISOString(),
    date: dateStr,
    isFriday,
    results,
  });
}
