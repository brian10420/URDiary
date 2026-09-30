/**
 * Every media id the two compositions can use, with whether the film is complete without it.
 * scripts/media-manifest.mjs compares this list with what is in public/media/.
 */
import {SFX} from './audio.ts';
import {INTRO_PLACEMENTS, LOOP_PLACEMENTS, MUSIC_BED_ID, SHOTS, narrationMediaId, sfxMediaId, shotMediaId} from './media.ts';
import {NARRATION} from './narration.ts';
import {LANGS} from './timeline.ts';
import {LOOP_UI_LANG} from './loop.ts';

export interface ExpectedMedia {
  id: string;
  kind: 'video' | 'image-or-video' | 'audio';
  required: boolean;
  usedBy: string;
}

export const expectedMedia = (): ExpectedMedia[] => {
  const out = new Map<string, ExpectedMedia>();
  const add = (e: ExpectedMedia) => {
    const prev = out.get(e.id);
    if (prev) {
      prev.required ||= e.required;
      if (!prev.usedBy.includes(e.usedBy)) prev.usedBy += `, ${e.usedBy}`;
    } else out.set(e.id, {...e});
  };
  for (const p of INTRO_PLACEMENTS) {
    for (const shot of p.fallback ? [p.shot, p.fallback] : [p.shot]) {
      const s = SHOTS[shot];
      for (const lang of s.perLang ? LANGS : (['zh'] as const)) {
        add({id: shotMediaId(shot, lang), kind: s.stillOk ? 'image-or-video' : 'video', required: !s.optional && shot === p.shot, usedBy: 'IntroLong'});
      }
    }
  }
  for (const p of LOOP_PLACEMENTS) {
    const s = SHOTS[p.shot];
    add({id: shotMediaId(p.shot, LOOP_UI_LANG), kind: s.stillOk ? 'image-or-video' : 'video', required: !s.optional, usedBy: 'ReadmeLoop'});
  }
  for (const line of NARRATION) for (const lang of LANGS) add({id: narrationMediaId(line.id, lang), kind: 'audio', required: true, usedBy: `IntroLong ${lang}`});
  add({id: MUSIC_BED_ID, kind: 'audio', required: true, usedBy: 'IntroLong'});
  for (const c of SFX) add({id: sfxMediaId(c.id), kind: 'audio', required: !c.optional, usedBy: 'IntroLong'});
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
};
