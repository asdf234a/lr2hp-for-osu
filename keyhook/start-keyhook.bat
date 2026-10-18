@echo off
title LR2 HP key helper
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lr2hp-keys.ps1" %*
pause
