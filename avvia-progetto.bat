@echo off
title FileX Dev Console
cd /d "%~dp0"

echo ============================================
echo   FileX Dev Console - Dashboard di sviluppo
echo ============================================
echo.

echo Chiudo la console precedente e i tool avviati da essa...
node scripts\dev-console-launcher.mjs prepare
if errorlevel 1 (
  echo.
  echo Avvio annullato: leggi il messaggio sopra.
  pause
  exit /b 1
)

echo.
echo Avvio console FileX: il browser si apre quando e' pronta ^(http://127.0.0.1:4390^)
start "" /b node scripts\dev-console-launcher.mjs open
npm run console

echo.
echo Console chiusa. Per ristartare: avvia-progetto.bat
pause
