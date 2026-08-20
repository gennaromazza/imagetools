@echo off
title FileX Dev Console
cd /d "%~dp0"

echo ============================================
echo   FileX Dev Console - Dashboard di sviluppo
echo ============================================
echo.

echo Avvio server dashboard su http://127.0.0.1:4390
start "" http://127.0.0.1:4390

echo Avvio console FileX in background...
npm run console

echo.
echo Console chiusa. Per ristartare: avvia-progetto.bat
pause