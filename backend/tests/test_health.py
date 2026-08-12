"""`/health` 端點的擴充欄位 (v2.3 task 3.1)：version / db_ok / uptime_seconds。

沿用既有的 {"status": "ok", "env": ...} 形狀不變——這個端點在
test_frontend_static.py (路由掛載順序)、test_security_headers.py (安全
標頭)、test_rate_limit.py (限流豁免) 已經在鎖其他面向，這裡只新增鎖三個
新欄位，以及「資料庫探測失敗時仍要回 200」這個明確的設計決策。
"""
from contextlib import contextmanager

import config


def test_health_still_returns_ok_status(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_health_reports_version_matching_single_source_of_truth(client):
    resp = client.get("/health")
    assert resp.json()["version"] == config.APP_VERSION


def test_health_reports_db_ok_true_when_database_reachable(client):
    resp = client.get("/health")
    assert resp.json()["db_ok"] is True


def test_health_reports_uptime_seconds_non_negative(client):
    resp = client.get("/health")
    uptime = resp.json()["uptime_seconds"]
    assert isinstance(uptime, (int, float))
    assert uptime >= 0


def test_health_db_ok_false_but_status_still_200_when_database_check_fails(client, monkeypatch):
    """設計決策：DB 探測失敗不能讓整個端點跟著回 500/503——/health 的第一
    份工作是回答「行程還活著嗎」，這件事在資料庫壞掉時依然成立。db_ok
    這個欄位本身就是給探測者拿來另外判斷資料庫層用的 (見 main.py 的
    health_check 註解)。"""
    import main

    @contextmanager
    def _broken_db_session():
        raise RuntimeError("simulated db failure for test")
        yield  # pragma: no cover - 前面已經 raise，不會走到這裡

    monkeypatch.setattr(main, "db_session", _broken_db_session)

    resp = client.get("/health")

    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    assert resp.json()["db_ok"] is False
