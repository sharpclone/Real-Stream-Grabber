#!/usr/bin/env bash
set -euo pipefail

MANIFEST_NAME="com.realstreamgrabber.mediagrabber.json"
FIREFOX_HOST_DIR="$HOME/.mozilla/native-messaging-hosts"
SNAP_FIREFOX_HOST_DIR="$HOME/snap/firefox/common/.mozilla/native-messaging-hosts"

removed=0

if [[ -f "$FIREFOX_HOST_DIR/$MANIFEST_NAME" ]]; then
  rm -f "$FIREFOX_HOST_DIR/$MANIFEST_NAME"
  echo "Removed $FIREFOX_HOST_DIR/$MANIFEST_NAME"
  removed=1
fi

if [[ -f "$SNAP_FIREFOX_HOST_DIR/$MANIFEST_NAME" ]]; then
  rm -f "$SNAP_FIREFOX_HOST_DIR/$MANIFEST_NAME"
  echo "Removed $SNAP_FIREFOX_HOST_DIR/$MANIFEST_NAME"
  removed=1
fi

if [[ "$removed" -eq 0 ]]; then
  echo "No native host manifest found."
fi

echo
echo "Native host uninstall complete."
echo "If installed, remove the extension from Firefox at about:addons."
