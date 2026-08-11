"""安全標頭中間件：對所有回應加上瀏覽器安全標頭。

v2.3 起 App 會透過 HTTPS tunnel 曝露到公網 (見 SDD global-constraints)，
補上基本的瀏覽器端防護：CSP、MIME sniffing 防護、Referrer 政策，以及
TLS 場景下的 HSTS。

CSP 只允許同源 ('self') 來源；style-src 額外開放 'unsafe-inline'——
index.html 目前還有約 20 個行內 style= 屬性，拔掉不在本次任務範圍內，
列為延後的強化項目。目前 index.html 也還外連 Google Fonts / Font Awesome
CDN，會被這個 CSP 擋下；等 Phase 2.2 把字型/圖示改成自架後，CSP 才不需要
任何外部來源，屆時這裡也要一併移除對外部主機的容忍 (目前本來就沒開放，
這裡先預告 Phase 2.2 應該做的事，避免有人誤以為要放寬 CSP 來「修好」字型)。

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

        response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"

        if _is_tls_request(request):
            # 兩年 + includeSubDomains：常見的保守預設值 (可參考
            # hstspreload.org 的建議下限 1 年)；未來若要送 HSTS preload
            # list 才需要額外的 preload 指令與更嚴格的子網域要求。
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"

        return response
