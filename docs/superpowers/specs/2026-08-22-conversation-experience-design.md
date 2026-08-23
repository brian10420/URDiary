# 對話體驗（v2.5 Spec B）設計文件

日期：2026-08-22
狀態：使用者已逐節核可（§2–§6 對應設計對話 §1–§5）
設計素材：`docs/superpowers/reference/legacy-prompts/conversation_prompt.txt`（使用者 v1 原創對話提示詞，逐段比對結論見 §2）
相依：v2.4 persona 調校成果（`prompts/{zh-TW,en}/persona_core.txt`、`conversation_prompt.txt`）、v2.4 spec① CompanionSettings（`users` 表五欄）、v2.4 spec③ `MascotModule.thinkingBubbleHtml()`、既有 check-in 流程（`interaction_service.py` + 前端 `requestDailyCheckin`）
向前承諾：§5 的 `get_user_profile_block()` 是 Spec C 記憶 2.0 的注入接縫；`onboarding_answers` 表是 Spec C ingestion 素材

## §0 一句話

陪伴者從「話少的好哥們」長出人味（映照句式＋few-shot 手感＋主動追問），並在初次見面時用一場零 LLM 的腳本式自我介紹認識使用者——答案原文入庫，留好 Spec C 使用者檔案的接縫。

## §1 範圍、非目標與裁決記錄

**做**：
1. 人味 #4——加法編輯兩語 persona_core／conversation_prompt：映照句式工具箱、自我覺察收束、主動追問許可、few-shot 例句段。
2. Onboarding #6——前端純腳本初次對話（自我介紹→取名邀請→七題輕量提問），chips 逃生口全程掛著，腳本訊息前隨機思考 1–3 秒（搖擺泡泡，測試可關）；答案原文存新表。
3. 使用者檔案注入——onboarding 答案以【他初次見面時告訴你的】區塊注入 conversation 與 check-in 兩入口，單一函式承載（Spec C 接縫）。

**非目標（本期不做）**：
- onboarding 不用 LLM（零金鑰可跑是硬需求）；不做「腳本＋LLM 點綴」混合路徑。
- 不做設定頁「重新自我介紹」重跑入口（觸發=每使用者一次；表結構 upsert 已為未來重跑留路）。
- 名字題**不**自動寫 `user_nickname`（純腳本無法可靠抽暱稱；由 profile block 讓模型自然學會稱呼；設定頁自設照舊）。
- onboarding 交換**不**寫入 `chat_messages`（一次性儀式，重載不重演；不進後續 LLM 對話歷史）。
- few-shot 段只進 conversation_prompt，**不**進 check-in 提示詞。
- 不蓋 in-app 提示詞/模型比較工具（A/B 是開發期流程，見 §6）。
- 不重構【情緒場景的優先順序】為 v1 具名角色框架（實質已吸收，重構有語氣回歸風險）。
- 手機 PWA 功能自動生效但驗收照既有約定延後至行動批次。

**裁決記錄（設計對話 AskUserQuestion）**：
| 議題 | 裁決 |
|---|---|
| onboarding 驅動 | 純腳本（零 LLM、零金鑰依賴） |
| 觸發條件 | 所有 `onboarding_completed_at` 為空者一次（含既有帳號 brian/amy） |
| 思考延遲範圍 | 只有腳本/靜態訊息；真實 LLM 回覆不另加 |
| A/B 形態 | 開發期流程，不蓋新功能 |
| 取名邀請 | 要，放自我介紹後當開場互動，寫現有 `companion_name` |
| 整體方案 | 方案 A（加法融入＋前端腳本＋單一函式接縫） |

## §2 提示詞融合（人味 #4）

### v1 原創提示詞逐段比對（七元素三處置）

| v1 元素 | 現行狀態 | 處置 |
|---|---|---|
| 依情緒分流角色系統（低迷→聆聽者/映照者/連結者；正面→陪伴者/連結者） | 已吸收：conversation_prompt【情緒場景的優先順序】低落→聆聽者/映照者、正面→思考夥伴；連結者散見記憶引用規則 | 維持敘述式，不重構 |
| 「我聽到你說…」「我能感受到…」映照句式 | **未吸收**（persona 只說「用自己的話反映」，無句式範例） | **融入**（增補 1） |
| 互動筆記日期敏感性 | 已吸收且更完整（【如何使用記憶】＋《標題》＋日期引用慣例） | 不動 |
| 情緒回應框架（負面先接納／成就連結成長／迷茫回顧策略） | 已吸收（低落三步＋場景清單） | 不動 |
| 察覺話題尾聲適當收尾 | 已吸收（場景清單末條） | 不動 |
| 避免過多主觀判斷、協助使用者發現自己的洞見 | **未吸收** | **融入**（增補 2，含人設張力處理） |
| 心理師人設 | v2.4 已刻意改為「朋友」 | 不融回 |

