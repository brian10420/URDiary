/**
 * IntroLong scene table — the single timeline every scene, caption, subtitle and audio cue
 * hangs off. Transcribed from promo/video/STORYBOARD.md §1.1 (times) and the §1.2 headings
 * (frame ranges). The storyboard is approved: change a number here only when the storyboard
 * changes, and `npm run check` re-verifies everything against these rules.
 *
 * Plain data (no React): imported by the Remotion bundle and, via Node's type stripping, by
 * scripts/check.mjs. Keep it erasable-syntax TypeScript with explicit `.ts` import paths.
 */

export const INTRO = {
  id: 'IntroLong',
  width: 1920,
  height: 1080,
  fps: 60,
  durationSec: 88.5,
  durationInFrames: 5310,
} as const;

export type Lang = 'zh' | 'en';
export const LANGS: readonly Lang[] = ['zh', 'en'];

export type SceneId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9' | 'S10';

export interface SceneSpec {
  id: SceneId;
  /** 場名 (§1.1). */
  name: string;
  /** Seconds, §1.1 「時間（s）」. */
  start: number;
  end: number;
  /** Inclusive frame range from the §1.2 heading, e.g. 「（幀 0–449）」. */
  frames: readonly [number, number];
  /** §1.1 「主來源」. */
  source: string;
  /** §1.1 「這場要讓人記住的一件事」. */
  takeaway: string;
}

export const SCENES: readonly SceneSpec[] = [
  {id: 'S1', name: '說不出口的話', start: 0.0, end: 7.5, frames: [0, 449], source: 'ComfyUI', takeaway: '為習慣把話收著的人而做'},
  {id: 'S2', name: '初次見面，取個名字', start: 7.5, end: 16.0, frames: [450, 959], source: 'UI', takeaway: '第一次見面，它會自我介紹、讓你取名'},
  {id: 'S3', name: '被聽見', start: 16.0, end: 24.0, frames: [960, 1439], source: 'UI', takeaway: '先聽、先接住，不急著給建議'},
  {id: 'S4', name: '被記得', start: 24.0, end: 33.0, frames: [1440, 1979], source: 'UI', takeaway: '聊到相關的事，會想起你寫過的那一天'},
  {id: 'S5', name: '一段對話，一篇日記', start: 33.0, end: 42.5, frames: [1980, 2549], source: 'UI', takeaway: '按一下寫成日記，行事曆那天蓋一枚印章'},
  {id: 'S6', name: '被看見', start: 42.5, end: 51.0, frames: [2550, 3059], source: 'MG', takeaway: '好日子有小慶祝，難過的日子只有陪伴'},
  {id: 'S7', name: '早安', start: 51.0, end: 60.0, frames: [3060, 3599], source: 'UI（手機）', takeaway: '每天第一次打開會先問候；手機也能用'},
  {id: 'S8', name: '你的記憶，你作主', start: 60.0, end: 68.0, frames: [3600, 4079], source: 'UI', takeaway: '記憶看得到、改得了，也能先問過你'},
  {id: 'S9', name: '存在你的電腦，AI 由你選', start: 68.0, end: 80.0, frames: [4080, 4799], source: 'MG', takeaway: '資料在本機；聊天送到你選的 AI；想讓聊天留在本機就用本地模型'},
  {id: 'S10', name: '療癒自己的事', start: 80.0, end: 88.5, frames: [4800, 5309], source: 'ComfyUI', takeaway: '讓每天寫日記，成為一件療癒自己的事；免費、開源'},
];

export type TransitionKind = 'fadeFromBlack' | 'matchDissolve' | 'dissolve' | 'cut' | 'matchCut' | 'hold';

export interface TransitionSpec {
  from: SceneId | null;
  to: SceneId | null;
  kind: TransitionKind;
  start: number;
  end: number;
  /** false = the storyboard names the transition but gives no times; the window is ours. */
  timed: boolean;
  note: string;
}

