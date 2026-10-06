#!/usr/bin/env bash
# Checks out the WebVTT Editor's Draft source (Bikeshed) into .spec/ for reference.
# It is not committed: the W3C document license permits copying, but a local checkout keeps
# the repo small and makes it easy to diff against new spec revisions.
# Usage: scripts/sync-spec.sh [git-ref]   (default: main)
set -euo pipefail

REF="${1:-main}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/.spec/webvtt"

if [ -d "$DEST/.git" ]; then
  git -C "$DEST" fetch --quiet --depth 1 origin "$REF"
  git -C "$DEST" checkout --quiet FETCH_HEAD
else
  git clone --quiet --depth 1 --branch "$REF" https://github.com/w3c/webvtt.git "$DEST"
fi

echo "WebVTT spec source at $DEST/index.bs ($(git -C "$DEST" log -1 --format='%h %cs'))"
echo "Pinned revision in docs/SPEC-NOTES.md: compare and update if it changed."
