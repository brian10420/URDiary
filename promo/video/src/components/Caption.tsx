/**
 * On-screen text (「畫面文字」). <CaptionText> is the one way text is set in this project (the
 * layout audit renders the same element); <CaptionCard> is the cream card with the green
 * bookmark ribbon the headline captions sit on; <CaptionTrack> shows the storyboard's card
 * captions at their in / out times. Scene-specific text (S1 title, S6 labels, S9 diagram, S10 end
 * card) is laid out by the scenes, with these same parts.
 */
import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import {CAPTIONS, type CaptionItem, typeset} from '../data/captions.ts';
import type {Lang} from '../data/timeline.ts';
import {EASE_OUT, lerp, presence, ramp} from '../lib/anim.ts';
import {C} from '../lib/theme.ts';
import {useTime} from '../lib/time.tsx';
import {type Role, textStyle} from './typography.ts';

export const CaptionText = ({
  role,
  lang,
  text,
  auditId,
  wrap = true,
  style,
}: {
  role: Role;
  lang: Lang;
  text: string;
  auditId?: string;
  wrap?: boolean;
  style?: CSSProperties;
}) => (
  <div data-audit={auditId} data-role={role} data-lang={lang} style={{...textStyle(role, lang, wrap), ...style}}>
    {typeset(text)}
  </div>
);

/** The mascot's bookmark as a ribbon: #5fd0a0 with the outline brown and the V notch. */
export const Ribbon = ({height = 46, style}: {height?: number; style?: CSSProperties}) => {
  const w = height * 0.5;
  return (
    <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} style={{display: 'block', overflow: 'visible', ...style}} aria-hidden>
      <path
        d={`M1.5 0 H${w - 1.5} V${height - 2} L${w / 2} ${height - w * 0.5} L1.5 ${height - 2} Z`}
        fill={C.bookmark}
        stroke={C.text}
        strokeWidth={3}
        strokeLinejoin="round"
      />
    </svg>
  );
};

export const Card = ({children, style, ribbon = true}: {children: ReactNode; style?: CSSProperties; ribbon?: boolean}) => (
  <div
    style={{
      position: 'relative',
      background: C.surface,
      borderRadius: 24,
      border: `1.5px solid ${C.line}`,
      boxShadow: C.shadow,
      padding: '26px 40px 28px 44px',
      ...style,
    }}
  >
    {ribbon ? <Ribbon style={{position: 'absolute', left: 22, top: -6}} /> : null}
    {children}
  </div>
);

/** Card caption content: title (+ optional small line). */
export const CaptionBody = ({item, lang, audit = false}: {item: CaptionItem; lang: Lang; audit?: boolean}) => (
  <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
    <CaptionText role="card-title" lang={lang} text={item.text[lang]} auditId={audit ? `${item.id}:title` : undefined} />
    {item.sub ? (
      <CaptionText role="card-sub" lang={lang} text={item.sub[lang]} auditId={audit ? `${item.id}:sub` : undefined} />
    ) : null}
  </div>
);

/** Soft arrival (fade + 14 px rise, 0.4 s) and a 0.3 s fade out, ending at `out`. */
export const useArrival = (tin: number, tout: number, fin = 0.4, fout = 0.3) => {
  const t = useTime();
  const o = presence(t, tin, tout, fin, fout);
  const rise = lerp(14, 0, ramp(t, tin, tin + fin + 0.15, EASE_OUT));
  return {opacity: o, transform: `translateY(${rise}px)`};
};

const CardCaption = ({item, lang}: {item: CaptionItem; lang: Lang}) => {
  const a = useArrival(item.in, item.out);
  if (a.opacity <= 0) return null;
  const pos: CSSProperties =
    item.kind === 'card-center'
      ? {position: 'absolute', top: 46, left: 0, right: 0, display: 'flex', justifyContent: 'center'}
      : item.pos === 'top-right'
        ? {position: 'absolute', top: 58, right: 72}
        : {position: 'absolute', top: 58, left: 72};
  return (
    <div style={{...pos, opacity: a.opacity, transform: a.transform}}>
      <Card>
        <CaptionBody item={item} lang={lang} />
      </Card>
    </div>
  );
};

/** All 'card' / 'card-center' captions of IntroLong, at the storyboard's times. */
export const CaptionTrack = ({lang}: {lang: Lang}) => {
  const t = useTime();
  const live = CAPTIONS.filter((c) => (c.kind === 'card' || c.kind === 'card-center') && t >= c.in && t < c.out);
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {live.map((c) => (
        <CardCaption key={c.id} item={c} lang={lang} />
      ))}
    </AbsoluteFill>
  );
};
