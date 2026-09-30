/**
 * Narration: the approved zh / en lines of STORYBOARD §1.2 with their in-points, plus how each
 * line is burned in as subtitles (§0: same language, bottom centre, zh ≤ 16 字 / en ≤ 42
 * characters per line, at most two lines).
 *
 * `text` is verbatim from the storyboard (straight apostrophes included — typography is applied
 * at render time) because the TTS step reads it too. `latestEnd` is the storyboard's 「最晚 x s」
 * from each 節奏核對; `estimateSpeechSec()` re-derives it from the §0 rhythm rules so an edited
 * line cannot silently overrun its scene (scripts/check.mjs).
 *
 * Audio slots: public/media/narration/<lang>/<id>.mp3 (e.g. narration/zh/S6-A.mp3; the ids are the ones
 * promo/narration/lines.json uses, so its TTS files drop straight in). Scenes with
 * two or three separately timed sentences (S6, S9) get one file per sentence.
 */
import type {Lang, SceneId} from './timeline.ts';

export interface NarrationLine {
  id: string;
  scene: SceneId;
  in: Record<Lang, number>;
  text: Record<Lang, string>;
  latestEnd: Record<Lang, number>;
  /** Subtitle events → lines. Joined, they must reproduce `text` exactly. */
  subtitles: Record<Lang, string[][]>;
  /**
   * false = not burned in. Only S10: its main end card (81.0 s, 「和旁白同步」) is this very
   * sentence, so a subtitle underneath would print it twice.
   */
  burnIn: boolean;
}

