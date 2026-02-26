$taskName = 'RealStreamGrabber YtDlp Update'
try {
  schtasks.exe /Delete /F /TN $taskName | Out-Null
} catch {
  # ignore
}
