# 行事曆升級（v2.5 Spec A）設計文件

日期：2026-08-17
狀態：使用者已逐節核可（§1–§6）；視覺 mockup 已逐屏核可
Mockup 原稿：`.superpowers/brainstorm/1362750-1786915065/content/`（`month-cell-layout.html` 佈局A、`day-panel.html` P1、`stamp-library-v3.html` 24 款印章＝已核可資產，實作原樣使用）
相依：v2.4 spec③ MascotModule（`feature/v2.4-mascot` @ 1c2a1e3）

## §0 一句話

月曆長出三件事：TimeTree 式跨天橫槓（可選色）、AI 在日記後悄悄蓋下的印章與小語（「平凡也值得紀錄」）、年份快速跳轉。

## §1 範圍與非目標

**做**：
1. 跨天事件——整天型事件加結束日，月視圖以連續橫槓呈現，可自選顏色。
2. AI 印章＋小語——日記生成後全自動在該日行事曆放 24 款印章之一＋≤30 字小語；低落日改鼓勵語氣。
3. 年份選取——年月 picker。

**非目標（本期不做）**：
- 跨天 × 重複規則並用（跨天事件 recurrence 一律 none）。
- 含時間的跨夜事件（event_time 與 end_date 互斥；含時間事件維持單日）。
- AI 生圖（印章全部是內建 SVG 資產）。
- 使用者手動蓋印章（印章是 AI 的「主動看見」；使用者要標記日子用既有事件）。
- 週/日視圖的橫槓（僅月視圖＋日面板）。

## §2 資料模型與後端 API

### calendar_events 新欄位（皆 nullable，符合 ensure_schema 限制）
- `end_date DATE NULL`——NULL＝單日。驗證（Pydantic schema 層）：
  - `end_date >= event_date`
  - 設了 `end_date` ⇒ `event_time` 必為 NULL（全天）且 `recurrence == "none"`，違反回 422
- `color VARCHAR(7) NULL`——`^#[0-9a-fA-F]{6}$`，NULL＝前端用分類色。單日事件也可設（表單同一欄位），但本期 UI 僅在橫槓/日面板左緣使用。

### 新表 day_notes
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | Integer PK | |
| user_id | FK users.id, index | |
| note_date | Date | 與 user_id 複合 UNIQUE——同日覆蓋（upsert） |
| stamp | String(24) | 印章 id（§3 清單） |
| phrase | Text | AI 小語（≤30 字為目標，不硬截） |
| source_diary_id | FK diaries.id, NULL | 日面板「來自 M/D 的日記」跳轉 |
| created_at / updated_at | DateTime | 慣例同其他表 |

### API
- `GET /calendar/day-notes?start=YYYY-MM-DD&end=YYYY-MM-DD`——隨月份載入，跨度上限沿用 62 天；回 `{ notes: [{date, stamp, phrase, source_diary_id}] }`。
- `DELETE /calendar/day-notes/{date}`——刪除當日印章（日面板刪除鍵用）。
- **沒有 POST**——寫入只發生在 `/chat/end` 日記生成成功的伺服器端路徑（§3）。
- `GET /calendar/events` 的 occurrence 展開：跨天事件**每天展開一筆**，每筆附 `span_day`（第幾天，1 起）、`span_total`（共幾天）、`color`。單日事件兩欄為 NULL/1。62 天上限、既有欄位不變。

## §3 AI 印章管線

- **零額外 LLM 成本**：日記生成的 JSON tail（現含 valence/arousal）擴充兩欄：`"stamp": "<id>"`、`"note": "<小語>"`。印章目錄（id＋一句用途說明）與選章規則注入日記生成提示詞。
- **情緒分流**：`valence < 0.45` → 只能從鼓勵組選（`umbrella / moon / rainbow / sprout / heal`），語氣＝陪伴打氣，不慶祝；否則從紀念角度選最能代表當日的印章。0.45 與 spec③ 彩蛋門檻同一語意界線。
- **情緒接口可替換**：分流判定集中成 `calendar_service`（或共用 service）單一常數＋函式；註解標明未來由使用者的情緒識別模型替換此判定。前端 mascot.js 的 `QUIET_VALENCE_THRESHOLD` 已同值，兩處註解互相指路。
- **容錯**：LLM 未回 stamp/note、stamp 不在清單 → 該日無印章，日記生成完全不受影響（沿用 diary_draft 容錯風格）。
- **一律生成**：低落日也蓋章（鼓勵是本功能核心）；同日重新生成日記 → upsert 覆蓋。
- **語言**：小語語言跟隨 `X-Language`。
- **開關**：`/chat/end` request body 加 `enable_day_note: bool = True`；桌面設定頁「AI 行事曆印章」開關（前端 config 存），關閉時前端帶 false，後端不寫 day_notes。

