# Removes TabLoft's shortcuts and auto-start and stops the server.
# Your saved library is kept unless you choose to delete it.

param([switch]$Yes, [switch]$DeleteData)

$ErrorActionPreference = 'Stop'
$Port = 7878
$StartMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'

$dataDir = $null
try { $dataDir = (Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2).data } catch {}

Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Remove-Item (Join-Path $StartMenu 'Startup\TabLoft.lnk') -ErrorAction SilentlyContinue
Remove-Item (Join-Path $StartMenu 'TabLoft') -Recurse -Force -ErrorAction SilentlyContinue
Write-Host '[ok] TabLoft stopped; shortcuts and auto-start removed.' -ForegroundColor Green

if (-not $dataDir) { $dataDir = Join-Path $env:LOCALAPPDATA 'TabLoft' }
if (Test-Path $dataDir) {
  Write-Host "Your library (saved tabs and snapshots) is in: $dataDir"
  $delete = $DeleteData
  if (-not $Yes -and -not $DeleteData) {
    $a = Read-Host 'Delete your library too? This cannot be undone. Type DELETE to confirm, or press Enter to keep it'
    $delete = $a -ceq 'DELETE'
  }
  if ($delete) {
    Remove-Item $dataDir -Recurse -Force
    Write-Host '[ok] Library deleted.' -ForegroundColor Green
  } else {
    Write-Host '[ok] Library kept. Reinstalling TabLoft will pick it up again.' -ForegroundColor Green
  }
}
Write-Host ''
Write-Host 'To finish, remove the TabLoft extension in each browser (Extensions page > Remove).'
Write-Host 'You can then delete the TabLoft program folder.'
