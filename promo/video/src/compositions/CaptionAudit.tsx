/**
 * CaptionAudit (check-only still). Lays out every piece of on-screen text — IntroLong captions,
 * end-card layers, provider chips, every subtitle line, the ReadmeLoop cards — with the very
 * components and type roles the film uses, waits for the fonts, then measures each block in the
 * browser: more than two lines (or a subtitle line that would not fit on one line) aborts the
 * render. scripts/check.mjs reads the per-block report from the browser log (CAPTION_AUDIT …).
 */
import {useEffect, useState} from 'react';
import {AbsoluteFill, cancelRender, continueRender, delayRender} from 'remotion';
import {CAPTIONS, type CaptionItem} from '../data/captions.ts';
import {HERO_CARD, LOOP_SEGMENTS} from '../data/loop.ts';
import {NARRATION} from '../data/narration.ts';
import type {Lang} from '../data/timeline.ts';
import {fontsReady} from '../lib/fonts.ts';
import {C, FONT} from '../lib/theme.ts';
import {CaptionText} from '../components/Caption.tsx';
import {SubtitlePlate} from '../components/Subtitle.tsx';
import type {Role} from '../components/typography.ts';

export type AuditProps = {lang: Lang};

const ROLE_OF: Record<CaptionItem['kind'], [Role, Role?]> = {
  title: ['title-wordmark', 'title-sub'],
  card: ['card-title', 'card-sub'],
  'card-center': ['card-title', 'card-sub'],
  'panel-label': ['panel-label'],
  'diagram-title': ['diagram-title'],
  'diagram-note': ['diagram-note'],
  'diagram-chip': ['diagram-chip'],
  fine: ['fine'],
  'end-wordmark': ['end-wordmark'],
  'end-main': ['end-main'],
  'end-small': ['end-small'],
  'end-meta': ['end-meta'],
  'end-url': ['end-url'],
  'end-disclaimer': ['end-disclaimer'],
};

type Result = {id: string; role: string; lines: number; overflow: boolean; width: number; maxWidth: number};

const measure = (): Result[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-audit]')).map((el) => {
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight);
    const rect = el.getBoundingClientRect();
    return {
      id: el.dataset.audit ?? '?',
      role: el.dataset.role ?? '?',
      lines: Math.round(rect.height / lh),
      overflow: el.scrollWidth > el.clientWidth + 1,
      width: Math.round(rect.width),
      maxWidth: parseFloat(cs.maxWidth),
    };
  });

export const CaptionAudit = ({lang}: AuditProps) => {
  const [handle] = useState(() => delayRender('caption audit: waiting for fonts'));
  useEffect(() => {
    let live = true;
    fontsReady
      .then(() => document.fonts.ready)
      .then(() => {
        if (!live) return;
        const results = measure();
        const bad = results.filter((r) => r.lines > 2 || r.overflow || (r.role === 'subtitle' && r.lines !== 1));
        // Compact on purpose: Remotion echoes every browser console line to the terminal.
        const report = {
          lang,
          blocks: results.length,
          maxLines: results.reduce((m, r) => Math.max(m, r.lines), 0),
          twoLines: results.filter((r) => r.lines === 2).map((r) => r.id),
          bad: bad.map((b) => b.id),
        };
        // eslint-disable-next-line no-console
        console.log(`CAPTION_AUDIT ${JSON.stringify(report)}`);
        if (bad.length) {
          cancelRender(new Error(`caption audit (${lang}) failed:\n${bad.map((b) => `  ${b.id} [${b.role}] ${b.lines} lines${b.overflow ? ', overflows' : ''} (${b.width}/${b.maxWidth} px)`).join('\n')}`));
        } else continueRender(handle);
      })
      .catch((e) => cancelRender(e));
    return () => {
      live = false;
    };
  }, [handle, lang]);

  const providerNames = (c: CaptionItem) => c.text[lang].split(/\s*[・·]\s*/);
  return (
    <AbsoluteFill style={{background: C.paper, padding: 40, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start', fontFamily: FONT.sans}}>
      {CAPTIONS.map((c) => {
        const [main, sub] = ROLE_OF[c.kind];
        if (c.id === 's9-providers') {
          return providerNames(c).map((n) => <CaptionText key={n} role="diagram-chip" lang="en" text={n} auditId={`${c.id}:${n}`} />);
        }
        return (
          <div key={c.id} style={{display: 'flex', flexDirection: 'column', gap: 4, outline: `1px dashed ${C.line}`}}>
            <CaptionText role={main} lang={lang} text={c.text[lang]} auditId={`${c.id}:text`} />
            {c.sub && sub ? <CaptionText role={sub} lang={lang} text={c.sub[lang]} auditId={`${c.id}:sub`} /> : null}
          </div>
        );
      })}
      {NARRATION.flatMap((l) =>
        l.subtitles[lang].map((lines, k) => <SubtitlePlate key={`${l.id}.${k}`} lines={lines} lang={lang} audit={`sub:${l.id}.${k}`} />),
      )}
      {[{en: HERO_CARD.en, zh: HERO_CARD.zh, id: 'hero'}, ...LOOP_SEGMENTS.filter((s) => s.card && s.kind === 'ui').map((s) => ({en: s.card!.en, zh: s.card!.zh, id: s.id}))].map((c) => (
        <div key={c.id} style={{display: 'flex', flexDirection: 'column', gap: 4}}>
          <CaptionText role="loop-en" lang="en" text={c.en} auditId={`loop:${c.id}:en`} />
          <CaptionText role="loop-zh" lang="zh" text={c.zh} auditId={`loop:${c.id}:zh`} />
        </div>
      ))}
      <CaptionText role="loop-wordmark" lang="en" text={HERO_CARD.wordmark} auditId="loop:hero:wordmark" />
    </AbsoluteFill>
  );
};
