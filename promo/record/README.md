# 介紹影片 UI 錄影（promo/record）

v2.6 動畫・互動・介紹影片線 1e.2：照 `promo/video/STORYBOARD.md` §3 的鏡頭表（U01–U17），用 Playwright 驅動
**隔離 demo 後端**（`promo/demo/`，127.0.0.1:8124）上真實的 App，錄成 60 fps 的中間檔。陪伴者的回覆、日記、
印章、問候全是當下由 grok-4.3 產生：**可以挑 take，不可以改字**。

## 鐵律

- 只連 **8124**，資料目錄一律是 `seed_demo.py` 種出來的暫存目錄。不碰 repo 的 `data/`、8001、8123、帳號 id 1。
- 錄影器**不讀金鑰**。金鑰只由 `promo/demo/run_demo_backend.sh` 從 `~/.config/urdiary-promo/xai_key` 交給後端行程。
- 錄影檔只寫到 `--out`（預設 `/mnt/Data_SSD/urdiary-media/recordings/`），不進 git。
- 重拍前的狀態重設一律走 `seed_demo.py` 的維護旗標（`--set-checkin`、`--clear-chat`、`--reset-hello`）；
  它們等同 `DELETE /chat/clear/`，但也能把「今天問候過了沒」改回來。

## 怎麼錄

```bash
# 0) 種子＋真模式後端（見 promo/demo/README.md）
export URDIARY_DATA_DIR=$(mktemp -d /tmp/urdiary-rec-XXXXXX)
.venv/bin/python promo/demo/seed_demo.py
promo/demo/run_demo_backend.sh            # 另開一個終端機；真的 grok-4.3

# 1) 錄（每次一個 session、一種語言；take 編號自動往上加）
node promo/record/record_shots.js --list                      # 列出 session 與鏡頭
node promo/record/record_shots.js --session phone  --lang zh  # U12＋U13（真 LLM：每日問候）
node promo/record/record_shots.js --session browse --lang en  # U16 U05 U08 U09 U11 U14（不打 LLM）
node promo/record/record_shots.js --session chain  --lang zh --attempts 4            # U03→U04→U06→U07→U15
node promo/record/record_shots.js --session chain  --lang zh --role copy --attempts 4  # 第二條主線（複本帳號）
node promo/record/record_shots.js --session happy  --lang zh  # U10 開心彩蛋（05:00–21:59 錄）
node promo/record/record_shots.js --session hello  --lang en  # U02；whatever＝U17；login＝U01；phonecal＝只有 U13

# 2) 組裝成 60 fps 中間檔＋ffprobe 驗證＋contact sheet（預設 ProRes 422 HQ；--codec h264 改 H.264 CRF 12）
node promo/record/record_shots.js --assemble [--shot U03,U04] [--lang zh] [--threads 3] [--keep-raw]
#    4K ProRes 很吃 CPU（實測單一工作約 5–14 倍實際長度，看機器忙不忙）。可以同時開幾個組裝行程：
#    每個 take 有一把鎖（raw 目錄裡的 .assembling），別的行程會跳過；--longest-first 長的先做，
#    --no-sheets 讓各行程不寫 contact sheet（最後用 --sheets 一次重做）。例：8 核開 4 個
#    node promo/record/record_shots.js --assemble --threads 2 --longest-first --no-sheets
node promo/record/record_shots.js --sheets     # 只重做每個鏡頭的 contact sheet

# 3) 產生 SHOTLOG.md（挑選建議寫在 <out>/_picks.json，會併進去）
node promo/record/record_shots.js --shotlog
```

`--attempts N`（只對 `chain` 有意義）：U04 的回覆沒有同時引用 D-16 那篇的「日期＋《標題》」、而且還有次數時，
這一輪就停在 U04（不結束對話），換新的 context 從 U03 重來；最後一次不管有沒有引用都往下錄 U06。
**同一個帳號一天只能結束一次對話**（再結束會覆蓋今天的印章），所以第二條主線用 `--role copy`，
或停掉後端、`seed_demo.py --reset` 重種。U06 之後、同一天的 U12 會把「今天的日記」當成最近一篇，
所以 U12 要在主線之前錄（或重種之後）。

## U12 主方案：不用等到隔天早上

分鏡 S7 要的是「D+1 早上、第一次打開 App」：昨天＝主線 U06 寫出的真日記、今天 10:00 有助教課、問候是早上版。
App 的「今天」「早上」都跟著後端的 `URDIARY_TIMEZONE` 走（05:00 換日，05:00–10:59 是早上），所以把整個隔離環境
放到 UTC+14（Pacific/Kiritimati，比台北快 6 小時）就能在同一個晚上錄完：

