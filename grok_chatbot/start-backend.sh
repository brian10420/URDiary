#!/usr/bin/env bash
# URDiary 後端一鍵啟動腳本 (純本地，免 Docker)
# 用法: ./start-backend.sh
# 首次執行會自動建立虛擬環境並安裝依賴；資料存於專案根目錄 data/
set -e
cd "$(dirname "$0")"

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

# 3. 啟動 FastAPI (扁平匯入需以 app/ 為工作目錄)
PORT="${API_PORT:-8001}"
echo "啟動後端於 http://127.0.0.1:${PORT} (API 文件: /docs)"
cd app
exec "$PY" -m uvicorn main:app --host 127.0.0.1 --port "${PORT}" --reload
