# URDiary 行動與桌面部署可行性評估

> 評估基準：`feature/v2.2-quality-and-calendar` 分支，HEAD `1bd14b3`
> 本文只做評估，不含任何程式碼變更。所有論斷附 `檔案:行號` 出處，見文末附錄。

---

## 太長不看

**目標一：朋友用手機連你的電腦（同一個 Wi-Fi）——做得到，缺三樣東西。**
後端本來就是純 JSON API、JWT 認證、沒有伺服器端 session，前端所有 Electron 專屬呼叫都有防護判斷，在一般瀏覽器裡載得起來。真正卡住的只有三件事：後端綁死在 `127.0.0.1`（手機連不到）、後端不提供靜態檔（手機拿不到網頁）、前端 API 位址寫死 `localhost:8001`（手機載到網頁也打不到後端）。前兩件是啟動指令與一行 mount 的層級，第三件是十幾行的來源推導。**加起來是一個週末的工作量，不是重寫。** 至於 LLM 金鑰在瀏覽器沒地方存這件事，其實有一條今天就能走的路：主機端在 `backend/.env` 填一把後備金鑰，全家共用，金鑰完全不經過網路——限制是只支援 Grok、共用同一份帳單。

**目標二：做成一般人能下載安裝的桌面程式——技術上都通，難的是後端。**
Electron 打包本身是成熟工具鏈（現有的 `electron-packager` 相依甚至沒被任何 script 引用，建議直接換 `electron-builder`），多尺寸圖示也只是美工工作。真正的難題是「使用者要先有 Python 環境並手動啟動後端」——這對一般人門檻太高。要嘛把後端用 PyInstaller 打成單一執行檔由 Electron 代為啟動（體驗最好、打包最重），要嘛承認這是開發者取向的專案。**這是路線選擇，不是技術障礙。**

**目標三：上架 App Store / Google Play / 桌面商店——目前有一個硬阻擋，和一個沒有標準答案的問題。**
硬阻擋是 `nodeIntegration: true` + `contextIsolation: false`：Mac App Store 沙箱直接不過、審查風險高。好消息是本分支把 IPC 面收斂到只剩 4 個 handler，遷移到 `preload` + `contextBridge` 的工程面已經很小。沒有標準答案的是「手機 App 的後端住哪裡」——連家中電腦、後端也上手機、官方託管，三條路各有各的代價，而且**這是產品定位決策，不是工程決策**，本文把三條路攤開但不替你選。

**一句話總結：** 手機分享是「小工程」等級，桌面安裝檔是「路線選擇」等級，上架是「產品定位決策」等級。三者難度差一個數量級，不要混為一談。

---

## 一、現況體檢

**結論先講：這個 codebase 的架構本身沒有阻擋跨平台的東西，缺的是「從來沒往那個方向做過」的設定與樣式。**

前一次改版（v2.0/v2.1）與本分支的整理已經順手清掉不少障礙。誠實盤點現有的正面條件：

| 現況 | 為什麼對跨平台有利 | 證據 |
|---|---|---|
| 後端是純 JSON API，JWT Bearer 認證 | 沒有伺服器端 session、沒有 cookie 依賴，任何客戶端拿 token 就能用 | `backend/app/api/deps.py:26-46`、`backend/app/utils/security.py:37-53` |
| CORS `allow_headers` 已涵蓋全部自訂標頭 | 跨來源請求不會因為漏一個標頭而在 preflight 被擋 | `backend/app/main.py:71-73` |
| CORS 來源已是環境變數 | 加入區網來源不用改程式碼 | `backend/app/config.py:81`、`backend/.env.example:38` |
| 前端所有 Electron/Node 呼叫都有 `window.require` 判斷 | 同一份前端資產在瀏覽器裡不會直接爆掉 | `desktop/js/secure_store.js:12`、`desktop/js/ui_manager.js:476`、`desktop/js/error_logger.js:111` |
| `viewport` meta 已存在 | 手機不會用桌面寬度縮放渲染 | `desktop/index.html:5` |
| SQLite 單檔 + `URDIARY_DATA_DIR` | 資料層可攜，備份與遷移就是搬一個資料夾 | `backend/app/config.py:19-21` |
| API 位址收斂到 `CONFIG.getApiBaseUrl()` 單一函式 | 未來要改成動態推導，只需要改一個地方 | `desktop/js/config.js:121-123`（呼叫端見附錄） |
| Electron IPC 只剩 4 個 handler | 未來遷移 `contextBridge` 的面積很小 | `desktop/main.js:175, 248, 260, 269` |
| 埠號已是環境變數 | 換埠不用改腳本 | `backend/start-backend.sh:28`、`backend/start-backend.bat:30` |
| 測試網 165 個後端 + 64 個前端 | 改動時有回歸保護，敢動 | `backend/tests/`、`desktop/tests/` |