```bash
export URDIARY_TIMEZONE=Pacific/Kiritimati          # 種子、demo 後端、錄影器（seed 維護旗標）都要用同一個
export URDIARY_DATA_DIR=$(mktemp -d /tmp/urdiary-rec-XXXXXX)
.venv/bin/python promo/demo/seed_demo.py              # 摘要要印出 D0＝當地換日前的那一天
promo/demo/run_demo_backend.sh                         # 另一個終端機（同樣 export 那個時區）

# 1) 當地 05:00 之前（台北 23:00 前）：主線寫出 D0 的日記（每個帳號一次）
node promo/record/record_shots.js --session chain --lang zh --attempts 1
node promo/record/record_shots.js --session chain --lang en --attempts 1

# 2) 仍在 05:00 之前：把手機 session 開好、停在密碼框（瀏覽器時區預設取種子 manifest 的時區）
node promo/record/record_shots.js --session morning  --lang zh --at 2026-10-01T05:05:00+14:00 &
node promo/record/record_shots.js --session morning  --lang en --at 2026-10-01T05:06:30+14:00 &
node promo/record/record_shots.js --session morning2 --lang zh --at 2026-10-01T05:08:30+14:00 &   # 重拍：先把問候改回昨天
node promo/record/record_shots.js --session morning2 --lang en --at 2026-10-01T05:10:30+14:00 &
```

鐵律：05:00 之後，在錄影開始之前**不能有任何登入**（登入就會呼叫 check-in，把「今天第一次」用掉）。
所以設定階段（登入、開關設定、停在密碼框）一律在 05:00 之前做完，時間到了只按「登入」。

## 晚上版：S3／S4 要在晚上（台北已過 23:00 也能錄）

分鏡 §3 的 S3／S4 發生在晚上：U03 畫面最上方的每日問候要是「晚上好／Evening」（`_time_of_day_label`：18:00–22:59，
看後端的 `URDIARY_TIMEZONE`）。台北太晚時，把整個隔離環境放到一個「現在是 18:xx–20:xx、而且和台北同一天」的時區，
例如 Europe/Moscow（UTC+3：台北 23:20＝莫斯科 18:20）。種子、demo 後端、錄影器（seed 維護旗標）用同一個
`URDIARY_TIMEZONE`；瀏覽器時區預設取種子 manifest 的時區，不必另給 `--tz`：

```bash
TZ=Europe/Moscow date                                  # 先確認：18:xx–20:xx，而且日期和台北一樣
export URDIARY_TIMEZONE=Europe/Moscow
export URDIARY_DATA_DIR=$(mktemp -d /tmp/urdiary-rec-XXXXXX)
.venv/bin/python promo/demo/seed_demo.py               # 摘要要印出 D0＝今天、D-16＝錄 S4 的那一篇
promo/demo/run_demo_backend.sh                          # 另一個終端機（同樣 export 那個時區）
```

U06（結束對話）與 U10（開心彩蛋）要在當地 22:00 以前：22:00 之後存日記會跳晚安版彩蛋。主線要在當地 23:00 以前錄完。
zh 的 `chain` 閘門也接受「清楚指向 D-16 的轉述式回憶」（同一句裡有過去的指涉＋D-16 才有的細節，例如
「你之前也因為第一次書報討論失眠過，那時候是準備到半夜還爬起來再順講稿」）；`--strict-recall` 改回只認「日期＋《標題》」。

## 自動驗收（每個 take 的 JSON `checks`，SHOTLOG 會列出）

開錄與停錄的那一刻各跑一次唯讀探針（不改 DOM），再加上錄到的真實幀：

- **麥克風圖示**：按鈕在畫面最上層時，從那一端的真實幀裁出按鈕（裝置像素）做像素驗收——FA6 microphone
  是實心膠囊：墨跡外框高寬比約 1.45，外框中上段幾乎全是墨（修好之前的空圓裁出來是 0 墨）。按鈕不在畫面上的
  鏡頭（日記頁、行事曆、記憶視窗）改驗 CSS 規則 `.fa-microphone::before`＋按鈕上計算出的 `::before` 是 U+F130。
- **頁尾年份**：`.app-footer` 的文字要有錄影當年（2026），不能有 2010–2025。
- **記憶檔節標題**：記憶視窗開著時（U14／U15），使用者檔案的 `## ` 標題要全部是介面語言那一套
  （`memory_files.SECTION_TITLES`：en＝Name & identity…、zh＝稱呼與身分…），帳本列不能出現另一種語言的節名。
