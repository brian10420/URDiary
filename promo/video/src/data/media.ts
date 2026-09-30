/**
 * Media slots. Every picture or sound the film needs has an id; the file lives at
 * public/media/<id>.<ext> (gitignored). scripts/media-manifest.mjs lists what is present at
 * bundle time; a missing file renders a labelled <Placeholder> (pictures) or silence (sound).
 *
 *   ComfyUI shots  G1–G6 (§4.3)          public/media/G1.mp4 …           language-neutral
 *   UI recordings  U02–U16 (§3.1)        public/media/ui/U03-zh.mp4 / ui/U03-en.mp4 (one per UI language;
 *                                        made by scripts/make-intermediates.sh from src/data/shots.ts)
 *   narration      (§1.2)                public/media/narration/zh/S6-A.mp3 …
 *   music bed      (§5.1)                public/media/music/bed-90s.mp3
 *   sound effects  (§5.1 音效 column)     public/media/sfx/<id>.mp3
 */
import type {Lang} from './timeline.ts';

export const VIDEO_EXT = ['mp4', 'webm', 'mov', 'mkv'] as const;
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp'] as const;
export const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] as const;

export type ShotId =
  | 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6'
  | 'U02' | 'U03' | 'U04' | 'U05' | 'U06' | 'U07' | 'U08' | 'U09' | 'U10' | 'U11' | 'U12' | 'U15' | 'U16';

export interface ShotSpec {
  id: ShotId;
  kind: 'comfy' | 'ui';
  /** UI recordings exist once per UI language; ComfyUI shots are shared. */
  perLang: boolean;
  /** Scene name the shot serves (for the placeholder label, e.g. 「G1 ComfyUI — 說不出口的話」). */
  label: string;
  /** The shot's own name in §3 / §4. */
  name: string;
  /** One-line brief shown on the placeholder. */
  brief: string;
  device?: 'desktop' | 'phone';
  /** A still is fine (U05 / U08 / U09 / U11 are 「靜止」 shots). */
  stillOk?: boolean;
  optional?: boolean;
  /** ComfyUI generation length (§4.3), frames @ 24 fps. */
  genFrames?: number;
}

