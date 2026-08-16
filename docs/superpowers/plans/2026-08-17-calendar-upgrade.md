# 行事曆升級（v2.5 Spec A）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 月曆長出三件事——TimeTree 式跨天橫槓（可選色）、AI 在日記後自動蓋下的印章與小語（低落日改鼓勵）、年份快速跳轉。

**Architecture:** 後端在 calendar_events 加 nullable 的 end_date/color 並讓 occurrence 逐日展開帶 span 欄位；新表 day_notes 由 /chat/end 日記管線伺服器端寫入（JSON tail 搭便車，零額外 LLM 呼叫）。前端橫槓用「與月格同一個 CSS grid 的顯式定位項目」實現連續膠囊（蓋過格線、resize 免疫）；印章 SVG 全內嵌 MascotModule.stampIcon。

**Tech Stack:** FastAPI + SQLAlchemy + SQLite（ensure_schema：新欄位必 nullable）、vitest + pytest、手寫 inline SVG。

**Spec:** `docs/superpowers/specs/2026-08-17-calendar-upgrade-design.md`（§1–§6 已核可；印章 SVG 已逐屏核可，原稿 `.superpowers/brainstorm/1362750-1786915065/content/stamp-library-v3.html`，本計畫 Task 4 內嵌完整轉錄版）

## Global Constraints

- 測試指令：desktop `cd /home/e604/Brian/URDiary/desktop && npm test`（基線 327 綠）；backend `cd /home/e604/Brian/URDiary/backend && source venv/bin/activate && python -m pytest -q`（基線 435 綠）
- 印章寫入只發生在 `/chat/end/` 管線（`/diary/enhanced-generate` 與 `/diary/generate` 一律不寫）；情緒門檻 `valence < 0.45` 集中在 `services/day_stamp.py` 單一常數（與前端 mascot.js `QUIET_VALENCE_THRESHOLD`、api_service `getMoodFromValence` sad 界線同語意；註解標明未來由使用者的情緒識別模型替換）
- 跨天橫槓硬規則：連續膠囊蓋過日期分隔線，文字從首段連續流出，不逐格切段
- 跨天事件＝整天型（`end_date` ⇒ `event_time` NULL 且 `recurrence` "none"，違反 422/400）
- i18n 兩語成對；印章名以 v3 核可清單為準（四字 2+2 為主、五字可）
- `prefers-reduced-motion`：本計畫零新增動畫（印章/橫槓皆靜態）
- 無新檔案掛載——sw.js SHELL_ASSETS 不動（同步測試會自動驗證）
- 前端 guard 慣例沿用：`typeof MascotModule !== 'undefined'` ＋既有輸出 fallback（bare-load 測試相容）
- 色票：8 色 swatch = `#e8836f #f5c542 #5fd0a0 #7f96c9 #8f62c9 #e8899a #2a78d6 #b8b2a5`；橫槓預設色 = `var(--cat-<category>)`

---

### Task 1: 後端跨天事件（end_date/color 欄位＋驗證＋逐日展開）

**Files:**
- Modify: `backend/app/database/models.py`（CalendarEvent，:182-197 區塊）
- Modify: `backend/app/api/schemas.py`（CalendarEventCreate :33-51、CalendarEventUpdate :54-94）
- Modify: `backend/app/services/calendar_service.py`（EventSnapshot :42-45、snapshot_event :63-74、_expand_one :111-132、_occurrence_dict :213-228）
- Modify: `backend/app/api/routes/calendar.py`（create_event :56-73、update_event :109-151、_serialize_event :37-50）
- Modify: `backend/app/database/crud.py`（create_calendar_event :410-430）
- Modify: `backend/app/utils/messages.py`（"event_deleted" 區塊後加一鍵）
- Test: `backend/tests/test_calendar_api.py`、`backend/tests/test_calendar_service.py`（追加）

**Interfaces:**
- Produces（後續 task 依賴）：occurrence dict 新欄位 `end_date`（iso 或 None）、`color`（"#rrggbb" 或 None）、`span_day`（int 或 None）、`span_total`（int，單日=1）；`_serialize_event` 回傳含 `end_date`/`color`。

- [ ] **Step 1: 追加失敗測試（API 驗證矩陣＋展開）**

`backend/tests/test_calendar_api.py` 追加（沿用檔內 `_create_event`/`auth_header` 慣例）：

```python
# --- 跨天事件 (v2.5 Spec A) ---------------------------------------------------

def test_create_multi_day_event_roundtrip(client, auth_header):
    headers, _ = auth_header
    resp = _create_event(client, headers, title="台南旅行",
                         event_date="2026-09-01", end_date="2026-09-03",
                         color="#8f62c9")
    assert resp.status_code in (200, 201)
    event = resp.json()["event"]
    assert event["end_date"] == "2026-09-03"
    assert event["color"] == "#8f62c9"


def test_create_multi_day_rejects_end_before_start(client, auth_header):
    headers, _ = auth_header
    resp = _create_event(client, headers, event_date="2026-09-03", end_date="2026-09-01")
    assert resp.status_code == 422


def test_create_multi_day_rejects_event_time(client, auth_header):
    headers, _ = auth_header
    resp = _create_event(client, headers, event_date="2026-09-01",
                         end_date="2026-09-02", event_time="09:00")
    assert resp.status_code == 422


def test_create_multi_day_rejects_recurrence(client, auth_header):
    headers, _ = auth_header
    resp = _create_event(client, headers, event_date="2026-09-01",
                         end_date="2026-09-02", recurrence="weekly")
    assert resp.status_code == 422


def test_create_rejects_bad_color(client, auth_header):
    headers, _ = auth_header
    resp = _create_event(client, headers, color="red")
    assert resp.status_code == 422


def test_update_timed_event_to_multi_day_rejected(client, auth_header):
    """PUT 只送 end_date、庫內事件帶時間：schema 驗不到，路由層合併後必須擋 400。"""
    headers, _ = auth_header
    created = _create_event(client, headers, event_time="14:00").json()["event"]
    resp = client.put(f"/calendar/events/{created['event_id']}",
                      json={"end_date": "2026-08-06"}, headers=headers)
    assert resp.status_code == 400


def test_update_can_clear_end_date(client, auth_header):
    headers, _ = auth_header
    created = _create_event(client, headers, event_date="2026-09-01",
                            end_date="2026-09-03").json()["event"]
    resp = client.put(f"/calendar/events/{created['event_id']}",
                      json={"end_date": None}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["event"]["end_date"] is None
```

`backend/tests/test_calendar_service.py` 追加（`_ev` helper 不改——namedtuple 新欄位帶預設值，既有建構不受影響）：

```python
def test_multi_day_event_expands_each_day_with_span_fields():
    ev = _ev(event_date=date(2026, 9, 1), recurrence="none")._replace(
        end_date=date(2026, 9, 3), color="#8f62c9")
    occs = expand_occurrences([ev], date(2026, 8, 31), date(2026, 9, 30))
    assert [o["date"] for o in occs] == ["2026-09-01", "2026-09-02", "2026-09-03"]
    assert [o["span_day"] for o in occs] == [1, 2, 3]
    assert all(o["span_total"] == 3 for o in occs)
    assert all(o["color"] == "#8f62c9" for o in occs)
    assert all(o["end_date"] == "2026-09-03" for o in occs)


def test_multi_day_event_clips_to_query_range():
    ev = _ev(event_date=date(2026, 8, 30), recurrence="none")._replace(end_date=date(2026, 9, 2))
    occs = expand_occurrences([ev], date(2026, 9, 1), date(2026, 9, 30))
    assert [o["date"] for o in occs] == ["2026-09-01", "2026-09-02"]
    assert [o["span_day"] for o in occs] == [3, 4]   # span_day 以事件自身起日錨定，不受查詢窗影響


def test_single_day_event_has_null_span_day_and_total_one():
    occs = expand_occurrences([_ev()], date(2026, 8, 1), date(2026, 8, 31))
    assert occs[0]["span_day"] is None
    assert occs[0]["span_total"] == 1
    assert occs[0]["color"] is None
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /home/e604/Brian/URDiary/backend && source venv/bin/activate && python -m pytest tests/test_calendar_api.py tests/test_calendar_service.py -q`
Expected: 新測試 FAIL（422 未觸發＝欄位不存在被 Pydantic 拒收、`_replace` 沒有 end_date 欄位）。

- [ ] **Step 3: models.py——CalendarEvent 加兩欄（nullable）**

在 `reminder_minutes` 欄位行後插入：

```python
    end_date = Column(Date, nullable=True)    # 跨天事件結束日 (含當日)；NULL=單日。僅 recurrence="none" 的全天事件可設 (schema+路由雙層驗證)
    color = Column(String(7), nullable=True)  # 事件自選色 "#rrggbb"；NULL=前端用分類色 --cat-*
```

- [ ] **Step 4: schemas.py——Create/Update 加欄位與驗證**

`_EVENT_TIME_PATTERN` 行後加：

```python
_COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"
```

`CalendarEventCreate` 欄位區（`reminder_minutes` 後）加：

```python
    end_date: Optional[date] = None
    color: Optional[str] = Field(default=None, pattern=_COLOR_PATTERN)
```

`CalendarEventCreate` 追加第二個 validator（與既有 `_check_recurrence_until_not_before_event_date` 並列）：

```python
    @model_validator(mode="after")
    def _check_multi_day_rules(self):
        """跨天事件 (v2.5 Spec A) 是「整天型」專屬：帶 end_date 就不可帶
        event_time，也不可與重複規則並用 (spec §1 非目標)。end_date 早於
        event_date 的事件展開不出任何 occurrence，一併在入口擋下。"""
        if self.end_date is not None:
            if self.end_date < self.event_date:
                raise ValueError("end_date must not be before event_date")
            if self.event_time is not None:
                raise ValueError("multi-day events must be all-day (event_time must be null)")
            if self.recurrence != "none":
                raise ValueError("multi-day events cannot repeat (recurrence must be 'none')")
        return self
```

`CalendarEventUpdate` 欄位區加（皆可清空欄位——傳 null 即清掉跨天/自選色）：

```python
    end_date: Optional[date] = None
    color: Optional[str] = Field(default=None, pattern=_COLOR_PATTERN)
```

`CalendarEventUpdate` 追加 validator（比照既有 fields_set 風格；單邊缺席的完整檢查由路由層合併後把關，見 Step 6）：

```python
    @model_validator(mode="after")
    def _check_multi_day_rules_partial(self):
        """partial update：只有欄位真的出現在請求裡才驗得到 (exclude_unset 語意，
        比照上面 recurrence_until 的已知限制)。跨庫存值的完整不變量由路由層
        update_event 以「合併後狀態」檢查 (multi_day_invalid)，這裡只擋
        「同一請求內自相矛盾」的組合。"""
        fs = self.model_fields_set
        if 'end_date' in fs and self.end_date is not None:
            if ('event_date' in fs and self.event_date is not None
                    and self.end_date < self.event_date):
                raise ValueError("end_date must not be before event_date")
            if 'event_time' in fs and self.event_time is not None:
                raise ValueError("multi-day events must be all-day (event_time must be null)")
            if 'recurrence' in fs and self.recurrence is not None and self.recurrence != "none":
                raise ValueError("multi-day events cannot repeat (recurrence must be 'none')")
        return self
```

- [ ] **Step 5: calendar_service.py——snapshot 與展開**

`EventSnapshot` 換成（新欄位置尾＋預設值，既有測試的 `_ev` 不必改）：

```python
EventSnapshot = namedtuple(
    "EventSnapshot",
    "id title note category event_date event_time recurrence recurrence_until reminder_minutes end_date color",
    defaults=(None, None),
)
```

`snapshot_event` 的 return 補兩欄：

```python
        recurrence=ev.recurrence, recurrence_until=ev.recurrence_until,
        reminder_minutes=ev.reminder_minutes,
        end_date=getattr(ev, "end_date", None), color=getattr(ev, "color", None),
    )
```

`_expand_one` 的 `recurrence == "none"` 分支換成：

```python
    if recurrence == "none":
        end_date = getattr(ev, "end_date", None)
        if end_date is not None and end_date >= event_date:
            # 跨天事件：逐日展開 (裁剪到查詢範圍)；span 欄位由 _occurrence_dict 依
            # 事件自身起訖算，不受查詢窗影響
            first = max(event_date, range_start)
            last = min(end_date, range_end)
            dates = []
            current = first
            while current <= last:
                dates.append(current)
                current += timedelta(days=1)
        else:
            dates = [event_date] if range_start <= event_date <= range_end else []
```

`_occurrence_dict` 換成：

```python
def _occurrence_dict(ev, d: date) -> dict:
    end_date = getattr(ev, "end_date", None)
    color = getattr(ev, "color", None)
    span_total = 1
    span_day = None
    if end_date is not None and ev.recurrence == "none" and end_date >= ev.event_date:
        span_total = (end_date - ev.event_date).days + 1
        span_day = (d - ev.event_date).days + 1
    return {
        "event_id": ev.id,
        "title": ev.title,
        "note": ev.note,
        "category": ev.category,
        "date": d.isoformat(),
        "time": ev.event_time,
        "recurrence": ev.recurrence,
        "event_date": ev.event_date.isoformat(),
        "recurrence_until": ev.recurrence_until.isoformat() if ev.recurrence_until else None,
        "reminder_minutes": ev.reminder_minutes,
        # v2.5 Spec A：跨天欄位。單日事件 span_day=None、span_total=1；
        # 前端以 span_total > 1 判斷要不要畫橫槓。
        "end_date": end_date.isoformat() if end_date else None,
        "color": color,
        "span_day": span_day,
        "span_total": span_total,
    }
```

- [ ] **Step 6: routes/calendar.py＋crud＋messages**

