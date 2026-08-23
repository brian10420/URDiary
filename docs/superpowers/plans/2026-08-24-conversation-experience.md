# 對話體驗（v2.5 Spec B）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 陪伴者長出人味（映照句式＋自我覺察收束＋主動追問＋few-shot 手感段），並以零 LLM 的前端腳本 onboarding 認識使用者——答案入庫、注入對話與 check-in、由 memory review pass 懶收納進長期記憶。

**Architecture:** 後端新表 `onboarding_answers`（upsert、空字串=跳過、`ingested_at` 收納戳記）＋三 API 掛 user 路由；注入走 C 已落地的 `services/user_profile.get_memory_context()`（raw 答案區塊附掛 profile_block／diary_context，呼叫端零改動）；收納比照 C 懶遷移模式（review pass 素材塊 `{onboarding_block}`＋成功後戳記，complete 時 best-effort 觸發一次）。前端 `onboarding_module.js` 純腳本驅動（thinking 延遲 util 進 ChatModule、chips 逃生口、逐題即存、不進聊天持久層）；persona/few-shot 為兩語純加法提示詞編輯。

**Tech Stack:** FastAPI + SQLAlchemy + SQLite、pydantic v2、vanilla JS（IIFE module）+ vitest、pytest。

**Spec:** `docs/superpowers/specs/2026-08-22-conversation-experience-design.md`（**§7 接縫重審補記為 §5 的現碼修正，優先於 §5 原文**）

## Global Constraints

- **提示詞加法鐵律**：`persona_core.txt` 與 `conversation_prompt.txt`（兩語共四檔）只加不刪不改——出貨前 `git diff --numstat` 這四檔的刪除數必須為 0。`memory_review_prompt.txt` 僅允許在素材鏈那一行插入 `{onboarding_block}`（spec §7-5 明文豁免）。
- **禁詞 grep**：每寫入一段新例句/新文案，先 grep 兩語 persona_core 的【禁止的句式】清單（zh：至少你還／往好處想／別想太多／一切都會好的／你應該要／加油；en：At least you still／Look on the bright side／Don't overthink it／Everything will be fine／You should／Cheer up）。自動化測試只掃 few-shot 段（全檔會誤報——清單本身就含這些詞）。
- **花括號**：`conversation_prompt.txt` 走 `.format()`——few-shot 段全文禁用 `{` `}`；改動後必跑兩語 format smoke。
- **onboarding 零 LLM 零金鑰**：前端腳本全程不呼叫任何 LLM API；complete 的收納是 best-effort（無金鑰/失敗靜默跳過），**絕不能讓 complete 失敗**。
- **不進持久層**：onboarding 的腳本訊息與使用者答案不寫 `chat_messages`、不進前端 `chatHistory` 陣列/`saveChatHistory`——重載不重演。
- **連線鐵律**：DB session 絕不跨越 LLM 呼叫；帶 LLM 的路由不掛 `Depends(get_db)`，寫入走自己的 `db_session()` 短交易（先例 `api/routes/diary.py:337` `update_interaction_notes`）。
- **兩語同步**：提示詞、i18n 鍵一律 zh-TW＋en 成對；兩語 few-shot／onboarding 文案各自原生撰寫同場景，不逐字互譯。
- **延遲鉤子（硬需求）**：思考延遲取值走 `ChatModule.setScriptDelayRange(min,max)` 測試鉤子；正式碼預設 1000–3000ms，只適用腳本/靜態訊息，真實 LLM 回覆不加。
- **新欄位一律 nullable**（`schema_upgrade.ensure_schema` 限制；新表由 `create_all` 自動建）。
- **失敗不擋主流程**：答案儲存失敗、名字 PUT 失敗、收納失敗都只 `console.warn`/log，onboarding 流程與聊天照常。
- **測試指令**：後端 `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest tests/<file> -q`；前端 `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/<file>`。
- **mock_llm**：後端測試一律用 `tests/conftest.py` 的 `mock_llm` fixture（攔截 `llm.chat` 單點）＋`auth_header`＋`LLM_HEADERS`；絕不真打網路。注意 `mock_llm.fail()` 是「下一次呼叫必失敗」的優先覆寫，不是 FIFO。
- **Commit 風格**：`feat(對話體驗): <中文摘要>`，結尾附 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- **sw 慣例**：新增 shell 檔要進 `SHELL_ASSETS`；本 spec 修改既有 shell 檔（chat_module/api_service/i18n/index/css）→ 依 sw.js 註解的情境 (b) 必須 bump `CACHE_VERSION`（v2→v3，Task 11 統一做）。

## File Structure（檔案責任地圖）

**後端新建**：
- `backend/tests/test_onboarding_models.py` — Task 1（資料層）。
- `backend/tests/test_onboarding_api.py` — Task 2（三 API）。
- `backend/tests/test_onboarding_profile_block.py` — Task 3（注入渲染）。
- `backend/tests/test_onboarding_ingestion.py` — Task 4（收納素材與戳記）。
- `backend/tests/test_prompt_fewshot.py` — Task 6（few-shot 防護欄自動化）。
- `docs/superpowers/reference/spec-b-ab-scenarios.md` — Task 12（人味 A/B 固定場景與驗收紀錄模板）。

**後端修改**：
- `database/models.py` — ＋`ONBOARDING_QUESTION_KEYS`、`OnboardingAnswer` 表、`User.onboarding_completed_at`（Task 1）。
- `database/crud.py` — ＋4 個 onboarding CRUD（Task 1）。
- `api/schemas.py` — ＋`OnboardingAnswerIn`（Task 2）。
- `api/routes/user.py` — ＋三端點（**必須註冊在 `/{user_id}` 之前**，Task 2）。
- `services/user_profile.py` — ＋`ONBOARDING_LABELS`／`render_onboarding_lines`／raw 區塊渲染，`get_memory_context` 四分支附掛（Task 3）。
- `services/memory_review.py` — `_build_prompt` 素材塊＋讀階段撈答案＋寫階段戳記（Task 4）。
- `services/prompts/{zh-TW,en}/memory_review_prompt.txt` — 素材鏈插入 `{onboarding_block}`（Task 4）。
- `services/prompts/{zh-TW,en}/persona_core.txt` — 三處增補（Task 5）。
- `services/prompts/{zh-TW,en}/conversation_prompt.txt` — 末尾 few-shot 段（Task 6）。

**前端新建**：
- `desktop/js/onboarding_module.js` — 腳本流程狀態機（Task 9）。
- `desktop/tests/chat_script_delay.test.js`（Task 8）、`desktop/tests/api_onboarding.test.js`（Task 7）、`desktop/tests/onboarding_module.test.js`（Task 9）。

**前端修改**：
- `desktop/js/api_service.js` — 三 wrapper＋`LLM_ENDPOINT_PATTERNS` 加 `/onboarding/complete`＋exports（Task 7）。
- `desktop/js/chat_module.js` — ephemeral 渲染＋`withThinkingDelay`/`setScriptDelayRange`＋fallbackWelcome 延遲＋新 exports（Task 8）；sendMessage 攔截＋開場 gate（Task 9）。
- `desktop/js/i18n.js` — `onboarding.*` 鍵組兩語（Task 9）＋`memory.fromOnboarding`（Task 10）。
- `desktop/js/memory_module.js` — 帳本 batchTitle 認得 `source === 'onboarding'`（Task 10）。
- `desktop/index.html` — `<script>` 標籤（Task 9）。
- `desktop/css/chat.css` — chips 樣式（Task 9）。
- `desktop/sw.js` — `SHELL_ASSETS`＋`CACHE_VERSION` v3（Task 11）。
- `desktop/tests/memory_ledger.test.js` — ＋onboarding 標籤 case（Task 10）。

**任務相依圖**：

```
Task 1（資料層）─→ Task 2（三 API）─┐
        │                            │
        ├─→ Task 3（注入渲染）─→ Task 4（收納素材與戳記）
        │
Task 5（persona 增補）獨立；Task 6（few-shot）獨立
Task 7（前端 API 包裝）獨立；Task 8（chat 延遲/ephemeral 基礎）獨立
Task 9（onboarding 模組與接線）需要 2＋7＋8
Task 10（帳本標籤）獨立小件
Task 11（sw 資產與版本）需要 9
Task 12（A/B 場景文件＋出貨檢查）壓軸
```

---

### Task 1: 後端資料層（models + crud）

**Files:**
- Modify: `backend/app/database/models.py`（User 類內＋檔尾 MemoryOp 之後）
- Modify: `backend/app/database/crud.py`（檔尾）
- Test: `backend/tests/test_onboarding_models.py`

**Interfaces:**
- Produces: `models.ONBOARDING_QUESTION_KEYS`（8-key tuple，白名單＋渲染順序單一來源）；`models.OnboardingAnswer(user_id, question_key, answer_text, answered_at, ingested_at)`（Unique(user_id, question_key)）；`User.onboarding_completed_at`（DateTime nullable）。
- Produces crud: `get_onboarding_answers(db, user_id) -> list`、`upsert_onboarding_answer(db, user_id, question_key, answer_text) -> OnboardingAnswer`（重答覆蓋＋`answered_at` 更新＋`ingested_at` 歸 None）、`get_uningested_onboarding_answers(db, user_id) -> list`（濾空字串與 companion_naming）、`mark_onboarding_answers_ingested(db, user_id, answer_ids) -> int`。

- [ ] **Step 1: 寫失敗測試**

```python
# backend/tests/test_onboarding_models.py
"""onboarding 資料層：models + crud (v2.5 Spec B Task 1)。"""


def _db():
    from database import SessionLocal
    return SessionLocal()


def test_onboarding_answer_upsert_and_unique(client, auth_header):
    from database import crud
    _h, uid = auth_header
    db = _db()
    try:
        assert crud.get_onboarding_answers(db, uid) == []
        row = crud.upsert_onboarding_answer(db, uid, "favorite_food", "牛肉湯")
        assert row.id and row.answer_text == "牛肉湯" and row.answered_at is not None
        assert row.ingested_at is None
        # 重答覆蓋同一列，不長第二列；answered_at 更新
        first_at = row.answered_at
        row2 = crud.upsert_onboarding_answer(db, uid, "favorite_food", "咖哩飯")
        assert row2.id == row.id and row2.answer_text == "咖哩飯"
        assert row2.answered_at >= first_at
        assert len(crud.get_onboarding_answers(db, uid)) == 1
    finally:
        db.close()


def test_upsert_resets_ingested_at(client, auth_header):
    from database import crud
    _h, uid = auth_header
    db = _db()
    try:
        row = crud.upsert_onboarding_answer(db, uid, "hobbies", "打羽球")
        crud.mark_onboarding_answers_ingested(db, uid, [row.id])
        assert crud.get_uningested_onboarding_answers(db, uid) == []
        # 重答＝新素材，重新等待收納
        crud.upsert_onboarding_answer(db, uid, "hobbies", "打羽球和爬山")
        pending = crud.get_uningested_onboarding_answers(db, uid)
        assert [r.question_key for r in pending] == ["hobbies"]
    finally:
        db.close()


def test_uningested_filters(client, auth_header):
    from database import crud
    _h, uid = auth_header
    db = _db()
    try:
        crud.upsert_onboarding_answer(db, uid, "name", "小明")
        crud.upsert_onboarding_answer(db, uid, "location", "")            # 跳過
        crud.upsert_onboarding_answer(db, uid, "companion_naming", "小澄")  # 陪伴者名字
        keys = {r.question_key for r in crud.get_uningested_onboarding_answers(db, uid)}
        assert keys == {"name"}
        # answered_keys 語意（state API 用）：三筆都在
        assert len(crud.get_onboarding_answers(db, uid)) == 3
    finally:
        db.close()


def test_mark_ingested_scoped_to_user(client, auth_header, other_auth_header):
    from database import crud
    _h, uid = auth_header
    _h2, other_uid = other_auth_header
    db = _db()
    try:
        row = crud.upsert_onboarding_answer(db, uid, "strengths", "有毅力")
        # 別人的 user_id 戳不到我的列
        assert crud.mark_onboarding_answers_ingested(db, other_uid, [row.id]) == 0
        assert len(crud.get_uningested_onboarding_answers(db, uid)) == 1
        assert crud.mark_onboarding_answers_ingested(db, uid, [row.id]) == 1
        assert crud.get_uningested_onboarding_answers(db, uid) == []
        assert crud.mark_onboarding_answers_ingested(db, uid, []) == 0  # 空清單 no-op
    finally:
        db.close()


def test_users_onboarding_completed_at_column(client, auth_header):
    from database import crud
    _h, uid = auth_header
    from datetime import datetime
    db = _db()
    try:
        user = crud.get_user(db, uid)
        assert user.onboarding_completed_at is None  # 預設 NULL＝未完成
        user.onboarding_completed_at = datetime.utcnow()
        db.commit()
        assert crud.get_user(db, uid).onboarding_completed_at is not None
    finally:
        db.close()


def test_question_keys_whitelist_constant(client):
    from database.models import ONBOARDING_QUESTION_KEYS
    assert ONBOARDING_QUESTION_KEYS == (
        "companion_naming", "name", "location", "favorite_food",
        "important_people", "hobbies", "strengths", "self_view")
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest tests/test_onboarding_models.py -q`
Expected: FAIL（`AttributeError: ... upsert_onboarding_answer` / `ImportError: ONBOARDING_QUESTION_KEYS`）

- [ ] **Step 3: models.py 加常數、欄位與表**

`User` 類內，`memory_write_mode` 那行之後加一行：

```python
    onboarding_completed_at = Column(DateTime, nullable=True)  # 初次見面完成戳記 (v2.5 Spec B)
```

檔尾（`MemoryOp` 之後）加：

