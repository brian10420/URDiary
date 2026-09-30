# 介紹影片示範資料（promo/demo）

v2.6 動畫・互動・介紹影片線 1e.1：給 `promo/video/STORYBOARD.md` §3 UI 錄影用的虛構示範人物，加上一個只在 **127.0.0.1:8124** 跑的隔離後端。人物、地名細節、對話全部虛構。

## 鐵律

- **絕對不要對 repo 的 `data/` 跑這裡的任何東西。** 三支腳本都會拒絕：`URDIARY_DATA_DIR` 解析 symlink 後落在 `data/` 裡、repo 裡、或是 repo 的上層目錄，一律直接結束，而且在 import 任何後端模組**之前**就擋下（後端的 `config.py` 一被 import 就會 mkdir 並寫 `secrets.json`）。預設只接受 `/tmp`（`os.tmpdir()`）或 `/mnt/Data_SSD/urdiary-media/` 底下的子目錄；其他位置要加 `--allow-dir`，而且會印警告。
- 只用 **8124**。不碰 8001（日常開發後端）或 8123（E2E）。
- 示範帳號的 id 從 101 起，**不會用到 id 1**。這個目錄有自己的 `secrets.json`，腳本會把 `SECRET_KEY`／`HASH_SALT` 設成空字串，擋掉 `backend/.env` 的值。所以這裡簽出的登入令牌、存的密碼雜湊，拿到真實後端都無效。
- xAI 金鑰只放在 `~/.config/urdiary-promo/xai_key`（`chmod 600`）。啟動時才讀，只進 uvicorn 行程的環境變數，不印出、不寫進任何檔案，也不存進資料庫，**不要 commit**。

## 資料集內容

| 帳號 | id | 人物／語言 | 狀態 | 用在 |
|---|---|---|---|---|
| `yuqing` | 101 | 語晴 / zh-TW | 完整三週資料 | 主帳號：U03–U09、U11、U12、U15 |
| `maya` | 102 | Maya / en | 完整三週資料 | 同上（en 版） |
| `yuqing_b` | 103 | 語晴 / zh-TW | 主帳號的完整複本 | U10 開心彩蛋；主帳號某天蓋壞了的備援 |
| `maya_b` | 104 | Maya / en | 主帳號的完整複本 | 同上（en 版） |
| `yuqing_hello` | 105 | zh-TW | 全新：初次見面沒開始、沒名字、沒資料 | S2／U02 取名、U17 |
| `maya_hello` | 106 | en | 全新 | 同上（en 版） |

**密碼**（只在示範目錄有效）：語晴的三個帳號 `treehole-demo-zh`；Maya 的三個帳號 `treehole-demo-en`。（寫在 `personas/*.json` 的 `accounts.password`，種子跑完也會印一次。）

每個完整帳號（日期都相對 **D0＝錄 S3–S5 那天**，預設是種子當天）：

- **日記 15 篇，D-21～D-1**。中間有 6 天空白（D-20、-18、-17、-15、-14、-8）。第一人稱，照 App 日記提示詞的四段結構（今日事件／情緒與感受／反思與洞察／明日方向；en：Today / Feelings / Reflections / Tomorrow）。valence 分布是 10 篇 0.55–0.85、2 篇 0.45–0.55、3 篇 < 0.45，最沉重的一天 0.30（「悲傷」，不是危機）。
- **AI 印章＋小語 15 枚**，一篇日記一枚，`source_diary_id` 指回那篇日記。沉重日只用鼓勵組（umbrella／heal／sprout），小語是安靜陪伴的語氣。
- **行事曆 8 個事件**（D-21～D+7 展開後 18 次）：每週「指導教授 meeting」（含 D0 14:00）、每週「大一統計習題課（助教）」（含 **D+1 10:00**，給 U12）、跨天「期中考週」D-14～D-12、書報討論 D-15、「媽媽生日」（紀念日，每年，落在 cake 那天）、「和小安去海邊看夕陽」（出遊，落在 camera 那天）、「牙醫回診」（健康）、跨天「回台南」D+3～D+4。**事件都沒設提醒**，避免錄到一半跳出 in-app 提醒。
- **記憶**：使用者檔案 476 字（en 535）、陪伴者筆記 177 字（en 258），逐條帶日期。帳本共 6 批，全部「已生效」：來自初次見面 1 批、來自日記 4 批（D-16、D-10、D-7、D-3）、你自己的編輯 1 筆。檔案內容是用 App 自己的 `memory_files.apply_op` 一筆一筆套出來的，所以帳本、檔案內容、「撤銷」三者對得上。「記下之前先問我」（核可制）已經打開，待核可 0 筆。
- **初次見面**：已完成。七題答案加上取名題（「小樹洞」／“Treehole”）都有，而且和日記內容一致；七題都標為已收納。`companion_name`＝小樹洞／Treehole，`user_nickname`＝語晴／Maya，風格三欄留預設。
- **每日問候**：`last_checkin_date`＝D-1 21:05，所以 D0 第一次打開 App 會問候（見下方「stub 注意」）。對話歷史是空的。