export const NARRATION: readonly NarrationLine[] = [
  {
    id: 'S1', scene: 'S1', in: {zh: 1.0, en: 1.0}, latestEnd: {zh: 5.1, en: 6.0}, burnIn: true,
    text: {zh: '有些話，說不出口；就這樣一直收著。', en: 'Some things are hard to say. So you keep them in.'},
    subtitles: {
      zh: [['有些話，說不出口；', '就這樣一直收著。']],
      en: [['Some things are hard to say.', 'So you keep them in.']],
    },
  },
  {
    id: 'S2', scene: 'S2', in: {zh: 8.1, en: 8.1}, latestEnd: {zh: 14.1, en: 14.6}, burnIn: true,
    text: {
      zh: '第一次見面，它會自我介紹，也問你想不想幫它取名字。',
      en: "When you first meet, it introduces itself and asks if you'd like to name it.",
    },
    subtitles: {
      zh: [['第一次見面，它會自我介紹，', '也問你想不想幫它取名字。']],
      en: [['When you first meet, it introduces itself', "and asks if you'd like to name it."]],
    },
  },
  {
    id: 'S3', scene: 'S3', in: {zh: 16.6, en: 16.6}, latestEnd: {zh: 21.9, en: 23.0}, burnIn: true,
    text: {
      zh: '它會先聽你說完，接住你的心情，不急著給建議。',
      en: "It listens first, sits with how you feel, and doesn't rush to give advice.",
    },
    subtitles: {
      zh: [['它會先聽你說完，', '接住你的心情，不急著給建議。']],
      en: [['It listens first, sits with how you feel,', "and doesn't rush to give advice."]],
    },
  },
  {
    id: 'S4', scene: 'S4', in: {zh: 24.7, en: 24.7}, latestEnd: {zh: 31.7, en: 31.6}, burnIn: true,
    text: {
      zh: '聊到相關的事，它會想起你寫過的某一天，連日期和標題都記得。',
      en: "When it's relevant, it recalls a day you wrote about — by its date and title.",
    },
    subtitles: {
      // 26 字 do not fit two 16-字 lines at a phrase break, so the sentence is shown in two steps.
      zh: [['聊到相關的事，', '它會想起你寫過的某一天，'], ['連日期和標題都記得。']],
      en: [["When it's relevant, it recalls a day", 'you wrote about — by its date and title.']],
    },
  },
  {
    id: 'S5', scene: 'S5', in: {zh: 33.7, en: 33.7}, latestEnd: {zh: 41.0, en: 41.0}, burnIn: true,
    text: {
      zh: '按一下，這段對話就成了一篇日記；行事曆那天，也多一枚小印章。',
      en: 'One tap, and the chat becomes a diary entry — plus a little stamp on your calendar.',
    },
    subtitles: {
      zh: [['按一下，這段對話就成了一篇日記；', '行事曆那天，也多一枚小印章。']],
      // 83 characters: two 42-character lines cannot hold it, so two steps.
      en: [['One tap, and the chat', 'becomes a diary entry —'], ['plus a little stamp on your calendar.']],
    },
  },
  {
    id: 'S6-A', scene: 'S6', in: {zh: 43.1, en: 43.1}, latestEnd: {zh: 46.35, en: 45.6}, burnIn: true,
    text: {zh: '開心的日子，有個小小的慶祝；', en: 'Good days get a little celebration.'},
    subtitles: {zh: [['開心的日子，有個小小的慶祝；']], en: [['Good days get a little celebration.']]},
  },
  {
    id: 'S6-B', scene: 'S6', in: {zh: 46.8, en: 46.8}, latestEnd: {zh: 50.05, en: 48.9}, burnIn: true,
    text: {zh: '難過的日子，只有安靜的陪伴。', en: 'Hard days get quiet company.'},
    subtitles: {zh: [['難過的日子，只有安靜的陪伴。']], en: [['Hard days get quiet company.']]},
  },
  {
    id: 'S7', scene: 'S7', in: {zh: 51.6, en: 51.6}, latestEnd: {zh: 58.7, en: 58.45}, burnIn: true,
    text: {
      zh: '每天第一次打開，它會先問候你——記得昨天，也知道今天的安排。',
      en: "First open of the day? It checks in — remembering yesterday, aware of today's plans.",
    },
    subtitles: {
      zh: [['每天第一次打開，它會先問候你——', '記得昨天，也知道今天的安排。']],
      en: [['First open of the day?', 'It checks in —'], ['remembering yesterday,', "aware of today's plans."]],
    },
  },
  {
    id: 'S8', scene: 'S8', in: {zh: 60.6, en: 60.6}, latestEnd: {zh: 67.0, en: 66.8}, burnIn: true,
    text: {
      zh: '它對你的記憶，你看得到、改得了，也能讓它記之前先問你。',
      en: 'You can read and edit its memory of you — or have it ask first.',
    },
    subtitles: {
      zh: [['它對你的記憶，你看得到、改得了，', '也能讓它記之前先問你。']],
      en: [['You can read and edit its memory of you —', 'or have it ask first.']],
    },
  },
  {
    id: 'S9-A', scene: 'S9', in: {zh: 68.6, en: 68.6}, latestEnd: {zh: 71.1, en: 71.95}, burnIn: true,
    text: {zh: '日記存在你自己的電腦。', en: 'Your diary is stored on your own computer.'},
    subtitles: {zh: [['日記存在你自己的電腦。']], en: [['Your diary is stored on your own computer.']]},
  },
  {
    id: 'S9-B', scene: 'S9', in: {zh: 71.4, en: 72.1}, latestEnd: {zh: 74.65, en: 75.0}, burnIn: true,
    text: {zh: '聊天內容，會送到你選的 AI；', en: 'Chats go to the AI you choose —'},
    subtitles: {zh: [['聊天內容，會送到你選的 AI；']], en: [['Chats go to the AI you choose —']]},
  },
  {
    id: 'S9-C', scene: 'S9', in: {zh: 75.0, en: 75.3}, latestEnd: {zh: 79.0, en: 79.05}, burnIn: true,
    text: {zh: '想讓聊天留在本機，就改用本地模型。', en: 'or keep chats at home with a local model.'},
    subtitles: {zh: [['想讓聊天留在本機，', '就改用本地模型。']], en: [['or keep chats at home with a local model.']]},
  },
  {
    id: 'S10', scene: 'S10', in: {zh: 81.0, en: 81.0}, latestEnd: {zh: 85.5, en: 86.0}, burnIn: false,
    text: {zh: '讓每天寫日記，成為一件療癒自己的事吧！', en: 'Let writing each day become a little way to care for yourself.'},
    subtitles: {
      zh: [['讓每天寫日記，', '成為一件療癒自己的事吧！']],
      en: [['Let writing each day become', 'a little way to care for yourself.']],
    },
  },
];

