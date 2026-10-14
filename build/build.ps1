# Builds the TabMind desktop installer:  dist\TabMind-Setup-<version>.exe
#
#   1. bundles server/ into one script (esbuild)
#   2. packs it plus ui/ into tabmind-server.exe, with Node built in (Node "single executable application")
#   3. compiles the tray app TabMind.exe (C# compiler that ships with Windows)
#   4. compiles the installer with Inno Setup (installed with winget if missing)
#
# Usage (from the repo root):  powershell -ExecutionPolicy Bypass -File build\build.ps1
# Needs: Node.js 24+ and `npm install` (dev tools only - the app itself has no dependencies).

param([switch]$SkipInstaller)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Out = Join-Path $PSScriptRoot 'out'
$Dist = Join-Path $Root 'dist'
Set-Location $Root
$Version = (Get-Content package.json -Raw | ConvertFrom-Json).version

function Step($m) { Write-Host ""; Write-Host "> $m" -ForegroundColor Cyan }
function Run($exe, [string[]]$a) {
  # Windows PowerShell treats any stderr output of a native tool as an error; judge by exit code only.
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $exe @a 2>&1 | ForEach-Object { "  $_" }
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  if ($code -ne 0) { throw "$exe failed with exit code $code" }
}

Write-Host "Building TabMind $Version" -ForegroundColor White
New-Item -ItemType Directory -Force -Path $Out, $Dist | Out-Null
Get-ChildItem $Out | Remove-Item -Recurse -Force
if (-not (Test-Path (Join-Path $Root 'node_modules\esbuild'))) { Step 'Installing build tools (npm install)'; Run npm.cmd @('install', '--no-fund', '--no-audit') }

# ------------------------------------------------------------------ 1. bundle
Step 'Bundling the server'
Run npx.cmd @('esbuild', 'server/server.js', '--bundle', '--platform=node', '--format=cjs', '--target=node22',
  "--outfile=$Out\server.cjs", '--log-level=warning', '--log-override:empty-import-meta=silent')

# ------------------------------------------------------------------ 2. single executable
Step 'Packing tabmind-server.exe (Node runtime + server + library UI)'
$assets = [ordered]@{}
Get-ChildItem ui -File -Recurse | ForEach-Object {
  $rel = $_.FullName.Substring($Root.Length + 1).Replace('\', '/')
  $assets[$rel] = $_.FullName
}
$seaConfig = [ordered]@{
  main = "$Out\server.cjs"
  output = "$Out\sea-prep.blob"
  disableExperimentalSEAWarning = $true
  useCodeCache = $false
  assets = $assets
}
$seaConfig | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 "$Out\sea-config.json"
Run node @('--experimental-sea-config', "$Out\sea-config.json")
$serverExe = Join-Path $Out 'tabmind-server.exe'
Copy-Item (Get-Command node).Source $serverExe
Run npx.cmd @('postject', $serverExe, 'NODE_SEA_BLOB', "$Out\sea-prep.blob",
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', '--overwrite')

# ------------------------------------------------------------------ 3. tray app
Step 'Compiling the tray app TabMind.exe'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
Run $csc @('-nologo', '-target:winexe', '-optimize', "-out:$Out\TabMind.exe", "-win32icon:$Root\assets\tabmind.ico",
  '-r:System.Windows.Forms.dll', '-r:System.Drawing.dll', '-r:System.Core.dll', '-r:System.Web.Extensions.dll', "$Root\desktop\TabMindTray.cs")

# ------------------------------------------------------------------ smoke test
Step 'Smoke-testing tabmind-server.exe'
$env:TABMIND_PORT = '7891'
$env:TABMIND_DATA = Join-Path $Out 'smoke-data'
$p = Start-Process $serverExe -PassThru -WindowStyle Hidden
try {
  $ok = $false
  for ($i = 0; $i -lt 40 -and -not $ok; $i++) {
    Start-Sleep -Milliseconds 250
    try { $ok = (Invoke-WebRequest "http://127.0.0.1:7891/" -UseBasicParsing -TimeoutSec 2).Content -match '<title>TabMind' } catch {}
  }
  if (-not $ok) { throw 'tabmind-server.exe did not serve the library page' }
  Write-Host '  [ok] server starts and serves the embedded library UI' -ForegroundColor Green
} finally {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  Remove-Item Env:TABMIND_PORT, Env:TABMIND_DATA
  Start-Sleep -Milliseconds 300
  Remove-Item (Join-Path $Out 'smoke-data') -Recurse -Force -ErrorAction SilentlyContinue
}

if ($SkipInstaller) { Write-Host "`nDone (installer skipped). Files in $Out"; exit 0 }

# ------------------------------------------------------------------ 4. installer
Step 'Building the installer (Inno Setup)'
$iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
          "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) {
  Write-Host '  Inno Setup not found - installing it with winget...'
  Run winget @('install', '--id', 'JRSoftware.InnoSetup', '--exact', '--silent', '--scope', 'user',
    '--accept-source-agreements', '--accept-package-agreements')
  $iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $iscc) { throw 'Inno Setup was not found after installing it.' }
}
Run $iscc @('/Q', "/DAppVersion=$Version", "/DRoot=$Root", "/DOut=$Out", "/O$Dist", "$PSScriptRoot\installer.iss")

$setup = Get-Item (Join-Path $Dist "TabMind-Setup-$Version.exe")
Write-Host ""
Write-Host ("Built {0}  ({1:N1} MB)" -f $setup.FullName, ($setup.Length / 1MB)) -ForegroundColor Green
