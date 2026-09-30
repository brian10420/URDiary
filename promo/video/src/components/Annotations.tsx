/**
 * The two MG marks the storyboard uses on top of real UI (§0 視覺基調):
 *   書籤綠細圈 #5fd0a0 — drawn on once, like a pen circling something
 *   暖黃螢光筆 #f5c542 @ 35% — sweeps left → right under the words (multiply, so text stays dark)
 * Both take a rect in the coordinate space of whatever they are placed in.
 */
import {EASE_IN_OUT, EASE_OUT, presence, ramp} from '../lib/anim.ts';
import {C} from '../lib/theme.ts';
import {useTime} from '../lib/time.tsx';

type Rect = readonly [number, number, number, number];

export const CircleMark = ({rect, from, drawSec = 0.5, until, stroke = 5}: {rect: Rect; from: number; drawSec?: number; until: number; stroke?: number}) => {
  const t = useTime();
  const o = presence(t, from, until, 0.05, 0.25);
  if (o <= 0) return null;
  const [x, y, w, h] = rect;
  const pad = Math.max(14, h * 0.35);
  const rx = w / 2 + pad;
  const ry = h / 2 + pad * 0.8;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const k = ramp(t, from, from + drawSec, EASE_OUT);
  // One loose loop that overshoots its start a little, as a hand would.
  const steps = 64;
  const turn = 1.1;
  const pts = Array.from({length: steps + 1}, (_, i) => {
    const a = -Math.PI * 0.62 + (i / steps) * Math.PI * 2 * turn;
    const wob = 1 + 0.025 * Math.sin(a * 3);
    return `${cx + Math.cos(a) * rx * wob},${cy + Math.sin(a) * ry * (1 + (i / steps) * 0.06)}`;
  });
  return (
    <svg style={{position: 'absolute', left: 0, top: 0, overflow: 'visible', opacity: o}} width={1} height={1}>
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={C.bookmark}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - k}
        transform={`rotate(-3 ${cx} ${cy})`}
      />
    </svg>
  );
};

export const Highlighter = ({rect, from, sweepSec = 0.9, until}: {rect: Rect; from: number; sweepSec?: number; until: number}) => {
  const t = useTime();
  const o = presence(t, from, until, 0.01, 0.35);
  if (o <= 0) return null;
  const [x, y, w, h] = rect;
  const k = ramp(t, from, from + sweepSec, EASE_IN_OUT);
  return (
    <div
      style={{
        position: 'absolute',
        left: x - 6,
        top: y + h * 0.18,
        width: (w + 12) * k,
        height: h * 0.78,
        borderRadius: 6,
        background: C.highlighter,
        mixBlendMode: 'multiply',
        opacity: o,
        transform: 'skewX(-4deg)',
      }}
    />
  );
};

/** A soft "tap" ripple where the recording's cursor clicks (S5 33.8). */
export const TapRipple = ({at, x, y}: {at: number; x: number; y: number}) => {
  const t = useTime();
  const k = ramp(t, at, at + 0.45, EASE_OUT);
  if (t < at || k >= 1) return null;
  const r = 12 + k * 34;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: '50%',
        border: `3px solid ${C.bookmark}`,
        opacity: (1 - k) * 0.9,
        transform: `scale(${1 + EASE_IN_OUT(k) * 0.05})`,
      }}
    />
  );
};
