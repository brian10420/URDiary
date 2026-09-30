#!/usr/bin/env node
/**
 * URDiary 介紹影片 UI 錄影器（v2.6 1e.2）——照 promo/video/STORYBOARD.md §3 的鏡頭表，
 * 用 Playwright 驅動「隔離的 demo 後端」(127.0.0.1:8124) 上真實的 App，錄成影片。
 *
 * 錄法（為什麼這樣錄，見 README）：
 *   - headless Chromium，用「原生」縮放（--force-device-scale-factor＋--window-size，不開 Playwright 的
 *     viewport 模擬）：模擬 DPR 時 CDP screencast 只給 CSS 尺寸的畫面，原生縮放才拿得到 3840×2160。
 *   - GPU 合成（ANGLE/GL-EGL）：軟體合成在 4K 只有 ~25 fps，GPU 約 60 fps（URDIARY_REC_GPU=0 可關）。
 *   - CDP Page.startScreencast(png) 逐幀存檔＋時間戳，之後用 ffmpeg concat（每幀時長＝下一幀時間差）
 *     補成固定 60 fps 的中間檔（預設 ProRes 422 HQ，可改 H.264 CRF 12）。
 *
 * 用法（在 repo 根目錄；URDIARY_DATA_DIR＝seed_demo.py 種好的目錄，demo 後端已在 8124 跑著）：
 *   node promo/record/record_shots.js --list                              # session 與鏡頭一覽
 *   node promo/record/record_shots.js --session chain --lang zh [--role copy] [--attempts 3] [--strict-recall]
 *     （zh 的 recall 閘門也接受清楚指向 D-16 的轉述式回憶；--strict-recall 改回只認「日期＋《標題》」）
 *   node promo/record/record_shots.js --session phone --lang en           # 其餘：hello whatever login phonecal browse happy
 *   node promo/record/record_shots.js --assemble [--shot U03,U04] [--codec prores|h264] [--threads N] [--keep-raw]
 *   node promo/record/record_shots.js --retrim                            # 修正 -t 之前組裝、尾巴多一段的檔
 *   node promo/record/record_shots.js --sheets                            # 只重做 contact sheet
 *   node promo/record/record_shots.js --shotlog                           # SHOTLOG.md（併入 <out>/_picks.json）
 *   node promo/record/record_shots.js --session morning --lang zh --at 2026-10-01T05:05:00+14:00   # U12 主方案（D+1 早上）
 *   共用：--out DIR（預設 /mnt/Data_SSD/urdiary-media/recordings）、--phone-dpr 2|3、
 *         --tz <IANA 時區>（瀏覽器時區；預設取種子 manifest 的時區，也就是後端的 URDIARY_TIMEZONE）
 *
 * 鐵律：只連 8124；不讀、不碰金鑰（金鑰只由 run_demo_backend.sh 交給後端）；錄影檔只寫到 --out
 * （預設 /mnt/Data_SSD/urdiary-media/recordings/）。重拍前的狀態重設一律走 seed_demo.py 的維護旗標。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const { chromium, devices } = require(path.join(REPO, 'desktop', 'node_modules', 'playwright'));

const BASE_URL = 'http://127.0.0.1:8124/';
const PY = path.join(REPO, '.venv', 'bin', 'python');
const SEEDER = path.join(REPO, 'promo', 'demo', 'seed_demo.py');
const PERSONA_FILES = { zh: 'promo/demo/personas/zh.json', en: 'promo/demo/personas/en.json' };
const UI_LANG = { zh: 'zh-TW', en: 'en' };
const LOCALE = { zh: 'zh-TW', en: 'en-US' };
const STUB_MARK = '[urdiary-e2e-stub]';

// ---------------------------------------------------------------------------
// 裝置
// ---------------------------------------------------------------------------
const DEVICES = {
  desktop: { width: 1920, height: 1080, dpr: 2 },
  phone: { width: 390, height: 844, dpr: 3, userAgent: devices['iPhone 14'].userAgent, touch: true },
};

// ---------------------------------------------------------------------------
// 鏡頭表（資料）。每個 session 是一個瀏覽器 context 裡的一串步驟；['rec', 'Uxx'] 到 ['stop'] 之間
// 錄成一個檔。步驟語彙見下方 ACTIONS。role＝persona JSON 的 accounts 角色（main/copy/hello）。
// ---------------------------------------------------------------------------
const SESSIONS = {
  // U02：全新帳號初次見面＋取名（純腳本，不打 LLM）。設定裡先登入一次（初次見面還沒答任何題，不會存東西）
  // 開關一次設定（模型顯示 grok-4.3），再切換使用者重新登入——錄「按下登入 → 自我介紹 → 取名」
  hello: {
    device: 'desktop', role: 'hello', shots: ['U02'],
    steps: [
      ['seed', '--reset-hello'], ['open'], ['login'], ['awaitScript', 'onboarding.naming'], ['touchSettings'],
      ['openSwitchUser'], ['pickProfile'], ['fillPassword'],
      ['rec', 'U02'], ['hold', 1.5], ['submitLogin'], ['awaitScript', 'onboarding.naming'], ['hold', 1.4],
      ['clickInput'], ['hold', 0.4], ['type', 'persona:companion.companion_name'], ['hold', 0.6], ['press', 'Enter'],
      ['awaitTitle', 'persona:companion.companion_name'], ['awaitScript', 'onboarding.namingAck'], ['hold', 3.5], ['stop'],
    ],
  },
  // U17：取名題回「隨便」→ 預設名字（選用備份）
  whatever: {
    device: 'desktop', role: 'hello', shots: ['U17'],
    steps: [
      ['seed', '--reset-hello'], ['open'], ['login'], ['awaitScript', 'onboarding.naming'], ['touchSettings'],
      ['openSwitchUser'], ['pickProfile'], ['fillPassword'],
      ['rec', 'U17'], ['hold', 1.5], ['submitLogin'], ['awaitScript', 'onboarding.naming'], ['hold', 1.4],
      ['clickInput'], ['hold', 0.4], ['type', 'lang:隨便|whatever'], ['hold', 0.6], ['press', 'Enter'],
      ['awaitScript', 'onboarding.nameDefaulted'], ['hold', 3.5], ['stop'],
    ],
  },
  // U01：登入歡迎（帳號清單 → 密碼框的揮手吉祥物）。先真的登入一次讓帳號進清單，再從設定登出
  login: {
    device: 'desktop', role: 'main', shots: ['U01'],
    steps: [
      ['seed', '--set-checkin', 'today'], ['open'], ['login'], ['awaitOpening'], ['logout'],
      ['rec', 'U01'], ['hold', 1.5], ['pickProfile'], ['hold', 4.5], ['stop'],
    ],
  },
  // U12＋U13：手機。先登入（問候標成已做）→ 開關一次設定 → 把問候重新排上 → 切換使用者重新登入，
  // 錄「按下登入 → 思考泡泡 → 端茶問候」，接著點底部「行事曆」
  phone: {
    device: 'phone', role: 'main', llm: true, shots: ['U12', 'U13'],
    steps: [
      ['seed', '--set-checkin', 'today', '--clear-chat'], ['open'], ['login'], ['awaitOpening'], ['touchSettings'],
      ['seed', '--set-checkin', 'yesterday', '--clear-chat'], ['openSwitchUser'], ['pickProfile'], ['fillPassword'],
      ['rec', 'U12'], ['hold', 1.5], ['submitLogin'], ['awaitCheckin'], ['hold', 3.5], ['stop'],
      ['rec', 'U13'], ['hold', 1.5], ['nav', 'calendar'], ['awaitCalendar'], ['hold', 3.5], ['stop'],
    ],
  },
  // U13 單獨重拍（不打 LLM：問候先標成已做）
  phonecal: {
    device: 'phone', role: 'main', shots: ['U13'],
    steps: [
      ['seed', '--set-checkin', 'today', '--clear-chat'], ['open'], ['login'], ['awaitOpening'], ['touchSettings'],
      ['relogin'], ['awaitOpening'], ['hold', 0.5],
      ['rec', 'U13'], ['hold', 1.5], ['nav', 'calendar'], ['awaitCalendar'], ['hold', 3.5], ['stop'],
    ],
  },
  // U12＋U13 主方案（D+1 早上、「昨天」＝主線 U06 寫出的真日記）：設定階段（登入、開關設定、停在密碼框）
  // 在後端的換日時刻（05:00）之前做完；--at 指定的時間一到才按登入——那一刻才是這一天第一次呼叫 check-in，
  // 整段錄進去。要在白天之外的時段錄，就把 demo 後端與種子放在別的時區（URDIARY_TIMEZONE）、瀏覽器用 --tz 對齊。
  morning: {
    device: 'phone', role: 'main', llm: true, shots: ['U12', 'U13'],
    steps: [
      ['seed', '--set-checkin', 'today', '--clear-chat'], ['open'], ['login'], ['awaitOpening'], ['touchSettings'], ['preflightMic'],
      ['openSwitchUser'], ['pickProfile'], ['fillPassword'], ['waitUntil'],
      ['rec', 'U12'], ['hold', 1.5], ['submitLogin'], ['awaitCheckin'], ['hold', 3.5], ['stop'],
      ['rec', 'U13'], ['hold', 1.5], ['nav', 'calendar'], ['awaitCalendar'], ['hold', 3.5], ['stop'],
    ],
  },
  // 同一帳號的重拍：時間到了先把問候改回「昨天」並清掉上一句（分鏡的重拍方式），再按登入
  morning2: {
    device: 'phone', role: 'main', llm: true, shots: ['U12', 'U13'],
    steps: [
      ['seed', '--set-checkin', 'today', '--clear-chat'], ['open'], ['login'], ['awaitOpening'], ['touchSettings'], ['preflightMic'],
      ['openSwitchUser'], ['pickProfile'], ['fillPassword'], ['waitUntil'], ['seed', '--set-checkin', 'yesterday', '--clear-chat'],
      ['rec', 'U12'], ['hold', 1.5], ['submitLogin'], ['awaitCheckin'], ['hold', 3.5], ['stop'],
      ['rec', 'U13'], ['hold', 1.5], ['nav', 'calendar'], ['awaitCalendar'], ['hold', 3.5], ['stop'],
    ],
  },
  // 瀏覽種子資料：U16、U05、U08、U09、U11、U14（不打 LLM：問候先標成已做）
  browse: {
    device: 'desktop', role: 'main', shots: ['U16', 'U05', 'U08', 'U09', 'U11', 'U14'],
    steps: [
      ['seed', '--set-checkin', 'today', '--clear-chat'], ['open'], ['login'], ['awaitOpening'], ['touchSettings'],
      ['relogin'], ['awaitOpening'], ['hold', 0.5],
      ['rec', 'U16'], ['hold', 4], ['stop'],
      ['rec', 'U05'], ['hold', 1.5], ['nav', 'diary'], ['awaitDiaryList'], ['hold', 1.5], ['scrollToDiary', 'recall_target_day'], ['hold', 5.5], ['stop'],
      ['rec', 'U08'], ['hold', 1.5], ['nav', 'calendar'], ['awaitCalendar'], ['hold', 5.5], ['ymPicker'], ['hold', 1.8], ['press', 'Escape'], ['hold', 2], ['stop'],
      ['rec', 'U09'], ['hold', 1.5], ['clickDay', 'bright_day'], ['hold', 4.5], ['stop'],
      ['rec', 'U11'], ['hold', 1.5], ['clickDay', 'heavy_day'], ['hold', 6], ['stop'],
      ['rec', 'U14'], ['hold', 1.5], ['openMemoryFromSettings'], ['hold', 2], ['clickProfileText'], ['hold', 3.5], ['stop'],
    ],
  },
  // 主線：U03 傾聽 → U04 記得那一天 →（有引用才往下，或次數用完）U06 結束對話 → U07 今天的印章 → U15 核可
  chain: {
    device: 'desktop', role: 'main', llm: true, shots: ['U03', 'U04', 'U06', 'U07', 'U15'],
    steps: [
      ['seed', '--set-checkin', 'today', '--clear-chat'], ['open'], ['login'], ['awaitOpening'], ['touchSettings'],
      ['seed', '--set-checkin', 'yesterday', '--clear-chat'], ['relogin'], ['awaitOpening'], ['hold', 1],
      ['rec', 'U03'], ['hold', 1.5], ['clickInput'], ['hold', 0.5], ['type', 'demo:u03'], ['hold', 0.8], ['send'], ['hold', 5], ['stop'],
      ['rec', 'U04'], ['hold', 1.5], ['clickInput'], ['hold', 0.5], ['type', 'demo:u04'], ['hold', 0.8], ['send'], ['hold', 5], ['stop'],
      ['gate', 'recall'],
      ['rec', 'U06'], ['hold', 1.5], ['endChat'], ['awaitNewDiaryCard'], ['hold', 1.5], ['openFirstDiary'], ['hold', 3.5], ['stop'],
      ['rec', 'U07'], ['hold', 1.5], ['nav', 'calendar'], ['awaitCalendar'], ['hold', 2], ['clickDay', 'today'], ['hold', 4.5], ['stop'],
      ['gate', 'pending'],
      ['rec', 'U15'], ['hold', 1.5], ['nav', 'chat'], ['hold', 1.5], ['openMemoryFromNotice'], ['hold', 2], ['clickProfileText'],
      ['hold', 2], ['ledgerTab'], ['hold', 2.5], ['approveOneAdd'], ['hold', 2.5], ['stop'],
    ],
  },
  // U10：複本帳號聊兩則開心小事 → 結束對話 → 畫面中央的跳躍彩蛋（要在 05:00–21:59 錄）
  happy: {
    device: 'desktop', role: 'copy', llm: true, shots: ['U10'],
    steps: [
      ['seed', '--set-checkin', 'today', '--clear-chat'], ['open'], ['login'], ['awaitOpening'], ['touchSettings'],
      ['relogin'], ['awaitOpening'], ['hold', 0.5],
      ['rec', 'U10'], ['hold', 1.5], ['clickInput'], ['hold', 0.4], ['type', 'demo:u10.0'], ['hold', 0.7], ['send'], ['hold', 2],
      ['clickInput'], ['hold', 0.4], ['type', 'demo:u10.1'], ['hold', 0.7], ['send'], ['hold', 2], ['endChat'], ['hold', 4], ['stop'],
    ],
  },
};

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;
const pad = (n, w = 6) => String(n).padStart(w, '0');
const log = (...a) => console.log(`[rec ${new Date().toTimeString().slice(0, 8)}]`, ...a);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, obj) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }

function getPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[/^\d+$/.test(k) ? Number(k) : k]), obj);
}

function isoAddDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function ffmpegPaths() {
  let ffmpeg = process.env.URDIARY_FFMPEG;
  let ffprobe = process.env.URDIARY_FFPROBE;
  if (!ffmpeg || !ffprobe) {
    const helper = '/mnt/Data_SSD/ComfyUI/.venv/bin/static_ffmpeg_paths';
    const r = spawnSync(helper, [], { encoding: 'utf8' });
    const txt = (r.stdout || '') + (r.stderr || '');
    ffmpeg = ffmpeg || (txt.match(/^FFMPEG=(.+)$/m) || [])[1];
    ffprobe = ffprobe || (txt.match(/^FFPROBE=(.+)$/m) || [])[1];
  }
  if (!ffmpeg || !ffprobe) throw new Error('ffmpeg/ffprobe not found: set URDIARY_FFMPEG and URDIARY_FFPROBE');
  return { ffmpeg: ffmpeg.trim(), ffprobe: ffprobe.trim() };
}

// 危機詞表：直接從後端原始碼讀（不 import 後端——config.py 一 import 就會寫檔）
function crisisWords() {
  const src = fs.readFileSync(path.join(REPO, 'backend/app/services/diary_service.py'), 'utf8');
  const words = [];
  for (const name of ['SENSITIVE_WORDS_ACUTE', 'SENSITIVE_WORDS_CONTEXTUAL']) {
    const m = src.match(new RegExp(name + '\\s*=\\s*\\[([\\s\\S]*?)\\]'));
    if (m) for (const q of m[1].matchAll(/"([^"]+)"/g)) words.push(q[1].toLowerCase());
  }
  return words;
}

// 記憶檔的節標題（兩種語言）：直接從後端原始碼讀 SECTION_TITLES（同上，不 import 後端）
function sectionTitles() {
  const src = fs.readFileSync(path.join(REPO, 'backend/app/services/memory_files.py'), 'utf8');
  const m = src.match(/SECTION_TITLES\s*=\s*\{([\s\S]*?)\n\}/);
  const out = { 'zh-TW': [], en: [] };
  if (m) for (const q of m[1].matchAll(/"zh-TW":\s*"([^"]+)",\s*"en":\s*"([^"]+)"/g)) { out['zh-TW'].push(q[1]); out.en.push(q[2]); }
  if (!out.en.length) throw new Error('could not parse SECTION_TITLES from memory_files.py');
  return out;
}

// 每日問候的時段稱呼：和後端 interaction_service._time_of_day_label 同一張表（後端時區的牆上小時）
function timeOfDayLabel(hour, lang) {
  const en = lang === 'en';
  if (hour >= 5 && hour < 11) return en ? 'morning' : '早上';
  if (hour >= 11 && hour < 14) return en ? 'midday' : '中午';
  if (hour >= 14 && hour < 18) return en ? 'afternoon' : '下午';
  if (hour >= 18 && hour < 23) return en ? 'evening' : '晚上';
  return en ? 'late night' : '深夜';
}
function tzClock(epochSec, tz) {
  const s = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(epochSec * 1000));
  return { hhmm: s, hour: Number(s.slice(0, 2)) };
}
// 問候裡和「晚上」衝突的「打招呼」字眼（只做提示，最後仍看原文）。只抓問候語本身：
// 「今天下午的 meeting」「the meeting this afternoon」是在說 14:00 那場會，不算衝突
const TIME_CONFLICTS = {
  zh: [/早安/, /早上好/, /早啊/, /午安/, /中午好/, /下午好/, /晚安/, /深夜/, /凌晨/, /這麼晚/],
  en: [/^\W*(good\s+)?(morning|afternoon)\b/i, /\bgood\s+(morning|afternoon|night)\b/i, /\blate\s+night\b/i, /\bup so late\b/i, /\bstill up\b/i],
};
function timeConflicts(text, lang) {
  return [...new Set(TIME_CONFLICTS[lang].map((re) => (String(text || '').match(re) || [])[0]).filter(Boolean))];
}

// 麥克風鍵的像素驗收：從「真的錄到的那一幀」裁出按鈕（裝置像素），灰階化後找出墨跡。
// FA6 的 microphone（f130）是實心膠囊＋U 形支架＋底座：墨跡外框高寬比約 1.45，外框中上段
// （膠囊）幾乎全是墨。修好之前的空圓沒有這個實心核心。回傳量測值與 ok。
let FF = null;
function ff() { return FF || (FF = ffmpegPaths()); }
function micPixelCheck(pngPath, box, dpr) {
  const x = Math.max(0, Math.round(box.x * dpr)), y = Math.max(0, Math.round(box.y * dpr));
  const w = Math.round(box.w * dpr), h = Math.round(box.h * dpr);
  if (w < 8 || h < 8) return { ok: false, reason: 'button box too small' };
  const r = spawnSync(ff().ffmpeg, ['-v', 'error', '-i', pngPath, '-vf', `crop=${w}:${h}:${x}:${y},format=gray`,
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { encoding: 'buffer', maxBuffer: 1 << 24 });
  if (r.status !== 0 || !r.stdout || r.stdout.length < w * h) return { ok: false, reason: `ffmpeg crop failed: ${String(r.stderr || '').trim()}` };
  const px = r.stdout;
  const sorted = Array.from(px.subarray(0, w * h)).sort((a, b) => a - b);
  const bg = sorted[Math.floor(sorted.length / 2)];
  let ink = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (Math.abs(px[j * w + i] - bg) > 48) { ink++; if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
  }
  if (!ink) return { ok: false, bg, ink: 0, reason: 'no ink in the button (empty)' };
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  let core = 0, coreN = 0;
  for (let j = y0 + Math.round(bh * 0.12); j <= y0 + Math.round(bh * 0.45); j++) {
    for (let i = x0 + Math.round(bw * 0.38); i <= x0 + Math.round(bw * 0.62); i++) { coreN++; if (Math.abs(px[j * w + i] - bg) > 48) core++; }
  }
  const coreRatio = coreN ? core / coreN : 0;
  const aspect = bh / bw;
  const ok = coreRatio >= 0.6 && aspect >= 1.2 && aspect <= 1.8 && bh >= h * 0.2;
  return { ok, bg, ink, ink_ratio: +(ink / (w * h)).toFixed(3), glyph_px: `${bw}x${bh}`, aspect: +aspect.toFixed(2),
    core_ink: +coreRatio.toFixed(2), crop: `${w}x${h}+${x}+${y}` };
}

// 錄影中的唯讀探針（不改 DOM）：麥克風鍵、頁尾、記憶視窗的節標題、畫面上的文字
function probePage(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && b.bottom > 0 && b.right > 0 && b.top < innerHeight && b.left < innerWidth;
    };
    const rect = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
    const out = {};
    const btn = document.getElementById('mic-button');
    const icon = btn && btn.querySelector('i');
    let rule = false;
    for (const sh of Array.from(document.styleSheets)) {
      let rules = null;
      try { rules = sh.cssRules; } catch (e) { continue; }
      for (const ru of Array.from(rules || [])) {
        if (ru.selectorText && /\.fa-microphone::?before/.test(ru.selectorText) && ru.style &&
          (ru.style.content.includes('\uf130') || /f130/i.test(ru.style.content))) rule = true;
      }
    }
    let onTop = false;
    if (btn && vis(btn)) {
      const b = btn.getBoundingClientRect();
      const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      onTop = !!el && (el === btn || btn.contains(el));
    }
    const before = icon ? getComputedStyle(icon, '::before').content : null;
    out.mic = { present: !!btn, visible: vis(btn), on_top: onTop, css_rule: rule,
      before_is_f130: !!before && (before.includes('\uf130') || /f130/i.test(before)),
      font_loaded: document.fonts.check('900 16px "Font Awesome 6 Free"', '\uf130'),
      icon_w: icon ? +icon.getBoundingClientRect().width.toFixed(1) : 0,
      button_box: btn && vis(btn) ? rect(btn) : null, dpr: devicePixelRatio };
    const f = document.querySelector('.app-footer');
    out.footer = f ? { visible: vis(f), text: f.textContent.trim() } : null;
    const md = document.getElementById('memory-dialog');
    if (md && vis(md)) {
      const heads = (id) => { const ta = document.getElementById(id); return ta ? (ta.value.match(/^##[ \t]+.+$/gm) || []).map((s) => s.replace(/^##[ \t]+/, '').trim()) : []; };
      out.memory = { profile_headings: heads('memory-profile-text'), companion_headings: heads('memory-companion-text'),
        ledger_rows: Array.from(document.querySelectorAll('#memory-ledger-list .memory-op-text')).map((n) => n.textContent.trim()).slice(0, 40) };
    }
    out.page_text = document.body.innerText || '';
    return out;
  });
}

// 一個 take 開頭與結尾的探針 → 驗收資料（麥克風像素取「按鈕在最上層」的那一端的真實幀）
function acceptanceFromProbes(start, end, meta, rawDir) {
  CRISIS_WORDS = CRISIS_WORDS || crisisWords();
  const ends = [['end', end], ['start', start]].filter(([, p]) => p && !p.error);
  const texts = ends.map(([, p]) => (p.page_text || '').toLowerCase());
  const out = {
    page: { stub: ends.some(([, p]) => (p.page_text || '').includes(STUB_MARK)),
      crisis: CRISIS_WORDS.filter((w) => texts.some((t) => t.includes(w))) },
    errors: [start && start.error, end && end.error].filter(Boolean),
  };
  const anyMic = ends.map(([, p]) => p.mic).find(Boolean);
  if (anyMic) {
    out.mic = { css_rule: anyMic.css_rule, before_is_f130: anyMic.before_is_f130, font_loaded: anyMic.font_loaded,
      icon_w: anyMic.icon_w, sampled: null, pixel: null };
    const frames = meta.frames.slice().sort((a, b) => a.t - b.t);
    for (const [which, p] of ends) {
      if (!(p.mic && p.mic.visible && p.mic.on_top && p.mic.button_box)) continue;
      const f = which === 'end' ? frames[frames.length - 1] : frames[0];
      out.mic.sampled = `${which} frame ${f.file}`;
      try { out.mic.pixel = micPixelCheck(path.join(rawDir, f.file), p.mic.button_box, p.mic.dpr || 1); } catch (e) { out.mic.pixel = { ok: false, reason: String(e.message || e) }; }
      break;
    }
  }
  const foot = ends.map(([, p]) => p.footer).find((x) => x && x.visible) || ends.map(([, p]) => p.footer).find(Boolean);
  if (foot) out.footer = foot;
  const mem = ends.map(([, p]) => p.memory).find(Boolean);
  if (mem) out.memory = mem;
  return out;
}
let CRISIS_WORDS = null;

// ---------------------------------------------------------------------------
// 錄影（CDP screencast → 逐幀 PNG＋時間戳）
// ---------------------------------------------------------------------------
// Chromium 的 screencast 會把「最後一次有變化的那一幀」壓著，等下一個合成幀才送出：畫面在動作之後
// 靜止下來（例如記憶帳本核可後重繪），最後的狀態就永遠錄不到。所以只要超過 ~0.1 s 沒收到幀，就發一次
// Page.captureScreenshot（不動 DOM、截圖本身丟掉）逼出下一個合成幀，被壓著的那一幀就會送出來。
const FLUSH_IDLE_S = 0.1;      // 多久沒收到幀就 flush
const FLUSH_MIN_GAP_S = 0.25;  // 兩次 flush 至少間隔（靜止時約每 0.3 s 一幀）

class Capture {
  constructor(cdp, dir, device) {
    this.cdp = cdp; this.dir = dir; this.device = device;
    this.frames = []; this.writes = []; this.n = 0; this.active = false;
    this.lastArrival = 0; this.lastFlush = 0; this.flushing = false; this.flushes = 0; this.flusher = null;
    this.onFrame = (f) => {
      this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
      this.lastArrival = now();
      if (!this.active) return;
      const file = `f_${pad(this.n++)}.png`;
      this.frames.push({ file, t: f.metadata.timestamp });
      this.writes.push(fs.promises.writeFile(path.join(this.dir, file), Buffer.from(f.data, 'base64')));
    };
  }

  async start() {
    fs.mkdirSync(this.dir, { recursive: true });
    const W = this.device.width * this.device.dpr;
    const H = this.device.height * this.device.dpr;
    // 第 0 幀：開錄當下的截圖（畫面靜止時 screencast 不會主動送幀）
    const t0 = now();
    const shot = await this.cdp.send('Page.captureScreenshot', { format: 'png' });
    const file0 = `f_${pad(this.n++)}.png`;
    fs.writeFileSync(path.join(this.dir, file0), Buffer.from(shot.data, 'base64'));
    this.frames.push({ file: file0, t: t0 });
    this.t0 = t0;
    this.active = true;
    this.cdp.on('Page.screencastFrame', this.onFrame);
    await this.cdp.send('Page.startScreencast', { format: 'png', maxWidth: W, maxHeight: H, everyNthFrame: 1 });
    this.lastArrival = now();
    this.flusher = setInterval(() => { this.maybeFlush(); }, 50);
  }

  async flush() {
    this.flushing = true; this.lastFlush = now(); this.flushes++;
    try { await this.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 10, optimizeForSpeed: true }); } catch (e) { /* ignore */ }
    this.flushing = false;
  }

  maybeFlush() {
    if (!this.active || this.flushing) return;
    const t = now();
    if (t - this.lastArrival < FLUSH_IDLE_S || t - this.lastFlush < FLUSH_MIN_GAP_S) return;
    this.flush();
  }

  async stop() {
    clearInterval(this.flusher);
    // 最後再 flush 一次，確保收尾那一刻的畫面有送出來
    while (this.flushing) await sleep(10);
    await this.flush();
    await sleep(150);
    const tEnd = now();
    this.active = false;
    await this.cdp.send('Page.stopScreencast').catch(() => {});
    this.cdp.off('Page.screencastFrame', this.onFrame);
    await Promise.all(this.writes);
    const frames = this.frames.slice().sort((a, b) => a.t - b.t);
    const gaps = frames.slice(1).map((f, i) => f.t - frames[i].t).sort((a, b) => a - b);
    const q = (p) => (gaps.length ? Math.round(gaps[Math.floor(p * (gaps.length - 1))] * 1000) : null);
    const meta = { t0: this.t0, tEnd, frames, width: this.device.width * this.device.dpr,
      height: this.device.height * this.device.dpr,
      stats: { count: frames.length, p50_ms: q(0.5), p95_ms: q(0.95), max_ms: q(1), flushes: this.flushes } };
    writeJson(path.join(this.dir, 'frames.json'), meta);
    return meta;
  }
}

