/**
 * Camera tracks for the app-window scenes (stage px). S2–S5 share one window — the storyboard
 * dissolves 「同一個視窗內」 between them — so they share one continuous track; S3 → S4 is a
 * cut, S5 cuts to the calendar at 37.8. Targets come from TARGETS (measured on the takes, per UI
 * language), so each language gets its own track.
 *
 * Pushes past ~1.3× use framed(): the camera centre is clamped so the window keeps covering the
 * frame (no paper showing at the edges while we are "inside" the app).
 */
import {targetRect, type TargetId} from '../data/media.ts';
import type {Lang} from '../data/timeline.ts';
import type {Cam, CamKey} from '../lib/camera.ts';
import {WINDOW, recToStage} from '../components/DeviceFrame.tsx';

const centerOf = (id: TargetId, lang: Lang): [number, number] => {
  const [x, y, w, h] = targetRect(id, lang);
  return recToStage(x + w / 2, y + h / 2);
};

/** The window's own centre on stage. */
export const WIN_CENTER: [number, number] = [WINDOW.x + WINDOW.contentW / 2, WINDOW.y + (WINDOW.contentH + WINDOW.bar) / 2];
/** The conversation column (right of the app's side bar). */
const CHAT: [number, number] = recToStage(1080, 520);

const REST: Cam = {zoom: 1, target: WIN_CENTER, blend: 0};
const CHAT_SOFT: Cam = {zoom: 1.045, target: CHAT, blend: 0.2};

const clampAxis = (c: number, lo: number, hi: number): number => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, c)));

/**
 * A push centred on `point`, as close as the window's edges allow (the window keeps filling the frame).
 * The frame's top edge never rests inside the window's title bar — that would cut its 「URDiary」 in half
 * (S3's reply sits just there) — so it snaps to show the bar whole or not at all, whichever is nearer.
 */
export const framed = (zoom: number, [x, y]: readonly [number, number]): Cam => {
  const halfH = 540 / zoom;
  const lo = WINDOW.y + halfH; // frame top on the window's top edge: the bar shows whole
  const hi = WINDOW.y + WINDOW.bar + WINDOW.contentH - halfH;
  let cy = clampAxis(y, lo, hi);
  if (cy - halfH > WINDOW.y && cy - halfH < WINDOW.y + WINDOW.bar) {
    const below = lo + WINDOW.bar; // frame top just under the bar: the bar is out of frame
    cy = below <= hi && below - cy < cy - lo ? below : lo;
  }
  return {
    zoom,
    blend: 1,
    target: [clampAxis(x, WINDOW.x + 960 / zoom, WINDOW.x + WINDOW.contentW - 960 / zoom), cy],
  };
};

export const s2s5Camera = (lang: Lang): readonly CamKey[] => {
  const s3 = framed(1.35, centerOf('s3Reply', lang)); // S3 推到回覆（回覆字約 16 px）
  const s4 = framed(1.32, centerOf('s4Reply', lang)); // S4 第二則回覆＋右側回憶卡都在畫面內
  const stamp = framed(1.7, centerOf('s5StampCard', lang));
  const cell = framed(1.6, centerOf('s5TodayCell', lang));
  const panel = framed(1.5, centerOf('s5PanelCard', lang));
  return [
    {t: 7.2, ...REST},
    {t: 8.3, ...REST},
    {t: 10.0, ...CHAT_SOFT}, // S2 8.3–10.0 鏡頭慢推
    {t: 19.0, ...CHAT_SOFT},
    {t: 23.6, ...s3}, // S3 19.0–23.6 推到回覆（只推不晃）
    {t: 24.0, ...s3},
    {t: 24.0, ...CHAT_SOFT}, // S4: cut
    {t: 26.0, ...CHAT_SOFT},
    {t: 27.8, ...s4}, // 回覆 26.0 出現後推近，28.0 螢光筆時看得清
    {t: 32.4, ...s4},
    {t: 33.2, ...CHAT_SOFT}, // 溶接到 S5（32.8–33.2）時退回，33.2 圈按鈕
    {t: 36.8, ...CHAT_SOFT},
    {t: 37.8, ...stamp}, // S5 詳情 → 推向印章卡
    {t: 37.8, ...REST}, // 37.8 切到行事曆
    {t: 38.1, ...REST},
    {t: 39.5, ...cell}, // 從月格推進到今天那格的 14 px 印章
    {t: 40.1, ...cell},
    {t: 41.3, ...panel}, // 日面板：印章卡＋小語＋「來自這天的日記」
    {t: 42.7, ...panel},
  ];
};

export const s8Camera = (lang: Lang): readonly CamKey[] => {
  const modal = framed(1.5, centerOf('s8Modal', lang)); // 記憶視窗的字約 16 px
  return [
    {t: 59.6, zoom: 1.12, target: WIN_CENTER, blend: 0}, // arriving from the enlarged phone
    {t: 60.5, ...REST},
    {t: 61.5, ...REST}, // 61.4 點通知泡泡
    {t: 62.3, ...modal},
    {t: 67.4, ...modal},
    {t: 68.2, ...REST}, // 視窗縮小退場（67.8–68.2）時拉回
  ];
};
