# 吉祥物動畫與互動（v2.6 motion 1c：App 內動畫）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 App 裡的書本吉祥物活起來——rig 化的 inline SVG 加上待機呼吸／眨眼、點擊反應、登入頁眼睛跟隨、初次見面揮手進場與取名慶祝、存日記翻頁彩蛋、行事曆新印章壓印，以及分頁切換的 View Transitions；全程守風格契約（inline SVG＋CSS、色票鎖定、§4 彩蛋硬規則），reduced-motion＝靜態。

**Architecture:** SVG 仍只在 `mascot.js` 的模板字串（rig 化＝把每個姿勢拆成具名 `<g class="mm-*">` 群組，靜止畫面逐像素不變）、keyframes 仍只在 `mascot.css`；新增獨立的行為層 `mascot_motion.js`（`window.MascotMotion`）：純函式決策（眨眼間隔、限流、共用排程器、眼睛位移）＋薄 DOM 層（只加 class／寫 inline transform，不用 WAAPI）。跨模組只靠兩個接點：模板上的 `data-mm-*` 行為旗標，與 `chat_module.js` 發出的 `urdiary:diary-saved` DOM 事件；視圖轉場留在 `ui_manager.js`（不依賴吉祥物模組）。影格審查靠 `desktop/tools/motion/` 的 harness＋Playwright 擷取腳本（暫停＋seek `document.getAnimations()`），靜止畫面不變靠像素同一性工具。

**Tech Stack:** vanilla JS（IIFE module）＋CSS keyframes＋View Transitions API（Electron 35／Chromium 134）、vitest 2＋jsdom 25、Playwright 1.61（e2e 與開發工具，只在 devDependencies）。

**Spec:** plan of record `docs/superpowers/plans/2026-09-30-motion-showcase.md`（原檔 `~/.claude/plans/comyfyui-opus-5-5-max-conmfyui-github-s-steady-canyon.md`）的 Stage 1 → **1c** 十項設計；風格契約 `docs/superpowers/specs/2026-08-14-mascot-illustrations-design.md`（§1 色票、§3 搖擺、§4 彩蛋硬規則、§6「SVG 只在 mascot.js 的模板字串、keyframes 只在 mascot.css」）。兩份都要讀。

**分支：** `feature/v2.6-motion-showcase`，從 `main@7210700`（Spec B 已合併）開。基線：vitest 464 綠、後端 pytest 604 綠、**e2e 在 main 上是紅的**（Spec B 的 onboarding 攔截了 e2e 旅程的第一則訊息，見 Task 1）。

## Global Constraints

- **色票（契約 §1，一字不差）**：描邊 `#4b2e1e`、書皮 `#b98d6d`、書頁 `#f9f3e6`、書籤 `#5fd0a0`、眼嘴 `#2b1a10`、腮紅 `#f0a78f`（opacity 0.55）；姿勢既有道具色不動；新增裝飾只准沿用 `mascot.js` 既有色值（愛心 `#e8899a`、金星 `#f5c542`）。
- **技術邊界**：只用 inline SVG＋CSS keyframes（WAAPI 雖允許，本計畫不用——keyframes 才能守 §6 單一來源）；不加任何動畫庫、不加任何 runtime npm 依賴。
- **單一來源（契約 §6）**：SVG 只在 `desktop/js/mascot.js` 的模板字串；吉祥物 keyframes 只在 `desktop/css/mascot.css`；App 層級非吉祥物動態（視圖轉場、聊天訊息淡入）在 `animations.css`／`chat.css`。
- **可攜**：`desktop/js/mascot_motion.js` 必須能在純靜態頁單獨運作（1d 展示頁會原封複製 `mascot.js`＋`mascot.css`＋它）——不得依賴 I18N／ApiService／UIManager；缺 `matchMedia` 視為「無偏好」（JS 動作照常，CSS `@media (prefers-reduced-motion)` 仍管轄 CSS 動態）、缺 `checkVisibility` 退回 `getClientRects()` 可見性檢查、缺 DOM／計時器 API 則不動作，一律不拋錯。（2026-09-30 審查裁決：缺 matchMedia 視為無偏好——能表達減少動態偏好的環境必有 matchMedia）
- **契約 §4**：彩蛋與反應只綁明確操作事件，永不由對話內容或情緒觸發；`.chat-messages` 裡只准安靜搖擺／靜態吉祥物；`valence < 0.45`（`QUIET_VALENCE_THRESHOLD`）走安靜路徑（沒有彩蛋、印章不壓）；前端目前沒有危機訊號＝已知限制（見文末）。
- **reduced-motion＝靜態**：每個新 `animation` 都要在同檔 `@media (prefers-reduced-motion: reduce)` 有 `animation: none`（`tests/reduced_motion_css.test.js` 逐檔檢查）；JS 動作前先問 `MascotMotion.isReducedMotion()`（視圖轉場問 `matchMedia`），偏好改變時即時停／起；瀏覽器層面由 `capture-frames.js --reduced` 斷言每個場景影格完全相同。
- **靜止畫面不變**：每個動手改 `mascot.js`／`mascot.css` 的任務結尾都跑 `node tools/motion/pose-identity.js`，必須印 `pose identity: OK`。
- **守衛**：呼叫端一律 `typeof MascotModule !== 'undefined'`／`typeof MascotMotion !== 'undefined'`（部分既有測試只 bare-load 單一模組）。
- **PWA**：新 shell 檔進 `index.html` 與 `sw.js` 的 `SHELL_ASSETS`；本計畫改了既有 shell 檔內容＝sw.js 註解的情境 (b)，`CACHE_VERSION` 由 `urdiary-shell-v3` bump 到 `urdiary-shell-v4`（Task 11 統一做一次）。
- **開發工具隔離**：`desktop/tools/motion/**` 不進 `index.html`、不進 `SHELL_ASSETS`、後端不掛（只掛 `/js` `/css` `/assets`）；工具輸出一律寫到 git 之外（預設 `os.tmpdir()`）。`tests/motion_tools.test.js` 釘住。
- **文字**：本計畫不新增任何使用者可見字串（名牌顯示的是使用者自己取的名字）；實作時若真的需要新字串，zh-TW／en 兩語同步進 `i18n.js`（`tests/i18n.test.js` 的鍵集合對等檢查會抓漏）。
- **測試指令**：前端 `cd /home/e604/Brian/URDiary/desktop && npx vitest run [檔案…]`；e2e `cd /home/e604/Brian/URDiary/desktop && npx playwright test`（隔離後端 8123＋stub LLM，約 20 秒）；後端 `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest -q`（本計畫不改後端，最後跑一次確認 604）。
- **資料與帳號**：不碰 `data/`、不用帳號 id 1、不對 Brian 的 Electron profile 開 App；測試只用 jsdom 與 e2e 隔離後端。
- **Git**：只 commit `desktop/` 與 `docs/` 底下的路徑；不放 >10 MB 檔；訊息 `feat(吉祥物動畫): <中文摘要>`（純測試 `test(吉祥物動畫)`），最後一行 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。

## Review Focus

計畫沒明講、但真的會碰到的五種情況（最可能出事的排前面）；每一行都有對應測試落在負責的任務裡：

1. **報讀器使用者走初次見面**：取名慶祝浮層的名牌若可被報讀，會脫離上下文再唸一次名字——浮層整個 `aria-hidden="true"`（Task 9：`onboarding_motion.test.js`「浮層整個 aria-hidden」）。
2. **兩個彩蛋撞在一起**：初次見面慶祝還沒淡完就按了「結束對話並生成日記」（onboarding 期間這顆鍵仍可按）——一次只留一個浮層，新的取代舊的，不疊（Task 9：「一次只留一個浮層」）。
3. **程式觸發的連續導覽撞上視圖轉場**：`endChat` 500ms 後自動 `.click()` 日記頁籤、同時使用者點了別的分頁——以最後一次的意圖收斂，不停在過期狀態（Task 11：「連續兩次程式觸發的導覽」；另：轉場的 220ms 內瀏覽器會吞掉點擊，屬已知限制）。
4. **系統的「減少動態」在 App 開著時被切換**：正在彈跳／眨眼／眼睛偏著的吉祥物要立刻回到靜止、不留卡住的 class／愛心／位移，關掉後恢復（Task 4「偏好即時切換」、Task 6「反應進行中偏好改成 reduce」、Task 7「跟隨中切成 reduce 立刻回正」）。
5. **印章壓印的「只一次」跨越切月、換帳號**：翻到別的月再回來、同分頁換帳號、第一次打開行事曆——都不重播、不外洩、既有的章不壓（Task 10：「章還沒出現在這次清單」「換帳號清空」「首次載入既有的章不壓」）。

## 設計決策（實作者必讀，Fable 審查依據）

- **模組切分**：`mascot.js`＝外觀（模板＋彩蛋浮層 DOM，沿用 `showSaveEgg` 先例）；`mascot_motion.js`＝行為（何時加哪個 class）；`ui_manager.js`＝視圖轉場（自己查 `matchMedia`，不依賴吉祥物模組——吉祥物載入失敗也不影響切頁）；`calendar_module.js`＝「哪張章是新的」。行為層不 import 任何 App 模組，1d 可以原封搬。
- **行為旗標**：模板在 `<svg>` 上標 `data-mm-idle`（待機）、`data-mm-tap`（可點）、`data-mm-follow`（眼睛跟隨）；只有登入歡迎與三種空狀態帶旗標，聊天區的思考中／生成日記／check-in 端茶一律不帶（契約 §4），彩蛋浮層也不帶。點擊用 document 層級委派＋執行期再擋一次 `.chat-messages`／`.mascot-egg`。
- **一個排程器**：全頁一個計時器，每 3–7 秒掃一次「在畫面上（`checkVisibility`）、睜眼」的待機吉祥物，各錯開 0–400ms 眨一次（錯開用 CSS 變數，不另開計時器）；分頁隱藏或 reduce 時連計時器都不排；呼吸與 zzz 是純 CSS 循環，隱藏時 `html.mm-paused` 暫停。
- **點擊反應套用範圍**：登入歡迎（揮手，已是笑眼）＋三種空狀態（睡覺→醒來笑、舉月曆、歪頭問號）。不套用：聊天區所有吉祥物、彩蛋浮層、印章與分類圖標。每隻 1.2 秒限流。
- **眼睛跟隨**：契約 §4 表格把揮手歡迎的眼睛定為「瞇瞇笑眼」（弧線、沒有瞳孔），所以跟隨做成「整張臉看過去」——眼睛位移上限 6（viewBox 單位）、嘴與腮紅跟一半，不改成豆豆眼。觸控：看向點擊處、700ms 後回正。
- **「新印章」的判定**：`/chat/end/` 回應帶 `diary.diary_id`、`/calendar/day-notes` 回應帶 `source_diary_id`。存日記成功時登記 id（安靜篇與沒開 AI 印章不登記），下一次 `loadMonth` 的清單裡對上的那天壓印一次、立刻消掉。不靠日期（不猜時區／5 點換日）、不靠「第一次看到」——第一次打開行事曆時既有的章一律不動。
- **視圖轉場**：只給分頁切換（`handleNavigation`）；`init`、斷點變化、日記詳情開關仍直接 `switchToState`。API 不在／reduce／同狀態 → 退回原本同步 class 切換（jsdom 天然走這條）。以「待套用狀態」做決策，連續觸發收斂到最後意圖；轉場期間 `html.vt-running` 讓 `.view-container` 的 0.3s 過渡直接跳終點。預設根節點交叉淡化 220ms。
- **e2e 策略**：旅程主體改在 `reducedMotion: 'reduce'` 下跑（所有新動態退回靜態／同步，斷言不和動畫賽跑，也順便證明 reduce 下 App 完整可用）；檔尾一支專屬 test 用 `page.emulateMedia` 切回 `no-preference`，用 `window.__vtCalls` 計數證明 reduce 下零次轉場、開了動態才走轉場，並等 `UIManager.viewTransitionSettled()` 再斷言單一面板版面。原型實測連跑 4 次 18/18 綠。
- **CACHE_VERSION**：只在 Task 11 bump 一次（v3→v4）。中途若要在實機 PWA 看某個任務的成果，得先手動 bump，否則舊版 mascot.js 會從 v3 快取出來（守衛讓它只會「少動畫」，不會壞）。

## File Structure（檔案責任地圖）

**新建（前端）**：
- `desktop/js/mascot_motion.js` — 行為層 `window.MascotMotion`：reduced-motion 監看、共用待機排程器、點擊反應、眼睛跟隨（Task 4 建，Task 5–7 擴充）。
- `desktop/tools/motion/pose-identity.js` — 靜止畫面像素同一性檢查（Task 2）。
- `desktop/tools/motion/harness.html`、`harness.js`、`capture-frames.js` — 影格審查 harness 與擷取／contact sheet（Task 3 建，之後每個視覺任務往 `harness.js` 的 `SCENES` 加場景）。
- 測試：`tests/mascot_rig.test.js`（T2）、`tests/motion_tools.test.js`（T3）、`tests/mascot_motion.test.js`＋`tests/reduced_motion_css.test.js`（T4）、`tests/mascot_idle.test.js`（T5）、`tests/mascot_react.test.js`（T6）、`tests/mascot_follow.test.js`（T7）、`tests/mascot_egg.test.js`（T8）、`tests/onboarding_motion.test.js`（T9）、`tests/calendar_stamp_press.test.js`（T10）、`tests/ui_manager_transitions.test.js`（T11）。

**修改（前端）**：
- `desktop/js/mascot.js` — rig 化（T2）、行為旗標（T5–T7）、開心臉＋愛心（T6）、翻頁紙＋`mascot-egg-happy`（T8）、雙手慶祝姿勢＋共用浮層＋初次見面兩個浮層（T9）。
- `desktop/css/mascot.css` — rig 共同設定＋待機（T5）、反應（T6）、揮手與跟隨（T7）、彩蛋升級（T8）、初次見面（T9）、印章壓印（T10）；每段都補 reduce 版。
- `desktop/css/animations.css` — reduce 版（T4）、視圖轉場（T11）。
- `desktop/css/chat.css` — reduce 版（T4）。
- `desktop/js/main.js` — 啟動 `MascotMotion.init()`（T4）。
- `desktop/index.html` — `<script src="js/mascot_motion.js">`（T4）。
- `desktop/sw.js` — `SHELL_ASSETS` 加 `mascot_motion.js`（T4）、`CACHE_VERSION` v4（T11）。
- `desktop/js/onboarding_module.js` — 揮手進場＋取名慶祝的兩個掛點（T9）。
- `desktop/js/chat_module.js` — 存日記成功廣播 `urdiary:diary-saved`（T10）。
- `desktop/js/calendar_module.js` — `createStampPressTracker`＋壓印 class（T10）。
- `desktop/js/ui_manager.js` — `resolveNavigation`／`shouldUseViewTransition`／`transitionToState`／`viewTransitionSettled`（T11）。
- `desktop/e2e/urdiary.spec.js` — onboarding 收束＋reduce 情境（T1）、轉場專屬 test（T11）。

**不動**：後端全部、`data/`、既有的 vitest 測試檔（本計畫只新增測試檔；`motion_tools.test.js` 是本計畫自己在 T3 建的，T4 補一行）。唯一被修改的既有測試是 e2e 旅程 `desktop/e2e/urdiary.spec.js`（T1、T11）。

**任務相依（依序執行即可）**：

```
T1 e2e 基線修復 ──────────────────────────────────────────────┐
T2 rig＋像素工具 → T3 影格 harness → T4 行為核心＋全域 reduce ─┤
   T4 → T5 待機 → T6 點擊反應 → T7 登入跟隨＋揮手 ────────────┤
   T2 → T8 存日記彩蛋升級 → T9 初次見面（用到 T7 的揮手、T8 的浮層）
   T4 → T10 行事曆壓印（用到 isReducedMotion）                 │
   T1＋T4 → T11 視圖轉場＋e2e 動態段＋CACHE_VERSION＋出貨檢查 ◀─┘
```

每個任務的共同收尾（各任務步驟裡會寫出確切指令）：vitest 全綠（數字逐任務遞增：464→510→518→538→546→560→570→575→588→602→628）、動到吉祥物就跑像素同一性、視覺任務跑影格擷取給 Fable 看、動到 App 接線就跑 e2e。

---

### Task 1: e2e 基線修復（onboarding 收束）＋旅程改在 reduced-motion 下跑

**為什麼先做**：main@7210700 上 `npx playwright test` 是紅的——全新帳號登入後 Spec B 的初次見面腳本接管聊天，e2e「chat: send a message」打的字在自我介紹的假思考空窗期被 `OnboardingModule.handleAnswer` 退回（輸入框不清、泡泡不出現），後面 10 支全被 serial 模式跳過（原型實測：2 failed、10 did not run、4 passed）。之後每個任務都要拿 e2e 當回歸閘門，所以第一步先把它修綠。只改測試，不改 App。

**Files:**
- Modify: `desktop/e2e/urdiary.spec.js`（常數區、`beforeAll` 的 `newContext`、`register and login` test）

**Interfaces:**
- Consumes: Spec B 既有 DOM——常駐 chip `[data-onboarding-start-chat]`、`onboarding.outroEarly` 文案、假思考泡泡 `.chat-message.thinking`。
- Produces: 旅程主體在 `reducedMotion: 'reduce'` 的 browser context 下跑（Task 11 的轉場 test 會用 `page.emulateMedia` 暫時切回 `no-preference`）；常數 `OUTRO_EARLY_TEXT`。

- [ ] **Step 1: 確認基線是紅的（失敗的「測試」就是現有 e2e）**

Run: `cd /home/e604/Brian/URDiary/desktop && npx playwright test 2>&1 | tail -8`
Expected: FAIL——`[iPhone 14]`／`[Pixel 7]` 的 `chat: send a message and receive the stub reply` 失敗（`locator('.chat-message.user-message').filter({ hasText: 'message 1' })` not found），摘要約 `2 failed / 10 did not run / 4 passed`。

- [ ] **Step 2: 常數區加 outroEarly 文案**

在 `const DIARY_DONE_TEXT = '對話已結束並生成摘要';` 之後插入：

```javascript
// v2.5 Spec B：全新帳號登入後先走「初次見面」腳本；本旅程點「直接開始聊天」
// chip 收束它，這是收束後的那句話（js/i18n.js 的 onboarding.outroEarly，
// zh-TW——e2e 瀏覽器沒設過語言，I18N 預設 zh-TW）。兩邊沒有共用來源，改文案
// 時務必同步。
const OUTRO_EARLY_TEXT = '好，那我們直接開始吧！想到什麼就跟我說什麼。';
```

- [ ] **Step 3: `beforeAll` 的 context 改在 reduced-motion 下**

找到：

```javascript
        const context = await browser.newContext({
            ...contextOptionsFor(deviceDescriptor),
            baseURL: BASE_URL,
        });
```

換成：

```javascript
        // reducedMotion: 'reduce'（v2.6 motion Task 1）：旅程主體一律在「減少動態」
        // 下跑——這條線之後加的吉祥物動畫、彩蛋與視圖轉場（View Transitions）在
        // 這個偏好下全部退回靜態／同步切換，斷言不必跟動畫時序賽跑。動態開啟時的
        // 轉場路徑由檔尾專屬的 test 用 page.emulateMedia 切回 no-preference 另外驗證。
        const context = await browser.newContext({
            ...contextOptionsFor(deviceDescriptor),
            baseURL: BASE_URL,
            reducedMotion: 'reduce',
        });
```

- [ ] **Step 4: `register and login` 收束 onboarding**

在該 test 的

```javascript
        await expect(page.locator('#create-user-dialog')).toBeHidden();
        await expect(page.locator('#user-input')).toBeVisible();
```

之後、既有的「登入成功後 main.js 的 loginUser() 會重新初始化 ChatModule…」註解之前，插入：

```javascript

        // v2.5 Spec B：全新帳號＝onboarding 未完成，ChatModule 的開場 gate 會先跑
        // 「初次見面」腳本（每則腳本訊息前有 1–3 秒假思考），期間 sendMessage 被
        // OnboardingModule 攔截——不收束的話下一個 test 打的字會被當成取名答案
        // （甚至在假思考空窗期被整句留在輸入框，見 onboarding_module.js
        // handleAnswer）。這裡點常駐 chip「直接開始聊天」收束，然後三段等待，
        // 讓後面每個「訊息數量」斷言的基準點不被 onboarding 的非同步尾巴汙染：
        //   1. outroEarly 那句話真的落地；
        //   2. networkidle——/users/onboarding/complete 回來了（它若帶回判定出的
        //      名字，finish() 會在 .then 裡「同步」掛上下一顆假思考泡泡）；
        //   3. 假思考泡泡歸零——那句更正／預設名字的話（如果有）也落地了。
        const startChatChip = page.locator('[data-onboarding-start-chat]');
        await expect(startChatChip).toBeVisible({ timeout: 15000 });
        await startChatChip.click();
        await expect(page.locator('.chat-messages')).toContainText(OUTRO_EARLY_TEXT, { timeout: 15000 });
        await page.waitForLoadState('networkidle');
        await expect(page.locator('.chat-message.thinking')).toHaveCount(0, { timeout: 15000 });
```

（既有的那段 `networkidle` 註解與呼叫保留不動——新帳號的每日問候本來就被 onboarding 取代，那行等的是日曆／日記的初始載入。）

- [ ] **Step 5: 跑 e2e 確認全綠**

Run: `cd /home/e604/Brian/URDiary/desktop && npx playwright test 2>&1 | tail -4`
Expected: `16 passed`（8 支 × iPhone 14／Pixel 7）。

- [ ] **Step 6: Commit**

```bash
cd /home/e604/Brian/URDiary
git add desktop/e2e/urdiary.spec.js
git commit -m "test(吉祥物動畫): e2e 旅程先收束初次見面再聊天、改在 reduced-motion 下跑

main 上 e2e 是紅的：Spec B 的 onboarding 攔截了旅程的第一則訊息。
點「直接開始聊天」chip 收束並等 outro／complete／假思考落地；
旅程主體改用 reducedMotion: 'reduce'，之後的動畫不和斷言賽跑。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Rig 化（具名部件群組）＋結構測試＋像素同一性工具

**目標**：把每個姿勢拆成具名 `<g class="mm-*">` 群組（動畫掛點），外觀逐像素不變。兩條鐵律：(1) 只包群組、不改繪製順序；(2) `mm-*` 群組本身不帶 `transform` 屬性——CSS `transform` 會整個蓋掉 SVG 的 `transform` 屬性，姿勢自帶的旋轉／位移（睡覺 `rotate(-6)`、歪頭 `rotate(5)`、跳 `translate(0 -18)`）一律留在外層無名 `<g>`。

**Files:**
- Modify: `desktop/js/mascot.js`（檔頭註解到 `POSE_GOODNIGHT` 結束整段、`// -- 對外 API` 之前插 `POSES` 表、`loadingHtml`／`thinkingBubbleHtml`／`emptyHtml`／`welcomeHtml`／`checkinHtml`／`showSaveEgg`）
- Create: `desktop/tools/motion/pose-identity.js`
- Test: `desktop/tests/mascot_rig.test.js`

**Interfaces:**
- Consumes: 既有 `MascotModule` 對外 API（不改名、不改參數）。
- Produces（之後每個任務都靠這組名字）：
  - rig class：`mm-rig`（`<svg>` 的唯一子節點）＞ `mm-body`（書頁＋書皮）、`mm-bookmark`、`mm-face`（內含 `mm-eyes`＋`mm-mouth`）、`mm-blush`、`mm-arm-r`（左右以「畫面」為準；`mm-arm-l` 由 Task 9 首次使用）、`mm-prop`、`mm-zzz`、`mm-stars`、`mm-shadow`、`mm-sky`、`mm-hat`。
  - `mm-eyes` 帶 `data-mm-eyes="dot|happy|closed"`；`<svg>` 帶 `data-mm-pose="smile|sleep|calendar|question|wave|jump|tea|goodnight"`。
  - 模組內部 helper：`part(name, inner, attrs)`、`face(inner)`（Task 6 加第二參數）、`svg200(inner, size, extraClass, pose)`、`svg220(inner, size, pose)`（Task 5 加第四參數）、`POSES` 表、常數 `EYES_HAPPY`／`MOUTH_HAPPY`／`FACE_HAPPY`／`FACE_SMILE`／`BLUSH`。
  - 工具：`cd desktop && node tools/motion/pose-identity.js [--base <ref>] [--out <dir>]`，成功印 `pose identity: OK (all common renders pixel-identical)`、失敗 exit 1 並把 base／head PNG 寫到 `--out`（預設 `<os tmp>/urdiary-pose-identity`）。

- [ ] **Step 1: 寫失敗測試**

`desktop/tests/mascot_rig.test.js`（注意 `REST_FACE`／`atRest`：之後的任務會在部分姿勢放「靜止時不畫」的零件——Task 6 的隱藏開心臉、Task 8 的翻頁紙——結構與圖元數都不算它們，這支測試從一開始就寫成向前相容）：

```javascript
// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadScript } from './helpers/load.js';

/**
 * v2.6 motion Task 2：吉祥物 rig 化的結構契約。
 *
 * 像素層面的「靜止畫面不變」由 tools/motion/pose-identity.js 驗（需要真瀏覽器）；
 * 這裡釘住 jsdom 就驗得到的結構：每個姿勢都有具名部件群組、群組不帶 transform
 * 屬性（CSS 動畫才掛得上去）、繪製順序正確、原本的每一筆圖元都還在。
 */

/** 各對外渲染 → 預期結構。prims＝rig 化之前（main@7210700）量到的圖元數。 */
const EXPECT = {
    loading:          { pose: 'smile',     eyes: 'dot',    blush: 0, armR: 0, prims: 6 },
    thinking:         { pose: 'smile',     eyes: 'dot',    blush: 0, armR: 0, prims: 6 },
    'empty-diary':    { pose: 'sleep',     eyes: 'closed', blush: 0, armR: 0, prims: 9 },
    'empty-calendar': { pose: 'calendar',  eyes: 'dot',    blush: 0, armR: 1, prims: 14 },
    'empty-generic':  { pose: 'question',  eyes: 'dot',    blush: 0, armR: 0, prims: 7 },
    welcome:          { pose: 'wave',      eyes: 'happy',  blush: 1, armR: 1, prims: 9 },
    checkin:          { pose: 'tea',       eyes: 'dot',    blush: 0, armR: 1, prims: 10 },
    'egg-happy':      { pose: 'jump',      eyes: 'happy',  blush: 0, armR: 0, prims: 9 },
    'egg-goodnight':  { pose: 'goodnight', eyes: 'closed', blush: 1, armR: 0, prims: 15 },
};

/**
 * 「靜止畫面」範圍：之後的任務會在部分姿勢放「靜止時不畫」的動畫零件——點擊反應的
 * 開心臉（.mm-face-alt，visibility="hidden"）、存日記彩蛋的翻頁紙（opacity="0"）。
 * 它們不屬於靜止畫面，結構與圖元數都不算。
 */
const REST_FACE = '.mm-face:not(.mm-face-alt)';
const atRest = (el) => !el.closest('[visibility="hidden"], [opacity="0"]');
const restAll = (svg, sel) => [...svg.querySelectorAll(sel)].filter(atRest);

function toSvg(html) {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.querySelector('svg');
}

function renderAll() {
    const out = {
        loading: MascotModule.loadingHtml(96),
        thinking: MascotModule.thinkingBubbleHtml(),
        'empty-diary': MascotModule.emptyHtml('diary', 'x'),
        'empty-calendar': MascotModule.emptyHtml('calendar', 'x'),
        'empty-generic': MascotModule.emptyHtml('generic', 'x'),
        welcome: MascotModule.welcomeHtml(),
        checkin: MascotModule.checkinHtml(),
    };
    for (const kind of ['happy', 'goodnight']) {
        MascotModule.showSaveEgg(kind);
        const egg = document.querySelector('.mascot-egg');
        out['egg-' + kind] = egg.innerHTML;
        egg.remove();
    }
    const svgs = {};
    for (const [name, html] of Object.entries(out)) svgs[name] = toSvg(html);
    return svgs;
}

describe('MascotModule rig（v2.6 motion Task 2）', () => {
    let svgs;
    beforeEach(() => {
        vi.useFakeTimers();   // showSaveEgg 的淡出計時器不外溢到別的測試
        loadScript('js/mascot.js');
        svgs = renderAll();
    });
    afterEach(() => { vi.useRealTimers(); });

    test.each(Object.keys(EXPECT))('%s：data-mm-pose 與唯一的 mm-rig 外層', (name) => {
        const svg = svgs[name];
        expect(svg.getAttribute('data-mm-pose')).toBe(EXPECT[name].pose);
        const rigs = svg.querySelectorAll('.mm-rig');
        expect(rigs.length).toBe(1);
        expect(rigs[0].parentNode).toBe(svg);
        // 所有圖元都在 mm-rig 裡（呼吸／彈跳才會帶著整隻動）
        restAll(svg, 'path,rect,circle,ellipse,text').forEach((el) => expect(rigs[0].contains(el)).toBe(true));
    });

    test.each(Object.keys(EXPECT))('%s：部件群組齊全、眼睛型別正確', (name) => {
        const svg = svgs[name];
        const e = EXPECT[name];
        expect(svg.querySelectorAll('.mm-body').length).toBe(1);
        expect(svg.querySelectorAll('.mm-bookmark').length).toBe(1);
        expect(svg.querySelectorAll(REST_FACE).length).toBe(1);
        const eyes = svg.querySelectorAll(`${REST_FACE} .mm-eyes`);
        expect(eyes.length).toBe(1);
        expect(eyes[0].getAttribute('data-mm-eyes')).toBe(e.eyes);
        expect(svg.querySelectorAll(`${REST_FACE} .mm-mouth`).length).toBe(1);
        expect(restAll(svg, '.mm-blush').length).toBe(e.blush);
        expect(svg.querySelectorAll('.mm-arm-r').length).toBe(e.armR);
    });

    test.each(Object.keys(EXPECT))('%s：mm-* 群組本身不帶 transform 屬性（CSS 動畫才蓋得上去）', (name) => {
        const groups = [...svgs[name].querySelectorAll('[class^="mm-"], [class*=" mm-"]')];
        expect(groups.length).toBeGreaterThanOrEqual(6);   // rig、body、bookmark、face、eyes、mouth 起跳
        const withTransform = groups.filter((el) => el.hasAttribute('transform'))
            .map((el) => el.getAttribute('class'));
        expect(withTransform).toEqual([]);
    });

    test.each(Object.keys(EXPECT))('%s：繪製順序 body → bookmark → face（臉畫在書皮之後才看得到）', (name) => {
        const svg = svgs[name];
        const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
        const body = svg.querySelector('.mm-body');
        const bookmark = svg.querySelector('.mm-bookmark');
        const faceEl = svg.querySelector(REST_FACE);
        expect(body.compareDocumentPosition(bookmark) & FOLLOWING).toBeTruthy();
        expect(bookmark.compareDocumentPosition(faceEl) & FOLLOWING).toBeTruthy();
    });

    test.each(Object.keys(EXPECT))('%s：圖元數與 rig 化之前相同（只包群組、不增刪筆畫）', (name) => {
        expect(restAll(svgs[name], 'path,rect,circle,ellipse,text').length).toBe(EXPECT[name].prims);
    });

    test('鎖定色票：書皮／書頁／書籤／描邊／眼口仍是契約 §1 的值', () => {
        const html = svgs.welcome.outerHTML;
        for (const color of ['#b98d6d', '#f9f3e6', '#5fd0a0', '#4b2e1e', '#2b1a10', '#f0a78f']) {
            expect(html).toContain(color);
        }
    });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/mascot_rig.test.js`
