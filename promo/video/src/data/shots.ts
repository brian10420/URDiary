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
 * Swapping a take (e.g. another U12 re-shoot): change `take` on its row and re-run
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
  zhSun: [1597, 251, 294, 118], // U09 zh: sun 「晴朗有勁」 + 「陽光正好，你也剛好有勁——記住這種感覺。」
  enSun: [1597, 251, 294, 159], // U09 en: sun "Sunny Spirit" + "Sunny outside, and you had the energy to match."
  zhToday: [1597, 251, 294, 118], // U07 zh: moon 「靜靜的夜」 + 「今天很重，我陪你一起喘口氣」
  enToday: [1597, 251, 294, 138], // U07 en: umbrella "Rainy Comfort" + "Rough day. I'm here while you set it down."
} as const;
/** U10: only the save egg (mascot + sparkles) where it lands on the diary page — no line of text inside. */
const EGG = [854, 492, 142, 80] as const;
/** U16: the left end of the provider row, 「AI: Grok (xAI)」 (its grok-4.3 label sits ~1,800 px to the right). */
const PROVIDER = [36, 796, 280, 40] as const;

export const CLIPS: readonly Clip[] = [
  // S2 初次見面＋取名 — the first ~2.7 s of each take are the re-login dialog; start after it.
  {id: 'ui/U02-zh', shot: 'U02', lang: 'zh', take: 'zh-take3', device: 'desktop', in: 2.63, out: 14.37, scale: 1,
    note: 'dialog closes 2.72 → intro 4.23 (+ welcome mascot to 6.1) → naming 5.63 → typing 8.24 → Enter 9.16 → title 9.19 → namingAck + naming celebration 11.77–13.6 → next question + scroll 14.03'},
  {id: 'ui/U02-en', shot: 'U02', lang: 'en', take: 'en-take4', device: 'desktop', in: 3.17, out: 15.83, scale: 1,
    note: 'dialog closes 2.60 → intro 4.77 (+ welcome mascot to 6.5) → naming 6.92 → typing 9.43 → Enter 11.13 → title 11.15 → namingAck + celebration 13.23–15.0 → next question + scroll 15.92'},
  // S3 被聽見 (+ loop chat, en) — the main chains (SHOTLOG 建議的兩組): zh U03/U04 take26 → U06/U07 take10 → U15 take6;
  // en U03/U04 take26 → U06/U07 take11 → U15 take7.
  {id: 'ui/U03-zh', shot: 'U03', lang: 'zh', take: 'zh-take26', device: 'desktop', in: 17.93, out: 31.58, scale: 1,
    note: 'typing ends 18.41 → sent 19.23 → thinking → reply 26.08 (fade to 26.37)'},
  {id: 'ui/U03-en', shot: 'U03', lang: 'en', take: 'en-take26', device: 'desktop', in: 46.73, out: 61.18, scale: 1,
    note: 'typing ends 47.22 → sent 48.03 → thinking → reply 55.68 (fade to 55.92)'},
  // S4 被記得 (+ loop memory, en) — both replies quote the 09-14 diary by date + title.
  {id: 'ui/U04-zh', shot: 'U04', lang: 'zh', take: 'zh-take26', device: 'desktop', in: 6.27, out: 21.233, scale: 1,
    note: 'sent 6.97 (chat scrolls) → thinking → reply 15.40 (scroll, fade to 15.68) quoting 「9 月 14 日《第一次上台報告前的失眠夜》」'},
  {id: 'ui/U04-en', shot: 'U04', lang: 'en', take: 'en-take26', device: 'desktop', in: 15.13, out: 29.0, scale: 1,
    note: 'sent 15.83 → thinking → reply 23.17 (scroll, fade to 23.48) quoting "September 14 in “Sleepless before my first presentation,”" (wraps after "first")'},
  // S4 回憶卡 — the 09-14 diary card, cropped at native 2× so the floating card stays sharp.
  {id: 'ui/U05-zh', shot: 'U05', lang: 'zh', take: 'zh-take4', device: 'desktop', in: 5.8, out: 10.1, scale: 2, crop: CARD_D16.zh,
    note: '9月14日《第一次上台報告前的失眠夜》card, static from 4.57'},
  {id: 'ui/U05-en', shot: 'U05', lang: 'en', take: 'en-take3', device: 'desktop', in: 5.8, out: 10.1, scale: 2, crop: CARD_D16.en,
    note: 'Sep 14 "Sleepless before my first presentation" card, static from 4.68'},
  // S5 結束對話 → 日記 (+ loop new card, en)
  {id: 'ui/U06-zh', shot: 'U06', lang: 'zh', take: 'zh-take10', device: 'desktop', in: 1.05, out: 32.65, scale: 1,
    note: 'end pressed 2.55 → 生成日記中 (24 s real wait) → system msg + notice 26.63 → 「加載中」 overlay 27.17–27.43 (jumped over) → diary page → card click 30.95 → detail 30.97–31.28'},
  {id: 'ui/U06-en', shot: 'U06', lang: 'en', take: 'en-take11', device: 'desktop', in: 0.92, out: 26.92, scale: 1,
    note: 'end pressed 2.42 → Creating your diary (18.6 s) → system msg + notice 21.00 → "Loading…" overlay 21.48–21.77 (jumped over) → diary page → card click 25.22 → detail 25.23–25.57'},
  // S5 行事曆 — the day panel is already open when the calendar appears (today is pre-selected).
  {id: 'ui/U07-zh', shot: 'U07', lang: 'zh', take: 'zh-take10', device: 'desktop', in: 2.45, out: 8.8, scale: 1,
    note: 'diary detail → calendar 2.52–2.72, static; the pointer crossing to today lights other cells 4.77–5.17 (jumped over); today = moon 「靜靜的夜」'},
  {id: 'ui/U07-en', shot: 'U07', lang: 'en', take: 'en-take11', device: 'desktop', in: 2.36, out: 8.65, scale: 1,
    note: 'diary detail → calendar 2.57–2.72, static; pointer hover 4.68–5.00 (jumped over); today = umbrella "Rainy Comfort"'},
  // S6 右格下方 — today's quiet stamp card, cropped from the same takes at native 2×.
  {id: 'ui/U07-zh-card', shot: 'U07', lang: 'zh', take: 'zh-take10', device: 'desktop', in: 2.5, out: 7.5, scale: 2, crop: CARD_DAY.zhToday,
    note: 'day panel stamp card (moon), static'},
  {id: 'ui/U07-en-card', shot: 'U07', lang: 'en', take: 'en-take11', device: 'desktop', in: 2.5, out: 7.5, scale: 2, crop: CARD_DAY.enToday,
    note: 'day panel stamp card (umbrella), static'},
  // ReadmeLoop 月格 (en only — the loop is en UI, §2)
  {id: 'ui/U08-en', shot: 'U08', lang: 'en', take: 'en-take3', device: 'desktop', in: 2.5, out: 7.0, scale: 1,
    note: 'September 2026 month grid, static 2.60–8.6 (picker opens 8.62)'},
  // S6 左格下方 — the good day's stamp card (09-26 sun).
  {id: 'ui/U09-zh', shot: 'U09', lang: 'zh', take: 'zh-take4', device: 'desktop', in: 2.5, out: 7.5, scale: 2, crop: CARD_DAY.zhSun,
    note: '09-26 sun 「晴朗有勁」 card, static from 2.32'},
  {id: 'ui/U09-en', shot: 'U09', lang: 'en', take: 'en-take3', device: 'desktop', in: 2.5, out: 7.5, scale: 2, crop: CARD_DAY.enSun,
    note: '09-26 sun "Sunny Spirit" card, static from 2.28'},
  // S6 左下角小窗（選用）— the app's real save egg on a copy account (valence 0.8), cropped tight at native 2×.
  {id: 'ui/U10-zh', shot: 'U10', lang: 'zh', take: 'zh-take2', device: 'desktop', in: 44.95, out: 46.75, scale: 2, crop: EGG,
    note: 'diary 44.60: egg jumps over the chat 44.6–45.1, 「加載中」 45.12–45.43, then sits on the diary page with sparkles, fading 45.95–46.3'},
  {id: 'ui/U10-en', shot: 'U10', lang: 'en', take: 'en-take2', device: 'desktop', in: 62.45, out: 64.25, scale: 2, crop: EGG,
    note: 'diary 62.20: egg jumps over the chat 62.2–62.65, "Loading…" 62.68–62.92, then on the diary page with sparkles, fading 63.5–63.75'},
  // S7 手機早安問候 — the D+1 morning take (first open of the day, tea mascot). The row carries the greeting
  // event as its anchor: after another re-shoot, change `take` and re-run the script; the trim follows the event.
  {id: 'ui/U12-zh', shot: 'U12', lang: 'zh', take: 'zh-take7', device: 'phone', in: 2.3, out: 14.383, scale: 2,
    anchor: {event: 'check-in greeting shown', at: 10.71}, note: 'sign-in 1.79 → chat 2.37–2.6 → thinking → greeting fades in 10.28–10.57'},
  {id: 'ui/U12-en', shot: 'U12', lang: 'en', take: 'en-take4', device: 'phone', in: 1.8, out: 11.3, scale: 2,
    anchor: {event: 'check-in greeting shown', at: 7.63}, note: 'sign-in 1.63 → chat 1.83 → thinking → greeting fades in 7.17–7.43'},
  // S7 尾（選用）— the calendar tab on the phone: October, today's 10:00 class. Used from after the tab switch,
  // so the chat page under it (en-take4 shows the en-take3 greeting) never appears.
  {id: 'ui/U13-zh', shot: 'U13', lang: 'zh', take: 'zh-take8', device: 'phone', in: 1.32, out: 3.42, scale: 2,
    note: 'chat → 行事曆 tab 1.57 → month grid 1.68–1.80: 2026年10月, today 10:00 大一統計習題課（助教）'},
  {id: 'ui/U13-en', shot: 'U13', lang: 'en', take: 'en-take4', device: 'phone', in: 1.32, out: 3.42, scale: 2,
    note: 'chat → Calendar tab 1.57 → month grid 1.77–1.80: October 2026, today 10:00 Intro Stats recitation (TA)'},
  // S8 核可通知 → 使用者檔案 → 帳本
  {id: 'ui/U15-zh', shot: 'U15', lang: 'zh', take: 'zh-take6', device: 'desktop', in: 2.2, out: 15.68, scale: 1,
    note: 'chat 2.63 → memory dialog 4.80 → text box 7.52 → ledger 10.28 → approve 13.80 → 已生效'},
  {id: 'ui/U15-en', shot: 'U15', lang: 'en', take: 'en-take7', device: 'desktop', in: 2.3, out: 15.6, scale: 1,
    note: 'chat 2.77 → memory dialog 4.77 → text box 7.43 → ledger 10.12 → approve 13.72 → Applied'},
  // S9 供應商段（選用）— the real provider selector, native 2× (560×80, drawn 1:1 in the S9 inset).
  {id: 'ui/U16-zh', shot: 'U16', lang: 'zh', take: 'zh-take4', device: 'desktop', in: 1.5, out: 3.5, scale: 2, crop: PROVIDER,
    note: 'static chat page; 「AI: Grok (xAI)」'},
  {id: 'ui/U16-en', shot: 'U16', lang: 'en', take: 'en-take3', device: 'desktop', in: 1.5, out: 3.5, scale: 2, crop: PROVIDER,
    note: 'static chat page; "AI: Grok (xAI)"'},
];

