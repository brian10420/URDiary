#!/usr/bin/env python3
"""URDiary 管理 CLI —— 邀請碼管理 (v2.3 task 1.4)。

對外開放 (tunnel) 前的安全閘門一半：`URDIARY_REQUIRE_INVITE=1` 開啟後，
/users/create 會要求一組有效邀請碼。這支 CLI 是唯一的邀請碼管理入口
(YAGNI：沒有對應的管理 UI)，只給有 shell 存取權的伺服器擁有者使用。

用法 (在 repo 根目錄執行；venv 路徑依安裝方式調整)：

    .venv/bin/python backend/scripts/urdiary_admin.py mint-invite --uses 5 --days 30 --note "beta 使用者"
    .venv/bin/python backend/scripts/urdiary_admin.py list-invites
    .venv/bin/python backend/scripts/urdiary_admin.py revoke-invite 3

也可以先 cd 進 backend/ 再用相對路徑執行 (./start-backend.sh 用的就是
這個習慣)：

    cd backend && ../.venv/bin/python scripts/urdiary_admin.py list-invites

讀寫哪個資料庫：由 config.py 的 URDIARY_DATA_DIR 環境變數決定 (未設定時
是 repo 根目錄的 data/)，與後端伺服器完全相同的規則 —— 這支 CLI 不接受
另外指定資料庫路徑的參數，需要對別的資料庫操作時改設該環境變數即可
(測試套件正是這樣做到隔離：conftest.py 在任何 app 模組 import 之前就把
URDIARY_DATA_DIR 設成臨時目錄，子行程會繼承這個環境變數)。

明文邀請碼只有 mint-invite 當下會印出一次：資料庫只存 sha256 雜湊
(utils/invite_codes.hash_invite_code)，之後任何指令 (包含 list-invites)
都無法、也不會再顯示明文。
"""
import argparse
import secrets
import sys
from datetime import datetime, timedelta
from pathlib import Path

# 本專案 app/ 內部一律用「扁平」匯入 (例如 `import config`、
# `from database import SessionLocal`，不帶 app. 前綴)；backend/tests/conftest.py
# 用同一招把 app/ 插進 sys.path。這裡在匯入任何 app 模組之前先做一樣的事，
# 這支腳本才能不靠任何套件安裝、直接以檔案路徑執行。
_APP_DIR = Path(__file__).resolve().parent.parent / "app"
sys.path.insert(0, str(_APP_DIR))

from database import SessionLocal, engine       # noqa: E402
from database.models import Base                 # noqa: E402
import database.crud as crud                      # noqa: E402
from utils.invite_codes import hash_invite_code   # noqa: E402


def _format_expiry(expires_at):
    return expires_at.isoformat() if expires_at else "永不過期"


def cmd_mint_invite(args, db) -> int:
    if args.uses < 1:
        print("錯誤：--uses 必須至少為 1", file=sys.stderr)
        return 1
    if args.days is not None and args.days < 1:
        print("錯誤：--days 必須至少為 1", file=sys.stderr)
        return 1

    code = secrets.token_urlsafe(16)  # 約 128 bits 熵，純隨機、不重複使用
    expires_at = (datetime.utcnow() + timedelta(days=args.days)) if args.days else None

    invite = crud.create_invite_code(
        db,
        code_hash=hash_invite_code(code),
        max_uses=args.uses,
        note=args.note,
        expires_at=expires_at,
    )

    print(f"邀請碼已建立 (id={invite.id})")
    print(f"code: {code}")
    print(f"可用次數: {invite.max_uses}｜有效期限: {_format_expiry(invite.expires_at)}"
          f"｜備註: {invite.note or '(無)'}")
    print("注意：明文邀請碼只會顯示這一次，請立即複製保存；"
          "資料庫只存雜湊值，之後 (包含 list-invites) 都無法再次查出明文。")
    return 0


def cmd_list_invites(args, db) -> int:
    invites = crud.list_invite_codes(db)
    if not invites:
        print("目前沒有任何邀請碼。")
        return 0

    for inv in invites:
        note = inv.note if inv.note else "(無)"
        revoked = "yes" if inv.revoked_at is not None else "no"
        print(f"[{inv.id}] note={note} used={inv.used_count}/{inv.max_uses} "
              f"expires={_format_expiry(inv.expires_at)} revoked={revoked}")
    return 0


def cmd_revoke_invite(args, db) -> int:
    invite = crud.revoke_invite_code(db, args.invite_id)
    if invite is None:
        print(f"錯誤：找不到 id={args.invite_id} 的邀請碼", file=sys.stderr)
        return 1

    print(f"邀請碼 id={invite.id} 已撤銷 (revoked_at={invite.revoked_at.isoformat()})")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="urdiary_admin.py",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    mint = sub.add_parser("mint-invite", help="建立一組新的邀請碼，明文只在這裡顯示一次")
    mint.add_argument("--uses", type=int, default=1, help="可使用次數上限 (預設 1)")
    mint.add_argument("--days", type=int, default=None, help="幾天後過期 (預設不過期)")
    mint.add_argument("--note", type=str, default=None, help="備註，方便日後在 list-invites 辨識用途")

    sub.add_parser("list-invites", help="列出所有邀請碼 (id/備註/使用量/期限/是否撤銷；不含明文或雜湊)")

    revoke = sub.add_parser("revoke-invite", help="撤銷一組邀請碼，之後無法再用來註冊")
    revoke.add_argument("invite_id", type=int, help="邀請碼 id (見 list-invites 的 [id])")

    return parser


def main(argv=None) -> int:
    # 讓這支 CLI 可以在全新的資料目錄上獨立運作 (例如全新部署、DB 檔案還
    # 不存在時)，不必依賴先啟動過一次後端伺服器；冪等，與 main.py 的
    # startup 事件用同一招 (create_all 只補「不存在的表」)。
    Base.metadata.create_all(bind=engine)

    parser = build_parser()
    args = parser.parse_args(argv)

    db = SessionLocal()
    try:
        if args.command == "mint-invite":
            return cmd_mint_invite(args, db)
        if args.command == "list-invites":
            return cmd_list_invites(args, db)
        if args.command == "revoke-invite":
            return cmd_revoke_invite(args, db)
        parser.error(f"未知的子指令: {args.command}")  # pragma: no cover - argparse 已擋掉
        return 2
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