export const SHOTS: Record<ShotId, ShotSpec> = {
  G1: {id: 'G1', kind: 'comfy', perLang: false, label: '說不出口的話', name: '夜裡的書桌', genFrames: 243,
    brief: '夜裡的書桌、暖色小檯燈；手機亮著空白對話框；吉祥物 3/4 側身看手機，約 3 s 轉向鏡頭微笑'},
  G2: {id: 'G2', kind: 'comfy', perLang: false, label: '被看見・左格', name: '開心的日子', genFrames: 124,
    brief: '正面微笑 → 小跳一下、開心瞇眼＋腮紅、3–4 顆金色四角星 → 落地回到微笑'},
  G3: {id: 'G3', kind: 'comfy', perLang: false, label: '被看見・右格', name: '難過的日子', genFrames: 124,
    brief: '窗外下雨；吉祥物平靜地陪著、慢慢呼吸。沒有星星、沒有跳'},
  G4: {id: 'G4', kind: 'comfy', perLang: false, label: '早安', name: '早安', genFrames: 124,
    brief: '清晨窗光；吉祥物捧白色茶杯微微舉起、微笑；右三分之一留給手機'},
  G5: {id: 'G5', kind: 'comfy', perLang: false, label: '療癒自己的事', name: '揮手收尾', genFrames: 124,
    brief: '奶油紙底，吉祥物在左三分之一揮一次手、放下、微笑；尾幀定格'},
  G6: {id: 'G6', kind: 'comfy', perLang: false, label: 'README 循環', name: 'README 搖擺循環', genFrames: 124,
    brief: '±5° 節拍器搖擺（支點 50% 88%），一個循環 3 個來回，中段眨一次眼；首幀＝尾幀'},
  U02: {id: 'U02', kind: 'ui', perLang: true, device: 'desktop', label: '初次見面，取個名字', name: '初次見面＋取名',
    brief: '自我介紹 → 取名邀請 → 打「小樹洞」→ 標題換名 → namingAck'},
  U03: {id: 'U03', kind: 'ui', perLang: true, device: 'desktop', label: '被聽見', name: '傾聽',
    brief: '語晴送出約 100 字的心事 → 思考泡泡 → 回覆浮現'},
  U04: {id: 'U04', kind: 'ui', perLang: true, device: 'desktop', label: '被記得', name: '記得那一天',
    brief: '第二則訊息 → 回覆引用「M 月 D 日《標題》」'},
  U05: {id: 'U05', kind: 'ui', perLang: true, device: 'desktop', stillOk: true, label: '回憶卡', name: '過往日記卡片',
    brief: 'D-16 那篇日記的卡片（日期、心情標籤、20 px 印章、標題）'},
  U06: {id: 'U06', kind: 'ui', perLang: true, device: 'desktop', label: '一段對話，一篇日記', name: '結束對話 → 日記',
    brief: '按「結束對話並生成日記」→ 生成中 → 日記頁新卡片 → 詳情與 40 px 印章卡'},
  U07: {id: 'U07', kind: 'ui', perLang: true, device: 'desktop', label: '今天的印章', name: '今天的印章',
    brief: '行事曆 → 今天那格 14 px 印章 → 日面板 40 px 印章卡＋小語'},
  U08: {id: 'U08', kind: 'ui', perLang: true, device: 'desktop', stillOk: true, label: '月曆全景', name: '月曆全景',
    brief: '月格靜止：≥12 天有印章、跨天橫槓、分類圖標'},
  U09: {id: 'U09', kind: 'ui', perLang: true, device: 'desktop', stillOk: true, label: '好日子印章卡', name: '好日子日面板',
    brief: 'valence ≥0.65 那天的日面板印章卡（例：sun「晴朗有勁」＋小語）'},
  U10: {id: 'U10', kind: 'ui', perLang: true, device: 'desktop', optional: true, label: '存日記彩蛋', name: '開心跳彩蛋（選用）',
    brief: '另一個示範帳號存日記時畫面中央的跳躍彩蛋'},
  U11: {id: 'U11', kind: 'ui', perLang: true, device: 'desktop', stillOk: true, optional: true, label: '難過日印章卡（備援）', name: '難過日子日面板',
    brief: '萬一 S5 那天沒蓋到印章，右格改用種子裡的沉重日印章卡'},
  U12: {id: 'U12', kind: 'ui', perLang: true, device: 'phone', label: '早安', name: '手機早安問候',
    brief: '行動版對話頁 → 思考泡泡 → 端茶小吉祥物＋早安問候'},
  U15: {id: 'U15', kind: 'ui', perLang: true, device: 'desktop', label: '你的記憶，你作主', name: '核可通知 → 使用者檔案 → 帳本',
    brief: '點通知泡泡 → 使用者檔案（游標進文字框）→ 記憶帳本 → 核可一筆 → 已生效'},
  U16: {id: 'U16', kind: 'ui', perLang: true, device: 'desktop', stillOk: true, optional: true, label: 'AI 由你選', name: '供應商字樣（選用）',
    brief: '輸入區上方「AI: Grok (xAI) grok-4.3」'},
};

/**
 * Media id of a shot: ComfyUI shots are `G1`…; UI recordings live in public/media/ui/ as
 * `ui/U03-zh`, and a variant (a second cut of the same take, e.g. the S6 stamp card cropped from
 * U07) is `ui/U07-zh-card`. The ids match src/data/shots.ts CLIPS.
 */
export const shotMediaId = (shot: ShotId, lang: Lang, variant?: string): string =>
  SHOTS[shot].kind === 'ui' ? `ui/${shot}-${lang}${variant ? `-${variant}` : ''}` : SHOTS[shot].perLang ? `${shot}-${lang}` : shot;
