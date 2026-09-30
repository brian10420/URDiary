/**
 * S4 被記得 — 24.0–33.0 s (frames 1440–1979). STORYBOARD §1.2 S4.
 * U04: the second message and the reply that recalls the 09-14 diary. 28.0–31.5 the warm
 * highlighter sweeps the recall — en: the date + title the reply quotes ("September 14 entry,
 * “Sleepless before my first presentation,”"); zh (v3.1): the paraphrased recall 「你之前第一次上台
 * 報告前也失眠到半夜爬起來順講稿」, since no zh take quoted date + title. A memory card (U05, the real
 * 09-14 diary card, cropped at native 2×) floats in on the right, beside the reply and clear of her
 * second message, and a thin line runs to it through the gap under the highlighted line.
 * 31.5–33.0 hold; out: the card retracts and the window dissolves into S5. Caption 27.5–32.5.
 */
import {introPlacement} from '../data/media.ts';
import type {Lang} from '../data/timeline.ts';
import {EASE_IN_OUT, EASE_OUT, lerp, ramp} from '../lib/anim.ts';
import {C} from '../lib/theme.ts';
import {useTime} from '../lib/time.tsx';
import {Highlighter} from '../components/Annotations.tsx';
import {Stamp} from '../components/Mascot.tsx';
import {MediaSlot, clipAspect} from '../components/MediaSlot.tsx';
import {inWindow, windowBox} from './window-marks.ts';

const CARD_IN = 29.6; // the paper sound (audio.ts) plays here
const CARD_OUT = [32.5, 32.9] as const;

const MemoryCard = ({lang}: {lang: Lang}) => {
  const t = useTime();
  const inK = ramp(t, CARD_IN, CARD_IN + 0.55, EASE_OUT);
  const outK = ramp(t, CARD_OUT[0], CARD_OUT[1], EASE_IN_OUT);
  const o = inK * (1 - outK);
  if (o <= 0) return null;
  const placement = introPlacement('S4.U05');
  const [sx, sy, sw] = inWindow('s4CardSlot', lang);
  const card = {x: sx, y: sy, w: sw, h: sw / clipAspect(placement, lang, 1.73)};
  const [qx, qy, qw, qh] = inWindow('s4Quote', lang);
  const line = ramp(t, 30.2, 30.8, EASE_IN_OUT) * (1 - outK);
  // start just under the end of the highlighted words, so the dot and the line stay off the text
  const x1 = qx + qw + 4;
  const y1 = qy + qh + 2;
  const gap = qy + qh + 9; // the blank band under the highlighted line
  const x2 = card.x - 8;
  const y2 = card.y + card.h / 2;
  return (
    <>
      <svg style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}} width={1} height={1}>
        <path
          d={`M${x1} ${y1} C ${x1 + 30} ${gap}, ${x2 - 140} ${gap}, ${x2} ${y2}`}
          fill="none"
          stroke={C.text}
          strokeWidth={2.5}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - line}
          opacity={0.7}
        />
        <circle cx={x1} cy={y1} r={3.5} fill={C.text} opacity={0.7 * Math.min(1, line * 4)} />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: card.x,
          top: card.y,
          width: card.w,
          height: card.h,
          borderRadius: 14,
          overflow: 'hidden',
          background: C.surface,
          boxShadow: '0 22px 44px -20px rgba(75, 46, 30, 0.6), 0 0 0 1.5px rgba(75, 46, 30, 0.16)',
          opacity: o,
          transform: `translateX(${lerp(40, 0, inK) + lerp(0, 40, outK)}px) rotate(${lerp(2.5, 1, inK)}deg)`,
        }}
      >
        <MediaSlot
          placement={placement}
          lang={lang}
          tone="paper"
          compact
          illustration={<Stamp id="book" size={56} style={{position: 'absolute', right: 26, top: 26}} />}
          labelPosition="top-left"
        />
      </div>
    </>
  );
};

export const S4 = ({lang}: {lang: Lang}) => (
  <>
    <MediaSlot placement={introPlacement('S4.U04')} lang={lang} tone="ui" targets={[windowBox('s4Quote', lang)]} labelPosition="center" />
    <Highlighter rect={inWindow('s4Quote', lang)} from={28.0} sweepSec={1.0} until={32.6} />
    <MemoryCard lang={lang} />
  </>
);
