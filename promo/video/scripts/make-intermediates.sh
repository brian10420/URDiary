#!/usr/bin/env bash
# UI-recording intermediates for Remotion's <OffthreadVideo>, from the table in src/data/shots.ts.
#
#   scripts/make-intermediates.sh                 all clips
#   scripts/make-intermediates.sh ui/U12-zh U05   only these (ids or shot names)
#   scripts/make-intermediates.sh --dry-run       print the jobs, encode nothing
#
# Each clip: the ProRes 422 HQ take (recordings/<shot>/<take>.mov, 3840×2160 or 1170×2532 @ 60) →
# trimmed to whole frames [in, out) → optional crop → lanczos to the clip's scale (desktop 1920×1080,
# phone 780×1688, crops native 2×) → H.264 CRF 14 slow, yuv420p, GOP 30, BT.709 tags, faststart,
# no audio → public/media/ui/<id>.mp4 (gitignored). The takes are already CFR 60 with exact k/60
# timestamps, so frames pass through 1:1 (setpts from 0, no -r: a CFR resampler would duplicate the
# first frame and shift the whole clip by one frame). Speed-ups are NOT baked in: they live in
# shots.ts SPEED_MAPS and are applied by <MediaSlot>. Every output is ffprobed (size, fps, frames).
#
# Tools: ComfyUI's static ffmpeg (override with FFMPEG= / FFPROBE=). Runs niced — recordings may be
# in progress on the same machine.
set -euo pipefail
cd "$(dirname "$0")/.."
FFMPEG=${FFMPEG:-/mnt/Data_SSD/ComfyUI/.venv/bin/static_ffmpeg}
FFPROBE=${FFPROBE:-/mnt/Data_SSD/ComfyUI/.venv/bin/static_ffprobe}
DRY=0
ARGS=()
for a in "$@"; do
  if [[ $a == --dry-run ]]; then DRY=1; else ARGS+=("$a"); fi
done

PLAN=$(node scripts/lib/intermediates-plan.mjs "${ARGS[@]}")
[[ -n $PLAN ]] || { echo "make-intermediates: empty plan" >&2; exit 1; }

fail=0
while IFS=$'\t' read -r id src ss frames vf out note size; do
  echo "== $id  ←  $note  → $size"
  if (( DRY )); then
    echo "   $FFMPEG -ss $ss -i $src -frames:v $frames -vf '$vf' … $out"
    continue
  fi
  mkdir -p "$(dirname "$out")"
  tmp="${out%.mp4}.part.mp4"
  t0=$(date +%s)
  nice -n 15 "$FFMPEG" -nostdin -hide_banner -v error -y \
    -ss "$ss" -i "$src" -frames:v "$frames" \
    -vf "$vf" -an -fps_mode passthrough \
    -c:v libx264 -preset slow -crf 14 -g 30 -pix_fmt yuv420p \
    -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
    -movflags +faststart "$tmp"
  mv -f "$tmp" "$out"
  got=$("$FFPROBE" -v error -select_streams v:0 -count_frames \
    -show_entries stream=width,height,r_frame_rate,nb_read_frames,codec_name,pix_fmt -of csv=p=0 "$out" </dev/null)
  IFS=',' read -r codec w h pix rate n <<<"$got"
  mb=$(du -m "$out" | cut -f1)
  ok=OK
  [[ "${w}x${h}" == "$size" && "$rate" == "60/1" && "$n" == "$frames" && "$pix" == "yuv420p" ]] || { ok=FAIL; fail=1; }
  echo "   $ok $codec ${w}x${h} $pix $rate, $n/$frames frames, ${mb} MB, $(( $(date +%s) - t0 )) s → ${out#"$PWD"/}"
done <<<"$PLAN"
exit $fail