換句話說：**現在的問題不是「架構錯了要重來」，而是「該加的設定與樣式還沒加」。** 這是好消息，也是本文其餘篇幅的前提。

---

## 二、目標一：手機開連結（同網段分享）

**結論先講：把缺口分三層看——第一層今天就能做完、第二層是一個週末、第三層需要你先做一個關於隱私的決定。**

情境設定：你在自己的電腦跑後端，朋友的手機連同一個 Wi-Fi，打開瀏覽器輸入 `http://192.168.x.x:8001` 就能用。

### 第一層：純設定或一行改動（S）

| 缺口 | 現況 | 修法 | 工作量 |
|---|---|---|---|
| 後端只聽 `127.0.0.1` | 啟動腳本硬編碼 `--host 127.0.0.1`（`backend/start-backend.sh:31`、`backend/start-backend.bat:33`） | 改 `--host 0.0.0.0`，或加一個 `API_HOST` 環境變數比照現有的 `API_PORT` 寫法 | S（一行） |
| CORS 白名單沒有區網來源 | 預設只有 `localhost:3000/8080`（`backend/app/config.py:80-83`） | **不用改程式碼**：在 `backend/.env` 設 `CORS_ALLOWED_ORIGINS=http://192.168.x.x:8080` | S（純設定） |
| 手機拿不到前端網頁 | 後端完全不提供靜態檔（全 repo 找不到 `StaticFiles` 或 `app.mount`） | 臨時解：在 `desktop/` 另起 `python -m http.server 8080`，**零程式碼變更就能先測通**。正式解見第二層 | S（純設定，臨時用） |

值得強調的是：**你今天就可以用「改一行 host + 設一個 CORS 環境變數 + 另起一個靜態伺服器」把整條路先跑通驗證**，不必等任何開發。唯一會卡住的是下一層的 API 位址問題。

### 第二層：小工程（M）

| 缺口 | 現況 | 影響 | 工作量 |
|---|---|---|---|
| 前端 API 位址寫死 localhost | `getApiBaseUrl()` 的預設值是 `http://localhost:8001`（`desktop/js/config.js:10, 122`），而**設定面板沒有任何改這個值的介面**（`settings_module.js` 的 `LOCAL_BASE_URL_KEY` 是給自架 LLM 端點用的，不是後端位址） | 手機載到網頁後，每個 API 請求都打向手機自己的 localhost → 全部失敗。這是第一層做完後唯一還會卡死的東西 | M（十幾行：瀏覽器情境由 `window.location.origin` 推導，`file://` 時退回 localhost） |
| 後端零靜態檔服務 | 同上 | 要正式分享就得有一個穩定入口，不能每次都手動起兩個伺服器 | M（`app.mount("/", StaticFiles(directory=..., html=True))`，注意要掛在 API 路由之後） |
| Electron 的 CSP 擋區網位址 | `connect-src 'self' http://localhost:*`（`desktop/main.js:102`） | 只影響「Electron 桌面版連遠端後端」這個情境；手機瀏覽器不受影響 | S（放寬到區網網段，但要想清楚放寬的代價） |
| CDN 依賴 | Google Fonts 與 cdnjs 的 Font Awesome（`desktop/index.html:7-8`） | 手機在弱網或離線時，圖示與字型全滅（介面到處是空白方框）。也是之後做 PWA 的前置條件 | M（把字型與圖示子集化後自帶，順便減少外部請求） |
| CSS 用 `@import` 串接 | `styles.css` 串 6 個檔（`desktop/css/styles.css:6-21`） | 在 `file://` 下無感，在 HTTP 下變成 7 次序列往返，手機首次載入明顯變慢 | S（合併或改成多個 `<link>` 平行載入；低優先） |

### 第三層：LLM 金鑰要放哪裡（產品決策）

**結論先講：這是本節唯一需要你「決定」而不是「實作」的問題，而且有一條今天就能走、且隱私最好的臨時路。**

現況機制：金鑰由 Electron 主行程用 `safeStorage`（作業系統金鑰鏈）加密存在 `userData/provider-keys.enc`（`desktop/main.js:220-245`），renderer 經 IPC 取得後放記憶體，發請求時附 `X-LLM-Api-Key` 標頭（`desktop/js/api_service.js:228-239`）。