export const narrationMediaId = (lineId: string, lang: Lang): string => `narration/${lang}/${lineId}`;
export const MUSIC_BED_ID = 'music/bed-90s';
export const sfxMediaId = (id: string): string => `sfx/${id}`;

// ---------------------------------------------------------------- where each shot plays

/**
 * One placement of a shot on a timeline: shown over [at0, at1] (storyboard seconds). UI recordings
 * are timed by src/data/shots.ts SPEED_MAPS (same key): knots of timeline → take seconds, so the
 * real waits can be sped up without re-encoding. Shots without a map (ComfyUI, until they arrive)
 * play linearly from `srcIn` seconds into the file at `rate` × speed.
 */
export interface Placement {
  shot: ShotId;
  at: readonly [number, number];
  srcIn: number;
  rate: number;
  /** A second cut of the same take (shotMediaId → ui/U07-zh-card). */
  variant?: string;
  /** From this timeline second on, hold the frame reached (S10: 「85.0 起 G5 定格在尾幀」). */
  freezeFrom?: number;
  /** Shot to use when `shot` has no file (S6 right card: U07, else the backup U11). */
  fallback?: ShotId;
  /** Lookup key used by the scenes. */
  key: string;
  note: string;
}

export const INTRO_PLACEMENTS: readonly Placement[] = [
  {key: 'S1.G1', shot: 'G1', at: [0.0, 7.7], srcIn: 0, rate: 1, note: 'S1 全畫面；Remotion 0.6–5.6 推近 100%→106%'},
  {key: 'S2.U02', shot: 'U02', at: [7.5, 16.2], srcIn: 0, rate: 1, note: 'S2 視窗內；思考泡泡的等待可加速'},
  {key: 'S3.U03', shot: 'U03', at: [15.8, 24.0], srcIn: 0, rate: 1, note: 'S3 視窗內；17.2–19.0 真實等待加速'},
  {key: 'S4.U04', shot: 'U04', at: [24.0, 33.2], srcIn: 0, rate: 1, note: 'S4 視窗內；24.8–26.0 思考泡泡加速'},
  {key: 'S4.U05', shot: 'U05', at: [29.6, 32.9], srcIn: 0, rate: 1, note: 'S4 回憶卡（由 MG 裁出卡片）'},
  {key: 'S5.U06', shot: 'U06', at: [32.8, 37.8], srcIn: 0, rate: 1, note: 'S5：生成日記的 30–90 s 等待加速成 1.4 s（33.9–35.3）'},
  {key: 'S5.U07', shot: 'U07', at: [37.8, 42.7], srcIn: 0, rate: 1, note: 'S5 行事曆 → 今天那格 → 日面板（到 42.7，印章配對剪接蓋過去）'},
  {key: 'S6.G2', shot: 'G2', at: [43.0, 51.0], srcIn: 0, rate: 1, note: 'S6 左格；46.8 起降到 60% 亮度'},
  {key: 'S6.U09', shot: 'U09', at: [43.4, 51.0], srcIn: 0, rate: 1, note: 'S6 左格下方的印章卡'},
  {key: 'S6.U10', shot: 'U10', at: [44.6, 45.4], srcIn: 0, rate: 1, note: 'S6 左下角 0.8 s 小窗（選用）'},
  {key: 'S6.G3', shot: 'G3', at: [46.8, 51.2], srcIn: 0, rate: 1, note: 'S6 右格'},
  {key: 'S6.card', shot: 'U07', variant: 'card', fallback: 'U11', at: [47.2, 51.2], srcIn: 0, rate: 1, note: 'S6 右格下方：S5 錄到的鼓勵組印章卡（U07 日面板裁切 ui/U07-<lang>-card；沒蓋到就換 U11）'},
  {key: 'S7.G4', shot: 'G4', at: [50.6, 60.1], srcIn: 0, rate: 1, note: 'S7a 全畫面，之後當手機底圖'},
  {key: 'S7.U12', shot: 'U12', at: [53.2, 60.1], srcIn: 0, rate: 1, note: 'S7b 手機畫面（54.2 起）'},
  {key: 'S8.U15', shot: 'U15', at: [59.6, 68.2], srcIn: 0, rate: 1, note: 'S8 視窗內'},
  {key: 'S9.U16', shot: 'U16', at: [73.6, 74.6], srcIn: 0, rate: 1, note: 'S9 可選 1 s（storyboard 寫在 75.0–80.0 那段；放在供應商段，Grok 亮起時）'},
  {key: 'S10.G5', shot: 'G5', at: [79.8, 88.5], srcIn: 0, rate: 1, freezeFrom: 85.0, note: 'S10 左三分之一；85.0 起定格在尾幀'},
];

