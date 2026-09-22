/**
 * Onboarding 初次見面（v2.5 Spec B）——純腳本驅動，零 LLM、零金鑰。
 *
 * 觸發：ChatModule 開場 gate 呼叫 maybeStart()；completed=false 才啟動，
 * 啟動當次與完成後同一 session 都抑制每日 check-in（自我介紹就是問候）。
 * 訊息全部走 ChatModule 的 ephemeral 渲染＋withThinkingDelay 假思考——
 * 不進 chatHistory/chat_messages，重載不重演。
 * 答案逐題即存（POST /users/onboarding/answer，空字串＝跳過）；取名先做
 * 零 LLM 的前綴／後綴剝除（extractName），≤12 字直接寫現有 companion_name
 * （PUT /users/me/companion 部分更新），下一則腳本訊息（namingAck）就自稱
 * 新名字。/onboarding/complete 首次完成時後端會用 LLM 讀全部原文再判定一次
 * （後題改口也看得到），判定結果與取名當下自稱的不同就補一句更正（finish()）。
 * 任何 API 失敗只 console.warn，流程照走。
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
    let scriptInFlight = false;        // 腳本訊息還在假思考泡泡裡（見 script()／handleAnswer）
    let ackedName = null;              // namingAck 當下自稱的名字（跳過／超長＝null；見 finish()）
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

    /** 換行／tab 壓成空白、其餘控制字元刪掉，再 trim（後端 pattern 的鏡像）。 */
    function sanitizeName(text) {
        return String(text)
            .replace(/[\r\n\t\v\f]+/g, ' ')
            .replace(/[\x00-\x08\x0e-\x1f\x7f]/g, '')
            .trim();
    }

    // extractName 的剝除規則：行首可疊一個語氣起手（那／就／那就／我想／我要／可以／不然）
    const NAME_PREFIX_ZH = /^(?:那就|那|就|我想|我要|可以|不然)?(?:叫你|叫妳|喊你|稱你|你就叫|你叫|你的名字(?:就叫|是|叫)?|名字(?:是|叫)?|取名(?:為|叫)?|你是)/;
    const NAME_PREFIX_EN = /^(?:i'll |i will |let's |let me |i want to |i'd like to |how about |what about |maybe )?(?:call you|name you|your name is|your name will be|you're|you are|you can be|be called|you'll be)\s+/i;
    // 尾詞前的空白／標點一起剝（「小澄，好嗎？」不留逗號）；英文尾詞要整字（\b）——
    // 否則 Brook 會被當成「Bro＋ok」剝成 Bro
    const NAME_SUFFIX = /[\s！!。？?～~，,.]*(?:吧|好了|好嗎|如何|怎麼樣|可以嗎|囉|喔|哦|啦|呢|\b(?:then|okay|ok|please))?[！!。？?～~，,.]*$/i;
    const NAME_QUOTE_PAIRS = [['「', '」'], ['『', '』'], ['“', '”'], ['"', '"'], ["'", "'"]];

    /** 剝掉包住整個名字的成對引號（可多層）。 */
    function stripQuotePairs(text) {
        let s = text;
        let stripped = true;
        while (stripped && s.length >= 2) {
            stripped = false;
            for (let i = 0; i < NAME_QUOTE_PAIRS.length; i++) {
                const open = NAME_QUOTE_PAIRS[i][0];
                const close = NAME_QUOTE_PAIRS[i][1];
                if (s.startsWith(open) && s.endsWith(close)) {
                    s = s.slice(open.length, s.length - close.length).trim();
                    stripped = true;
                    break;
                }
            }
        }
        return s;
    }

    /**
     * 取名答案 → 名字本體（零 LLM）：「我想叫你小樹洞」→「小樹洞」、「就叫你小澄吧」
     * →「小澄」、"I'll call you Momo!" → "Momo"。先 sanitizeName（控制字元防線不變），
     * 再剝前綴／後綴／成對引號；剝完是空的就退回洗過的原文。
     *
     * 只求 namingAck 當下說對——這是規則式的猜測，猜不中的（後題才改口、少見句型）
     * 交給 /onboarding/complete 的 LLM 判定當最終裁決（見 finish()）。
     */
    function extractName(text) {
        const clean = sanitizeName(text);
        let s = clean.replace(NAME_PREFIX_ZH, '').trim();
        s = s.replace(NAME_PREFIX_EN, '').trim();
        s = s.replace(NAME_SUFFIX, '').trim();
        s = stripQuotePairs(s);
        return s || clean;
    }

    /** 名字定案 → 聊天標題即時換名（SettingsModule 快取＋事件；測試可不載它）。 */
    function publishCompanionName(name) {
        if (typeof SettingsModule !== 'undefined' &&
            typeof SettingsModule.setCompanionName === 'function') {
            SettingsModule.setCompanionName(name);
        }
    }

    /**
     * 使用者打字送出（由 ChatModule.sendMessage 攔截轉來）。
     *
     * 回傳「這次送出有沒有被當成答案收下」：false 代表現在**還沒有題目可答**，
     * 呼叫端據此**不要清空輸入框**，使用者打的字才不會被無聲吃掉或誤記；
     * 等題目真的現身之後他再按一次 Enter 就會被收下。兩個窗口都算：
     *   (1) currentKey 還是 null——自我介紹（intro/resume）的假思考延遲；
     *   (2) scriptInFlight——askNext() 是**同步**把 currentKey 指到下一題的，
     *       但那題的文字要等 script() 的 1–3 秒假思考結束才會出現在畫面上。
     *       這段空窗期若照收，使用者補在上一題後面的話（「啊對了 我姓陳」）
     *       會被存成他根本還沒看到的那題（住哪個城市）的答案——文字被吃掉
     *       又存錯格，比 (1) 更糟。namingTooLong 的重試分支同理（currentKey
     *       停在取名題，但「名字太長了」那句話還沒出現）。
     */
    function handleAnswer(text) {
        if (!active || scriptInFlight || !currentKey) return false;
        ChatModule.addEphemeralUserMessage(text);
        hideChips();
        if (currentKey === NAMING_KEY) { handleNamingAnswer(text); return true; }
        saveAnswer(currentKey, text);
        answered.add(currentKey);
        askNext(true);
        return true;
    }

    /**
     * 取名分支：原文一律 upsert（含超長，供續跑判斷）；extractName 剝出的名字
     * ≤12 字才寫 companion_name，並記下 ackedName（finish() 拿它比對 LLM 判定）。
     *
     * 送去伺服器與拿來自稱的名字先洗掉控制字元：輸入框是 <textarea>，
     * Shift+Enter 就會插進一個換行，而後端 CompanionSettingsIn.companion_name
     * 帶 pattern=_NO_CTRL_PATTERN（那段文字會進 system prompt），含換行一律
     * 422；422 被下面的 .catch 吞掉之後 namingAck 照樣說「從現在起我就是X了」
     * ——陪伴者頂著一個伺服器根本沒收下的名字。長度也改量洗過的字數（那才是
     * 真正會被存起來的東西）。入庫的 saveAnswer 仍是原文（spec §4 答案原文入庫）。
     */
    function handleNamingAnswer(text) {
        saveAnswer(NAMING_KEY, text);
        answered.add(NAMING_KEY);
        const name = extractName(text);
        if (name && Array.from(name).length <= NAME_MAX_CHARS) {
            ApiService.fetchAPI('/users/me/companion', {
                method: 'PUT', body: { companion_name: name },
            }).then(function () {
                publishCompanionName(name);
            }, function (e) { console.warn('陪伴者名字儲存失敗（流程照常）:', e); });
            ackedName = name;
            script(I18N.t('onboarding.namingAck', { name: name }), function () { askNext(false); });
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

    /**
     * 收束（walked＝走完七題；early＝「直接開始聊天」）。已答部分早已逐題入庫。
     *
     * /onboarding/complete 會順手跑一次記憶收納 pass 並回傳 memory_review：
     * 核可制下這批答案會變成「待核可」ops，檔案這時還是空的。原本這裡把
     * 回應整個丟掉，而 Spec C 的待核可通知只掛在 endChat 那條路上——使用者
     * 因此完全不知道有東西等著他核可（帳本徽章也沒刷新）。這裡改成等結果
     * 回來、沿用 ChatModule 既有的通知路徑（不另造一套）。
     *
     * 兩件事都不能破：
     *   (1) 失敗不擋主流程——.catch 吞掉並回 null，outro 照樣先出現；
     *   (2) 通知要排在 outro「之後」——outro 自己還壓著 1–3 秒假思考，
     *       所以掛在 script() 的 andThen 裡等兩邊都到齊才顯示。
     *
     * 同一個回應還帶 companion_name（v2.5 Spec B 驗收回饋①）：後端用 LLM 讀全部
     * 原文判定出的名字，只有真的改寫了名字才有值。它和取名當下自稱的 ackedName
     * 不同（腳本猜錯、後題才改口、當時跳過）就補一句更正——同樣是 ephemeral 腳本
     * 訊息、同樣壓在 outro 之後，並用 andThen 把待核可通知串在更正句「之後」，
     * 不會兩則訊息搶順序。聊天標題不等更正句，拿到結果就換。
     */
    function finish(early) {
        currentKey = null;
        active = false;
        completedThisSession = true;
        removeChips();
        const completing = ApiService.completeOnboarding().catch(function (e) {
            console.warn('onboarding complete 送出失敗:', e);
            return null;
        });
        script(I18N.t(early ? 'onboarding.outroEarly' : 'onboarding.outro'), function () {
            completing.then(function (res) {
                const finalName = res && res.companion_name;
                if (finalName) publishCompanionName(finalName);
                if (finalName && finalName !== ackedName) {
                    script(I18N.t('onboarding.nameCorrected', { name: finalName }), function () {
                        showPendingNotice(res);
                    }, { last: true });
                } else {
                    showPendingNotice(res);
                }
            });
        }, { last: true });
    }

    function showPendingNotice(res) {
        if (typeof ChatModule.showMemoryPendingNotice !== 'function') return;
        // ephemeral：初次見面全程不進持久層，這則通知同理（見該函式說明）
        ChatModule.showMemoryPendingNotice(res && res.memory_review, { ephemeral: true });
    }

    function saveAnswer(key, text) {
        ApiService.saveOnboardingAnswer(key, text).catch(function (e) {
            console.warn('onboarding 答案儲存失敗（流程照常）:', e);
        });
    }

    /**
     * 每則腳本訊息：藏 chips → 假思考 → 訊息與 chips 同時現身 → andThen()。
     *
     * scriptInFlight 標記整段假思考延遲（見 handleAnswer）：在回呼「最前面」
     * 歸零，因為 andThen() 往往會再叫一次 script()（askNext → 下一題），
     * 那次自己會把旗標重新舉起來——放到回呼尾端清就會把它誤清掉。
     */
    function script(text, andThen, opts) {
        hideChips();
        scriptInFlight = true;
        ChatModule.withThinkingDelay(function () {
            scriptInFlight = false;
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
        // appendChatMessage 的 scrollToBottom() 發生在 chips 掛上「之前」，所以
        // 訊息捲到底之後 chips 又長出一截高度——對話一超過一個螢幕（七題流程
        // 必然會超過，手機更早），兩顆逃生口就掉到摺線下面了。這裡補捲一次，
        // 維持 spec §4「常駐 chips 全程掛著」。
        container.scrollTop = container.scrollHeight;
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
        scriptInFlight = false;
        ackedName = null;
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
        _test: { reset: reset, extractName: extractName },
    };
})();
