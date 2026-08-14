# Spec ①：提示詞翻新與陪伴者客製化

- 日期：2026-08-14
- 狀態：設計完成，待實作計畫
- 系列：本次改版拆三份 spec——①提示詞＋客製化（本篇）→ ② Grok 語音整合 → ③ 前端插圖與動畫

## 1. 背景與目標

產品定位校準：**陪伴與量身訂做，而不是治癒**。現行 persona 仍偏「情緒承接服務」（開場即預設使用者「壓力很大、習慣把情緒收起來」），要轉向「有個性的朋友」。

四個目標：

1. **對話品質再上一層**——以開放資料為師重寫 persona
2. **新增客製化功能**——AI 名字、相互稱呼、說話風格細節（不做人格預設集、不做自由文字個性描述）
3. **拉平供應商差距**——同一套提示詞下讓四家供應商都接近最佳表現
4. **其他角色提示詞一併對齊**新語氣

### 開放資料的關鍵發現（2026-08-14 調研）

[xai-org/grok-prompts](https://github.com/xai-org/grok-prompts)（xAI 官方開源的 Grok 系統提示詞）中**幾乎沒有人格與語氣條文**——沒有幽默指示、回覆長度規則、情感對話腳本；只有一個 `custom_personality` 模板鉤子。啟示：

- **提示詞要「少管」**：對話魅力主要來自模型本身；給身分、價值觀、許可，不寫劇本。與本專案 2026-07-13 的實戰教訓一致（約束式提示詞過擬合→冰冷公式化；防禦性規則要配正向許可）。
- **拉平供應商的主力是「減法」**：約束越少，各家模型自己的對話能力越能發揮。
- **模板鉤子注入客製化**與 xAI 自家做法同構，驗證本設計的注入方案。

## 2. 非目標

- 人格預設集（元氣／溫柔／損友等一鍵人格）——使用者明確不要
- 自由文字個性描述欄——不做
- per-provider 提示詞變體——**不預先實作**；盲評發現系統性跑偏才考慮
- 語音功能（spec ②）、前端插圖動畫（spec ③）
- 危機分級、反諂媚、禁毒性正向句式等安全底線的任何鬆動

## 3. persona_core 重寫（§1）

`backend/app/services/prompts/{zh-TW,en}/persona_core.txt` 兩語同步重寫，目標**比現行 41 行更短**。新結構：

1. **身分**：你是這本日記主人的朋友——開場即定調朋友關係；刪除「會來的人多半壓力很大」的治癒系前提。persona 本檔維持**純靜態**（不含模板變數），名字與稱呼一律由組裝時的注入區塊帶入（見 §4），避免雙軌機制
2. **個性核心**（新增段落，取代散落的語氣規則）：溫暖打底＋幽默直率；有自己的觀點與好奇心；敢不同意、會開玩笑；幽默是為了親近不是表演
3. **對話原則**（保留 v2 精華並瘦身）：分量跟著投入走、真誠參與內容本身、被打動就說出來、不必每則問題收尾
4. **情境模式**（降級）：「傾聽三步」從預設骨架降為「對方明顯低落時才切換」的場景技能；興奮分享時當思考夥伴
5. **「看見」與記憶引用**：原樣保留（產品靈魂）
6. **底線原封**：不當回音壁、禁止句式清單、誠實與界線（AI 身分、不替代專業）、危機一律交 `crisis_mode.txt`

配套：

- `roles.json` companion 角色一句話改為朋友定位（兩語）
- `conversation_prompt.txt` 記憶／行事曆機制不動，僅措辭對齊新語氣
- 命名處理：persona 內以一行靜態文字涵蓋無名狀態（「若他還沒幫你取名字，自稱『我』就好；也可以在自然的時機邀請他取一個——取名本身就是你們的一次互動」）；已取名時注入區塊會寫明名字，以注入內容為準

### 提示詞工作紀律（沿用實戰鐵律）

- 新增任何例句前先 grep 兩語 persona 的禁詞清單（曾踩「加油」被明文禁用）
- 注入區塊的使用說明必須緊貼區塊（放遠處會被「自然聊天」人設壓過）
- 本次為有意識的重寫，不適用「只做加法」規則，但重寫後兩語必須逐段對照一致

## 4. 客製化功能（§2）

### 資料層

`users` 表加 5 個 nullable 欄位，走既有 `database/schema_upgrade.py ensure_schema()` 自動補欄，零遷移腳本：

| 欄位 | 型別 | 值域 | 預設語意 |
|------|------|------|----------|
| `companion_name` | TEXT | 自由文字 ≤20 字 | 空＝無名，自稱「我」 |
| `user_nickname` | TEXT | 自由文字 ≤20 字 | 空＝不特別稱呼，自然以「你」相稱 |
| `style_reply_length` | TEXT | `short`/`natural`/`chatty` | 空＝`natural` |
| `style_emoji` | TEXT | `none`/`low`/`high` | 空＝`low` |
| `style_formality` | TEXT | `casual`/`polite` | 空＝`casual`（口語 vs 斯文） |

### API

- `PUT /users/me/companion`（比照既有 `PUT /users/me/llm` 模式，`backend/app/api/routes/user.py`）；request schema 進 `api/schemas.py`
- 枚舉欄位以 Literal 驗證；名字欄 trim、去除控制字元與換行、長度上限 20 字（超長回 422）
- `GET /users/me` 回傳上述 5 欄

### 注入

`services/prompt_builder.py` 組裝時，在 persona 之後插入一小節「【你們的稱呼與他喜歡的風格】」：

- 內容為**自然語言一至兩句**（例：「他幫你取了名字：小澄。他喜歡你叫他阿哲。他偏好簡短的回覆、少用表情符號。」），不是機械式 key=value
- **五欄全空時整節省略**，提示詞與現行完全等價
- 使用說明緊貼區塊（鐵律）
- 呼叫端 `services/interaction_service.py` 從 `current_user` 取值傳入；check-in 與對話兩個入口都要吃到

### UI

- 設定頁新增「陪伴者」卡片（`desktop/index.html`＋`js/settings_module.js`）：兩個文字欄＋三組 segmented 按鈕；存檔打 `PUT /users/me/companion`
- 聊天視窗標題在有 `companion_name` 時顯示名字（`js/chat_module.js`／`ui_manager.js`）
- i18n 兩語新增對應字串（`js/i18n.js`）；手機 PWA 因設定存後端 DB 自動同步，`css/mobile.css` 確認卡片在 768px 以下排版

## 5. 供應商拉平與模型升級（§3）

- Grok 預設模型 `grok-4.3` → **`grok-4.6`**：`backend/app/providers/factory.py`（PROVIDER_DEFAULT_MODELS）＋ `desktop/js/config.js` 兩處同步；README 若列模型一併更新
- 實作時檢查 Claude／OpenAI／Gemini 三家預設模型是否過時，更新到各家當前推薦的對話模型（以官方文件為準，不憑印象）
- 拉平主力＝瘦身提示詞（見 §3 設計）；**不**預先實作 per-provider 補丁
- 驗收＝盲評：5 個固定情境腳本（日常閒聊／長篇心事／興奮分享點子／情緒低落／應引用舊日記的場合），同一套訊息餵 4 家供應商，由使用者本人盲評「像不像朋友」；某家系統性跑偏才立案處理

## 6. 其他角色提示詞（§4）

- **對齊朋友語氣**（直接面對使用者）：`daily_note_prompt`（日記代寫）、`checkin_prompt`、`support_message`（每日一句）
- **分析型僅相容檢查**（輸出格式不動）：`interaction_note_prompt`、`emotion_analysis_prompt`、`theme_extraction`
- `crisis_mode.txt` 內文不動，僅確認與新 persona 的銜接語氣不突兀
- `en/` 全部同步，兩語逐段對照

## 7. 測試與驗收

1. `prompt_builder` 單元測試：五欄注入、全空 fallback（輸出與無此功能等價）、名字清洗、`companion_name` 有無的條件分支
2. companion 設定 API 測試：PUT 正常值／越界值（>20 字、非法枚舉）／GET 回讀
3. 既有測試全過:backend pytest（v2.2 時 168 項）＋ desktop vitest（69 項）＋ `smoke_test.sh`
4. 禁詞 grep：兩語新提示詞跑禁詞清單檢查
5. 盲評腳本（§5）＋使用者本人實測語氣——自動化測不出「溫暖」（2026-07-13 教訓）；測試不動 user 1 真實日記資料
6. E2E stub LLM（`URDIARY_ALLOW_STUB_LLM`）路徑確認新注入不破壞既有 Playwright 測試

## 8. 風險與緩解

| 風險 | 緩解 |
|------|------|
| 瘦身過頭→回到「太自由」的另一極端 | 保留禁句式清單與底線段；盲評把關；上線前使用者本人實測 |
| 名字／稱呼欄位被塞怪內容影響 prompt | 長度 20 字上限＋去控制字元換行；本質是使用者自己客製自己的 AI，風險有限 |
| `polite/casual` 在英文語境語意不同 | en 版 UI 文案獨立措辭（casual/polite ≈ relaxed/refined），注入句兩語各自打磨 |
| 模型升級改變既有語氣基準 | 先升模型再調提示詞，盲評以新模型為基準一次到位 |

## 9. 需要動的檔案清單

- 提示詞：`backend/app/services/prompts/{zh-TW,en}/`（persona_core、conversation_prompt、daily_note、checkin、support_message、roles.json；其餘檢查）
- 後端：`services/prompt_builder.py`、`services/interaction_service.py`、`database/`（users 模型＋ensure_schema）、`api/routes/user.py`、`api/schemas.py`、`providers/factory.py`
- 前端：`desktop/index.html`、`js/settings_module.js`、`js/chat_module.js`、`js/ui_manager.js`、`js/i18n.js`、`js/config.js`、`css/`（含 mobile.css）
- 測試：`backend/tests/`、`desktop/tests/`
