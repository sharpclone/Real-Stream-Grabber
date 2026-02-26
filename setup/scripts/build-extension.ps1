Param(
  [string]$SourceDir = (Join-Path $PSScriptRoot '..\..\extension'),
  [string]$OutDir = (Join-Path $PSScriptRoot '..\build'),
  [string]$OutName = 'realstreamgrabber.xpi'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $SourceDir)) {
  Write-Error "Extension folder not found: $SourceDir"
}

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

$zipPath = Join-Path $OutDir $OutName
if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($SourceDir, $zipPath)
Write-Host "Built $zipPath"
