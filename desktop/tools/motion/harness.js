/**
 * 影格審查場景表（v2.6 motion Task 3 起，每個視覺任務往 SCENES 加自己的場景）。
 *
 * 場景 = { viewport: [寬, 高], frames: [毫秒...], setup(stage) }：
 *   setup 只能「同步」把畫面與動畫觸發好——capture-frames.js 會先裝 Playwright 的
 *   假時鐘並 pauseAt 凍結（page.clock.install＋pauseAt），setTimeout／requestAnimationFrame 都不會自己跑，
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
            viewport: [320, 280], frames: [0, 150, 300, 450, 600, 700, 800, 900, 1000, 1200],
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
        // --- Task 6 點擊反應 -----------------------------------------------------
        // 190／260＝拉長到最高點（愛心此時必須還沒出現）、340＝愛心剛冒出、420＝放到最大
        'react-welcome': {
            viewport: [220, 200], frames: [0, 60, 120, 190, 260, 340, 420, 600, 850],
            setup: (stage) => MascotMotion.react(mount(stage, MascotModule.welcomeHtml()).querySelector('svg')),
        },
        'react-calendar': {
            viewport: [240, 220], frames: [0, 60, 120, 190, 260, 340, 420, 600, 850],
            setup: (stage) => MascotMotion.react(mount(stage, MascotModule.emptyHtml('calendar', '')).querySelector('svg')),
        },
        'react-sleep': {
            viewport: [240, 220], frames: [0, 60, 120, 190, 260, 340, 420, 600, 850],
            setup: (stage) => MascotMotion.react(mount(stage, MascotModule.emptyHtml('diary', '')).querySelector('svg')),
        },
        // --- Task 7 登入頁：揮手一次＋眼睛跟隨 ------------------------------------
        'login-wave': {
            viewport: [220, 200], frames: [0, 240, 480, 720, 960, 1200],
            setup: (stage) => mount(stage, MascotModule.welcomeHtml()),
        },
        'follow-right': { viewport: [320, 240], frames: [0, 70, 140], setup: (stage) => lookScene(stage, 1, 0.5) },
        'follow-left': { viewport: [320, 240], frames: [0, 70, 140], setup: (stage) => lookScene(stage, 0, 0.5) },
        'follow-up': { viewport: [320, 240], frames: [0, 70, 140], setup: (stage) => lookScene(stage, 0.5, 0) },
        'follow-down': { viewport: [320, 240], frames: [0, 70, 140], setup: (stage) => lookScene(stage, 0.5, 1) },
        'touch-settle': {
            viewport: [320, 240], frames: [0, 210, 420],
            setup: (stage) => {
                const svg = lookScene(stage, 0, 0);                  // 先看向左上角
                document.getAnimations().forEach((a) => a.finish());  // 看的過渡直接走完
                MascotMotion.settle(svg);                             // 影格＝回正過程
            },
        },
    };

    // 眼睛跟隨場景：游標放在視窗的相對位置 (fx, fy)；揮手與呼吸先取消，只看跟隨的過渡
    function lookScene(stage, fx, fy) {
        const svg = mount(stage, MascotModule.welcomeHtml()).querySelector('svg');
        document.getAnimations().forEach((a) => a.cancel());
        MascotMotion.lookAt(svg, fx * innerWidth, fy * innerHeight);
        return svg;
    }

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
        // 與 App 相同的行為層（main.js 也是這樣啟動）；擷取時假時鐘（pauseAt 凍結）讓排程器不會自己跑
        if (window.MascotMotion) window.MascotMotion.init();
        const name = new URLSearchParams(location.search).get('scene');
        if (name) { setup(name); return; }
        if (navigator.webdriver) return;   // 自動擷取時不畫索引
        const stage = document.getElementById('stage');
        stage.id = 'index';
        stage.innerHTML = list().map((n) => `<a href="?scene=${encodeURIComponent(n)}">${n}</a>`).join('');
    });
})();
