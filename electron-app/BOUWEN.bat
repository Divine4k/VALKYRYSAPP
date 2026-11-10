@echo off
title Valkyrys app bouwen
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this file again.
  pause & exit /b 1
)
echo Step 1 of 2: downloading the building tools (a few minutes the first time)...
call npm install
if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )
echo Step 2 of 2: building the app...
call npm run dist
if errorlevel 1 ( echo Build failed. & pause & exit /b 1 )
echo.
echo Done! Your app is in the "dist" folder:
echo   Valkyrys-app-1.0.0-nsis.exe      = installer (Start menu + desktop icon)
echo   Valkyrys-app-1.0.0-portable.exe  = single file, no install
explorer dist
pause
