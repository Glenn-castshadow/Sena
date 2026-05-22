@echo off
cd /d "%~dp0"
echo Starting Sena Job Tracker...

:: Find local IP and show the LAN address
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
  set IP=%%a
  goto :found
)
:found
set IP=%IP: =%

echo.
echo  Local:   http://localhost:3000
echo  Network: http://%IP%:3000
echo.
echo  Press Ctrl+C to stop the server.
echo.

start "" "http://localhost:3000"
node server.js
pause
