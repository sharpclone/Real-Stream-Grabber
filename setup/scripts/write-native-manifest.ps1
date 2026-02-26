Param(
  [string]$InstallDir
)

$ErrorActionPreference = 'Stop'

if (-not $InstallDir) {
  throw 'InstallDir is required'
}

$hostPath = Join-Path $InstallDir 'native\host.cmd'
$manifestDir = Join-Path $env:APPDATA 'Mozilla\NativeMessagingHosts'
if (-not (Test-Path $manifestDir)) {
  New-Item -ItemType Directory -Path $manifestDir | Out-Null
}

$manifestPath = Join-Path $manifestDir 'com.realstreamgrabber.mediagrabber.json'
$manifest = @{
  name = 'com.realstreamgrabber.mediagrabber'
  description = 'Native host that relays download requests to yt-dlp.'
  path = $hostPath
  type = 'stdio'
  allowed_extensions = @('cazacmihaihack@gmail.com')
}

$json = $manifest | ConvertTo-Json -Depth 6
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllBytes($manifestPath, $utf8NoBom.GetBytes($json))
Write-Host "Wrote native host manifest to $manifestPath"
