/** The cream page everything sits on (site: body background + the stage's ruled page). */
import type {CSSProperties} from 'react';
import {AbsoluteFill} from 'remotion';
import {C} from '../lib/theme.ts';

// Static paper grain (site --grain, a touch lighter). Off for the GIF-bound loop.
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .29 0 0 0 0 .18 0 0 0 0 .12 0 0 0 .045 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";
const RULED = 'repeating-linear-gradient(180deg, transparent 0 47px, rgba(75, 46, 30, 0.07) 47px 48px)';
const MARGIN = 'linear-gradient(90deg, transparent 0 118px, rgba(240, 167, 143, 0.45) 118px 121px, transparent 121px)';

export const Paper = ({ruled = false, margin = false, grain = true, color = C.paper, style}: {ruled?: boolean; margin?: boolean; grain?: boolean; color?: string; style?: CSSProperties}) => (
  <AbsoluteFill
    style={{
      backgroundColor: color,
      backgroundImage: [grain && GRAIN, margin && MARGIN, ruled && RULED].filter(Boolean).join(', ') || undefined,
      ...style,
    }}
  />
);