- **畫面文字**：`document.body.innerText` 裡沒有 stub 字樣、沒有危機詞（另外 LLM 原文照舊檢查）。
- **問候時段**：主線 U03 記下再登入那一刻的每日問候原文、後端時區的當地時間與時段（要是晚上／evening），
  並列出問候裡和晚上衝突的字眼（早安、下午、深夜…）。
- U06 的 valence ≥ 0.45 或跳了彩蛋會寫進備註（S5 要安靜版）。

## 鏡頭表是資料

`record_shots.js` 開頭的 `SESSIONS`：每個 session 是一串 `[動作, 參數…]`，`['rec', 'U03']` 到 `['stop']`
之間錄成一個檔。動作語彙在 `ACTIONS`（登入、開關設定、切換使用者、打字、送出並等回覆、結束對話、
切分頁、捲到某篇日記、點某一天、記憶視窗、核可、閘門…）。改鏡頭就改這張表。

幾個一定要知道的 App 行為（都寫進了 session 步驟）：

- **標題顯示名字**：設定面板打開過之後，聊天標題要等 ChatModule 下一次初始化才會換成陪伴者名字
  （`chat_module.js` 只在 init 與「儲存設定」時套用）。所以每個 session 都是「登入 → 開關一次設定 →
  切換使用者、同一個帳號再登入」，再開始錄。模型顯示的 grok-4.3 也是這一步寫進去的。
- **每日問候**要在「再登入」那一刻才觸發（先把問候標成已做、開完設定再用 `--set-checkin yesterday` 排回去），
  問候泡泡才會帶端茶吉祥物（從 localStorage 還原的舊問候不會帶）。
- 打字約 8 字/秒（±40%），標點後多停一下；每個動作前後至少留 ~1.5 s 靜止。

## 為什麼這樣錄（擷取方式）

- **原生縮放，不用 Playwright 的 viewport 模擬**：`deviceScaleFactor` 模擬下，CDP 的 screencast／截圖只給
  CSS 尺寸（1920×1080）。改用 `--force-device-scale-factor=2 --window-size=1920,1080`＋`viewport: null`，
  screencast 才是真的 3840×2160。手機用 `--force-device-scale-factor=3 --window-size=390,844`＋iPhone UA＋觸控
  （App 的行動版版面只看 `max-width: 768px`），得到 1170×2532。
- **GPU 合成**（`--use-gl=angle --use-angle=gl-egl`）：軟體合成在 4K 只有 ~25 fps，GPU 約 59 fps（實測 p95 幀距
  ~20 ms）。`URDIARY_REC_GPU=0` 改回 `--disable-gpu`。
- **CDP `Page.startScreencast`（png、everyNthFrame 1）**：每幀存檔＋時間戳，組裝時用 ffmpeg concat
  （每幀時長＝到下一幀的時間差）＋`fps=60` 補成固定 60 fps；色彩轉換（bt709、限定範圍）只做在不重複的幀上，
  `setparams` 把 bt709 primaries／transfer／matrix 標在幀上（ProRes 幀頭與 mov 的 colr atom 才會是 bt709）。
  concat 的最後一項要重複一次、fps 濾鏡才算得對最後一幀，代價是尾巴多一段，所以輸出一律 `-t` 截在停錄時間
  （`--retrim` 可以把沒截過的舊檔用 stream copy 截回來）。
- **flush**：Chromium 的 screencast 會把「最後一次有變化的那一幀」壓著，等下一個合成幀才送。畫面在動作後
  靜止時（例如記憶帳本核可後重繪、年月選擇器關掉），最後的狀態就錄不到。錄影器在 ~0.1 s 沒收到幀時發一次
  `Page.captureScreenshot`（不動 DOM、截圖丟掉），逼出被壓著的幀；靜止時因此約每 0.3 s 一幀。
- 錄到的每個 take 另存一份 JSON（事件時間軸＝影片秒數、LLM 原文、自動檢查：stub 字樣、危機詞、
  引用日期＋標題、valence、彩蛋、待核可數），SHOTLOG 由它們產生。

## 產出

```
<out>/<U-id>/<lang>-take<N>.mov         ProRes 422 HQ（yuv422p10le，60/1）或 .mp4（H.264 CRF 12）
<out>/<U-id>/<lang>-take<N>.json        這個 take 的記錄
<out>/<U-id>/contact-sheet-<U-id>.png   每個 take 一列、8 格
<out>/<U-id>/_strips/                   各 take 的縮圖條
<out>/SHOTLOG.md                        挑選用的總表
<out>/_picks.json                       人工挑選建議（--shotlog 會併進 SHOTLOG）
<out>/_raw/                             原始幀（組裝並驗證後自動刪除；--keep-raw 保留）
```
