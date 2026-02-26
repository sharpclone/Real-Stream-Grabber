$ErrorActionPreference = 'Stop'

$regPaths = @(
  'HKCU:\Software\Mozilla\NativeMessagingHosts\com.realstreamgrabber.mediagrabber',
  'HKLM:\Software\Mozilla\NativeMessagingHosts\com.realstreamgrabber.mediagrabber'
)

foreach ($path in $regPaths) {
  if (Test-Path $path) {
    try {
      Remove-Item $path -Force -ErrorAction SilentlyContinue
      Write-Host "Removed $path"
    } catch {
      Write-Host "Failed to remove $path: $($_.Exception.Message)"
    }
  }
}
