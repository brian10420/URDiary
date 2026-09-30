# site/tools — how the showcase page is built and checked

`site/` is a static page with no build step. These tools are dev-only; the Pages workflow
(`.github/workflows/pages.yml`) deletes `site/tools/` before uploading.

## Preview locally

```bash
site/tools/sync-mascot.sh                  # copy the mascot + icon from desktop/ into site/vendor/ (gitignored)
python3 -m http.server 8130 --bind 127.0.0.1 --directory site
# open http://127.0.0.1:8130/
```

The page runs the app's own `mascot.js`, `mascot_motion.js` and `mascot.css`; never edit the
copies in `site/vendor/` — edit `desktop/` and re-sync. `sync-mascot.sh --check` fails if a copy is
missing or stale (`--allow-missing` tolerates a fresh clone).

## Copy

Every visible string is in `site/i18n.js` (zh-TW and en). `node site/tools/check-i18n.js` fails on
missing keys, empty strings, mismatched `{placeholders}`, keys the page uses but the dictionary
lacks, and static `<title>` / description / og tags that drifted from the en strings. Facts must
match the app and `promo/video/STORYBOARD.md` §0/§6 (privacy wording, optional ask-first mode, no
"asks before advising").

## Screenshots (`site/assets/screens/{zh,en}/*.webp`)

Real UI from the fictional demo personas, never from `data/`:

```bash
export URDIARY_DATA_DIR=$(mktemp -d /tmp/urdiary-demo-XXXXXX)
.venv/bin/python promo/demo/seed_demo.py
.venv/bin/python promo/demo/seed_demo.py --user yuqing,maya --set-checkin today   # no stub greeting
promo/demo/run_demo_backend.sh --stub &                                           # 127.0.0.1:8124
node site/tools/capture-screens.js            # --only onboarding,… ; onboarding needs seed_demo.py --reset-hello first
# stop the backend afterwards; nothing should listen on 8124
```

Each zh/en pair has identical pixel dimensions (the page reserves them with width/height). If a
re-shoot changes a size, update the `width`/`height` in `index.html`.

## Videos (Stage 3)

Put `hero-loop.mp4` (the ReadmeLoop, H.264) and `intro-zh.mp4` / `intro-en.mp4` in `site/media/`,
then run `node site/tools/media-manifest.js` (the workflow runs it too). The page requests only the
files listed in `media/manifest.json`, so a video that does not exist yet costs no request and no
console error; a listed file that fails to load falls back through `onerror`. Keep every committed
file under 10 MB (a larger intro video would have to be fetched into `site/media/` by the workflow).
When AI-generated media go on the page, set `aiMediaDisclosure: true` in `site/config.js`.

## Link-preview image

`node site/tools/render-og.js` renders `tools/og-card.html` (mascot from `vendor/`, words from
`i18n.js`) to `site/assets/og-image.png`.

## Verify

```bash
site/tools/sync-mascot.sh && node site/tools/verify-site.js --out /tmp/urdiary-site-shots
```

Serves `site/` on a free port ≥ 8130 and checks, in Chromium (and Google Chrome for the H.264
path): 1440/390 × zh/en × light/dark with zero console errors, reduced motion with zero running
animations, no horizontal scroll at 360/390, links, landmarks/alt/headings, contrast, CLS, page
weight ≤ 3 MB, the language toggle, mascot interactions, and both video paths.