`_serialize_event` 在 `reminder_minutes` 行後加：

```python
        "end_date": event.end_date.isoformat() if event.end_date else None,
        "color": event.color,
```

`create_event` 的 crud 呼叫補兩個 kwargs：

```python
        reminder_minutes=payload.reminder_minutes,
        end_date=payload.end_date,
        color=payload.color,
    )
```

`crud.create_calendar_event` 簽名補 `end_date=None, color=None`（keyword-only 區）、建構補 `end_date=end_date, color=color`。

`update_event` 在 `nulled_fields` 檢查後、`crud.update_calendar_event` 前插入合併後不變量檢查：

```python
    # 跨天不變量以「合併後狀態」檢查：schema 只驗得到同請求內同時出現的欄位，
    # 例如庫內事件帶 event_time、這次只送 end_date，就得在這裡擋下。
    merged_event_date = update_data.get("event_date", existing.event_date)
    merged_end_date = update_data.get("end_date", existing.end_date)
    merged_time = update_data.get("event_time", existing.event_time)
    merged_recurrence = update_data.get("recurrence", existing.recurrence)
    if merged_end_date is not None and (
            merged_time is not None or merged_recurrence != "none"
            or merged_end_date < merged_event_date):
        api_logger.warning(f"跨天事件不變量違反: event_id={event_id}, data={sorted(update_data)}")
        raise BadRequestError(
            error_code=ErrorCode.INVALID_INPUT,
            detail=msg("multi_day_invalid", lang)
        )
```

`messages.py` 在 `"event_deleted"` 條目後加：

```python
    "multi_day_invalid": {
        "zh-TW": "跨天事件必須是整天、不可重複，且結束日不可早於開始日",
        "en": "Multi-day events must be all-day, non-repeating, and end on or after the start date",
    },
```

- [ ] **Step 7: 跑焦點測試綠 → 跑 backend 全套件綠 → Commit**

```bash
git add backend/app/database/models.py backend/app/database/crud.py backend/app/api/schemas.py backend/app/api/routes/calendar.py backend/app/services/calendar_service.py backend/app/utils/messages.py backend/tests/test_calendar_api.py backend/tests/test_calendar_service.py
git commit -m "feat(backend): 行事曆跨天事件——end_date/color 欄位、雙層驗證、逐日展開帶 span"
```

---

### Task 2: 後端 day_notes（表＋crud＋GET/DELETE API）

**Files:**
- Modify: `backend/app/database/models.py`（CalendarEvent class 之後加新 class）
- Modify: `backend/app/database/crud.py`（calendar 區段後加三函式）
- Modify: `backend/app/api/routes/calendar.py`（新增兩個端點）
- Modify: `backend/app/utils/messages.py`（兩鍵）
- Test: `backend/tests/test_day_notes_api.py`（新檔）

**Interfaces:**
- Produces：`crud.upsert_day_note(db, user_id, note_date, stamp, phrase, source_diary_id=None)`（Task 3 用）；`GET /calendar/day-notes?start&end` → `{start, end, notes:[{date, stamp, phrase, source_diary_id}]}`；`DELETE /calendar/day-notes/{note_date}` → `{message}`（Task 5 用）。

- [ ] **Step 1: 寫失敗測試**（新檔，docstring 慣例比照 test_calendar_api.py；不需要 mock_llm）

```python
"""鎖定 /calendar/day-notes API 與 crud.upsert_day_note (v2.5 Spec A)。

day_notes 沒有公開 POST——寫入只發生在 /chat/end 管線 (test_day_stamp.py 覆蓋)，
這裡直接用 crud 造資料。
"""
from datetime import date

from database import crud, db_session


def _seed_note(user_id, note_date, stamp="cake", phrase="小語", diary_id=None):
    with db_session() as db:
        return crud.upsert_day_note(db, user_id, note_date, stamp, phrase, source_diary_id=diary_id)


def test_upsert_overwrites_same_day(client, auth_header):
    _, user_id = auth_header
    _seed_note(user_id, date(2026, 8, 12), stamp="cake", phrase="第一版")
    _seed_note(user_id, date(2026, 8, 12), stamp="star", phrase="第二版")
    with db_session() as db:
        rows = crud.get_day_notes(db, user_id, date(2026, 8, 1), date(2026, 8, 31))
        assert len(rows) == 1
        assert rows[0].stamp == "star"
        assert rows[0].phrase == "第二版"


def test_get_day_notes_range_and_isolation(client, auth_header):
    headers, user_id = auth_header
    _seed_note(user_id, date(2026, 8, 12))
    _seed_note(user_id, date(2026, 9, 2), stamp="moon")
    resp = client.get("/calendar/day-notes?start=2026-08-01&end=2026-08-31", headers=headers)
    assert resp.status_code == 200
    notes = resp.json()["notes"]
    assert [n["date"] for n in notes] == ["2026-08-12"]
    assert notes[0]["stamp"] == "cake"


def test_get_day_notes_rejects_wide_range(client, auth_header):
    headers, _ = auth_header
    resp = client.get("/calendar/day-notes?start=2026-01-01&end=2026-12-31", headers=headers)
    assert resp.status_code == 400


def test_delete_day_note(client, auth_header):
    headers, user_id = auth_header
    _seed_note(user_id, date(2026, 8, 12))
    resp = client.delete("/calendar/day-notes/2026-08-12", headers=headers)
    assert resp.status_code == 200
    resp2 = client.delete("/calendar/day-notes/2026-08-12", headers=headers)
    assert resp2.status_code == 404
```

- [ ] **Step 2: 確認失敗 → Step 3: models.py 新表**（CalendarEvent class 後）

```python
class DayNote(Base):
    """AI 日記印章＋小語 (v2.5 Spec A)。一使用者一天最多一筆 (upsert 覆蓋)。

    note_date 用「日記日」(utils.time_utils.get_diary_date，凌晨 5 點換日)——
    印章代表的是那篇日記的日子，跟行事曆事件的「真實牆上日期」語意不同，
    這是刻意的：半夜寫完的日記，印章要蓋在使用者心中的「今天」。
    """
    __tablename__ = "day_notes"
    __table_args__ = (UniqueConstraint("user_id", "note_date", name="uq_day_notes_user_date"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    note_date = Column(Date, nullable=False, index=True)
    stamp = Column(String(24), nullable=False)      # services/day_stamp.py STAMP_IDS 之一
    phrase = Column(Text, nullable=False)           # AI 小語 (目標 ≤30 字，入庫上限見 day_stamp.NOTE_MAX)
    source_diary_id = Column(Integer, ForeignKey("diaries.id"), nullable=True)  # 回顧連結；刪日記時服務層置 NULL (未來 Spec D)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
```

（檔頭 import 若缺 `UniqueConstraint`，從 sqlalchemy 補上。FK 目標表名以檔內 Diary model 的 `__tablename__` 為準——實作時核對，若非 "diaries" 就照實填。）

- [ ] **Step 4: crud.py 三函式**（calendar 函式群後）

```python
def upsert_day_note(db: Session, user_id: int, note_date, stamp: str, phrase: str, *,
                    source_diary_id: Optional[int] = None):
    """同 (user_id, note_date) 覆蓋更新；不存在則新增 (v2.5 Spec A)。"""
    row = (db.query(models.DayNote)
             .filter(models.DayNote.user_id == user_id,
                     models.DayNote.note_date == note_date)
             .first())
    if row is None:
        row = models.DayNote(user_id=user_id, note_date=note_date,
                             stamp=stamp, phrase=phrase, source_diary_id=source_diary_id)
        db.add(row)
    else:
        row.stamp = stamp
        row.phrase = phrase
        row.source_diary_id = source_diary_id
    db.commit()
    db.refresh(row)
    return row


def get_day_notes(db: Session, user_id: int, start, end) -> List[models.DayNote]:
    """取 [start, end] (含兩端) 的印章，依日期排序。"""
    return (db.query(models.DayNote)
              .filter(models.DayNote.user_id == user_id,
                      models.DayNote.note_date >= start,
                      models.DayNote.note_date <= end)
              .order_by(models.DayNote.note_date)
              .all())


def delete_day_note(db: Session, user_id: int, note_date) -> bool:
    """刪除某日印章；不存在回 False。"""
    row = (db.query(models.DayNote)
             .filter(models.DayNote.user_id == user_id,
                     models.DayNote.note_date == note_date)
             .first())
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True
```

- [ ] **Step 5: routes/calendar.py 兩端點**（delete_event 後；共用 MAX_RANGE_DAYS）

```python
@router.get("/day-notes", response_model=Dict[str, Any],
           summary="查詢 AI 日記印章",
           description="查詢 [start, end] 區間內的 AI 印章＋小語，跨度上限 63 天")
def list_day_notes(start: date, end: date,
                   current_user: User = Depends(get_current_user),
                   lang: str = Depends(get_language)):
    """查詢區間內的 day_notes (僅限本人；守讀→關→回傳)"""
    if start > end or (end - start).days > MAX_RANGE_DAYS:
        api_logger.warning(f"day-notes 查詢區間無效: start={start}, end={end}, user_id={current_user.id}")
        raise BadRequestError(
            error_code=ErrorCode.INVALID_INPUT,
            detail=msg("invalid_date_range", lang)
        )

    with db_session() as db:
        rows = crud.get_day_notes(db, current_user.id, start, end)
        notes = [{
            "date": r.note_date.isoformat(),
            "stamp": r.stamp,
            "phrase": r.phrase,
            "source_diary_id": r.source_diary_id,
        } for r in rows]

    return {"start": start.isoformat(), "end": end.isoformat(), "notes": notes}


@router.delete("/day-notes/{note_date}", response_model=Dict[str, str],
              summary="刪除某日 AI 印章",
              description="刪除自己某一天的 AI 印章與小語")
def delete_day_note_route(note_date: date,
                          db: Session = Depends(get_db),
                          current_user: User = Depends(get_current_user),
                          lang: str = Depends(get_language)):
    """刪除某日印章 (僅限本人；不存在回 404)"""
    if not crud.delete_day_note(db, current_user.id, note_date):
        raise NotFoundError(
            error_code=ErrorCode.RESOURCE_NOT_FOUND,
            detail=msg("day_note_not_found", lang)
        )
    return {"message": msg("day_note_deleted", lang)}
```

`messages.py` 加：

```python
    "day_note_deleted": {
        "zh-TW": "這天的印章已刪除",
        "en": "The stamp for this day has been removed",
    },
    "day_note_not_found": {
        "zh-TW": "這天沒有印章",
        "en": "No stamp on this day",
    },
```

- [ ] **Step 6: 焦點測試綠 → backend 全綠 → Commit**

```bash
git add backend/app/database/models.py backend/app/database/crud.py backend/app/api/routes/calendar.py backend/app/utils/messages.py backend/tests/test_day_notes_api.py
git commit -m "feat(backend): day_notes 表與 GET/DELETE API——AI 印章小語的儲存層"
```

---

### Task 3: 後端印章管線（day_stamp.py＋diary_draft＋提示詞＋/chat/end 寫入）

**Files:**
- Create: `backend/app/services/day_stamp.py`
- Modify: `backend/app/services/diary_draft.py`（DiaryDraft :25-31、parse_diary_output JSON 分支 :94-100）
- Modify: `backend/app/services/prompts/zh-TW/daily_note_prompt.txt`（【輸出格式】段）
- Modify: `backend/app/services/prompts/en/daily_note_prompt.txt`（對應段，照 zh 版意譯）
- Modify: `backend/app/services/diary_service.py`（run_end_of_chat_pipeline :81-123）
- Modify: `backend/app/api/schemas.py`（UserDiaryCreate :13-22）
- Modify: `backend/app/api/routes/chat.py`（end_chat_session :149-197）
- Modify: `backend/app/api/routes/diary.py`（enhanced-generate 的 run_end_of_chat_pipeline 呼叫處，grep 定位）
- Test: `backend/tests/test_day_stamp.py`（新檔）

**Interfaces:**
- Consumes：Task 2 的 `crud.upsert_day_note`。
- Produces：`day_stamp.STAMP_IDS`（24 個 id，順序同 spec §3 清單）、`day_stamp.finalize(stamp, note, valence) -> (stamp|None, note)`、`DiaryDraft.stamp/.note`（Optional[str]，預設 None）、`/chat/end/` body 欄位 `enable_day_note: bool = True`。

- [ ] **Step 1: 寫失敗測試**

