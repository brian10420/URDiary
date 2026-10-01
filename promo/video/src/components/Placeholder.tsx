/**
 * Stand-in for a shot whose file is not in public/media/ yet: a labelled card in the shot's
 * light (night desk, rainy window, morning…) carrying the shot id, what the storyboard wants in
 * it, the file it expects and the running source time — so a draft shows the whole timeline
 * (which shot, which part of it, how long) before any real media exist.
 */
import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import {shotText, type ShotSpec} from '../data/media.ts';
import type {Lang} from '../data/timeline.ts';
import {uiText} from '../data/ui-strings.ts';
import {C, FONT} from '../lib/theme.ts';

export type Tone = 'night' | 'day' | 'rain' | 'morning' | 'paper' | 'ui' | 'flat';

const TONES: Record<Tone, {bg: string; ink: string; dash: string; label: string}> = {
  night: {
    bg: 'radial-gradient(circle at 22% 20%, rgba(255, 196, 120, 0.34), rgba(255, 196, 120, 0) 38%), linear-gradient(160deg, #1f2640 0%, #2b2944 55%, #37293a 100%)',
    ink: '#f7ecd9', dash: 'rgba(247, 236, 217, 0.28)', label: 'rgba(28, 21, 17, 0.62)',
  },
  day: {
    bg: 'radial-gradient(circle at 80% 18%, rgba(255, 240, 200, 0.9), rgba(255, 240, 200, 0) 42%), linear-gradient(180deg, #fff7e6 0%, #fdeacb 100%)',
    ink: C.text, dash: 'rgba(75, 46, 30, 0.22)', label: 'rgba(255, 253, 248, 0.8)',
  },
  rain: {
    bg: 'radial-gradient(circle at 30% 70%, rgba(255, 214, 160, 0.22), rgba(255, 214, 160, 0) 36%), linear-gradient(180deg, #56688a 0%, #7288b4 100%)',
    ink: '#f3f1ee', dash: 'rgba(243, 241, 238, 0.3)', label: 'rgba(28, 30, 44, 0.5)',
  },
  morning: {
    bg: 'radial-gradient(circle at 12% 30%, rgba(255, 250, 235, 0.95), rgba(255, 250, 235, 0) 45%), linear-gradient(115deg, #fff3d8 0%, #fbdfae 62%, #f4cf92 100%)',
    ink: C.text, dash: 'rgba(75, 46, 30, 0.22)', label: 'rgba(255, 253, 248, 0.8)',
  },
  paper: {bg: C.paper, ink: C.text, dash: 'rgba(75, 46, 30, 0.2)', label: 'rgba(255, 253, 248, 0.85)'},
  ui: {bg: C.uiGrey, ink: C.text, dash: 'rgba(75, 46, 30, 0.22)', label: 'rgba(255, 253, 248, 0.92)'},
  // GIF-safe: one flat colour, no gradient (§2 「大面積用平塗底色」)
  flat: {bg: C.paper, ink: C.text, dash: 'rgba(75, 46, 30, 0.22)', label: C.surface},
};

export type LabelPosition = 'center' | 'top-center' | 'top-left' | 'top-right' | 'bottom-left';

export interface PlaceholderProps {
  shot: ShotSpec;
  mediaId: string;
  lang?: Lang;
  tone: Tone;
  /** Seconds into the (future) source file that this frame would show. */
  srcSec?: number;
  /** Extra state line, e.g. 「定格」 or the loop phase. */
  status?: string;
  illustration?: ReactNode;
  /** Annotation targets drawn as dashed boxes, in this box's px. */
  targets?: Array<{label: string; x: number; y: number; w: number; h: number}>;
  /** Small slots (stamp cards, insets, the phone): a one-line label. */
  compact?: boolean;
  labelPosition?: LabelPosition;
  style?: CSSProperties;
}

const anchor = (p: LabelPosition, compact: boolean): CSSProperties => {
  const m = compact ? 12 : 40;
  switch (p) {
    case 'center':
      return {left: '50%', top: '50%', transform: 'translate(-50%, -50%)', alignItems: 'center', textAlign: 'center'};
    case 'top-center':
      return {left: '50%', top: m + 30, transform: 'translateX(-50%)', alignItems: 'center', textAlign: 'center'};
    case 'top-right':
      return {right: m, top: m, alignItems: 'flex-end', textAlign: 'right'};
    case 'bottom-left':
      return {left: m, bottom: m};
    default:
      return {left: m, top: m};
  }
};

