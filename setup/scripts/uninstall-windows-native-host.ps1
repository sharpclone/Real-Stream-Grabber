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

function Remove-MachinePathEntry($entry) {
  if (-not $entry) {
    return
  }

  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  if (-not $machinePath) {
    return
  }

  $parts = $machinePath -split ';' | Where-Object { $_ -ne '' }
  $filtered = @()
  foreach ($part in $parts) {
    if ($part.TrimEnd('\').ToLowerInvariant() -ne $entry.TrimEnd('\').ToLowerInvariant()) {
      $filtered += $part
    }
  }

  $newPath = ($filtered -join ';')
  if ($newPath -ne $machinePath) {
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'Machine')
    Write-Host "Removed from machine PATH: $entry"
  }
}

Ensure-Admin

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir '..\..')

if (Test-Path $InstallDir) {
  $InstallDir = (Resolve-Path $InstallDir).Path
} else {
  $InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
}

$unregisterScript = Join-Path $repoRoot 'setup\scripts\unregister-native-host.ps1'
$removePolicyScript = Join-Path $repoRoot 'setup\scripts\remove-firefox-policy.ps1'
$unregisterTaskScript = Join-Path $repoRoot 'setup\scripts\unregister-yt-dlp-task.ps1'

Write-Step 'Unregistering native host registry entries'
if (Test-Path $unregisterScript) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $unregisterScript
}

$manifestPath = Join-Path $env:APPDATA 'Mozilla\NativeMessagingHosts\com.realstreamgrabber.mediagrabber.json'
if (Test-Path $manifestPath) {
  Remove-Item $manifestPath -Force
  Write-Host "Removed manifest: $manifestPath"
}

Write-Step 'Removing legacy Firefox policies entry (if present)'
if (Test-Path $removePolicyScript) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $removePolicyScript
}

Write-Step 'Removing updater task (if present)'
if (Test-Path $unregisterTaskScript) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $unregisterTaskScript
}

Write-Step 'Cleaning Program Files install folder'
if (Test-Path $InstallDir) {
  $pathCandidates = @(
    (Join-Path $InstallDir 'bin'),
    (Join-Path $InstallDir 'bin\python'),
    (Join-Path $InstallDir 'bin\node'),
    (Join-Path $InstallDir 'bin\ffmpeg')
  )
  foreach ($candidate in $pathCandidates) {
    Remove-MachinePathEntry $candidate
  }

  Remove-Item $InstallDir -Recurse -Force
  Write-Host "Removed install dir: $InstallDir"
}

Write-Host ''
Write-Host 'Done. You can now remove the add-on from Firefox (about:addons) if needed.'
