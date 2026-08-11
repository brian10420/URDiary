"""使用者與認證端點。

v2.3 認證強化的工作階段模型 (見 database/models.AuthSession)：

    登入 ──► 建立工作階段列 (refresh_jti = J1)
            回傳 access(sid=J1, 30 分鐘) + refresh(jti=J1, 30 天)

    刷新 ──► 以 J1 找到那一列
            ├─ 已撤銷 或 已有 replaced_by_jti → **重用偵測**：
            │  該使用者全部工作階段一起撤銷，回 401
            ├─ expires_at 已過 → 401
            └─ 否則輪替：舊列 replaced_by_jti = J2、插入 J2 新列，
               回傳 access(sid=J2) + refresh(jti=J2)

    登出 ──► 用訪問令牌的 sid 找到那條鏈，整條撤銷

已知取捨：訪問令牌是無狀態的，撤銷後它仍會活到 exp 為止 ——
最壞延遲 = URDIARY_ACCESS_TOKEN_MINUTES (預設 30 分鐘)。刷新令牌則是
即時失效，所以被撤銷的裝置最多再撐 30 分鐘就完全出局。
"""
from fastapi import APIRouter, Depends, Header
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from datetime import datetime, timedelta

import uuid

from api.deps import get_db, get_current_user, get_current_token_data, get_language
from utils.api_exceptions import BadRequestError, NotFoundError, UnauthorizedError, ForbiddenError
from utils.error_codes import ErrorCode
from utils.messages import msg
from utils.password_validator import validate_password_and_get_errors
from database import crud
from database.models import User
from utils.security import (
    TokenData,
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    verify_password,
    get_password_hash,
)
from config import ACCESS_TOKEN_MINUTES, REFRESH_TOKEN_DAYS

router = APIRouter()

class UserCreate(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str
    expires_in: int
    user_id: int
    username: str

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str
    expires_in: int

class RefreshTokenRequest(BaseModel):
    refresh_token: Optional[str] = None


# --- 工作階段輔助 -------------------------------------------------------------

def _access_expires_in() -> int:
    return ACCESS_TOKEN_MINUTES * 60


def _device_label_from_user_agent(user_agent: Optional[str]) -> Optional[str]:
    """從 User-Agent 猜一個「人看得懂」的裝置名稱 (猜不出來就回 None)。

    刻意只認幾個常見組合、不引第三方 UA 解析套件：這個值只是裝置清單上
    的顯示字串，認不出來時前端會退回顯示原始 User-Agent。
    """
    if not user_agent:
        return None
    ua = user_agent.lower()

    if "urdiary" in ua:
        return "URDiary App"

    browser = next((name for token, name in (
        ("edg/", "Edge"), ("opr/", "Opera"), ("firefox", "Firefox"),
        ("chrome", "Chrome"), ("safari", "Safari"),
    ) if token in ua), None)
    platform = next((name for token, name in (
        ("iphone", "iPhone"), ("ipad", "iPad"), ("android", "Android"),
        ("windows", "Windows"), ("mac os", "macOS"), ("linux", "Linux"),
    ) if token in ua), None)

    if browser and platform:
        return f"{browser} · {platform}"
    return browser or platform


def _mint_pair(user: User, jti: str, session_expires_at: datetime):
    """簽發同屬一個工作階段的 access + refresh 令牌。

    access 的 sid 帶著本工作階段的 refresh_jti，登出與裝置清單才認得出
    「這個請求是哪一台裝置」。refresh 的 exp 對齊工作階段列的 expires_at，
    令牌不會宣稱自己比工作階段活得久 (輪替不延長總壽命)。
    """
    refresh = create_refresh_token(
        data={"sub": user.username, "id": user.id},
        jti=jti,
        expires_delta=session_expires_at - datetime.utcnow(),
    )
    access = create_access_token(
        data={"sub": user.username, "id": user.id},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_MINUTES),
        sid=jti,
    )
    return access, refresh