/**
 * Timeline → source, per placement key and language. Comments give the slope of each stretch.
 * Storyboard beats they hit are noted where the numbers come from (§1.2). Two knots at the same
 * timeline second are a jump (used to step over the app's own loading overlay and a stray hover).
 */
export const SPEED_MAPS: Readonly<Record<string, Partial<Record<Lang, readonly Knot[]>>>> = {
  // S2: intro at 8.3; the naming wait sped; typing → title switch at 12.7 (circle 12.8); namingAck 14.1; the
  // next question (with a scroll) would come after the 15.8–16.2 dissolve.
  'S2.U02': {
    // 1× intro | 1× naming 9.7 | 1.29× chips wait | 1× typing → title 12.7 | 1.84× thinking | 1× ack + celebration
    zh: [[7.2, 3.13], [8.3, 4.23], [9.8, 5.73], [11.75, 8.24], [12.7, 9.19], [14.1, 11.77], [16.2, 13.87]],
    // 1× intro | 1.9× → naming 9.9 | 2.3× wait | 1× typing → title 12.7 | 1.49× thinking | 1× ack + celebration
    en: [[7.2, 3.67], [8.3, 4.77], [9.3, 5.77], [9.9, 6.92], [10.98, 9.43], [12.7, 11.15], [14.1, 13.23], [16.2, 15.33]],
  },
  // S3: message sent 16.6; thinking 17.2–19.0 sped; reply at 19.0.
  'S3.U03': {
    zh: [[15.8, 18.43], [17.2, 19.83], [19.0, 26.08], [24.0, 31.08]], // 1× | 3.5× | 1×
    en: [[15.8, 47.23], [17.2, 48.63], [19.0, 55.68], [24.0, 60.68]], // 1× | 3.9× | 1×
  },
  // S4: second message 24.2; thinking 24.8–26.0 sped; reply 26.0; after the take ends the last frame holds.
  'S4.U04': {
    zh: [[24.0, 6.77], [24.8, 7.57], [26.0, 15.4], [33.2, 22.6]], // 1× | 6.5× | 1×
    en: [[24.0, 15.63], [24.8, 16.43], [26.0, 23.17], [33.2, 30.37]], // 1× | 5.6× | 1×
  },
  'S4.U05': {zh: [[29.6, 6.3], [32.9, 9.6]], en: [[29.6, 6.3], [32.9, 9.6]]},
  // S5: click 33.8; 生成日記中 sped into 1 s; the chat's system message + notice from 35.2, then — stepping over the
  // app's own dark 「加載中」 overlay — the diary page at 35.6; the new card is tapped at 36.6, detail by 37.0; push to its stamp card.
  'S5.U06': {
    zh: [[32.8, 1.55], [34.2, 2.95], [35.2, 26.6], [35.6, 27.0], [35.6, 27.47], [36.6, 30.95], [37.8, 32.15]], // 1× | 24× | 1× | jump | 3.5× | 1×
    en: [[32.8, 1.42], [34.2, 2.82], [35.2, 21.0], [35.6, 21.4], [35.6, 21.8], [36.6, 25.22], [37.8, 26.42]], // 1× | 18× | 1× | jump | 3.4× | 1×
  },
  // U07: 1× from the calendar; at the 39.6 tap it steps over the pointer's hover flicker (frames either side are identical).
  'S5.U07': {
    zh: [[37.8, 2.95], [39.6, 4.75], [39.6, 5.2], [42.7, 8.3]],
    en: [[37.8, 2.86], [39.6, 4.66], [39.6, 5.05], [42.7, 8.15]],
  },
  'S6.U09': {zh: [[43.4, 3.0], [47.4, 7.0]], en: [[43.4, 3.0], [47.4, 7.0]]}, // static card; holds after the take ends
  'S6.card': {zh: [[47.2, 3.0], [51.2, 7.0]], en: [[47.2, 3.0], [51.2, 7.0]]},
  // the egg on the diary page (after the loading overlay): sparkles, then its own fade-out
  'S6.U10': {zh: [[44.6, 45.45], [45.4, 46.25]], en: [[44.6, 62.95], [45.4, 63.75]]},
  // S7: the phone slides in 53.2 on the thinking bubble; the wait sped; greeting at 54.8; held until the
  // calendar tab is tapped at 59.0 (U13 on top), then the phone enlarges into S8.
  'S7.U12': {
    zh: [[53.2, 2.8], [54.4, 4.0], [54.8, 10.28], [58.9, 14.38]], // 1× | 16× | 1× (greeting event 10.71)
    en: [[53.2, 2.3], [54.4, 3.5], [54.8, 7.17], [58.9, 11.27]], // 1× | 9.2× | 1× (greeting event 7.63)
  },
  'S7.U13': {zh: [[59.0, 1.82], [60.1, 2.92]], en: [[59.0, 1.82], [60.1, 2.92]]},
  // S8: notice clicked 61.4 → 使用者檔案 61.5 → text box 62.9 → 帳本 64.2 → 核可 66.8 → 已生效.
  'S8.U15': {
    zh: [[59.6, 2.7], [61.5, 4.78], [62.9, 7.5], [64.2, 10.26], [66.8, 13.78], [68.2, 15.18]], // 1.1× | 1.9× | 2.1× | 1.35× | 1×
    en: [[59.6, 2.8], [61.5, 4.75], [62.9, 7.41], [64.2, 10.1], [66.8, 13.7], [68.2, 15.1]], // 1× | 1.9× | 2.1× | 1.4× | 1×
  },
  'S9.U16': {zh: [[73.6, 2.0], [74.6, 3.0]], en: [[73.6, 2.0], [74.6, 3.0]]},
  // ReadmeLoop (30 fps, en UI): her message → thinking → reply; the quoting reply; the new card; the month grid.
  'L.U03': {en: [[3.5, 47.23], [4.3, 48.03], [4.8, 48.53], [5.8, 55.68], [8.0, 57.88]]}, // 1× | 1× | 7.2× | 1×
  'L.U04': {en: [[8.0, 23.5], [12.0, 27.5]]},
  'L.U06': {en: [[12.0, 22.3], [13.5, 23.8]]},
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
