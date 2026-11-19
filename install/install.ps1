# aigent-talking-head installer for Windows (PowerShell 5.1 or 7). Safe to run again: it updates what is there and skips what is done.
#   irm https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/install/install.ps1 | iex
# What it does: checks Git, Node.js 18+, ffmpeg, Python 3.10+ and Chrome (offers to install missing ones with winget),
# clones or updates the repo, runs npm install, makes the Python venv, and puts a "Talking Head Studio" shortcut on
# your desktop that starts Studio and opens your browser.
# The Whisper speech model downloads on the first transcription (about 470 MB for small.en), or now with -PrefetchModel.
# Options (when saved as a file): -Dir <path> (default $HOME\aigent-talking-head), -Repo <git url>, -Branch <name>,
#   -Yes (install missing tools without asking), -NoShortcut, -PrefetchModel. In CI (CI set) it never asks.
# Settings also come from env vars when piped: AIGENT_DIR, AIGENT_REPO, AIGENT_BRANCH, AIGENT_YES=1.
param(
  [string]$Dir = $(if ($env:AIGENT_DIR) { $env:AIGENT_DIR } else { Join-Path $HOME 'aigent-talking-head' }),
  [string]$Repo = $(if ($env:AIGENT_REPO) { $env:AIGENT_REPO } else { 'https://github.com/wrg32786/aigent-talking-head' }),
  [string]$Branch = $env:AIGENT_BRANCH,
  [switch]$Yes,
  [switch]$NoShortcut,
  [switch]$PrefetchModel
)
$ErrorActionPreference = 'Stop'
if ($env:AIGENT_YES -eq '1') { $Yes = $true }
$CI = [bool]$env:CI

function Say($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "    ok: $m" }
function Note($m) { Write-Host "    note: $m" -ForegroundColor Yellow }
function Stop-Install($m) { Write-Host "`nStopped: $m" -ForegroundColor Red; exit 1 }
function Have($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function Ask($q) {
  if ($Yes) { return $true }
  if ($CI) { return $false }
  return ((Read-Host "    $q [y/N]") -match '^(y|yes)$')
}
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Need($cmd, $label, $wingetId, $hint) {
  if (Have $cmd) { Ok $label; return }
  if ((Have 'winget') -and (Ask "$label is missing. Install it with winget?")) {
    winget install --id $wingetId -e --accept-source-agreements --accept-package-agreements --silent | Out-Host
    Refresh-Path
    if (Have $cmd) { Ok "$label installed"; return }
  }
  Stop-Install "$label is missing. $hint"
}

Say 'Checking this computer (Windows)'
if (-not (Have 'winget')) { Note 'winget is not available, so missing tools cannot be installed for you. Install them yourself, then run this again.' }
Need 'git' 'Git' 'Git.Git' 'Install Git from https://git-scm.com/download/win'
Need 'node' 'Node.js' 'OpenJS.NodeJS.LTS' 'Install Node.js 18 or newer from https://nodejs.org'
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 18) { Stop-Install "Node.js $nodeMajor is too old; install 18 or newer from https://nodejs.org" }
Need 'ffmpeg' 'ffmpeg' 'Gyan.FFmpeg' 'Install ffmpeg from https://ffmpeg.org/download.html and add it to PATH'
$py = $null
foreach ($c in @(@('py', '-3'), @('python'))) {
  if (Have $c[0]) {
    $args2 = @($c | Select-Object -Skip 1) + @('-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)')
    & $c[0] @args2 2>$null
    if ($LASTEXITCODE -eq 0) { $py = $c; break }
  }
}
if (-not $py) {
  if ((Have 'winget') -and (Ask 'Python 3.10+ is missing. Install Python 3.12 with winget?')) {
    winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements --silent | Out-Host
    Refresh-Path
    if (Have 'py') { $py = @('py', '-3') }
  }
  if (-not $py) { Stop-Install 'Python 3.10 or newer is missing. Install it from https://www.python.org/downloads/ (tick "Add to PATH").' }
}
Ok "Python ($($py -join ' '))"
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($chrome) { Ok "Chrome ($chrome)" } else { Note 'Chrome not found. Studio works in any browser, but rendering needs Chrome: https://www.google.com/chrome/ (or set CHROME_PATH).' }

