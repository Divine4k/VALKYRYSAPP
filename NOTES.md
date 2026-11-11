# Valkyrys app: notes for working on it

Windows desktop app (Electron 33) that turns the client's purchase orders (PO PDFs) into numbered invoices, with statistics. Owner: freelancer "Valkyrys", Den Haag; client Piguillet. Shipped as one Go-built installer, `out/Valkyrys-app-Setup.exe`. Until 2026-11 the app was called "Valkyrys Facturen".

## Working rules (also in the Project instructions)
- Run only the tests for the area you changed. Run everything and build the installer only when asked to "release".
- Keep replies short; do not re-check what did not change.
- Source lives in the GitHub repo (see Environment). Commit and push when a batch of changes is done.

## Commands (all from the project folder)
```
tools/dev.sh build              app files -> app/web, copied into the Linux test copy of Electron (el/linux)
tools/dev.sh test settings dups run only these Electron tests (name without "test_"); builds first
tools/dev.sh units              quick tests of the reading/counting code, no window
tools/dev.sh all                everything, ~10 min
tools/dev.sh installer          payload + Windows installer only (fetches the Electron zips first if missing)
tools/dev.sh release            all tests; only if all pass: installer + a check of what is in it
tools/dev.sh update             signed update package -> out/update/ (latest.json + valkyrys-app-<ver>.zip)
tools/publish_update.sh <ver>   copy it into the clone of Divine4k/valkyrys-updates (/home/claude/valkyrys-updates), commit, push
```
**Release = installer AND publish the update** (`dev.sh update` + `publish_update.sh`). Updates are plain files on `main` of the PUBLIC repo `Divine4k/valkyrys-updates` (`latest.json`, `packages/`), read via raw.githubusercontent.com (CDN cache ~5 min). Attach that repo with add_repo (push). The signing key `keys/update-signing.pem` is NOT in git (gitignored; committing it is blocked). The user keeps the master copy; in a new session ask them to attach it and copy it to `keys/update-signing.pem` before `dev.sh update`. Never put it in any repo. If it is lost, a new key means one more full install. Only installs from the 1.2.0+ installer (loader v1) can update in-app.
Logs: `logs/<test>.log`. Tests need xvfb (the script uses `xvfb-run -a`). Do not leave `GOOS=windows` exported when running `go test`.

## Where things are
| Path | What |
|---|---|
| `tool/index.html` | The whole interface: CSS, texts in nl/en/pl (`I18N`), all logic (about 2,300 lines). Source of truth. |
| `tool/invoice-core.js` | Reading POs/invoices, counting days, building invoices. Runs in the page and in Node. |
| `tool/invoice-docx.js`, `tool/vendor`, `tool/img`, `tool/fonts` | Word output of the Valkyrys design, libraries, logos, fonts |
| `tool/invoice-templates.js` | The invoice designs: list to choose from, the person's own details (`senderFor`, `missing`), the Extreme Building PDF drawing and Word filling, `renderPdf` / `buildWord` pick the design by `data.template` |
| `tool/templates/extreme.docx` | Word file of the Extreme Building design with `[placeholders]`; filled in by `fillExtremeDocx` |
| `app/shim.js` | Stand-in for the storage/downloads the page expects (database via the local server) |
| `tools/build_app.py` | tool/ -> `app/web` (CDN libraries replaced by local copies, shim added) |
| `electron-app/main.js` | Small stable LOADER (loader v1, never needs updating): starts the newest good update in `%APPDATA%\Valkyrys app\versions\<ver>` (newer than bundled, `.ok`, not `.bad`, minLoader ok), else the bundled `app-main.js`; `.pending`/`.ok`/`.bad` markers give automatic rollback |
| `electron-app/app-main.js` | The real app: window, PIN lock, folders (config.json), show-in-folder, first-start flag, update IPC |
| `electron-app/updater.js` | In-app updates: `UPDATE_REPO`, Ed25519 public key, check/download/verify (signature + sha256 + size)/unpack/prune; auto-check 15 s after start, max every 6 h |
| `electron-app/preload.js` | The `valkyrys` bridge: getFolder, pickFolder, clearFolder, openFolder, listFiles, readFile, openFile, revealFile, saveFile, getWelcomed, setWelcomed, pickAnyDir/saveToDir/saveAsZip/writePicked ("Save as…": main only writes into a folder/.zip the user picked in a native dialog this run); `valkyrysLock` |
| `electron-app/server.js` | Local server on port 47831 (fixed, so the window remembers theme and language): serves the page, keeps data.json |
| `installer/` | Setup program in plain Go (own Win32 window, nl/en/pl, `/S` silent). `logic.go` texts and file handling (testable anywhere), `win_ops.go`, `win_gui.go` |
| `tools/build_payload.py` | Windows Electron (`dl/win.zip`) + app -> `installer/payload/app.zip` |
| `tools/test_*.js/.mjs` | Tests. `tools/test_helpers.js` has goTab, setLang, seedProfile (writes a chosen design unless `{template: null}`), chooseDesign |
| `tools/measure_pdf.mjs`, `tools/render_templates.mjs` | Measure a reference invoice (text baselines, rectangles, images); draw a sample invoice in every design |
| `realpo/` | The user's real POs (used by test_realpo), `po/` sample PO |

