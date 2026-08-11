"""鎖定 backend/scripts/urdiary_admin.py —— 邀請碼管理 CLI (v2.3 task 1.4)。

以真正的子行程呼叫這支腳本 (而不是 import 它的函式直接呼叫)，才是在測
「使用者真正會打的指令」：argparse 的參數解析、--help、離開碼、印到
stdout 的內容格式，都是子行程呼叫才驗得到的東西。

隔離性：conftest.py 在任何 app 模組 import 之前就把 URDIARY_DATA_DIR
設成一個臨時目錄 (os.environ，而非 monkeypatch)，這個設定在整個 pytest
行程存活期間都在，子行程預設會繼承父行程的環境變數，因此這裡的子行程
呼叫一樣落在同一個隔離的臨時目錄，不會碰到真正的 data/ (global-constraints
「Tests never touch data/」)。DB 是 SQLite WAL，子行程 commit 後，這裡用
同一個 pytest 行程內的 crud/SessionLocal 讀，看得到子行程寫入的資料。
"""
import hashlib
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

import database.crud as crud
from database import SessionLocal

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "urdiary_admin.py"


def _run_cli(*args, timeout=30):
    return subprocess.run(
        [sys.executable, str(SCRIPT_PATH), *args],
        capture_output=True, text=True, timeout=timeout,
    )


