# URDiary 介紹影片（Remotion 專案）

這個資料夾把核可的分鏡 [`STORYBOARD.md`](STORYBOARD.md) 變成兩支 Remotion 合成：

| 合成 | 規格 | 用途 |
|---|---|---|
| `IntroLong` | 1920×1080、60 fps、5310 幀（88.5 s），props `{lang: 'zh' \| 'en'}` | 長版介紹片，zh／en 兩版共用同一條時間軸 |
| `ReadmeLoop` | 1280×720、30 fps、600 幀（20.0 s）、無聲 | README 頂端的循環（之後再轉 GIF／WebP） |

素材（ComfyUI 片段、UI 錄影、旁白、配樂）還沒到的地方，畫面會出現標好鏡頭編號的佔位卡、聲音則保持安靜，所以現在就能渲染出完整的草稿來檢查時間軸。

---

## 環境

- **Node 24**（使用者空間安裝，不要用系統的 Node 18、也不要 `npm i -g`）：
  ```bash
  export PATH="$HOME/.local/opt/node-24/bin:$PATH"
  cd promo/video
  npm ci            # 版本全部釘死在 package.json / package-lock.json
  ```
- **Chrome**：Remotion 會自己下載 chrome-headless-shell（149.0.7790.0，下載 91.9 MB、解開後 220 MB，放在 `node_modules/.remotion/`）。第一次渲染會自動抓，也可以先跑 `npx remotion browser ensure`。
- **ffmpeg**：渲染用 Remotion 內附的版本，不用另外裝。內附版很精簡（沒有 `tile` 等濾鏡），所以 `npm run contact-sheet` 與 check 的逐像素比對會改用 ComfyUI 旁的 `static_ffmpeg`（`/mnt/Data_SSD/ComfyUI/.venv/bin/`），也可以用 `FFMPEG=`／`FFPROBE=` 指定。
- **字型**：Noto Sans TC（中文）、Inter（英文內文、字幕）、Newsreader（字標與英文標題；展示頁用的是 Palatino／Iowan 系統字，Newsreader 是最接近的 Google Font）。三套都由 `@remotion/google-fonts` 在**渲染時**從 Google Fonts 下載（SIL OFL），所以渲染時要能上網。Noto Sans TC 只載入片中中文真正用到的 unicode 區塊（約 22 個，而不是 105 個），加了新的中文字也會自動算進去。

## 指令

| 指令 | 做什麼 |
|---|---|
| `npm run dev` | 開 Remotion Studio（瀏覽器預覽、拖時間軸） |
| `npm run check` | 全部檢查，見下方「檢查」 |
| `npm run render:draft` | 三支草稿：`out/draft/intro-zh.mp4`、`intro-en.mp4`、`readme-loop.mp4`（0.5 倍大小、CRF 28，畫面右上角燒入場次／秒數／幀號，頂端有十場的進度條） |
| `npm run render:zh` ／ `render:en` | 長版母帶 `out/intro-zh.mp4`／`intro-en.mp4`（H.264 CRF 16、x264 slow、yuv420p、BT.709、AAC 320k） |
| `npm run render:loop` | 循環母帶 `out/readme-loop.mp4`（無聲） |
| `npm run typecheck` | TypeScript 型別檢查 |
| `npm run contact-sheet -- <影片> <輸出.png> [--count=20]` | 平均取 N 格拼成一張總覽圖 |
| `scripts/make-intermediates.sh [id…] [--dry-run]` | 把 `src/data/shots.ts` 列的 ★ take 轉成 `public/media/ui/*.mp4`（見下方「UI 錄影」） |
| `node scripts/render.mjs --crf=18 --out-dir=<資料夾> --suffix=-v2 intro-zh intro-en loop` | 給人看的全尺寸版本（第二版剪輯輸出到 `/mnt/Data_SSD/urdiary-media/renders/v2/`，中間剪在 `renders/interim/`）；先跑 `npm run gen` |
| `node scripts/import-narration.mjs` | 把正規化旁白複製成 `public/media/narration/<lang>/<id>.wav`，先核對字、入點與 §0 的「到場尾留 0.8 s」 |

每個指令都會先跑 `npm run gen`：從 `desktop/` 重新產生吉祥物、從 `public/media/` 重新產生素材清單（兩者都在 `src/generated/`，不進 git）。

