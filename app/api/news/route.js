// app/api/news/route.js — Better coverage for all tickers including small-caps
// Searches by COMPANY NAME (not just ticker symbol) for much better results

// Map tickers to company names for better Google News results
const TICKER_NAMES = {
  BE: "Bloom Energy", LITE: "Lumentum Holdings", APP: "AppLovin", CSIQ: "Canadian Solar",
  NBIS: "Nebius Group", IREN: "Iris Energy", APLD: "Applied Digital", VRT: "Vertiv Holdings",
  DBRG: "DigitalBridge", CIEN: "Ciena Corp", AWK: "American Water Works", XYL: "Xylem water",
  NEE: "NextEra Energy", PWR: "Quanta Services", DLR: "Digital Realty", EQIX: "Equinix",
  ABNB: "Airbnb", LYV: "Live Nation", MSGE: "MSG Entertainment", NCLH: "Norwegian Cruise",
  RCL: "Royal Caribbean", TKO: "TKO Group WWE", MAR: "Marriott", H: "Hyatt Hotels",
  BWXT: "BWX Technologies nuclear", EXC: "Exelon nuclear", GE: "GE Aerospace",
  AXP: "American Express", MA: "Mastercard", V: "Visa payments",
  ALRM: "Alarm.com", MSI: "Motorola Solutions", OSIS: "OSI Systems security", RTX: "RTX Raytheon defense",
  ABBV: "AbbVie pharma", ABT: "Abbott Labs", ADUS: "Addus HomeCare", AMGN: "Amgen biotech",
  DXCM: "DexCom diabetes", EHAB: "Enhabit Home Health", LLY: "Eli Lilly obesity GLP-1",
  MDT: "Medtronic devices", SYK: "Stryker orthopedic", TNL: "Travel Leisure vacation",
  VTR: "Ventas healthcare REIT", WELL: "Welltower senior housing",
  CLH: "Clean Harbors waste", DAR: "Darling Ingredients rendering", RSG: "Republic Services waste",
  TTEK: "Tetra Tech environmental", WM: "Waste Management",
  NOW: "ServiceNow software", RDDT: "Reddit social media", SNOW: "Snowflake cloud data",
  BABA: "Alibaba China AI", GOOG: "Google Alphabet AI", NVDA: "NVIDIA AI chips",
  TSLA: "Tesla electric vehicle", TSM: "TSMC semiconductor",
  DIS: "Disney entertainment", SPY: "S&P 500 index",
};

function getSearchName(ticker) {
  return TICKER_NAMES[ticker] || ticker;
}

async function fetchRSS(query, timeout = 6000) {
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
    while ((m = re.exec(xml)) !== null && items.length < 5) {
      const item = m[1];
      const gt = tag => { const r = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`); const x = item.match(r); return x ? x[1].trim().replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"') : ""; };
      const title = gt("title");
      if (!title) continue;
      const source = gt("source");
      const pubDate = gt("pubDate");
      const linkM = item.match(/<link\s*\/?>\s*(https?:\/\/[^\s<]+)/);
      let ds = "";
      try { ds = new Date(pubDate).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch {}
      const lo = title.toLowerCase();
      const sent = /surge|jump|rally|gain|beat|record|upgrade|rise|profit|strong|bullish|soar/i.test(lo) ? "positive" : /drop|fall|crash|plunge|miss|cut|downgrade|sell|decline|loss|weak|bearish|tumble|sink/i.test(lo) ? "negative" : "neutral";
      items.push({ title: title.substring(0, 250), summary: ds ? `${ds} — ${source || "Google News"}` : (source || "Google News"), sentiment: sent, source: source || "Google News", link: linkM ? linkM[1] : "" });
    }
    return items;
  } catch { return []; }
}

export async function POST(request) {
  const t0 = Date.now();
  try {
    const { tickers } = await request.json();
    if (!tickers?.length) return Response.json({ news: [], ms: 0 });

    // Build multiple search queries for better coverage
    const queries = [];

    // Query 1-3: Search by COMPANY NAME (much better for small-caps)
    const nameQueries = [];
    for (let i = 0; i < Math.min(tickers.length, 12); i += 4) {
      const batch = tickers.slice(i, i + 4).map(t => getSearchName(t)).join(" OR ");
      nameQueries.push(batch);
    }

    // Query 4: Search by ticker symbols for well-known ones
    const famousTickers = tickers.filter(t => ["NVDA", "TSLA", "GOOG", "BABA", "DIS", "ABNB", "LLY", "AMGN", "MA", "V", "GE", "SNOW", "NOW", "RDDT"].includes(t));
    if (famousTickers.length > 0) {
      queries.push(famousTickers.slice(0, 6).map(t => `$${t} stock`).join(" OR "));
    }

    // Query 5: Theme-based searches for broader coverage
    queries.push("AI data center infrastructure energy stock market");
    queries.push("healthcare biotech pharma GLP-1 stock");

    // Fire ALL queries in parallel
    const allQueries = [...nameQueries, ...queries];
    const allResults = await Promise.allSettled(
      allQueries.map(q => fetchRSS(q, 5000))
    );

    // Collect and tag results with matching tickers
    const allNews = [];
    const tickerUpper = new Set(tickers.map(t => t.toUpperCase()));
    const tickerNames = {};
    for (const t of tickers) {
      tickerNames[t] = (TICKER_NAMES[t] || t).toLowerCase().split(/\s+/);
    }

    for (const result of allResults) {
      if (result.status !== "fulfilled") continue;
      for (const item of result.value) {
        // Match tickers mentioned in headline (by ticker symbol OR company name keywords)
        const upperTitle = ` ${item.title.toUpperCase()} `;
        const lowerTitle = item.title.toLowerCase();
        const matched = [];

        for (const t of tickers) {
          // Check ticker symbol
          if (upperTitle.includes(` ${t} `) || upperTitle.includes(`(${t})`) || upperTitle.includes(`$${t}`)) {
            matched.push(t);
            continue;
          }
          // Check company name keywords (at least 2 words must match for multi-word names)
          const nameWords = tickerNames[t];
          if (nameWords.length === 1) {
            if (lowerTitle.includes(nameWords[0]) && nameWords[0].length > 3) matched.push(t);
          } else {
            const matchCount = nameWords.filter(w => w.length > 2 && lowerTitle.includes(w)).length;
            if (matchCount >= 2) matched.push(t);
          }
        }

        allNews.push({ ...item, tickers: [...new Set(matched)].slice(0, 4) });
      }
    }

    // Deduplicate by title
    const seen = new Set();
    const unique = allNews.filter(n => {
      const key = n.title.substring(0, 50).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort: items with matched tickers first, then by relevance
    unique.sort((a, b) => (b.tickers.length - a.tickers.length));

    return Response.json({ news: unique.slice(0, 15), count: unique.length, queries: allQueries.length, ms: Date.now() - t0 });
  } catch (e) {
    return Response.json({ news: [], error: e.message, ms: Date.now() - t0 }, { status: 500 });
  }
}

export async function GET() { return Response.json({ status: "ok" }); }
