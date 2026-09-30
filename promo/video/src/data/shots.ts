/**
 * UI recordings → intermediates → timelines (STORYBOARD §3, §1.2, §2).
 *
 * CLIPS: one row per file in public/media/ui/ — which ★ take feeds it (recordings/<shot>/<take>.mov,
 * SHOTLOG.md / _picks.json), the source range kept (0.5 s handles around what the timelines use),
 * an optional crop, and the output scale. scripts/make-intermediates.sh reads this table and
 * transcodes each row with static_ffmpeg (H.264 CRF 14, 60 fps, no audio); nothing here is baked in
 * beyond the trim and the crop.
 *
 * SPEED_MAPS: where each placement (media.ts INTRO_PLACEMENTS / LOOP_PLACEMENTS, by key) shows which
 * part of its take, as knots [timeline s, source s]. Between knots the source runs linearly — a
 * slope of 1 is real time, > 1 is a 「加速」 (typing / waiting), equal source seconds hold a frame.
 * Before the first knot and after the last the frame holds. Source seconds are the take's own
 * (the SHOTLOG event times), so a map reads against the SHOTLOG directly; <MediaSlot> converts them
 * to the intermediate's time (source − in). Change a speed-up here — no re-encode needed.
 *
 * Swapping a take (e.g. the U12 re-shoot): change `take` on its row and re-run
 * `scripts/make-intermediates.sh ui/U12-zh`. A row with an `anchor` names a recorder event (take
 * JSON `events[].what`) and the time it had in the take the numbers were measured on; the script
 * looks the event up in the new take's JSON and shifts the trim by the difference, so the
 * intermediate — and therefore every knot here — lines up with the new take unchanged.
 *
 * Plain data (no React): read by the Remotion bundle and, through Node's type stripping, by the
 * scripts. Keep it erasable-syntax TypeScript.
 */
import type {Lang} from './timeline.ts';

export type Rect = readonly [number, number, number, number];
export type Knot = readonly [number, number];

export const RECORDINGS_DIR = '/mnt/Data_SSD/urdiary-media/recordings';
export const CLIP_FPS = 60;

/** Recording geometry (§3 「裝置」): CSS viewport and the device pixel ratio it was captured at. */
export const DEVICES = {
  desktop: {css: [1920, 1080], dpr: 2},
  phone: {css: [390, 844], dpr: 3},
} as const;
export type Device = keyof typeof DEVICES;

export interface Clip {
  /** Media id under public/media/ (no extension). */
  id: string;
  shot: string;
  lang: Lang;
  /** recordings/<shot>/<take>.mov and its <take>.json */
  take: string;
  device: Device;
  /** Source seconds kept (rounded to whole 1/60 s frames by the script and by <MediaSlot>). */
  in: number;
  out: number;
  /** Output pixels per recording CSS px: desktop full frame 1 (1920×1080), phone 2 (780×1688), crops 2 (native 4K). */
  scale: number;
  /** Crop in recording CSS px; the whole viewport when absent. */
  crop?: Rect;
  /** Recorder event the trim follows when the take is swapped (see header). */
  anchor?: {event: string; at: number};
  note: string;
}

// Card crops: the white card fill measured on the takes (flood fill) plus a 6 px margin, so the
// card's own border and a hair of page show. zh / en cards differ in height (text wraps differently).
const CARD_D16 = {zh: [987, 827, 298, 172], en: [987, 806, 298, 193]} as const; // U05: 09-14 diary card
const CARD_DAY = {
  zhSun: [1597, 251, 294, 118], // U09 zh: sun 「晴朗有勁」 + note
  enSun: [1597, 251, 294, 159], // U09 en: sun "Sunny Spirit" + note
  zhToday: [1597, 251, 294, 118], // U07 zh: heal 「照顧自己」 + 「今天真的很累，慢慢來吧」
  enToday: [1597, 251, 294, 138], // U07 en: moon "Quiet Night" + "Rough day. I'm here while you set it down."
} as const;

