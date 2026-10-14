@echo off
rem Removes TabLoft's shortcuts and auto-start. Asks before touching your saved library.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
echo.
pause
