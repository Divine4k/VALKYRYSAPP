import fs from "node:fs"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const T = process.argv[2], out = process.argv[3], foot = Number(process.argv[4] || 1500), n = Number(process.argv[5] || 1);
const docx = require("/home/claude/.npm-global/lib/node_modules/docx");
const core = require(`${T}/invoice-core.js`), { buildDocx } = require(`${T}/invoice-docx.js`);
const rd = (f) => fs.readFileSync(`${T}/img/${f}`);
const lines = [{ desc: "PO-008148", tarief: 450, aantal: 3 }, { desc: "PO-008149 – Dagprijs", tarief: 500, aantal: 2 }].slice(0, n);
const buf = await buildDocx(docx, { logo: rd("logo-white.png"), logoW: 1365, logoH: 318, accent: rd("accent.png"), background: rd("background.png"), footGap: foot }, {
  factuurnr: "62-2026", datum: "09/11/2026", betaaltermijn: "14 dagen", btw: "verlegd", sender: core.SENDER, lines,
  client: { name: "Piguillet BV", street: "Edisonstraat 8", city: "2652 XS Berkel en Rodenrijs", kvk: "52742938", btw: "NL850577950B01" } }, core);
fs.writeFileSync(out, buf); console.log("wrote", out, buf.length);
