/**
 * Sound plan for IntroLong (STORYBOARD §5.1). Only placement and relative gain live here;
 * loudness (−16 LUFS integrated, ≤ −1.5 dBTP) is mastered later, outside Remotion.
 *
 * Music-side events in §5.1 (the 6.5 s pad entrance, the 46.8 s 「收聲」, the celesta at 43.3,
 * the last chord at 86.5) are part of the generated bed itself, not volume automation.
 */
import {INTRO} from './timeline.ts';

export const MUSIC = {
  /** Short fade so the bed never starts on a click (the piano motif enters at 0.3 s). */
  fadeIn: {start: 0.0, end: 0.3},
  /** §1.2 S10: 最後 0.5 s 只收音樂 — the picture holds on the end card. */
  fadeOut: {start: 88.0, end: INTRO.durationSec},
  /** §5.1 混音: ducking −9 dB under narration, attack 150 ms, release 400 ms. */
  duckDb: -9,
  attackSec: 0.15,
  releaseSec: 0.4,
} as const;

/**
 * Music gain (linear) at `t`, given the narration windows [start, end] in seconds. The duck is
 * look-ahead (the timeline is known): fully down when a line starts, back up `releaseSec` after
 * it ends. Interpolated in dB so the ramps sound even.
 */
export const musicGain = (t: number, narration: ReadonlyArray<readonly [number, number]>): number => {
  let duck = 0; // 0 … 1 of the full duck depth
  for (const [s, e] of narration) {
    let d = 0;
    if (t >= s - MUSIC.attackSec && t < s) d = (t - (s - MUSIC.attackSec)) / MUSIC.attackSec;
    else if (t >= s && t <= e) d = 1;
    else if (t > e && t < e + MUSIC.releaseSec) d = 1 - (t - e) / MUSIC.releaseSec;
    duck = Math.max(duck, d);
  }
  const db = MUSIC.duckDb * duck;
  let g = 10 ** (db / 20);
  if (t < MUSIC.fadeIn.end) g *= Math.max(0, (t - MUSIC.fadeIn.start) / (MUSIC.fadeIn.end - MUSIC.fadeIn.start));
  if (t > MUSIC.fadeOut.start) g *= Math.max(0, 1 - (t - MUSIC.fadeOut.start) / (MUSIC.fadeOut.end - MUSIC.fadeOut.start));
  return g;
};

export interface SfxCue {
  id: string;
  start: number;
  /** Ambiences run to `end` with short fades; one-shots play out. */
  end?: number;
  optional?: boolean;
  note: string;
}

/** §5.1 音效 column (and the matching §1.2 音樂／音效 lines). */
export const SFX: readonly SfxCue[] = [
  {id: 'room-tone', start: 0.0, end: 7.5, note: 'S1 很淡的夜間室內底噪'},
  {id: 'typing', start: 11.3, end: 12.6, note: 'S2 打字聲極輕（使用者打「小樹洞」）'},
  {id: 'chime', start: 14.1, note: 'S2 namingAck 出現時一個兩音小鐘聲（柔、不亮）；標題換名時不加音效'},
  {id: 'paper', start: 29.6, note: 'S4 回憶卡浮出時一個很輕的紙張聲（§5.1 表寫「31 左右」，§1.2 寫「浮出時」——跟著卡片）'},
  {id: 'click', start: 33.8, note: 'S5 輕點擊聲'},
  {id: 'page', start: 35.4, note: 'S5 翻頁聲'},
  {id: 'stamp', start: 40.0, note: 'S5 印章落下的柔軟「噗」聲（毛氈感，不要金屬感）'},
  {id: 'rain', start: 46.8, end: 51.0, note: 'S6 右格：很低的雨聲'},
  {id: 'cup', start: 51.8, optional: true, note: 'S7 可選：杯子輕碰聲'},
];

export const AMBIENCE_FADE_SEC = 0.4;
