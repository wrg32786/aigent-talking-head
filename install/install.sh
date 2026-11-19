#!/usr/bin/env bash
# aigent-talking-head installer for macOS and Linux. Safe to run again: it updates what is there and skips what is done.
#   curl -fsSL https://raw.githubusercontent.com/wrg32786/aigent-talking-head/main/install/install.sh | bash
# What it does: checks Git, Node.js 18+, ffmpeg, Python 3.10+ and Chrome (offers to install missing ones with Homebrew,
# apt, dnf or pacman), clones or updates the repo, runs npm install, makes the Python venv, and puts a
# "Talking Head Studio" launcher on your desktop that starts Studio and opens your browser.
# The Whisper speech model downloads on the first transcription (about 470 MB for small.en), or now with --prefetch-model.
# Options: --dir <path> (default ~/aigent-talking-head), --repo <git url>, --branch <name>, --yes (install missing tools
#   without asking), --no-shortcut, --prefetch-model, --no-open. In CI (CI set) it never asks and never opens a browser.
set -euo pipefail

DIR="${AIGENT_DIR:-$HOME/aigent-talking-head}"
REPO="${AIGENT_REPO:-https://github.com/wrg32786/aigent-talking-head}"
BRANCH="${AIGENT_BRANCH:-}"
YES=0; SHORTCUT=1; PREFETCH=0; OPEN=1
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    --no-shortcut) SHORTCUT=0; shift ;;
    --prefetch-model) PREFETCH=1; shift ;;
    --no-open) OPEN=0; shift ;;
    -h|--help) sed -n '2,10p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
done
[ -n "${CI:-}" ] && OPEN=0

say() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
ok() { printf '    ok: %s\n' "$*"; }
warn() { printf '    \033[1;33mnote:\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31mStopped:\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
# ask on the terminal even when this script is piped from curl; never in CI or with --yes
ask() {
  [ "$YES" = 1 ] && return 0
  [ -n "${CI:-}" ] && return 1
  [ -r /dev/tty ] || return 1
  printf '    %s [y/N] ' "$1" > /dev/tty; read -r a < /dev/tty || return 1
  case "$a" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

OS="$(uname -s)"
PM=""
if [ "$OS" = Darwin ]; then have brew && PM=brew
elif have apt-get; then PM=apt
elif have dnf; then PM=dnf
elif have pacman; then PM=pacman
fi
SUDO=""; [ "$(id -u)" != 0 ] && have sudo && SUDO="sudo"
pkg_install() { # names per package manager: brew apt dnf pacman
  local b="$1" a="$2" d="$3" p="$4"
  case "$PM" in
    brew) brew install $b ;;
    apt) $SUDO apt-get update -qq || true; $SUDO apt-get install -y $a ;;
    dnf) $SUDO dnf install -y $d ;;
    pacman) $SUDO pacman -S --noconfirm $p ;;
    *) return 1 ;;
  esac
}
need() { # command, label, brew, apt, dnf, pacman, hint
  local cmd="$1" label="$2"
  if have "$cmd"; then ok "$label"; return 0; fi
  if [ -n "$PM" ] && ask "$label is missing. Install it with $PM?"; then pkg_install "$3" "$4" "$5" "$6" && have "$cmd" && { ok "$label installed"; return 0; }; fi
  die "$label is missing. $7"
}

say "Checking this computer ($OS)"
[ "$OS" = Darwin ] && [ -z "$PM" ] && warn "Homebrew is not installed, so missing tools can't be installed for you. Get it from https://brew.sh, or install the tools yourself."
need git "Git" git git git git "Install Git from https://git-scm.com/downloads"
need node "Node.js" node nodejs nodejs nodejs "Install Node.js 18 or newer from https://nodejs.org"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js $NODE_MAJOR is too old; install 18 or newer from https://nodejs.org"
have npm || pkg_install node npm nodejs-npm npm || die "npm is missing; reinstall Node.js from https://nodejs.org"
need ffmpeg "ffmpeg" ffmpeg ffmpeg ffmpeg ffmpeg "Install ffmpeg from https://ffmpeg.org/download.html"
PY=""; for c in python3.12 python3.11 python3.10 python3; do if have "$c" && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then PY="$c"; break; fi; done
if [ -z "$PY" ]; then
  if [ -n "$PM" ] && ask "Python 3.10+ is missing. Install it with $PM?"; then pkg_install python@3.12 "python3 python3-venv" python3 python || true; have python3 && PY=python3; fi
  [ -n "$PY" ] || die "Python 3.10 or newer is missing. Install it from https://www.python.org/downloads/"
fi
ok "Python ($($PY --version 2>&1))"
if [ "$PM" = apt ] && ! "$PY" -c 'import ensurepip' 2>/dev/null; then
  ask "The Python venv module is missing. Install python3-venv with apt?" && $SUDO apt-get install -y python3-venv || die "Install python3-venv, then run this again."
