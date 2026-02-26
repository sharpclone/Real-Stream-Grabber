Real Stream Grabber - Windows Installer (Inno Setup)

This folder contains an Inno Setup script and helper PowerShell scripts that:
- Check Firefox is installed.
- Download portable Python/Node into the app folder (or use bundled zips if provided), and yt-dlp.exe.
- Register the native messaging host.
- Optionally install a Firefox policy to force-install the extension.
- Create a daily yt-dlp update scheduled task (mandatory).

Important limitations:
- Firefox stable requires signed extensions. A locally built XPI may not install unless you use Developer/Nightly or a signed build.
- The Firefox policy install writes to the Firefox program directory and can overwrite existing policies.json. It creates a backup if one exists.
- Python is installed by the installer if missing.

Steps (build in Windows VM recommended):
1) Install Inno Setup (https://jrsoftware.org/isinfo.php).
2) Build the XPI:
   - Open PowerShell in this repo and run:
     powershell -ExecutionPolicy Bypass -File .\setup\scripts\build-extension.ps1
   - This creates: setup\build\realstreamgrabber.xpi
3) Open setup\installer.iss in Inno Setup and compile.
4) Run the generated installer from setup\build\RealStreamGrabber-Setup.exe

Optional edits:
- Change Node.js version or Python version in setup\scripts\download-deps.ps1.
- To build an offline installer, place the zips in setup\assets (see setup\assets\README.txt).

If you want silent install:
- Use Inno Setup command line: 
  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" setup\installer.iss

Notes:
- Native host manifest is written to %APPDATA%\Mozilla\NativeMessagingHosts\com.realstreamgrabber.mediagrabber.json
- yt-dlp is downloaded to {app}\bin\yt-dlp.exe
- If you select the Firefox policy task, the extension is force-installed via policies.json
