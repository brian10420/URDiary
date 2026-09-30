#!/usr/bin/env node
/**
 * Renders the films (bundles once, then each target), then probes every output.
 *
 *   node scripts/render.mjs intro-zh intro-en loop          masters → out/
 *   node scripts/render.mjs --draft intro-zh intro-en loop  drafts  → out/draft/
 *
 * Masters: full size, H.264 CRF 16 (x264 slow), yuv420p, BT.709; IntroLong carries an audio
 * track (AAC 320k, silent until the narration / music files exist), ReadmeLoop is muted.
 * Drafts (npm run render:draft): scale 0.5, CRF 28 (x264 veryfast), JPEG 70, and the burned-in
 * scene / time / frame overlay — for checking the timeline, never for publishing.
 *
 * Options: --concurrency=N (default: Remotion's, half the CPU threads); --crf=N (masters: 16);
 * --out-dir=DIR (masters: out/, drafts: out/draft/); --suffix=S (appended to the file name, e.g.
 * -interim → intro-zh-interim.mp4). The interim cut for review:
 *   node scripts/render.mjs --crf=18 --out-dir=/mnt/Data_SSD/urdiary-media/renders/interim --suffix=-interim intro-zh intro-en loop
 * Run through npm (`npm run render:zh` …) so the generated mascot / media manifest are fresh.
 */
import {mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {ENTRY, OUT, findFfprobe, probe, rel} from './lib/tools.mjs';

const require = createRequire(import.meta.url);
const {bundle} = require('@remotion/bundler');
const {renderMedia, selectComposition} = require('@remotion/renderer');

const TARGETS = {
  'intro-zh': {id: 'IntroLong', props: {lang: 'zh'}, file: 'intro-zh.mp4', audio: true},
  'intro-en': {id: 'IntroLong', props: {lang: 'en'}, file: 'intro-en.mp4', audio: true},
  loop: {id: 'ReadmeLoop', props: {}, file: 'readme-loop.mp4', audio: false},
};

const args = process.argv.slice(2);
const draft = args.includes('--draft');
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const concurrency = Number(opt('concurrency')) || null;
const crfOpt = opt('crf') !== undefined ? Number(opt('crf')) : null;
const suffix = opt('suffix') ?? '';
const names = args.filter((a) => !a.startsWith('--'));
const unknown = names.filter((n) => !TARGETS[n]);
if (!names.length || unknown.length) {
  console.error(`usage: render.mjs [--draft] [--concurrency=N] ${Object.keys(TARGETS).join(' | ')} …${unknown.length ? `\nunknown: ${unknown.join(', ')}` : ''}`);
  process.exit(2);
}

const outDir = opt('out-dir') ? resolve(opt('out-dir')) : draft ? resolve(OUT, 'draft') : OUT;
mkdirSync(outDir, {recursive: true});

const t0 = Date.now();
process.stdout.write('bundling… ');
const serveUrl = await bundle({entryPoint: ENTRY, onProgress: () => {}});
console.log(`done (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

const ffprobe = findFfprobe();
const summary = [];
for (const name of names) {
  const target = TARGETS[name];
  const inputProps = {...target.props, draft};
  const composition = await selectComposition({serveUrl, id: target.id, inputProps});
  const outputLocation = resolve(outDir, target.file.replace(/\.mp4$/, `${suffix}.mp4`));
  const started = Date.now();
  let last = -1;
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: 'h264',
    outputLocation,
    overwrite: true,
    concurrency,
    colorSpace: 'bt709',
    pixelFormat: 'yuv420p',
    imageFormat: 'jpeg',
    scale: draft ? 0.5 : 1,
    crf: crfOpt ?? (draft ? 28 : 16),
    x264Preset: draft ? 'veryfast' : 'slow',
    jpegQuality: draft ? 70 : 95,
    muted: !target.audio,
    enforceAudioTrack: target.audio && !draft,
    audioBitrate: target.audio ? '320k' : null,
    logLevel: 'warn',
    onProgress: ({progress, renderedFrames}) => {
      const pct = Math.floor(progress * 10) * 10;
      if (pct !== last) {
        last = pct;
        process.stdout.write(`\r${name}: ${pct}% (${renderedFrames}/${composition.durationInFrames} frames)   `);
      }
    },
  });
  const secs = (Date.now() - started) / 1000;
  const p = probe(ffprobe, outputLocation, {count: true});
  const line = `${name}: ${rel(outputLocation)} — ${p.width}×${p.height}, ${p.fps} fps, ${p.frames} frames, video ${p.videoSec?.toFixed(3)} s (container ${p.durationSec?.toFixed(3)} s), ${p.codec} ${p.pixFmt}, audio ${p.hasAudio ? `yes (${p.audioSec?.toFixed(3)} s)` : 'none'}; rendered in ${secs.toFixed(0)} s`;
  console.log(`\r${line}`);
  summary.push({name, file: outputLocation, ...p, expectFrames: composition.durationInFrames, expectFps: composition.fps});
}

let bad = 0;
for (const s of summary) {
  const ok = s.frames === s.expectFrames && Math.abs(s.fps - s.expectFps) < 1e-6;
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${s.name}: ${s.frames}/${s.expectFrames} frames @ ${s.fps}/${s.expectFps} fps = ${(s.frames / s.fps).toFixed(3)} s`);
}
process.exit(bad ? 1 : 0);
