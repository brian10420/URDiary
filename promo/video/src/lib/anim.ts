/**
 * Motion helpers. Everything is a pure function of time — Remotion renders frames out of order
 * and in parallel, so CSS animations / transitions are never used.
 */
import {Easing, interpolate} from 'remotion';
import type {CssAnimation, TransformFn} from '../generated/mascot.ts';

/** CSS `ease-in-out` (the app's sway / wave) — also the default for camera moves. */
export const EASE_IN_OUT = Easing.bezier(0.42, 0, 0.58, 1);
/** The site's reveal curve, cubic-bezier(.2, .7, .2, 1): soft arrivals. */
export const EASE_OUT = Easing.bezier(0.2, 0.7, 0.2, 1);
export const EASE_IN = Easing.bezier(0.42, 0, 1, 1);
const CSS_TIMING: Record<string, (x: number) => number> = {
  linear: (x) => x,
  ease: Easing.bezier(0.25, 0.1, 0.25, 1),
  'ease-in': EASE_IN,
  'ease-out': Easing.bezier(0, 0, 0.58, 1),
  'ease-in-out': EASE_IN_OUT,
};

/** 0 before `a`, 1 after `b`, eased in between. */
export const ramp = (t: number, a: number, b: number, easing: (x: number) => number = EASE_IN_OUT): number =>
  b <= a ? (t >= b ? 1 : 0) : interpolate(t, [a, b], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing});

/** Visibility of something shown from `tin` to `tout`: fades in over `fin`, out over `fout` (ending at `tout`). */
export const presence = (t: number, tin: number, tout: number, fin = 0.35, fout = 0.3): number =>
  Math.min(ramp(t, tin, tin + fin, EASE_OUT), 1 - ramp(t, tout - fout, tout, EASE_IN_OUT));

export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** A 0 → 1 → 0 bell over [a, b], peaking in the middle. */
export const bell = (t: number, a: number, b: number): number => (t <= a || t >= b ? 0 : Math.sin(((t - a) / (b - a)) * Math.PI));

/**
 * Evaluates one of the app's CSS @keyframes (parsed from desktop/css/mascot.css by
 * scripts/gen-mascot.mjs) at `sec` seconds into the animation, the way the browser would:
 * the timing function applies per keyframe interval. `iterations` = 1 plays once and holds the
 * last keyframe; Infinity loops.
 */
export const keyframesAt = (
  anim: CssAnimation,
  sec: number,
  {iterations = Infinity, durationSec = anim.durationSec}: {iterations?: number; durationSec?: number} = {},
): {transform: string; opacity: number | undefined} => {
  const raw = sec / durationSec;
  const p = raw < 0 ? 0 : raw >= iterations ? 1 : raw - Math.floor(raw);
  const kfs = anim.keyframes;
  let i = 0;
  while (i + 1 < kfs.length - 1 && kfs[i + 1].offset <= p) i++;
  const a = kfs[i];
  const b = kfs[Math.min(i + 1, kfs.length - 1)];
  const span = b.offset - a.offset;
  const u = span > 0 ? Math.min(1, Math.max(0, (p - a.offset) / span)) : 1;
  const k = (CSS_TIMING[anim.timing] ?? CSS_TIMING.ease)(u);
  const mix = (fa: TransformFn[] = [], fb: TransformFn[] = []): string =>
    (fa.length >= fb.length ? fa : fb)
      .map((f, j) => {
        const fa2 = fa[j] ?? f;
        const fb2 = fb[j] ?? f;
        const args = f.args.map((arg, n) => `${lerp(fa2.args[n]?.v ?? arg.v, fb2.args[n]?.v ?? arg.v, k)}${arg.unit}`);
        return `${f.fn}(${args.join(', ')})`;
      })
      .join(' ');
  const opacity = a.opacity !== undefined || b.opacity !== undefined ? lerp(a.opacity ?? 1, b.opacity ?? 1, k) : undefined;
  return {transform: mix(a.transform, b.transform), opacity};
};

/** Rotation in degrees from a keyframes result like "rotate(-3.2deg)". */
export const rotationOf = (transform: string): number => Number(transform.match(/rotate\((-?[\d.e-]+)deg\)/)?.[1] ?? 0);
