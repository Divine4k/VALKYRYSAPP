// Prints where everything sits on page 1 of a PDF (text baselines in pt from the top, size, font; filled rectangles with colour).
// Use it on a reference invoice (a client's Word file converted to PDF) to copy its layout into a new template.
//   node tools/measure_pdf.mjs reference.pdf
import fs from "node:fs";
const pdfjs = await import("/home/claude/.npm-global/lib/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
const data = new Uint8Array(fs.readFileSync(process.argv[2]));
const doc = await pdfjs.getDocument({ data, useSystemFonts: false }).promise;
const page = await doc.getPage(1);
const H = page.view[3];
const tc = await page.getTextContent();
console.log("PAGE", page.view[2], "x", H);
const rows = tc.items.filter((i) => i.str.trim()).map((i) => ({ s: i.str, x: +i.transform[4].toFixed(2), base: +(H - i.transform[5]).toFixed(2), size: +Math.hypot(i.transform[0], i.transform[1]).toFixed(2), w: +i.width.toFixed(2), f: (tc.styles[i.fontName] || {}).fontFamily }));
rows.sort((a, b) => a.base - b.base || a.x - b.x);
for (const r of rows) console.log(`T  x=${r.x}  base=${r.base}  size=${r.size}  w=${r.w}  ${JSON.stringify(r.s)}`);
const ops = await page.getOperatorList(); const O = pdfjs.OPS;
let fill = [0, 0, 0], stroke = [0, 0, 0], lw = 1; const hex = (c) => c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const stack = []; let ctm = [1, 0, 0, 1, 0, 0];
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
for (let i = 0; i < ops.fnArray.length; i++) {
  const fn = ops.fnArray[i], a = ops.argsArray[i];
  if (fn === O.save) stack.push([ctm, fill, stroke, lw]); else if (fn === O.restore) [ctm, fill, stroke, lw] = stack.pop() || [ctm, fill, stroke, lw];
  else if (fn === O.transform) ctm = mul(ctm, a);
  else if (fn === O.setFillRGBColor) fill = a.length === 1 ? [...Buffer.from(String(a[0]).replace("#", ""), "hex")] : a;
  else if (fn === O.setStrokeRGBColor) stroke = a.length === 1 ? [...Buffer.from(String(a[0]).replace("#", ""), "hex")] : a;
  else if (fn === O.setLineWidth) lw = a[0];
  else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject) console.log(`IMG x=${ctm[4].toFixed(2)} top=${(H - ctm[5] - ctm[3]).toFixed(2)} w=${ctm[0].toFixed(2)} h=${ctm[3].toFixed(2)}`);
  else if (fn === O.constructPath) {
    // newer pdf.js: [paintOp, [path data], [minX, minY, maxX, maxY]]; older: [[ops], [coords]] followed by a separate fill/stroke op
    let paint = null, box = null;
    if (typeof a[0] === "number") { paint = a[0] === O.fill || a[0] === O.eoFill ? "fill" : a[0] === O.stroke ? "stroke" : a[0] === O.fillStroke || a[0] === O.eoFillStroke ? "fillstroke" : null; box = a[2]; }
    else {
      const nxt = ops.fnArray[i + 1]; paint = nxt === O.fill || nxt === O.eoFill ? "fill" : nxt === O.stroke ? "stroke" : null;
      const c = a[1]; if (c && c.length >= 4) box = [Math.min(c[0], c[2]), Math.min(c[1], c[3]), Math.max(c[0], c[2]), Math.max(c[1], c[3])];
    }
    if (!paint || !box) continue;
    const [bx0, by0, bx1, by1] = box;
    const X = (x, y) => x * ctm[0] + y * ctm[2] + ctm[4], Y = (x, y) => x * ctm[1] + y * ctm[3] + ctm[5];
    const xs = [X(bx0, by0), X(bx1, by1)], ys = [Y(bx0, by0), Y(bx1, by1)];
    const x = Math.min(...xs), w = Math.abs(xs[1] - xs[0]), top = H - Math.max(...ys), h = Math.abs(ys[1] - ys[0]);
    console.log(`${paint === "stroke" ? "LINE/BOX" : "RECT"} x=${x.toFixed(2)} top=${top.toFixed(2)} w=${w.toFixed(2)} h=${h.toFixed(2)} color=${hex(paint === "stroke" ? stroke : fill)}${paint !== "fill" ? " line=" + lw : ""}`);
  }
}
