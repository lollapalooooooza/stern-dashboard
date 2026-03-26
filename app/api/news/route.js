// app/api/news/route.js — FAST multi-source news aggregator with server cache
// Sources: Google News RSS + Finviz + Yahoo Finance RSS
// Server cache: 3-min TTL, progressive results

const TICKER_NAMES = {
  // Digital Infrastructure & Data Centers
  BE: "Bloom Energy", LITE: "Lumentum Holdings", APP: "AppLovin mobile advertising", CSIQ: "Canadian Solar",
  NBIS: "Nebius Group", IREN: "Iris Energy", APLD: "Applied Digital data center", VRT: "Vertiv Holdings",
  DBRG: "DigitalBridge", CIEN: "Ciena Corp", AWK: "American Water Works", XYL: "Xylem",
  NEE: "NextEra Energy", PWR: "Quanta Services", DLR: "Digital Realty", EQIX: "Equinix",
  // Experientials & Travel
  ABNB: "Airbnb", LYV: "Live Nation", MSGE: "MSG Entertainment", NCLH: "Norwegian Cruise",
  RCL: "Royal Caribbean", TKO: "TKO Group WWE", MAR: "Marriott", H: "Hyatt Hotels",
  TNL: "Travel Leisure vacation ownership",
  // Nuclear & Security
  BWXT: "BWX Technologies", EXC: "Exelon", GE: "GE Aerospace", DEF: "Defiance Technologies",
  // Payments
  AXP: "American Express", MA: "Mastercard", V: "Visa", PYPL: "PayPal",
  // Security & Defense
  ALRM: "Alarm.com", MSI: "Motorola Solutions", OSIS: "OSI Systems security", RTX: "RTX Raytheon defense",
  LMAB: "Lemonade Insurance", CG: "Carlyle Group",
  // Healthcare & Biotech
  ABBV: "AbbVie", ABT: "Abbott Labs", ADUS: "Addus HomeCare", AMGN: "Amgen",
  DXCM: "DexCom", EHAB: "Enhabit", LLY: "Eli Lilly", MDT: "Medtronic",
  SYK: "Stryker", VTR: "Ventas", WELL: "Welltower",
  // Healthcare Legacy (Silver Economy)
  CVS: "CVS Health", UNH: "UnitedHealth",
  // Waste & Environmental
  CLH: "Clean Harbors", DAR: "Darling Ingredients", RSG: "Republic Services", WM: "Waste Management",
  TTEK: "Tetra Tech", PSTG: "Pure Storage", ETR: "Entergy",
  // Legacy Software & Cloud
  NOW: "ServiceNow IT software", RDDT: "Reddit social media platform", SNOW: "Snowflake cloud data warehouse", CRWD: "CrowdStrike",
  MDB: "MongoDB", PLTR: "Palantir", CRM: "Salesforce", IBM: "IBM",
  // Battery & EV
  TSLA: "Tesla", RUM: "Rumble", RIVN: "Rivian",
  // AI & Semiconductors
  BABA: "Alibaba", GOOG: "Google", NVDA: "NVIDIA", TSM: "TSMC", QCOM: "Qualcomm",
  ARM: "ARM Holdings", MU: "Micron", AVGO: "Broadcom",
  // Diversified
  DIS: "Disney entertainment parks", SPY: "S&P 500", BRK: "Berkshire Hathaway", MSFT: "Microsoft", AAPL: "Apple", META: "Meta Facebook",
};

function getSearchName(ticker) {
  return TICKER_NAMES[ticker] || ticker;
}

// ─── Server-side cache ───
let newsCache = { news: [], ts: 0, tickerKey: "" };
const NEWS_CACHE_TTL = 180_000; // 3 minutes

// ─── Sentiment classifier with expanded keywords ───
function classifySentiment(title) {
  const lo = title.toLowerCase();
  if (/surge|jump|rally|gain|beat|record|upgrade|rise|profit|strong|bullish|soar|outperform|buy|boost|grow|accelerat|breakthrough|expand|optimis|upbeat|highest|recover/i.test(lo)) return "positive";
  if (/drop|fall|crash|plunge|miss|cut|downgrade|sell|decline|loss|weak|bearish|tumble|sink|slump|warning|layoff|fraud|investi(?:gat)|lawsuit|recall|bankrupt|risk|fear|concern|slash|worst|underperform/i.test(lo)) return "negative";
  return "neutral";
}

