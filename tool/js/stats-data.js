// Statistics data: preferences, sorting, weeks, invoice and PO rows, duplicate work days, aggregation.
"use strict";
// ------------------------------------------------------------ statistics
const eur0 = (n) => "€ " + Math.round(n).toLocaleString("nl-NL");
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const monthName = (m, style = "long") => cap(new Date(2000, m, 1).toLocaleDateString(state.lang, { month: style }).replace(/\.$/, ""));
const STAT_KEY = "valkyrys-stats";
function applyStatPrefs(sv) {
  if (!sv) return;
  if (desk && (sv.src === "pos" || sv.src === "invoices")) state.statSource = sv.src;
  if (["week", "month", "quarter", "year"].includes(sv.mode)) state.statMode = sv.mode;
  if (sv.basis === "order" || sv.basis === "work") state.poBasis = sv.basis;
  if (Array.isArray(sv.tiles)) state.kpiTiles = sv.tiles.filter((k) => KPI_ALL.includes(k));
  if (sv.sort && typeof sv.sort === "object") for (const t of ["st", "cl"]) { const s = sv.sort[t]; if (s && STAT_SORT_KEYS[t].includes(s.k) && (s.d === "asc" || s.d === "desc")) state.statSort[t] = { k: s.k, d: s.d }; }
}
// sorting of the period table (st) and the per-client table (cl); the total row always stays at the bottom
const STAT_SORT_KEYS = { st: ["per", "n", "days", "sub", "vat", "total"], cl: ["name", "n", "sub", "share"] };
const STAT_SORT_DEFAULT = { st: { k: "per", d: "asc" }, cl: { k: "sub", d: "desc" } };
state.statSort = { st: { ...STAT_SORT_DEFAULT.st }, cl: { ...STAT_SORT_DEFAULT.cl } };
const SORT_SVG = { hint: '<svg viewBox="0 0 8 10" aria-hidden="true"><path d="M4 0 8 4H0zM4 10 0 6h8z" fill="currentColor"/></svg>', asc: '<svg viewBox="0 0 8 10" aria-hidden="true"><path d="M4 1.5 8 7H0z" fill="currentColor"/></svg>', desc: '<svg viewBox="0 0 8 10" aria-hidden="true"><path d="M4 8.5 0 3h8z" fill="currentColor"/></svg>' };
// header cells as sort buttons; cols = [[key, label]], the arrow sits on the inner side so the text keeps its alignment
const sortHead = (t, cols) => { const s = cols.some((c) => c[0] === state.statSort[t].k) ? state.statSort[t] : STAT_SORT_DEFAULT[t]; return `<thead><tr>${cols.map(([k, h]) => { const on = s.k === k, next = on ? (s.d === "asc" ? "desc" : "asc") : (k === "per" || k === "name" ? "asc" : "desc");
    return `<th${on ? ` aria-sort="${s.d === "asc" ? "ascending" : "descending"}"` : ""}><button type="button" class="thb" data-sort="${k}" aria-label="${esc(tr(next === "asc" ? "thSortAsc" : "thSortDesc", h))}"><span class="sa">${SORT_SVG[on ? s.d : "hint"]}</span><span>${esc(h)}</span></button></th>`; }).join("")}</tr></thead>`; };
