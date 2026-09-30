/**
 * Transitions (§0: 「轉場只用溶接、紙張滑移、配對剪接，不用閃光或快速甩鏡」).
 *   dissolve   — the incoming layer fades in over the outgoing one
 *   paper      — the incoming page slides in from the right over the outgoing one (§2 loop)
 *   glow match — S1 → S2: the phone's glow travels to where the app window rises
 * The S5 → S6 match cut (stamp enlarges and splits in two) lives in the S6 scene.
 */
import type {ReactNode} from 'react';
import {AbsoluteFill, useVideoConfig} from 'remotion';
import {EASE_IN_OUT, bell, lerp, ramp} from '../lib/anim.ts';
import {useTime} from '../lib/time.tsx';

/** Opacity of a layer that dissolves in over [from, to] and (optionally) out over [outFrom, outTo]. */
export const dissolve = (t: number, from: number, to: number, outFrom?: number, outTo?: number): number => {
  const inK = from === to ? (t >= from ? 1 : 0) : ramp(t, from, to, EASE_IN_OUT);
  const outK = outFrom === undefined || outTo === undefined ? 0 : outFrom === outTo ? (t >= outFrom ? 1 : 0) : ramp(t, outFrom, outTo, EASE_IN_OUT);
  return inK * (1 - outK);
};

export const FadeFromBlack = ({from, to}: {from: number; to: number}) => {
  const t = useTime();
  const o = 1 - ramp(t, from, to, EASE_IN_OUT);
  return o > 0 ? <AbsoluteFill style={{background: '#000', opacity: o}} /> : null;
};

/**
 * Paper slide: `children` is the incoming page; it enters from the right edge and settles over
 * [from, to], its leading edge casting a soft shadow on the page below. Flat colours only, so the
 * GIF export stays clean.
 */
export const PaperSlide = ({from, to, children}: {from: number; to: number; children: ReactNode}) => {
  const t = useTime();
  const {width} = useVideoConfig();
  const k = ramp(t, from, to, EASE_IN_OUT);
  if (k <= 0) return null;
  const x = (1 - k) * width;
  // Once settled, no transform at all: the page then renders exactly as if it had never moved
  // (ReadmeLoop's frame 600 must equal frame 0 pixel for pixel).
  return (
    <AbsoluteFill style={{transform: k < 1 ? `translateX(${x}px)` : undefined}}>
      {k < 1 ? (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: -28,
            width: 28,
            background: 'linear-gradient(90deg, rgba(75, 46, 30, 0), rgba(75, 46, 30, 0.16))',
          }}
        />
      ) : null}
      {children}
    </AbsoluteFill>
  );
};

/** S1 → S2 配對溶接: a warm glow travels from the phone screen to the rising window. */
export const GlowMatch = ({from, to, fromPt, toPt}: {from: number; to: number; fromPt: readonly [number, number]; toPt: readonly [number, number]}) => {
  const t = useTime();
  if (t < from || t > to) return null;
  const k = ramp(t, from, to, EASE_IN_OUT);
  const x = lerp(fromPt[0], toPt[0], k);
  const y = lerp(fromPt[1], toPt[1], k);
  const r = lerp(160, 820, k);
  const o = 0.62 * bell(t, from, to);
  return (
    <AbsoluteFill
      style={{
        opacity: o,
        background: `radial-gradient(circle ${r}px at ${x}px ${y}px, rgba(255, 246, 222, 0.95), rgba(255, 238, 205, 0.45) 45%, rgba(255, 238, 205, 0) 100%)`,
        mixBlendMode: 'screen',
      }}
    />
  );
};