## Data and settings on the user's computer
- Folder `%APPDATA%\Valkyrys app` (moved from `Valkyrys Facturen` on first start of the new name; see top of main.js): `data.json` (numbering, history, settings), `config.json` (`folder` invoices, `poFolder`, `welcomed`), `pin.json` (salted scrypt hash; `{"v":1,"skipped":true}` = PIN skipped).
- Page-side prefs (theme, language) live in the browser profile inside that folder.

## Conventions
- Text for the interface: add every key to all three languages in `I18N` (nl, en, pl). `tr("key", a, b)` fills `{0}`, `{1}`. Days word: `tr(plural(n))`.
- `desk` is the desktop bridge (undefined in a plain browser). Folder-only UI is hidden without it.
- Navigation: a sidebar on the left (`#side`, no top bar since 1.1.4): logo (logo-white.png used as a CSS mask, drawn in `--ink` so it shows on every theme), the work tabs Statistieken (first, opens at start), Facturen, Documenten (`#tabs`, vertical tablist, arrows/Home/End), and at the bottom "Nieuw" `#newsBtn` and Instellingen `#tabSettings` (aria-pressed, not one of the tabs). Sidebar 180px; `#sideToggle` (above Nieuw, or Ctrl+B) collapses it to a 68px icon rail (labels as tooltips), remembered in localStorage `valkyrys-side` and `settings/prefs.side` (`savePrefs` merges, `set()` replaces the doc). `ValkSide` in the head sets `html.side-min` / `html.rail` before drawing; the rail is forced at 560-899px (toggle hidden), below 560px a bar at the bottom. `setTab()` in index.html. Settings holds folders, PIN, theme + language, invoice details.
- Documenten (`renderDocs`, `docSets`): one row per invoice number with its PDF/Word in the invoice folder, its PO (matched on the invoice's `po` or the file name via `poMentioned`) and invoices only in the app (drawn again). Built from what is already read (parse cache, `folderInvoices`, `invoices`, `poRecs`); redrawn from `renderNewPos`. "Sent" ticks in `settings/sent`, sort/filter in `settings/docsprefs`. Word files are previewed by `docxPage` (document.xml → simple HTML page; falls back to `noPrevWord`). Test: `tools/test_docs.js`.
- Statistics: each PO line is a work day dated from the start of its Omschrijving; range "t/m" expands to Mon-Fri; hour lines are qty/8; one date is never more than 1 day across lines and POs. Duplicate days across POs (`poDupes`) and one PO number in several files (`state.poSame`) only inform (banner + list), they change no figure. Invoice source: `lineDays(rate, qty, desc)`, rate < 100 = hour rate.
- Changing the PO reading? Bump `PARSER_VERSION` in index.html so cached reads are redone.
- Tests seed their own fake AppData (`seedProfile`), so they skip the PIN and first-start questions. Fixture folders in /tmp are made again before every test by `dev.sh`.
- Every user-visible change: add an item to the top entry of `tool/changelog.js` (nl/en/pl); on release start a new entry with the new version and bump electron-app/package.json. The "Nieuw" item in the sidebar shows a dot until the latest version is opened (`settings/news.seen`); a fresh install marks it seen silently, nothing opens by itself.
- When the UI moves, fix `tools/test_helpers.js` first (tab selectors) before touching single tests.

## Invoice designs (templates)
- Fresh installs: `settings/main.builtins: false` (written by server.js when there is no data.json) hides the built-in designs; the person adds their own .docx. Absent = older install, built-ins stay. `designSkipped` = first-start design step skipped. First start asks whether to set a PIN (`#lkAskYes`/`#lkAskNo`).
- Client presets: `settings/clients` = {list:[{id,name,fields:{client,betaaltermijn,btw}}], active}; the active client is copied into settings/main; cards can pick another client when 2+ exist. Test: test_clients.
- Settings `template` (`valkyrys` | `extreme`) and `sender` (the person's details: name, person, street, city, phone, email, iban, btw, kvk) live in `settings/main`. Only what the person typed is in `sender`; the rest comes from the design's defaults. Missing required details block invoices (banner on Invoices, warning in Settings).
- First start: design picker, then the details form, then the folder question (`firstRun()` in index.html). Installs from before designs existed get `template: "valkyrys"` from `electron-app/server.js`; a fresh install has none, so the picker shows. Tests that need a ready profile use `seedProfile` (design chosen).
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
