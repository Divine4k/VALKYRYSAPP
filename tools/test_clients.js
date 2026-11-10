// Client presets in "Facturen en klant": save, switch, update, delete, per-card client, kept after a restart, and the first preset made from the client that was filled in.
const { goTab, seedProfile, APP_DIR } = require("./test_helpers");
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const HOME = "/tmp/el-appdata-clients", F = "/tmp/clients-inv", PO = process.argv[3];
const dataFile = path.join(HOME, APP_DIR, "data.json");
const db = () => { try { return JSON.parse(fs.readFileSync(dataFile, "utf8")); } catch (e) { return {}; } };
const waitDb = async (fn, ms = 6000) => { const t = Date.now(); let d; while (Date.now() - t < ms) { d = db(); try { if (fn(d)) return d; } catch (e) {} await new Promise((r) => setTimeout(r, 150)); } return d; };
const launch = async () => {
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: HOME, XDG_CONFIG_HOME: HOME } });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.setViewportSize({ width: 1280, height: 1100 }).catch(() => {});
  await page.waitForSelector("#pick", { state: "attached" }); await page.waitForTimeout(1500); await goTab(page, "inv"); await page.waitForTimeout(300);
  await page.evaluate(() => { document.querySelector("#settingsBox").open = true; });
  return { app, page, errs };
};
const opts = (page) => page.$$eval("#clPick option", (o) => o.map((x) => x.textContent));
const picked = (page) => page.$eval("#clPick", (s) => s.options[s.selectedIndex] && s.options[s.selectedIndex].textContent);
const form = (page) => page.evaluate(() => ["cName", "cStreet", "cCity", "cKvk", "cBtw", "sTerm", "sBtw"].map((id) => document.getElementById(id).value));
const choose = async (page, label) => { const v = await page.$$eval("#clPick option", (o, l) => (o.find((x) => x.textContent === l) || {}).value, label); await page.selectOption("#clPick", v); await page.waitForTimeout(500); };
const modShown = (page) => page.isVisible("#clMod");

