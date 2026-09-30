// Shared helpers for the scripts: paths, ffprobe / ffmpeg discovery, small formatting bits.
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO = resolve(PROJECT, '..', '..');
export const PUBLIC = resolve(PROJECT, 'public');
export const MEDIA = resolve(PUBLIC, 'media');
export const OUT = resolve(PROJECT, 'out');
export const ENTRY = resolve(PROJECT, 'src/index.ts');

const require = createRequire(import.meta.url);
const compositorDir = () => {
  try {
    return dirname(require.resolve('@remotion/compositor-linux-x64-gnu/package.json'));
  } catch {
    return null;
  }
};

/** The full static ffmpeg build next to ComfyUI (has `tile`, `drawtext`); Remotion's own is minimal. */
const STATIC_BIN = '/mnt/Data_SSD/ComfyUI/.venv/bin';

/** ffprobe: $FFPROBE → Remotion's bundled one → ComfyUI's static_ffprobe → PATH. */
export const findFfprobe = () => {
  const c = compositorDir();
  const candidates = [process.env.FFPROBE, c && resolve(c, 'ffprobe'), `${STATIC_BIN}/static_ffprobe`, 'ffprobe'].filter(Boolean);
  for (const bin of candidates) {
    const r = spawnSync(bin, ['-version'], {encoding: 'utf8'});
    if (r.status === 0) return bin;
  }
  throw new Error('no working ffprobe found (set FFPROBE=/path/to/ffprobe)');
};

/** ffmpeg with the given filters: $FFMPEG → ComfyUI's static_ffmpeg → PATH → Remotion's bundled one. */
export const findFfmpeg = (needFilters = []) => {
  const c = compositorDir();
  const candidates = [process.env.FFMPEG, `${STATIC_BIN}/static_ffmpeg`, 'ffmpeg', c && resolve(c, 'ffmpeg')].filter(Boolean);
  for (const bin of candidates) {
    const r = spawnSync(bin, ['-hide_banner', '-filters'], {encoding: 'utf8'});
    if (r.status !== 0) continue;
    if (needFilters.every((f) => new RegExp(`\\s${f}\\s`).test(r.stdout))) return bin;
  }
  throw new Error(`no ffmpeg with filters [${needFilters.join(', ')}] found (set FFMPEG=/path/to/ffmpeg)`);
};

/**
 * ffprobe → {durationSec, videoSec, width, height, fps, frames, codec, pixFmt, hasAudio, audioSec}
 * (nulls where absent). `count: true` decodes every frame for an exact count (slow on long 4K
 * files — used for verifying renders, not for the manifest).
 */
export const probe = (ffprobe, file, {count = false} = {}) => {
  const entries = 'format=duration:stream=codec_type,codec_name,pix_fmt,width,height,avg_frame_rate,r_frame_rate,nb_frames,nb_read_frames,duration';
  const raw = execFileSync(
    ffprobe,
    ['-v', 'error', ...(count ? ['-count_frames'] : []), '-show_entries', entries, '-of', 'json', file],
    {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024},
  );
  const j = JSON.parse(raw);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  const rate = (r) => {
    if (!r || r === '0/0') return null;
    const [n, d] = r.split('/').map(Number);
    return d ? n / d : null;
  };
  return {
    durationSec: j.format?.duration ? Number(j.format.duration) : null,
    videoSec: v?.duration ? Number(v.duration) : null,
    width: v?.width ?? null,
    height: v?.height ?? null,
    fps: v ? rate(v.avg_frame_rate) ?? rate(v.r_frame_rate) : null,
    frames: v?.nb_read_frames ? Number(v.nb_read_frames) : v?.nb_frames ? Number(v.nb_frames) : null,
    codec: v?.codec_name ?? a?.codec_name ?? null,
    pixFmt: v?.pix_fmt ?? null,
    hasAudio: Boolean(a),
    audioSec: a?.duration ? Number(a.duration) : null,
  };
};

export const exists = (p) => existsSync(p);
export const rel = (p) => p.replace(`${PROJECT}/`, '');