```python
"""鎖定 services/day_stamp.py 與日記管線的印章寫入 (v2.5 Spec A)。"""
from datetime import date

from database import crud, db_session
from services import day_stamp
from services.diary_draft import parse_diary_output


def test_parse_diary_output_extracts_stamp_and_note():
    text = '日記正文。\n{"title": "t", "summary": "s", "valence": 0.8, "arousal": 0.4, "stamp": "cake", "note": "幫媽媽慶生的一天"}'
    draft = parse_diary_output(text)
    assert draft.stamp == "cake"
    assert draft.note == "幫媽媽慶生的一天"
    assert "stamp" not in draft.content


def test_parse_diary_output_without_stamp_fields_is_none():
    text = '正文。\n{"title": "t", "summary": "s", "valence": 0.5, "arousal": 0.5}'
    draft = parse_diary_output(text)
    assert draft.stamp is None
    assert draft.note is None


def test_finalize_low_valence_forces_encourage_set():
    stamp, note = day_stamp.finalize("cake", "打起精神", 0.3)
    assert stamp == day_stamp.FALLBACK_ENCOURAGE          # 非鼓勵組被替換
    stamp2, _ = day_stamp.finalize("rainbow", "會好起來的", 0.3)
    assert stamp2 == "rainbow"                             # 鼓勵組原樣通過


def test_finalize_unknown_or_missing_stamp_returns_none():
    assert day_stamp.finalize("nonsense", "x", 0.8)[0] is None
    assert day_stamp.finalize(None, "x", 0.8)[0] is None


def test_finalize_boundary_045_is_not_negative():
    stamp, _ = day_stamp.finalize("cake", "x", 0.45)
    assert stamp == "cake"


def test_finalize_cleans_note():
    _, note = day_stamp.finalize("cake", "  第一行\n第二行  ", 0.8)
    assert "\n" not in note and note.startswith("第一行")
    _, long_note = day_stamp.finalize("cake", "很" * 200, 0.8)
    assert len(long_note) <= day_stamp.NOTE_MAX


def test_pipeline_writes_day_note(client, auth_header, mock_llm):
    """/chat/end 成功後 day_notes 有落地 (mock_llm 的日記輸出含 stamp/note tail)。
    mock 輸出格式與現值以 conftest 既有 mock_llm fixture 為準照改；若該 fixture
    輸出不含 JSON tail，測試內以 monkeypatch 覆寫日記生成回傳文字。"""
    headers, user_id = auth_header
    client.post("/chat/", json={"message": "今天幫媽媽慶生"}, headers=headers)
    resp = client.post("/chat/end/", json={"exclude_interaction_notes": True,
                                           "enable_day_note": True}, headers=headers)
    assert resp.status_code == 200
    with db_session() as db:
        rows = db.query(__import__("database.models", fromlist=["models"]).DayNote).filter_by(user_id=user_id).all()
        assert len(rows) == 1


def test_pipeline_flag_off_writes_nothing(client, auth_header, mock_llm):
    headers, user_id = auth_header
    client.post("/chat/", json={"message": "隨便聊聊"}, headers=headers)
    resp = client.post("/chat/end/", json={"exclude_interaction_notes": True,
                                           "enable_day_note": False}, headers=headers)
    assert resp.status_code == 200
    with db_session() as db:
        rows = db.query(__import__("database.models", fromlist=["models"]).DayNote).filter_by(user_id=user_id).all()
        assert rows == []
```

（兩個 pipeline 測試的 chat 造數據與 mock_llm 用法以 conftest／既有 chat 測試檔為準照抄；`__import__` 那兩行實作時改成檔頂 `from database import models` 的正常寫法。斷言核心不變：flag on 寫一筆、off 零筆。）

- [ ] **Step 2: 確認失敗 → Step 3: 建 `services/day_stamp.py`**

```python
"""AI 日記印章：目錄、情緒分流、輸出淨化 (v2.5 Spec A)。

情緒判定的唯一權威在這裡：NEGATIVE_VALENCE_THRESHOLD 與前端 mascot.js 的
QUIET_VALENCE_THRESHOLD、api_service.getMoodFromValence 的 sad 界線 (>=0.45
即非負向) 是同一條語意線。未來使用者的專用情緒識別模型接入時，替換
is_negative() 一個函式即可，呼叫端不動。
"""
from typing import Optional, Tuple

# 與前端 MascotModule.stampIcon 的 STAMP_ICONS 鍵一一對應 (spec §3 清單順序)
STAMP_IDS = (
    "cake", "gift", "heart", "cheers", "trophy", "flag", "book", "star",
    "plane", "camera", "ball", "movie", "music", "food", "coffee", "flower",
    "sun", "umbrella", "moon", "rainbow", "sprout", "heal", "paw", "gradcap",
)
# 低落日 (負向情緒) 唯一允許的印章：陪伴與打氣，不慶祝
ENCOURAGE_STAMPS = ("umbrella", "moon", "rainbow", "sprout", "heal")
FALLBACK_ENCOURAGE = "heal"
NEGATIVE_VALENCE_THRESHOLD = 0.45
NOTE_MAX = 60   # 小語入庫硬上限 (提示詞要求 ≤30 字，這裡放寬一倍防溢出)


def is_negative(valence: float) -> bool:
    """負向情緒判定 (未來由專用情緒識別模型替換此函式)。"""
    return isinstance(valence, (int, float)) and valence < NEGATIVE_VALENCE_THRESHOLD


def clean_note(note: Optional[str]) -> str:
    if not note or not isinstance(note, str):
        return ""
    return " ".join(note.split())[:NOTE_MAX]


def finalize(stamp: Optional[str], note: Optional[str], valence: float) -> Tuple[Optional[str], str]:
    """把模型回的 stamp/note 淨化成可入庫的值。

    - stamp 不在 STAMP_IDS → (None, "")：這天不蓋章，絕不擋日記主流程
    - 負向情緒 (is_negative) 且 stamp 不在鼓勵組 → 硬替換為 FALLBACK_ENCOURAGE
      (spec §3 硬規則的伺服器端保底，不信任模型自覺)
    """
    if stamp not in STAMP_IDS:
        return None, ""
    if is_negative(valence) and stamp not in ENCOURAGE_STAMPS:
        stamp = FALLBACK_ENCOURAGE
    return stamp, clean_note(note)
```

- [ ] **Step 4: diary_draft.py**

`DiaryDraft` 加兩欄（置尾、帶預設）：

```python
@dataclass
class DiaryDraft:
    content: str
    title: Optional[str]
    summary: Optional[str]
    valence: float
    arousal: float
    stamp: Optional[str] = None   # v2.5 Spec A：AI 印章 id (未驗證原始值，day_stamp.finalize 才淨化)
    note: Optional[str] = None    # v2.5 Spec A：印章小語原始值
```

JSON tail 分支（`arousal = _clamp(...)` 行後）加：

```python
            stamp = _clean_field(data.get("stamp"), 24)
            note = _clean_field(data.get("note"), 200)
```

（函式頂端 `title = None` 等初始化處同步加 `stamp = None`、`note = None`；結尾 `return DiaryDraft(...)` 補 `stamp=stamp, note=note`。舊格式 regex 分支不處理 stamp——沒有 tail 就沒有印章。）

- [ ] **Step 5: 提示詞（zh-TW 與 en 兩檔）**

`zh-TW/daily_note_prompt.txt` 的【輸出格式】整段換成：

```text
【輸出格式】
先輸出日記正文（依上述四部分結構）。正文結束後，另起一行輸出一個單行 JSON 物件（不要使用程式碼區塊、不要加任何說明文字），格式如下：

{{"title": "日記標題", "summary": "一行摘要", "valence": 0.7, "arousal": 0.3, "stamp": "cake", "note": "給這一天的一句話"}}

- title：12 字以內，具體貼近今日核心事件或感受，讓使用者日後一眼認出這一天（例如「期中報告終於交出去了」）
- summary：50 字以內的一行摘要，概括今日主要事件與情緒，供日後檢索與回顧
- valence：0-1 之間的數值（愉悅程度，0 為非常負面，1 為非常正面）
- arousal：0-1 之間的數值（情緒激動程度，0 為非常平靜，1 為非常激動）
- stamp：從下方印章目錄選一個最能代表今天的 id。就算是平凡的一天也值得被記下——挑最貼近今天氣味的那一款
- note：30 字以內、給這一天的一句溫暖的話，口吻像朋友在行事曆上留的便條（例如「幫媽媽慶生的這天，你把愛做成了行動」）。不說教、不浮誇

【印章目錄】
cake 生日蛋糕｜gift 驚喜禮物｜heart 愛心滿滿｜cheers 聚會乾杯｜trophy 成就獎盃｜flag 里程碑小旗｜book 讀書進修｜star 閃耀的一天｜plane 出發遠行｜camera 出遊留影｜ball 活力運動｜movie 看場電影｜music 音樂時光｜food 美味一餐｜coffee 小歇片刻｜flower 花草散步｜sun 晴朗有勁｜umbrella 雨天安好｜moon 靜靜的夜｜rainbow 雨過天晴｜sprout 新芽成長｜heal 照顧自己｜paw 毛孩時光｜gradcap 考試學業

【印章的情緒規則（重要）】
若 valence 低於 0.45（今天偏沉重）：stamp 只能從 umbrella／moon／rainbow／sprout／heal 之中選，note 改為安靜的陪伴與打氣——承接感受、不慶祝、不要求振作（例如「今天辛苦了，我陪你把它放下」）。
```

`en/daily_note_prompt.txt` 的對應段照上面結構意譯（JSON 範例同形；目錄用 en 印章名：Birthday Cake／Sweet Surprise／Full of Love／Cheers Together／Achievement／Milestone Flag／Study Time／Shining Day／Off We Go／Snapshot Day／Active Day／Movie Night／Music Time／Tasty Meal／Little Break／Garden Walk／Sunny Spirit／Rainy Comfort／Quiet Night／After the Rain／New Sprout／Self Care／Furry Moments／Exam Season；情緒規則同義）。注意：兩檔既有的 `{{...}}` 雙大括號跳脫慣例必須沿用（載入端走 str.format）。

- [ ] **Step 6: pipeline＋路由**

`run_end_of_chat_pipeline` 簽名加參數 `enable_day_note: bool = False`；在「2. 保存日記」的 `with db_session()...` 區塊結束後、互動筆記之前插入：

```python
    # 2.5 AI 印章 (v2.5 Spec A)：印章跟著「日記日」(5am 換日) 走，代表那篇日記
    # 的日子。任何失敗只記 log——印章是加分項，絕不影響日記主流程。
    if enable_day_note:
        try:
            stamp, note_text = day_stamp.finalize(draft.stamp, draft.note, draft.valence)
            if stamp:
                with db_session() as db:
                    crud.upsert_day_note(db, numeric_user_id, get_diary_date(),
                                         stamp, note_text,
                                         source_diary_id=diary_payload["diary_id"])
        except Exception as e:
            log_error(e, {"user_id": user_id, "action": "run_end_of_chat_pipeline_day_note"})
```

（檔頂補 `from services import day_stamp` 與 `from utils.time_utils import get_diary_date`。）

`schemas.py` 的 `UserDiaryCreate` 加欄位：

```python
    enable_day_note: bool = True  # v2.5 Spec A：/chat/end 才會用；前端設定「AI 行事曆印章」開關
```

`routes/chat.py` 的 `run_end_of_chat_pipeline(...)` 呼叫補 `enable_day_note=user_input.enable_day_note`；`routes/diary.py` 的同名呼叫補 `enable_day_note=False`（grep `run_end_of_chat_pipeline` 定位，明確傳 False——印章只屬於 /chat/end）。

- [ ] **Step 7: 焦點測試綠 → backend 全綠 → Commit**

```bash
git add backend/app/services/day_stamp.py backend/app/services/diary_draft.py backend/app/services/diary_service.py backend/app/services/prompts backend/app/api/schemas.py backend/app/api/routes/chat.py backend/app/api/routes/diary.py backend/tests/test_day_stamp.py
git commit -m "feat(backend): AI 印章管線——JSON tail 搭便車、0.45 鼓勵分流保底、/chat/end 寫入 day_notes"
```

---

### Task 4: 前端 stampIcon 資產（mascot.js 24 款 SVG＋i18n 印章名）

**Files:**
- Modify: `desktop/js/mascot.js`（categoryIcon 函式後加 STAMP_ICONS＋stampIcon；return 區塊 :268-269 加曝光）
- Modify: `desktop/js/i18n.js`（兩語各 24 鍵，插在各語言 `'mascot.emptyGeneric'` 條目之後）
- Test: `desktop/tests/mascot_stamps.test.js`（新檔）

**Interfaces:**
- Produces：`MascotModule.stampIcon(id, size) -> string`——48 viewBox `<svg class="mascot-stamp" aria-hidden="true">`；未知 id（含原型鏈鍵如 "constructor"）fallback `star`。i18n 鍵 `stamp.<id>`。

- [ ] **Step 1: 寫失敗測試**

```javascript
// @vitest-environment jsdom
/** MascotModule.stampIcon：24 款印章、fallback、尺寸 (v2.5 Spec A)。 */
import { loadScript } from './helpers/load.js';

const STAMP_IDS = ['cake','gift','heart','cheers','trophy','flag','book','star',
    'plane','camera','ball','movie','music','food','coffee','flower',
    'sun','umbrella','moon','rainbow','sprout','heal','paw','gradcap'];

describe('MascotModule.stampIcon', () => {
    beforeEach(() => { loadScript('js/mascot.js'); });

    test('24 款都渲染出 svg 且帶 mascot-stamp class', () => {
        for (const id of STAMP_IDS) {
            const html = MascotModule.stampIcon(id, 40);
            expect(html).toContain('<svg');
            expect(html).toContain('mascot-stamp');
            expect(html).toContain('viewBox="0 0 48 48"');
        }
    });

    test('尺寸直通 width/height', () => {
        expect(MascotModule.stampIcon('cake', 14)).toContain('width="14"');
        expect(MascotModule.stampIcon('cake', 40)).toContain('height="40"');
    });

    test('未知 id 與原型鏈鍵 fallback star', () => {
        expect(MascotModule.stampIcon('nonsense', 14)).toBe(MascotModule.stampIcon('star', 14));
        expect(MascotModule.stampIcon('constructor', 14)).toBe(MascotModule.stampIcon('star', 14));
    });

    test('吉祥物系列含書本體、低落組全數存在', () => {
        for (const id of ['heart','book','umbrella','moon','heal']) {
            expect(MascotModule.stampIcon(id, 40)).toContain('#b98d6d'); // 書皮＝吉祥物本體
        }
    });
});
```

- [ ] **Step 2: 確認失敗 → Step 3: mascot.js 實作**（SVG 內容為已核可資產，原樣轉錄，禁止改動任何路徑/顏色/數值）

在 `categoryIcon` 函式定義後插入：

