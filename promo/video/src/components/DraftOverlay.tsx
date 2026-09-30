/**
 * Draft-only burn-in (props.draft): scene, storyboard time and frame in the corner, and a strip
 * across the top showing the ten scenes with the playhead — so a contact sheet of the draft reads
 * as a timeline check. Never in a final render.
 */
import {AbsoluteFill, useVideoConfig} from 'remotion';
import {SCENES, sceneAt} from '../data/timeline.ts';
import {UI} from '../data/ui-strings.ts';
import {FONT} from '../lib/theme.ts';
import {useAbsFrame} from '../lib/time.tsx';

const Chip = ({text}: {text: string}) => (
  <div
    style={{
      padding: '6px 16px',
      borderRadius: 999,
      background: 'rgba(28, 21, 17, 0.78)',
      color: '#fffdf8',
      fontFamily: FONT.zh,
      fontSize: 26,
      fontWeight: 700,
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
    }}
  >
    {text}
  </div>
);

export const IntroDraftOverlay = () => {
  const f = useAbsFrame();
  const {fps, durationInFrames, width} = useVideoConfig();
  const t = f / fps;
  const s = sceneAt(t);
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: 10, display: 'flex'}}>
        {SCENES.map((sc, i) => (
          <div
            key={sc.id}
            style={{
              width: ((sc.end - sc.start) / (durationInFrames / fps)) * width,
              background: sc.id === s.id ? 'rgba(95, 208, 160, 0.95)' : i % 2 ? 'rgba(28, 21, 17, 0.45)' : 'rgba(28, 21, 17, 0.3)',
            }}
          />
        ))}
        <div style={{position: 'absolute', top: 0, bottom: -6, left: (f / durationInFrames) * width - 2, width: 4, background: '#e8836f'}} />
      </div>
      <div style={{position: 'absolute', right: 22, top: 22}}>
        <Chip text={`${UI.draft} · ${s.id} ${s.name} · ${t.toFixed(2)} s · f${f}`} />
      </div>
    </AbsoluteFill>
  );
};

export const LoopDraftOverlay = ({phase}: {phase: number}) => {
  const f = useAbsFrame();
  const {fps} = useVideoConfig();
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div style={{position: 'absolute', right: 14, top: 14, transform: 'scale(0.7)', transformOrigin: 'top right'}}>
        <Chip text={`${UI.draft} · ${(f / fps).toFixed(2)} s · f${f} · G6 ${UI.phase} ${phase.toFixed(3)} s`} />
      </div>
    </AbsoluteFill>
  );
};
