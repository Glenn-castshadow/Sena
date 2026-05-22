@echo off
echo Adding Windows Firewall rule for Sena Job Tracker (port 3000)...
echo This script must be run as Administrator.
echo.

netsh advfirewall firewall add rule ^
  name="Sena Job Tracker" ^
  protocol=TCP ^
  dir=in ^
  localport=3000 ^
  action=allow ^
  profile=private

if %errorlevel% == 0 (
  echo.
  echo  Done! Other devices on your network can now reach the app.
) else (
  echo.
  echo  Failed. Right-click this file and choose "Run as administrator".
)
echo.
pause