export const CLIPS: readonly Clip[] = [
  // S2 初次見面＋取名 — the first ~3 s of each take are the re-login dialog; start after it.
  {id: 'ui/U02-zh', shot: 'U02', lang: 'zh', take: 'zh-take2', device: 'desktop', in: 2.68, out: 13.16, scale: 1,
    note: 'reset 2.9 → intro 4.28 → naming 5.52 → typing 8.31 → Enter 9.34 → title 9.42 → namingAck 11.23 → next question + scroll 12.72'},
  {id: 'ui/U02-en', shot: 'U02', lang: 'en', take: 'en-take1', device: 'desktop', in: 3.08, out: 16.1, scale: 1,
    note: 'reset 3.3 → intro 4.68 → naming 7.63 → typing 10.27 → Enter 12.04 → title 12.10 → namingAck 13.20 → next question + scroll 16.03'},
  // S3 被聽見 (+ loop chat, en) — the main chains: zh take16 / en take7 (SHOTLOG 建議的兩組).
  {id: 'ui/U03-zh', shot: 'U03', lang: 'zh', take: 'zh-take16', device: 'desktop', in: 17.21, out: 31.42, scale: 1,
    note: 'typing ends 17.71 → sent 18.51 → thinking → reply 25.92 (fade to 26.23)'},
  {id: 'ui/U03-en', shot: 'U03', lang: 'en', take: 'en-take7', device: 'desktop', in: 45.69, out: 60.18, scale: 1,
    note: 'typing ends 46.18 → sent 46.99 → thinking → reply 54.68 (fade to 54.97)'},
  // S4 被記得 (+ loop memory, en)
  {id: 'ui/U04-zh', shot: 'U04', lang: 'zh', take: 'zh-take16', device: 'desktop', in: 5.9, out: 20.217, scale: 1,
    note: 'sent 6.60 → thinking → reply 14.43 (paraphrased recall of 09-14, no date / title — v3.1)'},
  {id: 'ui/U04-en', shot: 'U04', lang: 'en', take: 'en-take7', device: 'desktop', in: 14.62, out: 28.967, scale: 1,
    note: 'sent 15.32 → thinking → reply 23.28 quoting "September 14 entry, “Sleepless before my first presentation,”"'},
  // S4 回憶卡 — the 09-14 diary card, cropped at native 2× so the floating card stays sharp.
  {id: 'ui/U05-zh', shot: 'U05', lang: 'zh', take: 'zh-take3', device: 'desktop', in: 5.8, out: 10.1, scale: 2, crop: CARD_D16.zh,
    note: '9月14日《第一次上台報告前的失眠夜》card, static after 5.8'},
  {id: 'ui/U05-en', shot: 'U05', lang: 'en', take: 'en-take2', device: 'desktop', in: 5.8, out: 10.1, scale: 2, crop: CARD_D16.en,
    note: 'Sep 14 "Sleepless before my first presentation" card, static after 5.9'},
  // S5 結束對話 → 日記 (+ loop new card, en)
  {id: 'ui/U06-zh', shot: 'U06', lang: 'zh', take: 'zh-take4', device: 'desktop', in: 0.9, out: 28.95, scale: 1,
    note: 'end pressed 2.40 → 生成日記中 (20 s real wait) → system msg + notice 22.92 → diary page 23.40 → detail 27.03–27.40'},
  {id: 'ui/U06-en', shot: 'U06', lang: 'en', take: 'en-take3', device: 'desktop', in: 0.83, out: 26.75, scale: 1,
    note: 'end pressed 2.33 → Creating your diary (18 s) → system msg + notice 20.80 → diary page 21.32 (spinner to ~22) → detail 24.88–25.20'},
  // S5 行事曆 — the day panel is already open when the calendar appears (today is pre-selected).
  {id: 'ui/U07-zh', shot: 'U07', lang: 'zh', take: 'zh-take4', device: 'desktop', in: 2.25, out: 8.15, scale: 1,
    note: 'calendar 2.48–2.68, static; today = heal stamp 「照顧自己」'},
  {id: 'ui/U07-en', shot: 'U07', lang: 'en', take: 'en-take3', device: 'desktop', in: 2.2, out: 8.1, scale: 1,
    note: 'calendar 2.43–2.68, static; today = moon stamp "Quiet Night"'},
  // S6 右格下方 — today's quiet stamp card, cropped from the same takes at native 2×.
  {id: 'ui/U07-zh-card', shot: 'U07', lang: 'zh', take: 'zh-take4', device: 'desktop', in: 2.5, out: 7.5, scale: 2, crop: CARD_DAY.zhToday,
    note: 'day panel stamp card (heal)'},
  {id: 'ui/U07-en-card', shot: 'U07', lang: 'en', take: 'en-take3', device: 'desktop', in: 2.5, out: 7.5, scale: 2, crop: CARD_DAY.enToday,
    note: 'day panel stamp card (moon)'},
  // ReadmeLoop 月格 (en only — the loop is en UI, §2)
  {id: 'ui/U08-en', shot: 'U08', lang: 'en', take: 'en-take2', device: 'desktop', in: 2.5, out: 7.0, scale: 1,
    note: 'September 2026 month grid, static 2.77–8.4 (picker opens 8.72)'},
  // S6 左格下方 — the good day's stamp card (09-26 sun).
  {id: 'ui/U09-zh', shot: 'U09', lang: 'zh', take: 'zh-take3', device: 'desktop', in: 2.5, out: 7.5, scale: 2, crop: CARD_DAY.zhSun,
    note: '09-26 sun 「晴朗有勁」 card'},
  {id: 'ui/U09-en', shot: 'U09', lang: 'en', take: 'en-take2', device: 'desktop', in: 2.5, out: 7.5, scale: 2, crop: CARD_DAY.enSun,
    note: '09-26 sun "Sunny Spirit" card'},
  // S6 左下角小窗（選用）— the app's real save egg on a copy account (valence 0.8 / 0.7).
  {id: 'ui/U10-zh', shot: 'U10', lang: 'zh', take: 'zh-take1', device: 'desktop', in: 51.2, out: 53.0, scale: 1,
    note: 'diary page 51.57, happy egg ≈ 51.6–52.7 (jump + gold sparkles)'},
  {id: 'ui/U10-en', shot: 'U10', lang: 'en', take: 'en-take1', device: 'desktop', in: 65.1, out: 66.9, scale: 1,
    note: 'diary page 64.97–65.72, happy egg ≈ 65.6–66.5'},
  // S7 手機早安問候 — STAND-IN: these ★ picks were recorded in the afternoon (「下午好」/ "Afternoon");
  // the true morning take is being re-shot. Swap = change `take` below and re-run the script: the trim
  // follows the greeting event, so the S7 knots stay valid.
  {id: 'ui/U12-zh', shot: 'U12', lang: 'zh', take: 'zh-take1', device: 'phone', in: 2.01, out: 10.867, scale: 2,
    anchor: {event: 'check-in greeting shown', at: 7.36}, note: 'sign-in 1.56 → thinking → greeting fades in 6.88–7.17'},
  {id: 'ui/U12-en', shot: 'U12', lang: 'en', take: 'en-take1', device: 'phone', in: 1.6, out: 10.467, scale: 2,
    anchor: {event: 'check-in greeting shown', at: 6.95}, note: 'sign-in 1.56 → thinking → greeting fades in 6.48–6.77'},
  // S8 核可通知 → 使用者檔案 → 帳本
  {id: 'ui/U15-zh', shot: 'U15', lang: 'zh', take: 'zh-take3', device: 'desktop', in: 2.2, out: 15.25, scale: 1,
    note: 'chat 2.52 → memory dialog 4.60 → text box 7.2 → ledger 9.92 → approve 13.37 → 已生效'},
  {id: 'ui/U15-en', shot: 'U15', lang: 'en', take: 'en-take3', device: 'desktop', in: 2.23, out: 15.2, scale: 1,
    note: 'chat 2.57 → memory dialog 4.63 → text box 7.23 → ledger 9.92 → approve 13.28 → Applied'},
];