### 印章清單（24 款，id／zh／en；📖＝吉祥物系列）
cake 生日蛋糕 Birthday Cake｜gift 驚喜禮物 Sweet Surprise｜heart📖 愛心滿滿 Full of Love｜cheers 聚會乾杯 Cheers Together｜trophy 成就獎盃 Achievement｜flag 里程碑小旗 Milestone Flag｜book📖 讀書進修 Study Time｜star 閃耀的一天 Shining Day｜plane 出發遠行 Off We Go｜camera 出遊留影 Snapshot Day｜ball 活力運動 Active Day｜movie 看場電影 Movie Night｜music 音樂時光 Music Time｜food 美味一餐 Tasty Meal｜coffee 小歇片刻 Little Break｜flower 花草散步 Garden Walk｜sun 晴朗有勁 Sunny Spirit｜umbrella📖 雨天安好 Rainy Comfort｜moon📖 靜靜的夜 Quiet Night｜rainbow 雨過天晴 After the Rain｜sprout 新芽成長 New Sprout｜heal📖 照顧自己 Self Care｜paw 毛孩時光 Furry Moments｜gradcap 考試學業 Exam Season

命名規則：zh 印章名四字（2+2）為主、五字可（閃耀的一天、里程碑小旗）。SVG 以 `stamp-library-v3.html` 為準原樣轉錄（48 viewBox、描邊 #4b2e1e、暖色票、吉祥物系列含迷你書本體）。

## §4 前端渲染與互動

### 月視圖橫槓（核可佈局 A＋修正）
- 每週列一個覆蓋層（z-index 蓋過日期分隔線），跨天事件畫**連續膠囊**：文字從首日連續流出，**不被格線截斷**（硬規則）。
- 位置＝日期列下方的「橫槓道」；跨週斷行各畫一段（首段左圓角、末段右圓角）。
- 每週最多 **2 條 lane**（分配順序固定：起日早者先佔上道；同起日依事件 id 小者先），第 3 條起以「+N」示於該格；點格開日面板看全部。
- 顏色＝`color` || 分類色（`--cat-*`）。點橫槓＝開該事件編輯。
- 對位：橫槓層與月格用同一 grid 模板計算（`calc(100%/7*n)`），避免 resize 飄移。

### 月格印章徽章（佈局 A）
- 日期旁 14px `stampIcon`，`title` tooltip＝小語全文。分類圖標列、cat-dot 退路皆不動。

### 日面板（核可佈局 P1）
1. **印章卡**（有印章才顯示）：40px 印章＋小語＋「來自 M/D 的日記」（跳日記頁該篇）；hover/長按顯示刪除（DELETE API＋樂觀移除）。
2. **跨天事件**：帶「第 N 天／共 M 天」徽章、左緣 4px 色條（color||分類色）。
3. 一般事件（現有樣式）。

### 事件表單
- 「＋結束日期」摺疊欄位；設定後鎖 `event_time` 與 `recurrence`（UI 置灰＋一行提示），清除即恢復。
- 顏色列：「分類色（預設）」＋ 8 色 swatch（#e8836f、#f5c542、#5fd0a0、#7f96c9、#8f62c9、#e8899a、#2a78d6、#b8b2a5）。

### 年份選取
- Header 年月變按鈕 → 彈出「年網格（當前 ±10）＋月網格」，選即跳轉；Esc/點外關閉。

### 工程慣例
- 印章 SVG 進 `MascotModule.stampIcon(id, size)`；未知 id fallback `star`。無新增動畫（印章靜態；reduced-motion 無新項）。無新檔案——sw precache 不動。
- i18n 兩語成對（印章名、表單標籤、tooltip、設定項、「第 N 天／共 M 天」）。
- guard 慣例沿用：`typeof MascotModule !== 'undefined'`＋既有輸出 fallback。

## §5 測試與人工驗收

**後端（pytest）**：end_date/color 驗證矩陣（含互斥 422）；跨天 occurrence 展開 span_day/span_total 正確（含跨週、跨查詢邊界）；day_notes upsert 覆蓋、GET 區間、DELETE；JSON tail 新欄位解析與容錯（缺欄/壞 id）；鼓勵組規則（低 valence 時提示詞注入鼓勵組限定）。
**前端（vitest）**：lane 分配純函式（重疊/超過 2 條→+N）；橫槓段落計算（跨週斷段、圓角側）；月格徽章與 tooltip 渲染；日面板 P1 順序與刪除；stampIcon 兩尺寸與 fallback；表單互斥鎖 UI 邏輯；年 picker 純邏輯。
**人工（交使用者）**：橫槓連續性與選色、印章徽章 14px 觀感、深色主題、日面板動線；手機 PWA 隨行動批次一併驗。

## §6 風險與退路

- 橫槓對位飄移 → 同一 grid 計算式；驗收盯 resize。
- 舊資料/舊客戶端相容：無 end_date＝單日照舊；舊 client 不帶 enable_day_note＝預設開。
- LLM 不合作 → 無印章、日記照常（無錯誤 UI）。
- 14px 印章認不出 → title tooltip 可救；極端情況可設定關閉整個印章功能。
- day_notes 隱私：全本地 SQLite，與日記同級。目前專案無刪日記功能；未來（Spec D）若加，服務層同步把該日記的 day_notes.source_diary_id 置 NULL（不依賴 SQLite FK pragma）。
