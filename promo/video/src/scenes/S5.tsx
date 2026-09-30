/**
 * S5 一段對話，一篇日記 — 33.0–42.5 s (frames 1980–2549). STORYBOARD §1.2 S5.
 * 33.2–33.8 the MG circles 「結束對話並生成日記」, 33.8 click; U06: generating (sped up),
 * the diary page, the new card, the detail with its 40 px stamp card (camera pushes in); 37.8 cut
 * to U07: the calendar, pushing into today's 14 px stamp, then the day panel. Caption
 * 35.5–39.5. Out 41.8–42.7: the stamp enlarges and splits into S6's two panels (S6.tsx).
 */
import {introPlacement} from '../data/media.ts';
import type {Lang} from '../data/timeline.ts';
import {CircleMark, TapRipple} from '../components/Annotations.tsx';
import {MediaSlot} from '../components/MediaSlot.tsx';
import {inWindow, windowBox} from './window-marks.ts';

export const S5 = ({lang}: {lang: Lang}) => {
  const [bx, by, bw, bh] = inWindow('s5EndButton');
  return (
    <>
      <MediaSlot placement={introPlacement('S5.U06')} lang={lang} tone="ui" targets={[windowBox('s5EndButton'), windowBox('s5StampCard')]} labelPosition="center" />
      <MediaSlot placement={introPlacement('S5.U07')} lang={lang} tone="ui" targets={[windowBox('s5TodayCell')]} labelPosition="center" />
      <CircleMark rect={inWindow('s5EndButton')} from={33.2} drawSec={0.5} until={34.3} />
      <TapRipple at={33.8} x={bx + bw / 2} y={by + bh / 2} />
    </>
  );
};
