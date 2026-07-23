@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Normalize a duplicated Path/PATH pair before Windows PowerShell builds
rem the child-process environment dictionary.
set "WENMI_SAVED_PATH=%PATH%"
set "Path="
set "PATH=%WENMI_SAVED_PATH%"
set "WENMI_SAVED_PATH="
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-desktop.ps1"
if errorlevel 1 pause
