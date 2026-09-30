/**
 * IntroLong sound: narration lines at their in-points, the music bed with the §5 envelope
 * (fade in, −9 dB look-ahead ducking under every line, last 0.5 s fade), and the §5.1 sound
 * effects. Each plays only if its file is in public/media/ — until then that part is silent.
 */
import {Html5Audio, staticFile, useVideoConfig} from 'remotion';
import {MEDIA_MANIFEST} from '../generated/media-manifest.ts';
import {AMBIENCE_FADE_SEC, SFX, musicGain} from '../data/audio.ts';
import {MUSIC_BED_ID, narrationMediaId, sfxMediaId} from '../data/media.ts';
import {NARRATION} from '../data/narration.ts';
import {INTRO, type Lang} from '../data/timeline.ts';
import {At} from '../lib/time.tsx';
import {narrationSec} from './Subtitle.tsx';

/** [start, end] of every narration line of `lang` that actually has a file — the music ducks under these only. */
export const narrationWindows = (lang: Lang): Array<readonly [number, number]> =>
  NARRATION.flatMap((l) => {
    const {sec, fromFile} = narrationSec(l, lang);
    return fromFile ? [[l.in[lang], l.in[lang] + sec] as const] : [];
  });

export const IntroAudio = ({lang}: {lang: Lang}) => {
  const {fps} = useVideoConfig();
  const windows = narrationWindows(lang);
  const bed = MEDIA_MANIFEST[MUSIC_BED_ID];
  return (
    <>
      {NARRATION.map((l) => {
        const m = MEDIA_MANIFEST[narrationMediaId(l.id, lang)];
        if (!m?.durationSec) return null;
        return (
          <At key={l.id} from={l.in[lang]} to={Math.min(INTRO.durationSec, l.in[lang] + m.durationSec + 0.1)} name={`narration ${l.id}`} layout="none">
            <Html5Audio src={staticFile(m.file)} />
          </At>
        );
      })}
      {bed ? (
        <At from={0} to={INTRO.durationSec} name="music bed" layout="none">
          <Html5Audio src={staticFile(bed.file)} volume={(f) => musicGain(f / fps, windows)} />
        </At>
      ) : null}
      {SFX.map((c) => {
        const m = MEDIA_MANIFEST[sfxMediaId(c.id)];
        if (!m?.durationSec) return null;
        const end = Math.min(INTRO.durationSec, c.end ?? c.start + m.durationSec);
        const ambience = c.end !== undefined;
        return (
          <At key={c.id} from={c.start} to={end} name={`sfx ${c.id}`} layout="none">
            <Html5Audio
              src={staticFile(m.file)}
              loop={ambience && m.durationSec < end - c.start}
              volume={(f) => {
                if (!ambience) return 1;
                const s = f / fps;
                const len = end - c.start;
                return Math.max(0, Math.min(1, s / AMBIENCE_FADE_SEC, (len - s) / AMBIENCE_FADE_SEC));
              }}
            />
          </At>
        );
      })}
    </>
  );
};
