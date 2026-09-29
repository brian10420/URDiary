# URDiary v2.6 動畫・互動・介紹影片線（Motion & Showcase）— 計畫

## Context

2026-09-29 Brian 宣告 Spec B（對話體驗）真機驗收**全部通過**（先前已簡測；A/B 表未逐項填，「之後有問題再回頭」），並新增一條線：**用 ComfyUI 與 Opus 5.5 max 做互動動畫，以及可放上 GitHub 的專案介紹影片**，要求盡可能最高品質、提高互動性；可以盡情用 ComfyUI、需要下載什麼都行（裝不了再問他）。本計畫＝先計畫、下個 session 起執行。

2026-09-29 已定裁決（AskUserQuestion）：
- **放置**：兩邊都做——App 內吉祥物互動升級＋GitHub Pages 互動展示頁，素材共用。
- **風格**：雙軌——App 內維持 inline SVG 向量（守 mascot 風格契約，Opus max 精修動畫）；影片／展示頁用 ComfyUI 生成動漫級高品質渲染與動態鏡頭。
- **影片**：短＋長兩版——README 頂端 15–20 秒無聲循環＋60–90 秒完整版（字幕、TTS 旁白、背景音樂）；長版用同一個 Remotion 合成分別出 zh-TW／en 兩個旁白版本。
- **Spec B**：由 Claude push＋開 PR＋合 main。
- **GPU**：等 Echo_mind protocol ladder 跑完（09-29 時 61/99 輪、每輪約 2.6 h，估 10/03–10/04 完成）且 Brian 說 OK 才跑 ComfyUI。H3 生成時 VRAM 峰值 31.8 GB，不能與訓練並行。
- **xAI 金鑰**：錄影中陪伴者用真的 grok-4.3 回覆；旁白用 App 內建的 grok TTS（順便首次實測真金鑰語音路徑）。
- **私人截圖**：`Picture/desktop_show.png`（id 1 真實日記）搬到 repo 外 `~/Pictures/URDiary/`。

## 現況盤點（重用，不重做）

- **App 吉祥物**：`desktop/js/mascot.js`（226 行 IIFE，`window.MascotModule`，7 姿勢＋7 分類圖標＋24 印章，全 inline SVG 模板字串）、`desktop/css/mascot.css`（sway／dot／pop 三組 keyframes，reduced-motion 全停）。呼叫端：`chat_module.js:393/957/1018/1096`、`diary_module.js:233/346/492`、`calendar_module.js:489/708/729/750`、`main.js:624`。無任何動畫庫、無 View Transitions；`ui_manager.js switchToState`（521–560）只切 class＋發 `viewStateChanged`。
- **風格契約**：`docs/superpowers/specs/2026-08-14-mascot-illustrations-design.md`：描邊 `#4b2e1e`、書皮 `#b98d6d`、書頁 `#f9f3e6`、書籤 `#5fd0a0`、眼口 `#2b1a10`、腮紅 `#f0a78f`@55%；彩蛋只綁明確操作、valence<0.45 安靜、reduced-motion＝靜態。
- **sw.js**：新資產放 `desktop/assets/`（後端只掛 /js /css /assets），手動加 `SHELL_ASSETS`（同步測試只檢查 index.html 的 css/js）；大影片不進 precache。CSP 已允許 `media-src 'self' blob:`。
- **ComfyUI**（`/mnt/Data_SSD/ComfyUI`＝`~/Brian/ComfyUI`，0.35.0，在 `comfyui.scope` 閒置中，:8188）：Qwen-Image-Edit-2511 int8＋角度 LoRA＋Lightning、Qwen-Image 2512、Anima、MiniMax H3 全家（影片＋音訊）、birefnet、KJNodes／MAINodes／H3 guide／plaguekind。**缺**：放大模型、補幀模型、音樂模型（ACE-Step 節點在但無權重）、TTS、H3 Ref2VA base。
- **09-16 角色管線計畫** `/mnt/Data_SSD/ComfyUI/anime/plans/2026-09-16-urdiary-character-pipeline.md`：Task 1–5、7 的 workflow JSON 都已建好並 validate（`workflows/urdiary/02_multiangle`、`03_pose_*`×7、`04_loop_{sway,wave,sleepy}`、`05_ad_{draft_4step,final_20step}`），**GPU 步驟全未跑**；Global Constraints／Task 0 preflight／monitor.sh／H3 幀格（17k+5 @24fps）照用。未決項：final ad 用 FL2VA base 接 Ref2VA 節點，本機無 Ref2VA base。
- **工具鏈**：無系統 ffmpeg → 用 `/mnt/Data_SSD/ComfyUI/.venv/bin/static_ffmpeg`（8.0.1）或 kdenlive flatpak；Node 18.19.1；`desktop/node_modules/playwright` 1.61＋`~/.cache/ms-playwright` chromium；google-chrome 154；Noto CJK 字型齊。**無 gh CLI**（PR 走 Claude in Chrome 或 compare URL）。comfy-mcp 只註冊在 `/home/e604/Brian/ComfyUI` 專案 → GPU 場要在那個 cwd 開。
- **隔離後端範式**：`desktop/playwright.config.js`＋`e2e/e2e-env.js`（`URDIARY_DATA_DIR` mkdtemp、獨立埠 8123、stub provider）；`backend/app/config.py:24` 讀 `URDIARY_DATA_DIR`。
- **角色分工**（沿用視覺線記憶）：Opus 5.5 max（`opus-max` 代理）主導生成（動畫程式碼、展示頁、分鏡、ComfyUI 提示詞）；Fable 編排＋評估（程式審查、影格／contact sheet 對風格契約評分）；Brian 拍板風格、分鏡、聲音、成品。