def _hash(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _extract_code(stdout: str) -> str:
    """從 mint-invite 的輸出裡挑出 `code: <明文>` 那一行的明文。"""
    for line in stdout.splitlines():
        if line.startswith("code: "):
            return line[len("code: "):].strip()
    raise AssertionError(f"mint-invite 輸出裡找不到 'code: ' 這一行:\n{stdout}")


def _extract_id(stdout: str) -> int:
    """從 mint-invite 的輸出裡挑出 `(id=<n>)`。"""
    import re
    m = re.search(r"\(id=(\d+)\)", stdout)
    assert m, f"mint-invite 輸出裡找不到 id:\n{stdout}"
    return int(m.group(1))


# --- 腳本本身存在、可執行、有說明文字 --------------------------------------

def test_script_file_exists():
    assert SCRIPT_PATH.is_file(), f"CLI 腳本不存在: {SCRIPT_PATH}"


def test_help_documents_all_three_subcommands():
    result = _run_cli("--help")
    assert result.returncode == 0, result.stderr
    for name in ("mint-invite", "list-invites", "revoke-invite"):
        assert name in result.stdout, f"--help 沒有列出子指令 {name}:\n{result.stdout}"


def test_no_arguments_exits_nonzero_instead_of_crashing():
    result = _run_cli()
    assert result.returncode != 0
    assert "Traceback" not in result.stderr


# --- mint-invite -----------------------------------------------------------

def test_mint_invite_default_uses_is_one_and_no_expiry():
    result = _run_cli("mint-invite", "--note", "cli test default")
    assert result.returncode == 0, result.stderr

    code = _extract_code(result.stdout)
    invite_id = _extract_id(result.stdout)
    assert "只會顯示這一次" in result.stdout or "只會顯示" in result.stdout

    db = SessionLocal()
    try:
        row = crud.get_invite_code(db, invite_id)
        assert row is not None
        assert row.code_hash == _hash(code), "CLI 印出的明文雜湊後應等於資料庫存的 code_hash"
        assert row.max_uses == 1
        assert row.used_count == 0
        assert row.expires_at is None
        assert row.note == "cli test default"
        assert row.revoked_at is None
    finally:
        db.close()


def test_mint_invite_with_uses_and_days_and_note():
    result = _run_cli("mint-invite", "--uses", "5", "--days", "7", "--note", "beta testers")
    assert result.returncode == 0, result.stderr

    code = _extract_code(result.stdout)
    invite_id = _extract_id(result.stdout)

    db = SessionLocal()
    try:
        row = crud.get_invite_code(db, invite_id)
        assert row.code_hash == _hash(code)
        assert row.max_uses == 5
        assert row.note == "beta testers"
        assert row.expires_at is not None
        expected = datetime.utcnow() + timedelta(days=7)
        assert abs((row.expires_at - expected).total_seconds()) < 60
    finally:
        db.close()


def test_mint_invite_rejects_uses_below_one():
    result = _run_cli("mint-invite", "--uses", "0")
    assert result.returncode != 0
    assert "Traceback" not in result.stderr


def test_mint_invite_two_calls_produce_different_codes_and_different_hashes():
    """明文用 secrets.token_urlsafe 產生，兩次呼叫不該撞碼 (機率上不可能，但
    順便驗證 CLI 真的每次都重新產生，而不是回傳固定值)。"""
    first = _extract_code(_run_cli("mint-invite").stdout)
    second = _extract_code(_run_cli("mint-invite").stdout)
    assert first != second
    assert _hash(first) != _hash(second)


# --- list-invites ------------------------------------------------------------

def test_list_invites_shows_id_note_used_max_expires_revoked_but_never_the_code_or_hash():
    mint_result = _run_cli("mint-invite", "--uses", "3", "--note", "list-test-marker-abc")
    code = _extract_code(mint_result.stdout)
    invite_id = _extract_id(mint_result.stdout)
    code_hash = _hash(code)

    result = _run_cli("list-invites")
    assert result.returncode == 0, result.stderr

    assert f"[{invite_id}]" in result.stdout
    assert "list-test-marker-abc" in result.stdout
    assert "0/3" in result.stdout

    # 絕不洩漏明文或雜湊 (brief: never the hash preimage；明文本來就沒被存，
    # 這裡額外確保連 code_hash 欄位本身都不在輸出欄位清單內)
    assert code not in result.stdout
    assert code_hash not in result.stdout


def test_list_invites_with_no_codes_does_not_crash():
    """獨立跑一個全新的隔離環境會更乾淨，但這裡的重點只是「沒有任何邀請碼時
    不要 crash」，用目前這個共用的測試資料庫即可 (可能已有其他測試留下的列，
    因此不斷言輸出為空，只斷言正常結束)。"""
    result = _run_cli("list-invites")
    assert result.returncode == 0, result.stderr
    assert "Traceback" not in result.stderr


# --- revoke-invite -----------------------------------------------------------

def test_revoke_invite_sets_revoked_at():
    invite_id = _extract_id(_run_cli("mint-invite").stdout)

    result = _run_cli("revoke-invite", str(invite_id))
    assert result.returncode == 0, result.stderr

    db = SessionLocal()
    try:
        row = crud.get_invite_code(db, invite_id)
        assert row.revoked_at is not None
    finally:
        db.close()

    listed = _run_cli("list-invites")
    assert f"[{invite_id}]" in listed.stdout
    # 這一列要顯示成已撤銷 (不斷言精確措辭，只確認不是「否/no」那種未撤銷標記
    # 出現在同一列——用最直接的方式：撈出該列所在行，確認 revoked 相關欄位有值)
    line = next(l for l in listed.stdout.splitlines() if l.startswith(f"[{invite_id}]"))
    assert "revoked=yes" in line or "revoked=是" in line


def test_revoke_invite_is_idempotent():
    invite_id = _extract_id(_run_cli("mint-invite").stdout)

    first = _run_cli("revoke-invite", str(invite_id))
    assert first.returncode == 0

    db = SessionLocal()
    try:
        revoked_at_first = crud.get_invite_code(db, invite_id).revoked_at
    finally:
        db.close()

    second = _run_cli("revoke-invite", str(invite_id))
    assert second.returncode == 0, second.stderr

    db = SessionLocal()
    try:
        assert crud.get_invite_code(db, invite_id).revoked_at == revoked_at_first
    finally:
        db.close()


def test_revoke_invite_unknown_id_fails_cleanly():
    result = _run_cli("revoke-invite", "999999999")
    assert result.returncode != 0
    assert "Traceback" not in result.stderr
