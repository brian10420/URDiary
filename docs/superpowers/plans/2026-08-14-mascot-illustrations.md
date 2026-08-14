# 吉祥物插圖與動畫 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以書本吉祥物建立前端視覺層：等待動畫（左右搖擺）、7 款姿態（空狀態/歡迎/彩蛋/晚安）、月曆 7 分類圖標（含新增「出遊」分類）兩級渲染。

**Architecture:** 全部 SVG 以模板字串內嵌單一模組 `desktop/js/mascot.js`（對外只暴露注入函式），動畫集中 `desktop/css/mascot.css`；兩檔加入 sw.js precache。彩蛋只綁操作事件＋情緒門檻（valence<0 → 靜態版；22:00–05:00 → 晚安版）。

**Tech Stack:** 手寫 inline SVG + CSS keyframes（零外部相依）、vitest。

**Spec:** `docs/superpowers/specs/2026-08-14-mascot-illustrations-design.md`（SVG 視覺已逐屏核可；mockup 原稿在 `.superpowers/brainstorm/3252250-1786691481/content/`）

## Global Constraints

- 測試指令同計畫 ①；後端只有 Task 6（travel 分類）動到，其餘純前端
- 色票固定：描邊 `#4b2e1e`、書皮 `#b98d6d`、書頁 `#f9f3e6`、書籤 `#5fd0a0`、睡帽 `#7f96c9`、星星 `#f5c542`；分類色沿用 `calendar.css` 的 `--cat-*`（health 圖標用 `#12a412`、other 用 `#b8b2a5`——調亮版只進圖標內嵌色，CSS 變數不動）
- `prefers-reduced-motion: reduce` 時所有吉祥物動畫停用（CSS 統一處理）
- 彩蛋硬規則：只綁操作事件；`valence < 0` → 靜態安靜版；聊天區永遠只有安靜動畫
- i18n 兩語成對；`desktop/sw.js` 的 `SHELL_ASSETS` 忘記加新檔＝離線缺圖（列入測試）

---

### Task 1: mascot.js＋mascot.css（核心模組）

**Files:**
- Create: `desktop/js/mascot.js`
- Create: `desktop/css/mascot.css`
- Test: `desktop/tests/mascot.test.js`

**Interfaces:**
- Produces（後續全部 task 依賴）：
  - `MascotModule.loadingHtml(size?: number) -> string`（搖擺吉祥物；size 預設 96）
  - `MascotModule.thinkingBubbleHtml() -> string`（26px 搖擺＋「思考中…」三點）
  - `MascotModule.emptyHtml(kind: 'diary'|'calendar'|'generic', caption: string) -> string`
  - `MascotModule.welcomeHtml() -> string`（揮手）／`MascotModule.checkinHtml() -> string`（端茶）
  - `MascotModule.eggKindFor(valence: number|null|undefined, hour: number) -> 'happy'|'goodnight'|'quiet'`
  - `MascotModule.showSaveEgg(kind) -> void`（overlay 1.5s 淡出，pointer-events:none）
  - `MascotModule.categoryIcon(category: string, size: number) -> string`（size<24 無臉版；未知分類 fallback 'other'）

- [ ] **Step 1: 寫失敗測試**

```javascript
/** MascotModule：彩蛋分流、分類圖標兩級渲染、未知分類 fallback。 */
const { loadScript } = require('./helpers/load.js');

describe('MascotModule', () => {
    beforeEach(() => { loadScript('js/mascot.js'); });

    test('eggKindFor：日間正向=happy、夜間=goodnight、負向永遠 quiet', () => {
        expect(MascotModule.eggKindFor(0.5, 14)).toBe('happy');
        expect(MascotModule.eggKindFor(null, 14)).toBe('happy');   // 無情緒資料視為正向
        expect(MascotModule.eggKindFor(0.5, 23)).toBe('goodnight');
        expect(MascotModule.eggKindFor(0.5, 4)).toBe('goodnight');
        expect(MascotModule.eggKindFor(0.5, 5)).toBe('happy');     // 05:00 整回日間
        expect(MascotModule.eggKindFor(-0.3, 23)).toBe('quiet');
        expect(MascotModule.eggKindFor(-0.3, 14)).toBe('quiet');
    });

    test('categoryIcon 兩級渲染：18px 無臉、24px 有臉', () => {
        const small = MascotModule.categoryIcon('work', 18);
        const big = MascotModule.categoryIcon('work', 24);
        expect(small).toContain('svg');
        expect(small).not.toContain('class="face"');
        expect(big).toContain('class="face"');
        expect(big).toContain('#2a78d6');
    });

    test('categoryIcon 未知分類 fallback other、七分類都有圖', () => {
        expect(MascotModule.categoryIcon('nonsense', 18))
            .toBe(MascotModule.categoryIcon('other', 18));
        for (const c of ['work','study','health','family','anniversary','other','travel']) {
            expect(MascotModule.categoryIcon(c, 24)).toContain('<svg');
        }
    });

    test('emptyHtml 帶 caption 且做 HTML escape', () => {
        const html = MascotModule.emptyHtml('diary', '<b>還沒有日記</b>');
        expect(html).toContain('&lt;b&gt;');
        expect(html).toContain('mascot-empty');
    });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/mascot.test.js`