Expected: FAIL，`36 failed | 10 passed (46)`（沒有 `data-mm-pose`、沒有 `mm-*` 群組；「圖元數」與「色票」兩組在舊碼上本來就會過——它們是回歸鎖）。

- [ ] **Step 3: 建像素同一性工具，先在「還沒改」的狀態跑一次當基準**

`desktop/tools/motion/pose-identity.js`：

```javascript
#!/usr/bin/env node
/**
 * 吉祥物靜止畫面的像素同一性檢查（v2.6 motion Task 2；之後每個視覺任務都跑）。
 *
 * 用法（cwd = desktop/）：
 *   node tools/motion/pose-identity.js               # 基準 = git merge-base HEAD main
 *   node tools/motion/pose-identity.js --base <ref>  # 指定基準 commit
 *   node tools/motion/pose-identity.js --out <dir>   # 差異 PNG 輸出（預設 <os tmp>/urdiary-pose-identity）
 *
 * 做法：同一份渲染清單（MascotModule 每個對外 API 的姿勢、兩種存日記彩蛋、七分類
 * 圖標 18/24、24 款印章 14/20/40）分別用「基準版 js/mascot.js」與「工作樹版」在 jsdom
 * 產出 HTML，再用 Playwright chromium（deviceScaleFactor 2）逐筆截圖、比對 PNG 位元組。
 *   模式 A：不載任何 CSS——純 SVG 幾何。rig 只准「包群組」，一筆一畫都不能變。
 *   模式 B：各自載入自己版本的 css/mascot.css、取消所有動畫——新 CSS 的「靜態」規則
 *           （visibility、transform-origin、顏色…）不得偷改靜止外觀。兩筆彩蛋不比 B
 *           （Task 8 會刻意改彩蛋的呈現）。
 * 只比「兩邊都有」的名稱；工作樹新增的渲染列為 new（不算失敗），基準有、工作樹沒有的
 * 列為 missing（算失敗）。任何失敗：印出名稱、把 base／head 兩張 PNG 寫進 --out，
 * exit code 1。這支工具不進 app shell：tools/ 不在 index.html、不在 sw.js 的
 * SHELL_ASSETS，後端也沒掛這個目錄。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { JSDOM } = require('jsdom');
const { chromium } = require('playwright');

const DESKTOP_ROOT = path.resolve(__dirname, '..', '..');
const CATEGORIES = ['work', 'study', 'health', 'family', 'anniversary', 'other', 'travel'];
const STAMPS = ['cake', 'gift', 'heart', 'cheers', 'trophy', 'flag', 'book', 'star',
    'plane', 'camera', 'ball', 'movie', 'music', 'food', 'coffee', 'flower',
    'sun', 'umbrella', 'moon', 'rainbow', 'sprout', 'heal', 'paw', 'gradcap'];
const EGG_NAMES = new Set(['egg-happy', 'egg-goodnight']);

function parseArgs(argv) {
    const args = { base: null, out: path.join(os.tmpdir(), 'urdiary-pose-identity') };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--base') args.base = argv[++i];
        else if (argv[i] === '--out') args.out = argv[++i];
    }
    return args;
}

function git(args) {
    return execFileSync('git', args, { cwd: DESKTOP_ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

function resolveBase(ref) {
    if (ref) return ref;
    try { return git(['merge-base', 'HEAD', 'main']).trim(); } catch (e) { return 'main'; }
}

/** 在 jsdom 裡跑某個版本的 mascot.js，回傳 [{name, html}]。 */
function collectRenders(mascotSource) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
    try {
        dom.window.eval(mascotSource);
        const M = dom.window.MascotModule;
        const doc = dom.window.document;
        const out = [];
        const add = (name, html) => out.push({ name, html });
        add('loading-96', M.loadingHtml(96));
        add('loading-26', M.loadingHtml(26));
        add('thinking', M.thinkingBubbleHtml());
        add('empty-diary', M.emptyHtml('diary', ''));
        add('empty-calendar', M.emptyHtml('calendar', ''));
        add('empty-generic', M.emptyHtml('generic', ''));
        add('welcome', M.welcomeHtml());
        add('checkin', M.checkinHtml());
        for (const kind of ['happy', 'goodnight']) {
            M.showSaveEgg(kind);
            const egg = doc.querySelector('.mascot-egg');
            add('egg-' + kind, egg.innerHTML);   // 只比 SVG 本體，外層 fixed 版位不比
            egg.remove();
        }
        for (const c of CATEGORIES) for (const size of [18, 24]) add(`cat-${c}-${size}`, M.categoryIcon(c, size));
        for (const id of STAMPS) for (const size of [14, 20, 40]) add(`stamp-${id}-${size}`, M.stampIcon(id, size));
        return out;
    } finally {
        dom.window.close();   // 清掉 showSaveEgg 排的 setTimeout，process 才會正常結束
    }
}

async function shootAll(browser, renders, css) {
    const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 480, height: 360 } });
    const page = await context.newPage();
    await page.setContent('<!doctype html><html><head><style>' +
        'html,body{margin:0;background:#fff}#cell{display:inline-block;padding:6px;background:#fff}' +
        '</style>' + (css ? `<style>${css}</style>` : '') + '</head><body></body></html>');
    const shots = new Map();
    for (const r of renders) {
        await page.evaluate((html) => {
            document.body.innerHTML = `<div id="cell">${html}</div>`;
            // 取消所有動畫：只看「靜態 CSS」的效果。不用「暫停在 t=0」——跑動畫的 SVG
            // 群組會被提升成合成層、邊緣反鋸齒跟著變，位元組永遠對不上（實測）。t=0
            // 的姿勢是否等於靜止姿勢，交給 capture-frames.js 的影格審查。
            document.getAnimations().forEach((a) => a.cancel());
        }, r.html);
        shots.set(r.name, await page.locator('#cell').screenshot());
    }
    await context.close();
    return shots;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const base = resolveBase(args.base);
    const baseJs = git(['show', `${base}:desktop/js/mascot.js`]);
    const baseCss = git(['show', `${base}:desktop/css/mascot.css`]);
    const headJs = fs.readFileSync(path.join(DESKTOP_ROOT, 'js', 'mascot.js'), 'utf8');
    const headCss = fs.readFileSync(path.join(DESKTOP_ROOT, 'css', 'mascot.css'), 'utf8');

    const baseRenders = collectRenders(baseJs);
    const headRenders = collectRenders(headJs);
    const headNames = new Set(headRenders.map((r) => r.name));
    const baseNames = new Set(baseRenders.map((r) => r.name));
    const missing = [...baseNames].filter((n) => !headNames.has(n));
    const fresh = [...headNames].filter((n) => !baseNames.has(n));
    const common = (list) => list.filter((r) => baseNames.has(r.name) && headNames.has(r.name));

    const browser = await chromium.launch();
    const failures = [];
    try {
        for (const mode of ['A', 'B']) {
            const pick = (list) => common(list).filter((r) => mode === 'A' || !EGG_NAMES.has(r.name));
            const b = await shootAll(browser, pick(baseRenders), mode === 'B' ? baseCss : null);
            const h = await shootAll(browser, pick(headRenders), mode === 'B' ? headCss : null);
            for (const [name, png] of b) {
                if (Buffer.compare(png, h.get(name)) !== 0) {
                    fs.mkdirSync(args.out, { recursive: true });
                    fs.writeFileSync(path.join(args.out, `${mode}-${name}.base.png`), png);
                    fs.writeFileSync(path.join(args.out, `${mode}-${name}.head.png`), h.get(name));
                    failures.push(`${mode}:${name}`);
                }
            }
            console.log(`mode ${mode}: compared ${b.size} renders`);
        }
    } finally {
        await browser.close();
    }

    console.log(`base = ${base}`);
    if (fresh.length) console.log(`new (not compared): ${fresh.join(', ')}`);
    if (missing.length) console.log(`MISSING in head: ${missing.join(', ')}`);
    if (failures.length) console.log(`PIXEL DIFF: ${failures.join(', ')}  →  ${args.out}`);
    if (missing.length || failures.length) {
        process.exitCode = 1;
        return;
    }
    console.log('pose identity: OK (all common renders pixel-identical)');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
```

Run: `cd /home/e604/Brian/URDiary/desktop && node tools/motion/pose-identity.js`
Expected（工作樹＝main，所有渲染都一樣）：

```
mode A: compared 96 renders
mode B: compared 94 renders
base = 7210700…（merge-base 的完整 hash）
pose identity: OK (all common renders pixel-identical)
```

（約 25 秒。jsdom 與 playwright 都在 `desktop/node_modules`；chromium 在 `~/.cache/ms-playwright`。）

- [ ] **Step 4: 改寫模板——檔頭註解一路到 `POSE_GOODNIGHT` 結束**

把 `desktop/js/mascot.js` 從第 1 行的 `/**` 起、到 `POSE_GOODNIGHT` 的最後一行（右腮紅 `cx="146"` 那個 ellipse，整個姿勢字串在這行收尾）止的整段（原第 1–88 行；`// -- 分類圖標` 那行起不動）換成：

```javascript
/**
 * MascotModule (v2.4 spec ③)：書本吉祥物視覺層唯一來源。
 * 所有 SVG 以模板字串內嵌（零外部請求）；動畫 class 在 css/mascot.css。
 * 彩蛋硬規則見 eggKindFor —— 只綁操作事件、情緒門檻、夜間版。
 *
 * Rig（v2.6 motion）：每個姿勢拆成具名群組，class 就是動畫掛點——
 *   mm-rig（整隻：呼吸／彈跳）> mm-body（書頁＋書皮）、mm-bookmark、
 *   mm-face（mm-eyes＋mm-mouth；mm-eyes 帶 data-mm-eyes=dot|happy|closed）、
 *   mm-blush、mm-arm-l／mm-arm-r（以「畫面」左右為準）、mm-prop（道具）、
 *   mm-zzz／mm-stars／mm-shadow／mm-sky／mm-hat（姿勢專屬）。
 * 兩條鐵律（tests/mascot_rig.test.js 釘住）：
 *   (1) 群組只包、不改繪製順序——靜止畫面與 rig 化之前逐像素相同
 *       （desktop/tools/motion/pose-identity.js 驗證）；
 *   (2) mm-* 群組本身不帶 transform 屬性——CSS transform 會整個蓋掉 SVG 的
 *       transform 屬性，姿勢自帶的旋轉／位移一律留在外層的無名 <g>。
 */
const MascotModule = (function () {
    const OUTLINE = '#4b2e1e';

    // rig 群組：attrs 只准放不影響靜止畫面的屬性（data-*、visibility、opacity 等）
    function part(name, inner, attrs) {
        return `<g class="mm-${name}"${attrs ? ' ' + attrs : ''}>${inner}</g>`;
    }
    function face(inner) { return `<g class="mm-face">${inner}</g>`; }

    // -- 基底（正面 Q 版）與姿態 --------------------------------------------
    const BASE_BOOK =
      part('body',
        `<path d="M54 90 q0 -18 18 -18 h56 q18 0 18 18 v4 h-92 z" fill="#f9f3e6" stroke="${OUTLINE}" stroke-width="9" stroke-linejoin="round"/>` +
        `<rect x="48" y="94" width="104" height="72" rx="16" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="9"/>`) +
      part('bookmark',
        `<path d="M64 94 h20 v36 l-10 -9 -10 9 z" fill="#5fd0a0" stroke="${OUTLINE}" stroke-width="6" stroke-linejoin="round"/>`);
    const FACE_SMILE = face(
      part('eyes', `<circle cx="103" cy="126" r="6.5" fill="#2b1a10"/><circle cx="133" cy="126" r="6.5" fill="#2b1a10"/>`, 'data-mm-eyes="dot"') +
      part('mouth', `<path d="M110 139 q8 7 16 0" stroke="#2b1a10" stroke-width="5" fill="none" stroke-linecap="round"/>`));
    const EYES_HAPPY = part('eyes', `<path d="M96 128 q7 -7 14 0 M126 128 q7 -7 14 0" stroke="#2b1a10" stroke-width="5" fill="none" stroke-linecap="round"/>`, 'data-mm-eyes="happy"');
    const MOUTH_HAPPY = part('mouth', `<path d="M106 136 q12 12 24 0" stroke="#2b1a10" stroke-width="5" fill="none" stroke-linecap="round"/>`);
    const FACE_HAPPY = face(EYES_HAPPY + MOUTH_HAPPY);
    const BLUSH = part('blush',
      `<ellipse cx="92" cy="140" rx="7" ry="4.5" fill="#f0a78f" opacity="0.55"/>` +
      `<ellipse cx="148" cy="140" rx="7" ry="4.5" fill="#f0a78f" opacity="0.55"/>`);

    function svg200(inner, size, extraClass, pose) {
        return `<svg viewBox="0 0 200 200" width="${size}" height="${size}" class="${extraClass || ''}" data-mm-pose="${pose}" aria-hidden="true"><g class="mm-rig">${inner}</g></svg>`;
    }
    function svg220(inner, size, pose) {
        return `<svg viewBox="0 0 220 200" width="${size}" height="${Math.round(size * 200 / 220)}" data-mm-pose="${pose}" aria-hidden="true"><g class="mm-rig">${inner}</g></svg>`;
    }

    const POSE_SLEEP =
      part('zzz',
        `<text x="150" y="52" font-size="22" fill="#a58a70" font-weight="bold" transform="rotate(12 150 52)">z</text>` +
        `<text x="168" y="38" font-size="16" fill="#bfa88d" font-weight="bold" transform="rotate(12 168 38)">z</text>`) +
      `<g transform="rotate(-6 100 130)">${BASE_BOOK}` +
        face(
          part('eyes', `<path d="M96 127 q7 5 14 0 M126 127 q7 5 14 0" stroke="#2b1a10" stroke-width="5" fill="none" stroke-linecap="round"/>`, 'data-mm-eyes="closed"') +
          part('mouth', `<circle cx="120" cy="141" r="3.5" fill="#2b1a10"/>`)) +
      `</g>` +
      part('prop',
        `<g transform="rotate(24 186 150)">` +
          `<rect x="180" y="118" width="11" height="52" rx="4" fill="#f2c94c" stroke="${OUTLINE}" stroke-width="5"/>` +
          `<path d="M181 170 l4.5 12 l4.5 -12 z" fill="#e8b04b" stroke="${OUTLINE}" stroke-width="4" stroke-linejoin="round"/>` +
        `</g>`);

    const POSE_CALENDAR =
      part('prop',
        `<g transform="rotate(8 178 92)">` +
          `<rect x="156" y="66" width="46" height="42" rx="7" fill="#ffffff" stroke="${OUTLINE}" stroke-width="6"/>` +
          `<rect x="156" y="66" width="46" height="12" rx="6" fill="#e8836f" stroke="${OUTLINE}" stroke-width="6"/>` +
          `<circle cx="168" cy="89" r="2.6" fill="#d9c9ae"/><circle cx="179" cy="89" r="2.6" fill="#d9c9ae"/><circle cx="190" cy="89" r="2.6" fill="#d9c9ae"/>` +
          `<circle cx="168" cy="99" r="2.6" fill="#d9c9ae"/><circle cx="179" cy="99" r="2.6" fill="#d9c9ae"/>` +
        `</g>`) +
      part('arm-r', `<path d="M152 120 q14 -6 20 -14" stroke="${OUTLINE}" stroke-width="8" fill="none" stroke-linecap="round"/>`) +
      BASE_BOOK +
      face(
        part('eyes', `<circle cx="106" cy="126" r="6.5" fill="#2b1a10"/><circle cx="136" cy="126" r="6.5" fill="#2b1a10"/>`, 'data-mm-eyes="dot"') +
        part('mouth', `<path d="M113 139 q8 7 16 0" stroke="#2b1a10" stroke-width="5" fill="none" stroke-linecap="round"/>`));

    const POSE_QUESTION =
      part('prop', `<text x="140" y="58" font-size="42" fill="#a58a70" font-weight="bold" font-family="sans-serif">?</text>`) +
      `<g transform="rotate(5 100 130)">${BASE_BOOK}` +
        face(
          part('eyes', `<circle cx="103" cy="126" r="6.5" fill="#2b1a10"/><circle cx="135" cy="124" r="6.5" fill="#2b1a10"/>`, 'data-mm-eyes="dot"') +
          part('mouth', `<path d="M112 141 h14" stroke="#2b1a10" stroke-width="5" stroke-linecap="round"/>`)) +
      `</g>`;

    const POSE_WAVE =
      part('arm-r',
        `<path d="M154 116 q16 -10 14 -26" stroke="${OUTLINE}" stroke-width="8" fill="none" stroke-linecap="round"/>` +
        `<circle cx="169" cy="86" r="7" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="5"/>`) +
      BASE_BOOK + FACE_HAPPY + BLUSH;

    const POSE_JUMP =
      part('shadow', `<ellipse cx="100" cy="176" rx="34" ry="7" fill="#d8c5ae"/>`) +
      part('stars',
        `<path d="M42 70 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 z" fill="#f5c542" stroke="${OUTLINE}" stroke-width="3"/>` +
        `<path d="M172 56 l3.5 8 8 3.5 -8 3.5 -3.5 8 -3.5 -8 -8 -3.5 8 -3.5 z" fill="#f5c542" stroke="${OUTLINE}" stroke-width="3"/>` +
        `<path d="M186 118 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5 z" fill="#f5c542" stroke="${OUTLINE}" stroke-width="3"/>`) +
      `<g transform="translate(0 -18)">${BASE_BOOK}${FACE_HAPPY}</g>`;

    const POSE_TEA =
      part('prop',
        `<path d="M174 84 q4 -6 0 -12 q-4 -6 0 -12 M186 88 q4 -6 0 -12" stroke="#c8b49a" stroke-width="4" fill="none" stroke-linecap="round"/>` +
        `<rect x="164" y="96" width="30" height="24" rx="7" fill="#ffffff" stroke="${OUTLINE}" stroke-width="6"/>` +
        `<path d="M194 102 q10 2 0 12" stroke="${OUTLINE}" stroke-width="5" fill="none"/>`) +
      part('arm-r', `<path d="M152 122 q10 -8 18 -10" stroke="${OUTLINE}" stroke-width="8" fill="none" stroke-linecap="round"/>`) +
      BASE_BOOK + FACE_SMILE;

    const POSE_GOODNIGHT =
      part('sky',
        `<path d="M190 40 a17 17 0 1 0 9 32 a13 13 0 1 1 -9 -32 z" fill="#f5c542" stroke="${OUTLINE}" stroke-width="3"/>` +
        `<circle cx="46" cy="52" r="2.5" fill="#f9f3e6"/><circle cx="176" cy="96" r="2" fill="#f9f3e6"/><circle cx="30" cy="96" r="2" fill="#f9f3e6"/>`) +
      BASE_BOOK +
      part('hat',
        `<path d="M58 74 Q78 30 128 38 Q158 44 164 66 L166 74 Q150 80 120 79 Q86 78 58 74 z" fill="#7f96c9" stroke="${OUTLINE}" stroke-width="8" stroke-linejoin="round"/>` +
        `<path d="M162 66 q14 6 8 20 q-3 8 -12 8" fill="#7f96c9" stroke="${OUTLINE}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>` +
        `<circle cx="158" cy="98" r="10" fill="#f9f3e6" stroke="${OUTLINE}" stroke-width="6"/>` +
        `<path d="M52 80 q0 -12 12 -12 h72 q12 0 12 12 v2 q-24 6 -48 6 q-24 0 -48 -6 z" fill="#f3ecdd" stroke="${OUTLINE}" stroke-width="7" stroke-linejoin="round"/>`) +
      face(
        part('eyes', `<path d="M96 128 q7 5 14 0 M126 128 q7 5 14 0" stroke="#2b1a10" stroke-width="5" fill="none" stroke-linecap="round"/>`, 'data-mm-eyes="closed"') +
        part('mouth', `<path d="M112 141 q7 6 14 0" stroke="#2b1a10" stroke-width="5" fill="none" stroke-linecap="round"/>`)) +
      part('blush',
        `<ellipse cx="92" cy="140" rx="7" ry="4.5" fill="#f0a78f" opacity="0.5"/>` +
        `<ellipse cx="146" cy="140" rx="7" ry="4.5" fill="#f0a78f" opacity="0.5"/>`);
```

每個姿勢的圖元、屬性、先後順序都與原檔逐字相同，只多了外面的群組；`BASE_BOOK`／`FACE_SMILE`／`FACE_HAPPY`／`BLUSH` 名稱不變（`FACE_HAPPY` 拆成 `EYES_HAPPY`＋`MOUTH_HAPPY` 兩個零件再組起來，Task 6 會重用零件）。

- [ ] **Step 5: `POSES` 表與對外 API 帶姿勢名**

在 `// -- 對外 API ----…` 那行之前插入：

```javascript
    // 姿勢名 → 模板（data-mm-pose 的值；emptyHtml／showSaveEgg 由名稱取模板）
    const POSES = { sleep: POSE_SLEEP, calendar: POSE_CALENDAR, question: POSE_QUESTION,
                    wave: POSE_WAVE, jump: POSE_JUMP, tea: POSE_TEA, goodnight: POSE_GOODNIGHT };
```

`loadingHtml`、`thinkingBubbleHtml`、`emptyHtml`、`welcomeHtml`、`checkinHtml` 五個函式整段換成：

```javascript
    function loadingHtml(size) {
        return `<span class="mascot-sway">${svg200(BASE_BOOK + FACE_SMILE, size || 96, '', 'smile')}</span>`;
    }

    function thinkingBubbleHtml() {
        return `<span class="mascot-sway">${svg200(BASE_BOOK + FACE_SMILE, 26, '', 'smile')}</span>` +
            `<span class="mascot-dots"><span>.</span><span>.</span><span>.</span></span>`;
    }

    function emptyHtml(kind, caption) {
        const pose = kind === 'diary' ? 'sleep' : kind === 'calendar' ? 'calendar' : 'question';
        return `<div class="mascot-empty">${svg220(POSES[pose], 132, pose)}` +
            `<p class="mascot-empty-caption">${escapeText(caption)}</p></div>`;
    }

    function welcomeHtml() { return `<div class="mascot-welcome">${svg220(POSE_WAVE, 110, 'wave')}</div>`; }
    function checkinHtml() { return `<span class="mascot-checkin">${svg220(POSE_TEA, 44, 'tea')}</span>`; }
```

`showSaveEgg` 整段換成：

```javascript
    function showSaveEgg(kind) {
        if (kind === 'quiet') return; // 沉重的日記：安靜，不慶祝
        const pose = kind === 'goodnight' ? 'goodnight' : 'jump';
        const wrap = document.createElement('div');
        wrap.className = 'mascot-egg' + (kind === 'goodnight' ? ' mascot-egg-night' : '');
        wrap.innerHTML = svg220(POSES[pose], 150, pose);
        document.body.appendChild(wrap);
        setTimeout(() => { wrap.classList.add('fade'); }, 1200);
        setTimeout(() => { wrap.remove(); }, 1800);
    }
```

- [ ] **Step 6: 跑測試確認通過（含既有吉祥物測試回歸）**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/mascot_rig.test.js tests/mascot.test.js tests/mascot_chat.test.js tests/mascot_empty.test.js tests/mascot_stamps.test.js`
Expected: 全 passed（rig 46 支全綠；既有斷言如 `>z<`、`#e8836f`、`>?<`、`width="44"` 照樣成立）。

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run`
Expected: `510 passed (510)`。

- [ ] **Step 7: 像素同一性＋工具自我檢查**

Run: `cd /home/e604/Brian/URDiary/desktop && node tools/motion/pose-identity.js`
Expected: `pose identity: OK (all common renders pixel-identical)`。

工具自我檢查（證明它真的抓得到半個單位的位移，做完一定要還原）：把 `POSE_QUESTION` 右眼的 `cx="135"` 暫改成 `cx="135.5"` 再跑一次 → Expected: `PIXEL DIFF: A:empty-generic, B:empty-generic` 且 exit code 1；改回 `cx="135"`、`git diff desktop/js/mascot.js` 確認只剩本任務的改動。

- [ ] **Step 8: Commit**

```bash
cd /home/e604/Brian/URDiary
git add desktop/js/mascot.js desktop/tests/mascot_rig.test.js desktop/tools/motion/pose-identity.js
git commit -m "feat(吉祥物動畫): 吉祥物 rig 化——具名部件群組＋結構測試＋像素同一性工具

每個姿勢拆成 mm-rig／body／bookmark／face(eyes,mouth)／blush／arm-r 等群組，
姿勢自帶的 transform 留在外層無名 <g>；靜止畫面與 main 逐像素相同
（tools/motion/pose-identity.js 以 jsdom＋chromium 比對 96 筆渲染）。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 影格審查 harness＋擷取腳本（contact sheet）

**目標**：Fable 每個視覺任務後要看「決定性的」影格。做法：一個不進 app shell 的開發頁（`file://` 直接開）列出場景；Playwright 腳本先 `page.clock.install()` 凍住計時器，setup 之後暫停 `document.getAnimations()` 全部動畫（含 CSS transition 與 View Transition 偽元素動畫——原型實測都在清單裡），逐一 seek 到指定毫秒截圖，拼成 contact sheet，輸出到 git 之外。`--reduced` 模式模擬「減少動態」並**斷言**每個場景所有影格位元組相同（＝靜態）。這個任務只放既有動畫（搖擺、思考點點、兩種存日記彩蛋）當場景——先證明管線本身可靠。

**Files:**
- Create: `desktop/tools/motion/harness.html`、`desktop/tools/motion/harness.js`、`desktop/tools/motion/capture-frames.js`
- Test: `desktop/tests/motion_tools.test.js`

**Interfaces:**
- Consumes: `MascotModule`（Task 2）。
- Produces:
  - `window.MotionHarness = { SCENES, list(), setup(name) }`；場景形狀 `{ viewport: [寬, 高], frames: [毫秒…遞增], setup(stage) → void | Promise }`，`setup(name)` 回 `{viewport, frames}`（場景回 Promise 時回 Promise）。**之後每個視覺任務都往 `SCENES` 加自己的場景。**
  - CLI：`cd desktop && node tools/motion/capture-frames.js [場景…] [--reduced] [--out <dir>]` → `<out>/contact-sheet.png`（`--reduced` 時 `contact-sheet-reduced.png`）＋`<out>/frames/<場景>@<ms>.png`；預設 `<out>`＝`<os tmp>/urdiary-motion-frames`。`--reduced` 任一場景影格不同 → 印 `REDUCED-MOTION VIOLATION` 並 exit 1。

- [ ] **Step 1: 寫失敗測試**

`desktop/tests/motion_tools.test.js`：

```javascript
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadScript } from './helpers/load.js';

/**
 * v2.6 motion Task 3：影格審查工具（desktop/tools/motion/）的兩個保證——
 *   (1) 不進 app shell：index.html 不引用、sw.js 的 SHELL_ASSETS 不列。
 *   (2) harness 的每個場景在 jsdom 都能同步 setup（壞掉的場景在 vitest 就抓到，
 *       不必等 Fable 跑 Playwright 才發現）。
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(DESKTOP, rel), 'utf8');

describe('motion 工具不進 app shell', () => {
    it('index.html 沒有任何 tools/ 引用', () => {
        expect(read('index.html')).not.toMatch(/tools\//);
    });

    it('sw.js 的 SHELL_ASSETS 沒有 /tools/ 路徑', () => {
        const sw = read('sw.js');
        const block = sw.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/)[1];
        expect(block).not.toMatch(/\/tools\//);
    });

    it('harness.html 直接引用 App 的 js/css（../../），不複製第二份吉祥物來源', () => {
        const html = read('tools/motion/harness.html');
        expect(html).toContain('src="../../js/mascot.js"');
        expect(html).toContain('href="../../css/mascot.css"');
        expect(fs.existsSync(path.join(DESKTOP, 'tools/motion/mascot.js'))).toBe(false);
    });
});

describe('harness 場景在 jsdom 可同步 setup', () => {
    beforeAll(() => {
        loadScript('js/mascot.js');
        loadScript('tools/motion/harness.js');
    });
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '<div id="stage"></div>';
    });
    afterEach(() => { vi.useRealTimers(); });

    it('場景表非空，每個場景都有 viewport 與遞增的 frames', () => {
        const names = window.MotionHarness.list();
        expect(names.length).toBeGreaterThanOrEqual(4);
        for (const name of names) {
            const s = window.MotionHarness.SCENES[name];
            expect(s.viewport).toHaveLength(2);
            expect(s.frames.length).toBeGreaterThanOrEqual(2);
            expect([...s.frames].sort((a, b) => a - b)).toEqual(s.frames);
        }
    });

    it.each(['sway', 'thinking', 'egg-happy', 'egg-night'])('%s：setup 不拋錯且畫面上有吉祥物 SVG', (name) => {
        window.MotionHarness.setup(name);
        expect(document.querySelector('#stage svg, .mascot-egg svg')).not.toBeNull();
    });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/motion_tools.test.js`
Expected: FAIL——`ENOENT … tools/motion/harness.html`、`harness.js` 載不到（原型：`1 failed | 2 passed | 5 skipped`；兩條「不進 shell」的守衛本來就成立）。

- [ ] **Step 3: 開發頁 `desktop/tools/motion/harness.html`**

```html
<!doctype html>
<html lang="zh-TW" data-theme="light">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>URDiary motion harness</title>
    <!--
      影格審查用的開發頁（v2.6 motion Task 3）。不進 app shell：index.html 不引用、
      sw.js 的 SHELL_ASSETS 不列、後端只掛 /js /css /assets，tools/ 連 HTTP 都拿不到。
      直接用 file:// 開：?scene=<名稱> 即時播放該場景；不帶參數列出全部場景。
      自動擷取影格：node tools/motion/capture-frames.js（見該檔檔頭）。
    -->
    <link rel="stylesheet" href="../../css/animations.css">
    <link rel="stylesheet" href="../../css/mascot.css">
    <style>
        html, body { margin: 0; background: #f5f5f5; font-family: sans-serif; }
        #stage { position: relative; width: 100vw; height: 100vh; display: flex;
                 align-items: center; justify-content: center; overflow: hidden; background: #fff; }
        #index { padding: 16px; }
        #index a { display: block; margin: 4px 0; }
        /* 版位替身：只為了讓場景長得像 App 裡的上下文，不引入整份 App CSS */
        .h-card { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px; }
        .h-cell { position: relative; width: 72px; height: 64px; border: 1px solid #e0e0e0; border-radius: 6px; }
        .h-cell .cell-stamp { position: absolute; top: 2px; right: 3px; line-height: 0; }
    </style>
    <script src="../../js/mascot.js"></script>
    <script src="harness.js"></script>
</head>
<body>
    <div id="stage"></div>
</body>
</html>
```

- [ ] **Step 4: 場景表 `desktop/tools/motion/harness.js`**

