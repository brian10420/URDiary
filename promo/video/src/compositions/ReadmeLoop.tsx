/**
 * ReadmeLoop — 1280×720, 30 fps, 600 frames (20.0 s), silent. STORYBOARD §2.
 * Three sheets on flat cream: the hero (G6 sway loop + the wordmark card), the UI sheet
 * (chat → memory → diary & stamp, cut between), and the hero again — each new sheet slides in
 * over the last (3.5–4.0, 16.5–17.0). The hero's G6 phase follows loop.ts (t on the way in,
 * (t − 20) mod 5.125 on the way out), so t = 20.000 renders exactly like t = 0. GIF-minded:
 * flat colours, no slow full-frame fades, at most two things moving at once.
 */
import type {ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import {MOTION} from '../generated/mascot.ts';
import {TARGETS, loopPlacement, type TargetId} from '../data/media.ts';
import {HERO_CARD, HERO_CARD_FADE, HERO_PERIOD_SEC, LOOP_SEGMENTS, LOOP_UI_LANG, SWAYS_PER_PERIOD, g6SourceTime, heroPhase} from '../data/loop.ts';
import {UI} from '../data/ui-strings.ts';
import {EASE_IN_OUT, keyframesAt, ramp, rotationOf} from '../lib/anim.ts';
import {C} from '../lib/theme.ts';
import {useTime} from '../lib/time.tsx';
import {CircleMark, Highlighter} from '../components/Annotations.tsx';
import {CaptionText} from '../components/Caption.tsx';
import {LoopDraftOverlay} from '../components/DraftOverlay.tsx';
import {Mascot} from '../components/Mascot.tsx';
import {MediaSlot, MediaSlotBody} from '../components/MediaSlot.tsx';
import {PaperSlide} from '../components/Transition.tsx';
import {scaleYOf} from '../scenes/shared.tsx';

export type LoopProps = {draft?: boolean};

const HERO_BOX = {x: 440, y: 20, w: 400, h: 400} as const;
const PANEL = {x: 60, y: 34, w: 1160, h: 450} as const;

/** G6 stand-in: the app's mascot swaying ±5° about 50% 88%, three times per period, one blink mid-loop. */
const SwayStandIn = ({phase}: {phase: number}) => {
  const sway = rotationOf(keyframesAt(MOTION.sway, phase, {durationSec: HERO_PERIOD_SEC / SWAYS_PER_PERIOD}).transform);
  const blinkAt = HERO_PERIOD_SEC / 2 - MOTION.blink.durationSec / 2;
  const eyes = phase >= blinkAt && phase < blinkAt + MOTION.blink.durationSec ? scaleYOf(keyframesAt(MOTION.blink, phase - blinkAt, {iterations: 1}).transform) : 1;
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
      <Mascot pose="smile" width={250} rig={{swayDeg: sway, eyesScaleY: eyes}} style={{marginTop: 30}} />
    </AbsoluteFill>
  );
};

const LoopCard = ({en, zh, wordmark, opacity = 1}: {en: string; zh: string; wordmark?: string; opacity?: number}) => (
  <div style={{position: 'absolute', left: 0, right: 0, bottom: wordmark ? 26 : 30, display: 'flex', justifyContent: 'center', opacity}}>
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: wordmark ? 8 : 6,
        padding: wordmark ? '18px 48px 20px' : '18px 44px 20px',
        borderRadius: 20,
        background: C.surface,
        border: `2px solid ${C.line}`,
      }}
    >
      {wordmark ? <CaptionText role="loop-wordmark" lang="en" text={wordmark} /> : null}
      <CaptionText role="loop-en" lang="en" text={en} style={{textAlign: 'center'}} />
      <CaptionText role="loop-zh" lang="zh" text={zh} style={{textAlign: 'center'}} />
    </div>
  </div>
);

const HeroSheet = ({phase, cardOpacity}: {phase: number; cardOpacity: number}) => (
  <AbsoluteFill style={{background: C.paper}}>
    <div style={{position: 'absolute', left: HERO_BOX.x, top: HERO_BOX.y, width: HERO_BOX.w, height: HERO_BOX.h}}>
      {/* phase-driven, so no time window: t = 20.000 must draw exactly what t = 0 draws */}
      <MediaSlotBody
        placement={loopPlacement('L.G6')}
        lang={LOOP_UI_LANG}
        tone="flat"
        sourceTime={g6SourceTime(phase)}
        illustration={<SwayStandIn phase={phase} />}
        compact
        labelPosition="top-left"
        status={`${UI.phase} ${phase.toFixed(3)} / ${HERO_PERIOD_SEC.toFixed(3)} s`}
      />
    </div>
    <LoopCard en={HERO_CARD.en} zh={HERO_CARD.zh} wordmark={HERO_CARD.wordmark} opacity={cardOpacity} />
  </AbsoluteFill>
);