```javascript
    // -- AI 日記印章（48 viewBox；v2.5 Spec A，原稿 stamp-library-v3 已逐屏核可） --
    const STAMP_ICONS = {
        cake: `<rect x="10" y="24" width="28" height="14" rx="3" fill="#f2b3c1" stroke="${OUTLINE}" stroke-width="3"/><rect x="14" y="17" width="20" height="9" rx="2.5" fill="#fffdf8" stroke="${OUTLINE}" stroke-width="3"/><rect x="22.7" y="9" width="2.6" height="8" fill="${OUTLINE}"/><ellipse cx="24" cy="7" rx="2.5" ry="3.5" fill="#f5c542" stroke="${OUTLINE}" stroke-width="2"/>`,
        gift: `<rect x="9" y="21" width="30" height="17" rx="3" fill="#e8836f" stroke="${OUTLINE}" stroke-width="3"/><rect x="7" y="14" width="34" height="8" rx="2.5" fill="#e34948" stroke="${OUTLINE}" stroke-width="3"/><rect x="21.5" y="14" width="5" height="24" fill="#f5c542" stroke="${OUTLINE}" stroke-width="2"/><path d="M24 13 q-7 -7 -10 -2 q-2 4 10 2 z M24 13 q7 -7 10 -2 q2 4 -10 2 z" fill="#f5c542" stroke="${OUTLINE}" stroke-width="2.5" stroke-linejoin="round"/>`,
        heart: `<path d="M37 6.5 c-2.8 -2.8 -6.5 -1 -6.5 2.2 c0 2.8 2.8 4.7 6.5 7.5 c3.7 -2.8 6.5 -4.7 6.5 -7.5 c0 -3.2 -3.7 -5 -6.5 -2.2 z" fill="#e8899a" stroke="${OUTLINE}" stroke-width="2.4" stroke-linejoin="round"/><path d="M13 20 q0 -5.5 5.5 -5.5 h11 q5.5 0 5.5 5.5 v1 h-22 z" fill="#f9f3e6" stroke="${OUTLINE}" stroke-width="2.6" stroke-linejoin="round"/><rect x="11" y="20" width="26" height="19" rx="5" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="3"/><path d="M15 20 h5.5 v8.5 l-2.75 -2.4 -2.75 2.4 z" fill="#5fd0a0" stroke="${OUTLINE}" stroke-width="1.8" stroke-linejoin="round"/><circle cx="21" cy="28.5" r="1.7" fill="#2b1a10"/><circle cx="29" cy="28.5" r="1.7" fill="#2b1a10"/><path d="M22.5 32 q2.5 2.2 5 0" stroke="#2b1a10" stroke-width="1.8" fill="none" stroke-linecap="round"/><ellipse cx="16.5" cy="32" rx="2" ry="1.3" fill="#f0a78f" opacity=".6"/><ellipse cx="33.5" cy="32" rx="2" ry="1.3" fill="#f0a78f" opacity=".6"/>`,
        cheers: `<g transform="rotate(-12 15 28)"><rect x="8" y="20" width="13" height="13" rx="3" fill="#fffdf8" stroke="${OUTLINE}" stroke-width="3"/><path d="M21 23 q6 1 0 7" fill="none" stroke="${OUTLINE}" stroke-width="2.5"/></g><g transform="rotate(12 34 28)"><rect x="27" y="20" width="13" height="13" rx="3" fill="#fffdf8" stroke="${OUTLINE}" stroke-width="3"/><path d="M27 23 q-6 1 0 7" fill="none" stroke="${OUTLINE}" stroke-width="2.5"/></g><path d="M24 10 l1.4 4 M19 12 l-1.2 3 M29 12 l1.2 3" stroke="#f5c542" stroke-width="2.5" stroke-linecap="round"/>`,
        trophy: `<path d="M15 10 h18 v8 q0 9 -9 9 q-9 0 -9 -9 z" fill="#f5c542" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/><path d="M15 12 q-7 1 -4 8 q2 4 6 3 M33 12 q7 1 4 8 q-2 4 -6 3" fill="none" stroke="${OUTLINE}" stroke-width="2.5"/><rect x="21.5" y="27" width="5" height="5" fill="#e8b04b" stroke="${OUTLINE}" stroke-width="2"/><rect x="16" y="32" width="16" height="5" rx="2" fill="#e8b04b" stroke="${OUTLINE}" stroke-width="2.5"/>`,
        flag: `<rect x="13" y="8" width="3.5" height="32" rx="1.7" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="2"/><path d="M17 10 l20 5.5 -20 5.5 z" fill="#e8836f" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/>`,
        book: `<path d="M15 15 q0 -4.5 5 -4.5 h8 q5 0 5 4.5 v1 h-18 z" fill="#f9f3e6" stroke="${OUTLINE}" stroke-width="2.4" stroke-linejoin="round"/><rect x="13" y="16" width="22" height="15" rx="4.5" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="2.8"/><circle cx="21" cy="22" r="1.5" fill="#2b1a10"/><circle cx="27.5" cy="22" r="1.5" fill="#2b1a10"/><path d="M22.5 25 q2 1.8 4 0" stroke="#2b1a10" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M24 36 q-9 -4 -18 -2.5 v9 q9 -1.5 18 2.5 z" fill="#fffdf8" stroke="${OUTLINE}" stroke-width="2.6" stroke-linejoin="round"/><path d="M24 36 q9 -4 18 -2.5 v9 q-9 -1.5 -18 2.5 z" fill="#f9f3e6" stroke="${OUTLINE}" stroke-width="2.6" stroke-linejoin="round"/>`,
        star: `<path d="M24 7 l4.8 10.4 11.2 1.2 -8.3 7.8 2.4 11.1 -10.1 -5.9 -10.1 5.9 2.4 -11.1 -8.3 -7.8 11.2 -1.2 z" fill="#f5c542" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/>`,
        plane: `<path d="M8 26 L40 12 32 38 24 28 z" fill="#dceafc" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/><path d="M24 28 L40 12" stroke="${OUTLINE}" stroke-width="2.5"/><path d="M24 28 l-2 8" stroke="${OUTLINE}" stroke-width="2.5"/>`,
        camera: `<rect x="18" y="11" width="11" height="7" rx="2" fill="#7f96c9" stroke="${OUTLINE}" stroke-width="3"/><rect x="8" y="15" width="32" height="21" rx="4" fill="#7f96c9" stroke="${OUTLINE}" stroke-width="3"/><circle cx="24" cy="25.5" r="6.5" fill="#fffdf8" stroke="${OUTLINE}" stroke-width="3"/><circle cx="24" cy="25.5" r="2.5" fill="${OUTLINE}"/><circle cx="35" cy="20" r="1.8" fill="#f5c542"/>`,
        ball: `<circle cx="24" cy="24" r="14" fill="#fffdf8" stroke="${OUTLINE}" stroke-width="3"/><path d="M24 17.5 l5.3 3.9 -2 6.2 h-6.6 l-2 -6.2 z" fill="${OUTLINE}"/><path d="M24 17.5 v-7 M29.3 21.4 l6.6 -2.2 M27.3 27.6 l4 5.4 M20.7 27.6 l-4 5.4 M18.7 21.4 l-6.6 -2.2" stroke="${OUTLINE}" stroke-width="2.2"/>`,
        movie: `<rect x="7" y="16" width="34" height="17" rx="3" fill="#f2b3c1" stroke="${OUTLINE}" stroke-width="3"/><path d="M30 17 v15" stroke="${OUTLINE}" stroke-width="2" stroke-dasharray="2.5 2.5"/><path d="M34.7 21 l1.2 2.6 2.8 .3 -2.1 2 .5 2.8 -2.4 -1.4 -2.4 1.4 .5 -2.8 -2.1 -2 2.8 -.3 z" fill="#e34948"/><path d="M11 21 h14 M11 25 h14 M11 29 h9" stroke="#a06b7a" stroke-width="2"/>`,
        music: `<ellipse cx="15" cy="35" rx="5.5" ry="4.5" fill="${OUTLINE}"/><ellipse cx="33" cy="31" rx="5.5" ry="4.5" fill="${OUTLINE}"/><path d="M20.5 35 v-21 l18 -4 v21" fill="none" stroke="${OUTLINE}" stroke-width="3"/><path d="M20.5 16.5 l18 -4" stroke="${OUTLINE}" stroke-width="5"/>`,
        food: `<path d="M9 25 h30 q0 11 -9 13 h-12 q-9 -2 -9 -13 z" fill="#e8836f" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/><path d="M17 20 q2 -3 0 -6 M25 20 q2 -3 0 -6 M33 20 q2 -3 0 -6" stroke="#c8b49a" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M13 12 l7 10 M40 9 l-9 13" stroke="#b98d6d" stroke-width="2.5" stroke-linecap="round"/>`,
        coffee: `<rect x="11" y="18" width="19" height="17" rx="3.5" fill="#fffdf8" stroke="${OUTLINE}" stroke-width="3"/><path d="M30 22 q9 1 0 10" fill="none" stroke="${OUTLINE}" stroke-width="3"/><path d="M16 13 q2 -3 0 -5 M25 13 q2 -3 0 -5" stroke="#c8b49a" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M13 38 h22" stroke="${OUTLINE}" stroke-width="2.5" stroke-linecap="round"/>`,
        flower: `<path d="M24 26 v12" stroke="#5fd0a0" stroke-width="3" stroke-linecap="round"/><path d="M24 33 q-7 1 -8 -5 q6 -1 8 5 z" fill="#5fd0a0" stroke="${OUTLINE}" stroke-width="2"/><circle cx="24" cy="12" r="4.5" fill="#f2b3c1" stroke="${OUTLINE}" stroke-width="2.2"/><circle cx="16" cy="18" r="4.5" fill="#f2b3c1" stroke="${OUTLINE}" stroke-width="2.2"/><circle cx="32" cy="18" r="4.5" fill="#f2b3c1" stroke="${OUTLINE}" stroke-width="2.2"/><circle cx="19" cy="25" r="4.5" fill="#f2b3c1" stroke="${OUTLINE}" stroke-width="2.2"/><circle cx="29" cy="25" r="4.5" fill="#f2b3c1" stroke="${OUTLINE}" stroke-width="2.2"/><circle cx="24" cy="19" r="3.6" fill="#f5c542" stroke="${OUTLINE}" stroke-width="2.2"/>`,
        sun: `<circle cx="24" cy="24" r="9" fill="#f5c542" stroke="${OUTLINE}" stroke-width="3"/><path d="M24 8 v4 M24 36 v4 M8 24 h4 M36 24 h4 M12.7 12.7 l2.8 2.8 M32.5 32.5 l2.8 2.8 M35.3 12.7 l-2.8 2.8 M15.5 32.5 l-2.8 2.8" stroke="#e8b04b" stroke-width="3" stroke-linecap="round"/><circle cx="21" cy="23" r="1.4" fill="#5a3d00"/><circle cx="27" cy="23" r="1.4" fill="#5a3d00"/><path d="M21.5 27 q2.5 2 5 0" stroke="#5a3d00" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
        umbrella: `<path d="M5 15 q14 -14 28 0 q-3 -2.2 -7 0 q-3.5 -2.2 -7 0 q-3 -2.2 -6.5 0 q-3.5 -2.2 -7.5 0 z" fill="#7f96c9" stroke="${OUTLINE}" stroke-width="2.6" stroke-linejoin="round"/><path d="M19 15 v8" stroke="${OUTLINE}" stroke-width="2.4"/><path d="M16 24 q0 -4.5 5 -4.5 h8 q5 0 5 4.5 v1 h-18 z" fill="#f9f3e6" stroke="${OUTLINE}" stroke-width="2.4" stroke-linejoin="round"/><rect x="14" y="25" width="22" height="15" rx="4.5" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="2.8"/><circle cx="22" cy="31" r="1.5" fill="#2b1a10"/><circle cx="28.5" cy="31" r="1.5" fill="#2b1a10"/><path d="M23.5 34 q2 1.8 4 0" stroke="#2b1a10" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M40 20 l-1.3 3.6 M42 28 l-1.3 3.6" stroke="#7f96c9" stroke-width="2.2" stroke-linecap="round"/>`,
        moon: `<path d="M40 6 a9 9 0 1 0 6.5 15 a7 7 0 1 1 -6.5 -15 z" fill="#f5c542" stroke="${OUTLINE}" stroke-width="2.2" stroke-linejoin="round"/><circle cx="8" cy="12" r="1.4" fill="#f5c542"/><circle cx="14" cy="6" r="1" fill="#f5c542"/><path d="M13 21 Q17 10 28 12 q5 1.5 5.5 6 l-20.5 3 z" fill="#7f96c9" stroke="${OUTLINE}" stroke-width="2.6" stroke-linejoin="round"/><circle cx="35.5" cy="19.5" r="2.4" fill="#f9f3e6" stroke="${OUTLINE}" stroke-width="1.8"/><rect x="12" y="22" width="24" height="17" rx="5" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="3"/><path d="M19 29 q2 1.8 4 0 M27 29 q2 1.8 4 0" stroke="#2b1a10" stroke-width="1.7" fill="none" stroke-linecap="round"/><circle cx="25" cy="33.5" r="1.2" fill="#2b1a10"/><ellipse cx="17" cy="32.5" rx="1.9" ry="1.2" fill="#f0a78f" opacity=".55"/><ellipse cx="33" cy="32.5" rx="1.9" ry="1.2" fill="#f0a78f" opacity=".55"/>`,
        rainbow: `<path d="M10 33 a14 14 0 0 1 28 0" fill="none" stroke="#e34948" stroke-width="4"/><path d="M14.5 33 a9.5 9.5 0 0 1 19 0" fill="none" stroke="#f5c542" stroke-width="4"/><path d="M19 33 a5 5 0 0 1 10 0" fill="none" stroke="#5fd0a0" stroke-width="4"/><ellipse cx="10" cy="34" rx="5" ry="3.8" fill="#fffdf8" stroke="${OUTLINE}" stroke-width="2.5"/><ellipse cx="38" cy="34" rx="5" ry="3.8" fill="#fffdf8" stroke="${OUTLINE}" stroke-width="2.5"/>`,
        sprout: `<path d="M14 30 h20 l-2.5 9 h-15 z" fill="#e8836f" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/><path d="M24 30 v-9" stroke="${OUTLINE}" stroke-width="2.5"/><path d="M24 21 q-9 -1 -9 -9 q9 1 9 9 z" fill="#5fd0a0" stroke="${OUTLINE}" stroke-width="2.5" stroke-linejoin="round"/><path d="M24 21 q9 -1 9 -9 q-9 1 -9 9 z" fill="#5fd0a0" stroke="${OUTLINE}" stroke-width="2.5" stroke-linejoin="round"/>`,
        heal: `<path d="M13 15 q0 -5 5.5 -5 h11 q5.5 0 5.5 5 v1 h-22 z" fill="#f9f3e6" stroke="${OUTLINE}" stroke-width="2.6" stroke-linejoin="round"/><rect x="11" y="15" width="26" height="20" rx="5" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="3"/><g transform="rotate(-24 32 15)"><rect x="25" y="12" width="14" height="5.5" rx="2.7" fill="#f3d9a4" stroke="${OUTLINE}" stroke-width="1.8"/><circle cx="30.5" cy="14.7" r=".7" fill="#b99b62"/><circle cx="32.8" cy="14.7" r=".7" fill="#b99b62"/><circle cx="35.1" cy="14.7" r=".7" fill="#b99b62"/></g><circle cx="20.5" cy="24.5" r="1.7" fill="#2b1a10"/><circle cx="28.5" cy="24.5" r="1.7" fill="#2b1a10"/><path d="M22.5 28.5 q2 1.6 4 0" stroke="#2b1a10" stroke-width="1.7" fill="none" stroke-linecap="round"/><ellipse cx="16" cy="27.5" rx="2" ry="1.3" fill="#f0a78f" opacity=".55"/><ellipse cx="33" cy="27.5" rx="2" ry="1.3" fill="#f0a78f" opacity=".55"/>`,
        paw: `<ellipse cx="24" cy="31" rx="9" ry="7" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="3"/><circle cx="12" cy="21" r="3.6" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="2.5"/><circle cx="20" cy="16.5" r="3.6" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="2.5"/><circle cx="28" cy="16.5" r="3.6" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="2.5"/><circle cx="36" cy="21" r="3.6" fill="#b98d6d" stroke="${OUTLINE}" stroke-width="2.5"/>`,
        gradcap: `<path d="M6 19 L24 11 42 19 24 27 z" fill="#5a4a36" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/><path d="M15 23.5 v7 q9 5.5 18 0 v-7" fill="#5a4a36" stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round"/><path d="M38 20 v9" stroke="${OUTLINE}" stroke-width="2.2"/><circle cx="38" cy="31" r="2.2" fill="#f5c542" stroke="${OUTLINE}" stroke-width="1.8"/>`,
    };

    function stampIcon(id, size) {
        // own-property 檢查：category 版 (CAT_ICONS) 的原型鏈坑在 v2.4 審查
        // 被點名過，這裡直接做對——"constructor" 之類的鍵一律走 fallback
        const draw = Object.prototype.hasOwnProperty.call(STAMP_ICONS, id)
            ? STAMP_ICONS[id] : STAMP_ICONS.star;
        return `<svg viewBox="0 0 48 48" width="${size}" height="${size}" class="mascot-stamp" aria-hidden="true">${draw}</svg>`;
    }
