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
from pydantic import BaseModel, Field
from datetime import datetime, timedelta

import logging
import uuid

from api.deps import get_db, get_current_user, get_current_token_data, get_language, get_llm_config
from api.schemas import CompanionSettingsIn, OnboardingAnswerIn
from middleware import rate_limit
from utils.api_exceptions import BadRequestError, NotFoundError, UnauthorizedError, ForbiddenError
from utils.error_codes import ErrorCode
from utils.messages import msg
from utils.password_validator import validate_password_and_get_errors
from utils.invite_codes import hash_invite_code
from database import crud, db_session
from database.models import User
from providers.factory import KNOWN_PROVIDERS
from providers.base import LLMConfig
from services import llm_credential_service
from utils.security import (
    TokenData,
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    verify_password,
    get_password_hash,
)
from config import ACCESS_TOKEN_MINUTES, REFRESH_TOKEN_DAYS
# REQUIRE_INVITE 特意不走 `from config import REQUIRE_INVITE`：那樣會在本模組
# import 當下把值綁死，測試無法用 monkeypatch 逐案切換。改成 `import config`
# 後在 create_user() 內以 config.REQUIRE_INVITE 讀「請求當下」的模組屬性
# (global-constraints / task-1.4-brief 明確要求的讀法)。
import config

router = APIRouter()
logger = logging.getLogger(__name__)

class UserCreate(BaseModel):
    username: str
    password: str
    # 僅在 config.REQUIRE_INVITE 開啟時才會被檢查；旗標關閉時整個欄位被忽略
    # (v2.3 task 1.4，預設關閉 —— Electron 本機首次啟動流程不受影響)
    invite_code: Optional[str] = None

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


class LLMCredentialIn(BaseModel):
    """PUT /users/me/llm 的請求 body (v2.3 task 1.6)。

    長度上限只是防呆／防止把資料庫塞爆，真正的合法性由路由層檢查
    (供應商是否認得、local 是否有 Base URL 與模型名稱)。
    """
    # 上限刻意比欄位的 20 字元寬鬆：打錯的供應商名稱要走路由層那句雙語的
    # 400 (「不支援的 AI 供應商」)，而不是 Pydantic 的 422 驗證錯誤
    provider: str = Field(max_length=50)
    api_key: str = Field(default="", max_length=500)
    base_url: Optional[str] = Field(default=None, max_length=255)
    model: Optional[str] = Field(default=None, max_length=80)


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
    """創建新用戶

    邀請碼閘門 (v2.3 task 1.4，僅 config.REQUIRE_INVITE 開啟時生效)：
    先「驗證但不消費」(找不到/已撤銷/已過期/已用完一律回同一句話，不當
    oracle 洩漏具體原因) → 建立使用者 → 才真正以條件式 UPDATE 認領一次
    名額。認領失敗代表輸掉了「最後一個名額」的競態 (驗證當下還有名額，
    認領當下已被別的請求搶走)：必須刪掉剛剛建立的帳號，不留下「帳號建立
    了但邀請碼沒被扣」的孤兒帳號。順序反過來 (先建帳號再驗證) 的話，
    使用者名稱重複／密碼強度不足這類「建立本來就會失敗」的請求會在驗證
    通過後才發現失敗，等於平白燒掉一次邀請額度。
    """
    invite = None
    if config.REQUIRE_INVITE:
        code = (user.invite_code or "").strip()
        if not code:
            raise BadRequestError(
                error_code=ErrorCode.INVITE_CODE_REQUIRED,
                detail=msg("invite_code_required", lang)
            )
        invite = crud.get_invite_code_by_hash(db, hash_invite_code(code))
        if invite is None or not crud.invite_code_is_usable(invite):
            raise BadRequestError(
                error_code=ErrorCode.INVITE_CODE_INVALID,
                detail=msg("invite_code_invalid", lang)
            )

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

    if invite is not None and not crud.claim_invite_code_use(db, invite.id):
        # 輸掉了「最後一個名額」的競態：補償刪除，不能超用、也不能留孤兒帳號
        crud.delete_user(db, new_user.id)
        raise BadRequestError(
            error_code=ErrorCode.INVITE_CODE_INVALID,
            detail=msg("invite_code_invalid", lang)
        )

    return {"message": "User created", "user_id": new_user.id, "username": new_user.username}

@router.post("/login", response_model=Token,
            summary="用戶登入",
            description="驗證用戶憑證並返回訪問令牌和刷新令牌")