## 階段總覽

| 階段 | 何時／cwd | GPU | 閘門 |
|---|---|---|---|
| 0 簿記 | 本 session 核可後立即 | 否 | 計畫核可 |
| 1 無 GPU 大宗 | 下個 session／`~/Brian/URDiary` | 否 | — |
| 2 ComfyUI 生成 | ladder 結束後／`~/Brian/ComfyUI` | 是 | nvidia-smi 無 Echo_mind＋Brian 說 OK |
| 3 合成與發布 | Stage 2 後／`~/Brian/URDiary` | 否 | 素材核可 |

## Stage 0 — 本 session 核可後立即（Brian 選 auto 即可無提示執行）

1. 記憶：更新 `urdiary-v2.5-ideas.md`（B 驗收通過 2026-09-29、A/B 表未逐項填、下一步＝本線 Stage 1，D／E 順延在本線之後）、`urdiary-visual-marketing-lane-2026-09-16.md`（本計畫路徑＋上列裁決）、`MEMORY.md` 兩行索引。
2. `mkdir -p ~/Pictures/URDiary && mv Picture/desktop_show.png ~/Pictures/URDiary/`，確認 `Picture/` 空了再 `rmdir`。
3. 把下方 Next-stage prompt 存成 `~/claude-handoffs/URDiary/2026-09-30_0000_motion-showcase-stage1.md`，最後訊息附貼用行。

## Stage 1 — 下個 session（無 GPU）

### 1a Spec B 收尾（先做）
1. 在 `feature/v2.5-conversation` 重跑：`cd backend && ../.venv/bin/python -m pytest -q`（期望 604 綠）、`cd desktop && npm test`（期望 464 綠）。
2. `docs/superpowers/reference/spec-b-ab-scenarios.md` 的「結論」填：2026-09-29 使用者宣告驗收通過（簡測；表格未逐項填，之後有問題再回頭）→ commit。
3. `git push -u origin feature/v2.5-conversation`。
4. PR：載入 chrome-browser skill，新分頁開 `https://github.com/brian10420/URDiary/compare/main...feature/v2.5-conversation?expand=1`，標題「v2.5 Spec B: 對話體驗（人味＋初次見面 onboarding）」，內文＝摘要＋測試數＋`🤖 Generated with [Claude Code](https://claude.com/claude-code)`；建立後用「Create a merge commit」（與 #12／#13 一致）。Chrome 不通 → 給 Brian compare URL 等他按。
5. `git checkout main && git pull --ff-only`，main 上雙套件重驗。
- **Done**：PR merged、`git rev-parse main origin/main` 相等、main 雙套件綠。