```

return 區塊改為：

```javascript
    return { loadingHtml, thinkingBubbleHtml, emptyHtml, welcomeHtml,
             checkinHtml, eggKindFor, showSaveEgg, categoryIcon, stampIcon };
```

- [ ] **Step 4: i18n.js 兩語各 24 鍵**（各語言 `'mascot.emptyGeneric'` 條目後插入）

zh-TW：

```javascript
            'stamp.cake': '生日蛋糕', 'stamp.gift': '驚喜禮物', 'stamp.heart': '愛心滿滿',
            'stamp.cheers': '聚會乾杯', 'stamp.trophy': '成就獎盃', 'stamp.flag': '里程碑小旗',
            'stamp.book': '讀書進修', 'stamp.star': '閃耀的一天', 'stamp.plane': '出發遠行',
            'stamp.camera': '出遊留影', 'stamp.ball': '活力運動', 'stamp.movie': '看場電影',
            'stamp.music': '音樂時光', 'stamp.food': '美味一餐', 'stamp.coffee': '小歇片刻',
            'stamp.flower': '花草散步', 'stamp.sun': '晴朗有勁', 'stamp.umbrella': '雨天安好',
            'stamp.moon': '靜靜的夜', 'stamp.rainbow': '雨過天晴', 'stamp.sprout': '新芽成長',
            'stamp.heal': '照顧自己', 'stamp.paw': '毛孩時光', 'stamp.gradcap': '考試學業',
```

en：

```javascript
            'stamp.cake': 'Birthday Cake', 'stamp.gift': 'Sweet Surprise', 'stamp.heart': 'Full of Love',
            'stamp.cheers': 'Cheers Together', 'stamp.trophy': 'Achievement', 'stamp.flag': 'Milestone Flag',
            'stamp.book': 'Study Time', 'stamp.star': 'Shining Day', 'stamp.plane': 'Off We Go',
            'stamp.camera': 'Snapshot Day', 'stamp.ball': 'Active Day', 'stamp.movie': 'Movie Night',
            'stamp.music': 'Music Time', 'stamp.food': 'Tasty Meal', 'stamp.coffee': 'Little Break',
            'stamp.flower': 'Garden Walk', 'stamp.sun': 'Sunny Spirit', 'stamp.umbrella': 'Rainy Comfort',
            'stamp.moon': 'Quiet Night', 'stamp.rainbow': 'After the Rain', 'stamp.sprout': 'New Sprout',
            'stamp.heal': 'Self Care', 'stamp.paw': 'Furry Moments', 'stamp.gradcap': 'Exam Season',
```

- [ ] **Step 5: 焦點測試綠（含 i18n.test.js 若驗 key 對稱）→ desktop 全綠 → Commit**

```bash
git add desktop/js/mascot.js desktop/js/i18n.js desktop/tests/mascot_stamps.test.js
git commit -m "feat(desktop): MascotModule.stampIcon——24 款 AI 印章 SVG 資產＋雙語印章名"
```

---

### Task 5: 前端 day-notes 顯示（月格徽章＋日面板 P1 印章卡＋刪除）

**Files:**
- Modify: `desktop/js/api_service.js`（calendar 函式群 :1252-1273 後加兩函式＋return 曝光 :1556-1559 區）
- Modify: `desktop/js/calendar_module.js`（狀態區 :119-131、loadMonth :252-278、renderGrid cell 組字 :419-422、renderDayPanel :472-531、handleDayPanelClick :535-556、reset :902-918）
- Modify: `desktop/css/calendar.css`（檔尾加區塊）
- Modify: `desktop/js/i18n.js`（4 鍵 ×2 語）
- Test: `desktop/tests/calendar_day_notes.test.js`（新檔）

**Interfaces:**
- Consumes：Task 2 API、Task 4 `MascotModule.stampIcon`。
- Produces：`ApiService.getDayNotes(start, end)`、`ApiService.deleteDayNote(date)`；`CalendarModule` 內部 `dayNotesByDate: Map<"YYYY-MM-DD", note>`。

- [ ] **Step 1: 寫失敗測試**（新檔；fixture／mock 模式照抄 `desktop/tests/mascot_empty.test.js` 的 CalendarModule describe——`loadScript` 順序 mascot→calendar、`window.ApiService` 物件替身、`CalendarModule.init()` 後直接 `await CalendarModule.loadMonth()`）

```javascript
// @vitest-environment jsdom
/** 月格印章徽章＋日面板 P1 印章卡 (v2.5 Spec A)。 */
import { vi } from 'vitest';
import { loadScript } from './helpers/load.js';

const NOTE = { date: null, stamp: 'cake', phrase: '幫媽媽慶生的這天，你把愛做成了行動', source_diary_id: 7 };

function isoToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('calendar day notes', () => {
    beforeEach(async () => {
        document.body.innerHTML = `
            <div id="calendar-view"></div>
            <div class="calendar-grid"></div>
            <div class="calendar-weekdays"></div>
            <div class="calendar-day-panel"></div>
            <span class="calendar-month-label"></span>`;
        NOTE.date = isoToday();
        window.ApiService = {
            isAuthenticated: () => true,
            getCalendarEvents: vi.fn(async () => ({ occurrences: [] })),
            getDayNotes: vi.fn(async () => ({ notes: [NOTE] })),
            deleteDayNote: vi.fn(async () => ({ message: 'ok' })),
        };
        loadScript('js/mascot.js');
        loadScript('js/i18n.js');
        loadScript('js/calendar_module.js');
        CalendarModule.init();
        await CalendarModule.loadMonth();
    });

    test('月格有 14px 印章徽章、title 帶小語', () => {
        const cell = document.querySelector(`[data-date="${NOTE.date}"]`);
        expect(cell.innerHTML).toContain('cell-stamp');
        expect(cell.innerHTML).toContain('width="14"');
        expect(cell.innerHTML).toContain('幫媽媽慶生');
    });

    test('日面板 P1：印章卡在最上、40px、含小語與刪除鍵', () => {
        const panel = document.querySelector('.calendar-day-panel');
        expect(panel.innerHTML).toContain('day-stamp-card');
        expect(panel.innerHTML).toContain('width="40"');
        expect(panel.innerHTML).toContain('幫媽媽慶生');
        expect(panel.querySelector('[data-action="delete-note"]')).toBeTruthy();
        // 印章卡在事件區塊之前
        const html = panel.innerHTML;
        expect(html.indexOf('day-stamp-card')).toBeLessThan(html.indexOf('day-panel-empty'));
    });

    test('刪除印章：確認後打 API 並移除卡片', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        document.querySelector('[data-action="delete-note"]').click();
        await Promise.resolve(); await Promise.resolve();
        expect(window.ApiService.deleteDayNote).toHaveBeenCalledWith(NOTE.date);
        expect(document.querySelector('.day-stamp-card')).toBeNull();
    });

    test('day-notes 載入失敗不影響月曆', async () => {
        window.ApiService.getDayNotes = vi.fn(async () => { throw new Error('boom'); });
        await CalendarModule.loadMonth();
        expect(document.querySelectorAll('[data-date]').length).toBe(42);
    });
});
```

（fixture 若缺 toolbar 按鈕會有既有的 console.warn 噪音——與 mascot_empty.test.js 同源的已知現象，不算失敗。若 `loadScript('js/i18n.js')` 在該 harness 有困難，比照既有測試改用最小 `window.I18N = { t: k => k, dateLocale: () => 'zh-TW' }` 替身。）

- [ ] **Step 2: api_service.js 兩函式＋曝光**

```javascript
    // v2.5 Spec A：AI 日記印章（隨月載入；無 POST——寫入在 /chat/end 伺服器端）
    async function getDayNotes(start, end) {
        const path = `/calendar/day-notes?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
        return await fetchAPI(path, { method: 'GET' });
    }

    // 刪除某日印章 → { message }
    async function deleteDayNote(dateIso) {
        return await fetchAPI(`/calendar/day-notes/${encodeURIComponent(dateIso)}`, { method: 'DELETE' });
    }
```

return 區加 `getDayNotes: getDayNotes,`、`deleteDayNote: deleteDayNote,`。

- [ ] **Step 3: calendar_module.js 接線**

狀態區加 `let dayNotesByDate = new Map();`。

`loadMonth` 的 try 區塊改為並行載入（day-notes 失敗靜默、不影響月曆主流程）：

```javascript
            const [response, notesResponse] = await Promise.all([
                ApiService.getCalendarEvents(range.startIso, range.endIso),
                (typeof ApiService.getDayNotes === 'function'
                    ? ApiService.getDayNotes(range.startIso, range.endIso)
                        .catch(err => { console.warn('載入 AI 印章失敗（不影響月曆）:', err); return null; })
                    : Promise.resolve(null)),
            ]);
            indexOccurrences(response && response.occurrences);
            indexDayNotes(notesResponse && notesResponse.notes);
```

新函式（indexOccurrences 後）：

```javascript
    // 印章依日期建索引；一天最多一筆 (後端 UNIQUE)，直接覆蓋
    function indexDayNotes(notes) {
        dayNotesByDate = new Map();
        if (!Array.isArray(notes)) return;
        notes.forEach(n => {
            if (n && typeof n.date === 'string' && n.stamp) dayNotesByDate.set(n.date, n);
        });
    }

    // 月格 14px 印章徽章 (核可佈局 A)；tooltip = 小語全文
    function renderCellStamp(note) {
        if (!note || typeof MascotModule === 'undefined' || !MascotModule.stampIcon) return '';
        return `<span class="cell-stamp" title="${escapeHtml(note.phrase || '')}">` +
               `${MascotModule.stampIcon(note.stamp, 14)}</span>`;
    }
```

`renderGrid` 的 cell 組字改為（`cell-day` span 後插入徽章）：

```javascript
            html += `<button type="button" class="${classes.join(' ')}" data-date="${escapeHtml(iso)}">` +
                    `<span class="cell-day">${cellDate.getDate()}</span>` +
                    renderCellStamp(dayNotesByDate.get(iso)) +
                    renderCellDots(occurrencesByDate.get(iso)) +
                    `</button>`;
```

`renderDayPanel` 在 header 組字後、`if (list.length === 0)` 前插入印章卡（P1：情感先於行程）：

```javascript
        const note = dayNotesByDate.get(iso);
        if (note && typeof MascotModule !== 'undefined' && MascotModule.stampIcon) {
            const sourceBtn = note.source_diary_id
                ? `<button type="button" class="btn btn-sm" data-action="open-diary">${escapeHtml(I18N.t('calendar.stampFromDiary'))}</button>`
                : '';
            html += `<div class="day-stamp-card">
                    ${MascotModule.stampIcon(note.stamp, 40)}
                    <div class="day-stamp-text">
                        <p class="day-stamp-phrase">${escapeHtml(note.phrase || '')}</p>
                        ${sourceBtn}
                    </div>
                    <button type="button" class="btn btn-sm day-stamp-delete" data-action="delete-note"
                            title="${escapeHtml(I18N.t('calendar.stampDelete'))}"><i class="fa fa-trash"></i></button>
                </div>`;
        }
```

`handleDayPanelClick` 在 `action === 'add'` 分支後加：

```javascript
        if (action === 'delete-note') {
            deleteDayNoteFor(selectedDate);
            return;
        }
        if (action === 'open-diary') {
            // v1：跳到日記視圖（若 DiaryModule 未來提供 openDiary(id) 再深連結）
            if (typeof UIManager !== 'undefined' && UIManager.handleNavigation) {
                UIManager.handleNavigation('diary');
            }
            return;
        }
```

新函式（confirmDelete 後）：

```javascript
    async function deleteDayNoteFor(dateIso) {
        if (!dateIso || !dayNotesByDate.has(dateIso)) return;
        if (!window.confirm(I18N.t('calendar.stampDeleteConfirm'))) return;
        try {
            await ApiService.deleteDayNote(dateIso);
            dayNotesByDate.delete(dateIso);
            renderGrid();
            renderDayPanel(selectedDate);
        } catch (error) {
            console.error('刪除 AI 印章失敗:', error);
            UIManager.showToast(I18N.t('calendar.stampDeleteFailed'));
        }
    }
```

`reset()` 加 `dayNotesByDate = new Map();`。

- [ ] **Step 4: css＋i18n**

`calendar.css` 檔尾加：

```css
/* --- AI 日記印章 (v2.5 Spec A；佈局 A＝月格角落徽章、P1＝日面板印章開場) --- */
.calendar-cell { position: relative; }
.cell-stamp { position: absolute; top: 2px; right: 3px; line-height: 0; }
.day-stamp-card {
    display: flex; align-items: center; gap: 10px;
    background: var(--bg-secondary, #fff); border: 2px solid var(--border-color, #f0e6d2);
    border-radius: 10px; padding: 10px; margin-bottom: 8px;
}
.day-stamp-text { flex: 1; min-width: 0; }
.day-stamp-phrase { margin: 0 0 4px; font-size: 14px; }
.day-stamp-delete { opacity: .35; }
.day-stamp-card:hover .day-stamp-delete, .day-stamp-delete:focus { opacity: 1; }
```

i18n 兩語各 4 鍵（calendar 區）：

```javascript
            'calendar.stampFromDiary': '來自這天的日記',
            'calendar.stampDelete': '刪除這天的印章',
            'calendar.stampDeleteConfirm': '要拿掉這天的印章與小語嗎？',
            'calendar.stampDeleteFailed': '刪除印章失敗，請稍後再試',
```

```javascript
            'calendar.stampFromDiary': "From this day's diary",
            'calendar.stampDelete': 'Remove this stamp',
            'calendar.stampDeleteConfirm': 'Remove the stamp and note for this day?',
            'calendar.stampDeleteFailed': 'Failed to remove the stamp, please try again',
```

- [ ] **Step 5: 焦點測試綠 → desktop 全綠 → Commit**

```bash
git add desktop/js/api_service.js desktop/js/calendar_module.js desktop/css/calendar.css desktop/js/i18n.js desktop/tests/calendar_day_notes.test.js
git commit -m "feat(desktop): AI 印章顯示——月格角落徽章＋日面板 P1 印章卡＋刪除"
```

---

### Task 6: 前端跨天橫槓（lane 純函式＋grid 顯式定位渲染＋CSS）

**Files:**
- Modify: `desktop/js/calendar_module.js`（純函式區 :23-115 後加三個純函式；renderGrid :399-426；grid click 委派 :205-210；return 曝光 :920-941）
- Modify: `desktop/css/calendar.css`（檔尾加區塊）
- Test: `desktop/tests/calendar_span_bars.test.js`（新檔）

**Interfaces:**
- Consumes：Task 1 occurrence 的 `span_total/span_day/end_date/color/event_date`。
- Produces：`CalendarModule.collectSpanEvents(occurrences)`、`CalendarModule.computeWeekSegments(spanEvents, weekStartIso)`（曝光供測試）。

**渲染原理（binding）：** `.calendar-grid` 本身是 7 欄 CSS grid、42 個 cell button 靠 auto-flow 佔滿 6 列。橫槓做成**顯式定位的 grid 子項**（inline style `grid-row: R; grid-column: A / B;`）附加在 42 個 cell 之後——顯式定位項可與 auto-flow 項重疊，天然與格線同一套 grid 計算，resize 免疫、零像素數學；z-index 蓋過格線＝連續膠囊不被切斷（硬規則）。

- [ ] **Step 1: 寫失敗測試**

```javascript
// @vitest-environment jsdom
/** 跨天橫槓：span 事件收集與週段落/lane 計算 (v2.5 Spec A)。 */
import { loadScript } from './helpers/load.js';

function occ(overrides) {
    return Object.assign({
        event_id: 1, title: '旅行', category: 'travel', color: null,
        date: '2026-09-01', event_date: '2026-09-01', end_date: '2026-09-03',
        span_day: 1, span_total: 3, time: null, recurrence: 'none',
    }, overrides);
}

describe('span bars', () => {
    beforeEach(() => { loadScript('js/calendar_module.js'); });

    test('collectSpanEvents：只收 span_total>1、依 event_id 去重', () => {
        const events = CalendarModule.collectSpanEvents([
            occ({ date: '2026-09-01', span_day: 1 }),
            occ({ date: '2026-09-02', span_day: 2 }),
            occ({ event_id: 2, span_total: 1, span_day: null, end_date: null }),
        ]);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ eventId: 1, start: '2026-09-01', end: '2026-09-03' });
    });

    test('週內段落：起訖同週＝兩端圓角、colStart/colEnd 正確（2026-08-31 是週一）', () => {
        const segs = CalendarModule.computeWeekSegments(
            [{ eventId: 1, title: '旅行', category: 'travel', color: null, start: '2026-09-01', end: '2026-09-03' }],
            '2026-08-31').segments;
        expect(segs).toHaveLength(1);
        expect(segs[0]).toMatchObject({ colStart: 2, colEnd: 4, roundLeft: true, roundRight: true, lane: 0, showTitle: true });
    });

    test('跨週事件：前段不封右圓角、後段不封左圓角、標題只在首段', () => {
        const ev = [{ eventId: 1, title: '長旅', category: 'travel', color: '#8f62c9', start: '2026-09-05', end: '2026-09-08' }];
        const w1 = CalendarModule.computeWeekSegments(ev, '2026-08-31').segments[0]; // 週六日
        const w2 = CalendarModule.computeWeekSegments(ev, '2026-09-07').segments[0]; // 週一二
        expect(w1).toMatchObject({ colStart: 6, colEnd: 7, roundRight: false, showTitle: true });
        expect(w2).toMatchObject({ colStart: 1, colEnd: 2, roundLeft: false, showTitle: false });
    });

    test('lane 分配：兩條並存、第三條進 overflow 計數', () => {
        const evs = [
            { eventId: 1, title: 'A', category: 'work', color: null, start: '2026-09-01', end: '2026-09-03' },
            { eventId: 2, title: 'B', category: 'family', color: null, start: '2026-09-02', end: '2026-09-04' },
            { eventId: 3, title: 'C', category: 'other', color: null, start: '2026-09-02', end: '2026-09-03' },
        ];
        const out = CalendarModule.computeWeekSegments(evs, '2026-08-31');
        expect(out.segments.map(s => s.lane).sort()).toEqual([0, 1]);
        expect(out.overflow.get('2026-09-02')).toBe(1);
        expect(out.overflow.get('2026-09-03')).toBe(1);
    });

    test('與週無交集＝空結果', () => {
        const out = CalendarModule.computeWeekSegments(
            [{ eventId: 1, title: 'x', category: 'other', color: null, start: '2026-10-01', end: '2026-10-02' }],
            '2026-08-31');
        expect(out.segments).toEqual([]);
    });
});
```

- [ ] **Step 2: 純函式實作**（放在 `parseLocalDateTime` 之後，同「純函式」區）

```javascript
    // "YYYY-MM-DD" ± n 天 → "YYYY-MM-DD"（本地，避開 toISOString 的 UTC 偏移）
    function addDaysIso(dateIso, days) {
        const d = new Date(`${dateIso}T00:00:00`);
        return toIsoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
    }

    /**
     * ★ 純函式：從 occurrence 陣列收集跨天事件（span_total > 1），依 event_id 去重
     * @returns {Array<{eventId, title, category, color, start, end}>}
     */
    function collectSpanEvents(occurrences) {
        const byId = new Map();
        (Array.isArray(occurrences) ? occurrences : []).forEach(occ => {
            if (!occ || !(occ.span_total > 1) || !occ.event_date || !occ.end_date) return;
            if (byId.has(occ.event_id)) return;
            byId.set(occ.event_id, {
                eventId: occ.event_id, title: occ.title,
                category: categoryOf(occ), color: occ.color || null,
                start: occ.event_date, end: occ.end_date,
            });
        });
        return Array.from(byId.values());
    }

    /**
     * ★ 純函式：某一週（weekStartIso＝該週週一）的橫槓段落與溢出計數
     *
     * lane 分配（spec §4）：起日早者先佔上道，同起日依 eventId 小者先；
     * 最多 2 條 lane，其餘進 overflow（date → 被藏起的條數），該格顯示 +N。
     * 段落欄位 colStart/colEnd 為 1-based（1=週一格 … 7=週日格，含兩端）。
     */
    function computeWeekSegments(spanEvents, weekStartIso) {
        const weekEndIso = addDaysIso(weekStartIso, 6);
        const segments = [];
        const overflow = new Map();
        const laneEnds = [null, null];   // 每道目前佔用到的結束日

        const sorted = (spanEvents || []).slice().sort((a, b) =>
            a.start < b.start ? -1 : a.start > b.start ? 1 : (a.eventId - b.eventId));

        sorted.forEach(ev => {
            if (ev.end < weekStartIso || ev.start > weekEndIso) return;   // 與本週無交集

            const segStart = ev.start > weekStartIso ? ev.start : weekStartIso;
            const segEnd = ev.end < weekEndIso ? ev.end : weekEndIso;

            let lane = -1;
            for (let i = 0; i < laneEnds.length; i++) {
                if (laneEnds[i] === null || laneEnds[i] < ev.start) { lane = i; break; }
            }
            if (lane === -1) {
                // 兩道皆滿：整段每一天記一筆溢出
                for (let d = segStart; d <= segEnd; d = addDaysIso(d, 1)) {
                    overflow.set(d, (overflow.get(d) || 0) + 1);
                }
                return;
            }
            laneEnds[lane] = ev.end;

            const dayDiff = (a, b) => Math.round(
                (new Date(`${a}T00:00:00`) - new Date(`${b}T00:00:00`)) / 86400000);
            segments.push({
                eventId: ev.eventId, title: ev.title, category: ev.category,
                color: ev.color, lane: lane,
                colStart: dayDiff(segStart, weekStartIso) + 1,
                colEnd: dayDiff(segEnd, weekStartIso) + 1,
                roundLeft: ev.start >= weekStartIso,
                roundRight: ev.end <= weekEndIso,
                showTitle: ev.start >= weekStartIso,   // 標題只在含事件起日的那一段
            });
        });

        return { segments: segments, overflow: overflow };
    }
```

- [ ] **Step 3: renderGrid 接線＋點擊**

`renderGrid` 在 42 格迴圈結束後、`gridElement.innerHTML = html;` 前插入：

```javascript
        // 跨天橫槓：顯式定位的 grid 子項（見 Task 6 渲染原理），附加在 cell 之後
        const spanEvents = collectSpanEvents(flattenOccurrences());
        for (let week = 0; week < 6; week++) {
            const weekStartIso = toIsoDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7));
            const out = computeWeekSegments(spanEvents, weekStartIso);
            out.segments.forEach(seg => {
                const cls = ['cal-span-bar', `lane-${seg.lane}`];
                if (!seg.roundLeft) cls.push('no-round-left');
                if (!seg.roundRight) cls.push('no-round-right');
                const bg = seg.color ? escapeHtml(seg.color) : `var(--cat-${escapeHtml(seg.category)})`;
                html += `<button type="button" class="${cls.join(' ')}" data-span-event-id="${escapeHtml(seg.eventId)}"` +
                        ` style="grid-row: ${week + 1}; grid-column: ${seg.colStart} / ${seg.colEnd + 1}; background: ${bg};"` +
                        ` title="${escapeHtml(seg.title)}">${seg.showTitle ? escapeHtml(seg.title) : ''}</button>`;
            });
            out.overflow.forEach((count, dateIso) => {
                const col = Math.round((new Date(`${dateIso}T00:00:00`) - new Date(`${weekStartIso}T00:00:00`)) / 86400000) + 1;
                html += `<span class="cell-span-more" style="grid-row: ${week + 1}; grid-column: ${col};">+${count}</span>`;
            });
        }
```

新 helper（indexOccurrences 後）：

```javascript
    // 目前月份索引攤平回陣列（collectSpanEvents 的輸入）
    function flattenOccurrences() {
        const all = [];
        occurrencesByDate.forEach(list => { all.push.apply(all, list); });
        return all;
    }
```

grid click 委派改為（橫槓優先於格子）：

```javascript
        gridElement.addEventListener('click', function(event) {
            const bar = event.target.closest('[data-span-event-id]');
            if (bar && gridElement.contains(bar)) {
                const id = bar.getAttribute('data-span-event-id');
                const occurrence = flattenOccurrences().find(o => String(o.event_id) === String(id));
                if (occurrence) openEventForm(occurrence, occurrence.date);
                return;
            }
            const cell = event.target.closest('[data-date]');
            if (cell && gridElement.contains(cell)) {
                selectDate(cell.getAttribute('data-date'));
            }
        });
```

return 區加 `collectSpanEvents: collectSpanEvents,`、`computeWeekSegments: computeWeekSegments,`。

- [ ] **Step 4: CSS**（calendar.css 檔尾）

```css
/* --- 跨天橫槓 (v2.5 Spec A)：grid 顯式定位項，蓋過格線的連續膠囊 --- */
.cal-span-bar {
    align-self: start; z-index: 2; height: 14px; margin-top: 24px;
    border: none; border-radius: 7px; padding: 0 6px;
    color: #fff; font-size: 10px; line-height: 14px; text-align: left;
    overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
    cursor: pointer; box-shadow: 0 1px 2px rgba(0, 0, 0, .18);
}
.cal-span-bar.lane-1 { margin-top: 40px; }
.cal-span-bar.no-round-left { border-top-left-radius: 0; border-bottom-left-radius: 0; }
.cal-span-bar.no-round-right { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.cell-span-more {
    align-self: start; justify-self: end; z-index: 2;
    margin-top: 40px; margin-right: 3px; font-size: 9px;
    color: var(--text-secondary, #8a7a66); pointer-events: none;
}
```

（若實作時發現月格 min-height 不足以容納兩道 lane＋圖標列，調 `.calendar-cell` 的 min-height——只加不減，並在報告註明調了多少。）

- [ ] **Step 5: 焦點測試綠 → desktop 全綠 → Commit**

```bash
git add desktop/js/calendar_module.js desktop/css/calendar.css desktop/tests/calendar_span_bars.test.js
git commit -m "feat(desktop): 跨天橫槓——lane 純函式＋grid 顯式定位連續膠囊（TimeTree 式）"
```

---

### Task 7: 事件表單——結束日期＋顏色 swatch

**Files:**
- Modify: `desktop/index.html`（event-dialog :307-360 區：全天列之後插結束日期列；分類列之後插顏色列）
- Modify: `desktop/js/calendar_module.js`（buildFormValues :629-640、openEventForm :651-685、readForm :719-739、saveEvent 驗證 :741-752、bindListeners :219-228、syncAllDayState 附近加 syncMultiDayState；return 曝光）
- Modify: `desktop/js/i18n.js`（5 鍵 ×2 語）
- Modify: `desktop/css/calendar.css`（swatch 樣式）
- Test: `desktop/tests/calendar_form_multiday.test.js`（新檔）

**Interfaces:**
- Consumes：Task 1 的 `end_date`/`color`（occurrence 與 API payload 直通）。

- [ ] **Step 1: 寫失敗測試**（fixture 含表單元素；模式照抄既有 readForm 相關測試——grep `readForm` 在 desktop/tests/ 的用例照其 DOM 建構）

```javascript
// @vitest-environment jsdom
/** 事件表單跨天＋顏色 (v2.5 Spec A)：readForm/buildFormValues/syncMultiDayState。 */
import { loadScript } from './helpers/load.js';

function buildFormDom() {
    document.body.innerHTML = `
        <input id="event-title" value="旅行"><textarea id="event-note"></textarea>
        <select id="event-category"><option value="travel" selected>出遊</option><option value="other">其他</option></select>
        <input id="event-date" value="2026-09-01">
        <input type="checkbox" id="event-all-day" checked><input id="event-time" value="09:00">
        <select id="event-recurrence"><option value="none" selected>none</option><option value="weekly">weekly</option></select>
        <input id="event-until"><select id="event-reminder"><option value="" selected></option></select>
        <input id="event-end-date" value="">
        <div id="event-color-swatches">
            <input type="radio" name="event-color" value="" checked>
            <input type="radio" name="event-color" value="#8f62c9">
        </div>
        <small id="event-multiday-hint" style="display:none"></small>
        <div id="event-error"></div>`;
}

describe('multi-day form', () => {
    beforeEach(() => { buildFormDom(); loadScript('js/calendar_module.js'); });

    test('readForm：空結束日＝null、預設色＝null', () => {
        const form = CalendarModule.readForm();
        expect(form.end_date).toBeNull();
        expect(form.color).toBeNull();
    });

    test('readForm：帶結束日與選色', () => {
        document.getElementById('event-end-date').value = '2026-09-03';
        document.querySelector('input[name="event-color"][value="#8f62c9"]').checked = true;
        const form = CalendarModule.readForm();
        expect(form.end_date).toBe('2026-09-03');
        expect(form.color).toBe('#8f62c9');
    });

    test('syncMultiDayState：設了結束日＝鎖全天/時間/重複/提醒＋顯示提示', () => {
        document.getElementById('event-end-date').value = '2026-09-03';
        CalendarModule.syncMultiDayState();
        expect(document.getElementById('event-all-day').checked).toBe(true);
        expect(document.getElementById('event-all-day').disabled).toBe(true);
        expect(document.getElementById('event-time').disabled).toBe(true);
        expect(document.getElementById('event-recurrence').disabled).toBe(true);
        expect(document.getElementById('event-multiday-hint').style.display).not.toBe('none');
        document.getElementById('event-end-date').value = '';
        CalendarModule.syncMultiDayState();
        expect(document.getElementById('event-all-day').disabled).toBe(false);
        expect(document.getElementById('event-recurrence').disabled).toBe(false);
    });

    test('buildFormValues：occurrence 帶 end_date/color 時預填', () => {
        const values = CalendarModule.buildFormValues({
            title: 't', note: null, category: 'travel', event_date: '2026-09-01',
            time: null, recurrence: 'none', recurrence_until: null,
            reminder_minutes: null, end_date: '2026-09-03', color: '#8f62c9',
        }, null);
        expect(values.end_date).toBe('2026-09-03');
        expect(values.color).toBe('#8f62c9');
    });
});
```

- [ ] **Step 2: index.html 表單欄位**

「全天」checkbox 的 form-group 之後插入：

```html
                    <div class="form-group">
                        <label for="event-end-date" data-i18n="calendar.endDate">結束日期（跨天活動，留空＝單日）:</label>
                        <input type="date" id="event-end-date" class="form-control">
                        <small id="event-multiday-hint" style="display: none; color: #888; margin-top: 4px;" data-i18n="calendar.multiDayHint">
                            跨天活動固定為整天型，時間／重複／提醒已停用
                        </small>
                    </div>
```

分類 select 的 form-group 之後插入：

```html
                    <div class="form-group">
                        <label data-i18n="calendar.color">顏色（跨天橫槓用）:</label>
                        <div id="event-color-swatches" class="color-swatches">
                            <label class="swatch swatch-default" title="分類色">
                                <input type="radio" name="event-color" value="" checked>
                                <span data-i18n="calendar.colorDefault">分類色</span>
                            </label>
                            <label class="swatch" style="--swatch: #e8836f;"><input type="radio" name="event-color" value="#e8836f"></label>
                            <label class="swatch" style="--swatch: #f5c542;"><input type="radio" name="event-color" value="#f5c542"></label>
                            <label class="swatch" style="--swatch: #5fd0a0;"><input type="radio" name="event-color" value="#5fd0a0"></label>
                            <label class="swatch" style="--swatch: #7f96c9;"><input type="radio" name="event-color" value="#7f96c9"></label>
                            <label class="swatch" style="--swatch: #8f62c9;"><input type="radio" name="event-color" value="#8f62c9"></label>
                            <label class="swatch" style="--swatch: #e8899a;"><input type="radio" name="event-color" value="#e8899a"></label>
                            <label class="swatch" style="--swatch: #2a78d6;"><input type="radio" name="event-color" value="#2a78d6"></label>
                            <label class="swatch" style="--swatch: #b8b2a5;"><input type="radio" name="event-color" value="#b8b2a5"></label>
                        </div>
                    </div>
```

- [ ] **Step 3: calendar_module.js**

`buildFormValues` return 補：

```javascript
            reminder_minutes: occurrence ? occurrence.reminder_minutes : null,
            end_date: (occurrence && occurrence.end_date) ? occurrence.end_date : null,
            color: (occurrence && occurrence.color) ? occurrence.color : null
```

`openEventForm` 在 `setValue('event-reminder', ...)` 後加：

```javascript
        setValue('event-end-date', values.end_date || '');
        const colorRadio = document.querySelector(
            `input[name="event-color"][value="${values.color || ''}"]`);
        const defaultRadio = document.querySelector('input[name="event-color"][value=""]');
        if (colorRadio) colorRadio.checked = true;
        else if (defaultRadio) defaultRadio.checked = true;
```

並在既有 `syncAllDayState(); syncRecurrenceState();` 呼叫處補 `syncMultiDayState();`。

新函式（syncRecurrenceState 後）：

```javascript
    // 跨天（設了結束日）＝整天型鎖定：全天強制勾選並停用、時間/重複/提醒停用
    // （與後端 schema/路由的 multi_day_invalid 不變量一致；readForm 對停用中的
    // 重複選單一律輸出 'none'，比照「停用中的提醒＝未設提醒」的既有規則）
    function syncMultiDayState() {
        const endInput = document.getElementById('event-end-date');
        if (!endInput) return;
        const isMultiDay = !!endInput.value;

        const allDayInput = document.getElementById('event-all-day');
        if (allDayInput) {
            if (isMultiDay) allDayInput.checked = true;
            allDayInput.disabled = isMultiDay;
        }
        const recurrenceInput = document.getElementById('event-recurrence');
        if (recurrenceInput) {
            if (isMultiDay) recurrenceInput.value = 'none';
            recurrenceInput.disabled = isMultiDay;
        }
        const hint = document.getElementById('event-multiday-hint');
        if (hint) hint.style.display = isMultiDay ? 'block' : 'none';

        syncAllDayState();
        syncRecurrenceState();
    }
```

`bindListeners` 加：

```javascript
        const endDateInput = document.getElementById('event-end-date');
        if (endDateInput) {
            endDateInput.addEventListener('change', syncMultiDayState);
        }
```

`readForm` 的 return 補（並在函式內先讀 radio）：

```javascript
        const colorInput = document.querySelector('input[name="event-color"]:checked');
        const endDate = getValue('event-end-date');
```

```javascript
            reminder_minutes: reminder === '' ? null : Number(reminder),
            end_date: endDate || null,
            color: (colorInput && colorInput.value) ? colorInput.value : null
```

（跨天時 `recurrence` 選單被停用但值已被 syncMultiDayState 設為 'none'，readForm 讀值即正確。）

`saveEvent` 在 event_date 檢查後加用戶端驗證：

```javascript
        if (payload.end_date && payload.end_date < payload.event_date) {
            showFormError(I18N.t('calendar.endBeforeStart'));
            return;
        }
```

return 區加 `syncMultiDayState: syncMultiDayState,`。

- [ ] **Step 4: css＋i18n**

`calendar.css` 檔尾加：

```css
/* --- 事件表單顏色 swatch (v2.5 Spec A) --- */
.color-swatches { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.color-swatches .swatch { display: inline-flex; align-items: center; cursor: pointer; }
.color-swatches .swatch input { width: auto; margin: 0; }
.color-swatches .swatch:not(.swatch-default) input { appearance: none; -webkit-appearance: none;
    width: 22px; height: 22px; border-radius: 50%; background: var(--swatch);
    border: 2px solid transparent; cursor: pointer; }
.color-swatches .swatch:not(.swatch-default) input:checked { border-color: var(--text-primary, #4b2e1e); }
```

i18n 兩語各 5 鍵：

```javascript
            'calendar.endDate': '結束日期（跨天活動，留空＝單日）:',
            'calendar.multiDayHint': '跨天活動固定為整天型，時間／重複／提醒已停用',
            'calendar.color': '顏色（跨天橫槓用）:',
            'calendar.colorDefault': '分類色',
            'calendar.endBeforeStart': '結束日期不可早於開始日期',
```

```javascript
            'calendar.endDate': 'End date (multi-day, leave empty for single day):',
            'calendar.multiDayHint': 'Multi-day events are all-day; time, repeat and reminder are disabled',
            'calendar.color': 'Color (for the multi-day bar):',
            'calendar.colorDefault': 'Category color',
            'calendar.endBeforeStart': 'End date must not be before the start date',
```

- [ ] **Step 5: 焦點測試綠 → desktop 全綠 → Commit**

```bash
git add desktop/index.html desktop/js/calendar_module.js desktop/css/calendar.css desktop/js/i18n.js desktop/tests/calendar_form_multiday.test.js
git commit -m "feat(desktop): 事件表單跨天結束日＋顏色 swatch——整天型鎖定與後端不變量一致"
```

---

### Task 8: 年份選取 picker

**Files:**
- Modify: `desktop/index.html`（calendar-toolbar :444-455：month-label 外包按鈕）
- Modify: `desktop/js/calendar_module.js`（bindListeners、renderMonthLabel、新函式群）
- Modify: `desktop/css/calendar.css`（picker 樣式）
- Modify: `desktop/js/i18n.js`（1 鍵 ×2 語）
- Test: `desktop/tests/calendar_year_picker.test.js`（新檔）

- [ ] **Step 1: 寫失敗測試**

```javascript
// @vitest-environment jsdom
/** 年月 picker (v2.5 Spec A #9)。 */
import { loadScript } from './helpers/load.js';

describe('year picker', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="calendar-view"></div><div class="calendar-grid"></div>
            <div class="calendar-weekdays"></div><div class="calendar-day-panel"></div>
            <button id="calendar-ym-btn"><span class="calendar-month-label"></span></button>
            <div id="calendar-ym-picker" style="display:none"></div>`;
        window.ApiService = { isAuthenticated: () => false, getCalendarEvents: async () => ({ occurrences: [] }) };
        window.I18N = { t: k => k, dateLocale: () => 'zh-TW' };   // picker 與週標頭都會用到
        loadScript('js/calendar_module.js');
        CalendarModule.init();
    });

    test('點年月鈕開 picker：含 21 個年份與 12 個月份鈕', () => {
        document.getElementById('calendar-ym-btn').click();
        const picker = document.getElementById('calendar-ym-picker');
        expect(picker.style.display).not.toBe('none');
        expect(picker.querySelectorAll('[data-ym-year]').length).toBe(21);
        expect(picker.querySelectorAll('[data-ym-month]').length).toBe(12);
    });

    test('選年再選月＝跳轉並關閉', () => {
        document.getElementById('calendar-ym-btn').click();
        const picker = document.getElementById('calendar-ym-picker');
        picker.querySelector('[data-ym-year="2030"]').click();
        expect(picker.style.display).not.toBe('none');       // 選年不關
        picker.querySelector('[data-ym-month="3"]').click();  // 0-based：3 = 4 月
        expect(picker.style.display).toBe('none');
        expect(document.querySelector('.calendar-month-label').textContent).toContain('2030');
    });
});
```

- [ ] **Step 2: index.html**——toolbar 的 `<span class="calendar-month-label"></span>` 外包按鈕、並在 toolbar 結尾後加 picker 容器：

```html
                    <button id="calendar-ym-btn" class="btn btn-sm" title="選擇年月" data-i18n-title="calendar.pickYearMonth">
                        <span class="calendar-month-label"></span>
                    </button>
