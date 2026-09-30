/**
 * Values that depend on what the real recordings show (the storyboard says 「依實際印章」「以錄到的為準」),
 * per UI language — each language has its own take chain, so the stamps differ. Read off the ★ takes
 * (4K crops of the day-panel stamp cards) and matched against desktop/js/mascot.js / i18n.js:
 *   zh U07 zh-take10: moon 「靜靜的夜」 + 「今天很重，我陪你一起喘口氣」   (diary 《教授說方向不對》, valence 0.25)
 *   en U07 en-take11: umbrella "Rainy Comfort" + "Rough day. I'm here while you set it down."
 *                     (diary "Advisor said rethink everything", valence 0.35)
 *   U09 (zh-take4 / en-take3): 09-26 sun 「晴朗有勁」 / "Sunny Spirit".
 * Keep captions.ts s6-left-stamp / s6-right-stamp in step with these.
 */
import type {StampId} from '../generated/mascot.ts';
import type {Lang} from './timeline.ts';

export const RECORDED: {s5Stamp: Record<Lang, StampId>; goodDayStamp: Record<Lang, StampId>} = {
  /** The stamp S5's diary got (U07) — enlarges and splits into S6, then sits under the right panel. */
  s5Stamp: {zh: 'moon', en: 'umbrella'},
  /** U09's good-day stamp (left panel). */
  goodDayStamp: {zh: 'sun', en: 'sun'},
};
