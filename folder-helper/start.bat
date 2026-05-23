@echo off
title Sena Folder Helper
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Download it from https://nodejs.org ^(LTS version^)
    pause
    exit /b 1
)

echo Starting Sena Folder Helper...
node server.js
if errorlevel 1 (
    echo.
    echo The helper stopped unexpectedly.
    pause
)
