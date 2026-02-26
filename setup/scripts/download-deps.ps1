Param(
  [string]$InstallDir,
  [string]$NodeVersion = '20.20.0',
  [string]$PythonVersion = '3.12.8'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$logDir = Join-Path $env:LOCALAPPDATA 'RealStreamGrabber'
if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}
$logFile = Join-Path $logDir 'install-deps.log'

function Write-Log($message) {
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  $line = "$timestamp $message"
  Add-Content -Path $logFile -Value $line
  Write-Host $message
}

if (-not $InstallDir) {
  throw 'InstallDir is required'
}

function Ensure-Dir($path) {
  if (-not (Test-Path $path)) {
    New-Item -ItemType Directory -Path $path | Out-Null
  }
}

function Download-File {
  Param(
    [string]$Url,
    [string]$OutFile
  )

  $bits = Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue
  if ($bits) {
    try {
      Start-BitsTransfer -Source $Url -Destination $OutFile -ErrorAction Stop
      return
    } catch {
      Write-Log "BITS download failed, falling back to Invoke-WebRequest: $($_.Exception.Message)"
    }
  }

  Invoke-WebRequest -Uri $Url -OutFile $OutFile
}

function Resolve-ExistingCommand {
  Param(
    [string]$Name,
    [string[]]$VersionArgs = @('--version')
  )

  $cmd = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $cmd) {
    return $null
  }

  $candidate = $cmd.Source
  if (-not $candidate) {
    $candidate = $cmd.Path
  }
  if (-not $candidate) {
    return $null
  }

  try {
    & $candidate @VersionArgs *> $null
    if ($LASTEXITCODE -eq 0 -or $null -eq $LASTEXITCODE) {
      return $candidate
    }
  } catch {
    return $null
  }

  return $null
}

$binDir = Join-Path $InstallDir 'bin'
$assetDir = Join-Path $InstallDir 'assets'
Ensure-Dir $binDir
Ensure-Dir $assetDir

function Install-PythonPortable($version) {
  $systemPython = Resolve-ExistingCommand -Name 'python'
  if (-not $systemPython) {
    $systemPython = Resolve-ExistingCommand -Name 'py' -VersionArgs @('-3', '--version')
  }
  if ($systemPython) {
    Write-Log "Python already available on PATH at $systemPython"
    return $systemPython
  }

  $pythonDir = Join-Path $binDir 'python'
  $pythonExe = Join-Path $pythonDir 'python.exe'
  if (Test-Path $pythonExe) {
    Write-Log 'Portable Python already present.'
    return $pythonExe
  }

  $zipName = "python-$version-embed-amd64.zip"
  $localZip = Join-Path $assetDir $zipName
  $tmpZip = Join-Path $env:TEMP $zipName
  $zipPath = $localZip

  if (-not (Test-Path $zipPath)) {
    $url = "https://www.python.org/ftp/python/$version/$zipName"
    Write-Log "Downloading Python $version (embedded) from $url"
    Download-File -Url $url -OutFile $tmpZip
    $zipPath = $tmpZip
  } else {
    Write-Log "Using bundled Python zip at $localZip"
  }

  if (Test-Path $pythonDir) {
    Remove-Item $pythonDir -Recurse -Force
  }
  Ensure-Dir $pythonDir
  Expand-Archive -Path $zipPath -DestinationPath $pythonDir -Force

  if (-not (Test-Path $pythonExe)) {
    throw 'Python extraction failed.'
  }
  Write-Log "Python ready at $pythonExe"
  return $pythonExe
}

function Install-NodePortable($version) {
  $systemNode = Resolve-ExistingCommand -Name 'node'
  if ($systemNode) {
    Write-Log "Node.js already available on PATH at $systemNode"
    return $systemNode
  }

  $nodeDir = Join-Path $binDir 'node'
  $nodeExe = Join-Path $nodeDir 'node.exe'
  if (Test-Path $nodeExe) {
    Write-Log 'Portable Node.js already present.'
    return $nodeExe
  }

  $zipName = "node-v$version-win-x64.zip"
  $localZip = Join-Path $assetDir $zipName
  $tmpZip = Join-Path $env:TEMP $zipName
  $zipPath = $localZip

  if (-not (Test-Path $zipPath)) {
    $url = "https://nodejs.org/dist/v$version/$zipName"
    Write-Log "Downloading Node.js $version (portable) from $url"
    Download-File -Url $url -OutFile $tmpZip
    $zipPath = $tmpZip
  } else {
    Write-Log "Using bundled Node.js zip at $localZip"
  }

  $extractDir = Join-Path $env:TEMP "node-$version-extract"
  if (Test-Path $extractDir) {
    Remove-Item $extractDir -Recurse -Force
  }
  Ensure-Dir $extractDir
  Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

  $innerDir = Join-Path $extractDir "node-v$version-win-x64"
  if (-not (Test-Path $innerDir)) {
    $innerDir = Get-ChildItem $extractDir | Where-Object { $_.PSIsContainer } | Select-Object -First 1 | ForEach-Object { $_.FullName }
  }

  if (-not $innerDir) {
    throw 'Node extraction failed.'
  }

  if (Test-Path $nodeDir) {
    Remove-Item $nodeDir -Recurse -Force
  }
  Move-Item $innerDir $nodeDir

  if (-not (Test-Path $nodeExe)) {
    throw 'Node extraction failed.'
  }
  Write-Log "Node.js ready at $nodeExe"
  return $nodeExe
}