## 分鏡怎麼驅動程式

所有時間都用分鏡上的**絕對秒數**寫（「28.0–31.5 螢光筆」就寫 28.0、31.5），元件用 `<At from to>` 放上時間軸，巢狀也不會位移。改分鏡時只改 `src/data/` 的資料，改完跑 `npm run check`。

| 檔案 | 對應分鏡 | 內容 |
|---|---|---|
| `src/data/timeline.ts` | §1.1、§1.2 標題 | 十場的時間、幀號範圍、主來源；轉場表（沒有寫時間的三個轉場標 `timed: false`）。載入時就會驗算：場次首尾相接、幀號和分鏡標題一致、總和 5310 |
| `src/data/narration.ts` | §1.2 旁白、§0 節奏規則 | zh／en 旁白原文、入點、「最晚」結束時間、字幕怎麼斷行分段；§0 的字數／停頓規則寫成 `estimateSpeechSec()`，check 會用它重算每一句 |
| `src/data/captions.ts` | §1.2 畫面文字 | 每張字卡的中英文、進出時間、位置 |
| `src/data/media.ts` | §3.1、§4.3 | 鏡頭表（G1–G6、U02–U16）、每個鏡頭放在哪裡（`INTRO_PLACEMENTS`／`LOOP_PLACEMENTS`：時間；UI 錄影的來源時間由 `shots.ts` 的速度曲線決定，ComfyUI 鏡頭用 `srcIn`、`rate`、定格）、MG 圈選／螢光筆／推鏡的目標座標（`TARGETS`，錄影的 CSS px，zh／en 各一組）、S4 回憶句（日期＋標題）螢光筆的每一行（`QUOTE_SPANS`） |
| `src/data/audio.ts` | §5 | 配樂的淡入淡出與旁白下的 −9 dB 閃避（起音 150 ms、釋放 400 ms）、音效表 |
| `src/data/loop.ts` | §2 | 循環的分段、字卡、相位公式（週期 P＝123/24＝5.125 s；開頭用 t、結尾用 (t−20) mod P） |
| `src/data/recorded.ts` | S5、S6 | 實際錄到的印章（zh／en 各自的 take 鏈：S5 的今天 moon「靜靜的夜」／umbrella “Rainy Comfort”、好日子 sun） |
| `src/data/shots.ts` | §3 | UI 錄影：每個中間檔用哪個 ★ take、保留哪一段、裁切；每個 placement 的速度曲線（時間軸秒 → take 秒） |

十場各在 `src/scenes/S1.tsx`…`S10.tsx`；S2–S5 在分鏡裡是「同一個視窗內」溶接，所以共用一個視窗和一條連續的鏡頭軌（`src/scenes/cameras.ts`）。共用元件在 `src/components/`：`DeviceFrame`（桌面視窗、手機外框）、`Caption`（字卡）、`Subtitle`（旁白字幕）、`Transition`（溶接、紙張滑移、配對溶接的光）、`Placeholder`、`MediaSlot`、`Mascot`。

吉祥物與印章**不複製進 git**：`scripts/gen-mascot.mjs` 在 node:vm 裡執行 `desktop/js/mascot.js`，透過它的公開 API 取出 9 個姿勢與 24 枚印章，動作（搖擺、揮手、眨眼、呼吸）與支點則從 `desktop/css/mascot.css` 解析。App 改了吉祥物，影片下次 `npm run gen` 就跟著變。

## 素材放哪裡

全部放在 `public/media/`（**不進 git**；中間檔放 `/mnt/Data_SSD/urdiary-media/`，要用時複製或連結過來）。放好之後跑 `npm run gen`（Studio 會自動重載），`npm run check` 的第 5 段會列出哪些格子已經有檔案。