export const LOOP_PLACEMENTS: readonly Placement[] = [
  {key: 'L.G6', shot: 'G6', at: [0.0, 20.0], srcIn: 0, rate: 1, note: '相位由 loop.ts 的 heroPhase() 決定（不是線性播放）'},
  {key: 'L.U03', shot: 'U03', at: [3.5, 8.0], srcIn: 0, rate: 1, note: 'en 裁切：她的訊息泡泡 → 思考泡泡 → 回覆前兩行（3.5–4.0 隨紙張滑入）'},
  {key: 'L.U04', shot: 'U04', at: [8.0, 12.0], srcIn: 0, rate: 1, note: 'en 裁切＋螢光筆掃過「日期＋標題」'},
  {key: 'L.U06', shot: 'U06', at: [12.0, 13.5], srcIn: 0, rate: 1, note: '新日記卡（13.5 切到月格）'},
  {key: 'L.U08', shot: 'U08', at: [13.5, 17.0], srcIn: 0, rate: 1, note: '真實的靜態月格；MG 依序圈 2–3 枚印章（16.5–17.0 被紙張蓋過）'},
];

// ---------------------------------------------------------------- MG annotation targets

type Rect = readonly [number, number, number, number];
/** Same rect in both UI languages. */
const both = (r: Rect): Record<Lang, Rect> => ({zh: r, en: r});

/**
 * Where the MG circles / highlighter / camera pushes land, in the recording's own CSS pixels
 * (desktop 1920×1080, phone 390×844), per UI language — zh and en layouts differ (button widths,
 * where a quote wraps). Measured on the ★ takes (frames at the moment each mark is shown; bubble
 * and card bounds by flood fill, text lines by ink rows). `provisional: true` = not measured yet
 * (drawn as a dashed box in placeholders).
 */
export interface Target {
  shot: ShotId;
  rect: Record<Lang, Rect>;
  label: string;
  provisional: boolean;
}

