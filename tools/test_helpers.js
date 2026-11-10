// Shared by the Electron tests. The few things every test does are here, so when the layout of the app changes it is fixed in this one place.
const fs = require("fs"), path = require("path");

const APP_DIR = "Valkyrys app"; // the data folder of the app inside the (fake) AppData folder of a test

const TABS = { stats: "#tabStats", inv: "#tabInv", settings: "#tabSettings" };
/** open a tab of the app: "stats" (statistics), "inv" (invoices) or "settings" */
const goTab = (page, name) => page.click(TABS[name]);

/** switch the interface language ("nl", "en", "pl") whichever tab is open (the list itself lives in Settings) */
const setLang = (page, lang) => page.evaluate((v) => { const s = document.querySelector("#lang"); s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })); }, lang);

/** a profile that is set up: no PIN question, and the first-start folder question already answered. `config` adds to config.json (folder, poFolder). Returns the data folder. */
function seedProfile(home, config = {}) {
  const dir = path.join(home, APP_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "pin.json"), '{"v":1,"skipped":true}');
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ welcomed: true, ...config }));
  return dir;
}

module.exports = { APP_DIR, goTab, setLang, seedProfile };
