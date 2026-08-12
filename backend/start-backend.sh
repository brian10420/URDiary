#!/usr/bin/env bash
# URDiary 後端一鍵啟動腳本 (純本地，免 Docker)
# 用法: ./start-backend.sh
# 首次執行會自動建立虛擬環境並安裝依賴；資料存於專案根目錄 data/
#
# v2.3 task 3.1：這支腳本現在也是 systemd 監督服務 (scripts/install-
# service.sh 產生的 urdiary-backend.service) 的 ExecStart，行為必須同時
# 對「開發者互動執行」與「systemd 背景執行」都正確。
set -euo pipefail
cd "$(dirname "$0")"

# ---------------------------------------------------------------------------
# 讀取 backend/.env，讓 API_PORT / ENV / URDIARY_HOST 對「這個腳本」也生效
# ---------------------------------------------------------------------------
# config.py 自己也會用 python-dotenv 讀一次 backend/.env，但那已經是
# uvicorn 行程「啟動之後」的事：--host/--port/--reload 這幾個旗標是這個
# shell 腳本在 exec uvicorn 之前就要決定好的，python-dotenv 那層完全來不
# 及影響——這正是 API_PORT 過去在這裡「設了沒用」的原因 (只影響 config.py
# 內部邏輯，不影響 uvicorn 實際綁定的 port)。
#
# 優先序 (高到低)：呼叫端已匯出的 shell 環境變數 > backend/.env 內的值 >
# 本腳本內建的預設值。做法：source 前先記下呼叫端是否「已經」設定過這三個
# 變數 (用 ${VAR+x}，因為空字串也算「有設定」，不能用 ${VAR:-} 判斷)，
# source 之後若呼叫端本來就設定過，就把原始值還原——避免 .env 蓋掉使用者
# 刻意匯出的環境變數 (例如 `API_PORT=9001 ./start-backend.sh`，或
# systemd unit 用 Environment= 明確指定的值)。
#
# URDIARY_HOST 一定要跟 ENV/API_PORT 用同一套 guard，即使 backend/.env.example
# 今天沒有這一行：它是這三個裡「安全等級最高」的一個——host 決定了服務綁在
# 哪個網路介面。如果之後有人為了本機方便在 backend/.env 加一行
# URDIARY_HOST=（或任何值），沒有這個 guard 的話 `source .env` 會悄悄蓋掉
# systemd unit 的 Environment=URDIARY_HOST=127.0.0.1，而這正是這個 guard
# 原本要防止的 0.0.0.0 曝險同一類問題——寧可現在多三行，也不要等真的有人
# 加了那行 .env 才發現優先序被打破。
_had_ENV="${ENV+x}"; _prior_ENV="${ENV-}"
_had_API_PORT="${API_PORT+x}"; _prior_API_PORT="${API_PORT-}"
_had_URDIARY_HOST="${URDIARY_HOST+x}"; _prior_URDIARY_HOST="${URDIARY_HOST-}"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

[ -n "$_had_ENV" ] && ENV="$_prior_ENV"
[ -n "$_had_API_PORT" ] && API_PORT="$_prior_API_PORT"
[ -n "$_had_URDIARY_HOST" ] && URDIARY_HOST="$_prior_URDIARY_HOST"

# 虛擬環境位於專案根目錄 .venv (與既有開發環境一致)
VENV_DIR="$(cd .. && pwd)/.venv"
PY="$VENV_DIR/bin/python"

# 1. 首次執行：建立虛擬環境
if [ ! -x "$PY" ]; then
  echo "首次執行：建立 Python 虛擬環境於 $VENV_DIR ..."
  python3 -m venv "$VENV_DIR"
fi

# 2. 確保依賴齊全
#    用 python -m pip 而非 pip 執行檔 (uv 建立的 venv 沒有 pip 執行檔，
#    需先 ensurepip)。uv 使用者也可自行 `uv pip install -r app/requirements.txt`。
if ! "$PY" -c "import fastapi, uvicorn, sqlalchemy" 2>/dev/null; then
  echo "安裝依賴中 (首次約需幾分鐘)..."
  "$PY" -m pip --version >/dev/null 2>&1 || "$PY" -m ensurepip --upgrade
  "$PY" -m pip install -r app/requirements.txt
fi

# 3. 決定監聽位址、埠號、是否啟用 reloader
#    - URDIARY_HOST 預設 127.0.0.1，取代舊版寫死的 --host 127.0.0.1：
#      tunnel (Tailscale serve/funnel，見 scripts/install-service.sh) 連的
#      是 localhost，ufw 也維持只擋外部直連；絕不預設 0.0.0.0。
#    - --reload 只在 ENV=development 開；systemd 監督的正式環境
#      (ENV=production) 一定要關掉——reloader 會多開檔案監看執行緒，
#      且正式環境不該因為程式碼變動就無預警重啟服務。
HOST="${URDIARY_HOST:-127.0.0.1}"
PORT="${API_PORT:-8001}"
RUN_ENV="${ENV:-development}"

# 4. 啟動 FastAPI (扁平匯入需以 app/ 為工作目錄)
#    刻意寫成 if/else 兩條完整的 exec 指令而不是「組一個旗標陣列」：陣列在
#    set -u 底下對「空陣列展開」的行為在 bash < 4.4 (例如 macOS 內建的
#    3.2) 會被當成 unbound variable 直接炸掉，這支腳本兩個平台都要能跑，
#    直接寫兩條分支最簡單也最不會踩雷。
cd app
if [ "$RUN_ENV" = "development" ]; then
  echo "啟動後端於 http://${HOST}:${PORT} (ENV=development，API 文件: /docs)"
  exec "$PY" -m uvicorn main:app --host "$HOST" --port "$PORT" --reload
else
  echo "啟動後端於 http://${HOST}:${PORT} (ENV=${RUN_ENV})"
  exec "$PY" -m uvicorn main:app --host "$HOST" --port "$PORT"
fi