const sortRows = (t, rows, val, keys) => { // stable: equal values keep their natural order
  let { k, d } = state.statSort[t]; if (!keys.includes(k)) ({ k, d } = STAT_SORT_DEFAULT[t]);
  const m = d === "asc" ? 1 : -1, r = rows.map((x, i) => [x, i]);
  r.sort((a, b) => { const va = val(a[0], k), vb = val(b[0], k); const c = typeof va === "string" ? va.localeCompare(vb, state.lang, { sensitivity: "base" }) : va - vb; return c * m || a[1] - b[1]; });
  return r.map((x) => x[0]);
};
const clickSort = (t, tbl, e) => {
  const b = e.target.closest("button[data-sort]"); if (!b) return false;
  const k = b.dataset.sort, s = $(`${tbl} button[data-sort="${state.statSort[t].k}"]`) ? state.statSort[t] : STAT_SORT_DEFAULT[t]; // a saved column that is not shown (VAT with orders) counts as the default
  if (s.k === k) state.statSort[t] = { k, d: s.d === "asc" ? "desc" : "asc" }; else state.statSort[t] = { k, d: k === "per" || k === "name" ? "asc" : "desc" };
  saveStatPrefs(); renderStats(); const n = $(`${tbl} button[data-sort="${k}"]`); if (n) n.focus(); return true;
};
// the statistic tiles: which ones show is the person's choice (filter button above the tiles); shown in the order of KPI_ALL
const KPI_DEFAULT = ["rev", "count", "days", "avg"];
const KPI_ALL = ["rev", "count", "days", "avg", "inc", "best", "perInv", "rate", "hours", "weeks", "weekday", "month", "clients", "open"];
state.kpiTiles = KPI_DEFAULT.slice();
try { applyStatPrefs(JSON.parse(localStorage.getItem(STAT_KEY) || "{}")); } catch (e) {}
const saveStatPrefs = () => { // remembered in the browser storage and in the saved data (survives a restart for sure)
  const v = { src: state.statSource, mode: state.statMode, basis: state.poBasis, tiles: state.kpiTiles.slice(), sort: { st: { ...state.statSort.st }, cl: { ...state.statSort.cl } } };
  try { localStorage.setItem(STAT_KEY, JSON.stringify(v)); } catch (e) {}
  if (state.db) { try { state.db.doc("settings/statprefs").set(v); } catch (e) {} }
};