// ─── Google News RSS fetcher ───
async function fetchGoogleRSS(query, timeout = 3500) {
  try {
    const resp = await fetch(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
      { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" }, signal: AbortSignal.timeout(timeout) }
    );
    if (!resp.ok) return [];
    const xml = await resp.text();
    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(xml)) !== null && items.length < 6) {
      const item = m[1];
      const gt = tag => { const r = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`); const x = item.match(r); return x ? x[1].trim().replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"') : ""; };
      const title = gt("title");
      if (!title) continue;
      const source = gt("source");
      const pubDate = gt("pubDate");
      const linkM = item.match(/<link\s*\/?>\s*(https?:\/\/[^\s<]+)/);
      let ds = "";
      try { ds = new Date(pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch {}
      items.push({ title: title.substring(0, 250), summary: ds ? `${ds} — ${source || "Google News"}` : (source || "Google News"), sentiment: classifySentiment(title), source: source || "Google News", link: linkM ? linkM[1] : "", pubDate });
    }
    return items;
  } catch { return []; }
}

// ─── Finviz news scraper (very fast, high quality) ───
async function fetchFinvizNews(tickers, timeout = 4000) {
  const items = [];
  // Finviz supports individual ticker pages — scrape top tickers for max coverage
  const topTickers = tickers.slice(0, 12);
  const results = await Promise.allSettled(
    topTickers.map(async (ticker) => {
      try {
        const resp = await fetch(`https://finviz.com/quote.ashx?t=${ticker}&ty=c&p=d&b=1`, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml",
          },
          signal: AbortSignal.timeout(timeout),
        });
        if (!resp.ok) return [];
        const html = await resp.text();
        // Extract news table rows
        const newsTable = html.match(/class="fullview-news-outer"[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/);
        if (!newsTable) return [];
        const rows = [];
        const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
        let rm;
        while ((rm = rowRe.exec(newsTable[1])) !== null && rows.length < 5) {
          const row = rm[1];
          const linkMatch = row.match(/<a[^>]*href="([^"]*)"[^>]*class="tab-link-news"[^>]*>([\s\S]*?)<\/a>/);
          if (!linkMatch) continue;
          const link = linkMatch[1];
          const title = linkMatch[2].replace(/<[^>]+>/g, '').trim();
          if (!title) continue;
          const sourceMatch = row.match(/<span[^>]*class="news-link-right"[^>]*>\(([^)]*)\)/);
          const source = sourceMatch ? sourceMatch[1] : "Finviz";
          const dateMatch = row.match(/<td[^>]*width="130"[^>]*>([^<]*)/);
          const dateStr = dateMatch ? dateMatch[1].trim() : "";
          rows.push({
            title: title.substring(0, 250),
            summary: `${dateStr} — ${source}`,
            sentiment: classifySentiment(title),
            source,
            link,
            tickers: [ticker],
          });
        }
        return rows;
      } catch { return []; }
    })
  );
  for (const r of results) {
    if (r.status === "fulfilled") items.push(...r.value);
  }
  return items;
}

