/**
 * On-screen text (「畫面文字」, STORYBOARD §1.2) for IntroLong: every word the film prints that
 * is not a narration subtitle. Times are the storyboard's; where it gives none (the S9 labels,
 * the S6 headline) the choice is noted. Text is verbatim — straight apostrophes are turned into
 * typographic ones at render time.
 *
 * `kind` picks the typographic role (src/components/Caption.tsx). `npm run check` renders all of
 * them at 1080p in a real browser and fails if any wraps to more than two lines.
 */
import type {Lang, SceneId} from './timeline.ts';

export type CaptionKind =
  | 'title' // S1 片名字卡（下方三分之一）
  | 'card' // feature headline card, top-left
  | 'card-center' // S6 「被看見」, top-centre
  | 'panel-label' // S6 stamp name under each panel
  | 'diagram-title' // S9 「你的電腦」
  | 'diagram-note' // S9 small lines under it
  | 'diagram-chip' // S9 provider names / local-model box
  | 'fine' // S9 底部細字
  | 'end-wordmark'
  | 'end-main'
  | 'end-small'
  | 'end-meta'
  | 'end-url'
  | 'end-disclaimer';

export interface CaptionItem {
  id: string;
  scene: SceneId;
  in: number;
  out: number;
  kind: CaptionKind;
  text: Record<Lang, string>;
  sub?: Record<Lang, string>;
  /** Where a 'card' sits (§0: 「放上方或左下」). Default top-left. */
  pos?: 'top-left' | 'top-right';
  /** Depends on what gets recorded (the storyboard says 「依實際印章」 etc.). */
  provisional?: boolean;
  note?: string;
}

