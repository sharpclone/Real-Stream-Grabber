Param(
  [string]$InstallDir
)

$ErrorActionPreference = 'Stop'

if (-not $InstallDir) {
  throw 'InstallDir is required'
}

$ytPath = Join-Path $InstallDir 'bin\yt-dlp.exe'
if (-not (Test-Path $ytPath)) {
  throw "yt-dlp not found at $ytPath"
}

$taskName = 'RealStreamGrabber YtDlp Update'
$cmd = "`"$ytPath`" -U"

schtasks.exe /Create /F /SC DAILY /ST 03:30 /TN $taskName /TR $cmd | Out-Null
Write-Host "Scheduled task '$taskName' created."
