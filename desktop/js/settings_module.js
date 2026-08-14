/**
 * LLM 設定模塊 - 供應商切換、模型自訂、API Key 管理
 *
 * 非機密偏好（目前供應商、各家自訂模型、本地 Base URL）存 localStorage。
 * API Key 依環境走兩條路（v2.3 task 1.6），由 SecureStore.isAvailable() 分流：
 *
 * - **Electron 桌面版**：經 SecureStore 走 safeStorage 加密存本機，呼叫時由
 *   fetchAPI 以 X-LLM-* 標頭送往後端，不寫伺服器。行為與改版前完全相同。
 * - **手機瀏覽器 / PWA**：沒有 safeStorage 可用（SecureStore.setKey 會拋錯），
 *   改用 GET/PUT/DELETE /users/me/llm 把金鑰加密存在後端。金鑰只會往上送、
 *   永遠拿不回明文（狀態只有遮罩後的最後 4 碼），也**絕不寫進 localStorage**。
 */
const SettingsModule = (function() {
    const ACTIVE_PROVIDER_KEY = 'urDiary_active_provider';
    const MODEL_OVERRIDES_KEY = 'urDiary_provider_models';
    const LOCAL_BASE_URL_KEY = 'urDiary_local_base_url';
    const SEMANTIC_MEMORY_KEY = 'urDiary_semantic_memory';

    // DOM 元素
    let settingsBtn, settingsDialog, closeSettingsBtn, providerSelect,
        modelInput, apiKeyInput, keyStatus, clearKeyBtn,
        baseUrlRow, baseUrlInput, saveBtn, settingsError,
        semanticCheckbox, semanticStatus, languageSelect,
        sessionsList, logoutBtn, keyNote;

    // 伺服器端金鑰狀態（僅瀏覽器模式使用）：
    // null = 還沒查 / 查失敗，物件 = GET /users/me/llm 的回應（只含遮罩）
    let serverLlmStatus = null;
    let serverLlmStatusFailed = false;
    // 打開面板當下表單上的 AI 設定；「什麼都還沒設定」時拿它當「有沒有被改動」的基準
    let llmSelectionAtOpen = null;

    /**
     * 這台裝置能不能用本機安全儲存放金鑰。
     * false（手機瀏覽器）時整個金鑰區塊改走伺服器端儲存。
     */
    function usesLocalKeyStore() {
        return (typeof SecureStore !== 'undefined') && SecureStore.isAvailable();
    }

    function getProviders() {
        return (typeof CONFIG !== 'undefined' && CONFIG.PROVIDERS) ? CONFIG.PROVIDERS : {};
    }

    function getModelOverrides() {
        try {
            const raw = localStorage.getItem(MODEL_OVERRIDES_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (error) {
            console.warn('讀取模型自訂設定失敗:', error);
            return {};
        }
    }

    function saveModelOverride(provider, model) {
        const overrides = getModelOverrides();
        if (model) {
            overrides[provider] = model;
        } else {
            delete overrides[provider];
        }
        localStorage.setItem(MODEL_OVERRIDES_KEY, JSON.stringify(overrides));
    }

    /**
     * 目前生效的 LLM 設定（fetchAPI 附標頭與聊天選單顯示都以此為準）
     */
    function getActiveLLM() {
        const providers = getProviders();
        let provider = localStorage.getItem(ACTIVE_PROVIDER_KEY) || 'grok';
        if (!providers[provider]) {
            provider = 'grok';
        }
        const def = providers[provider] || {};
        const model = getModelOverrides()[provider] || def.DEFAULT_MODEL || '';
        const baseUrl = def.NEEDS_BASE_URL ? (localStorage.getItem(LOCAL_BASE_URL_KEY) || '') : '';
        const hasKey = (typeof SecureStore !== 'undefined') ? SecureStore.hasKey(provider) : false;

        return {
            provider: provider,
            model: model,
            baseUrl: baseUrl,
            hasKey: hasKey,
            label: def.LABEL || provider
        };
    }

    /**
     * 語意記憶檢索是否啟用（fetchAPI 以 X-Memory-Semantic 標頭送往後端）
     */
    function isSemanticMemoryEnabled() {
        return localStorage.getItem(SEMANTIC_MEMORY_KEY) === '1';
    }

    // 查詢後端選配能力，更新語意檢索的可用狀態顯示
    async function refreshSemanticStatus() {
        if (!semanticStatus) return;
        try {
            const base = CONFIG.getApiBaseUrl();
            const res = await fetch(`${base}/system/capabilities`);
            const caps = await res.json();
            if (caps.semantic_memory_available) {
                semanticStatus.textContent = I18N.t('settings.semanticAvailable');
                semanticStatus.style.color = 'green';
                if (semanticCheckbox) semanticCheckbox.disabled = false;
            } else {
                semanticStatus.textContent = I18N.t('settings.semanticUnavailable');
                semanticStatus.style.color = '';
                if (semanticCheckbox) semanticCheckbox.disabled = true;
            }
        } catch (error) {
            // 後端未啟動等情況：保留預設說明文字即可
        }
    }

    function setActiveProvider(provider) {
        const providers = getProviders();
        if (!providers[provider]) {
            console.warn('未知的供應商:', provider);
            return;
        }
        localStorage.setItem(ACTIVE_PROVIDER_KEY, provider);
        notifyChanged();
    }

    function notifyChanged() {
        try {
            window.dispatchEvent(new CustomEvent('urdiary:llm-settings-changed', {
                detail: getActiveLLM()
            }));
        } catch (error) {
            console.warn('無法發送設定變更事件:', error);
        }
    }

    // ---- 設定面板 UI ----

    function showError(message) {
        if (settingsError) {
            settingsError.textContent = message;
            settingsError.style.display = message ? 'block' : 'none';
        }
    }

    function toast(message) {
        if (typeof UIManager !== 'undefined' && UIManager.showToast) {
            UIManager.showToast(message);
        } else {
            console.log(message);
        }
    }

    // ---- 伺服器端金鑰狀態（僅瀏覽器模式）----

    function hasOwnServerKey() {
        return !!(serverLlmStatus && serverLlmStatus.user_credential);
    }

    /**
     * 金鑰欄位下方那行狀態文字（瀏覽器模式）。
     *
     * 「有沒有自己的金鑰」與「現在實際在用哪一組」是兩件事：沒有自己的金鑰
     * 但伺服器有預設金鑰時，使用者其實已經可以正常聊天了——如實說明是誰的
     * 金鑰在生效，才不會讓人以為東西壞掉而反覆重填。
     */
    function serverKeyStatusText(def) {
        if (serverLlmStatusFailed) {
            return I18N.t('settings.keyStatusFailed');
        }
        if (hasOwnServerKey()) {
            return I18N.t('settings.keyStoredServer', {
                provider: serverLlmStatus.user_credential.provider,
                masked: serverLlmStatus.user_credential.key_masked || ''
            });
        }
        if (serverLlmStatus && (serverLlmStatus.source === 'server' || serverLlmStatus.source === 'env')) {
            return I18N.t('settings.keyServerDefault', { provider: serverLlmStatus.provider || '' });
        }
        return def && def.NEEDS_BASE_URL ? I18N.t('settings.keyLocalHint') : I18N.t('settings.keyNone');
    }

    /**
     * 這個帳號的請求「現在實際會用到」的那組設定（GET /users/me/llm 的頂層）。
     *
     * 可能來自自己的憑證、伺服器共用金鑰或 .env 後備——對設定面板而言三者
     * 是同一件事：都是「已經生效、而且沒有金鑰就改不動」的一組值。
     * 什麼都還沒設定（或狀態查不到）時回 null。
     */
    function effectiveLlmSelection() {
        if (!serverLlmStatus || !serverLlmStatus.configured) return null;
        return {
            provider: serverLlmStatus.provider || '',
            model: serverLlmStatus.model || '',
            baseUrl: serverLlmStatus.base_url || ''
        };
    }

    /** 目前表單上的 AI 設定（base_url 只在該供應商真的需要時才算數） */
    function currentLlmSelection() {
        const provider = providerSelect ? providerSelect.value : '';
        const def = getProviders()[provider] || {};
        return {
            provider: provider,
            model: modelInput ? modelInput.value.trim() : '',
            baseUrl: (def.NEEDS_BASE_URL && baseUrlInput) ? baseUrlInput.value.trim() : ''
        };
    }

    /** 查詢伺服器上的金鑰狀態（只會拿到遮罩，永遠拿不到明文） */
    async function refreshServerLlmStatus() {
        serverLlmStatus = null;
        serverLlmStatusFailed = false;
        try {
            serverLlmStatus = await ApiService.getLlmCredential();
            // 面板顯示的供應商/模型以「這個帳號實際會用到的那組」為準：先是
            // 自己的憑證，沒有的話就是伺服器共用金鑰／.env 後備。瀏覽器不送
            // X-LLM-* 標頭，localStorage 裡的偏好在這個環境不影響任何請求，
            // 拿它當顯示值不只誤導，還會讓下面「有沒有被改動」的比較從一開始
            // 就對不上——只是打開面板改個語言的人會被誤判成「改了 AI 設定」。
            const effective = effectiveLlmSelection();
            if (effective && providerSelect && getProviders()[effective.provider]) {
                providerSelect.value = effective.provider;
                if (effective.model) {
                    saveModelOverride(effective.provider, effective.model);
                }
                if (effective.baseUrl) {
                    localStorage.setItem(LOCAL_BASE_URL_KEY, effective.baseUrl);
                }
            }
        } catch (error) {
            console.warn('查詢伺服器金鑰狀態失敗:', error);
            serverLlmStatusFailed = true;
        }
        renderFields();
        llmSelectionAtOpen = currentLlmSelection();
    }

    /** 瀏覽器模式的儲存路徑：把金鑰（與同一組設定）送到伺服器加密保存 */
    async function saveServerLlmCredential(provider, def, apiKey, model, baseUrl) {
        const payload = { provider: provider, api_key: apiKey };
        if (model) payload.model = model;
        if (def.NEEDS_BASE_URL && baseUrl) payload.base_url = baseUrl;

        serverLlmStatus = await ApiService.saveLlmCredential(payload);
        serverLlmStatusFailed = false;
    }

    /**
     * 這次儲存有沒有「改了 AI 設定卻沒給金鑰」（瀏覽器模式）。
     *
     * 伺服器上存的是**一整組**設定，而金鑰依設計拿不回來，所以沒有金鑰就
     * 無法只換其中一個欄位。這種情況必須擋下來並說明白：不擋的話，
     * 表單會把偏好寫進 localStorage（在瀏覽器模式完全不影響任何請求，因為
     * 根本不送 X-LLM-* 標頭），再彈一句「已切換到 Claude」——伺服器上什麼
     * 都沒變，卻回報成功。
     *
     * 比較對象是「目前實際生效的那組」，不是「使用者自己的憑證」：用著
     * 伺服器共用金鑰的家人（user_credential 為 null）改供應商，同樣什麼都
     * 不會發生，一樣要擋。這正是最常見的情境。
     *
     * 兩個刻意不擋的情況（避免過度攔截）：
     * - AI 欄位跟生效中的那組一致 → 這次儲存與 AI 無關（改語言、改進階記憶
     *   開關…），照常存。
     * - 什麼都還沒設定（也沒有伺服器預設）→ 沒有「生效中的設定」可比，改用
     *   「打開面板時的表單狀態」當基準：沒動過 AI 欄位就放行，否則一個只想
     *   先把介面改成英文的新使用者，會被擋在一把他還沒填過的金鑰後面。
     */
    function serverLlmSelectionNeedsKey(provider, model, baseUrl) {
        const provided = { provider: provider, model: model, baseUrl: baseUrl };
        const baseline = effectiveLlmSelection() || llmSelectionAtOpen;
        if (!baseline) return false;

        const needsBaseUrl = !!(getProviders()[provider] || {}).NEEDS_BASE_URL;
        return provided.provider !== baseline.provider ||
            provided.model !== (baseline.model || '') ||
            // base_url 只有在該供應商真的需要時才比：其餘供應商的欄位是隱藏的，
            // 表單根本表達不出伺服器上存的值，拿來比只會誤判成「被改過」
            (needsBaseUrl && provided.baseUrl !== (baseline.baseUrl || ''));
    }

    // 依當前下拉選的供應商刷新表單各欄位
    function renderFields() {
        const providers = getProviders();
        const provider = providerSelect ? providerSelect.value : 'grok';
        const def = providers[provider] || {};

        if (modelInput) {
            modelInput.value = getModelOverrides()[provider] || '';
            modelInput.placeholder = def.DEFAULT_MODEL ?
                I18N.t('settings.modelDefaultPlaceholder', { model: def.DEFAULT_MODEL }) :
                I18N.t('settings.modelLocalPlaceholder');
        }

        // 有效模型 ID 建議清單（打錯 ID 供應商會回 404，盡量用選的）
        const suggestionsList = document.getElementById('settings-model-suggestions');
        if (suggestionsList) {
            const suggestions = def.SUGGESTED_MODELS || [];
            suggestionsList.innerHTML = suggestions.map(m => `<option value="${m}"></option>`).join('');
        }

        if (apiKeyInput) {
            apiKeyInput.value = '';
            const hasKey = usesLocalKeyStore() ? SecureStore.hasKey(provider) : hasOwnServerKey();
            apiKeyInput.placeholder = hasKey ? I18N.t('settings.apiKeyStoredPlaceholder') : I18N.t('settings.apiKeyPlaceholder');
            if (keyStatus) {
                keyStatus.textContent = usesLocalKeyStore() ?
                    (hasKey ? I18N.t('settings.keyStored') :
                        (def.NEEDS_BASE_URL ? I18N.t('settings.keyLocalHint') : I18N.t('settings.keyNone'))) :
                    serverKeyStatusText(def);
                keyStatus.style.color = hasKey ? 'green' : '';
            }
        }

        // 瀏覽器模式：金鑰存在伺服器，說明文字要換成對應的那句（不是系統金鑰鏈）
        if (keyNote && !usesLocalKeyStore()) {
            keyNote.textContent = I18N.t('settings.keyNoteServer');
        }

        if (baseUrlRow) {
            baseUrlRow.style.display = def.NEEDS_BASE_URL ? '' : 'none';
        }
        if (baseUrlInput && def.NEEDS_BASE_URL) {
            baseUrlInput.value = localStorage.getItem(LOCAL_BASE_URL_KEY) || '';
        }

        showError('');
    }

    // ---- 已登入的裝置（工作階段撤銷）----

    function formatSessionDate(iso) {
        if (!iso) return '';
        // 後端存的是 UTC naive 時間，序列化時不帶時區標記；補上 Z 才不會
        // 被瀏覽器當成本地時間而顯示成未來/過去好幾小時
        const normalized = /[Z+]|-\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`;
        const date = new Date(normalized);
        if (isNaN(date.getTime())) return '';
        return date.toLocaleString(I18N.dateLocale(), {
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    function renderSessions(sessions) {
        if (!sessionsList) return;
        if (!sessions.length) {
            sessionsList.innerHTML = `<small style="color: #888;">${escapeHtml(I18N.t('auth.devicesEmpty'))}</small>`;
            return;
        }

        // 所有欄位都來自伺服器（user_agent 是使用者可控的字串），一律轉義
        sessionsList.innerHTML = sessions.map(session => {
            const name = session.device_label || session.user_agent || I18N.t('auth.deviceUnknown');
            const marker = session.is_current ?
                ` <span style="color: green;">(${escapeHtml(I18N.t('auth.deviceCurrent'))})</span>` : '';
            const since = I18N.t('auth.deviceSince', { date: formatSessionDate(session.created_at) });
            const lastUsed = I18N.t('auth.deviceLastUsed', { date: formatSessionDate(session.last_used_at) });
            const revokeBtn = session.is_current ? '' :
                `<button class="btn settings-revoke-session" data-session-id="${escapeHtml(session.id)}"
                         data-device-name="${escapeHtml(name)}"
                         style="padding: 2px 8px; font-size: 12px;">${escapeHtml(I18N.t('auth.revokeDevice'))}</button>`;

            return `<div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid #eee;">
                <div style="min-width: 0;">
                    <div style="overflow-wrap: anywhere;">${escapeHtml(name)}${marker}</div>
                    <small style="color: #888;">${escapeHtml(since)} · ${escapeHtml(lastUsed)}</small>
                </div>
                ${revokeBtn}
            </div>`;
        }).join('');

        sessionsList.querySelectorAll('.settings-revoke-session').forEach(button => {
            button.addEventListener('click', () =>
                revokeSession(button.dataset.sessionId, button.dataset.deviceName, button));
        });
    }

    async function refreshSessions() {
        if (!sessionsList) return;
        sessionsList.innerHTML = `<small style="color: #888;">${escapeHtml(I18N.t('auth.devicesLoading'))}</small>`;
        try {
            const sessions = await ApiService.getSessions();
            renderSessions(Array.isArray(sessions) ? sessions : []);
        } catch (error) {
            console.warn('載入裝置清單失敗:', error);
            sessionsList.innerHTML = `<small style="color: #888;">${escapeHtml(I18N.t('auth.devicesFailed'))}</small>`;
        }
    }

    async function revokeSession(sessionId, deviceName, button) {
        if (!window.confirm(I18N.t('auth.revokeConfirm', { device: deviceName || '' }))) return;

        try {
            if (button) button.disabled = true;
            await ApiService.revokeSession(sessionId);
            toast(I18N.t('auth.revoked'));
            await refreshSessions();
        } catch (error) {
            console.error('撤銷裝置失敗:', error);
            toast(I18N.t('auth.revokeFailed', { error: error.message }));
            if (button) button.disabled = false;
        }
    }

    async function logout() {
        if (!window.confirm(I18N.t('auth.logoutConfirm'))) return;
        try {
            if (logoutBtn) logoutBtn.disabled = true;
            await ApiService.logout();
            toast(I18N.t('auth.loggedOut'));
            closeDialog();
            // 交回登入流程（與 fetchAPI 401 時同一條路徑，會重置各模塊狀態）
            window.dispatchEvent(new CustomEvent('urdiary:auth-expired', { detail: { endpoint: '/users/logout' } }));
        } finally {
            if (logoutBtn) logoutBtn.disabled = false;
        }
    }

    function openDialog() {
        if (!settingsDialog) return;

        // 以目前生效的供應商為初始選擇
        if (providerSelect) {
            providerSelect.value = getActiveLLM().provider;
        }
        if (semanticCheckbox) {
            semanticCheckbox.checked = isSemanticMemoryEnabled();
        }
        if (languageSelect) {
            languageSelect.value = I18N.getLang();
        }
        refreshSemanticStatus();
        refreshSessions();
        refreshCompanionSettings();
        loadVoicePrefs();
        renderFields();
        // 瀏覽器模式：金鑰在伺服器上，開啟面板時才去查（會再 renderFields 一次，
        // 並把 llmSelectionAtOpen 更新成同步過伺服器狀態後的表單內容）。
        // 這裡先記一次基準，涵蓋「查詢還沒回來就按下儲存」的空窗。
        if (!usesLocalKeyStore()) {
            llmSelectionAtOpen = currentLlmSelection();
            refreshServerLlmStatus();
        }
        settingsDialog.style.display = 'block';
        settingsDialog.style.zIndex = '1000';
    }

    function closeDialog() {
        if (settingsDialog) {
            settingsDialog.style.display = 'none';
        }
    }

    async function save() {
        const provider = providerSelect ? providerSelect.value : 'grok';
        const providers = getProviders();
        const def = providers[provider] || {};
        const model = modelInput ? modelInput.value.trim() : '';
        const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
        const baseUrl = baseUrlInput ? baseUrlInput.value.trim() : '';

        if (def.NEEDS_BASE_URL && !baseUrl) {
            showError(I18N.t('settings.needBaseUrl'));
            return;
        }
        if (def.NEEDS_BASE_URL && !model) {
            showError(I18N.t('settings.needModel'));
            return;
        }

        // 瀏覽器模式：伺服器上存的是一整組設定，而金鑰拿不回來，
        // 所以改了供應商/模型/端點就必須連金鑰一起重新送一次。
        // 不論使用者有沒有自己的憑證都一樣要擋——用著伺服器共用金鑰的人
        // 改供應商同樣不會有任何效果，卻最容易被一句「已切換到 X」騙過去。
        if (!usesLocalKeyStore() && !apiKey &&
                serverLlmSelectionNeedsKey(provider, model,
                                           def.NEEDS_BASE_URL ? baseUrl : '')) {
            showError(I18N.t('settings.serverKeyReenter'));
            return;
        }

        try {
            saveBtn.disabled = true;

            // 金鑰：有輸入才更新（留空 = 沿用既有）；寫入失敗如實顯示
            if (apiKey) {
                if (usesLocalKeyStore()) {
                    await SecureStore.setKey(provider, apiKey);
                } else {
                    await saveServerLlmCredential(provider, def, apiKey, model, baseUrl);
                }
                if (apiKeyInput) apiKeyInput.value = '';
            }

            saveModelOverride(provider, model);
            if (def.NEEDS_BASE_URL) {
                localStorage.setItem(LOCAL_BASE_URL_KEY, baseUrl);
            }
            if (semanticCheckbox) {
                localStorage.setItem(SEMANTIC_MEMORY_KEY, semanticCheckbox.checked ? '1' : '0');
            }

            localStorage.setItem(ACTIVE_PROVIDER_KEY, provider);
            notifyChanged();

            // 陪伴者客製化設定：與上面的 AI 供應商／金鑰是各自獨立的一組
            // 設定，用同一顆按鈕一起送出。
            //
            // code review 修復（最終審查裁定的必修項）：這裡刻意 await 在
            // 下面的成功回饋（toast/closeDialog/語言重載排程）之前，且與
            // 上面共用同一個 try/catch——原本放在整個 function 尾端、自己
            // 另包一組 try/catch 時，使用者會先看到「已儲存」的 toast、
            // 對話框也關閉了，這裡才失敗；離線 Electron 情境下上面的 AI/
            // 語言/金鑰幾乎全部只碰本機、幾乎必定「成功」，使用者因此會
            // 誤以為全部都存好了，卻靜默漏掉剛剛輸入的陪伴者名字／風格，
            // 且完全看不到任何錯誤（showError 寫進的是這時已經隱藏的
            // #settings-error）。若剛好又改了語言，下面排定的 400ms 後
            // location.reload() 還可能把還在飛的這個 PUT 攔腰打斷。
            //
            // 改成在這裡 await 到底（成功或丟出例外）才往下走：失敗時直接
            // 讓下面既有的 catch 接手——不顯示成功 toast、不關對話框、不
            // 排定 reload，錯誤訊息如實顯示在仍然開著的對話框裡，使用者
            // 看得到也能重按一次儲存重試（saveBtn 沿用下面既有的 finally，
            // 全部塵埃落定才重新啟用，這裡不需要另外處理）。
            //
            // saveCompanionSettings() 內部「是否曾成功載入過」(companionLoaded)
            // 與部分欄位 payload 的邏輯完全不變，這裡只是搬動呼叫時機。
            await saveCompanionSettings();

            // 語音偏好：純本機 localStorage（經 VoiceModule 封裝），沒有網路
            // I/O 也沒有失敗路徑，放在這裡（其餘欄位都存妥、companion 也
            // await 完）當作這顆按鈕收尾前的最後一步即可。
            saveVoicePrefs();

            // 語言變更：整頁重載以套用所有靜態與動態字串
            // （Electron 重載保留 localStorage 與 token，會自動回到登入狀態）
            const newLang = languageSelect ? languageSelect.value : I18N.getLang();
            const langChanged = newLang !== I18N.getLang();
            if (langChanged) {
                I18N.setLang(newLang);
            }

            const active = getActiveLLM();
            toast(langChanged ? I18N.t('settings.reloading')
                              : I18N.t('settings.saved', { label: active.label, model: active.model || I18N.t('settings.noModel') }));
            closeDialog();

            if (langChanged) {
                setTimeout(() => location.reload(), 400);
            }
        } catch (error) {
            console.error('儲存設定失敗:', error);
            showError(error.message || I18N.t('settings.saveFailed'));
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    async function clearKey() {
        const provider = providerSelect ? providerSelect.value : 'grok';
        try {
            if (usesLocalKeyStore()) {
                await SecureStore.deleteKey(provider);
                renderFields();
            } else {
                // 只刪自己那組；刪完之後可能回退到伺服器預設，狀態要重查
                serverLlmStatus = await ApiService.deleteLlmCredential();
                serverLlmStatusFailed = false;
                renderFields();
            }
            toast(I18N.t('settings.keyDeleted', { provider: provider }));
        } catch (error) {
            console.error('刪除金鑰失敗:', error);
            showError(error.message || I18N.t('settings.clearKeyFailed'));
        }
    }

    // ---- 陪伴者設定（Task 8：AI 名字／稱呼／回覆風格）----
    //
    // 刻意不走其餘欄位那套「init() 時快取 DOM 參照」模式：這幾個函式直接
    // document.getElementById 現查——buildCompanionPayload/applyCompanionData
    // 兩個是 _test 匯出的純輔助，測試不會（也不需要）先呼叫 init()。
    // 為了在元素還沒被渲染出來的頁面/測試 fixture（例如
    // tests/settings_llm_server.test.js 的最小化對話框）安全地略過，兩者
    // 都對「找不到元素」防禦——找不到就當空字串／不寫入，不丟例外。

    let companionNameCache = null;

    // 這個 session 有沒有成功「看過」伺服器上的陪伴者設定一次（GET 成功
    // 套用過，或存檔成功後拿伺服器回應重新套用過）。false 代表卡片上的 5
    // 個欄位現在顯示的空白不能信任為伺服器現況——很可能只是開面板當下
    // GET 失敗（暫時性問題／認證過期），欄位還停在初始空白。這面旗標決定
    // 儲存時要送「完整 5 欄位」（缺席即維持、空字串即清空的正常語意）還是
    // 「只送有填的欄位」（見 buildCompanionPartialPayload），修的正是：
    // GET 失敗 → 使用者其實只想改別的設定就按儲存 → 5 個空字串被當成明確
    // 清空指令，把使用者先前存好的陪伴者名字／風格靜默洗掉、且不出現任何
    // 錯誤訊息，使用者完全不會發現。
    let companionLoaded = false;

    /** 陪伴者名字（模組內快取；GET/PUT 成功後更新）。chat_module 讀取用。 */
    function getCompanionName() { return companionNameCache; }

    function companionFieldValue(id) {
        const el = document.getElementById(id);
        return el ? el.value : '';
    }

    function buildCompanionPayload() {
        return {
            companion_name: companionFieldValue('companion-name').trim(),
            user_nickname: companionFieldValue('companion-nickname').trim(),
            style_reply_length: companionFieldValue('companion-reply-length'),
            style_emoji: companionFieldValue('companion-emoji'),
            style_formality: companionFieldValue('companion-formality'),
        };
    }

    /**
     * 只含「有填」欄位的儲存 payload——後端 PUT 語意是「欄位缺席＝維持
     * 原值，空字串＝明確清空」（這正是後端刻意保留這個語意的理由），拿掉
     * 空字串欄位就等於「這幾個我沒意見，維持伺服器上原本的值」。
     *
     * 用於 companionLoaded === false 時：卡片這時顯示的空白不代表「使用者
     * 要清空」，只是「這個 session 還沒成功讀到伺服器上的值」——兩者外觀
     * 一樣（都是空欄位）但語意完全相反，不能沿用完整 5 欄位那份 payload
     * （那會把「還沒讀到」的欄位當成「使用者要清空」，靜默洗掉舊資料）。
     */
    function buildCompanionPartialPayload() {
        const full = buildCompanionPayload();
        const partial = {};
        Object.keys(full).forEach(key => {
            if (full[key]) partial[key] = full[key];
        });
        return partial;
    }

    function setCompanionFieldValue(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value;
    }

    function applyCompanionData(data) {
        setCompanionFieldValue('companion-name', data.companion_name || '');
        setCompanionFieldValue('companion-nickname', data.user_nickname || '');
        setCompanionFieldValue('companion-reply-length', data.style_reply_length || '');
        setCompanionFieldValue('companion-emoji', data.style_emoji || '');
        setCompanionFieldValue('companion-formality', data.style_formality || '');
        companionNameCache = data.companion_name || null;
    }

    /** 開啟面板時查詢目前的陪伴者設定；未登入/離線時安靜跳過，卡片維持現值。
     *  失敗時 companionLoaded 刻意留在 false（見旗標宣告處的說明）—— 儲存
     *  時會因此改走部分欄位 payload，不會拿這次沒讀到的空白覆蓋伺服器上
     *  既有的設定。 */
    async function refreshCompanionSettings() {
        try {
            const data = await ApiService.fetchAPI('/users/me/companion', { method: 'GET' });
            applyCompanionData(data);
            companionLoaded = true;
        } catch (e) { /* 未登入/離線時安靜跳過，卡片維持現值 */ }
    }

    /**
     * 儲存陪伴者設定。PUT body 走 fetchAPI 既有慣例——傳一般物件，由
     * fetchAPI 內部負責 JSON.stringify（不要在這裡先字串化一次，否則會
     * 被雙重編碼，後端收到的會是一個字串而不是 JSON 物件）。
     *
     * companionLoaded 為 false 時（開面板當下的 GET 失敗過，或還沒發生
     * 過），卡片上的空白欄位不能信任為「使用者要清空」——改送只含有填值
     * 欄位的 partial payload（缺席＝維持原值，是後端特意保留給這個情境的
     * 語意）；全部欄位皆空就整個跳過這次 PUT（沒有任何欄位需要異動，不必
     * 發這次請求，更不能發一個會被解讀成「全部清空」的物件出去）。
     */
    async function saveCompanionSettings() {
        const payload = companionLoaded ? buildCompanionPayload() : buildCompanionPartialPayload();
        if (!companionLoaded && Object.keys(payload).length === 0) {
            return;
        }
        const data = await ApiService.fetchAPI('/users/me/companion', {
            method: 'PUT', body: payload });
        applyCompanionData(data);
        companionLoaded = true;
        document.dispatchEvent(new CustomEvent('companion-settings-changed',
            { detail: { name: companionNameCache } }));
    }

    // ---- 語音偏好（Task 6：輸入模式／自動朗讀／朗讀語音）----
    //
    // 比照上面陪伴者設定卡片：直接 document.getElementById 現查，不走
    // init() 時快取 DOM 參照那套模式，讓測試不必先呼叫 init() 就能直接
    // 呼叫這兩個函式。三個偏好值全部經由 VoiceModule 封裝讀寫（Task 4），
    // 這裡完全不碰 localStorage——三個 key 只能由 VoiceModule 存取，是
    // 這個任務的硬性限制。

    function loadVoicePrefs() {
        const modeEl = document.getElementById('voice-input-mode');
        const autoreadEl = document.getElementById('voice-autoread');
        const voiceIdEl = document.getElementById('voice-id');
        if (modeEl) modeEl.value = VoiceModule.getInputMode();
        if (autoreadEl) autoreadEl.checked = VoiceModule.isAutoRead();
        if (voiceIdEl) voiceIdEl.value = VoiceModule.getVoiceId();
    }

    function saveVoicePrefs() {
        const modeEl = document.getElementById('voice-input-mode');
        const autoreadEl = document.getElementById('voice-autoread');
        const voiceIdEl = document.getElementById('voice-id');
        if (modeEl) VoiceModule.setInputMode(modeEl.value);
        if (autoreadEl) VoiceModule.setAutoRead(autoreadEl.checked);
        if (voiceIdEl) VoiceModule.setVoiceId(voiceIdEl.value.trim());
    }

    function init() {
        console.log('初始化 LLM 設定模塊');

        settingsBtn = document.getElementById('settings-btn');
        settingsDialog = document.getElementById('settings-dialog');
        closeSettingsBtn = document.getElementById('close-settings-btn');
        providerSelect = document.getElementById('settings-provider');
        modelInput = document.getElementById('settings-model');
        apiKeyInput = document.getElementById('settings-api-key');
        keyStatus = document.getElementById('settings-key-status');
        clearKeyBtn = document.getElementById('settings-clear-key');
        keyNote = document.getElementById('settings-key-note');
        baseUrlRow = document.getElementById('settings-base-url-row');
        baseUrlInput = document.getElementById('settings-base-url');
        saveBtn = document.getElementById('settings-save');
        settingsError = document.getElementById('settings-error');
        semanticCheckbox = document.getElementById('settings-semantic-memory');
        semanticStatus = document.getElementById('settings-semantic-status');
        languageSelect = document.getElementById('settings-language');
        sessionsList = document.getElementById('settings-sessions-list');
        logoutBtn = document.getElementById('settings-logout');

        // 供應商下拉選單由 CONFIG.PROVIDERS 生成
        if (providerSelect) {
            const providers = getProviders();
            providerSelect.innerHTML = Object.keys(providers).map(id =>
                `<option value="${id}">${id === 'local' ? I18N.t('provider.local') : providers[id].LABEL}</option>`
            ).join('');
            providerSelect.addEventListener('change', renderFields);
        }

        if (settingsBtn) settingsBtn.addEventListener('click', openDialog);
        if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeDialog);
        if (saveBtn) saveBtn.addEventListener('click', save);
        if (clearKeyBtn) clearKeyBtn.addEventListener('click', clearKey);
        if (logoutBtn) logoutBtn.addEventListener('click', logout);

        // 金鑰載入完成後刷新狀態顯示（面板若已開啟）
        if (typeof SecureStore !== 'undefined' && SecureStore.ready) {
            SecureStore.ready.then(() => {
                if (settingsDialog && settingsDialog.style.display === 'block') {
                    renderFields();
                }
            });
        }

        console.log('LLM 設定模塊初始化完成，目前供應商:', getActiveLLM().provider);
    }

    return {
        init: init,
        getActiveLLM: getActiveLLM,
        setActiveProvider: setActiveProvider,
        isSemanticMemoryEnabled: isSemanticMemoryEnabled,
        openDialog: openDialog,
        getCompanionName: getCompanionName,
        // 僅為 vitest 單元測試曝光，行為不變（本檔案目前唯一的 _test 匯出，
        // 未見既有慣例——依任務說明新增）。buildCompanionPartialPayload 與
        // saveCompanionSettings 是 code review 修復（controller 裁定的必修
        // 項）新增：需要能直接驗證「companionLoaded 為 false 時只送有填
        // 欄位、全空則整個跳過 PUT」這條防靜默清空的邏輯。loadVoicePrefs/
        // saveVoicePrefs 是 Task 6（語音設定卡片）新增。
        _test: {
            buildCompanionPayload,
            buildCompanionPartialPayload,
            applyCompanionData,
            saveCompanionSettings,
            loadVoicePrefs,
            saveVoicePrefs
        }
    };
})();

window.SettingsModule = SettingsModule;
