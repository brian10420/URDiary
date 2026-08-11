"""安全標頭中間件：對所有回應加上瀏覽器安全標頭。

v2.3 起 App 會透過 HTTPS tunnel 曝露到公網 (見 SDD global-constraints)，
補上基本的瀏覽器端防護：CSP、MIME sniffing 防護、Referrer 政策，以及
TLS 場景下的 HSTS。

CSP 只允許同源 ('self') 來源；style-src 額外開放 'unsafe-inline'——
index.html 目前還有約 20 個行內 style= 屬性，拔掉不在本次任務範圍內，
列為延後的強化項目。Phase 2.2 之前 index.html 曾外連 Google Fonts /
Font Awesome CDN，會被這個 CSP 擋下；Phase 2.2 已把字型/圖示改成自架
(desktop/assets/vendor/)，所以這條 CSP 從頭到尾沒放寬過、也不需要放寬——
下面這個常數本來就沒有任何外部主機的例外，未來若又要外接 CDN 字型/圖示，
正確做法是比照 Phase 2.2 再次自架，而不是在這裡幫外部主機開白名單。

註冊順序見 main.py：刻意排在 CORSMiddleware 之後 (= 比 CORS 更外層)。
CORS 對 preflight (OPTIONS) 請求會直接短路回應、不往內呼叫下一層，只有
放在最外層才能保證「所有」回應 (含 preflight) 都會被加上安全標頭。
"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "frame-ancestors 'none'"
)

# FastAPI 內建、未自架的 /docs (Swagger UI) 與 /redoc (ReDoc) 頁面
# (fastapi/openapi/docs.py 的 get_swagger_ui_html / get_redoc_html) 會從
# cdn.jsdelivr.net 載入 JS/CSS；Swagger UI 另外有一段行內 <script> 做
# 初始化，ReDoc 預設載入 Google Fonts。上面的嚴格 CSP 沒有 script-src，
# 退回 default-src 'self'，會讓這些頁面在真實瀏覽器裡整個空白或功能失效。
# /docs、/redoc 明列在 brief 的「不可被遮蔽」清單，代表它們必須維持
# 「可用」，不只是「連得到」——因此只在這幾條 FastAPI 自動產生的開發工具
# 路徑放寬 CSP，其餘所有路徑 (含 API JSON 與前端靜態檔) 一律套用上面的
# 嚴格版本，不允許任何外部主機。ENV=production 時 docs_url/redoc_url
# 本來就是 None (main.py)，這幾條路徑根本不存在，這個放寬不會擴大正式
# 環境的曝險面。
DOCS_CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; "
    "img-src 'self' https://fastapi.tiangolo.com; "
    "font-src 'self' https://fonts.gstatic.com; "
    "frame-ancestors 'none'"
)

# /docs/oauth2-redirect 是 FastAPI 在 docs_url 有值時自動註冊的 Swagger UI
# OAuth2 redirect 頁 (預設值見 FastAPI.__init__ 的 swagger_ui_oauth2_redirect_url)，
# 同樣帶一段行內 <script>，跟 /docs 本體歸在同一組「文件工具」路徑放寬。
RELAXED_CSP_PATHS = frozenset({"/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"})


def _is_tls_request(request: Request) -> bool:
    """請求是否經 TLS 到達：直連時看 URL scheme；經反代/tunnel 時看
    X-Forwarded-Proto (本機 uvicorn 本身沒有 TLS，HTTPS 由前面的 tunnel/
    反代終止，再用這個標頭轉發真實 scheme)。"""
    if request.url.scheme == "https":
        return True
    return request.headers.get("x-forwarded-proto", "").strip().lower() == "https"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """在每個回應加上安全標頭 (CSP / nosniff / referrer-policy / 條件式 HSTS)。"""

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)

        csp = (
            DOCS_CONTENT_SECURITY_POLICY
            if request.url.path in RELAXED_CSP_PATHS
            else CONTENT_SECURITY_POLICY
        )
        response.headers["Content-Security-Policy"] = csp
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"

        if _is_tls_request(request):
            # 兩年 + includeSubDomains：常見的保守預設值 (可參考
            # hstspreload.org 的建議下限 1 年)；未來若要送 HSTS preload
            # list 才需要額外的 preload 指令與更嚴格的子網域要求。
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"

        return response
