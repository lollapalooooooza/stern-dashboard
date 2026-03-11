export async function POST(request) {
  try {
    const { tickers } = await request.json();
    if (!tickers?.length) return Response.json({ news: [] });
    const allNews = [];
    const queries = [tickers.slice(0,5).join(" OR ")+" stock", tickers.length>5?tickers.slice(5,10).join(" OR ")+" stock":"stock market investing today"];
    for (const q of queries) {
      try {
        const resp = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, {
          headers:{"User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}, signal:AbortSignal.timeout(10000)
        });
        if (!resp.ok) continue;
        const xml = await resp.text();
        const re = /<item>([\s\S]*?)<\/item>/g;
        let m, cnt=0;
        while ((m=re.exec(xml))!==null && cnt<5) {
          const item=m[1];
          const gt=tag=>{const r=new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`);const x=item.match(r);return x?x[1].trim().replace(/&amp;/g,"&").replace(/&#39;/g,"'").replace(/&quot;/g,'"'):""};
          const title=gt("title"), source=gt("source"), pubDate=gt("pubDate");
          const linkM=item.match(/<link\s*\/?>\s*(https?:\/\/[^\s<]+)/);
          if (!title) continue;
          const upper=` ${title.toUpperCase()} `;
          const matched=tickers.filter(t=>upper.includes(` ${t.toUpperCase()} `)||upper.includes(`(${t.toUpperCase()})`));
          const lo=title.toLowerCase();
          const sent=/surge|jump|rally|gain|beat|record|upgrade|rise|profit|strong/i.test(lo)?"positive":/drop|fall|crash|plunge|miss|cut|downgrade|sell|decline|loss|weak/i.test(lo)?"negative":"neutral";
          let ds="";try{ds=new Date(pubDate).toLocaleDateString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}catch{}
          allNews.push({title:title.substring(0,250),summary:ds?`${ds} — ${source||"Google News"}`:(source||"Google News"),tickers:matched.slice(0,4),sentiment:sent,source:source||"Google News",link:linkM?linkM[1]:""});
          cnt++;
        }
      } catch{}
    }
    const seen=new Set();
    const uniq=allNews.filter(n=>{const k=n.title.substring(0,50).toLowerCase();if(seen.has(k))return false;seen.add(k);return true});
    return Response.json({news:uniq.slice(0,10)});
  } catch(e) {
    return Response.json({news:[],error:e.message},{status:500});
  }
}
export async function GET(){return Response.json({status:"ok"})}