Expected: FAIL — MascotModule 未定義。

- [ ] **Step 3: 實作 `js/mascot.js`**（SVG 路徑資料為已核可資產，原樣使用）

```javascript
/**
 * MascotModule (v2.4 spec ③)：書本吉祥物視覺層唯一來源。
 * 所有 SVG 以模板字串內嵌（零外部請求）；動畫 class 在 css/mascot.css。
 * 彩蛋硬規則見 eggKindFor —— 只綁操作事件、情緒門檻、夜間版。
 */
const MascotModule = (function () {
    const OUTLINE = '#4b2e1e';

    // -- 基底（正面 Q 版）與姿態 --------------------------------------------
    const BASE_BOOK = `
      <path d="M54 90 q0 -18 18 -18 h56 q18 0 18 18 v4 h-92 z" fill="#f9f3e6" stroke="${OUTLINE}" stroke-width="9" stroke-linejoin="round"/>
      <rect x="48" y="94" width="104" height="72" rx="16" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="9"/>
      <path d="M64 94 h20 v36 l-10 -9 -10 9 z" fill="#5fd0a0" stroke="${OUTLINE}" stroke-width="6" stroke-linejoin="round"/>`;
    const FACE_SMILE = `
      <circle cx="103" cy="126" r="6.5" fill="#2b1a10"/><circle cx="133" cy="126" r="6.5" fill="#2b1a10"/>
      <path d="M110 139 q8 7 16 0" stroke="#2b1a10" stroke-width="5" fill="none" stroke-linecap="round"/>`;
    const FACE_HAPPY = `
      <path d="M96 128 q7 -7 14 0 M126 128 q7 -7 14 0" stroke="#2b1a10" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M106 136 q12 12 24 0" stroke="#2b1a10" stroke-width="5" fill="none" stroke-linecap="round"/>`;
    const BLUSH = `
      <ellipse cx="92" cy="140" rx="7" ry="4.5" fill="#f0a78f" opacity="0.55"/>
      <ellipse cx="148" cy="140" rx="7" ry="4.5" fill="#f0a78f" opacity="0.55"/>`;

    function svg200(inner, size, extraClass) {
        return `<svg viewBox="0 0 200 200" width="${size}" height="${size}" class="${extraClass || ''}" aria-hidden="true">${inner}</svg>`;
    }
    function svg220(inner, size) {
        return `<svg viewBox="0 0 220 200" width="${size}" height="${Math.round(size * 200 / 220)}" aria-hidden="true">${inner}</svg>`;
    }

    const POSE_SLEEP = `
      <text x="150" y="52" font-size="22" fill="#a58a70" font-weight="bold" transform="rotate(12 150 52)">z</text>
      <text x="168" y="38" font-size="16" fill="#bfa88d" font-weight="bold" transform="rotate(12 168 38)">z</text>
      <g transform="rotate(-6 100 130)">${BASE_BOOK}
        <path d="M96 127 q7 5 14 0 M126 127 q7 5 14 0" stroke="#2b1a10" stroke-width="5" fill="none" stroke-linecap="round"/>
        <circle cx="120" cy="141" r="3.5" fill="#2b1a10"/></g>
      <g transform="rotate(24 186 150)">
        <rect x="180" y="118" width="11" height="52" rx="4" fill="#f2c94c" stroke="${OUTLINE}" stroke-width="5"/>
        <path d="M181 170 l4.5 12 l4.5 -12 z" fill="#e8b04b" stroke="${OUTLINE}" stroke-width="4" stroke-linejoin="round"/></g>`;

    const POSE_CALENDAR = `
      <g transform="rotate(8 178 92)">
        <rect x="156" y="66" width="46" height="42" rx="7" fill="#ffffff" stroke="${OUTLINE}" stroke-width="6"/>
        <rect x="156" y="66" width="46" height="12" rx="6" fill="#e8836f" stroke="${OUTLINE}" stroke-width="6"/>
        <circle cx="168" cy="89" r="2.6" fill="#d9c9ae"/><circle cx="179" cy="89" r="2.6" fill="#d9c9ae"/><circle cx="190" cy="89" r="2.6" fill="#d9c9ae"/>
        <circle cx="168" cy="99" r="2.6" fill="#d9c9ae"/><circle cx="179" cy="99" r="2.6" fill="#d9c9ae"/></g>
      <path d="M152 120 q14 -6 20 -14" stroke="${OUTLINE}" stroke-width="8" fill="none" stroke-linecap="round"/>
      ${BASE_BOOK}
      <circle cx="106" cy="126" r="6.5" fill="#2b1a10"/><circle cx="136" cy="126" r="6.5" fill="#2b1a10"/>
      <path d="M113 139 q8 7 16 0" stroke="#2b1a10" stroke-width="5" fill="none" stroke-linecap="round"/>`;

    const POSE_QUESTION = `
      <text x="140" y="58" font-size="42" fill="#a58a70" font-weight="bold" font-family="sans-serif">?</text>
      <g transform="rotate(5 100 130)">${BASE_BOOK}
        <circle cx="103" cy="126" r="6.5" fill="#2b1a10"/><circle cx="135" cy="124" r="6.5" fill="#2b1a10"/>
        <path d="M112 141 h14" stroke="#2b1a10" stroke-width="5" stroke-linecap="round"/></g>`;

    const POSE_WAVE = `
      <path d="M154 116 q16 -10 14 -26" stroke="${OUTLINE}" stroke-width="8" fill="none" stroke-linecap="round"/>
      <circle cx="169" cy="86" r="7" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="5"/>
      ${BASE_BOOK}${FACE_HAPPY}${BLUSH}`;

    const POSE_JUMP = `
      <ellipse cx="100" cy="176" rx="34" ry="7" fill="#d8c5ae"/>
      <path d="M42 70 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 z" fill="#f5c542" stroke="${OUTLINE}" stroke-width="3"/>
      <path d="M172 56 l3.5 8 8 3.5 -8 3.5 -3.5 8 -3.5 -8 -8 -3.5 8 -3.5 z" fill="#f5c542" stroke="${OUTLINE}" stroke-width="3"/>
      <path d="M186 118 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5 z" fill="#f5c542" stroke="${OUTLINE}" stroke-width="3"/>
      <g transform="translate(0 -18)">${BASE_BOOK}${FACE_HAPPY}</g>`;

    const POSE_TEA = `
      <path d="M174 84 q4 -6 0 -12 q-4 -6 0 -12 M186 88 q4 -6 0 -12" stroke="#c8b49a" stroke-width="4" fill="none" stroke-linecap="round"/>
      <rect x="164" y="96" width="30" height="24" rx="7" fill="#ffffff" stroke="${OUTLINE}" stroke-width="6"/>
      <path d="M194 102 q10 2 0 12" stroke="${OUTLINE}" stroke-width="5" fill="none"/>
      <path d="M152 122 q10 -8 18 -10" stroke="${OUTLINE}" stroke-width="8" fill="none" stroke-linecap="round"/>
      ${BASE_BOOK}${FACE_SMILE}`;

    const POSE_GOODNIGHT = `
      <path d="M190 40 a17 17 0 1 0 9 32 a13 13 0 1 1 -9 -32 z" fill="#f5c542" stroke="${OUTLINE}" stroke-width="3"/>
      <circle cx="46" cy="52" r="2.5" fill="#f9f3e6"/><circle cx="176" cy="96" r="2" fill="#f9f3e6"/><circle cx="30" cy="96" r="2" fill="#f9f3e6"/>
      ${BASE_BOOK}
      <path d="M58 74 Q78 30 128 38 Q158 44 164 66 L166 74 Q150 80 120 79 Q86 78 58 74 z" fill="#7f96c9" stroke="${OUTLINE}" stroke-width="8" stroke-linejoin="round"/>
      <path d="M162 66 q14 6 8 20 q-3 8 -12 8" fill="#7f96c9" stroke="${OUTLINE}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="158" cy="98" r="10" fill="#f9f3e6" stroke="${OUTLINE}" stroke-width="6"/>
      <path d="M52 80 q0 -12 12 -12 h72 q12 0 12 12 v2 q-24 6 -48 6 q-24 0 -48 -6 z" fill="#f3ecdd" stroke="${OUTLINE}" stroke-width="7" stroke-linejoin="round"/>
      <path d="M96 128 q7 5 14 0 M126 128 q7 5 14 0" stroke="#2b1a10" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M112 141 q7 6 14 0" stroke="#2b1a10" stroke-width="5" fill="none" stroke-linecap="round"/>
      <ellipse cx="92" cy="140" rx="7" ry="4.5" fill="#f0a78f" opacity="0.5"/>
      <ellipse cx="146" cy="140" rx="7" ry="4.5" fill="#f0a78f" opacity="0.5"/>`;

    // -- 分類圖標（48 viewBox；face 群組在 size<24 時整組省略） ----------------
    function faceGroup(inner) { return `<g class="face">${inner}</g>`; }
    const CAT_ICONS = {
        work: (f) => `
          <path d="M19 14 v-2.5 q0 -3.5 3.5 -3.5 h3 q3.5 0 3.5 3.5 V14" fill="none" stroke="${OUTLINE}" stroke-width="3.2" stroke-linecap="round"/>
          <rect x="7" y="14" width="34" height="24" rx="6" fill="#2a78d6" stroke="${OUTLINE}" stroke-width="3.2"/>
          ${f ? faceGroup('<circle cx="19" cy="25" r="2" fill="#12233f"/><circle cx="29" cy="25" r="2" fill="#12233f"/><path d="M20.5 30 q3.5 3 7 0" stroke="#12233f" stroke-width="2.4" fill="none" stroke-linecap="round"/>') : ''}`,
        study: (f) => `
          <g transform="rotate(45 24 24)">
            <rect x="17" y="1" width="14" height="8" rx="3" fill="#e8899a" stroke="${OUTLINE}" stroke-width="3"/>
            <rect x="17" y="7" width="14" height="25" rx="1.5" fill="#eda100" stroke="${OUTLINE}" stroke-width="3"/>
            <path d="M17 32 h14 l-7 10 z" fill="#f3d9a4" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/>
            <path d="M21.5 40.5 l2.5 3.5 2.5 -3.5 z" fill="${OUTLINE}"/>
            ${f ? faceGroup('<circle cx="21" cy="16" r="1.8" fill="#5a3d00"/><circle cx="27" cy="16" r="1.8" fill="#5a3d00"/><path d="M21.5 20.5 q2.5 2.2 5 0" stroke="#5a3d00" stroke-width="2.2" fill="none" stroke-linecap="round"/>') : ''}</g>`,
        health: (f) => `
          <path d="M19 7.5 h10 q2.5 0 2.5 2.5 v8.5 h8.5 q2.5 0 2.5 2.5 v6 q0 2.5 -2.5 2.5 h-8.5 v8.5 q0 2.5 -2.5 2.5 h-10 q-2.5 0 -2.5 -2.5 v-8.5 h-8.5 q-2.5 0 -2.5 -2.5 v-6 q0 -2.5 2.5 -2.5 h8.5 v-8.5 q0 -2.5 2.5 -2.5 z" fill="#12a412" stroke="${OUTLINE}" stroke-width="3.2" stroke-linejoin="round"/>
          ${f ? faceGroup('<circle cx="20" cy="23" r="2" fill="#063f06"/><circle cx="28" cy="23" r="2" fill="#063f06"/><path d="M21 27.5 q3 2.6 6 0" stroke="#063f06" stroke-width="2.4" fill="none" stroke-linecap="round"/>') : ''}`,
        family: (f) => `
          <path d="M6 23 L24 8 L42 23 q1.5 1.5 -1 2.5 H8 q-3 -0.5 -2 -2.5 z" fill="#12855c" stroke="${OUTLINE}" stroke-width="3.2" stroke-linejoin="round"/>
          <rect x="11" y="24" width="26" height="16" rx="3" fill="#1baf7a" stroke="${OUTLINE}" stroke-width="3.2"/>
          <rect x="20.5" y="31" width="7" height="9" rx="2.5" fill="#0e6b4a" ${f ? `stroke="${OUTLINE}" stroke-width="2.6"` : ''}/>
          ${f ? faceGroup('<circle cx="17.5" cy="29.5" r="1.9" fill="#06392a"/><circle cx="30.5" cy="29.5" r="1.9" fill="#06392a"/>') : ''}`,
        anniversary: (f) => `
          <ellipse cx="24" cy="5.5" rx="2.6" ry="3.4" fill="#f5c542" ${f ? `stroke="${OUTLINE}" stroke-width="2"` : ''}/>
          <rect x="22.4" y="8" width="3.2" height="7" fill="#fffdf8" stroke="${OUTLINE}" stroke-width="2.2"/>
          <path d="M12 15 h24 q3 0 3 3 v4 q0 3 -3 3 h-24 q-3 0 -3 -3 v-4 q0 -3 3 -3 z" fill="#f2b3c1" stroke="${OUTLINE}" stroke-width="3"/>
          <path d="M10 25 h28 q3 0 3 3 v8 q0 3 -3 3 H10 q-3 0 -3 -3 v-8 q0 -3 3 -3 z" fill="#e34948" stroke="${OUTLINE}" stroke-width="3.2"/>
          ${f ? faceGroup('<circle cx="19.5" cy="31" r="2" fill="#571212"/><circle cx="28.5" cy="31" r="2" fill="#571212"/><path d="M21 34.5 q3 2.6 6 0" stroke="#571212" stroke-width="2.4" fill="none" stroke-linecap="round"/>') : ''}`,
        other: (f) => `
          <path d="M12 7 h18 l8 8 v23 q0 3 -3 3 H12 q-3 0 -3 -3 V10 q0 -3 3 -3 z" fill="#b8b2a5" stroke="${OUTLINE}" stroke-width="3.2" stroke-linejoin="round"/>
          <path d="M30 7 v6 q0 2 2 2 h6 z" fill="#8f897c" ${f ? `stroke="${OUTLINE}" stroke-width="2.6" stroke-linejoin="round"` : ''}/>
          ${f ? faceGroup('<circle cx="19" cy="25" r="2" fill="#403b32"/><circle cx="28" cy="25" r="2" fill="#403b32"/><path d="M20.5 29.5 q3 2.6 6 0" stroke="#403b32" stroke-width="2.4" fill="none" stroke-linecap="round"/>') : ''}`,
        travel: (f) => `
          <path d="M19 13 v-2 q0 -3 3 -3 h4 q3 0 3 3 v2" fill="none" stroke="${OUTLINE}" stroke-width="3.2" stroke-linecap="round"/>
          <rect x="8" y="13" width="32" height="26" rx="6" fill="#8f62c9" stroke="${OUTLINE}" stroke-width="3.2"/>
          <rect x="13" y="13" width="4" height="26" fill="#6f46a3"/><rect x="31" y="13" width="4" height="26" fill="#6f46a3"/>
          ${f ? faceGroup('<circle cx="21" cy="24.5" r="2" fill="#2c1a47"/><circle cx="27" cy="24.5" r="2" fill="#2c1a47"/><path d="M21.5 29 q2.5 2.4 5 0" stroke="#2c1a47" stroke-width="2.4" fill="none" stroke-linecap="round"/>') : ''}`,
    };

    function escapeText(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // -- 對外 API -------------------------------------------------------------
    function loadingHtml(size) {
        return `<span class="mascot-sway">${svg200(BASE_BOOK + FACE_SMILE, size || 96)}</span>`;
    }

    function thinkingBubbleHtml() {
        return `<span class="mascot-sway">${svg200(BASE_BOOK + FACE_SMILE, 26)}</span>` +
            `<span class="mascot-dots"><span>.</span><span>.</span><span>.</span></span>`;
    }

    function emptyHtml(kind, caption) {
        const pose = kind === 'diary' ? POSE_SLEEP
                   : kind === 'calendar' ? POSE_CALENDAR : POSE_QUESTION;
        return `<div class="mascot-empty">${svg220(pose, 132)}` +
            `<p class="mascot-empty-caption">${escapeText(caption)}</p></div>`;
    }

    function welcomeHtml() { return `<div class="mascot-welcome">${svg220(POSE_WAVE, 110)}</div>`; }
    function checkinHtml() { return `<span class="mascot-checkin">${svg220(POSE_TEA, 44)}</span>`; }

    function eggKindFor(valence, hour) {
        if (typeof valence === 'number' && valence < 0) return 'quiet';
        if (hour >= 22 || hour < 5) return 'goodnight';
        return 'happy';
    }

    function showSaveEgg(kind) {
        if (kind === 'quiet') return; // 沉重的日記：安靜，不慶祝
        const pose = kind === 'goodnight' ? POSE_GOODNIGHT : POSE_JUMP;
        const wrap = document.createElement('div');
        wrap.className = 'mascot-egg' + (kind === 'goodnight' ? ' mascot-egg-night' : '');
        wrap.innerHTML = svg220(pose, 150);
        document.body.appendChild(wrap);
        setTimeout(() => { wrap.classList.add('fade'); }, 1200);
        setTimeout(() => { wrap.remove(); }, 1800);
    }

    function categoryIcon(category, size) {
        const draw = CAT_ICONS[category] || CAT_ICONS.other;
        const withFace = size >= 24;
        return `<svg viewBox="0 0 48 48" width="${size}" height="${size}" class="mascot-cat-icon" aria-hidden="true">${draw(withFace)}</svg>`;
    }

    return { loadingHtml, thinkingBubbleHtml, emptyHtml, welcomeHtml,
             checkinHtml, eggKindFor, showSaveEgg, categoryIcon };
})();

