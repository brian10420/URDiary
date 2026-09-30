/**
 * Colours and type families. Colours come from the mascot style contract
 * (docs/superpowers/specs/2026-08-14-mascot-illustrations-design.md §1), the storyboard's
 * 視覺基調 (§0) and the showcase page (site/styles.css), so the film, the page and the app match.
 */
export const C = {
  paper: '#f9f3e6', // 書頁 / 奶油紙底 (§0)
  paperAlt: '#f3e9d6',
  surface: '#fffdf8', // cards (site --surface)
  text: '#4b2e1e', // §0 字色 = the outline brown
  textStrong: '#2b1a10', // eyes / mouth; strongest text
  text2: '#6b4f3e', // site --ink-2
  text3: '#7a5c49',
  cover: '#b98d6d', // 書皮
  bookmark: '#5fd0a0', // 書籤綠 — 圈選 (§0); fills only, never text on cream
  bookmarkInk: '#1b6e4c', // green that reads as text (site --accent-ink)
  highlighter: 'rgba(245, 197, 66, 0.35)', // 暖黃 #f5c542 at 35% (§0 螢光筆)
  gold: '#f5c542',
  blush: '#f0a78f',
  rainBlue: '#7f96c9', // 雨天安好 / 睡帽 blue
  line: 'rgba(75, 46, 30, 0.13)',
  lineStrong: 'rgba(75, 46, 30, 0.24)',
  shadow: '0 2px 0 rgba(75, 46, 30, 0.04), 0 28px 60px -34px rgba(75, 46, 30, 0.55)',
  shadowSoft: '0 1px 0 rgba(75, 46, 30, 0.05), 0 12px 30px -20px rgba(75, 46, 30, 0.38)',
  night: '#1c1511', // site dark: 「a lamp-lit desk at night」
  uiGrey: '#f4f4f2', // screenshot frame background on the site
} as const;

/** Families (loaded in fonts.ts). Noto Sans TC sets every zh run, Latin included, so CJK punctuation stays full-width. */
export const FONT = {
  zh: '"Noto Sans TC", sans-serif',
  sans: 'Inter, sans-serif',
  serif: 'Newsreader, Georgia, serif', // the site's --font-serif (Palatino / Iowan) — Newsreader is the closest Google Font
} as const;
