/**
 * S10 療癒自己的事 — 80.0–88.5 s (frames 4800–5309). STORYBOARD §1.2 S10.
 * G5 (cream paper, the mascot in the left third waves once, lowers its hand, smiles; frozen on
 * its last frame from 85.0) with a few real stamps drifting slowly behind the end card. The end
 * card on the right adds one layer at a time: 80.5 wordmark → 81.0 the closing line (with the
 * narration, so no separate subtitle) → 83.8 「被聽見・被記得・被看見」 → 84.6 licence + URL →
 * 85.2 the disclaimer; held to 88.5 while only the music fades.
 */
import {AbsoluteFill} from 'remotion';
import {caption} from '../data/captions.ts';
import {introPlacement} from '../data/media.ts';
import type {Lang} from '../data/timeline.ts';
import {EASE_OUT, lerp, ramp} from '../lib/anim.ts';
import {C} from '../lib/theme.ts';
import {useTime} from '../lib/time.tsx';
import {Card, CaptionText} from '../components/Caption.tsx';
import {Stamp} from '../components/Mascot.tsx';
import {MediaSlot} from '../components/MediaSlot.tsx';
import type {StampId} from '../generated/mascot.ts';
import type {Role} from '../components/typography.ts';
import {WaveSketch} from './shared.tsx';

/** Drifting stamps: [id, x, y, size, drift period s, phase]. Small and slow (§1.2). */
const FLOAT: ReadonlyArray<readonly [StampId, number, number, number, number, number]> = [
  ['sun', 720, 96, 58, 9.0, 0.0],
  ['flower', 1842, 132, 50, 8.2, 1.3],
  ['coffee', 1790, 948, 54, 9.6, 2.1],
  ['music', 760, 930, 46, 7.8, 0.7],
  ['book', 1330, 60, 44, 8.8, 2.9],
  ['paw', 1180, 1000, 42, 9.2, 1.9],
  ['sprout', 640, 520, 40, 10.0, 3.4],
];

const Layer = ({id, lang, role, at, center = true}: {id: string; lang: Lang; role: Role; at?: number; center?: boolean}) => {
  const t = useTime();
  const c = caption(id);
  const tin = at ?? c.in;
  const o = ramp(t, tin, tin + 0.55, EASE_OUT);
  return (
    <div style={{opacity: o, transform: `translateY(${lerp(12, 0, o)}px)`, display: 'flex', justifyContent: center ? 'center' : 'flex-start'}}>
      <CaptionText role={role} lang={lang} text={c.text[lang]} style={{textAlign: center ? 'center' : 'left'}} />
    </div>
  );
};

export const S10 = ({lang}: {lang: Lang}) => {
  const t = useTime();
  const cardIn = ramp(t, 80.3, 80.85, EASE_OUT);
  return (
    <AbsoluteFill>
      <MediaSlot placement={introPlacement('S10.G5')} lang={lang} tone="paper" illustration={<WaveSketch waveAt={80.6} freezeAt={85.0} />} labelPosition="bottom-left" />
      {FLOAT.map(([id, x, y, size, period, phase]) => {
        const a = ((t - 80) / period + phase) * Math.PI * 2;
        return (
          <Stamp
            key={id}
            id={id}
            size={size}
            style={{
              position: 'absolute',
              left: x + Math.cos(a) * 10,
              top: y + Math.sin(a * 0.8) * 12,
              opacity: 0.55 * ramp(t, 80.2, 81.2, EASE_OUT),
              transform: `rotate(${Math.sin(a) * 6}deg)`,
            }}
          />
        );
      })}
      <div style={{position: 'absolute', left: 820, right: 110, top: 150, opacity: cardIn, transform: `translateY(${lerp(16, 0, cardIn)}px)`}}>
        <Card style={{padding: '54px 60px 50px', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0, background: C.surface}}>
          <Layer id="s10-wordmark" lang={lang} role="end-wordmark" />
          <div style={{height: 26}} />
          <Layer id="s10-main" lang={lang} role="end-main" />
          <div style={{height: 30}} />
          <Layer id="s10-pillars" lang={lang} role="end-small" />
          <div style={{height: 26}} />
          <Layer id="s10-license" lang={lang} role="end-meta" />
          <Layer id="s10-url" lang={lang} role="end-url" />
          <div style={{height: 22}} />
          <Layer id="s10-disclaimer" lang={lang} role="end-disclaimer" />
        </Card>
      </div>
    </AbsoluteFill>
  );
};