### 1b 研究＋下載（只動網路／磁碟，不跑 GPU、不重啟 ComfyUI）
每個欄位先 WebSearch 查 2026-10 當下最佳選項，核對授權、ComfyUI 支援、32 GB VRAM 可行性，再下載到 `models/` 對應資料夾；ComfyUI Python 依賴一律 `uv add`（使用者慣例）。
- 影片放大 864×480 → 1080p（候選 SeedVR2 類＋節點包，對照 plaguekind 已有的 H3 upscale）
- 補幀模型（給內建 `FrameInterpolate`；24 → 48／60 fps）
- 靜圖放大（插畫／動漫向 4x）
- 音樂：ACE-Step 1.5 權重（內建 `nodes_ace`），確認授權允許公開使用
- H3 Ref2VA base（09-16 未決項）若已釋出且放得下
- Remotion：先查它對 Node 18.19 的支援，不夠就在使用者空間裝新版 Node（不用 sudo），並記錄 Remotion 授權（個人免費）
- 磁碟預算 ≤ 80 GB（SSD 剩 472 GB）。要 sudo 或裝不起來 → 把確切指令交給 Brian。
- **Done**：`/mnt/Data_SSD/ComfyUI/anime/plans/2026-09-30-downloads.md` 列出路徑、大小、授權、sha256、用途。

### 1c App 內互動動畫（分支 `feature/v2.6-motion-showcase`，從新 main 開）
流程：用 writing-plans 把本節寫成 `docs/superpowers/plans/2026-09-30-motion-showcase.md`（連同本計畫一起 commit）→ subagent-driven-development，implementer＝`opus-max` 代理，每個任務由 Fable 做 spec＋品質審查＋影格目視審查。
設計（守風格契約：只用 inline SVG＋CSS／WAAPI，不加任何動畫庫，顏色鎖定）：
1. **Rig 化**：把 SVG 拆成具名群組（body／eyes／mouth／arm-l／arm-r／bookmark），既有姿勢外觀不變（加結構測試）。
2. **待機生命感**：呼吸＋隨機眨眼（3–7 s），分頁隱藏時暫停。
3. **登入頁眼睛跟隨游標**（位移夾限；觸控時看向點擊點）。
4. **點擊吉祥物的反應**：彈跳＋開心臉＋小愛心，有限流；算「明確操作」，符合契約 §4。
5. **Onboarding（Spec B）**：吉祥物揮手進場；取名完成時帶新名字小慶祝。
6. **行事曆印章壓印動畫**：只在新蓋的章首次出現時播，session 內不重播。
7. **存日記彩蛋升級**：翻頁／書籤飄動；保留 valence<0.45 安靜與夜間版。
8. **視圖轉場**：chat／diary／calendar 切換改用 `document.startViewTransition`（Electron 35），不支援時退回現行 class 切換。
9. **全域 reduced-motion**：擴及 `animations.css`、`chat.css` 與所有新動畫；JS 端先查 `matchMedia` 再啟動 WAAPI。
10. **既有規矩照守**：不對聊天內容起反應；前端目前沒有危機訊號（記為已知限制）；新資產放 `desktop/assets` 並加進 `SHELL_ASSETS`；保留 `typeof MascotModule` 守衛；新增文字兩語同步。
- **測試**：vitest 測觸發邏輯（限流、reduced-motion 分支、安靜門檻、rig 結構）；既有 mascot 測試與 e2e 維持綠。
- **Done**：兩套件＋e2e 綠；Fable 審過隔離後端 PWA 的影格；Brian 桌面驗收（先提醒他重啟 app）。

### 1d GitHub Pages 展示頁（同分支，`site/`，純靜態、不需建置）
- 單頁雙語（zh-TW／en 切換，預設依 `navigator.language`）。
- 區塊：
  - Hero：短循環影片（先放 placeholder）＋可互動吉祥物，部署時直接複製 `desktop/js/mascot.js` 與 `desktop/css/mascot.css`，只維護一份來源
  - 捲動式功能導覽：陪伴對話、初次見面與取名、自動日記、行事曆與印章、記憶 2.0 與 consent 帳本、語音、PWA／手機、本地優先
  - 吉祥物遊樂場：姿勢與彩蛋可點
  - 完整影片
  - 開始使用 → README
