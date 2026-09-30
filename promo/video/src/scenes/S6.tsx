/**
 * S6 被看見 — 42.5–51.0 s (frames 2550–3059). STORYBOARD §1.2 S6.
 * Opens on the S5 match cut: today's stamp enlarges on a widening cream disc (41.8–42.5), then
 * the sheet splits from the middle into two panels while the stamp halves ride apart
 * (42.5–43.3). Left (warm daylight, 43.0–46.8): G2's small celebration + the U09 stamp card.
 * 46.8: the left dims to 60 %, the right (cool rain) brings G3 — no stars, no jump — and today's
 * quiet stamp card. Out 50.6–51.2: the rain light warms into S7's morning.
 */
import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import {caption} from '../data/captions.ts';
import {introPlacement, targetRect} from '../data/media.ts';
import {RECORDED} from '../data/recorded.ts';
import type {Lang} from '../data/timeline.ts';
import {EASE_IN_OUT, EASE_OUT, lerp, presence, ramp} from '../lib/anim.ts';
import {camAt, camProject} from '../lib/camera.ts';
import {C} from '../lib/theme.ts';
import {useTime} from '../lib/time.tsx';
import {CaptionText} from '../components/Caption.tsx';
import {recToStage, REC_TO_WIN} from '../components/DeviceFrame.tsx';
import {Stamp} from '../components/Mascot.tsx';
import {MediaSlot, clipAspect, mediaFor} from '../components/MediaSlot.tsx';
import {Paper} from '../components/Paper.tsx';
import {s2s5Camera} from './cameras.ts';
import {HappySketch, RainSketch} from './shared.tsx';

type Box = {x: number; y: number; w: number; h: number};
const LEFT: Box = {x: 64, y: 176, w: 880, h: 560};
const RIGHT: Box = {x: 976, y: 176, w: 880, h: 560};
/** Stamp cards under the panels: fixed height, width from the real card's aspect (zh / en cards wrap differently). */
const CARD = {h: 190, overlap: 62} as const;
const SPLIT = [42.5, 43.3] as const;
const DIM = [46.8, 47.3] as const;

const lerpBox = (a: Box, b: Box, k: number): Box => ({x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k)});
const boxStyle = (b: Box): CSSProperties => ({position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h});

const Panel = ({box, radius, tone, paper, children, style}: {box: Box; radius: number; tone: string; paper: number; children?: ReactNode; style?: CSSProperties}) => (
  <div style={{...boxStyle(box), borderRadius: radius, overflow: 'hidden', background: tone, boxShadow: paper < 1 ? C.shadow : undefined, ...style}}>
    {children}
    {paper > 0 ? <AbsoluteFill style={{background: C.paper, opacity: paper}} /> : null}
  </div>
);

const StampCard = ({under, aspect, children, opacity, dim}: {under: Box; aspect: number; children: ReactNode; opacity: number; dim: number}) => (
  <div
    style={{
      position: 'absolute',
      left: under.x + (under.w - CARD.h * aspect) / 2,
      top: under.y + under.h - CARD.overlap,
      width: CARD.h * aspect,
      height: CARD.h,
      borderRadius: 18,
      overflow: 'hidden',
      background: C.surface,
      boxShadow: '0 22px 44px -22px rgba(75, 46, 30, 0.6), 0 0 0 1.5px rgba(75, 46, 30, 0.14)',
      opacity,
      filter: dim > 0 ? `brightness(${1 - 0.4 * dim})` : undefined,
    }}
  >
    {children}
  </div>
);

const Label = ({id, lang, under, dimTo = 1}: {id: string; lang: Lang; under: Box; dimTo?: number}) => {
  const t = useTime();
  const c = caption(id);
  const o = presence(t, c.in, c.out, 0.4, 0.3) * dimTo;
  if (o <= 0) return null;
  return (
    <div style={{position: 'absolute', left: under.x, width: under.w, top: under.y + under.h - CARD.overlap + CARD.h + 14, display: 'flex', justifyContent: 'center', opacity: o}}>
      <CaptionText role="panel-label" lang={lang} text={c.text[lang]} style={{textAlign: 'center'}} />
    </div>
  );
};

