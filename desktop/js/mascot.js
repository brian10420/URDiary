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

    // 安靜門檻：spec §4 原文寫「負向情緒 → 安靜版」並字面舉例 valence<0，
    // 但後端 valence 經 diary_draft.py 的 _clamp() 永遠夾在 [0,1]
    // （中性值 0.5，見 backend/app/services/diary_draft.py），不會是
    // 負數——照字面的 <0 在真實資料上永遠不會觸發，形同死碼。改用 0.45，
    // 對齊 getMoodFromValence()（desktop/js/api_service.js:1301-1311）
    // 判定 sad 的既有分界，沿用同一套「後端 valence 是 0~1 量表」慣例
    // （controller ruling R5，task 5 field-check 後裁定）。
    const QUIET_VALENCE_THRESHOLD = 0.45;

    function eggKindFor(valence, hour) {
        if (typeof valence === 'number' && valence < QUIET_VALENCE_THRESHOLD) return 'quiet';
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
