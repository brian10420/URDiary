"""手刻的行程內限流器 (v2.3 task 1.5：對外開放前的安全閘門後半)。

單一 uvicorn worker、家庭規模的用量，不值得多裝一個相依套件
(`slowapi`/`limits` 都沒裝) —— 固定視窗計數器存在模組級 dict 就夠用。
**重開機會清空所有計數**：這是本機部署的合理取捨 (與 config.py 的
「未設 env 就每次啟動重新生成密鑰」同一種取捨)，不必為了跨重啟保留計數
而換成需要落地的實作。

三種鍵值、兩種掛載方式 (v2.3 SDD 已定案的架構)：

1. **IP 鍵**(global / login / create / refresh)：由 `RateLimitMiddleware`
   在 ASGI 層擋下，不需要認證身分，單純看 method+path+來源 IP。
2. **使用者鍵**(LLM 端點 20/分鐘)：由 `enforce_llm_rate_limit` 這個
   FastAPI 依賴項擋，因為需要 `get_current_user` 解出的身分——中間件
   拿不到 (也刻意不在中間件解 JWT，見 global-constraints 與本檔案下方
   `enforce_llm_rate_limit` 的說明)。
3. **使用者名稱鍵**(登入失敗鎖定 10 次失敗/5 分鐘)：既不是單純 IP 也不是
   已認證身分——登入當下還沒有身分，而 body 是 form-urlencoded，在
   middleware 層讀 body 會跟下游的 `OAuth2PasswordRequestForm` 搶著消費
   同一個 request stream (Starlette 對「middleware 讀過 body 後下游還能
   不能再讀」這件事的保證會隨版本變動，不值得賭)。改成直接由
   `api/routes/user.py` 的 `login()` 呼叫 `check_username_lockout()` /
   `record_login_failure()` / `record_login_success()` 這三個函式——
   business logic 本來就知道「這次登入失敗了嗎」與「使用者名稱是什麼」。

**記憶體**：所有計數存在 `_counters: Dict[(bucket, key), _Window]`。沒有
背景執行緒定期清理；改成「每次呼叫 `_check_and_increment`/`_peek` 時，
順便掃一輪整個 dict、把視窗已經過期的項目砍掉」(見 `_prune_expired`)。
家庭規模下 dict 大小是「最近一個視窗內有動作過的相異 (bucket,key) 數」，
掃描成本可忽略；只要之後還有請求進來就會觸發清理，不會無止盡增長。

**時間源**：一律經 `_now()` (monotonic clock) 讀取，不要在別處直接呼叫
`time.monotonic()`。測試靠 `monkeypatch.setattr(rate_limit, "_now", fake)`
偽造時鐘來驗證「視窗重置」，不必真的 `time.sleep()`。

**RATE_LIMIT_ENABLED / TRUSTED_PROXY**：定義在 `config.py`（與
`REQUIRE_INVITE` 同一個模式），這裡一律用 `import config` 在呼叫當下讀
`config.RATE_LIMIT_ENABLED` / `config.TRUSTED_PROXY`，不要
`from config import ...` 把值綁死在本模組 import 當下——否則測試的
monkeypatch 不會被看到。
"""
import math
import time
from typing import Dict, Tuple

from fastapi import Depends
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

import config
from api.deps import get_current_user, get_language
from database.models import User
from middleware.exception_handlers import api_error_response
from services.prompt_loader import normalize_lang
from utils.api_exceptions import TooManyRequestsError
from utils.messages import msg

# -----------------------
# 桶設定 (全部是模組級常數：測試用 monkeypatch 往下調，不必真的等視窗過期)
# -----------------------
LOGIN_LIMIT, LOGIN_WINDOW_SECONDS = 10, 5 * 60
LOGIN_LOCKOUT_LIMIT, LOGIN_LOCKOUT_WINDOW_SECONDS = 10, 5 * 60
CREATE_LIMIT, CREATE_WINDOW_SECONDS = 5, 60 * 60
REFRESH_LIMIT, REFRESH_WINDOW_SECONDS = 30, 60 * 60
LLM_LIMIT, LLM_WINDOW_SECONDS = 20, 60
GLOBAL_LIMIT, GLOBAL_WINDOW_SECONDS = 300, 60