/** Scene boundaries (§1.2 「轉場」). The incoming scene is drawn from `start`, the outgoing one until `end`. */
export const TRANSITIONS: readonly TransitionSpec[] = [
  {from: null, to: 'S1', kind: 'fadeFromBlack', start: 0.0, end: 0.6, timed: true, note: 'S1 入＝黑場溶入（0.0–0.6）'},
  {from: 'S1', to: 'S2', kind: 'matchDissolve', start: 7.2, end: 7.7, timed: true, note: '配對溶接：手機螢幕的亮光 → S2 App 視窗的亮光'},
  {from: 'S2', to: 'S3', kind: 'dissolve', start: 15.8, end: 16.2, timed: true, note: '同一個視窗內溶接到 S3'},
  {from: 'S3', to: 'S4', kind: 'cut', start: 24.0, end: 24.0, timed: true, note: '直接切'},
  {from: 'S4', to: 'S5', kind: 'dissolve', start: 32.8, end: 33.2, timed: false, note: '回憶卡縮回，溶接到 S5（同一個視窗）'},
  {from: 'S5', to: 'S6', kind: 'matchCut', start: 41.8, end: 42.7, timed: true, note: '配對剪接：印章放大、一分為二，變成 S6 的左右兩格'},
  {from: 'S6', to: 'S7', kind: 'dissolve', start: 50.6, end: 51.2, timed: true, note: '右格的雨光慢慢轉暖，溶進 S7 的晨光'},
  {from: 'S7', to: 'S8', kind: 'dissolve', start: 59.6, end: 60.1, timed: true, note: '手機放大，溶進 S8 的桌面視窗'},
  {from: 'S8', to: 'S9', kind: 'dissolve', start: 67.8, end: 68.2, timed: false, note: '視窗縮小退場，溶進 S9 的奶油紙底'},
  {from: 'S9', to: 'S10', kind: 'dissolve', start: 79.8, end: 80.2, timed: false, note: '紙張淡成 S10 的底'},
  {from: 'S10', to: null, kind: 'hold', start: 88.0, end: 88.5, timed: true, note: '最後 0.5 s 只收音樂，畫面停在片尾卡'},
];

export const toFrame = (sec: number, fps: number = INTRO.fps): number => Math.round(sec * fps);

export const sceneById = (id: SceneId): SceneSpec => {
  const s = SCENES.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scene ${id}`);
  return s;
};

export const sceneAt = (sec: number): SceneSpec =>
  SCENES.find((s) => sec >= s.start && sec < s.end) ?? SCENES[SCENES.length - 1];

/** Where a scene is actually drawn: its own range, widened by the transitions into / out of it. */
export const renderWindow = (id: SceneId): {start: number; end: number} => {
  const s = sceneById(id);
  const tin = TRANSITIONS.find((t) => t.to === id && t.from !== null);
  const tout = TRANSITIONS.find((t) => t.from === id && t.to !== null);
  return {start: Math.min(s.start, tin?.start ?? s.start), end: Math.max(s.end, tout?.end ?? s.end)};
};

/**
 * The storyboard's arithmetic, asserted. Throws on import, so a broken table stops the Studio,
 * every render and `npm run check` alike.
 */
export const timelineProblems = (): string[] => {
  const p: string[] = [];
  const f = INTRO.fps;
  if (Math.abs(INTRO.durationSec * f - INTRO.durationInFrames) > 1e-9) p.push('88.5 s × 60 fps ≠ 5310 frames');
  if (SCENES[0].start !== 0) p.push('S1 must start at 0');
  if (SCENES[SCENES.length - 1].end !== INTRO.durationSec) p.push(`last scene must end at ${INTRO.durationSec}`);
  let total = 0;
  SCENES.forEach((s, i) => {
    const a = toFrame(s.start);
    const b = toFrame(s.end);
    if (Math.abs(s.start * f - a) > 1e-6 || Math.abs(s.end * f - b) > 1e-6) p.push(`${s.id}: ${s.start}–${s.end} s is not on a frame boundary`);
    if (a !== s.frames[0] || b - 1 !== s.frames[1]) p.push(`${s.id}: ${s.start}–${s.end} s → frames ${a}–${b - 1}, storyboard says ${s.frames[0]}–${s.frames[1]}`);
    if (b <= a) p.push(`${s.id}: empty`);
    if (i > 0 && SCENES[i - 1].end !== s.start) p.push(`${SCENES[i - 1].id} → ${s.id}: not contiguous (${SCENES[i - 1].end} ≠ ${s.start})`);
    total += b - a;
  });
  if (total !== INTRO.durationInFrames) p.push(`scene frames sum to ${total}, expected ${INTRO.durationInFrames}`);
  for (const t of TRANSITIONS) {
    if (t.end < t.start) p.push(`transition ${t.from}→${t.to}: ends before it starts`);
    if (t.start < 0 || t.end > INTRO.durationSec) p.push(`transition ${t.from}→${t.to}: outside the film`);
    const boundary = t.from ? sceneById(t.from).end : 0;
    if (t.from && t.to && (t.start > boundary || t.end < boundary)) p.push(`transition ${t.from}→${t.to} (${t.start}–${t.end}) does not straddle the ${boundary} s cut`);
  }
  for (let i = 0; i + 1 < SCENES.length; i++) {
    const n = TRANSITIONS.filter((t) => t.from === SCENES[i].id && t.to === SCENES[i + 1].id).length;
    if (n !== 1) p.push(`${SCENES[i].id}→${SCENES[i + 1].id}: ${n} transitions (expected 1)`);
  }
  return p;
};

const problems = timelineProblems();
if (problems.length) throw new Error(`timeline.ts does not match STORYBOARD §1.1:\n- ${problems.join('\n- ')}`);