```

```html
                <div id="calendar-ym-picker" class="calendar-ym-picker" style="display: none;"></div>
```

- [ ] **Step 3: calendar_module.js**

`bindListeners` 加：

```javascript
        bindClick('#calendar-ym-btn', toggleYmPicker);
        document.addEventListener('click', function(event) {
            const picker = document.getElementById('calendar-ym-picker');
            const btn = document.getElementById('calendar-ym-btn');
            if (!picker || picker.style.display === 'none') return;
            if (picker.contains(event.target) || (btn && btn.contains(event.target))) return;
            picker.style.display = 'none';
        });
        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape') {
                const picker = document.getElementById('calendar-ym-picker');
                if (picker) picker.style.display = 'none';
            }
        });
```

新函式群（goToToday 後）：

```javascript
    // --- 年月 picker (v2.5 Spec A #9) ------------------------------------------

    let pickerYear = null;   // picker 內暫選的年（尚未套用）

    function toggleYmPicker() {
        const picker = document.getElementById('calendar-ym-picker');
        if (!picker) return;
        if (picker.style.display !== 'none') { picker.style.display = 'none'; return; }
        pickerYear = viewYear;
        renderYmPicker();
        picker.style.display = 'block';
    }

    function renderYmPicker() {
        const picker = document.getElementById('calendar-ym-picker');
        if (!picker) return;

        let html = '<div class="ym-years">';
        for (let y = viewYear - 10; y <= viewYear + 10; y++) {
            html += `<button type="button" class="btn btn-sm${y === pickerYear ? ' active' : ''}" data-ym-year="${y}">${y}</button>`;
        }
        html += '</div><div class="ym-months">';
        for (let m = 0; m < 12; m++) {
            const label = new Date(2026, m, 1).toLocaleDateString(I18N.dateLocale(), { month: 'short' });
            html += `<button type="button" class="btn btn-sm" data-ym-month="${m}">${escapeHtml(label)}</button>`;
        }
        html += '</div>';
        picker.innerHTML = html;

        picker.querySelectorAll('[data-ym-year]').forEach(btn => btn.addEventListener('click', () => {
            pickerYear = Number(btn.getAttribute('data-ym-year'));
            renderYmPicker();   // 更新 active 高亮，不關閉
        }));
        picker.querySelectorAll('[data-ym-month]').forEach(btn => btn.addEventListener('click', () => {
            viewYear = pickerYear;
            viewMonth = Number(btn.getAttribute('data-ym-month'));
            picker.style.display = 'none';
            renderMonthLabel();   // 先同步更新標籤（loadMonth 是 async，不 await——標籤不該等網路）
            loadMonth();
        }));
    }
