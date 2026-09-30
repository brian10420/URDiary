#!/usr/bin/env node
/**
 * The job list for scripts/make-intermediates.sh, computed from src/data/shots.ts: one TSV line per
 * clip (id, source, seek, frame count, filter chain, output, shift note, expected size). Also checks
 * each take's recorder JSON: the anchor event (swapped takes), the stub / crisis-word checks.
 *
 *   node scripts/lib/intermediates-plan.mjs [id or shot …]     e.g.  ui/U12-zh   U12   (none = all)
 *
 * Messages go to stderr; stdout is only the TSV.
 */
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {CLIPS, CLIP_FPS, DEVICES, RECORDINGS_DIR, clipInFrame, clipOutFrame} from '../../src/data/shots.ts';
import {MEDIA} from './tools.mjs';

const want = process.argv.slice(2);
const pick = (c) => !want.length || want.some((w) => w === c.id || w === c.shot || `ui/${w}` === c.id);
const clips = CLIPS.filter(pick);
if (!clips.length) {
  console.error(`intermediates-plan: nothing matches ${want.join(' ')} (ids: ${CLIPS.map((c) => c.id).join(', ')})`);
  process.exit(2);
}

let bad = 0;
for (const c of clips) {
  const src = resolve(RECORDINGS_DIR, c.shot, `${c.take}.mov`);
  const meta = resolve(RECORDINGS_DIR, c.shot, `${c.take}.json`);
  if (!existsSync(src)) {
    console.error(`  ${c.id}: MISSING ${src}`);
    bad++;
    continue;
  }
  const j = existsSync(meta) ? JSON.parse(readFileSync(meta, 'utf8')) : null;
  const total = j?.ffprobe?.frames ?? null; // frames in the take (CFR 60)
  if (j?.checks?.stub_text) console.error(`  ${c.id}: WARNING ${c.take} has stub text (checks.stub_text)`);
  if (j?.checks?.crisis_words?.length) console.error(`  ${c.id}: WARNING ${c.take} crisis words: ${j.checks.crisis_words.join(', ')}`);

  // Anchor: follow the named recorder event into a swapped take.
  let shift = 0;
  if (c.anchor) {
    const ev = j?.events?.find((e) => e.what === c.anchor.event);
    if (!ev) {
      console.error(`  ${c.id}: anchor event "${c.anchor.event}" not in ${meta}`);
      bad++;
      continue;
    }
    shift = Math.round((ev.t - c.anchor.at) * CLIP_FPS) / CLIP_FPS;
    if (shift) console.error(`  ${c.id}: ${c.take} has "${c.anchor.event}" at ${ev.t} s (table: ${c.anchor.at} s) → trim shifted ${shift > 0 ? '+' : ''}${shift.toFixed(3)} s`);
  }
  let inF = clipInFrame(c) + Math.round(shift * CLIP_FPS);
  let outF = clipOutFrame(c) + Math.round(shift * CLIP_FPS);
  if (inF < 0) {
    console.error(`  ${c.id}: WARNING in-point before the take starts; clamped (knots will be off by ${(-inF / CLIP_FPS).toFixed(3)} s)`);
    inF = 0;
  }
  if (total && outF > total) outF = total;
  const frames = outF - inF;
  if (frames <= 0) {
    console.error(`  ${c.id}: empty range`);
    bad++;
    continue;
  }

  const dev = DEVICES[c.device];
  const [x, y, w, h] = c.crop ?? [0, 0, dev.css[0], dev.css[1]];
  const outW = Math.round(w * c.scale);
  const outH = Math.round(h * c.scale);
  const filters = ['setpts=PTS-STARTPTS'];
  if (c.crop) filters.push(`crop=${w * dev.dpr}:${h * dev.dpr}:${x * dev.dpr}:${y * dev.dpr}`);
  if (c.scale !== dev.dpr) filters.push(`scale=${outW}:${outH}:flags=lanczos:in_color_matrix=bt709:out_color_matrix=bt709`);
  filters.push('setsar=1', 'format=yuv420p');
  // Seek half a frame early: the first frame whose pts ≥ seek is exactly frame inF.
  const ss = ((inF - 0.5) / CLIP_FPS).toFixed(6);
  const out = resolve(MEDIA, `${c.id}.mp4`);
  const note = `${c.take} frames ${inF}–${outF - 1} (${(inF / CLIP_FPS).toFixed(3)}–${(outF / CLIP_FPS).toFixed(3)} s)${shift ? ` shift ${shift}` : ''}`;
  process.stdout.write([c.id, src, ss, frames, filters.join(','), out, note, `${outW}x${outH}`].join('\t') + '\n');
}
if (bad) process.exit(1);