- 部署用 `.github/workflows/pages.yml`：push main 且動到 `site/**` 或 mascot 檔時，組 artifact → `actions/upload-pages-artifact` → `actions/deploy-pages`。
- **Brian 一次性操作**：GitHub repo Settings → Pages → Source 選「GitHub Actions」。
- **Done**：本地 `python3 -m http.server` 起站，headless Chrome 在 1440 與 390 寬度截圖，兩語都看、另外模擬 reduced-motion；console 零錯誤；Fable 審過畫面。

### 1e 示範資料＋實機錄影
- **隔離後端**：`URDIARY_DATA_DIR=<scratchpad>/demo-data`，埠 **8124**（不用 8001／8123），照 `e2e-env.js` 的安全範式；絕不碰 `data/urdiary.db`。
- **虛構示範人物**：Opus 寫中英各一位，約三週的日記、事件、印章；由 `promo/demo/seed_demo.py`（進版控）透過 API 灌入。
- **即時對話段**：用真 grok-4.3。金鑰只從 `~/.config/urdiary-promo/xai_key`（0600，repo 外）讀，絕不印出、不進檔。先查 PWA 模式下金鑰怎麼帶，用 Playwright context 注入。
- **錄製**：Playwright＋Chrome（`--disable-gpu`），桌面 1920×1080@DPR2、手機 390×844；用 CDP screencast 的 PNG 幀或 recordVideo，取品質最好且可行的方式。用 static_ffmpeg 轉成高畫質中間檔，存在 repo 外 `/mnt/Data_SSD/urdiary-media/recordings/`。
- **Done**：分鏡要的每個 UI 鏡頭都有可用素材，Fable 看過 contact sheet。

### 1f 分鏡＋旁白＋Remotion 骨架
1. Opus max 起草兩份分鏡：
   - 長版 60–90 秒，8–10 場，每場寫：時間、畫面來源（ComfyUI 片段／UI 錄影／動態圖形）、zh 與 en 旁白、畫面文字
   - README 用的 15–20 秒無聲循環
   - 存到 `promo/video/STORYBOARD.md`
2. Fable 逐句核對事實：只宣稱現有功能。**文案準確性**：「資料存在你的電腦」可以說，但要承認聊天內容會送到你選的 AI 供應商，也可選本地模型。09-16 草稿那句「你的日記，只留在你的電腦」要改寫。
3. **Brian 核可分鏡與旁白稿**（檢查點：這之後才花 TTS 和 GPU）。
4. **旁白**：
   - 走 App 的 grok TTS 路徑：`backend/app/services/voice_service.py` 打 `https://api.x.ai/v1/tts`
   - 先查 xAI 現有聲音清單，產 2–3 個試聽給 Brian 選，再逐句產 zh 與 en
   - 順便把「真金鑰 TTS 首測」結果寫進記憶
5. **Remotion 專案 `promo/video/`**（原始碼進版控；`node_modules`、`public/media`、渲染輸出進 `.gitignore`）：
   - 合成：`IntroLong`（props `lang: zh|en`，1920×1080 60fps）與 `ReadmeLoop`
   - 字幕元件、裝置外框、轉場
   - ComfyUI 片段先用 placeholder 佔位，先出一版草稿驗時間軸
- **Done**：分鏡已核可；兩語旁白音檔齊；placeholder 草稿能順利渲染。

## Stage 2 — ComfyUI GPU 場（閘門：`nvidia-smi --query-compute-apps=pid,process_name --format=csv` 無 Echo_mind，且 Brian 說 OK；cwd `/home/e604/Brian/ComfyUI` 才有 comfy-mcp）

照 09-16 計畫的 Global Constraints 執行：只經 launcher 啟動（`comfyui.scope`）、跑 H3 時開 `monitor.sh`、排隊前先過 `validate_workflow`、不覆寫 `workflows/minimax_h3/`。
1. 跑 Task 0 preflight。1b 若裝了新節點包，要經 launcher 重啟。
2. **風格測試**：同一個 hero 鏡頭各出一組 4-step 草稿，三種畫風：
   - 精緻 2D 動漫賽璐璐＋柔光
   - 柔和 3D 黏土／玩具感
   - 精修扁平向量（09-16 廣告的畫風）
   - 做成 contact sheet → Fable 依風格契約評身份一致性 → **Brian 選一種**。
