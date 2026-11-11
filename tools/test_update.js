// In-app updates end to end (Linux Electron): manifest + zip served from 127.0.0.1 (VALKYRYS_UPDATE_URL), a fake 9.9.9 built from the current app,
// check / install / progress / restart, the loader starting 9.9.9, tampered zip and bad signature rejected, crash rollback, pruning of old versions.
//   node tools/test_update.js EXE
const { _electron: electron } = require("playwright");
const fs = require("fs"), path = require("path"), http = require("http"), crypto = require("crypto"), { execFileSync, spawnSync } = require("child_process");
const { seedProfile } = require("./test_helpers");
const SP = path.resolve(__dirname, ".."), EXE = process.argv[2];
const APPSRC = path.join(path.dirname(EXE), "resources", "app");
const home = "/tmp/el-upd", work = "/tmp/el-upd-srv";
const DATA = path.join(home, "Valkyrys app"), VERS = path.join(DATA, "versions");
const bundled = JSON.parse(fs.readFileSync(path.join(APPSRC, "package.json"), "utf8")).version;
let fails = 0;
const check = (ok, what, extra) => { console.log((ok ? "PASS " : "FAIL ") + what + (extra !== undefined ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; };
const brief = (s) => ({ ...s, latest: s.latest && s.latest.version });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (...p) => fs.existsSync(path.join(...p));

// a copy of the current app as version `ver` (app-main.js optionally replaced)
function fakeApp(dest, ver, mainCode) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(APPSRC, dest, { recursive: true });
  const pj = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8")); pj.version = ver;
  fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify(pj));
  if (mainCode) fs.writeFileSync(path.join(dest, "app-main.js"), mainCode);
  return dest;
}

