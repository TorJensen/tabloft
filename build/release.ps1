# Publishes a TabMind release on GitHub so installed copies offer it as an update.
#
#   1. bump "version" in package.json and extension/manifest.json (and the tray's AssemblyVersion)
#   2. commit and push to main
#   3. powershell -ExecutionPolicy Bypass -File build\release.ps1 -Notes "What changed, in a sentence or two"
#
# Builds the installer, then creates release v<version> with TabMind-Setup-<version>.exe attached.
# Needs the GitHub CLI (gh), signed in.

param([Parameter(Mandatory = $true)][string]$Notes, [switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root
$Version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$ExtVersion = (Get-Content extension\manifest.json -Raw | ConvertFrom-Json).version
$TrayVersion = [regex]::Match((Get-Content desktop\TabMindTray.cs -Raw), 'AssemblyVersion\("(\d+\.\d+\.\d+)').Groups[1].Value
if ($ExtVersion -ne $Version -or $TrayVersion -ne $Version) {
  throw "Versions differ: package.json $Version, extension $ExtVersion, tray $TrayVersion. Make them match first."
}
if (git status --porcelain) { throw 'You have uncommitted changes. Commit and push them first.' }
$branch = git rev-parse --abbrev-ref HEAD
if ($branch -ne 'main') { throw "Releases are made from main (you are on $branch)." }
$ErrorActionPreference = 'Continue'   # gh writes "release not found" to stderr, which is the good case here
& gh release view "v$Version" *> $null
$exists = $LASTEXITCODE -eq 0
$ErrorActionPreference = 'Stop'
if ($exists) { throw "Release v$Version already exists. Bump the version first." }

if (-not $SkipBuild) { & "$PSScriptRoot\build.ps1"; if ($LASTEXITCODE) { throw 'Build failed' } }
$setup = Join-Path $Root "dist\TabMind-Setup-$Version.exe"
if (-not (Test-Path $setup)) { throw "Missing $setup" }

& gh release create "v$Version" $setup --title "TabMind $Version" --notes $Notes --target main
if ($LASTEXITCODE) { throw 'gh release create failed' }
Write-Host "Released TabMind $Version. Installed copies will offer it within 12 hours (or via tray > Check for updates)." -ForegroundColor Green