瀏覽器沒有 `safeStorage`，所以 `SecureStore.setKey()` 直接拋錯（`desktop/js/secure_store.js:45-48`）→ 手機端存不了金鑰 → 聊天請求走到 `llm.resolve_config()` 找不到設定 → 拋 `LLMError`（`backend/app/llm.py:17-21`）→ 回 503（`backend/app/api/routes/chat.py:58-65`）。

四個選項：

| 選項 | 做法 | 隱私 | 使用體驗 | 工作量 | 與 README 隱私承諾的衝突 |
|---|---|---|---|---|---|
| **(d) 共用後備金鑰**（今天就能做） | 主機端在 `backend/.env` 設 `XAI_API_KEY`（`backend/app/config.py:69`、`backend/app/llm.py:22`），所有區網用戶共用 | **最好**：金鑰完全不經過網路，只存在主機的 `.env` | 可接受：使用者不用填任何東西就能聊 | **零**（現成機制） | 無衝突。金鑰確實沒離開你的電腦 |
| (a) 後端金鑰庫 | 後端加密存檔，每個帳號存自己的金鑰 | 中：金鑰落在「你的」伺服器（在家用場景就是你的電腦） | 最好：各自選供應商、各自付費 | M-L | **有**：`README.md:165` 說金鑰用系統金鑰鏈加密、`README.md:176` 說「只送往本機後端」。要誠實改寫 |
| (b) 每次手動輸入（`sessionStorage`） | 開分頁時貼一次金鑰，關掉就消失 | 最乾淨 | 最差：每次都要貼一長串 | S | 無衝突，但要說明「重開就要再貼」 |
| (c) WebCrypto + 通關密語加密 `localStorage` | 用密語派生金鑰加密後存瀏覽器 | 好，但取決於密語強度 | 中：每次開要輸密語 | L（實作最複雜、最容易做錯） | 需補充說明 |

**建議的思考順序**（不是替你決定，是排優先序）：先用 (d) 把區網分享跑起來，這是零成本且隱私最好的；如果之後真的需要「每個人用自己的供應商與帳單」，再實作 (a) 並同步誠實改寫 README，同時保留 (b) 當作隱私模式選項。(c) 的複雜度與它帶來的好處不成比例，建議先跳過。

**(d) 的三個限制要講清楚**：只支援 Grok 一家供應商（`backend/app/llm.py:22` 寫死 `provider="grok"`）、所有人共用同一份帳單與速率限制、沒辦法讓不同人用不同模型。

---

## 三、響應式（行動介面）缺口

**結論先講：現在的樣式幾乎是純桌面思維，需要一輪完整的響應式整理——不是災難，但也不是「加幾個 media query 就好」。**

全專案目前只有 3 個 `@media` 斷點，而且集中在兩個檔案：

| 檔案 | 斷點 | 內容 |
|---|---|---|
| `desktop/css/chat.css:376` | `max-width: 768px` | 訊息寬度、輸入框內距 |
| `desktop/css/chat.css:390` | `max-width: 480px` | 頭像尺寸、氣泡內距 |
| `desktop/css/calendar.css:394` | `max-width: 900px` | 日面板從右側移到月曆下方 |

`base.css`（823 行）、`diary.css`、`components.css` **完全沒有任何斷點**。也就是說：全域版面、日記視圖、通用元件在窄螢幕上都是原封不動的桌面樣式。

具體會壞掉的地方：

