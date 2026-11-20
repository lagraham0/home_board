// Builds data/wall.json: finished HTML + SVG for the display-only wall page (wall.html),
// so an old iPad (iOS 9) only has to show it. Run by refresh.mjs after the data refresh.
// The chart code below is shared with index.html.
import { readFile, writeFile } from "node:fs/promises";
const TZ = "America/Los_Angeles";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ---------- time helpers (all display in Pacific time) ---------- */
const fmtTime = d => new Date(d).toLocaleTimeString("en-US",{timeZone:TZ,hour:"numeric",minute:"2-digit"});
const fmtHour = d => new Date(d).toLocaleTimeString("en-US",{timeZone:TZ,hour:"numeric"});
function laParts(d = new Date()){
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23",weekday:"short"}).formatToParts(d).map(x=>[x.type,x.value]));
  return {ymd:`${p.year}-${p.month}-${p.day}`, wall:`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`, hour:+p.hour, wd:p.weekday};
}
/* NOAA times are Pacific wall-clock strings "YYYY-MM-DDTHH:MM" */
function wallLabel(s){ const [d,t]=s.split("T"); let [h,m]=t.split(":").map(Number); const ap=h>=12?"PM":"AM"; h=h%12||12;
  const day = d===laParts().ymd ? "" : (d===addDays(laParts().ymd,1) ? "Tmrw " : d.slice(5)+" "); return `${day}${h}:${String(m).padStart(2,"0")} ${ap}`; }
function addDays(ymd,n){ const [y,m,d]=ymd.split("-").map(Number); const dt=new Date(Date.UTC(y,m-1,d+n)); return dt.toISOString().slice(0,10); }
function dayName(ymd){ const t=laParts().ymd; if(ymd===t) return "Today"; if(ymd===addDays(t,1)) return "Tomorrow";
  const [y,m,d]=ymd.split("-").map(Number); return new Date(Date.UTC(y,m-1,d,12)).toLocaleDateString("en-US",{timeZone:"UTC",weekday:"long",month:"short",day:"numeric"}); }
function ago(iso){ if(!iso) return null; const m=Math.round((Date.now()-Date.parse(iso))/60000); return m; }
function ageChip(iso){ const m=ago(iso); if(m==null) return `<span class="chip mute">No data yet</span>`;
  const txt = m<1?"Updated just now": m<60?`Updated ${m} min ago`: `Updated ${Math.floor(m/60)} h ${m%60} min ago`;
  const cls = m<=90?"ok": m<=360?"warn":"crit"; return `<span class="chip ${cls}" title="${esc(new Date(iso).toLocaleString("en-US",{timeZone:TZ}))}">${txt}</span>`; }


const MPH2KT = 0.868976;
const toKt = s => String(s||"").replace(/\d+(\.\d+)?/g, n => Math.round(+n*MPH2KT)).replace(/\s*mph/i,"");
const DIRS = {N:0,NNE:22.5,NE:45,ENE:67.5,E:90,ESE:112.5,SE:135,SSE:157.5,S:180,SSW:202.5,SW:225,WSW:247.5,W:270,WNW:292.5,NW:315,NNW:337.5};
const alertChips = arr => (arr||[]).map(a => { const sev=/warning/i.test(a.event)?"crit":/advisory|watch/i.test(a.event)?"warn":"mute";
  return `<span class="chip ${sev}" title="${esc(a.headline)}">${esc(a.event)}${a.ends?` · until ${esc(fmtTime(a.ends))}`:""}</span>`; }).join("");

/* ---------- charts: inline SVG drawn to scale, colours from theme tokens ---------- */
const hourLbl = t => new Date(t).toLocaleTimeString("en-US",{timeZone:TZ,hour:"numeric"}).replace(" AM","a").replace(" PM","p");
const hmLbl = t => new Date(t).toLocaleTimeString("en-US",{timeZone:TZ,hour:"numeric",minute:"2-digit"}).replace(" AM","a").replace(" PM","p");
const dayLbl = t => new Date(t).toLocaleDateString("en-US",{timeZone:TZ,weekday:"short"});
const laHour = t => +new Intl.DateTimeFormat("en-US",{timeZone:TZ,hour:"numeric",hourCycle:"h23"}).format(new Date(t));
const laDate = t => laParts(new Date(t)).ymd;
const niceStep = (span, n=4) => { for(const st of [0.5,1,2,5,10,20,25,50,100]) if(span/st <= n) return st; return 200; };
const fmt1 = v => String(Math.round(v*10)/10);
/* NOAA times are Pacific wall-clock strings; find the matching instant (PST or PDT). */
const wallMs = s => { for(const off of ["-08:00","-07:00"]){ const m = Date.parse(s.slice(0,16)+":00"+off); if(laParts(new Date(m)).wall === s.slice(0,16)) return m; } return Date.parse(s.slice(0,16)+":00-08:00"); };
const ktRange = s => { const n = (toKt(s).match(/\d+/g)||[]).map(Number); return n.length ? [Math.min(...n), Math.max(...n)] : null; };

