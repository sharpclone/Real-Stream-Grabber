Param(
  [string]$FirefoxDir
)

$ErrorActionPreference = 'Stop'

function Write-Log($message) {
  $logDir = Join-Path $env:LOCALAPPDATA 'RealStreamGrabber'
  if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
  }
  $logPath = Join-Path $logDir 'uninstall-policy.log'
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -Path $logPath -Value "$timestamp $message"
}

function Get-FirefoxDirs {
  $dirs = @()
  $regKeys = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe'
  )
  foreach ($key in $regKeys) {
    try {
      $value = (Get-ItemProperty -Path $key -ErrorAction SilentlyContinue).'(default)'
      if ($value) {
        $dir = Split-Path $value -Parent
        if ($dir -and (Test-Path $dir)) { $dirs += $dir }
      }
    } catch {}
  }
  $fallbacks = @(
    "C:\Program Files\Mozilla Firefox",
    "C:\Program Files (x86)\Mozilla Firefox"
  )
  foreach ($path in $fallbacks) {
    if (Test-Path $path) { $dirs += $path }
  }
  return $dirs | Select-Object -Unique
}

function Write-JsonNoBom($path, $content) {
  $json = $content | ConvertTo-Json -Depth 10
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllBytes($path, $utf8NoBom.GetBytes($json))
}

$targets = @()
if ($FirefoxDir) {
  $targets += $FirefoxDir
} else {
  $targets += Get-FirefoxDirs
}

if (-not $targets) {
  Write-Log 'Firefox not found.'
  exit 0
}

foreach ($root in $targets) {
  Write-Log "Inspecting $root"
  $policyPath = Join-Path $root 'distribution\policies.json'
  $backupPath = "$policyPath.bak"
  if (Test-Path $backupPath) {
    try {
      $bakRaw = Get-Content $backupPath -Raw -ErrorAction Stop
      $bakJson = $bakRaw | ConvertFrom-Json -ErrorAction Stop
      $bakHasExtension = $false
      if ($bakJson.policies -and $bakJson.policies.ExtensionSettings) {
        $bakHasExtension = $bakJson.policies.ExtensionSettings.PSObject.Properties.Name -contains 'cazacmihaihack@gmail.com'
      }
      if (-not $bakHasExtension) {
        Copy-Item $backupPath $policyPath -Force
        Remove-Item $backupPath -Force
        Write-Log "Restored backup to $policyPath"
        continue
      }
      Write-Log "Backup contains RealStreamGrabber policy; skipping restore."
    } catch {
      Write-Log "Failed to inspect backup for $policyPath: $($_.Exception.Message)"
    }
  }
  if (Test-Path $policyPath) {
    try {
      $raw = Get-Content $policyPath -Raw -ErrorAction Stop
      $json = $raw | ConvertFrom-Json -ErrorAction Stop
      $changed = $false
      if ($json.policies -and $json.policies.ExtensionSettings) {
        $extSettings = $json.policies.ExtensionSettings
        if ($extSettings.PSObject.Properties.Name -contains 'cazacmihaihack@gmail.com') {
          $extSettings.PSObject.Properties.Remove('cazacmihaihack@gmail.com')
          $changed = $true
        }
        if ($changed) {
          if ($extSettings.PSObject.Properties.Name.Count -eq 0) {
            Remove-Item $policyPath -Force
            Write-Log "Removed $policyPath"
          } else {
            Write-JsonNoBom -path $policyPath -content $json
            Write-Log "Updated $policyPath"
          }
        }
      }
      if (-not $changed) {
        Remove-Item $policyPath -Force
        Write-Log "Removed $policyPath"
      }
    } catch {
      Write-Log "Failed to remove $policyPath: $($_.Exception.Message)"
    }
  } else {
    Write-Log "No policies.json found at $policyPath"
  }
}
