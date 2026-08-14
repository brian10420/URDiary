/**
 * VoiceModule (v2.4 spec ②)：錄音 → /voice/stt 轉寫；/voice/tts 朗讀。
 *
 * - MediaRecorder mime 依環境回退：Chrome/Electron audio/webm，iOS Safari
 *   只支援 audio/mp4（PWA 重點路徑）。
 * - TTS 以 messageId 快取 blob：同一則重播不重新計費。
 * - 偏好存 localStorage（比照語言/語意記憶開關慣例，零後端 schema）：
 *   urDiary_voice_input_mode / urDiary_voice_autoread / urDiary_voice_id
 * - 音訊 blob 只活在記憶體，不進 localStorage、不落任何儲存。
 */
const VoiceModule = (function () {
    const KEY_MODE = 'urDiary_voice_input_mode';
    const KEY_AUTOREAD = 'urDiary_voice_autoread';
    const KEY_VOICE = 'urDiary_voice_id';

    let mediaRecorder = null;
    let starting = false; // 見 startRecording() 內的說明：補上 getUserMedia() 那段 await 空窗期的同步鎖
    let chunks = [];
    let currentAudio = null;
    const ttsCache = new Map(); // messageId -> objectURL

    function isSupported() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia
            && typeof MediaRecorder !== 'undefined');
    }

    function pickMimeType(recorderClass) {
        const RC = recorderClass || (typeof MediaRecorder !== 'undefined' ? MediaRecorder : null);
        if (!RC || !RC.isTypeSupported) return '';
        if (RC.isTypeSupported('audio/webm')) return 'audio/webm';
        if (RC.isTypeSupported('audio/mp4')) return 'audio/mp4';   // iOS Safari
        return ''; // 交給瀏覽器預設
    }

    async function startRecording() {
        // 防止在錄音進行中被重複呼叫（例如錄音鍵被快速連按兩下、或未來
        // 呼叫端的邏輯錯誤）：不擋住的話，這裡會再要一次麥克風、把
        // mediaRecorder 覆寫掉，原本那個 MediaRecorder/MediaStream 就此
        // 孤兒化——它的 track 只在自己的 onstop 裡 .stop()，而 onstop 永遠
        // 不會觸發（沒有人會再拿到它的參考去呼叫 stopRecording）。結果是
        // 麥克風在使用者看得到的指示燈上持續亮著、被整個工作階段佔用，
        // 且公開 API 完全沒有辦法釋放它。
        // 上面這段檢查本身有個 async 空窗期：mediaRecorder 要等
        // getUserMedia() 的 promise resolve 之後才會被賦值（見下方），所以
        // 「第一次呼叫還卡在瀏覽器權限彈窗、尚未 resolve」的當下，
        // mediaRecorder 仍然是 null。此時若麥克風鍵被快速連按第二下，第二
        // 次呼叫一樣會通過 `if (mediaRecorder)` 這道檢查、再呼叫一次
        // getUserMedia()，把第一支尚在建立中的 MediaRecorder/MediaStream
        // 孤兒化——跟上面注解描述的孤兒化問題同一種後果，只是觸發時機更早、
        // 更容易在真實使用情境（尤其是第一次使用、瀏覽器一定會跳權限彈窗）
        // 踩到。用一個同步旗標 starting 補上這段空窗：從「決定要開始錄音」
        // 到「mediaRecorder 賦值完成」這整段期間都視為進行中，且旗標的檢查
        // 與寫入都在同一個同步區塊完成，兩次呼叫之間不會有交錯的機會。
        if (mediaRecorder || starting) {
            throw new Error('already-recording');
        }
        starting = true;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            chunks = [];
            const mimeType = pickMimeType();
            mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType })
                                     : new MediaRecorder(stream);
            mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
            mediaRecorder.start();
        } finally {
            // 不論成功（此時 mediaRecorder 已賦值，改由它擋下一次呼叫）
            // 或失敗（例如使用者拒絕權限；mediaRecorder 仍是 null，必須
            // 放行讓使用者能重新點擊重試，不能讓 starting 卡死在 true）
            // 都要釋放這把鎖。
            starting = false;
        }
    }

    function stopRecording() {
        return new Promise((resolve, reject) => {
            if (!mediaRecorder) { reject(new Error('not-recording')); return; }
            const recorder = mediaRecorder;
            mediaRecorder = null;
            recorder.onstop = async () => {
                recorder.stream.getTracks().forEach((t) => t.stop());
                try {
                    const type = recorder.mimeType || 'audio/webm';
                    const blob = new Blob(chunks, { type });
                    const ext = type.includes('mp4') ? 'm4a' : 'webm';
                    const form = new FormData();
                    form.append('file', blob, `voice.${ext}`);
                    // FormData body：ApiService.fetchAPI 不得對它套 JSON.stringify
                    // 或強加 Content-Type（見 api_service.js 的 isFormDataBody 分流）
                    const data = await ApiService.fetchAPI('/voice/stt',
                        { method: 'POST', body: form });
                    resolve({ text: data.text || '' });
                } catch (err) { reject(err); }
            };
            recorder.stop();
        });
    }

    async function speak(messageId, text) {
        stopSpeaking();
        let url = ttsCache.get(messageId);
        if (!url) {
            // 走 fetchRaw（回 Blob 的變體，不是 fetchAPI）：body 這裡先自行
            // JSON.stringify，fetchRaw 原樣送出、不會再轉一次——避免雙重編碼。
            const blob = await ApiService.fetchRaw('/voice/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, voice_id: getVoiceId() || null }),
            });
            url = URL.createObjectURL(blob);
            ttsCache.set(messageId, url);
        }
        currentAudio = new Audio(url);
        await currentAudio.play();
    }

    function stopSpeaking() {
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    }

    function getInputMode() { return localStorage.getItem(KEY_MODE) === 'fluent' ? 'fluent' : 'confirm'; }
    function setInputMode(mode) { localStorage.setItem(KEY_MODE, mode === 'fluent' ? 'fluent' : 'confirm'); }
    function isAutoRead() { return localStorage.getItem(KEY_AUTOREAD) === '1'; }
    function setAutoRead(on) { localStorage.setItem(KEY_AUTOREAD, on ? '1' : '0'); }
    function getVoiceId() { return localStorage.getItem(KEY_VOICE) || ''; }
    function setVoiceId(id) { localStorage.setItem(KEY_VOICE, id || ''); }

    return {
        isSupported, startRecording, stopRecording,
        speak, stopSpeaking,
        getInputMode, setInputMode, isAutoRead, setAutoRead, getVoiceId, setVoiceId,
        _test: { pickMimeType, cacheSize: () => ttsCache.size },
    };
})();

if (typeof window !== 'undefined') { window.VoiceModule = VoiceModule; }