# method+path 精確比對 → IP 鍵桶名。/users/token 是 OAuth2PasswordBearer
# 標準別名，內部直接呼叫 login() (見 api/routes/user.py 的 get_token())，
# 沒有獨立業務邏輯——不歸進同一個桶的話，攻擊者單純改打這條路徑就能繞過
# login 桶，形同沒做限流。
_IP_KEYED_PATHS: Dict[Tuple[str, str], str] = {
    ("POST", "/users/login"): "login",
    ("POST", "/users/token"): "login",
    ("POST", "/users/create"): "create",
    ("POST", "/users/token/refresh"): "refresh",
}

# /health 是監控/watchdog 探針，不能因為被 uptime 監控高頻打就 429——
# 監控掛掉比誤判一次濫用嚴重得多。這裡整條路徑豁免所有桶 (含 global)。
EXEMPT_PATHS = frozenset({"/health"})


def _limit_and_window(bucket: str) -> Tuple[int, float]:
    """依桶名回傳 (上限次數, 視窗秒數)。

    刻意寫成 if/elif 直接讀模組級常數的「名字」，不要預先烤進一個
    dict/tuple──那樣 `monkeypatch.setattr(rate_limit, "LOGIN_LIMIT", 2)`
    改的是模組屬性，若這裡的對照表在 import 當下就把值複製走，
    monkeypatch 會完全沒有作用 (同一個「模組屬性 vs 值複製」的坑，
    global-constraints 對 REQUIRE_INVITE 的警語也是同一件事)。
    """
    if bucket == "login":
        return LOGIN_LIMIT, LOGIN_WINDOW_SECONDS
    if bucket == "login_lockout":
        return LOGIN_LOCKOUT_LIMIT, LOGIN_LOCKOUT_WINDOW_SECONDS
    if bucket == "create":
        return CREATE_LIMIT, CREATE_WINDOW_SECONDS
    if bucket == "refresh":
        return REFRESH_LIMIT, REFRESH_WINDOW_SECONDS
    if bucket == "llm":
        return LLM_LIMIT, LLM_WINDOW_SECONDS
    if bucket == "global":
        return GLOBAL_LIMIT, GLOBAL_WINDOW_SECONDS
    raise KeyError(f"unknown rate-limit bucket: {bucket!r}")


def _now() -> float:
    """單調時鐘來源；測試 monkeypatch 這個函式本身以偽造時間流逝。"""
    return time.monotonic()


# (bucket, key) -> {"window_start": float, "count": int}
_counters: Dict[Tuple[str, str], Dict[str, float]] = {}


def _prune_expired(now: float) -> None:
    """機會性清理：掃一輪 `_counters`，砍掉視窗已經過期的項目。

    沒有背景執行緒——靠「每次真的有請求進來查詢/計數時」順便清理，符合
    task brief 的「no background thread」。家庭規模下 dict 條目數很小，
    全表掃描成本可忽略。
    """
    stale = [
        dict_key
        for dict_key, entry in _counters.items()
        if now - entry["window_start"] >= _limit_and_window(dict_key[0])[1]
    ]
    for dict_key in stale:
        del _counters[dict_key]


def _peek(bucket: str, key: str) -> Tuple[bool, float]:
    """檢查 (bucket, key) 是否還有名額，**不**遞增計數。

    回傳 (是否放行, 若拒絕則還要等待的秒數；放行時一律 0.0)。
    """
    limit, window = _limit_and_window(bucket)
    now = _now()
    _prune_expired(now)

    entry = _counters.get((bucket, key))
    if entry is None or now - entry["window_start"] >= window:
        return True, 0.0
    if entry["count"] >= limit:
        return False, max(window - (now - entry["window_start"]), 0.0)
    return True, 0.0


def _increment(bucket: str, key: str) -> None:
    """記一次事件，不做限制判斷 (判斷交給呼叫端自己先 `_peek`)。

    視窗已過期就重開一個新視窗，計 1 次。這是「登入失敗」這類「只有
    特定結果才算一次」場景要用的原語——是否放行由呼叫端 (login() 內部)
    自行決定，這裡只負責記帳。
    """
    limit, window = _limit_and_window(bucket)
    now = _now()
    entry = _counters.get((bucket, key))
    if entry is None or now - entry["window_start"] >= window:
        entry = {"window_start": now, "count": 0}
        _counters[(bucket, key)] = entry
    entry["count"] += 1


