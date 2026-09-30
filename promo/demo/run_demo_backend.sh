#!/usr/bin/env bash
# 為介紹影片錄影開一個「隔離的」URDiary 後端：127.0.0.1:8124，資料目錄＝URDIARY_DATA_DIR。
#
#   URDIARY_DATA_DIR=<seed_demo.py 種好的目錄> promo/demo/run_demo_backend.sh          # 真的 grok-4.3（錄影）
#   URDIARY_DATA_DIR=<同上>                    promo/demo/run_demo_backend.sh --stub   # 假回覆（乾跑、不花錢）
#   選項：--allow-dir（資料目錄不在 /tmp 或 /mnt/Data_SSD/urdiary-media/ 底下時）
#
# 真模式的金鑰：啟動當下讀 ~/.config/urdiary-promo/xai_key（可用 URDIARY_PROMO_KEY_FILE 改路徑），
# 只放進這個 uvicorn 行程的環境變數 XAI_API_KEY——這是 App 本來就有的「伺服器端 Grok 後備」
# 機制（config.XAI_API_KEY → llm.default_config）。瀏覽器／PWA 不送 X-LLM-* 標頭，所以聊天、
# 每日問候、寫日記、記憶收納都會用它；FALLBACK_GROK_MODEL=grok-4.3 讓模型固定是 grok-4.3，
# 設定面板與輸入區上方也會顯示「Grok (xAI) grok-4.3」。金鑰不印出、不寫檔、不進命令列參數
# （ps 看不到），也不存進資料庫——不要在設定面板裡再填一次。
#
# 絕不碰 8001（日常開發後端）、8123（E2E）或 repo 的 data/：目錄安全規則與 seed_demo.py 共用同一份
# 程式碼（--check-dir），而且目錄必須是 seed_demo.py 種過的（有 demo_manifest.json）。
# SECRET_KEY/HASH_SALT 設為空字串 → 用這個目錄自己的 secrets.json，示範帳號的 JWT 在真實後端無效。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PY="$REPO/.venv/bin/python"
APP_DIR="$REPO/backend/app"
HOST=127.0.0.1
PORT=8124
KEY_FILE="${URDIARY_PROMO_KEY_FILE:-$HOME/.config/urdiary-promo/xai_key}"
MODEL="${URDIARY_PROMO_MODEL:-grok-4.3}"

STUB=0
ALLOW=()
for arg in "$@"; do
  case "$arg" in
    --stub) STUB=1 ;;
    --allow-dir) ALLOW=(--allow-dir) ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "run_demo_backend: unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ ! -x "$PY" ]; then
  echo "run_demo_backend: $PY not found (create the repo .venv first)" >&2
  exit 2
fi
if [ -z "${URDIARY_DATA_DIR:-}" ]; then
  echo "run_demo_backend: REFUSED: set URDIARY_DATA_DIR to a directory seeded by promo/demo/seed_demo.py" >&2
  exit 2
fi

# 與種子腳本同一套目錄規則（不 import 任何後端模組）；不過就結束。stub 模式另外提醒
# 「今天還沒問候過的帳號一登入就會收到 stub 問候」（見 seed_demo.stub_checkin_warning）
CHECK_ARGS=(--check-dir --require-seeded)
if [ "$STUB" = 1 ]; then CHECK_ARGS+=(--stub-warning); fi
"$PY" "$HERE/seed_demo.py" "${CHECK_ARGS[@]}" "${ALLOW[@]}"
URDIARY_DATA_DIR="$(cd "$URDIARY_DATA_DIR" && pwd -P)"

if (exec 3<>"/dev/tcp/$HOST/$PORT") 2>/dev/null; then
  echo "run_demo_backend: REFUSED: something already listens on $HOST:$PORT" >&2
  exit 2
fi

export URDIARY_DATA_DIR
export URDIARY_RATE_LIMIT_ENABLED=0
export URDIARY_REQUIRE_INVITE=0
export ENV=development
# 後端預設會從環境變數 URDIARY_FRONTEND_DIR 取前端目錄；呼叫者的 shell 若殘留舊值（例如指到
# 別的 checkout 或舊版打包），錄到的就不是這個 repo 的 desktop/。先清掉，讓後端用預設的 repo 路徑。
unset URDIARY_FRONTEND_DIR
export SECRET_KEY=""
export HASH_SALT=""

if [ "$STUB" = 1 ]; then
  export URDIARY_ALLOW_STUB_LLM=1
  export XAI_API_KEY=""          # stub 只在「沒有任何金鑰」時生效
  unset FALLBACK_GROK_MODEL
  echo "run_demo_backend: LLM = deterministic stub ([urdiary-e2e-stub] replies; never record them)"
else
  if [ ! -r "$KEY_FILE" ]; then
    echo "run_demo_backend: REFUSED: xAI key file not readable: $KEY_FILE (use --stub for dry runs)" >&2
    exit 2
  fi
  XAI_API_KEY="$(tr -d '[:space:]' < "$KEY_FILE")"
  if [ -z "$XAI_API_KEY" ]; then
    echo "run_demo_backend: REFUSED: $KEY_FILE is empty" >&2
    exit 2
  fi
  export XAI_API_KEY
  export FALLBACK_GROK_MODEL="$MODEL"
  export URDIARY_ALLOW_STUB_LLM=0
  echo "run_demo_backend: LLM = Grok $MODEL via the server-side key from $KEY_FILE (not printed)"
fi

echo "run_demo_backend: data dir $URDIARY_DATA_DIR → http://$HOST:$PORT/  (Ctrl-C to stop)"
cd "$APP_DIR"
exec "$PY" -m uvicorn main:app --host "$HOST" --port "$PORT"
