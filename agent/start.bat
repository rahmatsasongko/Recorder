@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies ^(first run, this downloads Cypress^)...
  call npm install
)
node server.js
pause
