const { _electron: electron } = require("playwright"); const fs = require("fs"), path = require("path");
const { goTab, setLang, seedProfile } = require("./test_helpers");
let fails = 0; const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m, { got: a, want: b });
const dataHome = "/tmp/el-appdata-pin", D = path.join(dataHome, "Valkyrys app"), PINF = path.join(D, "pin.json");
const launch = async (waitApp = false) => {
  const app = await electron.launch({ executablePath: process.argv[2], args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: { ...process.env, APPDATA: dataHome, XDG_CONFIG_HOME: dataHome } });
  await app.firstWindow(); let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  await page.waitForLoadState("domcontentloaded"); await page.waitForTimeout(700); return { app, page };
};
const locked = (page) => page.$("#lockScreen").then((e) => !!e);
const type = async (page, sel, s) => { for (const d of s) await page.click(`#lockScreen [data-d="${d}"]`); };
const dbStatus = (page) => page.evaluate(() => fetch("/api/db", { cache: "no-store" }).then((r) => r.status));
const pinFile = () => { try { return JSON.parse(fs.readFileSync(PINF, "utf8")); } catch (e) { return null; } };
const unlockWith = async (page, pin) => { await page.fill("#lkPin1", pin); await page.press("#lkPin1", "Enter"); };
(async () => {
  fs.rmSync(dataHome, { recursive: true, force: true }); fs.mkdirSync(D, { recursive: true });
  fs.writeFileSync(path.join(D, "config.json"), JSON.stringify({ folder: "/tmp/np-inv" }));
  fs.writeFileSync(path.join(D, "data.json"), JSON.stringify({ "settings/main": { ...require("../electron-app/server.js").DEFAULT_SETTINGS, template: "valkyrys" } })); // the design is chosen already: only the PIN is asked
  let { app, page } = await launch(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));

  // ---- first start: make a PIN
  ok(await locked(page), "first start shows the PIN screen"); ok(!!(await page.$("#lkPin2")), "it asks for the PIN twice");
  eq(await page.textContent("#lkTitle"), "Maak een pincode", "setup title (Dutch)");
  ok(await page.evaluate(() => document.body.inert), "the app behind it cannot be reached (inert)");
  ok(await page.isVisible("#lockScreen .band img"), "logo band on the screen");
  await page.fill("#lkPin1", "12"); await page.fill("#lkPin2", "12"); await page.press("#lkPin2", "Enter"); await page.waitForTimeout(200);
  eq(await page.textContent("#lkErr"), "Gebruik 4 tot 8 cijfers.", "too short is refused");
  await page.fill("#lkPin1", "12ab34"); eq(await page.inputValue("#lkPin1"), "1234", "letters are ignored");
  await page.fill("#lkPin2", "1235"); await page.press("#lkPin2", "Enter"); await page.waitForTimeout(200);
  eq(await page.textContent("#lkErr"), "De twee pincodes zijn niet hetzelfde.", "mismatch is refused");
  ok(await locked(page) && pinFile() === null, "nothing saved yet");
  await page.fill("#lkPin1", ""); await type(page, "#lkPin1", "1234"); eq(await page.inputValue("#lkPin1"), "1234", "on-screen keypad types digits");
  await page.click('#lockScreen [data-act="go"]'); await page.waitForTimeout(100); ok(await page.evaluate(() => document.activeElement.id === "lkPin2"), "check mark moves to the second field");
  await page.fill("#lkPin2", ""); await type(page, "#lkPin2", "1234"); await page.click('#lockScreen [data-act="del"]'); await type(page, "#lkPin2", "4");
  await page.click('#lockScreen [data-act="go"]'); await page.waitForSelector("#statsView", { state: "visible" }); await page.waitForTimeout(800);
  ok(!(await locked(page)) && !(await page.evaluate(() => document.body.inert)), "app opens after the PIN is set");
  const pf = pinFile(); ok(pf && pf.hash && pf.salt && !JSON.stringify(pf).includes("1234"), "pin.json holds a salted hash, not the PIN", pf && Object.keys(pf));
  ok(await page.isVisible("#statsView") && !(await page.isVisible("#pinPanel")), "the app opens on Statistics, the PIN is in Settings"); await goTab(page, "settings"); ok(await page.isVisible("#pinPanel") && (await page.textContent("#pinNote")).startsWith("Pincode staat aan"), "settings panel says a PIN is on");
  await page.waitForFunction(() => document.querySelector("#folderInfo").textContent.includes("Facturen in de map"), null, { timeout: 15000 }); ok(true, "invoice folder works after unlocking");

  // ---- every start: log in
  await app.close(); ({ app, page } = await launch()); page.on("pageerror", (e) => errs.push(e.message));
  ok(await locked(page) && !(await page.$("#lkPin2")), "next start asks for the PIN (one field)"); eq(await page.textContent("#lkTitle"), "Voer je pincode in", "login title");
  eq(await dbStatus(page), 401, "saved data is not served while locked");
  ok(await page.evaluate(() => !document.querySelector("#folderInfo") || document.querySelector("#folderInfo").textContent === ""), "nothing from the folder is shown while locked");
  await unlockWith(page, "0000"); await page.waitForTimeout(400);
  eq(await page.textContent("#lkErr"), "Onjuiste pincode. Nog 4 pogingen voordat je even moet wachten.", "wrong PIN: tries left"); eq(await page.inputValue("#lkPin1"), "", "field is cleared");
  ok(await locked(page), "still locked");
  await page.click("#lkForgotBtn"); ok((await page.textContent("#lkForgot")).includes("pin.json"), "'forgot' explains how to reset");
  await type(page, "#lkPin1", "1234"); await page.click('#lockScreen [data-act="go"]'); await page.waitForSelector("#statsView", { state: "visible" }); await page.waitForTimeout(800);
  eq(await dbStatus(page), 200, "saved data is served after unlocking"); eq(await page.textContent("#nextNr"), "62-2026", "the app loaded its numbering after unlocking");
  ok((await page.textContent("#folderInfo")).includes("Facturen in de map"), "folder listing loads after unlocking");
  ok(pinFile().fails === 0, "a good PIN resets the wrong-try counter");

  // ---- too many wrong tries
  await app.close(); ({ app, page } = await launch());
  for (let i = 0; i < 5; i++) { await unlockWith(page, "9999"); await page.waitForTimeout(350); }
  ok((await page.textContent("#lkErr")).startsWith("Te veel pogingen. Probeer het over"), "5th wrong PIN starts a wait: " + (await page.textContent("#lkErr")));
  ok(await page.isDisabled("#lkPin1") && await page.isDisabled("#lkOk"), "fields are disabled during the wait");
  await app.close(); ({ app, page } = await launch());
  ok((await page.textContent("#lkErr")).startsWith("Te veel pogingen") && await page.isDisabled("#lkPin1"), "closing and reopening the app does not skip the wait");
  const pf2 = pinFile(); pf2.until = 0; pf2.fails = 0; fs.writeFileSync(PINF, JSON.stringify(pf2));
  await app.close(); ({ app, page } = await launch()); ok(!(await page.isDisabled("#lkPin1")), "after the wait the field works again");
  await unlockWith(page, "1234"); await page.waitForSelector("#statsView", { state: "visible" }); await page.waitForTimeout(600);

  // ---- change and turn off
  await goTab(page, "settings"); await page.click("#pinSetBtn"); ok(await page.$eval("#pinDlg", (d) => d.open) && !(await page.isVisible("#pinCurWrap")) === false, "change dialog opens with the current-PIN field");
  await page.fill("#pinCur", "0000"); await page.fill("#pinNew", "4321"); await page.fill("#pinRep", "4321"); await page.click("#pinSave"); await page.waitForTimeout(400);
  eq(await page.textContent("#pinErr"), "De huidige pincode klopt niet.", "wrong current PIN is refused");
  await page.fill("#pinCur", "1234"); await page.fill("#pinRep", "1111"); await page.click("#pinSave"); await page.waitForTimeout(200);
  eq(await page.textContent("#pinErr"), "De twee nieuwe pincodes zijn niet hetzelfde.", "new PINs must match");
  await page.fill("#pinRep", "4321"); await page.click("#pinSave"); await page.waitForTimeout(500);
  ok(!(await page.$eval("#pinDlg", (d) => d.open)) && (await page.textContent("#toast")).includes("Pincode gewijzigd"), "PIN changed");
  await app.close(); ({ app, page } = await launch());
  await unlockWith(page, "1234"); await page.waitForTimeout(400); ok(await locked(page), "old PIN no longer works");
  await unlockWith(page, "4321"); await page.waitForSelector("#statsView", { state: "visible" }); await page.waitForTimeout(600); ok(!(await locked(page)), "new PIN works");
  await goTab(page, "settings"); await page.click("#pinOffBtn"); ok(!(await page.isVisible("#pinNewWrap")), "turn-off dialog only asks for the current PIN");
  await page.fill("#pinCur", "4321"); await page.click("#pinSave"); await page.waitForTimeout(500);
  ok((await page.textContent("#toast")).includes("Pincode uitgeschakeld") && (await page.textContent("#pinNote")).startsWith("Geen pincode"), "PIN turned off");
  await app.close(); ({ app, page } = await launch()); ok(!(await locked(page)), "next start: no lock screen, and no new setup prompt after turning it off"); await page.waitForSelector("#pick", { state: "attached" });

  // ---- skip at first start, set later
  await app.close(); fs.rmSync(PINF); ({ app, page } = await launch()); ok(await locked(page), "setup prompt again (pin.json removed)");
  await page.click("#lkLater"); await page.waitForSelector("#statsView", { state: "visible" }); ok(!(await locked(page)), "'Nu niet' opens the app");
  await app.close(); ({ app, page } = await launch()); ok(!(await locked(page)), "and it does not ask again"); await page.waitForSelector("#pick", { state: "attached" }); await goTab(page, "inv"); await page.waitForTimeout(500);
  await goTab(page, "settings"); await page.click("#pinSetBtn"); ok(!(await page.isVisible("#pinCurWrap")), "set dialog has no current-PIN field");
  await page.fill("#pinNew", "2468"); await page.fill("#pinRep", "2468"); await page.click("#pinSave"); await page.waitForTimeout(500);
  ok((await page.textContent("#toast")).includes("Pincode ingesteld"), "PIN set later from settings");

  // ---- theme and language on the lock screen
  await page.evaluate(() => { localStorage.setItem("valkyrys-theme", JSON.stringify({ id: "midnight", custom: null })); localStorage.setItem("valkyrys-lang", "en"); }); await page.waitForTimeout(1800);
  await app.close(); ({ app, page } = await launch());
  eq(await page.evaluate(() => getComputedStyle(document.getElementById("lockScreen")).backgroundColor), "rgb(10, 15, 30)", "lock screen follows the theme");
  eq(await page.textContent("#lkTitle"), "Enter your PIN", "lock screen follows the language");
  await page.screenshot({ path: "/tmp/pin-lock.png" });
  await unlockWith(page, "2468"); await page.waitForSelector("#statsView", { state: "visible" }); await page.waitForTimeout(500); ok(!(await locked(page)), "unlocks");
  console.log("errors:", errs); ok(!errs.length, "no page errors");
  await app.close(); console.log(fails ? "FAILED: " + fails : "ALL PASSED"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL " + e.message); process.exit(1); });
