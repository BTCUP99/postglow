#!/bin/bash
# Postglow installer: downloads the latest release and puts it in /Applications.
#
#   curl -fsSL https://raw.githubusercontent.com/BTCUP99/postglow/main/install.sh | bash
#
# Files downloaded with curl are not quarantined, so macOS opens the app without
# the "unverified developer" prompt. Everything runs inside main() so a cut-off
# download of this script does nothing.

set -euo pipefail

REPO="BTCUP99/postglow"
APP="Postglow.app"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
TMP=""
MNT=""
cleanup() {
  [ -n "$MNT" ] && hdiutil detach "$MNT" -quiet >/dev/null 2>&1 || true
  [ -n "$TMP" ] && rm -rf "$TMP"
}

die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

main() {
  [ "$(uname -s)" = "Darwin" ] || die "Postglow 只支持 macOS。"

  local url dest
  TMP="$(mktemp -d)"
  MNT="$TMP/mnt"
  trap cleanup EXIT

  say "正在查找最新版本…"
  url="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
    grep -o '"browser_download_url": *"[^"]*_universal\.dmg"' | head -n1 | sed 's/.*"\(https[^"]*\)"/\1/')"
  [ -n "$url" ] || die "没有找到安装包，请到 https://github.com/$REPO/releases 手动下载。"

  say "正在下载 ${url##*/}…"
  curl -fL --progress-bar -o "$TMP/Postglow.dmg" "$url"

  mkdir -p "$MNT"
  hdiutil attach "$TMP/Postglow.dmg" -nobrowse -readonly -quiet -mountpoint "$MNT"
  [ -d "$MNT/$APP" ] || die "安装包里没有 $APP。"

  dest="/Applications"
  [ -w "$dest" ] || { dest="$HOME/Applications"; mkdir -p "$dest"; }

  if pgrep -xq postglow; then
    say "正在退出正在运行的 Postglow…"
    osascript -e 'quit app "Postglow"' >/dev/null 2>&1 || true
    sleep 2
  fi

  say "正在安装到 ${dest}…"
  rm -rf "${dest:?}/$APP"
  ditto "$MNT/$APP" "$dest/$APP"
  xattr -dr com.apple.quarantine "$dest/$APP" 2>/dev/null || true

  say "安装完成，正在打开 Postglow。"
  open "$dest/$APP"
}

main "$@"