Say "Getting the code into $Dir"
if (Test-Path (Join-Path $Dir '.git')) {
  git -C $Dir fetch --quiet origin
  if ($Branch) { git -C $Dir checkout --quiet $Branch }
  if (-not (git -C $Dir status --porcelain --untracked-files=no)) { git -C $Dir pull --quiet --ff-only; if ($LASTEXITCODE -ne 0) { Note 'could not fast-forward; keeping your local version' } }
  else { Note "you have local changes in $Dir, so it was not updated" }
  Ok 'updated'
} elseif ((Test-Path $Dir) -and (Get-ChildItem $Dir -Force | Select-Object -First 1)) {
  Stop-Install "$Dir exists and is not a clone of the kit. Pick another folder with -Dir."
} else {
  if ($Branch) { git clone --quiet --branch $Branch $Repo $Dir } else { git clone --quiet $Repo $Dir }
  if ($LASTEXITCODE -ne 0) { Stop-Install 'git clone failed' }
  Ok 'cloned'
}
Set-Location $Dir

Say 'Installing Node packages'
npm install --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { Stop-Install 'npm install failed' }
Ok 'npm install'

Say "Setting up Python (venv in $Dir\.venv)"
$vpy = Join-Path $Dir '.venv\Scripts\python.exe'
if (-not (Test-Path $vpy)) { $a = @($py | Select-Object -Skip 1) + @('-m', 'venv', '.venv'); & $py[0] @a }
& $vpy -m pip install --quiet --upgrade pip
& $vpy -m pip install --quiet -r requirements.txt
if ($LASTEXITCODE -ne 0) { Stop-Install 'pip install failed' }
Ok 'Python packages'
# optional reference-link helpers for Studio: yt-dlp (Unlicense) and instaloader (MIT, anonymous). Not fatal.
& $vpy -m pip install --quiet --upgrade yt-dlp instaloader
if ($LASTEXITCODE -eq 0) { Ok 'yt-dlp and instaloader (Studio reference links)' } else { Write-Host "    note: yt-dlp did not install; Studio still takes direct video links. Later: $vpy -m pip install yt-dlp" }
if ($PrefetchModel) {
  Say 'Downloading the Whisper model (small.en, about 470 MB)'
  & $vpy -c "from faster_whisper import WhisperModel; WhisperModel('small.en')"
  Ok 'model ready'
}

Say 'Making the Studio launcher'
$bat = Join-Path $Dir 'studio.bat'
@"
@echo off
rem Starts AIgent Studio and opens it in your browser. Made by install\install.ps1; safe to delete and remake.
cd /d "$Dir"
set "PYTHON=$vpy"
node kit\studio\server.mjs %*
if errorlevel 1 pause
"@ | Set-Content -Path $bat -Encoding ASCII
Ok $bat
if (-not $NoShortcut) {
  $desk = [Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $desk 'Talking Head Studio.lnk'
  $sh = New-Object -ComObject WScript.Shell
  $s = $sh.CreateShortcut($lnk)
  $s.TargetPath = $bat
  $s.WorkingDirectory = $Dir
  $s.Description = 'Make talking-head reels with AIgent Studio'
  $s.Save()
  Ok "Desktop: Talking Head Studio"
}

Say 'Checking the install'
$env:PYTHON = $vpy
npm run --silent check *> (Join-Path $env:TEMP 'aigent-check.log')
if ($LASTEXITCODE -eq 0) { Ok 'CHECK PASS' } else { Note "npm run check did not pass; see $env:TEMP\aigent-check.log" }

Write-Host "`nDone. Double-click 'Talking Head Studio' on your desktop, or run: $bat" -ForegroundColor Cyan
if (-not $CI -and (Ask 'Open Studio now?')) { Start-Process -FilePath $bat -WorkingDirectory $Dir }
