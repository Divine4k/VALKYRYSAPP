#!/bin/bash
# Valkyrys app: build, test and release from one place.
#
#   tools/dev.sh build              build the app files (app/web) and copy them into the Linux test copy of Electron
#   tools/dev.sh test NAME...       build, then run only those Electron tests, e.g.  tools/dev.sh test settings dups
#   tools/dev.sh units              the quick tests of the reading/counting code (no window)
#   tools/dev.sh all                build, then every test (about 10 minutes)
#   tools/dev.sh installer          Windows installer only, no tests:  out/Valkyrys-app-Setup.exe
#   tools/dev.sh release            all tests, and only when everything passes the installer, then a check of what is inside it
#
# Test logs go to logs/<name>.log. Names can be given with or without "test_".
set -u
SP=$(cd "$(dirname "$0")/.." && pwd); cd "$SP"
EXE="$SP/el/linux/electron"
LOGS="$SP/logs"; mkdir -p "$LOGS"
ELECTRON_TESTS="newpo po stats import folder pin theme podetail realpo dups settings templates electron sequence splash saveas docs news delete clients"

toolchain() { { [ -x "$EXE" ] && [ -f dl/win.zip ]; } || bash tools/get_toolchain.sh; }   # Electron zips come from the "toolchain" branch when missing
build() { toolchain && python3 -I tools/build_app.py && bash tools/sync_linux.sh; }

# the tests save files into their fixture folders, so they are made again before every test
fixtures() {
  node tools/make_np_folders.mjs "$SP/tool" /tmp/np-inv >/dev/null
  node tools/make_po_folder.mjs "$SP/tool" /tmp/po-folder >/dev/null
  node tools/make_test_folder.mjs "$SP/tool" /tmp/inv-folder2 "$SP/po/PO-008148.pdf" >/dev/null 2>&1 || node tools/make_test_folder.mjs "$SP/tool" /tmp/inv-folder2 >/dev/null
}

FAILED=""
run_one() {
  local t="test_${1#test_}" args
  case $t in
    test_realpo)   args="$SP/realpo";;
    test_electron) args="--no-splash $SP/po/PO-008148.pdf";;
    *)             args="$SP/po/PO-008148.pdf";;
  esac
  [ -f "tools/$t.js" ] || { echo "no such test: $t"; FAILED="$FAILED $t"; return; }
  fixtures
  timeout 290 xvfb-run -a node "tools/$t.js" "$EXE" $args > "$LOGS/$t.log" 2>&1
  local rc=$? pass fail
  pass=$(grep -c '^PASS' "$LOGS/$t.log"); fail=$(grep -c '^FAIL' "$LOGS/$t.log")
  if [ $rc -ne 0 ] || [ "$fail" -ne 0 ]; then echo "FAIL $t  (rc=$rc pass=$pass fail=$fail)"; grep -m8 '^FAIL' "$LOGS/$t.log" | cut -c1-240; FAILED="$FAILED $t"
  else echo "ok   $t  ($pass checks)"; fi
}

units() {
  local f out rc
  for f in test_workdates.mjs test_parse_generated.mjs; do
    out=$(node "tools/$f" "$SP/tool" 2>&1); rc=$?; if [ $rc -ne 0 ] || echo "$out" | grep -q '^FAIL'; then echo "FAIL $f"; echo "$out" | grep -m5 '^FAIL' | cut -c1-200; FAILED="$FAILED $f"; else echo "ok   $f"; fi
  done
  node tools/test_core.mjs "$SP/po/PO-008148.pdf" "$SP/tool" "$LOGS/core-out.pdf" >/dev/null 2>&1 && echo "ok   test_core.mjs" || { echo "FAIL test_core.mjs"; FAILED="$FAILED test_core.mjs"; }
  mkdir -p "$LOGS/tooltest"
  timeout 200 node tools/test_tool.js "$SP/tool" "$SP/po/PO-008148.pdf" "$LOGS/tooltest" > "$LOGS/test_tool.log" 2>&1 && echo "ok   test_tool.js (page in a plain browser)" || { echo "FAIL test_tool.js"; FAILED="$FAILED test_tool.js"; }
}

installer() {
  toolchain || return 1
  python3 -I tools/build_payload.py || return 1
  ( cd installer
    export CGO_ENABLED=0
    GOOS=windows GOARCH=amd64 go build -tags uninst -trimpath -ldflags "-H=windowsgui -s -w" -o payload/uninstall.exe . || exit 1   # only changes when the installer's Go code changes
    GOOS=windows GOARCH=amd64 go vet . || exit 1
    GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-H=windowsgui -s -w" -o ../out/Valkyrys-app-Setup.exe . || exit 1
    env -u GOOS -u GOARCH -u CGO_ENABLED go test ./... ) || return 1
  python3 -I - "$SP" <<'PY'
import sys, zipfile
sp = sys.argv[1]
z = zipfile.ZipFile(f"{sp}/installer/payload/app.zip"); names = z.namelist()
page = z.read("resources/app/web/index.html").decode("utf8")
assert "Valkyrys app.exe" in names, "program missing from the payload"
assert "Valkyrys Facturen" not in page, "old name left in the page"
for f in ("main.js", "preload.js", "server.js", "web/index.html"): assert f"resources/app/{f}" in names, f
print("payload ok:", len(names), "files")
PY
  ls -la out/Valkyrys-app-Setup.exe
}

cmd=${1:-help}; shift || true
case $cmd in
  build) build;;
  test)  [ $# -gt 0 ] || { echo "which tests? ($ELECTRON_TESTS)"; exit 2; }; build || exit 1; for t in "$@"; do run_one "$t"; done;;
  units) units;;
  all)   build || exit 1; units; for t in $ELECTRON_TESTS; do run_one "$t"; done;;
  installer) installer;;
  release) build || exit 1; units; for t in $ELECTRON_TESTS; do run_one "$t"; done
           if [ -n "$FAILED" ]; then echo; echo "NOT RELEASED, failing:$FAILED"; exit 1; fi
           installer;;
  *) sed -n '2,12p' "$0"; exit 2;;
esac
if [ -n "$FAILED" ]; then echo; echo "FAILING:$FAILED"; exit 1; fi
echo; echo "ALL GOOD"