function lineChart({pts, w=560, h=118, yMin=0, yMax, step, cls="sea", signed=false, band=null, marks=[], nowY=null, arrows=null, xDays=false, label=""}){
  if(!pts || pts.length < 2) return "";
  const L=30, R=10, T=arrows?24:14, B=18, iw=w-L-R, ih=h-T-B, t0=pts[0].t, t1=pts[pts.length-1].t, now=Date.now();
  const X = t => L + (t-t0)/(t1-t0)*iw, Y = v => T + (yMax-v)/(yMax-yMin)*ih, f = n => n.toFixed(1);
  let g = "";
  for(let v = Math.ceil(yMin/step)*step; v <= yMax+1e-9; v += step){ const y = f(Y(v));
    g += `<line class="c-grid${v===0&&yMin<0?" c-zero":""}" x1="${L}" x2="${w-R}" y1="${y}" y2="${y}"/><text class="c-t" x="${L-5}" y="${f(+y+3.5)}" text-anchor="end">${fmt1(Math.abs(v))}</text>`; }
  if(xDays){ let last = laDate(t0); for(const p of pts){ const d = laDate(p.t); if(d !== last && X(p.t) > L+10 && X(p.t) < w-R-10){ g += `<line class="c-grid" x1="${f(X(p.t))}" x2="${f(X(p.t))}" y1="${T}" y2="${h-B}"/><text class="c-t" x="${f(X(p.t))}" y="${h-4}" text-anchor="middle">${dayLbl(p.t)}</text>`; } last = d; } }
  else for(const p of pts){ if(laHour(p.t)%3===0 && X(p.t) > L+10 && X(p.t) < w-R-10) g += `<text class="c-t" x="${f(X(p.t))}" y="${h-4}" text-anchor="middle">${hourLbl(p.t)}</text>`; }
  const path = arr => arr.map((p,i) => `${i?"L":"M"}${f(X(p.t))},${f(Y(p.y))}`).join("");
  const area = (arr, base) => `${path(arr)}L${f(X(arr[arr.length-1].t))},${f(Y(base))}L${f(X(arr[0].t))},${f(Y(base))}Z`;
  let body = "";
  if(band) body += `<path class="c-band ${cls}" d="${band.map((p,i)=>`${i?"L":"M"}${f(X(p.t))},${f(Y(p.hi))}`).join("")}${band.slice().reverse().map(p=>`L${f(X(p.t))},${f(Y(p.lo))}`).join("")}Z"/>`;
  if(signed){
    // split at zero crossings so flood and ebb areas meet exactly on the zero line
    const seg = []; for(let i=0;i<pts.length;i++){ const a = pts[i], b = pts[i+1]; seg.push(a); if(b && (a.y<0) !== (b.y<0) && a.y !== 0 && b.y !== 0){ seg.push({t:a.t + (b.t-a.t)*(a.y/(a.y-b.y)), y:0}); } }
    body += `<path class="c-area flood" d="${area(seg.map(p=>({t:p.t,y:Math.max(0,p.y)})),0)}"/><path class="c-area ebb" d="${area(seg.map(p=>({t:p.t,y:Math.min(0,p.y)})),0)}"/>`;
    body += `<path class="c-line ink" d="${path(seg)}"/>`;
  } else { body += `<path class="c-area ${cls}" d="${area(pts, yMin)}"/><path class="c-line ${cls}" d="${path(pts)}"/>`; }
  if(arrows) for(const a of arrows){ if(a.deg==null) continue; body += `<g transform="translate(${f(X(a.t))},11) rotate(${a.deg})"><path class="c-arrow" d="M0,6 L-3.5,-5 L0,-2.5 L3.5,-5Z"/></g>`; }
  for(const m of marks){ const x = X(m.t), y = Y(m.y); if(x < L || x > w-R) continue;
    const anchor = x < L+34 ? "start" : x > w-R-34 ? "end" : "middle";
    body += `<circle class="c-mark" cx="${f(x)}" cy="${f(y)}" r="2.5"/><text class="c-lab" x="${f(x)}" y="${f(m.up ? Math.max(10, y-6) : Math.min(h-B-2, y+13))}" text-anchor="${anchor}">${esc(m.label)}</text>`; }
  if(now >= t0 && now <= t1){ const x = f(X(now)); body += `<line class="c-now" x1="${x}" x2="${x}" y1="${T}" y2="${h-B}"/>`;
    if(nowY != null) body += `<circle class="c-dot" cx="${x}" cy="${f(Y(nowY))}" r="4"/>`; }
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${g}${body}</svg>`;
}
function barChart({bars, w=300, h=118, label=""}){
  if(!bars || !bars.length) return "";
  const L=26, R=6, T=16, B=18, iw=w-L-R, ih=h-T-B, f = n => n.toFixed(1);
  const t0 = Date.parse(bars[0].start), t1 = Date.parse(bars[bars.length-1].end), X = t => L + (t-t0)/(t1-t0)*iw;
  const max = Math.max(...bars.map(b => b.in)), yMax = Math.max(1, Math.ceil(max)), step = niceStep(yMax, 3), Y = v => T + (yMax-v)/yMax*ih;
  let g = ""; for(let v=0; v<=yMax+1e-9; v+=step){ const y=f(Y(v)); g += `<line class="c-grid" x1="${L}" x2="${w-R}" y1="${y}" y2="${y}"/><text class="c-t" x="${L-4}" y="${f(+y+3.5)}" text-anchor="end">${fmt1(v)}</text>`; }
  const days = {}; let body = "";
  for(const b of bars){ const s = Date.parse(b.start), e = Date.parse(b.end), x0 = X(s)+1.5, x1 = X(e)-1.5;
    { const dk = laDate((s+e)/2); if(!days[dk]) days[dk] = []; days[dk].push((x0+x1)/2); }
    if(b.in > 0){ body += `<rect class="c-bar" x="${f(x0)}" y="${f(Y(b.in))}" width="${f(Math.max(1,x1-x0))}" height="${f(Y(0)-Y(b.in))}" rx="2"/>`;
      if(b.in >= 0.1) body += `<text class="c-lab" x="${f((x0+x1)/2)}" y="${f(Y(b.in)-3)}" text-anchor="middle">${fmt1(b.in)}</text>`; } }
  for(const [d, xs] of Object.entries(days)){ const x = xs.reduce((a,c)=>a+c,0)/xs.length; const [yy,mm,dd] = d.split("-").map(Number);
    g += `<text class="c-t" x="${f(x)}" y="${h-4}" text-anchor="middle">${new Date(Date.UTC(yy,mm-1,dd,12)).toLocaleDateString("en-US",{timeZone:"UTC",weekday:"short"})}</text>`; }
  if(max === 0) body += `<text class="c-t" x="${f(L+iw/2)}" y="${f(T+ih/2)}" text-anchor="middle">No new snow forecast</text>`;
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${g}${body}</svg>`;
}
function dialSvg(deg, kt){
  const c = 70, P = (a, r) => [c + r*Math.sin(a*Math.PI/180), c - r*Math.cos(a*Math.PI/180)].map(n => n.toFixed(1));
  let s = `<circle class="ring" cx="${c}" cy="${c}" r="60"/>`;
  for(let a=0; a<360; a+=30){ const [x1,y1] = P(a, a%90 ? 56 : 52), [x2,y2] = P(a, 60); s += `<line class="tick" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }
  for(const [a,l] of [[0,"N"],[90,"E"],[180,"S"],[270,"W"]]){ const [x,y] = P(a, 44); s += `<text class="card" x="${x}" y="${(+y+3.5).toFixed(1)}" text-anchor="middle">${l}</text>`; }
  // wedge sits on the rim at the direction the wind blows FROM and points into the dial
  if(deg != null && !isNaN(deg)){ const [ax,ay] = P(deg, 34), [bx,by] = P(deg-12, 66), [cx,cy] = P(deg+12, 66); s += `<polygon class="wedge" points="${ax},${ay} ${bx},${by} ${cx},${cy}"/>`; }
  s += `<text class="spd" x="${c}" y="${c+8}" text-anchor="middle">${kt == null ? "—" : esc(kt)}</text><text class="u" x="${c}" y="${c+22}" text-anchor="middle">kt</text>`;
  return s;
}
function wxIcon(short, name){
  const t = (short||"").toLowerCase(), night = /night|tonight|overnight/i.test(name||"");
  const sun = night ? `<path d="M20 6a9 9 0 1 0 6 14 7 7 0 0 1-6-14z" fill="currentColor" opacity=".85"/>` : `<circle cx="16" cy="16" r="6" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 3v4M16 25v4M3 16h4M25 16h4M6.8 6.8l2.8 2.8M22.4 22.4l2.8 2.8M6.8 25.2l2.8-2.8M22.4 9.6l2.8-2.8"/></g>`;
  const cloud = (dy=0) => `<path d="M9 ${23+dy}h14a5 5 0 0 0 0-10 7 7 0 0 0-13.4 2A4 4 0 0 0 9 ${23+dy}z" fill="currentColor" opacity=".55"/>`;
  let body;
  if(/snow|flurr|sleet|blizzard/.test(t)) body = cloud(-5) + `<g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M11 24v6M8.4 25.5l5.2 3M8.4 28.5l5.2-3M21 24v6M18.4 25.5l5.2 3M18.4 28.5l5.2-3"/></g>`;
  else if(/thunder/.test(t)) body = cloud(-5) + `<path d="M16 21l-3 6h4l-2 5 6-8h-4l2-3z" fill="currentColor"/>`;
  else if(/rain|shower|drizzle/.test(t)) body = cloud(-5) + `<g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 24l-1.5 5M17 24l-1.5 5M23 24l-1.5 5"/></g>`;
  else if(/fog|haze|smoke/.test(t)) body = `<g stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity=".7"><path d="M5 12h22M7 17h18M5 22h22"/></g>`;
  else if(/partly|mostly sunny|mostly clear/.test(t)) body = `<g transform="translate(-4 -4) scale(.8)">${sun}</g>` + cloud(2);
  else if(/cloud|overcast/.test(t)) body = cloud(-2);
  else if(/sunny|clear|fair/.test(t)) body = sun;
  else body = cloud(-2);
  return `<svg class="wxi" viewBox="0 0 32 32" aria-hidden="true">${body}</svg>`;
}


/* ---------- wall page builders: finished HTML + SVG for the old iPad ---------- */
const box = (svg, w, h) => svg ? `<div class="ch" style="padding-bottom:${(h / w * 100).toFixed(2)}%">${svg}</div>` : "";
const last = (a) => a[a.length - 1];

function buildSail(s, now) {
  const nowWall = laParts(new Date(now)).wall;
  let html = "";
  const alerts = alertChips(s.alerts);
  if (alerts) html += `<div class="chips">${alerts}</div>`;
  // dial + wind chart
  const dial = `<svg class="dial" width="120" height="120" viewBox="0 0 140 140">${dialSvg(s.obs ? +s.obs.deg : null, s.obs ? s.obs.kt : null)}</svg>`;
  const obsTxt = s.obs ? `<b>${esc(s.obs.dir)}</b> · gusts ${esc(s.obs.gustKt)} kt<br>observed ${esc(wallLabel(s.obs.t))}` : "Observed wind unavailable";
  const hrs = (s.hourly || []).filter((h) => Date.parse(h.t) > now - 3600e3).slice(0, 13)
    .map((h) => ({ t: Date.parse(h.t), r: ktRange(h.wind), deg: DIRS[h.dir] ?? null })).filter((h) => h.r);
  let wind = "";
  if (hrs.length > 1) {
    const hi = Math.max(...hrs.map((h) => h.r[1]), s.obs ? +s.obs.gustKt || 0 : 0), step = niceStep(hi, 4), yMax = Math.max(step * 2, Math.ceil(hi / step) * step);
    const nowObs = s.obs && Math.abs(wallMs(s.obs.t) - now) < 2 * 3600e3 ? +s.obs.kt : null;
    wind = box(lineChart({ pts: hrs.map((h) => ({ t: h.t, y: h.r[1] })), band: hrs.some((h) => h.r[0] !== h.r[1]) ? hrs.map((h) => ({ t: h.t, lo: h.r[0], hi: h.r[1] })) : null,
      w: 560, h: 118, yMax, step, cls: "sea", arrows: hrs.map((h) => ({ t: h.t, deg: h.deg })), nowY: nowObs, label: "Forecast wind" }), 560, 118);
  }
  html += `<div class="row"><div class="dialbox">${dial}<div class="sub">${obsTxt}</div></div><div class="grow"><div class="cap">Forecast wind, knots · next 12 h · arrows point downwind</div>${wind || '<p class="empty">No hourly forecast.</p>'}</div></div>`;
  // tide + current
  const tideH = (s.tideHourly || []).map((p) => ({ t: wallMs(p.t), y: p.ft })).filter((p) => p.t >= now - 3600e3 && p.t <= now + 24 * 3600e3);
  const tidesNext = (s.tides || []).filter((t) => t.t >= nowWall);
  let tide = "";
  if (tideH.length > 1) {
    const hi = Math.max(...tideH.map((p) => p.y)), lo = Math.min(0, ...tideH.map((p) => p.y)), step = niceStep(hi - lo, 3);
    const i = tideH.findIndex((p) => p.t > now), nowY = i > 0 ? tideH[i - 1].y + (tideH[i].y - tideH[i - 1].y) * (now - tideH[i - 1].t) / (tideH[i].t - tideH[i - 1].t) : null;
    const marks = tidesNext.map((t) => ({ t: wallMs(t.t), y: t.ft, up: t.type === "High", label: `${t.type === "High" ? "H" : "L"} ${t.ft} · ${hmLbl(wallMs(t.t))}` })).filter((m) => m.t <= last(tideH).t);
    tide = box(lineChart({ pts: tideH, w: 300, h: 118, yMin: Math.floor(lo / step) * step, yMax: Math.ceil((hi + 1) / step) * step, step, cls: "sea", marks, nowY, label: "Tide" }), 300, 118);
  }
  const curH = (s.currentHourly || []).map((p) => ({ t: wallMs(p.t), y: p.kt })).filter((p) => p.t >= now - 3600e3 && p.t <= now + 24 * 3600e3);
  const curNext = (s.currents || []).filter((c) => c.t >= nowWall);
  let cur = "";
  if (curH.length > 1) {
    const m = Math.max(1, ...curH.map((p) => Math.abs(p.y))), step = niceStep(2 * m, 4), lim = Math.ceil((m + 0.4) / step) * step;
    const i = curH.findIndex((p) => p.t > now), nowY = i > 0 ? curH[i - 1].y + (curH[i].y - curH[i - 1].y) * (now - curH[i - 1].t) / (curH[i].t - curH[i - 1].t) : null;
    const marks = curNext.filter((c) => c.type !== "slack").map((c) => ({ t: wallMs(c.t), y: c.type === "ebb" ? -c.kt : c.kt, up: c.type !== "ebb", label: `${c.kt}` })).filter((mk) => mk.t <= last(curH).t);
    cur = box(lineChart({ pts: curH, w: 300, h: 118, yMin: -lim, yMax: lim, step, signed: true, marks, nowY, label: "Current" }), 300, 118);
  }
  const tideTxt = tidesNext.slice(0, 2).map((t) => `${t.type} ${esc(t.ft)} ft ${esc(wallLabel(t.t))}`).join(" · ");
  const slack = curNext.filter((c) => c.type === "slack").slice(0, 2).map((c) => esc(wallLabel(c.t)));
  html += `<div class="row"><div class="half"><div class="cap">Tide, ft · next 24 h</div>${tide}<div class="src">${tideTxt}</div></div>` +
    `<div class="half"><div class="cap">Current at the Gate, kt · <span class="flood">flood ▲</span> <span class="ebb">ebb ▼</span></div>${cur}<div class="src">${slack.length ? "Slack " + slack.join(" · ") : ""}</div></div></div>`;
  const m0 = (s.marine || [])[0];
  if (m0) html += `<p class="sub marine">Marine forecast, ${esc(m0.name)}: ${esc(m0.text)}</p>`;
  return html;
}

function buildSnow(n, now) {
  let html = "";
  const alerts = alertChips(n.alerts);
  if (alerts) html += `<div class="chips">${alerts}</div>`;
  const r = n.observed && n.observed.resort, sn = n.observed && n.observed.snotel;
  let since = "—", sinceSub = "Since snow";
  if (sn && sn.lastSnowAt) {
    const h = (now - Date.parse(sn.lastSnowAt)) / 3600e3;
    since = h < 1 ? "&lt;1 h" : h < 48 ? `${Math.round(h)} h` : `${Math.floor(h / 24)} d`;
    sinceSub = `Since snow · ${esc(new Date(sn.lastSnowAt).toLocaleString("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "2-digit" }))}`;
  } else if (sn) { since = `${sn.lookbackDays || 30}+ d`; sinceSub = `Since snow · none in ${sn.lookbackDays || 30} days`; }
  html += `<div class="row stats">` +
    `<div class="stat"><span class="mid">${r && r.in24 != null ? esc(r.in24) + "<small>in</small>" : "—"}</span><span class="cap">Last 24 h · resort report</span></div>` +
    `<div class="stat"><span class="mid">${since}</span><span class="cap">${sinceSub}</span></div>` +
    `<div class="stat fc"><span class="mid">${n.snow24hIn ?? "—"}<small>in</small></span><span class="cap">Next 24 h · forecast</span></div>` +
    `<div class="stat fc"><span class="mid">${n.snow72hIn ?? "—"}<small>in</small></span><span class="cap">Next 72 h · forecast</span></div></div>`;
  const ds = ((sn && sn.depthSeries) || []).map(([t, v]) => ({ t: Date.parse(t), y: v }));
  let depth = "";
  if (ds.length > 1) {
    const hi = Math.max(...ds.map((p) => p.y), 1), step = niceStep(hi, 3), lp = last(ds);
    depth = box(lineChart({ pts: ds, w: 340, h: 118, yMax: Math.ceil((hi * 1.2) / step) * step, step, cls: "snow", xDays: true, marks: [{ t: lp.t, y: lp.y, up: true, label: `${lp.y} in` }], label: "Snow depth" }), 340, 118);
  }
  const bars = barChart({ bars: (n.blocks || []).filter((b) => Date.parse(b.end) > now), w: 300, h: 118, label: "Forecast new snow" });
  html += `<div class="row"><div class="half"><div class="cap">Snow depth, in · last 7 days (SNOTEL, 8,540 ft)</div>${depth || '<p class="empty">No depth data.</p>'}</div>` +
    `<div class="half"><div class="cap">Forecast new snow, in · per 6 h</div>${box(bars, 300, 118) || '<p class="empty">No forecast data.</p>'}</div></div>`;
  html += `<div class="row periods">` + (n.periods || []).slice(0, 4).map((p) =>
    `<div class="per">${wxIcon(p.short, p.name)}<div><b>${esc(p.name)}</b><br><span class="tp">${esc(p.temp)}°F</span> ${esc(p.short)}</div></div>`).join("") + `</div>`;
  const bits = [];
  if (r) bits.push(`Resort report ${String(r.updatedText || "").replace(/^Updated\s*/i, "").replace(/, \d{4} at/, " ")}`);
  if (sn) bits.push(`SNOTEL depth ${sn.depthIn} in, +${sn.depthGain24In} in in 24 h (${fmtTime(sn.lastObs)})`);
  bits.push("Last snow = latest hour with new gauge precipitation at 34 °F or colder");
  html += `<p class="src">${esc(bits.join(" · "))}</p>`;
  return html;
}

function buildEvents(e) {
  if (!e || !e.events || !e.events.length) return `<p class="empty">No events listed.</p>`;
  const list = e.events.filter((x) => x && x.title).slice().sort((a, b) => (a.start || "") < (b.start || "") ? -1 : 1);
  return `<div class="cap">${esc(e.weekend || "This weekend")} · Top 5 most popular on FunCheap SF</div><div class="evs">` + list.map((x) => {
    const d = x.start ? new Date(x.start) : null;
    const day = d ? d.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" }) : "";
    const tm = d ? d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).replace(":00", "") : "";
    return `<div class="ev"><div class="when"><b>${esc(day)}</b><br>${esc(tm)}</div><div class="what"><b>${esc(x.title)}</b><br><span class="sub">${esc([x.venue, x.city, x.price].filter(Boolean).join(" · "))}</span></div></div>`;
  }).join("") + `</div>`;
}

/* ---------- write data/wall.json ---------- */
const now = Date.now();
const w = JSON.parse(await readFile("data/weather.json", "utf8"));
let ev = null; try { ev = JSON.parse(await readFile("data/events.json", "utf8")); } catch {}
const asOf = new Date(now).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const wall = {
  generatedAt: now,
  dataUpdatedAt: w.updatedAt ? Date.parse(w.updatedAt) : null,
  asOf,
  sail: buildSail(w.sail || {}, now),
  snow: buildSnow(w.snow || {}, now),
  events: buildEvents(ev),
};
await writeFile("data/wall.json", JSON.stringify(wall) + "\n");
console.log(`Wall page data written (${JSON.stringify(wall).length} bytes, as of ${asOf}).`);