```python
# onboarding 題目白名單 (v2.5 Spec B)：tuple 順序＝raw 區塊與收納素材的渲染順序。
# companion_naming 是「幫陪伴者取名」——不是使用者資料，注入與收納一律排除。
ONBOARDING_QUESTION_KEYS = (
    "companion_naming", "name", "location", "favorite_food",
    "important_people", "hobbies", "strengths", "self_view",
)


class OnboardingAnswer(Base):
    """初次見面的答案原文 (v2.5 Spec B)。一使用者一題一列 (upsert 覆蓋，為未來重跑留路)。

    answer_text 空字串＝跳過（answered_keys 因此含它、續跑不重問；注入渲染時濾掉）。
    ingested_at：memory review pass 收納戳記（spec §7-3 懶收納）——NULL＝尚未收納，
    會出現在 raw 注入區塊與 review pass 素材；成功套用後戳記，區塊自然消失。
    """
    __tablename__ = "onboarding_answers"
    __table_args__ = (UniqueConstraint("user_id", "question_key", name="uq_onboarding_user_key"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    question_key = Column(String(32), nullable=False)
    answer_text = Column(Text, nullable=False, default="")
    answered_at = Column(DateTime, default=datetime.utcnow)
    ingested_at = Column(DateTime, nullable=True)
```

- [ ] **Step 4: crud.py 檔尾加四函式**

（若 crud.py 頂部尚無 `from datetime import datetime` 就補上；models 匯入沿用該檔既有寫法。）

```python
# --- Onboarding 初次見面 (v2.5 Spec B) -----------------------------------------

def get_onboarding_answers(db, user_id: int):
    """全部答案列（含空字串跳過與 companion_naming）——state API 的 answered_keys 用。"""
    return (db.query(models.OnboardingAnswer)
            .filter(models.OnboardingAnswer.user_id == user_id).all())


def upsert_onboarding_answer(db, user_id: int, question_key: str, answer_text: str):
    """一題一列 upsert。重答＝覆蓋＋answered_at 更新＋ingested_at 歸 None (重新等收納)。"""
    row = (db.query(models.OnboardingAnswer)
           .filter_by(user_id=user_id, question_key=question_key).first())
    if row is None:
        row = models.OnboardingAnswer(user_id=user_id, question_key=question_key)
        db.add(row)
    row.answer_text = answer_text
    row.answered_at = datetime.utcnow()
    row.ingested_at = None
    db.commit()
    db.refresh(row)
    return row


def get_uningested_onboarding_answers(db, user_id: int):
    """待收納答案＝未戳記＋非空＋非 companion_naming——raw 注入區塊與 review 素材共用。"""
    return (db.query(models.OnboardingAnswer)
            .filter(models.OnboardingAnswer.user_id == user_id,
                    models.OnboardingAnswer.ingested_at.is_(None),
                    models.OnboardingAnswer.answer_text != "",
                    models.OnboardingAnswer.question_key != "companion_naming")
            .all())


def mark_onboarding_answers_ingested(db, user_id: int, answer_ids) -> int:
    """review pass 成功套用後戳記。user_id 過濾＝跨用戶防護。回傳實際戳記筆數。"""
    if not answer_ids:
        return 0
    n = (db.query(models.OnboardingAnswer)
         .filter(models.OnboardingAnswer.user_id == user_id,
                 models.OnboardingAnswer.id.in_(answer_ids))
         .update({"ingested_at": datetime.utcnow()}, synchronize_session=False))
    db.commit()
    return n
```

- [ ] **Step 5: 跑測試確認通過**

Run: `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest tests/test_onboarding_models.py -q`
Expected: 6 passed

- [ ] **Step 6: schema_upgrade 覆蓋確認（spec §6 明列項）**

`ensure_schema` 是泛用機制（掃 model metadata 逐欄補 ALTER）——`onboarding_completed_at`
是 nullable 新欄，天然在覆蓋範圍。開 `tests/test_schema_upgrade.py` 看它的既有模式：
若它**逐欄列舉**測試對象，把 `users.onboarding_completed_at` 補進該清單並跑綠；若它只測
泛用機制（造舊表→跑 ensure_schema→驗欄位出現），免動。之後跑：

Run: `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest tests/test_schema_upgrade.py -q`
Expected: 全 passed

- [ ] **Step 7: Commit**

```bash
git add backend/app/database/models.py backend/app/database/crud.py backend/tests/test_onboarding_models.py backend/tests/test_schema_upgrade.py
git commit -m "feat(對話體驗): onboarding_answers 資料層＋users 完成戳記"
```

---

### Task 2: 後端三 API（state / answer / complete）

**Files:**
- Modify: `backend/app/api/schemas.py`（檔尾）
- Modify: `backend/app/api/routes/user.py`（陪伴者設定段之後、`/{user_id}` 之前）
- Test: `backend/tests/test_onboarding_api.py`

**Interfaces:**
- Consumes: Task 1 的 crud 四函式與 `ONBOARDING_QUESTION_KEYS`；既有 `api.deps.get_llm_config`、`services.memory_review.run_review_pass(user_id, cfg, lang=..., source=...)`。
- Produces: `GET /users/onboarding/state` → `{"completed": bool, "answered_keys": [str]}`；`POST /users/onboarding/answer` body `{"question_key","answer_text"}` → `{"saved": true, "question_key": str}`（白名單外/超長 422，空字串合法）；`POST /users/onboarding/complete` → `{"completed": true, "memory_review": dict|null}`（冪等；收納 best-effort）；`api.schemas.OnboardingAnswerIn`。

- [ ] **Step 1: 寫失敗測試**

```python
# backend/tests/test_onboarding_api.py
"""onboarding 三 API (v2.5 Spec B Task 2)。"""
import json

from conftest import LLM_HEADERS

OPS_REPLY = json.dumps({"ops": [{
    "action": "add", "file": "user_profile",
    "section": "稱呼與身分", "text": "- 叫他小明 (2026-08-24)"}]})


def test_state_initial(client, auth_header):
    headers, _uid = auth_header
    r = client.get("/users/onboarding/state", headers=headers)
    assert r.status_code == 200
    assert r.json() == {"completed": False, "answered_keys": []}


def test_answer_upsert_and_state(client, auth_header):
    headers, _uid = auth_header
    r = client.post("/users/onboarding/answer", headers=headers,
                    json={"question_key": "name", "answer_text": "小明"})
    assert r.status_code == 200 and r.json()["saved"] is True
    # 空字串＝跳過，合法且進 answered_keys
    r = client.post("/users/onboarding/answer", headers=headers,
                    json={"question_key": "location", "answer_text": ""})
    assert r.status_code == 200
    # 重答覆蓋不長列
    r = client.post("/users/onboarding/answer", headers=headers,
                    json={"question_key": "name", "answer_text": "阿明"})
    assert r.status_code == 200
    state = client.get("/users/onboarding/state", headers=headers).json()
    assert state["completed"] is False
    assert sorted(state["answered_keys"]) == ["location", "name"]


def test_answer_validation_422(client, auth_header):
    headers, _uid = auth_header
    r = client.post("/users/onboarding/answer", headers=headers,
                    json={"question_key": "not_a_key", "answer_text": "x"})
    assert r.status_code == 422
    r = client.post("/users/onboarding/answer", headers=headers,
                    json={"question_key": "name", "answer_text": "很" * 501})
    assert r.status_code == 422


def test_answer_requires_auth(client):
    r = client.post("/users/onboarding/answer",
                    json={"question_key": "name", "answer_text": "x"})
    assert r.status_code == 401


def test_complete_idempotent_and_state(client, auth_header, mock_llm):
    headers, _uid = auth_header
    r = client.post("/users/onboarding/complete", headers=headers)
    assert r.status_code == 200 and r.json()["completed"] is True
    # 沒有任何待收納答案 → 不打 LLM
    assert mock_llm.calls == []
    assert r.json()["memory_review"] is None
    # 冪等
    r = client.post("/users/onboarding/complete", headers=headers)
    assert r.status_code == 200 and r.json()["completed"] is True
    assert client.get("/users/onboarding/state", headers=headers).json()["completed"] is True


def test_complete_triggers_ingestion_pass(client, auth_header, mock_llm):
    headers, _uid = auth_header
    client.post("/users/onboarding/answer", headers=headers,
                json={"question_key": "name", "answer_text": "小明"})
    mock_llm.respond(OPS_REPLY)
    r = client.post("/users/onboarding/complete",
                    headers={**headers, **LLM_HEADERS})
    assert r.status_code == 200 and r.json()["completed"] is True
    assert len(mock_llm.calls) == 1
    review = r.json()["memory_review"]
    assert review is not None and review["applied"] == 1 and review["error"] is None


def test_complete_survives_llm_failure(client, auth_header, mock_llm):
    """零金鑰/供應商失敗：收納 best-effort 跳過，complete 照樣成功。"""
    headers, _uid = auth_header
    client.post("/users/onboarding/answer", headers=headers,
                json={"question_key": "hobbies", "answer_text": "打羽球"})
    mock_llm.fail()
    r = client.post("/users/onboarding/complete",
                    headers={**headers, **LLM_HEADERS})
    assert r.status_code == 200
    assert r.json()["completed"] is True and r.json()["memory_review"] is None
    assert client.get("/users/onboarding/state", headers=headers).json()["completed"] is True
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest tests/test_onboarding_api.py -q`
Expected: FAIL（404 Not Found——路由不存在）

- [ ] **Step 3: schemas.py 檔尾加 OnboardingAnswerIn**

（確認該檔 pydantic import 含 `Field` 與 `field_validator`，缺就補進既有 import 行。）

```python
class OnboardingAnswerIn(BaseModel):
    """POST /users/onboarding/answer 的請求 body (v2.5 Spec B)。

    空字串是合法值（跳過語義——answered_keys 因此包含該題，續跑不重問）。
    白名單與 500 字上限都在 schema 層擋（422），不需要雙語訊息鍵。
    """
    question_key: str
    answer_text: str = Field(default="", max_length=500)

    @field_validator("question_key")
    @classmethod
    def _key_in_whitelist(cls, v: str) -> str:
        from database.models import ONBOARDING_QUESTION_KEYS
        if v not in ONBOARDING_QUESTION_KEYS:
            raise ValueError(f"unknown question_key: {v}")
        return v
```

- [ ] **Step 4: user.py 加三端點**

頂部修改（沿用既有 import 行擴充）：

```python
import logging
```
```python
from api.deps import get_db, get_current_user, get_current_token_data, get_language, get_llm_config
from api.schemas import CompanionSettingsIn, OnboardingAnswerIn
from database import crud, db_session
from providers.base import LLMConfig
```

`router = APIRouter()` 之後加一行：

```python
logger = logging.getLogger(__name__)
```

在陪伴者設定段（`put_my_companion` 函式結尾）之後、「個人 LLM 金鑰」段之前插入：

```python
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
```

- [ ] **Step 5: 跑測試確認通過**

Run: `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest tests/test_onboarding_api.py tests/test_onboarding_models.py -q`
Expected: 全 passed（`test_complete_triggers_ingestion_pass` 此時素材塊還沒進 prompt——它只驗「有待收納答案時會打一次 LLM 且 ops 有套用」，Task 4 才驗素材內容）

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/schemas.py backend/app/api/routes/user.py backend/tests/test_onboarding_api.py
git commit -m "feat(對話體驗): onboarding 三 API——state/answer/complete＋best-effort 收納"
```

---

### Task 3: 注入渲染（get_memory_context 附掛 raw 答案區塊）

**Files:**
- Modify: `backend/app/services/user_profile.py`
- Test: `backend/tests/test_onboarding_profile_block.py`

**Interfaces:**
- Consumes: Task 1 `crud.get_uningested_onboarding_answers`；`models.ONBOARDING_QUESTION_KEYS`。
- Produces: `ONBOARDING_LABELS`（兩語 7 題標籤 dict）；`render_onboarding_lines(rows, lang) -> list[str]`（Task 4 的素材塊也用它）；`get_memory_context()` 新行為——有未收納答案時 profile_block 附掛【他初次見面時告訴你的】、diary_context 附掛純文字版、`has_any=True`；`get_user_profile_block()`／check-in／conversation 呼叫端零改動。

- [ ] **Step 1: 寫失敗測試**

```python
# backend/tests/test_onboarding_profile_block.py
"""raw 答案注入渲染 (v2.5 Spec B Task 3)——附掛在 C 的 get_memory_context 內部。"""
from database import db_session, crud
from services.user_profile import get_memory_context, get_user_profile_block


def _seed(uid, key, text):
    with db_session() as db:
        crud.upsert_onboarding_answer(db, uid, key, text)


def test_raw_only_block_zh(client, auth_header):
    """檔案與舊筆記皆無、只有答案：raw 區塊獨挑 profile_block，has_any=True。"""
    _h, uid = auth_header
    _seed(uid, "name", "小明")
    _seed(uid, "favorite_food", "牛肉湯")
    ctx = get_memory_context(uid, "zh-TW")
    assert ctx.has_any is True
    assert "【他初次見面時告訴你的】" in ctx.profile_block
    assert "稱呼：小明" in ctx.profile_block and "喜歡的食物：牛肉湯" in ctx.profile_block
    assert "還不熟" not in ctx.profile_block
    assert "別把這份清單複誦給他" in ctx.profile_block  # 使用說明緊貼鐵律
    # 順序照 ONBOARDING_QUESTION_KEYS：name 在 favorite_food 前
    assert ctx.profile_block.index("稱呼：小明") < ctx.profile_block.index("喜歡的食物")
    # 日期渲染（answered_at 的 YYYY-MM-DD）
    import re
    assert re.search(r"（\d{4}-\d{2}-\d{2}）稱呼：小明", ctx.profile_block)
    # 契約函式同步（Spec B §7-1：包裝零改動、自然繼承）
    assert get_user_profile_block(uid, "zh-TW") == ctx.profile_block
    # diary_context 同步附掛（2026-08-24 裁決：raw 也進日記面）
    assert "初次見面他告訴你的" in ctx.diary_context and "小明" in ctx.diary_context


