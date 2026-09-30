/**
 * MascotMotion（v2.6 motion）：吉祥物的「行為」層——待機生命感（呼吸／眨眼）、
 * 點擊反應、登入頁眼睛跟隨。SVG 模板仍只在 mascot.js、keyframes 仍只在
 * mascot.css（風格契約 §6）；本檔只決定「何時對哪個元素加哪個 class／設哪個
 * transform」，不用 WAAPI、不內嵌任何 keyframes。
 *
 * 獨立可攜：1d 的 GitHub Pages 展示頁會原封複製 mascot.js＋mascot.css＋本檔，
 * 所以本檔不依賴 I18N／ApiService／UIManager 或任何 App 模組。缺 API 時的行為：
 * 缺 matchMedia ⇒ 視為「無偏好」（JS 動作照常執行；CSS 的
 * @media (prefers-reduced-motion) 仍管轄所有 CSS 動態）；缺 checkVisibility ⇒ 退回
 * getClientRects() 可見性檢查；缺 DOM／計時器 API ⇒ 不動作，絕不拋錯。
 *
 * 分層：上半部是純函式決策（vitest 直接測），下半部是薄 DOM 層。
 * reduced-motion＝靜態：任何動作前先問 isReducedMotion()，偏好改變時即時停／起。
 */
