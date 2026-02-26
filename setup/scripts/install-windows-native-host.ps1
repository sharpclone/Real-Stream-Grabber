Param(
  [string]$InstallDir = "$env:ProgramFiles\RealStreamGrabber"
)

$ErrorActionPreference = 'Stop'

function Write-Step($message) {
  Write-Host "==> $message"
}

function Ensure-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script from an elevated PowerShell (Run as Administrator).'
  }
}

function Ensure-Dir($path) {
  if (-not (Test-Path $path)) {
    New-Item -ItemType Directory -Path $path | Out-Null
  }
}

function Add-MachinePathEntry($entry) {
  if (-not (Test-Path $entry)) {
    return
  }

  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  if (-not $machinePath) {
    $machinePath = ''
  }

  $parts = $machinePath -split ';' | Where-Object { $_ -ne '' }
  $exists = $false
  foreach ($part in $parts) {
    if ($part.TrimEnd('\').ToLowerInvariant() -eq $entry.TrimEnd('\').ToLowerInvariant()) {
      $exists = $true
      break
    }
  }
  if ($exists) {
    return
  }

  $newPath = if ($machinePath) { "$machinePath;$entry" } else { $entry }
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'Machine')
  $env:Path = "$env:Path;$entry"
  Write-Host "Added to machine PATH: $entry"
}

function Test-Command($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

Ensure-Admin

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir '..\..')

if (Test-Path $InstallDir) {
  $InstallDir = (Resolve-Path $InstallDir).Path
} else {
  $InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
}

$nativeSourceDir = Join-Path $repoRoot 'native'
$nativeTargetDir = Join-Path $InstallDir 'native'
$hostPySource = Join-Path $nativeSourceDir 'host.py'
$hostCmdSource = Join-Path $nativeSourceDir 'host.cmd'
$hostPyTarget = Join-Path $nativeTargetDir 'host.py'
$hostCmdTarget = Join-Path $nativeTargetDir 'host.cmd'

if (-not (Test-Path $hostPySource)) {
  throw "Source file not found: $hostPySource"
}
if (-not (Test-Path $hostCmdSource)) {
  throw "Source file not found: $hostCmdSource"
}

Write-Step "Installing native host files into $InstallDir"
Ensure-Dir $InstallDir
Ensure-Dir $nativeTargetDir
Ensure-Dir (Join-Path $InstallDir 'bin')
Ensure-Dir (Join-Path $InstallDir 'assets')

Copy-Item -Path $hostPySource -Destination $hostPyTarget -Force
Copy-Item -Path $hostCmdSource -Destination $hostCmdTarget -Force

$downloadDepsScript = Join-Path $repoRoot 'setup\scripts\download-deps.ps1'
if (-not (Test-Path $downloadDepsScript)) {
  throw "Script not found: $downloadDepsScript"
}

Write-Step 'Checking/downloading dependencies (Python, Node.js, yt-dlp, ffmpeg)'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $downloadDepsScript -InstallDir $InstallDir

Write-Step 'Ensuring local dependency folders are available on machine PATH'
$pathCandidates = @(
  (Join-Path $InstallDir 'bin'),
  (Join-Path $InstallDir 'bin\python'),
  (Join-Path $InstallDir 'bin\node'),
  (Join-Path $InstallDir 'bin\ffmpeg')
)
foreach ($candidate in $pathCandidates) {
  Add-MachinePathEntry $candidate
}

$writeManifestScript = Join-Path $repoRoot 'setup\scripts\write-native-manifest.ps1'
$registerScript = Join-Path $repoRoot 'setup\scripts\register-native-host.ps1'

if (-not (Test-Path $writeManifestScript)) {
  throw "Script not found: $writeManifestScript"
}
if (-not (Test-Path $registerScript)) {
  throw "Script not found: $registerScript"
}

Write-Step "Writing native host manifest for $InstallDir"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $writeManifestScript -InstallDir $InstallDir

Write-Step 'Registering native host in HKCU'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $registerScript

Write-Step 'Final dependency status'
$pythonOk = (Test-Command 'python') -or (Test-Command 'py') -or (Test-Path (Join-Path $InstallDir 'bin\python\python.exe'))
$nodeOk = (Test-Command 'node') -or (Test-Path (Join-Path $InstallDir 'bin\node\node.exe'))
$ytdlpOk = (Test-Command 'yt-dlp') -or (Test-Path (Join-Path $InstallDir 'bin\yt-dlp.exe'))
$ffmpegOk = (Test-Command 'ffmpeg') -or (Test-Path (Join-Path $InstallDir 'bin\ffmpeg\ffmpeg.exe'))

Write-Host "python: $pythonOk"
Write-Host "node: $nodeOk"
Write-Host "yt-dlp: $ytdlpOk"
Write-Host "ffmpeg: $ffmpegOk"

Write-Host ''
Write-Host 'Done. Now install the signed XPI from Releases and restart Firefox.'
