#!/bin/bash
# copy the current app files into the Linux Electron test copy
SP=$(cd "$(dirname "$0")/.." && pwd)
A=$SP/el/linux/resources/app
cp $SP/electron-app/main.js $SP/electron-app/preload.js $SP/electron-app/server.js $A/
rm -rf $A/web $A/splash && cp -r $SP/app/web $A/web && cp -r $SP/electron-app/splash $A/splash