// ---------------------------------------------------------------------------
// 一個 session 的執行環境
// ---------------------------------------------------------------------------
class Runner {
  constructor(opts) {
    Object.assign(this, opts);   // session, sessionName, lang, role, out, dataDir, persona, manifest, take
    this.acct = this.persona.accounts[this.role];
    this.password = this.persona.accounts.password;
    this.device = { ...DEVICES[this.session.device] };
    if (this.session.device === 'phone' && this.phoneDpr) this.device.dpr = Number(this.phoneDpr);
    this.d0 = this.manifest.personas[this.lang].d0;
    this.backendTz = this.manifest.timezone || 'Asia/Taipei';   // 後端 URDIARY_TIMEZONE（種子寫進 manifest）
    this.responses = [];          // 關心的 API 回應（checkin/chat/end）
    this.cur = null;              // 目前這個鏡頭 {shot, take, capture, events, llm, notes}
    this.done = [];               // 已錄完的鏡頭記錄
    this.state = {};              // 跨步驟的資料（例如 end chat 的回應）
  }

  // --- 瀏覽器 ---
  async launch() {
    const d = this.device;
    const gpu = process.env.URDIARY_REC_GPU !== '0';
    const args = [`--force-device-scale-factor=${d.dpr}`, `--window-size=${d.width},${d.height}`, '--hide-scrollbars',
      ...(gpu ? ['--use-gl=angle', '--use-angle=gl-egl'] : ['--disable-gpu'])];
    this.browser = await chromium.launch({ headless: true, args });
    this.ctx = await this.browser.newContext({
      viewport: null, locale: LOCALE[this.lang], timezoneId: this.tz || 'Asia/Taipei', reducedMotion: 'no-preference',
      colorScheme: 'light', ...(d.userAgent ? { userAgent: d.userAgent } : {}), ...(d.touch ? { hasTouch: true } : {}),
    });
    const uiLang = UI_LANG[this.lang];
    await this.ctx.addInitScript((lang) => {
      try { localStorage.setItem('urDiary_language', lang); } catch (e) { /* ignore */ }
      // 被動觀察：存日記彩蛋／初次見面浮層什麼時候出現（只讀，不改 App 行為）
      window.__recEggs = [];
      try {
        new MutationObserver((muts) => {
          for (const m of muts) for (const n of m.addedNodes) {
            if (n.nodeType === 1 && n.classList && n.classList.contains('mascot-egg')) {
              window.__recEggs.push({ cls: n.className, t: Date.now() });
            }
          }
        }).observe(document, { childList: true, subtree: true });
      } catch (e) { /* ignore */ }
    }, uiLang);
    this.page = await this.ctx.newPage();
    this.page.on('dialog', (dlg) => dlg.accept().catch(() => {}));
    this.page.on('response', async (resp) => {
      try {
        const u = new URL(resp.url());
        if (resp.request().method() !== 'POST') return;
        const p = u.pathname;
        if (!/^\/chat\/(checkin\/|enhanced\/|end\/)$/.test(p)) return;
        let body = null;
        try { body = await resp.json(); } catch (e) { body = null; }
        this.responses.push({ path: p, status: resp.status(), body, t: now() });
      } catch (e) { /* ignore */ }
    });
    this.cdp = await this.ctx.newCDPSession(this.page);
    log(`browser up (${this.session.device} ${d.width}x${d.height}@${d.dpr}${gpu ? ', gpu' : ', no gpu'})`);
  }

