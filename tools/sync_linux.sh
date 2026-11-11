#!/bin/bash
# copy the current app files (loader + app, as in the installer) into the Linux Electron test copy
SP=$(cd "$(dirname "$0")/.." && pwd)
python3 -I "$SP/tools/stage_app.py" "$SP/el/linux/resources/app" >/dev/null
