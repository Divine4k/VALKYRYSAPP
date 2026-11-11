#!/bin/bash
# Valkyrys app: build, test and release from one place.
#
#   tools/dev.sh build              build the app files (app/web) and copy them into the Linux test copy of Electron
#   tools/dev.sh test NAME...       run only those Electron tests, side by side, e.g.  tools/dev.sh test settings dups
#                                   (builds first only if tool/, electron-app/ or app/shim.js changed since the last build)
#   tools/dev.sh units              the quick tests of the reading/counting code (no window)
#   tools/dev.sh all                build if needed, then every test
#   tools/dev.sh update [--no-notes] in-app update only: out/update/latest.json + valkyrys-app-<version>.zip (publish: tools/publish_update.sh <version>)
#   tools/dev.sh installer          Windows installer only, no tests:  out/Valkyrys-app-Setup.exe
#   tools/dev.sh release            build, all tests, and only when everything passes the installer, then a check of what is inside it
#   tools/dev.sh fixtures DIR       make the test fixtures (np-inv, po-folder, inv-folder2) in DIR
#
#   JOBS=N      tests at the same time (default: CPUs, at most 4; JOBS=1 = one after another)
#   NOBUILD=1   never build before testing        KEEP=1  keep the run folder /tmp/vk-run.XXXX even when all passed
#
# Each run works in its own /tmp/vk-run.XXXX (VK_TMP), each test in its own folder in it, so runs at the same time do not collide.
# Test logs: logs/<name>.log (latest run). Names can be given with or without "test_".
set -u
SP=$(cd "$(dirname "$0")/.." && pwd); cd "$SP"
EXE="$SP/el/linux/electron"
LOGS="$SP/logs"; mkdir -p "$LOGS"
ELECTRON_TESTS="newpo po stats import folder pin theme podetail realpo dups settings templates electron sequence splash saveas docs news delete clients update_ui update mail nopo"

toolchain() { { [ -x "$EXE" ] && [ -f dl/win.zip ]; } || bash tools/get_toolchain.sh; }   # Electron zips come from the "toolchain" branch when missing
build() { toolchain && python3 -I tools/build_app.py && bash tools/sync_linux.sh; }

# `test` builds only when the sources changed since the last build (stamp = hash of the names and times of the files), NOBUILD=1 never builds.
# A lock keeps two runs at the same time (other agents) from building over each other.
STAMP="$LOGS/.build-stamp"
src_stamp() { find tool electron-app app/shim.js tools/build_app.py tools/stage_app.py tools/sync_linux.sh -type f -printf '%p %T@\n' 2>/dev/null | sort | md5sum | cut -c1-32; }
build_if_changed() {
  [ "${NOBUILD:-0}" = 1 ] && return 0
  ( flock 9
    s=$(src_stamp)
    if [ -x "$EXE" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$s" ]; then echo "build up to date"; exit 0; fi
    build && echo "$s" > "$STAMP" ) 9>"$LOGS/.build.lock"
}

# Every run has its own scratch folder (VK_TMP); every test its own folder inside it with a fresh copy of the fixtures, its own fake AppData,
# downloads and log, and its own port for the app's server. So runs and tests at the same time never share files.
RUN=""
new_run() { [ -n "$RUN" ] && return; RUN=$(mktemp -d /tmp/vk-run.XXXX); export VK_TMP="$RUN"; mkdir -p "$RUN/logs"; }
# the fixtures tests read (and save into): made once per run into DIR, copied for every test
fixtures() {
  local d=$1 T="$SP/tool"; mkdir -p "$d"
  node tools/make_np_folders.mjs "$T" "$d/np-inv" >/dev/null &
  node tools/make_po_folder.mjs "$T" "$d/po-folder" >/dev/null &
  { node tools/make_test_folder.mjs "$T" "$d/inv-folder2" "$SP/po/PO-008148.pdf" >/dev/null 2>&1 || node tools/make_test_folder.mjs "$T" "$d/inv-folder2" >/dev/null; } &
  wait
}
free_port() { python3 -I -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])'; }

# one test in its own folder; the last line of the result file is the summary line
run_one() {
  local t="test_${1#test_}" args res=$2 n=${3:-0}
  case $t in
    test_realpo)   args="$SP/realpo";;
    test_electron) args="--no-splash $SP/po/PO-008148.pdf";;
    *)             args="$SP/po/PO-008148.pdf";;
  esac
  [ -f "tools/$t.js" ] || { echo "FAIL $t  (no such test)" > "$res.part"; mv "$res.part" "$res"; return; }
  local dir="$RUN/$t.$n" log="$RUN/logs/$t.$n.log"   # .n: the same test may be named twice
  rm -rf "$dir"; mkdir -p "$dir"; cp -a "$RUN/fixtures/." "$dir/"
  VK_TMP="$dir" VALKYRYS_PORT=$(free_port) timeout 290 xvfb-run -a node "tools/$t.js" "$EXE" $args > "$log" 2>&1
  local rc=$? pass fail
  cp "$log" "$LOGS/$t.log.$$" && mv -f "$LOGS/$t.log.$$" "$LOGS/$t.log"   # logs/<test>.log = the latest run, never half written
  pass=$(grep -c '^PASS' "$log"); fail=$(grep -c '^FAIL' "$log")
  if [ $rc -ne 0 ] || [ "$fail" -ne 0 ]; then { grep -m8 '^FAIL' "$log" | cut -c1-240 | sed 's/^/     /'; echo "FAIL $t  (rc=$rc pass=$pass fail=$fail)"; } > "$res.part"
  else echo "ok   $t  ($pass checks)" > "$res.part"; fi
  mv "$res.part" "$res"
}

