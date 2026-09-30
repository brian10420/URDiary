#!/usr/bin/env node
/**
 * `npm run check` (after `npm run gen`). Fails (exit 1) on the first class of problem it finds,
 * after printing everything it checked:
 *
 *   1 timeline   — scene table = STORYBOARD §1.1: contiguous, frames match §1.2, Σ = 5310
 *   2 narration  — §0 rhythm rules: in-point ≥ scene start + 0.6 s; the slow-delivery end the
 *                  rules give matches the storyboard's 「最晚」 (its 0.05/0.1 s rounding) and leaves ≥ 0.8 s of
 *                  music before the scene ends (or the next line); with TTS files present, the
 *                  real lengths must obey the same rules. Subtitles: they reproduce the line
 *                  exactly, zh ≤ 16 字 / en ≤ 42 characters per line, ≤ 2 lines per step.
 *   3 captions   — every on-screen text inside its scene, both languages present
 *   4 loop       — §2 loop math (P = 5.125 s, phase(17) = 2.125, phase(20) = 0 …)
 *   5 media      — the manifest: which slots have files; present files have the right shape
 *   6 layout     — renders the CaptionAudit still (zh, en) at 1080p in Chrome with the real
 *                  fonts: no caption / end-card line / loop card wraps past two lines, no subtitle
 *                  line wraps at all
 *   7 loop seam  — renders ReadmeLoop at frame 0 and at t = 20.000 s (frame 600, which the
 *                  loop never outputs) and asserts the two are pixel-identical; frame 599 must
 *                  differ from frame 0 (no held frame at the loop point)
 *
 * Artifacts (for eyes): out/check/caption-audit-{zh,en}.png, out/check/loop-seam-{000,599,600}.png
 */
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {CAPTIONS} from '../src/data/captions.ts';
import {expectedMedia} from '../src/data/expected-media.ts';
import {loopProblems, HERO_PERIOD_SEC, heroPhase, LOOP, LOOP_MIN_PX, G6} from '../src/data/loop.ts';
import {ROLES} from '../src/components/typography.ts';
import {narrationMediaId} from '../src/data/media.ts';
import {NARRATION, estimateSpeechSec, joinSubtitle} from '../src/data/narration.ts';
import {INTRO, LANGS, SCENES, TRANSITIONS, renderWindow, sceneById, timelineProblems} from '../src/data/timeline.ts';
import {MEDIA_MANIFEST} from '../src/generated/media-manifest.ts';
import {ENTRY, OUT, findFfmpeg, rel} from './lib/tools.mjs';

const require = createRequire(import.meta.url);
const failures = [];
const section = (name) => console.log(`\n== ${name}`);
const pass = (msg) => console.log(`  PASS ${msg}`);
const fail = (msg) => {
  failures.push(msg);
  console.log(`  FAIL ${msg}`);
};
const check = (ok, msg) => (ok ? pass(msg) : fail(msg));

// ---------------------------------------------------------------- 1 timeline
section('1 timeline (STORYBOARD §1.1)');
{
  const probs = timelineProblems();
  check(probs.length === 0, `scene table: ${probs.length ? probs.join('; ') : 'contiguous, on frame boundaries, frames = §1.2 headings'}`);
  const total = SCENES.reduce((n, s) => n + Math.round((s.end - s.start) * INTRO.fps), 0);
  check(total === INTRO.durationInFrames, `Σ scene frames = ${total} (expected ${INTRO.durationInFrames} = ${INTRO.durationSec} s × ${INTRO.fps} fps)`);
  for (const s of SCENES) console.log(`       ${s.id.padEnd(3)} ${s.start.toFixed(1).padStart(4)}–${s.end.toFixed(1).padStart(4)} s  frames ${String(s.frames[0]).padStart(4)}–${String(s.frames[1]).padStart(4)}  ${s.name}`);
  const untimed = TRANSITIONS.filter((t) => !t.timed);
  console.log(`       transitions: ${TRANSITIONS.length} (${untimed.length} without storyboard times, windows chosen: ${untimed.map((t) => `${t.from}→${t.to} ${t.start}–${t.end}`).join(', ')})`);
}