/**
 * Timeline → source, per placement key and language. Comments give the slope of each stretch.
 * Storyboard beats they hit are noted where the numbers come from (§1.2).
 */
export const SPEED_MAPS: Readonly<Record<string, Partial<Record<Lang, readonly Knot[]>>>> = {
  // S2: intro at 8.3; the static naming wait sped; title switches at 12.7 (circle 12.8); namingAck ≈ 14.1.
  'S2.U02': {
    // 1× | 1.41× wait (naming + chips) | 1× typing → title 12.7 | 1.29× thinking | 1× ack + name badge | hold (next question would pop 15.6)
    zh: [[7.2, 3.18], [9.8, 5.78], [11.59, 8.31], [12.7, 9.42], [14.1, 11.23], [15.53, 12.66], [16.2, 12.66]],
    // 1× intro | 3.1× badge fade + thinking | 3.0× naming wait | 1× typing → title 12.7 | 1× ack 13.8 → (scroll 16.6 is after the dissolve)
    en: [[7.2, 3.58], [9.4, 5.78], [10.0, 7.63], [10.87, 10.27], [12.7, 12.1], [16.2, 15.6]],
  },
  // S3: message sent 16.6; thinking 17.2–19.0 sped; reply at 19.0.
  'S3.U03': {
    zh: [[15.8, 17.71], [17.2, 19.11], [19.0, 25.92], [24.0, 30.92]], // 1× | 3.8× | 1×
    en: [[15.8, 46.19], [17.2, 47.59], [19.0, 54.68], [24.0, 59.68]], // 1× | 3.9× | 1×
  },
  // S4: second message 24.2; thinking 24.8–26.0 sped; reply 26.0; after the take ends the last frame holds.
  'S4.U04': {
    zh: [[24.0, 6.4], [24.8, 7.2], [26.0, 14.43], [33.2, 21.63]], // 1× | 6.0× | 1×
    en: [[24.0, 15.12], [24.8, 15.92], [26.0, 23.28], [33.2, 30.48]], // 1× | 6.1× | 1×
  },
  'S4.U05': {zh: [[29.6, 6.3], [32.9, 9.6]], en: [[29.6, 6.3], [32.9, 9.6]]},
  // S5: click 33.8; 生成日記中 sped into ~1 s (storyboard 33.9–35.3); diary page → card → detail by 36.8; push to the stamp card.
  'S5.U06': {
    zh: [[32.8, 1.4], [34.2, 2.8], [35.2, 22.8], [35.5, 23.1], [36.8, 27.45], [37.8, 28.45]], // 1× | 20× | 1× | 3.3× | 1×
    en: [[32.8, 1.33], [34.2, 2.73], [35.2, 20.7], [35.5, 21.0], [36.8, 25.25], [37.8, 26.25]], // 1× | 18× | 1× | 3.3× | 1×
  },
  'S5.U07': {zh: [[37.8, 2.75], [42.7, 7.65]], en: [[37.8, 2.7], [42.7, 7.6]]},
  'S6.U09': {zh: [[43.4, 3.0], [47.4, 7.0]], en: [[43.4, 3.0], [47.4, 7.0]]}, // static card; holds after 47.4
  'S6.card': {zh: [[47.2, 3.0], [51.2, 7.0]], en: [[47.2, 3.0], [51.2, 7.0]]},
  'S6.U10': {zh: [[44.6, 51.7], [45.4, 52.5]], en: [[44.6, 65.6], [45.4, 66.4]]},
  // S7: phone slides in 53.2 on the thinking bubble; wait sped; greeting ≈ 55.8; slow push to 59.6.
  'S7.U12': {
    zh: [[53.2, 2.51], [54.6, 3.91], [55.6, 6.71], [60.1, 11.21]], // 1× | 2.8× | 1× (anchor: greeting event 7.36)
    en: [[53.2, 2.1], [54.6, 3.5], [55.6, 6.3], [60.1, 10.8]], // 1× | 2.8× | 1× (anchor: greeting event 6.95)
  },
  // S8: notice clicked 61.5 → 使用者檔案 → text box ≈ 62.8 → 帳本 64.2 → 核可 ≈ 66.8 → 已生效.
  'S8.U15': {
    zh: [[59.6, 2.7], [61.5, 4.6], [62.9, 7.4], [64.2, 9.9], [66.8, 13.35], [68.2, 14.75]], // 1× | 2.0× | 1.9× | 1.3× | 1×
    en: [[59.6, 2.73], [61.5, 4.63], [62.9, 7.4], [64.2, 9.9], [66.8, 13.3], [68.2, 14.7]], // 1× | 2.0× | 1.9× | 1.3× | 1×
  },
  // ReadmeLoop (30 fps, en UI): her bubble → thinking → reply; the quoting reply; the new card; the month grid.
  'L.U03': {en: [[3.5, 46.2], [4.3, 47.0], [4.8, 47.5], [5.8, 54.7], [8.0, 56.9]]}, // 1× | 1× | 7.2× | 1×
  'L.U04': {en: [[8.0, 23.3], [12.0, 27.3]]},
  'L.U06': {en: [[12.0, 22.6], [13.5, 24.1]]},
  'L.U08': {en: [[13.5, 3.0], [17.0, 6.5]]},
};

