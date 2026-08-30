@echo off
setlocal
set "APP_ROOT=%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_ROOT%start-local.ps1" -NoBrowser
if errorlevel 1 exit /b 1

start "" "http://127.0.0.1:43180/"
exit /b 0
