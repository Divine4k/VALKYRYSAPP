// Looking at a PO or invoice PDF, and a Word file drawn as a page (docxPage).
"use strict";
// ---- looking at the original PDF of a purchase order or an invoice (from the new-orders list and from the list behind a period of the statistics)
let poPrevSeq = 0;
async function previewDoc({ title, load, open, addPo, nopreview, word }) {
  const dlg = $("#poDlg"), pages = $("#poPages"), err = $("#poDlgErr"), id = ++poPrevSeq;
  $("#poDlgTitle").textContent = title; dlg.dataset.rel = open ? open.rel : ""; dlg.dataset.kind = open && open.kind ? open.kind : "";
  pages.innerHTML = ""; err.hidden = true; err.className = "chip error";
  const add = $("#poDlgAdd"); add.hidden = !addPo; add.textContent = tr("npAdd"); add.dataset.po = addPo || ""; // only a PO that still has to be added
  const ob = $("#poDlgOpen"), ok = word ? "wordOpen" : "poOpenExt"; ob.dataset.i18n = ok; ob.textContent = tr(ok); ob.hidden = !(desk && open);
  if (!dlg.open) dlg.showModal();
  if (nopreview) { err.className = "chip warn"; err.textContent = tr(nopreview); err.hidden = false; return; }
  try {
    const raw = await load(); if (!raw) throw new Error("unreadable");
    if (word) { // a Word file: drawn as a simple page; if that fails, the old "open it in Word" message
      try { const el = await docxPage(new Uint8Array(raw)); if (id === poPrevSeq) pages.appendChild(el); }
      catch (e) { if (id === poPrevSeq) { err.className = "chip warn"; err.textContent = tr("noPrevWord"); err.hidden = false; } }
      return;
    }
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(raw) }).promise;
    for (let p = 1; p <= Math.min(pdf.numPages, 6); p++) {
      if (id !== poPrevSeq) return;
      const page = await pdf.getPage(p), vp = page.getViewport({ scale: 2 }), cv = document.createElement("canvas");
      cv.width = vp.width; cv.height = vp.height; cv.setAttribute("role", "img"); cv.setAttribute("aria-label", tr("poPrevPage", p, pdf.numPages));
      pages.appendChild(cv); await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
    }
  } catch (e) { if (id === poPrevSeq) { err.textContent = tr("poPrevFail"); err.hidden = false; } }
}
const previewPo = (rel, po) => previewDoc({ title: tr("poPrevTitle", po), load: () => desk.readFile(rel, "pos"), open: { rel, kind: "pos" }, addPo: newPoItems().show.some((x) => x.r.po === po) ? po : "" });
/** an invoice: one made here is drawn again from what was saved; one that was only in the folder is shown from its PDF (a Word file can only be opened) */
function previewInvoice(x) {
  const nrTxt = x.key, mine = state.invoices.get(x.key), title = tr("invPrevTitle", nrTxt);
  if (mine && mine.lines && mine.lines.length) {
    const data = { factuurnr: mine.factuurnr, datum: mine.datum, betaaltermijn: mine.betaaltermijn || state.settings.betaaltermijn, client: mine.client || state.settings.client, lines: mine.lines, btw: mine.btw || "verlegd", ...recordLook(mine) };
    return previewDoc({ title, load: () => buildPdf(data) });
  }
  const rel = x.i && x.i.file; if (!rel || !desk) return previewDoc({ title, nopreview: "poPrevFail" });
  return /\.pdf$/i.test(rel) ? previewDoc({ title, load: () => desk.readFile(rel), open: { rel } }) : previewDoc({ title: tr("wordPrevTitle", nrTxt), load: () => desk.readFile(rel), open: { rel }, word: true });
}

