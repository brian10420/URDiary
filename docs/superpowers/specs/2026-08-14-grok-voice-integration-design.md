# Spec ②：Grok 語音整合（STT 輸入＋TTS 朗讀）

- 日期：2026-08-14
- 狀態：設計完成，待實作計畫
- 系列：① 提示詞＋客製化 → ② 語音（本篇）→ ③ 前端插圖與動畫

## 1. 背景與範圍決策

xAI 已開放語音 API（2026-08 調研）：即時 speech-to-speech（WebSocket `wss://api.x.ai/v1/realtime`，$0.08/分）、TTS（REST `/v1/tts`，$15/百萬字元）、STT（REST `/v1/stt`，批次 $0.10/小時、串流 $0.20/小時，25 語言）。參考：[xAI Voice Overview](https://docs.x.ai/docs/guides/voice)、[Grok Voice Agent API](https://x.ai/news/grok-voice-agent-api)。

**兩階段策略（使用者決策）**：本 spec 只做 **STT 語音輸入＋TTS 朗讀**；即時語音對話（工程量大：需 streaming 架構、對話回寫日記流、persona/記憶帶入 session）留給未來獨立 spec，屆時 ephemeral token 機制才登場。

## 2. 非目標

- 即時 speech-to-speech 對話（未來 spec）
- 120 秒聲音克隆（custom voice_id）
- 語音訊息以音訊形式保存——**只存轉寫文字**，不留音檔
- 前端直連 xAI（CORS 與 token 簽發風險，本階段不採）

## 3. 架構：後端代理（方案 A）

### 路由與服務

- `backend/app/api/routes/voice.py`：
  - `POST /voice/stt`：multipart 音檔＋語言提示（沿用 `X-Language` 標頭）→ xAI `/v1/stt` → `{text}`
  - `POST /voice/tts`：`{text, voice_id}` → xAI `/v1/tts` → 串流回 `audio/mpeg`
- `backend/app/services/voice_service.py`：以 httpx 直呼 xAI REST（STT/TTS 為 xAI 自有端點、非 OpenAI 相容，不走現有 chat SDK）；端點與參數細節實作時以官方文件為準
- 兩路由皆需 JWT 登入（比照 /chat）

### 金鑰解析（語音一律用 xAI 金鑰，與聊天供應商選擇無關）

四層，比照既有 `deps` 模式：

1. `X-Voice-Api-Key` 標頭（桌面 Electron 從 secure_store 的 grok 金鑰帶上）
2. 使用者 DB 憑證中的 grok 憑證（PWA 路徑；若 `llm_credential_service` 目前僅存單一供應商，實作時擴充為可按供應商名查詢）
3. 伺服器預設憑證
4. env `XAI_API_KEY`

四層皆無 → 專屬錯誤碼，前端引導至設定頁補 xAI 金鑰。

### 防護與隱私

- 音檔上限 10 分鐘／25MB（超限 413）；TTS 單次 2000 字（422）
- 逾時與上游錯誤映射為 `utils/messages.py` 雙語友善訊息，**不透傳 xAI 原始錯誤**
- **音訊只在記憶體處理，不落磁碟**（日記隱私原則）
- 金鑰不寫入任何 log

## 4. 前端 UX

### 共用模組 `desktop/js/voice_module.js`

- MediaRecorder 錄音：Chrome/Electron 用 webm/opus；**iOS Safari 落 mp4/aac**（PWA 重點，xAI STT 支援 12 種格式）
- 上傳至 `/voice/stt`、播放 `/voice/tts` 回流
- TTS blob 以訊息 id 快取於頁面記憶體——同一則重播不重新計費

### 聊天

- 輸入列麥克風鍵：錄音中顯示動畫＋計時，再按停止
- 依「語音輸入模式」設定分流（使用者決策：兩種都要、由設定切換）：
  - **確認模式**：轉寫填入輸入框，使用者編輯後送出
  - **流暢模式**：轉寫完直接送出
- AI 訊息旁播放鍵；設定開「自動朗讀新回覆」則新回覆到達即播（僅聊天）

### 日記編輯器

- 麥克風鍵：轉寫文字插入游標處，**永遠確認式**（口述日記是行動端核心場景）

### 設定頁「語音」卡片

- 語音輸入模式（確認／流暢）、自動朗讀開關、朗讀語音選擇（xAI 語音下拉）
- xAI 金鑰狀態提示與導引
- 偏好存 localStorage（`urDiary_voice_input_mode` / `urDiary_voice_autoread` / `urDiary_voice_id`），比照語言／語意記憶開關慣例；零後端 schema
- i18n 雙語字串；`mobile.css` 適配；getUserMedia 權限被拒的雙語提示（PWA 需 HTTPS 前提，部署文件已涵蓋）

## 5. 測試與驗收

1. 後端路由測試（mock httpx）：STT/TTS 正常流程、無金鑰錯誤碼、逾時映射
2. **安全邊界測試**（比照 v2.3 task 3.3 紀律）：未登入 401、超大檔 413、非音訊 MIME 拒收、金鑰不落 log、錯誤不透傳上游細節、音訊不落地驗證
3. 前端 vitest：`voice_module` 模式分流、blob 快取、iOS 格式分支
4. smoke_test.sh 加語音路由項（無金鑰時的預期錯誤碼即可，不需真金鑰）
5. 實機驗收：桌面 Electron＋手機 PWA（iOS Safari 格式特別驗）各一輪真金鑰流程
6. 實作完成後跑 `/security-review` 全面掃描

## 6. 費用參考

- STT $0.10/小時（批次）——每天口述 20 分鐘日記月費不到 US$1
- TTS $15/百萬字元——一則 200 字回覆約 US$0.003；預設手動播放即省錢設計

## 7. 需要動的檔案清單

- 後端：`api/routes/voice.py`（新）、`services/voice_service.py`（新）、`api/deps.py`（voice 金鑰解析）、`services/llm_credential_service.py`（按供應商查詢，如需）、`main.py`（掛路由）、`utils/messages.py`、requirements（httpx，如未內建）
- 前端：`js/voice_module.js`（新）、`js/chat_module.js`、`js/api_service.js`、`js/diary_module.js`、`js/settings_module.js`、`index.html`、`js/i18n.js`、`css/`（含 mobile.css）
- 測試：`backend/tests/`、`desktop/tests/`、`backend/tests/smoke_test.sh`