def _session_out(session, current_sid: Optional[str]) -> Dict[str, Any]:
    """裝置清單的輸出形狀。**絕不外洩 refresh_jti** —— 它等同令牌識別碼。"""
    return {
        "id": session.id,
        "device_label": session.device_label,
        "user_agent": session.user_agent,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "last_used_at": session.last_used_at.isoformat() if session.last_used_at else None,
        "expires_at": session.expires_at.isoformat() if session.expires_at else None,
        "is_current": bool(current_sid) and session.refresh_jti == current_sid,
    }


@router.post("/create", response_model=Dict[str, Any],
            summary="創建新用戶",
            description="創建新用戶（密碼經強度檢查與 bcrypt 雜湊後儲存）並返回用戶ID和用戶名")
def create_user(user: UserCreate, db: Session = Depends(get_db),
                lang: str = Depends(get_language)):
    """創建新用戶"""
    existing_user = crud.get_user_by_username(db, user.username)
    if existing_user:
        raise BadRequestError(
            error_code=ErrorCode.USER_ALREADY_EXISTS,
            detail=msg("username_taken", lang)
        )

    password_errors = validate_password_and_get_errors(user.password, lang)
    if password_errors:
        separator = "；" if lang == "zh-TW" else "; "
        raise BadRequestError(
            error_code=ErrorCode.INVALID_INPUT,
            detail=msg("password_too_weak", lang, reasons=separator.join(password_errors))
        )

    new_user = crud.create_user(db, user.username, get_password_hash(user.password))
    return {"message": "User created", "user_id": new_user.id, "username": new_user.username}

@router.post("/login", response_model=Token,
            summary="用戶登入",
            description="驗證用戶憑證並返回訪問令牌和刷新令牌")
async def login(form_data: OAuth2PasswordRequestForm = Depends(),
                db: Session = Depends(get_db),
                lang: str = Depends(get_language),
                user_agent: Optional[str] = Header(None)):
    """用戶登入並獲取訪問令牌"""
    # 查詢用戶
    user = crud.get_user_by_username(db, form_data.username)
    if not user:
        raise UnauthorizedError(
            error_code=ErrorCode.UNAUTHORIZED,
            detail=msg("invalid_credentials", lang)
        )

    # 驗證密碼（bcrypt + pepper，見 utils/security）
    if not user.password_hash:
        # 加密碼欄位之前建立的舊帳號 —— 不能無條件放行
        raise UnauthorizedError(
            error_code=ErrorCode.UNAUTHORIZED,
            detail=msg("account_has_no_password", lang)
        )
    if not verify_password(form_data.password, user.password_hash):
        raise UnauthorizedError(
            error_code=ErrorCode.UNAUTHORIZED,
            detail=msg("invalid_credentials", lang)
        )

    jti = str(uuid.uuid4())
    expires_at = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_DAYS)
    crud.create_auth_session(
        db,
        user_id=user.id,
        refresh_jti=jti,
        expires_at=expires_at,
        device_label=_device_label_from_user_agent(user_agent),
        user_agent=(user_agent or "")[:255] or None,
    )
    access_token, refresh_token = _mint_pair(user, jti, expires_at)

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": _access_expires_in(),
        "user_id": user.id,
        "username": user.username
    }

@router.post("/token/refresh", response_model=TokenResponse,
           summary="刷新訪問令牌",
           description="以刷新令牌換一對新的訪問／刷新令牌（每次使用都會輪替）")
