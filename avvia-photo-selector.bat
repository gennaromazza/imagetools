@echo off
cd /d %~dp0
call npm run dev --workspace=apps/photo-selector-app
