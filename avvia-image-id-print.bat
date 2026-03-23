@echo off
start "REMBG Sidecar" cmd /k "cd /d "%~dp0apps\IMAGE ID PRINT" && avvia-rembg-sidecar.bat"
start "Image ID Print" cmd /k "cd /d "%~dp0apps\IMAGE ID PRINT" && npm run dev"
