/**
 * Storyboard time. Every component in this project speaks in the storyboard's absolute seconds
 * (「28.0–31.5 螢光筆」), never in frames relative to some parent. <At> opens a <Sequence> at an
 * absolute time and tells its children where they are, so nesting never shifts a cue.
 */
import {createContext, useContext, type ReactNode} from 'react';
import {Sequence, useCurrentFrame, useVideoConfig} from 'remotion';

const OffsetContext = createContext(0);

/** Absolute composition frame, even inside nested <At>s. */
export const useAbsFrame = (): number => useCurrentFrame() + useContext(OffsetContext);

/** Absolute storyboard seconds. */
export const useTime = (): number => {
  const {fps} = useVideoConfig();
  return useAbsFrame() / fps;
};

/** Shows `children` from `from` to `to` (absolute seconds); media inside start playing at `from`. */
export const At = ({
  from,
  to,
  name,
  layout = 'absolute-fill',
  premountSec = 0,
  children,
}: {
  from: number;
  to: number;
  name?: string;
  layout?: 'absolute-fill' | 'none';
  premountSec?: number;
  children: ReactNode;
}) => {
  const {fps} = useVideoConfig();
  const base = useContext(OffsetContext);
  const f0 = Math.round(from * fps);
  const f1 = Math.round(to * fps);
  if (f1 <= f0) return null;
  return (
    <Sequence from={f0 - base} durationInFrames={f1 - f0} name={name} layout={layout} premountFor={Math.round(premountSec * fps)}>
      <OffsetContext.Provider value={f0}>{children}</OffsetContext.Provider>
    </Sequence>
  );
};