3. 用選定畫風跑多角度表（Task 2）＋7 姿勢（Task 3）→ Fable 審一致性，不行就重跑。
4. 循環動畫（Task 4：sway／wave／sleepy，首幀＝尾幀）→ 做 README 與展示頁的 hero loop。
5. 分鏡各場：H3 ref2va 4-step 草稿 → 挑好的 → 20-step 定稿（依 1b 的 Ref2VA 結論）。
6. 後製：放大到 ≥1080p、該補幀的補幀、用 MAINodes 做 color carry，輸出高畫質中間檔。
7. **音樂**：ACE-Step 出 90 秒溫暖鋼琴＋pad 的配樂床，以及 20 秒循環版，各給 3 選 1 → Brian 挑。
8. 紀錄寫進 `anime/plans/2026-09-30-urdiary-showcase-gpu.md` 的 Execution log。
- **Done**：分鏡每一格都有核可的 ≥1080p 定稿；音樂已核可。

## Stage 3 — 合成與發布（`~/Brian/URDiary`）
1. **渲染**：把素材放進 `promo/video/public/`，渲染 `IntroLong` zh 與 en 兩版（母帶：1920×1080 60fps h264 高畫質）與 `ReadmeLoop`（mp4＋GIF／animated WebP；可用 `anime/scripts/video_to_gif_webp.py` 或 ffmpeg palettegen）。
2. **發布型態**：先查 GitHub README 影片附件的大小上限。
   - README 頂端：短循環
   - 長版：Release asset 放母帶，另附符合上限的壓縮版 user-attachment
   - YouTube 由 Brian 決定要不要
   - **git 裡不放任何 >10 MB 的檔**
3. **README 改版**（中英兩段）：
   - hero loop＋功能截圖（示範帳號重拍）
   - 連到 Pages 與影片
   - 修正過時的測試數（398/269 → 實際數字）
4. **展示頁**：換上真素材。
5. **最終審查**：Fable 審整個分支；Brian 看成片，並驗收 App 內動畫。
6. **上線**：push、開 PR、合併。這次合併**要 Brian 另外同意**，Spec B 的授權不延伸到 v2.6。合併後確認 `https://brian10420.github.io/URDiary/` 上線。

## Critical files

- 修改：`desktop/js/mascot.js`、`desktop/css/mascot.css`、`desktop/css/animations.css`、`desktop/css/chat.css`、`desktop/js/ui_manager.js`、`desktop/js/{chat,diary,calendar}_module.js`、`desktop/js/i18n.js`、`desktop/sw.js`、`README.md`、`docs/superpowers/reference/spec-b-ab-scenarios.md`
- 新增：`site/**`、`.github/workflows/pages.yml`、`promo/video/**`（Remotion＋`STORYBOARD.md`）、`promo/demo/seed_demo.py`、`desktop/tests/mascot_motion*.test.js`、`docs/superpowers/plans/2026-09-30-motion-showcase.md`
- 重用：`e2e/e2e-env.js` 隔離範式、`backend/app/services/voice_service.py`、`/mnt/Data_SSD/ComfyUI/anime/scripts/*.py` 與 `workflows/urdiary/*.json`

## Guards

- **GPU**：Stage 2 閘門前不排任何 ComfyUI 工作、不重啟 ComfyUI；絕不碰 Echo_mind 的程序或檔案。
- **帳號與資料**：絕不用 id 1、`data/urdiary.db` 或 Brian 的 Electron profile，也不對真實 profile 開第二個 Electron 實例（2026-08-22 事故）；示範一律用隔離資料目錄＋埠 8124。
- **金鑰**：只放 `~/.config/urdiary-promo/xai_key`（0600）；不 echo、不 commit、不寫進 log。
- **風格與規則**：守風格契約與契約 §4；App 內不加動畫庫。
- **宣傳文案**：必須與 README 事實一致。
- **授權**：每個下載的模型／音樂都記下授權。
- **git**：媒體與模型都放 repo 外；commit trailer 用 Claude Fable 5.1；push 與合併依授權（Spec B＝已授權；v2.6＝另問）。
- **ComfyUI**：Python 依賴用 `uv add`；只經 launcher 起；跑 H3 要開 `monitor.sh`（中止條件：host MemAvailable <3 GB 持續 10 s，或 PSI full >20）。
- **排程**：Spec D／E 排在本線之後；本線跑完才開 D 設計場。

## Verification

