/**
 * MascotMotion（v2.6 motion）：吉祥物的「行為」層——待機生命感（呼吸／眨眼）、
 * 點擊反應、登入頁眼睛跟隨。SVG 模板仍只在 mascot.js、keyframes 仍只在
 * mascot.css（風格契約 §6）；本檔只決定「何時對哪個元素加哪個 class／設哪個
 * transform」，不用 WAAPI、不內嵌任何 keyframes。
 *
 * 獨立可攜：1d 的 GitHub Pages 展示頁會原封複製 mascot.js＋mascot.css＋本檔，
 * 所以本檔不依賴 I18N／ApiService／UIManager 或任何 App 模組；缺 matchMedia、
 * checkVisibility 等 API 時一律退回「不動」，不拋錯。
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
    const MOTION_CLASSES = ['mm-blink', 'mm-react'];   // reduced-motion 開啟時要立刻拔掉的一次性 class

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
            return isShown(svg) && !!svg.querySelector('.mm-face:not(.mm-face-alt) .mm-eyes[data-mm-eyes="dot"]');
        });
    }

    /** 眨一次眼：CSS（mascot.css 的 .mm-blink）負責動畫，這裡只設錯開延遲並重播 class。 */
    function blink(svg, delayMs) {
        if (reduced || !svg) return;
        svg.style.setProperty('--mm-blink-delay', (delayMs || 0) + 'ms');
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
        setTimeout(function () {
            svg.classList.remove('mm-react');
            removeHearts(svg);
        }, REACT_MS);
        return true;
    }

    function onDocumentClick(event) {
        const target = event.target && typeof event.target.closest === 'function'
            ? event.target.closest('svg[data-mm-tap]') : null;
        if (target) react(target);
    }

    /** reduced-motion 生效的瞬間：拔掉所有一次性動畫 class 與愛心，畫面回到靜止姿勢。 */
    function clearTransientMotion() {
        MOTION_CLASSES.forEach(function (cls) {
            document.querySelectorAll('.' + cls).forEach(function (el) { el.classList.remove(cls); });
        });
        removeHearts(document);
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
        _test: {
            isTapAllowed: isTapAllowed,
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
