#!/bin/bash
# Publishes a built in-app update (tools/dev.sh update) to the public updates repo, as plain files on its main branch:
#   tools/publish_update.sh 1.2.0 [CLONE]        CLONE = local clone of the updates repo (default $VALKYRYS_UPDATES_DIR or /home/claude/valkyrys-updates)
# Installed apps read https://raw.githubusercontent.com/<repo>/main/latest.json; the zip goes to packages/ (only the last 3 are kept).
# Needs push access to that repo (in a Claude session: attach Divine4k/valkyrys-updates with push access). Never copy keys/ there.
set -eu
SP=$(cd "$(dirname "$0")/.." && pwd); cd "$SP"
VER=${1:?usage: tools/publish_update.sh VERSION [CLONE]}
DEST=${2:-${VALKYRYS_UPDATES_DIR:-/home/claude/valkyrys-updates}}
M=out/update/latest.json Z=out/update/valkyrys-app-$VER.zip
[ -f "$M" ] && [ -f "$Z" ] || { echo "build it first: tools/dev.sh update"; exit 1; }
[ -d "$DEST/.git" ] || { echo "not a git clone: $DEST"; exit 1; }
node -e 'const U=require("./electron-app/updater.js"),m=require("./"+process.argv[1]); if(m.version!==process.argv[2]||!U.verify(m)||m.url!==U.ASSET_URL(m.version)){console.error("latest.json is not a signed manifest of "+process.argv[2]+" pointing at "+U.ASSET_URL(process.argv[2]));process.exit(1)}' "$M" "$VER"
cd "$DEST"
git fetch -q origin main && git checkout -q main && git rebase -q origin/main
mkdir -p packages
cp "$SP/$Z" packages/ && cp "$SP/$M" latest.json
# keep only the newest 3 packages (by version)
ls packages | grep -E '^valkyrys-app-[0-9]+\.[0-9]+\.[0-9]+\.zip$' | sed 's/^valkyrys-app-//; s/\.zip$//' | sort -t. -k1,1n -k2,2n -k3,3n | head -n -3 | while read -r v; do git rm -q -f "packages/valkyrys-app-$v.zip" 2>/dev/null || rm -f "packages/valkyrys-app-$v.zip"; done
git add latest.json packages
git commit -q -m "Valkyrys app $VER"
git push -q origin main
echo "published $VER to $(git remote get-url origin)"
