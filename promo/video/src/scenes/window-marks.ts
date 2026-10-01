/** TARGETS (recording CSS px, per UI language) → the window's content px, for MG marks and placeholder boxes. */
import {QUOTE_SPANS, targetLabel, targetRect, type TargetId} from '../data/media.ts';
import type {Lang} from '../data/timeline.ts';
import {REC_TO_WIN} from '../components/DeviceFrame.tsx';

type Rect = readonly [number, number, number, number];

/** Any rect in recording CSS px → window content px. */
export const rectInWindow = ([x, y, w, h]: Rect): [number, number, number, number] => [x * REC_TO_WIN, y * REC_TO_WIN, w * REC_TO_WIN, h * REC_TO_WIN];

export const inWindow = (id: TargetId, lang: Lang): [number, number, number, number] => rectInWindow(targetRect(id, lang));

/** Centre of a target in the window's content px. */
export const centerInWindow = (id: TargetId, lang: Lang): [number, number] => {
  const [x, y, w, h] = inWindow(id, lang);
  return [x + w / 2, y + h / 2];
};

export const windowBox = (id: TargetId, lang: Lang) => {
  const [x, y, w, h] = inWindow(id, lang);
  return {label: targetLabel(id, lang), x, y, w, h};
};

/** The S4 recalled date + title, one rect per text line (media.ts QUOTE_SPANS), in window content px. */
export const quoteInWindow = (lang: Lang): Array<[number, number, number, number]> => QUOTE_SPANS[lang].map(rectInWindow);

export const quoteBoxes = (lang: Lang) =>
  quoteInWindow(lang).map(([x, y, w, h], i, all) => ({label: lang === 'en' ? `Quoted date + title${all.length > 1 ? ` (line ${i + 1})` : ''} (highlighter)` : `回憶句 日期＋標題${all.length > 1 ? `（第 ${i + 1} 行）` : ''}（螢光筆）`, x, y, w, h}));