(async () => {
  // ================= an install from before presets: no settings/clients and no client filled in -> no preset is made
  fs.rmSync(HOME, { recursive: true, force: true }); fs.rmSync(F, { recursive: true, force: true }); fs.mkdirSync(F, { recursive: true });
  const { DEFAULT_SETTINGS } = require("../electron-app/server.js");
  fs.mkdirSync(path.join(HOME, APP_DIR), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify({ "settings/main": { ...DEFAULT_SETTINGS, template: "valkyrys", client: { name: "", street: "", city: "", kvk: "", btw: "" } } }));
  seedProfile(HOME, { folder: F });
  let { app, page, errs } = await launch();
  eq(await opts(page), ["Nieuwe klant…"], "no client filled in: no preset made, only 'Nieuwe klant…'");
  ok(!(await page.isEnabled("#clUpdate")) && !(await page.isEnabled("#clDelete")), "nothing to update or delete yet");
  await app.close();

  // ================= migration: the client that was filled in becomes the first preset, and the active one
  fs.rmSync(HOME, { recursive: true, force: true }); seedProfile(HOME, { folder: F });
  ({ app, page, errs } = await launch());
  eq(await opts(page), ["Piguillet BV", "Nieuwe klant…"], "existing client became a preset");
  eq(await picked(page), "Piguillet BV", "...and it is selected");
  let d = await waitDb((x) => x["settings/clients"]);
  const pig = d["settings/clients"] && d["settings/clients"].list[0];
  ok(pig && d["settings/clients"].active === pig.id && pig.fields.client.kvk === "52742938" && pig.fields.betaaltermijn === "14 dagen" && pig.fields.btw === "verlegd", "stored in settings/clients with its fields, active", d["settings/clients"]);
  ok(!(await modShown(page)), "not marked 'gewijzigd'");

  // ---- a new client
  await choose(page, "Nieuwe klant…");
  eq(await form(page), ["", "", "", "", "", "14 dagen", "verlegd"], "'Nieuwe klant…' empties the client fields");
  await page.fill("#cName", "Acme BV"); await page.fill("#cStreet", "Kade 1"); await page.fill("#cCity", "1000 AA Amsterdam"); await page.fill("#cKvk", "12345678"); await page.fill("#cBtw", "NL123456789B01");
  await page.fill("#sTerm", "30 dagen"); await page.selectOption("#sBtw", "21");
  await page.click("#clSaveNew"); ok(await page.isVisible("#clNameRow"), "'Opslaan als klant' asks for a name");
  eq(await page.inputValue("#clNewName"), "Acme BV", "...with the client name as default");
  await page.screenshot({ path: "/tmp/clients-name.png" });
  await page.click("#clNameOk"); await page.waitForTimeout(600);
  eq(await opts(page), ["Piguillet BV", "Acme BV", "Nieuwe klant…"], "Acme saved as preset"); eq(await picked(page), "Acme BV", "...and selected");
  d = await waitDb((x) => x["settings/main"].client.name === "Acme BV");
  eq([d["settings/main"].client.name, d["settings/main"].client.kvk, d["settings/main"].betaaltermijn, d["settings/main"].btw], ["Acme BV", "12345678", "30 dagen", "21"], "invoices now use Acme (settings/main)");
  eq(d["settings/main"].startNumber, DEFAULT_SETTINGS.startNumber, "the global start number is untouched");

  // ---- switch back: the fields fill
  await choose(page, "Piguillet BV");
  eq(await form(page), ["Piguillet BV", "Edisonstraat 8", "2652 XS Berkel en Rodenrijs", "52742938", "NL850577950B01", "14 dagen", "verlegd"], "choosing Piguillet fills all its fields");
  d = await waitDb((x) => x["settings/main"].client.name === "Piguillet BV"); eq([d["settings/main"].client.name, d["settings/main"].btw], ["Piguillet BV", "verlegd"], "...and makes it the one invoices use");

  // ---- change a field: 'gewijzigd' until updated
  await page.fill("#cStreet", "Edisonstraat 10");
  ok(await modShown(page), "editing a field marks it 'gewijzigd'"); ok(await page.isEnabled("#clUpdate"), "'Bijwerken' is available");
  await page.screenshot({ path: "/tmp/clients.png" });
  await page.click("#clUpdate"); await page.waitForTimeout(500);
  ok(!(await modShown(page)), "after 'Bijwerken' it is no longer marked");
  d = await waitDb((x) => x["settings/clients"].list.find((c) => c.name === "Piguillet BV").fields.client.street === "Edisonstraat 10");
  eq(d["settings/clients"].list.find((c) => c.name === "Piguillet BV").fields.client.street, "Edisonstraat 10", "the preset is updated in the database");
  eq(d["settings/main"].client.street, "Edisonstraat 10", "...and so is what invoices use");

  // ---- invoices: a new card takes the active client; per card the client can be changed
  await choose(page, "Acme BV");
  await page.setInputFiles("#file", [PO]); await page.waitForFunction(() => document.querySelectorAll("article.po h3").length === 1);
  const card = "article.po";
  eq(await page.$eval(`${card} select[data-k="client"]`, (s) => s.options[s.selectedIndex].textContent), "Acme BV", "new card: client select shows the active client");
  eq(await page.$eval(`${card} select[data-k="btw"]`, (s) => s.value), "21", "...and its VAT mode");
  ok((await page.textContent(card)).includes("12345678"), "the card warns the PO's KVK differs from Acme's");
  const nr1 = await page.inputValue(`${card} input[data-k="nr"]`);
  await page.click(`${card} button[data-act="download"]`); await page.waitForSelector(`${card} .done`, { timeout: 30000 });
  d = await waitDb((x) => x["invoices/" + nr1]);
  const r1 = d["invoices/" + nr1] || {};
  eq([r1.client && r1.client.name, r1.client && r1.client.kvk, r1.betaaltermijn, r1.btw], ["Acme BV", "12345678", "30 dagen", "21"], "saved invoice " + nr1 + " is for Acme");
  await page.setInputFiles("#file", [PO]); await page.waitForFunction(() => document.querySelectorAll("article.po h3").length === 2);
  const c2 = "article.po:nth-of-type(2)";
  const pv = await page.$$eval(`${c2} select[data-k="client"] option`, (o) => o.find((x) => x.textContent === "Piguillet BV").value);
  await page.selectOption(`${c2} select[data-k="client"]`, pv); await page.waitForTimeout(300);
  eq(await page.$eval(`${c2} select[data-k="btw"]`, (s) => s.value), "verlegd", "switching a card to Piguillet takes its VAT mode");
  ok(!(await page.textContent(c2)).includes("12345678"), "...and the KVK warning is gone");
  const nr2 = await page.inputValue(`${c2} input[data-k="nr"]`);
  await page.click(`${c2} button[data-act="download"]`);
  await page.waitForSelector("#poDupDlg[open]", { timeout: 5000 }).then(() => page.click("#poDupGo")).catch(() => {}); // same PO as the first card: "make it anyway"
  await page.waitForSelector(`${c2} .done`, { timeout: 30000 });
  d = await waitDb((x) => x["invoices/" + nr2]);
  const r2 = d["invoices/" + nr2] || {};
  eq([r2.client && r2.client.name, r2.client && r2.client.street, r2.betaaltermijn, r2.btw], ["Piguillet BV", "Edisonstraat 10", "14 dagen", "verlegd"], "saved invoice " + nr2 + " is for Piguillet while Acme stays active");
  eq(await picked(page), "Acme BV", "the active client did not change");
  await page.screenshot({ path: "/tmp/clients-cards.png", fullPage: true });

  // ---- delete Acme (with a question)
  let asked = ""; page.once("dialog", (dl) => { asked = dl.message(); dl.accept(); });
  await page.click("#clDelete"); await page.waitForTimeout(500);
  ok(asked.includes("Acme BV"), "delete asks first: " + asked);
  eq(await opts(page), ["Piguillet BV", "Nieuwe klant…"], "Acme is gone from the list");
  d = await waitDb((x) => x["settings/clients"].list.length === 1);
  eq(d["settings/clients"].list.map((c) => c.name), ["Piguillet BV"], "...and from the database");
  page.once("dialog", (dl) => dl.dismiss());
  await choose(page, "Piguillet BV"); await page.click("#clDelete"); await page.waitForTimeout(300);
  eq(await opts(page), ["Piguillet BV", "Nieuwe klant…"], "cancelling the question keeps the client");
  eq(errs, [], "no page errors");
  await app.close();

  // ---- after a restart
  ({ app, page, errs } = await launch());
  eq(await opts(page), ["Piguillet BV", "Nieuwe klant…"], "after a restart the presets are there (no second migration)");
  eq(await picked(page), "Piguillet BV", "...and the active one is selected");
  eq((await form(page)).slice(0, 2), ["Piguillet BV", "Edisonstraat 10"], "...with its updated fields");
  ok(!(await modShown(page)), "...not marked 'gewijzigd'");
  eq(errs, [], "no page errors after restart");
  await app.close();
  console.log(fails ? `${fails} FAILED` : "all passed"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack || e)); process.exit(1); });
