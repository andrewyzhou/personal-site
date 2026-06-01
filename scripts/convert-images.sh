#!/usr/bin/env bash
#
# convert-images.sh — turn photos into web-ready JPEGs.
#
# everything (HEIC/HEIF from an iPhone, PNG screenshots, oversized JPGs) runs
# through one flow: convert to JPEG, resize the long edge to <=2000px, quality 80.
# you do NOT need to make WebP/AVIF yourself — next/image generates those from
# the committed JPEG at request time.
#
# usage:
#   bash scripts/convert-images.sh <inputDir> [outputDir]
#   npm run images -- <inputDir> [outputDir]
#
# example (per-post): drop originals in public/blog/<slug>/raw/, then:
#   npm run images -- public/blog/my-post/raw public/blog/my-post
#
# originals are left untouched (raw .heic stays for re-conversion; it's gitignored).

set -euo pipefail

MAXDIM=2000
QUALITY=80

if [ "$#" -lt 1 ]; then
  echo "usage: bash scripts/convert-images.sh <inputDir> [outputDir]" >&2
  exit 1
fi

INPUT_DIR="$1"
OUTPUT_DIR="${2:-$1}"

if [ ! -d "$INPUT_DIR" ]; then
  echo "error: input dir '$INPUT_DIR' does not exist" >&2
  exit 1
fi

if ! command -v sips >/dev/null 2>&1; then
  echo "error: 'sips' not found (this script targets macOS)" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

# nullglob: no matches -> empty (not the literal pattern); nocaseglob: match .HEIC/.heic/.PNG/...
shopt -s nullglob nocaseglob

count=0
for f in "$INPUT_DIR"/*.heic "$INPUT_DIR"/*.heif "$INPUT_DIR"/*.png "$INPUT_DIR"/*.jpg "$INPUT_DIR"/*.jpeg; do
  base="$(basename "$f")"
  name="${base%.*}"
  out="$OUTPUT_DIR/$name.jpg"
  sips -s format jpeg -s formatOptions "$QUALITY" -Z "$MAXDIM" "$f" --out "$out" >/dev/null
  echo "converted $f -> $out"
  count=$((count + 1))
done

if [ "$count" -eq 0 ]; then
  echo "no images found in '$INPUT_DIR' (looked for .heic/.heif/.png/.jpg/.jpeg)"
else
  echo "done — $count image(s) -> JPEG (<=${MAXDIM}px, q${QUALITY}) in '$OUTPUT_DIR'"
fi