export const Placeholder = ({shot, mediaId, lang, tone, srcSec, status, illustration, targets, compact = false, labelPosition = 'center', style}: PlaceholderProps) => {
  const t = TONES[tone];
  const UI = uiText(lang);
  const text = shotText(shot, lang);
  const kindWord = shot.kind === 'comfy' ? UI.comfyShot : `${UI.uiShot}${lang && shot.perLang ? (lang === 'en' ? ` (${lang})` : `（${lang}）`) : ''}`;
  const ext = shot.kind === 'ui' && shot.stillOk ? 'png|mp4' : 'mp4';
  const meta = [`${UI.missing} · public/media/${mediaId}.${ext}`, srcSec !== undefined ? `${UI.source} ${srcSec.toFixed(2)} s` : '', status ?? '']
    .filter(Boolean)
    .join(' · ');
  return (
    <AbsoluteFill style={{background: t.bg, overflow: 'hidden', ...style}}>
      {illustration}
      <div style={{position: 'absolute', inset: compact ? 6 : 14, border: `${compact ? 2 : 3}px dashed ${t.dash}`, borderRadius: compact ? 12 : 22}} />
      {targets?.map((b) => (
        <div
          key={b.label}
          style={{
            position: 'absolute',
            left: b.x,
            top: b.y,
            width: b.w,
            height: b.h,
            border: `2.5px dashed ${C.bookmarkInk}`,
            borderRadius: 10,
            background: 'rgba(95, 208, 160, 0.10)',
          }}
        >
          <span
            style={{
              position: 'absolute',
              left: -2,
              top: -30,
              padding: '2px 10px',
              borderRadius: 8,
              background: C.bookmarkInk,
              color: '#fff',
              fontFamily: FONT.zh,
              fontSize: 17,
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            {b.label}・{UI.provisional}
          </span>
        </div>
      ))}
      <div
        style={{
          position: 'absolute',
          display: 'flex',
          flexDirection: 'column',
          gap: compact ? 2 : 4,
          maxWidth: compact ? '94%' : 860,
          padding: compact ? '6px 12px 7px' : '18px 28px 20px',
          borderRadius: compact ? 10 : 20,
          background: t.label,
          color: t.ink,
          fontFamily: FONT.zh,
          ...anchor(labelPosition, compact),
        }}
      >
        {compact ? (
          <div style={{display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'inherit'}}>
            <span style={{fontFamily: FONT.sans, fontWeight: 800, fontSize: 20, padding: '0 8px', borderRadius: 999, background: shot.kind === 'comfy' ? C.gold : C.bookmark, color: C.textStrong}}>
              {shot.id}
            </span>
            <span style={{fontSize: 18, fontWeight: 700}}>{text.label}</span>
          </div>
        ) : (
          <>
            <div style={{display: 'flex', gap: 18, alignItems: 'center'}}>
              <span style={{fontFamily: FONT.sans, fontWeight: 800, fontSize: 64, lineHeight: 1, letterSpacing: '0.01em'}}>{shot.id}</span>
              <span style={{display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left'}}>
                <span style={{fontSize: 20, fontWeight: 700, padding: '1px 10px', borderRadius: 999, background: shot.kind === 'comfy' ? C.gold : C.bookmark, color: C.textStrong}}>{kindWord}</span>
                <span style={{fontSize: 36, fontWeight: 700, lineHeight: 1.3}}>{text.label}</span>
              </span>
            </div>
            <div style={{fontSize: 22, fontWeight: 500, opacity: 0.9, lineHeight: 1.45, marginTop: 4}}>{text.brief}</div>
          </>
        )}
        <div style={{fontFamily: FONT.sans, fontSize: compact ? 14 : 19, fontWeight: 600, opacity: 0.82, fontVariantNumeric: 'tabular-nums'}}>{compact ? meta.replace(/^.*?· /, '') : meta}</div>
      </div>
    </AbsoluteFill>
  );
};
