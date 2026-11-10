// Test folders for the "new purchase orders" panel: an invoice folder where some POs already have an invoice (in three different ways).
import fs from "node:fs"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const [toolDir, outDir] = process.argv.slice(2);
const PDFLib = require("/home/claude/.npm-global/lib/node_modules/pdf-lib"), core = require(toolDir + "/invoice-core.js");
const images = { logo: fs.readFileSync(`${toolDir}/img/logo-white.png`), sidebar: fs.readFileSync(`${toolDir}/img/sidebar.png`) };
const client = { name: "Piguillet BV", street: "Edisonstraat 8", city: "2652 XS Berkel en Rodenrijs", kvk: "52742938", btw: "NL850577950B01" };
fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
const make = async (file, nr, datum, desc, rate, qty) => fs.writeFileSync(`${outDir}/${file}`, await core.renderInvoice(PDFLib, { fontkit: null, fonts: null, images },
  { factuurnr: nr, datum, betaaltermijn: "14 dagen", client, lines: [{ desc, tarief: rate, aantal: qty }], btw: "verlegd", sender: core.SENDER }));
await make("VALKYRYS 1-2025.pdf", "1-2025", "02/01/2026".replace("2026", "2025"), "PO-100001", 450, 3);            // PO named inside the invoice
await make("VALKYRYS 2-2026 PO-100003.pdf", "2-2026", "03/02/2026", "Werkzaamheden", 450, 4);                      // PO only in the file name
await make("VALKYRYS 3-2026.pdf", "3-2026", "04/03/2026", "PO-1000047", 450, 1);                                    // another number that merely starts like PO-100004
console.log(fs.readdirSync(outDir));
