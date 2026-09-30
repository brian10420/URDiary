/**
 * S1 說不出口的話 — 0.0–7.5 s (frames 0–449). STORYBOARD §1.2 S1.
 * G1 full frame, fading up from black (0.0–0.6); a very slow Remotion push 100% → 106%
 * (0.6–5.6); the title card fades in on the lower third at 5.6 and leaves with the 7.2–7.7
 * glow-match dissolve into S2.
 */
import {AbsoluteFill} from 'remotion';
import {caption} from '../data/captions.ts';
import {introPlacement} from '../data/media.ts';
import type {Lang} from '../data/timeline.ts';
import {EASE_IN_OUT, ramp} from '../lib/anim.ts';
import {useTime} from '../lib/time.tsx';
import {Card, CaptionText, useArrival} from '../components/Caption.tsx';
import {MediaSlot} from '../components/MediaSlot.tsx';
import {NightDeskSketch} from './shared.tsx';

const TITLE = caption('s1-title');

const TitleCard = ({lang}: {lang: Lang}) => {
  const a = useArrival(TITLE.in, TITLE.out, 0.6, 0.3);
  if (a.opacity <= 0) return null;
  return (
    <AbsoluteFill style={{alignItems: 'center'}}>
      <div style={{position: 'absolute', top: 646, opacity: a.opacity, transform: a.transform}}>
        <Card ribbon style={{padding: '28px 56px 30px', textAlign: 'center'}}>
          <CaptionText role="title-wordmark" lang={lang} text={TITLE.text[lang]} />
          <CaptionText role="title-sub" lang={lang} text={TITLE.sub?.[lang] ?? ''} style={{marginTop: 10}} />
        </Card>
      </div>
    </AbsoluteFill>
  );
};

export const S1 = ({lang}: {lang: Lang}) => {
  const t = useTime();
  const push = 1 + 0.06 * ramp(t, 0.6, 5.6, EASE_IN_OUT);
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <AbsoluteFill style={{transform: `scale(${push})`}}>
        <MediaSlot placement={introPlacement('S1.G1')} lang={lang} tone="night" illustration={<NightDeskSketch />} labelPosition="top-center" />
      </AbsoluteFill>
      <TitleCard lang={lang} />
    </AbsoluteFill>
  );
};
