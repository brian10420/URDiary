/**
 * The app window on cream paper, seen through a camera (S2–S5 share one; S8 has its own).
 * Children are drawn inside the window's content area, in content px (1472×828 — the
 * recording's 1920×1080 CSS px × REC_TO_WIN), so MG marks stay glued to the UI under the camera.
 */
import type {ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import {EASE_IN_OUT, EASE_OUT, lerp, ramp} from '../lib/anim.ts';
import {camAt, camTransform, type CamKey} from '../lib/camera.ts';
import {useTime} from '../lib/time.tsx';
import {DesktopWindow} from '../components/DeviceFrame.tsx';
import {Paper} from '../components/Paper.tsx';

export const WindowSet = ({
  camera,
  floatIn,
  exit,
  children,
}: {
  camera: readonly CamKey[];
  /** 「奶油底上浮出一個樸素的 App 視窗」 */
  floatIn?: readonly [number, number];
  /** 「視窗縮小退場」 */
  exit?: readonly [number, number];
  children: ReactNode;
}) => {
  const t = useTime();
  const cam = camAt(camera, t);
  const up = floatIn ? ramp(t, floatIn[0], floatIn[1], EASE_OUT) : 1;
  const away = exit ? ramp(t, exit[0], exit[1], EASE_IN_OUT) : 0;
  return (
    <AbsoluteFill>
      <Paper />
      <AbsoluteFill style={{transform: camTransform(cam), transformOrigin: '0 0'}}>
        <DesktopWindow
          style={{
            opacity: up * (1 - away),
            transform: `translateY(${(1 - up) * 56}px) scale(${lerp(0.965, 1, up) * lerp(1, 0.84, away)})`,
            transformOrigin: '50% 50%',
          }}
        >
          {children}
        </DesktopWindow>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