def _check_and_increment(bucket: str, key: str) -> Tuple[bool, float]:
    """peek 過關的話順便計入本次請求。IP 桶與 LLM 桶都用這個——
    「用量」直接等於「請求量」，不像登入鎖定只有失敗才算數。
    """
    allowed, retry_after = _peek(bucket, key)
    if allowed:
        _increment(bucket, key)
    return allowed, retry_after


def _ceil_seconds(seconds: float) -> int:
    """`Retry-After` 只認整數秒；無條件進位——寧可讓客戶端多等一點點，
    也不要少算導致它按建議時間重試又立刻撞上還沒重置的視窗。"""
    return max(int(math.ceil(seconds)), 1)


def reset() -> None:
    """清空所有計數器。給測試在案例之間重置用，也留給未來的管理介面用
    (例如手動解除某個被鎖定的帳號)。"""
    _counters.clear()


# -----------------------
# 真實用戶端 IP
# -----------------------
def _client_ip(request: Request) -> str:
    """解析這個請求該算在哪個 IP 頭上。

    預設 (`config.TRUSTED_PROXY` 關閉)：一律用 `request.client.host`——
    這是 ASGI 伺服器實際看到的 TCP 連線來源，請求者無法偽造。

    只有明確架在受信任的反向代理/tunnel 後面才開啟 `URDIARY_TRUSTED_PROXY`：
    這種部署下 `request.client.host` 只會是代理的本機連線位址，每個外部
    使用者都會共用同一個「IP」，限流形同對單一使用者生效、對其他人完全
    沒用。開啟後依序信任：

    - `CF-Connecting-IP`：Cloudflare 專屬標頭，只有 Cloudflare 的邊緣節點
      會設定，可信度最高。
    - `X-Forwarded-For` 的第一個值：Tailscale serve/funnel 等一般反代會
      設這個標頭 (見 middleware/security_headers.py 對 X-Forwarded-Proto
      的同類用法)。這個標頭本質上是「自報」的，只有在確定前面有受信任的
      代理會清洗/覆寫它時才能採信。
    - 兩者都沒有：退回 `request.client.host`。

    絕不在 `TRUSTED_PROXY` 關閉時讀這兩個標頭——它們是請求者可以任意
    塞值的一般 HTTP 標頭，沒有受信任代理把關時，攻擊者能讓每次請求自報
    不同 IP，直接繞過所有 IP 鍵的桶。
    """
    if config.TRUSTED_PROXY:
        cf_ip = request.headers.get("CF-Connecting-IP")
        if cf_ip and cf_ip.strip():
            return cf_ip.strip()
        xff = request.headers.get("X-Forwarded-For")
        if xff:
            first = xff.split(",")[0].strip()
            if first:
                return first
    return request.client.host if request.client else "unknown"


def _request_lang(request: Request) -> str:
    """中間件層沒有 FastAPI 的 `Depends(get_language)` 可用，直接讀
    `X-Language` 標頭走同一套正規化 (api/deps.get_language 內部做的事)。"""
    return normalize_lang(request.headers.get("x-language"))


