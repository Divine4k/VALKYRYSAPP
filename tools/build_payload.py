import os, shutil, zipfile, sys, subprocess
SP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, f"{SP}/tools")
import patch_exe
STAGE = f"{SP}/el/stage"
shutil.rmtree(STAGE, ignore_errors=True)
subprocess.check_call(["unzip", "-q", f"{SP}/dl/win.zip", "-d", STAGE])
# keep a few interface languages only
keep = {"en-US.pak", "en-GB.pak", "nl.pak", "pl.pak"}
for f in os.listdir(f"{STAGE}/locales"):
    if f not in keep: os.remove(f"{STAGE}/locales/{f}")
os.remove(f"{STAGE}/resources/default_app.asar") if os.path.exists(f"{STAGE}/resources/default_app.asar") else None
import stage_app
VER = stage_app.stage(f"{STAGE}/resources/app")   # loader as resources/app/main.js, the app (app-main.js ...) next to it
S = [("CompanyName", "Valkyrys"), ("FileDescription", "Valkyrys app"), ("FileVersion", VER), ("InternalName", "Valkyrys app"),
     ("LegalCopyright", "Valkyrys"), ("OriginalFilename", "Valkyrys app.exe"), ("ProductName", "Valkyrys app"), ("ProductVersion", VER)]
patch_exe.patch(f"{STAGE}/electron.exe", f"{STAGE}/Valkyrys app.exe", f"{SP}/electron-app/build/icon.ico", S, tuple(map(int, VER.split("."))) + (0,))
os.remove(f"{STAGE}/electron.exe")
out = f"{SP}/installer/payload/app.zip"
os.makedirs(os.path.dirname(out), exist_ok=True)
if os.path.exists(out): os.remove(out)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for r, ds, fs in os.walk(STAGE):
        for f in sorted(fs):
            p = os.path.join(r, f); z.write(p, os.path.relpath(p, STAGE).replace(os.sep, "/"))
print("payload", os.path.getsize(out) // 1048576, "MB;", sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(STAGE) for f in fs) // 1048576, "MB unpacked")
