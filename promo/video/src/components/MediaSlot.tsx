/**
 * One placement of a shot (src/data/media.ts): plays public/media/<id>.<ext> over the
 * placement's time with its source in-point / speed — or, while the file does not exist, the
 * labelled <Placeholder>. Presence is decided at bundle time from src/generated/media-manifest.ts
 * (scripts/media-manifest.mjs), so a missing file never becomes a failed network request.
 */
import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill, Freeze, Img, OffthreadVideo, staticFile, useVideoConfig} from 'remotion';
import {MEDIA_MANIFEST, type MediaEntry} from '../generated/media-manifest.ts';
import {RECORDING_SIZE, SHOTS, type Placement, type ShotSpec, shotMediaId} from '../data/media.ts';
import type {Lang} from '../data/timeline.ts';
import {UI} from '../data/ui-strings.ts';
import {At, useTime} from '../lib/time.tsx';
import {Placeholder, type LabelPosition, type PlaceholderProps, type Tone} from './Placeholder.tsx';

export const mediaFor = (p: Placement, lang: Lang): {entry: MediaEntry | undefined; shot: ShotSpec; id: string} => {
  for (const shotId of p.fallback ? [p.shot, p.fallback] : [p.shot]) {
    const id = shotMediaId(shotId, lang);
    if (MEDIA_MANIFEST[id]) return {entry: MEDIA_MANIFEST[id], shot: SHOTS[shotId], id};
  }
  return {entry: undefined, shot: SHOTS[p.shot], id: shotMediaId(p.shot, lang)};
};

export interface MediaSlotProps {
  placement: Placement;
  lang: Lang;
  tone: Tone;
  fit?: 'cover' | 'contain';
  /** Show only this region of the recording (recording CSS px), scaled so its width fills `box.w`. */
  crop?: {rect: readonly [number, number, number, number]; box: {w: number; h: number}};
  /** Exact source second to show instead of linear playback (ReadmeLoop's G6 phase). */
  sourceTime?: number;
  illustration?: ReactNode;
  targets?: PlaceholderProps['targets'];
  compact?: boolean;
  labelPosition?: LabelPosition;
  status?: string;
  style?: CSSProperties;
}

const mediaStyle = (entry: MediaEntry, fit: 'cover' | 'contain', crop: MediaSlotProps['crop']): CSSProperties => {
  if (!crop) return {width: '100%', height: '100%', objectFit: fit};
  const [x, y, w] = crop.rect;
  const k = crop.box.w / w;
  const rec = RECORDING_SIZE[(entry.width ?? 1) < (entry.height ?? 0) ? 'phone' : 'desktop'];
  return {position: 'absolute', left: -x * k, top: -y * k, width: rec.w * k, height: rec.h * k, maxWidth: 'none'};
};

const SlotBody = (props: MediaSlotProps) => {
  const {placement: p, lang, fit = 'cover', crop, sourceTime} = props;
  const {fps} = useVideoConfig();
  const t = useTime();
  const {entry, shot, id} = mediaFor(p, lang);
  const at0 = p.at[0];
  const frozen = p.freezeFrom !== undefined && t >= p.freezeFrom;
  const srcSec = sourceTime ?? p.srcIn + (Math.min(t, p.freezeFrom ?? Infinity) - at0) * p.rate;

  if (!entry) {
    return (
      <Placeholder
        shot={shot}
        mediaId={id}
        lang={lang}
        tone={props.tone}
        srcSec={srcSec}
        status={props.status ?? (frozen ? UI.frozen : undefined)}
        illustration={props.illustration}
        targets={props.targets}
        compact={props.compact}
        labelPosition={props.labelPosition}
        style={props.style}
      />
    );
  }
  const src = staticFile(entry.file);
  const style = mediaStyle(entry, fit, crop);
  let body: ReactNode;
  if (entry.kind === 'image') {
    body = <Img src={src} style={style} />;
  } else if (sourceTime !== undefined) {
    // Freeze accepts fractional frames: the clip shows exactly `sourceTime`.
    body = (
      <Freeze frame={sourceTime * fps}>
        <OffthreadVideo src={src} muted style={style} />
      </Freeze>
    );
  } else {
    const video = <OffthreadVideo src={src} muted trimBefore={Math.round(p.srcIn * fps)} playbackRate={p.rate} style={style} />;
    const freezeFrame = p.freezeFrom !== undefined ? Math.round((p.freezeFrom - at0) * fps) : undefined;
    body =
      freezeFrame !== undefined ? (
        <Freeze frame={freezeFrame} active={(f) => f >= freezeFrame}>
          {video}
        </Freeze>
      ) : (
        video
      );
  }
  return <AbsoluteFill style={{overflow: 'hidden', ...props.style}}>{body}</AbsoluteFill>;
};

/** The placement on its own time window, filling its parent box. */
export const MediaSlot = (props: MediaSlotProps) => (
  <At from={props.placement.at[0]} to={props.placement.at[1]} name={props.placement.key}>
    <SlotBody {...props} />
  </At>
);

/**
 * The slot without a time window of its own — for a shot whose frame is chosen by `sourceTime`
 * (ReadmeLoop's phase-driven G6), whose visibility the caller already controls.
 */
export const MediaSlotBody = (props: MediaSlotProps) => <SlotBody {...props} />;
