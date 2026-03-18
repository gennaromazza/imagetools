@echo off
setlocal

cd /d "%~dp0"
title IMAGETOOLS - Image Party Frame

where npm >nul 2>nul
if errorlevel 1 (
  echo npm non trovato. Installa Node.js e riprova.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Dipendenze non trovate. Avvio l'installazione...
  call npm install
  if errorlevel 1 (
    echo Installazione fallita.
    pause
    exit /b 1
  )
)

echo Avvio Image Party Frame...
call npm run dev:all:image-party-frame

if errorlevel 1 (
  echo.
  echo Il tool si e' chiuso con un errore.
  pause
)
