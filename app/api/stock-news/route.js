// app/api/stock-news/route.js — Fast single-ticker Google News + Yahoo Finance fallback
// Used when the catalyst backend has no news for a symbol

const TICKER_NAMES = {
  BE: "Bloom Energy", LITE: "Lumentum Holdings", APP: "AppLovin", CSIQ: "Canadian Solar",
  NBIS: "Nebius Group", IREN: "Iris Energy", APLD: "Applied Digital", VRT: "Vertiv Holdings",
  DBRG: "DigitalBridge", CIEN: "Ciena Corporation", AWK: "American Water Works", XYL: "Xylem",
  NEE: "NextEra Energy", PWR: "Quanta Services", DLR: "Digital Realty", EQIX: "Equinix",
  ABNB: "Airbnb", LYV: "Live Nation", MSGE: "MSG Entertainment", NCLH: "Norwegian Cruise Line",
  RCL: "Royal Caribbean", TKO: "TKO Group", MAR: "Marriott", H: "Hyatt Hotels",
  TNL: "Travel + Leisure", BWXT: "BWX Technologies", EXC: "Exelon", GE: "GE Aerospace",
  AXP: "American Express", MA: "Mastercard", V: "Visa", PYPL: "PayPal",
  ALRM: "Alarm.com", MSI: "Motorola Solutions", OSIS: "OSI Systems", RTX: "RTX Raytheon",
  ABBV: "AbbVie", ABT: "Abbott Laboratories", ADUS: "Addus HomeCare", AMGN: "Amgen",
  DXCM: "DexCom", EHAB: "Enhabit", LLY: "Eli Lilly", MDT: "Medtronic",
  SYK: "Stryker", VTR: "Ventas", WELL: "Welltower", CVS: "CVS Health", UNH: "UnitedHealth",
  CLH: "Clean Harbors", DAR: "Darling Ingredients", RSG: "Republic Services", WM: "Waste Management",
  TTEK: "Tetra Tech", PSTG: "Pure Storage", ETR: "Entergy",
  NOW: "ServiceNow", RDDT: "Reddit", SNOW: "Snowflake", CRWD: "CrowdStrike",
  MDB: "MongoDB", PLTR: "Palantir", CRM: "Salesforce", IBM: "IBM",
  TSLA: "Tesla", RIVN: "Rivian", BABA: "Alibaba", GOOG: "Google", NVDA: "NVIDIA",
  TSM: "TSMC", QCOM: "Qualcomm", ARM: "ARM Holdings", MU: "Micron", AVGO: "Broadcom",
  DIS: "Disney", MSFT: "Microsoft", AAPL: "Apple", META: "Meta Platforms",
  DEF: "Defiance Technologies", LMAB: "Lemonade Insurance", CG: "Carlyle Group",
  RUM: "Rumble", BRK: "Berkshire Hathaway",
};

// Server-side cache per symbol (2 min TTL)
const stockNewsCache = new Map();
const CACHE_TTL = 120_000;

function classifySentiment(title) {
  const lo = title.toLowerCase();
  if (/surge|jump|rally|gain|beat|record|upgrade|rise|profit|strong|bullish|soar|outperform|buy|boost|grow|highest|recover/i.test(lo)) return "positive";
  if (/drop|fall|crash|plunge|miss|cut|downgrade|sell|decline|loss|weak|bearish|tumble|sink|slump|warning|layoff|lawsuit|recall|worst|underperform/i.test(lo)) return "negative";
  return "neutral";
}

async function fetchRSS(query, timeout = 3500) {
  try {
    const resp = await fetch(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(timeout) }
    );
    if (!resp.ok) return [];
    const xml = await resp.text();
    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(xml)) !== null && items.length < 10) {
      const item = m[1];
      const gt = tag => { const r = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`); const x = item.match(r); return x ? x[1].trim().replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"') : ""; };
      const title = gt("title");
      if (!title) continue;
      const source = gt("source");
      const pubDate = gt("pubDate");
      const linkM = item.match(/<link\s*\/?>\s*(https?:\/\/[^\s<]+)/);
      let dateStr = "";
      try { dateStr = new Date(pubDate).toISOString().split("T")[0]; } catch {}
      items.push({
        news_id: `gn-${items.length}-${Date.now()}`,
        trade_date: dateStr,
        published_utc: pubDate,
        title: title.substring(0, 300),
        description: "",
        publisher: source || "Google News",
        article_url: linkM ? linkM[1] : "",
        image_url: null,
        relevance: null,
        key_discussion: null,
        sentiment: classifySentiment(title),
        reason_growth: null,
        reason_decrease: null,
        ret_t0: null,
        ret_t1: null,
      });
    }
    return items;
  } catch { return []; }
}

async function fetchYahooRSS(ticker, timeout = 3000) {
  try {
    const resp = await fetch(
      `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${ticker}&region=US&lang=en-US`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(timeout) }
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
      const pubDate = gt("pubDate");
      const linkM = item.match(/<link\s*\/?>\s*(https?:\/\/[^\s<]+)/);
      let dateStr = "";
      try { dateStr = new Date(pubDate).toISOString().split("T")[0]; } catch {}
      items.push({
        news_id: `yf-${items.length}-${Date.now()}`,
        trade_date: dateStr,
        published_utc: pubDate,
        title: title.substring(0, 300),
        description: "",
        publisher: "Yahoo Finance",
        article_url: linkM ? linkM[1] : "",
        image_url: null,
        relevance: null,
        key_discussion: null,
        sentiment: classifySentiment(title),
        reason_growth: null,
        reason_decrease: null,
        ret_t0: null,
        ret_t1: null,
      });
    }
    return items;
  } catch { return []; }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") || "").toUpperCase();
  if (!symbol) return Response.json({ news: [] });

  // Check cache
  const cached = stockNewsCache.get(symbol);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return Response.json({ news: cached.news, cached: true });
  }

  const companyName = TICKER_NAMES[symbol] || symbol;

  // Run all query strategies in parallel (Google + Yahoo)
  const results = await Promise.allSettled([
    fetchRSS(`"${companyName}" stock`),
    fetchRSS(`${symbol} stock market`),
    fetchRSS(`${companyName} earnings revenue`),
    fetchYahooRSS(symbol),
  ]);

  const allNews = [];
  const seen = new Set();
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value) {
      const key = item.title.substring(0, 50).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!seen.has(key)) {
        seen.add(key);
        allNews.push(item);
      }
    }
  }

  const finalNews = allNews.slice(0, 20);

  // Cache
  stockNewsCache.set(symbol, { news: finalNews, ts: Date.now() });

  return Response.json({ news: finalNews });
}