async def login(form_data: OAuth2PasswordRequestForm = Depends(),
                db: Session = Depends(get_db),
                lang: str = Depends(get_language),
                user_agent: Optional[str] = Header(None)):
    """用戶登入並獲取訪問令牌"""
    # 速率限制 (v2.3 task 1.5)：先查有沒有被鎖定，鎖定的話直接 429，
    # 連查詢使用者、算 bcrypt 的成本都省下來。用「請求附上的原始字串」
    # 當鍵，不先判斷帳號存不存在——鎖定行為必須跟帳號是否存在無關，
    # 否則「多快被鎖定」本身就變成能拿來探測帳號是否存在的側路。
    rate_limit.check_username_lockout(form_data.username, lang)

    # 查詢用戶
    user = crud.get_user_by_username(db, form_data.username)
    if not user:
        rate_limit.record_login_failure(form_data.username)
        raise UnauthorizedError(
            error_code=ErrorCode.UNAUTHORIZED,
            detail=msg("invalid_credentials", lang)
        )

    # 驗證密碼（bcrypt + pepper，見 utils/security）
    if not user.password_hash:
        # 加密碼欄位之前建立的舊帳號 —— 不能無條件放行
        rate_limit.record_login_failure(form_data.username)
        raise UnauthorizedError(
            error_code=ErrorCode.UNAUTHORIZED,
            detail=msg("account_has_no_password", lang)
        )
    if not verify_password(form_data.password, user.password_hash):
        rate_limit.record_login_failure(form_data.username)
        raise UnauthorizedError(
            error_code=ErrorCode.UNAUTHORIZED,
            detail=msg("invalid_credentials", lang)
        )

    # 登入成功：清掉這個使用者名稱先前累積的失敗次數，重新給滿鎖定額度
    rate_limit.record_login_success(form_data.username)

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


# --- 陪伴者客製化設定 (v2.4 spec ①：companion_name/user_nickname/style_*) ---
# 註冊順序同樣要在 /{user_id} 之前 (見上面 /sessions 的說明)。

def _companion_payload(user) -> Dict[str, Any]:
    return {
        "companion_name": user.companion_name or None,
        "user_nickname": user.user_nickname or None,
        "style_reply_length": user.style_reply_length or None,
        "style_emoji": user.style_emoji or None,
        "style_formality": user.style_formality or None,
    }


@router.get("/me/companion", response_model=Dict[str, Any],
            summary="查詢陪伴者客製化設定")