export const S6 = ({lang}: {lang: Lang}) => {
  const t = useTime();
  const k = ramp(t, SPLIT[0], SPLIT[1], EASE_IN_OUT);
  const left = lerpBox({x: 0, y: 0, w: 960, h: 1080}, LEFT, k);
  const right = lerpBox({x: 960, y: 0, w: 960, h: 1080}, RIGHT, k);
  const radius = lerp(0, 28, k);
  const dim = ramp(t, DIM[0], DIM[1], EASE_IN_OUT);
  const leftIn = ramp(t, 43.0, 43.45, EASE_OUT);
  const rightIn = ramp(t, 46.8, 47.3, EASE_OUT);
  const warm = ramp(t, 50.6, 51.2, EASE_IN_OUT);
  const u10 = mediaFor(introPlacement('S6.U10'), lang).entry;
  return (
    <AbsoluteFill>
      <Paper />
      <Panel box={left} radius={radius} tone="linear-gradient(180deg, #fff7e6, #fdeacb)" paper={1 - k}>
        <AbsoluteFill style={{opacity: leftIn, filter: dim > 0 ? `brightness(${1 - 0.4 * dim})` : undefined}}>
          <MediaSlot placement={introPlacement('S6.G2')} lang={lang} tone="day" illustration={<HappySketch size={300} />} labelPosition="top-left" />
          {u10 ? (
            <div style={{position: 'absolute', left: 24, bottom: 90, width: 300, height: 169, borderRadius: 14, overflow: 'hidden', boxShadow: C.shadow}}>
              <MediaSlot placement={introPlacement('S6.U10')} lang={lang} tone="ui" compact crop={{rect: targetRect('u10Egg', lang), box: {w: 300, h: 169}}} />
            </div>
          ) : null}
        </AbsoluteFill>
      </Panel>
      <Panel box={right} radius={radius} tone="linear-gradient(180deg, #56688a, #7288b4)" paper={1 - k}>
        <AbsoluteFill style={{opacity: rightIn}}>
          <MediaSlot placement={introPlacement('S6.G3')} lang={lang} tone="rain" illustration={<RainSketch size={300} />} labelPosition="top-left" />
        </AbsoluteFill>
        <AbsoluteFill
          style={{
            opacity: warm * 0.75,
            background: 'radial-gradient(circle at 30% 40%, rgba(255, 226, 170, 0.95), rgba(255, 214, 150, 0.55) 60%, rgba(255, 214, 150, 0.3))',
          }}
        />
      </Panel>
      {/* both cards are whole clips (U09 / U07 day-panel card, cropped at native 2× — shots.ts), so no crop here */}
      <StampCard under={LEFT} aspect={clipAspect(introPlacement('S6.U09'), lang, 2.5)} opacity={ramp(t, 43.4, 43.9, EASE_OUT)} dim={dim}>
        <MediaSlot
          placement={introPlacement('S6.U09')}
          lang={lang}
          tone="paper"
          compact
          illustration={<Stamp id={RECORDED.goodDayStamp[lang]} size={64} style={{position: 'absolute', right: 24, top: 24}} />}
          labelPosition="top-left"
        />
      </StampCard>
      <StampCard under={RIGHT} aspect={clipAspect(introPlacement('S6.card'), lang, 2.5)} opacity={ramp(t, 47.2, 47.7, EASE_OUT)} dim={0}>
        <MediaSlot
          placement={introPlacement('S6.card')}
          lang={lang}
          tone="paper"
          compact
          illustration={<Stamp id={RECORDED.s5Stamp[lang]} size={64} style={{position: 'absolute', right: 24, top: 24}} />}
          labelPosition="top-left"
        />
      </StampCard>
      <Label id="s6-left-stamp" lang={lang} under={LEFT} dimTo={1 - 0.4 * dim} />
      <Label id="s6-right-stamp" lang={lang} under={RIGHT} />
    </AbsoluteFill>
  );
};

/**
 * The S5 → S6 配對剪接, drawn over both scenes (41.8–43.3): today's stamp lifts off the day
 * panel's card where the S5 camera shows it (the 40 px stamp — U07 has the panel open), grows to
 * the centre on a cream disc that fills the frame by the 42.5 cut, then its halves ride out with
 * the splitting sheet and fade. The stamp is the one this language's take got (recorded.ts).
 */
export const StampMatchCut = ({lang}: {lang: Lang}) => {
  const t = useTime();
  if (t < 41.8 || t >= SPLIT[1]) return null;
  const [x, y, w, h] = targetRect('s5PanelStamp', lang);
  const cam = camAt(s2s5Camera(lang), 41.8);
  const [sx, sy] = camProject(cam, recToStage(x + w * 0.5, y + h * 0.5));
  const size0 = Math.max(w, h) * REC_TO_WIN * cam.zoom;
  const grow = ramp(t, 41.8, 42.5, EASE_IN_OUT);
  const cx = lerp(sx, 960, grow);
  const cy = lerp(sy, 500, grow);
  const size = lerp(size0, 400, grow);
  const disc = lerp(0, 1250, ramp(t, 42.05, 42.5, EASE_IN_OUT));
  const split = ramp(t, SPLIT[0], SPLIT[1], EASE_IN_OUT);
  const fade = 1 - ramp(t, SPLIT[0] + 0.25, SPLIT[1], EASE_IN_OUT);
  const half = (side: 'l' | 'r') => {
    const dx = (side === 'l' ? -1 : 1) * lerp(0, 456, split);
    const dy = lerp(0, -40, split);
    const s = lerp(1, 0.45, split);
    return (
      <div
        style={{
          position: 'absolute',
          left: cx - size / 2,
          top: cy - size / 2,
          width: size,
          height: size,
          opacity: fade,
          clipPath: t >= SPLIT[0] ? (side === 'l' ? 'inset(0 50% 0 0)' : 'inset(0 0 0 50%)') : undefined,
          transform: `translate(${dx}px, ${dy}px) scale(${s})`,
        }}
      >
        <Stamp id={RECORDED.s5Stamp[lang]} size={size} />
      </div>
    );
  };
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {t < SPLIT[0] && disc > 0 ? (
        <div style={{position: 'absolute', left: cx - disc, top: cy - disc, width: disc * 2, height: disc * 2, borderRadius: '50%', background: C.paper}} />
      ) : null}
      {half('l')}
      {t >= SPLIT[0] ? half('r') : null}
    </AbsoluteFill>
  );
};
