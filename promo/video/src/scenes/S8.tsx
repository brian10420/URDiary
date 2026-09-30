/**
 * S8 你的記憶，你作主 — 60.0–68.0 s (frames 3600–4079). STORYBOARD §1.2 S8.
 * U15 in the desktop window (dissolved in from the enlarged phone, 59.6–60.1): the warm notice
 * → the memory window on 「使用者檔案」 (cursor in the text box) → 「記憶帳本」 → approve one
 * item → 「已生效」. Caption 64.2–67.6 「可以設定：記下之前先問你」 (optional mode). No sound on
 * the approval. Out 67.8–68.2: the window shrinks away into S9's paper.
 */
import {introPlacement} from '../data/media.ts';
import type {Lang} from '../data/timeline.ts';
import {MediaSlot} from '../components/MediaSlot.tsx';
import {S8_CAMERA} from './cameras.ts';
import {WindowSet} from './WindowSet.tsx';

export const S8 = ({lang}: {lang: Lang}) => (
  <WindowSet camera={S8_CAMERA} exit={[67.8, 68.2]}>
    <MediaSlot placement={introPlacement('S8.U15')} lang={lang} tone="ui" labelPosition="center" />
  </WindowSet>
);
