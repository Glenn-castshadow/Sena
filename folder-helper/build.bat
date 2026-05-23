@echo off
title Build Sena Folder Helper
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Download it from https://nodejs.org ^(LTS version^)
    pause
    exit /b 1
)

echo Installing build tools...
call npm install
if errorlevel 1 goto error

echo.
echo Building SenaFolderHelper.exe ^(this may take a minute^)...
call npm run build
if errorlevel 1 goto error

echo.
echo Patching subsystem to suppress console window...
node scripts\set-gui-subsystem.js dist\SenaFolderHelper.exe
if errorlevel 1 (
    echo WARNING: Subsystem patch failed — console window will flash briefly on launch.
)

echo.
echo ============================================================
echo  Done!  dist\SenaFolderHelper.exe is ready to distribute.
echo
echo  Users download it from:  http://10.0.7.62:3000/helper
echo ============================================================
echo.
pause
exit /b 0

:error
echo.
echo Build failed — see errors above.
pause
exit /b 1
