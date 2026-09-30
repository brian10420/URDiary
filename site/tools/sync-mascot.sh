#!/usr/bin/env bash
# Copies the mascot's single source of truth from desktop/ into site/vendor/ (gitignored),
# so the showcase runs the app's own mascot code instead of a fork of it:
#   desktop/js/mascot.js, desktop/js/mascot_motion.js, desktop/css/mascot.css
# plus the app icon used as the page's favicon / header logo.
#
#   site/tools/sync-mascot.sh                    copy (run before previewing the site locally)
#   site/tools/sync-mascot.sh --check            verify: every copy present and byte-identical
#   site/tools/sync-mascot.sh --check --allow-missing
#                                                verify only the copies that exist (fresh clone)
#
# The Pages workflow runs the copy and then --check before uploading the artifact.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$SITE/.." && pwd)"
VENDOR="$SITE/vendor"

# source (relative to the repo root)          → vendor/<name>
PAIRS=(
  "desktop/js/mascot.js:mascot.js"
  "desktop/js/mascot_motion.js:mascot_motion.js"
  "desktop/css/mascot.css:mascot.css"
  "desktop/favicon.ico:favicon.ico"
  "desktop/assets/icons/icon-192.png:icon-192.png"
  "desktop/assets/icons/apple-touch-icon-180.png:apple-touch-icon-180.png"
)

MODE=copy
ALLOW_MISSING=0
for arg in "$@"; do
  case "$arg" in
    --check) MODE=check ;;
    --allow-missing) ALLOW_MISSING=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "sync-mascot: unknown option: $arg" >&2; exit 2 ;;
  esac
done

status=0
for pair in "${PAIRS[@]}"; do
  src="$REPO/${pair%%:*}"
  dst="$VENDOR/${pair##*:}"
  if [ ! -f "$src" ]; then
    echo "sync-mascot: source missing: ${pair%%:*}" >&2
    status=1
    continue
  fi
  if [ "$MODE" = copy ]; then
    mkdir -p "$VENDOR"
    cp "$src" "$dst"
    echo "copied   ${pair%%:*} -> site/vendor/${pair##*:}"
  elif [ ! -f "$dst" ]; then
    if [ "$ALLOW_MISSING" = 1 ]; then
      echo "absent   site/vendor/${pair##*:} (not synced yet)"
    else
      echo "MISSING  site/vendor/${pair##*:} — run site/tools/sync-mascot.sh" >&2
      status=1
    fi
  elif cmp -s "$src" "$dst"; then
    echo "ok       site/vendor/${pair##*:} == ${pair%%:*}"
  else
    echo "STALE    site/vendor/${pair##*:} differs from ${pair%%:*} — run site/tools/sync-mascot.sh" >&2
    status=1
  fi
done

if [ "$MODE" = check ]; then
  if [ "$status" = 0 ]; then echo "sync-mascot: check passed"; else echo "sync-mascot: check FAILED" >&2; fi
fi
exit "$status"
