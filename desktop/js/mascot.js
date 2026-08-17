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

    // -- AI 日記印章（48 viewBox；v2.5 Spec A，原稿 stamp-library-v3 已逐屏核可） --
    const STAMP_ICONS = {
        cake: `<rect x="10" y="24" width="28" height="14" rx="3" fill="#f2b3c1" stroke="${OUTLINE}" stroke-width="3"/><rect x="14" y="17" width="20" height="9" rx="2.5" fill="#fffdf8" stroke="${OUTLINE}" stroke-width="3"/><rect x="22.7" y="9" width="2.6" height="8" fill="${OUTLINE}"/><ellipse cx="24" cy="7" rx="2.5" ry="3.5" fill="#f5c542" stroke="${OUTLINE}" stroke-width="2"/>`,
        gift: `<rect x="9" y="21" width="30" height="17" rx="3" fill="#e8836f" stroke="${OUTLINE}" stroke-width="3"/><rect x="7" y="14" width="34" height="8" rx="2.5" fill="#e34948" stroke="${OUTLINE}" stroke-width="3"/><rect x="21.5" y="14" width="5" height="24" fill="#f5c542" stroke="${OUTLINE}" stroke-width="2"/><path d="M24 13 q-7 -7 -10 -2 q-2 4 10 2 z M24 13 q7 -7 10 -2 q2 4 -10 2 z" fill="#f5c542" stroke="${OUTLINE}" stroke-width="2.5" stroke-linejoin="round"/>`,
        heart: `<path d="M37 6.5 c-2.8 -2.8 -6.5 -1 -6.5 2.2 c0 2.8 2.8 4.7 6.5 7.5 c3.7 -2.8 6.5 -4.7 6.5 -7.5 c0 -3.2 -3.7 -5 -6.5 -2.2 z" fill="#e8899a" stroke="${OUTLINE}" stroke-width="2.4" stroke-linejoin="round"/><path d="M13 20 q0 -5.5 5.5 -5.5 h11 q5.5 0 5.5 5.5 v1 h-22 z" fill="#f9f3e6" stroke="${OUTLINE}" stroke-width="2.6" stroke-linejoin="round"/><rect x="11" y="20" width="26" height="19" rx="5" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="3"/><path d="M15 20 h5.5 v8.5 l-2.75 -2.4 -2.75 2.4 z" fill="#5fd0a0" stroke="${OUTLINE}" stroke-width="1.8" stroke-linejoin="round"/><circle cx="21" cy="28.5" r="1.7" fill="#2b1a10"/><circle cx="29" cy="28.5" r="1.7" fill="#2b1a10"/><path d="M22.5 32 q2.5 2.2 5 0" stroke="#2b1a10" stroke-width="1.8" fill="none" stroke-linecap="round"/><ellipse cx="16.5" cy="32" rx="2" ry="1.3" fill="#f0a78f" opacity=".6"/><ellipse cx="33.5" cy="32" rx="2" ry="1.3" fill="#f0a78f" opacity=".6"/>`,
        cheers: `<g transform="rotate(-12 15 28)"><rect x="8" y="20" width="13" height="13" rx="3" fill="#fffdf8" stroke="${OUTLINE}" stroke-width="3"/><path d="M21 23 q6 1 0 7" fill="none" stroke="${OUTLINE}" stroke-width="2.5"/></g><g transform="rotate(12 34 28)"><rect x="27" y="20" width="13" height="13" rx="3" fill="#fffdf8" stroke="${OUTLINE}" stroke-width="3"/><path d="M27 23 q-6 1 0 7" fill="none" stroke="${OUTLINE}" stroke-width="2.5"/></g><path d="M24 10 l1.4 4 M19 12 l-1.2 3 M29 12 l1.2 3" stroke="#f5c542" stroke-width="2.5" stroke-linecap="round"/>`,
        trophy: `<path d="M15 10 h18 v8 q0 9 -9 9 q-9 0 -9 -9 z" fill="#f5c542" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/><path d="M15 12 q-7 1 -4 8 q2 4 6 3 M33 12 q7 1 4 8 q-2 4 -6 3" fill="none" stroke="${OUTLINE}" stroke-width="2.5"/><rect x="21.5" y="27" width="5" height="5" fill="#e8b04b" stroke="${OUTLINE}" stroke-width="2"/><rect x="16" y="32" width="16" height="5" rx="2" fill="#e8b04b" stroke="${OUTLINE}" stroke-width="2.5"/>`,
        flag: `<rect x="13" y="8" width="3.5" height="32" rx="1.7" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="2"/><path d="M17 10 l20 5.5 -20 5.5 z" fill="#e8836f" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/>`,
        book: `<path d="M15 15 q0 -4.5 5 -4.5 h8 q5 0 5 4.5 v1 h-18 z" fill="#f9f3e6" stroke="${OUTLINE}" stroke-width="2.4" stroke-linejoin="round"/><rect x="13" y="16" width="22" height="15" rx="4.5" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="2.8"/><circle cx="21" cy="22" r="1.5" fill="#2b1a10"/><circle cx="27.5" cy="22" r="1.5" fill="#2b1a10"/><path d="M22.5 25 q2 1.8 4 0" stroke="#2b1a10" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M24 36 q-9 -4 -18 -2.5 v9 q9 -1.5 18 2.5 z" fill="#fffdf8" stroke="${OUTLINE}" stroke-width="2.6" stroke-linejoin="round"/><path d="M24 36 q9 -4 18 -2.5 v9 q-9 -1.5 -18 2.5 z" fill="#f9f3e6" stroke="${OUTLINE}" stroke-width="2.6" stroke-linejoin="round"/>`,
        star: `<path d="M24 7 l4.8 10.4 11.2 1.2 -8.3 7.8 2.4 11.1 -10.1 -5.9 -10.1 5.9 2.4 -11.1 -8.3 -7.8 11.2 -1.2 z" fill="#f5c542" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/>`,
        plane: `<path d="M8 26 L40 12 32 38 24 28 z" fill="#dceafc" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/><path d="M24 28 L40 12" stroke="${OUTLINE}" stroke-width="2.5"/><path d="M24 28 l-2 8" stroke="${OUTLINE}" stroke-width="2.5"/>`,
        camera: `<rect x="18" y="11" width="11" height="7" rx="2" fill="#7f96c9" stroke="${OUTLINE}" stroke-width="3"/><rect x="8" y="15" width="32" height="21" rx="4" fill="#7f96c9" stroke="${OUTLINE}" stroke-width="3"/><circle cx="24" cy="25.5" r="6.5" fill="#fffdf8" stroke="${OUTLINE}" stroke-width="3"/><circle cx="24" cy="25.5" r="2.5" fill="${OUTLINE}"/><circle cx="35" cy="20" r="1.8" fill="#f5c542"/>`,
        ball: `<circle cx="24" cy="24" r="14" fill="#fffdf8" stroke="${OUTLINE}" stroke-width="3"/><path d="M24 17.5 l5.3 3.9 -2 6.2 h-6.6 l-2 -6.2 z" fill="${OUTLINE}"/><path d="M24 17.5 v-7 M29.3 21.4 l6.6 -2.2 M27.3 27.6 l4 5.4 M20.7 27.6 l-4 5.4 M18.7 21.4 l-6.6 -2.2" stroke="${OUTLINE}" stroke-width="2.2"/>`,
        movie: `<rect x="7" y="16" width="34" height="17" rx="3" fill="#f2b3c1" stroke="${OUTLINE}" stroke-width="3"/><path d="M30 17 v15" stroke="${OUTLINE}" stroke-width="2" stroke-dasharray="2.5 2.5"/><path d="M34.7 21 l1.2 2.6 2.8 .3 -2.1 2 .5 2.8 -2.4 -1.4 -2.4 1.4 .5 -2.8 -2.1 -2 2.8 -.3 z" fill="#e34948"/><path d="M11 21 h14 M11 25 h14 M11 29 h9" stroke="#a06b7a" stroke-width="2"/>`,
        music: `<ellipse cx="15" cy="35" rx="5.5" ry="4.5" fill="${OUTLINE}"/><ellipse cx="33" cy="31" rx="5.5" ry="4.5" fill="${OUTLINE}"/><path d="M20.5 35 v-21 l18 -4 v21" fill="none" stroke="${OUTLINE}" stroke-width="3"/><path d="M20.5 16.5 l18 -4" stroke="${OUTLINE}" stroke-width="5"/>`,
        food: `<path d="M9 25 h30 q0 11 -9 13 h-12 q-9 -2 -9 -13 z" fill="#e8836f" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/><path d="M17 20 q2 -3 0 -6 M25 20 q2 -3 0 -6 M33 20 q2 -3 0 -6" stroke="#c8b49a" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M13 12 l7 10 M40 9 l-9 13" stroke="#b98d6d" stroke-width="2.5" stroke-linecap="round"/>`,
        coffee: `<rect x="11" y="18" width="19" height="17" rx="3.5" fill="#fffdf8" stroke="${OUTLINE}" stroke-width="3"/><path d="M30 22 q9 1 0 10" fill="none" stroke="${OUTLINE}" stroke-width="3"/><path d="M16 13 q2 -3 0 -5 M25 13 q2 -3 0 -5" stroke="#c8b49a" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M13 38 h22" stroke="${OUTLINE}" stroke-width="2.5" stroke-linecap="round"/>`,
        flower: `<path d="M24 26 v12" stroke="#5fd0a0" stroke-width="3" stroke-linecap="round"/><path d="M24 33 q-7 1 -8 -5 q6 -1 8 5 z" fill="#5fd0a0" stroke="${OUTLINE}" stroke-width="2"/><circle cx="24" cy="12" r="4.5" fill="#f2b3c1" stroke="${OUTLINE}" stroke-width="2.2"/><circle cx="16" cy="18" r="4.5" fill="#f2b3c1" stroke="${OUTLINE}" stroke-width="2.2"/><circle cx="32" cy="18" r="4.5" fill="#f2b3c1" stroke="${OUTLINE}" stroke-width="2.2"/><circle cx="19" cy="25" r="4.5" fill="#f2b3c1" stroke="${OUTLINE}" stroke-width="2.2"/><circle cx="29" cy="25" r="4.5" fill="#f2b3c1" stroke="${OUTLINE}" stroke-width="2.2"/><circle cx="24" cy="19" r="3.6" fill="#f5c542" stroke="${OUTLINE}" stroke-width="2.2"/>`,
        sun: `<circle cx="24" cy="24" r="9" fill="#f5c542" stroke="${OUTLINE}" stroke-width="3"/><path d="M24 8 v4 M24 36 v4 M8 24 h4 M36 24 h4 M12.7 12.7 l2.8 2.8 M32.5 32.5 l2.8 2.8 M35.3 12.7 l-2.8 2.8 M15.5 32.5 l-2.8 2.8" stroke="#e8b04b" stroke-width="3" stroke-linecap="round"/><circle cx="21" cy="23" r="1.4" fill="#5a3d00"/><circle cx="27" cy="23" r="1.4" fill="#5a3d00"/><path d="M21.5 27 q2.5 2 5 0" stroke="#5a3d00" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
        umbrella: `<path d="M5 15 q14 -14 28 0 q-3 -2.2 -7 0 q-3.5 -2.2 -7 0 q-3 -2.2 -6.5 0 q-3.5 -2.2 -7.5 0 z" fill="#7f96c9" stroke="${OUTLINE}" stroke-width="2.6" stroke-linejoin="round"/><path d="M19 15 v8" stroke="${OUTLINE}" stroke-width="2.4"/><path d="M16 24 q0 -4.5 5 -4.5 h8 q5 0 5 4.5 v1 h-18 z" fill="#f9f3e6" stroke="${OUTLINE}" stroke-width="2.4" stroke-linejoin="round"/><rect x="14" y="25" width="22" height="15" rx="4.5" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="2.8"/><circle cx="22" cy="31" r="1.5" fill="#2b1a10"/><circle cx="28.5" cy="31" r="1.5" fill="#2b1a10"/><path d="M23.5 34 q2 1.8 4 0" stroke="#2b1a10" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M40 20 l-1.3 3.6 M42 28 l-1.3 3.6" stroke="#7f96c9" stroke-width="2.2" stroke-linecap="round"/>`,
        moon: `<path d="M40 6 a9 9 0 1 0 6.5 15 a7 7 0 1 1 -6.5 -15 z" fill="#f5c542" stroke="${OUTLINE}" stroke-width="2.2" stroke-linejoin="round"/><circle cx="8" cy="12" r="1.4" fill="#f5c542"/><circle cx="14" cy="6" r="1" fill="#f5c542"/><path d="M13 21 Q17 10 28 12 q5 1.5 5.5 6 l-20.5 3 z" fill="#7f96c9" stroke="${OUTLINE}" stroke-width="2.6" stroke-linejoin="round"/><circle cx="35.5" cy="19.5" r="2.4" fill="#f9f3e6" stroke="${OUTLINE}" stroke-width="1.8"/><rect x="12" y="22" width="24" height="17" rx="5" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="3"/><path d="M19 29 q2 1.8 4 0 M27 29 q2 1.8 4 0" stroke="#2b1a10" stroke-width="1.7" fill="none" stroke-linecap="round"/><circle cx="25" cy="33.5" r="1.2" fill="#2b1a10"/><ellipse cx="17" cy="32.5" rx="1.9" ry="1.2" fill="#f0a78f" opacity=".55"/><ellipse cx="33" cy="32.5" rx="1.9" ry="1.2" fill="#f0a78f" opacity=".55"/>`,
        rainbow: `<path d="M10 33 a14 14 0 0 1 28 0" fill="none" stroke="#e34948" stroke-width="4"/><path d="M14.5 33 a9.5 9.5 0 0 1 19 0" fill="none" stroke="#f5c542" stroke-width="4"/><path d="M19 33 a5 5 0 0 1 10 0" fill="none" stroke="#5fd0a0" stroke-width="4"/><ellipse cx="10" cy="34" rx="5" ry="3.8" fill="#fffdf8" stroke="${OUTLINE}" stroke-width="2.5"/><ellipse cx="38" cy="34" rx="5" ry="3.8" fill="#fffdf8" stroke="${OUTLINE}" stroke-width="2.5"/>`,
        sprout: `<path d="M14 30 h20 l-2.5 9 h-15 z" fill="#e8836f" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/><path d="M24 30 v-9" stroke="${OUTLINE}" stroke-width="2.5"/><path d="M24 21 q-9 -1 -9 -9 q9 1 9 9 z" fill="#5fd0a0" stroke="${OUTLINE}" stroke-width="2.5" stroke-linejoin="round"/><path d="M24 21 q9 -1 9 -9 q-9 1 -9 9 z" fill="#5fd0a0" stroke="${OUTLINE}" stroke-width="2.5" stroke-linejoin="round"/>`,
        heal: `<path d="M13 15 q0 -5 5.5 -5 h11 q5.5 0 5.5 5 v1 h-22 z" fill="#f9f3e6" stroke="${OUTLINE}" stroke-width="2.6" stroke-linejoin="round"/><rect x="11" y="15" width="26" height="20" rx="5" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="3"/><g transform="rotate(-24 32 15)"><rect x="25" y="12" width="14" height="5.5" rx="2.7" fill="#f3d9a4" stroke="${OUTLINE}" stroke-width="1.8"/><circle cx="30.5" cy="14.7" r=".7" fill="#b99b62"/><circle cx="32.8" cy="14.7" r=".7" fill="#b99b62"/><circle cx="35.1" cy="14.7" r=".7" fill="#b99b62"/></g><circle cx="20.5" cy="24.5" r="1.7" fill="#2b1a10"/><circle cx="28.5" cy="24.5" r="1.7" fill="#2b1a10"/><path d="M22.5 28.5 q2 1.6 4 0" stroke="#2b1a10" stroke-width="1.7" fill="none" stroke-linecap="round"/><ellipse cx="16" cy="27.5" rx="2" ry="1.3" fill="#f0a78f" opacity=".55"/><ellipse cx="33" cy="27.5" rx="2" ry="1.3" fill="#f0a78f" opacity=".55"/>`,
        paw: `<ellipse cx="24" cy="31" rx="9" ry="7" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="3"/><circle cx="12" cy="21" r="3.6" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="2.5"/><circle cx="20" cy="16.5" r="3.6" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="2.5"/><circle cx="28" cy="16.5" r="3.6" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="2.5"/><circle cx="36" cy="21" r="3.6" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="2.5"/>`,
        gradcap: `<path d="M6 19 L24 11 42 19 24 27 z" fill="#5a4a36" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/><path d="M15 23.5 v7 q9 5.5 18 0 v-7" fill="#5a4a36" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/><path d="M38 20 v9" stroke="${OUTLINE}" stroke-width="2.2"/><circle cx="38" cy="31" r="2.2" fill="#f5c542" stroke="${OUTLINE}" stroke-width="1.8"/>`,
    };

    function stampIcon(id, size) {
        // own-property 檢查：category 版 (CAT_ICONS) 的原型鏈坑在 v2.4 審查
        // 被點名過，這裡直接做對——"constructor" 之類的鍵一律走 fallback
        const draw = Object.prototype.hasOwnProperty.call(STAMP_ICONS, id)
            ? STAMP_ICONS[id] : STAMP_ICONS.star;
        return `<svg viewBox="0 0 48 48" width="${size}" height="${size}" class="mascot-stamp" aria-hidden="true">${draw}</svg>`;
    }

    return { loadingHtml, thinkingBubbleHtml, emptyHtml, welcomeHtml,
             checkinHtml, eggKindFor, showSaveEgg, categoryIcon, stampIcon };
})();

if (typeof window !== 'undefined') { window.MascotModule = MascotModule; }
