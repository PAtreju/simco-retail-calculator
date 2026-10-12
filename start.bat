@echo off
rem Windows: double-click to start the calculator with live price refresh. Close this window to stop.
cd /d "%~dp0"
start "" http://localhost:8765
node serve.mjs
pause
