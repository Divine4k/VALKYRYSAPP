// Shared by the Electron tests. The few things every test does are here, so when the layout of the app changes it is fixed in this one place.
const fs = require("fs"), path = require("path");

const APP_DIR = "Valkyrys app"; // the data folder of the app inside the (fake) AppData folder of a test

const TABS = { stats: "#tabStats", inv: "#tabInv", docs: "#tabDocs", settings: "#tabSettings" };
/** open a tab of the app: "stats" (statistics), "inv" (invoices), "docs" (documents) or "settings" */
const goTab = (page, name) => page.click(TABS[name]);

/** switch the interface language ("nl", "en", "pl") whichever tab is open (the list itself lives in Settings) */
const setLang = (page, lang) => page.evaluate((v) => { const s = document.querySelector("#lang"); s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })); }, lang);

/** a profile that is set up: no PIN question, the first-start folder question already answered, and an invoice design chosen (the Valkyrys one unless opts.template says otherwise).
 *  `config` adds to config.json (folder, poFolder). opts.fresh (or opts.template === null) writes no data.json at all: a new install, which has no
 *  invoice designs until one is added (the first-start picker shows an empty list); its language counts as chosen, so the first-start language step is skipped. Returns the data folder. */
function seedProfile(home, config = {}, opts = {}) {
  const dir = path.join(home, APP_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "pin.json"), '{"v":1,"skipped":true}');
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ welcomed: true, ...config }));
  const data = path.join(dir, "data.json");
  const { DEFAULT_SETTINGS } = require("../electron-app/server.js");
  if (opts.template !== null && !opts.fresh && !fs.existsSync(data)) {
    fs.writeFileSync(data, JSON.stringify({ "settings/main": { ...DEFAULT_SETTINGS, template: opts.template === undefined ? "valkyrys" : opts.template } }));
  } else if (!fs.existsSync(data)) { // what electron-app/server.js makes for a new install, with the language already chosen (no first-start language step)
    fs.writeFileSync(data, JSON.stringify({ "settings/main": { ...DEFAULT_SETTINGS, builtins: false }, "settings/prefs": { lang: "nl", langChosen: true } }));
  }
  return dir;
}

/** first start: pick a design card in the picker and press Next (the details step, if any, is up to the test) */
async function chooseDesign(page, id) {
  const card = `#tplGrid [data-tpl="${id}"]`;
  await page.waitForSelector(card, { state: "visible" });
  await page.click(card);
  await page.click("#tplNext");
}

module.exports = { APP_DIR, goTab, setLang, seedProfile, chooseDesign };