  async close() {
    try { if (this.browser) await this.browser.close(); } catch (e) { /* ignore */ }
  }

  // --- 共用 ---
  t() { return this.cur ? +(now() - this.cur.capture.t0).toFixed(2) : null; }
  event(what, extra) {
    if (this.cur) this.cur.events.push({ t: this.t(), what, ...(extra || {}) });
    log(`${this.cur ? this.cur.shot + ' ' + this.t() + 's ' : ''}${what}`);
  }
  i18n(key, params) { return this.page.evaluate(([k, p]) => I18N.t(k, p), [key, params || null]); }

  resolveText(spec) {
    if (spec.startsWith('demo:')) return getPath(this.persona.demo_messages, spec.slice(5));
    if (spec.startsWith('persona:')) return getPath(this.persona, spec.slice(8));
    if (spec.startsWith('lang:')) { const [zh, en] = spec.slice(5).split('|'); return this.lang === 'zh' ? zh : en; }
    return spec;
  }

  dayIso(which) {
    if (which === 'today') return this.d0;
    const roles = this.persona.storyboard_roles;
    const off = typeof which === 'number' ? which : roles[which];
    return isoAddDays(this.d0, off);
  }

  async waitResponse(pathRe, sinceIdx, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = this.responses.slice(sinceIdx).find((r) => pathRe.test(r.path));
      if (hit) return hit;
      await sleep(100);
    }
    throw new Error(`timeout waiting for ${pathRe}`);
  }

  async noThinking(ms, timeoutMs = 60000) {
    // 連續 ms 毫秒都沒有思考泡泡、也沒有「生成日記中」泡泡
    const deadline = Date.now() + timeoutMs;
    let calmSince = null;
    while (Date.now() < deadline) {
      const busy = await this.page.evaluate(() => !!document.querySelector('.chat-message.thinking, .chat-message.diary-generating'));
      if (busy) calmSince = null; else if (calmSince === null) calmSince = Date.now();
      if (calmSince !== null && Date.now() - calmSince >= ms) return;
      await sleep(80);
    }
    throw new Error('timeout waiting for the chat to settle');
  }

  // 游標移動＋點擊（桌面用滑鼠、手機用觸控）
  async pointAt(locator, { settle = 250 } = {}) {
    await locator.waitFor({ state: 'visible', timeout: 20000 });
    const box = await locator.boundingBox();
    if (!box) throw new Error('element has no box');
    const x = box.x + box.width / 2 + (Math.random() - 0.5) * Math.min(12, box.width / 4);
    const y = box.y + box.height / 2 + (Math.random() - 0.5) * Math.min(6, box.height / 4);
    if (!this.device.touch) {
      await this.page.mouse.move(x, y, { steps: 22 });
      await sleep(settle);
    }
    return { x, y };
  }
  async click(locator, opts) {
    const { x, y } = await this.pointAt(locator, opts);
    if (this.device.touch) { await this.page.touchscreen.tap(x, y); return; }
    await this.page.mouse.down(); await sleep(70); await this.page.mouse.up();
  }
  L(sel) { return this.page.locator(sel).first(); }

  async humanType(text) {
    for (const ch of Array.from(text)) {
      await this.page.keyboard.type(ch);
      let d = (1000 / 8) * (0.6 + Math.random() * 0.8);
      if (/[，。、,.!?！？…；;:：]/.test(ch)) d += 150 + Math.random() * 200;
      await sleep(d);
    }
  }

  // --- 狀態重設（走 seed_demo.py 的維護旗標；demo 後端開著也可以） ---
  seed(args) {
    const out = execFileSync(PY, [SEEDER, '--user', this.acct.username, ...args], {
      cwd: REPO, env: { ...process.env, URDIARY_DATA_DIR: this.dataDir }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    log(`seed ${args.join(' ')} → ${out.trim().split('\n').pop()}`);
  }

  // --- 錄影開始／結束 ---
  nextTake(shot) {
    if (this.take && this.fixedTake) return Number(this.take);
    const dir = path.join(this.out, shot);
    let n = 1;
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        const m = f.match(new RegExp(`^${this.lang}-take(\\d+)\\.json$`));
        if (m) n = Math.max(n, Number(m[1]) + 1);
      }
    }
    return n;
  }

  async rec(shot) {
    const take = this.nextTake(shot);
    const rawDir = path.join(this.out, '_raw', `${shot}-${this.lang}-take${take}`);
    if (fs.existsSync(rawDir)) fs.rmSync(rawDir, { recursive: true, force: true });
    const capture = new Capture(this.cdp, rawDir, this.device);
    this.cur = { shot, take, capture, events: [], llm: {}, notes: [], respIdx: this.responses.length,
      startedAt: new Date().toISOString() };
    await capture.start();
    this.event('recording started');
    // 畫面最上方的每日問候（主線：再登入那一刻產生）跟著 U03 記下來，驗收它是不是晚上版
    if (shot === 'U03' && this.state.opening) this.cur.llm.opening_checkin = this.state.opening;
    this.cur.probeStart = await probePage(this.page).catch((e) => ({ error: String(e.message || e) }));
  }

  async stop(status = 'ok', error = null) {
    const c = this.cur;
    if (!c) return;
    const probeEnd = await probePage(this.page).catch((e) => ({ error: String(e.message || e) }));
    this.event('recording stopped');
    const meta = await c.capture.stop();
    const probe = acceptanceFromProbes(c.probeStart, probeEnd, meta, c.capture.dir);
    const rec = {
      shot: c.shot, lang: this.lang, take: c.take, session: this.sessionName, device: this.session.device,
      account: this.acct.username, ui_lang: UI_LANG[this.lang], timezone: this.tz || 'Asia/Taipei',
      viewport: `${this.device.width}x${this.device.height}@${this.device.dpr}`,
      started_at: c.startedAt, ended_at: new Date().toISOString(),
      raw_dir: path.relative(this.out, c.capture.dir), raw_duration_s: +(meta.tEnd - meta.t0).toFixed(2),
      frames: meta.stats, events: c.events, llm: c.llm, notes: c.notes, status, error,
      file: null, ffprobe: null, probe,
    };
    rec.checks = runChecks(rec, this);
    writeJson(path.join(this.out, c.shot, `${this.lang}-take${c.take}.json`), rec);
    log(`saved ${c.shot}/${this.lang}-take${c.take}.json (${meta.stats.count} frames, p95 gap ${meta.stats.p95_ms} ms)`);
    this.done.push(rec);
    this.cur = null;
    return rec;
  }
}

