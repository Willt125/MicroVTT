#!/usr/bin/env bash
# Makes long test media for the waveform memory acceptance test (apps/web/e2e/acceptance):
# pink noise, mono Opus at 8 kbps, 1 h (about 3.5 MB, ~40 s to make) and 12 h (about 42 MB,
# ~8 min). Usage: scripts/long-media.sh [output directory, default /tmp]
set -euo pipefail
out="${1:-/tmp}"
for hours in 1 12; do
  ffmpeg -loglevel error -y -f lavfi -i "anoisesrc=d=$((hours * 3600)):c=pink:r=16000:a=0.3" \
    -ac 1 -c:a libopus -b:a 8k "$out/long-${hours}h.webm"
  echo "Wrote $out/long-${hours}h.webm"
done
