Param(
  [string]$ManifestPath
)

$ErrorActionPreference = 'Stop'

if (-not $ManifestPath) {
  $ManifestPath = Join-Path $env:APPDATA 'Mozilla\NativeMessagingHosts\com.realstreamgrabber.mediagrabber.json'
}

if (-not (Test-Path $ManifestPath)) {
  throw "Manifest not found at $ManifestPath"
}

$regPath = 'HKCU:\Software\Mozilla\NativeMessagingHosts\com.realstreamgrabber.mediagrabber'
New-Item -Path $regPath -Force | Out-Null
New-ItemProperty -Path $regPath -Name '(default)' -Value $ManifestPath -PropertyType String -Force | Out-Null

Write-Host "Registered native host in HKCU at $regPath"
