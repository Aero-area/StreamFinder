#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <m3u8_url_or_file> <title> [format: mp4|mp3|m4a|wav]"
  exit 1
fi

INPUT="$1"
TITLE="$2"
FORMAT="${3:-mp4}"

case "$FORMAT" in
  mp4|mp3|m4a|wav) ;;
  *)
    echo "Unsupported format: $FORMAT"
    exit 1
    ;;
esac

SAFE_TITLE=$(printf "%s" "$TITLE" | sed 's/[\\/:*?"<>|]/ /g; s/[[:space:]]\+/ /g; s/^ //; s/ $//')
OUT="${SAFE_TITLE}.${FORMAT}"

if [ "$FORMAT" = "mp4" ]; then
  ffmpeg -y -i "$INPUT" -c copy "$OUT"
elif [ "$FORMAT" = "mp3" ]; then
  ffmpeg -y -i "$INPUT" -vn -c:a libmp3lame -q:a 2 "$OUT"
elif [ "$FORMAT" = "m4a" ]; then
  ffmpeg -y -i "$INPUT" -vn -c:a aac -b:a 192k "$OUT"
else
  ffmpeg -y -i "$INPUT" -vn -c:a pcm_s16le "$OUT"
fi

echo "Created: $OUT"
