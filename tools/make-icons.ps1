# Render tools/icon/icon.html to the App Store icon (1024, RGB, no alpha) and the web icons.
#   powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$py = 'C:\Users\jbitt\OneDrive\Desktop\Carrots\.venv\Scripts\python.exe'   # has Pillow
$src = ([uri](Join-Path $root 'tools\icon\icon.html')).AbsoluteUri
$raw = Join-Path $env:TEMP 'fishapp-icon-raw.png'
$prof = Join-Path $env:TEMP ('fa-icon-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$p = Start-Process -FilePath $chrome -PassThru -WindowStyle Hidden -ArgumentList @(
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', "--user-data-dir=$prof",
  '--window-size=1024,1024', '--force-device-scale-factor=1', '--default-background-color=060B11FF', "--screenshot=$raw", $src)
if (-not $p.WaitForExit(60000)) { $p.Kill(); throw 'chrome timed out' }
Remove-Item -Recurse -Force $prof -ErrorAction SilentlyContinue
$ios = 'C:\Users\jbitt\OneDrive\Desktop\Projects\FishApp-iOS\FishApp\Assets.xcassets\AppIcon.appiconset\AppIcon-1024.png'
$web = Join-Path $root 'public\icons'
$script = @"
from PIL import Image
im = Image.open(r'$raw').convert('RGB')
assert im.size == (1024, 1024), im.size
im.save(r'$ios', optimize=True)
for s in (180, 192, 512):
    im.resize((s, s), Image.LANCZOS).save(r'$web\icon-%d.png' % s, optimize=True)
im.resize((1024, 1024)).save(r'$root\tools\icon\icon-1024.png', optimize=True)
print('icons written', im.mode, im.size)
"@
$tmp = Join-Path $env:TEMP 'fishapp-icons.py'
Set-Content -Path $tmp -Value $script -Encoding utf8
& $py $tmp