fi
CHROME=""
for c in google-chrome google-chrome-stable chromium chromium-browser "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
  if have "$c" || [ -x "$c" ]; then CHROME="$c"; break; fi
done
[ -n "$CHROME" ] && ok "Chrome ($CHROME)" || warn "Chrome or Chromium not found. Studio's page works in any browser, but rendering needs Chrome: install it from https://www.google.com/chrome/ (or set CHROME_PATH)."

say "Getting the code into $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --quiet origin
  if [ -n "$BRANCH" ]; then git -C "$DIR" checkout --quiet "$BRANCH"; fi
  if git -C "$DIR" diff --quiet && git -C "$DIR" diff --cached --quiet; then git -C "$DIR" pull --quiet --ff-only || warn "could not fast-forward; keeping your local version"; else warn "you have local changes in $DIR, so it was not updated"; fi
  ok "updated"
elif [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
  die "$DIR exists and is not a clone of the kit. Pick another folder with --dir."
else
  git clone --quiet ${BRANCH:+--branch "$BRANCH"} "$REPO" "$DIR"; ok "cloned"
fi
cd "$DIR"

say "Installing Node packages"
npm install --no-audit --no-fund --loglevel=error; ok "npm install"

say "Setting up Python (venv in $DIR/.venv)"
[ -x .venv/bin/python ] || "$PY" -m venv .venv
.venv/bin/python -m pip install --quiet --upgrade pip
.venv/bin/python -m pip install --quiet -r requirements.txt; ok "Python packages"
# optional reference-link helpers for Studio: yt-dlp (YouTube, TikTok, X, Vimeo; Unlicense) and instaloader (one public
# Instagram post, anonymous; MIT). Separate programs the kit runs; a failure here does not stop the install.
if .venv/bin/python -m pip install --quiet --upgrade yt-dlp instaloader; then ok "yt-dlp and instaloader (Studio reference links)"; else warn "yt-dlp did not install; Studio still takes direct video links. Later: .venv/bin/python -m pip install yt-dlp"; fi
if [ "$PREFETCH" = 1 ]; then
  say "Downloading the Whisper model (small.en, about 470 MB)"
  .venv/bin/python -c "from faster_whisper import WhisperModel; WhisperModel('small.en')" && ok "model ready"
fi

say "Making the Studio launcher"
cat > studio.sh <<LAUNCH
#!/usr/bin/env bash
# Starts AIgent Studio and opens it in your browser. Made by install/install.sh; safe to delete and remake.
cd "$DIR" || exit 1
export PYTHON="$DIR/.venv/bin/python"
exec node kit/studio/server.mjs "\$@"
LAUNCH
chmod +x studio.sh; ok "$DIR/studio.sh"
if [ "$SHORTCUT" = 1 ]; then
  DESK="$HOME/Desktop"; have xdg-user-dir && DESK="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$DESK")"
  if [ "$OS" = Darwin ]; then
    mkdir -p "$DESK"
    printf '#!/bin/bash\n# Double-click to start AIgent Studio. Close this window to stop it.\n"%s/studio.sh"\n' "$DIR" > "$DESK/Talking Head Studio.command"
    chmod +x "$DESK/Talking Head Studio.command"; ok "Desktop: Talking Head Studio.command"
  else
    APPS="$HOME/.local/share/applications"; mkdir -p "$APPS"
    ICON="$DIR/kit/studio/public/favicon.svg"
    cat > "$APPS/aigent-studio.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Talking Head Studio
Comment=Make talking-head reels with AIgent Studio
Exec="$DIR/studio.sh"
Icon=$ICON
Terminal=true
Categories=AudioVideo;Video;
DESKTOP
    chmod +x "$APPS/aigent-studio.desktop"; ok "app menu: Talking Head Studio"
    if [ -d "$DESK" ]; then cp "$APPS/aigent-studio.desktop" "$DESK/"; chmod +x "$DESK/aigent-studio.desktop"; have gio && gio set "$DESK/aigent-studio.desktop" metadata::trusted true 2>/dev/null || true; ok "Desktop: Talking Head Studio"; fi
  fi
fi

say "Checking the install"
PYTHON="$DIR/.venv/bin/python" npm run --silent check >/tmp/aigent-check.log 2>&1 && ok "CHECK PASS" || { warn "npm run check did not pass; see /tmp/aigent-check.log"; }

printf '\n\033[1;36mDone.\033[0m Double-click "Talking Head Studio" on your desktop, or run: %s/studio.sh\n' "$DIR"
if [ "$OPEN" = 1 ] && [ -r /dev/tty ] && ask "Open Studio now?"; then exec "$DIR/studio.sh"; fi
