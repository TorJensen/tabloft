# TabMind installer for Windows.
# Installs/updates TabMind from this folder: checks Node.js, sets up shortcuts and
# auto-start, starts the server and walks you through adding the browser extension.
# Safe to run again at any time (that is also how updates are applied).
#
#   install.cmd                      normal interactive install
#   install.cmd -Yes                 don't ask questions (accept defaults)
#   install.cmd -NoAutostart         don't start TabMind at login
#   install.cmd -NoBrowserSetup      skip the extension walkthrough (used by update.cmd)

param([switch]$Yes, [switch]$NoAutostart, [switch]$NoBrowserSetup)

$ErrorActionPreference = 'Stop'
$App = $PSScriptRoot
$Port = 7878
$Url = "http://127.0.0.1:$Port"
$MinNode = [version]'22.13'
$StartMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$StartupLnk = Join-Path $StartMenu 'Startup\TabMind.lnk'
$MenuDir = Join-Path $StartMenu 'TabMind'

function Step($m) { Write-Host ""; Write-Host "> $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "  [ok] $m" -ForegroundColor Green }
function Note($m) { Write-Host "       $m" }
function Warn($m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }
function Ask($q, $default = $true) {
  if ($Yes) { return $default }
  $hint = if ($default) { '[Y/n]' } else { '[y/N]' }
  $a = Read-Host "  $q $hint"
  if ([string]::IsNullOrWhiteSpace($a)) { return $default }
  return $a -match '^(y|yes)$'
}

function Get-NodeVersion {
  try {
    $v = & node --version 2>$null
    if ($v -match '^v(\d+)\.(\d+)') { return [version]"$($Matches[1]).$($Matches[2])" }
  } catch {}
  return $null
}

function Test-TabMind {
  try {
    $r = Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 2
    return $r.app -eq 'TabMind'
  } catch { return $false }
}

function New-Shortcut($path, $target, $arguments, $description) {
  $s = (New-Object -ComObject WScript.Shell).CreateShortcut($path)
  $s.TargetPath = $target
  $s.Arguments = $arguments
  $s.WorkingDirectory = $App
  $s.IconLocation = (Join-Path $App 'assets\tabmind.ico')
  $s.Description = $description
  $s.Save()
}

Write-Host "TabMind installer" -ForegroundColor White
Note "Program folder: $App"

# ---------------------------------------------------------------- 1. Node.js
Step 'Checking Node.js'
$v = Get-NodeVersion
if (-not $v -or $v -lt $MinNode) {
  if ($v) { Warn "Node.js $v is too old (TabMind needs $MinNode or newer)." } else { Warn 'Node.js is not installed.' }
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget -and (Ask 'Install the current Node.js LTS now using winget?')) {
    & winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    $v = Get-NodeVersion
  }
  if (-not $v -or $v -lt $MinNode) {
    Warn 'Please install Node.js LTS from https://nodejs.org and run this installer again.'
    exit 1
  }
}
Ok "Node.js $v"

# ---------------------------------------------------------------- 2. Stop a running copy
Step 'Preparing'
if (Test-TabMind) {
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 800
  Ok 'Stopped the running TabMind so the new version can start'
} elseif (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  Warn "Port $Port is used by another program. Close it and run the installer again."
  exit 1
} else {
  Ok 'Nothing to stop'
}

# ---------------------------------------------------------------- 3. Shortcuts
Step 'Creating shortcuts'
New-Item -ItemType Directory -Force -Path $MenuDir | Out-Null
New-Shortcut (Join-Path $MenuDir 'TabMind Library.lnk') 'wscript.exe' "`"$App\tabmind-open.vbs`"" 'Open your TabMind library'
New-Shortcut (Join-Path $MenuDir 'Uninstall TabMind.lnk') 'cmd.exe' "/c `"$App\uninstall.cmd`"" 'Remove TabMind from this computer'
Ok 'Start Menu > TabMind > TabMind Library'

if ($NoAutostart) {
  Remove-Item $StartupLnk -ErrorAction SilentlyContinue
  Note 'Auto-start skipped (-NoAutostart)'
} else {
  New-Shortcut $StartupLnk 'wscript.exe' "`"$App\tabmind-background.vbs`"" 'Start the TabMind server at login'
  Ok 'TabMind will start automatically when you log in'
}

# ---------------------------------------------------------------- 4. Start
Step 'Starting TabMind'
Start-Process wscript.exe -ArgumentList "`"$App\tabmind-background.vbs`""
$up = $false
for ($i = 0; $i -lt 40 -and -not $up; $i++) { Start-Sleep -Milliseconds 250; $up = Test-TabMind }
if (-not $up) {
  Warn 'The server did not start. Run start-tabmind.cmd to see the error.'
  exit 1
}
$health = Invoke-RestMethod -Uri "$Url/api/health"
Ok "Running at $Url"
Note "Your library is stored in: $($health.data)"

# ---------------------------------------------------------------- 5. Browser extension
if (-not $NoBrowserSetup) {
  Step 'Adding the TabMind button to your browsers'
  $ext = Join-Path $App 'extension'
  $browsers = @(
    @{ Name = 'Google Chrome'; Page = 'chrome://extensions'; Paths = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") },
    @{ Name = 'Brave'; Page = 'brave://extensions'; Paths = @(
        "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
        "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe",
        "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe") },
    @{ Name = 'Microsoft Edge'; Page = 'edge://extensions'; Paths = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") }
  )
  $found = @()
  foreach ($b in $browsers) {
    $exe = $b.Paths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($exe) { $found += @{ Name = $b.Name; Page = $b.Page; Exe = $exe } }
  }
  if (-not $found.Count) {
    Warn 'No Chrome, Brave or Edge installation found.'
  } else {
    Note ('Found: ' + (($found | ForEach-Object { $_.Name }) -join ', '))
    Note ''
    Note 'For each browser, its Extensions page will open. Then:'
    Note '  1. Turn on "Developer mode" (a switch at the top right or bottom left)'
    Note '  2. Click "Load unpacked"'
    Note '  3. Paste the folder path (already copied for you: Ctrl+V) and click Select Folder'
    Note '  4. Click the puzzle-piece icon and pin TabMind to the toolbar'
    Note ''
    Note "Extension folder: $ext"
    Note 'Already added it before? Just click the reload arrow on the TabMind card instead.'
    foreach ($b in $found) {
      if (-not (Ask "Set up $($b.Name) now?")) { continue }
      Set-Clipboard -Value $ext
      Start-Process -FilePath $b.Exe -ArgumentList $b.Page
      if (-not $Yes) { Read-Host "  Press Enter when TabMind is added to $($b.Name)" | Out-Null }
    }
  }
}

# ---------------------------------------------------------------- Done
Step 'Done'
Ok 'TabMind is installed.'
Note 'Open the library any time from Start Menu > TabMind Library.'
Note 'Save tabs with the TabMind button in your browser, or Alt+Shift+S.'
if (-not $NoBrowserSetup -and (Ask 'Open the library now?')) { Start-Process $Url }
