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
        if (mediaRecorder) {
            throw new Error('already-recording');
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = [];
        const mimeType = pickMimeType();
        mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType })
                                 : new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        mediaRecorder.start();
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