def _rate_limited_response(request: Request, retry_after: float) -> Response:
    """組出與 `exception_handlers.http_exception_handler` 完全同形狀的
    429 JSON 回應 (error/detail/request_id/code 四個 key 一致)。中間件層
    的 429 不會經過那個 handler (它只接下游、經過路由的例外)，所以直接
    共用同一個 `api_error_response` 來組，避免兩處分別維護、慢慢長歪。
    """
    lang = _request_lang(request)
    exc = TooManyRequestsError(
        detail=msg("rate_limited", lang),
        headers={"Retry-After": str(_ceil_seconds(retry_after))},
    )
    return api_error_response(request, exc)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """IP 鍵桶 (global / login / create / refresh) 的 ASGI 層執行點。

    注意事項:
    - `config.RATE_LIMIT_ENABLED` 關閉時整個 no-op (每次請求都在呼叫當下讀
      這個模組屬性，不是啟動時讀一次)。
    - `/health` 全豁免。
    - 特定路徑桶 (login/create/refresh) 與 global 桶各自獨立判定，兩者
      都要有名額才放行；哪個先被打滿就回哪個的 Retry-After。
    - 只呼叫 `call_next`、不吃 request body，因此不會跟下游的
      `OAuth2PasswordRequestForm` 等 body 解析搶讀 request stream。
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        if not config.RATE_LIMIT_ENABLED or request.url.path in EXEMPT_PATHS:
            return await call_next(request)

        ip = _client_ip(request)

        specific_bucket = _IP_KEYED_PATHS.get((request.method, request.url.path))
        if specific_bucket is not None:
            allowed, retry_after = _check_and_increment(specific_bucket, ip)
            if not allowed:
                return _rate_limited_response(request, retry_after)

        allowed, retry_after = _check_and_increment("global", ip)
        if not allowed:
            return _rate_limited_response(request, retry_after)

        return await call_next(request)


# -----------------------
# 使用者鍵桶：LLM 端點 (FastAPI 依賴項)
# -----------------------
def enforce_llm_rate_limit(
    current_user: User = Depends(get_current_user),
    lang: str = Depends(get_language),
) -> None:
    """掛在每個真的會呼叫 LLM 供應商的端點上 (見 api/routes/diary.py、
    api/routes/chat.py 掛用清單)。

    務必掛成 `Depends(...)`、不要在端點本體手動呼叫——FastAPI 會在執行
    路由函式本體「之前」解完所有宣告的 Depends，這保證超額請求會在任何
    `llm.resolve_config()` / `llm.chat()` 之前就被攔下來，不會先燒了一次
    模型呼叫的額度才回 429。

    依賴 `get_current_user` (而不是自己重新解 JWT)：per-user 限流本來就
    需要「已通過認證的身分」，而中間件層刻意不做這件事 (global-constraints
    /decisions：不在 middleware 解 token)；FastAPI 的依賴項快取
    (`use_cache=True` 預設值) 保證同一個請求裡，端點本體另外宣告的
    `current_user: User = Depends(get_current_user)` 會共用同一次解析
    結果，不會多打一次資料庫。
    """
    if not config.RATE_LIMIT_ENABLED:
        return

    allowed, retry_after = _check_and_increment("llm", str(current_user.id))
    if not allowed:
        raise TooManyRequestsError(
            detail=msg("rate_limited", lang),
            headers={"Retry-After": str(_ceil_seconds(retry_after))},
        )


# -----------------------
# 使用者名稱鍵：登入失敗鎖定
# -----------------------
def check_username_lockout(username: str, lang: str = "zh-TW") -> None:
    """登入端點最先要做的事：檢查這個使用者名稱是不是已經因為太多次失敗
    被鎖定。**只檢查、不計數**——單純「嘗試登入」不該消耗鎖定額度，只有
    密碼真的錯了才算一次 (見 `record_login_failure`)。

    刻意用「請求裡原始附上的使用者名稱字串」當鍵，不去查這個帳號存不存在
    ——這樣不管使用者名稱是否真實存在，鎖定行為完全一致，不會變成一個
    可以拿來判斷「這個帳號存不存在」的側路 (task 1.5 self-review 明確
    點名的風險)。呼叫端必須在密碼驗證、甚至查詢使用者「之前」呼叫這個
    函式，才能同時省下一次不必要的 bcrypt 運算。
    """
    if not config.RATE_LIMIT_ENABLED:
        return

    allowed, retry_after = _peek("login_lockout", username)
    if not allowed:
        raise TooManyRequestsError(
            detail=msg("rate_limited", lang),
            headers={"Retry-After": str(_ceil_seconds(retry_after))},
        )


def record_login_failure(username: str) -> None:
    """登入失敗 (帳號不存在 / 密碼錯誤 / 帳號沒有密碼欄位) 都要呼叫這個
    ——任何一種失敗理由都記同一個桶、用同一句錯誤訊息，不能讓使用者名稱
    是否存在改變「多快被鎖定」這件事本身變成可觀測的差異。"""
    if not config.RATE_LIMIT_ENABLED:
        return
    _increment("login_lockout", username)


def record_login_success(username: str) -> None:
    """登入成功要清掉這個使用者名稱之前累積的失敗次數——鎖定只針對
    「持續失敗」，不是「這個使用者名稱曾經失敗過」，成功一次就該重新
    給滿額度。"""
    if not config.RATE_LIMIT_ENABLED:
        return
    _counters.pop(("login_lockout", username), None)