// ---- a Word file (.docx) drawn as a simple white page: paragraphs, bold/italic/underline, sizes and colours, tables, line breaks, pictures, header and footer
async function docxPage(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const xml = async (p) => { const f = zip.file(p); if (!f) return null; const d = new DOMParser().parseFromString(await f.async("string"), "application/xml"); return d.getElementsByTagName("parsererror").length ? null : d; };
  const doc = await xml("word/document.xml"); const body = doc && [...doc.documentElement.children].find((c) => c.localName === "body");
  if (!body) throw new Error("no document.xml");
  const kids = (el) => (el ? [...el.children] : []), child = (el, n) => kids(el).find((c) => c.localName === n) || null;
  const attr = (el, n) => (el ? el.getAttribute("w:" + n) ?? el.getAttribute(n) : null), val = (el, n) => attr(child(el, n), "val");
  const tw = (v) => (v == null || isNaN(+v) ? null : +v / 15); // twips -> CSS px
  const relsOf = async (part) => { const m = new Map(), x = await xml(part.replace(/([^/]+)$/, "_rels/$1.rels")); if (x) for (const r of x.getElementsByTagName("Relationship")) m.set(r.getAttribute("Id"), r.getAttribute("Target") || ""); return m; };
  const IMG = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml" };
  const imgSrc = async (target) => { // relative to word/; emf/wmf cannot be shown by a browser and are left out
    const parts = []; for (const p of ("word/" + target.replace(/^\//, "../")).split("/")) { if (p === "..") parts.pop(); else if (p && p !== ".") parts.push(p); }
    const f = zip.file(parts.join("/")), mime = IMG[parts.join("/").split(".").pop().toLowerCase()];
    return f && mime ? `data:${mime};base64,${await f.async("base64")}` : "";
  };
  // styles: run look of each style (with the styles it is based on) and the document defaults
  const sx = await xml("word/styles.xml"), styles = new Map(); let defRun = null, defPara = "";
  if (sx) for (const s of kids(sx.documentElement)) {
    if (s.localName === "docDefaults") defRun = child(child(s, "rPrDefault"), "rPr");
    if (s.localName !== "style") continue;
    styles.set(attr(s, "styleId"), { basedOn: val(s, "basedOn"), rPr: child(s, "rPr"), pPr: child(s, "pPr") });
    if (attr(s, "type") === "paragraph" && /^(1|true)$/.test(attr(s, "default") || "")) defPara = attr(s, "styleId");
  }
  const flag = (pr, n) => { const c = child(pr, n); if (!c) return undefined; const v = attr(c, "val"); return v == null || !/^(0|false|none|off)$/i.test(v); };
  const look = (pr, base) => {
    const o = { ...base }; if (!pr) return o;
    for (const k of ["b", "i", "caps", "strike", "vanish"]) { const f = flag(pr, k); if (f !== undefined) o[k] = f; }
    const u = val(pr, "u"); if (u) o.u = u !== "none";
    const sz = val(pr, "sz"); if (sz && +sz) o.sz = +sz / 2;
    const col = val(pr, "color"); if (col && /^[0-9a-f]{6}$/i.test(col)) o.color = "#" + col;
    const va = val(pr, "vertAlign"); if (va) o.va = va;
    const fnt = attr(child(pr, "rFonts"), "ascii"); if (fnt) o.font = fnt;
    const sh = attr(child(pr, "shd"), "fill"); if (sh && /^[0-9a-f]{6}$/i.test(sh)) o.bg = "#" + sh;
    return o;
  };
  const memo = new Map(), base0 = look(defRun, {});
  const styleLook = (id, depth = 0) => { if (!id || depth > 12 || !styles.has(id)) return base0; if (memo.has(id)) return memo.get(id); const s = styles.get(id), o = look(s.rPr, styleLook(s.basedOn, depth + 1)); memo.set(id, o); return o; };
  const stylePPr = (id, n, depth = 0) => { const s = id && styles.get(id); if (!s || depth > 12) return null; return child(s.pPr, n) || stylePPr(s.basedOn, n, depth + 1); };
  const css = (o) => [o.b && "font-weight:700", o.i && "font-style:italic", (o.u || o.strike) && `text-decoration:${[o.u && "underline", o.strike && "line-through"].filter(Boolean).join(" ")}`,
    o.sz && `font-size:${o.sz}pt`, o.color && `color:${o.color}`, o.caps && "text-transform:uppercase", o.bg && `background:${o.bg}`,
    o.va === "superscript" && "vertical-align:super;font-size:smaller", o.va === "subscript" && "vertical-align:sub;font-size:smaller",
    o.font && `font-family:'${o.font.replace(/['";<>]/g, "")}',Carlito,Calibri,sans-serif`].filter(Boolean).join(";");
  async function drawing(d, rels) {
    const anchor = d.getElementsByTagNameNS("*", "anchor")[0];
    if (anchor && anchor.getAttribute("behindDoc") === "1") return ""; // backgrounds and watermarks behind the text are left out
    let h = "";
    const blip = d.getElementsByTagNameNS("*", "blip")[0] || d.getElementsByTagNameNS("*", "imagedata")[0];
    const rid = blip && (blip.getAttribute("r:embed") || blip.getAttribute("r:id"));
    const src = rid && rels.has(rid) ? await imgSrc(rels.get(rid)) : "";
    if (src) { const ext = d.getElementsByTagNameNS("*", "extent")[0], w = ext ? Math.round(+ext.getAttribute("cx") / 9525) : 0; h += `<img src="${src}" alt=""${w > 0 ? ` style="width:${w}px"` : ""}>`; }
    for (const tb of d.getElementsByTagNameNS("*", "txbxContent")) h += `<div class="wbox">${await blocks(tb, rels)}</div>`;
    return h;
  }
  async function runKids(list, o, rels) {
    let h = "";
    for (const c of list) {
      const n = c.localName;
      if (n === "t") h += esc(c.textContent);
      else if (n === "tab" || n === "ptab") h += '<span class="wtab"></span>';
      else if (n === "br" || n === "cr") h += "<br>";
      else if (n === "noBreakHyphen") h += "‑";
      else if (n === "drawing" || n === "pict" || n === "object") h += await drawing(c, rels);
      else if (n === "AlternateContent") h += await runKids(kids(child(c, "Choice") || child(c, "Fallback")), o, rels);
    }
    return h;
  }
  async function inline(el, pLook, rels) { // the runs of a paragraph, also inside links, fields and content controls
    let h = "";
    for (const c of kids(el)) {
      const n = c.localName;
      if (n === "r") {
        const pr = child(c, "rPr"), cs = styles.get(val(pr, "rStyle")), o = look(pr, cs ? look(cs.rPr, pLook) : pLook); // character style, then the run's own look
        if (o.vanish) continue;
        const t = await runKids(kids(c), o, rels), st = css(o);
        if (t) h += st ? `<span style="${st}">${t}</span>` : t;
      } else if (["hyperlink", "smartTag", "ins", "fldSimple", "customXml"].includes(n)) h += await inline(c, pLook, rels);
      else if (n === "sdt") h += await inline(child(c, "sdtContent"), pLook, rels);
      else if (n === "AlternateContent") h += await inline(child(c, "Choice") || child(c, "Fallback"), pLook, rels);
    }
    return h;
  }
  async function para(p, rels) {
    const pPr = child(p, "pPr"), sid = val(pPr, "pStyle") || defPara;
    const pLook = styleLook(sid); // (the paragraph mark's own rPr does not apply to its text)
    const pp = (n) => child(pPr, n) || stylePPr(sid, n);
    const jc = attr(pp("jc"), "val"), sp = pp("spacing"), ind = pp("ind");
    const st = [jc && `text-align:${{ center: "center", right: "right", end: "right", both: "justify", distribute: "justify" }[jc] || "left"}`,
      sp && attr(sp, "before") && `margin-top:${+attr(sp, "before") / 20}pt`, sp && attr(sp, "after") != null && `margin-bottom:${+attr(sp, "after") / 20}pt`,
      ind && tw(attr(ind, "left") ?? attr(ind, "start")) && `padding-left:${tw(attr(ind, "left") ?? attr(ind, "start"))}px`, pLook.sz && `font-size:${pLook.sz}pt`].filter(Boolean).join(";");
    const bullet = pp("numPr") ? "• " : "";
    return `<div class="wp"${st ? ` style="${st}"` : ""}>${bullet}${await inline(p, pLook, rels)}</div>`;
  }
  async function table(t, rels) {
    const pr = child(t, "tblPr"), bd = child(pr, "tblBorders"), sid = val(pr, "tblStyle") || "";
    const lined = (bd && kids(bd).some((b) => !/^(none|nil)$/i.test(attr(b, "val") || "none"))) || /grid/i.test(sid);
    const tblW = child(pr, "tblW"), width = tblW && attr(tblW, "type") === "dxa" && tw(attr(tblW, "w")) ? `width:${tw(attr(tblW, "w"))}px;max-width:100%` : "";
    const cols = kids(child(t, "tblGrid")).map((g) => tw(attr(g, "w")));
    const rows = [], open = [];
    for (const tr of kids(t).filter((x) => x.localName === "tr")) {
      const row = []; let col = 0;
      for (const tc of kids(tr).filter((x) => x.localName === "tc")) {
        const cp = child(tc, "tcPr"), span = +val(cp, "gridSpan") || 1, vm = child(cp, "vMerge");
        if (vm && attr(vm, "val") !== "restart" && open[col]) { open[col].rows++; col += span; continue; } // merged with the cell above
        const fill = attr(child(cp, "shd"), "fill"), cell = { span, rows: 1, fill: fill && /^[0-9a-f]{6}$/i.test(fill) ? "#" + fill : "", html: await blocks(tc, rels) };
        open[col] = vm ? cell : null; row.push(cell); col += span;
      }
      rows.push(row);
    }
    const sum = cols.reduce((a, w) => a + (w || 0), 0); // column widths as parts of the whole, so the table always fits the page
    const cg = cols.length && cols.every(Boolean) ? `<colgroup>${cols.map((w) => `<col style="width:${(w / sum * 100).toFixed(2)}%">`).join("")}</colgroup>` : "";
    return `<table class="${lined ? "bd" : ""}"${width ? ` style="${width}"` : ""}>${cg}<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td${c.span > 1 ? ` colspan="${c.span}"` : ""}${c.rows > 1 ? ` rowspan="${c.rows}"` : ""}${c.fill ? ` style="background:${c.fill}"` : ""}>${c.html}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
  async function blocks(el, rels) {
    let h = "";
    for (const c of kids(el)) {
      const n = c.localName;
      if (n === "p") h += await para(c, rels);
      else if (n === "tbl") h += await table(c, rels);
      else if (n === "sdt") h += await blocks(child(c, "sdtContent"), rels);
      else if (n === "customXml") h += await blocks(c, rels);
      else if (n === "AlternateContent") h += await blocks(child(c, "Choice") || child(c, "Fallback"), rels);
    }
    return h;
  }
  const docRels = await relsOf("word/document.xml"), sect = [...body.children].reverse().find((c) => c.localName === "sectPr");
  const part = async (kind) => { // the default header or footer of the (last) section
    const ref = kids(sect).find((c) => c.localName === kind + "Reference" && (attr(c, "type") || "default") === "default"), target = ref && docRels.get(ref.getAttribute("r:id"));
    if (!target) return ""; const p = "word/" + target.replace(/^\//, ""), x = await xml(p); if (!x) return "";
    const h = await blocks(x.documentElement, await relsOf(p));
    return h.replace(/<[^>]+>/g, "").trim() || /<img/.test(h) ? h : ""; // an empty header adds nothing
  };
  const head = await part("header"), main = await blocks(body, docRels), foot = await part("footer");
  const page = document.createElement("div"); page.className = "wpage"; page.setAttribute("role", "document");
  const pgW = tw(attr(child(sect, "pgSz"), "w")), mar = child(sect, "pgMar"), ml = tw(attr(mar, "left")), mr = tw(attr(mar, "right"));
  if (pgW) page.style.maxWidth = `min(${Math.round(pgW)}px, 100%)`;
  if (ml != null && mr != null && window.innerWidth > 640) { page.style.paddingLeft = Math.round(Math.min(ml, 110)) + "px"; page.style.paddingRight = Math.round(Math.min(mr, 110)) + "px"; }
  page.innerHTML = (head ? `<div class="whf h">${head}</div>` : "") + main + (foot ? `<div class="whf f">${foot}</div>` : "");
  for (const el of page.querySelectorAll("span[style]")) { // very light text sat on a picture behind it, which is left out: it turns dark, unless a shaded cell is behind it
    const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(el.style.color); if (!m || 0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3] <= 200) continue;
    let p = el, shaded = false; while (p && p !== page && !shaded) { shaded = !!(p.style && p.style.backgroundColor); p = p.parentElement; }
    if (!shaded) el.style.color = "";
  }
  if (!page.textContent.trim() && !page.querySelector("img")) throw new Error("empty");
  return page;
}

