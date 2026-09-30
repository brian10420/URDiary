/**
 * S3 被聽見 — 16.0–24.0 s (frames 960–1439). STORYBOARD §1.2 S3.
 * U03 in the same window (dissolved in 15.8–16.2): her long message, the quiet thinking bubble,
 * the reply; the camera only pushes (19.0–23.6) toward the reply's first lines. No MG
 * decoration at all in this scene. Caption 「被聽見」 19.5–23.5 top-left. Out: cut.
 */
import {introPlacement} from '../data/media.ts';
import type {Lang} from '../data/timeline.ts';
import {MediaSlot} from '../components/MediaSlot.tsx';
import {windowBox} from './window-marks.ts';

export const S3 = ({lang}: {lang: Lang}) => (
  <MediaSlot placement={introPlacement('S3.U03')} lang={lang} tone="ui" targets={[windowBox('s3Reply')]} labelPosition="center" />
);