(async () => {
  fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
  seedProfile(home);
  // old version folders: 1.0.0 is older than the installed app (always removed); 3.0.0 / 4.0.0 are incomplete (never started), removed once older than the running one
  for (const v of ["1.0.0", "3.0.0", "4.0.0"]) { fs.mkdirSync(path.join(VERS, v), { recursive: true }); fs.writeFileSync(path.join(VERS, v, "package.json"), JSON.stringify({ version: v })); }
  fs.mkdirSync(path.join(VERS, "5.0.0.tmp"), { recursive: true });

  // ---- server: /latest.json from the current mode, /zip/<name> (tampered mode flips one byte), sent in slices so there is progress
  let mode = "good";
  const server = http.createServer((req, res) => {
    if (req.url.split("?")[0] === "/latest.json") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(fs.readFileSync(path.join(work, mode === "badsig" ? "badsig" : "good", "latest.json"))); }
    const m = /^\/zip\/(valkyrys-app-[\d.]+\.zip)$/.exec(req.url);
    if (!m) { res.writeHead(404); return res.end(); }
    const buf = Buffer.from(fs.readFileSync(path.join(work, "good", m[1])));
    if (mode === "tampered") buf[Math.floor(buf.length / 2)] ^= 0xff;
    res.writeHead(200, { "Content-Type": "application/zip", "Content-Length": buf.length });
    let i = 0; const step = () => { if (i >= buf.length) return res.end(); res.write(buf.subarray(i, i + 65536)); i += 65536; setTimeout(step, 5); }; step();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port, base = `http://127.0.0.1:${port}`;

  // ---- the fake 9.9.9 update: signed with keys/ (good) and with a stranger's key (badsig)
  const src = fakeApp(path.join(work, "app999"), "9.9.9");
  const bu = (out, extra = []) => execFileSync("node", [path.join(SP, "tools", "build_update.mjs"), "--app", src, "--version", "9.9.9", "--out", out, "--url", `${base}/zip/valkyrys-app-9.9.9.zip`, ...extra], { stdio: "pipe" });
  bu(path.join(work, "good"));
  const other = path.join(work, "other.pem"); fs.writeFileSync(other, crypto.generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }));
  bu(path.join(work, "badsig"), ["--key", other]);
  const man = JSON.parse(fs.readFileSync(path.join(work, "good", "latest.json"), "utf8"));
  const U = require(path.join(SP, "electron-app", "updater.js"));
  check(U.verify(man) && !U.verify({ ...man, size: man.size + 1 }) && !U.verify(JSON.parse(fs.readFileSync(path.join(work, "badsig", "latest.json"), "utf8"))), "manifest signature verifies only unchanged and with our key");

  const env = (extra = {}) => ({ ...process.env, APPDATA: home, XDG_CONFIG_HOME: home, VALKYRYS_UPDATE_URL: `${base}/latest.json`, ...extra });
  async function launch(extra) {
    const app = await electron.launch({ executablePath: EXE, args: ["--no-sandbox", "--disable-gpu", "--no-splash"], env: env(extra) });
    await app.firstWindow(); let page;
    for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => !w.url().includes("splash")); if (!page) await sleep(200); }
    await page.waitForFunction(() => !!window.valkyrysUpdate, null, { timeout: 20000 });
    return { app, page };
  }
  const st = (page) => page.evaluate(() => window.valkyrysUpdate.state());

  // ---- 1: installed app, auto-check soon after start
  let { app, page } = await launch({ VALKYRYS_UPDATE_DELAY: "500" });
  let s = await st(page);
  check(s.running === bundled && s.bundled === bundled, "running = bundled at first", brief(s));
  check(!exists(VERS, "1.0.0") && !exists(VERS, "5.0.0.tmp") && exists(VERS, "3.0.0") && exists(VERS, "4.0.0"), "start prunes versions not newer than the installed app and left-over .tmp");
  for (let i = 0; i < 50 && s.status !== "available"; i++) { await sleep(200); s = await st(page); }
  check(s.status === "available" && s.latest && s.latest.version === "9.9.9" && s.latest.size === man.size, "auto-check finds 9.9.9", { status: s.status, latest: s.latest && s.latest.version });
  check(Array.isArray(s.latest && s.latest.notes) && s.latest.notes.length > 0 && ["type", "nl", "en", "pl"].every((k) => k in s.latest.notes[0]), "notes from the changelog");
  check(!!s.lastCheck && !!JSON.parse(fs.readFileSync(path.join(DATA, "update.json"), "utf8")).lastCheck, "lastCheck kept in update.json", s.lastCheck);
  check(await page.evaluate(() => typeof window.valkyrysUpdate.restart === "function" && typeof window.valkyrysUpdate.onState === "function"), "bridge has restart and onState");
  await page.evaluate(() => { window.__upd = []; window.__unsub = window.valkyrysUpdate.onState((x) => window.__upd.push(x)); });

  mode = "badsig"; s = await page.evaluate(() => window.valkyrysUpdate.check());
  check(s.status === "error" && s.error === "signature", "bad signature rejected", brief(s));
  mode = "tampered"; s = await page.evaluate(() => window.valkyrysUpdate.check());
  check(s.status === "available", "tampered: manifest itself is fine", s.status);
  s = await page.evaluate(() => window.valkyrysUpdate.install());
  check(s.status === "error" && s.error === "sha256", "tampered zip rejected (sha256)", brief(s));
  check(!exists(VERS, "9.9.9") && !exists(VERS, "9.9.9.tmp"), "nothing installed from the tampered zip");

  mode = "good"; await page.evaluate(() => { window.__upd = []; });
  s = await page.evaluate(() => window.valkyrysUpdate.install());
  check(s.status === "ready", "install -> ready", brief(s));
  const pushes = await page.evaluate(() => window.__upd);
  const prog = pushes.filter((x) => x.status === "downloading").map((x) => x.progress);
  check(prog.length >= 3 && prog.every((p, i) => p >= 0 && p <= 1 && (i === 0 || p >= prog[i - 1])) && pushes[pushes.length - 1].status === "ready", "progress pushed 0..1 then ready", { n: prog.length, last: prog[prog.length - 1] });
  check(["app-main.js", "updater.js", "preload.js", "server.js", "web/index.html", "package.json"].every((f) => exists(VERS, "9.9.9", f)) && !exists(VERS, "9.9.9", "main.js") && !exists(VERS, "9.9.9", ".pending"), "9.9.9 unpacked into versions/ (no loader in it)");
  check(await page.evaluate(() => { const n = window.__upd.length; window.__unsub(); return n > 0; }), "onState unsubscribe");
  // restart(): relaunch + exit (replaced here so the test keeps hold of the process)
  await app.evaluate(({ app }) => { global.__r = []; app.relaunch = () => global.__r.push("relaunch"); app.exit = (c) => global.__r.push("exit" + c); });
  await page.evaluate(() => window.valkyrysUpdate.restart()); await sleep(400);
  check(JSON.stringify(await app.evaluate(() => global.__r)) === '["relaunch","exit0"]', "restart = relaunch + exit");
  await app.close();

  // ---- 2: the loader starts 9.9.9
  ({ app, page } = await launch());
  s = await st(page);
  check(s.running === "9.9.9" && s.bundled === bundled && s.status === "idle", "loader runs 9.9.9", brief(s));
  check(await app.evaluate(({ app }) => app.getVersion()) === bundled, "app.getVersion() still the installed version");
  check((await app.evaluate(() => global.valkyrysLoader.dir)).endsWith(path.join("versions", "9.9.9")), "app files come from versions/9.9.9");
  await page.waitForSelector("#pick", { state: "attached", timeout: 20000 });
  check(true, "page of 9.9.9 works");
  for (let i = 0; i < 40 && !exists(VERS, "9.9.9", ".ok"); i++) await sleep(200);
  check(exists(VERS, "9.9.9", ".pending") && exists(VERS, "9.9.9", ".ok"), "9.9.9 marked pending, then ok");
  check(!exists(VERS, "3.0.0") && exists(VERS, "4.0.0"), "keeps only one version older than the running one", fs.readdirSync(VERS));
  s = await page.evaluate(() => window.valkyrysUpdate.check());
  check(s.status === "uptodate", "check from 9.9.9 -> uptodate", s.status);
  await app.close();

  // ---- 3: 9.10.0 crashes on start (process ends): next start gives it up and goes back to 9.9.9
  fakeApp(path.join(VERS, "9.10.0"), "9.10.0", "process.exit(3);\n");
  const r = spawnSync(EXE, ["--no-sandbox", "--disable-gpu", "--no-splash"], { env: env(), timeout: 30000 });
  check(r.status === 3 && exists(VERS, "9.10.0", ".pending") && !exists(VERS, "9.10.0", ".ok"), "crashing 9.10.0 left pending without ok", { status: r.status, signal: r.signal });
  ({ app, page } = await launch());
  s = await st(page);
  check(s.running === "9.9.9" && s.rolledBack === "9.10.0" && exists(VERS, "9.10.0", ".bad"), "rolled back to 9.9.9, rolledBack = 9.10.0", brief(s));
  await app.close();

  // ---- 4: 9.11.0 throws while loading and there is no other update: the installed app starts in the same run
  fs.rmSync(path.join(VERS, "9.9.9"), { recursive: true }); fs.rmSync(path.join(VERS, "4.0.0"), { recursive: true });
  fakeApp(path.join(VERS, "9.11.0"), "9.11.0", 'throw new Error("boom at start");\n');
  ({ app, page } = await launch());
  s = await st(page);
  check(s.running === bundled && s.rolledBack === "9.11.0" && exists(VERS, "9.11.0", ".bad"), "rolled back to the installed app, rolledBack = 9.11.0", brief(s));
  await page.waitForSelector("#pick", { state: "attached", timeout: 20000 });
  check(true, "installed app works after the rollback");
  // a version that failed here is not offered again
  mode = "good"; fs.mkdirSync(path.join(VERS, "9.9.9")); fs.writeFileSync(path.join(VERS, "9.9.9", ".bad"), "{}");
  s = await page.evaluate(() => window.valkyrysUpdate.check());
  check(s.status === "uptodate", "a version marked bad is not offered again", s.status);
  await app.close();

  server.close();
  console.log(fails ? `${fails} FAILED` : "all update checks passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FAIL", e.stack || e.message); process.exit(1); });
