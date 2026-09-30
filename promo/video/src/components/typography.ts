/**
 * Type roles at 1080p (ReadmeLoop roles at 720p). One table for the scenes and for the layout
 * audit (compositions/CaptionAudit.tsx), so `npm run check` measures exactly what renders.
 * Sizes: every line of on-screen text is ≥ 20 px at 1080p; the loop keeps §2's en ≥ 44 / zh ≥ 40.
 */
import type {CSSProperties} from 'react';
import type {Lang} from '../data/timeline.ts';
import {C, FONT} from '../lib/theme.ts';

export type Role =
  | 'card-title'
  | 'card-sub'
  | 'title-wordmark'
  | 'title-sub'
  | 'panel-label'
  | 'diagram-title'
  | 'diagram-note'
  | 'diagram-chip'
  | 'fine'
  | 'end-wordmark'
  | 'end-main'
  | 'end-small'
  | 'end-meta'
  | 'end-url'
  | 'end-disclaimer'
  | 'subtitle'
  | 'loop-wordmark'
  | 'loop-en'
  | 'loop-zh';

interface Face {
  family: string;
  size: number;
  weight: number;
  /** Unitless line height; the rendered line box is size × lineHeight px. */
  lineHeight: number;
  letterSpacing?: string;
  color?: string;
}

interface RoleSpec {
  /** The text box width the role wraps in (px). The audit wraps at exactly this width. */
  maxWidth: number;
  zh: Face;
  en: Face;
}

const zh = (size: number, weight: number, lineHeight: number, extra: Partial<Face> = {}): Face => ({
  family: FONT.zh, size, weight, lineHeight, letterSpacing: '0.04em', ...extra,
});
const sans = (size: number, weight: number, lineHeight: number, extra: Partial<Face> = {}): Face => ({
  family: FONT.sans, size, weight, lineHeight, ...extra,
});
const serif = (size: number, weight: number, lineHeight: number, extra: Partial<Face> = {}): Face => ({
  family: FONT.serif, size, weight, lineHeight, letterSpacing: '-0.005em', ...extra,
});

export const ROLES: Record<Role, RoleSpec> = {
  'card-title': {maxWidth: 1100, zh: zh(58, 700, 1.3, {letterSpacing: '0.06em'}), en: serif(62, 650, 1.12)},
  'card-sub': {maxWidth: 1100, zh: zh(30, 500, 1.45, {color: C.text2}), en: sans(28, 500, 1.4, {color: C.text2})},
  'title-wordmark': {maxWidth: 1200, zh: serif(112, 700, 1.0, {letterSpacing: '-0.02em'}), en: serif(112, 700, 1.0, {letterSpacing: '-0.02em'})},
  'title-sub': {maxWidth: 1240, zh: zh(38, 700, 1.35, {letterSpacing: '0.08em', color: C.text2}), en: serif(40, 600, 1.2, {color: C.text2})},
  'panel-label': {maxWidth: 680, zh: zh(34, 700, 1.3, {letterSpacing: '0.1em'}), en: serif(36, 650, 1.15)},
  'diagram-title': {maxWidth: 700, zh: zh(50, 700, 1.3, {letterSpacing: '0.08em'}), en: serif(54, 650, 1.12)},
  'diagram-note': {maxWidth: 700, zh: zh(29, 500, 1.45, {color: C.text2}), en: sans(28, 500, 1.4, {color: C.text2})},
  'diagram-chip': {maxWidth: 640, zh: zh(32, 700, 1.3), en: sans(34, 600, 1.25)},
  fine: {maxWidth: 1480, zh: zh(27, 400, 1.5, {color: C.text2, letterSpacing: '0.03em'}), en: sans(25, 400, 1.45, {color: C.text2})},
  'end-wordmark': {maxWidth: 1000, zh: serif(120, 700, 1.0, {letterSpacing: '-0.02em'}), en: serif(120, 700, 1.0, {letterSpacing: '-0.02em'})},
  'end-main': {maxWidth: 1000, zh: zh(56, 700, 1.4, {letterSpacing: '0.06em'}), en: serif(58, 600, 1.16)},
  'end-small': {maxWidth: 1000, zh: zh(30, 500, 1.4, {letterSpacing: '0.18em', color: C.text2}), en: sans(28, 500, 1.4, {letterSpacing: '0.02em', color: C.text2})},
  'end-meta': {maxWidth: 1000, zh: zh(30, 700, 1.4, {letterSpacing: '0.06em'}), en: sans(28, 600, 1.4)},
  'end-url': {maxWidth: 1000, zh: sans(28, 600, 1.4, {color: C.bookmarkInk}), en: sans(28, 600, 1.4, {color: C.bookmarkInk})},
  'end-disclaimer': {maxWidth: 1000, zh: zh(24, 400, 1.45, {color: C.text3, letterSpacing: '0.04em'}), en: sans(22, 400, 1.45, {color: C.text3})},
  subtitle: {maxWidth: 1560, zh: zh(46, 500, 1.45, {color: C.textStrong, letterSpacing: '0.05em'}), en: sans(42, 500, 1.35, {color: C.textStrong})},
  'loop-wordmark': {maxWidth: 1080, zh: serif(84, 700, 1.0, {letterSpacing: '-0.02em'}), en: serif(84, 700, 1.0, {letterSpacing: '-0.02em'})},
  'loop-en': {maxWidth: 1120, zh: sans(46, 600, 1.2), en: sans(46, 600, 1.2)},
  'loop-zh': {maxWidth: 1120, zh: zh(40, 500, 1.35, {color: C.text2, letterSpacing: '0.08em'}), en: zh(40, 500, 1.35, {color: C.text2})},
};

export const faceOf = (role: Role, lang: Lang): Face => ROLES[role][lang];

/** The inline style of a text run in `role`. `wrap: false` keeps a line on one line (subtitles are pre-broken). */
/** Headline roles wrap into even lines (no one-word orphans); body roles wrap 'pretty'. */
const BALANCED: ReadonlySet<Role> = new Set<Role>(['card-title', 'title-sub', 'panel-label', 'diagram-title', 'fine', 'end-main', 'loop-en', 'loop-zh']);

export const textStyle = (role: Role, lang: Lang, wrap = true): CSSProperties => {
  const f = faceOf(role, lang);
  return {
    fontFamily: f.family,
    fontSize: f.size,
    fontWeight: f.weight,
    lineHeight: `${Math.round(f.size * f.lineHeight)}px`,
    letterSpacing: f.letterSpacing,
    color: f.color ?? C.text,
    maxWidth: ROLES[role].maxWidth,
    whiteSpace: wrap ? 'pre-line' : 'nowrap',
    overflowWrap: 'break-word',
    fontKerning: 'normal',
    fontVariantNumeric: 'proportional-nums',
    textWrap: (BALANCED.has(role) ? 'balance' : 'pretty') as CSSProperties['textWrap'],
  };
};

