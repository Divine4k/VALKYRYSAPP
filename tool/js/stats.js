// Statistics view: period dialog, tiles (KPIs), bar chart, renderStats, CSV export.
"use strict";
const FLAG_TEXT = { dup: "fDup", unit: "fUnit", hours: "fHours", nodate: "fNoDate" };
/** the documents behind one row of the statistics table (a period, or all of it): one line per purchase order or invoice with what it adds to the period, and under it the work days it was counted for */
function openPeriod(i) {
  const b = i === "all" ? state.statAll : (state.statBuckets || [])[+i]; if (!b || !b.rows.length) return;
  const po = state.statSource === "pos", A = b.a, p2 = (n) => String(n).padStart(2, "0"), ymd = (x) => `${p2(x.d)}-${p2(x.mo + 1)}-${x.y}`, key = (x) => x.y * 10000 + x.mo * 100 + x.d;
  state.perRows = b.rows; $("#perDlgTitle").textContent = b.long;
  $("#perSum").textContent = [`${A.n} ${tr(po ? "tOrders" : "tInvoices").toLowerCase()}`, `${core.qty(A.days)} ${tr("tDays").toLowerCase()}`, core.eur(A.sub)].join(" · ");
  const docs = new Map(); // one entry per document, in date order
  for (const x of b.rows) { let g = docs.get(x.key); if (!g) docs.set(x.key, (g = { rows: [], days: 0, sub: 0, flags: new Set() })); g.rows.push(x); g.days += x.days; g.sub += x.sub; (x.flags || []).forEach((f) => g.flags.add(f)); }
  const order = po && state.poBasis === "order", lineRows = po && !order;
  const head = ["", tr(po ? "dPo" : "dInv"), tr(po ? (order ? "csvOrderDate" : "dWorkDays") : "dDate"), tr("tDays"), tr(po ? "tValue" : "tEx"), ""];
  const warnOf = (flags) => [...flags].some((f) => f !== "hours");
  const flagsHtml = (flags) => [...flags].map((f) => `<span class="fl">${esc(tr(FLAG_TEXT[f]))}</span>`).join("");
  let html = `<thead><tr>${head.map((h, k) => `<th${k === 3 || k === 4 ? ' class="r"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>`;
  [...docs.entries()].forEach(([k, g], n) => {
    const first = g.rows[0], last = g.rows[g.rows.length - 1], open = lineRows && warnOf(g.flags);
    const when = lineRows && g.rows.length > 1 && key(first) !== key(last) ? `${ymd(first)} – ${ymd(last)}` : ymd(first);
    const sub = po ? (first.i.orderDate ? `<span class="dsub">${esc(tr("npOrdered", first.i.orderDate))}</span>` : "") : (first.client ? `<span class="dsub">${esc(first.client)}</span>` : "");
    const tog = lineRows ? `<button type="button" class="tog" data-tog="${n}" aria-expanded="${open}" aria-label="${esc(tr("perLinesOf", k))}"><span aria-hidden="true">${open ? "▾" : "▸"}</span></button>` : "";
    const btn = po ? (first.file ? `<button type="button" class="ghost" data-prev="po" data-rel="${esc(first.file.rel)}" data-key="${esc(k)}">${esc(tr("npPreview"))}</button>` : "") : `<button type="button" class="ghost" data-prev="inv" data-key="${esc(k)}">${esc(tr("npPreview"))}</button>`;
    html += `<tr class="doc${warnOf(g.flags) ? " flag" : ""}"><td class="tg">${tog}</td><td class="num">${esc(k)} ${sub} ${flagsHtml(g.flags)}</td><td class="nw">${esc(when)}</td><td class="r">${esc(core.qty(core.round2(g.days)))}</td><td class="r">${esc(core.eur(g.sub))}</td><td class="r">${btn}</td></tr>`;
    if (lineRows) for (const x of g.rows) html += `<tr class="ln${warnOf(x.flags || []) ? " flag" : ""}" data-of="${n}"${open ? "" : " hidden"}><td></td><td class="d">${esc(x.desc || "")}${flagsHtml(x.flags || [])}</td><td class="nw">${esc(ymd(x))}</td><td class="r">${esc(core.qty(core.round2(x.days)))}</td><td class="r">${esc(core.eur(x.sub))}</td><td></td></tr>`;
  });
  html += `</tbody><tfoot><tr><td></td><td colspan="2">${esc(tr("tTotal"))}</td><td class="r">${esc(core.qty(core.round2(A.days)))}</td><td class="r">${esc(core.eur(A.sub))}</td><td></td></tr></tfoot>`;
  $("#perTable").innerHTML = html;
  const all = $("#perAll"); all.hidden = !lineRows; all.dataset.on = "0"; all.textContent = tr("perShowLines");
  const dlg = $("#perDlg"); if (!dlg.open) dlg.showModal();
}

function renderSrc() {
  $("#statSource").hidden = !desk; if (!desk) return;
  $("#statSource").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.src === state.statSource)));
}
function renderScanInfo() {
  const po = state.statSource === "pos", sc = po ? state.poScan : state.scan, un = po ? state.poUnread : state.unread;
  const sn = $("#scanNote"); sn.hidden = !sc; if (sc) sn.textContent = tr("scanning", sc.done, sc.total);
  const d = $("#statsUnread"); d.hidden = !un.length;
  if (un.length) { $("#unreadSum").textContent = tr(po ? "unreadPo" : "unread", un.length); $("#unreadList").innerHTML = un.slice(0, 40).map((x) => `<li>${esc(x)}</li>`).join("") + (un.length > 40 ? `<li>…</li>` : ""); }
}

