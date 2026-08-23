/**
 * Onboarding 初次見面（v2.5 Spec B）——純腳本驅動，零 LLM、零金鑰。
 *
 * 觸發：ChatModule 開場 gate 呼叫 maybeStart()；completed=false 才啟動，
 * 啟動當次與完成後同一 session 都抑制每日 check-in（自我介紹就是問候）。
 * 訊息全部走 ChatModule 的 ephemeral 渲染＋withThinkingDelay 假思考——
 * 不進 chatHistory/chat_messages，重載不重演。
 * 答案逐題即存（POST /users/onboarding/answer，空字串＝跳過）；取名 ≤12 字
 * 直接寫現有 companion_name（PUT /users/me/companion 部分更新），下一則
 * 腳本訊息（namingAck）就自稱新名字。任何 API 失敗只 console.warn，流程照走。
 */
const OnboardingModule = (function () {
    // 提問順序＝後端 ONBOARDING_QUESTION_KEYS 去掉 companion_naming（它是開場互動）
    const QUESTION_KEYS = ['name', 'location', 'favorite_food', 'important_people',
                           'hobbies', 'strengths', 'self_view'];
    const NAMING_KEY = 'companion_naming';
    const NAME_MAX_CHARS = 12;
    const ACK_KEYS = ['onboarding.ack1', 'onboarding.ack2', 'onboarding.ack3', 'onboarding.ack4'];

    let active = false;
    let completedThisSession = false;  // 完成後同一 session 不補發 check-in
    let answered = new Set();
    let currentKey = null;             // NAMING_KEY | QUESTION_KEYS 之一 | null
    let namingRetried = false;
    let chipsEl = null;

    function isActive() { return active; }

    /**
     * 開場 gate 的入口。回傳 true＝onboarding 進行中或本 session 剛完成
     * （呼叫端據此抑制 check-in）；false＝照常走每日問候。
     */
    async function maybeStart() {
        if (active || completedThisSession) return true;
        if (typeof ApiService === 'undefined' || !ApiService.isAuthenticated ||
            !ApiService.isAuthenticated()) {
            return false;
        }
        let state;
        try {
            state = await ApiService.getOnboardingState();
        } catch (e) {
            console.warn('onboarding 狀態查詢失敗，照常走每日問候:', e);
            return false;
        }
        if (!state || state.completed) return false;

        answered = new Set(state.answered_keys || []);
        active = true;
        if (answered.size > 0) {
            // 中斷續跑：簡短再見面文案 → 第一個未答題（已答不重問）
            script(I18N.t('onboarding.resume'), function () { askNext(false); });
        } else {
            script(I18N.t('onboarding.intro'), function () { askNext(false); });
        }
        return true;
    }

    /** 下一個未答題（取名排最前）；全答完＝溫暖收束。withAck＝前綴隨機回應語。 */
    function askNext(withAck) {
        if (!active) return;
        const order = [NAMING_KEY].concat(QUESTION_KEYS);
        const next = order.find(function (k) { return !answered.has(k); });
        if (!next) { finish(false); return; }
        currentKey = next;
        const question = (next === NAMING_KEY)
            ? I18N.t('onboarding.naming')
            : I18N.t('onboarding.q.' + next);
        // 回應語併進同一則訊息（不多一次延遲、去填表感）
        script(withAck ? randomAck() + ' ' + question : question);
    }

    function randomAck() {
        return I18N.t(ACK_KEYS[Math.floor(Math.random() * ACK_KEYS.length)]);
    }

    /** 使用者打字送出（由 ChatModule.sendMessage 攔截轉來）。 */
    function handleAnswer(text) {
        if (!active || !currentKey) return;
        ChatModule.addEphemeralUserMessage(text);
        hideChips();
        if (currentKey === NAMING_KEY) { handleNamingAnswer(text); return; }
        saveAnswer(currentKey, text);
        answered.add(currentKey);
        askNext(true);
    }

    /** 取名分支：原文一律 upsert（含超長，供續跑判斷）；≤12 字才寫 companion_name。 */
    function handleNamingAnswer(text) {
        saveAnswer(NAMING_KEY, text);
        answered.add(NAMING_KEY);
        if (Array.from(text).length <= NAME_MAX_CHARS) {
            ApiService.fetchAPI('/users/me/companion', {
                method: 'PUT', body: { companion_name: text },
            }).catch(function (e) { console.warn('陪伴者名字儲存失敗（流程照常）:', e); });
            script(I18N.t('onboarding.namingAck', { name: text }), function () { askNext(false); });
        } else if (!namingRetried) {
            namingRetried = true;
            answered.delete(NAMING_KEY);   // 重試一次：取名還沒定案，currentKey 停在原地
            script(I18N.t('onboarding.namingTooLong'));
        } else {
            script(I18N.t('onboarding.namingStillLong'), function () { askNext(false); });
        }
    }

    /** 「跳過這題」chip：空字串 upsert（answered_keys 含之，續跑不重問）。 */
    function handleSkip() {
        if (!active || !currentKey) return;
        saveAnswer(currentKey, '');
        answered.add(currentKey);
        hideChips();
        askNext(true);
    }

    /** 收束（walked＝走完七題；early＝「直接開始聊天」）。已答部分早已逐題入庫。 */
    function finish(early) {
        currentKey = null;
        active = false;
        completedThisSession = true;
        removeChips();
        script(I18N.t(early ? 'onboarding.outroEarly' : 'onboarding.outro'), null, { last: true });
        ApiService.completeOnboarding().catch(function (e) {
            console.warn('onboarding complete 送出失敗:', e);
        });
    }

    function saveAnswer(key, text) {
        ApiService.saveOnboardingAnswer(key, text).catch(function (e) {
            console.warn('onboarding 答案儲存失敗（流程照常）:', e);
        });
    }

    /** 每則腳本訊息：藏 chips → 假思考 → 訊息與 chips 同時現身 → andThen()。 */
    function script(text, andThen, opts) {
        hideChips();
        ChatModule.withThinkingDelay(function () {
            ChatModule.addEphemeralSystemMessage(text);
            if (active && (!opts || !opts.last)) showChips();
            if (andThen) andThen();
        });
    }

    // --- 常駐 chips（貼最新腳本訊息下方）---

    function ensureChips() {
        if (chipsEl) return chipsEl;
        chipsEl = document.createElement('div');
        chipsEl.className = 'onboarding-chips';
        chipsEl.innerHTML =
            '<button type="button" class="onboarding-chip" data-onboarding-skip>' +
            I18N.t('onboarding.chipSkip') + '</button>' +
            '<button type="button" class="onboarding-chip" data-onboarding-start-chat>' +
            I18N.t('onboarding.chipStartChat') + '</button>';
        chipsEl.addEventListener('click', function (e) {
            const btn = e.target.closest('button');
            if (!btn) return;
            if (btn.hasAttribute('data-onboarding-skip')) handleSkip();
            else if (btn.hasAttribute('data-onboarding-start-chat')) finish(true);
        });
        return chipsEl;
    }

    function showChips() {
        const container = document.querySelector('.chat-messages');
        if (!container) return;
        container.appendChild(ensureChips());  // append＝移到最新訊息之後
        chipsEl.style.display = '';
    }

    function hideChips() {
        if (chipsEl) chipsEl.style.display = 'none';
    }

    function removeChips() {
        if (chipsEl && chipsEl.parentNode) chipsEl.parentNode.removeChild(chipsEl);
        chipsEl = null;
    }

    /**
     * 歸零模組狀態——換帳號時由 ChatModule.reset() 呼叫。
     *
     * 本模組是 IIFE 單例，狀態活在整個分頁的生命週期裡；而 main.js 的
     * loginUser() 每次登入都跑 reset() → init() 且「不重整頁面」（全檔唯一的
     * location.reload() 是 service worker 更新路徑），所以同一個分頁換帳號是
     * 真實情境。不歸零會外洩兩種狀態：
     *   (1) completedThisSession：前一個帳號完成過，下一個帳號的 maybeStart()
     *       會直接 return true，初次見面永遠不啟動，連每日問候也一併被抑制
     *       ——下一位使用者看到的是空白對話頁。
     *   (2) active/currentKey：前一個帳號停在進行中，下一位使用者打的字會被
     *       sendMessage 攔截，以「上一個帳號當前題目」的 key 存進他自己的帳號。
     * 比照 ChatModule.reset() 既有的 slowModelHintShown 歸零（同一個理由）。
     */
    function reset() {
        active = false;
        completedThisSession = false;
        answered = new Set();
        currentKey = null;
        namingRetried = false;
        removeChips();
    }

    return {
        maybeStart: maybeStart,
        isActive: isActive,
        handleAnswer: handleAnswer,
        handleSkip: handleSkip,
        reset: reset,
        // 僅為 vitest 曝光（IIFE 單例跨測試共用）：與正式 reset 同一份實作，
        // 不另外複製一份，避免兩邊日後各自漂移
        _test: { reset: reset },
    };
})();
