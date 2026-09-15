@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  start "" "index.html"
  exit /b
)
echo LogicKernel: http://localhost:4173
echo Keep this window open while using the local server.
node server.mjs
pause
