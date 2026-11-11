# Valkyrys app: notes for working on it

Windows desktop app (Electron 33) that turns the client's purchase orders (PO PDFs) into numbered invoices, with statistics. Owner: freelancer "Valkyrys", Den Haag; client Piguillet. Shipped as one Go-built installer, `out/Valkyrys-app-Setup.exe`. Until 2026-11 the app was called "Valkyrys Facturen".

## Working rules (also in the Project instructions)
- Run only the tests for the area you changed. "Release" = publish an in-app update (`dev.sh update` + `publish_update.sh`; signing key from the project file `update-signing.txt`, see Commands); build the full installer only when asked.
- Small changes and bug fixes: do them directly. Agents only for 2+ large, independent pieces; max 2 screenshot-polish rounds per change.
- Keep replies short; do not re-check what did not change.
- Source lives in the GitHub repo (see Environment). Commit and push when a batch of changes is done.

## Commands (all from the project folder)
```
tools/dev.sh build              app files -> app/web, copied into the Linux test copy of Electron (el/linux)
tools/dev.sh test settings dups run only these Electron tests (name without "test_"), side by side; builds first only if
                                tool/, electron-app/ or app/shim.js changed since the last build (stamp logs/.build-stamp)
tools/dev.sh units              quick tests of the reading/counting code, no window
tools/dev.sh all                everything (all 22 Electron tests ~3.7 min with 2 at a time)
tools/dev.sh fixtures DIR       make the test fixtures (np-inv, po-folder, inv-folder2) in DIR
tools/dev.sh installer          payload + Windows installer only (fetches the Electron zips first if missing)
tools/dev.sh release            all tests; only if all pass: installer + a check of what is in it
tools/dev.sh update             signed update package -> out/update/ (latest.json + valkyrys-app-<ver>.zip)
tools/publish_update.sh <ver>   copy it into the clone of Divine4k/valkyrys-updates (/home/claude/valkyrys-updates), commit, push
```
**Release = publish the in-app update** (`dev.sh update` + `publish_update.sh`); the full installer (`dev.sh installer`) only when the user asks for it. Updates are plain files on `main` of the PUBLIC repo `Divine4k/valkyrys-updates` (`latest.json`, `packages/`), read via raw.githubusercontent.com (CDN cache ~5 min). Attach that repo with add_repo (push). The signing key `keys/update-signing.pem` is NOT in git (gitignored; committing it is blocked). A copy is in the Claude Project files as `update-signing.txt` (same PEM text): in a new session read it with the Projects tool (`project_read update-signing.txt`) and write it to `keys/update-signing.pem` before `dev.sh update` — no need to ask the user. The user also keeps their own copy. Never put it in any repo. If it is lost, a new key means one more full install. Only installs from the 1.2.0+ installer (loader v1) can update in-app.
Test runs: `JOBS=N` tests at the same time (default CPUs, max 4; `JOBS=1` = one after another; more than the CPUs makes timing-based checks flaky), `NOBUILD=1` never build, `KEEP=1` keep the run folder. Every run works in its own `/tmp/vk-run.XXXX` (exported as `VK_TMP`; kept when something fails): fixtures made once per run, then each test gets its own folder `$VK_TMP/test_x.N` with a fresh copy, its own fake AppData, downloads, log, and its own app server port (`VALKYRYS_PORT`, honoured by app-main.js; default 47831). So several runs (agents) at once do not collide. In tests use `tmp("name")` from test_helpers.js for every scratch path (screenshots may stay `/tmp/<name>.png`); `saved(file)` waits for a file the app writes.
One test by hand: `xvfb-run -a node tools/test_theme.js el/linux/electron po/PO-008148.pdf` (without VK_TMP the helper uses `/tmp/vk-manual` and makes the fixtures there again on every start; set `VK_TMP=/some/dir` to use another folder).
Logs: `logs/<test>.log` (copy of the latest run). Tests need xvfb (the script uses `xvfb-run -a`). Do not leave `GOOS=windows` exported when running `go test`.