```javascript
/**
 * 影格審查場景表（v2.6 motion Task 3 起，每個視覺任務往 SCENES 加自己的場景）。
 *
 * 場景 = { viewport: [寬, 高], frames: [毫秒...], setup(stage) }：
 *   setup 只能「同步」把畫面與動畫觸發好——capture-frames.js 會先裝 Playwright 的
 *   假時鐘（page.clock.install），setTimeout／requestAnimationFrame 都不會自己跑，
 *   接著暫停 document.getAnimations() 全部動畫、逐一 seek 到 frames 的時間點截圖。
 *   所以依賴計時器的收尾（移除 class、淡出）在擷取期間不會發生，影格才穩定。
 * frames 的時間點＝審查時要看的關鍵姿勢（起點、最大位移、回彈、收尾）。
 */
(function () {
    'use strict';

    function mount(stage, html) {
        stage.innerHTML = html;
        return stage.firstElementChild;
    }

    const SCENES = {
        // --- 既有動畫（v2.4）：證明擷取管線本身可用 ---------------------------
        'sway': {
            viewport: [220, 200], frames: [0, 450, 900, 1350],
            setup: (stage) => mount(stage, MascotModule.loadingHtml(96)),
        },
        'thinking': {
            viewport: [200, 120], frames: [0, 300, 600, 900],
            setup: (stage) => mount(stage, `<div class="h-card">${MascotModule.thinkingBubbleHtml()}</div>`),
        },
        'egg-happy': {
            viewport: [320, 280], frames: [0, 150, 300, 450],
            setup: () => MascotModule.showSaveEgg('happy'),
        },
        'egg-night': {
            viewport: [320, 280], frames: [0, 300],
            setup: () => MascotModule.showSaveEgg('goodnight'),
        },
    };

    function list() { return Object.keys(SCENES); }

    // setup 可以回傳 Promise（例如 View Transition 的 ready）：等它好了才回 meta，
    // capture-frames.js 的 page.evaluate 會一起等
    function setup(name) {
        const scene = SCENES[name];
        if (!scene) throw new Error(`unknown scene: ${name}`);
        document.querySelectorAll('.mascot-egg').forEach((el) => el.remove());
        const stage = document.getElementById('stage');
        stage.innerHTML = '';
        const meta = { viewport: scene.viewport, frames: scene.frames };
        const pending = scene.setup(stage);
        return pending && typeof pending.then === 'function' ? pending.then(() => meta) : meta;
    }

    window.MotionHarness = { SCENES: SCENES, list: list, setup: setup };

    // 手動檢視：file://.../harness.html?scene=<名稱>
    document.addEventListener('DOMContentLoaded', function () {
        const name = new URLSearchParams(location.search).get('scene');
        if (name) { setup(name); return; }
        if (navigator.webdriver) return;   // 自動擷取時不畫索引
        const stage = document.getElementById('stage');
        stage.id = 'index';
        stage.innerHTML = list().map((n) => `<a href="?scene=${encodeURIComponent(n)}">${n}</a>`).join('');
    });
})();
```

- [ ] **Step 5: 擷取腳本 `desktop/tools/motion/capture-frames.js`**

```javascript
#!/usr/bin/env node
/**
 * 影格擷取＋contact sheet（v2.6 motion Task 3；Fable 在每個視覺任務後用它審影格）。
 *
 * 用法（cwd = desktop/）：
 *   node tools/motion/capture-frames.js                  # 全部場景
 *   node tools/motion/capture-frames.js blink react-welcome   # 指定場景
 *   node tools/motion/capture-frames.js --reduced        # 模擬 prefers-reduced-motion: reduce，
 *                                                        # 並「斷言」每個場景各影格完全相同（=靜態）
 *   node tools/motion/capture-frames.js --out <dir>      # 預設 <os tmp>/urdiary-motion-frames
 *
 * 輸出：<out>/contact-sheet.png（每列一個場景、每欄一個時間點）＋ <out>/frames/<場景>@<ms>.png。
 * 輸出一律在 git 之外（預設 os.tmpdir()）。
 *
 * 決定性：先 page.clock.install() 讓 setTimeout／rAF 停住（場景的收尾計時器不會在擷取中途
 * 移除 class），setup 之後暫停 document.getAnimations() 的全部動畫（含 CSS transition、
 * View Transition 偽元素動畫），每個影格把全部動畫 seek 到同一個 currentTime 再截圖。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const HARNESS = pathToFileURL(path.join(__dirname, 'harness.html')).href;

function parseArgs(argv) {
    const args = { scenes: [], reduced: false, out: path.join(os.tmpdir(), 'urdiary-motion-frames') };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--reduced') args.reduced = true;
        else if (argv[i] === '--out') args.out = argv[++i];
        else args.scenes.push(argv[i]);
    }
    return args;
}

async function captureScene(browser, name, reduced) {
    const context = await browser.newContext({ deviceScaleFactor: 2, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.clock.install({ time: new Date('2026-10-01T10:00:00') });
    await page.goto(HARNESS);
    // 先定視窗大小再 setup：場景可能依 innerWidth 放游標，而 View Transition 遇到視窗改尺寸會被跳過
    const viewport = await page.evaluate((n) => window.MotionHarness.SCENES[n].viewport, name);
    await page.setViewportSize({ width: viewport[0], height: viewport[1] });
    const meta = await page.evaluate((n) => window.MotionHarness.setup(n), name);
    await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
    const shots = [];
    for (const t of meta.frames) {
        await page.evaluate((ms) => document.getAnimations().forEach((a) => { a.currentTime = ms; }), t);
        shots.push({ t, png: await page.screenshot() });
    }
    await context.close();
    if (errors.length) throw new Error(`scene ${name}: page error ${errors.join(' | ')}`);
    return shots;
}

async function contactSheet(browser, rows, outFile) {
    const cells = rows.map(({ name, shots }) => `<tr><th>${name}</th>${shots.map(({ t, png }) =>
        `<td><img src="data:image/png;base64,${png.toString('base64')}"><div>${t} ms</div></td>`).join('')}</tr>`).join('');
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1600, height: 900 } });
    await page.setContent(`<!doctype html><style>
        body{margin:12px;font:13px sans-serif;background:#fafafa}
        th{text-align:right;padding:6px 10px;vertical-align:middle;white-space:nowrap}
        td{padding:6px;text-align:center;vertical-align:top}
        img{max-width:260px;max-height:260px;border:1px solid #ddd;background:#fff;display:block}
    </style><table>${cells}</table>`);
    await page.screenshot({ path: outFile, fullPage: true });
    await page.close();
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const browser = await chromium.launch();
    try {
        const probe = await browser.newPage();
        await probe.goto(HARNESS);
        const all = await probe.evaluate(() => window.MotionHarness.list());
        await probe.close();
        const names = args.scenes.length ? args.scenes : all;
        const unknown = names.filter((n) => !all.includes(n));
        if (unknown.length) throw new Error(`unknown scene(s): ${unknown.join(', ')}；可用：${all.join(', ')}`);

        fs.mkdirSync(path.join(args.out, 'frames'), { recursive: true });
        const rows = [];
        const moving = [];
        for (const name of names) {
            const shots = await captureScene(browser, name, args.reduced);
            shots.forEach(({ t, png }) => fs.writeFileSync(path.join(args.out, 'frames', `${name}@${t}.png`), png));
            if (shots.some(({ png }) => Buffer.compare(png, shots[0].png) !== 0)) moving.push(name);
            rows.push({ name, shots });
        }
        const sheet = path.join(args.out, args.reduced ? 'contact-sheet-reduced.png' : 'contact-sheet.png');
        await contactSheet(browser, rows, sheet);
        console.log(`contact sheet: ${sheet}`);
        console.log(`frames:        ${path.join(args.out, 'frames')}`);
        if (args.reduced) {
            if (moving.length) {
                console.log(`REDUCED-MOTION VIOLATION (frames differ): ${moving.join(', ')}`);
                process.exitCode = 1;
            } else {
                console.log(`reduced motion: all ${names.length} scenes static`);
            }
        } else {
            const still = names.filter((n) => !moving.includes(n));
            if (still.length) console.log(`note: no motion captured in: ${still.join(', ')}`);
        }
    } finally {
        await browser.close();
    }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
```

- [ ] **Step 6: 跑測試確認通過**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/motion_tools.test.js`
Expected: `8 passed (8)`。

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run`
Expected: `518 passed (518)`。

- [ ] **Step 7: 實際擷取一次（管線自我檢查）**

Run: `cd /home/e604/Brian/URDiary/desktop && node tools/motion/capture-frames.js && node tools/motion/capture-frames.js --reduced`
Expected（各約 1–2 秒；路徑以腳本印出的為準——`os.tmpdir()` 在這台是 `/tmp`，之後各任務寫的 `/tmp/urdiary-motion-frames/…` 都是指這裡）：

```
contact sheet: /tmp/urdiary-motion-frames/contact-sheet.png
frames:        /tmp/urdiary-motion-frames/frames
note: no motion captured in: egg-night
contact sheet: /tmp/urdiary-motion-frames/contact-sheet-reduced.png
frames:        /tmp/urdiary-motion-frames/frames
reduced motion: all 4 scenes static
```

（`egg-night` 本來就是靜態彩蛋，所以沒有動態是對的。）

- [ ] **Step 8: 影格審查（Fable）**

看 `contact-sheet.png`：`sway` 0/450/900/1350 ms 依序 −5°→0→+5°→0、支點在腳底；`thinking` 三個點依序亮；`egg-happy` 0 ms 在下方縮小、150–450 ms 彈上來；`egg-night` 深色底晚安版。四列都該跟今天 App 裡看到的一模一樣——這一步只驗證擷取管線，不審美。

- [ ] **Step 9: Commit**

```bash
cd /home/e604/Brian/URDiary
git add desktop/tools/motion/harness.html desktop/tools/motion/harness.js desktop/tools/motion/capture-frames.js desktop/tests/motion_tools.test.js
git commit -m "feat(吉祥物動畫): 影格審查 harness 與 contact sheet 擷取腳本

tools/motion/ 開發頁（不進 app shell）＋Playwright 擷取：假時鐘凍住計時器、
暫停並 seek document.getAnimations()；--reduced 斷言每個場景都是靜態。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 行為核心 `mascot_motion.js`＋接線＋全域 reduced-motion CSS

**目標**：建立行為層骨架——reduced-motion 監看（即時切換）、分頁隱藏暫停、**全頁唯一**的待機排程器（依賴注入，純函式可測）、限流器；接進 `index.html`／`SHELL_ASSETS`／`main.js`。同時把 `animations.css`、`chat.css` 補上 reduce 版，並用靜態 CSS 測試鎖住「之後每個新 `animation` 都要有 reduce 版」。這個任務之後畫面上還看不到新動作（模板還沒標 `data-mm-idle`，Task 5 才標）。

**Files:**
- Create: `desktop/js/mascot_motion.js`
- Modify: `desktop/index.html`（script 標籤）、`desktop/sw.js`（`SHELL_ASSETS`）、`desktop/js/main.js`（`DOMContentLoaded` 裡、`ErrorLogger` 之後）、`desktop/css/animations.css`（檔尾）、`desktop/css/chat.css`（檔尾）、`desktop/tools/motion/harness.html`、`desktop/tools/motion/harness.js`、`desktop/tests/motion_tools.test.js`（一行）
- Test: `desktop/tests/mascot_motion.test.js`、`desktop/tests/reduced_motion_css.test.js`

**Interfaces:**
- Consumes: Task 2 的 rig（`svg[data-mm-idle] .mm-face:not(.mm-face-alt) .mm-eyes[data-mm-eyes="dot"]` 這個選擇器是排程器的「誰要眨眼」）。
- Produces:
  - `window.MascotMotion = { init(), isReducedMotion() → boolean, blink(svg, delayMs), _test: { nextBlinkDelay(rand) → int, createRateLimiter(intervalMs) → { tryAcquire(key, now) → boolean }, createIdleScheduler(deps) → { start(), stop(), isRunning() }, collectIdle() → SVGElement[], schedulerRunning() → boolean, teardown() } }`
  - `createIdleScheduler` 的 `deps`：`{ setTimer(fn, ms) → id, clearTimer(id), random() → [0,1), collect() → Element[], blink(el, delayMs), isHidden() → boolean, isReduced() → boolean }`
  - DOM 約定：眨眼＝在 `<svg>` 上重播 class `mm-blink`＋設 CSS 變數 `--mm-blink-delay`；分頁隱藏時 `<html>` 帶 `mm-paused`；reduce 生效時拔掉 `MOTION_CLASSES` 裡的一次性 class（Task 6／7 往這個陣列加）。
  - `init()` 冪等；`_test.teardown()` 拆掉監聽器與計時器（測試專用）。

- [ ] **Step 1: 寫失敗測試（行為核心）**

`desktop/tests/mascot_motion.test.js`：

```javascript
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadScript } from './helpers/load.js';

/**
 * v2.6 motion Task 4：MascotMotion 核心——純函式（眨眼間隔、限流、排程器）＋
 * DOM 層（reduced-motion 監看、分頁隱藏暫停、只對「在畫面上」的待機吉祥物動作）。
 * jsdom 沒有 matchMedia／checkVisibility，測試各自補上可控的替身。
 */

/** 可控的 prefers-reduced-motion 替身：set(v) 會像瀏覽器一樣發 change。 */
function stubReducedMotion(initial) {
    const listeners = [];
    const mql = {
        matches: initial,
        media: '(prefers-reduced-motion: reduce)',
        addEventListener: (type, fn) => listeners.push(fn),
        removeEventListener: (type, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    };
    window.matchMedia = vi.fn(() => mql);
    return { set(v) { mql.matches = v; listeners.slice().forEach((fn) => fn({ matches: v })); } };
}

let hiddenFlag = false;
function setHidden(v) {
    hiddenFlag = v;
    document.dispatchEvent(new Event('visibilitychange'));
}

/** 一隻「待機、睜眼」的吉祥物替身（結構同 mascot.js rig：svg[data-mm-idle] > .mm-face > .mm-eyes[data-mm-eyes]）。 */
function idleSvg(eyes = 'dot') {
    const host = document.createElement('div');
    host.innerHTML = `<svg data-mm-idle viewBox="0 0 220 200"><g class="mm-rig"><g class="mm-face">` +
        `<g class="mm-eyes" data-mm-eyes="${eyes}"><circle cx="1" cy="1" r="1"/></g></g></g></svg>`;
    document.body.appendChild(host);
    return host.firstElementChild;
}

describe('純函式', () => {
    beforeEach(() => { loadScript('js/mascot_motion.js'); });

    it('nextBlinkDelay：rand 0→3000、0.5→5000、趨近 1→<7000，越界夾住', () => {
        const f = MascotMotion._test.nextBlinkDelay;
        expect(f(0)).toBe(3000);
        expect(f(0.5)).toBe(5000);
        expect(f(0.9999)).toBeLessThan(7000);
        expect(f(0.9999)).toBeGreaterThanOrEqual(6999);
        expect(f(-3)).toBe(3000);
        expect(f(5)).toBe(7000);
        expect(f(NaN)).toBe(3000);
    });

    it('createRateLimiter：同一 key 間隔內擋下、過了間隔放行；不同 key 互不影響', () => {
        const limiter = MascotMotion._test.createRateLimiter(1200);
        const a = {}; const b = {};
        expect(limiter.tryAcquire(a, 0)).toBe(true);
        expect(limiter.tryAcquire(a, 1199)).toBe(false);
        expect(limiter.tryAcquire(b, 500)).toBe(true);
        expect(limiter.tryAcquire(a, 1200)).toBe(true);
        expect(limiter.tryAcquire(a, 1300)).toBe(false);   // 放行後重新起算
    });
});

describe('createIdleScheduler（注入依賴＋假計時器）', () => {
    let blink, collect, hidden, reduced, rand, sched;
    beforeEach(() => {
        vi.useFakeTimers();
        loadScript('js/mascot_motion.js');
        blink = vi.fn();
        collect = vi.fn(() => ['A', 'B']);
        hidden = false; reduced = false; rand = 0;
        sched = MascotMotion._test.createIdleScheduler({
            setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (id) => clearTimeout(id),
            random: () => rand, collect, blink,
            isHidden: () => hidden, isReduced: () => reduced,
        });
    });
    afterEach(() => { vi.useRealTimers(); });

    it('3 秒前不眨、到點對每隻各眨一次（錯開 0–400ms），並排下一輪', () => {
        sched.start();
        vi.advanceTimersByTime(2999);
        expect(blink).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(blink).toHaveBeenCalledTimes(2);
        expect(blink.mock.calls.map((c) => c[0])).toEqual(['A', 'B']);
        blink.mock.calls.forEach((c) => { expect(c[1]).toBeGreaterThanOrEqual(0); expect(c[1]).toBeLessThanOrEqual(400); });
        expect(sched.isRunning()).toBe(true);
        vi.advanceTimersByTime(3000);
        expect(blink).toHaveBeenCalledTimes(4);
    });

    it('rand 趨近 1：間隔拉到將近 7 秒', () => {
        rand = 0.9999;
        sched.start();
        vi.advanceTimersByTime(6990);
        expect(blink).not.toHaveBeenCalled();
        vi.advanceTimersByTime(10);
        expect(blink).toHaveBeenCalled();
    });

    it('全頁只有一個計時器：重複 start 不會疊出第二個', () => {
        sched.start(); sched.start(); sched.start();
        vi.advanceTimersByTime(3000);
        expect(blink).toHaveBeenCalledTimes(2);   // 還是一輪（兩隻各一次），不是三輪
    });

    it('沒有吉祥物在畫面上：不眨但照常排下一輪（新出現的吉祥物下一輪就接得上）', () => {
        collect.mockReturnValue([]);
        sched.start();
        vi.advanceTimersByTime(3000);
        expect(blink).not.toHaveBeenCalled();
        expect(sched.isRunning()).toBe(true);
    });

    it('stop 之後不再眨', () => {
        sched.start();
        sched.stop();
        vi.advanceTimersByTime(20000);
        expect(blink).not.toHaveBeenCalled();
        expect(sched.isRunning()).toBe(false);
    });

    it('分頁隱藏或 reduced-motion：start 不排計時器', () => {
        hidden = true;
        sched.start();
        expect(sched.isRunning()).toBe(false);
        hidden = false; reduced = true;
        sched.start();
        expect(sched.isRunning()).toBe(false);
        vi.advanceTimersByTime(20000);
        expect(blink).not.toHaveBeenCalled();
    });
});

describe('DOM 層：init／reduced-motion／分頁可見度', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(0);   // 固定 3000ms 一輪、錯開 0ms
        hiddenFlag = false;
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => hiddenFlag });
        // jsdom 沒有 checkVisibility：預設「在畫面上」，個別測試再覆寫
        Element.prototype.checkVisibility = function () { return true; };
        document.body.innerHTML = '';
        loadScript('js/mascot_motion.js');
    });
    afterEach(() => {
        MascotMotion._test.teardown();
        delete window.matchMedia;
        delete Element.prototype.checkVisibility;
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('init 冪等：呼叫兩次仍只有一個排程器，一輪只眨一次', () => {
        const svg = idleSvg();
        const spy = vi.spyOn(svg.classList, 'add');
        MascotMotion.init();
        MascotMotion.init();
        vi.advanceTimersByTime(3000);
        expect(spy.mock.calls.filter((c) => c[0] === 'mm-blink')).toHaveLength(1);
        expect(svg.classList.contains('mm-blink')).toBe(true);
        expect(svg.style.getPropertyValue('--mm-blink-delay')).toBe('0ms');
    });

    it('只眨「在畫面上、睜眼」的待機吉祥物：隱藏的、閉眼的、已移除的都不動', () => {
        const shown = idleSvg('dot');
        const closed = idleSvg('closed');
        const invisible = idleSvg('dot');
        invisible.checkVisibility = () => false;
        const detached = idleSvg('dot');
        detached.parentNode.remove();
        MascotMotion.init();
        vi.advanceTimersByTime(3000);
        expect(shown.classList.contains('mm-blink')).toBe(true);
        expect(closed.classList.contains('mm-blink')).toBe(false);
        expect(invisible.classList.contains('mm-blink')).toBe(false);
        expect(detached.classList.contains('mm-blink')).toBe(false);
    });

    it('沒有 matchMedia 的環境：isReducedMotion() 為 false、照常運作不拋錯', () => {
        delete window.matchMedia;
        expect(() => MascotMotion.init()).not.toThrow();
        expect(MascotMotion.isReducedMotion()).toBe(false);
        expect(MascotMotion._test.schedulerRunning()).toBe(true);
    });

    it('一開始就 reduced：排程器不啟動、blink() 也不加 class', () => {
        stubReducedMotion(true);
        const svg = idleSvg();
        MascotMotion.init();
        expect(MascotMotion.isReducedMotion()).toBe(true);
        expect(MascotMotion._test.schedulerRunning()).toBe(false);
        MascotMotion.blink(svg, 0);
        vi.advanceTimersByTime(20000);
        expect(svg.classList.contains('mm-blink')).toBe(false);
    });

    it('偏好即時切換：開 reduce → 停排程並拔掉 mm-blink；關掉 → 恢復', () => {
        const media = stubReducedMotion(false);
        const svg = idleSvg();
        MascotMotion.init();
        vi.advanceTimersByTime(3000);
        expect(svg.classList.contains('mm-blink')).toBe(true);
        media.set(true);
        expect(MascotMotion.isReducedMotion()).toBe(true);
        expect(MascotMotion._test.schedulerRunning()).toBe(false);
        expect(svg.classList.contains('mm-blink')).toBe(false);
        media.set(false);
        expect(MascotMotion._test.schedulerRunning()).toBe(true);
    });

    it('分頁隱藏：停排程、html 加 mm-paused；回來：恢復、拔 mm-paused', () => {
        const svg = idleSvg();
        MascotMotion.init();
        setHidden(true);
        expect(MascotMotion._test.schedulerRunning()).toBe(false);
        expect(document.documentElement.classList.contains('mm-paused')).toBe(true);
        vi.advanceTimersByTime(30000);
        expect(svg.classList.contains('mm-blink')).toBe(false);
        setHidden(false);
        expect(document.documentElement.classList.contains('mm-paused')).toBe(false);
        vi.advanceTimersByTime(3000);
        expect(svg.classList.contains('mm-blink')).toBe(true);
    });
});

describe('接線（house rule：呼叫端 typeof 守衛）', () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

    it('main.js 以 typeof 守衛呼叫 MascotMotion.init()', () => {
        const src = read('js/main.js');
        expect(src).toMatch(/typeof MascotMotion !== 'undefined'[^\n]*\n?[^\n]*MascotMotion\.init\(\)/);
    });

    it('index.html 在 mascot.js 之後、ui_manager.js 之前載入 mascot_motion.js', () => {
        const html = read('index.html');
        const iMascot = html.indexOf('src="js/mascot.js"');
        const iMotion = html.indexOf('src="js/mascot_motion.js"');
        const iUi = html.indexOf('src="js/ui_manager.js"');
        expect(iMotion).toBeGreaterThan(iMascot);
        expect(iMotion).toBeLessThan(iUi);
    });
});
```

- [ ] **Step 2: 寫失敗測試（CSS 靜態檢查）**

`desktop/tests/reduced_motion_css.test.js`：

```javascript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * v2.6 motion Task 4：全域 reduced-motion＝靜態 的 CSS 靜態檢查。
 *
 * jsdom 不算 @media，所以這裡直接讀 CSS 原文：每個宣告了 animation（值不是 none）的
 * 選擇器，都必須在同一個檔案的 @media (prefers-reduced-motion: reduce) 區塊裡被設成
 * animation: none——之後任何任務新增動畫卻忘了靜態版，這支測試就會紅。
 * 比對時把選擇器裡的 :not(...) 拿掉再比（reduce 區塊用較寬的選擇器蓋掉即可），
 * 空白正規化。瀏覽器層面的「reduce 下每個場景影格都相同」另由
 * `node tools/motion/capture-frames.js --reduced` 驗。
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_DIR = path.resolve(__dirname, '..', 'css');
const FILES = ['animations.css', 'chat.css', 'mascot.css'];

/** 頂層區塊切分：[{ prelude, body }]，body 是大括號內原文（巢狀大括號完整保留）。 */
function blocks(css) {
    const out = [];
    let i = 0; let segStart = 0;
    while (i < css.length) {
        const ch = css[i];
        if (ch === ';') { segStart = i + 1; i++; continue; }
        if (ch === '{') {
            const prelude = css.slice(segStart, i).trim();
            let depth = 1; let j = i + 1;
            while (j < css.length && depth > 0) {
                if (css[j] === '{') depth++;
                else if (css[j] === '}') depth--;
                j++;
            }
            out.push({ prelude, body: css.slice(i + 1, j - 1) });
            i = j; segStart = j;
            continue;
        }
        i++;
    }
    return out;
}