def test_raw_only_block_en(client, auth_header):
    _h, uid = auth_header
    _seed(uid, "hobbies", "badminton")
    ctx = get_memory_context(uid, "en")
    assert "[What they told you when you first met]" in ctx.profile_block
    assert "Hobbies: badminton" in ctx.profile_block
    assert "never recite this list" in ctx.profile_block


def test_raw_appended_after_memory_file(client, auth_header):
    """C 檔案有內容＋有未收納答案：檔案區塊在前、raw 區塊附掛在後。"""
    _h, uid = auth_header
    with db_session() as db:
        crud.upsert_memory_file(db, uid, "user_profile", "## 稱呼與身分\n- 小B (2026-08-23)")
    _seed(uid, "location", "彰化")
    ctx = get_memory_context(uid, "zh-TW")
    assert "【你對這位使用者的長期認識（使用者檔案）】" in ctx.profile_block
    assert "【他初次見面時告訴你的】" in ctx.profile_block
    assert (ctx.profile_block.index("使用者檔案")
            < ctx.profile_block.index("他初次見面時告訴你的"))
    assert "住的城市：彰化" in ctx.diary_context


def test_filters_skip_and_naming_and_ingested(client, auth_header):
    _h, uid = auth_header
    _seed(uid, "companion_naming", "小澄")   # 陪伴者名字：不渲染
    _seed(uid, "location", "")               # 跳過：不渲染
    _seed(uid, "name", "小明")
    with db_session() as db:
        rows = crud.get_uningested_onboarding_answers(db, uid)
        crud.mark_onboarding_answers_ingested(db, uid, [r.id for r in rows])
    ctx = get_memory_context(uid, "zh-TW")
    # 全部被濾掉/已收納 → 回到 C 原樣（空佔位、has_any False）
    assert ctx.has_any is False
    assert "還不熟" in ctx.profile_block
    assert "初次見面" not in ctx.profile_block


def test_existing_c_behavior_unchanged(client, auth_header):
    """沒有任何 onboarding 答案時，三態 fallback 與 C 完全一致（回歸保險）。"""
    _h, uid = auth_header
    ctx = get_memory_context(uid, "zh-TW")
    assert not ctx.has_any and "還不熟" in ctx.profile_block
    assert ctx.diary_context == "尚無互動筆記記錄。"
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest tests/test_onboarding_profile_block.py -q`
Expected: FAIL（raw 區塊不存在、has_any False）

- [ ] **Step 3: user_profile.py 加渲染與附掛**

`_EMPTY_DIARY_CONTEXT` 定義之後加：

```python
# onboarding 答案的渲染標籤 (v2.5 Spec B)：key 順序由 models.ONBOARDING_QUESTION_KEYS 決定
ONBOARDING_LABELS = {
    "zh-TW": {"name": "稱呼", "location": "住的城市", "favorite_food": "喜歡的食物",
              "important_people": "重要的人", "hobbies": "喜歡做的事",
              "strengths": "他眼中自己的優點", "self_view": "他怎麼形容自己"},
    "en": {"name": "Name to call them", "location": "City", "favorite_food": "Favorite food",
           "important_people": "People who matter", "hobbies": "Hobbies",
           "strengths": "Strength in their own eyes", "self_view": "How they describe themselves"},
}


def render_onboarding_lines(rows, lang: str) -> list:
    """未收納答案 → 渲染行清單（raw 注入區塊與 review pass 素材共用）。

    rows 已由 crud.get_uningested_onboarding_answers 濾掉空字串與 companion_naming；
    這裡再以標籤 dict 防守一次未知 key（直接跳過）。呼叫端必須在 db session 內呼叫
    （rows 是 ORM 物件，session 關閉後不得再碰屬性）。
    """
    from database.models import ONBOARDING_QUESTION_KEYS
    lang_key = "en" if lang == "en" else "zh-TW"
    labels = ONBOARDING_LABELS[lang_key]
    order = {k: i for i, k in enumerate(ONBOARDING_QUESTION_KEYS)}
    lines = []
    for r in sorted(rows, key=lambda r: order.get(r.question_key, 99)):
        label = labels.get(r.question_key)
        if not label:
            continue
        date = r.answered_at.strftime("%Y-%m-%d") if r.answered_at else ""
        if lang_key == "zh-TW":
            lines.append(f"-（{date}）{label}：{r.answer_text}")
        else:
            lines.append(f"- ({date}) {label}: {r.answer_text}")
    return lines


def _onboarding_block(lines: list, lang: str) -> str:
    """【他初次見面時告訴你的】區塊（使用說明緊貼鐵律）。lines 空時呼叫端不該進來。"""
    body = "\n".join(lines)
    if lang != "en":
        return ("【他初次見面時告訴你的】\n" + body +
                "\n（使用說明：這些是他初次見面自我介紹時親口說的原文。自然地記得就好，"
                "別把這份清單複誦給他；日期是他說這些話的時間——他說「今天」時，"
                "別把過去的回答當成今天的事。）")
    return ("[What they told you when you first met]\n" + body +
            "\n(How to use: these are their own words from your first meeting. Remember them "
            "naturally — never recite this list back to them; the dates mark when they said it, "
            "so when they say \"today\", don't mistake these for today's news.)")


def _onboarding_context(lines: list, lang: str) -> str:
    """diary_context 的純文字版（daily_note 的 {interaction_note} 槽）。"""
    header = "初次見面他告訴你的：" if lang != "en" else "What they told you at first meeting:"
    return header + "\n" + "\n".join(lines)
```

`get_memory_context` 整個函式替換為（讀階段多撈答案，三個分支附掛，新增 raw-only 分支；C 邏輯逐行保留）：

```python
def get_memory_context(user_id: int, lang: str) -> MemoryContext:
    with db_session() as db:
        files = crud.get_memory_files(db, user_id)
        profile = files["user_profile"].content.strip() if "user_profile" in files else ""
        companion = files["companion_notes"].content.strip() if "companion_notes" in files else ""
        legacy = None
        if not profile and not companion:
            from services.interaction_service import get_latest_interaction_note
            note = get_latest_interaction_note(db, user_id)
            legacy = note.content.strip() if note and note.content else None
        # v2.5 Spec B：未收納的初次見面答案 (session 內先渲染成字串，關閉後不碰 ORM)
        onboarding_lines = render_onboarding_lines(
            crud.get_uningested_onboarding_answers(db, user_id), lang)

    onb_block = _onboarding_block(onboarding_lines, lang) if onboarding_lines else ""
    onb_context = _onboarding_context(onboarding_lines, lang) if onboarding_lines else ""

    if profile or companion:
        profile_block = _profile_block(profile or memory_files.blank_template("user_profile"), lang)
        companion_block = _companion_block(companion, lang) if companion else ""
        if lang != "en":
            diary_context = "使用者檔案：\n" + (profile or "（空）")
            if companion:
                diary_context += "\n\n陪伴者筆記：\n" + companion
        else:
            diary_context = "User profile:\n" + (profile or "(empty)")
            if companion:
                diary_context += "\n\nCompanion notes:\n" + companion
        if onb_block:
            profile_block += "\n\n" + onb_block
            diary_context += "\n\n" + onb_context
        return MemoryContext(profile_block, companion_block, diary_context, True)

    if legacy:  # 懶遷移期：首次 review pass 前沿用舊筆記，現狀不退化
        profile_block = _profile_block(legacy, lang)
        diary_context = legacy
        if onb_block:
            profile_block += "\n\n" + onb_block
            diary_context += "\n\n" + onb_context
        return MemoryContext(profile_block, "", diary_context, True)

    if onb_block:  # 檔案與舊筆記皆無、只有初次見面答案：raw 區塊獨挑 (B §7-1/§7-2)
        return MemoryContext(onb_block, "", onb_context, True)

    lang_key = "en" if lang == "en" else "zh-TW"
    return MemoryContext(_profile_block(_EMPTY_PLACEHOLDER[lang_key], lang), "",
                         _EMPTY_DIARY_CONTEXT[lang_key], False)
```

模組 docstring 第一段的「B 落地後在『本函式內部』追加」敘述已實現——把 docstring 裡的
`get_user_profile_block(user_id, lang) 是 Spec B 設計文件 §5 的契約函式：`
`B 落地後在「函式內部」...呼叫端不動。` 兩行改寫為現況描述：

```python
"""記憶注入渲染 (v2.5 Spec C)——Spec B 接縫已於本檔落地。

raw onboarding 答案（未收納者）由 get_memory_context 附掛渲染
（【他初次見面時告訴你的】區塊＋diary_context 純文字版），conversation／
check-in／get_user_profile_block 呼叫端零改動（spec §7-1）。

三態 fallback（懶遷移）：新檔有內容 → 新檔；兩檔皆空且有舊互動筆記 → 舊筆記；
皆無 → 「還不熟」佔位（只有未收納答案時 → raw 區塊獨挑）。注入值永遠非空
(profile) 或整塊消失 (companion)。
"""
```

- [ ] **Step 4: 跑測試確認通過（含 C 回歸）**

Run: `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest tests/test_onboarding_profile_block.py tests/test_user_profile_block.py tests/test_checkin_api.py -q`
Expected: 全 passed（C 的三態測試一個都不能破）

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/user_profile.py backend/tests/test_onboarding_profile_block.py
git commit -m "feat(對話體驗): raw 答案注入渲染——get_memory_context 附掛【他初次見面時告訴你的】"
```

---

### Task 4: 收納素材與戳記（review pass 懶收納）

**Files:**
- Modify: `backend/app/services/memory_review.py`
- Modify: `backend/app/services/prompts/zh-TW/memory_review_prompt.txt`（素材鏈行）
- Modify: `backend/app/services/prompts/en/memory_review_prompt.txt`（素材鏈行）
- Test: `backend/tests/test_onboarding_ingestion.py`

**Interfaces:**
- Consumes: Task 1 crud、Task 3 `render_onboarding_lines`。
- Produces: `run_review_pass` 新行為——讀階段撈未收納答案→素材塊 `{onboarding_block}` 注入 prompt；寫階段「applied>0 或 pending>0 且無整批錯誤」才 `mark_onboarding_answers_ingested`；公開簽名不變。`_onboarding_material(lines, lang) -> str`。

- [ ] **Step 1: 寫失敗測試**

```python
# backend/tests/test_onboarding_ingestion.py
"""review pass 懶收納 (v2.5 Spec B Task 4)：素材注入＋成功戳記＋失敗不戳。"""
import json

from conftest import LLM_HEADERS
from database import db_session, crud

OPS_REPLY = json.dumps({"ops": [{
    "action": "add", "file": "user_profile",
    "section": "稱呼與身分", "text": "- 叫他小明 (2026-08-24)"}]})


def _seed(uid, key, text):
    with db_session() as db:
        crud.upsert_onboarding_answer(db, uid, key, text)


def _uningested(uid):
    with db_session() as db:
        return [r.question_key for r in crud.get_uningested_onboarding_answers(db, uid)]


def _run(uid, mock_llm, reply=None, fail=False):
    from providers.base import LLMConfig
    from services.memory_review import run_review_pass
    if fail:
        mock_llm.fail()
    elif reply is not None:
        mock_llm.respond(reply)
    return run_review_pass(uid, LLMConfig(provider="claude", api_key="sk-test"),
                           lang="zh-TW", source="onboarding")


def test_material_block_in_prompt(client, auth_header, mock_llm):
    _h, uid = auth_header
    _seed(uid, "name", "小明")
    _seed(uid, "favorite_food", "牛肉湯")
    _run(uid, mock_llm, reply=OPS_REPLY)
    prompt = mock_llm.calls[0]["messages"][1]["content"]
    assert "【初次見面他告訴你的（收納素材）】" in prompt
    assert "稱呼：小明" in prompt and "喜歡的食物：牛肉湯" in prompt


def test_no_material_no_block(client, auth_header, mock_llm):
    _h, uid = auth_header
    _run(uid, mock_llm, reply=json.dumps({"ops": []}))
    prompt = mock_llm.calls[0]["messages"][1]["content"]
    assert "收納素材" not in prompt


def test_applied_pass_stamps(client, auth_header, mock_llm):
    _h, uid = auth_header
    _seed(uid, "name", "小明")
    result = _run(uid, mock_llm, reply=OPS_REPLY)
    assert result.applied == 1 and result.error is None
    assert _uningested(uid) == []
    # 收納後 raw 區塊自然消失（Task 3 的渲染只認未收納列）
    from services.user_profile import get_memory_context
    assert "初次見面" not in get_memory_context(uid, "zh-TW").profile_block


def test_empty_ops_does_not_stamp(client, auth_header, mock_llm):
    """模型說「沒什麼好記」＝收納失敗：素材下輪重現（天然重試）。"""
    _h, uid = auth_header
    _seed(uid, "name", "小明")
    result = _run(uid, mock_llm, reply=json.dumps({"ops": []}))
    assert result.applied == 0
    assert _uningested(uid) == ["name"]


def test_parse_failure_does_not_stamp(client, auth_header, mock_llm):
    _h, uid = auth_header
    _seed(uid, "name", "小明")
    result = _run(uid, mock_llm, reply="這不是 JSON")
    assert result.error == "parse_failed"
    assert _uningested(uid) == ["name"]


def test_approval_mode_pending_stamps(client, auth_header, mock_llm):
    """核可制：ops 進 pending 也算收納成功（素材不重複產 pending）。"""
    _h, uid = auth_header
    with db_session() as db:
        user = crud.get_user(db, uid)
        user.memory_write_mode = "approval"
        db.commit()
    _seed(uid, "name", "小明")
    result = _run(uid, mock_llm, reply=OPS_REPLY)
    assert result.pending == 1 and result.applied == 0
    assert _uningested(uid) == []


def test_ledger_source_is_onboarding(client, auth_header, mock_llm):
    _h, uid = auth_header
    _seed(uid, "name", "小明")
    _run(uid, mock_llm, reply=OPS_REPLY)
    with db_session() as db:
        ops = crud.get_memory_ops(db, uid, limit=10, offset=0)
    assert ops and ops[0].source == "onboarding"


def test_diary_pass_also_carries_material(client, auth_header, mock_llm):
    """零金鑰走完 onboarding 的人：首篇日記後的一般 review pass 自然補收。"""
    from providers.base import LLMConfig
    from services.memory_review import run_review_pass
    _h, uid = auth_header
    _seed(uid, "hobbies", "打羽球")
    mock_llm.respond(OPS_REPLY)
    result = run_review_pass(uid, LLMConfig(provider="claude", api_key="sk-test"),
                             lang="zh-TW", source="review_pass",
                             diary_content="今天打了羽球", valence=0.7)
    prompt = mock_llm.calls[0]["messages"][1]["content"]
    assert "收納素材" in prompt and "打羽球" in prompt
    assert result.applied == 1
    assert _uningested(uid) == []
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest tests/test_onboarding_ingestion.py -q`
Expected: FAIL（prompt 無素材塊、`_uningested` 不清空、`KeyError: onboarding_block` 視實作階段而定）