async def refresh_token(
    authorization: Optional[str] = Header(None),
    refresh_request: Optional[RefreshTokenRequest] = None,
    db: Session = Depends(get_db),
    lang: str = Depends(get_language),
    user_agent: Optional[str] = Header(None),
):
    """輪替刷新令牌並換發新的訪問令牌。

    只接受 type=refresh 且**尚未過期**的令牌。舊版「過期的訪問令牌也能來
    換新的」是無限滑動視窗：只要偷到任何一張訪問令牌，就能永遠續下去。
    """
    # 請求主體優先：客戶端多半會固定附上 Authorization (訪問令牌)，
    # 刷新令牌走 body 才不會被那張訪問令牌蓋掉。
    current_token = None
    if refresh_request and refresh_request.refresh_token:
        current_token = refresh_request.refresh_token
    elif authorization and authorization.startswith("Bearer "):
        current_token = authorization[7:]

    if not current_token:
        raise UnauthorizedError(
            error_code=ErrorCode.UNAUTHORIZED,
            detail=msg("token_missing", lang)
        )

    invalid = UnauthorizedError(
        error_code=ErrorCode.UNAUTHORIZED,
        detail=msg("refresh_token_invalid", lang)
    )

    # 簽章／有效期／iss／type 任何一項不過就是無效，錯誤原因不外洩
    payload = decode_refresh_token(current_token)
    if payload is None:
        raise invalid

    session = crud.get_auth_session_by_jti(db, payload["jti"])
    if session is None:
        raise invalid

    # 重用偵測：已撤銷或已被輪替過的令牌又出現 = 有人手上握著舊令牌副本。
    # 無法分辨是使用者還是攻擊者，所以整個帳號的工作階段一起清掉。
    if session.revoked_at is not None or session.replaced_by_jti is not None:
        crud.revoke_all_user_auth_sessions(db, session.user_id)
        raise UnauthorizedError(
            error_code=ErrorCode.UNAUTHORIZED,
            detail=msg("refresh_token_reused", lang)
        )

    # 工作階段列自己的有效期：即使 JWT 還沒過期也一樣算數
    if session.expires_at <= datetime.utcnow():
        raise invalid

    user = crud.get_user(db, user_id=session.user_id)
    if user is None:
        raise NotFoundError(
            error_code=ErrorCode.USER_NOT_FOUND,
            detail=msg("user_not_found", lang)
        )

    # 舊列的欄位在 claim (bulk UPDATE + commit) 之後會被 expire 掉，先讀起來
    new_jti = str(uuid.uuid4())
    original_created_at = session.created_at
    session_expires_at = session.expires_at
    previous_label = session.device_label
    previous_user_agent = session.user_agent

    # 先以條件式 UPDATE 認領輪替，成功了才簽新令牌
    if not crud.claim_auth_session_rotation(db, session.id, new_jti):
        # 輸掉微秒級的競態 ≠ 令牌外洩。走到這裡代表查表當下這一列還是乾淨的
        # (沒撤銷、沒輪替)，只是另一個請求在這幾微秒內先認領走了 —— 合法
        # 客戶端同時送出兩個刷新請求就會這樣。單純回 401 讓對方改用贏家換到
        # 的令牌，**不撤銷任何東西**：把它當重用處理的話，客戶端一個併發
        # bug 就會把使用者所有裝置踢下線 (含剛剛贏得輪替的那一個)。
        # 真正的重用偵測在上面的查表階段，那裡才有「舊令牌又冒出來」的證據。
        raise invalid

    crud.create_auth_session(
        db,
        user_id=user.id,
        refresh_jti=new_jti,
        # 輪替不延長工作階段總壽命：沿用原本的到期時間，否則只要一直刷新
        # 就永遠不會過期，等於又變回無限滑動視窗
        expires_at=session_expires_at,
        # 裝置資訊沿用登入當時的，除非這次請求帶了新的 User-Agent
        device_label=_device_label_from_user_agent(user_agent) or previous_label,
        user_agent=((user_agent or "")[:255] or previous_user_agent),
        created_at=original_created_at,  # 裝置清單顯示的是「何時登入」
    )

    access_token, new_refresh_token = _mint_pair(user, new_jti, session_expires_at)

    return {
        "access_token": access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer",
        "expires_in": _access_expires_in(),
    }


@router.post("/logout", response_model=Dict[str, Any],
             summary="登出目前裝置",
             description="撤銷目前這個工作階段（其刷新令牌立即失效）")
