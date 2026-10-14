; TabMind installer (Inno Setup 6). Built by build\build.ps1, which passes
; AppVersion, Root (repo folder) and Out (folder with TabMind.exe + tabmind-server.exe).
; Per-user install: no admin rights needed. The library itself lives in
; %LOCALAPPDATA%\TabMind and is kept on uninstall unless the user chooses otherwise.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{8F3C2A71-5B9E-4C1D-A6E2-7D4B9F1C3E58}
AppName=TabMind
AppVersion={#AppVersion}
AppVerName=TabMind {#AppVersion}
AppPublisher=Tor Jensen
AppComments=Send browser tabs to a local library with snapshots, then close them without fear.
PrivilegesRequired=lowest
DefaultDirName={autopf}\TabMind
DisableProgramGroupPage=yes
DisableDirPage=auto
DisableReadyPage=yes
OutputBaseFilename=TabMind-Setup-{#AppVersion}
SetupIconFile={#Root}\assets\tabmind.ico
UninstallDisplayIcon={app}\TabMind.exe
UninstallDisplayName=TabMind
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Tasks]
Name: "autostart"; Description: "Start TabMind automatically when I log in (recommended)"
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "{#Out}\TabMind.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Out}\tabmind-server.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Root}\extension\*"; DestDir: "{app}\extension"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Root}\README.md"; DestDir: "{app}"; Flags: ignoreversion

[InstallDelete]
; Leftovers from the older script-based install (install.cmd)
Type: files; Name: "{userstartup}\TabMind.lnk"
Type: filesandordirs; Name: "{userprograms}\TabMind"
; Extension files removed in newer versions
Type: filesandordirs; Name: "{app}\extension"

[Icons]
Name: "{autoprograms}\TabMind"; Filename: "{app}\TabMind.exe"; Comment: "Open your TabMind library"
Name: "{autodesktop}\TabMind"; Filename: "{app}\TabMind.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "TabMind"; \
  ValueData: """{app}\TabMind.exe"" --background"; Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{app}\TabMind.exe"; Parameters: "--setup-extension"; \
  Description: "Add the TabMind button to my browsers (Chrome, Brave, Edge)"; Flags: postinstall skipifsilent waituntilterminated
Filename: "{app}\TabMind.exe"; Description: "Start TabMind and open my library"; Flags: postinstall nowait skipifsilent
Filename: "{app}\TabMind.exe"; Parameters: "--background"; Flags: nowait skipifnotsilent

[Code]
procedure StopTabMind();
var
  Code: Integer;
begin
  // Tray app and packaged server (no /T: an in-app update runs this installer as the tray's child)
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM TabMind.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM tabmind-server.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
  // A server started by the older script-based install runs as node.exe: stop it only if it answers as TabMind
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -Command "try { if ((Invoke-RestMethod http://127.0.0.1:7878/api/health -TimeoutSec 2).app -eq ''TabMind'') ' +
    '{ Get-NetTCPConnection -LocalPort 7878 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force } } } catch {}"',
    '', SW_HIDE, ewWaitUntilTerminated, Code);
  Sleep(500);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopTabMind();
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  StopTabMind();
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    // The tray menu can switch autostart on even if the install task was unticked
    RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'TabMind');
    DataDir := ExpandConstant('{localappdata}\TabMind');
    if DirExists(DataDir) and not UninstallSilent() then
    begin
      if MsgBox('TabMind has been removed.' + #13#10#13#10 +
                'Your library (saved tabs and snapshots) is still in:' + #13#10 + DataDir + #13#10#13#10 +
                'Do you also want to DELETE your library? This cannot be undone.' + #13#10 +
                'Choose No to keep it - reinstalling TabMind will pick it up again.',
                mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(DataDir, True, True, True);
    end;
    MsgBox('To finish, remove the TabMind extension in each browser (Extensions page > Remove).',
           mbInformation, MB_OK);
  end;
end;
