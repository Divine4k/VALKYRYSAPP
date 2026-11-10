#!/bin/bash
# Fetch the Electron zips (kept in the "toolchain" branch of the repo) and set up dl/ and el/linux.
# Needed for the Electron window tests and for building the installer. dev.sh calls this by itself when they are missing.
set -eu
SP=$(cd "$(dirname "$0")/.." && pwd); cd "$SP"
if [ -f dl/win.zip ] && [ -x el/linux/electron ]; then echo "toolchain already there"; exit 0; fi
T=$(mktemp -d)
echo "fetching the toolchain branch (about 220 MB, can take a few minutes)..."
git clone -q --depth 1 --branch toolchain "$(git remote get-url origin)" "$T"
mkdir -p dl
for n in linux win; do cat "$T"/parts/$n.zip.part* > dl/$n.zip; done
( cd dl && sha256sum -c "$T/parts/SHA256-of-zips.txt" )
cp "$T/parts/SHASUMS256.txt" dl/
rm -rf "$T" el/linux; mkdir -p el
unzip -q dl/linux.zip -d el/linux
rm -f el/linux/resources/default_app.asar
mkdir -p el/linux/resources/app/build
cp electron-app/build/icon.png electron-app/build/icon.ico el/linux/resources/app/build/
echo '{ "name": "valkyrys-app", "productName": "Valkyrys app", "version": "1.0.0", "main": "main.js", "description": "Valkyrys app", "author": "Valkyrys" }' > el/linux/resources/app/package.json
echo "toolchain ready (the app files are copied in by: tools/dev.sh build)"