function Install-YtDlp($targetDir) {
  $systemYtdlp = Resolve-ExistingCommand -Name 'yt-dlp'
  if ($systemYtdlp) {
    Write-Log "yt-dlp already available on PATH at $systemYtdlp"
    return $systemYtdlp
  }

  $targetBin = Join-Path $targetDir 'bin'
  Ensure-Dir $targetBin

  $ytPath = Join-Path $targetBin 'yt-dlp.exe'
  if (Test-Path $ytPath) {
    Write-Log 'yt-dlp already installed in app bin.'
    return $ytPath
  }

  $url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  Write-Log "Downloading yt-dlp from $url"
  Download-File -Url $url -OutFile $ytPath
  Write-Log "yt-dlp installed at $ytPath"
  return $ytPath
}

function Install-Ffmpeg() {
  $systemFfmpeg = Resolve-ExistingCommand -Name 'ffmpeg'
  if ($systemFfmpeg) {
    Write-Log "ffmpeg already available on PATH at $systemFfmpeg"
    return $systemFfmpeg
  }

  $ffmpegDir = Join-Path $binDir 'ffmpeg'
  $ffmpegExe = Join-Path $ffmpegDir 'ffmpeg.exe'
  if (Test-Path $ffmpegExe) {
    Write-Log 'ffmpeg already present.'
    return $ffmpegDir
  }

  $zipName = 'ffmpeg-master-latest-win64-gpl-shared.zip'
  $localZip = Join-Path $assetDir $zipName
  $tmpZip = Join-Path $env:TEMP $zipName
  $zipPath = $localZip

  if (-not (Test-Path $zipPath)) {
    $url = 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl-shared.zip'
    Write-Log "Downloading ffmpeg from $url"
    Download-File -Url $url -OutFile $tmpZip
    $zipPath = $tmpZip
  } else {
    Write-Log "Using bundled ffmpeg zip at $localZip"
  }

  $extractDir = Join-Path $env:TEMP 'ffmpeg-extract'
  if (Test-Path $extractDir) {
    Remove-Item $extractDir -Recurse -Force
  }
  Ensure-Dir $extractDir
  Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

  $innerDir = Get-ChildItem $extractDir | Where-Object { $_.PSIsContainer } | Select-Object -First 1
  $binSource = $null
  if ($innerDir) {
    $candidate = Join-Path $innerDir.FullName 'bin'
    if (Test-Path $candidate) {
      $binSource = $candidate
    }
  }
  if (-not $binSource) {
    $ffmpegFound = Get-ChildItem $extractDir -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1
    if ($ffmpegFound) {
      $binSource = $ffmpegFound.Directory.FullName
    }
  }
  if (-not $binSource) {
    throw 'ffmpeg extraction failed.'
  }

  if (Test-Path $ffmpegDir) {
    Remove-Item $ffmpegDir -Recurse -Force
  }
  Ensure-Dir $ffmpegDir
  Copy-Item (Join-Path $binSource '*') $ffmpegDir -Force

  if (-not (Test-Path $ffmpegExe)) {
    throw 'ffmpeg installation failed.'
  }
  Write-Log "ffmpeg installed at $ffmpegDir"
  return $ffmpegDir
}

Write-Log "Dependency install started. InstallDir=$InstallDir"
$pythonExe = Install-PythonPortable -version $PythonVersion
$nodeExe = Install-NodePortable -version $NodeVersion
$ytPath = Install-YtDlp -targetDir $InstallDir
$ffmpegDir = Install-Ffmpeg
Write-Log "Dependency install completed."
