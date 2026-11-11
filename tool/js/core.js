// Main script, part 1 of 16 (all parts share one global scope; order in index.html matters): shared helpers ($, esc, tr), state, libraries, loadAssets.
"use strict";
const core = window.InvoiceCore;
const TP = window.InvoiceTemplates; // the invoice designs and the person's own details
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isoToNl = (iso) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };

const DEFAULTS = { startNumber: 1, startYear: new Date().getFullYear(), betaaltermijn: "14 dagen", btw: "verlegd", fileTemplate: "VALKYRYS {nummer}",
  client: { name: "", street: "", city: "", kvk: "", btw: "" }, template: "" };
const state = { settings: structuredClone(DEFAULTS), invoices: new Map(), cards: [], db: null, dl: null, assets: null, seq: 0, lang: "nl", folder: null, files: [], fileNums: new Map(), folderSig: "", savedTo: "", tab: "stats", statMode: "month", statYear: 0, parseCache: new Map(), folderInvoices: [], unread: [], scan: null, dbReady: null,
  statSource: "invoices", poBasis: "work", poSkip: new Set(), poChecked: false, npAll: false, npBusy: false, invoicesLoaded: false, folderScanned: false, poFolder: null, poFiles: [], poSig: "", poScanSig: "", poRecs: [], poUnread: [], poScan: null, poCache: new Map(), poDup: null, poSame: [], welcomed: false };
state.dbReady = new Promise((res) => { state.dbResolve = res; });
// ------------------------------------------------------------ languages (the interface only: invoices themselves stay in Dutch)
const LANGS = { nl: "Nederlands", en: "English", pl: "Polski" };
const I18N = window.VALK_I18N; // the texts: i18n/nl.js, i18n/en.js, i18n/pl.js
const tr = (k, ...a) => String(((I18N[state.lang] || I18N.nl)[k] ?? I18N.nl[k] ?? k)).replace(/\{(\d)\}/g, (m, i) => (a[+i] ?? ""));
const plural = (n) => { if (n === 1) return "daysOne"; if (state.lang === "pl") { const r10 = n % 10, r100 = n % 100; return r10 >= 2 && r10 <= 4 && !(r100 >= 12 && r100 <= 14) ? "daysFew" : "daysMany"; } return "daysMany"; };


// ------------------------------------------------------------ libraries
const libsOk = !!(window.PDFLib && window.pdfjsLib && core);
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
if (!libsOk) {
  const b = $("#libError");
  b.dataset.i18n = "libError"; b.textContent = tr("libError");
  b.hidden = false;
}

async function loadAssets() {
  if (state.assets) return state.assets;
  const get = async (p) => { const r = await fetch(p); if (!r.ok) throw new Error(p); return new Uint8Array(await r.arrayBuffer()); };
  const images = { logo: await get("img/logo-white.png"), sidebar: await get("img/sidebar.png"), extremeLogo: await get("img/extreme-logo.png"), extremeEmblem: await get("img/extreme-emblem.png") };
  state.docxAssets = { logo: images.logo, logoW: 1365, logoH: 318, accent: await get("img/accent.png"), background: await get("img/background.png") };
  let fonts = null;
  try { fonts = { regular: await get("fonts/Carlito-Regular.ttf"), bold: await get("fonts/Carlito-Bold.ttf"), italic: await get("fonts/Carlito-Italic.ttf") }; } catch (e) { fonts = null; }
  let extremeDocx = null; try { extremeDocx = await get("templates/extreme.docx"); } catch (e) {}
  state.assets = { fontkit: window.fontkit || null, fonts, images, docx: state.docxAssets, extremeDocx };
  return state.assets;
}