| 天 | 語晴 | Maya | 印章 | valence | 分鏡 |
|---|---|---|---|---|---|
| D-21 | 和小安的牛肉麵之夜 | Pho night with Annie | food | 0.66 | |
| D-19 | 夜跑到河堤的那一圈 | Night run along the river | ball | 0.72 | |
| D-16 | 第一次上台報告前的失眠夜 | Sleepless before my first presentation | moon | 0.50 | S4／U04 回憶目標、U05 |
| D-13 | 期中考週的複習課 | Midterm review session | gradcap | 0.58 | |
| D-12 | 研究方法期中考沒寫完 | Didn't finish my research methods midterm | heal | 0.38 | 沉重日 |
| D-11 | 考完後的琴房時光 | Piano after midterms | music | 0.70 | |
| D-10 | 視訊幫媽媽慶生 | Singing to Mom over video | cake | 0.80 | |
| D-9 | 六十份作業和一杯咖啡 | Sixty homework sets and one coffee | coffee | 0.48 | |
| D-7 | 想家的雨天 | Rainy day, missing home | umbrella「雨天安好／Rainy Comfort」 | 0.30 | U11、S6 右 |
| D-6 | 和小安去海邊看夕陽 | Sunset hike with Annie | camera | 0.82 | |
| D-5 | 看完牙醫散步回家 | No cavities, and a long walk home | flower | 0.62 | |
| D-4 | 文獻整理終於寫完了 | Finally finished my literature notes | sun「晴朗有勁／Sunny Spirit」 | 0.80 | U09、S6 左 |
| D-3 | 媽媽傳來湯圓的影片 | Mom sent videos of Dumpling | paw | 0.64 | |
| D-2 | 又忍不住跟別人比較 | Comparing myself again | sprout | 0.42 | 沉重日 |
| D-1 | 小安煮的番茄湯 | Annie's tomato soup night | heart | 0.68 | S7 備案（D0 早上錄 U12） |

**示範訊息**（照打，不改字）寫在 `personas/*.json` 的 `demo_messages`：`u03`（約 100 字／62 words）、`u04`、`u10`（兩則開心的小事）。種子腳本會驗證兩件事：這些訊息沒有危機詞；D-16 那篇在 U03 那一輪、U04 那一輪的關鍵字檢索都排第 1（App 取前 3 注入提示詞）。**U03 本身要含「報告」／“presentation”**，原因是 U04 那一輪的檢索詞只取「上一則使用者訊息＋這一則」的前 12 個詞；U03 夠長時，U04 自己的詞會被截掉。所以改 U03 的措辭前，先想清楚這一點。

## 種子 → 開後端 → 驗證

一律用 repo 的 `.venv`，在 repo 根目錄執行：

