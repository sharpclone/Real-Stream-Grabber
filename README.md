# Real Stream Grabber


There are a lot of extensions out there that download media from sites, but i found that all of them do not achieve what i want from a real media downloader. I insired myself from the legendary android app 1dm+, which could download absolutely everything - no other app has achieved its downloading capabilities. I tried to reproduce its functionality with this addon. Hope you find it useful.

PS: On windows it seems that the extension is way slower as on linux. I cant figure out what causes that. Maybe you could help!


## Features

- Detects media requests in the active tab (`m3u8`, `mp4`, `mp3`, `mkv`, `vtt`)
- YouTube quick download (video/audio), including playlist mode
- Native Messaging bridge to a Python host that runs `yt-dlp`
- Optional Firefox-cookie downloads
- Progress, queue/cancel support, and download status in popup
- Windows installer (Inno Setup) with dependency provisioning

## Repository Layout

- `extension/` - Firefox extension source (popup/background/options + manifest)
- `native/` - Native host (`host.py`, `host.cmd`, native manifest template)
- `setup/` - Windows installer scripts/assets and build outputs

## Local Development

### Linux

1. Install dependencies:

```bash
sudo apt update
sudo apt install -y python3 nodejs ffmpeg zip
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

2. Register native host:

```bash
./setup/scripts/install-linux-native-host.sh
```

3. Load extension temporarily in Firefox (`about:debugging` -> This Firefox -> Load Temporary Add-on -> `extension/manifest.json`), or install signed XPI.

### Windows

- Use the Inno Setup installer from `setup/build/RealStreamGrabber-Setup.exe`, or compile `setup/installer.iss`.
- Installer scripts are in `setup/scripts/`.

## Build XPI

```bash
cd extension
zip -r ../setup/build/realstreamgrabber.xpi .
```



## Notes

- Extension ID is set in `extension/manifest.json` under `browser_specific_settings.gecko.id`.
- Native host app name is `com.realstreamgrabber.mediagrabber`.
