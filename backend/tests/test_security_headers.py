"""鎖定安全標頭中間件 (CSP / nosniff / referrer-policy / 條件式 HSTS)，
以及它相對 CORSMiddleware 的註冊順序 (main.py 的順序警語：CORS 註冊在
main.py:63-74、預設是最外層)。

只用既有的 /health 端點驗證標頭：這個端點在 task 1.1 之前就存在，跟前端
靜態檔掛載無關，能單純鎖定「中間件本身」的行為。靜態回應也會拿到同一組
標頭這件事，另外在 test_frontend_static.py 隨靜態檔測試一起驗證。
"""
from starlette.middleware.cors import CORSMiddleware

from middleware.security_headers import SecurityHeadersMiddleware
from middleware.rate_limit import RateLimitMiddleware


def test_registered_outermost_relative_to_cors(client):
    """add_middleware() 是 insert(0, ...)：最後呼叫的排在 user_middleware[0]，
    也就是最外層 (離網路端最近，參見 starlette.applications.Starlette.
    build_middleware_stack)。main.py 刻意把安全標頭中間件排在 CORS 之後
    註冊，讓它包住 CORS——CORS 對 preflight (OPTIONS) 請求會直接短路回應、
    不呼叫更內層，只有放在最外層才能保證「所有」回應都會被加上安全標頭。

    限流中間件 (v2.3 task 1.5) 則刻意排在最內層 (比 CORS 更內)：
    - 仍然要在 CORS 之內，preflight 短路才不會白白算進限流額度。
    - 一樣要在 SecurityHeaders 之內，被擋下的 429 才拿得到安全標頭。
    見 main.py 的排序註解與 middleware/rate_limit.py 模組docstring。
    """
    import main

    classes = [mw.cls for mw in main.app.user_middleware]

    assert SecurityHeadersMiddleware in classes
    assert CORSMiddleware in classes
    assert RateLimitMiddleware in classes
    assert classes.index(SecurityHeadersMiddleware) < classes.index(CORSMiddleware)
    assert classes.index(CORSMiddleware) < classes.index(RateLimitMiddleware)


def test_headers_present_on_api_json_response(client):
    resp = client.get("/health")

    assert resp.status_code == 200
    assert resp.headers.get("x-content-type-options") == "nosniff"
    assert resp.headers.get("referrer-policy") == "same-origin"

    csp = resp.headers.get("content-security-policy")
    assert "default-src 'self'" in csp
    assert "style-src 'self' 'unsafe-inline'" in csp
    assert "frame-ancestors 'none'" in csp


def test_hsts_absent_over_plain_http(client):
    resp = client.get("/health")
    assert "strict-transport-security" not in resp.headers


def test_hsts_present_when_request_scheme_is_https(client):
    resp = client.get("https://testserver/health")
    assert "max-age=" in resp.headers.get("strict-transport-security", "")


def test_hsts_present_when_x_forwarded_proto_is_https(client):
    """本機開發沒有原生 TLS 端點：HTTPS tunnel/反代會用這個標頭轉發真實
    scheme (見 global-constraints 的行動裝置部署脈絡)。"""
    resp = client.get("/health", headers={"x-forwarded-proto": "https"})
    assert "max-age=" in resp.headers.get("strict-transport-security", "")


# --- /docs /redoc /openapi.json：FastAPI 內建、未自架的文件工具頁 -----------
#
# get_swagger_ui_html/get_redoc_html (fastapi/openapi/docs.py) 從
# cdn.jsdelivr.net 載入 JS/CSS，Swagger UI 另外有一段行內 <script> 做
# 初始化、ReDoc 預設載 Google Fonts。嚴格 CSP (script-src 退回
# default-src 'self') 會讓這些頁面在真實瀏覽器裡整個空白或功能失效——
# TestClient 不會執行/擋下瀏覽器資源載入，所以只看狀態碼/文字內容的測試
# (test_docs_route_not_shadowed 等) 完全看不出這個問題，必須直接斷言
# CSP 標頭本身的內容。/docs /redoc 明列在 brief 的「不可被遮蔽」清單，
# 代表它們必須維持「可用」，不只是「連得到」。

def test_docs_path_gets_relaxed_csp_allowing_swagger_ui_cdn(client):
    resp = client.get("/docs")
    csp = resp.headers.get("content-security-policy", "")

    assert "https://cdn.jsdelivr.net" in csp
    assert "'unsafe-inline'" in csp  # Swagger UI 的行內初始化 script


def test_redoc_path_gets_relaxed_csp_allowing_redoc_cdn(client):
    resp = client.get("/redoc")
    csp = resp.headers.get("content-security-policy", "")

    assert "https://cdn.jsdelivr.net" in csp


def test_openapi_json_path_gets_relaxed_csp_for_consistency_with_docs(client):
    """/openapi.json 本身是 JSON、CSP 對它其實是惰性的，但跟 /docs /redoc
    劃為同一組「文件工具」路徑處理，行為保持一致、好理解。"""
    resp = client.get("/openapi.json")
    csp = resp.headers.get("content-security-policy", "")

    assert "https://cdn.jsdelivr.net" in csp


def test_root_path_keeps_strict_csp_without_external_hosts(client):
    """根路徑「/」是 URDiary 自己的前端頁面，不是 FastAPI 的文件工具頁：
    CDN 放寬僅限 /docs /redoc /openapi.json (與 swagger 的 oauth2-redirect)，
    其餘所有路徑 (含 API 與前端靜態檔) 一律維持嚴格版本，不允許任何外部主機。
    """
    resp = client.get("/")
    csp = resp.headers.get("content-security-policy", "")

    assert "cdn.jsdelivr.net" not in csp
    assert "style-src 'self' 'unsafe-inline'" in csp


def test_health_path_keeps_strict_csp_without_external_hosts(client):
    resp = client.get("/health")
    csp = resp.headers.get("content-security-policy", "")

    assert "cdn.jsdelivr.net" not in csp
