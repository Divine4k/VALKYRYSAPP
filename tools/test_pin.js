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
const pad = async (page, s) => { for (const d of s) await page.click(`#lockScreen [data-d="${d}"]`); }; // on-screen keypad
const keys = (page, s) => page.keyboard.type(s); // physical keyboard, no Enter
const dots = (page) => page.$$eval("#lkDots i", (a) => ({ n: a.length, on: a.filter((i) => i.classList.contains("on")).length, opt: a.filter((i) => i.classList.contains("opt")).length }));
const goShown = (page) => page.$eval('#lockScreen [data-act="go"]', (b) => getComputedStyle(b).visibility === "visible");
const err = (page) => page.textContent("#lkErr");
const opened = async (page) => { await page.waitForSelector("#statsView", { state: "visible" }); await page.waitForTimeout(600); return !(await locked(page)); };
const dbStatus = (page) => page.evaluate(() => fetch("/api/db", { cache: "no-store" }).then((r) => r.status));
const pinFile = () => { try { return JSON.parse(fs.readFileSync(PINF, "utf8")); } catch (e) { return null; } };
(async () => {
  fs.rmSync(dataHome, { recursive: true, force: true }); fs.mkdirSync(D, { recursive: true });
  fs.writeFileSync(path.join(D, "config.json"), JSON.stringify({ folder: "/tmp/np-inv" }));
  fs.writeFileSync(path.join(D, "data.json"), JSON.stringify({ "settings/main": { ...require("../electron-app/server.js").DEFAULT_SETTINGS, template: "valkyrys" } })); // the design is chosen already: only the PIN is asked
  let { app, page } = await launch(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));

  // ---- first start: choose a PIN in two steps
  ok(await locked(page), "first start shows the PIN screen");
  eq(await page.textContent("#lkTitle"), "Kies een pincode", "setup step 1 title (Dutch)");
  ok(await page.evaluate(() => document.body.inert), "the app behind it cannot be reached (inert)");
  ok(await page.isVisible("#lockScreen .band img"), "logo on the card");
  ok(await page.evaluate(() => [...document.querySelectorAll("#lockScreen input")].every((i) => getComputedStyle(i).opacity === "0")), "no visible input boxes");
  ok(await page.evaluate(() => document.activeElement.id === "lkIn"), "keyboard focus is ready at once");
  eq(await dots(page), { n: 8, on: 0, opt: 4 }, "step 1: dots for 4 to 8 digits");
  ok(await goShown(page) && await page.isDisabled('#lockScreen [data-act="go"]'), "check key shown, off below 4 digits");
  await keys(page, "12"); await page.keyboard.press("Enter"); await page.waitForTimeout(200);
  eq(await err(page), "Gebruik 4 tot 8 cijfers.", "too short is refused"); eq((await dots(page)).on, 0, "dots cleared");
  await keys(page, "12ab34"); eq(await page.inputValue("#lkIn"), "1234", "letters are ignored"); eq((await dots(page)).on, 4, "dots fill while typing"); eq(await err(page), "", "error goes away on typing");
  await page.keyboard.press("Enter"); await page.waitForTimeout(150);
  eq(await page.textContent("#lkTitle"), "Herhaal je pincode", "Enter goes to step 2"); eq(await dots(page), { n: 4, on: 0, opt: 0 }, "step 2: as many dots as the chosen PIN");
  ok(!(await goShown(page)), "no check key in step 2");
  await keys(page, "1235"); await page.waitForTimeout(400);
  eq(await page.textContent("#lkTitle"), "Kies een pincode", "mismatch goes back to step 1"); eq(await err(page), "De twee pincodes zijn niet hetzelfde.", "mismatch message");
  ok(await locked(page) && pinFile() === null, "nothing saved yet");
  await pad(page, "123"); eq((await dots(page)).on, 3, "on-screen keypad types digits");
  await page.screenshot({ path: "/tmp/pin_setup.png" });
  await pad(page, "4"); await page.click('#lockScreen [data-act="go"]'); await page.waitForTimeout(150); eq(await page.textContent("#lkTitle"), "Herhaal je pincode", "check key goes to step 2");
  await page.click('#lockScreen [data-act="del"]'); eq(await page.textContent("#lkTitle"), "Kies een pincode", "backspace on an empty step 2 goes back"); await pad(page, "1234"); await page.keyboard.press("Enter"); await page.waitForTimeout(150);
  await pad(page, "123"); await page.click('#lockScreen [data-act="del"]'); eq((await dots(page)).on, 2, "backspace key removes a digit"); await pad(page, "34");
  ok(await opened(page) && !(await page.evaluate(() => document.body.inert)), "app opens as soon as the repeat matches (no Enter)");
  const pf = pinFile(); ok(pf && pf.hash && pf.salt && !JSON.stringify(pf).includes("1234"), "pin.json holds a salted hash, not the PIN", pf && Object.keys(pf)); eq(pf.len, 4, "pin.json keeps the length");
  ok(await page.isVisible("#statsView") && !(await page.isVisible("#pinPanel")), "the app opens on Statistics, the PIN is in Settings"); await goTab(page, "settings"); ok(await page.isVisible("#pinPanel") && (await page.textContent("#pinNote")).startsWith("Pincode staat aan"), "settings panel says a PIN is on");
  await goTab(page, "docs"); await page.waitForFunction(() => document.querySelector("#docsInfo").textContent.includes("Facturen in de map"), null, { timeout: 15000 }); ok(true, "invoice folder works after unlocking");

  // ---- every start: log in, instantly on the last digit
  await app.close(); ({ app, page } = await launch()); page.on("pageerror", (e) => errs.push(e.message));
  ok(await locked(page), "next start asks for the PIN"); eq(await page.textContent("#lkTitle"), "Voer je pincode in", "login title");
  eq(await dots(page), { n: 4, on: 0, opt: 0 }, "one dot per digit of the PIN"); ok(!(await goShown(page)), "no check key: it logs in by itself");
  await page.screenshot({ path: "/tmp/pin_login.png" });
  eq(await dbStatus(page), 401, "saved data is not served while locked");
  ok(await page.evaluate(() => !document.querySelector("#docsList li") && !document.querySelector("#docsInfo").textContent), "nothing from the folder is shown while locked");
  await keys(page, "0000"); await page.waitForTimeout(500);
  eq(await err(page), "Onjuiste pincode.", "wrong PIN: short message"); eq((await dots(page)).on, 0, "dots are cleared");
  ok(await page.$eval("#lkDots", (e) => e.classList.contains("lk-shake") && e.classList.contains("bad")), "dots shake");
  ok(await locked(page), "still locked"); eq(pinFile().fails, 1, "the wrong try is counted");
  await page.click("#lkForgotBtn"); ok((await page.textContent("#lkForgot")).includes("pin.json"), "'forgot' explains how to reset");
  for (const k of ["Numpad1", "Numpad2", "Numpad3"]) await page.keyboard.press(k); eq((await dots(page)).on, 3, "numpad types too (focus kept after clicking elsewhere)");
  await page.keyboard.press("Backspace"); eq((await dots(page)).on, 2, "Backspace removes a digit"); await keys(page, "3");
  const t0 = Date.now(); await keys(page, "4");
  ok(await opened(page), "unlocks on the last digit, no Enter"); console.log("  unlock took ~" + (Date.now() - t0 - 600) + " ms");
  eq(await dbStatus(page), 200, "saved data is served after unlocking"); eq(await page.textContent("#nextNr"), "62-2026", "the app loaded its numbering after unlocking");
  await goTab(page, "docs"); await page.waitForFunction(() => document.querySelector("#docsInfo").textContent.includes("Facturen in de map"), null, { timeout: 15000 }).catch(() => {});
  ok((await page.textContent("#docsInfo")).includes("Facturen in de map"), "folder listing loads after unlocking");
  ok(pinFile().fails === 0, "a good PIN resets the wrong-try counter");

  // ---- too many wrong tries
  await app.close(); ({ app, page } = await launch());
  const msgs = []; for (let i = 0; i < 5; i++) { await keys(page, "9999"); await page.waitForTimeout(450); msgs.push(await err(page)); }
  eq(msgs.slice(0, 4), ["Onjuiste pincode.", "Onjuiste pincode.", "Onjuiste pincode. Nog 2 pogingen voordat je even moet wachten.", "Onjuiste pincode. Nog 1 poging voordat je even moet wachten."], "warning only near the limit");
  ok(msgs[4].startsWith("Te veel pogingen. Probeer het over"), "5th wrong PIN starts a wait: " + msgs[4]);
  ok(await page.isDisabled("#lkIn") && await page.isDisabled('#lockScreen [data-d="1"]'), "typing and keypad are off during the wait");
  await keys(page, "1234"); await page.waitForTimeout(300); ok(await locked(page) && (await dots(page)).on === 0, "typing does nothing during the wait");
  await app.close(); ({ app, page } = await launch());
  ok((await err(page)).startsWith("Te veel pogingen") && await page.isDisabled("#lkIn"), "closing and reopening the app does not skip the wait");
  const pf2 = pinFile(); pf2.until = 0; pf2.fails = 0; fs.writeFileSync(PINF, JSON.stringify(pf2));
  await app.close(); ({ app, page } = await launch()); ok(!(await page.isDisabled("#lkIn")), "after the wait it works again");
  await pad(page, "1234"); ok(await opened(page), "keypad clicks unlock on the last digit");

  // ---- change and turn off
  await goTab(page, "settings"); await page.click("#pinSetBtn"); ok(await page.$eval("#pinDlg", (d) => d.open) && !(await page.isVisible("#pinCurWrap")) === false, "change dialog opens with the current-PIN field");
  await page.fill("#pinCur", "0000"); await page.fill("#pinNew", "54321"); await page.fill("#pinRep", "54321"); await page.click("#pinSave"); await page.waitForTimeout(400);
  eq(await page.textContent("#pinErr"), "De huidige pincode klopt niet.", "wrong current PIN is refused");
  await page.fill("#pinCur", "1234"); await page.fill("#pinRep", "1111"); await page.click("#pinSave"); await page.waitForTimeout(200);
  eq(await page.textContent("#pinErr"), "De twee nieuwe pincodes zijn niet hetzelfde.", "new PINs must match");
  await page.fill("#pinRep", "54321"); await page.click("#pinSave"); await page.waitForTimeout(500);
  ok(!(await page.$eval("#pinDlg", (d) => d.open)) && (await page.textContent("#toast")).includes("Pincode gewijzigd"), "PIN changed"); eq(pinFile().len, 5, "changing the PIN saves the new length");
  await app.close(); ({ app, page } = await launch());
  eq((await dots(page)).n, 5, "five dots for the new PIN"); await keys(page, "1234"); await page.waitForTimeout(400); ok(await locked(page) && (await dots(page)).on === 4, "4 of 5 digits: not checked yet");
  await keys(page, "5"); await page.waitForTimeout(500); ok(await locked(page) && (await err(page)) === "Onjuiste pincode.", "old PIN no longer works");
  await keys(page, "54321"); ok(await opened(page), "new PIN works");
  await goTab(page, "settings"); await page.click("#pinOffBtn"); ok(!(await page.isVisible("#pinNewWrap")), "turn-off dialog only asks for the current PIN");
  await page.fill("#pinCur", "54321"); await page.click("#pinSave"); await page.waitForTimeout(500);
  ok((await page.textContent("#toast")).includes("Pincode uitgeschakeld") && (await page.textContent("#pinNote")).startsWith("Geen pincode"), "PIN turned off");
  await app.close(); ({ app, page } = await launch()); ok(!(await locked(page)), "next start: no lock screen, and no new setup prompt after turning it off"); await page.waitForSelector("#pick", { state: "attached" });

  // ---- skip at first start, set later
  await app.close(); fs.rmSync(PINF); ({ app, page } = await launch()); ok(await locked(page), "setup prompt again (pin.json removed)");
  await page.click("#lkLater"); await page.waitForSelector("#statsView", { state: "visible" }); ok(!(await locked(page)), "'Nu niet' opens the app");
  await app.close(); ({ app, page } = await launch()); ok(!(await locked(page)), "and it does not ask again"); await page.waitForSelector("#pick", { state: "attached" }); await goTab(page, "inv"); await page.waitForTimeout(500);
  await goTab(page, "settings"); await page.click("#pinSetBtn"); ok(!(await page.isVisible("#pinCurWrap")), "set dialog has no current-PIN field");
  await page.fill("#pinNew", "2468"); await page.fill("#pinRep", "2468"); await page.click("#pinSave"); await page.waitForTimeout(500);
  ok((await page.textContent("#toast")).includes("Pincode ingesteld"), "PIN set later from settings"); eq(pinFile().len, 4, "setting it from settings saves the length");

  // ---- pin.json from before the length was kept: dots up to 8 and a check key; the length is learnt at the first login
  await app.close(); const old = pinFile(); delete old.len; fs.writeFileSync(PINF, JSON.stringify(old)); ({ app, page } = await launch());
  eq(await dots(page), { n: 8, on: 0, opt: 4 }, "old pin.json: dots for up to 8 digits"); ok(await goShown(page), "old pin.json: check key shown");
  await keys(page, "2468"); await page.waitForTimeout(500); ok(await locked(page), "old pin.json: no auto login");
  await page.click('#lockScreen [data-act="go"]'); ok(await opened(page), "old pin.json: check key unlocks"); eq(pinFile().len, 4, "length saved after that login");

  // ---- theme and language on the lock screen
  await page.evaluate(() => { localStorage.setItem("valkyrys-theme", JSON.stringify({ id: "midnight", custom: null })); localStorage.setItem("valkyrys-lang", "en"); }); await page.waitForTimeout(1800);
  await app.close(); ({ app, page } = await launch());
  eq(await page.evaluate(() => getComputedStyle(document.getElementById("lockScreen")).backgroundColor), "rgb(10, 15, 30)", "lock screen follows the theme");
  eq(await page.textContent("#lkTitle"), "Enter your PIN", "lock screen follows the language");
  await page.screenshot({ path: "/tmp/pin_login_midnight.png" });
  await keys(page, "2468"); ok(await opened(page), "unlocks");
  console.log("errors:", errs); ok(!errs.length, "no page errors");
  await app.close(); console.log(fails ? "FAILED: " + fails : "ALL PASSED"); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL " + e.message); process.exit(1); });
