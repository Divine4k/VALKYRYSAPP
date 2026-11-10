// Draws a sample invoice in every design (PDF, and Word for the designs that have it) so they can be looked at and compared.
//   node tools/render_templates.mjs <toolDir> <outDir>
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const [toolDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const core = require(`${toolDir}/invoice-core.js`), T = require(`${toolDir}/invoice-templates.js`), InvoiceDocx = require(`${toolDir}/invoice-docx.js`);
const PDFLib = require("/home/claude/.npm-global/lib/node_modules/pdf-lib"), JSZip = require("/opt/npm-tools/node_modules/jszip"), docx = require("/home/claude/.npm-global/lib/node_modules/docx");
const rd = (p) => new Uint8Array(fs.readFileSync(`${toolDir}/${p}`));
const assets = {
  fontkit: null, fonts: { regular: rd("fonts/Carlito-Regular.ttf"), bold: rd("fonts/Carlito-Bold.ttf"), italic: rd("fonts/Carlito-Italic.ttf") },
  images: { logo: rd("img/logo-white.png"), sidebar: rd("img/sidebar.png"), extremeLogo: rd("img/extreme-logo.png"), extremeEmblem: rd("img/extreme-emblem.png") },
  docx: { logo: rd("img/logo-white.png"), logoW: 1365, logoH: 318, accent: rd("img/accent.png"), background: rd("img/background.png") },
  extremeDocx: rd("templates/extreme.docx"),
};
const client = { name: "Piguillet BV", street: "Edisonstraat 8", city: "2652 XS Berkel en Rodenrijs", kvk: "52742938", btw: "NL850577950B01" };
const lines = [{ desc: "PO-008148", tarief: 450, aantal: 3 }, { desc: "PO-008151", tarief: 56.25, aantal: 12 }];
const filled = { name: "Extreme Building", person: "J. Jansen", street: "Voorbeeldstraat 12", city: "1234 AB Teststad", phone: "0612345678", email: "info@extreme-building.example", iban: "NL91 ABNA 0417 1643 00", btw: "NL123456789B01", kvk: "12345678" };
for (const t of T.TEMPLATES) {
  const sender = T.forRender(t.id === "extreme" ? filled : T.senderFor(t.id));
  const data = { template: t.id, factuurnr: "62-2026", datum: "09/11/2026", betaaltermijn: "14 dagen", client, lines, btw: "verlegd", sender };
  fs.writeFileSync(`${outDir}/${t.id}.pdf`, await T.renderPdf(PDFLib, assets, data, core));
  const w = await T.buildWord({ docx, InvoiceDocx, JSZip }, assets, data, core);
  fs.writeFileSync(`${outDir}/${t.id}.docx`, Buffer.from(w));
  console.log("wrote", t.id);
}
