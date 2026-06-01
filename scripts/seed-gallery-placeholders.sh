#!/usr/bin/env bash
# generate placeholder galleries with imagemagick.
# meant for development only — run once, commit the outputs, delete galleries
# when you replace them with real photos.
#
# usage: bash scripts/seed-gallery-placeholders.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUBLIC="$ROOT/public/galleries"
CONTENT="$ROOT/content/gallery"

mkdir -p "$PUBLIC" "$CONTENT"

# size shortcuts (wxh)
L="1200x800"        # landscape 3:2
L_WIDE="1600x900"   # landscape 16:9
L_PANO="1680x720"   # wide
P="800x1200"        # portrait 2:3
P_TALL="720x1280"   # portrait 9:16
S="1000x1000"       # square

# helper: write_gallery <slug> <title> <date> <caption> <dims-list> <colors-list>
write_gallery() {
  local slug="$1"
  local title="$2"
  local date="$3"
  local caption="$4"
  local dims_list="$5"
  local colors_list="$6"

  local dir="$PUBLIC/$slug"
  mkdir -p "$dir"

  # split into arrays (assumes space-separated)
  read -r -a dims <<< "$dims_list"
  read -r -a colors <<< "$colors_list"

  local n=${#dims[@]}
  local files=()
  for ((i = 0; i < n; i++)); do
    local f="photo-$(printf "%02d" "$((i + 1))").jpg"
    local size="${dims[$i]}"
    local color="${colors[$i]}"
    magick -size "$size" \
      gradient:"$color"-"#0a0a0a" \
      -gravity center -pointsize 60 -fill 'rgba(238,238,238,0.45)' \
      -annotate +0+0 "$slug · $((i + 1))" \
      -quality 85 "$dir/$f"
    files+=("$f")
  done

  # first photo is the cover
  local cover="${files[0]}"

  # write yaml
  {
    echo "title: $title"
    echo "date: $date"
    echo "caption: $caption"
    echo "cover: $cover"
    echo "photos:"
    for f in "${files[@]}"; do echo "  - $f"; done
  } > "$CONTENT/$slug.yaml"

  echo "✓ $slug ($n photos)"
}

# --- gallery defs ---
# format: write_gallery <slug> <title> <date> <caption> "<dims...>" "<colors...>"

write_gallery autumn-2025 "autumn 2025" 2025-11-12 \
  "color study from a walk through the hills." \
  "$L $L $L $P $L $L_WIDE" \
  "#6b3d1a #8a4b22 #aa5a30 #c97842 #a16135 #7a3b1a"

write_gallery tokyo-night "tokyo night" 2025-09-22 \
  "neon, rain, late dinners. mostly handheld at iso 6400." \
  "$P $P $P $P $L $P_TALL $P $L" \
  "#1a2240 #29155a #2b4e8c #6a1e6e #143a5a #2a1b4e #08233f #381b66"

write_gallery film-roll-1 "first roll" 2025-07-04 \
  "first 35mm roll i shot. portra 400 pushed one stop." \
  "$L $P $L $L $P $S $L $L_WIDE $P $L $S $L" \
  "#b3925d #c2a06d #a98253 #7e6034 #8f6e3f #a08f6a #c5a371 #8a6d3c #b59563 #d4b07a #98774c #a18258"

write_gallery weekend-coffee "weekend coffee" 2025-05-18 \
  "saturday mornings at a few cafes around campus." \
  "$S $S $S $S $S" \
  "#5b3a22 #6b4530 #4a2e1c #7a5236 #3e2715"

write_gallery mountain-trip "mountain trip" 2025-03-30 \
  "three days up at lake tahoe in march." \
  "$L_PANO $L_WIDE $L_PANO $L_WIDE" \
  "#244c66 #2e607e #1b4060 #3a7099"

write_gallery street-portraits "street portraits" 2024-12-09 \
  "strangers who said yes, with the 50mm." \
  "$P $P $P $P $P $P $P" \
  "#3d3d3d #4a4a4a #565656 #3a3a3a #6a6a6a #2c2c2c #525252"

write_gallery studio-shots "studio shots" 2024-10-14 \
  "controlled light experiments — backdrop and a single strobe." \
  "$S $S $S $S $S $S" \
  "#c2b5d8 #b7c2d4 #d2c4b7 #c0d4c0 #d8b7b7 #b5c6c2"

write_gallery golden-hour "golden hour" 2024-08-21 \
  "thirty minutes before sunset, a few sundays in a row." \
  "$L $L $L $L_WIDE $L $L $P $L $L" \
  "#c97829 #d68a35 #b56720 #e09a45 #c87a2b #a85a18 #d68e3a #c2741f #a85a1a"

write_gallery winter-walks "winter walks" 2024-06-02 \
  "january through february in the city. gray, slow, ok." \
  "$L_WIDE $L_WIDE $L $L_WIDE $L" \
  "#5a6b7a #4c5e6e #6e7e8c #485866 #5e6c7a"

write_gallery interior-bw "interior, b/w" 2024-04-15 \
  "afternoon light moving across a few rooms in the apartment." \
  "$P $P $P $P" \
  "#3a3a3a #555555 #2a2a2a #6c6c6c"

write_gallery tide-pools "tide pools" 2024-02-29 \
  "fitzgerald reserve at low tide. a lot of patience for crabs." \
  "$L $L $L $L $L $L" \
  "#1e5a52 #2a6c5f #186452 #277661 #225a4e #2e7a66"

write_gallery concert-set "concert set" 2024-01-11 \
  "three bands at the independent. iso brave, shutter brave." \
  "$L $L $P $L $L $P $L $L $P $L" \
  "#5a1e7a #6c2e8a #4a166a #7a3a99 #5e1f7d #802c8e #4d1864 #6f2785 #3d1056 #62208a"

write_gallery desert-drive "desert drive" 2026-04-04 \
  "joshua tree → twentynine palms, two days, mostly the car." \
  "$L_PANO $L_PANO $L_PANO $L_WIDE $L_PANO" \
  "#9c5a35 #b86a3e #a85e2e #8c4e22 #c4754a"

write_gallery morning-runs "morning runs" 2026-02-18 \
  "5am, marina, four mornings i actually got out of bed." \
  "$L $L $L $L" \
  "#c08a9a #b27a8c #a86a80 #c69aaa"

write_gallery june-2024 "june 2024" 2024-06-30 \
  "phone snaps — the kind you take when you don't want to think." \
  "$P_TALL $P_TALL $P $P_TALL $P $P_TALL $P $P_TALL" \
  "#4a6a3a #5a7e44 #4e6c3e #6a8c52 #547440 #466436 #5e7c46 #486838"

write_gallery cafe-paris "café — paris" 2025-01-08 \
  "the eight days i was there i drank a lot of coffee." \
  "$S $S $S $S $S $S" \
  "#8a6e4a #9a7c54 #7a5e3e #aa8e64 #6e5234 #8e7244"

write_gallery quick-snaps "quick snaps" 2026-01-25 \
  "iphone, mixed, undated dumps from the camera roll." \
  "$P $L $S $L_WIDE $P $L $S $P_TALL $L $S $L" \
  "#5a5a5a #6e6e6e #4a4a4a #7c7c7c #525252 #888888 #3e3e3e #686868 #5e5e5e #767676 #4e4e4e"

echo
echo "done. $(ls "$CONTENT" | grep -c .yaml) total gallery yaml files."
