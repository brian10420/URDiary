/**
 * S8 你的記憶，你作主 — 60.0–68.0 s (frames 3600–4079). STORYBOARD §1.2 S8.
 * U15 in the desktop window (dissolved in from the enlarged phone, 59.6–60.1): the warm notice
 * (tapped 61.4) → the memory window on 「使用者檔案」 (tap into the text box 62.8; the camera pushes
 * in so the dated lines read) → 「記憶帳本」 (64.2) → approve one item (≈ 66.8) → 「已生效」. Caption
 * 64.2–67.6 「可以設定：記下之前先問你」 (optional mode). No sound on the approval. Out 67.8–68.2:
 * the window shrinks away into S9's paper while the camera pulls back.
 * Tap times follow shots.ts 'S8.U15' (the recording has no visible pointer): each ripple lands just
 * before the take reacts — memory window zh 4.80 / en 4.77, text box 7.52 / 7.43, ledger 10.28 / 10.12,
 * approve 13.80 / 13.72.
 */
import {introPlacement} from '../data/media.ts';
import type {Lang} from '../data/timeline.ts';
import {TapRipple} from '../components/Annotations.tsx';
import {MediaSlot} from '../components/MediaSlot.tsx';
import {s8Camera} from './cameras.ts';
import {centerInWindow} from './window-marks.ts';
import {WindowSet} from './WindowSet.tsx';

export const S8 = ({lang}: {lang: Lang}) => {
  const taps = [
    {at: 61.4, id: 's8Notice'},
    {at: 62.8, id: 's8ProfileText'},
    {at: 64.2, id: 's8LedgerTab'},
    {at: 66.78, id: 's8Approve'},
  ] as const;
  return (
    <WindowSet camera={s8Camera(lang)} exit={[67.8, 68.2]}>
      <MediaSlot placement={introPlacement('S8.U15')} lang={lang} tone="ui" labelPosition="center" />
      {taps.map(({at, id}) => {
        const [x, y] = centerInWindow(id, lang);
        return <TapRipple key={id} at={at} x={x} y={y} />;
      })}
    </WindowSet>
  );
};
