@echo off
setlocal
cd /d "%~dp0"
node.exe -e "require('node:fs').writeFileSync('node-path.txt', '\uFEFF' + process.execPath, 'utf16le')"
if errorlevel 1 (
  echo Node.js 22 or newer must be available in this terminal.
  pause
  exit /b 1
)
echo Node.js path saved for UltraSquad.
