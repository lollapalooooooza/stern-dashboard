// app/api/stock-news/route.js — Single-ticker Google News fallback for catalyst
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
};

async function fetchRSS(query, timeout = 5000) {
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
    while ((m = re.exec(xml)) !== null && items.length < 12) {
      const item = m[1];
      const gt = tag => { const r = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`); const x = item.match(r); return x ? x[1].trim().replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"') : ""; };
      const title = gt("title");
      if (!title) continue;
      const source = gt("source");
      const pubDate = gt("pubDate");
      const linkM = item.match(/<link\s*\/?>\s*(https?:\/\/[^\s<]+)/);
      let dateStr = "";
      try { dateStr = new Date(pubDate).toISOString().split("T")[0]; } catch {}
      const lo = title.toLowerCase();
      const sent = /surge|jump|rally|gain|beat|record|upgrade|rise|profit|strong|bullish|soar/i.test(lo) ? "positive" : /drop|fall|crash|plunge|miss|cut|downgrade|sell|decline|loss|weak|bearish|tumble|sink/i.test(lo) ? "negative" : "neutral";
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
        sentiment: sent,
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

  const companyName = TICKER_NAMES[symbol] || symbol;

  // Run multiple query strategies in parallel
  const results = await Promise.allSettled([
    fetchRSS(`"${companyName}" stock`),
    fetchRSS(`${symbol} stock market`),
    fetchRSS(`${companyName} earnings revenue`),
  ]);

  const allNews = [];
  const seen = new Set();
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value) {
      const key = item.title.substring(0, 50).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        allNews.push(item);
      }
    }
  }

  return Response.json({ news: allNews.slice(0, 15) });
}