export const CAPTIONS: readonly CaptionItem[] = [
  {
    id: 's1-title', scene: 'S1', in: 5.6, out: 7.5, kind: 'title',
    text: {zh: 'URDiary', en: 'URDiary'},
    sub: {zh: '一個會記得你的 AI 日記夥伴', en: 'An AI diary companion that remembers you'},
    note: '5.6–7.5 片名字卡在下方三分之一淡入；隨 7.2–7.7 的配對溶接淡出',
  },
  {
    id: 's2-name', scene: 'S2', in: 10.5, out: 15.5, kind: 'card', pos: 'top-right',
    text: {zh: '幫它取個名字', en: 'Give it a name'},
    sub: {zh: '不取也行，之後隨時能改', en: "Or don't — rename it anytime"},
    note: '右上：左上是對話標題，12.8–13.6 要圈它，字卡不能蓋住',
  },
  {id: 's3-heard', scene: 'S3', in: 19.5, out: 23.5, kind: 'card', text: {zh: '被聽見', en: 'Heard'}, note: '左上'},
  {id: 's4-remembered', scene: 'S4', in: 27.5, out: 32.5, kind: 'card', text: {zh: '被記得', en: 'Remembered'}},
  {id: 's5-diary', scene: 'S5', in: 35.5, out: 39.5, kind: 'card', text: {zh: '一段對話，一篇日記', en: 'One chat, one diary entry'}},
  {
    id: 's6-seen', scene: 'S6', in: 42.8, out: 50.6, kind: 'card-center', text: {zh: '被看見', en: 'Seen'},
    note: '上方置中；storyboard 沒給時間——隨 42.5–43.3 紙張分開時浮出，50.6 轉場開始前收',
  },
  {
    id: 's6-left-stamp', scene: 'S6', in: 43.0, out: 50.6, kind: 'panel-label',
    text: {zh: '晴朗有勁', en: 'Sunny Spirit'}, note: '左格下方，依實際印章：U09 zh-take3／en-take2 都是 09-26 的 sun（recorded.ts）',
  },
  {
    id: 's6-right-stamp', scene: 'S6', in: 46.8, out: 51.0, kind: 'panel-label',
    text: {zh: '照顧自己', en: 'Quiet Night'},
    note: '右格下方，依實際印章：S5 錄到的今天——zh U07 zh-take4 是 heal「照顧自己」、en U07 en-take3 是 moon “Quiet Night”（i18n stamp.heal／stamp.moon；recorded.ts）',
  },
  {
    id: 's7-phone', scene: 'S7', in: 55.0, out: 59.5, kind: 'card',
    text: {zh: '手機也能用・連回你自己的電腦', en: 'On your phone, too — connected to your own computer'},
  },
  {
    id: 's8-ask-first', scene: 'S8', in: 64.2, out: 67.6, kind: 'card',
    text: {zh: '可以設定：記下之前先問你', en: 'Optional: ask before it remembers'},
    note: '對齊旁白「也能讓它…」那半句；核可制是選配（§0 誠實規則 8）',
  },
  {
    id: 's9-computer', scene: 'S9', in: 68.3, out: 79.8, kind: 'diagram-title', text: {zh: '你的電腦', en: 'Your computer'},
    note: '68.0–71.2 字卡「你的電腦」（筆電畫出來之後浮出，整場留著）',
  },
  {
    id: 's9-sqlite', scene: 'S9', in: 68.8, out: 79.8, kind: 'diagram-note',
    text: {zh: '日記存在本機 SQLite 檔', en: 'Diaries live in a local SQLite file'},
    note: 'storyboard 列在 S9 畫面文字但沒給時間——跟著旁白 A（68.6）出現',
  },
  {
    id: 's9-no-cloud', scene: 'S9', in: 70.5, out: 79.8, kind: 'diagram-note',
    text: {zh: '不用註冊雲端帳號・沒有追蹤', en: 'No cloud sign-up · No tracking'}, note: '70.5 起加小字',
  },
  {
    id: 's9-providers', scene: 'S9', in: 71.2, out: 75.0, kind: 'diagram-chip',
    text: {zh: 'Claude・ChatGPT・Gemini・Grok', en: 'Claude · ChatGPT · Gemini · Grok'},
    note: '只有文字、不放 logo；拆成四個標籤，Grok 亮起＝「你選的」（示範帳號用 grok-4.3）',
  },
  {
    id: 's9-local', scene: 'S9', in: 75.0, out: 79.8, kind: 'diagram-chip',
    text: {zh: '本地模型（Ollama／LM Studio）', en: 'Local model (Ollama / LM Studio)'}, note: '筆電裡長出的小方塊',
  },
  {
    id: 's9-fine-1', scene: 'S9', in: 71.2, out: 80.0, kind: 'fine',
    text: {
      zh: '聊天、每日問候和寫日記時，對話內容與它需要參考的記憶、行程，會送到你選的 AI 供應商。',
      en: 'Chats, daily check-ins and diary writing send your messages — plus the memories and plans they need — to the AI provider you choose.',
    },
  },
  {
    id: 's9-fine-2', scene: 'S9', in: 75.0, out: 80.0, kind: 'fine',
    text: {zh: '語音輸入與朗讀一律經由 xAI。', en: 'Voice input and read-aloud always use xAI.'},
  },
  {id: 's10-wordmark', scene: 'S10', in: 80.5, out: 88.5, kind: 'end-wordmark', text: {zh: 'URDiary', en: 'URDiary'}},
  {
    id: 's10-main', scene: 'S10', in: 81.0, out: 88.5, kind: 'end-main',
    // 主字卡兩行 — the line break is the storyboard's.
    text: {zh: '讓每天寫日記，\n成為一件療癒自己的事吧！', en: 'Let writing each day become\na little way to care for yourself.'},
    note: '和旁白同步（81.0）；所以 S10 不另外燒字幕',
  },
  {
    id: 's10-pillars', scene: 'S10', in: 83.8, out: 88.5, kind: 'end-small',
    text: {zh: '被聽見・被記得・被看見', en: 'Heard · Remembered · Seen'}, note: '不念',
  },
  {
    id: 's10-license', scene: 'S10', in: 84.6, out: 88.5, kind: 'end-meta',
    text: {zh: '免費・開源・Apache-2.0', en: 'Free · Open source · Apache-2.0'},
  },
  {
    id: 's10-url', scene: 'S10', in: 84.6, out: 88.5, kind: 'end-url',
    text: {zh: 'github.com/brian10420/URDiary', en: 'github.com/brian10420/URDiary'},
  },
  {
    id: 's10-disclaimer', scene: 'S10', in: 85.2, out: 88.5, kind: 'end-disclaimer',
    text: {zh: '情緒陪伴，不是醫療或心理治療。', en: 'Emotional companionship — not medical or psychological treatment.'},
  },
];

export const caption = (id: string): CaptionItem => {
  const c = CAPTIONS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown caption ${id}`);
  return c;
};

/** Straight quotes → typographic, for display only (data stays verbatim). */
export const typeset = (s: string): string => s.replace(/(\p{L})'(\p{L})/gu, '$1’$2').replace(/'/g, '’');