// ─── Yahoo Finance RSS (fast, broad coverage) ───
async function fetchYahooRSS(tickers, timeout = 3500) {
  const items = [];
  // Yahoo Finance RSS feed for individual tickers
  const topTickers = tickers.slice(0, 15);
  const results = await Promise.allSettled(
    topTickers.map(async (ticker) => {
      try {
        const resp = await fetch(
          `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${ticker}&region=US&lang=en-US`,
          { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(timeout) }
        );
        if (!resp.ok) return [];
        const xml = await resp.text();
        const rows = [];
        const re = /<item>([\s\S]*?)<\/item>/g;
        let m;
        while ((m = re.exec(xml)) !== null && rows.length < 3) {
          const item = m[1];
          const gt = tag => { const r = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`); const x = item.match(r); return x ? x[1].trim().replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"') : ""; };
          const title = gt("title");
          if (!title) continue;
          const pubDate = gt("pubDate");
          const linkM = item.match(/<link\s*\/?>\s*(https?:\/\/[^\s<]+)/);
          let ds = "";
          try { ds = new Date(pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch {}
          rows.push({
            title: title.substring(0, 250),
            summary: `${ds} — Yahoo Finance`,
            sentiment: classifySentiment(title),
            source: "Yahoo Finance",
            link: linkM ? linkM[1] : "",
            tickers: [ticker],
          });
        }
        return rows;
      } catch { return []; }
    })
  );
  for (const r of results) {
    if (r.status === "fulfilled") items.push(...r.value);
  }
  return items;
}

export async function POST(request) {
  const t0 = Date.now();
  try {
    const { tickers } = await request.json();
    if (!tickers?.length) return Response.json({ news: [], ms: 0 });

    // ─── Check server cache ───
    const tickerKey = tickers.sort().join(",");
    const now = Date.now();
    if (newsCache.ts > 0 && (now - newsCache.ts) < NEWS_CACHE_TTL && newsCache.tickerKey === tickerKey) {
      return Response.json({ news: newsCache.news, count: newsCache.news.length, cached: true, ms: Date.now() - t0 });
    }

    const tickerSet = new Set(tickers);
    const tickerNames = {};
    for (const t of tickers) {
      tickerNames[t] = (TICKER_NAMES[t] || t).toLowerCase().split(/\s+/);
    }

    // ─── Build SMARTER Google News queries (fewer, more targeted) ───
    const googleQueries = [];

    // Strategy 1: Company name batches of 4 (fewer, larger batches)
    for (let i = 0; i < Math.min(tickers.length, 60); i += 4) {
      const batch = tickers.slice(i, i + 4).map(t => `"${getSearchName(t)}"`).join(" OR ");
      googleQueries.push(batch);
    }

    // Strategy 2: Top movers / most-watched individual searches (top 8 only)
    const priorityTickers = tickers.filter(t => ["NVDA", "TSLA", "GOOG", "AAPL", "MSFT", "META", "PLTR", "CRWD", "LLY", "ABNB"].includes(t));
    for (const t of priorityTickers.slice(0, 8)) {
      googleQueries.push(`$${t} stock news today`);
    }

    // Strategy 3: Condensed theme searches (6 instead of 12)
    const themeQueries = [
      "AI semiconductor data center stock news",
      "nuclear energy defense security stock",
      "biotech pharma healthcare GLP-1 stock",
      "payments fintech digital stock",
      "travel cruise hospitality entertainment stock",
      "waste environmental infrastructure stock",
    ];
    googleQueries.push(...themeQueries);

    // ─── Fire ALL sources in parallel ───
    const [googleResults, finvizResults, yahooResults] = await Promise.allSettled([
      // Google News RSS (targeted queries)
      Promise.allSettled(googleQueries.map(q => fetchGoogleRSS(q, 3500))),
      // Finviz (fast, high-quality per-ticker news)
      fetchFinvizNews(tickers, 4000),
      // Yahoo Finance RSS (broad per-ticker coverage)
      fetchYahooRSS(tickers, 3500),
    ]).then(results => results.map(r => r.status === "fulfilled" ? r.value : []));

    // ─── Collect all news items ───
    const allNews = [];

    // Process Google News results
    const googleItems = Array.isArray(googleResults) ? googleResults : [];
    for (const result of googleItems) {
      if (!result || result.status !== "fulfilled") continue;
      for (const item of result.value || []) {
        // Match tickers mentioned in headline
        const upperTitle = ` ${item.title.toUpperCase()} `;
        const lowerTitle = item.title.toLowerCase();
        const matched = [];

        for (const t of tickers) {
          if (upperTitle.includes(` ${t} `) || upperTitle.includes(`(${t})`) || upperTitle.includes(`$${t}`)) {
            matched.push(t);
            continue;
          }
          const nameWords = tickerNames[t];
          if (nameWords.length === 1) {
            if (lowerTitle.includes(nameWords[0]) && nameWords[0].length > 2) matched.push(t);
          } else {
            const matchCount = nameWords.filter(w => w.length > 2 && lowerTitle.includes(w)).length;
            if (matchCount >= 2) matched.push(t);
          }
        }

        if (matched.length > 0) {
          allNews.push({ ...item, tickers: [...new Set(matched)].slice(0, 4) });
        }
      }
    }

    // Process Finviz results (already have tickers attached)
    const finvizItems = Array.isArray(finvizResults) ? finvizResults : [];
    for (const item of finvizItems) {
      allNews.push(item);
    }

    // Process Yahoo Finance results (already have tickers attached)
    const yahooItems = Array.isArray(yahooResults) ? yahooResults : [];
    for (const item of yahooItems) {
      allNews.push(item);
    }

    // ─── Deduplicate by title (first 50 chars, case-insensitive) ───
    const seen = new Set();
    const unique = allNews.filter(n => {
      const key = n.title.substring(0, 50).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // ─── Sort: more matched tickers = higher relevance, then sentiment variety ───
    unique.sort((a, b) => {
      // Primary: more ticker matches
      const tickerDiff = (b.tickers?.length || 0) - (a.tickers?.length || 0);
      if (tickerDiff !== 0) return tickerDiff;
      // Secondary: positive > negative > neutral (actionable first)
      const sentOrder = { positive: 0, negative: 1, neutral: 2 };
      return (sentOrder[a.sentiment] ?? 2) - (sentOrder[b.sentiment] ?? 2);
    });

    const finalNews = unique.slice(0, 30);

    // Update cache
    newsCache = { news: finalNews, ts: Date.now(), tickerKey };

    return Response.json({ news: finalNews, count: finalNews.length, total_found: unique.length, queries: googleQueries.length, sources: { google: googleItems.length, finviz: finvizItems.length, yahoo: yahooItems.length }, ms: Date.now() - t0 });
  } catch (e) {
    return Response.json({ news: [], error: e.message, ms: Date.now() - t0 }, { status: 500 });
  }
}

export async function GET() { return Response.json({ status: "ok" }); }
