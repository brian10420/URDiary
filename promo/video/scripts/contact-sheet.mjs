#!/usr/bin/env node
/**
 * A contact sheet: N evenly spaced frames of a video, tiled (ffmpeg select + tile).
 *
 *   node scripts/contact-sheet.mjs <video> <out.png> [--count=20] [--cols=5] [--width=384]
 *
 * Frame i is the one in the middle of the i-th of N equal slices (so the first tile is not frame
 * 0 and the last is not the final frame). Needs an ffmpeg with the `tile` filter — the static
 * build next to ComfyUI is found automatically (Remotion's bundled ffmpeg is too minimal);
 * override with FFMPEG=/path/to/ffmpeg.
 */
import {execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {findFfmpeg, findFfprobe, probe} from './lib/tools.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => Number(args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt);
const [video, out] = args.filter((a) => !a.startsWith('--'));
if (!video || !out) {
  console.error('usage: contact-sheet.mjs <video> <out.png> [--count=20] [--cols=5] [--width=384]');
  process.exit(2);
}
const count = opt('count', 20);
const cols = opt('cols', 5);
const width = opt('width', 384);
const rows = Math.ceil(count / cols);

const info = probe(findFfprobe(), resolve(video), {count: true});
const n = info.frames;
if (!n) throw new Error(`cannot count the frames of ${video}`);
const frames = Array.from({length: count}, (_, i) => Math.min(n - 1, Math.floor(((i + 0.5) * n) / count)));
const select = frames.map((f) => `eq(n\\,${f})`).join('+');
const ffmpeg = findFfmpeg(['select', 'scale', 'tile']);
mkdirSync(dirname(resolve(out)), {recursive: true});
execFileSync(ffmpeg, [
  '-v', 'error', '-y',
  '-i', resolve(video),
  '-vf', `select='${select}',scale=${width}:-2,tile=${cols}x${rows}:padding=6:margin=6:color=0x2b1a10`,
  '-fps_mode', 'passthrough',
  '-frames:v', '1',
  resolve(out),
]);
const times = frames.map((f) => (info.fps ? (f / info.fps).toFixed(2) : String(f)));
console.log(`contact-sheet: ${out} — ${count} frames of ${n} (${cols}×${rows}, ${width} px wide): t = ${times.join(', ')} s`);
