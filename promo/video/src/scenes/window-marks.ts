/** TARGETS (recording CSS px) → the window's content px, for MG marks and placeholder boxes. */
import {TARGETS, type TargetId} from '../data/media.ts';
import {REC_TO_WIN} from '../components/DeviceFrame.tsx';

export const inWindow = (id: TargetId): [number, number, number, number] => {
  const [x, y, w, h] = TARGETS[id].rect;
  return [x * REC_TO_WIN, y * REC_TO_WIN, w * REC_TO_WIN, h * REC_TO_WIN];
};

export const windowBox = (id: TargetId) => {
  const [x, y, w, h] = inWindow(id);
  return {label: TARGETS[id].label, x, y, w, h};
};