### persona_core.txt 三處增補（兩語同步，全加法）

1. **映照句式工具箱**——【當他情緒低落時】「反映」步驟後補：「我聽到你說…」「我能感受到…」「聽起來…」是好用的起手式；**並排反公式警語**：連續訊息不重複同一起手式、反映永遠用自己的話換句話說（v2 公式化教訓的直接應用：防禦規則配正向許可）。
2. **自我覺察收束**——低落段尾補，且處理與「有觀點的朋友」人設的張力（分時機而非壓抑觀點）：「他傾訴情緒時，幫他自己看見他的洞見，比你替他下結論更有力；你的觀點留到他喘過氣。聊想法時照常主動。」
3. **主動追問許可**——【怎麼聊天】補：真的好奇就追問細節（「後來呢？」「那你怎麼回？」）——好奇是在乎的證明；「一次最多一個問題」上限不變。

實際文案於實作時起草；本節增補**不得刪改任何既有行**（`git diff --numstat` 驗證），每條新例句寫入前先 grep 兩語 persona_core 禁詞清單。

## §3 Few-shot 例句段（【回應手感示範】）

**位置**：兩語 `conversation_prompt.txt` 末尾新段【回應手感示範】（en 標題實作時定，如 "How replies should feel — examples"）。純靜態文字：不加 placeholder、不改 builder；`load_prompt` 每次讀檔，調校免重啟。兩語**各自原生撰寫**同場景，不逐字互譯。

**四情境四例**（每例=「他說：…」→「你可以這樣回：…」）：

| # | 情境 | 示範重點 |
|---|---|---|
| 1 | 低落傾訴（長訊息帶情緒） | 映照起手＋接住情緒＋不給建議＋分量相稱；**本例附 ✗/✓ 分量對比**（掏心長訊息：✗ 兩句敷衍 → ✓ 相稱回應），直接打擊「話少好哥們」病灶 |
| 2 | 興奮分享想法 | 思考夥伴：投入內容、說共鳴、丟一個「我在想——」 |
| 3 | 日常閒聊（短訊息） | **短回應**、自然接話——反向防護：不讓 few-shot 教壞成「每則都寫長」 |
| 4 | 迷茫 | 回顧過往策略＋溫和給一個小方向 |

**三條防護欄**：
1. 段首反過擬合框架：「這些是手感示範，不是模板——別逐字套用、別讓每則回覆長得像範例。」
2. 例句**不含**具體《標題》/日期的記憶引用（防模型模仿虛構引用；引用示範由【相關日記】既有說明承擔）。例 4 的「過往策略」用泛指語（「上次卡住的時候你…」）。
3. 技術鐵律：例句全文**禁用花括號 `{}`**（conversation_prompt 走 `.format()`，裸花括號會炸注入）；禁詞 grep；`--numstat` 零刪改。

**Token 成本**：四例＋框架約 600–800 字/語（每則訊息約 +400–600 tokens）——本地單人 app、金鑰自備，可接受。

## §4 Onboarding 流程

### 觸發與豁免

- 進聊天室時前端查 `GET /users/onboarding/state`：`completed=false` → 啟動 onboarding，**該次不發 check-in 請求**（自我介紹就是問候），且完成後的**同一個 session 不補發**——下次進入起照常；`completed=true` → 現行流程照舊。
- 全程零 LLM 呼叫、無金鑰可跑；收束後若無金鑰，接現有無金鑰引導（不動現有邏輯）。

### 腳本序列（前端 `onboarding_module.js`；文案進前端 i18n 字典，兩語）

```
intro（自我介紹；「想直接跟我開始對話也沒關係！」寫在文案裡）
→ naming（取名邀請：「你想幫我取個名字嗎？之後想到再取也行！」）
→ q1 name → q2 location → q3 favorite_food → q4 important_people
→ q5 hobbies → q6 strengths → q7 self_view
→ outro（溫暖收束 → POST complete）
```

