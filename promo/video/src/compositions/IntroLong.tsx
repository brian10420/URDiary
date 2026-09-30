/**
 * IntroLong — 1920×1080, 60 fps, 5310 frames (88.5 s); props {lang: 'zh' | 'en'}. Both languages
 * share one timeline and one layout (§0); only narration, subtitles, captions and UI recordings
 * change. Scene layers and their dissolves are derived from timeline.ts (SCENES + TRANSITIONS).
 */
import {AbsoluteFill} from 'remotion';
import {TRANSITIONS, sceneById, type Lang, type SceneId} from '../data/timeline.ts';
import {IntroAudio} from '../components/AudioTracks.tsx';
import {CaptionTrack} from '../components/Caption.tsx';
import {IntroDraftOverlay} from '../components/DraftOverlay.tsx';
import {SubtitleTrack} from '../components/Subtitle.tsx';
import {FadeFromBlack, GlowMatch} from '../components/Transition.tsx';
import {WIN_CENTER, s2s5Camera} from '../scenes/cameras.ts';
import {G1_PHONE_POINT, Layer} from '../scenes/shared.tsx';
import {WindowSet} from '../scenes/WindowSet.tsx';
import {S1} from '../scenes/S1.tsx';
import {S2} from '../scenes/S2.tsx';
import {S3} from '../scenes/S3.tsx';
import {S4} from '../scenes/S4.tsx';
import {S5} from '../scenes/S5.tsx';
import {S6, StampMatchCut} from '../scenes/S6.tsx';
import {S7} from '../scenes/S7.tsx';
import {S8} from '../scenes/S8.tsx';
import {S9} from '../scenes/S9.tsx';
import {S10} from '../scenes/S10.tsx';

export type IntroProps = {lang: Lang; draft?: boolean};

const soft = (k: string) => k === 'dissolve' || k === 'matchDissolve';

/** A scene's layer: from its dissolve-in (or its own start), to the end of its way out. */
const span = (id: SceneId) => {
  const s = sceneById(id);
  const tin = TRANSITIONS.find((t) => t.to === id && t.from !== null);
  const tout = TRANSITIONS.find((t) => t.from === id && t.to !== null);
  return {
    from: tin && soft(tin.kind) ? tin.start : s.start,
    to: tout ? Math.max(s.end, tout.end) : s.end,
    fadeIn: tin && soft(tin.kind) ? ([tin.start, tin.end] as const) : undefined,
  };
};

const transition = (kind: string) => {
  const t = TRANSITIONS.find((x) => x.kind === kind);
  if (!t) throw new Error(`no ${kind} transition`);
  return t;
};

export const IntroLong = ({lang, draft = false}: IntroProps) => {
  const [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10] = (['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10'] as const).map(span);
  const fromBlack = transition('fadeFromBlack');
  const glow = transition('matchDissolve');
  const floatIn = [sceneById('S2').start, sceneById('S2').start + 0.8] as const; // 7.5–8.3 視窗浮出
  return (
    <AbsoluteFill style={{backgroundColor: '#000'}}>
      <Layer {...s1} name="S1 說不出口的話">
        <S1 lang={lang} />
      </Layer>
      <Layer from={s2.from} to={s5.to} fadeIn={s2.fadeIn} name="S2–S5 one app window">
        <WindowSet camera={s2s5Camera(lang)} floatIn={floatIn}>
          <Layer {...s2} fadeIn={undefined} name="S2 初次見面，取個名字">
            <S2 lang={lang} />
          </Layer>
          <Layer {...s3} name="S3 被聽見">
            <S3 lang={lang} />
          </Layer>
          <Layer {...s4} name="S4 被記得">
            <S4 lang={lang} />
          </Layer>
          <Layer {...s5} name="S5 一段對話，一篇日記">
            <S5 lang={lang} />
          </Layer>
        </WindowSet>
      </Layer>
      <Layer {...s6} name="S6 被看見">
        <S6 lang={lang} />
      </Layer>
      <Layer {...s7} name="S7 早安">
        <S7 lang={lang} />
      </Layer>
      <Layer {...s8} name="S8 你的記憶，你作主">
        <S8 lang={lang} />
      </Layer>
      <Layer {...s9} name="S9 存在你的電腦，AI 由你選">
        <S9 lang={lang} />
      </Layer>
      <Layer {...s10} name="S10 療癒自己的事">
        <S10 lang={lang} />
      </Layer>
      <StampMatchCut lang={lang} />
      <GlowMatch from={glow.start} to={glow.end} fromPt={G1_PHONE_POINT} toPt={WIN_CENTER} />
      <FadeFromBlack from={fromBlack.start} to={fromBlack.end} />
      <CaptionTrack lang={lang} />
      <SubtitleTrack lang={lang} />
      <IntroAudio lang={lang} />
      {draft ? <IntroDraftOverlay /> : null}
    </AbsoluteFill>
  );
};

