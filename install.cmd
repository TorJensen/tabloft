@echo off
rem Double-click to install (or reinstall) TabLoft on this computer.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
pause
