/**
 * Fonts (Google Fonts through @remotion/google-fonts; fetched at render time, cached by Chrome):
 *   Noto Sans TC — every zh run (variable: one file per unicode-range chunk covers all weights)
 *   Inter        — en UI text, subtitles
 *   Newsreader   — the wordmark and en display lines (the site sets them in Palatino / Iowan Old
 *                  Style; Newsreader is the closest Google Font — compared side by side with P052)
 *
 * Noto Sans TC ships ~105 chunks. Loading the whole 「chinese-traditional」 subset would fetch all
 * of them in every render tab, so the chunks are picked from the Chinese text the film actually
 * contains (all data modules + ui-strings.ts). New zh text in data is covered automatically.
 */
import {getInfo as notoInfo, loadVariableFont as loadNoto} from '@remotion/google-fonts/NotoSansTC';
import {loadVariableFont as loadInter} from '@remotion/google-fonts/Inter';
import {loadVariableFont as loadNewsreader} from '@remotion/google-fonts/Newsreader';
import {CAPTIONS} from '../data/captions.ts';
import {HERO_CARD, LOOP_SEGMENTS} from '../data/loop.ts';
import {SHOTS, SHOTS_EN, TARGETS} from '../data/media.ts';
import {NARRATION} from '../data/narration.ts';
import {SCENES} from '../data/timeline.ts';
import {UI, UI_TEXT} from '../data/ui-strings.ts';

const zhCorpus = (): string =>
  [
    ...NARRATION.flatMap((l) => [l.text.zh, ...l.subtitles.zh.flat()]),
    ...CAPTIONS.flatMap((c) => [c.text.zh, c.sub?.zh ?? '']),
    ...LOOP_SEGMENTS.map((s) => s.card?.zh ?? ''),
    HERO_CARD.zh,
    ...SCENES.flatMap((s) => [s.id, s.name, s.takeaway]),
    ...Object.values(SHOTS).flatMap((s) => [s.label, s.name, s.brief]),
    ...Object.values(TARGETS).map((t) => t.label),
    ...Object.values(UI),
    ...Object.values(UI_TEXT.en),
    ...Object.values(SHOTS_EN).flatMap((s) => [s.label, s.name, s.brief]),
    // digits, Latin and punctuation used in labels / timecodes
    ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~·—–×→／（）：「」《》、，。；？！…',
  ].join('');

const parseRanges = (s: string): Array<[number, number]> =>
  s.split(',').map((part) => {
    const [a, b] = part.trim().replace(/^U\+/i, '').split('-');
    return [parseInt(a, 16), parseInt(b ?? a, 16)];
  });

/** The Noto Sans TC chunks (e.g. "[113]", "latin") that contain the film's zh text. */
export const notoChunksFor = (text: string): string[] => {
  const faces = notoInfo().variable?.fontFaces.filter((f) => f.style === 'normal') ?? [];
  const ranges = faces.map((f) => ({subset: f.subset, ranges: parseRanges(f.unicodeRange)}));
  const need = new Set<string>();
  for (const ch of new Set(Array.from(text))) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0x20) continue;
    const hit = ranges.find((r) => r.ranges.some(([a, b]) => cp >= a && cp <= b));
    if (hit) need.add(hit.subset);
  }
  return [...need].sort();
};

export const NOTO_CHUNKS = notoChunksFor(zhCorpus());

// The typings only list the named subsets, but the loader resolves numbered chunk keys such as
// "[113]" directly (@remotion/google-fonts resolve-font-subsets.js) — that is what keeps this at
// ~20 requests instead of ~105.
type NotoSubset = NonNullable<Parameters<typeof loadNoto>[1]>['subsets'][number];
const noto = loadNoto('normal', {subsets: NOTO_CHUNKS as unknown as NotoSubset[], ignoreTooManyRequestsWarning: true});
const inter = loadInter('normal', {subsets: ['latin', 'latin-ext']});
const newsreader = loadNewsreader('normal', {subsets: ['latin', 'latin-ext']});

/** Resolves once every font face has loaded (the audit waits for it before measuring). */
export const fontsReady: Promise<void> = Promise.all([noto.waitUntilDone(), inter.waitUntilDone(), newsreader.waitUntilDone()]).then(
  () => undefined,
);
