Param(
  [string]$SourceRoot,
  [string]$InstallDir = "$env:ProgramFiles\RealStreamGrabber"
)

$ErrorActionPreference = 'Stop'

if (-not $SourceRoot) {
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  $SourceRoot = Resolve-Path (Join-Path $scriptDir '..\..')
}

$sourceNativeDir = Join-Path $SourceRoot 'native'
$targetNativeDir = Join-Path $InstallDir 'native'

if (-not (Test-Path $sourceNativeDir)) {
  throw "Source native directory not found: $sourceNativeDir"
}

if (-not (Test-Path $targetNativeDir)) {
  throw "Target native directory not found: $targetNativeDir"
}

$hostPySource = Join-Path $sourceNativeDir 'host.py'
$hostCmdSource = Join-Path $sourceNativeDir 'host.cmd'
$hostPyTarget = Join-Path $targetNativeDir 'host.py'
$hostCmdTarget = Join-Path $targetNativeDir 'host.cmd'

if (-not (Test-Path $hostPySource)) {
  throw "host.py not found in source: $hostPySource"
}

Copy-Item -Path $hostPySource -Destination $hostPyTarget -Force
Write-Host "Copied host.py -> $hostPyTarget"

if (Test-Path $hostCmdSource) {
  Copy-Item -Path $hostCmdSource -Destination $hostCmdTarget -Force
  Write-Host "Copied host.cmd -> $hostCmdTarget"
}

$writeManifestScript = Join-Path $SourceRoot 'setup\scripts\write-native-manifest.ps1'
$registerScript = Join-Path $SourceRoot 'setup\scripts\register-native-host.ps1'

if (Test-Path $writeManifestScript) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $writeManifestScript -InstallDir $InstallDir
}

if (Test-Path $registerScript) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $registerScript
}

Write-Host "Native host sync complete."
