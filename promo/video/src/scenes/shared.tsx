/**
 * Pieces the scenes share: <Layer> (a time window with an optional dissolve-in) and the
 * placeholder illustrations — each ComfyUI stand-in shows the app's own mascot in the pose the
 * storyboard asks for, so a draft already reads like the film.
 */
import type {ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import {MOTION} from '../generated/mascot.ts';
import {EASE_IN_OUT, keyframesAt, ramp, rotationOf} from '../lib/anim.ts';
import {C} from '../lib/theme.ts';
import {At, useTime} from '../lib/time.tsx';
import {Mascot, type Rig} from '../components/Mascot.tsx';
import {dissolve} from '../components/Transition.tsx';

export const Layer = ({from, to, fadeIn, name, children}: {from: number; to: number; fadeIn?: readonly [number, number]; name?: string; children: ReactNode}) => (
  <At from={from} to={to} name={name}>
    <Fade fadeIn={fadeIn}>{children}</Fade>
  </At>
);

const Fade = ({fadeIn, children}: {fadeIn?: readonly [number, number]; children: ReactNode}) => {
  const t = useTime();
  const o = fadeIn ? dissolve(t, fadeIn[0], fadeIn[1]) : 1;
  if (o <= 0) return null;
  return <AbsoluteFill style={{opacity: o}}>{children}</AbsoluteFill>;
};

export const scaleYOf = (transform: string): number => Number(transform.match(/scaleY\((-?[\d.e-]+)\)/)?.[1] ?? 1);
export const scaleXYOf = (transform: string): [number, number] => {
  const m = transform.match(/scale\((-?[\d.e-]+),\s*(-?[\d.e-]+)\)/);
  return m ? [Number(m[1]), Number(m[2])] : [1, 1];
};

/** Idle life for mascots outside the chat area (breathe + an occasional blink), from mascot.css. */
export const idleRig = (t: number, blinkAt: number[] = []): Rig => {
  const breathe = scaleXYOf(keyframesAt(MOTION.breathe, t).transform);
  let eyes = 1;
  for (const b of blinkAt) if (t >= b && t < b + MOTION.blink.durationSec) eyes = scaleYOf(keyframesAt(MOTION.blink, t - b, {iterations: 1}).transform);
  return {breathe, eyesScaleY: eyes};
};

/** Where the phone lies in G1 (stage px). PROVISIONAL — set from the real G1; the S1 → S2 glow starts here. */
export const G1_PHONE_POINT = [1392, 600] as const;

/** G1 stand-in: the mascot beside a phone glowing on a night desk. */
export const NightDeskSketch = () => {
  const t = useTime();
  const cursorOn = Math.floor(t * 1.6) % 2 === 0;
  const [px, py] = G1_PHONE_POINT;
  return (
    <AbsoluteFill>
      <div style={{position: 'absolute', left: 0, right: 0, top: 690, bottom: 0, background: 'linear-gradient(180deg, #3a2c2c, #2a201f)'}} />
      <div
        style={{
          position: 'absolute',
          left: px - 130,
          top: py - 58,
          width: 260,
          height: 116,
          borderRadius: 22,
          background: '#fdf6e6',
          boxShadow: '0 0 120px 46px rgba(255, 238, 200, 0.42)',
          transform: 'perspective(900px) rotateX(58deg)',
        }}
      >
        <div style={{position: 'absolute', left: 26, right: 26, top: 30, height: 44, borderRadius: 12, border: `3px solid rgba(75, 46, 30, 0.3)`}} />
        {cursorOn ? <div style={{position: 'absolute', left: 44, top: 40, width: 4, height: 24, background: C.text}} /> : null}
      </div>
      <Mascot pose="smile" width={290} rig={idleRig(t, [3.0])} style={{position: 'absolute', left: 470, top: 372}} />
    </AbsoluteFill>
  );
};

/** G2 stand-in: the celebration pose (the only shot allowed stars — §4.1 rule 7). */
export const HappySketch = ({size}: {size: number}) => {
  const t = useTime();
  const hop = Math.sin(Math.min(1, Math.max(0, (t - 43.4) / 0.6)) * Math.PI) * 18;
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
      <Mascot pose="jump" width={size} style={{transform: `translateY(${-hop}px)`}} />
    </AbsoluteFill>
  );
};

/** G3 stand-in: calm company by a rainy window — no stars, no jump. */
export const RainSketch = ({size}: {size: number}) => {
  const t = useTime();
  const drops = Array.from({length: 26}, (_, i) => {
    const x = (i * 97) % 860;
    const speed = 380 + ((i * 53) % 160);
    const y = ((t * speed + i * 131) % 760) - 60;
    return <div key={i} style={{position: 'absolute', left: x, top: y, width: 2.5, height: 34, borderRadius: 2, background: 'rgba(235, 242, 255, 0.4)'}} />;
  });
  return (
    <AbsoluteFill>
      {drops}
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        <Mascot pose="smile" width={size} rig={idleRig(t, [48.6])} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** G4 stand-in: morning tea, subject on the left so the phone can take the right third. */
export const TeaSketch = () => {
  const t = useTime();
  return <Mascot pose="tea" width={470} rig={idleRig(t, [52.4, 56.9])} style={{position: 'absolute', left: 260, top: 330}} />;
};

/** G5 stand-in: one wave (the app's mm-wave, 1.2 s) in the left third, then still; freezes with the shot. */
export const WaveSketch = ({waveAt, freezeAt}: {waveAt: number; freezeAt: number}) => {
  const t = Math.min(useTime(), freezeAt);
  const arm = rotationOf(keyframesAt(MOTION.wave, t - waveAt, {iterations: 1}).transform);
  const settle = ramp(t, waveAt - 0.4, waveAt, EASE_IN_OUT);
  return <Mascot pose="wave" width={420} rig={{armDeg: t >= waveAt ? arm : 0, breathe: [1, 1 + 0.004 * settle]}} style={{position: 'absolute', left: 200, top: 360}} />;
};
