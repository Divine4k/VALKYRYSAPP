// Text of an old Word file (.doc, Word 97-2003): the compound file around it, the WordDocument stream and its piece table.
// Only the text, as lines (paragraphs and table cells), the way docxLines gives them for a .docx. Runs in the page and in Node (tests).
"use strict";
const WordDoc = (function () {
  const END = 0xFFFFFFFA; // sector numbers from here up end a chain
  /** the streams of a compound file (OLE2) by name; null when it is not one */
  function cfbStreams(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 512 || dv.getUint32(0, true) !== 0xE011CFD0 || dv.getUint32(4, true) !== 0xE11AB1A1) return null;
    const ss = 1 << dv.getUint16(0x1E, true), mss = 1 << dv.getUint16(0x20, true), cutoff = dv.getUint32(0x38, true);
    const secOff = (n) => (n + 1) * ss; // the header takes the first sector (512 bytes, or 4096 in version 4)
    // the FAT sectors: 109 in the header, the rest in a chain of DIFAT sectors
    const fatSecs = [];
    for (let i = 0; i < 109; i++) { const s = dv.getUint32(0x4C + i * 4, true); if (s < END) fatSecs.push(s); }
    let di = dv.getUint32(0x44, true), guard = 0;
    while (di < END && guard++ < 10000) {
      const o = secOff(di); if (o + ss > bytes.length) break;
      for (let i = 0; i < ss / 4 - 1; i++) { const s = dv.getUint32(o + i * 4, true); if (s < END) fatSecs.push(s); }
      di = dv.getUint32(o + ss - 4, true);
    }
    const fat = [];
    for (const s of fatSecs) { const o = secOff(s); for (let i = 0; i < ss / 4 && o + i * 4 + 4 <= bytes.length; i++) fat.push(dv.getUint32(o + i * 4, true)); }
    const chain = (start, table) => { const out = []; let s = start; const seen = new Set(); while (s < END && !seen.has(s) && s < table.length) { seen.add(s); out.push(s); s = table[s]; } return out; };
    const readChain = (start, size) => {
      const out = new Uint8Array(size); let pos = 0;
      for (const s of chain(start, fat)) { const o = secOff(s); const n = Math.min(ss, size - pos, bytes.length - o); if (n <= 0) break; out.set(bytes.subarray(o, o + n), pos); pos += n; if (pos >= size) break; }
      return out.subarray(0, pos);
    };
    // the directory
    const dirBytes = readChain(dv.getUint32(0x30, true), 1 << 24);
    const entries = [];
    for (let o = 0; o + 128 <= dirBytes.length; o += 128) {
      const ddv = new DataView(dirBytes.buffer, dirBytes.byteOffset + o, 128);
      const nl = ddv.getUint16(0x40, true), type = ddv.getUint8(0x42);
      if (!type || nl < 2 || nl > 64) continue;
      let name = ""; for (let i = 0; i < nl / 2 - 1; i++) name += String.fromCharCode(ddv.getUint16(i * 2, true));
      entries.push({ name, type, start: ddv.getUint32(0x74, true), size: ddv.getUint32(0x78, true) });
    }
    const root = entries.find((e) => e.type === 5);
    // small streams live in the mini stream (64-byte sectors), with their own FAT
    let mini = null, minifat = null;
    const getMini = () => {
      if (mini) return;
      mini = root ? readChain(root.start, root.size) : new Uint8Array(0);
      const mf = readChain(dv.getUint32(0x3C, true), dv.getUint32(0x40, true) * ss), mdv = new DataView(mf.buffer, mf.byteOffset, mf.byteLength);
      minifat = []; for (let i = 0; i + 4 <= mf.length; i += 4) minifat.push(mdv.getUint32(i, true));
    };
    const streams = {}; Object.defineProperty(streams, "_all", { value: [], enumerable: false });
    for (const e of entries) {
      if (e.type !== 2) continue;
      const get = () => {
        if (e.size >= cutoff) return readChain(e.start, e.size);
        getMini(); const out = new Uint8Array(e.size); let pos = 0;
        for (const s of chain(e.start, minifat)) { const n = Math.min(mss, e.size - pos); out.set(mini.subarray(s * mss, s * mss + n), pos); pos += n; if (pos >= e.size) break; }
        return out;
      };
      streams[e.name] = get; streams._all.push({ name: e.name, get });
    }
    return streams;
  }

  /** a .doc: its whole text (main text, then footnotes, headers and footers) and where those parts end; null when it is not one */
  function docRaw(bytes) {
    const st = cfbStreams(bytes); if (!st || !st.WordDocument) return null;
    const wd = st.WordDocument(), dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
    if (wd.length < 0x1AA || dv.getUint16(0, true) !== 0xA5EC) return null;
    const flags = dv.getUint16(0x0A, true);
    if (flags & 0x0100) return null; // encrypted
    const tblName = flags & 0x0200 ? "1Table" : "0Table"; if (!st[tblName]) return null;
    const tbl = st[tblName](), tdv = new DataView(tbl.buffer, tbl.byteOffset, tbl.byteLength);
    const fcClx = dv.getUint32(0x1A2, true), lcbClx = dv.getUint32(0x1A6, true);
    if (!lcbClx || fcClx + lcbClx > tbl.length) return null;
    // the Clx: some Prc blocks (formatting), then the piece table
    let o = fcClx;
    while (o < fcClx + lcbClx && tbl[o] === 0x01) o += 3 + tdv.getInt16(o + 1, true);
    if (tbl[o] !== 0x02) return null;
    const lcb = tdv.getUint32(o + 1, true), p = o + 5, n = Math.floor((lcb - 4) / 12);
    const cp = (i) => tdv.getUint32(p + i * 4, true);
    const ansi = new TextDecoder("windows-1252"), utf16 = new TextDecoder("utf-16le");
    let text = "";
    for (let i = 0; i < n; i++) {
      const pcd = p + (n + 1) * 4 + i * 8, fc = tdv.getUint32(pcd + 2, true), len = cp(i + 1) - cp(i);
      if (len <= 0) continue;
      if (fc & 0x40000000) { const s = (fc & 0x3FFFFFFF) / 2; text += ansi.decode(wd.subarray(s, s + len)); }
      else text += utf16.decode(wd.subarray(fc, fc + len * 2));
    }
    // the header document: stories 0-5 are footnote separators, then per section: even header, odd header, even footer, odd footer, first header, first footer
    const fcHdd = dv.getUint32(0xF2, true), lcbHdd = dv.getUint32(0xF6, true), hdd = [];
    if (lcbHdd >= 8 && fcHdd + lcbHdd <= tbl.length) for (let i = 0; i + 4 <= lcbHdd; i += 4) hdd.push(tdv.getUint32(fcHdd + i, true));
    return { text, ccpText: dv.getInt32(0x4C, true), ccpFtn: dv.getInt32(0x50, true), ccpHdd: dv.getInt32(0x54, true), hdd, st };
  }
  /** the whole text of a .doc, or null */
  const docText = (bytes) => { const r = docRaw(bytes); return r ? r.text : null; };

  // ---- an Excel sheet embedded in the Word file (Workbook stream, BIFF8): its first sheet as text rows, amounts as "€ 1.725,00"
  const CURRENCY_BUILTIN = new Set([5, 6, 7, 8, 42, 44]);
  const moneyFmt = (id, fmts) => id != null && (CURRENCY_BUILTIN.has(+id) || /€|\[\$€|EUR/.test(fmts[id] || ""));
  const nlNum = (v, d) => { const neg = v < 0, x = Math.abs(v).toFixed(d), [i, f] = x.split("."); return (neg ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (f ? "," + f : ""); };
  const cellNum = (v, money) => (money ? "€ " + nlNum(v, 2) : Number.isInteger(v) ? String(v) : nlNum(Math.round(v * 100) / 100, 2).replace(/0$/, ""));
  const gridOfCells = (cells) => [...cells.keys()].sort((a, b) => a - b).map((r) => [...cells.get(r).entries()].sort((a, b) => a[0] - b[0]).map((x) => [x[0], x[1].replace(/\s+/g, " ").trim()]).filter((x) => x[1])).filter((r) => r.length);
  /** rows of a grid as text lines */
  const gridRows = (g) => g.map((r) => r.map((x) => x[1]).join(" "));
  const sheetRows = (wb) => gridRows(sheetGrid(wb));
  /** the first sheet of a BIFF8 workbook as a grid: rows of [column, text] */
  function sheetGrid(wb) {
    const dv = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);
    const recs = []; for (let o = 0; o + 4 <= wb.length;) { const t = dv.getUint16(o, true), n = dv.getUint16(o + 2, true); recs.push({ t, o: o + 4, n }); o += 4 + n; }
    const fmts = {}, xfs = [], sst = []; let sheet = -1;
    const u16 = (o) => dv.getUint16(o, true);
    const ustr = (o) => { const cch = u16(o), hi = wb[o + 2] & 1; o += 3; return hi ? new TextDecoder("utf-16le").decode(wb.subarray(o, o + cch * 2)) : new TextDecoder("windows-1252").decode(wb.subarray(o, o + cch)); };
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (r.t === 0x0809 && i > 0 && u16(r.o + 2) === 0x0010) { sheet = i; break; } // the first worksheet
      if (r.t === 0x041E) fmts[u16(r.o)] = ustr(r.o + 2);
      else if (r.t === 0x00E0) xfs.push(u16(r.o + 2));
      else if (r.t === 0x00FC) { // shared strings, continued over CONTINUE records
        const chunks = [[r.o, r.o + r.n]]; for (let j = i + 1; j < recs.length && recs[j].t === 0x003C; j++) chunks.push([recs[j].o, recs[j].o + recs[j].n]);
        let c = 0, p = chunks[0][0] + 8; const total = dv.getUint32(r.o + 4, true);
        const need = (k) => { if (p + k > chunks[c][1] && c + 1 < chunks.length) { c++; p = chunks[c][0]; } };
        const byte = () => { need(1); return wb[p++]; }, word = () => { need(2); const v = u16(p); p += 2; return v; }, dword = () => { need(4); const v = dv.getUint32(p, true); p += 4; return v; };
        for (let k = 0; k < total && c < chunks.length; k++) {
          const cch = word(); let fl = byte(), runs = 0, ext = 0, str = "";
          if (fl & 8) runs = word(); if (fl & 4) ext = dword();
          let left = cch;
          while (left > 0) {
            if (p >= chunks[c][1]) { if (c + 1 >= chunks.length) break; c++; p = chunks[c][0]; fl = wb[p++]; } // a string that goes on in the next CONTINUE starts with a new flags byte
            const w = fl & 1 ? 2 : 1, n = Math.min(left, Math.floor((chunks[c][1] - p) / w));
            str += w === 2 ? new TextDecoder("utf-16le").decode(wb.subarray(p, p + n * 2)) : new TextDecoder("windows-1252").decode(wb.subarray(p, p + n));
            p += n * w; left -= n; if (!n) break;
          }
          for (let skip = runs * 4 + ext; skip > 0;) { if (p >= chunks[c][1]) { if (c + 1 >= chunks.length) break; c++; p = chunks[c][0]; } const n = Math.min(skip, chunks[c][1] - p); p += n; skip -= n; }
          sst.push(str);
        }
      }
    }
    if (sheet < 0) return [];
    const num = (v, xf) => cellNum(v, moneyFmt(xfs[xf], fmts));
    const rk = (x) => { let v; if (x & 2) v = x >> 2; else { const b = new DataView(new ArrayBuffer(8)); b.setUint32(4, x & 0xFFFFFFFC, true); v = b.getFloat64(0, true); } return x & 1 ? v / 100 : v; };
    const cells = new Map(); const put = (row, col, text) => { if (text === "" || text == null) return; if (!cells.has(row)) cells.set(row, new Map()); cells.get(row).set(col, String(text)); };
    let pendingStr = null;
    for (let i = sheet + 1; i < recs.length; i++) {
      const { t, o, n } = recs[i]; if (t === 0x000A) break; // end of the sheet
      if (t === 0x00FD) put(u16(o), u16(o + 2), sst[dv.getUint32(o + 6, true)]);
      else if (t === 0x0204) put(u16(o), u16(o + 2), ustr(o + 6));
      else if (t === 0x0203) put(u16(o), u16(o + 2), num(dv.getFloat64(o + 6, true), u16(o + 4)));
      else if (t === 0x027E) put(u16(o), u16(o + 2), num(rk(dv.getUint32(o + 6, true)), u16(o + 4)));
      else if (t === 0x00BD) { const row = u16(o), c0 = u16(o + 2); for (let k = 0; 6 + k * 6 + 6 <= n; k++) put(row, c0 + k, num(rk(dv.getUint32(o + 6 + k * 6, true)), u16(o + 4 + k * 6))); }
      else if (t === 0x0006) {
        const row = u16(o), col = u16(o + 2), xf = u16(o + 4);
        if (u16(o + 12) === 0xFFFF) { if (wb[o + 6] === 0) pendingStr = [row, col]; } // a text result: it follows in a STRING record
        else put(row, col, num(dv.getFloat64(o + 6, true), xf));
      } else if (t === 0x0207 && pendingStr) { put(pendingStr[0], pendingStr[1], ustr(o)); pendingStr = null; }
    }
    return gridOfCells(cells);
  }
  /** the first sheet of an .xlsx workbook (a zip) as the same kind of grid */
  async function xlsxGrid(JSZip, bytes) {
    const zip = await JSZip.loadAsync(bytes), txt = async (n) => { const f = zip.file(n); return f ? f.async("string") : ""; };
    const unx = (t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&amp;/g, "&");
    const tOf = (x) => [...x.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => unx(m[1])).join("");
    const sst = [...(await txt("xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => tOf(m[1]));
    const styles = await txt("xl/styles.xml"), fmts = {};
    for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) { const id = /numFmtId="(\d+)"/.exec(m[0]), code = /formatCode="([^"]*)"/.exec(m[0]); if (id && code) fmts[id[1]] = unx(code[1]); }
    const xfs = [...((/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles) || [])[1] || "").matchAll(/<xf\b[^>]*>/g)].map((m) => +((/numFmtId="(\d+)"/.exec(m[0]) || [])[1] || 0));
    const name = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.replace(/\D+/g, ""), 10) - parseInt(b.replace(/\D+/g, ""), 10))[0];
    const sheet = name ? await txt(name) : "", cells = new Map();
    const put = (row, col, text) => { if (text === "" || text == null) return; if (!cells.has(row)) cells.set(row, new Map()); cells.get(row).set(col, String(text)); };
    for (const c of sheet.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+)(\d+)"/.exec(c[1]); if (!ref || c[2] == null) continue;
      const col = [...ref[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1, row = +ref[2] - 1, t = (/\bt="([^"]+)"/.exec(c[1]) || [])[1] || "n", xf = +((/\bs="(\d+)"/.exec(c[1]) || [])[1] || 0);
      const v = (/<v>([^<]*)<\/v>/.exec(c[2]) || [])[1];
      if (t === "inlineStr") put(row, col, tOf(c[2])); else if (v == null) continue;
      else if (t === "s") put(row, col, sst[+v]); else if (t === "str" || t === "e") put(row, col, t === "e" ? "" : unx(v)); else if (t === "b") put(row, col, v === "1" ? "TRUE" : "FALSE");
      else if (isFinite(+v)) put(row, col, cellNum(+v, moneyFmt(xfs[xf], fmts)));
    }
    return gridOfCells(cells);
  }
  /** the grid of an embedded workbook, whatever it is packed in: an .xlsx, an .xls, or an OLE object holding either */
  async function gridOf(JSZip, bytes) {
    if (bytes[0] === 0x50 && bytes[1] === 0x4B) return JSZip ? xlsxGrid(JSZip, bytes) : [];
    const st = cfbStreams(bytes); if (!st) return [];
    const wb = st._all.find((x) => x.name === "Workbook" || x.name === "Book"); if (wb) return sheetGrid(wb.get());
    const pk = st._all.find((x) => x.name === "Package" || x.name === "CONTENTS"); if (pk && JSZip) { const b = pk.get(); if (b[0] === 0x50 && b[1] === 0x4B) return xlsxGrid(JSZip, b); }
    return [];
  }
  /** the tables of the workbooks embedded in a .docx (zip already opened), in file order: [{ name, grid }] */
  async function docxGrids(JSZip, zip) {
    const out = [];
    for (const name of Object.keys(zip.files).filter((n) => /^word\/embeddings\/[^/]+$/.test(n) && !zip.files[n].dir).sort()) {
      try { const grid = await gridOf(JSZip, await zip.file(name).async("uint8array")); if (grid.length) out.push({ name, grid }); } catch (e) {}
    }
    return out;
  }

  /** the text as lines: paragraphs and table cells each on their own, field codes left out (their result kept), then the rows of embedded Excel tables */
  function docLines(bytes) {
    const lines = textLines(bytes); if (lines == null) return null;
    for (const g of docGrids(bytes)) lines.push(...gridRows(g));
    return lines;
  }
  /** the grids of the workbooks embedded in a .doc */
  function docGrids(bytes) {
    const st = cfbStreams(bytes), out = []; if (!st) return out;
    for (const x of st._all) if (x.name === "Workbook" || x.name === "Book") { try { const g = sheetGrid(x.get()); if (g.length) out.push(g); } catch (e) {} }
    return out;
  }
  const OBJ = "\u0001"; // stands on a line of its own where an embedded object (the Excel table) is
  const toLines = (t, mark) => cleanText(t, mark).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  function textLines(bytes) { const t = docText(bytes); return t == null ? null : toLines(t, false); }
  /** what a preview needs: { header: [lines], body: [line | { grid }], footer: [lines] } (the tables where their objects stand), or null */
  function docPreview(bytes) {
    const raw = docRaw(bytes); if (!raw) return null;
    const grids = docGrids(bytes), ok = raw.ccpText > 0 && raw.ccpText <= raw.text.length;
    const body = []; let gi = 0;
    for (const l of toLines(ok ? raw.text.slice(0, raw.ccpText) : raw.text, true)) { if (l === OBJ) { if (gi < grids.length) body.push({ grid: grids[gi++] }); } else body.push(l); }
    while (gi < grids.length) body.push({ grid: grids[gi++] });
    const header = [], footer = [], add = (list, t) => { for (const l of toLines(t, false)) if (!list.includes(l)) list.push(l); };
    if (ok && raw.ccpHdd > 0) {
      const base = raw.ccpText + raw.ccpFtn, story = (i) => (i + 1 < raw.hdd.length ? raw.text.slice(base + raw.hdd[i], base + raw.hdd[i + 1]) : "");
      for (let i = 6; i + 1 < raw.hdd.length; i++) add([0, 1, 4].includes((i - 6) % 6) ? header : footer, story(i));
    }
    return { header, body, footer };
  }
  function cleanText(t, mark) {
    let out = "", depth = 0, inCode = [], code = [];
    for (const ch of t) {
      const c = ch.charCodeAt(0);
      if (c === 0x13) { depth++; inCode.push(true); code.push(""); continue; } // field begin: the code follows
      if (c === 0x14) { if (depth) { inCode[depth - 1] = false; if (mark && /^\s*EMBED\b/i.test(code[depth - 1])) { out += "\n" + OBJ + "\n"; code[depth - 1] = ""; } } continue; } // separator: the result follows
      if (c === 0x15) { if (depth) { if (mark && /^\s*EMBED\b/i.test(code[depth - 1])) out += "\n" + OBJ + "\n"; depth--; inCode.pop(); code.pop(); } continue; } // field end
      if (depth && inCode[depth - 1]) { code[depth - 1] += ch; continue; }
      if (inCode.some(Boolean)) continue;
      if (c === 0x0D || c === 0x07 || c === 0x0B || c === 0x0C) { out += "\n"; continue; } // paragraph, cell, line break, page break
      if (c < 0x20 && c !== 0x09) continue; // pictures, footnote marks and other special characters
      out += c === 0x09 ? " " : ch === "\u00A0" ? " " : ch;
    }
    return out;
  }
  return { cfbStreams, docText, docLines, docPreview, sheetRows, sheetGrid, xlsxGrid, gridOf, gridRows, docxGrids };
})();
if (typeof module !== "undefined" && module.exports) module.exports = WordDoc;
