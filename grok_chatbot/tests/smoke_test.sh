#!/usr/bin/env bash
# URDiary 後端煙霧測試：無需真金鑰，驗證認證、資料流與供應商鏈路。
# 用法: 先啟動後端 (./start-backend.sh)，再執行 ./tests/smoke_test.sh
set -u
BASE="${URDIARY_API:-http://127.0.0.1:8001}"
USER="smoke_$(date +%s)"
PASS='Sm0keTest!A'
PASSED=0; FAILED=0

check() { # check <名稱> <實際> <預期子字串>
  if [[ "$2" == *"$3"* ]]; then PASSED=$((PASSED+1)); echo "  ✓ $1"
  else FAILED=$((FAILED+1)); echo "  ✗ $1  (expect ~'$3', got: ${2:0:120})"; fi
}

echo "== 健康檢查 =="
check "GET /health" "$(curl -sm 5 $BASE/health)" '"status":"ok"'
check "GET /system/capabilities" "$(curl -sm 5 $BASE/system/capabilities)" 'semantic_memory_available'

echo "== 帳號與認證 =="
check "建立帳號" "$(curl -sm 5 -X POST $BASE/users/create -H 'Content-Type: application/json' -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}")" '"username"'
check "弱密碼被拒" "$(curl -sm 5 -X POST $BASE/users/create -H 'Content-Type: application/json' -d '{"username":"weak_pw_user","password":"123"}')" 'error'
TOKEN=$(curl -sm 5 -X POST $BASE/users/login -H 'Content-Type: application/x-www-form-urlencoded' -d "username=$USER&password=$PASS" | python3 -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null)
check "登入取得 token" "${TOKEN:0:10}" 'ey'
check "無 token 被拒" "$(curl -sm 5 -o /dev/null -w '%{http_code}' $BASE/diaries/1)" '401'

echo "== 供應商鏈路 (假金鑰應得各家 SDK 的認證錯誤) =="
for P in claude openai gemini grok; do
  R=$(curl -sm 30 -X POST $BASE/chat/enhanced/ -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -H "X-LLM-Provider: $P" -H 'X-LLM-Api-Key: sk-fake-key' -d '{"message":"hi"}')
  check "provider=$P 回 LLM 錯誤而非假回覆" "$R" 'error'
done
check "缺金鑰給明確錯誤" "$(curl -sm 5 -X POST $BASE/chat/enhanced/ -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H 'X-LLM-Provider: claude' -d '{"message":"hi"}')" 'API Key'
check "缺金鑰錯誤 (en)" "$(curl -sm 5 -X POST $BASE/chat/enhanced/ -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H 'X-Language: en' -H 'X-LLM-Provider: claude' -d '{"message":"hi"}')" 'Missing API key'

echo "== check-in 降級 =="
check "無可用 LLM 時 checkin:false (不報錯)" "$(curl -sm 60 -X POST $BASE/chat/checkin/ -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H 'X-LLM-Provider: claude' -H 'X-LLM-Api-Key: sk-fake')" '"checkin":false'

echo "== 資料端點 =="
# 注意: UID 是 bash 唯讀內建變數，不可用
MY_ID=$(python3 -c "import base64,json,sys;p='$TOKEN'.split('.')[1];p+='='*(-len(p)%4);print(json.loads(base64.urlsafe_b64decode(p))['id'])")
check "讀自己的日記列表" "$(curl -sm 5 $BASE/diaries/$MY_ID -H "Authorization: Bearer $TOKEN")" '"diaries"'
check "跨用戶讀取被拒" "$(curl -sm 5 -o /dev/null -w '%{http_code}' $BASE/diaries/999999 -H "Authorization: Bearer $TOKEN")" '403'

echo
echo "結果: $PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
