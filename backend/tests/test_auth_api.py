"""鎖定 /users/* 認證相關 API 的現行行為 (api/routes/user.py)。"""
import uuid

from conftest import TEST_PASSWORD


def _username():
    return f"authtest_{uuid.uuid4().hex[:10]}"


def test_create_user_returns_200_with_expected_fields(client):
    username = _username()
    resp = client.post("/users/create", json={"username": username, "password": TEST_PASSWORD})

    assert resp.status_code == 200
    body = resp.json()
    assert body["username"] == username
    assert isinstance(body["user_id"], int)
    assert "message" in body


def test_create_user_duplicate_username_returns_400_with_code(client):
    username = _username()
    first = client.post("/users/create", json={"username": username, "password": TEST_PASSWORD})
    assert first.status_code == 200

    dup = client.post("/users/create", json={"username": username, "password": TEST_PASSWORD})

    assert dup.status_code == 400
    body = dup.json()
    assert body["code"] == "E2001"  # ErrorCode.USER_ALREADY_EXISTS，現行值
    assert "已存在" in body["detail"]


def test_create_user_weak_password_returns_400(client):
    resp = client.post("/users/create", json={"username": _username(), "password": "weak"})

    assert resp.status_code == 400
    body = resp.json()
    assert body["code"] == "E1001"  # ErrorCode.INVALID_INPUT
    assert "密碼強度不足" in body["detail"]


def test_login_success_returns_access_and_refresh_tokens(client):
    username = _username()
    client.post("/users/create", json={"username": username, "password": TEST_PASSWORD})

    resp = client.post("/users/login", data={"username": username, "password": TEST_PASSWORD})

    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 24 * 60 * 60
    assert body["username"] == username


def test_login_wrong_password_returns_401(client):
    username = _username()
    client.post("/users/create", json={"username": username, "password": TEST_PASSWORD})

    resp = client.post("/users/login", data={"username": username, "password": "WrongPass1!"})

    assert resp.status_code == 401
    assert resp.json()["code"] == "E1004"  # ErrorCode.UNAUTHORIZED


def test_get_own_user_returns_200(client, auth_header):
    headers, user_id = auth_header
    resp = client.get(f"/users/{user_id}", headers=headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["user_id"] == user_id
    assert "username" in body
    assert "created_at" in body


def test_get_other_user_returns_403(client, auth_header, other_auth_header):
    headers, _ = auth_header
    _, other_user_id = other_auth_header

    resp = client.get(f"/users/{other_user_id}", headers=headers)

    assert resp.status_code == 403
    assert resp.json()["code"] == "E1005"  # ErrorCode.FORBIDDEN


def test_list_users_returns_only_self(client, auth_header, other_auth_header):
    headers, user_id = auth_header
    other_auth_header  # 造第二個用戶，確認不會洩漏出去

    resp = client.get("/users/", headers=headers)

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["user_id"] == user_id


def test_refresh_token_returns_new_token(client, auth_header):
    headers, _ = auth_header
    old_token = headers["Authorization"].split(" ", 1)[1]

    resp = client.post("/users/token/refresh", headers=headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 7 * 24 * 60 * 60
    assert body["access_token"] != old_token


def test_protected_endpoint_without_token_returns_401(client):
    resp = client.get("/users/1")
    assert resp.status_code == 401
