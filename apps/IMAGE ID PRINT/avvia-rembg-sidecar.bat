@echo off
setlocal
cd /d "%~dp0ai-sidecar"

if not exist ".venv" (
  py -m venv .venv
)

call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
python rembg_server.py