- **分割視圖硬切 50%**：`.view-container.half` 是固定 `flex: 0 0 50%` + `max-width: 50%`（`desktop/css/base.css:450-453`），而切換邏輯在 JS 裡純粹加 class、完全沒有判斷視窗寬度（`desktop/js/ui_manager.js:189-190, 228-229`）。手機上「對話 + 日記」並排 = 兩欄各 190px，兩邊都不能用。窄螢幕應該改成上下堆疊或只顯示一個。
- **頂部列一行塞太多東西**：logo + 3 個導覽項 + 4 個圖示按鈕全部擠在一列（`desktop/index.html:45-71`、`desktop/css/base.css:367-375`），375px 寬的手機必定溢出。
- **觸控目標偏小**：`.icon-btn` 是 2.5rem = 40px（`desktop/css/base.css:255-256`），低於 iOS HIG 的 44pt 與 Material 的 48dp；一般按鈕上下內距 8px（`desktop/css/base.css:161`）換算約 40px 高；`.btn-sm` 更小（`desktop/css/base.css:222`）。需要一輪針對觸控的尺寸調整。
- **日曆在窄螢幕**：900px 以下日面板會堆疊到下方（已處理），但 7 欄的月曆格仍然是 `repeat(7, 1fr)` 搭配最小 56px 列高（`desktop/css/calendar.css:114-115`）；390px 寬的手機每格只剩約 53px，日期加事件點勉強塞得下但很擠。右側日面板固定 320px（`desktop/css/calendar.css:82`）在斷點以下才會解除。整體算「能看但不好用」，需要納入這一輪整理。
- **提醒通知**：行事曆用 Web Notification API 且有完整防護判斷（`desktop/js/calendar_module.js:780-834`），瀏覽器可用。但 iOS Safari 要求「已加到主畫面的 PWA + HTTPS」才會發通知——區網 HTTP 情境下 iPhone 收不到提醒，這點要在使用說明裡先講明白，免得被當成 bug。

工作量估計：**M**（一輪系統性的響應式整理，含觸控尺寸、頂部列收合、分割視圖的窄螢幕策略）。有 64 個前端測試護著，改動相對安全。

---

## 四、安全姿態

**結論先講：目前的安全模型是為「單機、單人、只聽 localhost」設計的，這在原本情境下完全合理；一旦上區網或託管，有一個問題必須先解決，其餘可以排程處理。**

### 必須先解：區網明文傳輸 LLM 金鑰

**這是本文最需要你注意的一條。**

前端發聊天請求時，會把 API 金鑰放進 `X-LLM-Api-Key` 標頭（`desktop/js/api_service.js:235`），後端的 CORS 也明確允許這個標頭（`backend/app/main.py:72`）。在目前的單機情境下，這段流量從來沒離開過 `127.0.0.1`，所以是安全的。

**但一旦後端改綁 `0.0.0.0` 讓手機連進來，而且沒有 TLS，你的 LLM API 金鑰就會以明文形式在 Wi-Fi 上傳輸。** 同一個網段上任何人（咖啡廳、宿舍網路、學校網路、被入侵的路由器、開了封包側錄的室友）都能直接讀到。API 金鑰被撿走的後果是別人拿你的帳單去跑模型，而且通常要等到帳單來了才會發現。

三個處理方式，按推薦順序：

1. **選第二節的 (d) 方案**——金鑰留在後端 `.env`，前端根本不送這個標頭，這個風險自動消失。**這是最省力也最徹底的解法。**
2. **限制在完全信任的網路使用**——自家 Wi-Fi、且明確告知使用者。文件裡要有明確警語，不能只寫在心裡。
3. **加 TLS**——自簽憑證在手機上會跳警告、使用體驗差；`mkcert` 之類工具要在每台裝置裝根憑證。區網家用場景通常不值得，但如果之後走託管路線就是必要的。

同樣走明文的還有登入密碼與 JWT。區網情境下風險等級較低（攻擊者要能側錄封包），但一併列出：不要把區網分享當成「安全的」，把它當成「在信任的網路裡方便的」。

### 可以排程處理

| 項目 | 現況 | 什麼情境下會變成問題 |
|---|---|---|
| JWT 存 `localStorage` | `desktop/js/api_service.js:10, 68-69` | XSS 攻擊面。單機低風險；一旦有多人或公開部署要重新評估 |
| 沒有 token 撤銷機制 | 沒有登出端點，`get_current_user` 只驗簽章（`backend/app/api/deps.py:26-46`）；`jti` 已預留但沒人用（`backend/app/utils/security.py:49`） | 換密碼或裝置遺失時，舊 token 到期前仍然有效。登入給 24 小時、refresh 給 7 天（`backend/app/api/routes/user.py:122, 207`）。**託管或多人部署前必須補**（DB/Redis 黑名單，或短時效 + refresh rotation） |
| `TOKEN_EXPIRE_MINUTES` 設定實際上沒作用 | 定義在 `backend/app/config.py:64` 且寫進 `.env.example:22`，但全專案沒有任何地方讀它——有效期是兩處硬編碼（`user.py:122, 207`） | 現在：文件說得到但改了沒效果，會誤導人。修法是 S（把兩處改成讀設定） |
| HS256 單一密鑰 | `backend/app/utils/security.py:16`、`backend/app/config.py:63` | 單機合理。多服務或需要金鑰輪替時要改非對稱簽章 |
| `data/secrets.json` 權限 0600 自動生成 | `backend/app/config.py:31-55` | 單機做得很好。多人部署要改成外部密鑰管理 |
| CSP 允許 `unsafe-inline` | `desktop/main.js:102` | 削弱 XSS 防護。上架前應收緊 |

