// An invoice without a purchase order (another client): the button on the Invoices tab, client typed on the card, lines added/removed,
// "Bewaren als klant", saving into the invoice folder, and the main client left alone.
const { tmp, goTab, seedProfile, APP_DIR, saved } = require("./test_helpers");
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const HOME = tmp("el-appdata-nopo"), F = tmp("nopo-inv");
const db = () => { try { return JSON.parse(fs.readFileSync(path.join(HOME, APP_DIR, "data.json"), "utf8")); } catch (e) { return {}; } };
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch (e) {} await new Promise((r) => setTimeout(r, 150)); } return false; };
(async () => {
  fs.rmSync(HOME, { recursive: true, force: true }); fs.rmSync(F, { recursive: true, force: true }); fs.mkdirSync(F, { recursive: true });
  seedProfile(HOME, { folder: F });
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: HOME, XDG_CONFIG_HOME: HOME } });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.setViewportSize({ width: 1280, height: 1100 }).catch(() => {});
  await page.waitForSelector("#pick", { state: "attached" }); await page.waitForTimeout(1500);
  await goTab(page, "inv"); await page.waitForTimeout(300);

  ok(await page.isVisible(".nextbox #newNoPo") && (await page.textContent("#newNoPo")).trim() === "Nieuw" && (await page.getAttribute("#newNoPo", "aria-label")) === "Factuur zonder inkooporder", "'+ Nieuw' box beside the 'Volgende factuur' box");
  const geo = await page.evaluate(() => { const a = document.querySelector(".nextbox .nextmain").getBoundingClientRect(), b = document.querySelector("#newNoPo").getBoundingClientRect(); return { left: b.right <= a.left + 1, narrow: b.width < a.width / 2, same: Math.abs(a.top - b.top) < 2 }; });
  ok(geo.left && geo.narrow && geo.same, "...left of the number, much narrower", geo);
  ok(!(await page.$("#drop #newNoPo")), "no extra button in the drop zone");
  await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: "/tmp/nopo-top.png", clip: { x: 900, y: 80, width: 380, height: 200 } });
  await page.click("#newNoPo");
  const card = ".po.nopo";
  ok(await until(() => page.isVisible(card)), "an empty card is added");
  ok(/Factuur zonder inkooporder/.test(await page.textContent(`${card} h3`)), "...titled 'Factuur zonder inkooporder'");
  ok(!(await page.isVisible(`${card} .ownclient`)) && /Klantgegevens · nog niet ingevuld/.test(await page.textContent(`${card} [data-act=owntoggle]`)), "client box folded: 'Klantgegevens · nog niet ingevuld'");
  await page.screenshot({ path: "/tmp/nopo-new.png" });
  await page.click(`${card} [data-act=owntoggle]`);
  ok(await page.isVisible(`${card} .ownclient`) && await page.evaluate(() => document.activeElement && document.activeElement.dataset.ck === "name"), "opened: the client fields, name has focus");
  ok(/Andere klant/.test(await page.$eval(`${card} select[data-k=client]`, (s) => s.options[s.selectedIndex].textContent)), "client: 'Andere klant' by default");
  const notes = await page.textContent(`${card} .checks`);
  ok(/naam van de klant/.test(notes) && /minstens één regel/.test(notes), "notes ask for the client and a line", notes);
  await page.click(`${card} [data-act=download-both]`);
  ok(await until(async () => /minstens één regel/.test(await page.textContent("#toast"))), "saving an empty one: says what is missing");
  ok(!fs.readdirSync(F).length, "...and saves nothing");

  await page.fill(`${card} [data-ck=name]`, "Bakkerij De Vries"); await page.fill(`${card} [data-ck=street]`, "Dorpsstraat 1"); await page.fill(`${card} [data-ck=city]`, "1234 AB Delft");
  await page.fill(`${card} [data-line="0"][data-k=desc]`, "Advieswerk oktober"); await page.fill(`${card} [data-line="0"][data-k=aantal]`, "2"); await page.fill(`${card} [data-line="0"][data-k=tarief]`, "450");
  ok((await page.textContent(`${card} [data-amt="0"]`)).includes("900,00"), "line amount 2 × 450");
  await page.screenshot({ path: "/tmp/nopo-before-add.png" });
  await page.click(`${card} [data-act=addline]`);
  ok(await until(async () => (await page.$$(`${card} .line`)).length === 2), "+ Regel toevoegen", await page.evaluate(() => state.cards.map((c) => c.lines.length)));
  await page.fill(`${card} [data-line="1"][data-k=desc]`, "Reiskosten"); await page.fill(`${card} [data-line="1"][data-k=aantal]`, "1"); await page.fill(`${card} [data-line="1"][data-k=tarief]`, "35");
  await page.click(`${card} [data-line="1"][data-k=tarief]`); await page.keyboard.press("Tab"); await page.waitForTimeout(200);
  ok((await page.textContent(`${card} [data-total]`)).includes("935,00"), "total of both lines", await page.textContent(`${card} [data-total]`));
  await page.screenshot({ path: "/tmp/nopo-card.png" });
  await page.click(`${card} [data-act=addline]`); await page.click(`${card} [data-act=delline][data-line="2"]`);
  ok((await page.$$(`${card} .line`)).length === 2, "a line can be removed again");

  await page.click(`${card} [data-act=owntoggle]`);
  ok(!(await page.isVisible(`${card} .ownclient`)) && /Bakkerij De Vries, 1234 AB Delft/.test(await page.textContent(`${card} [data-act=owntoggle]`)), "folded again: the name shows on the button, the typed details are kept");
  await page.click(`${card} [data-act=owntoggle]`);
  await page.click(`${card} [data-act=saveclient]`);
  ok(await until(async () => /Bakkerij De Vries/.test(await page.textContent("#toast"))), "Bewaren als klant: toast");
  ok(await until(() => { const c = db()["settings/clients"]; return c && c.list.some((p) => p.name === "Bakkerij De Vries" && p.fields.client.city === "1234 AB Delft"); }), "...stored as a client preset", db()["settings/clients"]);
  ok((await page.$eval(`${card} select[data-k=client]`, (s) => s.options[s.selectedIndex].textContent)) === "Bakkerij De Vries" && !(await page.isVisible(`${card} .ownclient`)), "...and picked on the card");
  ok((await page.textContent(`${card} [data-total]`)).includes("935,00"), "lines kept");

  await page.click(`${card} [data-act=download-both]`);
  const pdf = await until(() => fs.readdirSync(F).some((n) => n.endsWith(".pdf")) && fs.readdirSync(F).some((n) => n.endsWith(".docx")), 15000);
  ok(pdf, "saved: PDF and Word in the invoice folder", fs.readdirSync(F));
  const recs = await until(() => Object.entries(db()).some(([k, v]) => k.startsWith("invoices/") && v.client && v.client.name === "Bakkerij De Vries"));
  const rec = Object.entries(db()).find(([k, v]) => k.startsWith("invoices/") && v.client && v.client.name === "Bakkerij De Vries");
  ok(recs && rec && rec[1].po === "" && rec[1].lines.length === 2 && rec[1].totaal === 935 && rec[1].client.street === "Dorpsstraat 1", "logged with the other client, no PO, both lines", rec && rec[1]);
  ok(db()["settings/main"].client.name !== "Bakkerij De Vries", "the main client is left alone", db()["settings/main"].client);
  for (const f of fs.readdirSync(F).filter((n) => n.endsWith(".pdf"))) await saved(path.join(F, f));
  ok(!errs.length, "no page errors", errs);
  await app.close();
  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack || e)); process.exit(1); });