# run the named Electron tests JOBS at a time (default: number of CPUs, at most 4; JOBS=1 = one after another); results in the given order
FAILED=""
run_tests() {
  new_run; fixtures "$RUN/fixtures"
  local jobs=${JOBS:-$(nproc)}; [ -z "${JOBS:-}" ] && [ "$jobs" -gt 4 ] && jobs=4; [ "$jobs" -ge 1 ] 2>/dev/null || jobs=1
  local names=("$@") n=${#names[@]} i next=0 running=0 t0=$SECONDS
  mkdir -p "$RUN/res"
  for ((i = 0; i < n; i++)); do
    while [ $running -ge $jobs ]; do wait -n; running=$((running - 1)); flush_res; done
    run_one "${names[$i]}" "$RUN/res/$i" $i & running=$((running + 1))
  done
  while [ $running -gt 0 ]; do wait -n; running=$((running - 1)); flush_res; done
  wait; flush_res
  while [ $next -lt $n ]; do show_res $next; next=$((next + 1)); done
  echo "($n tests, $jobs at a time, $((SECONDS - t0)) s)"
}
flush_res() { while [ $next -lt $n ] && [ -f "$RUN/res/$next" ]; do show_res $next; next=$((next + 1)); done; }
show_res() { local r="$RUN/res/$1"; [ -f "$r" ] || { echo "FAIL ${names[$1]}  (no result)"; FAILED="$FAILED ${names[$1]}"; return; }
  tail -n1 "$r"; if ! tail -n1 "$r" | grep -q '^ok'; then head -n -1 "$r"; FAILED="$FAILED $(tail -n1 "$r" | awk '{print $2}')"; fi; }

units() {
  local f out rc; new_run
  for f in test_workdates.mjs test_parse_generated.mjs test_mailfetch.mjs; do
    out=$(node "tools/$f" "$SP/tool" 2>&1); rc=$?; if [ $rc -ne 0 ] || echo "$out" | grep -q '^FAIL'; then echo "FAIL $f"; echo "$out" | grep -m5 '^FAIL' | cut -c1-200; FAILED="$FAILED $f"; else echo "ok   $f"; fi
  done
  node tools/test_core.mjs "$SP/po/PO-008148.pdf" "$SP/tool" "$RUN/core-out.pdf" >/dev/null 2>&1 && echo "ok   test_core.mjs" || { echo "FAIL test_core.mjs"; FAILED="$FAILED test_core.mjs"; }
  mkdir -p "$RUN/tooltest"
  timeout 200 node tools/test_tool.js "$SP/tool" "$SP/po/PO-008148.pdf" "$RUN/tooltest" > "$RUN/logs/test_tool.log" 2>&1; rc=$?; cp "$RUN/logs/test_tool.log" "$LOGS/test_tool.log"
  [ $rc -eq 0 ] && echo "ok   test_tool.js (page in a plain browser)" || { echo "FAIL test_tool.js"; FAILED="$FAILED test_tool.js"; }
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
for n in ["resources/app/web/index.html"] + [n for n in names if n.startswith(("resources/app/web/js/", "resources/app/web/i18n/")) and n.endswith(".js")]:
    assert "Valkyrys Facturen" not in z.read(n).decode("utf8"), f"old name left in {n}"
for f in ("main.js", "app-main.js", "updater.js", "preload.js", "server.js", "mailfetch.js", "package.json", "web/index.html", "web/vendor/jszip.min.js", "splash/splash.html", "build/icon.png"): assert f"resources/app/{f}" in names, f
assert b"global.valkyrysLoader" in z.read("resources/app/main.js"), "resources/app/main.js is not the loader"
import json; pj = json.loads(z.read("resources/app/package.json")); ev = json.load(open(f"{sp}/electron-app/package.json"))["version"]
assert pj["version"] == ev and pj["main"] == "main.js", pj
print("payload ok:", len(names), "files")
PY
  ls -la out/Valkyrys-app-Setup.exe
}

cmd=${1:-help}; shift || true
case $cmd in
  build) build && src_stamp > "$STAMP";;
  fixtures) [ $# -eq 1 ] || { echo "usage: dev.sh fixtures DIR"; exit 2; }; fixtures "$1"; exit;;
  test)  [ $# -gt 0 ] || { echo "which tests? ($ELECTRON_TESTS)"; exit 2; }; build_if_changed || exit 1; run_tests "$@";;
  units) units;;
  all)   build_if_changed || exit 1; units; run_tests $ELECTRON_TESTS;;
  update) build && node tools/build_update.mjs "$@" || exit 1;;   # dev.sh update --no-notes: a quiet fix (no changelog entry of its own)
  installer) installer;;
  release) build || exit 1; src_stamp > "$STAMP"; units; run_tests $ELECTRON_TESTS
           if [ -n "$FAILED" ]; then echo; echo "NOT RELEASED, failing:$FAILED  (files: $RUN)"; exit 1; fi
           installer;;
  *) sed -n '2,18p' "$0"; exit 2;;
esac
if [ -n "$FAILED" ]; then echo; echo "FAILING:$FAILED"; [ -n "$RUN" ] && echo "test files kept in $RUN (logs in $RUN/logs)"; exit 1; fi
[ -n "$RUN" ] && [ "${KEEP:-0}" != 1 ] && rm -rf "$RUN"
echo; echo "ALL GOOD"
