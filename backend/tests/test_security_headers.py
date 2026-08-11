"""鎖定安全標頭中間件 (CSP / nosniff / referrer-policy / 條件式 HSTS)，
以及它相對 CORSMiddleware 的註冊順序 (main.py 的順序警語：CORS 註冊在
main.py:63-74、預設是最外層)。

只用既有的 /health 端點驗證標頭：這個端點在 task 1.1 之前就存在，跟前端
靜態檔掛載無關，能單純鎖定「中間件本身」的行為。靜態回應也會拿到同一組
標頭這件事，另外在 test_frontend_static.py 隨靜態檔測試一起驗證。
"""
from starlette.middleware.cors import CORSMiddleware

from middleware.security_headers import SecurityHeadersMiddleware


def test_registered_outermost_relative_to_cors(client):
    """add_middleware() 是 insert(0, ...)：最後呼叫的排在 user_middleware[0]，
    也就是最外層 (離網路端最近，參見 starlette.applications.Starlette.
    build_middleware_stack)。main.py 刻意把安全標頭中間件排在 CORS 之後
    註冊，讓它包住 CORS——CORS 對 preflight (OPTIONS) 請求會直接短路回應、
    不呼叫更內層，只有放在最外層才能保證「所有」回應都會被加上安全標頭。
    """
    import main

    classes = [mw.cls for mw in main.app.user_middleware]

    assert SecurityHeadersMiddleware in classes
    assert CORSMiddleware in classes
    assert classes.index(SecurityHeadersMiddleware) < classes.index(CORSMiddleware)


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
