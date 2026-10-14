@echo off
rem Double-click to install (or reinstall) TabMind on this computer.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
pause
