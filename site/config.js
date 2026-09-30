/**
 * URDiary showcase — page configuration (no copy here; all text lives in i18n.js).
 *
 * media: where the videos will live once Stage 3 produces them. The page never requests a
 *   file that media/manifest.json does not list (a missing file would 404 and log a console
 *   error), and falls back to the interactive mascot / the "coming soon" card when a listed
 *   file fails to load (onerror). The Pages workflow regenerates the manifest from the files
 *   actually present in site/media/ (site/tools/media-manifest.js), so adding a video there is
 *   enough — no code change.
 *
 * aiMediaDisclosure: flip to true in the same commit that publishes AI-generated illustrations
 *   or video (ComfyUI / Wan / Qwen-Image output) on this page; it shows the
 *   "部分插圖／影片由 AI 生成 / Some illustrations and videos … generated with AI" line.
 *   Keep it false while every visual on the page comes from the app itself.
 */
window.URDIARY_SITE = {
    media: {
        heroLoop: 'media/hero-loop.mp4',
        intro: { 'zh-TW': 'media/intro-zh.mp4', 'en': 'media/intro-en.mp4' }
    },
    aiMediaDisclosure: false
};