const norm = (sel) => sel.replace(/:not\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
const isReducedMedia = (prelude) => /^@media[^{]*prefers-reduced-motion\s*:\s*reduce/.test(prelude);
const ANIMATED = /(^|[;\s])animation(-name)?\s*:\s*(?!none\b)[^;]+/;
const ANIMATION_NONE = /(^|[;\s])animation(-name)?\s*:\s*none\b/;

function scan(css) {
    const animated = new Set();
    const neutralised = new Set();
    (function walk(list, inReduced) {
        for (const { prelude, body } of list) {
            if (prelude.startsWith('@keyframes') || prelude.startsWith('@-webkit-keyframes')) continue;
            if (prelude.startsWith('@media') || prelude.startsWith('@supports')) {
                walk(blocks(body), inReduced || isReducedMedia(prelude));
                continue;
            }
            const selectors = prelude.split(',').map(norm).filter(Boolean);
            if (inReduced && ANIMATION_NONE.test(body)) selectors.forEach((s) => neutralised.add(s));
            if (!inReduced && ANIMATED.test(body)) selectors.forEach((s) => animated.add(s));
        }
    })(blocks(css.replace(/\/\*[\s\S]*?\*\//g, '')), false);
    return { animated: [...animated], neutralised };
}

describe('reduced-motion＝靜態：每個動畫選擇器都有 animation:none 的 reduce 版', () => {
    it('解析器自我檢查：抓得到已知的動畫與 reduce 區塊（避免正規式失配後空轉假綠燈）', () => {
        const { animated, neutralised } = scan(fs.readFileSync(path.join(CSS_DIR, 'mascot.css'), 'utf8'));
        expect(animated).toContain('.mascot-sway');
        expect(neutralised.has('.mascot-sway')).toBe(true);
    });

    it.each(FILES)('%s', (file) => {
        const { animated, neutralised } = scan(fs.readFileSync(path.join(CSS_DIR, file), 'utf8'));
        expect(animated.length).toBeGreaterThan(0);
        const uncovered = animated.filter((sel) => !neutralised.has(sel));
        expect(uncovered, `${file} 缺 reduced-motion 靜態版：${uncovered.join(' | ')}`).toEqual([]);
    });
});
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/mascot_motion.test.js tests/reduced_motion_css.test.js`
Expected: FAIL——`js/mascot_motion.js` 不存在（ENOENT）；CSS 檢查列出 `animations.css 缺 reduced-motion 靜態版：.fade-in | .slide-in | .loading` 與 `chat.css 缺 …：.chat-message | .thinking-dots span | #mic-button.recording i`（`mascot.css` 那筆與「解析器自我檢查」本來就過）。

- [ ] **Step 4: 行為層 `desktop/js/mascot_motion.js`**

```javascript
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
    const MOTION_CLASSES = ['mm-blink'];   // reduced-motion 開啟時要立刻拔掉的一次性 class

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

    /** reduced-motion 生效的瞬間：拔掉所有一次性動畫 class，畫面回到靜止姿勢。 */
    function clearTransientMotion() {
        MOTION_CLASSES.forEach(function (cls) {
            document.querySelectorAll('.' + cls).forEach(function (el) { el.classList.remove(cls); });
        });
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
        document.documentElement.classList.toggle('mm-paused', !!document.hidden);
        scheduler.start();
    }

    /** 測試專用：拆掉監聽器與計時器，下一個測試可重新 init()。 */
    function teardown() {
        if (!started) return;
        started = false;
        scheduler.stop();
        document.removeEventListener('visibilitychange', onVisibilityChange);
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
        _test: {
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
```

- [ ] **Step 5: 接線——`index.html`、`sw.js`、`main.js`**

`desktop/index.html`：在 `<script src="js/mascot.js"></script>` 下一行插入

```html
    <script src="js/mascot_motion.js"></script>
```

`desktop/sw.js` 的 `SHELL_ASSETS`：在 `'/js/mascot.js',` 下一行插入

```javascript
    '/js/mascot_motion.js',
```

`desktop/js/main.js`：在 `ErrorLogger.init()` 的 if/else 區塊之後、`// 确保先初始化ApiService` 之前插入

```javascript
    // 吉祥物行為層（v2.6 motion：待機、點擊反應、眼睛跟隨；reduced-motion 下全靜態）。
    // 不依賴任何 App 模組，越早啟動越好——後面各模組渲染出的吉祥物一出現就接得上。
    if (typeof MascotMotion !== 'undefined' && typeof MascotMotion.init === 'function') {
        MascotMotion.init();
    }

```

- [ ] **Step 6: 全域 reduced-motion CSS**

`desktop/css/animations.css` 檔尾（`.button-press { … }` 之後，原檔最後一行沒有換行，先補一個）附加：

```css
/* 使用者要求減少動態效果（v2.6 motion Task 4）：本檔的通用動畫與視圖切換一律靜態。
   吉祥物在 mascot.css、聊天在 chat.css 各自處理；tests/reduced_motion_css.test.js
   逐檔檢查「每個 animation 都有 none 版」。轉圈的載入指示（base.css／components.css
   的 spin）是進度狀態指示、刻意保留；toast 的 transition 也保留——ui_manager.js 的
   showToast 靠 transitionend 移除節點，拿掉 transition 會讓看不見的 toast 永遠留在 DOM。 */
@media (prefers-reduced-motion: reduce) {
    .fade-in, .slide-in, .loading { animation: none !important; }
    .page-transition, .button-press { transition: none !important; }
    .view-container { transition: none !important; }
}
```

`desktop/css/chat.css` 檔尾附加（放最後：同 specificity 下要贏過前面的宣告）：

```css
/* 使用者要求減少動態效果（v2.6 motion Task 4）：訊息淡入、思考點點、錄音脈動、
   結束鈕懸浮位移一律靜態（錄音中的紅色圖示本身已足以辨識狀態）。放檔尾：同
   specificity 下要贏過上面的宣告。 */
@media (prefers-reduced-motion: reduce) {
    .chat-message { animation: none; }
    .thinking-dots span { animation: none; }
    #mic-button.recording i { animation: none; }
    #end-chat-btn, #end-chat-btn:hover, #end-chat-btn:active { transition: none; transform: none; }
}
```

- [ ] **Step 7: harness 也載入行為層**

`desktop/tools/motion/harness.html`：在 `<script src="../../js/mascot.js"></script>` 下一行插入

```html
    <script src="../../js/mascot_motion.js"></script>
```

`desktop/tools/motion/harness.js` 的 `DOMContentLoaded` 監聽器最前面（`const name = new URLSearchParams(…)` 之前）插入

```javascript
        // 與 App 相同的行為層（main.js 也是這樣啟動）；擷取時假時鐘讓排程器不會自己跑
        if (window.MascotMotion) window.MascotMotion.init();
```

`desktop/tests/motion_tools.test.js` 的 `beforeAll`：在 `loadScript('js/mascot.js');` 下一行插入

```javascript
        loadScript('js/mascot_motion.js');
```

- [ ] **Step 8: 跑測試確認通過**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/mascot_motion.test.js tests/reduced_motion_css.test.js tests/motion_tools.test.js tests/sw_logic.test.js`
Expected: 全 passed（`sw_logic.test.js` 的「index.html ↔ SHELL_ASSETS 同步」會確認新 script 有進清單）。

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run`
Expected: `538 passed (538)`。

- [ ] **Step 9: e2e＋後端 PWA 資產檢查（新 shell 檔真的載得到、CSP 沒擋）**

Run: `cd /home/e604/Brian/URDiary/desktop && npx playwright test 2>&1 | tail -3`
Expected: `16 passed`。

Run: `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest tests/test_pwa_assets.py tests/test_frontend_static.py -q 2>&1 | grep -E "passed|failed"`
Expected: `39 passed`（`test_every_precached_shell_asset_is_actually_reachable` 會真的去 GET `/js/mascot_motion.js`）。

- [ ] **Step 10: Commit**

```bash
cd /home/e604/Brian/URDiary
git add desktop/js/mascot_motion.js desktop/index.html desktop/sw.js desktop/js/main.js \
        desktop/css/animations.css desktop/css/chat.css \
        desktop/tools/motion/harness.html desktop/tools/motion/harness.js \
        desktop/tests/mascot_motion.test.js desktop/tests/reduced_motion_css.test.js desktop/tests/motion_tools.test.js
git commit -m "feat(吉祥物動畫): 行為層 MascotMotion 核心＋全域 reduced-motion

reduced-motion 即時監看、分頁隱藏暫停、全頁唯一的待機排程器（依賴注入可測）、
限流器；接進 index.html／SHELL_ASSETS／main.js。animations.css、chat.css 補
reduce 版，靜態 CSS 測試鎖住「每個 animation 都要有 none 版」。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 待機生命感（呼吸＋隨機眨眼＋睡覺的 zzz）

**目標**：登入歡迎與三種空狀態的吉祥物會呼吸（3.6 s 循環，睡著的 4.8 s）、睜眼的每 3–7 秒眨一次、睡覺姿勢的 zzz 緩緩飄動；分頁隱藏時全停；聊天區的吉祥物（思考中／生成日記／check-in 端茶）維持今天的樣子（契約 §4）。排程由 Task 4 的共用排程器負責，這個任務只標模板旗標＋寫 CSS。

**Files:**
- Modify: `desktop/js/mascot.js`（`svg220` 加 `behavior` 參數、`emptyHtml`、`welcomeHtml`）
- Modify: `desktop/css/mascot.css`（`.mascot-cat-icon` 之後插入 rig 共同設定＋待機段；reduce 區塊換新版）
- Modify: `desktop/tools/motion/harness.js`（三個場景）
- Test: `desktop/tests/mascot_idle.test.js`

**Interfaces:**
- Consumes: `MascotMotion.blink(svg, delayMs)`、`_test.teardown()`（Task 4）；rig class（Task 2）。
- Produces: 模板旗標 `data-mm-idle`（只在 `welcomeHtml()` 與 `emptyHtml()` 的 `<svg>`）；`svg220(inner, size, pose, behavior)` 第四參數＝附加在 `<svg>` 上的屬性字串（Task 6／7 往裡面加 `data-mm-tap`／`data-mm-follow`）；CSS：`.mm-rig`／`.mm-eyes`／`.mm-zzz` 的 `transform-box: fill-box`、keyframes `mm-breathe`／`mm-zzz`／`mm-blink`、變數 `--mm-breathe`（呼吸週期）。

- [ ] **Step 1: 寫失敗測試**

`desktop/tests/mascot_idle.test.js`：

```javascript
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadScript } from './helpers/load.js';

/**
 * v2.6 motion Task 5：待機生命感的「誰會動」契約。
 * 契約 §4：聊天區域只有安靜搖擺／靜態吉祥物——思考中、生成日記、check-in 端茶
 * 一律不帶 data-mm-idle（不呼吸、不眨眼），即使端茶那隻是睜眼的。
 */
function svgOf(html) {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.querySelector('svg');
}

describe('模板行為旗標', () => {
    beforeEach(() => { loadScript('js/mascot.js'); });

    it.each([
        ['welcome', () => MascotModule.welcomeHtml()],
        ['empty-diary', () => MascotModule.emptyHtml('diary', 'x')],
        ['empty-calendar', () => MascotModule.emptyHtml('calendar', 'x')],
        ['empty-generic', () => MascotModule.emptyHtml('generic', 'x')],
    ])('%s 帶 data-mm-idle', (name, render) => {
        expect(svgOf(render()).hasAttribute('data-mm-idle')).toBe(true);
    });

    it.each([
        ['loading', () => MascotModule.loadingHtml(96)],
        ['thinking', () => MascotModule.thinkingBubbleHtml()],
        ['checkin', () => MascotModule.checkinHtml()],
    ])('聊天區域的 %s 不帶任何 data-mm-* 行為旗標', (name, render) => {
        const svg = svgOf(render());
        const flags = [...svg.attributes].map((a) => a.name).filter((n) => n.startsWith('data-mm-') && n !== 'data-mm-pose');
        expect(flags).toEqual([]);
    });
});

describe('排程器 × 真模板（jsdom）', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(0);
        Element.prototype.checkVisibility = function () { return true; };
        loadScript('js/mascot.js');
        loadScript('js/mascot_motion.js');
        document.body.innerHTML =
            `<div id="cal">${MascotModule.emptyHtml('calendar', 'x')}</div>` +
            `<div id="diary">${MascotModule.emptyHtml('diary', 'x')}</div>` +
            `<div class="chat-messages"><div id="tea">${MascotModule.checkinHtml()}</div></div>`;
        MascotMotion.init();
    });
    afterEach(() => {
        MascotMotion._test.teardown();
        delete Element.prototype.checkVisibility;
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('3 秒一輪：空行事曆（睜眼）眨、空日記（睡著）不眨、聊天區 check-in 端茶（睜眼但非待機）不眨', () => {
        vi.advanceTimersByTime(3000);
        expect(document.querySelector('#cal svg').classList.contains('mm-blink')).toBe(true);
        expect(document.querySelector('#diary svg').classList.contains('mm-blink')).toBe(false);
        expect(document.querySelector('#tea svg').classList.contains('mm-blink')).toBe(false);
    });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/mascot_idle.test.js`
Expected: FAIL（`5 failed | 3 passed`：四個模板沒有 `data-mm-idle`、排程器找不到可眨的吉祥物；聊天區三個「不帶旗標」本來就成立）。

- [ ] **Step 3: 模板加行為旗標**

`desktop/js/mascot.js` 的 `svg220` 整段換成：

```javascript
    // behavior：行為旗標（data-mm-idle＝待機生命感…），只給 mascot_motion.js 當掛點；
    // 聊天區域的吉祥物（思考中／生成日記／check-in）一律不帶——契約 §4：只准安靜搖擺或靜態
    function svg220(inner, size, pose, behavior) {
        return `<svg viewBox="0 0 220 200" width="${size}" height="${Math.round(size * 200 / 220)}" data-mm-pose="${pose}"${behavior ? ' ' + behavior : ''} aria-hidden="true"><g class="mm-rig">${inner}</g></svg>`;
    }
```

`emptyHtml` 的 return 第一行改成：

```javascript
        return `<div class="mascot-empty">${svg220(POSES[pose], 132, pose, 'data-mm-idle')}` +
```

`welcomeHtml` 換成：

```javascript
    function welcomeHtml() { return `<div class="mascot-welcome">${svg220(POSE_WAVE, 110, 'wave', 'data-mm-idle')}</div>`; }
```

（`checkinHtml`、`loadingHtml`、`thinkingBubbleHtml`、彩蛋都不加。）

- [ ] **Step 4: 待機 CSS**

`desktop/css/mascot.css`：在 `.mascot-cat-icon { vertical-align: middle; }` 之後、`@media (prefers-reduced-motion: reduce)` 之前插入：

```css
/* ---- v2.6 motion：rig 部件的共同設定 ----------------------------------------
   SVG 群組的 transform 預設以整張 viewBox 為參考框；fill-box 讓 transform-origin 的
   百分比落在「該部件自己的外框」上（眼睛以自己的中心縮、整隻以腳底為支點）。 */
.mm-rig, .mm-eyes, .mm-zzz { transform-box: fill-box; }
.mm-rig { transform-origin: 50% 100%; }
.mm-eyes { transform-origin: 50% 55%; }

/* 待機生命感（mascot_motion.js 的共用排程器只負責眨眼的時機；呼吸與 zzz 是純 CSS）。
   只作用在模板標了 data-mm-idle 的吉祥物（登入歡迎、空狀態）——聊天區域的吉祥物不帶。
   呼吸週期用自訂屬性調（睡著的比較慢）；不要另寫 animation-duration 規則——它的
   specificity 會蓋過點擊反應 .mm-react 的彈跳時長。 */
svg[data-mm-idle] .mm-rig { animation: mm-breathe var(--mm-breathe, 3.6s) ease-in-out infinite; }
svg[data-mm-pose="sleep"] { --mm-breathe: 4.8s; }
svg[data-mm-idle][data-mm-pose="sleep"] .mm-zzz { animation: mm-zzz 2.8s ease-in-out infinite; }
@keyframes mm-breathe { 0%, 100% { transform: scale(1, 1); } 50% { transform: scale(1.01, 1.025); } }
@keyframes mm-zzz { 0%, 100% { transform: translateY(0); opacity: 1; } 50% { transform: translateY(-4px); opacity: .55; } }

/* 眨眼：排程器加 .mm-blink（並設 --mm-blink-delay 錯開），只有睜眼（dot）的眼睛會動 */
svg.mm-blink .mm-eyes[data-mm-eyes="dot"] { animation: mm-blink 180ms ease-in-out var(--mm-blink-delay, 0ms) 1; }
@keyframes mm-blink { 0%, 100% { transform: scaleY(1); } 45%, 55% { transform: scaleY(.1); } }

/* 分頁隱藏時（html.mm-paused，mascot_motion.js 設）連 CSS 的循環待機一起停 */
html.mm-paused svg[data-mm-idle] .mm-rig, html.mm-paused svg[data-mm-idle] .mm-zzz { animation-play-state: paused; }

```

檔尾的 reduce 區塊整段換成：

```css
@media (prefers-reduced-motion: reduce) {
    .mascot-sway, .mascot-dots span, .mascot-egg svg { animation: none !important; }
    .mascot-egg { transition: none; }
    svg[data-mm-idle] .mm-rig, svg[data-mm-idle][data-mm-pose="sleep"] .mm-zzz,
    svg.mm-blink .mm-eyes[data-mm-eyes="dot"] { animation: none !important; }
}
```

- [ ] **Step 5: harness 場景**

`desktop/tools/motion/harness.js` 的 `SCENES`：在 `'egg-night'` 場景之後、`SCENES` 的結尾 `};` 之前插入：

```javascript
        // --- Task 5 待機生命感 ---------------------------------------------------
        'idle-breathe': {
            viewport: [220, 200], frames: [0, 900, 1800, 2700],
            setup: (stage) => mount(stage, MascotModule.welcomeHtml()),
        },
        'idle-sleep': {
            viewport: [240, 220], frames: [0, 1200, 2400, 3600],
            setup: (stage) => mount(stage, MascotModule.emptyHtml('diary', '')),
        },
        'blink': {
            viewport: [240, 220], frames: [0, 45, 90, 135, 180],
            setup: (stage) => {
                mount(stage, MascotModule.emptyHtml('calendar', ''));
                MascotMotion.blink(stage.querySelector('svg'), 0);
            },
        },
```

- [ ] **Step 6: 跑測試確認通過**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/mascot_idle.test.js tests/reduced_motion_css.test.js tests/mascot_rig.test.js tests/motion_tools.test.js`
Expected: 全 passed。

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run`
Expected: `546 passed (546)`。

- [ ] **Step 7: 靜止畫面不變＋reduce 靜態**

Run: `cd /home/e604/Brian/URDiary/desktop && node tools/motion/pose-identity.js | tail -1 && node tools/motion/capture-frames.js --reduced | tail -1`
Expected: `pose identity: OK (all common renders pixel-identical)` 與 `reduced motion: all 7 scenes static`。

- [ ] **Step 8: 影格審查（Fable）**

Run: `cd /home/e604/Brian/URDiary/desktop && node tools/motion/capture-frames.js idle-breathe idle-sleep blink`

看 `/tmp/urdiary-motion-frames/contact-sheet.png`：
- `idle-breathe` 0／900／1800／2700 ms：1800 ms 最「吸飽」（高 +2.5%、寬 +1%），**腳底不動**（支點在底部中央）；幅度要「看得出活著、看不出在動畫」。太小／太大就調 `mm-breathe` 的 `scale(1.01, 1.025)`。
- `idle-sleep` 0／1200／2400／3600 ms：呼吸更慢；兩個 z 往上飄 4 單位、變淡再回來；鉛筆與書一起呼吸不脫節。
- `blink` 0／45／90／135／180 ms：90 ms 兩眼都闔成細線、以眼睛群組中心收，沒有整張臉上下跳；180 ms 完全回原狀。

- [ ] **Step 9: Commit**

```bash
cd /home/e604/Brian/URDiary
git add desktop/js/mascot.js desktop/css/mascot.css desktop/tools/motion/harness.js desktop/tests/mascot_idle.test.js
git commit -m "feat(吉祥物動畫): 待機生命感——呼吸、隨機眨眼、睡覺的 zzz

只給登入歡迎與空狀態（data-mm-idle）；聊天區吉祥物維持安靜搖擺／靜態。
眨眼時機由共用排程器決定，呼吸與 zzz 為純 CSS，分頁隱藏時暫停。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 點擊反應（彈跳＋開心臉＋小愛心，限流）

**目標**：點（或觸控點）登入歡迎與三種空狀態的吉祥物 → 整隻彈一下、臉換成開心的笑眼＋腮紅、頭上冒出一顆小愛心往上飄走；同一隻 1.2 秒內只反應一次。這是「明確操作」觸發的小彩蛋（契約 §4）。**不套用**：聊天訊息區所有吉祥物（思考中、生成日記、check-in 端茶）、彩蛋浮層、印章與分類圖標——模板不標 `data-mm-tap`，執行期再用 `isTapAllowed` 擋一次 `.chat-messages`／`.mascot-egg`。reduced-motion 下完全不動。

**Files:**
- Modify: `desktop/js/mascot.js`（`face()` 加參數、`FACE_REACT`、睡覺／舉月曆／歪頭三個姿勢、`data-mm-tap` 旗標、`reactionHeartSvg`、exports）
- Modify: `desktop/js/mascot_motion.js`（常數、限流器、`isTapAllowed`／`react`／點擊委派、`clearTransientMotion`、`init`／`teardown`、exports）
- Modify: `desktop/css/mascot.css`（反應段＋reduce）
- Modify: `desktop/tools/motion/harness.js`（三個場景）
- Test: `desktop/tests/mascot_react.test.js`

**Interfaces:**
- Consumes: `createRateLimiter`、`restartClass`、`MOTION_CLASSES`、`clearTransientMotion`（Task 4）；`svg220(…, behavior)`（Task 5）；`EYES_HAPPY`／`MOUTH_HAPPY`／`BLUSH`（Task 2）。
- Produces:
  - `MascotModule.reactionHeartSvg() → string`（`<g data-mm-heart transform="translate(108 50)"><g class="mm-heart">…</g></g>`）。
  - 靜止臉 `.mm-face.mm-face-rest`；反應臉 `.mm-face.mm-face-alt[visibility="hidden"]`（只在睡覺／舉月曆／歪頭三個姿勢；揮手本來就是笑眼，不需要）。
  - 旗標 `data-mm-tap`（`welcomeHtml()`、`emptyHtml()`）；`face(inner, extraClass)`。
  - `MascotMotion.react(svg) → boolean`（播了才回 true）；`MascotMotion._test.isTapAllowed(el) → boolean`；`MOTION_CLASSES` 多了 `'mm-react'`。
  - CSS：`.mm-react`（彈跳 `mm-bounce` 600ms＋換臉）、`.mm-heart`（`mm-heart` 900ms）；`svg[data-mm-tap]` 游標為手指。

- [ ] **Step 1: 寫失敗測試**

`desktop/tests/mascot_react.test.js`：

```javascript
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadScript } from './helpers/load.js';

/**
 * v2.6 motion Task 6：點擊吉祥物的反應（彈跳＋開心臉＋小愛心）。
 * 契約 §4：這是「明確操作」觸發的彩蛋，只給登入歡迎與空狀態；聊天訊息區與彩蛋浮層裡
 * 的吉祥物永遠不反應；reduced-motion 下完全不動；同一隻 1.2 秒內只反應一次。
 */
function svgOf(html) {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.querySelector('svg');
}

describe('模板：誰可點、開心臉、愛心', () => {
    beforeEach(() => { loadScript('js/mascot.js'); });

    it.each([
        ['welcome', () => MascotModule.welcomeHtml(), 0],
        ['empty-diary', () => MascotModule.emptyHtml('diary', 'x'), 1],
        ['empty-calendar', () => MascotModule.emptyHtml('calendar', 'x'), 1],
        ['empty-generic', () => MascotModule.emptyHtml('generic', 'x'), 1],
    ])('%s：帶 data-mm-tap；開心臉（隱藏的 .mm-face-alt）數量正確', (name, render, alts) => {
        const svg = svgOf(render());
        expect(svg.hasAttribute('data-mm-tap')).toBe(true);
        const alt = svg.querySelectorAll('.mm-face-alt');
        expect(alt.length).toBe(alts);
        if (alts) {
            expect(alt[0].getAttribute('visibility')).toBe('hidden');          // 靜止畫面不畫
            expect(alt[0].querySelector('.mm-eyes').getAttribute('data-mm-eyes')).toBe('happy');
            expect(svg.querySelectorAll('.mm-face-rest').length).toBe(1);      // CSS 反應時藏這張
        }
    });

    it.each([
        ['loading', () => MascotModule.loadingHtml(96)],
        ['thinking', () => MascotModule.thinkingBubbleHtml()],
        ['checkin', () => MascotModule.checkinHtml()],
    ])('聊天區域的 %s：不可點、沒有開心臉', (name, render) => {
        const svg = svgOf(render());
        expect(svg.hasAttribute('data-mm-tap')).toBe(false);
        expect(svg.querySelector('.mm-face-alt')).toBeNull();
    });

    it('愛心只用既有色票（#e8899a 粉紅＋#4b2e1e 描邊），動畫群組不帶 transform 屬性', () => {
        const html = MascotModule.reactionHeartSvg();
        const colors = html.match(/#[0-9a-fA-F]{6}/g);
        expect([...new Set(colors)].sort()).toEqual(['#4b2e1e', '#e8899a']);
        const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        host.innerHTML = html;
        expect(host.querySelector('[data-mm-heart]')).not.toBeNull();
        expect(host.querySelector('.mm-heart').hasAttribute('transform')).toBe(false);
    });
});

describe('MascotMotion.react＋點擊委派', () => {
    let reducedListeners;
    function setReduced(v) {
        window.matchMedia = vi.fn(() => ({
            matches: v,
            addEventListener: (t, fn) => reducedListeners.push(fn),
            removeEventListener: () => {},
        }));
    }
    beforeEach(() => {
        vi.useFakeTimers();
        reducedListeners = [];
        loadScript('js/mascot.js');
        loadScript('js/mascot_motion.js');
        document.body.innerHTML =
            `<div id="login">${MascotModule.welcomeHtml()}</div>` +
            `<div class="chat-messages"><div id="in-chat">${MascotModule.emptyHtml('calendar', 'x')}</div>` +
            `<div id="tea">${MascotModule.checkinHtml()}</div></div>` +
            `<div class="mascot-egg"><div id="in-egg">${MascotModule.welcomeHtml()}</div></div>`;
    });
    afterEach(() => {
        MascotMotion._test.teardown();
        delete window.matchMedia;
        vi.useRealTimers();
    });

    const login = () => document.querySelector('#login svg');
    const clickOn = (svg) => svg.querySelector('.mm-body path').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    it('isTapAllowed：登入歡迎可以；聊天訊息區、彩蛋浮層、沒標 data-mm-tap 的都不行', () => {
        const allowed = MascotMotion._test.isTapAllowed;
        expect(allowed(login())).toBe(true);
        expect(allowed(document.querySelector('#in-chat svg'))).toBe(false);
        expect(allowed(document.querySelector('#in-egg svg'))).toBe(false);
        expect(allowed(document.querySelector('#tea svg'))).toBe(false);
    });

    it('點吉祥物任一部件：整隻加 mm-react、插入一顆愛心；900ms 後兩者都收掉', () => {
        MascotMotion.init();
        clickOn(login());
        expect(login().classList.contains('mm-react')).toBe(true);
        expect(login().querySelectorAll('[data-mm-heart]').length).toBe(1);
        vi.advanceTimersByTime(899);
        expect(login().classList.contains('mm-react')).toBe(true);
        vi.advanceTimersByTime(1);
        expect(login().classList.contains('mm-react')).toBe(false);
        expect(login().querySelectorAll('[data-mm-heart]').length).toBe(0);
    });

    it('限流：1.2 秒內連點只反應一次，過了才再反應', () => {
        MascotMotion.init();
        expect(MascotMotion.react(login())).toBe(true);
        vi.advanceTimersByTime(500);
        expect(MascotMotion.react(login())).toBe(false);
        expect(login().querySelectorAll('[data-mm-heart]').length).toBe(1);
        vi.advanceTimersByTime(600);                  // t=1100：上一輪已收掉，但仍在 1200ms 內
        expect(MascotMotion.react(login())).toBe(false);
        expect(login().classList.contains('mm-react')).toBe(false);
        vi.advanceTimersByTime(100);                  // t=1200
        expect(MascotMotion.react(login())).toBe(true);
    });

    it('聊天訊息區與彩蛋浮層裡的吉祥物：點了也不反應', () => {
        MascotMotion.init();
        clickOn(document.querySelector('#in-chat svg'));
        clickOn(document.querySelector('#in-egg svg'));
        clickOn(document.querySelector('#tea svg'));
        expect(document.querySelectorAll('.mm-react').length).toBe(0);
        expect(document.querySelectorAll('[data-mm-heart]').length).toBe(0);
    });

    it('reduced-motion：點了不動', () => {
        setReduced(true);
        MascotMotion.init();
        clickOn(login());
        expect(login().classList.contains('mm-react')).toBe(false);
        expect(login().querySelectorAll('[data-mm-heart]').length).toBe(0);
    });

    it('反應進行中偏好改成 reduce：立刻拔掉 mm-react 與愛心', () => {
        setReduced(false);
        MascotMotion.init();
        clickOn(login());
        expect(login().classList.contains('mm-react')).toBe(true);
        reducedListeners.forEach((fn) => fn({ matches: true }));
        expect(login().classList.contains('mm-react')).toBe(false);
        expect(login().querySelectorAll('[data-mm-heart]').length).toBe(0);
    });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/mascot_react.test.js`
Expected: FAIL（`9 failed | 5 passed`：`reactionHeartSvg is not a function`、`MascotMotion.react is not a function`、模板沒有 `data-mm-tap`／`.mm-face-alt`；聊天區「不可點」與「不反應」本來就成立）。

- [ ] **Step 3: `mascot.js`——開心臉零件與 `face()` 的第二參數**

`face` 換成：

```javascript
    function face(inner, extraClass) { return `<g class="mm-face${extraClass ? ' ' + extraClass : ''}">${inner}</g>`; }
```

在 `const BLUSH = …;` 之後、`function svg200` 之前插入：

```javascript
    // 點擊反應的開心臉（v2.6 motion Task 6）：預設 visibility="hidden"，靜止畫面不畫它；
    // mascot.css 在 svg.mm-react 時把它換上、把同一姿勢的 .mm-face-rest 藏起來。
    // 只放在「靜止臉不是開心臉」且可點的姿勢（睡覺、舉月曆、歪頭問號）。
    const FACE_REACT = `<g class="mm-face mm-face-alt" visibility="hidden">${EYES_HAPPY}${MOUTH_HAPPY}${BLUSH}</g>`;

```

- [ ] **Step 4: `mascot.js`——三個可點姿勢放上反應臉**

`POSE_SLEEP`、`POSE_CALENDAR`、`POSE_QUESTION` 三個定義整段換成（差別只有：靜止臉加 `'mm-face-rest'`、同一個座標系裡緊接著放 `FACE_REACT`；舉月曆姿勢的臉整體右移 3，反應臉用外層無名 `<g transform>` 跟著移——`mm-*` 群組本身仍不帶 transform）：

```javascript
    const POSE_SLEEP =
      part('zzz',
        `<text x="150" y="52" font-size="22" fill="#a58a70" font-weight="bold" transform="rotate(12 150 52)">z</text>` +
        `<text x="168" y="38" font-size="16" fill="#bfa88d" font-weight="bold" transform="rotate(12 168 38)">z</text>`) +
      `<g transform="rotate(-6 100 130)">${BASE_BOOK}` +
        face(
          part('eyes', `<path d="M96 127 q7 5 14 0 M126 127 q7 5 14 0" stroke="#2b1a10" stroke-width="5" fill="none" stroke-linecap="round"/>`, 'data-mm-eyes="closed"') +
          part('mouth', `<circle cx="120" cy="141" r="3.5" fill="#2b1a10"/>`), 'mm-face-rest') +
        FACE_REACT +
      `</g>` +
      part('prop',
        `<g transform="rotate(24 186 150)">` +
          `<rect x="180" y="118" width="11" height="52" rx="4" fill="#f2c94c" stroke="${OUTLINE}" stroke-width="5"/>` +
          `<path d="M181 170 l4.5 12 l4.5 -12 z" fill="#e8b04b" stroke="${OUTLINE}" stroke-width="4" stroke-linejoin="round"/>` +
        `</g>`);

    const POSE_CALENDAR =
      part('prop',
        `<g transform="rotate(8 178 92)">` +
          `<rect x="156" y="66" width="46" height="42" rx="7" fill="#ffffff" stroke="${OUTLINE}" stroke-width="6"/>` +
          `<rect x="156" y="66" width="46" height="12" rx="6" fill="#e8836f" stroke="${OUTLINE}" stroke-width="6"/>` +
          `<circle cx="168" cy="89" r="2.6" fill="#d9c9ae"/><circle cx="179" cy="89" r="2.6" fill="#d9c9ae"/><circle cx="190" cy="89" r="2.6" fill="#d9c9ae"/>` +
          `<circle cx="168" cy="99" r="2.6" fill="#d9c9ae"/><circle cx="179" cy="99" r="2.6" fill="#d9c9ae"/>` +
        `</g>`) +
      part('arm-r', `<path d="M152 120 q14 -6 20 -14" stroke="${OUTLINE}" stroke-width="8" fill="none" stroke-linecap="round"/>`) +
      BASE_BOOK +
      face(
        part('eyes', `<circle cx="106" cy="126" r="6.5" fill="#2b1a10"/><circle cx="136" cy="126" r="6.5" fill="#2b1a10"/>`, 'data-mm-eyes="dot"') +
        part('mouth', `<path d="M113 139 q8 7 16 0" stroke="#2b1a10" stroke-width="5" fill="none" stroke-linecap="round"/>`), 'mm-face-rest') +
      `<g transform="translate(3 0)">${FACE_REACT}</g>`;   // 這個姿勢的臉整體右移 3

    const POSE_QUESTION =
      part('prop', `<text x="140" y="58" font-size="42" fill="#a58a70" font-weight="bold" font-family="sans-serif">?</text>`) +
      `<g transform="rotate(5 100 130)">${BASE_BOOK}` +
        face(
          part('eyes', `<circle cx="103" cy="126" r="6.5" fill="#2b1a10"/><circle cx="135" cy="124" r="6.5" fill="#2b1a10"/>`, 'data-mm-eyes="dot"') +
          part('mouth', `<path d="M112 141 h14" stroke="#2b1a10" stroke-width="5" stroke-linecap="round"/>`), 'mm-face-rest') +
        FACE_REACT +
      `</g>`;
```

- [ ] **Step 5: `mascot.js`——可點旗標、愛心、exports**

`emptyHtml` 的 return 第一行改成：

```javascript
        return `<div class="mascot-empty">${svg220(POSES[pose], 132, pose, 'data-mm-idle data-mm-tap')}` +
```

`welcomeHtml` 換成：

```javascript
    function welcomeHtml() { return `<div class="mascot-welcome">${svg220(POSE_WAVE, 110, 'wave', 'data-mm-idle data-mm-tap')}</div>`; }
```

在 `function categoryIcon` 之前插入：

```javascript
    // 點擊反應的小愛心（v2.6 motion Task 6）：沿用 heart 印章的心形路徑與既有粉紅 #e8899a。
    // 外層無名 <g> 負責定位（transform 屬性；插在 <svg> 底下、mm-rig 之外，不跟著彈跳），
    // 內層 .mm-heart 給 CSS 動畫（不能帶 transform 屬性，理由同 rig 鐵律 (2)）。
    function reactionHeartSvg() {
        return `<g data-mm-heart transform="translate(108 50)"><g class="mm-heart">` +
            `<path d="M37 6.5 c-2.8 -2.8 -6.5 -1 -6.5 2.2 c0 2.8 2.8 4.7 6.5 7.5 c3.7 -2.8 6.5 -4.7 6.5 -7.5 c0 -3.2 -3.7 -5 -6.5 -2.2 z" ` +
            `transform="scale(2) translate(-37 -9.5)" fill="#e8899a" stroke="${OUTLINE}" stroke-width="2.4" stroke-linejoin="round"/>` +
            `</g></g>`;
    }

```

檔尾 `return { … }` 換成：

```javascript
    return { loadingHtml, thinkingBubbleHtml, emptyHtml, welcomeHtml,
             checkinHtml, eggKindFor, showSaveEgg, categoryIcon, stampIcon,
             reactionHeartSvg };
```

- [ ] **Step 6: `mascot_motion.js`——反應邏輯與點擊委派**

常數區：`BLINK_STAGGER_MS` 那行之後的 `MOTION_CLASSES` 換成：

```javascript
    const REACT_MS = 900;                  // 點擊反應全長（彈跳 600ms、愛心 900ms 取長者）
    const REACT_INTERVAL_MS = 1200;        // 同一隻吉祥物兩次反應的最小間隔（限流）
    const MOTION_CLASSES = ['mm-blink', 'mm-react'];   // reduced-motion 開啟時要立刻拔掉的一次性 class
```

`let scheduler = null;` 之後加一行：

```javascript
    let tapLimiter = createRateLimiter(REACT_INTERVAL_MS);
```

把 `/** reduced-motion 生效的瞬間：拔掉所有一次性動畫 class，畫面回到靜止姿勢。 */` 連同底下的 `function clearTransientMotion() {…}` 整段換成：

```javascript
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
```

`init()` 裡，`document.addEventListener('visibilitychange', onVisibilityChange);` 下一行加：

```javascript
        document.addEventListener('click', onDocumentClick);
```

`teardown()` 裡，`document.removeEventListener('visibilitychange', onVisibilityChange);` 下一行加：

```javascript
        document.removeEventListener('click', onDocumentClick);
        tapLimiter = createRateLimiter(REACT_INTERVAL_MS);
```

檔尾的回傳物件（`return { init: init, … }`；注意 `init()` 裡建排程器的 deps 也有一行 `blink: blink,`，不是那一行）：`blink: blink,` 之後加 `react: react,`；`_test: {` 的第一個成員加 `isTapAllowed: isTapAllowed,`。

- [ ] **Step 7: 反應 CSS**

`desktop/css/mascot.css`：在 `@keyframes mm-blink …` 那行之後、`/* 分頁隱藏時（html.mm-paused…` 之前插入：

```css
/* 點擊反應（v2.6 motion Task 6）：彈跳＋換開心臉＋小愛心。只有模板標了 data-mm-tap 的
   吉祥物（登入歡迎、空狀態）會被 mascot_motion.js 加上 .mm-react（聊天區、彩蛋浮層永不）。
   這條要排在待機呼吸之後：同 specificity，後寫的蓋掉呼吸，反應期間暫停呼吸。 */
svg[data-mm-tap] { cursor: pointer; }
svg.mm-react .mm-rig { animation: mm-bounce 600ms cubic-bezier(.3, .7, .4, 1) 1; }
svg.mm-react .mm-face-rest, svg.mm-react .mm-zzz { visibility: hidden; }
svg.mm-react .mm-face-alt { visibility: visible; }
.mm-heart { transform-box: fill-box; transform-origin: 50% 100%; animation: mm-heart 900ms ease-out 1 both; }
@keyframes mm-bounce {
    0%   { transform: translateY(0) scale(1, 1); }
    18%  { transform: translateY(0) scale(1.06, .9); }
    45%  { transform: translateY(-9%) scale(.97, 1.05); }
    72%  { transform: translateY(0) scale(1.04, .96); }
    100% { transform: translateY(0) scale(1, 1); }
}
@keyframes mm-heart {
    0%   { transform: translateY(6px) scale(.3); opacity: 0; }
    25%  { transform: translateY(0) scale(1.15); opacity: 1; }
    45%  { transform: translateY(-4px) scale(1); opacity: 1; }
    100% { transform: translateY(-26px) scale(.9); opacity: 0; }
}
```

reduce 區塊整段換成：

```css
@media (prefers-reduced-motion: reduce) {
    .mascot-sway, .mascot-dots span, .mascot-egg svg { animation: none !important; }
    .mascot-egg { transition: none; }
    svg[data-mm-idle] .mm-rig, svg[data-mm-idle][data-mm-pose="sleep"] .mm-zzz,
    svg.mm-blink .mm-eyes[data-mm-eyes="dot"],
    svg.mm-react .mm-rig, .mm-heart { animation: none !important; }
}
```

- [ ] **Step 8: harness 場景**

`desktop/tools/motion/harness.js` 的 `SCENES`：在 `'blink'` 場景之後、結尾 `};` 之前插入：

```javascript
        // --- Task 6 點擊反應 -----------------------------------------------------
        'react-welcome': {
            viewport: [220, 200], frames: [0, 120, 260, 420, 600, 850],
            setup: (stage) => MascotMotion.react(mount(stage, MascotModule.welcomeHtml()).querySelector('svg')),
        },
        'react-calendar': {
            viewport: [240, 220], frames: [0, 120, 260, 420, 600, 850],
            setup: (stage) => MascotMotion.react(mount(stage, MascotModule.emptyHtml('calendar', '')).querySelector('svg')),
        },
        'react-sleep': {
            viewport: [240, 220], frames: [0, 120, 260, 420, 600, 850],
            setup: (stage) => MascotMotion.react(mount(stage, MascotModule.emptyHtml('diary', '')).querySelector('svg')),
        },
```

- [ ] **Step 9: 跑測試確認通過**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/mascot_react.test.js tests/mascot_rig.test.js tests/mascot_idle.test.js tests/mascot_motion.test.js tests/reduced_motion_css.test.js tests/motion_tools.test.js`
Expected: 全 passed（rig 測試的 `REST_FACE`／`atRest` 本來就排除隱藏的反應臉）。

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run`
Expected: `560 passed (560)`。

Run: `cd /home/e604/Brian/URDiary/desktop && node tools/motion/pose-identity.js | tail -1 && node tools/motion/capture-frames.js --reduced | tail -1`
Expected: `pose identity: OK …`（反應臉是 `visibility="hidden"`，靜止不畫）與 `reduced motion: all 10 scenes static`。

Run: `cd /home/e604/Brian/URDiary/desktop && npx playwright test 2>&1 | tail -3`
Expected: `16 passed`（document 層級點擊委派不影響任何既有點擊）。

- [ ] **Step 10: 影格審查（Fable）**

Run: `cd /home/e604/Brian/URDiary/desktop && node tools/motion/capture-frames.js react-welcome react-calendar react-sleep`

看 contact sheet，三列各 0／120／260／420／600／850 ms：120 壓扁（寬 +6%、高 −10%，腳底貼地）、260 跳到最高（約 9% 身高）＋愛心放到最大、420–600 回彈＋笑眼腮紅＋愛心往上飄、850 愛心幾乎透明、身體回原樣。睡覺姿勢：zzz 消失、臉換成笑臉（「被叫醒很開心」）；舉月曆姿勢：笑臉對齊原本右移 3 的臉，不歪。愛心在頭頂、不壓到月曆紙與問號；最高點若與書頁頂端重疊太多，調 `reactionHeartSvg` 的 `translate(108 50)`。

- [ ] **Step 11: Commit**

```bash
cd /home/e604/Brian/URDiary
git add desktop/js/mascot.js desktop/js/mascot_motion.js desktop/css/mascot.css desktop/tools/motion/harness.js desktop/tests/mascot_react.test.js
git commit -m "feat(吉祥物動畫): 點擊吉祥物的反應——彈跳、開心臉、小愛心

只給登入歡迎與空狀態（data-mm-tap）；聊天訊息區與彩蛋浮層永不反應；
每隻 1.2 秒限流；reduced-motion 下不動、偏好切換時立即收掉。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 登入頁——眼睛跟隨游標（觸控：看向點擊處再回正）＋開框揮手

**目標**：登入框的揮手吉祥物（全 App 唯一帶 `data-mm-follow` 的一隻）看向游標：位移夾在 6（viewBox 單位，110px 顯示約 3px），嘴與腮紅只跟一半像在轉頭；觸控裝置沒有 hover，改成「看向點擊處、700ms 後回正」。每次開登入框（`main.js` 每次都重新注入 `welcomeHtml()`）手臂揮一次。契約 §4 把揮手歡迎的眼睛定為瞇瞇笑眼（沒有瞳孔），所以「眼睛跟隨」做成整張臉看過去，不改成豆豆眼。滑鼠事件在 document 層級共用一個監聽、以 `requestAnimationFrame` 合併；對話框關著（吉祥物不在畫面上）什麼都不算。`main.js` 不需要改。

**Files:**
- Modify: `desktop/js/mascot.js`（`welcomeHtml` 加 `data-mm-follow`）
- Modify: `desktop/js/mascot_motion.js`（常數、`computeLookOffset`、跟隨狀態、`faceCenter`／`applyLook`／`lookAt`／`settle`／指標事件、`clearTransientMotion`、`init`／`teardown`、exports）
- Modify: `desktop/css/mascot.css`（揮手＋跟隨平滑＋reduce）
- Modify: `desktop/tools/motion/harness.js`（六個場景＋`lookScene` helper）
- Test: `desktop/tests/mascot_follow.test.js`

**Interfaces:**
- Consumes: `isShown`、`MOTION_CLASSES`、`clearTransientMotion`（Task 4）；rig 的 `.mm-face .mm-eyes`／`.mm-mouth`／`.mm-blush`／`.mm-arm-r`（Task 2）。
- Produces:
  - `MascotMotion.lookAt(svg, clientX, clientY) → boolean`（reduce、非 follow、量不到幾何 → false）；`MascotMotion.settle(svg)`（回正，非 reduce 時加 `mm-settle` 走慢速過渡）。
  - `MascotMotion._test.computeLookOffset(from, to, max, reach) → {x, y}`（純函式，長度 ≤ max）。
  - 旗標 `data-mm-follow`（只有 `welcomeHtml()`）；CSS：`svg[data-mm-pose="wave"] .mm-arm-r` 一次性 `mm-wave`（Task 9 的進場浮層同一個揮手）；`.mm-arm-r`／`.mm-arm-l` 的 `transform-origin`（肩膀；`mm-arm-l` 給 Task 9）。

- [ ] **Step 1: 寫失敗測試**

`desktop/tests/mascot_follow.test.js`（jsdom 量不到 SVG 幾何：`getBBox`／`getScreenCTM` 用替身把臉中心固定在螢幕 (500, 300)；jsdom 沒有 `PointerEvent`，用 `MouseEvent` 補上 `pointerType`）：

```javascript
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadScript } from './helpers/load.js';

/**
 * v2.6 motion Task 7：登入頁眼睛跟隨（位移夾限、觸控看向點擊處再回正）＋揮手。
 * jsdom 量不到 SVG 幾何：getBBox／getScreenCTM 用替身，讓「臉中心」固定在螢幕 (500, 300)。
 */
const FACE = { x: 500, y: 300 };

function pointer(type, x, y, pointerType) {
    const ev = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    Object.defineProperty(ev, 'pointerType', { value: pointerType });
    document.dispatchEvent(ev);
}

const t = (sel) => document.querySelector(`#login svg ${sel}`).style.transform;

describe('computeLookOffset（純函式）', () => {
    beforeEach(() => { loadScript('js/mascot_motion.js'); });
    const f = (to) => MascotMotion._test.computeLookOffset(FACE, to, 6, 240);

    it('遠處（超過 reach）：方向正確、長度夾在 6', () => {
        expect(f({ x: 2000, y: 300 })).toEqual({ x: 6, y: 0 });
        expect(f({ x: 500, y: -900 })).toEqual({ x: 0, y: -6 });
        const d = f({ x: -1000, y: 1800 });
        expect(Math.hypot(d.x, d.y)).toBeCloseTo(6, 10);
        expect(d.x).toBeLessThan(0);
        expect(d.y).toBeGreaterThan(0);
    });

    it('reach 內線性縮小：距離 120（reach 一半）→ 長度 3', () => {
        const d = f({ x: 620, y: 300 });
        expect(d.x).toBeCloseTo(3, 10);
        expect(d.y).toBeCloseTo(0, 10);
    });

    it('游標就在臉上或輸入非有限值：不動', () => {
        expect(f({ x: 500.2, y: 300.1 })).toEqual({ x: 0, y: 0 });
        expect(f({ x: NaN, y: 300 })).toEqual({ x: 0, y: 0 });
    });

    it('任何方向、任何距離都不超過上限（網格掃描）', () => {
        for (let x = -3000; x <= 3000; x += 250) {
            for (let y = -3000; y <= 3000; y += 250) {
                const d = f({ x, y });
                expect(Math.hypot(d.x, d.y)).toBeLessThanOrEqual(6 + 1e-9);
            }
        }
    });
});

describe('跟隨的 DOM 接線', () => {
    let reducedListeners;
    beforeEach(() => {
        vi.useFakeTimers();
        reducedListeners = [];
        Element.prototype.checkVisibility = function () { return true; };
        // 眼睛群組中心 = (500, 300)：bbox 中心 (100, 50)、父層矩陣位移 (400, 250)
        window.SVGElement.prototype.getBBox = function () { return { x: 90, y: 45, width: 20, height: 10 }; };
        window.SVGElement.prototype.getScreenCTM = function () { return { a: 1, b: 0, c: 0, d: 1, e: 400, f: 250 }; };
        loadScript('js/mascot.js');
        loadScript('js/mascot_motion.js');
        document.body.innerHTML =
            `<div id="login">${MascotModule.welcomeHtml()}</div>` +
            `<div id="empty">${MascotModule.emptyHtml('calendar', 'x')}</div>`;
    });
    afterEach(() => {
        MascotMotion._test.teardown();
        delete Element.prototype.checkVisibility;
        delete window.SVGElement.prototype.getBBox;
        delete window.SVGElement.prototype.getScreenCTM;
        delete window.matchMedia;
        vi.useRealTimers();
    });

    it('只有登入歡迎帶 data-mm-follow', () => {
        expect(document.querySelector('#login svg').hasAttribute('data-mm-follow')).toBe(true);
        expect(document.querySelector('#empty svg').hasAttribute('data-mm-follow')).toBe(false);
    });

    it('滑鼠：pointermove 合併到下一個畫格才算；眼睛到上限、嘴與腮紅跟一半', () => {
        MascotMotion.init();
        pointer('pointermove', 3000, 300, 'mouse');
        expect(t('.mm-face .mm-eyes')).toBe('');          // 還沒到 rAF
        vi.advanceTimersByTime(20);
        expect(t('.mm-face .mm-eyes')).toBe('translate(6.00px, 0.00px)');
        expect(t('.mm-face .mm-mouth')).toBe('translate(3.00px, 0.00px)');
        expect(t('.mm-blush')).toBe('translate(3.00px, 0.00px)');
        expect(document.querySelector('#empty svg .mm-eyes').style.transform).toBe('');   // 非跟隨吉祥物不動
    });

    it('觸控：pointerdown 立刻看向點擊處，700ms 後回正並帶 mm-settle', () => {
        MascotMotion.init();
        pointer('pointerdown', 500, -2000, 'touch');
        expect(t('.mm-face .mm-eyes')).toBe('translate(0.00px, -6.00px)');
        vi.advanceTimersByTime(699);
        expect(t('.mm-face .mm-eyes')).toBe('translate(0.00px, -6.00px)');
        vi.advanceTimersByTime(1);
        expect(t('.mm-face .mm-eyes')).toBe('');
        expect(document.querySelector('#login svg').classList.contains('mm-settle')).toBe(true);
    });

    it('觸控的 pointermove 不觸發滑鼠式跟隨（手指拖曳時不亂轉）', () => {
        MascotMotion.init();
        pointer('pointermove', 3000, 300, 'touch');
        vi.advanceTimersByTime(20);
        expect(t('.mm-face .mm-eyes')).toBe('');
    });

    it('不在畫面上的登入吉祥物（對話框關著）不動', () => {
        document.querySelector('#login svg').checkVisibility = () => false;
        MascotMotion.init();
        pointer('pointermove', 3000, 300, 'mouse');
        vi.advanceTimersByTime(20);
        expect(t('.mm-face .mm-eyes')).toBe('');
    });

    it('reduced-motion：不跟隨；跟隨中切成 reduce 立刻回正', () => {
        let reduce = false;
        window.matchMedia = vi.fn(() => ({ get matches() { return reduce; },
            addEventListener: (type, fn) => reducedListeners.push(fn), removeEventListener: () => {} }));
        MascotMotion.init();
        pointer('pointermove', 3000, 300, 'mouse');
        vi.advanceTimersByTime(20);
        expect(t('.mm-face .mm-eyes')).toBe('translate(6.00px, 0.00px)');
        reduce = true;
        reducedListeners.forEach((fn) => fn({ matches: true }));
        expect(t('.mm-face .mm-eyes')).toBe('');
        pointer('pointermove', 0, 300, 'mouse');
        vi.advanceTimersByTime(20);
        expect(t('.mm-face .mm-eyes')).toBe('');
        pointer('pointerdown', 0, 300, 'touch');
        expect(t('.mm-face .mm-eyes')).toBe('');
    });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/mascot_follow.test.js`
Expected: FAIL（`8 failed | 2 passed`：`computeLookOffset is not a function`、`welcomeHtml` 沒有 `data-mm-follow`、沒有任何 transform 被寫入）。

- [ ] **Step 3: `mascot.js`——登入歡迎帶跟隨旗標**

`welcomeHtml` 換成：

```javascript
    // 登入歡迎：待機＋可點＋眼睛跟隨游標（data-mm-follow 全 App 只有這一隻）
    function welcomeHtml() { return `<div class="mascot-welcome">${svg220(POSE_WAVE, 110, 'wave', 'data-mm-idle data-mm-tap data-mm-follow')}</div>`; }
```

- [ ] **Step 4: `mascot_motion.js`——常數與純函式**

`const MOTION_CLASSES = …` 那行換成：

```javascript
    const MOTION_CLASSES = ['mm-blink', 'mm-react', 'mm-settle'];   // reduced-motion 開啟時要立刻拔掉的 class
    const LOOK_MAX = 6;                    // 眼睛最大位移（viewBox 單位；110px 的登入吉祥物約 3px）
    const LOOK_REACH_PX = 240;             // 游標離臉這麼遠（螢幕 px）就到最大位移，更近則線性縮小
    const LOOK_PARALLAX = 0.5;             // 嘴與腮紅只跟一半：像轉頭，不像只有眼珠在滑
    const TOUCH_SETTLE_MS = 700;           // 觸控：看向點擊處多久後回正
```

在 `createIdleScheduler` 的說明註解（`/**` 開頭、「共用待機排程器——全頁只有一個計時器」）之前插入：

```javascript
    /**
     * 眼睛跟隨：從臉中心 from 看向 to（兩者皆螢幕座標 px），回傳位移（viewBox 單位）。
     * 方向＝from→to，長度＝max × min(1, 距離/reach)——永遠 ≤ max；距離 < 0.5px 或
     * 非有限值回 {0,0}。
     */
    function computeLookOffset(from, to, max, reach) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.hypot(dx, dy);
        if (!isFinite(dist) || dist < 0.5) return { x: 0, y: 0 };
        const k = (max * Math.min(1, dist / reach)) / dist;
        return { x: dx * k, y: dy * k };
    }

```

- [ ] **Step 5: `mascot_motion.js`——跟隨的 DOM 層**

`let tapLimiter = createRateLimiter(REACT_INTERVAL_MS);` 之後加：

```javascript
    let lastPointer = null;                // 最近一次滑鼠／筆的位置（rAF 合併後才計算）
    let lookFrame = null;
    let settleTimers = new WeakMap();      // 觸控回正計時器（每次觸控一次性，不是常駐）
```

把 `/** reduced-motion 生效的瞬間：拔掉所有一次性動畫 class 與愛心，畫面回到靜止姿勢。 */` 連同底下的 `function clearTransientMotion() {…}` 整段換成：

```javascript
    /** 臉（靜止臉的眼睛群組中心）在螢幕上的位置；環境量不到（jsdom、未渲染）回 null。 */
    function faceCenter(svg) {
        const eyes = svg.querySelector('.mm-face:not(.mm-face-alt) .mm-eyes');
        if (!eyes || typeof eyes.getBBox !== 'function' || !eyes.parentNode ||
            typeof eyes.parentNode.getScreenCTM !== 'function') return null;
        const box = eyes.getBBox();
        const m = eyes.parentNode.getScreenCTM();   // 父層矩陣：量「沒被跟隨位移過」的位置
        if (!m) return null;
        const px = box.x + box.width / 2;
        const py = box.y + box.height / 2;
        return { x: m.a * px + m.c * py + m.e, y: m.b * px + m.d * py + m.f };
    }

    /** 寫入眼睛／嘴／腮紅的 inline transform；off＝null 表示回正。 */
    function applyLook(svg, off) {
        function set(selector, k) {
            svg.querySelectorAll(selector).forEach(function (el) {
                el.style.transform = off
                    ? 'translate(' + (off.x * k).toFixed(2) + 'px, ' + (off.y * k).toFixed(2) + 'px)'
                    : '';
            });
        }
        set('.mm-face .mm-eyes', 1);
        set('.mm-face .mm-mouth', LOOK_PARALLAX);
        set('.mm-blush', LOOK_PARALLAX);
    }

    /** 讓一隻 data-mm-follow 吉祥物看向螢幕座標 (x, y)。回傳是否真的轉了。 */
    function lookAt(svg, x, y) {
        if (reduced || !svg || !svg.hasAttribute('data-mm-follow')) return false;
        const c = faceCenter(svg);
        if (!c) return false;
        svg.classList.remove('mm-settle');
        applyLook(svg, computeLookOffset(c, { x: x, y: y }, LOOK_MAX, LOOK_REACH_PX));
        return true;
    }

    /** 回正（觸控看完、或 reduced-motion 生效時）。 */
    function settle(svg) {
        if (!reduced) svg.classList.add('mm-settle');
        applyLook(svg, null);
    }

    function followers() {
        return Array.prototype.filter.call(document.querySelectorAll('svg[data-mm-follow]'), isShown);
    }

    function flushLook() {
        lookFrame = null;
        if (!lastPointer || reduced) return;
        followers().forEach(function (svg) { lookAt(svg, lastPointer.x, lastPointer.y); });
    }

    // 滑鼠／筆：pointermove 只記位置，一個 rAF 內合併成一次計算（全頁共用，不是每隻各綁）
    function onPointerMove(event) {
        if (reduced || event.pointerType === 'touch') return;
        lastPointer = { x: event.clientX, y: event.clientY };
        if (lookFrame === null) lookFrame = requestAnimationFrame(flushLook);
    }

    // 觸控：沒有 hover，改成「看向點擊處，TOUCH_SETTLE_MS 後回正」
    function onPointerDown(event) {
        if (reduced || event.pointerType !== 'touch') return;
        followers().forEach(function (svg) {
            if (!lookAt(svg, event.clientX, event.clientY)) return;
            clearTimeout(settleTimers.get(svg));
            settleTimers.set(svg, setTimeout(function () { settle(svg); }, TOUCH_SETTLE_MS));
        });
    }

    /** reduced-motion 生效的瞬間：拔掉所有一次性動畫 class、愛心、跟隨位移，回到靜止姿勢。 */
    function clearTransientMotion() {
        MOTION_CLASSES.forEach(function (cls) {
            document.querySelectorAll('.' + cls).forEach(function (el) { el.classList.remove(cls); });
        });
        removeHearts(document);
        document.querySelectorAll('svg[data-mm-follow]').forEach(function (svg) { applyLook(svg, null); });
    }
```

`init()` 裡，`document.addEventListener('click', onDocumentClick);` 下一行加：

```javascript
        document.addEventListener('pointermove', onPointerMove, { passive: true });
        document.addEventListener('pointerdown', onPointerDown, { passive: true });
```

`teardown()` 裡，`document.removeEventListener('click', onDocumentClick);` 下一行加：

```javascript
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerdown', onPointerDown);
        if (lookFrame !== null) { cancelAnimationFrame(lookFrame); lookFrame = null; }
        lastPointer = null;
        settleTimers = new WeakMap();
```

回傳物件：`react: react,` 之後加 `lookAt: lookAt,` 與 `settle: settle,`；`_test` 裡 `isTapAllowed` 之後加 `computeLookOffset: computeLookOffset,`。

（眼睛群組同時可能被 CSS 動畫改 transform——眨眼的 `scaleY` 會在動畫期間蓋過這裡的 inline translate；跟隨只用在揮手歡迎，它是笑眼、不眨眼，所以不衝突。）

- [ ] **Step 6: CSS——揮手與跟隨平滑**

`desktop/css/mascot.css`：在 `@keyframes mm-heart { … }` 區塊之後、`/* 分頁隱藏時…` 之前插入：

```css
/* 揮手姿勢一出現就揮一次（v2.6 motion Task 7）：登入框每次開啟都重新注入 welcomeHtml()，
   所以「每次開登入框揮一次」；之後 Task 9 的 onboarding 進場浮層用同一個姿勢、同一個揮手。
   支點＝肩膀＝手臂群組外框的左下角。 */
.mm-arm-r, .mm-arm-l { transform-box: fill-box; }
.mm-arm-r { transform-origin: 0% 100%; }
.mm-arm-l { transform-origin: 100% 100%; }
svg[data-mm-pose="wave"] .mm-arm-r { animation: mm-wave 1.2s ease-in-out 1; }
@keyframes mm-wave {
    0%, 100% { transform: rotate(0deg); }
    20% { transform: rotate(-16deg); }
    40% { transform: rotate(8deg); }
    60% { transform: rotate(-14deg); }
    80% { transform: rotate(5deg); }
}

/* 眼睛跟隨（v2.6 motion Task 7）：mascot_motion.js 直接寫 inline transform（位移量隨游標變），
   這裡只給平滑；.mm-settle＝觸控後回正，放慢一點。 */
svg[data-mm-follow] .mm-face .mm-eyes, svg[data-mm-follow] .mm-face .mm-mouth,
svg[data-mm-follow] .mm-blush { transition: transform 140ms ease-out; }
svg[data-mm-follow].mm-settle .mm-face .mm-eyes, svg[data-mm-follow].mm-settle .mm-face .mm-mouth,
svg[data-mm-follow].mm-settle .mm-blush { transition-duration: 420ms; transition-timing-function: ease-in-out; }
```

reduce 區塊整段換成：

```css
@media (prefers-reduced-motion: reduce) {
    .mascot-sway, .mascot-dots span, .mascot-egg svg { animation: none !important; }
    .mascot-egg { transition: none; }
    svg[data-mm-idle] .mm-rig, svg[data-mm-idle][data-mm-pose="sleep"] .mm-zzz,
    svg.mm-blink .mm-eyes[data-mm-eyes="dot"],
    svg.mm-react .mm-rig, .mm-heart,
    svg[data-mm-pose="wave"] .mm-arm-r { animation: none !important; }
    svg[data-mm-follow] .mm-face .mm-eyes, svg[data-mm-follow] .mm-face .mm-mouth,
    svg[data-mm-follow] .mm-blush { transition: none !important; }
}
```

- [ ] **Step 7: harness 場景**

`desktop/tools/motion/harness.js` 的 `SCENES`：在 `'react-sleep'` 之後、結尾 `};` 之前插入：

```javascript
        // --- Task 7 登入頁：揮手一次＋眼睛跟隨 ------------------------------------
        'login-wave': {
            viewport: [220, 200], frames: [0, 240, 480, 720, 960, 1200],
            setup: (stage) => mount(stage, MascotModule.welcomeHtml()),
        },
        'follow-right': { viewport: [320, 240], frames: [0, 70, 140], setup: (stage) => lookScene(stage, 1, 0.5) },
        'follow-left': { viewport: [320, 240], frames: [0, 70, 140], setup: (stage) => lookScene(stage, 0, 0.5) },
        'follow-up': { viewport: [320, 240], frames: [0, 70, 140], setup: (stage) => lookScene(stage, 0.5, 0) },
        'follow-down': { viewport: [320, 240], frames: [0, 70, 140], setup: (stage) => lookScene(stage, 0.5, 1) },
        'touch-settle': {
            viewport: [320, 240], frames: [0, 210, 420],
            setup: (stage) => {
                const svg = lookScene(stage, 0, 0);                  // 先看向左上角
                document.getAnimations().forEach((a) => a.finish());  // 看的過渡直接走完
                MascotMotion.settle(svg);                             // 影格＝回正過程
            },
        },
```

`SCENES` 結尾 `};` 之後、`function list()` 之前插入：

```javascript

    // 眼睛跟隨場景：游標放在視窗的相對位置 (fx, fy)；揮手與呼吸先取消，只看跟隨的過渡
    function lookScene(stage, fx, fy) {
        const svg = mount(stage, MascotModule.welcomeHtml()).querySelector('svg');
        document.getAnimations().forEach((a) => a.cancel());
        MascotMotion.lookAt(svg, fx * innerWidth, fy * innerHeight);
        return svg;
    }
```

- [ ] **Step 8: 跑測試確認通過**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/mascot_follow.test.js tests/mascot_react.test.js tests/mascot_motion.test.js tests/reduced_motion_css.test.js tests/motion_tools.test.js`
Expected: 全 passed。

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run`
Expected: `570 passed (570)`。

Run: `cd /home/e604/Brian/URDiary/desktop && node tools/motion/pose-identity.js | tail -1 && node tools/motion/capture-frames.js --reduced | tail -1`
Expected: `pose identity: OK …` 與 `reduced motion: all 16 scenes static`。

- [ ] **Step 9: 影格審查（Fable）**

Run: `cd /home/e604/Brian/URDiary/desktop && node tools/motion/capture-frames.js login-wave follow-left follow-right follow-up follow-down touch-settle`

- `login-wave` 0／240／480／720／960／1200 ms：手臂以肩膀為軸往上甩（−16°）、往回（+8°）、再一次，1200 ms 回原位；手不脫離肩膀。
- `follow-*` 0／70／140 ms：140 ms 時整張臉明顯偏向該方向（眼睛約 3px、嘴與腮紅約一半），不出書皮框。已知觀察點：`follow-right` 右腮紅會壓到書皮右描邊（它靜止時就貼著邊）——若看起來髒，把 `LOOK_PARALLAX` 從 0.5 降到 0.3。
- `touch-settle` 0／210／420 ms：從左上回正，420 ms 完全置中。

另外手動確認一次（不必截圖）：`file:///home/e604/Brian/URDiary/desktop/tools/motion/harness.html?scene=idle-breathe` 用滑鼠在頁面上移動，臉會跟著轉、移開視窗不會亂跳。

- [ ] **Step 10: Commit**

```bash
cd /home/e604/Brian/URDiary
git add desktop/js/mascot.js desktop/js/mascot_motion.js desktop/css/mascot.css desktop/tools/motion/harness.js desktop/tests/mascot_follow.test.js
git commit -m "feat(吉祥物動畫): 登入頁吉祥物看向游標＋開框揮手

位移夾限 6（嘴與腮紅跟一半＝轉頭感）；觸控看向點擊處 700ms 後回正；
document 層級共用監聽＋rAF 合併，不在畫面上不計算；reduce 下靜態。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 存日記彩蛋升級（翻頁＋書籤飄動＋金星依序亮）

**目標**：開心版彩蛋（跳起來那隻）在既有的 pop 進場上多三件事：書籤從上緣為軸飄動、兩張書頁從書頂以書脊為軸翻過去（第二張晚 180ms）、三顆金星依序亮起。**不變的硬規則**：`valence < 0.45` 仍然沒有彩蛋（`eggKindFor` 不動）、夜間晚安版照舊、1200ms 開始淡出 1800ms 移除、浮層 `pointer-events: none` 永不擋操作。翻頁紙在靜止畫面不畫（`opacity="0"` 簡報屬性，動畫才帶出來），所以 reduce 下彩蛋長得跟今天一模一樣。

**Files:**
- Modify: `desktop/js/mascot.js`（`FLIP_PAGE`、`POSE_JUMP` 最後一行、`showSaveEgg` 的 class）
- Modify: `desktop/css/mascot.css`（彩蛋升級段＋reduce）
- Modify: `desktop/tools/motion/harness.js`（`egg-happy` 加影格）
- Test: `desktop/tests/mascot_egg.test.js`

**Interfaces:**
- Consumes: rig 的 `.mm-bookmark`／`.mm-stars`（Task 2）；Task 2 rig 測試的 `atRest`（排除 `opacity="0"`）。
- Produces: 開心版彩蛋外層 class `mascot-egg mascot-egg-happy`（晚安版 `mascot-egg mascot-egg-night`）——**翻頁／書籤／金星的 CSS 只認 `.mascot-egg-happy`**，Task 9 的初次見面浮層不會誤吃這些動畫；`POSE_JUMP` 內 `.mm-flip > .mm-flip-page[opacity="0"]` ×2；keyframes `mm-flutter`／`mm-page-flip`／`mm-twinkle`（Task 9 重用 `mm-twinkle`）。

- [ ] **Step 1: 寫失敗測試**

`desktop/tests/mascot_egg.test.js`：

```javascript
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadScript } from './helpers/load.js';

/**
 * v2.6 motion Task 8：存日記彩蛋升級（翻頁＋書籤飄動＋金星依序亮）。
 * 不變的硬規則：quiet（valence<0.45）沒有彩蛋、夜間版照舊、1.2 秒開始淡出 1.8 秒移除、
 * 浮層 pointer-events:none 不擋操作；翻頁紙在靜止畫面不畫（opacity="0"）。
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('存日記彩蛋', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
        loadScript('js/mascot.js');
    });
    afterEach(() => { vi.useRealTimers(); });

    it('開心版：兩張翻頁紙（靜止不畫）、書籤在、只用書頁色＋描邊色', () => {
        MascotModule.showSaveEgg('happy');
        const egg = document.querySelector('.mascot-egg');
        expect(egg.classList.contains('mascot-egg-happy')).toBe(true);    // 翻頁 CSS 只認這個 class
        expect(egg.classList.contains('mascot-egg-night')).toBe(false);
        const pages = egg.querySelectorAll('.mm-flip .mm-flip-page');
        expect(pages.length).toBe(2);
        pages.forEach((p) => {
            expect(p.getAttribute('opacity')).toBe('0');
            expect(p.getAttribute('fill')).toBe('#f9f3e6');
            expect(p.getAttribute('stroke')).toBe('#4b2e1e');
            expect(p.hasAttribute('transform')).toBe(false);   // CSS 翻頁動畫才掛得上
        });
        expect(egg.querySelector('.mm-bookmark')).not.toBeNull();
    });

    it('晚安版：照舊（沒有翻頁紙）', () => {
        MascotModule.showSaveEgg('goodnight');
        const egg = document.querySelector('.mascot-egg.mascot-egg-night');
        expect(egg).not.toBeNull();
        expect(egg.querySelector('.mm-flip-page')).toBeNull();
    });

    it('quiet：沒有彩蛋', () => {
        MascotModule.showSaveEgg('quiet');
        expect(document.querySelector('.mascot-egg')).toBeNull();
    });

    it('時間軸不變：1200ms 加 fade、1800ms 移除', () => {
        MascotModule.showSaveEgg('happy');
        const egg = document.querySelector('.mascot-egg');
        vi.advanceTimersByTime(1199);
        expect(egg.classList.contains('fade')).toBe(false);
        vi.advanceTimersByTime(1);
        expect(egg.classList.contains('fade')).toBe(true);
        vi.advanceTimersByTime(600);
        expect(document.querySelector('.mascot-egg')).toBeNull();
    });

    it('浮層永不擋操作：mascot.css 的 .mascot-egg 帶 pointer-events: none', () => {
        const css = fs.readFileSync(path.resolve(__dirname, '..', 'css', 'mascot.css'), 'utf8');
        const rule = css.match(/\.mascot-egg\s*\{([^}]*)\}/);
        expect(rule).not.toBeNull();
        expect(rule[1]).toMatch(/pointer-events:\s*none/);
    });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/mascot_egg.test.js`
Expected: FAIL（`1 failed | 4 passed`：開心版沒有翻頁紙、沒有 `mascot-egg-happy`；其餘四支是「硬規則不變」的回歸鎖，本來就過）。

- [ ] **Step 3: `mascot.js`——翻頁紙與開心版 class**

在 `const POSE_JUMP =` 之前插入：

```javascript
    // 存日記彩蛋升級（v2.6 motion Task 8）：兩張從書頂翻起的書頁（同形，第二張晚一拍）。
    // 靜止畫面不畫——opacity="0" 簡報屬性，mascot.css 的 mm-page-flip 動畫才把它們帶出來；
    // 頁的左緣就是書脊 x=100，CSS 以 fill-box 的 0% 為翻頁軸。
    const FLIP_PAGE = `<path class="mm-flip-page" opacity="0" d="M100 80 q20 -26 44 -16 l-2 16 q-22 -8 -42 12 z" fill="#f9f3e6" stroke="${OUTLINE}" stroke-width="5" stroke-linejoin="round"/>`;

```

`POSE_JUMP` 的最後一行換成：

```javascript
      `<g transform="translate(0 -18)">${BASE_BOOK}${FACE_HAPPY}${part('flip', FLIP_PAGE + FLIP_PAGE)}</g>`;
```

`showSaveEgg` 裡的 `wrap.className = …` 那行換成：

```javascript
        // mascot-egg-happy（v2.6 motion Task 8）：翻頁／書籤／金星的 CSS 只認這個 class
        wrap.className = 'mascot-egg ' + (kind === 'goodnight' ? 'mascot-egg-night' : 'mascot-egg-happy');
```

- [ ] **Step 4: 彩蛋升級 CSS**

`desktop/css/mascot.css`：在 `@keyframes mascot-pop { … }` 那行之後、`.mascot-cat-icon { vertical-align: middle; }` 之前插入：

```css
/* 存日記彩蛋升級（v2.6 motion Task 8）：開心版（.mascot-egg-happy）多了書籤飄動、兩張翻頁、
   金星依序亮起。晚安版（.mascot-egg-night）與安靜版（根本沒有彩蛋）維持原樣。時間軸：0–450ms 既有的
   mascot-pop 進場；翻頁 150–850／330–1030ms；1200ms 起淡出（mascot.js 的計時器不變）。 */
.mascot-egg-happy .mm-bookmark {
    transform-box: fill-box; transform-origin: 50% 0%;
    animation: mm-flutter 900ms ease-in-out 120ms 1 both;
}
.mascot-egg-happy .mm-flip-page {
    transform-box: fill-box; transform-origin: 0% 100%;
    animation: mm-page-flip 700ms ease-in-out 150ms 1 both;
}
.mascot-egg-happy .mm-flip-page + .mm-flip-page { animation-delay: 330ms; }
.mascot-egg-happy .mm-stars path {
    transform-box: fill-box; transform-origin: 50% 50%;
    animation: mm-twinkle 500ms ease-out 1 both;
}
.mascot-egg-happy .mm-stars path:nth-child(2) { animation-delay: 120ms; }
.mascot-egg-happy .mm-stars path:nth-child(3) { animation-delay: 240ms; }
@keyframes mm-flutter {
    0%, 100% { transform: rotate(0deg); }
    20% { transform: rotate(-14deg); }
    45% { transform: rotate(10deg); }
    70% { transform: rotate(-6deg); }
    85% { transform: rotate(3deg); }
}
@keyframes mm-page-flip {
    0%   { transform: scaleX(1) translateY(0); opacity: 0; }
    12%  { opacity: 1; }
    50%  { transform: scaleX(0) translateY(-10px); }
    88%  { opacity: 1; }
    100% { transform: scaleX(-1) translateY(0); opacity: 0; }
}
@keyframes mm-twinkle {
    0%   { transform: scale(0); }
    60%  { transform: scale(1.3); }
    100% { transform: scale(1); }
}
```

reduce 區塊整段換成：

```css
@media (prefers-reduced-motion: reduce) {
    .mascot-sway, .mascot-dots span, .mascot-egg svg { animation: none !important; }
    .mascot-egg { transition: none; }
    svg[data-mm-idle] .mm-rig, svg[data-mm-idle][data-mm-pose="sleep"] .mm-zzz,
    svg.mm-blink .mm-eyes[data-mm-eyes="dot"],
    svg.mm-react .mm-rig, .mm-heart,
    svg[data-mm-pose="wave"] .mm-arm-r,
    .mascot-egg-happy .mm-bookmark, .mascot-egg-happy .mm-flip-page,
    .mascot-egg-happy .mm-stars path { animation: none !important; }
    svg[data-mm-follow] .mm-face .mm-eyes, svg[data-mm-follow] .mm-face .mm-mouth,
    svg[data-mm-follow] .mm-blush { transition: none !important; }
}
```

- [ ] **Step 5: harness——看完整條時間軸**

`desktop/tools/motion/harness.js` 的 `'egg-happy'` 場景，`frames` 改成：

```javascript
            viewport: [320, 280], frames: [0, 150, 300, 450, 600, 800, 1000],
```

- [ ] **Step 6: 跑測試確認通過**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/mascot_egg.test.js tests/mascot_rig.test.js tests/mascot.test.js tests/mascot_chat.test.js tests/reduced_motion_css.test.js`
Expected: 全 passed（`mascot_chat.test.js` 的「負向 valence 不掛彩蛋」「白天版不是晚安版」照舊）。

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run`
Expected: `575 passed (575)`。

Run: `cd /home/e604/Brian/URDiary/desktop && node tools/motion/pose-identity.js | tail -1 && node tools/motion/capture-frames.js --reduced | tail -1`
Expected: `pose identity: OK …`（`egg-happy` 模式 A：翻頁紙 opacity 0，靜止不畫）與 `reduced motion: all 16 scenes static`。

- [ ] **Step 7: 影格審查（Fable）**

Run: `cd /home/e604/Brian/URDiary/desktop && node tools/motion/capture-frames.js egg-happy egg-night`

`egg-happy` 0／150／300／450／600／800／1000 ms：0 在下方縮小（既有 pop）；150–300 第一張頁從書頂右半邊翹起、書籤往左甩；450–600 頁立到垂直（最高、約書頂上方 10 單位）、第二張跟上；800–1000 頁落到左半邊並淡出、書籤回正、三顆星依序亮完。頁的顏色＝書頁米白＋棕描邊，與書頂一體。`egg-night` 與今天相同（沒有翻頁）。頁太小看不出「翻」→ 放大 `FLIP_PAGE` 的路徑（右緣 x 目前到 144）。

- [ ] **Step 8: Commit**

```bash
cd /home/e604/Brian/URDiary
git add desktop/js/mascot.js desktop/css/mascot.css desktop/tools/motion/harness.js desktop/tests/mascot_egg.test.js
git commit -m "feat(吉祥物動畫): 存日記彩蛋升級——翻頁、書籤飄動、金星依序亮

只作用在開心版（.mascot-egg-happy）；安靜版仍無彩蛋、晚安版照舊、
1.2 秒淡出不擋操作；翻頁紙靜止不畫，reduce 下與今天完全相同。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: 初次見面——揮手進場＋帶新名字的取名慶祝

**目標**：onboarding 一啟動（全新開始或中斷續跑，`maybeStart` 真的把流程打開；揮手跟第一則自我介紹／再見面訊息一起出現——已登入的人開 App 時啟動畫面還蓋著，等假思考結束訊息真的出現再揮），畫面中央彈出揮手的吉祥物（Task 7 的揮手）；取名這一步定案時（使用者給了 ≤12 字的名字，或說「隨便／之後再取」拿到預設名字），彈出雙手高舉的慶祝姿勢＋米白名牌寫著新名字，與 `namingAck` 那則訊息同時出現。

**與契約 §4 的調和（Fable 請特別審）**：onboarding 是聊天式的 ephemeral 訊息，而 §4 規定聊天區只准安靜搖擺／靜態。所以兩個動作都**不進 `.chat-messages`**，而是沿用存日記彩蛋的浮層（`position: fixed`、`pointer-events: none`、`aria-hidden`、1.6 秒淡出）；觸發點是兩個**操作事件**（onboarding 啟動——性質等同 check-in，Spec B 明訂「自我介紹就是問候」；取名定案），與答案內容、情緒無關——「隨便」拿到預設名字也照常慶祝，負面字眼當名字也照常慶祝，太長重問／第二次仍太長放棄／跳過取名則沒有名字定案、不慶祝，收束時後端判定改名（更正句）不補慶祝。§4 條列的彩蛋事件（存日記成功、check-in、夜間收尾）沒有字面列出 onboarding——本計畫把它視為同類操作事件，列在文末待 Brian 確認。名字是使用者輸入：一律 `textContent`。另外兩條 Review Focus：浮層整個 `aria-hidden`、一次只留一個浮層。

**Files:**
- Modify: `desktop/js/mascot.js`（`POSE_CHEER`、`POSES` 加 `cheer`、`showSaveEgg` 改走共用 `showEggOverlay`、`showOnboardingEgg`／`showNamingEgg`、exports）
- Modify: `desktop/js/onboarding_module.js`（`celebrate` helper、`maybeStart`、`handleNamingAnswer` 兩個分支）
- Modify: `desktop/css/mascot.css`（初次見面段＋reduce）
- Modify: `desktop/tools/motion/harness.js`（兩個場景）
- Test: `desktop/tests/onboarding_motion.test.js`

**Interfaces:**
- Consumes: 揮手 CSS `svg[data-mm-pose="wave"] .mm-arm-r`、`.mm-arm-l` 的 `transform-origin`（Task 7）；`mm-twinkle`、`.mascot-egg-happy` 分流（Task 8）；Spec B 的 `ChatModule.setScriptDelayRange`／`OnboardingModule._test.reset`／chips。
- Produces:
  - `MascotModule.showOnboardingEgg() → HTMLElement`（`.mascot-egg.mascot-egg-wave`，揮手姿勢）；`MascotModule.showNamingEgg(name) → HTMLElement`（`.mascot-egg.mascot-egg-cheer`，`data-mm-pose="cheer"` 雙手高舉，名牌 `.mascot-egg-name` 以 `textContent` 寫入名字）。
  - 模組內部 `showEggOverlay(variantClass, pose, caption, fadeAtMs)`：先移除所有既有 `.mascot-egg`、外層 `aria-hidden="true"`、`fadeAtMs` 加 `fade`、再 600ms 移除；`showSaveEgg` 改用它（存日記仍是 1200／1800ms）。
  - `OnboardingModule` 內部 `celebrate(kind, name)`，`kind ∈ {'wave','name'}`，`typeof MascotModule` 守衛。
  - 新 rig 使用者：`mm-arm-l` 首次出現（Task 2 預留）。

- [ ] **Step 1: 寫失敗測試**

`desktop/tests/onboarding_motion.test.js`（流程 fixture 比照既有 `tests/onboarding_module.test.js`：延遲設 0、`ApiService` stub；這支另外載入真的 `mascot.js`，用 `vi.spyOn` 觀察兩個浮層函式）：

```javascript
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * v2.6 motion Task 9：初次見面的吉祥物浮層。
 * 契約 §4：只綁兩個操作事件——onboarding 啟動（揮手進場）、取名這一步定案（帶新名字的
 * 慶祝）；不看答案內容與情緒、不進 .chat-messages；名字一律 textContent。
 * 流程 fixture 比照 tests/onboarding_module.test.js（延遲設 0、ApiService stub）。
 */
async function flush() {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
}

function installApi(state, completeResult) {
    window.ApiService = {
        isAuthenticated: () => true,
        getOnboardingState: async () => state,
        saveOnboardingAnswer: async () => ({ saved: true }),
        completeOnboarding: async () => { state.completed = true; return completeResult || { completed: true }; },
        checkIn: async () => ({ checkin: false }),
        fetchAPI: async () => ({}),
    };
}

const REAL = {};   // spy 之前的真實作（beforeEach 每次重新 spy）

beforeAll(() => {
    loadCoreScripts();
    loadScript('js/mascot.js');
    loadScript('js/chat_module.js');
    loadScript('js/onboarding_module.js');
    REAL.showOnboardingEgg = MascotModule.showOnboardingEgg;
});

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('numericUserId', '1');
    document.body.innerHTML = `
        <div class="chat-container">
            <div class="chat-messages"></div>
            <div class="chat-title"></div>
        </div>
        <textarea id="user-input"></textarea>
        <button id="send-button"></button>`;
    ChatModule.setScriptDelayRange(0, 0);
    OnboardingModule._test.reset();
    vi.spyOn(MascotModule, 'showOnboardingEgg');
    vi.spyOn(MascotModule, 'showNamingEgg');
});

afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('.mascot-egg').forEach((el) => el.remove());
});

async function start(state, completeResult) {
    installApi(state, completeResult);
    ChatModule.init();
    await flush();
}

describe('揮手進場：綁在 onboarding 啟動', () => {
    it('全新開始：跟自我介紹訊息一起揮手一次，浮層在 body 上、不在聊天訊息區', async () => {
        let textAtWave = null;
        MascotModule.showOnboardingEgg.mockImplementation(function () {
            textAtWave = document.querySelector('.chat-messages').textContent;
            return REAL.showOnboardingEgg();
        });
        await start({ completed: false, answered_keys: [] });
        expect(MascotModule.showOnboardingEgg).toHaveBeenCalledTimes(1);
        expect(textAtWave).toContain(I18N.t('onboarding.intro'));   // 訊息已出現才揮手
        const egg = document.querySelector('.mascot-egg.mascot-egg-wave');
        expect(egg).not.toBeNull();
        expect(egg.parentNode).toBe(document.body);
        expect(egg.closest('.chat-messages')).toBeNull();
    });

    it('中斷續跑（已答過幾題）：同樣是 onboarding 啟動，揮手一次', async () => {
        await start({ completed: false, answered_keys: ['companion_naming', 'name'] });
        expect(MascotModule.showOnboardingEgg).toHaveBeenCalledTimes(1);
    });

    it('已完成的帳號：不啟動、不揮手', async () => {
        await start({ completed: true, answered_keys: [] });
        expect(MascotModule.showOnboardingEgg).not.toHaveBeenCalled();
    });
});

describe('取名慶祝：綁在取名定案', () => {
    it('給了名字：namingAck 出現之後才慶祝，帶剝好的名字', async () => {
        await start({ completed: false, answered_keys: [] });
        let textAtCelebration = null;
        MascotModule.showNamingEgg.mockImplementation(function (name) {
            textAtCelebration = document.querySelector('.chat-messages').textContent;
            return null;
        });
        OnboardingModule.handleAnswer('我想叫你小樹洞');
        await flush();
        expect(MascotModule.showNamingEgg).toHaveBeenCalledTimes(1);
        expect(MascotModule.showNamingEgg).toHaveBeenCalledWith('小樹洞');
        expect(textAtCelebration).toContain(I18N.t('onboarding.namingAck', { name: '小樹洞' }));
    });

    it('說「隨便」：拿到預設名字，一樣慶祝（觸發只看「這一步定案」，不看說了什麼）', async () => {
        await start({ completed: false, answered_keys: [] });
        OnboardingModule.handleAnswer('隨便');
        await flush();
        expect(MascotModule.showNamingEgg).toHaveBeenCalledWith(I18N.t('onboarding.defaultName'));
    });

    it('名字帶負面字眼也照常慶祝：不做任何情緒判斷', async () => {
        await start({ completed: false, answered_keys: [] });
        OnboardingModule.handleAnswer('難過');
        await flush();
        expect(MascotModule.showNamingEgg).toHaveBeenCalledWith('難過');
    });

    it('名字太長（重問）與第二次仍太長（放棄）：都沒有名字定案，不慶祝', async () => {
        await start({ completed: false, answered_keys: [] });
        OnboardingModule.handleAnswer('這是一個超過十二個字的非常非常長的名字');
        await flush();
        expect(MascotModule.showNamingEgg).not.toHaveBeenCalled();
        OnboardingModule.handleAnswer('這也是一個超過十二個字的非常非常長的名字');
        await flush();
        expect(MascotModule.showNamingEgg).not.toHaveBeenCalled();
    });

    it('跳過取名、收束時後端判定了名字（更正句）：不補慶祝', async () => {
        await start({ completed: false, answered_keys: [] },
                    { completed: true, companion_name: '小澄', companion_name_note: null });
        OnboardingModule.handleSkip();
        await flush();
        document.querySelector('[data-onboarding-start-chat]').click();
        await flush();
        expect(document.querySelector('.chat-messages').textContent)
            .toContain(I18N.t('onboarding.nameCorrected', { name: '小澄' }));
        expect(MascotModule.showNamingEgg).not.toHaveBeenCalled();
    });
});

describe('浮層本身（MascotModule）', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('名牌用 textContent：名字裡的 HTML 原樣顯示、不會變成元素', () => {
        MascotModule.showNamingEgg.mockRestore();
        MascotModule.showNamingEgg('<b>小澄</b>');
        const tag = document.querySelector('.mascot-egg-cheer .mascot-egg-name');
        expect(tag.textContent).toBe('<b>小澄</b>');
        expect(tag.querySelector('b')).toBeNull();
    });

    it('慶祝浮層：雙手高舉姿勢、不可點；1600ms 開始淡出、2200ms 移除', () => {
        MascotModule.showNamingEgg.mockRestore();
        MascotModule.showNamingEgg('小澄');
        const egg = document.querySelector('.mascot-egg-cheer');
        const svg = egg.querySelector('svg');
        expect(svg.getAttribute('data-mm-pose')).toBe('cheer');
        expect(svg.querySelectorAll('.mm-arm-l').length).toBe(1);
        expect(svg.querySelectorAll('.mm-arm-r').length).toBe(1);
        expect(svg.hasAttribute('data-mm-tap')).toBe(false);
        vi.advanceTimersByTime(1600);
        expect(egg.classList.contains('fade')).toBe(true);
        vi.advanceTimersByTime(600);
        expect(document.querySelector('.mascot-egg-cheer')).toBeNull();
    });

    it('Review Focus：浮層整個 aria-hidden（報讀器不會脫離上下文唸出名牌）', () => {
        MascotModule.showNamingEgg.mockRestore();
        MascotModule.showNamingEgg('小澄');
        expect(document.querySelector('.mascot-egg-cheer').getAttribute('aria-hidden')).toBe('true');
    });

    it('Review Focus：一次只留一個浮層——初次見面慶祝中又存了日記，新的取代舊的，不疊', () => {
        MascotModule.showNamingEgg.mockRestore();
        MascotModule.showNamingEgg('小澄');
        MascotModule.showSaveEgg('happy');
        const eggs = document.querySelectorAll('.mascot-egg');
        expect(eggs.length).toBe(1);
        expect(eggs[0].classList.contains('mascot-egg-happy')).toBe(true);
        vi.advanceTimersByTime(3000);                 // 舊浮層的計時器對已移除節點無害
        expect(document.querySelectorAll('.mascot-egg').length).toBe(0);
    });

    it('揮手浮層：揮手姿勢、不可點、1600ms 淡出', () => {
        MascotModule.showOnboardingEgg.mockRestore();
        MascotModule.showOnboardingEgg();
        const egg = document.querySelector('.mascot-egg-wave');
        expect(egg.querySelector('svg').getAttribute('data-mm-pose')).toBe('wave');
        expect(egg.querySelector('svg').hasAttribute('data-mm-tap')).toBe(false);
        vi.advanceTimersByTime(1600);
        expect(egg.classList.contains('fade')).toBe(true);
    });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/onboarding_motion.test.js`
Expected: FAIL（`13 failed`：`vi.spyOn` 找不到 `showOnboardingEgg`／`showNamingEgg`）。

- [ ] **Step 3: `mascot.js`——雙手慶祝姿勢**

在 `const POSE_TEA =` 之前插入：

```javascript
    // 取名慶祝（v2.6 motion Task 9）：雙手高舉＋開心臉＋腮紅＋兩顆金星。
    // 左手＝右手（揮手姿勢那隻）對書本中線 x=100 鏡射。
    const POSE_CHEER =
      part('stars',
        `<path d="M58 40 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 z" fill="#f5c542" stroke="${OUTLINE}" stroke-width="3"/>` +
        `<path d="M150 34 l3.5 8 8 3.5 -8 3.5 -3.5 8 -3.5 -8 -8 -3.5 8 -3.5 z" fill="#f5c542" stroke="${OUTLINE}" stroke-width="3"/>`) +
      part('arm-l',
        `<path d="M46 116 q-16 -10 -14 -26" stroke="${OUTLINE}" stroke-width="8" fill="none" stroke-linecap="round"/>` +
        `<circle cx="31" cy="86" r="7" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="5"/>`) +
      part('arm-r',
        `<path d="M154 116 q16 -10 14 -26" stroke="${OUTLINE}" stroke-width="8" fill="none" stroke-linecap="round"/>` +
        `<circle cx="169" cy="86" r="7" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="5"/>`) +
      BASE_BOOK + FACE_HAPPY + BLUSH;

```

`POSES` 表換成：

```javascript
    const POSES = { sleep: POSE_SLEEP, calendar: POSE_CALENDAR, question: POSE_QUESTION,
                    wave: POSE_WAVE, jump: POSE_JUMP, tea: POSE_TEA, goodnight: POSE_GOODNIGHT,
                    cheer: POSE_CHEER };
```

- [ ] **Step 4: `mascot.js`——共用浮層與兩個初次見面浮層**

`showSaveEgg` 整段換成：

```javascript
    /**
     * 彩蛋浮層（存日記與初次見面共用）：fixed 置中、pointer-events:none（mascot.css），
     * fadeAtMs 開始淡出、再 600ms 移除。caption 是使用者給的字（陪伴者名字）——一律
     * textContent，絕不進 innerHTML。一次只留一個浮層（新的直接取代還沒淡完的舊的，
     * 不疊在一起）；整個浮層 aria-hidden——純裝飾，名字已由對話訊息說過一次。
     */
    function showEggOverlay(variantClass, pose, caption, fadeAtMs) {
        document.querySelectorAll('.mascot-egg').forEach((el) => el.remove());
        const wrap = document.createElement('div');
        wrap.className = 'mascot-egg ' + variantClass;
        wrap.setAttribute('aria-hidden', 'true');
        wrap.innerHTML = svg220(POSES[pose], 150, pose);
        if (caption) {
            const tag = document.createElement('div');
            tag.className = 'mascot-egg-name';
            tag.textContent = caption;
            wrap.appendChild(tag);
        }
        document.body.appendChild(wrap);
        setTimeout(() => { wrap.classList.add('fade'); }, fadeAtMs);
        setTimeout(() => { wrap.remove(); }, fadeAtMs + 600);
        return wrap;
    }

    function showSaveEgg(kind) {
        if (kind === 'quiet') return; // 沉重的日記：安靜，不慶祝
        // mascot-egg-happy（v2.6 motion Task 8）：翻頁／書籤／金星的 CSS 只認這個 class
        if (kind === 'goodnight') showEggOverlay('mascot-egg-night', 'goodnight', null, 1200);
        else showEggOverlay('mascot-egg-happy', 'jump', null, 1200);
    }

    // 初次見面（v2.6 motion Task 9）——兩個浮層都只由 onboarding_module.js 的「操作事件」觸發
    // （onboarding 啟動、取名完成），不看任何答案內容或情緒；不進 .chat-messages（契約 §4）。
    function showOnboardingEgg() { return showEggOverlay('mascot-egg-wave', 'wave', null, 1600); }
    function showNamingEgg(name) { return showEggOverlay('mascot-egg-cheer', 'cheer', String(name || ''), 1600); }
```

檔尾 `return { … }` 換成：

```javascript
    return { loadingHtml, thinkingBubbleHtml, emptyHtml, welcomeHtml,
             checkinHtml, eggKindFor, showSaveEgg, categoryIcon, stampIcon,
             reactionHeartSvg, showOnboardingEgg, showNamingEgg };
```

- [ ] **Step 5: `onboarding_module.js`——兩個操作事件的掛點**

在 `function isActive() { return active; }` 之後插入：

```javascript

    /**
     * 初次見面的吉祥物浮層（v2.6 motion Task 9）。契約 §4：只綁兩個「操作事件」——
     * 'wave'＝onboarding 啟動（maybeStart 真的把流程打開，隨第一則腳本訊息出現），'name'＝
     * 取名這一步定案（使用者給了名字，或說「隨便／之後再取」拿到預設名字）。不看答案內容、不看
     * 情緒；浮層是 fixed 的 .mascot-egg，不進 .chat-messages（聊天區仍只有安靜搖擺）。
     * typeof 守衛：測試可不載 mascot.js。
     */
    function celebrate(kind, name) {
        if (typeof MascotModule === 'undefined') return;
        if (kind === 'wave' && typeof MascotModule.showOnboardingEgg === 'function') {
            MascotModule.showOnboardingEgg();
        } else if (kind === 'name' && typeof MascotModule.showNamingEgg === 'function') {
            MascotModule.showNamingEgg(name);
        }
    }
```

`maybeStart()` 裡、`active = true;` 之後那段 `if (answered.size > 0) { script(…resume…) } else { script(…intro…) }` 換成（兩個 `script` 的 callback 先 `celebrate('wave')` 再 `askNext`）：

```javascript
        // 揮手進場（v2.6 motion Task 9）跟第一則腳本訊息一起出現：啟動當下 App 可能還蓋著
        // 啟動畫面（已登入者開 App 時），等假思考結束、訊息真的出現再揮手
        if (answered.size > 0) {
            // 中斷續跑：簡短再見面文案 → 第一個未答題（已答不重問）
            script(I18N.t('onboarding.resume'), function () { celebrate('wave'); askNext(false); });
        } else {
            script(I18N.t('onboarding.intro'), function () { celebrate('wave'); askNext(false); });
        }
```

`handleNamingAnswer()` 裡，從 `const defaultName = I18N.t('onboarding.defaultName');` 那行起、到 ≤12 字分支的 `script(I18N.t('onboarding.namingAck', { name: name }), function () { askNext(false); });` 那行止（片語命中給預設名字、給了名字這兩個分支的內容），換成：

```javascript
            const defaultName = I18N.t('onboarding.defaultName');
            saveCompanionName(defaultName);
            script(I18N.t(phrase === 'later' ? 'onboarding.nameDefaultedLater'
                                             : 'onboarding.nameDefaulted', { name: defaultName }),
                   function () { celebrate('name', defaultName); askNext(false); });
        } else if (name && Array.from(name).length <= NAME_MAX_CHARS) {
            saveCompanionName(name);
            script(I18N.t('onboarding.namingAck', { name: name }),
                   function () { celebrate('name', name); askNext(false); });
```

（重試與放棄兩個分支不動——它們沒有名字定案。`finish()` 也不動。）

- [ ] **Step 6: 初次見面 CSS**

`desktop/css/mascot.css`：在 `@keyframes mm-twinkle { … }` 區塊之後、`.mascot-cat-icon { vertical-align: middle; }` 之前插入：

```css
/* 初次見面（v2.6 motion Task 9）：進場揮手浮層（.mascot-egg-wave）與取名慶祝浮層
   （.mascot-egg-cheer）沿用 .mascot-egg 的 fixed＋pointer-events:none＋淡出，也沿用非晚安
   彩蛋的 mascot-pop 進場；揮手本身是 Task 7 的 svg[data-mm-pose="wave"] .mm-arm-r。
   名牌只用契約色：書頁米白底、描邊棕字。 */
.mascot-egg-cheer { flex-direction: column; gap: 8px; }
.mascot-egg-cheer .mm-arm-r { animation: mm-cheer-r 480ms ease-in-out 3 alternate; }
.mascot-egg-cheer .mm-arm-l { animation: mm-cheer-l 480ms ease-in-out 3 alternate; }
.mascot-egg-cheer .mm-stars path {
    transform-box: fill-box; transform-origin: 50% 50%;
    animation: mm-twinkle 500ms ease-out 1 both;
}
.mascot-egg-cheer .mm-stars path:nth-child(2) { animation-delay: 160ms; }
.mascot-egg-name {
    max-width: min(80vw, 320px); padding: 4px 16px;
    border: 3px solid #4b2e1e; border-radius: 999px; background: #f9f3e6; color: #4b2e1e;
    font-weight: 700; font-size: 18px; line-height: 1.4; text-align: center; overflow-wrap: anywhere;
    animation: mm-name-in 420ms ease-out 180ms 1 both;
}
@keyframes mm-cheer-r { from { transform: rotate(-12deg); } to { transform: rotate(10deg); } }
@keyframes mm-cheer-l { from { transform: rotate(12deg); } to { transform: rotate(-10deg); } }
@keyframes mm-name-in { from { transform: translateY(10px) scale(.9); opacity: 0; } to { transform: none; opacity: 1; } }
```

reduce 區塊整段換成：

```css
@media (prefers-reduced-motion: reduce) {
    .mascot-sway, .mascot-dots span, .mascot-egg svg { animation: none !important; }
    .mascot-egg { transition: none; }
    svg[data-mm-idle] .mm-rig, svg[data-mm-idle][data-mm-pose="sleep"] .mm-zzz,
    svg.mm-blink .mm-eyes[data-mm-eyes="dot"],
    svg.mm-react .mm-rig, .mm-heart,
    svg[data-mm-pose="wave"] .mm-arm-r,
    .mascot-egg-happy .mm-bookmark, .mascot-egg-happy .mm-flip-page,
    .mascot-egg-happy .mm-stars path,
    .mascot-egg-cheer .mm-arm-r, .mascot-egg-cheer .mm-arm-l, .mascot-egg-cheer .mm-stars path,
    .mascot-egg-name { animation: none !important; }
    svg[data-mm-follow] .mm-face .mm-eyes, svg[data-mm-follow] .mm-face .mm-mouth,
    svg[data-mm-follow] .mm-blush { transition: none !important; }
}
```

- [ ] **Step 7: harness 場景**

`desktop/tools/motion/harness.js` 的 `SCENES`：在 `'touch-settle'` 之後、結尾 `};` 之前插入：

```javascript
        // --- Task 9 初次見面 -----------------------------------------------------
        'onboarding-wave': {
            viewport: [320, 280], frames: [0, 200, 400, 800, 1200],
            setup: () => MascotModule.showOnboardingEgg(),
        },
        'naming-cheer': {
            viewport: [320, 300], frames: [0, 200, 450, 700, 1000, 1400],
            setup: () => MascotModule.showNamingEgg('小澄'),
        },
```

- [ ] **Step 8: 跑測試確認通過（含 Spec B 既有 onboarding 測試回歸）**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/onboarding_motion.test.js tests/onboarding_module.test.js tests/mascot_egg.test.js tests/mascot_chat.test.js tests/mascot_rig.test.js tests/reduced_motion_css.test.js`
Expected: 全 passed（既有 `onboarding_module.test.js` 不載 `mascot.js`，`celebrate` 的守衛讓它照舊全綠）。

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run`
Expected: `588 passed (588)`。

Run: `cd /home/e604/Brian/URDiary/desktop && node tools/motion/pose-identity.js | tail -1 && node tools/motion/capture-frames.js --reduced | tail -1`
Expected: `pose identity: OK …` 與 `reduced motion: all 18 scenes static`。

Run: `cd /home/e604/Brian/URDiary/desktop && npx playwright test 2>&1 | tail -3`
Expected: `16 passed`（e2e 註冊後 onboarding 啟動＝揮手浮層出現；它 `pointer-events: none`，不擋「直接開始聊天」chip 的點擊）。

- [ ] **Step 9: 影格審查（Fable）**

Run: `cd /home/e604/Brian/URDiary/desktop && node tools/motion/capture-frames.js onboarding-wave naming-cheer`

- `onboarding-wave` 0／200／400／800／1200 ms：從下方彈進（既有 pop）、手臂揮兩下（與登入頁同一個揮手）、1200 ms 回原位；浮層沒有背景色（不像晚安版的深底）。
- `naming-cheer` 0／200／450／700／1000／1400 ms：雙手以肩膀為軸上下擺三下、兩顆星依序亮、名牌「小澄」180 ms 後淡入；名牌米白底棕框棕字、在吉祥物正下方置中、長名字會折行不撐破（可在 `harness.js` 暫改成 12 字名字再跑一次看，看完改回）。
- 深色主題下名牌自帶底色、不受影響。

- [ ] **Step 10: Commit**

```bash
cd /home/e604/Brian/URDiary
git add desktop/js/mascot.js desktop/js/onboarding_module.js desktop/css/mascot.css desktop/tools/motion/harness.js desktop/tests/onboarding_motion.test.js
git commit -m "feat(吉祥物動畫): 初次見面揮手進場＋帶新名字的取名慶祝

兩個浮層只綁 onboarding 啟動與取名定案兩個操作事件，不看答案內容與情緒；
沿用彩蛋浮層（fixed、不擋操作、aria-hidden、一次一個），不進聊天訊息區；
名字一律 textContent。存日記彩蛋改走同一個浮層 helper。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: 行事曆新印章的壓印動畫（只在第一次出現時、只一次）

**目標**：存完日記、AI 蓋出今天的印章後，下一次打開（或重新載入）行事曆時，那張章在月格 14px 徽章與日面板 40px 印章卡上「從上方蓋下、微回彈」一次；之後的重繪、切月再回來、同 session 再進行事曆都不重播。第一次打開行事曆時既有的章一律不動。

**「新」怎麼判定**：`/chat/end/` 的回應帶 `diary.diary_id`；`/calendar/day-notes` 的每筆帶 `source_diary_id`。`chat_module.js` 在存日記成功時廣播 DOM 事件 `urdiary:diary-saved`（只帶操作結果：`{ diaryId, quiet, dayNote }`，不帶任何內容），`calendar_module.js` 登記那個 id；下一次 `loadMonth` 拿到的清單裡 `source_diary_id` 對上的那天，只在緊接著的這一次重繪帶 `.mm-stamp-press`，同時把 id 消掉。安靜篇（`valence < 0.45`，契約 §4 的情緒門檻）與沒開「AI 行事曆印章」不登記——章照樣出現，只是靜態。reduce 下照樣消耗、只是不加 class（之後關掉偏好也不補播）。換帳號 `reset()` 清空。不需要改後端。

**Files:**
- Modify: `desktop/js/chat_module.js`（`endChat` 成功路徑：`eggKind` 變數＋廣播事件）
- Modify: `desktop/js/calendar_module.js`（`createStampPressTracker`、狀態、事件監聽、`loadMonth`、`renderCellStamp`、`renderDayPanel`、`reset`、exports）
- Modify: `desktop/css/mascot.css`（壓印段＋reduce）
- Modify: `desktop/tools/motion/harness.js`（兩個場景）
- Test: `desktop/tests/calendar_stamp_press.test.js`

**Interfaces:**
- Consumes: `MascotModule.eggKindFor`／`showSaveEgg`（既有）、`MascotMotion.isReducedMotion()`（Task 4，`typeof` 守衛）、既有 `isDayNoteEnabled()`。
- Produces:
  - DOM 事件 `urdiary:diary-saved`，`detail = { diaryId: number|null, quiet: boolean, dayNote: boolean }`，只在 `ApiService.endChat` 成功後發一次。
  - `CalendarModule.createStampPressTracker() → { expect(diaryId), take(notes) → Set<'YYYY-MM-DD'>, clear(), size() }`（純函式工廠，vitest 曝光）。
  - CSS：`.mm-stamp-press .mascot-stamp` 的 `mm-stamp-press` 520ms 一次性動畫（`.cell-stamp` 與 `.day-stamp-card` 共用）。

- [ ] **Step 1: 寫失敗測試**

`desktop/tests/calendar_stamp_press.test.js`（DOM fixture 比照既有 `tests/calendar_day_notes.test.js`）：

```javascript
// @vitest-environment jsdom
import { describe, test, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * v2.6 motion Task 10：行事曆印章壓印——只有「剛存的那篇日記」蓋出的新章、第一次出現時
 * 壓一次；既有的章第一次打開行事曆也不動；安靜篇與沒開印章不壓；換帳號清空。
 * fixture 比照 tests/calendar_day_notes.test.js。
 */
function isoToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('createStampPressTracker（純函式）', () => {
    let tracker;
    beforeEach(() => {
        delete window.CalendarModule;
        loadCoreScripts();
        loadScript('js/calendar_module.js');
        tracker = CalendarModule.createStampPressTracker();
    });

    const note = (date, id) => ({ date, stamp: 'cake', phrase: 'x', source_diary_id: id });

    it('沒有登記過：既有的章一律不壓（首次打開行事曆不會整片亂跳）', () => {
        expect([...tracker.take([note('2026-09-01', 3), note('2026-09-02', 4)])]).toEqual([]);
    });

    it('登記的日記 id 對上 source_diary_id：回傳那天，且只回一次（不重播）', () => {
        tracker.expect(7);
        const notes = [note('2026-09-01', 3), note('2026-09-30', 7)];
        expect([...tracker.take(notes)]).toEqual(['2026-09-30']);
        expect([...tracker.take(notes)]).toEqual([]);
        expect(tracker.size()).toBe(0);
    });

    it('id 型別寬鬆比對（後端數字、事件字串都算同一篇）', () => {
        tracker.expect('12');
        expect([...tracker.take([note('2026-09-30', 12)])]).toEqual(['2026-09-30']);
    });

    it('章還沒出現在這次清單（例如翻到別的月）：保留到真的出現那次', () => {
        tracker.expect(9);
        expect([...tracker.take([note('2026-09-01', 3)])]).toEqual([]);
        expect(tracker.size()).toBe(1);
        expect([...tracker.take([note('2026-10-02', 9)])]).toEqual(['2026-10-02']);
    });

    it('沒有 source_diary_id 的章、空 id、非陣列輸入：安全略過', () => {
        tracker.expect(null);
        tracker.expect('');
        tracker.expect(5);
        expect([...tracker.take([{ date: '2026-09-30', stamp: 'cake', source_diary_id: null }])]).toEqual([]);
        expect([...tracker.take(null)]).toEqual([]);
        tracker.clear();
        expect(tracker.size()).toBe(0);
    });
});

describe('行事曆接線：urdiary:diary-saved → 下一次載入壓印一次', () => {
    let NOTE;
    beforeEach(async () => {
        document.body.innerHTML = `
            <div id="calendar-view"></div>
            <div class="calendar-grid"></div>
            <div class="calendar-weekdays"></div>
            <div class="calendar-day-panel"></div>
            <span class="calendar-month-label"></span>`;
        NOTE = { date: isoToday(), stamp: 'cake', phrase: '做了一件勇敢的事', source_diary_id: 7 };
        window.ApiService = {
            isAuthenticated: () => true,
            getCalendarEvents: vi.fn(async () => ({ occurrences: [] })),
            getDayNotes: vi.fn(async () => ({ notes: [NOTE] })),
        };
        loadScript('js/security_utils.js');
        loadScript('js/mascot.js');
        loadScript('js/i18n.js');
        delete window.CalendarModule;          // 理由見 calendar_day_notes.test.js
        loadScript('js/calendar_module.js');
        CalendarModule.init();
        await CalendarModule.loadMonth();
    });
    afterEach(() => { delete window.MascotMotion; });

    const pressed = () => document.querySelectorAll('.mm-stamp-press');
    const saved = (detail) => document.dispatchEvent(new CustomEvent('urdiary:diary-saved', { detail }));

    test('首次載入（沒有剛存的日記）：既有的章不壓', () => {
        expect(document.querySelector('.cell-stamp')).not.toBeNull();
        expect(pressed().length).toBe(0);
    });

    test('存了日記 7 之後載入：月格徽章與日面板印章卡都壓一次；之後重繪／再載入都不重播', async () => {
        saved({ diaryId: 7, quiet: false, dayNote: true });
        await CalendarModule.loadMonth();
        expect(document.querySelector('.cell-stamp.mm-stamp-press')).not.toBeNull();
        expect(document.querySelector('.day-stamp-card.mm-stamp-press')).not.toBeNull();
        document.querySelector(`[data-date="${NOTE.date}"]`).click();   // selectDate → 重繪
        expect(pressed().length).toBe(0);
        await CalendarModule.loadMonth();
        expect(pressed().length).toBe(0);
    });

    test('別篇日記存檔：這張章（屬於日記 7）不壓', async () => {
        saved({ diaryId: 8, quiet: false, dayNote: true });
        await CalendarModule.loadMonth();
        expect(pressed().length).toBe(0);
    });

    test('安靜篇（valence<0.45）與沒開 AI 印章：不壓', async () => {
        saved({ diaryId: 7, quiet: true, dayNote: true });
        await CalendarModule.loadMonth();
        expect(pressed().length).toBe(0);
        saved({ diaryId: 7, quiet: false, dayNote: false });
        await CalendarModule.loadMonth();
        expect(pressed().length).toBe(0);
    });

    test('換帳號（reset）：前一個帳號等著壓的章清空', async () => {
        saved({ diaryId: 7, quiet: false, dayNote: true });
        CalendarModule.reset();
        await CalendarModule.loadMonth();
        expect(pressed().length).toBe(0);
    });

    test('reduced-motion：不加動畫 class，但照樣消耗（之後關掉偏好也不補播）', async () => {
        window.MascotMotion = { isReducedMotion: () => true };
        saved({ diaryId: 7, quiet: false, dayNote: true });
        await CalendarModule.loadMonth();
        expect(pressed().length).toBe(0);
        window.MascotMotion = { isReducedMotion: () => false };
        await CalendarModule.loadMonth();
        expect(pressed().length).toBe(0);
    });
});

describe('chat_module：存日記成功才廣播 urdiary:diary-saved（只帶操作結果）', () => {
    const CHAT_HTML = `
        <div class="chat-container">
            <div class="chat-messages"></div>
            <div class="chat-input-area"><div class="chat-input-wrapper">
                <textarea id="user-input"></textarea><button id="send-button"></button>
            </div></div>
            <button id="end-chat-btn"></button><button id="clear-chat-btn"></button>
        </div>`;
    let events;
    const listener = (e) => events.push(e.detail);

    beforeEach(() => {
        loadCoreScripts();
        loadScript('js/mascot.js');
        loadScript('js/chat_module.js');
        localStorage.clear();
        document.body.innerHTML = CHAT_HTML;
        window.UIManager = { showToast: vi.fn(), showLoadingSpinner: vi.fn(), hideLoadingSpinner: vi.fn() };
        ChatModule.reset();
        ChatModule.init();
        events = [];
        document.addEventListener('urdiary:diary-saved', listener);
        vi.spyOn(Date.prototype, 'getHours').mockReturnValue(14);
    });
    afterEach(() => {
        document.removeEventListener('urdiary:diary-saved', listener);
        vi.restoreAllMocks();
    });

    it('正向日記：{diaryId, quiet:false, dayNote:true}，沒有任何內容欄位', async () => {
        window.ApiService = { endChat: vi.fn(async () => ({
            message: 'ok', diary: { diary_id: 21, title: '秘密標題', content: '秘密內容', valence: 0.8 } })) };
        await ChatModule.endChat();
        expect(events).toEqual([{ diaryId: 21, quiet: false, dayNote: true }]);
    });

    it('低落日記（valence<0.45）：quiet:true；關掉 AI 印章：dayNote:false', async () => {
        localStorage.setItem('urdiary_day_note_enabled', '0');
        window.ApiService = { endChat: vi.fn(async () => ({
            message: 'ok', diary: { diary_id: 22, valence: 0.2 } })) };
        await ChatModule.endChat();
        expect(events).toEqual([{ diaryId: 22, quiet: true, dayNote: false }]);
    });

    it('存日記失敗：不廣播', async () => {
        window.ApiService = { endChat: vi.fn(async () => { throw new Error('boom'); }) };
        await ChatModule.endChat();
        expect(events).toEqual([]);
    });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/calendar_stamp_press.test.js`
Expected: FAIL（`8 failed | 6 passed`：`createStampPressTracker is not a function`、存日記後沒有 `.mm-stamp-press`、沒有廣播事件；「首次載入不壓」「別篇不壓」這類反向斷言在舊碼上本來就成立）。

- [ ] **Step 3: `chat_module.js`——存日記成功才廣播**

`endChat()` 成功路徑的彩蛋區塊（`// v2.4 spec ③：存日記彩蛋。…` 開頭那個 `if (typeof MascotModule !== 'undefined') { … }`）整段換成：

```javascript
            // v2.4 spec ③：存日記彩蛋。只綁這個操作事件；negative valence → 安靜略過。
            let eggKind = null;
            if (typeof MascotModule !== 'undefined') {
                const valence = (response.diary && typeof response.diary.valence === 'number')
                    ? response.diary.valence : null;
                eggKind = MascotModule.eggKindFor(valence, new Date().getHours());
                MascotModule.showSaveEgg(eggKind);
            }

            // v2.6 motion Task 10：廣播「剛存好一篇日記」——行事曆據此只對這篇蓋出的新印章
            // 播一次壓印。只帶操作結果（日記 id、是否走安靜版、有沒有開印章），不帶任何內容。
            document.dispatchEvent(new CustomEvent('urdiary:diary-saved', {
                detail: {
                    diaryId: (response.diary && response.diary.diary_id) || null,
                    quiet: eggKind === 'quiet',
                    dayNote: isDayNoteEnabled()
                }
            }));
```

（`eggKindFor(valence, hour)` 的呼叫參數不變，`tests/mascot_chat.test.js` 的 `toHaveBeenCalledWith(0.8, 14)` 照舊成立。失敗路徑走 catch，不會廣播。）

- [ ] **Step 4: `calendar_module.js`——判定工廠與狀態**

在 `// --- 狀態 ----…` 那行之前插入：

```javascript
    /**
     * ★ 純函式工廠：印章「壓印動畫」只給剛存的那篇日記蓋出的新章、而且只播一次（v2.6 motion Task 10）
     *
     * expect(diaryId)：存日記成功（chat_module.js 發的 urdiary:diary-saved）時登記。
     * take(notes)：每次 loadMonth 拿到印章清單時呼叫，回傳「這次重繪該壓印的日期」集合，
     *   並把對上的 id 消掉——之後的重繪、切月再回來都不重播。
     * 「新」的判定＝note.source_diary_id 對上剛存的日記 id（/calendar/day-notes 本來就回這欄）：
     * 不靠日期（時區／5 點換日都不用猜），也不靠「第一次看到」——第一次打開行事曆時既有的章
     * 一律不動。同一天再存一篇會 upsert 出新 id，新章照樣壓一次。
     */
    function createStampPressTracker() {
        let pending = new Set();
        return {
            expect: function (diaryId) {
                if (diaryId === null || diaryId === undefined || diaryId === '') return;
                pending.add(String(diaryId));
            },
            take: function (notes) {
                const dates = new Set();
                if (!Array.isArray(notes) || pending.size === 0) return dates;
                notes.forEach(function (n) {
                    if (!n || typeof n.date !== 'string' ||
                        n.source_diary_id === null || n.source_diary_id === undefined) return;
                    const id = String(n.source_diary_id);
                    if (pending.has(id)) {
                        dates.add(n.date);
                        pending.delete(id);
                    }
                });
                return dates;
            },
            clear: function () { pending = new Set(); },
            size: function () { return pending.size; }
        };
    }

```

`let dayNotesByDate = new Map();` 那行之後加：

```javascript
    const stampPress = createStampPressTracker();   // v2.6 motion Task 10：等著壓印的日記 id
    let pressDates = new Set();             // 只服務「loadMonth 之後那一次」重繪：這次要壓印的日期
```

`bindListeners()` 的最前面（`// 視圖狀態機切到行事曆時才真的去要資料` 之前）插入：

```javascript
        // v2.6 motion Task 10：剛存好的日記 → 它的印章下次出現時壓印一次。安靜篇（情緒門檻，
        // 契約 §4）與沒開「AI 行事曆印章」的不登記；只看操作結果，不看任何內容。
        document.addEventListener('urdiary:diary-saved', function(event) {
            const detail = event && event.detail;
            if (!detail || detail.quiet || detail.dayNote === false) return;
            stampPress.expect(detail.diaryId);
        });

```

- [ ] **Step 5: `calendar_module.js`——載入、渲染、重置**

`loadMonth()` 的 try 區塊中，從 `indexDayNotes(notesResponse && notesResponse.notes);` 到 `scheduleReminders();` 換成：

```javascript
            indexDayNotes(notesResponse && notesResponse.notes);
            // 壓印：這次清單裡有剛存的日記蓋出的章 → 只在接下來這一次重繪帶 class。
            // reduced-motion 下照樣「消耗」掉（不留到之後才播），只是不加動畫 class。
            const toPress = stampPress.take(notesResponse && notesResponse.notes);
            const reduce = typeof MascotMotion !== 'undefined' &&
                typeof MascotMotion.isReducedMotion === 'function' && MascotMotion.isReducedMotion();
            pressDates = reduce ? new Set() : toPress;
            // 這次載入的範圍涵蓋今天的話，順手更新提醒用的快照（免一次額外請求）
            applyTodaysSnapshot(range.startIso, range.endIso);
            renderGrid();
            renderDayPanel(selectedDate);
            pressDates = new Set();
            scheduleReminders();
```

`renderCellStamp` 整段換成：

```javascript
    function renderCellStamp(note) {
        if (!note || typeof MascotModule === 'undefined' || !MascotModule.stampIcon) return '';
        const press = pressDates.has(note.date) ? ' mm-stamp-press' : '';
        return `<span class="cell-stamp${press}" title="${escapeHtml(note.phrase || '')}">` +
               `${MascotModule.stampIcon(note.stamp, 14)}</span>`;
    }
```

`renderDayPanel` 裡開印章卡的那一行（`html +=` 後面接著 `<div class="day-stamp-card">` 的樣板字串開頭）換成兩行：

```javascript
            const press = pressDates.has(iso) ? ' mm-stamp-press' : '';
            html += `<div class="day-stamp-card${press}">
```

`reset()` 裡 `dayNotesByDate = new Map();` 之後加：

```javascript
        // 換帳號：前一個帳號等著壓印的日記 id 不能帶到下一個帳號
        stampPress.clear();
        pressDates = new Set();
```

回傳物件最後的 `syncMultiDayState: syncMultiDayState` 換成：

```javascript
        syncMultiDayState: syncMultiDayState,
        // v2.6 motion Task 10：壓印判定的純函式工廠，僅為 vitest 曝光
        createStampPressTracker: createStampPressTracker
```

- [ ] **Step 6: 壓印 CSS**

`desktop/css/mascot.css`：在 `@keyframes mm-name-in …` 那行之後、`.mascot-cat-icon { vertical-align: middle; }` 之前插入：

```css
/* 行事曆印章壓印（v2.6 motion Task 10）：只有剛存的日記蓋出的新章、第一次出現時播一次——
   誰帶 .mm-stamp-press 由 calendar_module.js 的 createStampPressTracker 決定，下一次重繪就不帶了。
   月格 14px 徽章與日面板 40px 印章卡同一個動作：從上方蓋下、微回彈。 */
.mm-stamp-press .mascot-stamp {
    transform-origin: 50% 50%;
    animation: mm-stamp-press 520ms cubic-bezier(.2, .9, .3, 1.15) 1 both;
}
@keyframes mm-stamp-press {
    0%   { transform: scale(1.9) rotate(-14deg); opacity: 0; }
    45%  { transform: scale(.9) rotate(3deg); opacity: 1; }
    70%  { transform: scale(1.06) rotate(-1deg); opacity: 1; }
    100% { transform: scale(1) rotate(0deg); opacity: 1; }
}
```

reduce 區塊整段換成：

```css
@media (prefers-reduced-motion: reduce) {
    .mascot-sway, .mascot-dots span, .mascot-egg svg { animation: none !important; }
    .mascot-egg { transition: none; }
    svg[data-mm-idle] .mm-rig, svg[data-mm-idle][data-mm-pose="sleep"] .mm-zzz,
    svg.mm-blink .mm-eyes[data-mm-eyes="dot"],
    svg.mm-react .mm-rig, .mm-heart,
    svg[data-mm-pose="wave"] .mm-arm-r,
    .mascot-egg-happy .mm-bookmark, .mascot-egg-happy .mm-flip-page,
    .mascot-egg-happy .mm-stars path,
    .mascot-egg-cheer .mm-arm-r, .mascot-egg-cheer .mm-arm-l, .mascot-egg-cheer .mm-stars path,
    .mascot-egg-name, .mm-stamp-press .mascot-stamp { animation: none !important; }
    svg[data-mm-follow] .mm-face .mm-eyes, svg[data-mm-follow] .mm-face .mm-mouth,
    svg[data-mm-follow] .mm-blush { transition: none !important; }
}
```

- [ ] **Step 7: harness 場景**

`desktop/tools/motion/harness.js` 的 `SCENES`：在 `'naming-cheer'` 之後、結尾 `};` 之前插入：

```javascript
        // --- Task 10 行事曆印章壓印（版位替身：.h-cell＝月格、.h-card＝日面板印章卡）----------
        'stamp-press-cell': {
            viewport: [160, 120], frames: [0, 120, 240, 360, 520],
            setup: (stage) => mount(stage, `<div class="h-cell"><span class="cell-stamp mm-stamp-press">` +
                `${MascotModule.stampIcon('cake', 14)}</span></div>`),
        },
        'stamp-press-card': {
            viewport: [200, 140], frames: [0, 120, 240, 360, 520],
            setup: (stage) => mount(stage, `<div class="h-card day-stamp-card mm-stamp-press">` +
                `${MascotModule.stampIcon('cake', 40)}</div>`),
        },
```

- [ ] **Step 8: 跑測試確認通過（含既有行事曆與聊天測試回歸）**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/calendar_stamp_press.test.js tests/calendar_day_notes.test.js tests/calendar_view_reload.test.js tests/mascot_chat.test.js tests/mascot_empty.test.js tests/reduced_motion_css.test.js`
Expected: 全 passed。

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run`
Expected: `602 passed (602)`。

Run: `cd /home/e604/Brian/URDiary/desktop && node tools/motion/pose-identity.js | tail -1 && node tools/motion/capture-frames.js --reduced | tail -1`
Expected: `pose identity: OK …` 與 `reduced motion: all 20 scenes static`。

Run: `cd /home/e604/Brian/URDiary/desktop && npx playwright test 2>&1 | tail -3`
Expected: `16 passed`（e2e 結束對話兩次＝stub 蓋了章，行事曆 test 進去時在 reduce 下不加 class，CRUD 照常）。

- [ ] **Step 9: 影格審查（Fable）**

Run: `cd /home/e604/Brian/URDiary/desktop && node tools/motion/capture-frames.js stamp-press-cell stamp-press-card`

兩列各 0／120／240／360／520 ms：0 看不見；120 大一號、逆時針斜著半透明「舉起來」；240 前後蓋到最低（0.9 倍、微順時針）；360 回彈；520 端正落定，與靜止的章完全一樣。14px 月格那張也要看得出「蓋下去」而不是單純閃一下。

- [ ] **Step 10: Commit**

```bash
cd /home/e604/Brian/URDiary
git add desktop/js/chat_module.js desktop/js/calendar_module.js desktop/css/mascot.css desktop/tools/motion/harness.js desktop/tests/calendar_stamp_press.test.js
git commit -m "feat(吉祥物動畫): 行事曆新印章壓印——只給剛存的日記、只播一次

chat_module 存日記成功廣播 urdiary:diary-saved（只帶 id／安靜／印章開關）；
calendar_module 以 source_diary_id 對上那天、只在下一次重繪壓印並立刻消掉；
既有章首次打開不動、安靜篇不壓、換帳號清空、reduce 下照樣消耗。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: 視圖轉場（View Transitions）＋e2e 動態段＋CACHE_VERSION v4＋出貨檢查

**目標**：聊天／日記／行事曆分頁切換在支援的環境（Electron 35、現代 Chromium）用 `document.startViewTransition` 交叉淡化 220ms；API 不在（jsdom、舊瀏覽器）、使用者要求減少動態、或目標就是目前狀態時，退回今天的同步 class 切換——窄螢幕／寬螢幕的面板規則（`resolvePaneClasses`）完全不動，轉場只包在外面。決策先抽成純函式：`handleNavigation` 原本的 switch 原樣變成 `resolveNavigation(state, view)`（逐條測試鎖住行為不變），轉場與否是 `shouldUseViewTransition(...)`。View Transition 的 DOM 更新是非同步的，所以導覽決策以「待套用狀態」為準，程式觸發的連續導覽收斂到最後意圖（Review Focus 第 3 條）。最後 bump `CACHE_VERSION`、跑全套出貨檢查。

**已知限制（寫進註解與文末）**：轉場那 220ms 內瀏覽器的 hit test 落在 `<html>`，點擊不會到新畫面（原型在 Chromium 實測；`::view-transition { pointer-events: none }` 也無效）——所以轉場刻意短；e2e 的 Playwright 會自動等它結束，不會 flaky。

**Files:**
- Modify: `desktop/js/ui_manager.js`（`handleNavigation` 改寫＋新增 `resolveNavigation`／`shouldUseViewTransition`／`prefersReducedMotion`／`transitionToState`／`viewTransitionSettled`、exports）
- Modify: `desktop/css/animations.css`（轉場 220ms、`html.vt-running`、reduce 保險）
- Modify: `desktop/e2e/urdiary.spec.js`（`__vtCalls` 計數 init script、檔尾動態段 test）
- Modify: `desktop/sw.js`（`CACHE_VERSION`）
- Modify: `desktop/tools/motion/harness.html`、`desktop/tools/motion/harness.js`（轉場示意場景）
- Test: `desktop/tests/ui_manager_transitions.test.js`

**Interfaces:**
- Consumes: 既有 `switchToState`／`resolvePaneClasses`／`VIEW_STATE`／`VIEW_TYPE`／`viewStateChanged` 事件（行事曆靠它載入，轉場 callback 裡照樣發）；Task 1 的 reduce 旅程。
- Produces:
  - `UIManager.resolveNavigation(state, view) → state | null`（純函式；`null`＝不動）
  - `UIManager.shouldUseViewTransition({ hasApi, reducedMotion, sameState }) → boolean`（純函式）
  - `UIManager.transitionToState(state) → ViewTransition | null`（`null`＝走了同步切換）
  - `UIManager.viewTransitionSettled() → Promise<void>`（沒有轉場就立刻 resolve；e2e 用）
  - 轉場期間 `<html>` 帶 `vt-running`；`sw.js` 的 `CACHE_VERSION = 'urdiary-shell-v4'`；e2e 全域 `window.__vtCalls`。

- [ ] **Step 1: 寫失敗測試**

`desktop/tests/ui_manager_transitions.test.js`（jsdom 沒有 `document.startViewTransition`；需要時用行為相同的替身：callback 延到 microtask 才跑、`finished` 在 callback 之後）：

```javascript
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * v2.6 motion Task 11：分頁切換的視圖轉場。
 *   - resolveNavigation：handleNavigation 原本的 switch 原樣抽成純函式（逐條鎖住）
 *   - shouldUseViewTransition：API 不在／reduced-motion／同狀態 → 退回同步 class 切換
 *   - transitionToState：以「待套用狀態」為準收斂連續導覽；只有分頁切換走轉場
 * jsdom 沒有 document.startViewTransition；需要時用行為相同的替身（callback 延到 microtask）。
 */
beforeAll(() => {
    loadCoreScripts();
    loadScript('js/ui_manager.js');
});

describe('resolveNavigation（純函式，行為與 v2.5 handleNavigation 相同）', () => {
    const S = () => UIManager.VIEW_STATE;
    it.each([
        ['chat_full', 'diary', 'chat_diary'],
        ['chat_full', 'chat', null],
        ['chat_diary', 'chat', 'chat_full'],
        ['chat_diary', 'diary', null],
        ['diary_detail', 'chat', 'chat_detail'],
        ['diary_detail', 'diary', null],
        ['chat_detail', 'chat', 'chat_full'],
        ['chat_detail', 'diary', 'chat_diary'],
        ['calendar_full', 'chat', 'chat_full'],
        ['calendar_full', 'diary', 'chat_diary'],
        ['calendar_full', 'calendar', 'calendar_full'],   // 已在行事曆再點＝重新載入（沿用）
        ['chat_full', 'calendar', 'calendar_full'],
        ['diary_detail', 'calendar', 'calendar_full'],
        ['bogus_state', 'chat', 'chat_full'],             // 未知狀態一律回聊天
        ['chat_full', 'settings', null],                  // 未知分頁不動
    ])('%s + 點 %s → %s', (state, view, expected) => {
        expect(UIManager.resolveNavigation(state, view)).toBe(expected);
        expect(Object.values(S())).toContain(expected === null ? 'chat_full' : expected);
    });
});

describe('shouldUseViewTransition（純函式）', () => {
    it.each([
        [{ hasApi: true, reducedMotion: false, sameState: false }, true],
        [{ hasApi: false, reducedMotion: false, sameState: false }, false],
        [{ hasApi: true, reducedMotion: true, sameState: false }, false],
        [{ hasApi: true, reducedMotion: false, sameState: true }, false],
        [undefined, false],
    ])('%j → %s', (opts, expected) => {
        expect(UIManager.shouldUseViewTransition(opts)).toBe(expected);
    });
});

describe('handleNavigation × View Transition（DOM）', () => {
    let reduce;
    let stateEvents;
    const onState = (e) => stateEvents.push(e.detail.newState);

    beforeEach(() => {
        reduce = false;
        window.matchMedia = vi.fn((q) => ({
            matches: q.includes('prefers-reduced-motion') ? reduce : false,   // 斷點查詢：一律寬螢幕
            addEventListener() {}, removeEventListener() {},
        }));
        document.body.innerHTML = `
            <nav><button class="nav-item" data-view="chat"></button>
                 <button class="nav-item" data-view="diary"></button>
                 <button class="nav-item" data-view="calendar"></button></nav>
            <div id="chat-view" class="view-container"></div>
            <div id="diary-view" class="view-container">
                <div class="diary-list"></div><div class="diary-detail" style="display:none"></div>
            </div>
            <div id="calendar-view" class="view-container"></div>`;
        UIManager.init();                        // 會 switchToState(CHAT_FULL) 歸零
        stateEvents = [];
        document.addEventListener('viewStateChanged', onState);
    });

    afterEach(async () => {
        await UIManager.viewTransitionSettled();
        document.removeEventListener('viewStateChanged', onState);
        delete document.startViewTransition;
        delete window.matchMedia;
    });

    /** 行為同 Chromium 的替身：callback 延到 microtask 才跑，finished 在 callback 之後。 */
    function stubViewTransition() {
        document.startViewTransition = vi.fn((cb) => {
            const updateCallbackDone = Promise.resolve().then(cb);
            return { updateCallbackDone, ready: updateCallbackDone,
                     finished: updateCallbackDone.then(() => {}), skipTransition() {} };
        });
    }

    it('沒有 View Transition API（jsdom／舊瀏覽器）：同步切換，與今天完全相同', () => {
        UIManager.handleNavigation('diary');
        expect(UIManager.getCurrentState()).toBe('chat_diary');
        expect(document.getElementById('diary-view').classList.contains('half')).toBe(true);
        expect(stateEvents).toEqual(['chat_diary']);
    });

    it('有 API：走轉場——期間 html.vt-running、callback 才換 class、結束清掉 vt-running', async () => {
        stubViewTransition();
        UIManager.handleNavigation('calendar');
        expect(document.startViewTransition).toHaveBeenCalledTimes(1);
        expect(document.documentElement.classList.contains('vt-running')).toBe(true);
        expect(document.getElementById('calendar-view').classList.contains('active')).toBe(false);
        await UIManager.viewTransitionSettled();
        expect(document.getElementById('calendar-view').classList.contains('active')).toBe(true);
        expect(document.documentElement.classList.contains('vt-running')).toBe(false);
        expect(stateEvents).toEqual(['calendar_full']);
    });

    it('連續兩次程式觸發的導覽（callback 還沒跑）：以最後一次的意圖收斂', async () => {
        stubViewTransition();
        UIManager.handleNavigation('diary');   // 聊天全螢幕 → 聊天＋日記
        UIManager.handleNavigation('chat');    // 以「待套用的聊天＋日記」判斷 → 回聊天全螢幕
        await UIManager.viewTransitionSettled();
        await Promise.resolve();
        expect(UIManager.getCurrentState()).toBe('chat_full');
        expect(document.getElementById('chat-view').classList.contains('active')).toBe(true);
        expect(document.getElementById('diary-view').classList.contains('half')).toBe(false);
    });

    it('reduced-motion：不開轉場，同步切換', () => {
        stubViewTransition();
        reduce = true;
        UIManager.handleNavigation('diary');
        expect(document.startViewTransition).not.toHaveBeenCalled();
        expect(UIManager.getCurrentState()).toBe('chat_diary');
    });

    it('同狀態（已在行事曆再點行事曆）：不開轉場，但仍重新套用並發 viewStateChanged（行事曆會重載）', async () => {
        stubViewTransition();
        UIManager.handleNavigation('calendar');
        await UIManager.viewTransitionSettled();
        UIManager.handleNavigation('calendar');
        expect(document.startViewTransition).toHaveBeenCalledTimes(1);
        expect(stateEvents).toEqual(['calendar_full', 'calendar_full']);
    });

    it('非分頁切換（init、斷點變化、日記詳情開關）直接 switchToState，永不轉場', () => {
        stubViewTransition();
        UIManager.switchToState('chat_diary');
        UIManager.showDiaryDetail();
        UIManager.hideDiaryDetail();
        expect(document.startViewTransition).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/ui_manager_transitions.test.js`
Expected: FAIL（`26 failed`：`UIManager.resolveNavigation is not a function`、`shouldUseViewTransition is not a function`、`viewTransitionSettled is not a function`）。

- [ ] **Step 3: `ui_manager.js`——決策抽純函式＋轉場**

把 `// 處理導航點擊` 註解連同 `function handleNavigation(view) { … }` 整段（到下一個 `// ------…` 分隔線、`// resolvePaneClasses（v2.3 task 2.1）` 之前）換成：

```javascript
    // 處理導航點擊（頭部導覽／底部分頁列／日記空狀態「開始對話」／行事曆「看日記」）。
    // 決策在純函式 resolveNavigation；轉場在 transitionToState（v2.6 motion Task 11）。
    // 以「待套用的狀態」為準做決策：View Transition 的 DOM 更新是非同步的，程式觸發的
    // 連續導覽（例如 endChat 500ms 後自動 .click() 日記頁籤）不能拿過期的 currentViewState 判斷。
    function handleNavigation(view) {
        console.log(`處理導航點擊: ${view}, 當前狀態: ${currentViewState}`);

        try {
            const next = resolveNavigation(pendingViewState || currentViewState, view);
            if (next) {
                transitionToState(next);
            }
        } catch (error) {
            console.error('導航處理錯誤:', error);
        }
    }

    /**
     * 純函式：目前狀態＋點了哪個分頁 → 下一個狀態；null＝維持不動（v2.6 motion Task 11 自
     * handleNavigation 原本的 switch 原樣抽出，行為逐條不變，見 tests/ui_manager_transitions.test.js）。
     * - 行事曆：任何狀態都進 CALENDAR_FULL（已在行事曆也回傳它——重新套用會再發一次
     *   viewStateChanged，行事曆據此重新載入，沿用 v2.5 的行為）
     * - 狀態1 CHAT_FULL：日記→狀態2；聊天→不動
     * - 狀態2 CHAT_DIARY_SPLIT：聊天→狀態1；日記→不動
     * - 狀態3 DIARY_DETAIL_SPLIT：聊天→狀態4；日記→不動
     * - 狀態4 CHAT_DETAIL_SPLIT：聊天→狀態1；日記→狀態2
     * - 狀態5 CALENDAR_FULL：聊天→狀態1；日記→狀態2
     * - 未知狀態：一律回到狀態1
     */
    function resolveNavigation(state, view) {
        const S = VIEW_STATE;
        if (view === VIEW_TYPE.CALENDAR) return S.CALENDAR_FULL;
        switch (state) {
            case S.CHAT_FULL:
                return view === VIEW_TYPE.DIARY ? S.CHAT_DIARY_SPLIT : null;
            case S.CHAT_DIARY_SPLIT:
                return view === VIEW_TYPE.CHAT ? S.CHAT_FULL : null;
            case S.DIARY_DETAIL_SPLIT:
                return view === VIEW_TYPE.CHAT ? S.CHAT_DETAIL_SPLIT : null;
            case S.CHAT_DETAIL_SPLIT:
            case S.CALENDAR_FULL:
                if (view === VIEW_TYPE.CHAT) return S.CHAT_FULL;
                if (view === VIEW_TYPE.DIARY) return S.CHAT_DIARY_SPLIT;
                return null;
            default:
                return S.CHAT_FULL;
        }
    }

    // ------------------------------------------------------------------
    // 視圖轉場（v2.6 motion Task 11）
    //
    // 分頁切換改走 document.startViewTransition（Electron 35／Chromium 134 起支援）：
    // 瀏覽器先拍下舊畫面、跑 callback 換 class、再交叉淡化到新畫面。三種情況退回
    // 原本的同步 class 切換：API 不存在（jsdom、舊瀏覽器）、使用者要求減少動態、
    // 目標狀態就是現在的狀態（例如再點一次行事曆＝重新載入，不需要轉場）。
    // 只有 handleNavigation 走這裡；init、斷點變化、日記詳情開關仍直接 switchToState
    // （那些不是分頁切換，詳情面板也有自己的過渡）。
    // ------------------------------------------------------------------

    /** 純函式：這次切換要不要用 View Transition。 */
    function shouldUseViewTransition(opts) {
        return !!(opts && opts.hasApi && !opts.reducedMotion && !opts.sameState);
    }

    function prefersReducedMotion() {
        return typeof window.matchMedia === 'function' &&
            !!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    // 已排進 View Transition、callback 還沒套上的目標狀態（handleNavigation 以它為準）
    let pendingViewState = null;
    // 目前這一個轉場（viewTransitionSettled 等它；結束時清掉 html.vt-running）
    let activeViewTransition = null;

    function transitionToState(newState) {
        const useTransition = shouldUseViewTransition({
            hasApi: typeof document.startViewTransition === 'function',
            reducedMotion: prefersReducedMotion(),
            sameState: newState === (pendingViewState || currentViewState)
        });
        if (!useTransition) {
            pendingViewState = null;
            switchToState(newState);
            return null;
        }

        pendingViewState = newState;
        // 轉場期間讓 .view-container 自己的 0.3s 過渡直接跳到終點（animations.css），
        // 否則「新畫面」快照裡還在淡入，兩層淡化疊在一起中途會發灰
        document.documentElement.classList.add('vt-running');
        const transition = document.startViewTransition(function() {
            // 連續觸發時每個 callback 都套「最新」的目標：前一個轉場被新的蓋掉時，瀏覽器
            // 仍會呼叫它的 callback，這樣兩個 callback 都收斂到同一個最終狀態
            const target = pendingViewState;
            pendingViewState = null;
            if (target) {
                switchToState(target);
            }
        });
        activeViewTransition = transition;
        transition.finished.catch(function() {}).then(function() {
            if (activeViewTransition === transition) {
                activeViewTransition = null;
                document.documentElement.classList.remove('vt-running');
            }
        });
        return transition;
    }

    /** 等目前的視圖轉場播完（沒有轉場就立刻 resolve）；e2e 與除錯用。 */
    function viewTransitionSettled() {
        return activeViewTransition
            ? activeViewTransition.finished.catch(function() {})
            : Promise.resolve();
    }

```

回傳物件：`getLayoutMode,` 之後插入：

```javascript
        // v2.6 motion Task 11：分頁切換的決策（純函式）與視圖轉場
        resolveNavigation,
        shouldUseViewTransition,
        transitionToState,
        viewTransitionSettled,
```

（`switchToState` 本身一行都不改：`init`、斷點變化 `handleBreakpointChange`、`showDiaryDetail`／`hideDiaryDetail`、相容用的 `switchView` 都照舊同步直呼它。）

- [ ] **Step 4: 轉場 CSS**

`desktop/css/animations.css`：在 `.button-press { … }` 之後、`/* 使用者要求減少動態效果（v2.6 motion Task 4）` 之前插入：

```css
/* 視圖轉場（v2.6 motion Task 11）：分頁切換走 document.startViewTransition（ui_manager.js
   transitionToState），用瀏覽器預設的根節點交叉淡化，縮短成 220ms——轉場期間瀏覽器會吃掉
   點擊（實測 hit test 落在 <html>），越短越不擋手。html.vt-running 期間 .view-container
   自己的 0.3s 過渡直接跳到終點，只留一層淡化。 */
::view-transition-old(root), ::view-transition-new(root) { animation-duration: 220ms; }
html.vt-running .view-container { transition: none !important; }
```

檔尾的 reduce 區塊整段換成：

```css
@media (prefers-reduced-motion: reduce) {
    .fade-in, .slide-in, .loading { animation: none !important; }
    .page-transition, .button-press { transition: none !important; }
    .view-container { transition: none !important; }
    /* JS 在 reduce 下根本不開轉場；這裡是第二道保險 */
    ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; }
}
```

- [ ] **Step 5: 跑單元測試確認通過**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/ui_manager_transitions.test.js tests/ui_manager_helpers.test.js tests/connectivity_banner.test.js tests/reduced_motion_css.test.js`
Expected: 全 passed（`ui_manager_helpers.test.js` 的 `resolvePaneClasses` 十組與安全預設照舊）。

- [ ] **Step 6: e2e——計數 init script 與檔尾動態段**

`desktop/e2e/urdiary.spec.js` 的 `beforeAll`：在既有關掉 `AUTO_SWITCH_TO_DIARY_AFTER_END` 的 `addInitScript` 之後、`beforeAll` 結尾之前插入：

```javascript

        // 視圖轉場計數（v2.6 motion Task 11）：包住 document.startViewTransition，檔尾的轉場
        // test 用它證明兩件事——reduce 下一次都沒開、開了動態才真的走轉場路徑。每次導覽
        // （含 reload）都重新套用，計數跟著頁面生命週期歸零。
        await page.addInitScript(() => {
            const original = Document.prototype.startViewTransition;
            if (typeof original !== 'function') return;
            window.__vtCalls = 0;
            Document.prototype.startViewTransition = function (...args) {
                window.__vtCalls += 1;
                return original.apply(this, args);
            };
        });
```

在 `mobile layout: single pane + bottom tab bar visible` 那支 test 之後、`test.describe.serial` 的結尾 `});` 之前插入：

```javascript

    // v2.6 motion Task 11：旅程其餘部分都在 reducedMotion: 'reduce' 下跑（見 beforeAll），
    // 這裡是唯一開動態的段落——驗 View Transition 路徑本身：真的有開轉場、每次都等
    // 轉場播完再斷言（UIManager.viewTransitionSettled），播完後仍是窄螢幕單一面板、
    // html.vt-running 已清掉。finally 切回 reduce，後面若再加 test 也不受影響。
    test('view transitions: tab switches animate with motion allowed and settle into the single-pane layout', async () => {
        // 前面整段都在 reduce 下（這個頁面自 reload 後）：一次轉場都不該開過
        expect(await page.evaluate(() => window.__vtCalls)).toBe(0);

        await page.emulateMedia({ reducedMotion: 'no-preference' });
        try {
            const steps = [['calendar', '#calendar-view'], ['diary', '#diary-view'], ['chat', '#chat-view']];
            for (const [view, pane] of steps) {
                await page.click(`.tab-bar .nav-item[data-view="${view}"]`);
                await page.evaluate(() => UIManager.viewTransitionSettled());
                await expect(page.locator(pane)).toBeVisible();
                await expect(page.locator('.view-container.active')).toHaveCount(1);
                await expect(page.locator('html')).not.toHaveClass(/vt-running/);
            }
            expect(await page.evaluate(() => window.__vtCalls)).toBe(steps.length);
        } finally {
            await page.emulateMedia({ reducedMotion: 'reduce' });
        }
    });
```

Run: `cd /home/e604/Brian/URDiary/desktop && npx playwright test 2>&1 | tail -4`
Expected: `18 passed`（9 支 × 2 裝置；新的那支每台約 1 秒）。連跑三次都要綠（原型 4/4 次 18/18）：

Run: `cd /home/e604/Brian/URDiary/desktop && for i in 1 2 3; do npx playwright test --reporter=line 2>&1 | grep -E "^  [0-9]+ (passed|failed)"; done`
Expected: 三行 `18 passed`。

- [ ] **Step 7: harness 轉場示意場景**

`desktop/tools/motion/harness.html` 的 `<style>`：在 `.h-cell .cell-stamp { … }` 之後加：

```css
        .h-pane { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
        .h-pane[hidden] { display: none; }
        .h-cal { background: #f9f3e6; }
```

`desktop/tools/motion/harness.js` 的 `SCENES`：在 `'stamp-press-card'` 之後、結尾 `};` 之前插入：

```javascript
        // --- Task 11 視圖轉場（替身：兩個全版面板；轉場規則來自真的 css/animations.css）-------
        'view-transition': {
            viewport: [360, 240], frames: [0, 55, 110, 165, 220],
            setup: (stage) => {
                mount(stage, `<div class="h-pane h-chat">${MascotModule.welcomeHtml()}</div>` +
                    `<div class="h-pane h-cal" hidden>${MascotModule.emptyHtml('calendar', '')}</div>`);
                const transition = document.startViewTransition(() => {
                    stage.querySelector('.h-chat').hidden = true;
                    stage.querySelector('.h-cal').hidden = false;
                });
                return transition.ready;
            },
        },
```

- [ ] **Step 8: `CACHE_VERSION` v3 → v4**

`desktop/sw.js`：

```javascript
const CACHE_VERSION = 'urdiary-shell-v4';
```

理由（sw.js 自己的註解，情境 (b)）：本分支改了 `mascot.js`、`mascot.css`、`animations.css`、`chat.css`、`main.js`、`ui_manager.js`、`onboarding_module.js`、`chat_module.js`、`calendar_module.js`、`index.html` 等既有 shell 檔的內容，cache-first 不 bump 的話已安裝的 PWA 會一直吃舊檔。

Run: `cd /home/e604/Brian/URDiary && grep -n "CACHE_VERSION = " desktop/sw.js && git diff main -- desktop/sw.js | grep -E "^[-+].*(CACHE_VERSION|mascot_motion)"`
Expected: `const CACHE_VERSION = 'urdiary-shell-v4';`，diff 只有 v3→v4 與新增的 `'/js/mascot_motion.js',`。

- [ ] **Step 9: 出貨檢查（全部貼輸出）**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run 2>&1 | tail -4`
Expected: `628 passed (628)`。

Run: `cd /home/e604/Brian/URDiary/desktop && npx playwright test 2>&1 | tail -3`
Expected: `18 passed`。

Run: `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest -q 2>&1 | grep -E "passed|failed" | tail -1`
Expected: `604 passed`（本分支沒改後端；`test_pwa_assets` 會 GET 新的 `/js/mascot_motion.js`）。

Run: `cd /home/e604/Brian/URDiary/desktop && node tools/motion/pose-identity.js | tail -1 && node tools/motion/capture-frames.js | tail -1 && node tools/motion/capture-frames.js --reduced | tail -1`
Expected: `pose identity: OK …`、`note: no motion captured in: egg-night`、`reduced motion: all 21 scenes static`。

守則複核：

Run: `cd /home/e604/Brian/URDiary && git diff --stat main -- . ':!desktop' ':!docs' | tail -1; git diff main --name-only | grep -v -E '^(desktop|docs)/' ; grep -rn "tools/" desktop/index.html; grep -c "Co-Authored-By: Claude Fable 5.1" <(git log main..HEAD --format=%B)`
Expected: 前三個指令沒有輸出（只動了 `desktop/`、`docs/`；index.html 不引用 tools/）；最後一個數字＝本分支 commit 數。

Run: `cd /home/e604/Brian/URDiary && git diff main -- desktop/js/i18n.js | wc -l`
Expected: `0`（本計畫沒有新增使用者可見字串）。

- [ ] **Step 10: 影格審查（Fable）＋整支 contact sheet**

Run: `cd /home/e604/Brian/URDiary/desktop && node tools/motion/capture-frames.js view-transition && node tools/motion/capture-frames.js`

`view-transition` 0／55／110／165／220 ms：舊畫面（揮手、白底）淡出、新畫面（舉月曆、米白底）淡入，220 ms 完全是新畫面，中途不發灰、不閃白。全部場景的 contact sheet 最後整體看一次：同一套色票、同一個角色、動作幅度一致。

- [ ] **Step 11: 人工走一輪真的 App（Fable；隔離後端，不碰 data/、不用 8001／8124）**

```bash
cd /home/e604/Brian/URDiary/backend/app
D=$(mktemp -d /tmp/urdiary-motion-review-XXXX)
URDIARY_DATA_DIR=$D URDIARY_ALLOW_STUB_LLM=1 URDIARY_RATE_LIMIT_ENABLED=0 URDIARY_REQUIRE_INVITE=0 \
  ENV=development XAI_API_KEY= ../../.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8125
```

用 Claude in Chrome 開 `http://127.0.0.1:8125`（新分頁）：建一個拋棄式帳號 → 初次見面揮手浮層（跟自我介紹一起出現）→ 取名「小澄」看慶祝名牌 → 聊一句、結束對話（stub 會蓋章）→ 切行事曆看今天的章壓一次、再切走切回不重播 → 行事曆空白日的吉祥物點一下 → 用「切換用戶」開登入框看揮手與看游標。reduce 版在 e2e 已全程覆蓋；要人工看的話，Chrome DevTools > Rendering > Emulate CSS media feature `prefers-reduced-motion: reduce`，全部應該靜態、功能照常。完成後 Ctrl-C 並 `rm -rf "$D"`（不要動 `data/`、不要用 8001／8124）。

- [ ] **Step 12: Commit**

```bash
cd /home/e604/Brian/URDiary
git add desktop/js/ui_manager.js desktop/css/animations.css desktop/e2e/urdiary.spec.js desktop/sw.js \
        desktop/tools/motion/harness.html desktop/tools/motion/harness.js desktop/tests/ui_manager_transitions.test.js
git commit -m "feat(吉祥物動畫): 分頁切換的視圖轉場＋e2e 動態段＋CACHE_VERSION v4

handleNavigation 決策抽成純函式 resolveNavigation；支援時走 View Transition
（220ms 交叉淡化），API 不在／reduce／同狀態退回同步 class 切換；以待套用狀態
收斂連續導覽。e2e 旅程在 reduce 下零轉場、檔尾動態段驗轉場路徑與單一面板版面。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 與風格契約的張力（實作照「契約安全版」做；請 Brian 驗收時一併確認）

1. **初次見面的兩個動作 vs 契約 §4「聊天區只有安靜搖擺／靜態吉祥物」**：onboarding 是聊天式 ephemeral 訊息，若把揮手／慶祝畫進訊息串就違反 §4。本計畫改用存日記彩蛋同一種浮層（`position: fixed`、`pointer-events: none`、`aria-hidden`、1.6 秒淡出、一次一個），完全不進 `.chat-messages`（Task 9 測試釘住「浮層在 body 上、不在聊天訊息區」）。
2. **§4 的彩蛋事件清單沒有字面列出 onboarding**：清單是「存日記成功、check-in、夜間收尾」。本計畫把「onboarding 啟動」視為與 check-in 同類的操作事件（Spec B 明訂初次見面當天以自我介紹取代 check-in），「取名定案」視為使用者的明確操作；兩者都與答案內容、情緒無關（「隨便」也慶祝、負面字眼當名字也慶祝）。若 Brian 認為 onboarding 不該有彩蛋，拿掉 `onboarding_module.js` 裡兩個 `celebrate(...)` 呼叫即可，其餘不受影響。
3. **登入頁「眼睛跟隨」vs §4 表格「揮手歡迎＝瞇瞇笑眼」**：笑眼是弧線、沒有瞳孔可以轉。本計畫不改眼型，改成整張臉看過去（眼睛滿位移、嘴與腮紅一半），姿勢外觀逐像素不變。
4. **行事曆壓印套用情緒門檻**：壓印不是彩蛋，但它是「慶祝感」的小動作；照 §4 的精神，安靜篇（valence < 0.45）的章靜態出現、不壓。

## 已知限制

- **前端沒有危機訊號**：§4「危機模式相關流程中一律不出現任何彩蛋」目前在前端無從判斷（v2.4 起就是如此）。本計畫所有彩蛋都集中在 `MascotModule.showEggOverlay` 與 `MascotMotion.react` 兩個入口，未來有危機訊號時在這兩處加一道閘即可。
- **視圖轉場的 220ms 內點擊會被吞掉**（Chromium 行為，Task 11 已實測並縮短時長）。
- **reduce 下仍會轉的兩樣**：載入 spinner（進度狀態指示）與 toast 的淡入淡出（`showToast` 靠 `transitionend` 移除節點）——刻意保留，理由寫在 `animations.css` 註解。
- **跟隨到最右時右腮紅會壓到書皮描邊**（它靜止時就貼邊）；Task 7 影格審查若覺得髒，把 `LOOK_PARALLAX` 從 0.5 降到 0.3。

## 原型驗證紀錄（計畫撰寫時，於 scratchpad 的隔離副本逐任務實作過一遍）

- 每個任務邊界 vitest 全綠：464 → 510 → 518 → 538 → 546 → 560 → 570 → 575 → 588 → 602 → 628。
- 每個任務的新測試放到「上一個任務的程式碼」上跑都是紅的（TDD 紅燈確認；數字即各任務 Step 2 的 Expected）。
- `pose-identity.js` 在 Task 2–11 每個邊界都是 `OK`；改半個單位的眼睛位置與加一條靜態 CSS 都能抓到。
- `capture-frames.js --reduced` 在 Task 3–11 每個邊界都印 `all N scenes static`（N＝4、4、7、10、16、16、18、20、21）；Task 4 那一輪曾有一次擷取失敗、重跑 10 次無法重現。
- e2e（`URDIARY_FRONTEND_DIR` 指向原型）：Task 1 後 16/16；Task 11 後 18/18，連跑 5 次皆綠。後端 `test_pwa_assets.py`＋`test_frontend_static.py` 對原型前端 39 passed；後端全套對原型前端 603 passed＋1 failed——失敗的是 `test_config.py::test_frontend_dir_defaults_to_repo_root_desktop…`，純粹因為驗證時用 `URDIARY_FRONTEND_DIR` 把前端指到原型（不覆寫時 `test_config.py` 5/5 過），在真的 repo 上跑應為 604。
- 沒能驗證：Electron 35 實機（依 guard 不對真實 profile 開 Electron；View Transitions／`checkVisibility` 依 Chromium 134 支援推定，影格在 Playwright chromium-1228 上實拍）、手機實機觸控（觸控路徑只在 jsdom 與 harness 驗）、以及「好不好看」——影格是第一版，呼吸幅度、翻頁紙大小、愛心位置都留給 Fable 影格審查與 Brian 驗收調整。

## 給 1d（GitHub Pages 展示頁）的交接

- 展示頁只要原封複製 `desktop/js/mascot.js`、`desktop/css/mascot.css`、`desktop/js/mascot_motion.js`，頁面載入後呼叫 `MascotMotion.init()`；吉祥物用 `MascotModule.welcomeHtml()`／`emptyHtml(kind, caption)` 產生就自帶 `data-mm-*` 行為旗標。`desktop/tools/motion/harness.html` 就是最小可用的嵌入範例（它不載任何 App 模組）。
- **注意**：repo 根目錄 `.gitignore` 第 107 行有 `/site`（Python 範本遺留），1d 若照計畫把展示頁放在 `site/`，整個目錄會被忽略——1d 要先刪那一行或換目錄名。

## Self-Review 紀錄（計畫完成時逐項核過）

- **Spec 覆蓋**（plan of record 1c 十項）：①Rig→T2（＋像素工具）；②待機生命感→T4（排程器、可見度暫停、不動分離的吉祥物）＋T5（呼吸／眨眼／zzz）；③登入頁眼睛跟隨→T7；④點擊反應→T6（套用範圍與不套用範圍見設計決策）；⑤Onboarding→T9（契約調和見上）；⑥印章壓印→T10（「新」的判定見設計決策）；⑦存日記彩蛋升級→T8（安靜版、晚安版不變）；⑧視圖轉場→T11；⑨全域 reduced-motion→T4（animations.css、chat.css＋靜態 CSS 測試）＋每個任務自己的 reduce 版＋`capture-frames --reduced`；⑩既有規矩→Global Constraints＋T4（index.html／SHELL_ASSETS／main.js 守衛測試）＋T9／T10（守衛）＋T11（CACHE_VERSION、i18n 零新增、只動 desktop／docs）。brief 額外要求：像素同一性（T2）、影格 harness（T3，每個視覺任務的影格審查步驟列了時間點）、e2e 策略（T1＋T11）、危機訊號限制（上節）。
- **佔位符掃描**：全計畫沒有 TBD／TODO／「之後補」；每個程式步驟都附完整程式碼（測試檔與新檔全文、修改處給原文錨點＋新內容），程式碼直接取自逐任務驗證過的原型 commit。
- **型別／名稱一致**：`svg220(inner, size, pose, behavior)`（T5 起）、`face(inner, extraClass)`（T6 起）、`.mm-face:not(.mm-face-alt)`（T2 測試、T4 排程器、T7 跟隨一致）、`MascotMotion.isReducedMotion()`（T4 定義、T10 使用）、`mm-arm-l` 的 `transform-origin`（T7 定義、T9 使用）、`mm-twinkle`（T8 定義、T9 使用）、`.mascot-egg-happy`（T8 定義、T9 的 `showSaveEgg` 保留）、`urdiary:diary-saved` 的 `{diaryId, quiet, dayNote}`（T10 兩端一致）、`UIManager.viewTransitionSettled()`（T11 定義、e2e 使用）。
- **Review Focus**：五條各有測試落在負責任務（T9 兩條、T11、T4／T6／T7、T10）。

## 執行交接

依 plan of record：subagent-driven-development，implementer＝`opus-max` 代理、每個任務由 Fable 做 spec＋品質審查，視覺任務（T3、T5–T11）另看影格。任務之間有介面相依（rig class、`svg220` 參數、`showEggOverlay`），請依序執行。全部完成後：兩套件＋e2e 綠、Fable 影格審過、請 Brian 桌面驗收（先提醒他重啟 App；PWA 會跳「有新版本」提示）。v2.6 的 push／合併需要 Brian 另外同意。