// ---------------------------------------------------------------- helpers

export const clipById = (id: string): Clip | undefined => CLIPS.find((c) => c.id === id);

/** First frame of the intermediate, as a whole source frame (the script trims at exactly this frame). */
export const clipInFrame = (c: Clip): number => Math.round(c.in * CLIP_FPS);
export const clipOutFrame = (c: Clip): number => Math.round(c.out * CLIP_FPS);

/** The CSS rect the file covers and its pixels per CSS px (crop or full viewport). */
export const clipGeometry = (c: Clip): {rect: Rect; scale: number} => ({
  rect: c.crop ?? [0, 0, DEVICES[c.device].css[0], DEVICES[c.device].css[1]],
  scale: c.scale,
});

export const speedMap = (key: string, lang: Lang): readonly Knot[] | undefined => SPEED_MAPS[key]?.[lang];

/** Source seconds at timeline second `t` (piecewise linear; holds before the first / after the last knot). */
export const sourceAt = (knots: readonly Knot[], t: number): number => {
  if (t <= knots[0][0]) return knots[0][1];
  for (let i = 0; i + 1 < knots.length; i++) {
    const [t0, s0] = knots[i];
    const [t1, s1] = knots[i + 1];
    if (t < t1) return t1 === t0 ? s1 : s0 + ((t - t0) * (s1 - s0)) / (t1 - t0);
  }
  return knots[knots.length - 1][1];
};

