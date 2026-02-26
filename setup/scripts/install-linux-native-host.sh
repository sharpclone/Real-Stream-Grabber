#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

HOST_PATH="$REPO_ROOT/native/host.py"
MANIFEST_NAME="com.realstreamgrabber.mediagrabber.json"
FIREFOX_HOST_DIR="$HOME/.mozilla/native-messaging-hosts"
SNAP_FIREFOX_HOST_DIR="$HOME/snap/firefox/common/.mozilla/native-messaging-hosts"

if [[ ! -f "$HOST_PATH" ]]; then
  echo "host.py not found at: $HOST_PATH" >&2
  exit 1
fi

mkdir -p "$FIREFOX_HOST_DIR"

cat > "$FIREFOX_HOST_DIR/$MANIFEST_NAME" <<EOF
{
  "name": "com.realstreamgrabber.mediagrabber",
  "description": "Native host that relays download requests to yt-dlp.",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_extensions": ["cazacmihaihack@gmail.com"]
}
EOF

# If Firefox is installed as Snap, mirror the manifest there too.
if [[ -d "$HOME/snap/firefox" ]]; then
  mkdir -p "$SNAP_FIREFOX_HOST_DIR"
  cp "$FIREFOX_HOST_DIR/$MANIFEST_NAME" "$SNAP_FIREFOX_HOST_DIR/$MANIFEST_NAME"
fi

chmod +x "$HOST_PATH"

echo "Installed native host manifest:"
echo "  $FIREFOX_HOST_DIR/$MANIFEST_NAME"
if [[ -d "$HOME/snap/firefox" ]]; then
  echo "  $SNAP_FIREFOX_HOST_DIR/$MANIFEST_NAME"
fi

echo
echo "Dependency check:"
for cmd in python3 yt-dlp node ffmpeg; do
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "  [ok] $cmd -> $(command -v "$cmd")"
  else
    echo "  [missing] $cmd"
  fi
done

echo
echo "Restart Firefox after this."
