@echo off
REM Avvio AlbumWiew in modalità sviluppo (Vite + Electron)
cd /d %~dp0
call npm install
start cmd /k "npm run dev"
