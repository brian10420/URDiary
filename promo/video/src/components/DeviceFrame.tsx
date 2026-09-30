/**
 * Device chrome drawn as motion graphics (§1.2 S2: 「樸素的 App 視窗（MG 外框，不放任何作業系統
 * 品牌）」; S7: 手機外框). No traffic lights, no notch, no OS marks — just the app's own name.
 */
import type {CSSProperties, ReactNode} from 'react';
import {RECORDING_SIZE} from '../data/media.ts';
import {UI} from '../data/ui-strings.ts';
import {C, FONT} from '../lib/theme.ts';
import {Mascot} from './Mascot.tsx';

/** The desktop window on the 1920×1080 stage: a 1472×828 content area (16:9, the recording's shape). */
export const WINDOW = {x: 224, y: 104, contentW: 1472, contentH: 828, bar: 44} as const;
/** Recording CSS px → window content px. */
export const REC_TO_WIN = WINDOW.contentW / RECORDING_SIZE.desktop.w;
/** Recording CSS px → stage px (window placed at WINDOW.x / y). */
export const recToStage = (x: number, y: number): [number, number] => [
  WINDOW.x + x * REC_TO_WIN,
  WINDOW.y + WINDOW.bar + y * REC_TO_WIN,
];

export const DesktopWindow = ({children, style}: {children: ReactNode; style?: CSSProperties}) => (
  <div
    style={{
      position: 'absolute',
      left: WINDOW.x,
      top: WINDOW.y,
      width: WINDOW.contentW,
      height: WINDOW.contentH + WINDOW.bar,
      borderRadius: 18,
      overflow: 'hidden',
      background: C.surface,
      boxShadow: '0 3px 0 rgba(75, 46, 30, 0.05), 0 46px 90px -40px rgba(75, 46, 30, 0.6), 0 0 0 1.5px rgba(75, 46, 30, 0.12)',
      ...style,
    }}
  >
    <div
      style={{
        height: WINDOW.bar,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 18px',
        background: C.paperAlt,
        borderBottom: '1px solid rgba(75, 46, 30, 0.12)',
        fontFamily: FONT.serif,
        fontWeight: 700,
        fontSize: 20,
        color: C.text,
      }}
    >
      <Mascot pose="smile" width={26} />
      {UI.appTitle}
    </div>
    <div style={{position: 'relative', width: WINDOW.contentW, height: WINDOW.contentH, overflow: 'hidden', background: C.uiGrey}}>
      {children}
    </div>
  </div>
);

/** Phone screen size on stage: 390×844 CSS (the recording) scaled to this width. */
export const PHONE = {screenW: 404, bezel: 12, radius: 58} as const;
export const PHONE_SCREEN_H = Math.round((PHONE.screenW * RECORDING_SIZE.phone.h) / RECORDING_SIZE.phone.w);

export const PhoneFrame = ({children, style}: {children: ReactNode; style?: CSSProperties}) => (
  <div
    style={{
      width: PHONE.screenW + PHONE.bezel * 2,
      height: PHONE_SCREEN_H + PHONE.bezel * 2,
      padding: PHONE.bezel,
      borderRadius: PHONE.radius,
      background: C.textStrong,
      boxShadow: '0 40px 80px -36px rgba(43, 26, 16, 0.75), inset 0 0 0 2px rgba(255, 255, 255, 0.08)',
      ...style,
    }}
  >
    <div
      style={{
        position: 'relative',
        width: PHONE.screenW,
        height: PHONE_SCREEN_H,
        borderRadius: PHONE.radius - PHONE.bezel,
        overflow: 'hidden',
        background: C.uiGrey,
      }}
    >
      {children}
    </div>
  </div>
);

/** One component for both, when the caller only knows the device. */
export const DeviceFrame = ({device, children, style}: {device: 'desktop' | 'phone'; children: ReactNode; style?: CSSProperties}) =>
  device === 'phone' ? <PhoneFrame style={style}>{children}</PhoneFrame> : <DesktopWindow style={style}>{children}</DesktopWindow>;
