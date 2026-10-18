@echo off
title LR2 HP key helper
rem Sync osu!'s mania key bindings to the overlay first (needs Node.js)
where node >nul 2>nul
if errorlevel 1 (
    echo Node.js not found: skipping keybind sync.
) else (
    if not exist "%~dp0node_modules\realm" (
        echo Installing the realm package for keybind sync...
        pushd "%~dp0"
        call npm install --omit=dev --no-audit --no-fund
        popd
    )
    node "%~dp0sync-keys.mjs" %*
)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lr2hp-keys.ps1"
pause
