#!/usr/bin/env bash
# 把 URDiary 後端安裝成受監督的 systemd --user 服務 + Tailscale tunnel。
#
# **這支腳本由 agent 撰寫、刻意不執行**：它會安裝真正的 systemd unit、
# 啟動真正的服務、開啟 loginctl linger (讓服務在登出後繼續跑)——這些都是
# 機器擁有者才能決定的事 (v2.3 task 3.1 brief 明確要求 author it, do NOT
# execute it)。請先讀過下面每一段在做什麼，確認符合你的預期，再手動執行：
#
#   backend/scripts/install-service.sh
#
# 執行前提：
#   1. ./start-backend.sh 至少成功跑過一次 (repo 根目錄要有 .venv)。
#   2. 已安裝並登入 Tailscale (https://tailscale.com/download)，
#      `tailscale status` 看得到自己這台裝置。
#   3. 你已經決定好要用 `tailscale serve` (只有 tailnet 內看得到，預設
#      也是這支腳本寫入的設定) 還是 `tailscale funnel` (公開到整個
#      網際網路)——後者需要另外去 tailnet 的 ACL 開 Funnel 權限，見下面
#      tunnel unit 內的註解。
#
# 冪等：可以重複執行。每次都會用「當下」的 backend/.env 重新產生兩個
# unit 檔、daemon-reload、(re)enable --now、(re)enable-linger；不會產生
# 重複的 unit，也不會重複 enable-linger。**但**如果服務當下已經在跑，
# `enable --now` 不會自動重啟既有行程——改了 .env 之後想讓新設定生效，
# 執行完這支腳本再手動:
#   systemctl --user restart urdiary-backend.service urdiary-tunnel.service
set -euo pipefail

# ---------------------------------------------------------------------------
# 路徑：一律從腳本自身位置推導，不寫死只在這台機器存在的絕對路徑
# (只有 tailscale 執行檔位置例外，那是系統安裝路徑，見下面的偵測)。
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"      # backend/
REPO_ROOT="$(cd "${BACKEND_DIR}/.." && pwd)"       # repo 根目錄
VENV_PY="${REPO_ROOT}/.venv/bin/python"
START_SCRIPT="${BACKEND_DIR}/start-backend.sh"
UNIT_DIR="${HOME}/.config/systemd/user"
BACKEND_UNIT="${UNIT_DIR}/urdiary-backend.service"
TUNNEL_UNIT="${UNIT_DIR}/urdiary-tunnel.service"
TAILSCALE_BIN="$(command -v tailscale || true)"
TAILSCALE_BIN="${TAILSCALE_BIN:-/usr/bin/tailscale}"

