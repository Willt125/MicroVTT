#!/usr/bin/env bash
# Vendors the WebVTT parsing conformance tests from web-platform-tests into tests/wpt.
# Usage: scripts/sync-wpt.sh [git-ref]   (default: master)
set -euo pipefail

REF="${1:-master}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/tests/wpt"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --quiet --depth 1 --branch "$REF" --filter=blob:none --sparse \
  https://github.com/web-platform-tests/wpt.git "$TMP/wpt"
git -C "$TMP/wpt" sparse-checkout set webvtt/parsing webvtt/api
git -C "$TMP/wpt" sparse-checkout add LICENSE.md 2>/dev/null || true

SRC="$TMP/wpt/webvtt"
rm -rf "$DEST"
mkdir -p "$DEST/file-parsing" "$DEST/cue-text-parsing" "$DEST/api"

# File parsing: .test sources (title / metadata / JS assertions / === / VTT body) and the
# signature-invalid .vtt fixtures. The generated .html wrappers are not needed.
cp "$SRC"/parsing/file-parsing/support/*.test "$DEST/file-parsing/"
cp "$SRC"/parsing/file-parsing/support/*.vtt "$DEST/file-parsing/"
cp "$SRC"/parsing/file-parsing/README.md "$DEST/file-parsing/"
cp "$SRC"/parsing/file-parsing/tools/parser.py "$DEST/file-parsing/reference-parser.py"

# Cue text parsing: html5lib-style .dat tree dumps.
cp "$SRC"/parsing/cue-text-parsing/dat/*.dat "$DEST/cue-text-parsing/"

# VTTCue / VTTRegion API semantics (used as a reference for our model's setters).
cp -r "$SRC"/api/VTTCue "$SRC"/api/VTTRegion "$DEST/api/"

cp "$TMP/wpt/LICENSE.md" "$DEST/LICENSE.md"
{
  echo "Source: https://github.com/web-platform-tests/wpt (webvtt/parsing, webvtt/api)"
  echo "Commit: $(git -C "$TMP/wpt" rev-parse HEAD)"
  echo "Date:   $(git -C "$TMP/wpt" log -1 --format=%cI)"
  echo "License: 3-Clause BSD (see LICENSE.md)"
  echo
  echo "Do not edit by hand; re-run scripts/sync-wpt.sh."
} > "$DEST/SOURCE.txt"

echo "Vendored WPT webvtt tests into $DEST"