```bash
# 1) 種子（錄影當天做；目錄可以放 /tmp 或 /mnt/Data_SSD/urdiary-media/ 底下）
export URDIARY_DATA_DIR=$(mktemp -d /tmp/urdiary-demo-XXXXXX)
.venv/bin/python promo/demo/seed_demo.py
#   --d0 2026-10-16        錄影日不是今天時（--d0-zh／--d0-en 可以分開指定）
#   --reset                重種：清掉這個目錄裡的舊資料（8124 必須先停；資料庫裡有任何非示範帳號就拒絕）
#   --checkin-done         種完就把「今天的問候」標成已發生（整天都用 stub 錄的話）

# 2) 開隔離後端（前景執行，Ctrl-C 停；前端也由它提供：http://127.0.0.1:8124/）
promo/demo/run_demo_backend.sh           # 真的 grok-4.3：讀 ~/.config/urdiary-promo/xai_key
promo/demo/run_demo_backend.sh --stub    # 假回覆，乾跑用（畫面上會出現 [urdiary-e2e-stub]，那段不能用）

# 3) 驗證（8124 必須空著；它會自己開一個 stub 後端、核對完再關掉）
promo/demo/verify_demo.sh                 # 核對上面這個 URDIARY_DATA_DIR
promo/demo/verify_demo.sh --real-config   # 改用真模式開：只核對 App 看到的是 Grok grok-4.3，不呼叫任何 LLM
env -u URDIARY_DATA_DIR promo/demo/verify_demo.sh   # 全新煙霧測試：mkdtemp → 種子 → 核對 → 刪掉
```

**金鑰怎麼進 App**：用 App 本來就有的「伺服器端 Grok 後備」。`run_demo_backend.sh` 啟動時讀金鑰檔，放進 uvicorn 的 `XAI_API_KEY`，並設 `FALLBACK_GROK_MODEL=grok-4.3`。瀏覽器／PWA 模式不送 `X-LLM-*` 標頭，所以聊天、每日問候、寫日記、記憶收納都會走這把金鑰。設定面板會顯示「使用伺服器預設金鑰」，供應商是 Grok、模型是 grok-4.3。**不要在設定面板再填一次金鑰**：那樣會把一份加密副本存進示範資料庫。

`verify_demo.sh` 會核對以下項目，全部用真的 HTTP API，只發 GET 和登入：

- 每個帳號都能登入，id 不是 1。
- 日記：日期、標題、摘要、全文、valence、arousal、印章、小語，還有排序。
- 印章 API：每枚都指回它那篇日記。
- 行事曆：D-21～D+7 的每一個 occurrence、跨天橫槓、今天和明天的行程、分類數量。
- D0 那個月的月格至少 12 枚印章（U08）。
- 記憶檔：內容雜湊與種子時一致、字數在範圍內、核可制開著、待核可 0。
- 帳本：批次順序和「來自日記《…》」的標題。
- 初次見面狀態、陪伴者名字、App 看到的 AI 設定（不印金鑰）。
- 三個分鏡前提：S4 的 D-16、S6 的兩枚印章、S7 的 D-1 日記。
- hello 帳號是全新的。

最後還會確認 8124 已經空出來、repo `data/` 每個檔案的 mtime 和大小都沒變；`--real-config` 另外確認金鑰沒有出現在後端輸出裡。

驗證核對的是**錄影前**的種子狀態。錄完 U06 之後，D0 多了一篇真日記、帳本多了待核可批次，這時再跑會回報差異，這是正常的；要回到乾淨狀態就 `--reset` 重種。

## 錄影當天的順序與注意事項

**stub 注意**：主帳號今天還沒問候過的話，用 `--stub` 後端登入，一打開聊天頁就會把 stub 問候寫進對話歷史。它會出現在 U03 畫面上，也會被寫進 U06 的日記。`run_demo_backend.sh --stub` 啟動時會列出這些帳號。**用 stub 登入主帳號之前**，先執行：

```bash
.venv/bin/python promo/demo/seed_demo.py --user yuqing,yuqing_b,maya,maya_b --set-checkin today
```

1. **D0 白天（可以用 stub）**：先執行上面那行。U02／U17 用 hello 帳號；U05、U08、U09、U11 用主帳號瀏覽種子資料。U10 要真的 grok，用複本帳號 `yuqing_b`／`maya_b`（不要在主帳號結束對話）。
2. **D0 晚上（真 grok）**：不加 `--stub` 重開後端。想要一則真的早上問候出現在 U03 上方的話，先執行 `--user yuqing --set-checkin yesterday --clear-chat` 再登入；不需要就跳過（分鏡寫「若有」）。依序錄 U03 → U04 → U06 → U07 → U15。**主帳號這一天只能結束一次對話**，再結束一次會覆蓋今天的印章。
3. **D+1 早上**：U12（手機）。D0 寫的真實日記就是「昨天」，D+1 10:00 有助教課。D0 錄完之後、U12 之前，不要再結束任何對話。