### 上架的硬阻擋：Electron 安全設定

`desktop/main.js:80-89` 目前是 `nodeIntegration: true` + `contextIsolation: false` + `enableRemoteModule: true`。這是 Electron 官方明確列為不建議的組合：renderer 裡的任何 JS（包含被注入的）都能直接呼叫 Node API。

- **Mac App Store**：沙箱要求直接過不了。
- **Microsoft Store**：技術上可上，但安全審查風險高。
- **一般下載安裝**：不影響，只是自己承擔風險。

**好消息**：本分支已經把 IPC 面收斂到只剩 4 個 handler（`desktop/main.js:175, 248, 260, 269`），而且 renderer 端的 Electron 呼叫全部集中在三個有防護判斷的地方（`secure_store.js:12`、`ui_manager.js:476`、`error_logger.js:111`）。遷移到 `preload` + `contextBridge` 的實際工作面比一般專案小很多，估 **S-M**。這件事不急，但它是所有商店路線的前置條件，值得在還記得這些程式碼的時候先做掉。

---

## 五、目標二：桌面安裝檔

**結論先講：前端打包是標準流程，難的是「使用者怎麼把 Python 後端跑起來」——這決定了這個安裝檔是給開發者還是給一般人。**

### 前端打包（M）

- 現況：`electron-packager ^17.1.2` 在 `devDependencies` 裡，但 `scripts` 只有 `start` / `start:win` / `test`，**沒有任何地方引用它**（`desktop/package.json:6-10, 17`）。等於裝了沒用。
- 建議改用 `electron-builder`：一份設定同時產出 Linux（AppImage/deb）、Windows（NSIS 安裝檔）、macOS（dmg），自動更新的生態也比較完整。
- 圖示：目前 `desktop/assets/` 只有 `icon.jpg` 和 `default-avatar.png`（而且是同一個檔的兩份副本，各 79KB）。正式打包需要 macOS 的 `.icns` 與 Windows 的 `.ico` 多尺寸版本，這是美工工作不是工程工作。

### 後端隨附策略（真正的難題）

| 選項 | 做法 | 使用者體驗 | 打包複雜度 | 適合誰 |
|---|---|---|---|---|
| (i) 附啟動腳本 | 沿用現有的 venv bootstrap（`backend/start-backend.sh:13-25` 會自動建虛擬環境並裝相依） | 差：要先裝 Python、要開終端機、首次要等幾分鐘裝相依 | 低（現成的） | 開發者、願意照做的技術使用者 |
| (ii) PyInstaller 打包後端 | 後端打成單一執行檔，由 Electron 主行程 `spawn` 啟動與關閉 | **最好**：點兩下就能用，跟一般軟體沒兩樣 | 高：要處理三平台交叉打包、SQLite 與相依的隱藏 import、防毒軟體誤報 | 一般人 |
| (iii) 維持開發者取向 | 文件寫清楚 `git clone` 流程，不做安裝檔 | 不適用 | 零 | 開源專案的常見選擇 |

**建議的作法**：在 v2.4 先做一個 PyInstaller 的概念驗證（單一平台就好，估 M），實際量一下打包體積與啟動時間再決定要不要全面投入。不要一開始就承諾（ii），因為交叉打包的坑通常比預期多。

**額外要決定的一件事**：語意記憶用的 `fastembed` 模型約 220MB（`backend/app/requirements.txt:18-19`）。目前是選配、要另外 `pip install`。打包時應該**不內含**，改成「使用者在設定面板開啟時才下載」——不然安裝檔會從幾十 MB 暴增到接近 300MB，而且大部分人用不到。現有的 `/system/capabilities` 端點（`backend/app/main.py:90-97`）已經有回報可用狀態的機制，接得上這個設計。

---

## 六、目標三：上架商店

**結論先講：桌面商店是「先做完 contextIsolation 遷移 + 簽章公證」的流程問題；手機商店則卡在一個必須由你決定的產品定位問題。**

### 手機（iOS / Android）

技術上最短的路徑很清楚：前端已經是純 web 資產（HTML + CSS + 原生 JS，沒有建置步驟），**Capacitor 包殼是最直接的做法**——把 `desktop/` 當作 web 資產目錄，就能產出 iOS 與 Android 專案。前面提到的響應式整理與金鑰方案，剛好都是這條路的前置工作。

