@echo off
setlocal

cd /d "%~dp0"

echo Avvio Image Party Frame...

start "Image Party Frame API" cmd /k "npm.cmd run dev:server"
start "Image Party Frame UI" cmd /k "npm.cmd run dev"

echo.
echo Backend: http://localhost:3001
echo Frontend: http://localhost:5173
echo.
echo Le finestre dei server sono state aperte.

endlocal
