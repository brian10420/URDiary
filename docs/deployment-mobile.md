# URDiary 行動裝置部署指南

> 對應版本：v2.3.0（`APP_VERSION`，`backend/app/config.py:15`）。
> 本文件是**操作指南**：每一條指令、每一個旗標都對照 v2.3 實際程式碼核實過，不是憑印象寫的。
> 它與 [`deployment-feasibility.md`](deployment-feasibility.md) 的關係是「評估 → 落地」——那份文件評估「做不做得到」，這份文件教「怎麼做」。想知道 v2.3 具體實作了評估報告裡的哪些項目，見該文件末尾新增的落地對照。

## 太長不看

把 URDiary 分享給家人朋友的手機用，流程是：**裝 Tailscale → 用 `install-service.sh` 把後端裝成受監督的服務（同時開一條 tailnet-only 的 HTTPS 通道）→ 發一組邀請碼 → （可選）設定共用金鑰 → 對方在手機瀏覽器打開連結、加到主畫面。**

**在你把服務開放給「整個網際網路」（也就是用 `tailscale funnel` 而不是 `tailscale serve`）之前，有一道安全閘門必須先確認開著**——見下面第一節。閘門沒開的情況下，任何拿得到網址的人都能自行註冊帳號、無限制打你的 LLM 額度。`install-service.sh` 產生的服務單元預設就已經把這道閘門開好、且預設走 tailnet-only 的 `serve`，照著第四節做的話不需要自己額外設定；只有在你決定自己手動啟動後端、不用這支腳本時，才需要自己記得。

---

## 一、安全閘門：對外開放前必讀

**這是本文件最重要的一節，優先讀完再往下做。**

在把 tunnel 從「只有我的 tailnet 看得到」（`tailscale serve`）切成「整個網際網路都能連」（`tailscale funnel`）之前，以下三個環境變數**必須同時成立**——只開一兩個不算數，這是一組閘門而不是三個獨立選項：

| 環境變數 | 要求值 | 沒開會怎樣 |
|---|---|---|
| `URDIARY_REQUIRE_INVITE` | `1` | 任何人都能自行呼叫 `/users/create` 註冊帳號——沒有邀請碼這道關卡（預設 `False`，`backend/app/config.py:137`） |
| `URDIARY_RATE_LIMIT_ENABLED` | `1`（其實是預設值，但要明確確認） | 對話、註冊、登入等端點沒有次數限制——攻擊者或誤用可以無限制打你設定的 LLM 金鑰額度（預設已是 `True`，`backend/app/config.py:148`；`install-service.sh` 仍選擇明寫，不依賴「預設值以後不會被改掉」這個假設） |
| `ENV` | `production` | `/docs`、`/redoc`、`/openapi.json` 會完整公開你的 API 規格（見 `backend/app/main.py:63-64`：`ENV != "production"` 時才會註冊這兩條路由）；同時 `start-backend.sh` 也會因此關掉 `--reload`，避免正式環境無預警重啟 |

**如果你照第四節用 `backend/scripts/install-service.sh` 安裝**，這三個值連同 `URDIARY_HOST=127.0.0.1`、`URDIARY_TRUSTED_PROXY=1` 一起寫進 `urdiary-backend.service`（腳本原始碼見 `backend/scripts/install-service.sh:117-135`），不需要另外設定。只有你選擇不用這支腳本、自己手動啟動後端時，才需要自己把這三個環境變數帶上。

**推薦順序**：先只用 `tailscale serve`（預設值，只有你的 tailnet 看得到），實際用自己的手機連過、確認一切正常，**再**考慮要不要切到 `tailscale funnel`（見第二節）。沒有必須公開到整個網際網路的理由時，`serve` 本身就已經解決「家人朋友的手機連得到」這個需求——tailnet 成員都是你自己邀請加入的裝置。

### 這道閘門背後的假設（值得知道，不是額外待辦）

