// app/api/news/route.js — Enhanced coverage for all tickers including small-caps
// Searches by COMPANY NAME (not just ticker symbol) for much better results
// Expanded ticker coverage (62+ holdings), parallel searches, and multi-strategy fallbacks

// Map tickers to company names for better Google News results (~62 active holdings)
const TICKER_NAMES = {
  // Digital Infrastructure & Data Centers
  BE: "Bloom Energy", LITE: "Lumentum Holdings", APP: "AppLovin", CSIQ: "Canadian Solar",
  NBIS: "Nebius Group", IREN: "Iris Energy", APLD: "Applied Digital", VRT: "Vertiv Holdings",
  DBRG: "DigitalBridge", CIEN: "Ciena Corp", AWK: "American Water Works", XYL: "Xylem",
  NEE: "NextEra Energy", PWR: "Quanta Services", DLR: "Digital Realty", EQIX: "Equinix",

  // Experientials & Travel
  ABNB: "Airbnb", LYV: "Live Nation", MSGE: "MSG Entertainment", NCLH: "Norwegian Cruise",
  RCL: "Royal Caribbean", TKO: "TKO Group WWE", MAR: "Marriott", H: "Hyatt Hotels",

  // Nuclear & Security
  BWXT: "BWX Technologies", EXC: "Exelon", GE: "GE Aerospace", DEF: "Defiance Technologies",

  // Payments
  AXP: "American Express", MA: "Mastercard", V: "Visa", PYPL: "PayPal",

  // Security & Defense
  ALRM: "Alarm.com", MSI: "Motorola Solutions", OSIS: "OSI Systems", RTX: "Raytheon",
  LMAB: "Lemonade Insurance", CG: "Carlyle Group",

  // Healthcare & Biotech
  ABBV: "AbbVie", ABT: "Abbott Labs", ADUS: "Addus HomeCare", AMGN: "Amgen",
  DXCM: "DexCom", EHAB: "Enhabit", LLY: "Eli Lilly", MDT: "Medtronic",
  SYK: "Stryker", VTR: "Ventas", WELL: "Welltower",

  // Healthcare Legacy (Silver Economy)
  TNL: "Travel Leisure", CVS: "CVS Health", UNH: "UnitedHealth",

  // Waste & Environmental
  CLH: "Clean Harbors", DAR: "Darling Ingredients", RSG: "Republic Services", WM: "Waste Management",
  TTEK: "Tetra Tech", PSTG: "Pure Storage", ETR: "Entergy",

  // Legacy Software & Cloud
  NOW: "ServiceNow", RDDT: "Reddit", SNOW: "Snowflake", CRWD: "CrowdStrike",
  MDB: "MongoDB", PLTR: "Palantir", CRM: "Salesforce", IBM: "IBM",

  // Battery & EV
  TSLA: "Tesla", RUM: "Rumble", RIVN: "Rivian",

  // AI & Semiconductors
  BABA: "Alibaba", GOOG: "Google", NVDA: "NVIDIA", TSM: "TSMC", QCOM: "Qualcomm",
  ARM: "ARM Holdings", MU: "Micron", AVGO: "Broadcom",

  // Diversified
  DIS: "Disney", SPY: "S&P 500", BRK: "Berkshire Hathaway", MSFT: "Microsoft",
};

function getSearchName(ticker) {
  return TICKER_NAMES[ticker] || ticker;
}

async function fetchRSS(query, timeout = 4000) {
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
    while ((m = re.exec(xml)) !== null && items.length < 8) {
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
    const tickerSet = new Set(tickers);

    // Strategy 1: Search by COMPANY NAME in batches of 3 (more specific results)
    const nameQueries = [];
    for (let i = 0; i < Math.min(tickers.length, 62); i += 3) {
      const batch = tickers.slice(i, i + 3).map(t => getSearchName(t)).join(" OR ");
      nameQueries.push(batch);
    }
    queries.push(...nameQueries);

    // Strategy 2: Individual searches for less-famous small-cap tickers
    const smallCapTickers = tickers.filter(t =>
      !["NVDA", "TSLA", "GOOG", "BABA", "DIS", "ABNB", "LLY", "AMGN", "MA", "V", "GE", "SNOW", "NOW", "RDDT", "MSFT", "IBM", "CRM", "CRWD", "PLTR", "ARM", "TSM", "QCOM"].includes(t)
    );
    for (const ticker of smallCapTickers.slice(0, 20)) {
      queries.push(`${getSearchName(ticker)} stock`);
    }

    // Strategy 3: Famous ticker symbol searches for quick hits
    const famousTickers = tickers.filter(t => ["NVDA", "TSLA", "GOOG", "BABA", "DIS", "ABNB", "LLY", "AMGN", "MA", "V", "GE", "SNOW", "NOW", "RDDT"].includes(t));
    if (famousTickers.length > 0) {
      queries.push(famousTickers.slice(0, 8).map(t => `$${t} stock`).join(" OR "));
    }

    // Strategy 4: Theme-based searches covering ALL themes
    const themeQueries = [
      "AI data center infrastructure energy stock",
      "nuclear power energy generation stock",
      "cybersecurity defense security stock",
      "waste management environmental recycling stock",
      "digital infrastructure cloud data center",
      "payments fintech payment processing",
      "biotech pharma GLP-1 healthcare stock",
      "silver economy aging healthcare senior stock",
      "legacy software enterprise software cloud",
      "battery electric vehicle EV stock",
      "experiential entertainment travel hospitality",
    ];
    queries.push(...themeQueries);

    // Fire ALL queries in parallel with 4s timeout
    const allResults = await Promise.allSettled(
      queries.map(q => fetchRSS(q, 4000))
    );

    // Collect and tag results with matching tickers
    const allNews = [];
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
          // Check company name keywords
          const nameWords = tickerNames[t];
          if (nameWords.length === 1) {
            // Single-word names: require length > 2 (not 3)
            if (lowerTitle.includes(nameWords[0]) && nameWords[0].length > 2) matched.push(t);
          } else {
            // Multi-word names: at least 2 words must match
            const matchCount = nameWords.filter(w => w.length > 2 && lowerTitle.includes(w)).length;
            if (matchCount >= 2) matched.push(t);
          }
        }

        if (matched.length > 0) {
          allNews.push({ ...item, tickers: [...new Set(matched)].slice(0, 4) });
        }
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

    // Return 30 results (increased from 15)
    return Response.json({ news: unique.slice(0, 30), count: unique.length, queries: queries.length, ms: Date.now() - t0 });
  } catch (e) {
    return Response.json({ news: [], error: e.message, ms: Date.now() - t0 }, { status: 500 });
  }
}

export async function GET() { return Response.json({ status: "ok" }); }
