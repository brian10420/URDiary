/**
 * Fixed words the components print themselves (placeholders, draft overlay, diagram details), per
 * language. `UI` is the zh table (lib/fonts.ts collects every Noto Sans TC glyph from it); the en
 * table is Latin only, so it needs no extra font chunks. Components pick with `uiText(lang)`.
 */
import type {Lang} from './timeline.ts';

export const UI_TEXT = {
  zh: {
    comfyShot: 'ComfyUI 生成鏡頭',
    uiShot: 'UI 錄影',
    missing: '素材未到',
    frozen: '定格',
    source: '來源',
    phase: '相位',
    draft: '草稿',
    provisional: '暫定位置',
    appTitle: 'URDiary',
    dbFile: 'urdiary.db',
  },
  en: {
    comfyShot: 'ComfyUI shot',
    uiShot: 'UI recording',
    missing: 'media missing',
    frozen: 'frozen',
    source: 'source',
    phase: 'phase',
    draft: 'draft',
    provisional: 'provisional position',
    appTitle: 'URDiary',
    dbFile: 'urdiary.db',
  },
} as const;

/** The zh table (what lib/fonts.ts scans, and what language-less callers keep using). */
export const UI = UI_TEXT.zh;

export const uiText = (lang: Lang = 'zh') => UI_TEXT[lang];