// ---------------------------------------------------------------------------
// 步驟語彙
// ---------------------------------------------------------------------------
const ACTIONS = {
  async seed(r, ...args) { r.seed(args); },

  async open(r) {
    await r.page.goto(BASE_URL);
    await r.L('#user-select-dialog').waitFor({ state: 'visible', timeout: 30000 });
    await sleep(600);
  },

  // 第一次登入（清單裡還沒有這個帳號）：「使用其他帳號登入…」→ 帳號＋密碼
  async login(r) {
    r.state.loginIdx = r.responses.length;
    await r.L('#user-list .user-item[data-username=""]').click();
    await r.L('#password-dialog').waitFor({ state: 'visible' });
    await r.page.fill('#login-username', r.acct.username);
    await r.page.fill('#user-password', r.password);
    await r.L('#verify-password-btn').click();
    await r.L('#password-dialog').waitFor({ state: 'hidden', timeout: 30000 });
    await r.L('#user-input').waitFor({ state: 'visible', timeout: 30000 });
  },

  // 錄影用：密碼框填好、還沒按登入
  async fillLogin(r) {
    await r.L('#user-list .user-item[data-username=""]').click();
    await r.L('#password-dialog').waitFor({ state: 'visible' });
    await r.page.fill('#login-username', r.acct.username);
    await r.page.fill('#user-password', r.password);
    await r.page.mouse.move(r.device.width * 0.72, r.device.height * 0.78);
    await sleep(800);
  },
  async fillPassword(r) {
    await r.page.fill('#user-password', r.password);
    if (!r.device.touch) await r.page.mouse.move(r.device.width * 0.72, r.device.height * 0.78);
    await sleep(800);
  },
  async submitLogin(r) {
    r.state.loginIdx = r.responses.length;
    await r.click(r.L('#verify-password-btn'));
    r.event('sign-in pressed');
    // #user-input 在對話框後面本來就「可見」；要等登入真的完成（對話框關掉、ChatModule 已重設）
    await r.L('#password-dialog').waitFor({ state: 'hidden', timeout: 30000 });
  },

  // 登入後的開場：等 /chat/checkin/ 回來、畫面安定（真問候或靜態歡迎詞都算）
  async awaitOpening(r) {
    const hit = await r.waitResponse(/^\/chat\/checkin\/$/, r.state.loginIdx || 0, 240000).catch(() => null);
    if (hit && hit.body && hit.body.checkin) {
      r.state.lastCheckin = hit.body.message;
      const clock = tzClock(hit.t, r.backendTz);
      r.state.opening = { status: hit.status, checkin: true, text: hit.body.message || null, model: hit.body.model_used,
        at: new Date(hit.t * 1000).toISOString(), backend_tz: r.backendTz, local_hhmm: clock.hhmm,
        label: timeOfDayLabel(clock.hour, r.lang) };
    } else {
      r.state.opening = null;
    }
    await r.noThinking(3300, 60000);
    await r.page.waitForLoadState('networkidle').catch(() => {});
  },

  // 開一次設定再關掉：SettingsModule 才會讀到陪伴者名字，也把 grok-4.3 寫進模型偏好
  async touchSettings(r) {
    const waitCompanion = r.page.waitForResponse((res) => /\/users\/me\/companion$/.test(new URL(res.url()).pathname), { timeout: 20000 });
    const waitLlm = r.page.waitForResponse((res) => /\/users\/me\/llm$/.test(new URL(res.url()).pathname), { timeout: 20000 });
    await r.L('#settings-btn').click();
    await r.L('#settings-dialog').waitFor({ state: 'visible' });
    await Promise.all([waitCompanion, waitLlm]);
    await sleep(700);
    const name = await r.page.evaluate(() => SettingsModule.getCompanionName());
    r.state.companionName = name;
    await r.L('#close-settings-btn').click();
    await r.L('#settings-dialog').waitFor({ state: 'hidden' });
    log(`settings touched (companion name cached: ${name})`);
  },

  async openSwitchUser(r) {
    await r.L('#user-select-btn').click();
    await r.L('#user-select-dialog').waitFor({ state: 'visible' });
    await sleep(500);
  },
  async pickProfile(r) {
    await r.click(r.L(`#user-list .user-item[data-username="${r.acct.username}"]`));
    await r.L('#password-dialog').waitFor({ state: 'visible' });
    r.event('profile picked; password dialog open');
  },
  // 切換使用者 → 同一個帳號再登入一次（ChatModule 重新初始化：標題換成名字、模型顯示 grok-4.3）
  async relogin(r) {
    await ACTIONS.openSwitchUser(r);
    await r.L(`#user-list .user-item[data-username="${r.acct.username}"]`).click();
    await r.L('#password-dialog').waitFor({ state: 'visible' });
    await r.page.fill('#user-password', r.password);
    r.state.loginIdx = r.responses.length;
    await r.L('#verify-password-btn').click();
    await r.L('#password-dialog').waitFor({ state: 'hidden', timeout: 30000 });
    await r.L('#user-input').waitFor({ state: 'visible' });
    const title = await r.page.textContent('.chat-title');
    log(`re-signed in; chat title = ${title}`);
  },

  async logout(r) {
    await r.L('#settings-btn').click();
    await r.L('#settings-dialog').waitFor({ state: 'visible' });
    await r.L('#settings-logout').click();
    await r.L('#user-select-dialog').waitFor({ state: 'visible', timeout: 20000 });
    await sleep(1500);
    await r.page.mouse.move(r.device.width * 0.8, r.device.height * 0.85);
  },

  async hold(r, seconds) { await sleep(seconds * 1000); },

  // 錄影前的麥克風字形檢查：原生解析度截一張圖，用 micPixelCheck 看按鈕裡是不是真的畫出了麥克風
  // （圖示字型子集舊版沒有這個字形，按鈕只剩空圓）。沒畫出來就整個 session 中止，不要錄
  async preflightMic(r) {
    const p = await probePage(r.page);
    const box = p.mic && p.mic.button_box;
    if (!box) throw new Error('preflight: mic button not visible on the chat page');
    const shot = await r.cdp.send('Page.captureScreenshot', { format: 'png' });
    const tmp = path.join(os.tmpdir(), `urdiary-preflight-mic-${process.pid}.png`);
    fs.writeFileSync(tmp, Buffer.from(shot.data, 'base64'));
    let res;
    try { res = micPixelCheck(tmp, box, p.mic.dpr || r.device.dpr); } finally { fs.rmSync(tmp, { force: true }); }
    log(`preflight mic glyph: ${JSON.stringify(res)}`);
    if (!res.ok) throw new Error(`preflight: mic glyph not rendered (${res.reason || 'shape check failed'})`);
    r.state.preflightMic = res;
  },

  // 等到 --at 指定的時刻（ISO 8601，例如 2026-10-01T05:05:00+14:00）；已經過了就直接往下
  async waitUntil(r) {
    if (!r.at) throw new Error('waitUntil needs --at <ISO time>');
    const target = Date.parse(r.at);
    if (Number.isNaN(target)) throw new Error(`bad --at ${r.at}`);
    log(`waiting until ${r.at} (${Math.max(0, Math.round((target - Date.now()) / 1000))} s)`);
    while (Date.now() < target) await sleep(Math.min(1000, target - Date.now()));
    log('time reached');
  },

  async clickInput(r) { await r.click(r.L('#user-input')); },
  async press(r, key) { await r.page.keyboard.press(key); r.event(`key ${key}`); },
  async type(r, spec) {
    const text = r.resolveText(spec);
    if (!text) throw new Error(`nothing to type for ${spec}`);
    r.event('typing starts', { text });
    await r.humanType(text);
    r.event('typing ends');
  },

  // Enter 送出 → 等 /chat/enhanced/ 回來 → 回覆落地
  async send(r) {
    const idx = r.responses.length;
    await r.page.keyboard.press('Enter');
    r.event('message sent');
    const hit = await r.waitResponse(/^\/chat\/enhanced\/$/, idx, 240000);
    const reply = hit.body && (hit.body.message || hit.body.response);
    await r.noThinking(400, 60000);
    r.event('reply shown', { chars: reply ? reply.length : 0 });
    if (r.cur) {
      r.cur.llm.replies = r.cur.llm.replies || [];
      r.cur.llm.replies.push({ status: hit.status, text: reply || null, model: hit.body && hit.body.model_used });
    }
    r.state.lastReply = reply;
  },

  // 初次見面腳本訊息（i18n 文字）出現
  async awaitScript(r, key) {
    const params = { name: r.resolveText('persona:companion.companion_name') };
    let text = await r.i18n(key, params);
    if (key === 'onboarding.nameDefaulted') text = await r.i18n(key, { name: await r.i18n('onboarding.defaultName') });
    const probe = text.slice(0, Math.min(18, text.length));
    await r.page.waitForFunction((p) => Array.from(document.querySelectorAll('.chat-message.system-message:not(.thinking) .message-bubble'))
      .some((b) => b.textContent.includes(p)), probe, { timeout: 30000 });
    r.event(`script message shown: ${key}`);
    if (r.cur) { r.cur.llm.script = r.cur.llm.script || []; r.cur.llm.script.push({ key, text }); }
  },
  async awaitTitle(r, spec) {
    const want = r.resolveText(spec);
    await r.page.waitForFunction((w) => (document.querySelector('.chat-title') || {}).textContent === w, want, { timeout: 20000 });
    r.event(`chat title is now ${want}`);
  },

  // 手機早安問候：等 checkin 回應（checkin:true）→ 問候泡泡出現
  async awaitCheckin(r) {
    const hit = await r.waitResponse(/^\/chat\/checkin\/$/, r.state.loginIdx || 0, 240000);
    const msg = hit.body && hit.body.message;
    await r.noThinking(400, 60000);
    r.event(hit.body && hit.body.checkin ? 'check-in greeting shown' : 'NO check-in (checkin:false)');
    if (r.cur) r.cur.llm.checkin = { status: hit.status, checkin: !!(hit.body && hit.body.checkin), text: msg || null,
      model: hit.body && hit.body.model_used };
    if (!(hit.body && hit.body.checkin)) r.cur.notes.push('check-in did not fire (already greeted today?)');
    const tea = await r.page.evaluate(() => !!document.querySelector('.chat-message.system-message .mascot-checkin'));
    if (r.cur) r.cur.llm.checkin.tea_mascot_rendered = tea;
  },

  async endChat(r) {
    const idx = r.responses.length;
    await r.page.evaluate(() => { window.__recEggs = []; });
    await r.click(r.L('#end-chat-btn'));
    r.event('end chat pressed');
    const hit = await r.waitResponse(/^\/chat\/end\/$/, idx, 400000);
    r.event('diary generated (response)');
    await sleep(1700);   // 彩蛋 1.2 s＋淡出
    const eggs = await r.page.evaluate(() => window.__recEggs || []);
    const b = hit.body || {};
    const diary = b.diary || {};
    r.state.endChat = b;
    if (r.cur) {
      r.cur.llm.end_chat = {
        status: hit.status, message: b.message, model: b.model_used,
        diary: { id: diary.diary_id || diary.id, title: diary.title, summary: diary.summary, content: diary.content,
          valence: diary.valence, arousal: diary.arousal, stamp: diary.stamp, stamp_phrase: diary.stamp_phrase || diary.phrase },
        memory_review: b.memory_review || null, memory_review_error: b.memory_review_error || null,
        eggs: eggs.map((e) => e.cls),
      };
      r.event(`egg overlays seen: ${eggs.length ? eggs.map((e) => e.cls).join(', ') : 'none'}`);
    }
  },

  async awaitNewDiaryCard(r) {
    const title = r.state.endChat && r.state.endChat.diary && r.state.endChat.diary.title;
    await r.L('#diary-view').waitFor({ state: 'visible', timeout: 20000 });
    await r.page.waitForFunction((t) => {
      const c = document.querySelector('.diary-card .card-title');
      return !!c && (!t || c.textContent.includes(t));
    }, title || null, { timeout: 30000 });
    r.event('diary view shows the new card');
  },
  async openFirstDiary(r) {
    await r.click(r.L('.diary-card'));
    await r.L('.diary-detail .detail-content').waitFor({ state: 'visible', timeout: 20000 });
    r.event('diary detail open');
  },

  async nav(r, view) {
    const sel = r.device.touch ? `.tab-bar .nav-item[data-view="${view}"]` : `.app-nav .nav-item[data-view="${view}"]`;
    await r.click(r.L(sel));
    r.event(`nav → ${view}`);
    await r.L(`#${view}-view`).waitFor({ state: 'visible', timeout: 20000 });
  },
  async awaitDiaryList(r) {
    await r.page.waitForFunction(() => document.querySelectorAll('.diary-card').length > 3, null, { timeout: 20000 });
  },
  async awaitCalendar(r) {
    await r.page.waitForFunction(() => document.querySelectorAll('.calendar-grid .calendar-cell').length === 42 &&
      document.querySelectorAll('.calendar-grid .cell-stamp').length > 0, null, { timeout: 20000 });
    r.event('month grid loaded');
  },

  // 捲到某篇日記卡（滾輪、緩入緩出），卡片停在清單上半部
  async scrollToDiary(r, which) {
    const iso = r.dayIso(which);
    const spec = r.persona.diaries.find((d) => d.day === r.persona.storyboard_roles[which]);
    const title = spec ? spec.title : null;
    const plan = await r.page.evaluate((t) => {
      const cards = Array.from(document.querySelectorAll('.diary-card'));
      const card = cards.find((c) => (c.querySelector('.card-title') || {}).textContent.includes(t));
      if (!card) return null;
      let el = card.parentElement;
      while (el && !(el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
      const scroller = el || document.scrollingElement;
      const sr = scroller.getBoundingClientRect ? scroller.getBoundingClientRect() : { top: 0, left: 0, width: innerWidth, height: innerHeight };
      const cr = card.getBoundingClientRect();
      const delta = cr.top - (sr.top + Math.max(24, sr.height * 0.22));
      return { delta, x: sr.left + sr.width / 2, y: sr.top + sr.height / 2 };
    }, title);
    if (!plan) throw new Error(`diary card not found: ${title}`);
    await r.page.mouse.move(plan.x, plan.y, { steps: 15 });
    await sleep(300);
    r.event(`scroll to ${iso} 《${title}》`, { delta: Math.round(plan.delta) });
    const steps = Math.max(20, Math.round(Math.abs(plan.delta) / 18));
    let done = 0;
    for (let i = 1; i <= steps; i++) {
      const target = plan.delta * (0.5 - 0.5 * Math.cos(Math.PI * i / steps));
      const dy = Math.round(target - done);
      if (dy) await r.page.mouse.wheel(0, dy);
      done += dy;
      await sleep(16);
    }
    await sleep(400);
    r.event('scrolled');
  },

  async clickDay(r, which) {
    const iso = r.dayIso(which);
    await r.click(r.L(`.calendar-grid .calendar-cell[data-date="${iso}"]`));
    await r.page.waitForFunction((d) => {
      const title = document.querySelector('.calendar-day-panel .day-panel-title');
      const sel = document.querySelector(`.calendar-grid .calendar-cell.selected[data-date="${d}"]`);
      return !!title && !!sel;
    }, iso, { timeout: 20000 });
    const stamp = await r.page.evaluate(() => {
      const card = document.querySelector('.calendar-day-panel .day-stamp-card');
      return card ? (card.querySelector('.day-stamp-phrase') || {}).textContent || '' : null;
    });
    // 印章圖示本身沒有 id 屬性：用 App 自己的唯讀 GET 查這天是哪一枚（只為了寫進記錄）
    const note = await r.page.evaluate(async (d) => {
      try { const res = await ApiService.getDayNotes(d, d); return (res && res.notes && res.notes[0]) || null; } catch (e) { return null; }
    }, iso);
    r.event(`day ${iso} open; stamp card ${stamp === null ? 'absent' : 'present'}${note && note.stamp ? ` (${note.stamp})` : ''}`);
    if (r.cur) r.cur.llm.day_panel = { date: iso, stamp_card: stamp !== null, stamp: note ? note.stamp : null, phrase: stamp };
    if (r.cur && stamp === null) r.cur.notes.push(`no stamp card on ${iso}`);
  },
  async ymPicker(r) {
    await r.click(r.L('#calendar-ym-btn'));
    r.event('year/month picker toggled');
  },

  async openMemoryFromNotice(r) {
    const text = await r.i18n('memory.pendingNotice');
    const bubble = r.page.locator('.chat-message.system-message .message-bubble', { hasText: text.slice(0, 12) }).last();
    await bubble.scrollIntoViewIfNeeded();
    await r.click(bubble);
    await r.L('#memory-dialog').waitFor({ state: 'visible', timeout: 20000 });
    await r.L('#memory-pane-profile').waitFor({ state: 'visible' });
    r.event('memory dialog open (user profile tab)');
  },
  async openMemoryFromSettings(r) {
    await r.click(r.L('#settings-btn'));
    await r.L('#settings-dialog').waitFor({ state: 'visible' });
    await sleep(900);
    const manage = r.L('#settings-memory-manage');
    await manage.scrollIntoViewIfNeeded();
    await sleep(400);
    await r.click(manage);
    await r.L('#memory-dialog').waitFor({ state: 'visible', timeout: 20000 });
    r.event('settings → manage memory → user profile tab');
  },
  async clickProfileText(r) {
    const ta = r.L('#memory-profile-text');
    const box = await ta.boundingBox();
    // 點在文字框第三行附近，游標出現在文字中間（不改任何字）
    if (r.device.touch) await r.page.touchscreen.tap(box.x + box.width * 0.6, box.y + 60);
    else { await r.page.mouse.move(box.x + box.width * 0.6, box.y + 60, { steps: 20 }); await sleep(250); await r.page.mouse.down(); await sleep(60); await r.page.mouse.up(); }
    const counter = await r.page.textContent('#memory-profile-count').catch(() => null);
    r.event(`clicked into the profile text (${counter})`);
  },
  async ledgerTab(r) {
    await r.click(r.L('#memory-tab-ledger'));
    await r.page.waitForFunction(() => document.querySelectorAll('#memory-ledger-list .memory-op-row').length > 0, null, { timeout: 20000 });
    const banner = await r.page.evaluate(() => { const b = document.getElementById('memory-approval-banner'); return !!b && b.style.display !== 'none'; });
    r.event(`ledger tab (approval banner ${banner ? 'visible' : 'hidden'})`);
  },
  async approveOneAdd(r) {
    const addWord = await r.i18n('memory.opAdd');
    const pick = await r.page.evaluate((w) => {
      const rows = Array.from(document.querySelectorAll('#memory-ledger-list .memory-op-row'));
      const withBtn = rows.filter((row) => row.querySelector('[data-op-approve]'));
      const add = withBtn.find((row) => (row.querySelector('.memory-op-text') || {}).textContent.trim().startsWith(w));
      const row = add || withBtn[0];
      if (!row) return null;
      return { id: row.querySelector('[data-op-approve]').getAttribute('data-op-approve'), text: row.querySelector('.memory-op-text').textContent.trim(), isAdd: !!add };
    }, addWord);
    if (!pick) throw new Error('no pending op to approve');
    await r.click(r.L(`[data-op-approve="${pick.id}"]`));
    r.event('approve pressed', { op: pick.text });
    await r.page.waitForFunction((id) => !document.querySelector(`[data-op-approve="${id}"]`), pick.id, { timeout: 20000 });
    const applied = await r.i18n('memory.stApplied');
    r.event(`op ${pick.id} approved → ${applied}`);
    if (r.cur) r.cur.llm.approved_op = pick;
  },

  // 閘門：recall＝U03/U04 沒有「日期＋標題」而且還有重試次數 → 這一輪到此為止（不結束對話）
  async gate(r, kind) {
    if (kind === 'recall') {
      const last = r.done.filter((d) => d.shot === 'U03' || d.shot === 'U04');
      const verbatim = last.some((d) => d.checks && d.checks.recall && d.checks.recall.date && d.checks.recall.title);
      // zh 旁白不再宣稱「日期＋標題」：清楚指向 D-16 的轉述式回憶也算（--strict-recall 改回只認完整引用）
      const para = r.lang === 'zh' && !r.strictRecall && last.some((d) => d.checks && d.checks.recall && d.checks.recall.paraphrase);
      const ok = verbatim || para;
      r.state.recallOk = ok;
      if (!ok && r.attemptsLeft > 0) { log(`gate recall: no ${r.lang === 'zh' && !r.strictRecall ? 'D-16 recall' : 'date+title citation'} yet → retry from U03`); return 'abort'; }
      log(`gate recall: ${verbatim ? 'cited (date+title)' : para ? 'paraphrased recall of D-16' : 'not cited, attempts exhausted → continue'}`);
    }
    if (kind === 'pending') {
      const mr = r.state.endChat && r.state.endChat.memory_review;
      const pending = mr && mr.pending;
      if (!(pending > 0)) { log('gate pending: no pending memory ops → skip U15'); return 'stop'; }
      log(`gate pending: ${pending} pending op(s)`);
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// 自動檢查（寫進每個 take 的 JSON，SHOTLOG 會列出）
// ---------------------------------------------------------------------------
let CRISIS = null;
function llmTexts(rec) {
  const out = [];
  const l = rec.llm || {};
  if (l.checkin && l.checkin.text) out.push(l.checkin.text);
  if (l.opening_checkin && l.opening_checkin.text) out.push(l.opening_checkin.text);
  for (const x of l.replies || []) if (x.text) out.push(x.text);
  if (l.end_chat) {
    const d = l.end_chat.diary || {};
    for (const k of ['title', 'summary', 'content', 'stamp_phrase']) if (d[k]) out.push(d[k]);
    if (l.end_chat.message) out.push(l.end_chat.message);
  }
  if (l.day_panel && l.day_panel.phrase) out.push(l.day_panel.phrase);
  return out;
}
function recallCheck(texts, r) {
  const roles = r.persona.storyboard_roles;
  const spec = r.persona.diaries.find((d) => d.day === roles.recall_target_day);
  const iso = r.dayIso('recall_target_day');
  const [, m, d] = iso.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const mon = months[m - 1];
  const dateRes = [new RegExp(`${m}\\s*月\\s*${d}\\s*[日號号]`), new RegExp(`(^|[^0-9])${m}\\s*/\\s*${d}([^0-9]|$)`),
    new RegExp(`${mon}\\s+${d}(st|nd|rd|th)?\\b`, 'i'), new RegExp(`${mon.slice(0, 3)}\\.?\\s+${d}\\b`, 'i'), new RegExp(`\\b${d}(st|nd|rd|th)?\\s+(of\\s+)?${mon}`, 'i')];
  const norm = (s) => s.toLowerCase().replace(/[“”"'‘’《》「」]/g, '');
  const all = texts.join('\n');
  // 轉述式回憶：同一句裡同時有「過去」的指涉和 D-16 那篇才有的細節（不在 U04 訊息裡的詞）
  const para = PARAPHRASE[r.lang];
  const sentences = all.split(r.lang === 'zh' ? /(?<=[。！？!?])|\n/ : /(?<=[.!?])\s+|\n/).map((s) => s.trim()).filter(Boolean);
  const hits = sentences.filter((s) => { const t = s.toLowerCase(); return para.past.some((w) => t.includes(w)) && para.details.some((w) => t.includes(w)); });
  return { target: `${iso} 《${spec.title}》`, date: dateRes.some((re) => re.test(all)), title: norm(all).includes(norm(spec.title)),
    paraphrase: hits.length > 0, paraphrase_lines: hits.slice(0, 3) };
}
const PARAPHRASE = {
  zh: { details: ['書報討論', '半夜', '爬起來', '講稿', '第一次上台', '第一次報告', '第一次在'],
    past: ['之前', '上次', '那次', '那天', '那晚', '那時', '記得', '上回', '9 月 14', '9月14', '九月十四', '兩週前', '兩個禮拜前', '前陣子'] },
  en: { details: ['seminar', 'first presentation', 'ran through', 'the talk', 'got up', "couldn't sleep", 'could not sleep'],
    past: ['remember', 'last time', 'back on', 'back in', 'that night', 'before your first', 'september 14', 'the 14th', 'earlier this month',
      'couple of weeks ago', 'two weeks ago', 'wrote'] },
};
function runChecks(rec, r) {
  CRISIS = CRISIS || crisisWords();
  const texts = llmTexts(rec);
  const all = texts.join('\n').toLowerCase();
  const checks = {
    stub_text: texts.some((t) => t.includes(STUB_MARK)),
    crisis_words: CRISIS.filter((w) => all.includes(w)),
  };
  if (rec.shot === 'U03' || rec.shot === 'U04') checks.recall = recallCheck((rec.llm.replies || []).map((x) => x.text || ''), r);
  if (rec.llm.end_chat) {
    const e = rec.llm.end_chat;
    checks.valence = e.diary ? e.diary.valence : null;
    checks.egg = e.eggs && e.eggs.length ? e.eggs.join(',') : null;
    checks.pending_ops = e.memory_review ? e.memory_review.pending : null;
    if (rec.shot === 'U06' && checks.egg && /happy|night/.test(checks.egg)) rec.notes.push('EGG POPPED after the heavy chat → discard this take (storyboard S5)');
    if (rec.shot === 'U06' && typeof checks.valence === 'number' && checks.valence >= 0.45) rec.notes.push(`U06 valence ${checks.valence} ≥ 0.45 → not a heavy-day diary (storyboard S5)`);
    if (rec.shot === 'U10' && !checks.egg) rec.notes.push('no happy egg (valence below 0.45?) → not usable for U10');
  }
  // --- 畫面驗收（修好的 UI）：麥克風圖示、頁尾年份、記憶檔節標題的語言、畫面上的 stub／危機詞、問候時段
  const pr = rec.probe || {};
  const year = String(new Date(rec.started_at).getFullYear());
  if (pr.mic) {
    const px = pr.mic.pixel;
    checks.mic_glyph = { ok: px ? !!px.ok : !!(pr.mic.css_rule && pr.mic.before_is_f130 && pr.mic.icon_w > 0),
      how: px ? `pixels (${pr.mic.sampled})` : 'css rule + computed ::before (button not on screen)',
      css_rule: pr.mic.css_rule, before_is_f130: pr.mic.before_is_f130, font_loaded: pr.mic.font_loaded, icon_w: pr.mic.icon_w,
      ...(px ? { core_ink: px.core_ink, aspect: px.aspect, glyph_px: px.glyph_px, ink_ratio: px.ink_ratio, reason: px.reason } : {}) };
    if (!checks.mic_glyph.ok) rec.notes.push(`mic glyph check FAILED (${checks.mic_glyph.how}${px && px.reason ? ': ' + px.reason : ''})`);
  }
  if (pr.footer) {
    checks.footer_year = { ok: pr.footer.text.includes(year) && !/20(1\d|2[0-5])/.test(pr.footer.text), visible: pr.footer.visible, text: pr.footer.text };
    if (!checks.footer_year.ok) rec.notes.push(`footer does not say ${year}: ${pr.footer.text}`);
  }
  if (pr.memory) {
    TITLES = TITLES || sectionTitles();
    const want = rec.ui_lang === 'en' ? 'en' : 'zh-TW';
    const other = want === 'en' ? 'zh-TW' : 'en';
    const heads = pr.memory.profile_headings || [];
    const bad = heads.filter((h) => !TITLES[want].includes(h));
    const ledgerOther = (pr.memory.ledger_rows || []).filter((t) => TITLES[other].some((x) => t.includes(x)));
    checks.memory_titles = { ok: heads.length > 0 && !bad.length && !ledgerOther.length, lang: want, profile_headings: heads,
      not_in_lang: bad, ledger_rows_other_lang: ledgerOther };
    if (!checks.memory_titles.ok) rec.notes.push(`memory section titles not all ${want}: ${JSON.stringify({ bad, ledgerOther, heads })}`);
  }
  if (pr.page) {
    checks.page_stub = pr.page.stub;
    checks.page_crisis = pr.page.crisis;
    if (pr.page.stub) rec.notes.push('STUB TEXT ON SCREEN → discard');
    if (pr.page.crisis.length) rec.notes.push(`crisis word(s) on screen: ${pr.page.crisis.join(', ')}`);
  }
  const oc = rec.llm.opening_checkin;
  if (oc) {
    const want = rec.lang === 'en' ? 'evening' : '晚上';
    const conflicts = timeConflicts(oc.text, rec.lang);
    // 問候本身有沒有明說「晚上」（晚上好／今晚、Evening／tonight）：挑 take 時優先
    const says = rec.lang === 'en' ? /\bevening\b|\btonight\b/i.test(oc.text || '') : /晚上|今晚/.test(oc.text || '');
    checks.checkin_time = { label: oc.label, local: `${oc.local_hhmm} ${oc.backend_tz}`, evening: oc.label === want, says_evening: says, conflicts };
    if (oc.label !== want) rec.notes.push(`opening check-in is the ${oc.label} version, not ${want}`);
    if (conflicts.length) rec.notes.push(`opening check-in mentions ${conflicts.join(', ')}`);
  }
  return checks;
}
let TITLES = null;

// ---------------------------------------------------------------------------
// 執行一個 session（chain 可以重試）
// ---------------------------------------------------------------------------
async function runSession(args) {
  const name = args.session;
  const session = SESSIONS[name];
  if (!session) throw new Error(`unknown session ${name}; known: ${Object.keys(SESSIONS).join(', ')}`);
  const lang = args.lang;
  if (!PERSONA_FILES[lang]) throw new Error('--lang zh|en');
  const dataDir = process.env.URDIARY_DATA_DIR;
  if (!dataDir) throw new Error('set URDIARY_DATA_DIR to the seeded demo dir');
  const manifest = readJson(path.join(dataDir, 'demo_manifest.json'));
  const persona = readJson(path.join(REPO, PERSONA_FILES[lang]));
  const out = path.resolve(args.out || '/mnt/Data_SSD/urdiary-media/recordings');
  const attempts = Number(args.attempts || 1);
  const results = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const r = new Runner({ session, sessionName: name, lang, role: args.role || session.role, out, dataDir, persona, manifest,
      take: args.take, fixedTake: !!args.take, phoneDpr: args['phone-dpr'], attemptsLeft: attempts - attempt,
      tz: args.tz || manifest.timezone || 'Asia/Taipei', at: args.at, strictRecall: !!args['strict-recall'] });
    log(`=== session ${name} (${lang}, ${r.acct.username}) attempt ${attempt}/${attempts}`);
    let aborted = false;
    try {
      await r.launch();
      for (const step of session.steps) {
        const [op, ...a] = step;
        if (op === 'rec') { await r.rec(a[0]); continue; }
        if (op === 'stop') { await r.stop(); continue; }
        const fn = ACTIONS[op];
        if (!fn) throw new Error(`unknown step ${op}`);
        const res = await fn(r, ...a);
        if (res === 'abort') { aborted = true; break; }
        if (res === 'stop') break;
      }
    } catch (e) {
      log(`ERROR: ${e.stack || e}`);
      if (r.cur) {
        try { await r.page.screenshot({ path: path.join(r.cur.capture.dir, 'failure.png') }); } catch (x) { /* ignore */ }
        await r.stop('failed', String(e.message || e));
      }
      results.push(...r.done);
      await r.close();
      throw e;
    }
    await r.close();
    results.push(...r.done);
    if (!aborted) break;
  }
  return results;
}

// ---------------------------------------------------------------------------
// 組裝：逐幀 PNG → 60 fps CFR（ProRes 422 HQ 或 H.264 CRF 12）＋ffprobe＋contact sheet
// ---------------------------------------------------------------------------
function ffprobeJson(ffprobe, file) {
  const r = spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_packets',
    '-show_entries', 'stream=codec_name,profile,width,height,pix_fmt,r_frame_rate,avg_frame_rate,nb_read_packets,color_space,color_primaries,color_transfer:format=duration,size,bit_rate',
    '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  const s = j.streams[0]; const f = j.format;
  return { codec: s.codec_name, profile: s.profile, width: s.width, height: s.height, pix_fmt: s.pix_fmt,
    r_frame_rate: s.r_frame_rate, avg_frame_rate: s.avg_frame_rate, frames: Number(s.nb_read_packets),
    duration_s: +Number(f.duration).toFixed(3), size_mb: +(Number(f.size) / 1048576).toFixed(1), bit_rate_mbps: +(Number(f.bit_rate) / 1e6).toFixed(1),
    color_space: s.color_space, color_primaries: s.color_primaries, color_transfer: s.color_transfer };
}

// 平行組裝（幾個 --assemble 行程同時跑）：每個 take 一把鎖（raw 目錄裡的 .assembling，內容＝pid），
// 拿不到就跳過；鎖的主人已經不在（被中斷）就接手
function takeLock(rawDir) {
  const lock = path.join(rawDir, '.assembling');
  for (let i = 0; i < 2; i++) {
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); return lock; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const pid = Number(fs.readFileSync(lock, 'utf8')) || 0;
    let alive = false;
    try { if (pid) { process.kill(pid, 0); alive = true; } } catch (e) { alive = e.code === 'EPERM'; }
    if (alive) return null;
    fs.rmSync(lock, { force: true });
  }
  return null;
}

function assembleTake(recPath, opts) {
  let rec = readJson(recPath);
  if (rec.file && !opts.force) return rec;
  const rawDir = path.join(opts.out, rec.raw_dir);
  if (!fs.existsSync(path.join(rawDir, 'frames.json'))) { log(`skip ${recPath}: no raw frames`); return rec; }
  const lock = takeLock(rawDir);
  if (!lock) { log(`skip ${path.relative(opts.out, recPath)}: another assembler has it`); return rec; }
  try {
    rec = readJson(recPath);   // 拿到鎖之後重讀：別的行程可能剛組裝完
    if (rec.file && !opts.force) return rec;
    return assembleLocked(recPath, rec, rawDir, opts);
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

function assembleLocked(recPath, rec, rawDir, opts) {
  const { ffmpeg, ffprobe } = opts.paths;
  const metaPath = path.join(rawDir, 'frames.json');
  const meta = readJson(metaPath);
  const frames = meta.frames.slice().sort((a, b) => a.t - b.t);
  const kept = [];
  for (let i = 0; i < frames.length; i++) {
    if (i + 1 < frames.length && frames[i + 1].t - frames[i].t < 0.001) continue;   // 同時間戳：留後者
    kept.push(frames[i]);
  }
  const lines = ['ffconcat version 1.0'];
  for (let i = 0; i < kept.length; i++) {
    const dur = (i + 1 < kept.length ? kept[i + 1].t : meta.tEnd) - kept[i].t;
    lines.push(`file '${kept[i].file}'`, `duration ${Math.max(dur, 0.001).toFixed(6)}`);
  }
  lines.push(`file '${kept[kept.length - 1].file}'`);
  const listFile = path.join(rawDir, 'list.ffconcat');
  fs.writeFileSync(listFile, lines.join('\n') + '\n');
  const ext = opts.codec === 'h264' ? 'mp4' : 'mov';
  const outFile = path.join(opts.out, rec.shot, `${rec.lang}-take${rec.take}.${ext}`);
  // 先轉色彩空間（只轉「不重複」的那些幀）、再用 fps 補成固定 60 fps（補出來的幀只是參照，不重算）。
  // setparams 把 bt709 primaries／transfer／matrix 標在每一幀上：編碼器照幀上的標記寫進 ProRes 幀頭，
  // mov 也才會寫出 bt709 的 colr atom（只靠輸出端的 -color_primaries 參數，ffmpeg 8 不會生效）
  const tag = 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv';
  const vf = opts.codec === 'h264'
    ? `scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p,${tag},fps=60:round=near`
    : `scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv422p10le,${tag},fps=60:round=near`;
  const enc = opts.codec === 'h264'
    ? ['-c:v', 'libx264', '-crf', '12', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
    : ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le'];
  // concat 的最後一項要重複一次，否則 fps 濾鏡會把最後一幀的時長算錯；重複之後尾巴會多出一段，
  // 所以輸出一律用 -t 截在「開錄到停錄」的真實長度
  const expectDur = meta.tEnd - kept[0].t;
  const argv = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', vf,
    ...enc, '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-threads', String(opts.threads || 0),
    '-t', expectDur.toFixed(3), outFile];
  log(`assembling ${path.relative(opts.out, outFile)} (${kept.length} frames, ${(meta.tEnd - kept[0].t).toFixed(1)} s)`);
  const t0 = Date.now();
  const res = spawnSync(opts.nice ? 'nice' : ffmpeg, opts.nice ? ['-n', '15', ffmpeg, ...argv] : argv, { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`ffmpeg failed for ${outFile}: ${res.stderr}`);
  const probe = ffprobeJson(ffprobe, outFile);
  const expect = expectDur;
  const okSize = probe.width === meta.width && probe.height === meta.height;
  const okDur = Math.abs(probe.duration_s - expect) <= 0.05;
  const okFps = probe.r_frame_rate === '60/1';
  rec.file = path.relative(opts.out, outFile);
  rec.ffprobe = probe;
  rec.assembled = { codec: opts.codec, seconds: +((Date.now() - t0) / 1000).toFixed(1), frames_in: kept.length,
    verified: okSize && okDur && okFps, expected_duration_s: +expect.toFixed(3) };
  rec.strip = contactStrip(rec, meta, kept, rawDir, opts);
  writeJson(recPath, rec);
  log(`  → ${probe.width}x${probe.height} ${probe.r_frame_rate} ${probe.duration_s}s ${probe.size_mb} MB (${rec.assembled.seconds}s) verified=${rec.assembled.verified}`);
  if (rec.assembled.verified && !opts.keepRaw) {
    fs.rmSync(rawDir, { recursive: true, force: true });
    rec.raw_deleted = true;
    writeJson(recPath, rec);
  }
  return rec;
}

function takeRecords(out, shot) {
  const recs = [];
  const shots = shot ? String(shot).split(',') : fs.readdirSync(out).filter((d) => /^U\d\d$/.test(d)).sort();
  for (const s of shots) {
    const dir = path.join(out, s);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => /^(zh|en)-take\d+\.json$/.test(x))) {
      recs.push({ path: path.join(dir, f), rec: readJson(path.join(dir, f)) });
    }
  }
  const langOrder = { zh: 0, en: 1 };
  recs.sort((a, b) => a.rec.shot.localeCompare(b.rec.shot) || langOrder[a.rec.lang] - langOrder[b.rec.lang] || a.rec.take - b.rec.take);
  return recs;
}

// 每個 take 一條 8 格縮圖（從原始幀取：第 k 格＝影片時間 (k+0.5)/8 當下顯示的那一幀），存在 <鏡頭>/_strips/
function contactStrip(rec, meta, kept, rawDir, opts) {
  const { ffmpeg } = opts.paths;
  const dur = meta.tEnd - kept[0].t;
  const picks = [];
  for (let k = 0; k < 8; k++) {
    const t = kept[0].t + (k + 0.5) * dur / 8;
    let f = kept[0];
    for (const x of kept) { if (x.t <= t) f = x; else break; }
    picks.push({ file: path.join(rawDir, f.file), t: +(t - kept[0].t).toFixed(1) });
  }
  const phone = meta.height > meta.width;
  const scale = phone ? 'scale=-2:560' : 'scale=560:-2';
  const font = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
  const label = `${rec.shot} ${rec.lang}-take${rec.take}   ${dur.toFixed(1)} s   ${meta.width}x${meta.height}   samples at ${picks.map((p) => p.t).join(' / ')} s`.replace(/:/g, '\\:');
  const inputs = picks.flatMap((p) => ['-i', p.file]);
  const fc = picks.map((_, i) => `[${i}:v]${scale},pad=iw+8:ih+8:4:4:color=0xf9f3e6[v${i}]`).join(';') +
    `;${picks.map((_, i) => `[v${i}]`).join('')}hstack=inputs=8,pad=iw+8:ih+60:4:56:color=0xf9f3e6,` +
    `drawtext=fontfile=${font}:text='${label}':x=12:y=14:fontsize=26:fontcolor=0x4b2e1e[out]`;
  const dir = path.join(opts.out, rec.shot, '_strips');
  fs.mkdirSync(dir, { recursive: true });
  const strip = path.join(dir, `${rec.lang}-take${rec.take}.png`);
  const res = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', fc, '-map', '[out]', '-frames:v', '1', strip], { encoding: 'utf8' });
  if (res.status !== 0) { log(`contact strip failed for ${rec.shot}/${rec.lang}-take${rec.take}: ${res.stderr}`); return null; }
  return path.relative(opts.out, strip);
}

// 一個鏡頭一張 contact sheet：把各 take 的縮圖條上下疊起來（zh 在前，take 依序）
function contactSheet(out, shot, paths) {
  const { ffmpeg } = paths;
  const recs = takeRecords(out, shot).filter((x) => x.rec.strip && fs.existsSync(path.join(out, x.rec.strip)));
  if (!recs.length) return null;
  const strips = recs.map((x) => path.join(out, x.rec.strip));
  const sheet = path.join(out, shot, `contact-sheet-${shot}.png`);
  const inputs = strips.flatMap((st) => ['-i', st]);
  const filter = strips.length === 1 ? '[0:v]null[out]'
    : `${strips.map((_, i) => `[${i}:v]`).join('')}vstack=inputs=${strips.length}[out]`;
  const res = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', sheet], { encoding: 'utf8' });
  if (res.status !== 0) { log(`contact sheet failed for ${shot}: ${res.stderr}`); return null; }
  log(`contact sheet ${path.relative(out, sheet)} (${strips.length} takes)`);
  return sheet;
}

// 修正 -t 之前組裝的檔：ProRes 每一幀都是關鍵幀，stream copy 截到真實長度就是逐幀精確的結果
function retrimAll(args) {
  const out = path.resolve(args.out || '/mnt/Data_SSD/urdiary-media/recordings');
  const { ffmpeg, ffprobe } = ffmpegPaths();
  for (const { path: p, rec } of takeRecords(out, args.shot)) {
    if (!rec.file || !rec.assembled) continue;
    const expect = rec.assembled.expected_duration_s;
    if (rec.ffprobe.duration_s - expect <= 0.05) continue;
    const file = path.join(out, rec.file);
    const tmp = file.replace(/(\.[a-z0-9]+)$/, '.retrim$1');
    const res = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0', '-c', 'copy', '-t', expect.toFixed(3), tmp], { encoding: 'utf8' });
    if (res.status !== 0) { log(`retrim failed ${rec.file}: ${res.stderr}`); continue; }
    fs.renameSync(tmp, file);
    const before = rec.ffprobe.duration_s;
    rec.ffprobe = ffprobeJson(ffprobe, file);
    rec.assembled.retrimmed_from_s = before;
    rec.assembled.verified = rec.ffprobe.width > 0 && rec.ffprobe.r_frame_rate === '60/1' && Math.abs(rec.ffprobe.duration_s - expect) <= 0.05;
    writeJson(p, rec);
    log(`retrimmed ${rec.file}: ${before}s → ${rec.ffprobe.duration_s}s (expected ${expect}s) verified=${rec.assembled.verified}`);
    const rawDir = path.join(out, rec.raw_dir);
    if (rec.assembled.verified && fs.existsSync(rawDir) && !args['keep-raw']) {
      fs.rmSync(rawDir, { recursive: true, force: true }); rec.raw_deleted = true; writeJson(p, rec);
    }
  }
}

function assembleAll(args) {
  const out = path.resolve(args.out || '/mnt/Data_SSD/urdiary-media/recordings');
  const paths = ffmpegPaths();
  const codec = args.codec === 'h264' ? 'h264' : 'prores';
  const touched = new Set();
  let todo = takeRecords(out, args.shot).filter(({ rec }) => !args.lang || rec.lang === args.lang);
  // --longest-first：幾個組裝行程平行跑時，長的先做，尾巴比較短
  if (args['longest-first']) todo = todo.slice().sort((a, b) => (b.rec.raw_duration_s || 0) - (a.rec.raw_duration_s || 0));
  for (const { path: p, rec } of todo) {
    if (rec.file && !args.force) continue;
    if (rec.status !== 'ok' && !args['include-failed']) { log(`skip failed take ${p}`); continue; }
    try {
      assembleTake(p, { out, paths, codec, keepRaw: !!args['keep-raw'], force: !!args.force, nice: true, threads: args.threads || 0 });
      touched.add(rec.shot);
    } catch (e) { log(`ASSEMBLY ERROR ${p}: ${e.message}`); }
  }
  if (args['no-sheets']) return;   // 平行組裝時各行程不寫 contact sheet，最後用 --sheets 一次重做
  const shots = args.sheets === 'all' ? fs.readdirSync(out).filter((d) => /^U\d\d$/.test(d)) : Array.from(touched);
  for (const s of shots.sort()) contactSheet(out, s, paths);
}

// ---------------------------------------------------------------------------
// SHOTLOG.md（每個 take：檔案、長度、解析度／fps、發生了什麼、LLM 原文、建議、問題）
// ---------------------------------------------------------------------------
function buildShotlog(args) {
  const out = path.resolve(args.out || '/mnt/Data_SSD/urdiary-media/recordings');
  const picksPath = path.join(out, '_picks.json');
  const picks = fs.existsSync(picksPath) ? readJson(picksPath) : {};
  const recs = takeRecords(out);
  const byShot = {};
  for (const x of recs) (byShot[x.rec.shot] = byShot[x.rec.shot] || []).push(x.rec);
  const quote = (t) => String(t).split('\n').map((l) => `> ${l}`).join('\n');
  const local = (iso) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }) + '（台北）' : '-');
  const byKey = {};
  for (const x of recs) byKey[`${x.rec.shot}/${x.rec.lang}-take${x.rec.take}`] = x.rec;
  // 為了磁碟空間刪掉的舊 .mov：JSON 與縮圖條還在，表格標「已刪」
  const fileCell = (rec) => (!rec.file ? '（未組裝）' : '`' + rec.file + '`' + (fs.existsSync(path.join(out, rec.file)) ? '' : '（已刪）'));
  const L = [];
  L.push('# URDiary 介紹影片 UI 錄影記錄（SHOTLOG）', '');
  L.push(`產生時間：${local(new Date().toISOString())}　｜　錄影器：\`promo/record/record_shots.js\`　｜　分鏡：\`promo/video/STORYBOARD.md\` §3`, '');
  if (picks._header) L.push(picks._header, '');
  L.push('每個 take 一段：檔案、ffprobe（解析度／fps／長度）、事件時間軸（秒＝影片時間）、LLM 原文（照錄、未改字）、自動檢查、挑選建議與問題。', '');
  L.push('## 總覽', '', '| 鏡頭 | take | 檔案 | 長度 | 解析度／fps | 建議 |', '|---|---|---|---|---|---|');
  for (const shot of Object.keys(byShot).sort()) {
    for (const rec of byShot[shot]) {
      const k = `${shot}/${rec.lang}-take${rec.take}`;
      const p = picks[k] || {};
      const fp = rec.ffprobe;
      L.push(`| ${shot} | ${rec.lang}-take${rec.take} | ${fileCell(rec)} | ${fp ? fp.duration_s.toFixed(1) + ' s' : '-'} | ${fp ? `${fp.width}×${fp.height} ${fp.r_frame_rate} ${fp.codec}` : '-'} | ${p.pick || ''} |`);
    }
  }
  L.push('');
  for (const shot of Object.keys(byShot).sort()) {
    L.push(`## ${shot}`, '');
    if (picks[shot]) L.push(picks[shot], '');
    for (const rec of byShot[shot]) {
      const k = `${shot}/${rec.lang}-take${rec.take}`;
      const p = picks[k] || {};
      const fp = rec.ffprobe;
      L.push(`### ${k}${p.pick ? `　—　${p.pick}` : ''}`, '');
      L.push(`- 檔案：${fileCell(rec)}${fp ? `（${fp.size_mb} MB）` : ''}`);
      if (fp) L.push(`- ffprobe：${fp.codec}${fp.profile ? ' ' + fp.profile : ''}，${fp.width}×${fp.height}，${fp.pix_fmt}，r_frame_rate ${fp.r_frame_rate}，${fp.frames} 幀，${fp.duration_s} s`);
      L.push(`- 帳號／裝置：\`${rec.account}\`（${rec.ui_lang}），${rec.device} ${rec.viewport}；錄於 ${local(rec.started_at)}` +
        (rec.timezone && rec.timezone !== 'Asia/Taipei'
          ? `；後端與瀏覽器時區 ${rec.timezone}（當地 ${new Date(rec.started_at).toLocaleString('sv-SE', { timeZone: rec.timezone })}）` : ''));
      if (rec.frames) L.push(`- 擷取：${rec.frames.count} 張 screencast 幀，幀間隔 p50 ${rec.frames.p50_ms} ms／p95 ${rec.frames.p95_ms} ms` +
        (rec.frames.flushes !== undefined ? `，flush ${rec.frames.flushes} 次` : '（錄影器加 flush 之前錄的）') + '（畫面靜止時沿用前一幀）');
      for (const e of (rec.events || [])) if (e.text) L.push(`- 使用者輸入（${e.t.toFixed(1)}s 起逐字打）：「${e.text}」`);
      L.push(`- 狀態：${rec.status}${rec.error ? `（${rec.error}）` : ''}`);
      const ev = (rec.events || []).filter((e) => !/^recording (started|stopped)$/.test(e.what));
      if (ev.length) L.push(`- 發生了什麼：${ev.map((e) => `${e.t.toFixed(1)}s ${e.what}`).join('；')}`);
      const l = rec.llm || {};
      if (l.script) for (const s of l.script) L.push(`- 腳本訊息（i18n \`${s.key}\`，非 LLM）：「${s.text}」`);
      if (l.checkin) { L.push(`- 每日問候（${l.checkin.model || ''}，checkin=${l.checkin.checkin}${l.checkin.tea_mascot_rendered ? '，帶端茶吉祥物' : ''}）：`, '', quote(l.checkin.text || '（無）'), ''); }
      if (l.opening_checkin) {
        const oc = l.opening_checkin;
        L.push(`- 畫面上方的每日問候（${oc.model || ''}；後端 ${oc.backend_tz} 當地 ${oc.local_hhmm}＝${oc.label}版）：`, '', quote(oc.text || '（無）'), '');
      }
      for (const [i, x] of (l.replies || []).entries()) { L.push(`- 回覆 ${i + 1}（${x.model || ''}）：`, '', quote(x.text || '（無）'), ''); }
      if (l.end_chat) {
        const e = l.end_chat; const d = e.diary || {};
        // /chat/end/ 的回應不帶印章（印章寫在 day_notes）：主線的 U06 用同組 U07 日面板上讀到的
        const u07 = rec.shot === 'U06' ? byKey[`U07/${rec.lang}-take${rec.take}`] : null;
        const dp = u07 && u07.llm && u07.llm.day_panel;
        const stampTxt = d.stamp ? `${d.stamp}「${d.stamp_phrase || ''}」`
          : dp ? `${dp.stamp ? dp.stamp + ' ' : ''}「${dp.phrase || ''}」（同組 U07 日面板）` : '（回應不含印章）';
        L.push(`- 結束對話：系統訊息「${e.message}」；日記《${d.title}》valence ${d.valence}／arousal ${d.arousal}；印章 ${stampTxt}；待核可 ${e.memory_review ? e.memory_review.pending : '-'}；彩蛋 ${e.eggs && e.eggs.length ? e.eggs.join(', ') : '無'}`);
        if (d.summary) L.push(`- 日記摘要：${d.summary}`);
        if (d.content) L.push('- 日記全文：', '', quote(d.content), '');
      }
      if (l.day_panel) L.push(`- 日面板 ${l.day_panel.date}：印章卡 ${l.day_panel.stamp_card ? '有' : '無'}${l.day_panel.stamp ? `（${l.day_panel.stamp}）` : ''}${l.day_panel.phrase ? `，小語「${l.day_panel.phrase}」` : ''}`);
      if (l.approved_op) L.push(`- 核可的那一筆：${l.approved_op.text}${l.approved_op.isAdd ? '' : '（不是「新增到」）'}`);
      const c = rec.checks || {};
      const bits = [`stub 字樣 ${c.stub_text ? '⚠️有' : '無'}`, `危機詞 ${c.crisis_words && c.crisis_words.length ? '⚠️' + c.crisis_words.join('、') : '無'}`];
      if (c.recall) bits.push(`引用 ${c.recall.target}：日期 ${c.recall.date ? '✓' : '✗'}、標題 ${c.recall.title ? '✓' : '✗'}` +
        ('paraphrase' in c.recall ? `、轉述式回憶 ${c.recall.paraphrase ? '✓「' + c.recall.paraphrase_lines.join('」「') + '」' : '✗'}` : ''));
      if (c.checkin_time) bits.push(`上方問候 ${c.checkin_time.label}版（${c.checkin_time.local}）${c.checkin_time.evening ? '✓' : '⚠️'}` +
        (c.checkin_time.says_evening ? '、問候明說晚上' : c.checkin_time.says_evening === false ? '、問候沒明說晚上' : '') +
        (c.checkin_time.conflicts.length ? `，⚠️ 提到 ${c.checkin_time.conflicts.join('、')}` : ''));
      if (c.mic_glyph) bits.push(`麥克風圖示 ${c.mic_glyph.ok ? '✓' : '⚠️✗'}（` + (c.mic_glyph.core_ink !== undefined
        ? `像素：膠囊核心墨 ${c.mic_glyph.core_ink}、圖形 ${c.mic_glyph.glyph_px}、高寬比 ${c.mic_glyph.aspect}` : `按鈕不在畫面上；CSS 規則 ${c.mic_glyph.css_rule ? '有' : '無'}、::before＝f130 ${c.mic_glyph.before_is_f130 ? '是' : '否'}`) + '）');
      if (c.footer_year) bits.push(`頁尾「${c.footer_year.text}」${c.footer_year.ok ? '✓' : '⚠️'}${c.footer_year.visible ? '' : '（不在畫面上）'}`);
      if (c.memory_titles) bits.push(`記憶檔節標題 ${c.memory_titles.lang} ${c.memory_titles.ok ? '✓' : '⚠️✗'}（${c.memory_titles.profile_headings.join('／')}）`);
      if ('page_stub' in c) bits.push(`畫面文字 stub ${c.page_stub ? '⚠️有' : '無'}、危機詞 ${c.page_crisis && c.page_crisis.length ? '⚠️' + c.page_crisis.join('、') : '無'}`);
      if ('valence' in c) bits.push(`valence ${c.valence}`);
      if ('egg' in c) bits.push(`彩蛋 ${c.egg || '無'}`);
      if ('pending_ops' in c) bits.push(`待核可 ${c.pending_ops}`);
      L.push(`- 自動檢查：${bits.join('；')}`);
      const notes = [...(rec.notes || []), ...(p.notes ? [p.notes] : [])];
      if (notes.length) L.push(`- 問題／備註：${notes.join('；')}`);
      if (p.why) L.push(`- 建議理由：${p.why}`);
      L.push('');
    }
  }
  if (picks._footer) L.push(picks._footer, '');
  const file = path.join(out, 'SHOTLOG.md');
  fs.writeFileSync(file, L.join('\n'));
  log(`wrote ${file} (${recs.length} takes)`);
}

// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    for (const [k, s] of Object.entries(SESSIONS)) console.log(`${k.padEnd(9)} ${s.device.padEnd(8)} role=${s.role.padEnd(6)} shots=${s.shots.join(',')}${s.llm ? '  (real LLM)' : ''}`);
    return;
  }
  if (args.retrim) return retrimAll(args);
  if (args.assemble) return assembleAll(args);
  if (args.sheets && !args.session) {
    const out = path.resolve(args.out || '/mnt/Data_SSD/urdiary-media/recordings');
    const paths = ffmpegPaths();
    for (const s of fs.readdirSync(out).filter((d) => /^U\d\d$/.test(d)).sort()) contactSheet(out, s, paths);
    return;
  }
  if (args.shotlog) return buildShotlog(args);
  if (!args.session) {
    const lines = fs.readFileSync(__filename, 'utf8').split('\n');
    console.log(lines.slice(1, lines.findIndex((l) => l.trim() === '*/') + 1).join('\n'));
    process.exit(2);
  }
  const recs = await runSession(args);
  for (const x of recs) log(`${x.shot} ${x.lang}-take${x.take}: ${x.status}; checks ${JSON.stringify(x.checks)}${x.notes.length ? '; notes ' + x.notes.join(' | ') : ''}`);
}

main().catch((e) => { console.error(e.stack || String(e)); process.exit(1); });
