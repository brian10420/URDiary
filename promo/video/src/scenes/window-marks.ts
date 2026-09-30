/** TARGETS (recording CSS px, per UI language) → the window's content px, for MG marks and placeholder boxes. */
import {TARGETS, targetRect, type TargetId} from '../data/media.ts';
import type {Lang} from '../data/timeline.ts';
import {REC_TO_WIN} from '../components/DeviceFrame.tsx';

export const inWindow = (id: TargetId, lang: Lang): [number, number, number, number] => {
  const [x, y, w, h] = targetRect(id, lang);
  return [x * REC_TO_WIN, y * REC_TO_WIN, w * REC_TO_WIN, h * REC_TO_WIN];
};

/** Centre of a target in the window's content px. */
export const centerInWindow = (id: TargetId, lang: Lang): [number, number] => {
  const [x, y, w, h] = inWindow(id, lang);
  return [x + w / 2, y + h / 2];
};

export const windowBox = (id: TargetId, lang: Lang) => {
  const [x, y, w, h] = inWindow(id, lang);
  return {label: TARGETS[id].label, x, y, w, h};
};
