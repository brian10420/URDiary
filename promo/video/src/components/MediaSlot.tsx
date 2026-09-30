/**
 * One placement of a shot (src/data/media.ts): plays public/media/<id>.<ext> over the
 * placement's time — or, while the file does not exist, the labelled <Placeholder>. Presence is
 * decided at bundle time from src/generated/media-manifest.ts (scripts/media-manifest.mjs), so a
 * missing file never becomes a failed network request.
 *
 * Timing: a placement with a speed map (src/data/shots.ts SPEED_MAPS) shows, on every frame, the
 * source second the map gives (knots of timeline → take seconds), converted to the intermediate's
 * own time (source − the clip's in-point) and snapped into that source frame; <AtSourceFrame> pins
 * the <OffthreadVideo> there. Speed-ups, holds and the storyboard's 「加速」 all come from the map, so
 * they stay adjustable without re-encoding. Without a map the file plays linearly (srcIn / rate).
 *
 * Crops: rects are in recording CSS px; the clip table says which CSS rect a file covers and at how
 * many pixels per CSS px (full 1920×1080 frame at 1, the phone at 2, card crops at 2).
 */
import type {CSSProperties, ReactElement, ReactNode} from 'react';
import {AbsoluteFill, Freeze, Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {MEDIA_MANIFEST, type MediaEntry} from '../generated/media-manifest.ts';
import {RECORDING_SIZE, SHOTS, type Placement, type ShotSpec, shotMediaId} from '../data/media.ts';
import {CLIP_FPS, type Rect, clipById, clipGeometry, clipInFrame, sourceAt, speedMap} from '../data/shots.ts';
import type {Lang} from '../data/timeline.ts';
import {UI} from '../data/ui-strings.ts';
import {At, useTime} from '../lib/time.tsx';
import {Placeholder, type LabelPosition, type PlaceholderProps, type Tone} from './Placeholder.tsx';

export const mediaFor = (p: Placement, lang: Lang): {entry: MediaEntry | undefined; shot: ShotSpec; id: string} => {
  const tries: Array<[typeof p.shot, string | undefined]> = [[p.shot, p.variant]];
  if (p.fallback) tries.push([p.fallback, undefined]);
  for (const [shotId, variant] of tries) {
    const id = shotMediaId(shotId, lang, variant);
    if (MEDIA_MANIFEST[id]) return {entry: MEDIA_MANIFEST[id], shot: SHOTS[shotId], id};
  }
  return {entry: undefined, shot: SHOTS[p.shot], id: shotMediaId(p.shot, lang, p.variant)};
};

export interface MediaSlotProps {
  placement: Placement;
  lang: Lang;
  tone: Tone;
  fit?: 'cover' | 'contain';
  /** Show only this region of the recording (recording CSS px), scaled so its width fills `box.w`. */
  crop?: {rect: Rect; box: {w: number; h: number}};
  /** Exact source second to show instead of linear playback (ReadmeLoop's G6 phase). */
  sourceTime?: number;
  illustration?: ReactNode;
  targets?: PlaceholderProps['targets'];
  compact?: boolean;
  labelPosition?: LabelPosition;
  status?: string;
  style?: CSSProperties;
}

/** The CSS rect a file covers and its px per CSS px (from the clip table; else a full recording). */
const geometryOf = (id: string, entry: MediaEntry): {rect: Rect; scale: number} => {
  const clip = clipById(id);
  if (clip) return clipGeometry(clip);
  const phone = (entry.width ?? 1) < (entry.height ?? 0);
  const rec = RECORDING_SIZE[phone ? 'phone' : 'desktop'];
  return {rect: [0, 0, rec.w, rec.h], scale: (entry.width ?? rec.w) / rec.w};
};

const mediaStyle = (id: string, entry: MediaEntry, fit: 'cover' | 'contain', crop: MediaSlotProps['crop']): CSSProperties => {
  if (!crop) return {width: '100%', height: '100%', objectFit: fit};
  const g = geometryOf(id, entry);
  const [x, y, w] = crop.rect;
  const k = crop.box.w / w; // box px per CSS px
  const cssW = (entry.width ?? g.rect[2] * g.scale) / g.scale;
  const cssH = (entry.height ?? g.rect[3] * g.scale) / g.scale;
  return {position: 'absolute', left: (g.rect[0] - x) * k, top: (g.rect[1] - y) * k, width: cssW * k, height: cssH * k, maxWidth: 'none'};
};

/**
 * Seconds into the intermediate for take-second `src`: minus the clip's in-point, clamped to the
 * file, and moved a quarter-frame into the source frame so the compositor cannot pick a neighbour.
 */
const clipTime = (id: string, entry: MediaEntry, src: number): number => {
  const clip = clipById(id);
  const fps = entry.fps ?? CLIP_FPS;
  const local = clip ? src - clipInFrame(clip) / CLIP_FPS : src;
  const frames = entry.frames ?? Math.floor((entry.durationSec ?? 0) * fps);
  const f = Math.max(0, Math.min(frames - 1, Math.floor(local * fps + 1e-6)));
  return (f + 0.25) / fps;
};

/**
 * Shows its video child at `frame` (composition frames from the file's start) on every frame.
 * A <Sequence> starting `current − frame` frames ago makes the child's clock read exactly `frame`.
 * (Not <Freeze>: it sets the timeline to `frame + the sequence's offset`, which Remotion clamps to
 * the composition's length — in the 600-frame loop a clip 20 s in came out as a much earlier frame.)
 */
const AtSourceFrame = ({frame, children}: {frame: number; children: ReactElement}) => {
  const current = useCurrentFrame();
  return (
    <Sequence from={current - frame} layout="none" name="source frame">
      {children}
    </Sequence>
  );
};

const SlotBody = (props: MediaSlotProps) => {
  const {placement: p, lang, fit = 'cover', crop, sourceTime} = props;
  const {fps} = useVideoConfig();
  const t = useTime();
  const {entry, shot, id} = mediaFor(p, lang);
  const at0 = p.at[0];
  const map = speedMap(p.key, lang);
  const frozen = p.freezeFrom !== undefined && t >= p.freezeFrom;
  const srcSec = sourceTime ?? (map ? sourceAt(map, t) : p.srcIn + (Math.min(t, p.freezeFrom ?? Infinity) - at0) * p.rate);

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
  const style = mediaStyle(id, entry, fit, crop);
  let body: ReactNode;
  if (entry.kind === 'image') {
    body = <Img src={src} style={style} />;
  } else if (sourceTime !== undefined || map) {
    // fractional frames are fine: the clip shows exactly that second
    const local = map ? clipTime(id, entry, srcSec) : (sourceTime as number);
    body = (
      <AtSourceFrame frame={local * fps}>
        <OffthreadVideo src={src} muted style={style} />
      </AtSourceFrame>
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

/** Aspect (w / h) of the file a placement plays, from the clip table — for boxes that show a whole crop. */
export const clipAspect = (p: Placement, lang: Lang, fallback: number): number => {
  const clip = clipById(shotMediaId(p.shot, lang, p.variant));
  if (!clip) return fallback;
  const [, , w, h] = clipGeometry(clip).rect;
  return w / h;
};
