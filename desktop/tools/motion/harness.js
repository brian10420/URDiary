/**
 * 影格審查場景表（v2.6 motion Task 3 起，每個視覺任務往 SCENES 加自己的場景）。
 *
 * 場景 = { viewport: [寬, 高], frames: [毫秒...], setup(stage) }：
 *   setup 只能「同步」把畫面與動畫觸發好——capture-frames.js 會先裝 Playwright 的
 *   假時鐘（page.clock.install），setTimeout／requestAnimationFrame 都不會自己跑，
 *   接著暫停 document.getAnimations() 全部動畫、逐一 seek 到 frames 的時間點截圖。
 *   所以依賴計時器的收尾（移除 class、淡出）在擷取期間不會發生，影格才穩定。
 * frames 的時間點＝審查時要看的關鍵姿勢（起點、最大位移、回彈、收尾）。
 */
(function () {
    'use strict';

    function mount(stage, html) {
        stage.innerHTML = html;
        return stage.firstElementChild;
    }

    const SCENES = {
        // --- 既有動畫（v2.4）：證明擷取管線本身可用 ---------------------------
        'sway': {
            viewport: [220, 200], frames: [0, 450, 900, 1350],
            setup: (stage) => mount(stage, MascotModule.loadingHtml(96)),
        },
        'thinking': {
            viewport: [200, 120], frames: [0, 300, 600, 900],
            setup: (stage) => mount(stage, `<div class="h-card">${MascotModule.thinkingBubbleHtml()}</div>`),
        },
        'egg-happy': {
            viewport: [320, 280], frames: [0, 150, 300, 450],
            setup: () => MascotModule.showSaveEgg('happy'),
        },
        'egg-night': {
            viewport: [320, 280], frames: [0, 300],
            setup: () => MascotModule.showSaveEgg('goodnight'),
        },
        // --- Task 5 待機生命感 ---------------------------------------------------
        'idle-breathe': {
            viewport: [220, 200], frames: [0, 900, 1800, 2700],
            setup: (stage) => mount(stage, MascotModule.welcomeHtml()),
        },
        'idle-sleep': {
            viewport: [240, 220], frames: [0, 1200, 2400, 3600],
            setup: (stage) => mount(stage, MascotModule.emptyHtml('diary', '')),
        },
        'blink': {
            viewport: [240, 220], frames: [0, 45, 90, 135, 180],
            setup: (stage) => {
                mount(stage, MascotModule.emptyHtml('calendar', ''));
                MascotMotion.blink(stage.querySelector('svg'), 0);
            },
        },
    };

    function list() { return Object.keys(SCENES); }

    // setup 可以回傳 Promise（例如 View Transition 的 ready）：等它好了才回 meta，
    // capture-frames.js 的 page.evaluate 會一起等
    function setup(name) {
        const scene = SCENES[name];
        if (!scene) throw new Error(`unknown scene: ${name}`);
        document.querySelectorAll('.mascot-egg').forEach((el) => el.remove());
        const stage = document.getElementById('stage');
        stage.innerHTML = '';
        const meta = { viewport: scene.viewport, frames: scene.frames };
        const pending = scene.setup(stage);
        return pending && typeof pending.then === 'function' ? pending.then(() => meta) : meta;
    }

    window.MotionHarness = { SCENES: SCENES, list: list, setup: setup };

    // 手動檢視：file://.../harness.html?scene=<名稱>
    document.addEventListener('DOMContentLoaded', function () {
        // 與 App 相同的行為層（main.js 也是這樣啟動）；擷取時假時鐘讓排程器不會自己跑
        if (window.MascotMotion) window.MascotMotion.init();
        const name = new URLSearchParams(location.search).get('scene');
        if (name) { setup(name); return; }
        if (navigator.webdriver) return;   // 自動擷取時不畫索引
        const stage = document.getElementById('stage');
        stage.id = 'index';
        stage.innerHTML = list().map((n) => `<a href="?scene=${encodeURIComponent(n)}">${n}</a>`).join('');
    });
})();