const MascotMotion = (function () {
    'use strict';

    const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
    const BLINK_MIN_MS = 3000;
    const BLINK_MAX_MS = 7000;
    const BLINK_STAGGER_MS = 400;          // 同一 tick 多隻吉祥物時各自錯開，免得同步眨眼
    const REACT_MS = 900;                  // 點擊反應全長（彈跳 600ms、愛心 900ms 取長者）
    const REACT_INTERVAL_MS = 1200;        // 同一隻吉祥物兩次反應的最小間隔（限流）
    const MOTION_CLASSES = ['mm-blink', 'mm-react', 'mm-settle'];   // reduced-motion 開啟時要立刻拔掉的 class
    const LOOK_MAX = 6;                    // 眼睛最大位移（viewBox 單位；110px 的登入吉祥物約 3px）
    const LOOK_REACH_PX = 240;             // 游標離臉這麼遠（螢幕 px）就到最大位移，更近則線性縮小
    const LOOK_PARALLAX = 0.5;             // 嘴與腮紅只跟一半：像轉頭，不像只有眼珠在滑
    const TOUCH_SETTLE_MS = 700;           // 觸控：看向點擊處多久後回正

    // ------------------------------------------------------------------
    // 純函式
    // ------------------------------------------------------------------

    /** 下一次眨眼前的等待（ms）：rand∈[0,1) 線性對應到 [3000, 7000)（取整數毫秒）；越界先夾住。 */
    function nextBlinkDelay(rand) {
        const r = Math.min(Math.max(Number(rand) || 0, 0), 1);
        return Math.floor(BLINK_MIN_MS + r * (BLINK_MAX_MS - BLINK_MIN_MS));
    }

    /**
     * 每個 key（DOM 元素）各自的最小間隔限流：tryAcquire(key, now) 回 true＝放行並
     * 記下時間；間隔內再叫回 false。WeakMap 讓被移除的元素自動釋放。
     */
    function createRateLimiter(intervalMs) {
        const last = new WeakMap();
        return {
            tryAcquire: function (key, now) {
                const prev = last.get(key);
                if (prev !== undefined && now - prev < intervalMs) return false;
                last.set(key, now);
                return true;
            }
        };
    }

    /**
     * 眼睛跟隨：從臉中心 from 看向 to（兩者皆螢幕座標 px），回傳位移（viewBox 單位）。
     * 方向＝from→to，長度＝max × min(1, 距離/reach)——永遠 ≤ max；距離 < 0.5px 或
     * 非有限值回 {0,0}。
     */
    function computeLookOffset(from, to, max, reach) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.hypot(dx, dy);
        if (!isFinite(dist) || dist < 0.5) return { x: 0, y: 0 };
        const k = (max * Math.min(1, dist / reach)) / dist;
        return { x: dx * k, y: dy * k };
    }

    /**
     * 共用待機排程器——全頁只有一個計時器，不是每隻吉祥物一個。
     * 每次 tick：collect() 取「此刻在畫面上、睜著眼」的待機吉祥物，逐一 blink(el, 錯開ms)，
     * 再排下一次 nextBlinkDelay 後的 tick。分頁隱藏或 reduced-motion 時不排任何計時器。
     * 依賴全部注入（deps），vitest 用假計時器直接驗；正式的 deps 見下方 DOM 層。
     * deps: { setTimer(fn, ms)→id, clearTimer(id), random()→[0,1), collect()→Element[],
     *         blink(el, delayMs), isHidden()→bool, isReduced()→bool }
     */
    function createIdleScheduler(deps) {
        let timer = null;
        function schedule() {
            if (timer !== null) return;   // 已有計時器：重入時不覆蓋（免得洩漏一個永遠清不掉的 timer）
            timer = deps.setTimer(tick, nextBlinkDelay(deps.random()));
        }
        function tick() {
            timer = null;
            if (deps.isHidden() || deps.isReduced()) return;
            deps.collect().forEach(function (el) {
                deps.blink(el, Math.round(deps.random() * BLINK_STAGGER_MS));
            });
            schedule();
        }
        return {
            start: function () {
                if (timer !== null || deps.isHidden() || deps.isReduced()) return;
                schedule();
            },
            stop: function () {
                if (timer !== null) { deps.clearTimer(timer); timer = null; }
            },
            isRunning: function () { return timer !== null; }
        };
    }

    // ------------------------------------------------------------------
    // DOM 層
    // ------------------------------------------------------------------

    let started = false;
    let reducedMql = null;
    let reduced = false;
    let scheduler = null;
    let tapLimiter = createRateLimiter(REACT_INTERVAL_MS);
    let lastPointer = null;                // 最近一次滑鼠／筆的位置（rAF 合併後才計算）
    let lookFrame = null;
    let settleTimers = new WeakMap();      // 觸控回正計時器（每次觸控一次性，不是常駐）
    const reactTimers = new Map();         // svg → 反應收尾計時器（重播時先清舊的；reduced-motion 生效時全清）

    function isReducedMotion() { return reduced; }

    /** 在畫面上＝連在文件裡、非 display:none／visibility:hidden／opacity:0 祖先。 */
    function isShown(el) {
        if (!el || !el.isConnected) return false;
        if (typeof el.checkVisibility === 'function') {
            return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
        }
        return el.getClientRects().length > 0;
    }

    /** 同一個 class 再加一次也要重播動畫：先拔、強制樣式重算、再加。 */
    function restartClass(el, cls) {
        el.classList.remove(cls);
        void el.getBoundingClientRect();
        el.classList.add(cls);
    }

    /** 待機吉祥物（模板加了 data-mm-idle 的 <svg>）中，此刻在畫面上、臉上是睜眼的那些。 */
    function collectIdle() {
        return Array.prototype.filter.call(document.querySelectorAll('svg[data-mm-idle]'), function (svg) {
            // 執行期排除（同 isTapAllowed）：模板旗標之外再擋一次放錯位置的吉祥物
            return !svg.closest('.chat-messages, .mascot-egg') && isShown(svg) && !!svg.querySelector('.mm-face:not(.mm-face-alt) .mm-eyes[data-mm-eyes="dot"]');
        });
    }

    /**
     * 眨眼動畫播完就拔掉 mm-blink：否則元素從 display:none 再顯示（切視圖）時 CSS 會
     * 帶著過期的 --mm-blink-delay 重播一次。animationend 從 .mm-eyes 冒泡到 <svg>，
     * 只認 mm-blink（.mm-react 的 mm-bounce 等不能誤拔）。同一函式參照 addEventListener 會去重。
     */
    function onBlinkEnd(event) {
        if (event.animationName !== 'mm-blink') return;
        event.currentTarget.classList.remove('mm-blink');
        event.currentTarget.removeEventListener('animationend', onBlinkEnd);
    }

    /** 眨一次眼：CSS（mascot.css 的 .mm-blink）負責動畫，這裡只設錯開延遲並重播 class。 */
    function blink(svg, delayMs) {
        if (reduced || !svg) return;
        svg.style.setProperty('--mm-blink-delay', (delayMs || 0) + 'ms');
        svg.addEventListener('animationend', onBlinkEnd);
        restartClass(svg, 'mm-blink');
    }

    /**
     * 契約 §4：點擊反應只給模板標了 data-mm-tap 的吉祥物；就算標了，放進聊天訊息區或
     * 彩蛋浮層裡也一律不反應（聊天區只准安靜搖擺／靜態，彩蛋本身已是反應）。
     */
    function isTapAllowed(el) {
        return !!(el && el.hasAttribute && el.hasAttribute('data-mm-tap') &&
                  !el.closest('.chat-messages, .mascot-egg'));
    }

    function removeHearts(root) {
        root.querySelectorAll('[data-mm-heart]').forEach(function (n) { n.parentNode.removeChild(n); });
    }

    /**
     * 點擊反應：彈跳＋換開心臉＋小愛心（動畫都在 mascot.css 的 .mm-react／.mm-heart）。
     * 回傳是否真的播了（reduced-motion、不允許的位置、限流中都回 false）。
     */
    function react(svg) {
        if (reduced || !isTapAllowed(svg)) return false;
        if (!tapLimiter.tryAcquire(svg, Date.now())) return false;
        removeHearts(svg);
        restartClass(svg, 'mm-react');
        if (typeof MascotModule !== 'undefined' && typeof MascotModule.reactionHeartSvg === 'function') {
            svg.insertAdjacentHTML('beforeend', MascotModule.reactionHeartSvg());
        }
        clearTimeout(reactTimers.get(svg));
        reactTimers.set(svg, setTimeout(function () {
            reactTimers.delete(svg);
            svg.classList.remove('mm-react');
            removeHearts(svg);
        }, REACT_MS));
        return true;
    }

    function onDocumentClick(event) {
        const target = event.target && typeof event.target.closest === 'function'
            ? event.target.closest('svg[data-mm-tap]') : null;
        if (target) react(target);
    }

    /** 臉（靜止臉的眼睛群組中心）在螢幕上的位置；環境量不到（jsdom、未渲染）回 null。 */
    function faceCenter(svg) {
        const eyes = svg.querySelector('.mm-face:not(.mm-face-alt) .mm-eyes');
        if (!eyes || typeof eyes.getBBox !== 'function' || !eyes.parentNode ||
            typeof eyes.parentNode.getScreenCTM !== 'function') return null;
        const box = eyes.getBBox();
        const m = eyes.parentNode.getScreenCTM();   // 父層矩陣：量「沒被跟隨位移過」的位置
        if (!m) return null;
        const px = box.x + box.width / 2;
        const py = box.y + box.height / 2;
        return { x: m.a * px + m.c * py + m.e, y: m.b * px + m.d * py + m.f };
    }

    /** 寫入眼睛／嘴／腮紅的 inline transform；off＝null 表示回正。 */
    function applyLook(svg, off) {
        function set(selector, k) {
            svg.querySelectorAll(selector).forEach(function (el) {
                el.style.transform = off
                    ? 'translate(' + (off.x * k).toFixed(2) + 'px, ' + (off.y * k).toFixed(2) + 'px)'
                    : '';
            });
        }
        set('.mm-face .mm-eyes', 1);
        set('.mm-face .mm-mouth', LOOK_PARALLAX);
        set('.mm-blush', LOOK_PARALLAX);
    }

    /** 讓一隻 data-mm-follow 吉祥物看向螢幕座標 (x, y)。回傳是否真的轉了。 */
    function lookAt(svg, x, y) {
        if (reduced || !svg || !svg.hasAttribute('data-mm-follow')) return false;
        const c = faceCenter(svg);
        if (!c) return false;
        svg.classList.remove('mm-settle');
        clearTimeout(settleTimers.get(svg));   // 混合裝置：觸控後改用滑鼠，舊的回正計時器不能再把臉拉回正中
        applyLook(svg, computeLookOffset(c, { x: x, y: y }, LOOK_MAX, LOOK_REACH_PX));
        return true;
    }

    /** 回正（觸控看完、或 reduced-motion 生效時）。 */
    function settle(svg) {
        if (!reduced) svg.classList.add('mm-settle');
        applyLook(svg, null);
    }

    function followers() {
        return Array.prototype.filter.call(document.querySelectorAll('svg[data-mm-follow]'), isShown);
    }

    function flushLook() {
        lookFrame = null;
        if (!lastPointer || reduced) return;
        followers().forEach(function (svg) { lookAt(svg, lastPointer.x, lastPointer.y); });
    }

    // 滑鼠／筆：pointermove 只記位置，一個 rAF 內合併成一次計算（全頁共用，不是每隻各綁）
    function onPointerMove(event) {
        if (reduced || event.pointerType === 'touch') return;
        lastPointer = { x: event.clientX, y: event.clientY };
        if (lookFrame === null) lookFrame = requestAnimationFrame(flushLook);
    }

    // 觸控：沒有 hover，改成「看向點擊處，TOUCH_SETTLE_MS 後回正」
    function onPointerDown(event) {
        if (reduced || event.pointerType !== 'touch') return;
        followers().forEach(function (svg) {
            if (!lookAt(svg, event.clientX, event.clientY)) return;
            clearTimeout(settleTimers.get(svg));
            settleTimers.set(svg, setTimeout(function () { settle(svg); }, TOUCH_SETTLE_MS));
        });
    }

    /** reduced-motion 生效的瞬間：拔掉所有一次性動畫 class、愛心、跟隨位移，回到靜止姿勢。 */
    function clearTransientMotion() {
        MOTION_CLASSES.forEach(function (cls) {
            document.querySelectorAll('.' + cls).forEach(function (el) { el.classList.remove(cls); });
        });
        removeHearts(document);
        reactTimers.forEach(function (id) { clearTimeout(id); });
        reactTimers.clear();
        document.querySelectorAll('svg[data-mm-follow]').forEach(function (svg) { applyLook(svg, null); });
    }

    function onReducedChange(event) {
        reduced = !!(event && event.matches);
        if (reduced) {
            scheduler.stop();
            clearTransientMotion();
        } else {
            scheduler.start();
        }
    }

    function onVisibilityChange() {
        const hidden = !!document.hidden;
        document.documentElement.classList.toggle('mm-paused', hidden);
        if (hidden) scheduler.stop();
        else scheduler.start();
    }

    function watchReducedMotion() {
        if (typeof window.matchMedia !== 'function') return;   // jsdom／舊環境：當作沒偏好
        reducedMql = window.matchMedia(REDUCED_QUERY);
        if (!reducedMql) return;
        reduced = !!reducedMql.matches;
        if (typeof reducedMql.addEventListener === 'function') {
            reducedMql.addEventListener('change', onReducedChange);
        } else if (typeof reducedMql.addListener === 'function') {
            reducedMql.addListener(onReducedChange);
        }
    }

    /** 啟動（冪等）：reduced-motion 監看、分頁可見度、共用待機排程器。 */
    function init() {
        if (started) return;
        started = true;
        scheduler = createIdleScheduler({
            setTimer: function (fn, ms) { return setTimeout(fn, ms); },
            clearTimer: function (id) { clearTimeout(id); },
            random: Math.random,
            collect: collectIdle,
            blink: blink,
            isHidden: function () { return !!document.hidden; },
            isReduced: isReducedMotion
        });
        watchReducedMotion();
        document.addEventListener('visibilitychange', onVisibilityChange);
        document.addEventListener('click', onDocumentClick);
        document.addEventListener('pointermove', onPointerMove, { passive: true });
        document.addEventListener('pointerdown', onPointerDown, { passive: true });
        document.documentElement.classList.toggle('mm-paused', !!document.hidden);
        scheduler.start();
    }

    /** 測試專用：拆掉監聽器與計時器，下一個測試可重新 init()。 */
    function teardown() {
        if (!started) return;
        started = false;
        scheduler.stop();
        document.removeEventListener('visibilitychange', onVisibilityChange);
        document.removeEventListener('click', onDocumentClick);
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerdown', onPointerDown);
        if (lookFrame !== null) { cancelAnimationFrame(lookFrame); lookFrame = null; }
        lastPointer = null;
        settleTimers = new WeakMap();
        tapLimiter = createRateLimiter(REACT_INTERVAL_MS);
        if (reducedMql) {
            if (typeof reducedMql.removeEventListener === 'function') {
                reducedMql.removeEventListener('change', onReducedChange);
            } else if (typeof reducedMql.removeListener === 'function') {
                reducedMql.removeListener(onReducedChange);
            }
        }
        reducedMql = null;
        reduced = false;
        document.documentElement.classList.remove('mm-paused');
    }

    return {
        init: init,
        isReducedMotion: isReducedMotion,
        blink: blink,
        react: react,
        lookAt: lookAt,
        settle: settle,
        _test: {
            isTapAllowed: isTapAllowed,
            computeLookOffset: computeLookOffset,
            nextBlinkDelay: nextBlinkDelay,
            createRateLimiter: createRateLimiter,
            createIdleScheduler: createIdleScheduler,
            collectIdle: collectIdle,
            schedulerRunning: function () { return !!(scheduler && scheduler.isRunning()); },
            teardown: teardown
        }
    };
})();

if (typeof window !== 'undefined') { window.MascotMotion = MascotMotion; }
