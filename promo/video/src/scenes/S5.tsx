/**
 * S5 一段對話，一篇日記 — 33.0–42.5 s (frames 1980–2549). STORYBOARD §1.2 S5.
 * 33.2–33.8 the MG circles 「結束對話並生成日記」, 33.8 click; U06: generating (sped up), the
 * chat's closing message and notice, the diary page (the app's own loading overlay is stepped over),
 * the new card (tap), the detail with its 40 px stamp card (camera pushes in); 37.8 cut to U07: the
 * calendar, pushing into today's 14 px stamp (tap), then the day panel's card. Caption 35.5–39.5.
 * Out 41.8–42.7: the stamp enlarges and splits into S6's two panels (S6.tsx).
 * The recording has no visible mouse pointer (headless screencast), so clicks get a soft ripple
 * at the moment the take shows them (shots.ts maps: end button 33.8, new card 36.6, today 39.6).
 */
import {introPlacement} from '../data/media.ts';
import type {Lang} from '../data/timeline.ts';
import {CircleMark, TapRipple} from '../components/Annotations.tsx';
import {MediaSlot} from '../components/MediaSlot.tsx';
import {centerInWindow, inWindow, windowBox} from './window-marks.ts';

export const S5 = ({lang}: {lang: Lang}) => {
  const [bx, by] = centerInWindow('s5EndButton', lang);
  const [cx, cy] = centerInWindow('s5NewCard', lang);
  const [dx, dy] = centerInWindow('s5TodayCell', lang);
  return (
    <>
      <MediaSlot placement={introPlacement('S5.U06')} lang={lang} tone="ui" targets={[windowBox('s5EndButton', lang), windowBox('s5StampCard', lang)]} labelPosition="center" />
      <MediaSlot placement={introPlacement('S5.U07')} lang={lang} tone="ui" targets={[windowBox('s5TodayCell', lang)]} labelPosition="center" />
      <CircleMark rect={inWindow('s5EndButton', lang)} from={33.2} drawSec={0.5} until={34.3} />
      <TapRipple at={33.8} x={bx} y={by} />
      <TapRipple at={36.6} x={cx} y={cy} />
      <TapRipple at={39.6} x={dx} y={dy} />
    </>
  );
};
