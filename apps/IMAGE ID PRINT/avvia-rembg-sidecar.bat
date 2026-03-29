@echo off
setlocal
cd /d "%~dp0ai-sidecar"

if not exist ".venv" (
  py -m venv .venv
  if errorlevel 1 goto :fail
)

call .venv\Scripts\activate.bat
if errorlevel 1 goto :fail

python -c "import numpy, rembg, onnxruntime, cv2, flask, flask_cors" >nul 2>&1
if not errorlevel 1 goto :run

python -m pip install --upgrade pip
if errorlevel 1 goto :fail

echo Dipendenze sidecar mancanti o non aggiornate. Installazione in corso...
python -m pip install -r requirements.txt
if errorlevel 1 goto :fail

:run
python rembg_server.py
goto :eof

:fail
echo.
echo Installazione sidecar AI fallita.
echo Se vedi file bloccati o WinError 32, esegui reset-rembg-sidecar.bat.
echo Controlla gli errori sopra e poi riavvia questo script.
exit /b 1