**重拍工具**（對已種好的目錄操作，demo 後端開著也可以）：

```bash
.venv/bin/python promo/demo/seed_demo.py --user yuqing --clear-chat          # U04 重試：等同 DELETE /chat/clear/；之後再按 App 的「清空對話」
.venv/bin/python promo/demo/seed_demo.py --user yuqing --set-checkin yesterday --clear-chat   # U12 重拍：問候再出現一次
.venv/bin/python promo/demo/seed_demo.py --reset-hello                        # U02／U17 重拍：hello 帳號回到全新，仍保持登入
```

**瀏覽器端的設定**不在資料庫裡，存在 `http://127.0.0.1:8124` 這個 origin 的 localStorage，每個錄影 context 各設一次：

- 介面語言：設定面板，或 `localStorage.urDiary_language = 'zh-TW' | 'en'`。zh 和 en 用不同的 Playwright context。
- 「AI 行事曆印章」預設就是開的；語意檢索預設關；語音朗讀預設關。
- 登入後先**打開一次設定面板再關掉**（不要按儲存、不要填金鑰）。這一步會讓標題換成「小樹洞」／“Treehole”，輸入區上方也會顯示「AI: Grok (xAI) grok-4.3」（分鏡 §3.4 第 2、3 點）。
- Playwright 建議：`timezoneId: 'Asia/Taipei'`、`reducedMotion: 'no-preference'`。U01 的帳號清單來自瀏覽器，每個帳號先在那個 context 登入過一次，才會出現在清單裡。

## 改人物資料

內容全部在 `personas/zh.json`、`personas/en.json`，改完重跑 `seed_demo.py --reset`。每個日期都是相對 D0 的天數（`"day": -16`），`time` 是台北牆上時間。凌晨 5 點前寫的日記算前一天（例：D-16 的 `01:20`），和 App 的換日規則一樣。帳本的 `{date}` 代表那一批的日子，`{day:-21}` 代表 D0 前 21 天。

寫入前，種子腳本會照分鏡 §3.3 的契約把關，**任何一條不過就一個字都不寫**：

- 日記：D-21～D-1 共 14–16 篇，一定要有 D-1；zh 標題 ≤ 12 字、摘要 ≤ 50 字、小語 ≤ 30 字；en 小語不超過 App 的 60 字元入庫上限。
- valence 分布（見上）；沉重日只能用鼓勵組印章。印章 id 必須同時存在於後端 `STAMP_IDS` 和 `desktop/js/mascot.js`。
- 一定要有的印章：cake、camera 或 plane、book 或 gradcap、coffee、music、paw；D-4 是 sun、D-7 是 umbrella。
- 行事曆：用 API 的 `CalendarEventCreate` 驗證，事件不能設提醒。D+1 早上問候看的行事曆視窗是 D0～D+8，最多 10 行，要確保 D+1 10:00 的事件不會被擠出去。
- 記憶：兩檔字數分別在 400–560、150–300；帳本要有 2–4 批來自日記、1 筆使用者編輯。
- 所有文字不能出現 `diary_service.py` 危機詞清單上的詞。
- 回憶關鍵字要同時出現在 D-16 的標題／摘要和 U04 訊息裡。

## 已知限制（資料模型表達不了、或錄影時要留意的）

- **U08 月格要 D0 在當月 14 號以後。** 日記只到 D-1，有 12 篇在 D-13～D-1，所以 D0 是某月 1–13 號時，當月月格不到 12 枚印章。種子腳本會印出實際數字。
- **en 記憶檔的章節標題是中文**（`## 稱呼與身分`…）。這是 App 的真實行為：`memory_files.SECTIONS` 不分語言，en 的記憶收納也寫這些標題。en 的 U15 畫面會看到它們。
- **en 小語上限 60 字元**：App 入庫時把小語截在 60 字元（`day_stamp.NOTE_MAX`），但 en 提示詞要的是約 15 個字。種子資料都在 60 字元內；U06 真實產生的 en 小語有可能在字中間被截斷。
- U06／U07 的印章、U15 的待核可批次、所有問候與回覆，都是錄影當下由 grok-4.3 產生，無法預先種。
- 後端自己的 log 會寫到 `backend/app/logs/*.log`（gitignored，路徑寫死在 `utils/logger.py`），跟 E2E 後端一樣。