// ---------------------------------------------------------------- 2 narration
section('2 narration & subtitles (§0 節奏規則)');
{
  const ZH_MAX = 16;
  const EN_MAX = 42;
  const before = failures.length;
  let n = 0;
  for (const lang of LANGS) {
    for (const [i, line] of NARRATION.entries()) {
      const scene = sceneById(line.scene);
      const prev = NARRATION[i - 1];
      const next = NARRATION[i + 1];
      const firstInScene = !prev || prev.scene !== line.scene;
      const lastInScene = !next || next.scene !== line.scene;
      const start = line.in[lang];
      const est = start + estimateSpeechSec(line.text[lang], lang);
      const id = `${line.id} ${lang}`;
      if (firstInScene && start < scene.start + 0.6 - 1e-9) fail(`${id}: in-point ${start} s is < scene start + 0.6 s`);
      // The storyboard rounds its 「最晚」 to 0.05 / 0.1 s, almost always up (22.93 → 23.0).
      const drift = line.latestEnd[lang] - est;
      if (drift < -0.05 || drift > 0.1) fail(`${id}: rhythm model ends at ${est.toFixed(2)} s, storyboard says 最晚 ${line.latestEnd[lang]} s`);
      const limit = lastInScene ? scene.end - 0.8 : next.in[lang];
      if (Math.max(est, line.latestEnd[lang]) > limit + 1e-9) fail(`${id}: ends ${Math.max(est, line.latestEnd[lang]).toFixed(2)} s, must end by ${limit.toFixed(2)} s`);
      const m = MEDIA_MANIFEST[narrationMediaId(line.id, lang)];
      if (m?.durationSec) {
        const real = start + m.durationSec;
        if (real > limit + 1e-9) fail(`${id}: TTS file ends ${real.toFixed(2)} s, must end by ${limit.toFixed(2)} s (§0: 刪字，不加速)`);
        else pass(`${id}: TTS ${m.durationSec.toFixed(2)} s fits (ends ${real.toFixed(2)} s ≤ ${limit.toFixed(2)} s)`);
      }
      const joined = joinSubtitle(line.subtitles[lang], lang);
      if (joined !== line.text[lang]) fail(`${id}: subtitles do not reproduce the line:\n         "${joined}"\n       ≠ "${line.text[lang]}"`);
      for (const ev of line.subtitles[lang]) {
        if (ev.length > 2) fail(`${id}: a subtitle step has ${ev.length} lines`);
        for (const l of ev) {
          const len = Array.from(l).length;
          if (lang === 'zh' ? len > ZH_MAX : len > EN_MAX) fail(`${id}: subtitle line "${l}" is ${len} characters (max ${lang === 'zh' ? ZH_MAX : EN_MAX})`);
        }
      }
      n++;
    }
  }
  if (failures.length === before) pass(`${n} lines × rules: in-points, 最晚 ends (storyboard = §0 model −0.05…+0.1 s), ≥ 0.8 s tails, subtitle text / zh ≤ 16 / en ≤ 42 / ≤ 2 lines`);
  const burned = NARRATION.filter((l) => !l.burnIn).map((l) => l.id);
  console.log(`       not burned in: ${burned.join(', ') || '—'} (S10's main end card is the same sentence, in sync)`);
}

// ---------------------------------------------------------------- 3 captions
section('3 on-screen text (§1.2 畫面文字)');
{
  const before = failures.length;
  for (const c of CAPTIONS) {
    const w = renderWindow(c.scene);
    if (!(c.out > c.in)) fail(`${c.id}: out ${c.out} ≤ in ${c.in}`);
    if (c.in < w.start - 1e-9 || c.out > w.end + 1e-9) fail(`${c.id}: ${c.in}–${c.out} s is outside ${c.scene}'s window ${w.start}–${w.end} s`);
    for (const lang of LANGS) {
      if (!c.text[lang]?.trim()) fail(`${c.id}: no ${lang} text`);
      if (c.sub && !c.sub[lang]?.trim()) fail(`${c.id}: no ${lang} small line`);
    }
  }
  if (failures.length === before) pass(`${CAPTIONS.length} items inside their scenes, zh + en present (${CAPTIONS.filter((c) => c.provisional).length} provisional: ${CAPTIONS.filter((c) => c.provisional).map((c) => c.id).join(', ')})`);
}

// ---------------------------------------------------------------- 4 loop
section('4 ReadmeLoop math (§2)');
{
  const probs = loopProblems();
  check(probs.length === 0, probs.length ? probs.join('; ') : `P = ${HERO_PERIOD_SEC} s (${G6.generatedFrames - 1}/${G6.fps}); phase(0) = ${heroPhase(0)}, phase(17) = ${heroPhase(17)}, phase(20) = ${heroPhase(20)}; ${LOOP.durationInFrames} frames, frame ${LOOP.durationInFrames} not output`);
  // §2 「無聲可讀」: master type en ≥ 44 px, zh ≥ 40 px (the loop cards set en in loop-en, zh in loop-zh)
  const en = ROLES['loop-en'].en.size;
  const zh = ROLES['loop-zh'].zh.size;
  check(en >= LOOP_MIN_PX.en && zh >= LOOP_MIN_PX.zh, `loop card type: en ${en} px (≥ ${LOOP_MIN_PX.en}), zh ${zh} px (≥ ${LOOP_MIN_PX.zh}) on the 1280×720 master`);
}

