/**
 * ReadmeLoop — the silent 20 s loop for the README / showcase hero (STORYBOARD §2).
 *
 * 1280×720, 30 fps, 600 frames (0–599). Designed so that t = 20.000 s equals t = 0; frame 600 is
 * never output, so the loop point does not hold a frame twice.
 *
 * Loop seam (§2 「循環接縫」): G6 is generated first frame = last frame; looping drops that
 * duplicate, so its period is P = 123 / 24 = 5.125 s. The opening uses the loop time t
 * (0 → 3.5); the closing uses (t − 20) mod P, so t = 17.0 is phase 2.125 s and t = 20.0 is
 * phase 0 — frame 0 again. The hero card is fully on at t = 0 (no fade at the start) and has
 * faded fully in before 18.0 s at the end, so both ends match exactly.
 */
import type {Lang} from './timeline.ts';

export const LOOP = {
  id: 'ReadmeLoop',
  width: 1280,
  height: 720,
  fps: 30,
  durationSec: 20.0,
  durationInFrames: 600,
} as const;

/** G6 source: 124 frames @ 24 fps with first = last; the loop drops the last → 123-frame period. */
export const G6 = {fps: 24, generatedFrames: 124} as const;
export const HERO_PERIOD_SEC = (G6.generatedFrames - 1) / G6.fps; // 5.125

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Hero phase (seconds into the G6 period) at loop time t. §2: t on the way in, (t − 20) mod P on the way out. */
export const heroPhase = (t: number): number => (t < 10 ? mod(t, HERO_PERIOD_SEC) : mod(t - LOOP.durationSec, HERO_PERIOD_SEC));

/**
 * The G6 frame to show for a phase, as a source time that sits a quarter-frame into that frame
 * (so "nearest frame" and "last frame at or before" pick the same one).
 */
export const g6SourceTime = (phase: number): number => {
  const k = Math.min(G6.generatedFrames - 2, Math.floor(phase * G6.fps + 1e-6));
  return (k + 0.25) / G6.fps;
};

/** Sway used by the G6 placeholder: 3 back-and-forths per period (§4.3: 「一個循環剛好 3 個來回」). */
export const SWAYS_PER_PERIOD = 3;

export type LoopSegmentKind = 'hero' | 'slide' | 'ui';

export interface LoopSegment {
  id: string;
  start: number;
  end: number;
  kind: LoopSegmentKind;
  /** Card text: en big line + zh small line (§2 table). */
  card?: {en: string; zh: string; wordmark?: string};
  note: string;
}

export const HERO_CARD = {wordmark: 'URDiary', en: 'An AI diary companion that remembers you', zh: '一個會記得你的 AI 日記夥伴'} as const;

export const LOOP_SEGMENTS: readonly LoopSegment[] = [
  {id: 'hero-in', start: 0.0, end: 3.5, kind: 'hero', card: HERO_CARD, note: 'Hero：G6 搖擺循環置中偏上，奶油底'},
  {id: 'slide-1', start: 3.5, end: 4.0, kind: 'slide', note: '紙張滑移轉場（MG）'},
  {id: 'chat', start: 4.0, end: 8.0, kind: 'ui', card: {en: 'Talk about your day', zh: '說說今天'}, note: '對話：U03 en 裁切'},
  {id: 'memory', start: 8.0, end: 12.0, kind: 'ui', card: {en: 'It remembers that day', zh: '它記得那一天'}, note: '回憶：U04 en 裁切＋螢光筆'},
  {id: 'stamp', start: 12.0, end: 16.5, kind: 'ui', card: {en: 'A diary & a stamp for your day', zh: '寫成日記，蓋個印章'}, note: 'U06 新日記卡 → U08 月格＋書籤綠細圈'},
  {id: 'slide-2', start: 16.5, end: 17.0, kind: 'slide', note: '紙張滑移轉場（MG）'},
  {id: 'hero-out', start: 17.0, end: 20.0, kind: 'hero', card: HERO_CARD, note: '回到 Hero：G6 播最後 3.0 s，相位對到 0；字卡 18.0 s 前淡入並停住'},
];

/** Hero card opacity: fully on at t = 0 (no fade-in), fades in on the way out and is full by 18.0 s. */
export const HERO_CARD_FADE = {start: 17.35, end: 17.95} as const;

/** The UI language the loop uses (§2 「UI 語言」: en UI + bilingual cards, open option 5). */
export const LOOP_UI_LANG: Lang = 'en';

/** §2 「無聲可讀」: minimum type sizes on the 1280×720 master. */
export const LOOP_MIN_PX = {en: 44, zh: 40} as const;

export const loopProblems = (): string[] => {
  const p: string[] = [];
  if (Math.abs(LOOP.durationSec * LOOP.fps - LOOP.durationInFrames) > 1e-9) p.push('20 s × 30 fps ≠ 600');
  if (Math.abs(HERO_PERIOD_SEC - 5.125) > 1e-12) p.push(`hero period ${HERO_PERIOD_SEC} ≠ 5.125`);
  LOOP_SEGMENTS.forEach((s, i) => {
    if (i > 0 && LOOP_SEGMENTS[i - 1].end !== s.start) p.push(`${LOOP_SEGMENTS[i - 1].id} → ${s.id} not contiguous`);
    // §2 「每張字卡至少 3.5 s」 (the hero card spans the seam: 17.35–20 + 0–3.5).
    if (s.card && s.kind !== 'hero' && s.end - s.start < 3.5) p.push(`${s.id}: card on screen < 3.5 s`);
  });
  if (LOOP_SEGMENTS[0].start !== 0 || LOOP_SEGMENTS[LOOP_SEGMENTS.length - 1].end !== LOOP.durationSec) p.push('segments must cover 0–20 s');
  // The seam, numerically: phase(20) must equal phase(0) = 0, and phase(17) = 2.125 (§2).
  if (Math.abs(heroPhase(0)) > 1e-12) p.push(`phase(0) = ${heroPhase(0)}`);
  if (Math.abs(heroPhase(LOOP.durationSec)) > 1e-9) p.push(`phase(20) = ${heroPhase(LOOP.durationSec)}`);
  if (Math.abs(heroPhase(17) - 2.125) > 1e-9) p.push(`phase(17) = ${heroPhase(17)} (storyboard: 2.125)`);
  if (HERO_CARD_FADE.end > 18.0) p.push('hero card must be fully in before 18.0 s');
  return p;
};

const problems = loopProblems();
if (problems.length) throw new Error(`loop.ts does not match STORYBOARD §2:\n- ${problems.join('\n- ')}`);