但真正的問題是：**後端住在哪裡？**

| 路線 | 做法 | 隱私 | 使用體驗 | 營運成本 | 工程量 |
|---|---|---|---|---|---|
| (i) App 連使用者家中電腦 | 手機 App 連回家裡跑的後端 | **最好**：資料完全不離開使用者 | 差：出門就要動態 DNS 或內網穿透（Tailscale/ngrok 之類），家用網路門檻高，而且家裡電腦沒開就不能用 | 零 | M（App 端要做位址設定與連線失敗的處理） |
| (ii) 後端也上手機 | 後端跟著 App 跑在裝置上 | 最好 | 好 | 零 | **L 或不可行**：Python 在 iOS 上不實際。除非後端重寫（Rust/Go/TypeScript），或改成手機直連 LLM——但那等於把 API 金鑰放進行動 App，那是另一套完整的風險（金鑰可被反編譯取出、App Store 對此有審查意見） |
| (iii) 官方託管後端 | 你架伺服器，使用者註冊帳號 | **最差**：日記內容存在你的伺服器上 | 最好：裝了就能用 | 持續費用 + 法律責任（個資、未成年使用者、資料外洩通報義務） | L（要補真正的 token 撤銷、TLS、備份、監控、隱私權政策） |

**這三條路沒有客觀上的正確答案，因為它們對應的是不同的產品。** (i) 是「給技術使用者的自架工具」，(iii) 是「給一般人的雲端服務」，(ii) 是「真正的離線 App」。

幾點供你判斷時參考，但決定權在你：
- 目前 README 的定位非常明確——`README.md:9` 寫「你的資料不離開你的電腦」、`README.md:177` 寫「唯一的網路流量是你的電腦與 AI 供應商之間」。走 (iii) 等於改變產品的核心承諾，不是加一個功能而已。
- 有一種折衷是**雙軌**：預設自架（(i)），另外提供可選的託管（(iii)），使用者自己選。代價是兩套都要維護、文件要講清楚差異，而且託管軌一旦開了就有營運責任，不能隨便關掉。
- 如果只是想讓朋友用，第二節的區網分享已經解決了 90% 的需求，不一定需要上架。**先確認「上架」解決的是什麼問題，再決定走哪條路。**

### 桌面商店（Mac App Store / Microsoft Store）

沒有定位問題，只有流程問題，按順序：

1. **`contextIsolation` 遷移**（S-M，見第四節）——沙箱的前置條件，不做就不用談。
2. **程式碼簽章與公證**——macOS 需要 Apple Developer 帳號（年費）與 notarization 流程；Windows 需要程式碼簽章憑證。這是行政成本不是工程成本。
3. **後端隨附**——沙箱環境下 `spawn` 外部執行檔有額外限制，第五節的 (ii) 方案要重新驗證可行性。

### 開源版與上架版的關係

**建議：同一個 codebase，用組態或建置旗標分流，不要分叉。**

理由很實際：兩個分支意味著每個修正都要做兩次，而以這個專案的規模（單人維護），分叉幾個月後其中一邊必然會落後。金鑰方案 (a)/(d)、後端位址、託管與否，全都可以用環境變數或建置期常數控制。

---

## 七、建議路線圖

**結論先講：三個版本各解一類問題，順序不能顛倒——因為每一步都是下一步的前置。**

