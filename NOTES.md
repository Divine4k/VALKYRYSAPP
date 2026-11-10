# Valkyrys app: notes for working on it

Windows desktop app (Electron 33) that turns the client's purchase orders (PO PDFs) into numbered invoices, with statistics. Owner: freelancer "Valkyrys", Den Haag; client Piguillet. Shipped as one Go-built installer, `out/Valkyrys-app-Setup.exe`. Until 2026-11 the app was called "Valkyrys Facturen".

## Working rules (also in the Project instructions)
- Run only the tests for the area you changed. Run everything and build the installer only when asked to "release".
- Keep replies short; do not re-check what did not change.
- Everything is in one folder (the session scratchpad). It is not in git: back it up (zip) or put it in a repo.

## Commands (all from the project folder)
```
tools/dev.sh build              app files -> app/web, copied into the Linux test copy of Electron (el/linux)
tools/dev.sh test settings dups run only these Electron tests (name without "test_"); builds first
tools/dev.sh units              quick tests of the reading/counting code, no window
tools/dev.sh all                everything, ~10 min
tools/dev.sh installer          payload + Windows installer only
tools/dev.sh release            all tests; only if all pass: installer + a check of what is in it
```
Logs: `logs/<test>.log`. Tests need xvfb (the script uses `xvfb-run -a`). Do not leave `GOOS=windows` exported when running `go test`.

## Where things are
| Path | What |
|---|---|
| `tool/index.html` | The whole interface: CSS, texts in nl/en/pl (`I18N`), all logic (about 2,300 lines). Source of truth. |
| `tool/invoice-core.js` | Reading POs/invoices, counting days, building invoices. Runs in the page and in Node. |
| `tool/invoice-docx.js`, `tool/vendor`, `tool/img`, `tool/fonts` | Word output, libraries, logo, fonts |
| `app/shim.js` | Stand-in for the storage/downloads the page expects (database via the local server) |
| `tools/build_app.py` | tool/ -> `app/web` (CDN libraries replaced by local copies, shim added) |
| `electron-app/main.js` | Window, PIN lock, folders (config.json), show-in-folder, first-start flag |
| `electron-app/preload.js` | The `valkyrys` bridge: getFolder, pickFolder, clearFolder, openFolder, listFiles, readFile, openFile, revealFile, saveFile, getWelcomed, setWelcomed; `valkyrysLock` |
| `electron-app/server.js` | Local server on port 47831 (fixed, so the window remembers theme and language): serves the page, keeps data.json |
| `installer/` | Setup program in plain Go (own Win32 window, nl/en/pl, `/S` silent). `logic.go` texts and file handling (testable anywhere), `win_ops.go`, `win_gui.go` |
| `tools/build_payload.py` | Windows Electron (`dl/win.zip`) + app -> `installer/payload/app.zip` |
| `tools/test_*.js/.mjs` | Tests. `tools/test_helpers.js` has goTab, setLang, seedProfile |
| `realpo/` | The user's real POs (used by test_realpo), `po/` sample PO |

## Data and settings on the user's computer
- Folder `%APPDATA%\Valkyrys app` (moved from `Valkyrys Facturen` on first start of the new name; see top of main.js): `data.json` (numbering, history, settings), `config.json` (`folder` invoices, `poFolder`, `welcomed`), `pin.json` (salted scrypt hash; `{"v":1,"skipped":true}` = PIN skipped).
- Page-side prefs (theme, language) live in the browser profile inside that folder.

## Conventions
- Text for the interface: add every key to all three languages in `I18N` (nl, en, pl). `tr("key", a, b)` fills `{0}`, `{1}`. Days word: `tr(plural(n))`.
- `desk` is the desktop bridge (undefined in a plain browser). Folder-only UI is hidden without it.
- Tabs: Statistieken (first, opens at start), Facturen, Instellingen. `setTab()` in index.html. Settings holds folders, PIN, theme + language, invoice details.
- Statistics: each PO line is a work day dated from the start of its Omschrijving; range "t/m" expands to Mon-Fri; hour lines are qty/8; one date is never more than 1 day across lines and POs. Duplicate days across POs (`poDupes`) and one PO number in several files (`state.poSame`) only inform (banner + list), they change no figure. Invoice source: `lineDays(rate, qty, desc)`, rate < 100 = hour rate.
- Changing the PO reading? Bump `PARSER_VERSION` in index.html so cached reads are redone.
- Tests seed their own fake AppData (`seedProfile`), so they skip the PIN and first-start questions. Fixture folders in /tmp are made again before every test by `dev.sh`.
- When the UI moves, fix `tools/test_helpers.js` first (tab selectors) before touching single tests.

## Installer
- Replaces an installed "Valkyrys Facturen" (shortcuts, entry in Installed apps, listed files); data is left to the app to move.
- `payload/uninstall.exe` only needs rebuilding when the installer's Go code changes (`-tags uninst`); `dev.sh installer` does it anyway. Icon/manifest: `tools/make_syso.py electron-app/build/icon.ico installer/rsrc_windows_amd64.syso`.
- Never run on real Windows from here. Everything Windows-specific (window, shortcuts, registry, replacing the old install) is untested; test it on a machine before trusting it.

## Environment (no network from the shell)
Needs: Electron 33 Linux copy in `el/linux`, Windows Electron zip `dl/win.zip`, Go (cross-compile), Node, Python, xvfb, Playwright, and libraries in `/opt/npm-tools` (pdf-lib, jszip) and `/home/claude/.npm-global` (pdfjs-dist, pdf-lib, docx). If a fresh machine lacks them, the Electron tests and installer cannot be rebuilt there.

## Known limits
- A PO layout with prices vertically centred between two text lines is not read (listed as "unread").
- Wrapped second rows of a PO line are ignored; word-only invoices can only be opened, not previewed.