- **Spec B**：PR 已合、main 與 origin/main 相等、雙套件綠。
- **App 動畫**：vitest＋e2e 綠。在隔離後端的 PWA 上用 CDP 截圖或 screencast 審影格，reduced-motion 模擬下要是靜態。最後由 Brian 桌面驗收。
- **展示頁**：本地起站，兩種寬度×兩語截圖、console 零錯誤；上線後 curl 確認 Pages URL 回 200。
- **ComfyUI**：每個 workflow 排隊前都 `validate_workflow` 通過；跑時 monitor.sh 不觸發中止條件；每批出 contact sheet 給 Fable 對風格契約評分，再由 Brian 核可。
- **影片**：用 ffprobe 確認解析度、fps、長度、音軌；用 ffmpeg loudnorm 量測響度，目標約 −16 LUFS；抽幀審查；Brian 看完成片才發布。

## Next-stage prompt

**URDiary · motion-showcase Stage 1 — continuation prompt (2026-09-30 00:00)**

**Header:** paste after /clear · Fable 5.1 @ high · mode: auto · Presence: present

**Lane + roles:** URDiary v2.6 動畫・互動・介紹影片線 Stage 1（無 GPU）· Fable 編排＋審查；`opus-max` 代理（Opus 5.5 @ max）實作動畫程式碼／展示頁／分鏡；Explore 代理查找；Claude in Chrome 只用於開 PR。

**Scope fence:** `/home/e604/Brian/URDiary`（合併 feature/v2.5-conversation → main；新分支 feature/v2.6-motion-showcase）、ComfyUI `models/` 與 `custom_nodes/` 的下載安裝、`/mnt/Data_SSD/urdiary-media/`、`~/.config/urdiary-promo/` · NOT：任何 ComfyUI 生成工作或重啟（屬 Stage 2）、Echo_mind 一切、`data/urdiary.db`、帳號 id 1、在 Brian 的 profile 開 Electron、`workflows/minimax_h3/`。

**No-deadline line:** 無截止日；品質優先。

**Authority:** 「卡住中那邊全部通過…我還希望增加一個部份是動畫結合ComfyUI或是opus 5.5 max互動動畫與專案介紹影片生成，你可以盡情使用ComfyUI需要我下載哪些工作流檔案都行，裝不了再跟我說，並且盡所能得到最高品質…」＋2026-09-29 七項裁決（見計畫 Context）· decision class：execution only。分鏡／旁白稿、畫風、聲音、成片、v2.6 合併＝user decides。

**State pointers:**
- Plan of record: `/home/e604/.claude/plans/comyfyui-opus-5-5-max-conmfyui-github-s-steady-canyon.md`（1c 會把它 commit 成 `docs/superpowers/plans/2026-09-30-motion-showcase.md`）
- Ledgers / status files: memory `urdiary-v2.5-ideas.md`、`urdiary-visual-marketing-lane-2026-09-16.md`；ComfyUI 端 `/mnt/Data_SSD/ComfyUI/anime/plans/2026-09-16-urdiary-character-pipeline.md`（Execution log）
- Commits: `af7306a` — Spec B 最後一筆（branch feature/v2.5-conversation，main..HEAD 27 commits，未 push）；`2b5667f` — main＝origin/main，可 fast-forward
- Running jobs: Echo_mind protocol ladder（GPU 10 GB，估 10/03–04 完成）· 查法 `nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv` 與 `tail -3 ~/Brian/Echo_mind/benchmark_runs/protocol_ladder_20260925/driver.log`；ComfyUI 在 comfyui.scope 閒置（:8188）
- Done — do not repeat: Spec B 實作＋Brian 驗收通過；09-16 ComfyUI workflow JSON 建好並 validate；resilient-dazzling-phoenix 的模型全數下載完成；Stage 0（記憶、交接檔、私人截圖搬到 `~/Pictures/URDiary/`）

**Read first:**
1. 本計畫檔 — 裁決、Stage 1 各步與 done 條件
2. `docs/superpowers/specs/2026-08-14-mascot-illustrations-design.md` — 風格契約（1c 必守）
3. `desktop/js/mascot.js`＋`desktop/css/mascot.css` — 要 rig 化的現行實作
4. `desktop/e2e/e2e-env.js` — 隔離後端範式（1e 照抄）