// ---------------------------------------------------------------- 5 media
section('5 media manifest (public/media → src/generated/media-manifest.ts)');
{
  const expected = expectedMedia();
  const present = expected.filter((e) => MEDIA_MANIFEST[e.id]);
  const missing = expected.filter((e) => !MEDIA_MANIFEST[e.id] && e.required);
  pass(`${present.length}/${expected.length} slots have files; ${missing.length} required slots show a placeholder / stay silent`);
  const g6 = MEDIA_MANIFEST.G6;
  if (g6) {
    check(g6.fps === G6.fps && (g6.frames === null || g6.frames === G6.generatedFrames), `G6: ${g6.frames} frames @ ${g6.fps} fps (loop math expects ${G6.generatedFrames} @ ${G6.fps}, first = last)`);
  }
  for (const [id, m] of Object.entries(MEDIA_MANIFEST)) {
    if (/^U\d\d-/.test(id) && m.kind === 'video' && m.fps && Math.abs(m.fps - 60) > 0.01) fail(`${id}: ${m.fps} fps — UI recordings are converted to CFR 60 fps (§3.4 #11)`);
  }
}

// ---------------------------------------------------------------- 6 + 7 need Chrome
const {bundle} = require('@remotion/bundler');
const {renderStill, selectComposition} = require('@remotion/renderer');
const CHECK_OUT = resolve(OUT, 'check');
mkdirSync(CHECK_OUT, {recursive: true});
process.stdout.write('\n(bundling for the browser checks… ');
const t0 = Date.now();
const serveUrl = await bundle({entryPoint: ENTRY, onProgress: () => {}});
console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s)`);

section('6 layout audit — every text block at 1080p, real fonts, ≤ 2 lines');
for (const lang of LANGS) {
  let report = null;
  const inputProps = {lang};
  const output = resolve(CHECK_OUT, `caption-audit-${lang}.png`);
  try {
    const composition = await selectComposition({serveUrl, id: 'CaptionAudit', inputProps});
    await renderStill({
      serveUrl,
      composition,
      inputProps,
      output,
      overwrite: true,
      scale: 0.5,
      logLevel: 'error',
      onBrowserLog: (log) => {
        if (log.text.startsWith('CAPTION_AUDIT ')) report = JSON.parse(log.text.slice('CAPTION_AUDIT '.length));
      },
    });
  } catch (e) {
    fail(`${lang}: ${String(e.message || e).split('\n').slice(0, 12).join('\n       ')}`);
  }
  if (report) {
    check(report.bad.length === 0, `${lang}: ${report.blocks} blocks measured, max ${report.maxLines} lines; two-line blocks: ${report.twoLines.join(', ') || '—'} → ${rel(output)}`);
  } else if (!failures.some((f) => f.startsWith(`${lang}:`))) fail(`${lang}: the audit reported nothing`);
}

section('7 ReadmeLoop seam — frame 0 vs t = 20.000 s');
{
  const composition = await selectComposition({serveUrl, id: 'ReadmeLoopSeam', inputProps: {draft: false}});
  const shot = async (frame) => {
    const output = resolve(CHECK_OUT, `loop-seam-${String(frame).padStart(3, '0')}.png`);
    await renderStill({serveUrl, composition, frame, output, overwrite: true, imageFormat: 'png', inputProps: {draft: false}, logLevel: 'error'});
    return output;
  };
  const f0 = await shot(0);
  const f600 = await shot(LOOP.durationInFrames);
  const f599 = await shot(LOOP.durationInFrames - 1);
  let ffmpeg = null;
  const pixels = (file) => {
    ffmpeg ??= findFfmpeg([]);
    return execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], {maxBuffer: 64 * 1024 * 1024});
  };
  const same = (a, b) => {
    if (readFileSync(a).equals(readFileSync(b))) return true;
    return pixels(a).equals(pixels(b));
  };
  check(same(f0, f600), `frame 0 and frame 600 (t = ${(LOOP.durationInFrames / LOOP.fps).toFixed(3)} s, phase ${heroPhase(LOOP.durationSec)}) are pixel-identical → ${rel(f0)}, ${rel(f600)}`);
  check(!same(f0, f599), `frame 599 differs from frame 0 (no held frame at the loop point)`);
}

console.log(`\n${failures.length ? `check: ${failures.length} FAILED` : 'check: all passed'}`);
process.exit(failures.length ? 1 : 0);
