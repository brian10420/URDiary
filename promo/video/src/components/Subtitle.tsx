/**
 * Burned-in narration subtitles (§0): same language as the narration, bottom centre, at most two
 * lines, on a cream plate so they read over the night desk, the app and the paper alike.
 * Timing: from the in-point for the length of the TTS file once it exists (public/media/
 * narration/<lang>/<id>.mp3), until then the storyboard's 「最晚」 budget. Long sentences change
 * subtitle at the point the §0 rhythm model says the next part is spoken.
 */
import {AbsoluteFill} from 'remotion';
import {MEDIA_MANIFEST} from '../generated/media-manifest.ts';
import {narrationMediaId} from '../data/media.ts';
import {NARRATION, type NarrationLine, subtitleEvents} from '../data/narration.ts';
import type {Lang} from '../data/timeline.ts';
import {presence} from '../lib/anim.ts';
import {useTime} from '../lib/time.tsx';
import {CaptionText} from './Caption.tsx';

/** How long the voice of `line` lasts: the file's length if present, else the storyboard budget. */
export const narrationSec = (line: NarrationLine, lang: Lang): {sec: number; fromFile: boolean} => {
  const m = MEDIA_MANIFEST[narrationMediaId(line.id, lang)];
  if (m?.durationSec) return {sec: m.durationSec, fromFile: true};
  return {sec: line.latestEnd[lang] - line.in[lang], fromFile: false};
};

/** Subtitles stay up a moment after the voice stops (never into the next line). */
const HOLD_SEC = 0.25;

export const subtitleSchedule = (lang: Lang) =>
  NARRATION.filter((l) => l.burnIn).flatMap((line, i, all) => {
    const {sec} = narrationSec(line, lang);
    const next = all[i + 1];
    const events = subtitleEvents(line, lang, sec);
    const last = events[events.length - 1];
    const cap = next && next.scene === line.scene ? next.in[lang] - 0.05 : Infinity;
    last.end = Math.min(last.end + HOLD_SEC, cap);
    return events.map((e, k) => ({...e, key: `${line.id}.${k}`}));
  });

export const SubtitlePlate = ({lines, lang, audit}: {lines: string[]; lang: Lang; audit?: string}) => (
  <div
    style={{
      display: 'inline-flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: lang === 'zh' ? '10px 30px 12px' : '12px 32px 13px',
      borderRadius: 18,
      background: 'rgba(255, 253, 248, 0.94)',
      boxShadow: '0 10px 28px -16px rgba(43, 26, 16, 0.55), 0 0 0 1px rgba(75, 46, 30, 0.08)',
    }}
  >
    {lines.map((l, i) => (
      <CaptionText key={i} role="subtitle" lang={lang} text={l} wrap={false} auditId={audit ? `${audit}:${i}` : undefined} style={{textAlign: 'center'}} />
    ))}
  </div>
);

export const SubtitleTrack = ({lang}: {lang: Lang}) => {
  const t = useTime();
  const live = subtitleSchedule(lang).filter((e) => t >= e.start && t < e.end);
  return (
    <AbsoluteFill style={{alignItems: 'center', pointerEvents: 'none'}}>
      {live.map((e) => (
        <div key={e.key} style={{position: 'absolute', bottom: 60, opacity: presence(t, e.start, e.end, 0.14, 0.14)}}>
          <SubtitlePlate lines={e.lines} lang={lang} />
        </div>
      ))}
    </AbsoluteFill>
  );
};

