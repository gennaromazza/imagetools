@echo off
setlocal

cd /d "%~dp0"
title IMAGETOOLS - Selezione tool

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

echo.
echo ==============================
echo        IMAGETOOLS SUITE
echo ==============================
echo.
echo 1. Auto Layout App
echo 2. Image Party Frame
echo.
set /p TOOL_CHOICE=Seleziona il tool da avviare [1-2]: 

if "%TOOL_CHOICE%"=="1" (
  call "%~dp0avvia-auto-layout.bat"
  exit /b %errorlevel%
)

if "%TOOL_CHOICE%"=="2" (
  call "%~dp0avvia-image-party-frame.bat"
  exit /b %errorlevel%
)

echo Scelta non valida.
pause
exit /b 1
