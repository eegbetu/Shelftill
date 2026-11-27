// Runs every hour on GitHub (see .github/workflows/news.yml). Reads public headline feeds from news sites
// and approximate exchange rates, and writes news.json for the home page. Only headlines, a short summary,
// the source and a link to the full story on the source's own site are kept.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// Sections of the home page, and the publishers' public headline feeds for each.
const FEEDS = {
  top: [
    ["Premium Times", "https://www.premiumtimesng.com/feed"],
    ["Vanguard", "https://www.vanguardngr.com/feed/"],
    ["Channels TV", "https://www.channelstv.com/feed/"],
    ["BBC News", "https://feeds.bbci.co.uk/news/world/africa/rss.xml"],
  ],
  politics: [
    ["Vanguard", "https://www.vanguardngr.com/category/politics/feed/"],
    ["Channels TV", "https://www.channelstv.com/category/politics/feed/"],
    ["Premium Times", "https://www.premiumtimesng.com/news/politics/feed"],
    ["The Cable", "https://www.thecable.ng/category/politics/feed"],
  ],
  nigeria: [
    ["Nairametrics", "https://nairametrics.com/feed/"],
    ["BusinessDay", "https://businessday.ng/feed/"],
    ["Premium Times", "https://www.premiumtimesng.com/business/feed"],
    ["Vanguard", "https://www.vanguardngr.com/category/business/feed/"],
  ],
  world: [
    ["BBC News", "https://feeds.bbci.co.uk/news/world/rss.xml"],
    ["Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml"],
    ["CNBC", "https://www.cnbc.com/id/10001147/device/rss/rss.html"],
    ["BBC News", "https://feeds.bbci.co.uk/news/business/rss.xml"],
  ],
  sports: [
    ["BBC Sport", "https://feeds.bbci.co.uk/sport/football/rss.xml"],
    ["Vanguard", "https://www.vanguardngr.com/category/sports/feed/"],
    ["Channels TV", "https://www.channelstv.com/category/sports/feed/"],
    ["BBC Sport", "https://feeds.bbci.co.uk/sport/rss.xml"],
  ],
  entertainment: [
    ["Vanguard", "https://www.vanguardngr.com/category/entertainment/feed/"],
    ["BBC News", "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml"],
    ["Pulse Nigeria", "https://www.pulse.ng/rss"],
    ["Premium Times", "https://www.premiumtimesng.com/entertainment/feed"],
  ],
  tech: [
    ["TechCabal", "https://techcabal.com/feed/"],
    ["Techpoint Africa", "https://techpoint.africa/feed/"],
    ["BBC News", "https://feeds.bbci.co.uk/news/technology/rss.xml"],
    ["Techeconomy", "https://techeconomy.ng/feed/"],
  ],
};
const RATES_URL = "https://open.er-api.com/v6/latest/USD";
const RATE_CODES = ["USD", "GBP", "EUR", "CNY", "GHS"];
const CRYPTO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether&vs_currencies=ngn,usd&include_24hr_change=true";
const PER_SOURCE = 4, PER_SECTION = 14, MAX_AGE_H = 72;

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", naira: "₦" };
const decode = s => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
const clean = s => decode(String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i")); return m ? m[1] : ""; };
// Summaries without the clutter some feeds add ("read more…", "The post … appeared first on …", a leading dash).
const tidy = s => s.replace(/\s*The post .*? appeared first on .*$/i, "").replace(/\s*(read more|continue reading)\b.*$/i, "")
  .replace(/\[(…|\.\.\.)\]\s*$/, "").replace(/^[\s—–-]+/, "").trim();
const short = (s, n) => s.length <= n ? s : s.slice(0, s.lastIndexOf(" ", n) > 40 ? s.lastIndexOf(" ", n) : n).replace(/[,.;:\s]+$/, "") + "…";

async function get(url) {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; ShelfTillNews/1.0; +https://eegbetu.github.io/Shelftill/)", accept: "application/rss+xml, application/xml, text/xml, application/json, */*" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

async function readFeed([source, url]) {
  try {
    const xml = await get(url);
    const items = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map(m => m[0]).slice(0, 15).map(it => {
      let link = clean(tag(it, "link")) || clean(tag(it, "guid"));
      const t = Date.parse(clean(tag(it, "pubDate")) || clean(tag(it, "dc:date")));
      return { title: clean(tag(it, "title")), link, summary: short(tidy(clean(tag(it, "description"))), 170), source, t: isNaN(t) ? 0 : t };
    }).filter(i => i.title && /^https?:\/\//.test(i.link) && i.t && Date.now() - i.t < MAX_AGE_H * 3600e3 && i.t < Date.now() + 3600e3);
    console.log(`${source}: ${items.length} recent stories`);
    return items.slice(0, PER_SOURCE);
  } catch (e) { console.log(`${source}: failed (${e.message})`); return []; }
}

async function section(list) {
  const all = (await Promise.all(list.map(readFeed))).flat();
  const seen = new Set();
  return all.sort((a, b) => b.t - a.t).filter(i => { const k = i.title.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, PER_SECTION);
}

async function rates() {
  try {
    const j = JSON.parse(await get(RATES_URL));
    if (j.result !== "success" || !j.rates?.NGN) throw new Error("no NGN rate");
    const ngnPerUsd = j.rates.NGN;
    return { asOf: j.time_last_update_unix * 1000, list: RATE_CODES.map(c => ({ code: c, ngn: Math.round((ngnPerUsd / j.rates[c]) * 100) / 100 })).filter(r => isFinite(r.ngn) && r.ngn > 0) };
  } catch (e) { console.log(`Rates: failed (${e.message})`); return null; }
}

async function crypto() {
  try {
    const j = JSON.parse(await get(CRYPTO_URL));
    const pick = (id, code, name) => j[id]?.ngn ? { code, name, ngn: j[id].ngn, usd: j[id].usd, change: Math.round((j[id].ngn_24h_change ?? j[id].usd_24h_change ?? 0) * 10) / 10 } : null;
    const list = [pick("bitcoin", "BTC", "Bitcoin"), pick("ethereum", "ETH", "Ethereum"), pick("tether", "USDT", "Tether")].filter(Boolean);
    return list.length ? { asOf: Date.now(), list } : null;
  } catch (e) { console.log(`Crypto: failed (${e.message})`); return null; }
}

const old = existsSync("news.json") ? JSON.parse(readFileSync("news.json", "utf8")) : {};
const keys = Object.keys(FEEDS);
const got = await Promise.all([...keys.map(k => section(FEEDS[k])), rates(), crypto()]);
const next = {};
keys.forEach((k, n) => { next[k] = got[n].length ? got[n] : old[k] || []; console.log(`${k}: ${next[k].length}`); });
next.rates = got[keys.length] || old.rates || null;
// Crypto prices move all the time: only refresh them when headlines or rates changed too, or every few hours.
const fresh = got[keys.length + 1];
const prevSame = JSON.stringify(keys.map(k => next[k]).concat([next.rates])) === JSON.stringify(keys.map(k => old[k]).concat([old.rates]));
const cryptoDue = !old.crypto || Date.now() - old.crypto.asOf > 3 * 3600e3;
next.crypto = fresh && (!prevSame || cryptoDue) ? fresh : old.crypto || fresh || null;
if (prevSame && next.crypto === old.crypto) console.log("No change");
else { writeFileSync("news.json", JSON.stringify({ updated: Date.now(), ...next }, null, 1)); console.log("Wrote news.json"); }
