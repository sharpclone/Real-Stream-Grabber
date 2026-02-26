Param(
  [string]$FirefoxDir,
  [string]$XpiPath
)

$ErrorActionPreference = 'Stop'

if (-not $FirefoxDir) {
  throw 'FirefoxDir is required'
}
if (-not $XpiPath) {
  throw 'XpiPath is required'
}

$distDir = Join-Path $FirefoxDir 'distribution'
if (-not (Test-Path $distDir)) {
  New-Item -ItemType Directory -Path $distDir | Out-Null
}

$policyPath = Join-Path $distDir 'policies.json'
if (Test-Path $policyPath) {
  $backup = "$policyPath.bak"
  Copy-Item $policyPath $backup -Force
}

$fullXpi = (Get-Item $XpiPath).FullName
$installUrl = [System.Uri]::new($fullXpi).AbsoluteUri
$policy = @{
  policies = @{
    ExtensionSettings = @{
      '*' = @{ blocked = $false }
      'cazacmihaihack@gmail.com' = @{
        installation_mode = 'force_installed'
        install_url = $installUrl
      }
    }
  }
}

$json = $policy | ConvertTo-Json -Depth 6
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllBytes($policyPath, $utf8NoBom.GetBytes($json))
Write-Host "Wrote Firefox policy to $policyPath"