- `URDIARY_TRUSTED_PROXY=1` 讓限流器改信任 `X-Forwarded-For` 表頭來辨識「每個使用者」的真實 IP（否則所有經過 tunnel 的請求都會被誤判成同一個來源）。這個假設成立的前提是 **tunnel 是唯一對外入口**——`X-Forwarded-For` 本質上是請求者能自己塞值的一般標頭。只要這台機器的 `127.0.0.1:<port>` 沒有被別的方式（例如另一個反向代理、或不小心把埠對外開放）暴露出去，這個假設就成立（完整說明見 `backend/scripts/install-service.sh:95-105` 的註解）。
- `ENV=production` 只關掉 `/docs`/`/redoc`，`/health` 仍然刻意保持可探測（不需要認證），這是給 tunnel／systemd 做健康檢查用的（`backend/app/main.py:128-151`）。它只回報 `status`/`env`/`version`/`db_ok`/`uptime_seconds`，不含任何使用者資料。

---

## 二、`tailscale serve` 與 `tailscale funnel`：安全性差異

| | `tailscale serve` | `tailscale funnel` |
|---|---|---|
| 誰連得到 | **只有你的 tailnet**——也就是你自己登入過同一個 Tailscale 帳號的裝置 | **整個網際網路**——任何人拿到網址都能連，等同公開網站 |
| HTTPS 憑證 | 有效憑證，Tailscale 自動核發 | 同樣是有效憑證 |
| 支援的埠 | tailnet 內部任意埠 | **只能三選一：443 / 8443 / 10000**（Funnel 的硬限制，`tailscale funnel --help` 沒特別強調，但這是官方文件明載的限制） |
| 需要額外設定 | 不需要 | 需要先到 [tailscale 管理後台的 ACL 頁面](https://login.tailscale.com/admin/acls) 開啟這個節點的 Funnel 權限（預設關閉） |
| `install-service.sh` 的預設值 | 這是腳本寫入 `urdiary-tunnel.service` 的預設 `ExecStart` | 以註解形式留在同一個 unit 檔裡，需要手動切換（見下方） |

兩者都會核發一張有效的 HTTPS 憑證——這不是可有可無的細節：PWA 的 Service Worker 只在「安全情境」（HTTPS，或 `localhost`）下才會被瀏覽器允許註冊，單純的區網 HTTP 連線做不到「加到主畫面後離線可用、背景更新」這些事。

### 要不要切到 `tailscale funnel`

`install-service.sh` 寫入的 `urdiary-tunnel.service`（位於 `~/.config/systemd/user/urdiary-tunnel.service`）內容大致是：

```ini
ExecStart=/usr/bin/tailscale serve http://127.0.0.1:8001
# 公開替代方案 (預設不用！會把後端暴露到整個網際網路)：
# ExecStart=/usr/bin/tailscale funnel http://127.0.0.1:8001
```

確認過第一節的三個安全閘門都開著之後，若真的需要公開到整個網際網路，手動編輯這個檔案，把 `serve` 那行註解掉、取消 `funnel` 那行的註解，然後：

```bash
systemctl --user daemon-reload
systemctl --user restart urdiary-tunnel.service
```

**注意**：`install-service.sh` 是冪等腳本，每次重新執行都會用「當下」的設定重新產生這個 unit 檔（見腳本開頭「冪等」段落的說明）——也就是說**重新執行安裝腳本會把這個檔案覆蓋回 `serve` 預設值**，手動切到 `funnel` 的編輯不會被保留。之後只要重跑過 `install-service.sh`，記得重新做一次上面的切換。

查目前實際生效的設定：

```bash
tailscale serve status     # 或 tailscale funnel status
```

---

## 三、Cloudflare Tunnel（替代方案，非本機預設）

這台機器**沒有安裝 `cloudflared`**（已確認：`which cloudflared` 找不到執行檔），`install-service.sh` 也完全沒有寫任何 Cloudflare 相關的 unit——Tailscale 是這份指南的預設路徑，以下只是給不想用 Tailscale（例如想要自己的網域、不想讓對方也要裝 Tailscale App）的人的**概念性替代方案**，不是本專案已經接好、測過的東西。

一般模式（需要一個 Cloudflare 帳號 + 一個網域）：

```bash
# 需自行安裝 cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel login
cloudflared tunnel create urdiary
cloudflared tunnel route dns urdiary <你的子網域>
cloudflared tunnel run --url http://127.0.0.1:8001 urdiary
```

**第一節的安全閘門對 Cloudflare Tunnel 同樣適用，而且同樣重要**——那三個環境變數是後端自己的設定，跟前面擋的是哪一種 tunnel 無關。用 Cloudflare 時一樣要在 `ENV=production` + `URDIARY_REQUIRE_INVITE=1` + `URDIARY_RATE_LIMIT_ENABLED=1` 都確認之後才對外開放；`URDIARY_TRUSTED_PROXY=1` 則要重新確認 Cloudflare 是否把真實用戶端 IP 放進同一個 `X-Forwarded-For` 表頭（不同代理服務的行為可能不同，這點本文件未驗證，開通前請自行確認 `middleware/rate_limit.py` 讀到的表頭是否符合預期）。

如果你想長期用 Cloudflare Tunnel 取代 Tailscale，需要自己寫一個對應的 systemd unit（可以參照 `backend/scripts/install-service.sh` 裡 `urdiary-tunnel.service` 的寫法：`BindsTo=`/`After=urdiary-backend.service`，前景執行不加 `--url` 之外的背景旗標，讓 systemd 能真正監督這個行程）。

---

## 四、安裝為受監督的服務（systemd + Tailscale）

### 前提

1. `./start-backend.sh` 至少成功跑過一次——repo 根目錄要有 `.venv`（`backend/scripts/install-service.sh` 會檢查 `${REPO_ROOT}/.venv/bin/python` 是否存在，沒有就報錯並中止）。
2. 已安裝並登入 [Tailscale](https://tailscale.com/download)，`tailscale status` 看得到自己這台裝置。這台機器上確認過是 `/usr/bin/tailscale`，版本 1.102.2。
3. 已經決定好要走 `tailscale serve` 還是 `tailscale funnel`（見第二節；預設、也是建議的起點是 `serve`）。

### 執行

```bash
cd backend
./scripts/install-service.sh
```

腳本是冪等的，可以重複執行。它會做這些事：

1. 在 `~/.config/systemd/user/` 寫入兩個 systemd **user** unit：
   - `urdiary-backend.service`——`ExecStart` 就是 `backend/start-backend.sh`，環境變數帶上第一節列的五個安全閘門（`ENV=production`、`URDIARY_HOST=127.0.0.1`、`URDIARY_REQUIRE_INVITE=1`、`URDIARY_RATE_LIMIT_ENABLED=1`、`URDIARY_TRUSTED_PROXY=1`），`Restart=on-failure`。
   - `urdiary-tunnel.service`——預設 `ExecStart` 是 `tailscale serve http://127.0.0.1:<port>`（埠號取自 `backend/.env` 的 `API_PORT`，沒設定則 `8001`），`BindsTo=`+`After=urdiary-backend.service`（後端停了 tunnel 也跟著停）。
2. `systemctl --user daemon-reload`，然後 `enable --now` 兩個服務。
3. `loginctl enable-linger $(whoami)`——**這一步是必要的**：沒有它，systemd `--user` 服務會在你登出（包含 SSH 斷線）後被系統殺掉；開了 linger 之後服務能在你登出、甚至機器重開機後繼續跑。

**再次強調**：不管有沒有帶 `--host` 之類的旗標，後端一律只監聽 `127.0.0.1`——`URDIARY_HOST=127.0.0.1` 在 unit 檔裡明寫，即使那已經是 `start-backend.sh` 未設定時的預設值。對外的唯一路徑是 `urdiary-tunnel.service`。

### 冪等性的一個例外要注意

如果服務**當下已經在跑**，重新執行這支腳本、`systemctl --user enable --now` 並不會自動重啟既有行程。改了 `backend/.env` 之後想讓新設定生效，重新執行腳本產生新 unit 檔，再手動：

```bash
systemctl --user restart urdiary-backend.service urdiary-tunnel.service
```

### 檢查狀態

```bash
systemctl --user status urdiary-backend.service urdiary-tunnel.service
journalctl --user -u urdiary-backend.service -u urdiary-tunnel.service -f   # 即時日誌
tailscale serve status                                                      # 目前對外的 serve/funnel 設定
curl http://127.0.0.1:8001/health                                           # {"status":"ok","env":"production","version":"2.3.0","db_ok":true,...}
```

`ENV=production` 生效後，`http://<你的 tunnel 網址>/docs` 與 `/redoc` 會回 404（`backend/app/main.py:63-64`：`docs_url`/`redoc_url` 在非 production 才註冊）；`/health` 仍然可以正常探測，這是刻意設計（見第一節），不是漏改。

### 密鑰不會出現在 unit 檔裡

`SECRET_KEY`／`HASH_SALT` 刻意不寫進任何 systemd unit：一如既往由 `data/secrets.json` 在後端首次啟動時自動產生並持久化（權限 `0600`，`backend/app/config.py:43-67`）。這組密鑰同時也用來加密存放在資料庫裡的 LLM 金鑰（見第六節）——**輪換它（或刪掉 `data/secrets.json`）會讓所有已儲存的 LLM 金鑰與所有登入工作階段一起失效**，每個人都要重新登入、伺服器擁有者也要重跑一次 `set-server-key`。

---

## 五、建立邀請碼並分享連結

確認 `URDIARY_REQUIRE_INVITE=1` 已經生效之後（第四節安裝完就會是這樣），用 `urdiary_admin.py` 發一組邀請碼：

```bash
.venv/bin/python backend/scripts/urdiary_admin.py mint-invite --uses 5 --days 30 --note "家人"
```

- `--uses`：可使用次數上限（預設 1；上面例子給 5 個人共用同一組碼）。
- `--days`：幾天後過期（預設不過期）。
- `--note`：純粹給你自己在 `list-invites` 時辨識用途，不影響行為。

輸出的明文邀請碼**只會顯示這一次**——資料庫只存 SHA-256 雜湊，之後（包含 `list-invites`）都無法再查出明文，請立即複製保存。

```bash
.venv/bin/python backend/scripts/urdiary_admin.py list-invites            # 列出所有邀請碼（用量/期限/是否撤銷，不含明文）
.venv/bin/python backend/scripts/urdiary_admin.py revoke-invite 3         # 撤銷 id=3 的邀請碼，之後無法再用來註冊
```

**分享給對方的是兩樣東西**：tunnel 網址（`tailscale serve status` 可以查到，格式類似 `https://<機器名>.<你的 tailnet>.ts.net`）+ 這組邀請碼，透過你信任的管道傳給對方（例如私訊）。對方打開網址、點「建立新帳號」時，畫面會**自動多出一欄「邀請碼」**——這一欄是否顯示由前端讀取 `/system/capabilities` 的 `require_invite` 欄位動態決定（`desktop/js/main.js:387`），你不需要另外做任何設定去「打開」這個欄位，伺服器端的 `URDIARY_REQUIRE_INVITE=1` 生效後它就會自己出現。

---

## 六、設定伺服器預設 LLM 金鑰（讓家人零設定就能用）

不想讓每個家人都自己申請、貼一次 API Key？在伺服器上設一組共用的預設金鑰：

```bash
.venv/bin/python backend/scripts/urdiary_admin.py set-server-key --provider grok
# 會用 getpass 提示輸入金鑰（畫面不回顯、不進 shell history）
.venv/bin/python backend/scripts/urdiary_admin.py show-server-key
# 只顯示遮罩後的狀態（供應商/模型/Base URL/金鑰末 4 碼），絕不印出明文或密文
```

支援的供應商：`claude` / `openai` / `grok` / `gemini` / `local`（`local` 需另外加 `--base-url` 與 `--model`，例如自架的 Ollama）。金鑰**絕不接受**用命令列參數傳入（沒有 `--key` 這種旗標）——只能用互動式提示或 `--key-stdin`（管道讀取，例如接 `pass show grok`），避免明文留在 shell history 或被同機其他使用者用 `ps` 看到。

沒有自己設定金鑰的帳號，聊天時都會自動退回用這一組（解析順序見 `backend/app/api/deps.py` 的 `get_llm_config`）。**個人金鑰的優先權高於伺服器預設金鑰**——任何人仍然可以在 App 右上角**設定**面板貼上自己的金鑰、用自己選的供應商，兩者並不衝突。

同樣受 `SECRET_KEY` 輪換影響：伺服器預設金鑰是用 `SECRET_KEY` 導出的金鑰加密存進資料庫的，輪換 `SECRET_KEY` 會讓它解不開，需要重新 `set-server-key` 一次。

---

## 七、安裝為 PWA：iOS 與 Android

前提：你已經有一個 HTTPS 網址（`tailscale serve`/`funnel` 給的網址，或 Cloudflare Tunnel），**不是** `http://192.168.x.x:8001` 這種區網 HTTP 位址——後者可以打開網頁，但不符合 Service Worker 要求的安全情境，做不到「加到主畫面後離線可用、背景更新」。

### iOS（Safari）

1. 用 **Safari**（不是 Chrome——iOS 上只有 Safari 能把網站加到主畫面成為獨立 App）打開你的 tunnel 網址。
2. 點底部工具列的「分享」圖示。
3. 選「加入主畫面」（Add to Home Screen）。
4. 確認名稱後點「新增」。

主畫面上會出現 URDiary 的圖示（`desktop/assets/icons/apple-touch-icon-180.png`，由 `index.html` 的 `<link rel="apple-touch-icon">` 指定），全螢幕啟動（無 Safari 網址列，`display: standalone`），狀態列樣式為深色（`apple-mobile-web-app-status-bar-style: black`）。

### Android（Chrome）

1. 用 **Chrome** 打開你的 tunnel 網址。
2. Chrome 通常會在網址列出現「安裝」圖示，或是在右上角選單（⋮）裡有「安裝應用程式」／「加到主畫面」——實際文字與位置依 Chrome 版本可能略有不同。
3. 確認安裝。

Android 會用到 `manifest.webmanifest` 裡標記 `purpose: maskable` 的那個圖示（`icon-maskable-512.png`），讓圖示在各家 Android 桌面的裁切形狀（圓形、圓角方形…）下都不會被裁掉重要部分。

兩個平台都會拿到同一份 `manifest.webmanifest`：`name`/`short_name` 皆為「URDiary」、`theme_color`/`background_color` 是米棕色系（`#6d5046`/`#f5f5f0`）、`start_url`/`scope` 都是 `/`。

---

## 八、App 內更新流程

Service Worker **不會在使用者操作到一半時把 App 悄悄換掉**——這是刻意設計（`desktop/sw.js` 檔頭說明）。實際流程：

1. 後端部署了新版本的前端檔案後，下次任何人打開（或重新整理）App 時，瀏覽器會偵測到 `sw.js` 有變動，開始在背景安裝新的 Service Worker。
2. 新的 Service Worker 裝好後**停在 `waiting` 狀態**，不會自動接手——這時畫面上會跳出一個提示：「**有新版本可用**」，旁邊有一個「**重新載入**」按鈕（`desktop/js/i18n.js` 的 `pwa.updateAvailable`/`pwa.updateReload`）。
3. 只有使用者主動點下「重新載入」，新的 Service Worker 才會真正接手、頁面才會重新整理換上新版本。不點的話，舊版本會繼續正常運作，不受影響，下次重新打開 App 時提示還會再出現。

這個設計的理由很直接：如果聊到一半、或日曆表單填到一半時背景默默重新整理頁面，會直接把使用者正在做的事情打斷。

---

## 九、收回對外連線（重新變回純本機）

不想再對外開放時，依序執行：

```bash
# 1. 關掉 Tailscale 的對外設定
tailscale serve reset      # 如果你切到 funnel 過，用 tailscale funnel reset

# 2. 停用兩個 systemd 服務（disable 之後開機／登入也不會自動啟動）
systemctl --user disable --now urdiary-backend.service urdiary-tunnel.service

# 3. 取消登出後繼續執行的設定
loginctl disable-linger "$(whoami)"
```

這樣做之後，後端不再對外可連，你的日記資料完全不受影響——`data/urdiary.db` 原封不動。如果之後只是想在自己電腦上繼續用（不透過手機），直接照 README 原本的方式跑 `./start-backend.sh` + 桌面 App 即可，不需要任何 tunnel。

---

## 十、誠實聲明：這份文件驗證過什麼、還沒驗證什麼

**已驗證**（v2.3 開發過程中，透過桌面瀏覽器 + CDP 裝置模擬完成）：

- PWA 安裝就緒度：manifest 可解析、圖示 200、Service Worker 成功註冊並進入 `activated`/controlling 狀態、離線殼層快取確實填入、零 CSP 違規、字型與圖示皆同源載入成功。這些是在 `http://127.0.0.1:8001`（瀏覽器視 `localhost` 為安全情境，不需要真的走 HTTPS 就能測 Service Worker）用真實的 Chrome 驗證過的，不是紙上推演。
- 窄螢幕版面（單欄、底部分頁列、觸控尺寸）：透過 Chrome DevTools 的裝置模擬（390px 寬，對應 iPhone 尺寸）驗證過。
- 端對端流程（註冊、聊天、產生日記、日曆 CRUD、離線橫幅、版面）：Playwright 在 **iPhone 14 與 Pixel 7 的模擬視窗／User-Agent** 下跑過完整的 16 個測試，全部通過——但這仍然是桌面瀏覽器模擬出的裝置設定檔（viewport + UA + touch 旗標），**不是實體手機**。

**沒有驗證、需要你在真實裝置上親自確認一次**（不是阻擋發布的問題，但發布前應該實測）：

- 在**實體 iPhone**與**實體 Android 手機**上，真的完成「加到主畫面」這個手勢，確認圖示、啟動畫面、全螢幕效果符合預期。
- 在真實鍵盤彈出時（例如打字聊天、填日曆表單），鍵盤**不會蓋住**正在輸入的欄位——`visualViewport` 的鍵盤位移邏輯已經寫好，但只在桌面模擬環境測試過，真實裝置的鍵盤行為（尤其 iOS Safari）有其特殊性，尚未在實機上確認。
- App 保持在前景/背景執行時，行事曆提醒通知在真實手機上的實際觸發行為（提醒只在 URDiary 仍在執行時觸發，這件事本身在桌面瀏覽器驗證過，但手機作業系統對背景分頁/PWA 的省電與凍結策略可能不同，尚未實測）。
- Android Chrome 各版本「安裝應用程式」選單的實際文字與位置——第七節的描述是 Chrome 目前已知的一般行為，沒有在實體 Android 裝置上逐一核對過用詞。

換句話說：**這份文件教的每一條指令、每一個環境變數都對照原始碼核實過，可以放心照做；但「裝到手機上實際體驗如何」這件事，還需要你自己在一支真的 iPhone 與一支真的 Android 手機上各走一次才算數。**
