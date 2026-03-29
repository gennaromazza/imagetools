@echo off
setlocal
cd /d "%~dp0ai-sidecar"

echo Arresto eventuali processi Python del sidecar...
taskkill /f /im python.exe >nul 2>&1
taskkill /f /im pythonw.exe >nul 2>&1

if exist ".venv" (
  echo Rimozione ambiente virtuale esistente...
  rmdir /s /q ".venv"
  if exist ".venv" (
    echo.
    echo Impossibile rimuovere .venv. Chiudi terminali, editor o processi che la stanno usando e riprova.
    exit /b 1
  )
)

echo Creazione nuovo ambiente virtuale...
py -m venv .venv
if errorlevel 1 goto :fail

call .venv\Scripts\activate.bat
if errorlevel 1 goto :fail

python -m pip install --upgrade pip
if errorlevel 1 goto :fail

echo Installazione dipendenze sidecar...
python -m pip install -r requirements.txt
if errorlevel 1 goto :fail

echo.
echo Sidecar AI ripristinato con successo.
echo Avvio del server...
python rembg_server.py
goto :eof

:fail
echo.
echo Reset sidecar AI fallito.
echo Controlla gli errori sopra e riprova.
exit /b 1
