# Assembles the app folder that ships as resources/app: the loader (main.js) plus the real app next to it. Used by build_payload.py (installer),
# build_update.mjs (update zip = this folder minus main.js) and sync_linux.sh (Linux test copy).   python3 -I tools/stage_app.py DEST [VERSION]
import json, os, shutil, sys
SP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOADER = "main.js"
APP_FILES = ["app-main.js", "updater.js", "preload.js", "server.js"]

def version():
    return json.load(open(f"{SP}/electron-app/package.json"))["version"]

def stage(dest, ver=None):
    ver = ver or version()
    shutil.rmtree(dest, ignore_errors=True)
    os.makedirs(f"{dest}/build")
    for f in [LOADER] + APP_FILES: shutil.copy(f"{SP}/electron-app/{f}", f"{dest}/{f}")
    shutil.copytree(f"{SP}/app/web", f"{dest}/web")
    shutil.copytree(f"{SP}/electron-app/splash", f"{dest}/splash")
    for f in ["icon.png", "icon.ico"]: shutil.copy(f"{SP}/electron-app/build/{f}", f"{dest}/build/{f}")
    pj = {"name": "valkyrys-app", "productName": "Valkyrys app", "version": ver, "main": LOADER, "minLoader": 1, "description": "Valkyrys app", "author": "Valkyrys"}
    open(f"{dest}/package.json", "w").write(json.dumps(pj) + "\n")
    return ver

if __name__ == "__main__":
    print(stage(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None))
