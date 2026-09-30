/**
 * Fixed words the components print themselves (placeholders, draft overlay, diagram details).
 * Kept here so lib/fonts.ts can load every Noto Sans TC glyph the film uses.
 */
export const UI = {
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
} as const;
