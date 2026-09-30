#!/usr/bin/env bash
# 示範資料的煙霧測試（不用 pytest）：開一個自己的 demo 後端 → 用真的 API 核對 → 關掉 → 確認
# 8124 沒人在聽、repo 的 data/ 一個 byte 都沒動。
#
#   promo/demo/verify_demo.sh                                  # 全新：mkdtemp → 種子 → stub 後端 → 核對 → 刪暫存目錄
#   URDIARY_DATA_DIR=<已種好的目錄> promo/demo/verify_demo.sh     # 核對錄影要用的那個目錄（不重種、不刪）
#   選項：
#     --real-config  改用真模式開後端（讀 xAI 金鑰檔），只核對 App 看到的是 Grok grok-4.3——
#                    不呼叫任何 LLM 端點、零花費；另外確認金鑰沒有出現在後端輸出裡
#     --keep         全新模式跑完不刪暫存目錄
#     --allow-dir    同 seed_demo.py
# 8124 已經有人在聽（例如正在錄影的 demo 後端）時會拒絕執行：先停掉它。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PY="$REPO/.venv/bin/python"
HOST=127.0.0.1
PORT=8124
KEY_FILE="${URDIARY_PROMO_KEY_FILE:-$HOME/.config/urdiary-promo/xai_key}"
MODE=stub
KEEP=0
ALLOW=()
for arg in "$@"; do
  case "$arg" in
    --real-config) MODE=real ;;
    --keep) KEEP=1 ;;
    --allow-dir) ALLOW=(--allow-dir) ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "verify_demo: unknown option: $arg" >&2; exit 2 ;;
  esac
done

port_busy() { (exec 3<>"/dev/tcp/$HOST/$PORT") 2>/dev/null; }
snapshot_data() {
  # repo data/ 的 mtime（奈秒）與大小；只讀 metadata，不打開任何檔案
  if [ -d "$REPO/data" ]; then
    (cd "$REPO" && find data -maxdepth 1 -printf '%p %T@ %s\n' | sort)
  else
    echo "(no data/ directory)"
  fi
}

if port_busy; then
  echo "verify_demo: REFUSED: something already listens on $HOST:$PORT — stop it first" >&2
  exit 2
fi
BEFORE="$(snapshot_data)"

FRESH=0
if [ -z "${URDIARY_DATA_DIR:-}" ]; then
  URDIARY_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/urdiary-demo-verify-XXXXXX")"
  FRESH=1
  export URDIARY_DATA_DIR
  echo "== fresh smoke run in $URDIARY_DATA_DIR"
  "$PY" "$HERE/seed_demo.py" "${ALLOW[@]}"
else
  export URDIARY_DATA_DIR
  echo "== checking the existing demo dir $URDIARY_DATA_DIR"
  "$PY" "$HERE/seed_demo.py" --check-dir --require-seeded "${ALLOW[@]}"
fi

LOG="$URDIARY_DATA_DIR/verify-backend.log"
RUN_ARGS=("${ALLOW[@]}")
if [ "$MODE" = stub ]; then RUN_ARGS+=(--stub); fi
echo "== starting the demo backend ($MODE) on $HOST:$PORT; log: $LOG"
"$HERE/run_demo_backend.sh" "${RUN_ARGS[@]}" >"$LOG" 2>&1 &
PID=$!
stop_backend() {
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
}
trap stop_backend EXIT

"$PY" - "$PID" "http://$HOST:$PORT/health" <<'EOF'
import os, sys, time, urllib.request
pid, url = int(sys.argv[1]), sys.argv[2]
deadline = time.time() + 90
while time.time() < deadline:
    try:
        os.kill(pid, 0)
    except OSError:
        sys.exit("verify_demo: the demo backend exited during startup (see the log)")
    try:
        with urllib.request.urlopen(url, timeout=2) as resp:
            if resp.status == 200:
                sys.exit(0)
    except OSError:
        pass
    time.sleep(0.5)
sys.exit("verify_demo: the demo backend did not answer /health within 90 s")
EOF

STATUS=0
"$PY" "$HERE/verify_demo.py" --expect-llm "$MODE" || STATUS=1

echo "== stopping the demo backend (pid $PID)"
stop_backend
trap - EXIT
if "$PY" - "$HOST" "$PORT" <<'EOF'
import socket, sys, time
host, port = sys.argv[1], int(sys.argv[2])
deadline = time.time() + 15
while time.time() < deadline:
    with socket.socket() as s:
        s.settimeout(0.5)
        if s.connect_ex((host, port)) != 0:
            sys.exit(0)
    time.sleep(0.3)
sys.exit(1)
EOF
then
  echo "PASS  port $PORT is free again"
else
  echo "FAIL  something still listens on $HOST:$PORT"; STATUS=1
fi

if [ "$MODE" = real ]; then
  if "$PY" - "$KEY_FILE" "$LOG" <<'EOF'
import sys
key = open(sys.argv[1], encoding="utf-8").read().strip()
log = open(sys.argv[2], encoding="utf-8", errors="replace").read()
sys.exit(1 if key and key in log else 0)
EOF
  then echo "PASS  the xAI key does not appear in the backend output"
  else echo "FAIL  the xAI key appears in $LOG — delete that file"; STATUS=1
  fi
fi

AFTER="$(snapshot_data)"
if [ "$BEFORE" = "$AFTER" ]; then
  echo "PASS  repo data/ untouched (mtime and size of every entry identical)"
else
  echo "FAIL  repo data/ changed during the run:"; diff <(echo "$BEFORE") <(echo "$AFTER") || true; STATUS=1
fi

if [ "$FRESH" = 1 ] && [ "$KEEP" = 0 ]; then
  case "$URDIARY_DATA_DIR" in
    "${TMPDIR:-/tmp}"/urdiary-demo-verify-*) rm -rf -- "$URDIARY_DATA_DIR"; echo "== removed $URDIARY_DATA_DIR" ;;
  esac
fi
if [ "$STATUS" = 0 ]; then echo "verify_demo: ALL CHECKS PASSED"; else echo "verify_demo: FAILURES (see above)"; fi
exit "$STATUS"
