/**
 * S2 初次見面，取個名字 — 7.5–16.0 s (frames 450–959). STORYBOARD §1.2 S2.
 * The plain app window floats up on cream (7.5–8.3), U02 plays inside; the title switches to
 * 「小樹洞」 the moment the name is saved and the MG circles it once in bookmark green
 * (12.8–13.6). Caption 10.5–15.5 comes from the caption track. Out: dissolve inside the same
 * window to S3 (15.8–16.2).
 */
import {introPlacement} from '../data/media.ts';
import type {Lang} from '../data/timeline.ts';
import {CircleMark} from '../components/Annotations.tsx';
import {MediaSlot} from '../components/MediaSlot.tsx';
import {inWindow, windowBox} from './window-marks.ts';

export const S2 = ({lang}: {lang: Lang}) => (
  <>
    <MediaSlot placement={introPlacement('S2.U02')} lang={lang} tone="ui" targets={[windowBox('s2Title')]} labelPosition="center" />
    <CircleMark rect={inWindow('s2Title')} from={12.8} drawSec={0.5} until={13.6} />
  </>
);
