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

  /** the whole text of a .doc (main text, then headers/footers etc.), or null */
  function docText(bytes) {
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
    return text;
  }

  // ---- an Excel sheet embedded in the Word file (Workbook stream, BIFF8): its first sheet as text rows, amounts as "€ 1.725,00"
  const CURRENCY_BUILTIN = new Set([5, 6, 7, 8, 42, 44]);
  function sheetRows(wb) {
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
    const isMoney = (xf) => { const f = xfs[xf]; return f != null && (CURRENCY_BUILTIN.has(f) || /€|\[\$€|EUR/.test(fmts[f] || "")); };
    const nl = (v, d) => { const neg = v < 0, x = Math.abs(v).toFixed(d), [i, f] = x.split("."); return (neg ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (f ? "," + f : ""); };
    const num = (v, xf) => (isMoney(xf) ? "€ " + nl(v, 2) : Number.isInteger(v) ? String(v) : nl(v, 2).replace(/0$/, ""));
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
    return [...cells.keys()].sort((a, b) => a - b).map((r) => [...cells.get(r).entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1].replace(/\s+/g, " ").trim()).filter(Boolean).join(" ")).filter(Boolean);
  }

  /** the text as lines: paragraphs and table cells each on their own, field codes left out (their result kept), then the rows of embedded Excel tables */
  function docLines(bytes) {
    const lines = textLines(bytes); if (lines == null) return null;
    const st = cfbStreams(bytes);
    for (const x of st._all) if (x.name === "Workbook" || x.name === "Book") { try { lines.push(...sheetRows(x.get())); } catch (e) {} }
    return lines;
  }
  function textLines(bytes) {
    const t = docText(bytes); if (t == null) return null;
    let out = "", depth = 0, inCode = [];
    for (const ch of t) {
      const c = ch.charCodeAt(0);
      if (c === 0x13) { depth++; inCode.push(true); continue; } // field begin: the code follows
      if (c === 0x14) { if (depth) inCode[depth - 1] = false; continue; } // separator: the result follows
      if (c === 0x15) { if (depth) { depth--; inCode.pop(); } continue; } // field end
      if (inCode.some(Boolean)) continue;
      if (c === 0x0D || c === 0x07 || c === 0x0B || c === 0x0C) { out += "\n"; continue; } // paragraph, cell, line break, page break
      if (c < 0x20 && c !== 0x09) continue; // pictures, footnote marks and other special characters
      out += c === 0x09 ? " " : ch === " " ? " " : ch;
    }
    return out.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  }
  return { cfbStreams, docText, docLines, sheetRows };
})();
if (typeof module !== "undefined" && module.exports) module.exports = WordDoc;