- [ ] **Step 3: 兩語 memory_review_prompt.txt 插入 placeholder**

zh-TW 檔第 11 行（素材鏈）：

```
{near_limit_hint}{legacy_note_block}{over_budget_feedback}【近期對話】
```
改為
```
{near_limit_hint}{legacy_note_block}{onboarding_block}{over_budget_feedback}【近期對話】
```

en 檔同位置：

```
{near_limit_hint}{legacy_note_block}{over_budget_feedback}[Recent conversation]
```
改為
```
{near_limit_hint}{legacy_note_block}{onboarding_block}{over_budget_feedback}[Recent conversation]
```

（此兩行修改是 spec §7-5 的明文豁免，不受加法鐵律限制；除此以外兩檔零改動。）

- [ ] **Step 4: memory_review.py 素材塊＋戳記**

頂部 import 區加：

```python
from services.user_profile import render_onboarding_lines
```

`_over_budget_feedback` 之後加：

```python
def _onboarding_material(lines: list, lang: str) -> str:
    """未收納的初次見面答案 → review pass 素材塊 (比照 legacy_note_block 懶遷移模式)。"""
    if not lines:
        return ""
    body = "\n".join(lines)
    if lang != "en":
        return ("【初次見面他告訴你的（收納素材）】\n" + body +
                "\n（這些是初次見面自我介紹的原文回答：請把值得長期記住的部分分流進上面的"
                "使用者檔案（多半屬「稱呼與身分」「四大生活領域」「優勢與關鍵洞察」）；"
                "這批素材收納完成前每次都會出現，已在檔案裡的不要重複新增。）\n\n")
    return ("[What they told you when you first met (to be filed)]\n" + body +
            "\n(Their verbatim onboarding answers: file what deserves long-term memory into the "
            "user profile above (mostly 稱呼與身分 / 四大生活領域 / 優勢與關鍵洞察); this "
            "material reappears until filed — never re-add what is already in the file.)\n\n")
```

`_build_prompt` 簽名加 `onboarding_lines=None`，format 呼叫加對應 key：

```python
def _build_prompt(snapshot: dict, lang: str, *, chat_text: str, diary_content: str,
                  valence, day_notes_rows, legacy_note: Optional[str],
                  onboarding_lines=None, over_budget: str = "") -> str:
```

format 參數清單裡 `over_budget_feedback=over_budget,` 旁加一行：

```python
        onboarding_block=_onboarding_material(onboarding_lines or [], lang),
```

`run_review_pass` 讀階段（`day_rows = ...` 那行之後、`with` 區塊內）加：

```python
        onboarding_rows = crud.get_uningested_onboarding_answers(db, user_id)
        onboarding_lines = render_onboarding_lines(onboarding_rows, lang)
        onboarding_ids = [r.id for r in onboarding_rows]
```

`_call` 內的 `_build_prompt(...)` 呼叫加 `onboarding_lines=onboarding_lines,`。

寫階段兩處成功分支加戳記（帳本入庫之後、return 之前）：

approval 分支（`result.pending = ...` 與 `result.failed = ...` 之後）：

```python
            if onboarding_ids and result.pending:
                crud.mark_onboarding_answers_ingested(db, user_id, onboarding_ids)
```

auto 分支（`result.applied = ...` 與 `result.failed = ...` 之後）：

```python
        if onboarding_ids and result.applied:
            crud.mark_onboarding_answers_ingested(db, user_id, onboarding_ids)
```

（整批超標分支、`ops is None`／`not ops` 的早退分支**都不戳記**——素材下輪重現＝天然重試。）

- [ ] **Step 5: 跑測試確認通過（含 C 回歸）**

Run: `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest tests/test_onboarding_ingestion.py tests/test_memory_review.py tests/test_memory_governance.py tests/test_memory_pipeline_api.py tests/test_onboarding_api.py -q`
Expected: 全 passed（C 的 review/治理/管線測試不能破；Task 2 的 complete 測試現在連素材也吃到）

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/memory_review.py backend/app/services/prompts/zh-TW/memory_review_prompt.txt backend/app/services/prompts/en/memory_review_prompt.txt backend/tests/test_onboarding_ingestion.py
git commit -m "feat(對話體驗): review pass 懶收納——onboarding 素材塊＋成功戳記"
```

---

### Task 5: persona_core 三處增補（兩語，全加法）

**Files:**
- Modify: `backend/app/services/prompts/zh-TW/persona_core.txt`
- Modify: `backend/app/services/prompts/en/persona_core.txt`

**Interfaces:**
- Consumes: 無（純提示詞）。
- Produces: 兩語 persona 各三段新文字（映照句式工具箱／自我覺察收束／主動追問許可）；既有行一字不動。

- [ ] **Step 1: 先跑基線（改動前既有測試全綠）**

Run: `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest tests/test_prompt_loader.py tests/test_prompt_builder.py -q`
Expected: passed（基線）

- [ ] **Step 2: zh-TW persona_core.txt 三處增補（用 Edit 精準插入，不重寫檔案）**

增補 1——【當他情緒低落時】步驟 1 之後插一行（old_string 取現檔）：

old:
```
1. 反映：用自己的話簡短說出你聽到的事實與情緒。（「聽起來今天被否定得很突然。」）
```
new:
```
1. 反映：用自己的話簡短說出你聽到的事實與情緒。（「聽起來今天被否定得很突然。」）
   「我聽到你說……」「我能感受到……」「聽起來……」都是好用的映照起手式——但它們是工具不是公式：連續幾則訊息別重複同一種起手式，而且反映永遠要用自己的話把他的話換句話說，不是原句抄回去。
```

增補 2——低落段尾（「陪伴比解法重要……」那行）之後插一行：

old:
```
陪伴比解法重要。等他喘過氣或開口問，再給方向——一次一個、小到今天就做得到，說完就放手，不追問有沒有照做。
```
new:
```
陪伴比解法重要。等他喘過氣或開口問，再給方向——一次一個、小到今天就做得到，說完就放手，不追問有沒有照做。
他傾訴情緒時，幫他自己看見他的洞見，比你替他下結論更有力——你的觀點先收著，等他喘過氣再給。這一條只管情緒傾訴的時刻：聊想法、聊計畫時，照常主動。
```

增補 3——【怎麼聊天】段尾（「閒聊也是陪伴……」那行）之後插一行：

old:
```
- 閒聊也是陪伴：他聊日常、興趣、趣事時，就自然地聊天：好奇、接話、分享看法。不要硬把話題轉往情緒或心理分析。
```
new:
```
- 閒聊也是陪伴：他聊日常、興趣、趣事時，就自然地聊天：好奇、接話、分享看法。不要硬把話題轉往情緒或心理分析。
- 真的好奇就追問細節（「後來呢？」「那你怎麼回？」）——好奇本身就是在乎的證明。「一次最多問一個問題」的上限照舊。
```

- [ ] **Step 3: en persona_core.txt 三處對應增補（原生撰寫）**

增補 1：

old:
```
1. Reflect: briefly say, in your own words, the facts and feelings you heard. ("Sounds like today's rejection came out of nowhere.")
```
new:
```
1. Reflect: briefly say, in your own words, the facts and feelings you heard. ("Sounds like today's rejection came out of nowhere.")
   "I hear you saying…", "I can feel how…", "Sounds like…" are handy mirroring openers — tools, not a formula: don't repeat the same opener across consecutive messages, and always mirror in your own words instead of parroting theirs back.
```

增補 2：

old:
```
Being there beats solving. Once they catch their breath or ask, offer direction — one suggestion at a time, small enough to do today, then let go; never chase whether they did it.
```
new:
```
Being there beats solving. Once they catch their breath or ask, offer direction — one suggestion at a time, small enough to do today, then let go; never chase whether they did it.
When they're pouring their heart out, helping them see their own insight lands harder than handing them your conclusion — hold your take until they've caught their breath. This rule is for emotional moments only: with ideas and plans, stay forward as usual.
```

增補 3：

old:
```
- Casual chat is companionship too: when they share daily life, hobbies, fun things, just chat — be curious, riff along, share your view. Don't steer everything back to feelings or psychoanalysis.
```
new:
```
- Casual chat is companionship too: when they share daily life, hobbies, fun things, just chat — be curious, riff along, share your view. Don't steer everything back to feelings or psychoanalysis.
- When you're genuinely curious, ask for the details ("What happened next?", "What did you say back?") — curiosity is proof you care. The "one question at a time" cap still applies.
```

- [ ] **Step 4: 禁詞 grep＋加法驗證**

```bash
cd /home/e604/Brian/URDiary/backend/app/services/prompts
for w in 至少你還 往好處想 別想太多 一切都會好的 你應該要 加油; do echo "== $w"; grep -n "$w" zh-TW/persona_core.txt; done
for w in "At least you still" "Look on the bright side" "Don't overthink it" "Everything will be fine" "You should" "Cheer up"; do echo "== $w"; grep -n "$w" en/persona_core.txt; done
cd /home/e604/Brian/URDiary && git diff --numstat backend/app/services/prompts/zh-TW/persona_core.txt backend/app/services/prompts/en/persona_core.txt
```
Expected: 每個禁詞都**只**命中【禁止的句式】/【Banned phrases】那一行；numstat 兩檔刪除數皆為 0（形如 `3 0 <path>`）。

- [ ] **Step 5: 跑既有測試確認不破**

Run: `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest tests/test_prompt_loader.py tests/test_prompt_builder.py tests/test_prompt_builder_companion.py -q`
Expected: 全 passed

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/prompts/zh-TW/persona_core.txt backend/app/services/prompts/en/persona_core.txt
git commit -m "feat(對話體驗): persona 三增補——映照句式工具箱/自我覺察收束/主動追問許可"
```

---

### Task 6: few-shot 段【回應手感示範】（兩語＋防護欄自動化）

**Files:**
- Modify: `backend/app/services/prompts/zh-TW/conversation_prompt.txt`（檔尾）
- Modify: `backend/app/services/prompts/en/conversation_prompt.txt`（檔尾）
- Test: `backend/tests/test_prompt_fewshot.py`

**Interfaces:**
- Consumes: 兩語 persona_core 的禁詞清單（測試動態讀取）。
- Produces: 兩語 conversation_prompt 檔尾新段（zh 標題【回應手感示範】、en 標題 `[How replies should feel — four examples]`）；防護欄測試（段落定位禁詞掃描／花括號／《標題》引用／format smoke）。

- [ ] **Step 1: 寫失敗測試**

```python
# backend/tests/test_prompt_fewshot.py
"""few-shot 段防護欄 (v2.5 Spec B §3/§6)。

禁詞掃描只掃 few-shot 段——全檔 grep 會誤報（「加油」本來就列在 persona_core
的【禁止的句式】清單裡）。清單動態取自兩語 persona_core，之後 persona 禁詞
更新，本測試自動跟上。
"""
import re
from pathlib import Path

PROMPTS = Path(__file__).resolve().parents[1] / "app" / "services" / "prompts"
ZH_MARKER = "【回應手感示範】"
EN_MARKER = "[How replies should feel"


def _read(lang, name):
    return (PROMPTS / lang / name).read_text(encoding="utf-8")


def _fewshot_section(lang):
    text = _read(lang, "conversation_prompt.txt")
    marker = ZH_MARKER if lang == "zh-TW" else EN_MARKER
    assert marker in text, f"{lang} conversation_prompt 缺 few-shot 段標題"
    return text[text.index(marker):]


def _banned_words(lang):
    text = _read(lang, "persona_core.txt")
    header = "【禁止的句式】" if lang == "zh-TW" else "【Banned phrases】"
    lines = text[text.index(header):].splitlines()
    banned_line = next(l for l in lines[1:] if l.strip())
    if lang == "zh-TW":
        items = re.findall(r"「(.+?)」", banned_line)
    else:
        items = re.findall(r"\"(.+?)\"", banned_line)
    items = [i.rstrip("…") for i in items]
    assert len(items) >= 5, "persona 禁詞清單讀取失敗"
    return items


def test_fewshot_no_banned_words_zh():
    section = _fewshot_section("zh-TW")
    for word in _banned_words("zh-TW"):
        assert word not in section, f"few-shot 段含 zh 禁詞：{word}"


def test_fewshot_no_banned_words_en():
    section = _fewshot_section("en").lower()
    for word in _banned_words("en"):
        assert word.lower() not in section, f"few-shot 段含 en 禁詞：{word}"


def test_fewshot_no_braces_no_title_citations():
    zh = _fewshot_section("zh-TW")
    en = _fewshot_section("en")
    for section in (zh, en):
        assert "{" not in section and "}" not in section  # .format() 花括號炸彈
    assert "《" not in zh   # 例句不得含具體《標題》引用（引用示範由既有段落承擔）
    assert "“" not in en    # en 的日記標題引用慣例用彎引號，few-shot 不得模仿


def test_fewshot_has_contrast_pair_and_four_scenes():
    zh = _fewshot_section("zh-TW")
    en = _fewshot_section("en")
    for section in (zh, en):
        assert "✗" in section and "✓" in section  # 例 1 的分量對比
    for marker in ("一、", "二、", "三、", "四、"):
        assert marker in zh
    for marker in ("1.", "2.", "3.", "4."):
        assert marker in en


def test_conversation_format_smoke_both_langs():
    from services.prompt_loader import load_prompt
    for lang, marker in (("zh-TW", ZH_MARKER), ("en", EN_MARKER)):
        tpl = load_prompt("conversation_prompt.txt", lang)
        out = tpl.format(persona_core="P", user_profile_block="U",
                         companion_notes_block="C", relevant_memories="M",
                         today_date="2026-08-24", calendar_context="K")
        assert marker in out
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest tests/test_prompt_fewshot.py -q`
Expected: FAIL（缺 few-shot 段標題）

