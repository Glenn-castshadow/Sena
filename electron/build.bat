@echo off
title Build Sena Job Tracker
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Download it from https://nodejs.org ^(LTS version^)
    pause
    exit /b 1
)

echo Installing dependencies...
call npm install
if errorlevel 1 goto error

echo.
echo Building Sena Job Tracker...
call npm run build
if errorlevel 1 goto error

echo.
echo ============================================================
echo  Done!  dist\Sena Job Tracker-win32-x64\ is ready.
echo  Zip that folder and distribute to LAN users.
echo  Users extract anywhere and run Sena Job Tracker.exe
echo ============================================================
echo.
pause
exit /b 0

:error
echo.
echo Build failed — see errors above.
pause
exit /b 1
