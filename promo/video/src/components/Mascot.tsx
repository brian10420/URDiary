/**
 * The app's own mascot / stamp SVGs (src/generated/mascot.ts ← desktop/js/mascot.js), drawn at
 * any size. Rig parts are moved through the class hooks mascot.js provides (mm-rig, mm-eyes,
 * mm-arm-r …) with a per-instance <style> computed from the current frame — never CSS
 * animations, which Remotion cannot render deterministically.
 */
import {useId, type CSSProperties} from 'react';
import {MOTION, PIVOTS, POSES, STAMPS, type PoseId, type StampId} from '../generated/mascot.ts';

export interface Rig {
  /** Whole-body sway in degrees, about the app's sway pivot (mascot.css: 50% 88%). */
  swayDeg?: number;
  /** Right arm (screen right) rotation in degrees, about the shoulder. */
  armDeg?: number;
  /** Eye squash for blinking: 1 open … 0.1 shut. */
  eyesScaleY?: number;
  /** Breathing scale of the whole rig, [x, y]. */
  breathe?: readonly [number, number];
}

export const Mascot = ({pose, width, rig, style}: {pose: PoseId; width: number; rig?: Rig; style?: CSSProperties}) => {
  const cls = `mm${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const rules = [`.${cls} svg{display:block;width:100%;height:auto;overflow:visible}`];
  if (rig?.armDeg !== undefined) {
    rules.push(`.${cls} .mm-arm-r{transform-box:fill-box;transform-origin:${PIVOTS.armR};transform:rotate(${rig.armDeg}deg)}`);
  }
  if (rig?.eyesScaleY !== undefined) {
    rules.push(`.${cls} .mm-eyes{transform-box:fill-box;transform-origin:${PIVOTS.eyes};transform:scaleY(${rig.eyesScaleY})}`);
  }
  if (rig?.breathe) {
    rules.push(`.${cls} .mm-rig{transform-box:fill-box;transform-origin:${PIVOTS.rig};transform:scale(${rig.breathe[0]},${rig.breathe[1]})}`);
  }
  return (
    <div
      className={cls}
      style={{
        width,
        transform: rig?.swayDeg ? `rotate(${rig.swayDeg}deg)` : undefined,
        transformOrigin: MOTION.sway.origin,
        ...style,
      }}
    >
      <style>{rules.join('')}</style>
      <div dangerouslySetInnerHTML={{__html: POSES[pose]}} />
    </div>
  );
};

export const Stamp = ({id, size, style}: {id: StampId; size: number; style?: CSSProperties}) => (
  <div style={{width: size, height: size, ...style}}>
    <div style={{width: '100%', height: '100%'}} dangerouslySetInnerHTML={{__html: STAMPS[id].replace('<svg ', '<svg style="display:block;width:100%;height:100%" ')}} />
  </div>
);

