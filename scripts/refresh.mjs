// Refreshes data/weather.json and data/events.json for the Home Board.
// Runs hourly in GitHub Actions (Node 20+, no dependencies).
// Rule: never invent a value. If a source fails, keep that part of the previous file.
import { readFile, writeFile, mkdir } from "node:fs/promises";

const UA = "home-board personal dashboard (GitHub Actions)";
const TZ = "America/Los_Angeles";
const errors = [];
const now = Date.now();

const readJson = async (p) => { try { return JSON.parse(await readFile(p, "utf8")); } catch { return null; } };
async function get(url, { headers = {}, as = "json" } = {}) {
  const r = await fetch(url, { headers: { "User-Agent": UA, ...headers } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return as === "json" ? r.json() : r.text();
}
async function section(name, fn) {
  try { return await fn(); } catch (e) { errors.push(`${name}: ${e.message}`); console.error(`[${name}]`, e.message); return null; }
}
const ent = (s) => String(s || "").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const strip = (s) => ent(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

const prevW = (await readJson("data/weather.json")) || {};
const prevE = await readJson("data/events.json");

/* ---------- 1. National Weather Service (Heavenly + Golden Gate) ---------- */
const nws = await section("NWS forecast", async () => {
  const g = (u) => get("https://api.weather.gov" + u, { headers: { Accept: "application/geo+json" } });
  const MM2IN = 1 / 25.4, M2FT = 3.28084;
  const [hf, hg, ha, sh, mz, sa] = await Promise.all([
    g("/gridpoints/REV/37,81/forecast"), g("/gridpoints/REV/37,81"), g("/alerts/active?point=38.9405,-119.8974"),
    g("/gridpoints/MTR/83,107/forecast/hourly"), g("/zones/forecast/PZZ530/forecast"), g("/alerts/active?zone=PZZ530"),
  ]);
  const dur = (s) => { const m = /P(?:(\d+)D)?T?(?:(\d+)H)?/.exec(s); return ((+m[1] || 0) * 24 + (+m[2] || 0)) * 3600e3; };
  const blocks = hg.properties.snowfallAmount.values.map((v) => { const [st, d] = v.validTime.split("/"); const s = Date.parse(st); return { s, e: s + dur(d), in: v.value * MM2IN }; });
  // Forecast snow still to fall, pro-rating any partly elapsed block.
  const remaining = (h) => { const lim = now + h * 3600e3;
    return +blocks.reduce((a, x) => { const lo = Math.max(x.s, now), hi = Math.min(x.e, lim); return hi > lo ? a + x.in * (hi - lo) / (x.e - x.s) : a; }, 0).toFixed(1); };
  const alerts = (f) => f.features.map((x) => ({ event: x.properties.event, headline: x.properties.headline, ends: x.properties.ends || x.properties.expires }));
  return {
    snow: {
      place: "Heavenly Mountain Resort", gridpoint: "REV 37,81",
      elevationFt: Math.round(hf.properties.elevation.value * M2FT), forecastUpdated: hf.properties.updateTime,
      alerts: alerts(ha),
      periods: hf.properties.periods.slice(0, 6).map((p) => ({ name: p.name, temp: p.temperature, short: p.shortForecast, detail: p.detailedForecast, pop: p.probabilityOfPrecipitation?.value ?? null })),
      snow24hIn: remaining(24), snow72hIn: remaining(72),
      blocks: blocks.filter((x) => x.e > now && x.s < now + 72 * 3600e3).map((x) => ({ start: new Date(x.s).toISOString(), end: new Date(x.e).toISOString(), in: +x.in.toFixed(1) })),
    },
    sail: {
      place: "Golden Gate Bridge", gridpoint: "MTR 83,107", marineZone: "PZZ530 San Francisco Bay",
      marineUpdated: mz.properties.updated,
      marine: mz.properties.periods.slice(0, 2).map((p) => ({ name: p.name, text: p.detailedForecast })),
      hourly: sh.properties.periods.slice(0, 12).map((p) => ({ t: p.startTime, temp: p.temperature, wind: p.windSpeed, dir: p.windDirection, short: p.shortForecast })),
      alerts: alerts(sa),
    },
  };
});

/* ---------- 2. Heavenly resort snow report ---------- */
const resort = await section("Heavenly snow report", async () => {
  const html = await get("https://www.skiheavenly.com/the-mountain/mountain-conditions/snow-and-weather-report.aspx", { as: "text" });
  const m = html.match(/FR\.snowReportData\s*=\s*(\{[\s\S]*?\});/);
  if (!m) throw new Error("snow report data not found on page");
  const d = JSON.parse(m[1]);
  return { in24: +d.TwentyFourHourSnowfall.Inches, in48: +d.FortyEightHourSnowfall.Inches, in7d: +d.SevenDaySnowfall.Inches,
    baseIn: +d.BaseDepth.Inches, seasonIn: +d.CurrentSeason.Inches, updatedText: d.LastUpdatedText, source: "skiheavenly.com snow report" };
});

/* ---------- 3. NRCS SNOTEL 518 Heavenly Valley (hourly, Pacific Standard Time) ---------- */
const snotel = await section("SNOTEL", async () => {
  const f = (d) => d.toISOString().slice(0, 10);
  const url = `https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data?stationTriplets=518:CA:SNTL&elements=SNWD,PREC,TOBS&duration=HOURLY&beginDate=${f(new Date(now - 30 * 86400e3))}%2000:00&endDate=${f(new Date(now + 86400e3))}%2023:59`;
  const d = await get(url);
  const S = {};
  for (const x of d[0].data) S[x.stationElement.elementCode] = Object.fromEntries(x.values.map((v) => [v.date, v.value]));
  const iso = (h) => h.replace(" ", "T") + ":00-08:00", ms = (h) => Date.parse(iso(h));
  const hrs = Object.keys(S.PREC).filter((h) => S.PREC[h] != null).sort();
  // Last snow = most recent hour the gauge reached a new high by >= 0.1 in at <= 34 F.
  let hw = null, last = null;
  for (const h of hrs) { const p = S.PREC[h], t = S.TOBS[h]; if (hw == null) { hw = p; continue; } if (p >= hw + 0.1 - 1e-9) { if (t != null && t <= 34) last = h; hw = p; } }
  const dh = Object.keys(S.SNWD).filter((h) => S.SNWD[h] != null).sort(), lastObs = dh.at(-1), t0 = ms(lastObs) - 24 * 3600e3;
  const w = dh.filter((h) => ms(h) >= t0).map((h) => S.SNWD[h]), p24 = hrs.filter((h) => ms(h) >= t0);
  return { station: "NRCS SNOTEL 518 Heavenly Valley", elevationFt: 8540, lastObs: iso(lastObs), depthIn: S.SNWD[lastObs],
    depthGain24In: Math.max(0, S.SNWD[lastObs] - Math.min(...w)),
    swe24In: +Math.max(0, S.PREC[p24.at(-1)] - S.PREC[p24[0]]).toFixed(1),
    lastSnowAt: last ? iso(last) : null, lookbackDays: 30,
    depthSeries: (() => { const wk = dh.filter((h) => ms(h) >= ms(lastObs) - 7 * 86400e3); return wk.filter((h, i) => i % 3 === 0 || i === wk.length - 1).map((h) => [iso(h), S.SNWD[h]]); })(),
    rule: "Last snow = most recent hour the precipitation gauge reached a new high by at least 0.1 in while air temperature was 34 F or colder" };
});

/* ---------- 4. NOAA tides, currents, observed wind ---------- */
const tides = await section("NOAA tides & currents", async () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const ymd = `${p.year}${p.month}${p.day}`;
  const b = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?time_zone=lst_ldt&units=english&format=json&application=home_board";
  const [t, c, w] = await Promise.all([
    get(b + "&station=9414290&product=predictions&datum=MLLW&interval=hilo&begin_date=" + ymd + "&range=48"),
    get(b + "&station=SFB1203&product=currents_predictions&interval=MAX_SLACK&begin_date=" + ymd + "&range=48"),
    get(b + "&station=9414290&product=wind&date=latest"),
  ]);
  const [th, ch] = await Promise.all([
    get(b + "&station=9414290&product=predictions&datum=MLLW&interval=h&begin_date=" + ymd + "&range=48"),
    get(b + "&station=SFB1203&product=currents_predictions&interval=h&begin_date=" + ymd + "&range=48"),
  ]);
  const iso = (s) => s.replace(" ", "T");
  const out = { windStation: "NOAA 9414290 San Francisco", tideStation: "NOAA 9414290 San Francisco", currentStation: "NOAA SFB1203 Golden Gate Bridge, 0.46 nm E",
    tides: t.predictions.map((x) => ({ t: iso(x.t), type: x.type === "H" ? "High" : "Low", ft: +(+x.v).toFixed(1) })),
    currents: c.current_predictions.cp.map((x) => ({ t: iso(x.Time), type: x.Type, kt: +Math.abs(+x.Velocity_Major).toFixed(1) })) };
  out.tideHourly = th.predictions.map((x) => ({ t: iso(x.t), ft: +(+x.v).toFixed(2) }));
  out.currentHourly = ch.current_predictions.cp.map((x) => ({ t: iso(x.Time), kt: +(+x.Velocity_Major).toFixed(2) }));
  if (w?.data?.[0]) out.obs = { t: iso(w.data[0].t), kt: +(+w.data[0].s).toFixed(1), gustKt: +(+w.data[0].g).toFixed(1), deg: +w.data[0].d, dir: w.data[0].dr };
  return out;
});

/* ---------- 5. FunCheap SF weekend top 5 (refreshed every 6 hours) ---------- */
const eventsAge = prevE?.updatedAt ? now - Date.parse(prevE.updatedAt) : Infinity;
const events = eventsAge < 6 * 3600e3 ? null : await section("FunCheap weekend", async () => {
  const html = await get("https://sf.funcheap.com/weekend/", { as: "text" });
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const weekend = (text.match(/Weekend:\s*([A-Z][a-z]{2} \d{1,2}\s*-\s*[A-Z][a-z]{2} \d{1,2},\s*\d{4})/) || [])[1] || null;
  const i = html.indexOf("Top 5 Most Popular Events");
  if (i < 0) throw new Error("Top 5 list not found");
  const links = [...html.slice(i, i + 6000).matchAll(/<a[^>]+href="(https:\/\/sf\.funcheap\.com\/[^"\/]+\/)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((m) => ({ url: m[1], title: strip(m[2]) })).filter((x) => x.title).slice(0, 5);
  if (!links.length) throw new Error("no events found");
  const list = [];
  for (const l of links) {
    const ev = { ...l, start: null, end: null, venue: null, city: null, price: null };
    try {
      const h = await get(l.url, { as: "text" });
      const lds = [...h.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).flat().filter(Boolean);
      const ld = lds.find((x) => /Event/.test(x["@type"])) || {};
      const a = ld.location?.address;
      const city = typeof a === "string" ? (a.split(",").slice(-2, -1)[0] || "").trim() : (a?.addressLocality || "");
      const pr = ld.offers?.price;
      Object.assign(ev, { start: ld.startDate || null, end: ld.endDate || null, venue: ld.location?.name ? strip(ld.location.name) : null, city: city || null,
        price: pr == null ? null : (+pr === 0 ? "Free" : "$" + (+pr % 1 ? (+pr).toFixed(2) : +pr)) });
    } catch (e) { errors.push(`FunCheap event ${l.url}: ${e.message}`); }
    list.push(ev);
  }
  // Titles, links, dates, venue, city and price only — no event descriptions are copied.
  return { updatedAt: new Date(now).toISOString(), weekend, source: "sf.funcheap.com/weekend — Top 5 Most Popular Events", events: list };
});

/* ---------- write files ---------- */
const keepTides = (s) => s ? Object.fromEntries(["windStation", "tideStation", "currentStation", "tides", "currents", "tideHourly", "currentHourly", "obs"].filter((k) => k in s).map((k) => [k, s[k]])) : {};
const weather = {
  updatedAt: (nws || tides || resort || snotel) ? new Date(now).toISOString() : (prevW.updatedAt || null),
  source: "api.weather.gov; skiheavenly.com; wcc.sc.egov.usda.gov; api.tidesandcurrents.noaa.gov",
  snow: { ...(nws?.snow ?? prevW.snow ?? {}), observed: { resort: resort ?? prevW.snow?.observed?.resort ?? null, snotel: snotel ?? prevW.snow?.observed?.snotel ?? null } },
  sail: { ...(nws?.sail ?? prevW.sail ?? {}), ...(tides ?? keepTides(prevW.sail)) },
  errors,
};
await mkdir("data", { recursive: true });
await writeFile("data/weather.json", JSON.stringify(weather, null, 1) + "\n");
if (events) await writeFile("data/events.json", JSON.stringify(events, null, 1) + "\n");

/* ---------- keep the free Supabase project from pausing (one tiny read) ---------- */
await section("Supabase keep-alive", async () => {
  const cfg = await readFile("config.js", "utf8");
  const url = (cfg.match(/supabaseUrl:\s*"([^"]+)"/) || [])[1], key = (cfg.match(/supabaseAnonKey:\s*"([^"]+)"/) || [])[1];
  if (!url || !key || /YOUR-/.test(url + key)) return;
  const r = await fetch(`${url.replace(/\/$/, "")}/rest/v1/settings?select=key&limit=1`, { headers: { apikey: key } });
  if (!r.ok) throw new Error(`${r.status}`);
});

console.log(errors.length ? `Done with ${errors.length} problem(s):\n- ${errors.join("\n- ")}` : "Done. All sources updated.");