async def logout(current_user: User = Depends(get_current_user),
                 token_data: TokenData = Depends(get_current_token_data),
                 db: Session = Depends(get_db),
                 lang: str = Depends(get_language)):
    """撤銷目前訪問令牌所屬的工作階段。

    訪問令牌可能是輪替前簽發的 (sid 指向鏈中間的舊列)，所以撤整條鏈，
    否則鏈尾那個還活著的工作階段會逃掉。
    """
    if token_data.sid:
        session = crud.get_auth_session_by_jti(db, token_data.sid)
        # 只能撤自己的工作階段 (sid 已由簽章保護，這裡是縱深防禦)
        if session is not None and session.user_id == current_user.id:
            crud.revoke_auth_session_chain(db, session)

    return {"message": msg("logged_out", lang)}


# 注意：/sessions 必須註冊在 /{user_id} 之前。Starlette 依註冊順序
# first-match-wins，先掛 /{user_id} 的話 GET /users/sessions 會被它接走，
# 然後因為 user_id: int 轉型失敗回 422。
@router.get("/sessions", response_model=List[Dict[str, Any]],
            summary="列出已登入的裝置",
            description="列出目前有效的工作階段（每台裝置一列，含目前這台的標記）")
async def list_sessions(current_user: User = Depends(get_current_user),
                        token_data: TokenData = Depends(get_current_token_data),
                        db: Session = Depends(get_db)):
    """列出目前使用者還活著的工作階段"""
    sessions = crud.list_active_auth_sessions(db, current_user.id)
    return [_session_out(s, token_data.sid) for s in sessions]


@router.delete("/sessions/{session_id}", response_model=Dict[str, Any],
               summary="撤銷指定裝置",
               description="撤銷某一台裝置的登入狀態（別人的工作階段回 404）")
async def revoke_session(session_id: int,
                         current_user: User = Depends(get_current_user),
                         db: Session = Depends(get_db),
                         lang: str = Depends(get_language)):
    """撤銷指定的工作階段"""
    session = crud.get_auth_session(db, session_id)
    # 別人的工作階段一律回 404（與其他單一資源端點一致，不透露它存在）
    if session is None or session.user_id != current_user.id:
        raise NotFoundError(
            error_code=ErrorCode.RESOURCE_NOT_FOUND,
            detail=msg("session_not_found", lang)
        )

    crud.revoke_auth_session_chain(db, session)
    return {"message": msg("session_revoked", lang)}


@router.get("/{user_id}", response_model=Dict[str, Any],
           summary="獲取用戶資訊",
           description="獲取自己的用戶詳細資訊（需認證，僅能查詢自己）")
def get_user(user_id: int, current_user: User = Depends(get_current_user),
             lang: str = Depends(get_language)):
    """獲取用戶資訊（僅限本人）"""
    if user_id != current_user.id:
        raise ForbiddenError(
            error_code=ErrorCode.FORBIDDEN,
            detail=msg("forbidden_user", lang)
        )
    return {
        "user_id": current_user.id,
        "username": current_user.username,
        "created_at": current_user.created_at.isoformat()
    }

@router.get("/", response_model=List[Dict[str, Any]],
          summary="獲取目前登入的用戶",
          description="不再無認證列出全部使用者；僅回傳目前登入者（本機 profile 清單由前端維護）")
def get_users(current_user: User = Depends(get_current_user)):
    """獲取用戶列表（僅回傳目前登入者，避免洩漏其他帳號）"""
    return [{
        "user_id": current_user.id,
        "username": current_user.username,
        "created_at": current_user.created_at.isoformat()
    }]

# 简单令牌获取端点，用于 OAuth2PasswordBearer
@router.post("/token", response_model=Token)
async def get_token(form_data: OAuth2PasswordRequestForm = Depends(),
                    db: Session = Depends(get_db),
                    lang: str = Depends(get_language),
                    user_agent: Optional[str] = Header(None)):
    """获取访问令牌 - 与login端点功能相同，但符合OAuth2标准"""
    return await login(form_data, db, lang, user_agent)