/** A target rect (recording CSS px) inside the panel, through the panel's crop of that recording. */
const inPanel = (crop: TargetId, id: TargetId): [number, number, number, number] => {
  const [cx, cy, cw] = TARGETS[crop].rect;
  const k = PANEL.w / cw;
  const [x, y, w, h] = TARGETS[id].rect;
  return [(x - cx) * k, (y - cy) * k, w * k, h * k];
};

const Panel = ({children}: {children: ReactNode}) => (
  <div style={{position: 'absolute', left: PANEL.x, top: PANEL.y, width: PANEL.w, height: PANEL.h, borderRadius: 18, overflow: 'hidden', background: C.uiGrey, border: `2px solid ${C.line}`}}>
    {children}
  </div>
);

const segment = (id: string) => {
  const s = LOOP_SEGMENTS.find((x) => x.id === id);
  if (!s?.card) throw new Error(`loop segment ${id} has no card`);
  return s;
};

const UiSheet = () => {
  const t = useTime();
  const chat = segment('chat');
  const memory = segment('memory');
  const stamp = segment('stamp');
  const crop = (id: TargetId) => ({rect: TARGETS[id].rect, box: {w: PANEL.w, h: PANEL.h}});
  const card = t < memory.start ? chat.card : t < stamp.start ? memory.card : stamp.card;
  return (
    <AbsoluteFill style={{background: C.paper}}>
      <Panel>
        <MediaSlot placement={loopPlacement('L.U03')} lang={LOOP_UI_LANG} tone="ui" crop={crop('loopChat')} labelPosition="center" />
        <MediaSlot placement={loopPlacement('L.U04')} lang={LOOP_UI_LANG} tone="ui" crop={crop('loopMemory')} labelPosition="center" />
        <MediaSlot placement={loopPlacement('L.U06')} lang={LOOP_UI_LANG} tone="ui" crop={crop('loopDiary')} labelPosition="center" />
        <MediaSlot placement={loopPlacement('L.U08')} lang={LOOP_UI_LANG} tone="ui" crop={crop('loopMonth')} labelPosition="center" />
        {t >= memory.start && t < memory.end ? <Highlighter rect={inPanel('loopMemory', 'loopQuote')} from={8.6} sweepSec={0.9} until={memory.end + 0.4} /> : null}
        {t >= 13.5 && t < 17.0
          ? (['loopStampA', 'loopStampB', 'loopStampC'] as const).map((id, i) => (
              <CircleMark key={id} rect={inPanel('loopMonth', id)} from={14.0 + i * 0.7} drawSec={0.45} until={17.2} stroke={4} />
            ))
          : null}
      </Panel>
      {card ? <LoopCard en={card.en} zh={card.zh} /> : null}
    </AbsoluteFill>
  );
};

export const ReadmeLoop = ({draft = false}: LoopProps) => {
  const t = useTime();
  const phase = heroPhase(t);
  const slide1 = LOOP_SEGMENTS.find((s) => s.id === 'slide-1');
  const slide2 = LOOP_SEGMENTS.find((s) => s.id === 'slide-2');
  if (!slide1 || !slide2) throw new Error('loop slides missing');
  return (
    <AbsoluteFill style={{background: C.paper}}>
      {t < slide1.end ? <HeroSheet phase={phase} cardOpacity={1} /> : null}
      {t >= slide1.start && t < slide2.end ? (
        <PaperSlide from={slide1.start} to={slide1.end}>
          <UiSheet />
        </PaperSlide>
      ) : null}
      {t >= slide2.start ? (
        <PaperSlide from={slide2.start} to={slide2.end}>
          <HeroSheet phase={phase} cardOpacity={ramp(t, HERO_CARD_FADE.start, HERO_CARD_FADE.end, EASE_IN_OUT)} />
        </PaperSlide>
      ) : null}
      {draft ? <LoopDraftOverlay phase={phase} /> : null}
    </AbsoluteFill>
  );
};