def get_my_companion(current_user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    user = db.query(User).filter_by(id=current_user.id).first()
    return _companion_payload(user)


@router.put("/me/companion", response_model=Dict[str, Any],
            summary="儲存陪伴者客製化設定",
            description="部分更新：未出現的欄位維持原值；送空字串＝清空該欄")
def put_my_companion(payload: CompanionSettingsIn,
                     current_user: User = Depends(get_current_user),
                     db: Session = Depends(get_db),
                     lang: str = Depends(get_language)):
    user = db.query(User).filter_by(id=current_user.id).first()
    data = payload.model_dump(exclude_unset=True)
    column_map = {
        "companion_name": "companion_name", "user_nickname": "user_nickname",
        "style_reply_length": "style_reply_length",
        "style_emoji": "style_emoji", "style_formality": "style_formality"}
    for field, column in column_map.items():
        if field in data:
            value = data[field]
            if isinstance(value, str):
                value = value.strip() or None  # 空字串＝清空
            setattr(user, column, value)
    db.commit()
    return {"message": msg("companion_saved", lang), **_companion_payload(user)}


# --- Onboarding 初次見面 (v2.5 Spec B) ---
# 註冊順序同樣要在 /{user_id} 之前 (見上面 /sessions 的說明——"onboarding"
# 會被 /{user_id} 的 int 轉型接走然後 422)。

@router.get("/onboarding/state", response_model=Dict[str, Any],
            summary="查詢 onboarding 狀態",
            description="回報是否已完成初次見面，以及已作答（含空字串跳過）的題目 key")
def get_onboarding_state(current_user: User = Depends(get_current_user),
                         db: Session = Depends(get_db)):
    answers = crud.get_onboarding_answers(db, current_user.id)
    return {"completed": current_user.onboarding_completed_at is not None,
            "answered_keys": [a.question_key for a in answers]}


@router.post("/onboarding/answer", response_model=Dict[str, Any],
             summary="儲存一題 onboarding 答案",
             description="逐題 upsert；空字串＝跳過（續跑不重問）。白名單外或超長回 422")
def save_onboarding_answer(payload: OnboardingAnswerIn,
                           current_user: User = Depends(get_current_user),
                           db: Session = Depends(get_db)):
    row = crud.upsert_onboarding_answer(db, current_user.id,
                                        payload.question_key, payload.answer_text)
    return {"saved": True, "question_key": row.question_key}


@router.post("/onboarding/complete", response_model=Dict[str, Any],
             summary="完成 onboarding",
             description="設完成戳記（冪等），並盡力把答案收納進長期記憶（無金鑰時靜默跳過）")
def complete_onboarding(current_user: User = Depends(get_current_user),
                        llm_config: Optional[LLMConfig] = Depends(get_llm_config),
                        lang: str = Depends(get_language)):
    """連線紀律比照 diary.py 的 update_interaction_notes：本路由不掛 get_db，
    寫入走自己的短交易，LLM 呼叫期間不持有工作用 session。"""
    with db_session() as db:
        user = crud.get_user(db, current_user.id)
        if user.onboarding_completed_at is None:
            user.onboarding_completed_at = datetime.utcnow()
            db.commit()
        has_material = bool(crud.get_uningested_onboarding_answers(db, current_user.id))

    review = None
    if has_material:
        try:
            from services.memory_review import run_review_pass
            review = run_review_pass(current_user.id, llm_config, lang=lang,
                                     source="onboarding")
        except Exception as e:  # 收納是 best-effort：任何失敗都不擋 complete
            logger.warning(f"onboarding 收納略過 (user_id={current_user.id}): {e}")

    return {"completed": True,
            "memory_review": review.as_dict() if review else None}


# --- 個人 LLM 金鑰 (v2.3 task 1.6：手機瀏覽器沒有 safeStorage，金鑰改存伺服器) ---
# 註冊順序同樣要在 /{user_id} 之前 (見上面 /sessions 的說明)。這三個端點
# **永遠不回傳明文金鑰，也不回傳密文**，只回最後 4 碼的遮罩。

@router.get("/me/llm", response_model=Dict[str, Any],
            summary="查詢目前生效的 AI 金鑰設定",
            description="回報這個帳號在不帶 X-LLM-* 標頭時會用到哪一組設定（永遠不含金鑰明文）")
def get_my_llm_credential(current_user: User = Depends(get_current_user)):
    """目前生效的 LLM 設定與來源 (user / server / env / 無)。"""
    return llm_credential_service.describe_for_user(current_user.id)


@router.put("/me/llm", response_model=Dict[str, Any],
            summary="儲存個人 AI 金鑰",
            description="以伺服器金鑰加密後儲存；同一個帳號只保留一組（重複呼叫會取代舊的）")
def put_my_llm_credential(payload: LLMCredentialIn,
                          current_user: User = Depends(get_current_user),
                          lang: str = Depends(get_language)):
    """設定這個帳號的 LLM 憑證。

    先驗證再寫入：供應商名稱要認得 (打錯的話等到真的呼叫模型才報錯就太晚了)、
    local 端點要有 Base URL 與模型名稱 (否則存進去的是一組永遠不能用的設定)。
    """
    provider = (payload.provider or "").strip().lower()
    api_key = (payload.api_key or "").strip()
    base_url = (payload.base_url or "").strip()
    model = (payload.model or "").strip()

    if not llm_credential_service.is_known_provider(provider):
        raise BadRequestError(
            error_code=ErrorCode.INVALID_INPUT,
            detail=msg("llm_unknown_provider", lang, provider=payload.provider,
                       providers=" / ".join(KNOWN_PROVIDERS))
        )

    if provider == "local":
        # 本地端點通常不驗金鑰，但沒有 Base URL / 模型名稱就一定跑不起來
        if not base_url:
            raise BadRequestError(error_code=ErrorCode.INVALID_INPUT,
                                  detail=msg("llm_base_url_required", lang))
        if not model:
            raise BadRequestError(error_code=ErrorCode.INVALID_INPUT,
                                  detail=msg("llm_model_required", lang))
    elif not api_key:
        raise BadRequestError(error_code=ErrorCode.INVALID_INPUT,
                              detail=msg("llm_key_required", lang))

    llm_credential_service.store_credential(
        user_id=current_user.id, provider=provider, api_key=api_key,
        base_url=base_url, model=model)

    return {"message": msg("llm_credential_saved", lang),
            **llm_credential_service.describe_for_user(current_user.id)}


@router.delete("/me/llm", response_model=Dict[str, Any],
               summary="刪除個人 AI 金鑰",
               description="刪除這個帳號存在伺服器上的金鑰（之後回退到伺服器預設或 .env 後備）")
def delete_my_llm_credential(current_user: User = Depends(get_current_user),
                             lang: str = Depends(get_language)):
    """刪除自己的憑證 (冪等；不會動到伺服器預設那一列)。"""
    llm_credential_service.delete_user_credential(current_user.id)
    return {"message": msg("llm_credential_deleted", lang),
            **llm_credential_service.describe_for_user(current_user.id)}


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
