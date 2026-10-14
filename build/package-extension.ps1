# Packs the browser extension for the Chrome Web Store / Edge Add-ons:
#   dist\tabloft-extension-<version>.zip  (manifest.json at the root of the zip)
#
# Usage (from the repo root):  powershell -ExecutionPolicy Bypass -File build\package-extension.ps1

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Ext = Join-Path $Root 'extension'
$Dist = Join-Path $Root 'dist'
$manifest = Get-Content (Join-Path $Ext 'manifest.json') -Raw | ConvertFrom-Json
$Version = $manifest.version
if ($manifest.description.Length -gt 132) { throw "manifest description is $($manifest.description.Length) chars; the stores allow 132." }

New-Item -ItemType Directory -Force $Dist | Out-Null
$zip = Join-Path $Dist "tabloft-extension-$Version.zip"
Remove-Item $zip -ErrorAction SilentlyContinue

# Build the zip by hand so entries use forward slashes (Compress-Archive in Windows PowerShell
# writes backslashes, which the Chrome Web Store rejects).
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
try {
  Get-ChildItem $Ext -File -Recurse | ForEach-Object {
    $entry = $_.FullName.Substring($Ext.Length + 1).Replace('\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entry, 'Optimal')
  }
} finally { $archive.Dispose() }

$size = (Get-Item $zip).Length / 1KB
Write-Host ("Packed {0}  ({1:N0} KB)" -f $zip, $size) -ForegroundColor Green
