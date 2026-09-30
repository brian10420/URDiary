/**
 * Values that depend on what the real recordings turn out to show (the storyboard says
 * 「依實際印章」「以錄到的為準」). PROVISIONAL — set them from the takes in Stage 3, together with
 * the matching labels in captions.ts (s6-left-stamp / s6-right-stamp).
 */
export const RECORDED = {
  /** The stamp S5's diary got (U07) — enlarges and splits into S6. §1.2 S6 example: umbrella「雨天安好」. */
  s5Stamp: 'umbrella',
  /** U09's good-day stamp. §1.2 S6 example: sun「晴朗有勁」. */
  goodDayStamp: 'sun',
} as const;