// ---- weeks (ISO 8601: a week runs Monday to Sunday, week 1 holds the first Thursday)
const DAY = 864e5;
const mondayOf = (y, mo, d) => { const t = new Date(Date.UTC(y, mo, d)); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t; };
const isoWeekOf = (thursday) => Math.ceil(((thursday - Date.UTC(thursday.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
const weekRange = (mon) => { const sun = new Date(mon.getTime() + 6 * DAY); const mn = (t) => monthName(t.getUTCMonth(), "short");
  return mon.getUTCMonth() === sun.getUTCMonth() ? `${mon.getUTCDate()}–${sun.getUTCDate()} ${mn(sun)}` : `${mon.getUTCDate()} ${mn(mon)} – ${sun.getUTCDate()} ${mn(sun)}`; };

/** invoices: every invoice in the list or in the folder, with its date and amounts (excl. VAT = "sub"); the invoice date decides the period */
function invStatData() {
  const list = []; let undated = 0;
  for (const i of state.invoices.values()) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(i.datum || ""));
    let y, mo, d;
    if (m) { d = +m[1]; mo = +m[2] - 1; y = +m[3]; }
    else if (i.createdAt && !isNaN(Date.parse(i.createdAt))) { const t = new Date(i.createdAt); y = t.getFullYear(); mo = t.getMonth(); d = t.getDate(); }
    else { undated++; continue; }
    let sub, vat, total;
    if (i.lines && i.lines.length) ({ sub, vat, total } = core.totals(i.lines, i.btw || "verlegd"));
    else { total = +i.totaal || 0; const r = (core.BTW[i.btw] || core.BTW.verlegd).rate; sub = core.round2(total / (1 + r)); vat = core.round2(total - sub); }
    let days = 0, hrs = 0; // a day rate counts its quantity; an hour rate (under 100) counts 8 hours as 1 day
    for (const l of i.lines || []) { days += core.lineDays(+l.tarief, +l.aantal, l.desc); if (core.isHourLine(+l.tarief || 0, l.desc)) hrs++; }
    list.push({ i, key: i.factuurnr, y, mo, d, sub, vat, total, days, client: ((i.client && i.client.name) || "").trim(), flags: hrs ? ["hours"] : [] });
  }
  const have = new Set(state.invoices.keys());
  for (const i of state.folderInvoices) { // invoices that are only in the folder
    if (have.has(i.factuurnr)) continue;
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(i.datum); if (!m) { undated++; continue; }
    const a = i.amounts;
    list.push({ i, key: i.factuurnr, y: +m[3], mo: +m[2] - 1, d: +m[1], sub: a.sub, vat: a.vat, total: a.total, days: a.days || 0, client: ((i.client && i.client.name) || "").trim(), src: "folder", flags: a.hours ? ["hours"] : [] });
  }
  return { list, undated };
}
/** purchase orders. Every PO line is one work day: the date at the start of its Omschrijving (a range counts each work day in it); the amount is the line's own total.
    By default each work day counts on its own date; or the whole PO on its order date. Days: a day price counts as written, hours are 8 to a day, and one date is never
    more than one day, however many lines or POs mention it (those cases are flagged, so they can be checked in the breakdown of the period). */
const dashDate = (t) => { const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(String(t || "")); return m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31 ? { y: +m[3], mo: +m[2] - 1, d: +m[1] } : null; };
/** every work day of every purchase order as its own entry (a range of dates is split into its days) */
function poLines() {
  const dash = dashDate, kv = state.settings.client;
  let undated = 0; const lines = [];
  for (const { f, r } of state.poRecs) {
    const client = r.kvk && kv.kvk && r.kvk === kv.kvk ? kv.name : r.kvk ? "KVK " + r.kvk : "";
    for (const it of r.items) {
      if (!isFinite(it.total)) continue;
      const work = (it.work && it.work.length ? it.work : (it.dates || []).slice(0, 1)).map(dash).filter(Boolean), dated = work.length > 0;
      const dts = dated ? work : [dash(r.orderDate)].filter(Boolean);   // a line without a date falls back on the order date
      if (!dts.length) { undated++; continue; }
      const eq = core.dayEquivalent(it, dated); let rest = core.round2(it.total);
      dts.forEach((dt, n) => { const part = n === dts.length - 1 ? rest : core.round2(it.total / dts.length); rest = core.round2(rest - part); lines.push({ f, r, it, client, dt, dated, sub: part, days: eq / dts.length, desc: it.desc || "" }); });
    }
  }
  return { lines, undated };
}
function poStatData() {
  const dash = dashDate, pad2 = (n) => String(n).padStart(2, "0");
  const { lines, undated } = poLines();
  const perDate = new Map(); // one work day is one day: several lines or POs on the same date share it
  for (const l of lines) if (l.dated) { l.k = l.dt.y * 10000 + l.dt.mo * 100 + l.dt.d; let o = perDate.get(l.k); if (!o) perDate.set(l.k, (o = { days: 0, pos: new Set() })); o.days += l.days; o.pos.add(l.r.po); }
  for (const l of lines) {
    const o = l.dated && perDate.get(l.k), over = o && o.days > 1 + 1e-9;
    if (over) l.days /= o.days;
    l.flags = [over && o.pos.size > 1 && "dup", l.it.kind === "other" && "unit", l.it.kind === "hour" && "hours", !l.dated && "nodate"].filter(Boolean);
  }
  const mk = (l, dt, sub, days, flags, extra) => ({ i: { factuurnr: l.r.po, po: l.r.po, datum: `${pad2(dt.d)}/${pad2(dt.mo + 1)}/${dt.y}`, orderDate: l.r.orderDate, client: { name: l.client } },
    key: l.r.po, y: dt.y, mo: dt.mo, d: dt.d, sub: core.round2(sub), vat: 0, total: core.round2(sub), days, client: l.client, src: "po", file: l.f, flags, ...extra });
  const list = [];
  if (state.poBasis === "order") {
    const byPo = new Map();
    for (const l of lines) { let o = byPo.get(l.r.po); if (!o) byPo.set(l.r.po, (o = { first: l, sub: 0, days: 0, n: 0, flags: new Set() })); o.sub += l.sub; o.days += l.days; o.n++; l.flags.forEach((x) => o.flags.add(x)); }
    for (const o of byPo.values()) list.push(mk(o.first, dash(o.first.r.orderDate) || o.first.dt, o.sub, o.days, [...o.flags], { n: o.n }));
  } else for (const l of lines) list.push(mk(l, l.dt, l.sub, l.days, l.flags, { desc: l.desc, qty: l.it.qty, price: l.it.price, kind: l.it.kind }));
  return { list, undated };
}
const natPo = (a, b) => String(a).localeCompare(String(b), "nl", { numeric: true });
/** work days that are on more than one purchase order. A corrected order sent after a wrong one looks exactly like this (and so do two real jobs on one day),
    so this only informs: it changes no figure. Orders with the same work days are grouped, so a corrected order shows up as one pair, not as a row per day. */
function poDupes() {
  const { lines } = poLines(), byDate = new Map();
  for (const l of lines) {
    if (!l.dated) continue;
    const k = l.dt.y * 10000 + l.dt.mo * 100 + l.dt.d; let o = byDate.get(k); if (!o) byDate.set(k, (o = { dt: l.dt, by: new Map() }));
    let e = o.by.get(l.r.po); if (!e) o.by.set(l.r.po, (e = [])); e.push(l);
  }
  const groups = new Map(); let days = 0;
  for (const [, o] of [...byDate].sort((a, b) => a[0] - b[0])) {
    if (o.by.size < 2) continue;
    days++;
    const pos = [...o.by.keys()].sort(natPo), gk = pos.join("\u0000");
    let g = groups.get(gk); if (!g) groups.set(gk, (g = { pos, dates: [], per: new Map(pos.map((po) => [po, { f: null, r: null, prices: new Set(), sub: 0, desc: "" }])) }));
    g.dates.push(o.dt);
    for (const [po, ls] of o.by) { const p = g.per.get(po); for (const l of ls) { p.f = l.f; p.r = l.r; p.prices.add(l.it.price); p.sub += l.sub; if (!p.desc) p.desc = l.desc; } }
  }
  const out = [...groups.values()].map((g) => {
    const rows = g.pos.map((po) => { const p = g.per.get(po); return { po, f: p.f, orderDate: p.r.orderDate || "", prices: [...p.prices].filter((x) => isFinite(x)).sort((x, y) => x - y), sub: core.round2(p.sub), desc: p.desc }; });
    return { pos: g.pos, dates: g.dates, rows, rateDiffers: new Set(rows.map((r) => r.prices.join(","))).size > 1 };
  }).sort((a, b) => a.dates[0].y * 10000 + a.dates[0].mo * 100 + a.dates[0].d - (b.dates[0].y * 10000 + b.dates[0].mo * 100 + b.dates[0].d));
  return { days, groups: out };
}
const statData = () => {
  const { list, undated } = state.statSource === "pos" ? poStatData() : invStatData();
  list.sort((a, b) => a.y - b.y || a.mo - b.mo || a.d - b.d || String(a.key).localeCompare(String(b.key), "nl", { numeric: true }));
  return { list, undated };
};
const aggr = (rows) => { const keys = new Set(); const a = rows.reduce((t, r) => { keys.add(r.key); t.sub += r.sub; t.vat += r.vat; t.total += r.total; t.days += r.days; return t; }, { sub: 0, vat: 0, total: 0, days: 0 }); a.n = keys.size; return a; };
const statScope = () => { const { list } = statData(); const now = new Date(), cy = now.getFullYear(); const dataYears = [...new Set(list.map((x) => x.y))];
  const years = [...new Set([...dataYears, cy])].sort((a, b) => b - a);
  const sel = years.includes(state.statYear) ? state.statYear : dataYears.includes(cy) ? cy : (dataYears.sort((a, b) => b - a)[0] || cy);
  return { list, years, sel, cy, now }; };

