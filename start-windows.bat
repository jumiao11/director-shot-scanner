@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Please install Node.js from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
set PORT=5180
echo Starting Director Shot Scanner...
echo Local:   http://127.0.0.1:5180/?v=4
echo Keep this window open while using the website.
echo.
start "" "http://127.0.0.1:5180/?v=4"
node server.js
pause
