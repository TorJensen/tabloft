@echo off
rem Starts the TabMind server in this window. Library: http://127.0.0.1:7878
cd /d "%~dp0"
node server\server.js
pause