| 檔名 | 內容 | 要求 |
|---|---|---|
| `G1.mp4` … `G5.mp4` | ComfyUI 鏡頭（§4.3） | ≥1920×1080、補幀到 60 fps（§4.4）、靜音匯入 |
| `G6.mp4` | README 搖擺循環 | 24 fps、**124 幀、首幀＝尾幀**（循環會丟掉最後一幀）；方形，疊在 16:9 奶油底上 |
| `ui/U02-zh.mp4`、`ui/U02-en.mp4` …（`ui/U##-<lang>[-變體]`） | UI 錄影（§3）的中間檔 | 由 `scripts/make-intermediates.sh` 產生，見下方「UI 錄影」 |
| `narration/zh/S1.wav` …（`narration/<lang>/<id>`） | 旁白，一句一檔 | id＝`S1`–`S5`、`S6-A`、`S6-B`、`S7`、`S8`、`S9-A`、`S9-B`、`S9-C`、`S10`；由 `node scripts/import-narration.mjs` 複製（48 kHz WAV，檔頭約 0.12 s 靜音，WAV 的第 0 秒放在入點）。有檔案之後，字幕長度、配樂閃避都改用檔案的實際長度 |
| `music/bed-90s.mp3` | 90 s 配樂床（§5.1） | 已剪到 88.5 s 對齊畫面 |
| `sfx/<id>.mp3` | 音效（§5.1） | id 見 `src/data/audio.ts`：`room-tone`、`typing`、`chime`、`paper`、`click`、`page`、`stamp`、`rain`、`cup`（選用） |

### UI 錄影（中間剪起）

原始錄影在 `/mnt/Data_SSD/urdiary-media/recordings/<U>/<lang>-take<N>.mov`（ProRes 422 HQ；桌面 3840×2160、手機 1170×2532，都是 CFR 60），每個 take 的事件時間與 LLM 原文在同目錄的 `SHOTLOG.md`／`<take>.json`。`src/data/shots.ts` 是唯一的對照表：

- **`CLIPS`**：一列一個中間檔——用哪個 ★ take（全部是修正 UI 後重錄的 take：zh 主線 U03／U04 take26 → U06／U07 take10 → U15 take6；en 主線 U03／U04 take26 → U06／U07 take11 → U15 take7；S7 用 D+1 早上的 U12 zh-take7／en-take4，尾巴接 U13 zh-take8／en-take4；其他鏡頭用 `_picks.json` 的 ★）、保留哪一段（`in`／`out`，已含 0.5 s 前後餘量，腳本會取整到 1/60 s 的整幀）、要不要裁切（`crop`，錄影的 CSS px）與輸出倍率（`scale`：桌面整張 1＝1920×1080；手機 2＝780×1688——585 是奇數寬、x264 yuv420p 不收，S7 出場又會推到 1.75 倍；回憶卡／印章卡／彩蛋小窗／供應商小窗的裁切 2＝4K 原生解析度，放大成浮卡也清楚）。
- **`SPEED_MAPS`**：每個 placement（`media.ts` 的 key）在時間軸上放 take 的哪一段，寫成節點 `[時間軸秒, take 秒]`；節點之間線性，斜率 1＝原速、>1＝分鏡寫的「加速」（打字、等回覆、生成日記）、兩個節點 take 秒相同＝定格。take 秒就是 SHOTLOG 的時間，直接對得起來。`<MediaSlot>` 每一幀算出 take 秒、減掉中間檔的 `in`，用一個起點位移過的 `<Sequence>` 把 `<OffthreadVideo>` 釘在那一幀（不用 `<Freeze>`：它的幀號會被夾到合成長度，600 幀的循環裡後段會拿到錯的幀）——**加速不燒進檔案**，改節點就好，不必重轉。
- **MG 目標**（`media.ts` 的 `TARGETS`／`QUOTE_SPANS`）：圈選、螢光筆、推鏡、點擊波紋的位置，錄影 CSS px，zh／en 分開（按鈕寬度、引用句換行都不同：en 的 “September 14 in “Sleepless before my first / presentation,”” 跨兩行，螢光筆一行接一行掃），在 take 上實測。
- **跳接**：速度曲線裡兩個節點同一個時間軸秒＝在那一刻換到 take 的另一秒。用來跳過 App 自己的「加載中」深色遮罩（S5 切日記頁、U10 彩蛋）與游標經過時閃一下的 hover（U07 點今天）；跳點前後的畫面相同或只差頁面切換。

```bash
scripts/make-intermediates.sh --dry-run      # 看要轉哪些、每個從第幾幀到第幾幀
scripts/make-intermediates.sh                # 全部（27 個檔，約 3 分鐘；nice，錄影中也能跑）
scripts/make-intermediates.sh ui/U12-zh U05  # 只轉某幾個（id 或鏡頭名）
```