| 版本 | 項目 | 工作量 | 風險 |
|---|---|---|---|
| **v2.3 區網分享版** | 後端綁 `0.0.0.0`（或 `API_HOST` 環境變數） | S | 低。要在文件明確寫「僅限信任網路」 |
| | `.env` 設定區網 CORS 來源 | S（純設定） | 低 |
| | 後端 mount 靜態檔服務前端 | M | 低。要確認掛載順序不會蓋掉 API 路由 |
| | API 位址由 `window.location.origin` 推導 | M | 中。要同時顧到 `file://`（Electron）與 HTTP（瀏覽器）兩種情境，兩邊都得測 |
| | 金鑰採方案 (d)，同時保留 (b) 當隱私選項 | S | 低。要說清楚「共用同一把金鑰與帳單」 |
| | 一輪完整響應式整理（含日曆與觸控尺寸） | M | 中。改動面大，但有 64 個前端測試護著 |
| | 字型與圖示改成自帶 | M | 低。順帶解決離線與弱網 |
| | PWA manifest + 加到主畫面 | S | 低。iOS 通知需 HTTPS，要事先講明白 |
| | 區網使用說明與安全警語 | S | 低。**但這是必要的**，不能省 |
| **v2.4 桌面安裝檔** | 改用 `electron-builder` | M | 低。成熟工具鏈 |
| | 多尺寸圖示（icns/ico） | S | 低。美工工作 |
| | PyInstaller 後端概念驗證 | M | **高**。三平台交叉打包、隱藏 import、防毒誤報都是已知的坑。先單一平台驗證再決定投入 |
| | 自動更新機制評估 | M | 中。要有簽章才有意義，可延後 |
| | `fastembed` 改成首次啟用時下載 | S | 低。已有 `/system/capabilities` 可接 |
| **v3 商店軌** | `preload` + `contextBridge` 遷移 | S-M | 中。IPC 只剩 4 個所以面積小，但要逐一驗證 renderer 行為沒變 |
| | Capacitor iOS/Android 包殼 | M | 中。前提是響應式整理已完成 |
| | **後端定位決策**（三路擇一或雙軌） | — | **這是產品決策，不是工程項目。決定之前不要動工** |
| | TLS 與帳號機制強化 | M-L | 高。只在走託管路線時才需要 |
| | 真正的 token 撤銷機制 | M | 中。`jti` 已預留（`security.py:49`），底子在。**託管前必做** |
| | 順手修：`TOKEN_EXPIRE_MINUTES` 接上實際使用 | S | 低。目前是死設定，會誤導人 |

**跨版本的原則**：開源版與上架版共用同一個 codebase，差異用組態或建置旗標處理，不分叉。

---

## 附錄：證據清單

以下所有位置皆已對照 HEAD `1bd14b3` 核實。

### 後端

| 檔案:行號 | 內容 |
|---|---|
| `backend/app/main.py:63-74` | CORS middleware 設定 |
| `backend/app/main.py:71-73` | `allow_headers` 完整涵蓋 `X-LLM-*`、`X-Memory-Semantic`、`X-Language` |
| `backend/app/main.py:90-97` | `/system/capabilities` 端點（回報 fastembed 可用狀態） |
| `backend/app/config.py:19-21` | `URDIARY_DATA_DIR` 與 SQLite 路徑 |
| `backend/app/config.py:31-55` | `secrets.json` 自動生成與 0600 權限 |
| `backend/app/config.py:63` | `ALGORITHM = "HS256"` |
| `backend/app/config.py:64` | `TOKEN_EXPIRE_MINUTES`（**全專案無人讀取**） |
| `backend/app/config.py:69` | `XAI_API_KEY` 後備金鑰來源 |
| `backend/app/config.py:80-83` | CORS 預設 `localhost:3000/8080`，可由環境變數覆寫 |
| `backend/app/api/deps.py:26-46` | `get_current_user`：純簽章驗證，無撤銷檢查 |
| `backend/app/api/routes/user.py:122` | 登入 token 硬編碼 24 小時 |
| `backend/app/api/routes/user.py:207` | refresh token 硬編碼 7 天 |
| `backend/app/api/routes/chat.py:58-65` | `LLMError` → 503 |
| `backend/app/llm.py:17-21` | 無金鑰時拋錯的訊息 |
| `backend/app/llm.py:22` | 後備供應商寫死 `grok` |
| `backend/app/utils/security.py:16, 18` | `HS256`、預設 720 分鐘（實際被呼叫端覆寫） |
| `backend/app/utils/security.py:37-53` | `create_access_token`；`:49` 的 `jti` 註明「預留：未來若加入撤銷機制可用」 |
| `backend/app/requirements.txt:18-19` | `fastembed` 為選配，模型約 220MB |
| `backend/start-backend.sh:28, 31` | `API_PORT` 環境變數；`--host 127.0.0.1` |
| `backend/start-backend.bat:30, 33` | 同上（Windows） |
| `backend/.env.example:22, 38` | `TOKEN_EXPIRE_MINUTES`、`CORS_ALLOWED_ORIGINS` 已文件化 |
| 全 repo grep | 找不到 `StaticFiles` / `app.mount`；找不到 `blacklist` / `revoke`；找不到登出端點；找不到 `0.0.0.0` |

### 前端

