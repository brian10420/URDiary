/**
 * Camera tracks for the app-window scenes (stage px). S2–S5 share one window — the storyboard
 * dissolves 「同一個視窗內」 between them — so they share one continuous track; S3 → S4 is a
 * cut, S5 cuts to the calendar at 37.8. Targets come from TARGETS (provisional until the real
 * recordings exist).
 */
import {TARGETS, type TargetId} from '../data/media.ts';
import type {CamKey} from '../lib/camera.ts';
import {WINDOW, recToStage} from '../components/DeviceFrame.tsx';

const centerOf = (id: TargetId): [number, number] => {
  const [x, y, w, h] = TARGETS[id].rect;
  return recToStage(x + w / 2, y + h / 2);
};

/** The window's own centre on stage. */
export const WIN_CENTER: [number, number] = [WINDOW.x + WINDOW.contentW / 2, WINDOW.y + (WINDOW.contentH + WINDOW.bar) / 2];
/** The conversation column (right of the app's side bar). */
const CHAT: [number, number] = recToStage(1080, 520);

const REST = {zoom: 1, target: WIN_CENTER, blend: 0};
const CHAT_SOFT = {zoom: 1.045, target: CHAT, blend: 0.2};

export const S2_S5_CAMERA: readonly CamKey[] = [
  {t: 7.2, ...REST},
  {t: 8.3, ...REST},
  {t: 10.0, ...CHAT_SOFT}, // S2 8.3–10.0 鏡頭慢推
  {t: 19.0, ...CHAT_SOFT},
  {t: 23.6, zoom: 1.3, target: centerOf('s3Reply'), blend: 0.55}, // S3 19.0–23.6 推到回覆前三、四行
  {t: 24.0, zoom: 1.3, target: centerOf('s3Reply'), blend: 0.55},
  {t: 24.0, ...CHAT_SOFT}, // S4: cut
  {t: 36.3, ...CHAT_SOFT},
  {t: 37.8, zoom: 1.36, target: centerOf('s5StampCard'), blend: 0.6}, // S5 詳情 → 推向印章卡
  {t: 37.8, ...REST}, // 37.8 切到行事曆
  {t: 38.1, ...REST},
  {t: 39.7, zoom: 1.6, target: centerOf('s5TodayCell'), blend: 0.62}, // 從月格推進到今天那格
  {t: 40.3, zoom: 1.6, target: centerOf('s5TodayCell'), blend: 0.62},
  {t: 41.5, zoom: 1.25, target: centerOf('s5TodayCell'), blend: 0.42}, // 點開日面板：退一點看全卡
  {t: 42.7, zoom: 1.25, target: centerOf('s5TodayCell'), blend: 0.42},
];

export const S8_CAMERA: readonly CamKey[] = [
  {t: 59.6, zoom: 1.12, target: WIN_CENTER, blend: 0}, // arriving from the enlarged phone
  {t: 60.5, ...REST},
  {t: 61.5, ...REST},
  {t: 67.8, zoom: 1.05, target: recToStage(960, 560), blend: 0.15},
  {t: 68.2, zoom: 1.05, target: recToStage(960, 560), blend: 0.15},
];