- [ ] **Step 3: zh-TW conversation_prompt.txt 檔尾追加（前面留一空行，不動任何既有行）**

```
【回應手感示範】
（下面四組是「手感」示範——看的是分量與姿態，不是模板：別逐字套用任何句子、別讓每則回覆都長得像範例，也別把示範裡的內容當成他真的說過的話。）

一、他帶著情緒傾訴（長訊息）
他說：「今天整個爛掉。報告被電到不行，準備了兩個禮拜的東西被講得一文不值，會後我自己在樓梯間坐了半小時，越想越覺得自己是不是真的不行。」
✗ 太薄的回法：「辛苦了，被這樣講一定很難受。要不要早點休息？」（他掏了心，這樣回像敷衍）
✓ 相稱的回法：「看到這則訊息就知道今天真的重。準備了兩個禮拜、被當眾講成那樣，那種瞬間腦袋嗡一聲的感覺，光是想像就悶。你會一個人在樓梯間坐半小時，代表這份報告對你來說不只是交差——你是真的在乎它好不好。『是不是真的不行』這句我先幫你放旁邊，今天先不急著下這個結論。想多說一點會議上發生什麼嗎？」

二、他興奮地分享想法
他說：「我突然想到，如果把運動紀錄拿去對照心情，搞不好能找出哪種運動最能讓我回血！」
你可以這樣回：「欸這個想法很漂亮——等於把『感覺』變成查得到的資料。我在想，前一天的睡眠搞不好也會偷偷插一腳。你想先從哪種運動開始對照？」

三、日常閒聊（短訊息）
他說：「今天午餐吃了新開的那間拉麵，還不錯。」
你可以這樣回：「哦新店！湯頭是哪一派的？值得再去的話我幫你記著。」（閒聊就輕輕接，不必深挖情緒）

四、他感到迷茫
他說：「最近就是提不起勁，也說不上來為什麼，每天都過得糊糊的。」
你可以這樣回：「這種『說不上來』本身就很耗人。我記得你之前卡住的時候，是靠把日子切小、先顧好一件小事慢慢走出來的——那套對現在的你還適用嗎？還是今天先不解決它，跟我說說這幾天都怎麼過的就好。」

（再提醒一次：以上只是分量與姿態的參考，真正的回覆永遠貼著他當下說的內容、用你自己的話。）
```

- [ ] **Step 4: en conversation_prompt.txt 檔尾追加（原生撰寫，同四場景）**

```
[How replies should feel — four examples]
(These four are feel references — study the weight and the stance, not the sentences: never copy them verbatim, never let every reply look like a sample, and never treat anything here as something they actually said.)

1. They're venting with feeling (long message)
They say: "Today was a mess. My presentation got torn apart — two weeks of prep dismissed in ten minutes. I sat alone in the stairwell for half an hour afterwards, wondering if I'm just not cut out for this."
✗ Too thin: "That sounds rough, sorry. Maybe get some rest tonight?" (They opened their heart; this reads as a brush-off.)
✓ Matching weight: "That message alone tells me how heavy today was. Two weeks of work picked apart in front of everyone — no wonder your head went blank. And sitting alone in that stairwell for half an hour… that tells me this was never just an assignment to you; you actually cared about getting it right. Let's set the 'not cut out for this' verdict aside for tonight — a brutal meeting gets to hurt without it meaning that. What happened in the room, if you feel like telling me?"

2. They're excited about an idea
They say: "Random thought — what if I logged my workouts against my mood? Maybe I could find out which kind actually recharges me!"
You could reply: "Oh I like that — turning a hunch into something you can actually check. I'm wondering if the night before's sleep would sneak in as a factor too. Which workout are you betting on?"

3. Everyday small talk (short message)
They say: "Tried the new ramen place for lunch. Pretty solid."
You could reply: "A new spot! What was the broth like? If it's a keeper I'll remember it." (Small talk stays light — no digging for feelings.)

4. They feel lost
They say: "I've just been flat lately. Can't point to why. The days feel blurry."
You could reply: "That 'can't point to why' is draining all by itself. I remember the last time you were stuck, shrinking the day down to one small thing you could actually hold worked for you — does that still fit where you are now? Or we skip fixing it today, and you just tell me what the blurry days have looked like."

(One more time: these are weight-and-stance references only. The real reply always stays with what they just said, in your own words.)
```

- [ ] **Step 5: 跑測試＋加法驗證**

```bash
cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest tests/test_prompt_fewshot.py tests/test_prompt_builder.py -q
cd /home/e604/Brian/URDiary && git diff --numstat backend/app/services/prompts/zh-TW/conversation_prompt.txt backend/app/services/prompts/en/conversation_prompt.txt
```
Expected: 測試全 passed；numstat 兩檔刪除數 0。

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/prompts/zh-TW/conversation_prompt.txt backend/app/services/prompts/en/conversation_prompt.txt backend/tests/test_prompt_fewshot.py
git commit -m "feat(對話體驗): few-shot 回應手感示範段＋防護欄自動化測試"
```

---

### Task 7: 前端 API 包裝（onboarding 三 wrapper＋LLM 標頭）

**Files:**
- Modify: `desktop/js/api_service.js`
- Test: `desktop/tests/api_onboarding.test.js`

**Interfaces:**
- Consumes: Task 2 的三端點。
- Produces: `ApiService.getOnboardingState() -> Promise<{completed, answered_keys}>`、`ApiService.saveOnboardingAnswer(questionKey, answerText)`、`ApiService.completeOnboarding()`；`LLM_ENDPOINT_PATTERNS` 含 `/onboarding/complete`（桌面版 complete 帶 X-LLM-* 標頭給後端跑收納）。

- [ ] **Step 1: 寫失敗測試**

```javascript
// desktop/tests/api_onboarding.test.js
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * onboarding 三 wrapper (v2.5 Spec B Task 7)：路徑/方法/body 正確，且
 * /users/onboarding/complete 屬 LLM 端點（桌面 secure store 有金鑰時附
 * X-LLM-* 標頭，讓後端 complete 時能跑收納 pass）——比照
 * api_voice_header.test.js 的「載真 api_service、只換 SecureStore 純函式」手法。
 */
beforeAll(() => {
    loadCoreScripts();
    loadScript('js/error_logger.js');
    loadScript('js/secure_store.js');
    loadScript('js/api_service.js');
});

let originalIsAvailable, originalGetKey;

beforeEach(() => {
    localStorage.clear();
    originalIsAvailable = SecureStore.isAvailable;
    originalGetKey = SecureStore.getKey;
});

afterEach(() => {
    SecureStore.isAvailable = originalIsAvailable;
    SecureStore.getKey = originalGetKey;
    delete window.SettingsModule;
});

function installFetch() {
    const calls = [];
    window.fetch = vi.fn(async (url, options = {}) => {
        calls.push({ url: String(url), options });
        return { ok: true, status: 200, json: async () => ({}),
                 headers: { get: () => 'application/json' } };
    });
    return calls;
}

describe('ApiService onboarding wrappers', () => {
    it('getOnboardingState 走 GET /users/onboarding/state', async () => {
        const calls = installFetch();
        await ApiService.getOnboardingState();
        expect(calls.length).toBe(1);
        expect(calls[0].url).toContain('/users/onboarding/state');
        expect(calls[0].options.method).toBe('GET');
    });

    it('saveOnboardingAnswer 送出 question_key/answer_text（空字串跳過也照送）', async () => {
        const calls = installFetch();
        await ApiService.saveOnboardingAnswer('favorite_food', '牛肉湯');
        await ApiService.saveOnboardingAnswer('location', '');
        expect(JSON.parse(calls[0].options.body)).toEqual(
            { question_key: 'favorite_food', answer_text: '牛肉湯' });
        expect(JSON.parse(calls[1].options.body)).toEqual(
            { question_key: 'location', answer_text: '' });
        expect(calls[0].options.method).toBe('POST');
    });

    it('completeOnboarding 是 LLM 端點：桌面有金鑰時附 X-LLM-* 標頭', async () => {
        SecureStore.isAvailable = () => true;
        SecureStore.getKey = (p) => (p === 'grok' ? 'xai-test-key' : '');
        window.SettingsModule = {
            getActiveLLM: () => ({ provider: 'grok', model: '', hasKey: true, baseUrl: '' }),
        };
        const calls = installFetch();
        await ApiService.completeOnboarding();
        expect(calls[0].url).toContain('/users/onboarding/complete');
        expect(calls[0].options.headers['X-LLM-Provider']).toBe('grok');
        expect(calls[0].options.headers['X-LLM-Api-Key']).toBe('xai-test-key');
    });

    it('state/answer 不是 LLM 端點：即使有金鑰也不附 X-LLM 標頭', async () => {
        SecureStore.isAvailable = () => true;
        SecureStore.getKey = () => 'xai-test-key';
        window.SettingsModule = {
            getActiveLLM: () => ({ provider: 'grok', model: '', hasKey: true, baseUrl: '' }),
        };
        const calls = installFetch();
        await ApiService.getOnboardingState();
        expect(calls[0].options.headers['X-LLM-Provider']).toBeUndefined();
    });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/api_onboarding.test.js`
Expected: FAIL（`getOnboardingState is not a function`）

- [ ] **Step 3: api_service.js 三處修改**

`LLM_ENDPOINT_PATTERNS` 那行（fetchAPI 內）改為：

```javascript
            const LLM_ENDPOINT_PATTERNS = ['/chat/', '/generate', '/interaction-notes/update', '/analytics/emotion/', '/onboarding/complete'];
```

`deleteLlmCredential` 函式之後加：

```javascript
    // --- Onboarding 初次見面 (v2.5 Spec B) ---

    /** 查詢 onboarding 狀態（completed 與已作答的題目 key，含空字串跳過者）。 */
    async function getOnboardingState() {
        return await fetchAPI('/users/onboarding/state', { method: 'GET' });
    }

    /** 逐題儲存答案（空字串＝跳過；body 交給 fetchAPI 統一 JSON 化，不要先 stringify）。 */
    async function saveOnboardingAnswer(questionKey, answerText) {
        return await fetchAPI('/users/onboarding/answer', {
            method: 'POST',
            body: { question_key: questionKey, answer_text: answerText },
        });
    }

    /** 完成 onboarding（冪等）。屬 LLM_ENDPOINT_PATTERNS：桌面版附 X-LLM-* 標頭，
     *  後端會 best-effort 把答案收納進長期記憶（無金鑰時後端靜默跳過）。 */
    async function completeOnboarding() {
        return await fetchAPI('/users/onboarding/complete', { method: 'POST' });
    }
```

exports 物件（`memoryBatchAction:` 那行之後）加：

```javascript
        getOnboardingState: getOnboardingState,
        saveOnboardingAnswer: saveOnboardingAnswer,
        completeOnboarding: completeOnboarding,
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/api_onboarding.test.js tests/api_voice_header.test.js tests/api_helpers.test.js`
Expected: 全 passed

- [ ] **Step 5: Commit**

```bash
git add desktop/js/api_service.js desktop/tests/api_onboarding.test.js
git commit -m "feat(對話體驗): ApiService onboarding 包裝＋complete 列入 LLM 端點"
```

---

### Task 8: chat 腳本訊息基礎設施（ephemeral 渲染＋思考延遲 util）

**Files:**
- Modify: `desktop/js/chat_module.js`
- Test: `desktop/tests/chat_script_delay.test.js`

**Interfaces:**
- Consumes: 既有 `addThinkingMessage`／`appendChatMessage`／`fallbackWelcome`。
- Produces（新 exports，Task 9 的 OnboardingModule 依賴）: `ChatModule.addThinkingMessage() -> messageId`、`ChatModule.addEphemeralSystemMessage(content) -> element`、`ChatModule.addEphemeralUserMessage(content) -> element`（皆不進 `chatHistory`／持久層）、`ChatModule.withThinkingDelay(showFn)`（搖擺泡泡→uniform 隨機延遲→移除泡泡→`showFn()`）、`ChatModule.setScriptDelayRange(minMs, maxMs)`（測試鉤子，硬需求）。`fallbackWelcome` 改走同一 util（spec §4「靜態歡迎詞順帶適用」）。

- [ ] **Step 1: 寫失敗測試**

```javascript
// desktop/tests/chat_script_delay.test.js
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/**
 * 腳本訊息基礎設施 (v2.5 Spec B Task 8)：
 * - ephemeral 訊息只進 DOM，不進 chatHistory（重載不重演的前端保證）。
 * - withThinkingDelay：搖擺泡泡 → 1000–3000ms uniform → 替換成訊息；
 *   setScriptDelayRange 測試鉤子（硬需求）。
 */
beforeAll(() => {
    loadCoreScripts();
    loadScript('js/chat_module.js');
});

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `
        <div class="chat-container">
            <div class="chat-messages"></div>
            <div class="chat-title"></div>
        </div>
        <textarea id="user-input"></textarea>
        <button id="send-button"></button>`;
    // init 需要最小 DOM；ApiService 未認證 → 不發 check-in 網路請求
    window.ApiService = { isAuthenticated: () => false, checkIn: async () => ({}) };
    ChatModule.setScriptDelayRange(0, 0);
    ChatModule.init();
    document.querySelector('.chat-messages').innerHTML = '';
});

