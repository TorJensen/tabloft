@echo off
rem Gets the latest TabMind from GitHub and restarts it. Your library is not touched.
cd /d "%~dp0"
where git >nul 2>nul || (echo Git is not installed - download the new version manually instead. & pause & exit /b 1)
git pull --ff-only || (echo Update failed - see the message above. & pause & exit /b 1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -NoBrowserSetup -Yes
echo.
echo If the browser extension changed, click the reload arrow on the TabMind card
echo on each browser's Extensions page.
pause
