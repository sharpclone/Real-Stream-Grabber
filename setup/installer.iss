#define AppName "Real Stream Grabber"
#define AppVersion "2.0.26"
#define AppPublisher "Real Stream Grabber"

[Setup]
AppId={{A43A2D1B-2E0E-4C79-B75A-4CB4F9A0B8B7}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={pf}\RealStreamGrabber
DefaultGroupName=Real Stream Grabber
DisableProgramGroupPage=yes
SetupIconFile={#SourcePath}\assets\icon.ico
OutputDir=build
OutputBaseFilename=RealStreamGrabber-Setup
Compression=lzma
SolidCompression=yes
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=admin
UsePreviousTasks=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "firefoxpolicy"; Description: "Install Firefox policy (force install extension)"

[Files]
Source: "{#SourcePath}\..\native\host.py"; DestDir: "{app}\native"; Flags: ignoreversion
Source: "{#SourcePath}\..\native\host.cmd"; DestDir: "{app}\native"; Flags: ignoreversion
Source: "{#SourcePath}\scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion recursesubdirs
Source: "{#SourcePath}\assets\*"; DestDir: "{app}\assets"; Flags: ignoreversion recursesubdirs
Source: "{#SourcePath}\build\realstreamgrabber.xpi"; DestDir: "{app}\extension"; Flags: ignoreversion

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\download-deps.ps1"" -InstallDir ""{app}"""; StatusMsg: "Downloading dependencies..."; Flags: runhidden
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\write-native-manifest.ps1"" -InstallDir ""{app}"""; StatusMsg: "Registering native host..."; Flags: runhidden
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\register-native-host.ps1"""; StatusMsg: "Registering native host..."; Flags: runhidden
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\register-yt-dlp-task.ps1"" -InstallDir ""{app}"""; StatusMsg: "Creating update task..."; Flags: runhidden
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\write-firefox-policy.ps1"" -FirefoxDir ""{code:GetFirefoxDir}"" -XpiPath ""{app}\extension\realstreamgrabber.xpi"""; StatusMsg: "Installing Firefox policy..."; Flags: runhidden; Tasks: firefoxpolicy; Check: IsFirefoxInstalled

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\unregister-yt-dlp-task.ps1"""; Flags: runhidden waituntilterminated
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\unregister-native-host.ps1"""; Flags: runhidden waituntilterminated
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\remove-firefox-policy.ps1"""; Flags: runhidden waituntilterminated

[Code]
function GetFirefoxDir(Param: string): string;
var
  Path: string;
begin
  if RegQueryStringValue(HKLM, 'Software\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe', '', Path) then
    Result := ExtractFileDir(Path)
  else if RegQueryStringValue(HKLM, 'Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe', '', Path) then
    Result := ExtractFileDir(Path)
  else if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe', '', Path) then
    Result := ExtractFileDir(Path)
  else if DirExists(ExpandConstant('{pf}\Mozilla Firefox')) then
    Result := ExpandConstant('{pf}\Mozilla Firefox')
  else if DirExists(ExpandConstant('{pf32}\Mozilla Firefox')) then
    Result := ExpandConstant('{pf32}\Mozilla Firefox')
  else
    Result := '';
end;

function IsFirefoxInstalled: Boolean;
var
  Dir: string;
begin
  Dir := GetFirefoxDir('');
  Result := Dir <> '';
end;

function InitializeSetup(): Boolean;
var
  Dir: string;
begin
  Dir := GetFirefoxDir('');
  if Dir = '' then
  begin
    MsgBox('Firefox was not found. Please install Firefox first.', mbError, MB_OK);
    Result := False;
  end
  else
    Result := True;
end;

procedure RemoveFirefoxPolicyInline();
var
  ResultCode: Integer;
  Params: string;
begin
  Params :=
    '-NoProfile -ExecutionPolicy Bypass -Command "' +
    '$logDir = Join-Path $env:LOCALAPPDATA ''RealStreamGrabber'';' +
    'New-Item -ItemType Directory -Path $logDir -Force | Out-Null;' +
    '$log = Join-Path $logDir ''uninstall-policy.log'';' +
    'function Log($m){ Add-Content -Path $log -Value ((Get-Date -Format ''yyyy-MM-dd HH:mm:ss'') + '' '' + $m) }' +
    '$dirs=@();' +
    '$keys=@(''HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe'',' +
    '''HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe'',' +
    '''HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe'');' +
    'foreach($k in $keys){ try { $v=(Get-ItemProperty -Path $k -ErrorAction SilentlyContinue).''(default)'';' +
    'if($v){$d=Split-Path $v -Parent; if(Test-Path $d){$dirs+=$d}} } catch {} }' +
    '$dirs += ''C:\\Program Files\\Mozilla Firefox'',''C:\\Program Files (x86)\\Mozilla Firefox'';' +
    '$dirs = $dirs | Select-Object -Unique;' +
    'function WriteNoBom($path,$content){ $json=$content | ConvertTo-Json -Depth 10;' +
    '$utf8NoBom=New-Object System.Text.UTF8Encoding $false;' +
    '[System.IO.File]::WriteAllBytes($path,$utf8NoBom.GetBytes($json)) }' +
    'foreach($root in $dirs){' +
    '$policy=Join-Path $root ''distribution\\policies.json'';' +
    'if(Test-Path $policy){ try{' +
    '$raw=Get-Content $policy -Raw -ErrorAction Stop; $json=$raw | ConvertFrom-Json -ErrorAction Stop;' +
    '$changed=$false; if($json.policies -and $json.policies.ExtensionSettings){' +
    '$ext=$json.policies.ExtensionSettings;' +
    'if($ext.PSObject.Properties.Name -contains ''cazacmihaihack@gmail.com''){ $ext.PSObject.Properties.Remove(''cazacmihaihack@gmail.com''); $changed=$true }' +
    'if($changed){ if($ext.PSObject.Properties.Name.Count -eq 0){ Remove-Item $policy -Force; Log(''Removed ''+$policy) }' +
    'else { WriteNoBom $policy $json; Log(''Updated ''+$policy) } } }' +
    'if(-not $changed){ Remove-Item $policy -Force; Log(''Removed ''+$policy) }' +
    '} catch { Log(''Failed ''+$policy+'' : ''+$_.Exception.Message) } } else { Log(''No policies.json at ''+$policy) } }' +
    '"';
  Exec('powershell.exe', Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    RemoveFirefoxPolicyInline();
  end;
end;