# ---------------------------------------------------------------------------
# 埠號：套用與 start-backend.sh 完全相同的優先序 (shell 環境變數 >
# backend/.env > 預設 8001)，讓「backend 監聽的埠」與「tunnel 轉發的埠」
# 兩個 unit 檔永遠指向同一個埠號。
# ---------------------------------------------------------------------------
_had_API_PORT="${API_PORT+x}"; _prior_API_PORT="${API_PORT-}"
if [ -f "${BACKEND_DIR}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "${BACKEND_DIR}/.env"
  set +a
fi
[ -n "${_had_API_PORT}" ] && API_PORT="${_prior_API_PORT}"
PORT="${API_PORT:-8001}"

echo "==> 使用埠號 ${PORT} (優先序：shell 環境變數 > backend/.env > 預設值 8001)"

# ---------------------------------------------------------------------------
# 前置檢查
# ---------------------------------------------------------------------------
if [ ! -x "${VENV_PY}" ]; then
  echo "!! 找不到虛擬環境 ${VENV_PY}" >&2
  echo "!! 請先手動執行過一次 ${START_SCRIPT} 完成首次安裝 (建立 venv、裝相依)" >&2
  exit 1
fi
if [ ! -x "${TAILSCALE_BIN}" ]; then
  echo "!! 找不到 tailscale 執行檔 (${TAILSCALE_BIN})" >&2
  echo "!! 請先安裝並登入 Tailscale: https://tailscale.com/download" >&2
  exit 1
fi

echo "==> 建立 ${UNIT_DIR}"
mkdir -p "${UNIT_DIR}"

# ---------------------------------------------------------------------------
# 後端服務 unit
# ---------------------------------------------------------------------------
# 部署設定 (對外開放前的安全閘門，v2.3 phase 1 定案；務必整組一起開，
# 不要只開其中幾個)：
#   ENV=production
#       對應 config.py 的 os.getenv("ENV", "development")：關掉
#       /docs /redoc，並讓 start-backend.sh 據此關掉 --reload
#       (見 start-backend.sh 的 RUN_ENV 判斷)。
#   URDIARY_HOST=127.0.0.1
#       雖然這已經是 start-backend.sh 未設定時的預設值，這裡仍然明講：
#       絕不綁 0.0.0.0，唯一對外路徑是下面的 tunnel unit。
#   URDIARY_REQUIRE_INVITE=1
#       對外開放前必須開的邀請碼閘門 (phase 1)；沒開的話任何人都能自行
#       註冊帳號。
#   URDIARY_RATE_LIMIT_ENABLED=1
#       明確寫死開啟——雖然 config.py 的預設值也是 True，這裡不依賴
#       「預設值以後不會被改掉」這個假設。
#   URDIARY_TRUSTED_PROXY=1
#       架在 Tailscale serve/funnel 後面才能開：tunnel 會把真實用戶端
#       IP 補進 X-Forwarded-For，限流才看得到「每個使用者」而不是全部
#       算在 tunnel 的本機連線上 (見 middleware/rate_limit.py 的
#       _client_ip)。
#       ⚠️ 安全前提 (security-review 留意)：這個旗標成立的前提是「tunnel
#       是唯一對外入口」。X-Forwarded-For 本質上是請求者能自己塞值的
#       一般 HTTP 標頭；如果這台機器之後又多了其他未受信任的反向代理、
#       或者這個連接埠又被別的方式暴露出去，開著 TRUSTED_PROXY 就等於
#       讓任何請求者自報 IP、直接繞過限流。只要 tunnel unit 還是唯一會
#       連到 127.0.0.1:${PORT} 的入口，這個假設就成立。
#
# SECRET_KEY / HASH_SALT 刻意不寫在這裡：一如既往由 data/secrets.json
# 首次啟動自動產生並持久化 (config.py 的 _load_or_create_secrets)，
# unit 檔不碰任何機密。
#
# 沒有 After=/Wants=network-online.target：systemd --user 實例看不到
# system 層級的 target (authoring 時用 `systemctl --user status
# network-online.target` 讀 只確認過 -> "could not be found")，寫了也不
# 會有效果。後端本身也不需要網路才能啟動 (SQLite 是本機檔案)，不需要
# 額外的啟動順序保證。
echo "==> 寫入 ${BACKEND_UNIT}"
cat > "${BACKEND_UNIT}" <<EOF
[Unit]
Description=URDiary backend (FastAPI, supervised)

[Service]
Type=simple
WorkingDirectory=${BACKEND_DIR}
Environment=ENV=production
Environment=URDIARY_HOST=127.0.0.1
Environment=URDIARY_REQUIRE_INVITE=1
Environment=URDIARY_RATE_LIMIT_ENABLED=1
Environment=URDIARY_TRUSTED_PROXY=1
ExecStart=${START_SCRIPT}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

# ---------------------------------------------------------------------------
# Tunnel unit：預設用 `tailscale serve` (tailnet-only HTTPS)
# ---------------------------------------------------------------------------
# 安全預設：`tailscale serve` 只有同一個 tailnet 裡的裝置看得到，零公開
# 曝險。`tailscale funnel` (下面註解掉的替代寫法) 會把服務公開到整個
# 網際網路——只有你明確要讓 tailnet 以外的人連線時才切換，且事前要：
#   1. 到 https://login.tailscale.com/admin/acls 開啟這個節點的 Funnel
#      權限 (預設關閉)。
#   2. 只能選 443 / 8443 / 10000 三個對外埠之一 (Funnel 的硬限制，
#      `tailscale funnel --help` 沒列出但官方文件明確寫)——不是任意埠。
#
# 不加 --bg：讓 `tailscale serve`/`funnel` 留在前景執行，systemd 才有一個
# 真正的 process 可以監督 (當掉時 Restart=on-failure 才有意義)。加 --bg
# 只會把設定寫進 tailscaled 然後立刻退出——systemd 會把「啟動後馬上結束」
# 當成崩潰不斷嘗試重啟，反而不是我們要的行為。
#
# ExecStart 用完整的 http://127.0.0.1:<port> 寫法 (而不是只給埠號)：
# 兩者對 `tailscale serve` 是等價的 (bare port 預設就是指向
# 127.0.0.1)，但寫明本機 scheme+host+port 讓人不用先知道這個隱含規則
# 就能看懂這一行在做什麼。
#
# BindsTo(+After)= urdiary-backend.service：tunnel 沒有後端可轉發就沒有
# 意義，讓它的生命週期跟著後端走 (後端停了 tunnel 也跟著停；systemd
# --user 實例看得到彼此，這跟上面「system 層級 target 看不到」是兩回事)。
echo "==> 寫入 ${TUNNEL_UNIT}"
cat > "${TUNNEL_UNIT}" <<EOF
[Unit]
Description=URDiary Tailscale tunnel (tailnet-only HTTPS via 'tailscale serve')
After=urdiary-backend.service
BindsTo=urdiary-backend.service

[Service]
Type=simple
ExecStart=${TAILSCALE_BIN} serve http://127.0.0.1:${PORT}
# 公開替代方案 (預設不用！會把後端暴露到整個網際網路)：
# ExecStart=${TAILSCALE_BIN} funnel http://127.0.0.1:${PORT}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

echo "==> systemctl --user daemon-reload"
systemctl --user daemon-reload

echo "==> systemctl --user enable --now urdiary-backend.service"
systemctl --user enable --now urdiary-backend.service

echo "==> systemctl --user enable --now urdiary-tunnel.service"
systemctl --user enable --now urdiary-tunnel.service

echo "==> loginctl enable-linger $(whoami)  (目前預設 Linger=no，服務會在登出後被殺掉)"
loginctl enable-linger "$(whoami)"

echo ""
echo "==> 完成。"
echo "    狀態: systemctl --user status urdiary-backend.service urdiary-tunnel.service"
echo "    日誌: journalctl --user -u urdiary-backend.service -u urdiary-tunnel.service -f"
echo "    目前對外的 Tailscale serve 設定: tailscale serve status"
echo "    改過 backend/.env 之後想讓新設定生效: 重新執行這支腳本，再"
echo "      systemctl --user restart urdiary-backend.service urdiary-tunnel.service"
