@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo.
echo  Script DM platform:  http://127.0.0.1:3000
echo.
node server.js
pause
