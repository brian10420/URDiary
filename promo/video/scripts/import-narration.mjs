#!/usr/bin/env node
/**
 * Copies the normalized narration (promo/narration → /mnt/Data_SSD/urdiary-media/narration) into
 * public/media/narration/<lang>/<id>.wav (gitignored), after checking that the TTS manifest and
 * src/data/narration.ts agree: same ids, same text, same in-points (the WAV's 0 s goes on the
 * in-point; each file starts with ~0.12 s of silence). Prints where every line ends against the
 * §0 rule (≥ 0.8 s before its scene ends, or before the next line of the same scene).
 *
 *   node scripts/import-narration.mjs [--manifest=/path/manifest.json]
 */
import {copyFileSync, existsSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {NARRATION} from '../src/data/narration.ts';
import {sceneById} from '../src/data/timeline.ts';
import {MEDIA} from './lib/tools.mjs';

const arg = process.argv.find((a) => a.startsWith('--manifest='));
const MANIFEST = arg ? arg.split('=')[1] : '/mnt/Data_SSD/urdiary-media/narration/manifest.json';
const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const problems = [];
let copied = 0;
for (const lang of ['zh', 'en']) {
  NARRATION.forEach((line, i) => {
    const e = m.entries.find((x) => x.id === line.id && x.lang === lang);
    if (!e) return problems.push(`${line.id} ${lang}: not in ${MANIFEST}`);
    if (e.text !== line.text[lang]) problems.push(`${line.id} ${lang}: text differs from narration.ts\n    tts:  ${e.text}\n    film: ${line.text[lang]}`);
    if (Math.abs(e.in_point_s - line.in[lang]) > 1e-6) problems.push(`${line.id} ${lang}: TTS in-point ${e.in_point_s} ≠ narration.ts ${line.in[lang]}`);
    const src = e.files?.wav;
    if (!src || !existsSync(src)) return problems.push(`${line.id} ${lang}: no WAV (${src})`);
    const dst = resolve(MEDIA, 'narration', lang, `${line.id}.wav`);
    mkdirSync(dirname(dst), {recursive: true});
    // one file per slot: drop a stale mp3 of the same id (media-manifest refuses two files for one id)
    for (const ext of ['mp3', 'm4a', 'aac', 'ogg', 'flac']) rmSync(resolve(MEDIA, 'narration', lang, `${line.id}.${ext}`), {force: true});
    copyFileSync(src, dst);
    copied++;
    const next = NARRATION[i + 1];
    const sameScene = next && next.scene === line.scene;
    const limit = sameScene ? next.in[lang] : sceneById(line.scene).end - 0.8;
    const end = line.in[lang] + e.duration_s;
    const ok = end <= limit + 1e-9;
    if (!ok) problems.push(`${line.id} ${lang}: ends ${end.toFixed(2)} s > ${limit.toFixed(2)} s`);
    console.log(`  ${ok ? 'ok  ' : 'LATE'} ${lang} ${line.id.padEnd(5)} in ${line.in[lang].toFixed(2).padStart(5)}  ${e.duration_s.toFixed(3)} s → ends ${end.toFixed(2).padStart(5)} (limit ${limit.toFixed(2)}${sameScene ? `, next line` : `, ${line.scene} ends ${sceneById(line.scene).end}`}; ${e.voice}, ${e.lufs} LUFS)`);
  });
}
console.log(`import-narration: ${copied} WAVs → public/media/narration/ (from ${MANIFEST})`);
if (problems.length) {
  for (const p of problems) console.error(`import-narration: ERROR ${p}`);
  process.exit(1);
}
