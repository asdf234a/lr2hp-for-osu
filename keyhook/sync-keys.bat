@echo off
title LR2 HP keybind sync
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is needed for keybind sync: https://nodejs.org
    pause
    exit /b 1
)
if not exist "%~dp0node_modules\realm" (
    echo Installing the realm package...
    pushd "%~dp0"
    call npm install --omit=dev --no-audit --no-fund
    popd
)
node "%~dp0sync-keys.mjs" %*
pause