```

- [ ] **Step 4: css＋i18n**

```css
/* --- 年月 picker (v2.5 Spec A) --- */
.calendar-ym-picker {
    position: absolute; z-index: 30; margin-top: 4px; padding: 10px;
    background: var(--bg-secondary, #fff); border: 1px solid var(--border-color, #d8d2c6);
    border-radius: 10px; box-shadow: 0 4px 14px rgba(0, 0, 0, .12); max-width: 340px;
}
.calendar-ym-picker .ym-years { display: flex; flex-wrap: wrap; gap: 4px; max-height: 120px; overflow-y: auto; margin-bottom: 8px; }
.calendar-ym-picker .ym-months { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.calendar-ym-picker .btn.active { outline: 2px solid var(--cat-work, #2a78d6); }
```

（`.calendar-toolbar` 若非 `position: relative`，補上一行讓 picker 錨定。）

i18n：`'calendar.pickYearMonth': '選擇年月'` / `'Pick year & month'`。

- [ ] **Step 5: 焦點測試綠 → desktop 全綠 → Commit**

```bash
git add desktop/index.html desktop/js/calendar_module.js desktop/css/calendar.css desktop/js/i18n.js desktop/tests/calendar_year_picker.test.js
git commit -m "feat(desktop): 行事曆年月 picker——±10 年跳轉"
```

---

### Task 9: 設定開關「AI 行事曆印章」＋endChat 接線

**Files:**
- Modify: `desktop/index.html`（設定頁語音區塊後加印章區塊 :~266-287 之後）
- Modify: `desktop/js/chat_module.js`（新增 isDayNoteEnabled/setDayNoteEnabled＋endChat 呼叫；return 曝光）
- Modify: `desktop/js/api_service.js`（endChat :1153-1180）
- Modify: `desktop/js/settings_module.js`（載入/儲存，比照 voice-input-mode 的處理 :697-710 附近）
- Modify: `desktop/js/i18n.js`（2 鍵 ×2 語）
- Test: `desktop/tests/day_note_setting.test.js`（新檔）

**Interfaces:**
- Consumes：Task 3 的 `/chat/end/` body 欄位 `enable_day_note`。
- Produces：`ChatModule.isDayNoteEnabled() -> bool`（預設 true）、`ChatModule.setDayNoteEnabled(on)`；`ApiService.endChat(model, enableDayNote)`。

- [ ] **Step 1: 寫失敗測試**

```javascript
// @vitest-environment jsdom
/** 「AI 行事曆印章」設定開關＋endChat 請求接線 (v2.5 Spec A)。 */
import { loadScript } from './helpers/load.js';

describe('day note setting', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = '<div id="chat-messages"></div>';
        loadScript('js/chat_module.js');
    });

    test('預設開啟；set 後持久化', () => {
        expect(ChatModule.isDayNoteEnabled()).toBe(true);
        ChatModule.setDayNoteEnabled(false);
        expect(ChatModule.isDayNoteEnabled()).toBe(false);
        expect(localStorage.getItem('urdiary_day_note_enabled')).toBe('0');
        ChatModule.setDayNoteEnabled(true);
        expect(ChatModule.isDayNoteEnabled()).toBe(true);
    });
});
```

並在 `desktop/tests/mascot_chat.test.js` 的 endChat describe 追加一條（沿用該檔的 ApiService mock 形狀——mock `endChat: vi.fn(async (model, enableDayNote) => ...)`）：

```javascript
    test('endChat 依設定帶 enable_day_note', async () => {
        localStorage.setItem('urdiary_day_note_enabled', '0');
        await ChatModule.endChat();
        const call = window.ApiService.endChat.mock.calls.at(-1);
        expect(call[1]).toBe(false);
    });
```

- [ ] **Step 2: index.html 設定區塊**（語音區塊的最後一個 form-group 之後、`settings-error` 之前）

```html
                    <hr style="margin: 14px 0;">
                    <h4 data-i18n="stampSet.sectionTitle">AI 行事曆印章</h4>
                    <div class="form-group">
                        <label style="display:flex;align-items:center;gap:8px;">
                            <input type="checkbox" id="stamp-enabled" style="width:auto;" checked>
                            <span data-i18n="stampSet.enable">日記完成後，自動在行事曆那天蓋上印章與小語</span>
                        </label>
                    </div>
```

- [ ] **Step 3: chat_module.js**

常數區加 `const DAY_NOTE_KEY = 'urdiary_day_note_enabled';`，新函式（比照 voice_module 的 localStorage getter/setter 慣例）：

```javascript
    // v2.5 Spec A：「AI 行事曆印章」開關（預設開；'0' 才是關）
    function isDayNoteEnabled() { return localStorage.getItem(DAY_NOTE_KEY) !== '0'; }
    function setDayNoteEnabled(on) { localStorage.setItem(DAY_NOTE_KEY, on ? '1' : '0'); }
```

`endChat` 內的 `await ApiService.endChat()` 改為 `await ApiService.endChat(null, isDayNoteEnabled())`。
return 區加 `isDayNoteEnabled: isDayNoteEnabled,`、`setDayNoteEnabled: setDayNoteEnabled,`。

- [ ] **Step 4: api_service.js**——`endChat` 簽名與 body 改為：

```javascript
    async function endChat(model = null, enableDayNote = true) {
```

```javascript
                body: {
                    exclude_interaction_notes: true,  // 防止將互動筆記融入日記
                    enable_day_note: enableDayNote !== false  // v2.5 Spec A：AI 行事曆印章開關
                }
```

- [ ] **Step 5: settings_module.js**——載入設定處（voice-input-mode 讀取附近）加：

```javascript
        const stampEl = document.getElementById('stamp-enabled');
        if (stampEl && typeof ChatModule !== 'undefined' && ChatModule.isDayNoteEnabled) {
            stampEl.checked = ChatModule.isDayNoteEnabled();
        }
```

儲存處（voice 設定寫回附近）加：

```javascript
        if (stampEl && typeof ChatModule !== 'undefined' && ChatModule.setDayNoteEnabled) {
            ChatModule.setDayNoteEnabled(stampEl.checked);
        }
```

（`stampEl` 於儲存函式內重新 `getElementById`，兩處分屬不同函式作用域。）

- [ ] **Step 6: i18n 兩語**

```javascript
            'stampSet.sectionTitle': 'AI 行事曆印章',
            'stampSet.enable': '日記完成後，自動在行事曆那天蓋上印章與小語',
```

```javascript
            'stampSet.sectionTitle': 'AI Calendar Stamps',
            'stampSet.enable': 'After each diary, stamp that day on the calendar with a little note',
```

- [ ] **Step 7: 焦點測試綠 → desktop 全綠＋backend 全綠（最終雙套件確認）→ Commit**

```bash
git add desktop/index.html desktop/js/chat_module.js desktop/js/api_service.js desktop/js/settings_module.js desktop/js/i18n.js desktop/tests/day_note_setting.test.js desktop/tests/mascot_chat.test.js
git commit -m "feat(desktop): 設定「AI 行事曆印章」開關＋endChat enable_day_note 接線"
```

---

## 人工驗收清單（全部 task 完成後交使用者）

- 建一筆 3 天跨天事件（自選紫色）：月視圖橫槓連續不被格線切斷、跨週斷行圓角正確、點橫槓開編輯、日面板顯示「第 N 天／共 M 天」
- 結束一次日記對話：行事曆該日出現印章徽章（tooltip 小語）、日面板印章卡在最上、刪除鍵可用；設定關閉開關後再生成一次＝不蓋章
- 低落內容的對話（valence < 0.45）：印章只出現鼓勵組、小語是陪伴語氣
- 年月 picker：跳 2030 再跳回、Esc／點外關閉
- 深色主題掃一遍：橫槓、swatch、印章卡、picker
- 手機 PWA：隨行動批次一併驗（含 v2.4 的 18px 圖標）

## Self-Review 紀錄

- Spec 覆蓋：§2 資料模型（T1/T2）、§3 管線與 0.45 保底（T3）、§3 印章清單/雙語名（T4）、§4 佈局 A＋P1＋橫槓硬規則＋lane 規則＋表單＋picker（T5–T8）、§3 開關（T9）、§5 測試（各 task）、§6 風險（T5 靜默失敗、T1 路由層合併驗證、T6 grid 顯式定位=對位免疫）。
- 型別一致：occurrence 的 `span_total/span_day/end_date/color` 命名貫穿 T1→T5/T6/T7；`stampIcon(id, size)` 貫穿 T4→T5；`enable_day_note` 貫穿 T3→T9；`upsert_day_note(db, user_id, note_date, stamp, phrase, source_diary_id=)` 貫穿 T2→T3。
- 已知現場變異點（實作時核對，不盲信行號）：所有行號為 2026-08-17 快照；diaries 表名（T2 FK）；conftest 的 mock_llm 輸出形狀（T3 pipeline 測試）；readForm 既有測試的 DOM fixture 形狀（T7）；`.calendar-toolbar` 定位（T8）。
- 印章 SVG 與 stamp-library-v3.html 核可稿逐字一致（吉祥物系列 5 款含迷你書本體 `#b98d6d`）。