- **取名分支**：無論結果，原文一律 upsert `onboarding_answers`（`question_key=companion_naming`，供續跑判斷）。回答 ≤12 字 → 另寫現有 `companion_name`（沿用 companion 設定端點），**下一則腳本訊息即自稱新名字**（當場生效）；>12 字 → 溫和請他取短一點（重試一次）；仍超長 → 只留原文＋「之後可到設定頁告訴我」，繼續 q1。
- **答題**：打字送出=回答當前題，原文逐題即存（`POST /users/onboarding/answer`）。
- **跳過語義**：「跳過這題」（含取名）＝以**空字串**答案 upsert 該題——`answered_keys` 因此包含它，續跑不重問已跳過的題；profile block 渲染時濾掉空值。
- **回應語池**：收到答案後，下一題訊息**前綴**一句隨機輕量回應（「記下來了！」「好喔～」等，i18n 池）——併進同一則訊息，不多一次延遲、去填表感。
- **常駐 chips**（貼最新腳本訊息下方）：「跳過這題」＋「直接開始聊天」。「直接開始聊天」任何時點按下 → 短版收束訊息 → `POST complete`；已答部分照存。
- **中斷續跑**：app 中途關閉、旗標仍空 → 下次進入以簡短版再見面文案開場，從 `answered_keys` 之後第一個未答題續問；已答不重問。
- **語言切換**：現有機制整頁 reload → 續跑自然以新語言續問；答案原文語言不限。

### 思考延遲（假思考）

- 每則腳本訊息顯示前：搖擺思考泡泡（`MascotModule.thinkingBubbleHtml()`）uniform 隨機 1000–3000ms，然後泡泡替換為訊息、chips 同時現身。
- **測試鉤子（硬需求）**：延遲取值走 module 層函式/旗標，測試可設 0；配 fake timers 驗證區間。
- 適用範圍=腳本/靜態訊息（onboarding 全部訊息；靜態歡迎詞 fallbackWelcome 順帶適用同一 util）；真實 LLM 回覆維持現狀不加。

### 渲染

- 腳本訊息用現有系統訊息樣式（`addSystemMessage`）；使用者答案用一般使用者訊息樣式。
- 兩者皆**不寫入** `chat_messages`、不進 `saveChatHistory` 持久層——重載不重演。

## §5 資料模型、API 與 Spec C 接縫

### 資料層

- 新表 `onboarding_answers`：

| 欄位 | 型別 | 說明 |
|---|---|---|
| id | Integer PK | |
| user_id | FK users.id, index | |
| question_key | String(32) | 白名單：`companion_naming / name / location / favorite_food / important_people / hobbies / strengths / self_view` |
| answer_text | Text | 長度上限 500 字（schema 層驗證，防爆 prompt） |
| answered_at | DateTime | upsert 時更新 |

  Unique(`user_id`, `question_key`)——重答覆蓋（為未來重跑留路）。
- `users` 加 nullable 欄 `onboarding_completed_at`（DateTime）——走 `schema_upgrade.ensure_schema()` 自動補欄。
- `companion_name` 用現有欄，不新造。

### API（掛現有 user 路由）

- `GET /users/onboarding/state` → `{"completed": bool, "answered_keys": [str]}`（`answered_keys`＝有 row 的 keys，**含**空字串跳過者）
- `POST /users/onboarding/answer` `{"question_key", "answer_text"}` → upsert；白名單外 422、超長 422；**空字串合法**（跳過語義）
- `POST /users/onboarding/complete` → 設 `onboarding_completed_at`（走完或提前退出都呼叫；冪等）

### Profile block（Spec C 接縫）

新 `services/user_profile.py`，單一函式：

```python
def get_user_profile_block(user_id: int, lang: str) -> str
```

- **本期實作**：讀 `onboarding_answers`（排除 `companion_naming`——那是陪伴者的名字非使用者資料；濾掉空字串——那是跳過）→ 渲染【他初次見面時告訴你的】區塊：逐條帶日期（「（2026-08-22）喜歡的食物：牛肉湯」），**使用說明緊貼區塊**（鐵律）：自然記得、別複誦清單、對方說「今天」時注意日期時效。
- 無任何答案 → 回**空字串**，注入端整塊消失（比照 `companion_block` 模式，模型不看到空區塊標題）。
- **注入點 1**：`conversation_prompt.txt` 於【你對這位使用者的長期認識（互動筆記）】**之前**加 `{user_profile_block}` placeholder；`build_conversation_system` 加對應 format key（空字串時不留多餘空行）。
- **注入點 2**：check-in——`interaction_service` 現行 `user_profile` = 互動筆記前 400 字或「還不熟」佔位；改為：profile block（有就前綴）＋筆記摘要，兩者皆無才用「還不熟」。
- **Spec C 到來時**：只重寫本函式內部（策展版使用者檔案／USER.md 等價物），兩個呼叫端、placeholder、答案表全不動；`onboarding_answers` 成為 Spec C ingestion 素材之一。

## §6 測試與驗收

### 後端（pytest）