| 檔案:行號 | 內容 |
|---|---|
| `desktop/index.html:5` | `viewport` meta 存在 |
| `desktop/index.html:7-8` | Google Fonts 與 cdnjs Font Awesome 外部依賴 |
| `desktop/index.html:45-71` | 頂部列：logo + 3 導覽項 + 4 圖示按鈕 |
| `desktop/js/config.js:10, 122` | API base URL 預設 `http://localhost:8001` |
| `desktop/js/config.js:121-123` | `getApiBaseUrl()` 單一來源 |
| `desktop/js/api_service.js:10, 68-69` | JWT 存 `localStorage` |
| `desktop/js/api_service.js:111, 177, 871` | `getApiBaseUrl()` 呼叫端 |
| `desktop/js/api_service.js:228-239` | `hasKey` 閘控的 `X-LLM-*` 標頭區塊 |
| `desktop/js/api_service.js:235` | **`X-LLM-Api-Key` 明文標頭** |
| `desktop/js/main.js:564`、`desktop/js/settings_module.js:79` | 其餘 `getApiBaseUrl()` 呼叫端 |
| `desktop/js/secure_store.js:12` | `window.require` 防護判斷 |
| `desktop/js/secure_store.js:45-48` | 非 Electron 環境 `setKey` 拋錯 |
| `desktop/js/ui_manager.js:189-190, 228-229` | 分割視圖加 class，無視窗寬度判斷 |
| `desktop/js/ui_manager.js:476`、`desktop/js/error_logger.js:111` | `window.require` 防護判斷 |
| `desktop/js/calendar_module.js:780-834` | Web Notification API（有完整防護判斷） |
| `desktop/css/styles.css:6-21` | 6 個 `@import` |
| `desktop/css/base.css:161, 222, 255-256` | 按鈕內距、`.btn-sm`、`.icon-btn` 2.5rem |
| `desktop/css/base.css:367-375` | `.app-header` 單列 flex 版面 |
| `desktop/css/base.css:450-453` | `.view-container.half` 固定 50% |
| `desktop/css/calendar.css:82, 114-115` | 日面板固定 320px、月曆 7 欄最小 56px 列高 |
| `desktop/css/calendar.css:394-403` | 唯一的版面斷點（900px） |
| `desktop/css/chat.css:376, 390` | 兩個行動斷點 |
| `desktop/main.js:76` | `minWidth: 800` |
| `desktop/main.js:80-89` | `nodeIntegration: true`、`contextIsolation: false`、`enableRemoteModule: true` |
| `desktop/main.js:102` | CSP：`unsafe-inline`、`connect-src 'self' http://localhost:*` |
| `desktop/main.js:175, 248, 260, 269` | 全部 4 個 IPC handler |
| `desktop/main.js:220-245` | `safeStorage` 加密的 `provider-keys.enc` |
| `desktop/package.json:6-10, 17` | scripts 未引用 `electron-packager` |
| `desktop/assets/` | 只有 `icon.jpg` 與 `default-avatar.png` |
| 全 repo grep | 找不到 PWA manifest 或 service worker；renderer 的 Node API 呼叫全部有防護判斷 |

### 專案定位

| 檔案:行號 | 內容 |
|---|---|
| `README.md:9` | 「你的資料不離開你的電腦」 |
| `README.md:165` | 金鑰以系統金鑰鏈加密 |
| `README.md:167` | 「任何資料都不會上傳」 |
| `README.md:176-177` | 「只送往本機後端」、「唯一的網路流量是你的電腦與 AI 供應商之間」 |

### 相對於評估初稿的修正

撰寫過程中對照現行 HEAD，以下幾項與初期盤點不符，已依實況更正：

- **CORS 已可用環境變數設定**（`config.py:81`、`.env.example:38`），不需要改程式碼——比原先評估的樂觀。
- **`styles.css` 是 6 個 `@import` 不是 8 個**，序列往返是 7 次不是 9 次。
- **不是「幾乎沒有行動樣式」**：`chat.css` 有兩個斷點、`calendar.css` 有一個。但 `base.css`／`diary.css`／`components.css` 確實是零，整體結論不變。
- **測試數量**：後端 165 個（不是 148）、前端 64 個（6 個檔案）。
- **多了一個金鑰方案 (d)**：`.env` 後備金鑰是現成機制（`llm.py:22`），零工作量且隱私最好，初期盤點漏了這條。
- **多發現一項**：`TOKEN_EXPIRE_MINUTES` 定義了也寫進文件，但全專案無人讀取，有效期實際是兩處硬編碼。
- 本分支已修好、不再是缺口的項目：API 位址單點收斂、IPC 縮到 4 個 handler、token 黑名單（原本恆為 False）已移除、`diary.css` 的孤兒行動樣式已刪、`main.js` 的圖示引用已修正。