/** Every problem with the table: knots out of order, maps reaching outside their clip, bad crops. */
export const shotsProblems = (): string[] => {
  const p: string[] = [];
  const ids = new Set<string>();
  for (const c of CLIPS) {
    if (ids.has(c.id)) p.push(`${c.id}: listed twice`);
    ids.add(c.id);
    if (!(c.out > c.in)) p.push(`${c.id}: out ${c.out} ≤ in ${c.in}`);
    const [cw, ch] = DEVICES[c.device].css;
    if (c.crop) {
      const [x, y, w, h] = c.crop;
      if (x < 0 || y < 0 || x + w > cw || y + h > ch) p.push(`${c.id}: crop ${c.crop.join(',')} outside the ${cw}×${ch} viewport`);
      if ((w * c.scale) % 2 || (h * c.scale) % 2) p.push(`${c.id}: crop × scale must be even (yuv420p)`);
    } else if ((cw * c.scale) % 2 || (ch * c.scale) % 2) p.push(`${c.id}: ${cw * c.scale}×${ch * c.scale} is odd (yuv420p)`);
  }
  for (const [key, byLang] of Object.entries(SPEED_MAPS)) {
    for (const [lang, knots] of Object.entries(byLang)) {
      if (!knots || knots.length < 2) {
        p.push(`${key} ${lang}: needs ≥ 2 knots`);
        continue;
      }
      knots.forEach(([t, s], i) => {
        if (i > 0 && t < knots[i - 1][0]) p.push(`${key} ${lang}: knot ${i} goes back in time`);
        if (i > 0 && s < knots[i - 1][1]) p.push(`${key} ${lang}: knot ${i} plays backwards`);
        if (!Number.isFinite(t) || !Number.isFinite(s)) p.push(`${key} ${lang}: knot ${i} not finite`);
      });
    }
  }
  return p;
};

/** Checks that every map stays inside the clip it plays (called by media.ts once it knows the ids). */
export const mapRangeProblems = (key: string, lang: Lang, clipId: string): string[] => {
  const c = clipById(clipId);
  const knots = speedMap(key, lang);
  if (!c || !knots) return [];
  const lo = Math.min(...knots.map((k) => k[1]));
  const hi = Math.max(...knots.map((k) => k[1]));
  const p: string[] = [];
  if (lo < c.in - 1e-6) p.push(`${key} ${lang}: map starts at ${lo} s, before ${c.id}'s in ${c.in} s`);
  // Running past `out` is allowed — the last frame holds (S4, S7 end on a still screen) — but not by much.
  if (hi > c.out + 2.0) p.push(`${key} ${lang}: map reaches ${hi} s, > 2 s past ${c.id}'s out ${c.out} s`);
  return p;
};

const problems = shotsProblems();
if (problems.length) throw new Error(`shots.ts:\n- ${problems.join('\n- ')}`);