// ---------------------------------------------------------------- the §0 rhythm rules

/** Slowest allowed delivery (§0): zh 4.0 字/s, en 2.4 words/s — used for the 「最晚」 end. */
export const SLOW_RATE: Record<Lang, number> = {zh: 4.0, en: 2.4};

/** §0 pause table. The sentence-final mark is not counted. */
const PAUSES: Array<[RegExp, number]> = [
  [/^(——|—)$/, 0.35],
  [/^、$/, 0.15],
  [/^[，,]$/, 0.25],
  [/^；$/, 0.3],
  [/^[。？.?！!]$/, 0.4],
];

/** zh syllables: every 漢字, 「AI」 = 2, 「URDiary」 = 5 (§0). */
const zhSyllables = (s: string): number =>
  (s.match(/\p{Script=Han}/gu) ?? []).length + (s.match(/AI/g) ?? []).length * 2 + (s.match(/URDiary/g) ?? []).length * 5;

/** en words: whitespace-separated tokens containing a letter (a lone 「—」 is not a word). */
const enWords = (s: string): number => s.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;

const pauseMarks = (s: string): string[] => s.match(/——|[—、，,；。？.?！!]/g) ?? [];

/** Seconds the storyboard's rhythm model gives `text` at `rate` (pauses included, final mark excluded). */
export const estimateSpeechSec = (text: string, lang: Lang, rate: number = SLOW_RATE[lang]): number => {
  const t = text.trim();
  const units = lang === 'zh' ? zhSyllables(t) : enWords(t);
  const marks = pauseMarks(t.replace(/[—、，,；。？.?！!]+$/u, ''));
  const pause = marks.reduce((sum, m) => sum + (PAUSES.find(([re]) => re.test(m))?.[1] ?? 0), 0);
  return units / rate + pause;
};

/** Joins subtitle lines back into the sentence (zh: no separator, en: one space). */
export const joinSubtitle = (events: string[][], lang: Lang): string =>
  events.flat().join(lang === 'zh' ? '' : ' ');

/**
 * Subtitle timing inside one narration line: event k starts where the rhythm model says its
 * first word is spoken, scaled to the line's real (or budgeted) duration. With the TTS file
 * present, `durationSec` is the file's length; otherwise the storyboard's 最晚 budget.
 */
export const subtitleEvents = (
  line: NarrationLine,
  lang: Lang,
  durationSec: number,
): Array<{start: number; end: number; lines: string[]}> => {
  const events = line.subtitles[lang];
  const total = estimateSpeechSec(line.text[lang], lang);
  const start = line.in[lang];
  // Model time from the start of the sentence to just after `prefix`, its trailing pause
  // included: append one unit (a 字 / a word) so the prefix's last mark is not "final", then
  // take that unit back off.
  const elapsedAfter = (prefix: string): number =>
    prefix.trim() ? estimateSpeechSec(prefix + (lang === 'zh' ? '字' : ' x'), lang) - 1 / SLOW_RATE[lang] : 0;
  let spoken = '';
  return events.map((lines, k) => {
    const before = elapsedAfter(spoken);
    spoken += lines.join(lang === 'zh' ? '' : ' ') + (lang === 'zh' ? '' : ' ');
    const after = k === events.length - 1 ? total : elapsedAfter(spoken);
    return {start: start + (durationSec * before) / total, end: start + (durationSec * after) / total, lines};
  });
};
