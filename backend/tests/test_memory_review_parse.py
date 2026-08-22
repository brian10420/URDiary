"""review pass 輸出解析與提示詞模板 (v2.5 Spec C Task 3)。"""
from services import memory_review as mr
from services.prompt_loader import load_prompt

_SMOKE_KWARGS = dict(
    today_date="2026-08-23",
    user_profile_content="## 稱呼與身分", user_profile_count=8, user_profile_limit=800,
    companion_notes_content="## 有效的支持方式", companion_notes_count=9, companion_notes_limit=600,
    near_limit_hint="", legacy_note_block="", over_budget_feedback="",
    chat_history="使用者: 嗨", todays_diary="今天很平常。",
    mood_hint="情緒平穩", day_notes_trail="（近兩週沒有印章）",
)


def test_parse_plain_json():
    raw = '{"ops": [{"action": "add", "file": "user_profile", "section": "情緒模式", "text": "- x (2026-08-23)"}]}'
    ops = mr.parse_review_output(raw)
    assert isinstance(ops, list) and ops[0]["action"] == "add"


def test_parse_fenced_and_prose_wrapped():
    fenced = '```json\n{"ops": []}\n```'
    assert mr.parse_review_output(fenced) == []
    prose = '好的，以下是本次更新：\n{"ops": [{"action": "remove", "file": "companion_notes", "target": "舊句"}]}\n以上。'
    ops = mr.parse_review_output(prose)
    assert ops and ops[0]["action"] == "remove"


def test_parse_failures_return_none():
    assert mr.parse_review_output("") is None
    assert mr.parse_review_output("完全不是 JSON") is None
    assert mr.parse_review_output('{"foo": 1}') is None          # 沒有 ops 鍵
    assert mr.parse_review_output('{"ops": "not-a-list"}') is None
    # 陣列裡的非 dict 項被濾掉，不炸
    assert mr.parse_review_output('{"ops": [1, {"action": "add"}]}') == [{"action": "add"}]


def test_prompt_templates_format_smoke_both_langs():
    for lang in ("zh-TW", "en"):
        template = load_prompt("memory_review_prompt.txt", lang)
        rendered = template.format(**_SMOKE_KWARGS)
        # 字面 JSON 範例的花括號在 format 後要還原成單括號
        assert '{"action": "add"' in rendered
        assert "{today_date}" not in rendered


def test_day_notes_trail_and_mood_hint():
    class Row:  # 假 DayNote (只取用到的欄位)
        def __init__(self, d, s, p):
            import datetime
            self.note_date = datetime.date.fromisoformat(d)
            self.stamp, self.phrase = s, p
    rows = [Row("2026-08-22", "food", "牛肉湯的快樂"), Row("2026-08-20", "heal", "累了就休息")]
    trail = mr.format_day_notes_trail(rows, "zh-TW")
    assert "08/22" in trail and "food" in trail and "牛肉湯的快樂" in trail
    assert mr.format_day_notes_trail([], "zh-TW") == "（近兩週沒有印章）"
    assert mr.format_day_notes_trail([], "en") == "(no stamps in the past two weeks)"
    assert "溫柔" in mr.mood_hint(0.2, "zh-TW")   # is_negative → 低落日提示
    assert "平穩" in mr.mood_hint(0.7, "zh-TW")
    assert "gentle" in mr.mood_hint(0.2, "en").lower()