/** can this tile show with the current source? (some figures only exist for invoices, for POs by work date, or in the desktop app) */
function kpiAvail(k) {
  const po = state.statSource === "pos";
  if (k === "inc" && po) return { ok: false, why: "kpiOnlyInv" };
  if (k === "weekday" && !(po && state.poBasis === "work")) return { ok: false, why: "kpiOnlyPoWork" };
  if (k === "open" && !desk) return { ok: false, why: "kpiOnlyDesk" };
  return { ok: true };
}
/** the extra tiles (beyond the four default ones), from the same rows as the rest of the statistics */
function kpiExtras({ list, scope, A, po, mode, sel, cy, now, best }) {
  const tile = (label, value, sub) => `<div class="kpi"><p class="eyebrow">${esc(label)}</p><div class="v num">${esc(value)}</div><div class="s">${sub}</div></div>`;
  const pct = (a, b) => { const p = Math.round((a - b) / b * 100); return { cls: p >= 0 ? "up" : "down", txt: (p >= 0 ? "+" : "−") + Math.abs(p) + "%" }; };
  return {
    inc: () => tile(tr("kInc"), eur0(A.total), esc(tr("kIncSub", eur0(A.vat)))),
    best: () => {
      if (!best) return tile(tr(mode === "week" ? "kBestWeekT" : "kBestMonthT"), "–", "");
      if (mode === "week") return tile(tr("kBestWeekT"), eur0(best.a.sub), esc(`${tr("week")} ${best.wn} · ${weekRange(new Date(best.t))}`));
      return tile(tr("kBestMonthT"), eur0(best.v), esc(`${monthName(best.k % 12)} ${Math.floor(best.k / 12)}`));
    },
    perInv: () => {
      const per = new Map(); scope.forEach((x) => per.set(x.key, (per.get(x.key) || 0) + x.sub));
      const max = Math.max(0, ...per.values());
      return tile(tr(po ? "kPerOrder" : "kPerInv"), A.n ? eur0(A.sub / A.n) : "–", esc(max ? tr("kMaxOne", eur0(max)) : ""));
    },
    rate: () => tile(tr("kRate"), A.days ? eur0(A.sub / A.days) : "–", esc(A.days ? tr("kRateHour", eur0(A.sub / A.days / 8)) : "")),
    hours: () => tile(tr("kHours"), core.qty(core.round2(A.days * 8)), esc(tr("kHoursSub"))),
    weeks: () => {
      const wk = new Set(scope.filter((x) => x.days > 0).map((x) => mondayOf(x.y, x.mo, x.d).getTime()));
      return tile(tr("kWeeks"), String(wk.size), esc(wk.size ? tr("kWeeksSub", core.qty(core.round2(A.days / wk.size))) : ""));
    },
    weekday: () => { // POs by work date: each row is a real work day
      const per = Array(7).fill(0); scope.forEach((x) => { per[(new Date(Date.UTC(x.y, x.mo, x.d)).getUTCDay() + 6) % 7] += x.days; });
      const i = per.reduce((m, v, j) => (v > per[m] ? j : m), 0);
      if (!per[i]) return tile(tr("kWeekday"), "–", "");
      return tile(tr("kWeekday"), cap(new Date(2024, 0, 1 + i).toLocaleDateString(state.lang, { weekday: "long" })), esc(tr("kWeekdaySub", core.qty(core.round2(per[i])))));
    },
    month: () => { // the current month (or the last month of a past year) against the month before it, over all rows so January compares with December
      const ref = mode === "year" || sel === cy ? cy * 12 + now.getMonth() : sel < cy ? sel * 12 + 11 : sel * 12;
      const sum = (k) => list.reduce((t, x) => t + (x.y * 12 + x.mo === k ? x.sub : 0), 0);
      const cur = sum(ref), prev = sum(ref - 1), pm = monthName((ref - 1) % 12);
      const label = ref === cy * 12 + now.getMonth() ? tr("kMonthNow") : `${monthName(ref % 12)} ${Math.floor(ref / 12)}`;
      if (!prev) return tile(label, eur0(cur), esc(tr("kPrevMonth", pm, eur0(0))));
      const p = pct(cur, prev);
      return tile(label, eur0(cur), `<span class="${p.cls}">${esc(tr("kVsMonth", p.txt, `${pm} (${eur0(prev)})`))}</span>`);
    },
    clients: () => {
      const c = new Map(); scope.forEach((x) => { const k = x.client || tr("noClient"); c.set(k, (c.get(k) || 0) + x.sub); });
      const top = [...c.entries()].sort((a, b) => b[1] - a[1])[0];
      return tile(tr("kClients"), String(c.size), esc(top ? tr("kClientsTop", top[0], (A.sub ? Math.round(top[1] / A.sub * 100) : 0) + "%") : ""));
    },
    open: () => { // POs in the folder that have no invoice yet (same list as "New purchase orders" on the Invoices tab); not tied to the chosen year
      const f = state.poFolder;
      if (!f || !f.exists) return tile(tr("kOpen"), "–", esc(tr("kOpenNoFolder")));
      if (state.poScanSig === "" || !state.invoicesLoaded || !state.folderScanned) return tile(tr("kOpen"), "…", esc(tr("kOpenWait")));
      const { show } = newPoItems(), val = show.reduce((t, { r }) => t + r.items.reduce((a, i) => a + (isFinite(i.total) ? i.total : 0), 0), 0);
      return tile(tr("kOpen"), eur0(val), esc(show.length ? tr("kOpenSub", show.length) : tr("kOpenNone")));
    },
  };
}
function renderKpiMenu() {
  const a = document.activeElement, fk = a && a.dataset && a.dataset.kpi, fr = a && a.id === "kpiReset"; // keep the focus where it was
  $("#kpiMenu").innerHTML =`<p class="kmt">${esc(tr("kpiMenuTitle"))}</p>` + KPI_ALL.map((k) => {
    const av = kpiAvail(k), on = state.kpiTiles.includes(k);
    return `<label class="${av.ok ? "" : "na"}"><input type="checkbox" data-kpi="${k}"${on ? " checked" : ""}><span>${esc(tr("kpiN_" + k))}${av.ok ? "" : `<small>${esc(tr(av.why))}</small>`}</span></label>`;
  }).join("") + `<div class="kfoot"><button type="button" class="ghost" id="kpiReset">${esc(tr("kpiReset"))}</button></div>`;
  const back = fk ? $("#kpiMenu").querySelector(`input[data-kpi="${fk}"]`) : fr ? $("#kpiReset") : null; if (back) back.focus();
}
const kpiMenuOpen = (on) => {
  $("#kpiMenu").hidden = !on; $("#kpiFilter").setAttribute("aria-expanded", String(on));
  if (on) { renderKpiMenu(); const c = $("#kpiMenu").querySelector("input"); if (c) c.focus(); }
};
$("#kpiFilter").addEventListener("click", () => kpiMenuOpen($("#kpiMenu").hidden));
$("#kpiMenu").addEventListener("change", (e) => {
  const c = e.target.closest("input[data-kpi]"); if (!c) return;
  const set = new Set(state.kpiTiles); if (c.checked) set.add(c.dataset.kpi); else set.delete(c.dataset.kpi);
  state.kpiTiles = KPI_ALL.filter((k) => set.has(k)); saveStatPrefs(); renderStats();
});
$("#kpiMenu").addEventListener("click", (e) => {
  if (!e.target.closest("#kpiReset")) return;
  state.kpiTiles = KPI_DEFAULT.slice(); saveStatPrefs(); renderStats(); renderKpiMenu();
});
document.addEventListener("click", (e) => { if (!$("#kpiMenu").hidden && !e.target.closest(".kpihead")) kpiMenuOpen(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#kpiMenu").hidden) { kpiMenuOpen(false); $("#kpiFilter").focus(); e.preventDefault(); } });

// ---- the bar chart of the statistics (same periods as the table under it)
/** gridline steps: 3-4 round values (1, 2, 2.5, 5 x 10^n), the top one at or above the highest bar */
function chartTicks(max) {
  let st = 1;
  out: for (let e = 0; e <= 9; e++) for (const m of [1, 2, 2.5, 5]) { st = m * 10 ** e; if (Math.ceil(max / st - 1e-9) <= 4) break out; }
  const n = Math.max(1, Math.ceil(max / st - 1e-9));
  return Array.from({ length: n }, (_, i) => (i + 1) * st);
}
/** axis label: in full under 10.000 (€ 2.500), compact from there (€ 10k / € 12,5k); one style per axis */
const tickFmt = (v, compact) => (compact ? "€ " + (v / 1000).toLocaleString("nl-NL", { maximumFractionDigits: 1 }) + tr("chK") : eur0(v));
const countWord = (n, po) => `${n} ${tr((po ? "chPo" : "chInv") + { daysOne: "1", daysFew: "F", daysMany: "M" }[plural(n)])}`;
function renderChart({ buckets, mode, sel, cy, po, unitKey }) {
  const box = $("#chartBox"), chart = $("#chart"), n = buckets.length, dense = n > 14;
  const keep = document.activeElement && document.activeElement.closest && document.activeElement.closest("#chart .bc"); // a re-render keeps the keyboard focus on the same period
  const keepIdx = keep ? +keep.dataset.i : -1;
  hideChartTip();
  box.classList.toggle("dense", dense); chart.classList.toggle("dense", dense);
  chart.style.setProperty("grid-template-columns", `repeat(${n}, minmax(0, 1fr))`);
  const max = Math.max(0, ...buckets.map((b) => b.a.sub)), ticks = chartTicks(Math.max(max, 1)), top = Math.max(max * 1.15, ticks[ticks.length - 1], 1), compact = ticks[ticks.length - 1] >= 10000;
  const labels = ticks.map((v) => tickFmt(v, compact));
  box.style.setProperty("--yw", Math.ceil(Math.max(...labels.map((l) => l.length), 3) * 6.4 + 10) + "px");
  $("#chartGrid").innerHTML = ticks.map((v, i) => `<div class="yl" style="--f:${(v / top).toFixed(4)}" data-v="${v}"><span>${esc(labels[i])}</span></div>`).join("");
  // the average: over the periods that have passed (empty ones count too), the same figure as the "average per week/month" tile
  const nowIdx = buckets.findIndex((b) => b.now), lastData = buckets.reduce((m, b, i) => (b.a.sub ? i : m), -1);
  const elapsed = Math.max(nowIdx >= 0 ? nowIdx + 1 : mode === "year" || sel < cy ? n : 0, lastData + 1);
  const sum = buckets.reduce((t, b) => t + b.a.sub, 0), avg = elapsed ? sum / elapsed : 0, showAvg = elapsed >= 2 && avg > 0;
  const av = $("#chartAvg"); av.hidden = !showAvg; av.classList.remove("below");
  const avgText = tr("chAvg", eur0(avg), tr(unitKey));
  if (showAvg) { av.style.setProperty("--f", (avg / top).toFixed(4)); av.dataset.v = String(Math.round(avg * 100) / 100); const u = document.createElement("span"); u.className = "u"; u.textContent = " " + tr(unitKey); av.firstElementChild.replaceChildren(tr("chAvg", eur0(avg), "").trim(), u); av.title = tr("chAvgHint"); }
  const hi = max > 0 ? buckets.findIndex((b) => b.a.sub === max) : -1;
  // week mode: the month name under the week that holds the 1st of that month
  const monthAt = mode === "week" ? (t) => { for (let m = 0; m < 12; m++) { const d = Date.UTC(sel, m, 1); if (d >= t && d < t + 7 * DAY) return m; } return -1; } : null;
  const focusAt = keepIdx >= 0 && keepIdx < n ? keepIdx : nowIdx >= 0 ? nowIdx : Math.max(0, lastData);
  chart.setAttribute("aria-label", [$("#chartTitle").textContent, showAvg ? avgText : ""].filter(Boolean).join(". "));
  chart.innerHTML = buckets.map((b, i) => {
    const lab = dense && i % 4 !== 0 ? " " : esc(b.label); // many weeks: a number on every fourth one
    const val = i === hi ? `<span class="bv num${i < 2 ? " l" : i > n - 3 && n > 4 ? " r" : ""}">${esc(eur0(b.a.sub))}</span>` : "";
    const bar = b.a.sub > 0 ? `<div class="bar" style="height:${(b.a.sub / top * 100).toFixed(2)}%"></div>` : `<div class="bar zero"></div>`;
    const m = monthAt ? monthAt(b.t) : -1;
    const mon = monthAt ? `<span class="bm${m % 2 ? " alt" : ""}">${m >= 0 ? `<span>${esc(monthName(m, "short"))}</span>` : " "}</span>` : "";
    return `<div class="bc${b.now ? " now" : ""}${b.rows.length ? " has" : ""}" data-i="${i}" role="button" tabindex="${i === focusAt ? 0 : -1}" aria-label="${esc(chartTipText(chartTip(b, mode, po)))}"${b.rows.length ? ' aria-haspopup="dialog"' : ' aria-disabled="true"'}>` +
      `<div class="bz">${b.now ? `<span class="bnow" aria-hidden="true">${esc(tr("chNow"))}</span>` : ""}${val}${bar}</div><span class="bx">${lab}</span>${mon}<span class="bn num">${b.a.n || " "}</span></div>`;
  }).join("");
  if (keepIdx >= 0 && keepIdx < n) chart.children[keepIdx].focus();
  const under = chart.querySelector(".bc:hover"); if (under) showChartTip(under); // the pointer is still on a bar: its tooltip stays
  // the average label moves under its line when it would sit on the value label of the highest bar
  if (showAvg && hi >= 0) {
    const r1 = av.firstElementChild.getBoundingClientRect(), v = chart.querySelector(".bv"), r2 = v && v.getBoundingClientRect();
    if (r2 && r1.left < r2.right && r2.left < r1.right && r1.top < r2.bottom && r2.top < r1.bottom) av.classList.add("below");
  }
}
/** what the tooltip and the accessible name of one bar say: period, value (excl. and, with VAT, incl.), count, days */
function chartTip(b, mode, po) {
  const t = { title: mode === "week" ? b.text : b.long };
  if (!b.rows.length) { t.none = tr("chNone"); return t; }
  t.ex = [core.eur(b.a.sub), tr("chEx")];
  if (!po && b.a.vat > 0) t.inc = [core.eur(b.a.total), tr("chInc")];
  t.cnt = `${countWord(b.a.n, po)} · ${core.qty(core.round2(b.a.days))} ${tr(plural(b.a.days))}`;
  return t;
}
const chartTipText = (t) => [t.title, t.none, t.ex && t.ex.join(" "), t.inc && t.inc.join(" "), t.cnt].filter(Boolean).join(", ");
function hideChartTip() { const t = $("#chartTip"); t.hidden = true; document.querySelectorAll("#chart .bc.on").forEach((c) => c.classList.remove("on")); }
function showChartTip(col) {
  const b = (state.statBuckets || [])[+col.dataset.i]; if (!b) return;
  const t = chartTip(b, state.statMode, state.statSource === "pos"), tip = $("#chartTip");
  document.querySelectorAll("#chart .bc.on").forEach((c) => c !== col && c.classList.remove("on")); col.classList.add("on");
  const line = (cls, txt, small) => { const d = document.createElement("div"); d.className = cls; d.textContent = txt; if (small) { const sm = document.createElement("small"); sm.textContent = " " + small; d.append(sm); } return d; };
  tip.replaceChildren(line("tt", t.title));
  if (t.none) tip.append(line("tn", t.none));
  else { tip.append(line("tv", ...t.ex)); if (t.inc) tip.append(line("ti", ...t.inc)); tip.append(line("tn", t.cnt), line("th", tr("chClick"))); }
  tip.hidden = false;
  // above the bar, centred; beside it when there is no room above; always inside the chart
  const box = $("#chartBox").getBoundingClientRect(), bz = col.querySelector(".bz").getBoundingClientRect(), bar = col.querySelector(".bar").getBoundingClientRect();
  const w = tip.offsetWidth, h = tip.offsetHeight, gap = 8, cx = bz.left + bz.width / 2 - box.left;
  let x = cx - w / 2, y = bar.top - box.top - h - gap;
  if (y < 0) { y = 0; x = bz.right - box.left + gap; if (x + w > box.width) x = bz.left - box.left - gap - w; }
  tip.style.transform = `translate(${Math.round(Math.max(0, Math.min(box.width - w, x)))}px, ${Math.round(Math.max(0, Math.min(box.height - h, y)))}px)`;
}
{
  const chart = $("#chart");
  chart.addEventListener("pointerover", (e) => { const c = e.target.closest(".bc"); if (c) showChartTip(c); });
  $("#chartBox").addEventListener("pointerleave", () => { const f = document.activeElement; if (chart.contains(f) && f.matches(":focus-visible")) showChartTip(f.closest(".bc")); else hideChartTip(); });
  chart.addEventListener("focusin", (e) => { const c = e.target.closest(".bc"); if (c && c.matches(":focus-visible")) showChartTip(c); });
  chart.addEventListener("focusout", (e) => { if (!chart.contains(e.relatedTarget)) hideChartTip(); });
  chart.addEventListener("click", (e) => { const c = e.target.closest(".bc"); if (c) openPeriod(c.dataset.i); });
  chart.addEventListener("keydown", (e) => {
    const c = e.target.closest(".bc"); if (!c) return;
    const cols = [...chart.children], i = cols.indexOf(c);
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPeriod(c.dataset.i); return; }
    if (e.key === "Escape") { if (!$("#chartTip").hidden) { hideChartTip(); e.preventDefault(); } return; }
    const j = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: cols.length - 1 }[e.key];
    if (j === undefined) return; e.preventDefault();
    const to = cols[Math.max(0, Math.min(cols.length - 1, j))]; c.tabIndex = -1; to.tabIndex = 0; to.focus();
  });
}
function renderStats() {
  const { list, undated } = statData();
  const { years, sel, cy, now } = statScope();
  const mode = state.statMode, po = state.statSource === "pos";
  $("#statMode").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  $("#poBasisLbl").hidden = !po || !desk; $("#poBasis").value = state.poBasis;
  const ys = $("#statYear"); ys.innerHTML = years.map((y) => `<option value="${y}"${y === sel ? " selected" : ""}>${y}</option>`).join(""); ys.disabled = mode === "year";
  renderSrc(); renderScanInfo(); renderDup();
  const scanning = po ? state.poScan : state.scan;
  // no permanent "read from" line: folders live in Settings. The empty state says what is missing and, when a folder is needed or not found, offers a button to Settings
  const f = po ? state.poFolder : state.folder, missing = !!(desk && f && !f.exists);
  const emptyKey = missing ? "folderMissing" : po ? (!f ? "statsEmptyPo" : "statsEmptyPo2") : "statsEmpty";
  const showEmpty = !scanning && (missing || !list.length), goKey = missing ? "openSettings" : desk && !f && !list.length ? "srcSet" : "";
  const em = $("#statsEmpty"); em.textContent = tr(emptyKey); em.hidden = !showEmpty; em.classList.toggle("bad", missing);
  const go = $("#statsGoSettings"); go.hidden = !showEmpty || !goKey; if (goKey) { go.dataset.i18n = goKey; go.textContent = tr(goKey); }
  $("#statsEmptyBox").hidden = !showEmpty; $("#statsBody").hidden = !list.length; $("#statCsv").hidden = !list.length;
  $("#statMode").hidden = $("#statYear").closest("label").hidden = !list.length;
  if (!list.length) return;

  const scope = mode === "year" ? list : list.filter((x) => x.y === sel);
  // ---- periods for chart and table
  let buckets;
  if (mode === "week") {
    buckets = []; const curMon = mondayOf(cy, now.getMonth(), now.getDate()).getTime();
    for (let t = mondayOf(sel, 0, 1).getTime(); t <= Date.UTC(sel, 11, 31); t += 7 * DAY) {
      const mon = new Date(t), wn = isoWeekOf(new Date(t + 3 * DAY));
      buckets.push({ t, wn, label: String(wn), long: `${tr("week")} ${wn} (${weekRange(mon)})`, text: `${tr("week")} ${wn} · ${weekRange(mon)}`, rows: [], now: sel === cy && t === curMon });
    }
    const byT = new Map(buckets.map((b) => [b.t, b]));
    scope.forEach((x) => { const b = byT.get(mondayOf(x.y, x.mo, x.d).getTime()); if (b) b.rows.push(x); });
  } else if (mode === "month") buckets = Array.from({ length: 12 }, (_, m) => ({ label: monthName(m, "short"), long: `${monthName(m)} ${sel}`, text: monthName(m), rows: scope.filter((x) => x.mo === m), now: sel === cy && m === now.getMonth() }));
  else if (mode === "quarter") buckets = Array.from({ length: 4 }, (_, q) => ({ label: "Q" + (q + 1), long: `Q${q + 1} ${sel}`, text: "Q" + (q + 1), rows: scope.filter((x) => Math.floor(x.mo / 3) === q), now: sel === cy && q === Math.floor(now.getMonth() / 3) }));
  else { const y0 = Math.min(...list.map((x) => x.y)), y1 = Math.max(cy, ...list.map((x) => x.y)); buckets = []; for (let y = y0; y <= y1; y++) buckets.push({ label: String(y), long: String(y), text: String(y), rows: list.filter((x) => x.y === y), now: y === cy }); }
  buckets.forEach((b) => { b.a = aggr(b.rows); });
  state.statBuckets = buckets; // the lists behind a period read from these
  state.statAll = { long: mode === "year" ? tr("tTotal") : `${tr("tTotal")} ${sel}`, rows: scope, a: aggr(scope) };

  // ---- tiles
  const A = aggr(scope);
  let units, unitsLabel, best, bestText;
  if (mode === "week") {
    const idx = buckets.findIndex((b) => b.now);
    units = sel === cy ? (idx >= 0 ? idx + 1 : buckets.length) : sel < cy ? buckets.length : 1; unitsLabel = "kAvgWeek";
    best = buckets.reduce((m, b) => (b.a.sub > (m ? m.a.sub : 0) ? b : m), null); bestText = best && tr("kBestWeek", `${tr("week")} ${best.wn}`, eur0(best.a.sub));
  } else {
    if (mode === "year") { const first = Math.min(...list.map((x) => x.y * 12 + x.mo)); units = Math.max(1, cy * 12 + now.getMonth() - first + 1); }
    else units = sel < cy ? 12 : sel === cy ? now.getMonth() + 1 : 1;
    unitsLabel = "kAvgMonth";
    const byMonth = new Map(); scope.forEach((x) => { const k = x.y * 12 + x.mo; byMonth.set(k, (byMonth.get(k) || 0) + x.sub); });
    let bm = null; byMonth.forEach((v, k) => { if (!bm || v > bm.v) bm = { v, k }; });
    best = bm; bestText = bm && tr("kBest", `${monthName(bm.k % 12)}${mode === "year" ? " " + Math.floor(bm.k / 12) : ""}`, eur0(bm.v));
  }
  let cmp = "";
  if (mode !== "year") {
    const prev = list.filter((x) => x.y === sel - 1 && (sel !== cy || x.mo < now.getMonth() || (x.mo === now.getMonth() && x.d <= now.getDate())));
    const ps = aggr(prev).sub;
    if (ps > 0) { const pct = Math.round((A.sub - ps) / ps * 100); const txt = tr(sel === cy ? "vsPrevYtd" : "vsPrev", (pct >= 0 ? "+" : "−") + Math.abs(pct) + "%", sel - 1); cmp = `<span class="${pct >= 0 ? "up" : "down"}">${esc(txt)}</span>`; }
  }
  const scopeTxt = mode === "year" ? tr("scopeAll") : tr("scopeYear", sel);
  const tile = (label, value, sub) => `<div class="kpi"><p class="eyebrow">${esc(label)}</p><div class="v num">${esc(value)}</div><div class="s">${sub}</div></div>`;
  const tiles = {
    rev: () => tile(tr(po ? "kOrdered" : "kRevenue"), eur0(A.sub), cmp || esc(scopeTxt)),
    count: () => tile(tr(po ? "kOrders" : "kInvoices"), String(A.n), esc(A.n ? tr(po ? "kAvgOrder" : "kAvgInvoice", eur0(A.sub / A.n)) : "")),
    days: () => tile(tr("kDays"), core.qty(A.days), esc(A.days ? tr("kAvgRate", eur0(A.sub / A.days)) : "")),
    avg: () => tile(tr(unitsLabel), eur0(A.sub / units), esc(best ? bestText : "")),
    ...kpiExtras({ list, scope, A, po, mode, sel, cy, now, best }),
  };
  $("#kpis").innerHTML = KPI_ALL.filter((k) => state.kpiTiles.includes(k) && kpiAvail(k).ok && tiles[k]).map((k) => tiles[k]().replace('<div class="kpi">', `<div class="kpi" data-k="${k}">`)).join("");
  $("#kpis").hidden = !$("#kpis").children.length;
  $("#kpiFilter").classList.toggle("custom", state.kpiTiles.join() !== KPI_DEFAULT.join());
  if (!$("#kpiMenu").hidden) renderKpiMenu();

  // ---- chart
  const unitKey = { week: "unitWeek", month: "unitMonth", quarter: "unitQuarter", year: "unitYear" }[mode];
  $("#chartTitle").textContent = `${tr(po ? "whatOrdered" : "whatRevenue")} ${tr(unitKey)}${mode === "year" ? "" : ", " + sel}`;
  renderChart({ buckets, mode, sel, cy, po, unitKey });
  const count = tr(po ? "tOrders" : "tInvoices");

  // ---- table (weeks without anything on them are left out)
  const cell = (v, fmt) => (v ? `<td>${esc(fmt(v))}</td>` : `<td class="z">–</td>`);
  const head = po ? [["per", tr("tPeriod")], ["n", tr("tOrders")], ["days", tr("tDays")], ["sub", tr("tValue")]] : [["per", tr("tPeriod")], ["n", tr("tInvoices")], ["days", tr("tDays")], ["sub", tr("tEx")], ["vat", tr("tVat")], ["total", tr("tInc")]];
  const shown = sortRows("st", mode === "week" ? buckets.filter((b) => b.a.n) : buckets, (b, k) => (k === "per" ? buckets.indexOf(b) : b.a[k] || 0), head.map((c) => c[0]));
  $("#stTable").innerHTML = sortHead("st", head) + `<tbody>` +
    shown.map((b) => `<tr${b.now ? ' class="now"' : ""}><td>${b.rows.length ? `<button type="button" class="plink" data-per="${buckets.indexOf(b)}" aria-haspopup="dialog">${esc(b.text)}</button>` : esc(b.text)}</td>${cell(b.a.n, String)}${cell(b.a.days, core.qty)}${cell(b.a.sub, core.eur)}${po ? "" : cell(b.a.vat, core.eur) + cell(b.a.total, core.eur)}</tr>`).join("") +
    `</tbody><tfoot><tr><td>${scope.length ? `<button type="button" class="plink" data-per="all" aria-haspopup="dialog">${esc(tr("tTotal"))}</button>` : esc(tr("tTotal"))}</td><td>${A.n}</td><td>${esc(core.qty(A.days))}</td><td>${esc(core.eur(A.sub))}</td>${po ? "" : `<td>${esc(core.eur(A.vat))}</td><td>${esc(core.eur(A.total))}</td>`}</tr></tfoot>`;

  // ---- per client (only when there is more than one)
  const clients = new Map(); scope.forEach((x) => { const k = x.client || tr("noClient"); if (!clients.has(k)) clients.set(k, []); clients.get(k).push(x); });
  $("#clientPanel").hidden = clients.size < 2;
  if (clients.size > 1) {
    const cols = [["name", tr("tClient")], ["n", count], ["sub", tr(po ? "tValue" : "tEx")], ["share", tr("tShare")]];
    const rows = sortRows("cl", [...clients.entries()].map(([k, r]) => [k, aggr(r)]).sort((a, b) => b[1].sub - a[1].sub), ([k, a], c) => (c === "name" ? k : c === "n" ? a.n : a.sub), cols.map((c) => c[0]));
    $("#clTable").innerHTML = sortHead("cl", cols) + `<tbody>` +
      rows.map(([k, a]) => `<tr><td>${esc(k)}</td><td>${a.n}</td><td>${esc(core.eur(a.sub))}</td><td>${A.sub ? Math.round(a.sub / A.sub * 100) : 0}%</td></tr>`).join("") + "</tbody>";
  }
  if (po) {
    const has = (x, f) => x.flags && x.flags.includes(f);
    const dupDays = new Set(list.filter((x) => has(x, "dup")).map((x) => x.y * 10000 + x.mo * 100 + x.d)).size; // dates that more than one PO claims
    const unitLines = new Set(list.filter((x) => has(x, "unit")).map((x) => x.key + "|" + (x.desc || ""))).size;
    $("#statsNote").textContent = [tr("statsNotePo", state.poRecs.length), state.poBasis === "work" && tr("poSplitNote"), dupDays && tr("noteDup", dupDays), unitLines && tr("noteUnit", unitLines), undated && tr("noDate", undated), tr("perHint")].filter(Boolean).join(" ");
  } else {
    const nF = list.filter((x) => x.src === "folder").length;
    const nHours = list.filter((x) => x.flags && x.flags.includes("hours")).length;
    $("#statsNote").textContent = [nF ? tr("statsNote2", list.length, list.length - nF, nF) : tr("statsNote", list.length), nHours && tr("noteHoursInv", nHours), undated && tr("noDate", undated), list.some((x) => x.src === "folder" && x.i.dateGuess) && tr("dateGuess"), tr("perHint")].filter(Boolean).join(" ");
  }
}

async function exportCsv() {
  const { list } = statData(); const { sel } = statScope(); const po = state.statSource === "pos";
  const rows = state.statMode === "year" ? list : list.filter((x) => x.y === sel);
  if (!rows.length) return;
  const q = (t) => `"${String(t ?? "").replace(/"/g, '""')}"`, n2 = (n) => core.round2(n).toFixed(2).replace(".", ","), dd = (n) => String(core.round2(n)).replace(".", ",");
  let head, body;
  if (po) { // one line per PO (the part that falls in the chosen period)
    const g = new Map(); rows.forEach((x) => { if (!g.has(x.key)) g.set(x.key, []); g.get(x.key).push(x); });
    head = [tr("csvPo"), tr("csvOrderDate"), tr("csvFirstDay"), tr("client"), tr("tDays"), tr("tValue")].map(q).join(";");
    body = [...g.values()].map((r) => [q(r[0].key), q((r[0].i.orderDate || "").replace(/-/g, "/")), q(r[0].i.datum), q(r[0].client), dd(r.reduce((a, x) => a + x.days, 0)), n2(r.reduce((a, x) => a + x.sub, 0))].join(";"));
  } else {
    head = [tr("invNo"), tr("invDate"), "PO", tr("client"), tr("tEx"), tr("tVat"), tr("tInc"), tr("tDays")].map(q).join(";");
    body = rows.map((x) => [q(x.i.factuurnr), q(x.i.datum || ""), q(x.i.po || ""), q(x.client), n2(x.sub), n2(x.vat), n2(x.total), dd(x.days)].join(";"));
  }
  const blob = new Blob(["﻿" + [head, ...body].join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
  const nm = `${po ? "Inkooporders" : "Facturen"} ${state.statMode === "year" ? "alle jaren" : sel}.csv`;
  if (await save(nm, blob, { plain: true })) toast(tr("downloaded", nm));
}

