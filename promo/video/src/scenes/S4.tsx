/**
 * S4 被記得 — 24.0–33.0 s (frames 1440–1979). STORYBOARD §1.2 S4.
 * U04: the second message and the reply that quotes 「M 月 D 日《標題》」. 28.0–31.5 the warm
 * highlighter sweeps the date + title, a memory card (U05, the real diary card) floats in on the
 * right and a thin line ties it to the quote; 31.5–33.0 hold; out: the card retracts and the
 * window dissolves into S5. Caption 「被記得」 27.5–32.5.
 */
import {introPlacement, TARGETS} from '../data/media.ts';
import type {Lang} from '../data/timeline.ts';
import {EASE_IN_OUT, EASE_OUT, lerp, ramp} from '../lib/anim.ts';
import {C} from '../lib/theme.ts';
import {useTime} from '../lib/time.tsx';
import {Highlighter} from '../components/Annotations.tsx';
import {Stamp} from '../components/Mascot.tsx';
import {MediaSlot} from '../components/MediaSlot.tsx';
import {inWindow, windowBox} from './window-marks.ts';

const CARD = {x: 884, y: 318, w: 520, h: 159} as const; // content px, right of the quote
const CARD_IN = 29.6; // the paper sound (audio.ts) plays here
const CARD_OUT = [32.5, 32.9] as const;

const MemoryCard = ({lang}: {lang: Lang}) => {
  const t = useTime();
  const inK = ramp(t, CARD_IN, CARD_IN + 0.55, EASE_OUT);
  const outK = ramp(t, CARD_OUT[0], CARD_OUT[1], EASE_IN_OUT);
  const o = inK * (1 - outK);
  if (o <= 0) return null;
  const [qx, qy, qw, qh] = inWindow('s4Quote');
  const line = ramp(t, 30.2, 30.8, EASE_IN_OUT) * (1 - outK);
  const x1 = qx + qw + 10;
  const y1 = qy + qh / 2;
  const x2 = CARD.x - 6;
  const y2 = CARD.y + CARD.h / 2;
  return (
    <>
      <svg style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}} width={1} height={1}>
        <path
          d={`M${x1} ${y1} C ${x1 + 70} ${y1}, ${x2 - 70} ${y2}, ${x2} ${y2}`}
          fill="none"
          stroke={C.text}
          strokeWidth={2.5}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - line}
          opacity={0.7}
        />
        <circle cx={x1} cy={y1} r={5} fill={C.text} opacity={0.7 * Math.min(1, line * 4)} />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: CARD.x,
          top: CARD.y,
          width: CARD.w,
          height: CARD.h,
          borderRadius: 18,
          overflow: 'hidden',
          background: C.surface,
          boxShadow: '0 26px 50px -24px rgba(75, 46, 30, 0.6), 0 0 0 1.5px rgba(75, 46, 30, 0.14)',
          opacity: o,
          transform: `translateX(${lerp(40, 0, inK) + lerp(0, 40, outK)}px) rotate(${lerp(2.5, 1, inK)}deg)`,
        }}
      >
        <MediaSlot
          placement={introPlacement('S4.U05')}
          lang={lang}
          tone="paper"
          compact
          crop={{rect: TARGETS.u05Card.rect, box: {w: CARD.w, h: CARD.h}}}
          illustration={<Stamp id="book" size={56} style={{position: 'absolute', right: 26, top: 26}} />}
          labelPosition="top-left"
        />
      </div>
    </>
  );
};

export const S4 = ({lang}: {lang: Lang}) => (
  <>
    <MediaSlot placement={introPlacement('S4.U04')} lang={lang} tone="ui" targets={[windowBox('s4Quote')]} labelPosition="center" />
    <Highlighter rect={inWindow('s4Quote')} from={28.0} sweepSec={1.0} until={32.6} />
    <MemoryCard lang={lang} />
  </>
);