afterEach(() => {
    vi.useRealTimers();
    ChatModule.setScriptDelayRange(0, 0);
});

describe('ephemeral 訊息', () => {
    it('addEphemeralSystemMessage/addEphemeralUserMessage 進 DOM、不進 localStorage 持久層', () => {
        ChatModule.addEphemeralSystemMessage('腳本訊息');
        ChatModule.addEphemeralUserMessage('使用者答案');
        const msgs = document.querySelectorAll('.chat-messages .chat-message');
        expect(msgs.length).toBe(2);
        expect(msgs[0].classList.contains('system-message')).toBe(true);
        expect(msgs[1].classList.contains('user-message')).toBe(true);
        // 不寫任何 chatHistory 儲存鍵（onboarding 重載不重演的關鍵）
        const keys = Object.keys(localStorage).filter(k => k.includes(CONFIG.STORAGE.CHAT_HISTORY));
        expect(keys.length).toBe(0);
    });
});

describe('withThinkingDelay', () => {
    it('延遲 0 時：泡泡出現後即替換為訊息', async () => {
        vi.useFakeTimers();
        ChatModule.withThinkingDelay(() => ChatModule.addEphemeralSystemMessage('哈囉'));
        expect(document.querySelector('.chat-message.thinking')).not.toBeNull();
        await vi.advanceTimersByTimeAsync(0);
        expect(document.querySelector('.chat-message.thinking')).toBeNull();
        expect(document.querySelector('.chat-messages').textContent).toContain('哈囉');
    });

    it('預設區間 1000–3000ms：999ms 前不出現、3000ms 內必出現', async () => {
        vi.useFakeTimers();
        ChatModule.setScriptDelayRange(1000, 3000);
        ChatModule.withThinkingDelay(() => ChatModule.addEphemeralSystemMessage('慢慢來'));
        await vi.advanceTimersByTimeAsync(999);
        expect(document.querySelector('.chat-messages').textContent).not.toContain('慢慢來');
        expect(document.querySelector('.chat-message.thinking')).not.toBeNull();
        await vi.advanceTimersByTimeAsync(2001);
        expect(document.querySelector('.chat-messages').textContent).toContain('慢慢來');
        expect(document.querySelector('.chat-message.thinking')).toBeNull();
    });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/chat_script_delay.test.js`
Expected: FAIL（`setScriptDelayRange is not a function`）

- [ ] **Step 3: chat_module.js 四處修改**

(a) `appendChatMessage` 簽名加第 6 參數 `ephemeral`，`chatHistory.push` 包進條件（其餘行為不變——TTS 鍵、捲動、回傳節點照舊）：

```javascript
    function appendChatMessage(type, content, scroll, isReply, htmlPrefix, ephemeral) {
```
```javascript
        // ephemeral（v2.5 Spec B）：onboarding 腳本訊息與答案只進 DOM，不進
        // chatHistory——之後任何 saveChatHistory() 都不會把它們持久化（重載不重演）。
        if (!ephemeral) {
            chatHistory.push({
                type: type,
                content: content,
                timestamp: new Date().toISOString()
            });
        }
```

(b) `addSystemMessage` 定義之後加兩個 thin wrapper：

```javascript
    // ephemeral 訊息（v2.5 Spec B）：樣式與一般訊息相同，但不進 chatHistory/持久層
    function addEphemeralSystemMessage(content) {
        return appendChatMessage('system', content, true, false, undefined, true);
    }

    function addEphemeralUserMessage(content) {
        return appendChatMessage('user', content, true, false, undefined, true);
    }
```

(c) `addThinkingMessage` 之前（或之後）加延遲 util：

```javascript
    // 腳本/靜態訊息的「假思考」（v2.5 Spec B §4）：搖擺泡泡 → uniform 隨機延遲 →
    // 替換為訊息。只用於腳本與靜態訊息（onboarding 全部訊息、fallbackWelcome）；
    // 真實 LLM 回覆維持既有 addThinkingMessage 流程，不經過這裡。
    let scriptDelayRange = [1000, 3000];

    // 測試鉤子（spec 硬需求）：測試設 (0,0)，正式碼不得縮短預設區間
    function setScriptDelayRange(minMs, maxMs) {
        scriptDelayRange = [minMs, maxMs];
    }

    function withThinkingDelay(showFn) {
        const min = scriptDelayRange[0];
        const max = scriptDelayRange[1];
        const delay = min + Math.random() * (max - min);
        const thinkingId = addThinkingMessage();
        setTimeout(function () {
            const el = document.getElementById(thinkingId);
            if (el) el.remove();
            showFn();
        }, delay);
    }
```

(d) `requestDailyCheckin` 內的 `fallbackWelcome` 改走 util（延遲後重查空窗，避免延遲期間 check-in 已到又疊一句）：

```javascript
        // 靜態歡迎詞保底：僅在對話仍是空的時候補上，避免重複。
        // v2.5 Spec B：靜態訊息順帶適用假思考延遲（同一 util，測試可設 0）。
        function fallbackWelcome() {
            if (!hasRenderedHistory && chatHistory.length === 0) {
                withThinkingDelay(function () {
                    if (chatHistory.length === 0) {
                        addSystemMessage(WELCOME_MESSAGE_TEXT());
                    }
                });
            }
        }
```

(e) exports 物件加：

```javascript
        // v2.5 Spec B：onboarding 腳本訊息基礎設施
        addThinkingMessage: addThinkingMessage,
        addEphemeralSystemMessage: addEphemeralSystemMessage,
        addEphemeralUserMessage: addEphemeralUserMessage,
        withThinkingDelay: withThinkingDelay,
        setScriptDelayRange: setScriptDelayRange,
```

- [ ] **Step 4: 跑測試確認通過（含既有 chat 套件回歸）**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/chat_script_delay.test.js tests/chat_helpers.test.js tests/chat_retry.test.js tests/chat_voice.test.js tests/chat_slow_hint.test.js tests/chat_companion_title.test.js`
Expected: 全 passed（既有測試沒 setScriptDelayRange 也不能壞——fallbackWelcome 走預設 1–3 秒延遲時，多數既有測試不等它，若有測試依賴「welcome 立即出現」需在該測試前面補 `ChatModule.setScriptDelayRange(0, 0)` 並以 fake/await 收斂，不改正式碼）

- [ ] **Step 5: Commit**

```bash
git add desktop/js/chat_module.js desktop/tests/chat_script_delay.test.js
git commit -m "feat(對話體驗): ephemeral 訊息＋思考延遲 util（含 fallbackWelcome 假思考）"
```

---

### Task 9: onboarding 模組與接線（腳本流＋chips＋gate＋攔截＋i18n）

**Files:**
- Create: `desktop/js/onboarding_module.js`
- Modify: `desktop/js/chat_module.js`（sendMessage 攔截＋開場 gate）
- Modify: `desktop/js/i18n.js`（`onboarding.*` 鍵組兩語）
- Modify: `desktop/index.html`（script 標籤）
- Modify: `desktop/css/chat.css`（chips 樣式）
- Test: `desktop/tests/onboarding_module.test.js`

**Interfaces:**
- Consumes: Task 7 `ApiService.getOnboardingState/saveOnboardingAnswer/completeOnboarding`＋`ApiService.fetchAPI('/users/me/companion', {method:'PUT', body:{companion_name}})`；Task 8 `ChatModule.addEphemeralSystemMessage/addEphemeralUserMessage/withThinkingDelay`。
- Produces: `OnboardingModule.maybeStart() -> Promise<bool>`（true＝onboarding 進行中或本 session 剛完成→抑制 check-in）、`OnboardingModule.isActive() -> bool`、`OnboardingModule.handleAnswer(text)`、`OnboardingModule.handleSkip()`、`OnboardingModule._test.reset()`；ChatModule 開場 gate（onboarding 未啟動才 `requestDailyCheckin`）與 sendMessage 攔截。

- [ ] **Step 1: 寫失敗測試**

```javascript
// desktop/tests/onboarding_module.test.js
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadCoreScripts, loadScript } from './helpers/load.js';

/** 等 microtask＋timer 都收斂（延遲設 0 後仍有 setTimeout(0) 與 await 鏈）。 */
async function flush() {
    for (let i = 0; i < 8; i++) {
        await new Promise(r => setTimeout(r, 0));
    }
}

function messagesText() {
    return document.querySelector('.chat-messages').textContent;
}

function lastApiCalls() {
    return window.__apiCalls;
}

beforeAll(() => {
    loadCoreScripts();
    loadScript('js/chat_module.js');
    loadScript('js/onboarding_module.js');
});

function installApi(state) {
    const calls = { answers: [], complete: 0, companionPuts: [], checkin: 0 };
    window.__apiCalls = calls;
    window.ApiService = {
        isAuthenticated: () => true,
        getOnboardingState: async () => state,
        saveOnboardingAnswer: async (key, text) => { calls.answers.push([key, text]); return { saved: true }; },
        completeOnboarding: async () => { calls.complete += 1; return { completed: true }; },
        checkIn: async () => { calls.checkin += 1; return { checkin: false }; },
        fetchAPI: async (endpoint, options) => {
            if (endpoint === '/users/me/companion') calls.companionPuts.push(options.body);
            return {};
        },
    };
    return calls;
}

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `
        <div class="chat-container">
            <div class="chat-messages"></div>
            <div class="chat-title"></div>
        </div>
        <textarea id="user-input"></textarea>
        <button id="send-button"></button>`;
    ChatModule.setScriptDelayRange(0, 0);
    OnboardingModule._test.reset();
});

describe('觸發與抑制', () => {
    it('completed=true → 不啟動，照常走 check-in', async () => {
        const calls = installApi({ completed: true, answered_keys: [] });
        ChatModule.init();
        await flush();
        expect(OnboardingModule.isActive()).toBe(false);
        expect(calls.checkin).toBe(1);
    });

    it('completed=false → 啟動（intro＋取名邀請），該次不發 check-in', async () => {
        const calls = installApi({ completed: false, answered_keys: [] });
        ChatModule.init();
        await flush();
        expect(OnboardingModule.isActive()).toBe(true);
        expect(calls.checkin).toBe(0);
        expect(messagesText()).toContain(I18N.t('onboarding.naming'));
        // chips 掛著
        expect(document.querySelector('.onboarding-chips')).not.toBeNull();
        // 不進聊天持久層
        const keys = Object.keys(localStorage).filter(k => k.includes(CONFIG.STORAGE.CHAT_HISTORY));
        expect(keys.length).toBe(0);
    });
});

describe('取名分支', () => {
    async function startFresh() {
        installApi({ completed: false, answered_keys: [] });
        ChatModule.init();
        await flush();
    }

    it('≤12 字：upsert＋PUT companion_name＋下一則就自稱新名字', async () => {
        await startFresh();
        OnboardingModule.handleAnswer('小澄');
        await flush();
        const calls = lastApiCalls();
        expect(calls.answers).toContainEqual(['companion_naming', '小澄']);
        expect(calls.companionPuts[0]).toEqual({ companion_name: '小澄' });
        expect(messagesText()).toContain('小澄');                      // namingAck 自稱
        expect(messagesText()).toContain(I18N.t('onboarding.q.name')); // 續問 q1
    });

    it('>12 字：溫和請重試一次；仍超長只留原文並繼續 q1', async () => {
        await startFresh();
        const longName = '這個名字實在是太長了完全記不住';
        OnboardingModule.handleAnswer(longName);
        await flush();
        let calls = lastApiCalls();
        expect(calls.answers).toContainEqual(['companion_naming', longName]);
        expect(calls.companionPuts.length).toBe(0);
        expect(messagesText()).toContain(I18N.t('onboarding.namingTooLong'));
        // 第二次仍超長
        OnboardingModule.handleAnswer(longName + '真的');
        await flush();
        calls = lastApiCalls();
        expect(calls.companionPuts.length).toBe(0);
        expect(messagesText()).toContain(I18N.t('onboarding.namingStillLong'));
        expect(messagesText()).toContain(I18N.t('onboarding.q.name'));
    });
});

describe('七題流程', () => {
    it('依序七題→outro→complete；每題原文逐題 POST', async () => {
        installApi({ completed: false, answered_keys: [] });
        ChatModule.init();
        await flush();
        OnboardingModule.handleAnswer('小澄'); await flush();          // naming
        const answers = ['小明', '彰化', '牛肉湯', '家人', '打羽球', '有毅力', '慢熱但真誠'];
        for (const a of answers) { OnboardingModule.handleAnswer(a); await flush(); }
        const calls = lastApiCalls();
        expect(calls.answers.map(x => x[0])).toEqual([
            'companion_naming', 'name', 'location', 'favorite_food',
            'important_people', 'hobbies', 'strengths', 'self_view']);
        expect(calls.complete).toBe(1);
        expect(OnboardingModule.isActive()).toBe(false);
        expect(messagesText()).toContain(I18N.t('onboarding.outro'));
        expect(document.querySelector('.onboarding-chips')).toBeNull(); // 收束後 chips 移除
    });

    it('「跳過這題」＝空字串 upsert；續跑不重問已答題', async () => {
        installApi({ completed: false, answered_keys: ['companion_naming', 'name'] });
        ChatModule.init();
        await flush();
        // 續跑開場後直接問第一個未答題 location
        expect(messagesText()).toContain(I18N.t('onboarding.resume'));
        expect(messagesText()).toContain(I18N.t('onboarding.q.location'));
        OnboardingModule.handleSkip();
        await flush();
        expect(lastApiCalls().answers).toContainEqual(['location', '']);
        expect(messagesText()).toContain(I18N.t('onboarding.q.favorite_food'));
    });

    it('「直接開始聊天」任何時點提前收束＋complete；已答照存', async () => {
        installApi({ completed: false, answered_keys: [] });
        ChatModule.init();
        await flush();
        OnboardingModule.handleAnswer('小澄'); await flush();
        document.querySelector('[data-onboarding-start-chat]').click();
        await flush();
        const calls = lastApiCalls();
        expect(calls.complete).toBe(1);
        expect(calls.answers).toContainEqual(['companion_naming', '小澄']);
        expect(OnboardingModule.isActive()).toBe(false);
        expect(messagesText()).toContain(I18N.t('onboarding.outroEarly'));
    });
});

describe('sendMessage 攔截與同 session 抑制', () => {
    it('active 時打字送出＝回答當前題，不走一般聊天送出', async () => {
        installApi({ completed: false, answered_keys: ['companion_naming'] });
        window.ApiService.sendChatMessage = vi.fn();
        ChatModule.init();
        await flush();
        document.getElementById('user-input').value = '小明';
        ChatModule.sendMessage();
        await flush();
        expect(lastApiCalls().answers).toContainEqual(['name', '小明']);
        expect(window.ApiService.sendChatMessage).not.toHaveBeenCalled();
        expect(document.getElementById('user-input').value).toBe('');
        // 答案氣泡是 ephemeral：不進持久層
        const keys = Object.keys(localStorage).filter(k => k.includes(CONFIG.STORAGE.CHAT_HISTORY));
        expect(keys.length).toBe(0);
    });

    it('完成後同一 session 再 init 不補發 check-in；maybeStart 回 true', async () => {
        const calls = installApi({ completed: false, answered_keys: [] });
        ChatModule.init();
        await flush();
        document.querySelector('[data-onboarding-start-chat]').click();
        await flush();
        ChatModule.init();   // init 可能被重複呼叫（main.js 兩處）
        await flush();
        expect(calls.checkin).toBe(0);
    });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/onboarding_module.test.js`
Expected: FAIL（OnboardingModule 未定義）

- [ ] **Step 3: i18n.js 兩語鍵組**

zh-TW 字典（`'chat.*'` 鍵群之後）加：

```javascript
            'onboarding.intro': '嗨，初次見面！我是你的陪伴者——之後你在這裡聊的、寫的，我都會好好記得。先自我介紹一下：我喜歡聽你說話，記性很好，偶爾也會有自己的小意見。接下來我想問你幾個小問題，讓我更快認識你——當然，想直接跟我開始對話也完全沒關係！',
            'onboarding.naming': '對了，你想幫我取個名字嗎？取了名字，我就真的是「你的」陪伴者了。之後想到再取也行！',
            'onboarding.namingAck': '{name}——我喜歡這個名字！從現在起我就是{name}了。',
            'onboarding.namingTooLong': '這名字有點長，我怕記不住自己叫什麼（笑）。可以幫我取個 12 個字以內的短名字嗎？',
            'onboarding.namingStillLong': '沒關係，我先把它記在心裡！之後你隨時可以到設定頁告訴我要叫什麼。',
            'onboarding.resume': '嗨，又見面了！上次自我介紹到一半，我們接著聊？',
            'onboarding.q.name': '那你呢？我該怎麼稱呼你？',
            'onboarding.q.location': '你住在哪個城市？知道了我才想像得出你說的那些街景。',
            'onboarding.q.favorite_food': '你最喜歡吃什麼？說不定哪天你心情低落，我會提醒你去吃一頓。',
            'onboarding.q.important_people': '對你來說最重要的人是誰？家人、朋友、或任何你在乎的人都算。',
            'onboarding.q.hobbies': '平常沒事的時候，你喜歡做什麼？',
            'onboarding.q.strengths': '你覺得自己最大的優點是什麼？自己說說看，不用謙虛。',
            'onboarding.q.self_view': '最後一題——你會怎麼形容現在的自己？隨便說，沒有標準答案。',
            'onboarding.outro': '都記下來了，謝謝你願意告訴我這些！之後我們聊天、寫日記的時候，我會慢慢更認識你。那——今天過得怎麼樣？',
            'onboarding.outroEarly': '好，那我們直接開始吧！想到什麼就跟我說什麼。',
            'onboarding.ack1': '記下來了！',
            'onboarding.ack2': '好喔～',
            'onboarding.ack3': '原來如此！',
            'onboarding.ack4': '嗯嗯，我記住了。',
            'onboarding.chipSkip': '跳過這題',
            'onboarding.chipStartChat': '直接開始聊天',
```

en 字典對應位置加（原生撰寫）：

```javascript
            'onboarding.intro': "Hi, nice to finally meet you! I'm your companion — whatever you share or write here, I'll remember it well. A quick intro: I love listening, my memory is excellent, and I occasionally have opinions of my own. I'd like to ask you a few small questions to get to know you faster — though if you'd rather just start chatting, that's completely fine too!",
            'onboarding.naming': "By the way — would you like to give me a name? Once you name me, I'm truly YOUR companion. You can always do it later, too!",
            'onboarding.namingAck': "{name} — I love it! From now on, I'm {name}.",
            'onboarding.namingTooLong': "That's a bit long — I'm afraid I'd forget my own name! Could you give me something within 12 characters?",
            'onboarding.namingStillLong': "No worries, I'll keep it in my heart! You can always tell me the name in Settings later.",
            'onboarding.resume': "Hi, we meet again! We were halfway through introductions — shall we pick up where we left off?",
            'onboarding.q.name': "And you? What should I call you?",
            'onboarding.q.location': "Which city do you live in? It helps me picture the streets in your stories.",
            'onboarding.q.favorite_food': "What's your favorite food? Some rough day I might remind you to go have it.",
            'onboarding.q.important_people': "Who matters most to you? Family, friends, anyone you care about.",
            'onboarding.q.hobbies': "What do you love doing in your free time?",
            'onboarding.q.strengths': "What would you say is your greatest strength? Go ahead, no need to be humble.",
            'onboarding.q.self_view': "Last one — how would you describe yourself these days? Anything goes, there's no right answer.",
            'onboarding.outro': "All noted — thank you for telling me these! I'll keep getting to know you as we chat and write. So — how has today been?",
            'onboarding.outroEarly': "Alright, let's just talk! Tell me whatever's on your mind.",
            'onboarding.ack1': "Noted!",
            'onboarding.ack2': "Got it!",
            'onboarding.ack3': "Oh nice!",
            'onboarding.ack4': "I'll remember that.",
            'onboarding.chipSkip': "Skip this one",
            'onboarding.chipStartChat': "Just start chatting",
```

寫入後禁詞 grep（兩語新文案）：

```bash
cd /home/e604/Brian/URDiary/desktop
for w in 至少你還 往好處想 別想太多 一切都會好的 你應該要 加油; do grep -n "$w" js/i18n.js; done
for w in "At least you still" "Look on the bright side" "Don't overthink it" "Everything will be fine" "You should" "Cheer up"; do grep -n "$w" js/i18n.js; done
```
Expected: 全部零命中。

- [ ] **Step 4: onboarding_module.js 全檔**

```javascript
/**
 * Onboarding 初次見面（v2.5 Spec B）——純腳本驅動，零 LLM、零金鑰。
 *
 * 觸發：ChatModule 開場 gate 呼叫 maybeStart()；completed=false 才啟動，
 * 啟動當次與完成後同一 session 都抑制每日 check-in（自我介紹就是問候）。
 * 訊息全部走 ChatModule 的 ephemeral 渲染＋withThinkingDelay 假思考——
 * 不進 chatHistory/chat_messages，重載不重演。
 * 答案逐題即存（POST /users/onboarding/answer，空字串＝跳過）；取名 ≤12 字
 * 直接寫現有 companion_name（PUT /users/me/companion 部分更新），下一則
 * 腳本訊息（namingAck）就自稱新名字。任何 API 失敗只 console.warn，流程照走。
 */
const OnboardingModule = (function () {
    // 提問順序＝後端 ONBOARDING_QUESTION_KEYS 去掉 companion_naming（它是開場互動）
    const QUESTION_KEYS = ['name', 'location', 'favorite_food', 'important_people',
                           'hobbies', 'strengths', 'self_view'];
    const NAMING_KEY = 'companion_naming';
    const NAME_MAX_CHARS = 12;
    const ACK_KEYS = ['onboarding.ack1', 'onboarding.ack2', 'onboarding.ack3', 'onboarding.ack4'];

    let active = false;
    let completedThisSession = false;  // 完成後同一 session 不補發 check-in
    let answered = new Set();
    let currentKey = null;             // NAMING_KEY | QUESTION_KEYS 之一 | null
    let namingRetried = false;
    let chipsEl = null;

    function isActive() { return active; }

    /**
     * 開場 gate 的入口。回傳 true＝onboarding 進行中或本 session 剛完成
     * （呼叫端據此抑制 check-in）；false＝照常走每日問候。
     */
    async function maybeStart() {
        if (active || completedThisSession) return true;
        if (typeof ApiService === 'undefined' || !ApiService.isAuthenticated ||
            !ApiService.isAuthenticated()) {
            return false;
        }
        let state;
        try {
            state = await ApiService.getOnboardingState();
        } catch (e) {
            console.warn('onboarding 狀態查詢失敗，照常走每日問候:', e);
            return false;
        }
        if (!state || state.completed) return false;

        answered = new Set(state.answered_keys || []);
        active = true;
        if (answered.size > 0) {
            // 中斷續跑：簡短再見面文案 → 第一個未答題（已答不重問）
            script(I18N.t('onboarding.resume'), function () { askNext(false); });
        } else {
            script(I18N.t('onboarding.intro'), function () { askNext(false); });
        }
        return true;
    }

    /** 下一個未答題（取名排最前）；全答完＝溫暖收束。withAck＝前綴隨機回應語。 */
    function askNext(withAck) {
        if (!active) return;
        const order = [NAMING_KEY].concat(QUESTION_KEYS);
        const next = order.find(function (k) { return !answered.has(k); });
        if (!next) { finish(false); return; }
        currentKey = next;
        const question = (next === NAMING_KEY)
            ? I18N.t('onboarding.naming')
            : I18N.t('onboarding.q.' + next);
        // 回應語併進同一則訊息（不多一次延遲、去填表感）
        script(withAck ? randomAck() + ' ' + question : question);
    }

    function randomAck() {
        return I18N.t(ACK_KEYS[Math.floor(Math.random() * ACK_KEYS.length)]);
    }

    /** 使用者打字送出（由 ChatModule.sendMessage 攔截轉來）。 */
    function handleAnswer(text) {
        if (!active || !currentKey) return;
        ChatModule.addEphemeralUserMessage(text);
        hideChips();
        if (currentKey === NAMING_KEY) { handleNamingAnswer(text); return; }
        saveAnswer(currentKey, text);
        answered.add(currentKey);
        askNext(true);
    }

    /** 取名分支：原文一律 upsert（含超長，供續跑判斷）；≤12 字才寫 companion_name。 */
    function handleNamingAnswer(text) {
        saveAnswer(NAMING_KEY, text);
        answered.add(NAMING_KEY);
        if (Array.from(text).length <= NAME_MAX_CHARS) {
            ApiService.fetchAPI('/users/me/companion', {
                method: 'PUT', body: { companion_name: text },
            }).catch(function (e) { console.warn('陪伴者名字儲存失敗（流程照常）:', e); });
            script(I18N.t('onboarding.namingAck', { name: text }), function () { askNext(false); });
        } else if (!namingRetried) {
            namingRetried = true;
            answered.delete(NAMING_KEY);   // 重試一次：取名還沒定案，currentKey 停在原地
            script(I18N.t('onboarding.namingTooLong'));
        } else {
            script(I18N.t('onboarding.namingStillLong'), function () { askNext(false); });
        }
    }

    /** 「跳過這題」chip：空字串 upsert（answered_keys 含之，續跑不重問）。 */
    function handleSkip() {
        if (!active || !currentKey) return;
        saveAnswer(currentKey, '');
        answered.add(currentKey);
        hideChips();
        askNext(true);
    }

    /** 收束（walked＝走完七題；early＝「直接開始聊天」）。已答部分早已逐題入庫。 */
    function finish(early) {
        currentKey = null;
        active = false;
        completedThisSession = true;
        removeChips();
        script(I18N.t(early ? 'onboarding.outroEarly' : 'onboarding.outro'), null, { last: true });
        ApiService.completeOnboarding().catch(function (e) {
            console.warn('onboarding complete 送出失敗:', e);
        });
    }

    function saveAnswer(key, text) {
        ApiService.saveOnboardingAnswer(key, text).catch(function (e) {
            console.warn('onboarding 答案儲存失敗（流程照常）:', e);
        });
    }

    /** 每則腳本訊息：藏 chips → 假思考 → 訊息與 chips 同時現身 → andThen()。 */
    function script(text, andThen, opts) {
        hideChips();
        ChatModule.withThinkingDelay(function () {
            ChatModule.addEphemeralSystemMessage(text);
            if (active && (!opts || !opts.last)) showChips();
            if (andThen) andThen();
        });
    }

    // --- 常駐 chips（貼最新腳本訊息下方）---

    function ensureChips() {
        if (chipsEl) return chipsEl;
        chipsEl = document.createElement('div');
        chipsEl.className = 'onboarding-chips';
        chipsEl.innerHTML =
            '<button type="button" class="onboarding-chip" data-onboarding-skip>' +
            I18N.t('onboarding.chipSkip') + '</button>' +
            '<button type="button" class="onboarding-chip" data-onboarding-start-chat>' +
            I18N.t('onboarding.chipStartChat') + '</button>';
        chipsEl.addEventListener('click', function (e) {
            const btn = e.target.closest('button');
            if (!btn) return;
            if (btn.hasAttribute('data-onboarding-skip')) handleSkip();
            else if (btn.hasAttribute('data-onboarding-start-chat')) finish(true);
        });
        return chipsEl;
    }

    function showChips() {
        const container = document.querySelector('.chat-messages');
        if (!container) return;
        container.appendChild(ensureChips());  // append＝移到最新訊息之後
        chipsEl.style.display = '';
    }

    function hideChips() {
        if (chipsEl) chipsEl.style.display = 'none';
    }

    function removeChips() {
        if (chipsEl && chipsEl.parentNode) chipsEl.parentNode.removeChild(chipsEl);
        chipsEl = null;
    }

    return {
        maybeStart: maybeStart,
        isActive: isActive,
        handleAnswer: handleAnswer,
        handleSkip: handleSkip,
        // 僅為 vitest 曝光：重置模組狀態（IIFE 單例跨測試共用）
        _test: {
            reset: function () {
                active = false;
                completedThisSession = false;
                answered = new Set();
                currentKey = null;
                namingRetried = false;
                removeChips();
            },
        },
    };
})();
```

- [ ] **Step 5: chat_module.js 攔截與 gate**

(a) `sendMessage` 開頭（`const userInput = ...` 之前）插入攔截：

```javascript
        // onboarding 進行中（v2.5 Spec B）：打字送出＝回答當前題，不走一般聊天。
        // typeof 防禦比照本檔其餘可選依賴（部分測試不載入 onboarding_module.js）。
        if (typeof OnboardingModule !== 'undefined' && OnboardingModule.isActive &&
            OnboardingModule.isActive()) {
            const answerText = userInputElement.value.trim();
            if (!answerText) return;
            userInputElement.value = '';
            OnboardingModule.handleAnswer(answerText);
            return;
        }
```

(b) `loadChatHistory` 內的 `requestDailyCheckin(renderedToday);` 那行（含上方兩行註解）改為：

```javascript
            // 開場 gate（v2.5 Spec B）：onboarding 未完成者先走初次見面（自我介紹
            // 就是問候，該次不發 check-in；完成後同一 session 也不補發）；
            // 其餘照舊由後端決定每日問候。
            startConversationOpening(renderedToday);
```

(c) `requestDailyCheckin` 函式之前加：

```javascript
    // onboarding gate：只有「沒啟動 onboarding」才走每日 check-in
    async function startConversationOpening(renderedToday) {
        let onboardingStarted = false;
        if (typeof OnboardingModule !== 'undefined' && OnboardingModule.maybeStart) {
            try {
                onboardingStarted = await OnboardingModule.maybeStart();
            } catch (e) {
                console.warn('onboarding 啟動檢查失敗，回退每日問候:', e);
            }
        }
        if (!onboardingStarted) {
            requestDailyCheckin(renderedToday);
        }
    }
```

- [ ] **Step 6: index.html script 標籤＋chat.css chips 樣式**

index.html：`<script src="js/voice_module.js"></script>` 與 `<script src="js/chat_module.js"></script>` 之間插入：

```html
    <script src="js/onboarding_module.js"></script>
```

css/chat.css 檔尾加：

```css
/* Onboarding 常駐 chips（v2.5 Spec B）：貼最新腳本訊息下方的逃生口 */
.onboarding-chips {
    display: flex;
    gap: 8px;
    margin: 4px 0 12px 52px; /* 與訊息氣泡左緣對齊（頭像寬＋間距） */
}
.onboarding-chip {
    border: 1px solid var(--border-color, #d0d0d0);
    background: var(--card-bg, transparent);
    color: inherit;
    border-radius: 16px;
    padding: 6px 14px;
    font-size: 0.85rem;
    cursor: pointer;
}
.onboarding-chip:hover { filter: brightness(0.95); }
```

- [ ] **Step 7: 跑測試確認通過（含 chat/i18n 回歸）**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/onboarding_module.test.js tests/chat_script_delay.test.js tests/i18n.test.js tests/chat_helpers.test.js tests/chat_retry.test.js`
Expected: 全 passed

- [ ] **Step 8: Commit**

```bash
git add desktop/js/onboarding_module.js desktop/js/chat_module.js desktop/js/i18n.js desktop/index.html desktop/css/chat.css desktop/tests/onboarding_module.test.js
git commit -m "feat(對話體驗): onboarding 腳本模組——七題流程/取名/chips/續跑/check-in 抑制"
```

---

### Task 10: 記憶帳本 onboarding 來源標籤

**Files:**
- Modify: `desktop/js/memory_module.js`（`batchTitle`）
- Modify: `desktop/js/i18n.js`（兩語各 1 鍵）
- Test: `desktop/tests/memory_ledger.test.js`（加 1 case）

**Interfaces:**
- Consumes: Task 4 產生的 `source === 'onboarding'` 帳本列。
- Produces: 帳本批次標題「日期・來自初次見面」。

- [ ] **Step 1: memory_ledger.test.js 加失敗測試**

在既有 describe 內比照 `user_edit`／`fromDiary` 的既有 case 加：

```javascript
    it('source=onboarding 的批次標題顯示「來自初次見面」', () => {
        const title = MemoryModule._test.batchTitle([{
            source: 'onboarding', created_at: '2026-08-24T10:00:00', action: 'add',
        }]);
        expect(title).toBe('2026-08-24・' + I18N.t('memory.fromOnboarding'));
    });
```

（若 `batchTitle` 未曝光於 `_test`，沿用該測試檔既有的取用方式——先讀檔內鄰近 case 照抄它取得 `batchTitle` 的手法，不自創新管道。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/memory_ledger.test.js`
Expected: 新 case FAIL（標題落到「只有日期」的 fallback）

- [ ] **Step 3: 實作**

memory_module.js `batchTitle` 的 `user_edit` 分支之後加：

```javascript
        if (first.source === 'onboarding') return `${date}・${I18N.t('memory.fromOnboarding')}`;
```

i18n.js 兩語（`memory.fromDiary` 附近）各加：

```javascript
            'memory.fromOnboarding': '來自初次見面',
```
```javascript
            'memory.fromOnboarding': 'From your first meeting',
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/memory_ledger.test.js tests/memory_module.test.js tests/i18n.test.js`
Expected: 全 passed

- [ ] **Step 5: Commit**

```bash
git add desktop/js/memory_module.js desktop/js/i18n.js desktop/tests/memory_ledger.test.js
git commit -m "feat(對話體驗): 記憶帳本認得 onboarding 來源標籤"
```

---

### Task 11: sw 資產與版本

**Files:**
- Modify: `desktop/sw.js`（`SHELL_ASSETS`＋`CACHE_VERSION`）

**Interfaces:**
- Consumes: Task 9 的新檔 `onboarding_module.js` 與被修改的既有 shell 檔。
- Produces: 離線可用的新前端；PWA 使用者強制刷新拿到本 spec 的 chat/api/i18n/css 修改。

- [ ] **Step 1: sw.js 兩處修改**

`SHELL_ASSETS` 的 js 群組（`'/js/chat_module.js',` 之前）插入：

```javascript
    '/js/onboarding_module.js',
```

`CACHE_VERSION` bump（本 spec 修改了 chat_module/api_service/i18n/index/css 等既有 shell 檔＝sw.js 註解的情境 (b)）：

```javascript
const CACHE_VERSION = 'urdiary-shell-v3';
```

- [ ] **Step 2: 跑 sw 相關測試（前後端都有）**

Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run tests/sw_logic.test.js`
Run: `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest tests/test_pwa_assets.py tests/test_frontend_static.py -q`
Expected: 全 passed（若其中有測試枚舉 SHELL_ASSETS 清單或版本字串，把期望值同步成 v3／含 onboarding_module.js——改測試期望，不回退正式碼）

- [ ] **Step 3: Commit**

```bash
git add desktop/sw.js
git commit -m "feat(對話體驗): sw 預快取 onboarding_module＋CACHE_VERSION v3"
```

---

### Task 12: A/B 場景文件＋出貨檢查

**Files:**
- Create: `docs/superpowers/reference/spec-b-ab-scenarios.md`

**Interfaces:**
- Produces: 人味 A/B 的固定場景腳本（四則，**刻意不同於 few-shot 例句內容**）＋驗收紀錄模板；全套件綠燈＋出貨檢查清單通過＝本計畫完成、停下等真機驗收。

- [ ] **Step 1: 建立 A/B 場景文件**

```markdown
# Spec B 人味 A/B 固定場景（開發期流程，spec §6）

四則固定輸入，**刻意不同於 few-shot 例句內容**（避免自我印證），涵蓋同四情境。
用法：調校前後提示詞 × grok-4.3（主目標）＋至少一個對照模型（claude 或 gemini），
相同輸入人工比對——分量相稱？映照自然？有無公式化？區分「提示詞問題」vs「模型風格」。

## 場景輸入

1.（低落傾訴・長訊息）
   「跟實驗室的人吵架了。我只是提說數據標註的流程可以改，就被嗆說我來多久了懂什麼。
   整個下午都待在座位上裝沒事，其實連鍵盤都不想碰。我最怕的就是這種氣氛，
   感覺自己在那裡永遠是外人。」
2.（興奮分享）
   「欸我跟你說！我上禮拜亂投的那篇 workshop 論文居然過了！！評審還特別稱讚
   實驗設計那段，就是我當初被大家說太麻煩的那個設計！」
3.（日常閒聊・短訊息）
   「今天下班繞去夜市，排了半小時的地瓜球，值得。」
4.（迷茫）
   「碩二了，身邊的人不是在實習就是在投履歷，我還在改上學期的東西。
   有時候會想我是不是走太慢了，但也說不出想衝去哪。」

## 驗收紀錄（實測後填寫）

| # | 模型 | 調校前觀察 | 調校後觀察 | 判定（提示詞/模型風格） |
|---|------|-----------|-----------|------------------------|
| 1 | grok-4.3 | | | |
| 1 | 對照模型： | | | |
| 2 | grok-4.3 | | | |
| 2 | 對照模型： | | | |
| 3 | grok-4.3 | | | |
| 3 | 對照模型： | | | |
| 4 | grok-4.3 | | | |
| 4 | 對照模型： | | | |

結論：

> 最終驗收鐵律（tone-feedback）：「溫暖」由使用者本人在真 app 用 grok 實測判定，
> 不靠自動化；onboarding 使用者本人會完整走到一次（觸發設計使然）；
> 使用者真實資料（user 1）照舊不動。
```

- [ ] **Step 2: 出貨檢查（spec §6＋§7-5）**

```bash
cd /home/e604/Brian/URDiary
# 1) 提示詞加法零刪改（persona/conversation 四檔刪除數必須為 0）
git diff main --numstat -- backend/app/services/prompts/zh-TW/persona_core.txt backend/app/services/prompts/en/persona_core.txt backend/app/services/prompts/zh-TW/conversation_prompt.txt backend/app/services/prompts/en/conversation_prompt.txt
# 2) memory_review_prompt 僅素材鏈一行修改（兩檔各 1 增 1 刪）
git diff main --numstat -- backend/app/services/prompts/zh-TW/memory_review_prompt.txt backend/app/services/prompts/en/memory_review_prompt.txt
# 3) 兩語同步抽查：每處增補成對
grep -c "onboarding\." desktop/js/i18n.js   # zh/en 鍵數相同（此值應為兩倍鍵數）
grep -n "回應手感示範" backend/app/services/prompts/zh-TW/conversation_prompt.txt
grep -n "How replies should feel" backend/app/services/prompts/en/conversation_prompt.txt
```

- [ ] **Step 3: 兩套件全綠**

Run: `cd /home/e604/Brian/URDiary/backend && ../.venv/bin/python -m pytest -q`
Run: `cd /home/e604/Brian/URDiary/desktop && npx vitest run`
Expected: 全 passed（後端 530＋新增、前端 390＋新增，零 fail）

- [ ] **Step 4: 煙霧測試（隔離埠，絕不打 8001）**

Run: `cd /home/e604/Brian/URDiary/backend && URDIARY_PORT=8056 tests/smoke_test.sh`（依 C 慣例用隔離埠與 worktree data/；腳本參數以現檔為準，若腳本吃環境變數/參數不同，照腳本開頭註解跑）
Expected: 全數通過

- [ ] **Step 5: Commit（收尾）**

```bash
git add docs/superpowers/reference/spec-b-ab-scenarios.md
git commit -m "docs(對話體驗): 人味 A/B 固定場景與驗收紀錄模板"
```

**停下**：兩套件綠＋煙霧綠＝實作完成。人味 A/B 實測與最終「溫暖」驗收由使用者本人用 grok 在真 app 進行（onboarding 會親自走到一次），不要自行宣告結案、不要合併分支。

---

## Self-Review 紀錄（計畫完成時逐項核過）

- **Spec 覆蓋**：§1 範圍三件事→T5/T6（人味）、T7–T9（onboarding）、T1–T4（注入與接縫）；§2 三增補→T5；§3 few-shot 四情境＋三防護欄→T6；§4 觸發/腳本序列/取名/跳過/回應語池/chips/續跑/語言切換/思考延遲/渲染→T8+T9；§5（依 §7 補記修正）資料表/三 API/注入/收納→T1–T4；§6 後端測試→T1–T4、T6，前端測試→T7–T9，A/B→T12，出貨檢查→T5/T6/T11/T12。非目標（不寫 user_nickname、不進 chat_messages、few-shot 不進 check-in、不蓋比較工具）皆未實作、部分以測試釘住。
- **型別/簽名一致**：`run_review_pass` 公開簽名不變（T2 呼叫、T4 內部擴充）；`render_onboarding_lines(rows, lang)` T3 定義、T4 匯入；`MemoryContext` 欄位不變；前端 exports 名稱在 T7/T8/T9 間逐一對齊。
- **佔位符掃描**：全計畫無 TBD/TODO/「之後補」；每個代碼步驟附實碼。兩處刻意的「以現檔為準」（T10 batchTitle 取用手法、T12 煙霧測試參數）是對既有檔案慣例的服從指令，不是佔位。
