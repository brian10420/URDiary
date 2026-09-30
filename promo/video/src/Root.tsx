/**
 * Compositions. The two films, plus two check-only helpers used by scripts/check.mjs.
 */
import {Composition, Folder} from 'remotion';
import {INTRO} from './data/timeline.ts';
import {LOOP} from './data/loop.ts';
import './lib/fonts.ts';
import {CaptionAudit} from './compositions/CaptionAudit.tsx';
import {IntroLong} from './compositions/IntroLong.tsx';
import {ReadmeLoop} from './compositions/ReadmeLoop.tsx';

export const RemotionRoot = () => (
  <>
    <Composition
      id={INTRO.id}
      component={IntroLong}
      width={INTRO.width}
      height={INTRO.height}
      fps={INTRO.fps}
      durationInFrames={INTRO.durationInFrames}
      defaultProps={{lang: 'zh', draft: false}}
    />
    <Composition
      id={LOOP.id}
      component={ReadmeLoop}
      width={LOOP.width}
      height={LOOP.height}
      fps={LOOP.fps}
      durationInFrames={LOOP.durationInFrames}
      defaultProps={{draft: false}}
    />
    <Folder name="checks">
      {/* Frame 600 of this one is t = 20.000 s — the frame ReadmeLoop never outputs; it must equal frame 0. */}
      <Composition
        id="ReadmeLoopSeam"
        component={ReadmeLoop}
        width={LOOP.width}
        height={LOOP.height}
        fps={LOOP.fps}
        durationInFrames={LOOP.durationInFrames + 1}
        defaultProps={{draft: false}}
      />
      <Composition
        id="CaptionAudit"
        component={CaptionAudit}
        width={1920}
        height={5600}
        fps={30}
        durationInFrames={1}
        defaultProps={{lang: 'zh'}}
      />
    </Folder>
  </>
);