if (typeof window !== 'undefined') { window.MascotModule = MascotModule; }
```

- [ ] **Step 4: 建 `css/mascot.css`**

```css
/* 吉祥物動畫與版位 (v2.4 spec ③)。動畫只此一處；reduced-motion 統一停用。 */
.mascot-sway { display: inline-block; animation: mascot-sway 1.8s ease-in-out infinite; transform-origin: 50% 88%; }
@keyframes mascot-sway { 0%, 100% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } }

.mascot-dots span { animation: mascot-dot 1.2s infinite; font-weight: 700; }
.mascot-dots span:nth-child(2) { animation-delay: .2s; }
.mascot-dots span:nth-child(3) { animation-delay: .4s; }
@keyframes mascot-dot { 0%, 60%, 100% { opacity: .25; } 30% { opacity: 1; } }

.mascot-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 28px 12px; opacity: .95; }
.mascot-empty-caption { color: var(--text-secondary, #8a7a66); font-size: 14px; margin: 0; text-align: center; }

.mascot-welcome { display: flex; justify-content: center; margin-bottom: 6px; }
.mascot-checkin { display: inline-block; vertical-align: middle; margin-right: 6px; }

.mascot-egg {
    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    pointer-events: none; z-index: 2000; opacity: 1; transition: opacity .5s ease;
}
.mascot-egg.fade { opacity: 0; }
.mascot-egg-night { background: radial-gradient(circle at 50% 45%, rgba(62, 55, 82, .92), rgba(62, 55, 82, .75)); }
.mascot-egg:not(.mascot-egg-night) svg { animation: mascot-pop .45s ease-out; }
@keyframes mascot-pop { 0% { transform: translateY(18px) scale(.85); } 60% { transform: translateY(-6px) scale(1.04); } 100% { transform: translateY(0) scale(1); } }

.mascot-cat-icon { vertical-align: middle; }

@media (prefers-reduced-motion: reduce) {
    .mascot-sway, .mascot-dots span, .mascot-egg svg { animation: none !important; }
    .mascot-egg { transition: none; }
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/mascot.test.js`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add desktop/js/mascot.js desktop/css/mascot.css desktop/tests/mascot.test.js
git commit -m "feat(desktop): MascotModule——吉祥物 SVG 資產、動畫、彩蛋分流、分類圖標"
```

---

### Task 2: 掛載＋sw precache

**Files:**
- Modify: `desktop/index.html`（`<link rel="stylesheet" href="css/mascot.css">` 加在 mobile.css 之後；`<script src="js/mascot.js">` 加在 i18n.js 之後、其他 module 之前）
- Modify: `desktop/sw.js`（`SHELL_ASSETS` 陣列加 `'/css/mascot.css'` 與 `'/js/mascot.js'`——插在對應區段，維持該檔註解說的「與 index.html 同步」）
- Test: 既有 sw 相關測試（`grep -rln "SHELL_ASSETS\|sw_logic" desktop/tests/` 找到的檔案）若斷言資產清單，更新之

- [ ] **Step 1: 兩檔掛載＋SHELL_ASSETS 追加**
- [ ] **Step 2: `npm test` 全綠**（sw 測試如有清單斷言，同步更新並在 commit message 註明）
- [ ] **Step 3: Commit**

```bash
git add desktop/index.html desktop/sw.js desktop/tests
git commit -m "feat(desktop): mascot 資產掛載＋sw precache 同步"
```

---

### Task 3: 聊天整合（思考中＋check-in＋歡迎）

**Files:**
- Modify: `desktop/js/chat_module.js`（`addThinkingMessage` :667、`requestDailyCheckin` :308）
- Modify: `desktop/index.html:121` 附近（登入 modal 的 `<h3 data-i18n="login.title">` 之前插 `<div id="login-mascot"></div>`）
- Modify: `desktop/js/main.js` 或登入 modal 顯示邏輯處（以 `grep -n "login.title\|login-username" desktop/js/main.js` 找到開啟登入框的函式，注入 welcomeHtml）
- Test: `desktop/tests/mascot_chat.test.js`

- [ ] **Step 1: 寫失敗測試**

```javascript
const { loadScript } = require('./helpers/load.js');

describe('mascot chat integration', () => {
    beforeEach(() => {
        loadScript('js/mascot.js');
    });

    test('thinkingBubbleHtml 含搖擺吉祥物與三點', () => {
        const html = MascotModule.thinkingBubbleHtml();
        expect(html).toContain('mascot-sway');
        expect(html).toContain('mascot-dots');
    });

    test('checkinHtml 是行內小尺寸（44px）', () => {
        expect(MascotModule.checkinHtml()).toContain('width="44"');
    });
});
```

- [ ] **Step 2: 確認失敗（首次跑會過——本 task 的主要工作是接線，測試先鎖模組輸出）→ 實作接線**
  - `addThinkingMessage()`：思考泡泡的 inner HTML 改為 `MascotModule.thinkingBubbleHtml()`（保留既有外層 class 與捲動行為；原本的「...」動畫元素移除）
  - `requestDailyCheckin` 成功路徑：check-in 問候訊息的 bubble 內文前綴 `MascotModule.checkinHtml()`（作為 HTML 前綴時注意該處是否走 textContent——若是，改用既有的 system/assistant HTML 渲染路徑，比照 `appendChatMessage` 對 HTML 的處理慣例；使用者文字仍必須 escape）
  - 登入 modal：開啟時 `document.getElementById('login-mascot').innerHTML = MascotModule.welcomeHtml()`
- [ ] **Step 3: `npm test` 全綠＋手動看一眼（`cd desktop && npm start -- --no-sandbox`）：送訊息出現搖擺思考泡泡**
- [ ] **Step 4: Commit**

```bash
git add desktop/js/chat_module.js desktop/js/main.js desktop/index.html desktop/tests/mascot_chat.test.js
git commit -m "feat(desktop): 聊天思考動畫、check-in 端茶、登入歡迎吉祥物"
```

---

### Task 4: 空狀態整合（日記／行事曆／無結果）

**Files:**
- Modify: `desktop/js/diary_module.js`（日記清單為空的渲染分支——`grep -n "noContent\|沒有\|empty\|length === 0" desktop/js/diary_module.js` 定位）
- Modify: `desktop/js/calendar_module.js`（無事件視圖分支，同法定位）
- Modify: `desktop/js/i18n.js`（4 個 caption key，兩語）
- Test: `desktop/tests/mascot_empty.test.js`

- [ ] **Step 1: 寫失敗測試**

```javascript
const { loadScript } = require('./helpers/load.js');

describe('mascot empty states', () => {
    beforeEach(() => { loadScript('js/mascot.js'); });

    test('三種空狀態各用對應姿勢（睡覺 zzz／月曆紙／問號）', () => {
        expect(MascotModule.emptyHtml('diary', 'x')).toContain('>z<');
        expect(MascotModule.emptyHtml('calendar', 'x')).toContain('#e8836f');
        expect(MascotModule.emptyHtml('generic', 'x')).toContain('>?<');
    });
});
```

- [ ] **Step 2: 實作接線**——各清單/視圖的「空」分支輸出改為：
  - 日記空清單：`listEl.innerHTML = MascotModule.emptyHtml('diary', I18N.t('mascot.emptyDiary'))`
  - 行事曆無事件（週/日視圖的空區）：`MascotModule.emptyHtml('calendar', I18N.t('mascot.emptyCalendar'))`
  - 搜尋/篩選無結果（若該視圖存在）：`MascotModule.emptyHtml('generic', I18N.t('mascot.emptyGeneric'))`
  - i18n 兩語：`'mascot.emptyDiary': '還沒有日記——跟我聊聊今天吧' / "No diaries yet — come tell me about your day"`、`'mascot.emptyCalendar': '這週還空空的，要記點什麼嗎？' / "This week is wide open — want to note something?"`、`'mascot.emptyGeneric': '這裡還沒有東西耶' / "Nothing here yet"`
- [ ] **Step 3: `npm test` 全綠 → Step 4: Commit**

```bash
git add desktop/js/diary_module.js desktop/js/calendar_module.js desktop/js/i18n.js desktop/tests/mascot_empty.test.js
git commit -m "feat(desktop): 空狀態吉祥物插圖（日記/行事曆/無結果）"
```

---

### Task 5: 存日記彩蛋（情緒門檻＋夜間晚安版）

**Files:**
- Modify: `desktop/js/chat_module.js`（`endChat` :693 的日記生成成功路徑）
- Test: `desktop/tests/mascot.test.js`（eggKindFor 已於 Task 1 覆蓋；本 task 補接線煙霧測試如可行）

- [ ] **Step 1: 定位成功回呼**——`endChat()` 內日記生成 API 成功、顯示「日記已生成」訊息之處（`grep -n "endChat\|generate" desktop/js/chat_module.js` 區段內）。
- [ ] **Step 2: 接線**

```javascript
        // v2.4 spec ③：存日記彩蛋。只綁這個操作事件；negative valence → 安靜略過。
        const valence = (diaryResult && typeof diaryResult.valence === 'number')
            ? diaryResult.valence : null;
        MascotModule.showSaveEgg(MascotModule.eggKindFor(valence, new Date().getHours()));
```
（`diaryResult` 為該處既有的 API 回傳變數名，依現場；若回傳不含 `valence` 欄位，等同 null＝視為正向——後端 Diary 模型有 valence 欄，回傳有帶就自動生效。）

- [ ] **Step 3: `npm test` 全綠＋手動：結束對話生成日記 → 白天出現開心跳、22:00 後出現晚安版（可暫改系統時間驗證）**
- [ ] **Step 4: Commit**

```bash
git add desktop/js/chat_module.js
git commit -m "feat(desktop): 存日記彩蛋——開心跳/晚安版，負向情緒安靜略過"
```

---

### Task 6: 新增「出遊 travel」分類（前後端）

**Files:**
- Modify: `backend/app/api/schemas.py:28`（`_CalendarCategory` Literal 加 `"travel"`）
- Modify: `backend/app/services/calendar_service.py:31`（`CATEGORIES` tuple 加 `"travel"`——順序放 `"anniversary"` 之後、`"other"` 之前）
- Modify: `backend/app/database/models.py:184`（註解補 travel）
- Modify: `desktop/js/calendar_module.js`（前端 `CATEGORIES` 陣列同步加 `'travel'`，同樣放 other 之前）
- Modify: `desktop/index.html:274` select（`anniversary` 之後加 `<option value="travel" data-i18n="category.travel">出遊</option>`）
- Modify: `desktop/js/i18n.js`（兩語 `'category.travel': '出遊'` / `'Outing'`）
- Modify: `desktop/css/calendar.css`（:28-33 light 與 :38-43 dark 兩個變數區塊各加 `--cat-travel: #8f62c9;` 與 `--cat-travel: #a678e8;`；:215-220 加 `.cat-travel { background-color: var(--cat-travel); }`）
- Test: `backend/tests/test_calendar_api.py`（追加）

- [ ] **Step 1: 追加失敗測試**（比照該檔既有建立事件測試的 body 寫法）

```python
def test_create_event_travel_category(client):
    headers, _ = _create_and_login(client, _unique_username())
    resp = client.post("/calendar/events", headers=headers, json={
        "title": "去台南玩", "category": "travel", "event_date": "2026-09-01"})
    assert resp.status_code == 200
    assert resp.json()["category"] == "travel"
```
（實際路徑/回傳形狀以該檔既有測試為準照抄；若建立回傳包在別的鍵下，斷言對齊。）

- [ ] **Step 2: 確認失敗（422）→ Step 3: 七處實作 → Step 4: backend pytest -q＋desktop npm test 全綠**
- [ ] **Step 5: Commit**

```bash
git add backend/app/api/schemas.py backend/app/services/calendar_service.py backend/app/database/models.py desktop/js/calendar_module.js desktop/index.html desktop/js/i18n.js desktop/css/calendar.css backend/tests/test_calendar_api.py
git commit -m "feat: 行事曆新增「出遊 travel」分類（紫 #8f62c9，前後端＋i18n＋色票）"
```

---

### Task 7: 月曆圖標兩級渲染＋人工驗收

**Files:**
- Modify: `desktop/js/calendar_module.js:449`（月格 `<span class="cat-dot cat-…">` → `MascotModule.categoryIcon(category, 18)`，保留原 title tooltip：外包一層 `<span title="${tip}">…</span>`）
- Modify: `desktop/js/calendar_module.js:488`（日清單 `<span class="cat-dot …">` → `MascotModule.categoryIcon(category, 24)`）
- Modify: `desktop/css/calendar.css`（月格內 `.mascot-cat-icon` 的間距微調；`.cat-dot` 樣式保留——退路與其他殘留用途）
- Test: `desktop/tests/calendar_helpers.test.js`（若該檔測到 cat-dot 輸出，斷言更新為含 `mascot-cat-icon`）

- [ ] **Step 1: 兩處替換＋css 間距**（月格一天多事件時圖標橫排 `gap: 2px`，超出寬度由既有格子溢出規則處理）
- [ ] **Step 2: `npm test` 全綠**
- [ ] **Step 3: 人工驗收清單（交使用者）**
  - 桌面＋手機 PWA：月視圖 18px 圖標可辨識（七分類各建一筆看過）；日清單 24px 有臉版
  - 深色主題下月格圖標與晚安彩蛋各看一次
  - `prefers-reduced-motion`（系統設定開啟）：思考泡泡與彩蛋皆靜止
  - 若實機 18px 仍糊 → 該處退回 `cat-dot` 色點（一行 revert，css 未刪）
- [ ] **Step 4: Commit**

```bash
git add desktop/js/calendar_module.js desktop/css/calendar.css desktop/tests/calendar_helpers.test.js
git commit -m "feat(desktop): 月曆分類吉祥物圖標兩級渲染（月格 18px 無臉/清單 24px 有臉）"
```

---

## Self-Review 紀錄

- Spec 覆蓋：§1 基底與色票（Task 1 常數）、§3 等待動畫＋reduced-motion（Task 1 css＋Task 3）、§4 七姿勢與彩蛋硬規則（Task 1/3/4/5；goodnight=夜間存日記替代版與 spec 一致）、§5 分類圖標＋travel＋兩級渲染（Task 6/7）、§6 工程結構（單一 mascot.js/css＋sw precache＝Task 1/2）、§7 測試（各 task＋Task 7 人工項）、§8 風險（18px 退路寫在 Task 7 驗收）。
- 型別一致：`eggKindFor -> 'happy'|'goodnight'|'quiet'` 與 `showSaveEgg(kind)` 貫穿 Task 1/5；`categoryIcon(category, size)` 貫穿 Task 1/7；`emptyHtml(kind, caption)` 貫穿 Task 1/4。
- 現場變異點：diary/calendar 空分支與 endChat 成功回呼的確切行號（已附 grep 定位法）、checkin 訊息是否走 HTML 渲染路徑（Task 3 已註明 escape 要求）、crisis 流程無前端訊號——彩蛋以「事件綁定＋valence 門檻」實現 spec 硬規則（spec §4 語意）。