- 三 API：upsert 冪等、白名單擋、長度上限擋、state 回報 `answered_keys`、complete 冪等。
- `get_user_profile_block`：有答案含日期渲染／全空回空字串／兩語／排除 `companion_naming` 與空字串跳過項。
- `prompt_builder`：conversation 注入 block（有/空）；check-in 合成三情境（block＋筆記／只筆記／皆無→「還不熟」）。
- 兩語 `conversation_prompt.format()` smoke——花括號炸彈在測試就爆。
- **禁詞測試自動化（新）**：全檔 grep 會誤報（「加油」列在【禁止的句式】清單本身），故測試**以段標題定位【回應手感示範】段**，只掃該段不得含兩語禁詞（zh 清單取自 persona_core【禁止的句式】；en 清單實作時自 en persona_core 對應段落讀出）；其他段落照舊人工 grep 鐵律。
- `schema_upgrade` 自動補 `onboarding_completed_at`。

### 前端（vitest）

- 觸發/不觸發、腳本序列七題順序、跳過、「直接開始聊天」提前收束、取名 ≤12 生效＋超長重試分支、逐題 POST、續跑跳過已答題、check-in 抑制、chips 行為。
- 延遲鉤子測試設 0（硬需求）；fake timers 驗 1000–3000ms 區間；泡泡→訊息替換。
- 不寫入聊天歷史持久層的斷言。

### 人味 A/B（開發期流程）

1. 固定場景腳本四則——**刻意不同於 few-shot 例句內容**（避免自我印證），涵蓋同四情境。
2. 調校前/後提示詞 × grok-4.3（主目標）＋至少一個對照模型（claude 或 gemini），相同輸入人工比對：分量相稱？映照自然？有無公式化？——區分「提示詞問題」vs「模型風格」。
3. 結論寫進驗收紀錄文件。
4. **最終驗收=使用者本人在真 app 用 grok 實測**（tone-feedback 鐵律：「溫暖」不靠自動化判斷）；onboarding 使用者本人會完整走到一次（觸發設計使然）；使用者真實資料（user 1）照舊不動。

### 出貨檢查

- `git diff --numstat` 驗兩語提示詞加法零刪改（僅聲明過的新段/新行）。
- 兩語同步檢查（zh-TW/en 每處增補成對）。
- sw `CACHE_VERSION` bump（PWA 拿到新前端）。

## §7 接縫重審補記（2026-08-24，C 落地後逐節重審定案）

Spec C（記憶 2.0）已先於 B 合併 main@2c346fe。逐節重審結論：§1–§4、§6 照舊；
§5 接縫敘述按現碼微調如下，B 實作以本節與實作計畫
（`docs/superpowers/plans/2026-08-24-conversation-experience.md`）為準，其餘設計不重開：

1. **承載函式**：`services/user_profile.py` 已由 C 建立；conversation 與 check-in 兩個
   呼叫端實際呼叫的是 `get_memory_context()`（`interaction_service.py:56`、`:234`；
   `get_user_profile_block()` 是它的薄包裝、生產路徑無人直呼）。B 的
   【他初次見面時告訴你的】渲染加在 **`get_memory_context()` 內部**——兩個呼叫端與
   包裝函式全部零改動，比原文更徹底做到「呼叫端不動」。
2. **注入點 1、2 已由 C 完成**（conversation 雙 placeholder＋builder format key；
   check-in 的 profile_block＋companion_block 合成與「還不熟」fallback）。B 唯一的
   行為差異：有未收納答案時 `has_any=True`（自然由第 1 點達成）。
3. **「Spec C 到來時」段反轉為收納（ingestion）**（2026-08-24 使用者裁決：
   complete 一次＋懶收納素材）：`onboarding_answers` 加 `ingested_at`（nullable）；
   complete 端點 best-effort 呼叫 `run_review_pass(source="onboarding")`（無金鑰／失敗
   靜默跳過、絕不擋 complete）；另比照 C 的 `legacy_note_block` 懶遷移模式，review pass
   讀階段把未收納答案渲染成【初次見面他告訴你的（收納素材）】注入
   `memory_review_prompt` 新 placeholder `{onboarding_block}`——零金鑰走完 onboarding
   的人，首篇日記後的 review pass 自然補收。成功套用（applied>0 或 approval 模式
   pending>0）才戳記 `ingested_at`；收納後 raw 區塊自然消失。空 ops／解析失敗／超標
   整批拒絕都不戳記（素材下輪重現＝天然重試）。
4. **raw 答案同步進 `diary_context`**（2026-08-24 使用者裁決：成本低、體驗優先）——
   日記生成當天即知道名字與喜好；收納後改經 user_profile 檔自然到位。
5. 「加法零刪改＋numstat」鐵律的適用範圍＝`persona_core.txt` 與
   `conversation_prompt.txt` 兩檔（語氣調校資產）；`memory_review_prompt.txt` 的
   `{onboarding_block}` placeholder 插入是 C 檔案的必要修改（僅素材鏈那一行），
   不在此鐵律內。
