/**
 * A 2-D camera over a 1920×1080 stage: zoom toward a target point, optionally bringing it toward
 * the centre (`blend`). Keyframed tracks ease between keys (only push, never shake — §1.2 S3
 * 「只推不晃」); two keys at the same time make a cut.
 */
import {EASE_IN_OUT, lerp} from './anim.ts';

export interface Cam {
  zoom: number;
  /** Stage px the camera looks at. */
  target: readonly [number, number];
  /** 0 = target stays where it is on screen, 1 = target moves to the centre. */
  blend: number;
}

export interface CamKey extends Cam {
  t: number;
}

export const CAM_REST: Cam = {zoom: 1, target: [960, 540], blend: 0};

export const camAt = (track: readonly CamKey[], t: number): Cam => {
  if (!track.length) return CAM_REST;
  if (t <= track[0].t) return track[0];
  for (let i = 0; i + 1 < track.length; i++) {
    const a = track[i];
    const b = track[i + 1];
    if (t >= a.t && t < b.t) {
      if (b.t === a.t) return b;
      const k = EASE_IN_OUT((t - a.t) / (b.t - a.t));
      return {
        zoom: lerp(a.zoom, b.zoom, k),
        target: [lerp(a.target[0], b.target[0], k), lerp(a.target[1], b.target[1], k)],
        blend: lerp(a.blend, b.blend, k),
      };
    }
  }
  return track[track.length - 1];
};

/** CSS transform (origin 0 0) that renders the stage through the camera. */
export const camTransform = ({zoom, target: [tx, ty], blend}: Cam, w = 1920, h = 1080): string => {
  const dx = lerp(tx, w / 2, blend);
  const dy = lerp(ty, h / 2, blend);
  return `translate(${dx}px, ${dy}px) scale(${zoom}) translate(${-tx}px, ${-ty}px)`;
};

/** Where a stage point lands on screen through the camera. */
export const camProject = ({zoom, target: [tx, ty], blend}: Cam, [x, y]: readonly [number, number], w = 1920, h = 1080): [number, number] => [
  lerp(tx, w / 2, blend) + (x - tx) * zoom,
  lerp(ty, h / 2, blend) + (y - ty) * zoom,
];

/**
 * A push centred on `point` (blend 1) whose centre is clamped so the given region — by default the
 * whole 1920×1080 stage — keeps covering the frame: pushing toward something near an edge never
 * reveals what lies beyond it.
 */
export const coveringPush = (zoom: number, [x, y]: readonly [number, number], region: readonly [number, number, number, number] = [0, 0, 1920, 1080], w = 1920, h = 1080): Cam => {
  const [rx, ry, rw, rh] = region;
  const clamp = (c: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, c)));
  return {
    zoom,
    blend: 1,
    target: [clamp(x, rx + w / 2 / zoom, rx + rw - w / 2 / zoom), clamp(y, ry + h / 2 / zoom, ry + rh - h / 2 / zoom)],
  };
};

