# Real Stream Grabber firefox extension

There are a lot of extensions out there that download media from sites, but I found that most of them do not achieve what I want from a real media downloader. I was inspired by the Android app 1DM+, which could download almost everything. I tried to reproduce that workflow with this add-on.

PS: On Windows it can still feel slower than on Linux in some cases. If you profile and find a clear bottleneck, please open an issue.
#Screenshots
##Random Website
<img width="1474" height="497" alt="image" src="https://github.com/user-attachments/assets/81741b6b-7c4a-4dcf-a26d-a14da1f73c74" />
##Special interface for youtube
<img width="1781" height="834" alt="image" src="https://github.com/user-attachments/assets/2716c25a-09fd-4727-922d-2c1839920051" />

## Features

- Detects media requests in the active tab (`m3u8`, `mp4`, `mp3`, `mkv`, `vtt`)
- YouTube quick download (video/audio), including playlist mode
- Native Messaging bridge to a Python host that runs `yt-dlp`
- Optional Firefox-cookie downloads
- Progress, queue/cancel support, and download status in popup
- Windows installer (Inno Setup) with dependency provisioning


## Easy Install - Firefox only

### Linux

1. Install runtime dependencies:

Debian / Ubuntu:

```bash
sudo apt update
sudo apt install -y python3 nodejs ffmpeg zip
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

Fedora:

```bash
sudo dnf install -y python3 nodejs ffmpeg zip 
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

2. [Clone](https://github.com/sharpclone/Real-Stream-Grabber) this repo (needed for `native/host.py`) and register native messaging:

```bash
./setup/scripts/install-linux-native-host.sh
```

3. Install the signed `.xpi` from [GitHub Releases](https://github.com/sharpclone/Real-Stream-Grabber/releases) in Firefox.
4. Restart Firefox.

### Windows

Use the PowerShell script from this repo.

1. [Download](https://github.com/sharpclone/Real-Stream-Grabber/archive/refs/heads/main.zip) this repo ZIP.
2. Open PowerShell as Administrator in the repo root.
3. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup\scripts\install-windows-native-host.ps1
```

What this script does:
- Checks if Python, Node.js, yt-dlp, and ffmpeg already exist on `PATH`.
- Downloads only missing dependencies.
- Copies native host files to `C:\Program Files\RealStreamGrabber`.
- Adds local dependency folders to machine `PATH` when needed.
- Writes/registers the Firefox native host manifest.

4. Install the signed `.xpi` from [GitHub Releases](https://github.com/sharpclone/Real-Stream-Grabber/releases).
5. Restart Firefox.

## Uninstall

### Windows

1. Open PowerShell as Administrator in the repo root.
2. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup\scripts\uninstall-windows-native-host.ps1
```

This removes native host registration, manifest, install folder (`C:\Program Files\RealStreamGrabber`), and cleans legacy policy entries from older installer-based setups.

3. Remove the extension from Firefox at `about:addons`.

### Linux

1. In the repo root, run:

```bash
./setup/scripts/uninstall-linux-native-host.sh
```

2. Remove the extension from Firefox at `about:addons`.

## Repository Layout

- `extension/` - Firefox extension source (popup/background/options + manifest)
- `native/` - Native host (`host.py`, `host.cmd`, native manifest template)
- `setup/` - Windows installer scripts/assets and build outputs


## Build XPI

```bash
cd extension
zip -r ../setup/build/realstreamgrabber.xpi .
```

## Build Windows Installer (optional)

- Build extension XPI first:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup\scripts\build-extension.ps1
```

- Compile `setup/installer.iss` with Inno Setup.
- Output installer is generated in `setup/build/`.

## Notes

- Extension ID is set in `extension/manifest.json` under `browser_specific_settings.gecko.id`.
- Native host app name is `com.realstreamgrabber.mediagrabber`.