**Next actions (in order):**
1. 1a Spec B 收尾 — done when：PR 已合、main＝origin/main、main 上 604／464 綠
2. 1b 研究＋下載 — done when：`anime/plans/2026-09-30-downloads.md` 有路徑、授權、sha256，且沒有排任何 GPU 工作
3. 1c App 內互動動畫（writing-plans → SDD with opus-max）— done when：套件＋e2e 綠、Fable 影格審過、請 Brian 桌面驗收
4. 1d 展示頁＋pages.yml — done when：本地兩寬×兩語截圖審過、請 Brian 開 Pages
5. 1e 示範資料＋錄影 — done when：分鏡要的 UI 鏡頭都齊
6. 1f 分鏡→Brian 核可→旁白→Remotion placeholder 草稿 — done when：草稿渲染成功
7. 寫 Stage 2 交接檔（cwd `~/Brian/ComfyUI`，閘門＝ladder 結束＋Brian OK）

**Guards:**
- 無 GPU：Stage 1 不排任何 ComfyUI 工作、不重啟 ComfyUI、不碰 Echo_mind
- 絕不用 id 1、`data/urdiary.db`、真實 Electron profile；示範用隔離資料目錄＋埠 8124
- xAI 金鑰只從 `~/.config/urdiary-promo/xai_key` 讀，不 echo、不 commit
- 守風格契約與契約 §4、不加動畫庫；宣傳文案要與事實一致（聊天內容會送到所選 AI 供應商）
- git 不放 >10 MB 檔；push／合併依授權（Spec B 已授權，v2.6 另問）；trailer 用 Claude Fable 5.1
- 宣稱完成前先跑驗證指令、貼出輸出

**Open questions for the user (batched):**
- xAI 金鑰檔：請 Brian 在自己的終端機跑 `mkdir -p ~/.config/urdiary-promo && (umask 077; read -rsp 'xAI key: ' k; printf %s "$k" > ~/.config/urdiary-promo/xai_key)` — 沒有檔案就先用 stub 錄非對話鏡頭、旁白延後
- GitHub Pages：到 Settings → Pages → Source 選「GitHub Actions」— 沒開就先本地預覽
- 長版影片要不要另外放 YouTube — 預設不放，只用 Release asset＋README 附件
- 旁白聲音從 2–3 個試聽中挑 — 沒回覆就用 xAI 預設 `eve`

**End ritual:**
- Memory：更新 `urdiary-visual-marketing-lane-2026-09-16.md`（Stage 1 進度）＋`urdiary-v2.5-ideas.md`（B 已合 main），並更新 MEMORY.md 索引
- 只 commit 本 session 自己的路徑（`docs/`、`desktop/`、`site/`、`promo/`、`.github/`），帶現行 attribution
- context 過 30／50／70／85% 時寫交接檔；最後訊息 ≤15 行，以貼用行結尾

**Paste line:** `Read ~/claude-handoffs/URDiary/2026-09-30_0000_motion-showcase-stage1.md and follow it.`

## 2026-09-30 執行追記

- **1a**：Spec B＝PR #14 合入 main@7210700（604／464 綠）。**e2e 在 main 上是紅的**（Spec B onboarding 攔截了旅程第一則訊息，2 failed／10 did not run）→ 由 1c 計畫 Task 1 修。
- **1b**：下載清單與 sha256 見 `/mnt/Data_SSD/ComfyUI/anime/plans/2026-09-30-downloads.md`；授權稽核見同目錄 `2026-09-30-license-audit.md`。
- **H3 授權裁決（Brian，2026-09-30）**：MiniMax H3 授權 I.5／V.4 排除 EU／UK／韓國／美國且禁止在區外 display Outputs——公開 README／Pages 全球可見，**公開素材一律不用 H3（含 H3 audio）**；Stage 2 的影片改用 **Wan 2.2 14B（Apache-2.0，first/last frame，可做首尾同幀循環）**，關鍵影格用 Qwen-Image-Edit（Apache-2.0）；H3 只限私下草稿。下載預算由 80 GB 放寬到約 100 GB。
- **1c 實作計畫**：`docs/superpowers/plans/2026-09-30-motion-showcase-1c-app-motion.md`（11 任務）。
- **1d 注意**：repo 根 `.gitignore` 有 `/site`（Python 範本遺留），展示頁目錄需先處理。
