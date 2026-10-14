@echo off
rem Makes TabMind start silently every time you log in to Windows.
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%STARTUP%\TabMind.lnk'); $s.TargetPath='wscript.exe'; $s.Arguments='\"%~dp0tabmind-background.vbs\"'; $s.WorkingDirectory='%~dp0'; $s.Save()"
echo TabMind will now start automatically at login.
wscript.exe "%~dp0tabmind-background.vbs"
echo TabMind started. Library: http://127.0.0.1:7878
pause
