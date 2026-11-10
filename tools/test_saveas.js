// "Save as…" on the batch bar: any folder (separate files) or one .zip with only the ticked contents; records the invoices once.
const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
const JSZip = require("/opt/npm-tools/node_modules/jszip");
const { goTab, seedProfile, APP_DIR } = require("./test_helpers");
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
(async () => {
  const dataHome = "/tmp/el-appdata-saveas"; fs.rmSync(dataHome, { recursive: true, force: true });
  const F = "/tmp/saveas-inv", D = "/tmp/saveas-anydir", Z = "/tmp/saveas-zip/out.zip", P = "/tmp/saveas-po";
  for (const d of [F, D, path.dirname(Z), P]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }
  fs.copyFileSync(process.argv[3], P + "/PO-008148.pdf"); fs.copyFileSync(process.argv[3], P + "/PO-copy.pdf");
  seedProfile(dataHome, { folder: F });
  const dataFile = path.join(dataHome, APP_DIR, "data.json");
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: dataHome, XDG_CONFIG_HOME: dataHome } });
  // stub the native dialogs: the folder picker answers D, the Save-As dialog answers Z (or "cancelled" when __cancel is set)
  await app.evaluate(({ dialog }, [D, Z]) => {
    globalThis.__asked = [];
    dialog.showOpenDialog = async (w, o) => { globalThis.__asked.push(["open", (o || w || {}).title]); return { canceled: false, filePaths: [D] }; };
    dialog.showSaveDialog = async (w, o) => { const opts = o || w || {}; globalThis.__asked.push(["save", opts.defaultPath]); return globalThis.__cancel ? { canceled: true } : { canceled: false, filePath: Z }; };
  }, [D, Z]);
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.waitForSelector("#pick", { state: "attached" }); await goTab(page, "inv"); await page.waitForTimeout(600);
  await page.setInputFiles("#file", [P + "/PO-008148.pdf", P + "/PO-copy.pdf"]); await page.waitForFunction(() => document.querySelectorAll("article.po h3").length === 2);
  ok(await page.isVisible("#batch"), "batch bar shows with two POs");
  ok((await page.textContent("#zipAll")) === "Alles opslaan in de map", "folder button kept");
  ok((await page.textContent("#saveAs")) === "Opslaan als…", "Save as… button next to it");
  const nrs = await page.$$eval('[data-k="nr"]', (i) => i.map((x) => x.value)); console.log("numbers:", nrs);

  // the dialog: defaults, nothing ticked = no Save
  await page.click("#saveAs"); await page.waitForSelector("#saveDlg[open]");
  const st = () => page.evaluate(() => { const $ = (id) => document.getElementById(id); return { po: $("saveInPo").checked, poOff: $("saveInPo").disabled, pdf: $("saveInPdf").checked, docx: $("saveInDocx").checked, go: !$("saveGo").disabled, dirShown: !$("saveModeDirWrap").hidden }; });
  let s = await st(); ok(s.po && !s.poOff && s.pdf && s.docx && s.go && s.dirShown, "defaults: POs, PDF and Word ticked, folder option shown " + JSON.stringify(s));
  await page.uncheck("#saveInPo"); await page.uncheck("#saveInPdf"); await page.uncheck("#saveInDocx");
  ok(!(await st()).go, "Save disabled when nothing is ticked");

  // cancel the Save-As dialog: nothing written, nothing recorded
  await app.evaluate(() => { globalThis.__cancel = true; });
  await page.check("#saveInPdf"); await page.check("#saveModeZip"); await page.click("#saveGo"); await page.waitForTimeout(800);
  ok(!fs.existsSync(Z), "cancelled: no zip");
  ok(!(await page.evaluate(() => document.querySelector("article.po .done") !== null)), "cancelled: invoices not marked as made");
  await app.evaluate(() => { globalThis.__cancel = false; });

  // one .zip: POs + PDF, no Word
  if (!(await page.isVisible("#saveDlg"))) { await page.click("#saveAs"); await page.waitForSelector("#saveDlg[open]"); }
  await page.check("#saveModeZip"); await page.check("#saveInPo"); await page.check("#saveInPdf"); await page.uncheck("#saveInDocx");
  await page.click("#saveGo");
  await page.waitForFunction(() => /Opgeslagen als/.test(document.querySelector("#toast").textContent), null, { timeout: 60000 });
  console.log("toast:", await page.textContent("#toast"));
  const asked = await app.evaluate(() => globalThis.__asked); console.log("asked:", JSON.stringify(asked));
  const lastSave = asked.filter((a) => a[0] === "save").pop();
  ok(lastSave && /facturen-\d+-\d+-\d{4}\.zip$/.test(lastSave[1]), "default zip name like facturen-62-63-2026.zip: " + (lastSave && lastSave[1]));
  ok(fs.existsSync(Z), "zip written where the Save-As dialog said");
  const names = Object.keys((await JSZip.loadAsync(fs.readFileSync(Z))).files).sort(); console.log("zip:", names);
  ok(names.includes("PO-008148.pdf") && names.includes("PO-copy.pdf"), "both POs in the zip under their own file names");
  ok(nrs.every((n) => names.some((x) => x.includes(n) && x.endsWith(".pdf"))), "an invoice PDF per card");
  ok(!names.some((x) => x.endsWith(".docx")), "no Word files (not ticked)");
  ok(names.length === 4, "exactly 4 files: " + names.length);
  ok(!fs.readdirSync(path.dirname(Z)).some((n) => n.endsWith(".part")), "no temp file left");
  await page.waitForTimeout(800);
  ok((await page.$$eval("article.po .done", (d) => d.length)) === 2, "both invoices marked as made");
  await goTab(page, "docs"); await page.waitForTimeout(300);
  const histNrs = await page.$$eval("#docsList li", (l) => l.map((x) => x.dataset.nr)); await goTab(page, "inv");
  ok(nrs.every((n) => histNrs.includes(n)), "both listed in Documents");
  ok(!(await page.$("#hist")), "no 'Gemaakte facturen' list on the Invoices tab");
  const db1 = JSON.parse(fs.readFileSync(dataFile, "utf8")); const made1 = nrs.map((n) => db1["invoices/" + n] && db1["invoices/" + n].createdAt);
  ok(made1.every(Boolean), "saved in data.json");

  // separate files into any folder: Word only; the invoices are not recorded a second time
  await page.click("#saveAs"); await page.waitForSelector("#saveDlg[open]");
  await page.check("#saveModeDir"); await page.uncheck("#saveInPo"); await page.uncheck("#saveInPdf"); await page.check("#saveInDocx");
  await page.click("#saveGo");
  await page.waitForFunction(() => /bestanden opgeslagen in/.test(document.querySelector("#toast").textContent), null, { timeout: 60000 });
  const dirFiles = fs.readdirSync(D).sort(); console.log("dir:", dirFiles);
  ok(dirFiles.length === 2 && dirFiles.every((n) => n.endsWith(".docx")), "two Word files in the chosen folder, nothing else");
  ok(fs.readdirSync(F).length === 0, "the invoice folder was not touched");
  await page.waitForTimeout(500);
  const db2 = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  ok(nrs.every((n, i) => db2["invoices/" + n] && db2["invoices/" + n].createdAt === made1[i]), "not recorded twice");
  ok(Object.keys(db2).filter((k) => k.startsWith("invoices/")).length === 2, "still two invoices");

  // the bridge only writes where the user picked, and only plain file names
  const sec = await page.evaluate(async ([D]) => {
    const b = new Uint8Array([1, 2, 3]);
    return { otherDir: (await window.valkyrys.saveToDir("/tmp", "x.pdf", b)).error, traversal: (await window.valkyrys.saveToDir(D, "../x.pdf", b)).error,
      badExt: (await window.valkyrys.saveToDir(D, "x.exe", b)).error, otherZip: (await window.valkyrys.writePicked("/tmp/other.zip", b)).error,
      reused: (await window.valkyrys.writePicked("/tmp/saveas-zip/out.zip", b)).error };
  }, [D]);
  console.log("security:", sec);
  ok(sec.otherDir === "dir" && sec.traversal === "name" && sec.badExt === "name" && sec.otherZip === "path" && sec.reused === "path", "unpicked folders, bad names and unpicked zip paths are refused");
  ok(!fs.existsSync("/tmp/x.pdf") && !fs.existsSync("/tmp/other.zip"), "nothing written outside");

  // English labels
  await page.evaluate(() => { const s = document.querySelector("#lang"); s.value = "en"; s.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.waitForTimeout(300);
  ok((await page.textContent("#saveAs")) === "Save as…", "English label");
  console.log("errors:", errs); ok(!errs.length, "no page errors");
  await app.close();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
