/**
 * S7 早安 — 51.0–60.0 s (frames 3060–3599). STORYBOARD §1.2 S7.
 * S7a: G4 full frame (morning light, tea raised). 53.2–54.2 the phone frame slides into the
 * right third (eased, no bounce); S7b 54.2–59.6: U12 on the phone — the morning greeting with the
 * tea-holding mascot — while the camera eases toward the phone. Caption 55.0–59.5. Out
 * 59.6–60.1: the phone enlarges and dissolves into S8's desktop window.
 */
import {AbsoluteFill} from 'remotion';
import {introPlacement} from '../data/media.ts';
import type {Lang} from '../data/timeline.ts';
import {EASE_IN_OUT, lerp, ramp} from '../lib/anim.ts';
import {camAt, camTransform, type CamKey} from '../lib/camera.ts';
import {useTime} from '../lib/time.tsx';
import {PHONE, PHONE_SCREEN_H, PhoneFrame} from '../components/DeviceFrame.tsx';
import {Mascot} from '../components/Mascot.tsx';
import {MediaSlot} from '../components/MediaSlot.tsx';
import {TeaSketch} from './shared.tsx';

const PHONE_W = PHONE.screenW + PHONE.bezel * 2;
const PHONE_H = PHONE_SCREEN_H + PHONE.bezel * 2;
/** Right third of the frame: centred at x = 1600. */
const PHONE_X = 1600 - PHONE_W / 2;
const PHONE_Y = (1080 - PHONE_H) / 2;
const PHONE_CENTER: [number, number] = [1600, 540];

const CAMERA: readonly CamKey[] = [
  {t: 50.6, zoom: 1, target: [960, 540], blend: 0},
  {t: 54.2, zoom: 1, target: PHONE_CENTER, blend: 0},
  {t: 59.6, zoom: 1.08, target: PHONE_CENTER, blend: 0.3}, // 鏡頭慢慢推近手機
  {t: 60.1, zoom: 1.75, target: PHONE_CENTER, blend: 0.9}, // 手機放大，溶進 S8
];

export const S7 = ({lang}: {lang: Lang}) => {
  const t = useTime();
  const slide = ramp(t, 53.2, 54.2, EASE_IN_OUT);
  const x = lerp(1920 + 40, PHONE_X, slide);
  return (
    <AbsoluteFill style={{transform: camTransform(camAt(CAMERA, t)), transformOrigin: '0 0'}}>
      <MediaSlot placement={introPlacement('S7.G4')} lang={lang} tone="morning" illustration={<TeaSketch />} labelPosition="top-right" />
      {slide > 0 ? (
        <PhoneFrame style={{position: 'absolute', left: x, top: PHONE_Y}}>
          <MediaSlot
            placement={introPlacement('S7.U12')}
            lang={lang}
            tone="ui"
            compact
            labelPosition="top-left"
            illustration={<Mascot pose="tea" width={120} style={{position: 'absolute', left: (PHONE.screenW - 120) / 2, top: PHONE_SCREEN_H / 2 - 60}} />}
          />
        </PhoneFrame>
      ) : null}
    </AbsoluteFill>
  );
};