輸出一律 H.264 CRF 14 slow、yuv420p、GOP 30、BT.709、faststart、60 fps、無聲，逐檔 ffprobe（尺寸、fps、幀數）。take 本身就是時間戳精確的 CFR 60，所以逐幀直通（中間檔第 k 幀＝take 第 in＋k 幀，已實測）。

**換 take（例如 U12 再重拍）**：只改 `shots.ts` 那一列的 `take`，再跑 `scripts/make-intermediates.sh ui/U12-zh`。U12 的列帶 `anchor`（錄影器事件 `check-in greeting shown` 在量節點那個 take 的秒數），腳本會到新 take 的 JSON 找同一個事件、把裁切平移同樣的秒數，所以中間檔裡問候出現的時間不變、S7 的節點不用動。其他鏡頭換 take 時，照新 take 的 SHOTLOG 時間（畫面實際變化的那一幀，錄影器事件常晚 0.2–0.6 s）改該 placement 的節點。

## 檢查（`npm run check`）

1. **時間軸**：十場首尾相接、秒數落在幀上、幀號＝§1.2 標題、總和 5310 幀。
2. **旁白與字幕**：入點 ≥ 場首＋0.6 s；用 §0 規則重算的最慢結束時間和分鏡的「最晚」一致（分鏡四捨五入到 0.05／0.1 s），並且到場尾至少留 0.8 s（或趕在下一句之前）；有 TTS 檔時用實際長度再檢查一次（超出就要刪字，§0）。字幕：串起來要和旁白一字不差，zh 每行 ≤16 字、en 每行 ≤42 字元、每段 ≤2 行。
3. **畫面文字**：每張字卡都在自己那場裡、中英文都有。
4. **循環數學**：P＝5.125 s、相位 (17)＝2.125、相位 (20)＝0；循環字卡的字級 en ≥44 px、zh ≥40 px（§2「無聲可讀」）。
5. **素材清單**：哪些格子有檔、G6 是不是 124 幀／24 fps、UI 錄影是不是 60 fps。
6. **版面**：在 Chrome 裡用正式字型、以 1080p 排出每一張字卡、片尾卡的每一層、每一行字幕、循環的字卡，量行數：超過兩行（或字幕有任何一行折行）就失敗。總覽圖存在 `out/check/caption-audit-{zh,en}.png`。
7. **循環接縫**：渲染第 0 幀與第 600 幀（t＝20.000 s，循環本身不輸出這一幀），兩張要逐像素相同；第 599 幀必須和第 0 幀不同（接縫不會重複停一幀）。

## 授權

- **Remotion**：採 Remotion 的 Free License——個人、3 人以下的營利組織、非營利組織都可以免費使用（包含商業用途）；超過這個規模的公司要買 Company License。條文在 `node_modules/remotion/LICENSE.md`。Brian 是個人（學生）專案，符合 Free License，不需要 license key；沒有設定 key 時渲染器不會送出任何使用紀錄。
- **字型**：Noto Sans TC、Inter、Newsreader 都是 SIL Open Font License。
- 本資料夾的程式碼隨 repo 採 Apache-2.0。

## 還沒做的事

- ComfyUI 鏡頭（G1–G6）、配樂、音效——目前是佔位／靜音（配樂閃避的邏輯已接好，有檔就生效）。UI 錄影與旁白已接上（第二版剪輯）。
- U12（S7 手機早安，D+1 早上錄）的輸入列麥克風鍵是空圓（zh-take7、en-take4 都是）。推測原因：照 SHOTLOG，手機 session 在台北 20:4x 就載入頁面、停在密碼框，比圖示修正（677fa88，21:24）早，23:05 登入時沒有重新載入。要修只能重拍 U12（重新載入頁面）；桌面鏡頭都是修正後的。
- `G1_PHONE_POINT`（S1 → S2 的光從哪裡出發）要等 G1。
- 響度（整合 −16 LUFS、真峰值 ≤ −1.5 dBTP，§5.1）留到混音時處理，Remotion 這邊只做相對音量。
- ReadmeLoop 的 GIF（800×450、15 fps、palettegen）與 animated WebP（960×540）輸出是 Stage 3 的事；這裡先出 mp4 母帶。