export const TARGETS = {
  s2Title: {shot: 'U02', rect: {zh: [36, 109, 62, 28], en: [36, 110, 86, 26]}, label: '對話標題（換成小樹洞）', provisional: false},
  s3Reply: {shot: 'U03', rect: {zh: [92, 428, 1054, 140], en: [92, 428, 1298, 116]}, label: '回覆（推近目標）', provisional: false},
  s4Reply: {shot: 'U04', rect: both([92, 521, 1298, 164]), label: '第二則回覆（推近目標）', provisional: false},
  // zh (v3.1): the paraphrased recall 「你之前第一次上台報告前也失眠到半夜爬起來順講稿」— no date / title in zh takes.
  // en: "September 14 entry, “Sleepless before my first presentation,”" (U04 en-take7).
  s4Quote: {shot: 'U04', rect: {zh: [103, 603, 375, 28], en: [264, 603, 456, 28]}, label: '回憶句／日期＋標題（螢光筆）', provisional: false},
  // Where the memory card floats: right of the reply, clear of her second message (y 436–500).
  s4CardSlot: {shot: 'U04', rect: {zh: [1430, 506, 440, 254], en: [1430, 500, 440, 285]}, label: '回憶卡位置', provisional: false},
  s5EndButton: {shot: 'U06', rect: {zh: [856, 939, 208, 55], en: [841, 939, 238, 55]}, label: '「結束對話並生成日記」按鈕', provisional: false},
  s5NewCard: {shot: 'U06', rect: {zh: [993, 157, 286, 159], en: [993, 157, 286, 180]}, label: '日記頁最上面的新卡片', provisional: false},
  s5StampCard: {shot: 'U06', rect: {zh: [983, 246, 330, 59], en: [983, 246, 420, 59]}, label: '詳情頁印章卡（推近）', provisional: false},
  s5TodayCell: {shot: 'U07', rect: both([466, 757, 208, 119]), label: '今天那格（推近）', provisional: false},
  s5TodayStamp: {shot: 'U07', rect: both([662, 757, 14, 14]), label: '今天那格的 14 px 印章', provisional: false},
  s5PanelCard: {shot: 'U07', rect: {zh: [1603, 257, 282, 106], en: [1603, 257, 282, 126]}, label: '日面板印章卡', provisional: false},
  s5PanelStamp: {shot: 'U07', rect: both([1617, 292, 34, 32]), label: '日面板 40 px 印章（配對剪接起點）', provisional: false},
  u10Egg: {shot: 'U10', rect: both([795, 455, 320, 180]), label: '存日記彩蛋（裁切）', provisional: false},
  s8Notice: {shot: 'U15', rect: {zh: [92, 641, 753, 44], en: [92, 641, 1107, 44]}, label: '溫暖通知泡泡', provisional: false},
  s8Modal: {shot: 'U15', rect: both([640, 192, 640, 626]), label: '記憶視窗（推近）', provisional: false},
  s8ProfileText: {shot: 'U15', rect: both([690, 385, 60, 30]), label: '使用者檔案文字框', provisional: false},
  s8LedgerTab: {shot: 'U15', rect: {zh: [873, 276, 110, 42], en: [926, 276, 154, 42]}, label: '「記憶帳本」分頁', provisional: false},
  s8Approve: {shot: 'U15', rect: {zh: [1157, 468, 42, 22], en: [1120, 511, 66, 21]}, label: '「核可」按鈕', provisional: false},
  // ReadmeLoop crops (en takes; aspect = the loop panel 1160×450) and marks
  loopChat: {shot: 'U03', rect: both([60, 150, 1320, 512]), label: '對話欄（裁切）', provisional: false},
  loopMemory: {shot: 'U04', rect: both([60, 272, 1320, 512]), label: '回覆＋引用（裁切）', provisional: false},
  loopDiary: {shot: 'U06', rect: both([940, 88, 980, 380]), label: '新日記卡（裁切）', provisional: false},
  loopMonth: {shot: 'U08', rect: both([460, 480, 1108, 430]), label: '月格（裁切）', provisional: false},
  loopQuote: {shot: 'U04', rect: both([264, 603, 456, 28]), label: '日期＋標題（螢光筆）', provisional: false},
  loopStampA: {shot: 'U08', rect: both([886, 629, 10, 9]), label: '印章 9/24（相機）', provisional: false},
  loopStampB: {shot: 'U08', rect: both([1330, 499, 10, 9]), label: '印章 9/19（音樂）', provisional: false},
  loopStampC: {shot: 'U08', rect: both([1330, 629, 10, 9]), label: '印章 9/26（太陽）', provisional: false},
} as const satisfies Record<string, Target>;

export type TargetId = keyof typeof TARGETS;
export const targetRect = (id: TargetId, lang: Lang): Rect => TARGETS[id].rect[lang];

const byKey = (list: readonly Placement[], key: string): Placement => {
  const p = list.find((x) => x.key === key);
  if (!p) throw new Error(`no placement "${key}"`);
  return p;
};
export const introPlacement = (key: string): Placement => byKey(INTRO_PLACEMENTS, key);
export const loopPlacement = (key: string): Placement => byKey(LOOP_PLACEMENTS, key);

export const RECORDING_SIZE = {desktop: {w: 1920, h: 1080}, phone: {w: 390, h: 844}} as const;