## Where things are
| Path | What |
|---|---|
| `tool/index.html` | Markup only (+ the `<link>`/`<script>` tags; their order matters). **Find the area file first; never put new code in index.html except markup.** |
| `tool/css/*.css` | Styles, cut from the old `<style>` in its original order (the cascade depends on it, keep the `<link>` order): base (theme vars), layout, components (buttons, save/delete dialogs), invoices (cards, history, banners), dialogs (toast, dialog), lockscreen, theme, po (folder path, new POs, period/PO dialogs), sidebar, news (what's new + updates), stats, settings, dups, firstrun, stats-table, documents (+ Word page), utilities (last). `url()` in CSS is relative to css/ (`../img/...`) |
| `tool/i18n/nl.js`, `en.js`, `pl.js` | Interface texts, `window.VALK_I18N.<lang>`; `tr()` reads them (js/core.js) |
| `tool/js/boot-side.js`, `boot-theme.js`, `boot-lock.js` | Run before the markup: sidebar width (`ValkSide`), theme engine (`ValkTheme`), PIN lock screen (its own texts) |
| `tool/js/*.js` (main script) | One script cut in parts sharing one global scope (no IIFE; top-level `const`/`function` are visible to later files; "use strict" in each). Loaded in the order below. Code that runs while loading may use only earlier files; anything async at start goes in init.js |
| `tool/js/sendmail.js` | Sending invoices by email: the round floating button bottom right "Facturen versturen" (`#docsSendStart.sendfab`, only on Documents) starts choosing (`state.docs.selMode`: tick boxes, `#sendBar` with "all unsent", cancel), ticked rows `state.docs.sel`, "Per e-mail versturen…" → `#sendDlg` (from, to, subject, text with {placeholders}: nummers lijst totaal aantal naam Factuur/factuur; preview). One email, the invoice PDFs attached (folder file, or drawn from the record). Subject and text start empty every time; addresses can be saved (`settings/mailsend.book`, chips under "Aan": click = in/out, × = forget; "bewaren" box for new ones) and the account (`from`) is remembered. Sent ones get the Sent tick. Main: `mail.send` in mailfetch.js = SMTP 465 (smtpOf: Gmail smtp.gmail.com, WP smtp.wp.pl, other imap.→smtp.; `acc.smtp` overrides), AUTH PLAIN, then IMAP APPEND into \\Sent (not Gmail, it keeps its own). Tests: test_mailfetch (units), test_send (fake SMTP `startSmtp` in fake_imap.js) |
| `tool/js/reveal.js` | Eye button in every password/PIN field (not the lock screen's hidden `.lk-in`; boot-lock.js has its own eye beside the dots). The lock screen has no number pad: typed on the keyboard, only "Bevestigen" while choosing a PIN |
| `tool/js/core.js` | `$`, `esc`, `tr`, `plural`, `state`, `DEFAULTS`, `LANGS`, library check, `loadAssets` |
| `tool/js/invoices.js` | Numbering (`renumber`), reading dropped POs, building/saving invoices (PDF/Word, `desk`, Save as…), PO-already-invoiced dialog, invoice cards (`render`), `toast`, `busy` |
| `tool/js/clients.js` | Client presets (`settings/clients`) |
| `tool/js/folder.js` | Invoice folder: listing, reading invoices for the statistics, `PARSER_VERSION` |
| `tool/js/stats-data.js` | Statistics data: prefs, sorting, weeks, invoice/PO rows, `poDupes`, aggregation |
| `tool/js/po.js` | PO folder (`refreshPoFolder`, `scanPos`), duplicate-days dialog, new POs list (`renderNewPos`, `addPos`) |
| `tool/js/docpreview.js` | Preview of a PO/invoice PDF, Word file as a page (`docxPage`) |
| `tool/js/documents.js` | Documents tab (`docSets`, `renderDocs`, warnings), deleting an invoice, refresh buttons, stale records |
| `tool/js/stats.js` | Statistics view: period dialog, tiles (KPIs), bar chart, `renderStats`, CSV |
| `tool/js/nav.js` | Sidebar, tabs (`setTab`), statistics and new-PO event handlers |
| `tool/js/theme.js` | Theme picker in Settings |
| `tool/js/news.js` | What's new dialog and in-app updates (Settings panel, bars) |
| `tool/js/settings.js` | PIN settings, language (`applyLang`, `savePrefs`) |
| `tool/js/invoice-events.js` | Card events, settings form submit, file picking and dropping |
| `tool/js/designs.js` | First start (`firstRun`, welcome), invoice designs, own details, imported Word designs |
| `tool/js/init.js` | Start (loads the data, snapshots). Always last |
| `tool/invoice-core.js` | Reading POs/invoices, counting days, building invoices. Runs in the page and in Node. |
| `tool/invoice-docx.js`, `tool/vendor`, `tool/img`, `tool/fonts` | Word output of the Valkyrys design, libraries, logos, fonts |
| `tool/invoice-templates.js` | The invoice designs: list to choose from, the person's own details (`senderFor`, `missing`), the Extreme Building PDF drawing and Word filling, `renderPdf` / `buildWord` pick the design by `data.template` |
| `tool/templates/extreme.docx` | Word file of the Extreme Building design with `[placeholders]`; filled in by `fillExtremeDocx` |
| `app/shim.js` | Stand-in for the storage/downloads the page expects (database via the local server) |
| `tools/build_app.py` | tool/ -> `app/web` (CDN libraries replaced by local copies, shim added) |
| `electron-app/main.js` | Small stable LOADER (loader v1, never needs updating): starts the newest good update in `%APPDATA%\Valkyrys app\versions\<ver>` (newer than bundled, `.ok`, not `.bad`, minLoader ok), else the bundled `app-main.js`; `.pending`/`.ok`/`.bad` markers give automatic rollback |
| `electron-app/app-main.js` | The real app: window, PIN lock, folders (config.json), show-in-folder, first-start flag, update IPC |
| `electron-app/updater.js` | In-app updates: `UPDATE_REPO`, Ed25519 public key, check/download/verify (signature + sha256 + size)/unpack/prune; checks right at the start (while the splash plays), then every hour; never installs by itself |
| `electron-app/preload.js` | The `valkyrys` bridge: getFolder, pickFolder, clearFolder, openFolder, listFiles, readFile, openFile, revealFile, saveFile, getWelcomed, setWelcomed, pickAnyDir/saveToDir/saveAsZip/writePicked ("Save as…": main only writes into a folder/.zip the user picked in a native dialog this run); `valkyrysLock` |
| `electron-app/mailfetch.js` | E-mail connections (Settings › Verbindingen): accounts in `<data folder>/mail.json` (password via safeStorage), own small IMAP client (no npm), read-only (EXAMINE + BODY.PEEK). Mails with subject `Inkooporder PO-######` + PDF → saved into the PO folder (never overwrites). Every check: subjects of the last 30 days' `Inkooporder` mails (one header FETCH), compared by PO number with the folder (+ subfolders); missing ones are fetched again, except numbers in `skip` (deleted through the app: `folder:trash` pos → `mail.forget`; or ignored). Gmail: the `\All` mailbox. First check right at the start (while the splash plays, also before the PIN), then every 5 min while unlocked; the splash waits for both start checks (max 9 s from start, START_CHECKS_MAX_MS). `mode` ask (default) or auto (save + `unseen` names until the page calls `seen`) or ask (`pending` [{key,acc,uid,uv,name}], `download(keys)`/`ignore(keys)`). The page shows a card in `#mailNotes` at the top of the Invoices tab ("Je hebt nieuwe inkooporders in je mail!") and a dot `#invDot` on Facturen; when the window is not focused it calls `notify` (Windows notification + taskbar flash; the toast may need the installer to set the AUMID on the shortcut). IPC `mail:*`, bridge `valkyrysMail`. Tests: `tools/test_mailfetch.mjs` (units), `tools/test_mail.js`, fake server `tools/fake_imap.js` (plain TCP only with env `VALKYRYS_MAIL_PLAIN=1`) |
| `tool/js/mail.js` | Connections panel + add dialog with a step guide per service (`MAIL_GUIDE`; "Otwórz ↗" buttons open fixed help pages via IPC `app:link`, names only: gTwoSv, gAppPw, wpMail, wpKonto) (Gmail app password / WP / other IMAP), status per account, check now, on/off, disconnect; toast + `refreshPoFolder()` when POs come in |
| `electron-app/server.js` | Local server on port 47831 (env `VALKYRYS_PORT` overrides; fixed, so the window remembers theme and language): serves the page, keeps data.json |
| `installer/` | Setup program in plain Go (own Win32 window, nl/en/pl, `/S` silent). `logic.go` texts and file handling (testable anywhere), `win_ops.go`, `win_gui.go` |
| `tools/build_payload.py` | Windows Electron (`dl/win.zip`) + app -> `installer/payload/app.zip` |
| `tools/test_*.js/.mjs` | Tests. `tools/test_helpers.js` has goTab, setLang, seedProfile (writes a chosen design unless `{template: null}`), chooseDesign |
| `tools/measure_pdf.mjs`, `tools/render_templates.mjs` | Measure a reference invoice (text baselines, rectangles, images); draw a sample invoice in every design |
| `realpo/` | The user's real POs (used by test_realpo), `po/` sample PO |

## Data and settings on the user's computer
- Folder `%APPDATA%\Valkyrys app` (moved from `Valkyrys Facturen` on first start of the new name; see top of main.js): `data.json` (numbering, history, settings), `config.json` (`folder` invoices, `poFolder`, `welcomed`), `pin.json` (salted scrypt hash; `{"v":1,"skipped":true}` = PIN skipped), `mail.json` (e-mail accounts, encrypted passwords, last seen UID per account).
- Page-side prefs (theme, language) live in the browser profile inside that folder.

## Conventions
- Text for the interface: add every key to all three languages in `tool/i18n/nl.js`, `en.js`, `pl.js`. `tr("key", a, b)` fills `{0}`, `{1}`. Days word: `tr(plural(n))`.
- `desk` is the desktop bridge (undefined in a plain browser). Folder-only UI is hidden without it.
- Navigation: a sidebar on the left (`#side`, no top bar since 1.1.4): logo (logo-white.png used as a CSS mask, drawn in `--ink` so it shows on every theme), the work tabs Statistieken (first, opens at start), Facturen, Documenten (`#tabs`, vertical tablist, arrows/Home/End), and at the bottom "Nieuw" `#newsBtn` and Instellingen `#tabSettings` (aria-pressed, not one of the tabs). Sidebar 180px; `#sideToggle` (above Nieuw, or Ctrl+B) collapses it to a 68px icon rail (labels as tooltips), remembered in localStorage `valkyrys-side` and `settings/prefs.side` (`savePrefs` merges, `set()` replaces the doc). `ValkSide` (js/boot-side.js) sets `html.side-min` / `html.rail` before drawing; the rail is forced at 560-899px (toggle hidden), below 560px a bar at the bottom. `setTab()` in js/nav.js. Settings has its own tabs (`#setTabs`, js/settabs.js): Mijn gegevens (details + design), Mappen, Verbindingen, Weergave (theme + language), Beveiliging (PIN), Updates. Each panel says its tab with `data-stab`; a tab whose panels are all hidden is not shown; the open one is remembered (localStorage `valkyrys-settab`). Go there from elsewhere with `openSettings(tab)`; tests use `goSet(page, tab)` from test_helpers.
- Documenten (`renderDocs`, `docSets`): one row per invoice number with its PDF/Word in the invoice folder, its PO (matched on the invoice's `po` or the file name via `poMentioned`) and invoices only in the app (drawn again). Built from what is already read (parse cache, `folderInvoices`, `invoices`, `poRecs`); redrawn from `renderNewPos`. "Sent" ticks in `settings/sent`, sort/filter in `settings/docsprefs`. Word files are previewed by `docxPage` (document.xml → simple HTML page; falls back to `noPrevWord`). Test: `tools/test_docs.js`.
- Statistics: each PO line is a work day dated from the start of its Omschrijving; range "t/m" expands to Mon-Fri; hour lines are qty/8; one date is never more than 1 day across lines and POs. Duplicate days across POs (`poDupes`) and one PO number in several files (`state.poSame`) only inform (banner + list), they change no figure. Invoice source: `lineDays(rate, qty, desc)`, rate < 100 = hour rate.
- Changing the PO reading? Bump `PARSER_VERSION` in js/folder.js so cached reads are redone.
- Tests seed their own fake AppData (`seedProfile`), so they skip the PIN and first-start questions. Fixture folders are made per run and copied fresh for every test (see Commands: VK_TMP).
- What's new (`tool/changelog.js`): only main features, one short sentence each; no details, small fixes or polish (the user wants it short). Quiet fixes: new version without an entry, `dev.sh update --no-notes`.
- Every main feature: add an item to the top entry of `tool/changelog.js` (nl/en/pl); on release start a new entry with the new version and bump electron-app/package.json. The "Nieuw" item in the sidebar shows a dot until the latest version is opened (`settings/news.seen`); a fresh install marks it seen silently, nothing opens by itself.
- When the UI moves, fix `tools/test_helpers.js` first (tab selectors) before touching single tests.

## Invoice designs (templates)
- Fresh installs: `settings/main.builtins: false` (written by server.js when there is no data.json) hides the built-in designs; the person adds their own .docx. Absent = older install, built-ins stay. `designSkipped` = first-start design step skipped. First start asks whether to set a PIN (`#lkAskYes`/`#lkAskNo`).
- Invoice without a PO: "+ Nieuw" (`#newNoPo`, its own box left of "Volgende factuur" in `.nextbox`) → `addNoPo()` (js/invoices.js): a card with `noPo: true`, `po: ""`, starts with the active client preset; "Andere klant" in its Klant list shows fields for a client typed on the card (`c.own`, inputs `data-ck`, used by `cardClient`) or a preset (`c.clientId`), lines added/removed (`addline`/`delline`), "Bewaren als klant" makes a preset. Blocked while no line has desc+qty+rate (`noPoEmpty`). Typed fields only refresh the notes (`renderCardNotes`, waits for the click while a mouse button is down). Test: test_nopo.
- Client presets: `settings/clients` = {list:[{id,name,fields:{client,betaaltermijn,btw}}], active}; the active client is copied into settings/main; cards can pick another client when 2+ exist. Test: test_clients.
- Settings `template` (`valkyrys` | `extreme`) and `sender` (the person's details: name, person, street, city, phone, email, iban, btw, kvk) live in `settings/main`. Only what the person typed is in `sender`; the rest comes from the design's defaults. Missing required details block invoices (banner on Invoices, warning in Settings).
- First start: design picker, then the details form, then the folder question (`firstRun()` in js/designs.js). Installs from before designs existed get `template: "valkyrys"` from `electron-app/server.js`; a fresh install has none, so the picker shows. Tests that need a ready profile use `seedProfile` (design chosen).
- Each saved invoice stores its `template` and `sender`, so an old invoice is drawn again in the design and with the details it was made with (`recordLook`).
- The importer (`parseInvoiceText(lines, owners)`) gets the own names/KVKs of every design and the current sender so it never takes the sender for the client.
- **Own designs (imported Word files)**: "Nieuw ontwerp toevoegen…" in the picker imports a .docx in the style of `extreme.docx` (IPC `tpl:import`/`tpl:read`/`tpl:remove`, file in `<data folder>/templates/<id>.docx`, list in `settings/main.customTemplates` [{id,name,file}]; plain browser keeps `b64` in the list). `fillTemplateDocx` (generic; `fillExtremeDocx` uses it) fills [placeholders], sample client/date/term/totals, the line rows, and replaces sender details typed in the file; `inspectDocx`/`readSender` read those details (labels Van/KVK/BTW NR/IBAN, regexes) and they become the design's defaults, filled into empty fields on choosing. No docx→PDF converter is available offline, so their PDF is the Valkyrys layout with the file's logo (first wide picture). Thumbnail: `img/tpl-custom.png`. Test fixture: `tools/make_custom_docx.js`.
- **Adding a design for another person**: get their invoice as a Word file with `[placeholders]` (like `tool/templates/extreme.docx`), convert it to PDF (LibreOffice), run `node tools/measure_pdf.mjs ref.pdf` for positions, then: pictures into `tool/img/`, an entry in `TEMPLATES`, a `render...` function (copy `renderExtreme`), a Word-fill function (copy `fillExtremeDocx`), a thumbnail `tool/img/tpl-ID.png` (from `tools/render_templates.mjs`), texts `tplDesc_ID` in all three languages, assets in `loadAssets()`, a case in `tools/test_parse_generated.mjs`, and check it with `tools/test_templates.js`. Compare the result with the reference side by side (pixel diff).

## Installer
- Replaces an installed "Valkyrys Facturen" (shortcuts, entry in Installed apps, listed files); data is left to the app to move.
- `payload/uninstall.exe` only needs rebuilding when the installer's Go code changes (`-tags uninst`); `dev.sh installer` does it anyway. Icon/manifest: `tools/make_syso.py electron-app/build/icon.ico installer/rsrc_windows_amd64.syso`.
- Never run on real Windows from here. Everything Windows-specific (window, shortcuts, registry, replacing the old install) is untested; test it on a machine before trusting it.

## Environment (no network from the shell except GitHub through the git proxy)
- Source: GitHub repo `Divine4k/VALKYRYSAPP`, branch `main`. Attach it with add_repo (push needs the Claude GitHub App, installed on Divine4k).
- Electron zips (Linux test copy, Windows installer payload) are too big for `main`: they live in branch `toolchain`, cut in parts. `tools/get_toolchain.sh` (called by `dev.sh build` / `dev.sh installer` when missing) fetches them, checks the checksums and sets up `dl/` and `el/linux`. Takes a few minutes. Never merge `toolchain` into main.
- Also needed: Go (cross-compile), Node, Python, xvfb, Playwright, and libraries in `/opt/npm-tools` (pdf-lib, jszip) and `/home/claude/.npm-global` (pdfjs-dist, pdf-lib, docx).
- Push the source with plain git (commit on main, `git push`). Do not commit installers, `app/web`, `installer/payload`, logs.

## Known limits
- A PO layout with prices vertically centred between two text lines is not read (listed as "unread").
- Wrapped second rows of a PO line are ignored.
- The Word preview is approximate: pictures behind the text (backgrounds) and EMF/WMF images are left out, positioned text boxes flow inline.
