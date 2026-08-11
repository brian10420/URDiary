"""鎖定 services/memory_retrieval.py 的關鍵字檢索管線行為。

extract_terms 涉及 jieba 分詞，實際切詞結果不是靠正則手算，而是先用互動式
執行過真實程式碼取得現行輸出，再把驗證過的期望值寫進斷言。
"""
from datetime import timedelta
from types import SimpleNamespace

import pytest

import services.memory_retrieval as mr
from services.memory_retrieval import extract_terms, format_memories, NO_MEMORY_PLACEHOLDER


# --- extract_terms -------------------------------------------------------------

def test_extract_terms_chinese_filters_stopwords_via_jieba():
    text = "今天的天氣真好，我去圖書館讀書，順便買了咖啡。"
    terms = extract_terms(text)

    # 停用詞 (今天/的/我/了) 應被 ZH_STOPWORDS 濾除
    assert "今天" not in terms
    assert "的" not in terms
    # 實質內容詞應該留下 (現行 jieba cut_for_search 的實際切詞結果)
    assert terms == ["天氣", "真好", "圖書館", "讀書", "順便", "咖啡"]


def test_extract_terms_english_filters_stopwords_and_lowercases():
    text = "Today I went for a walk with my cat and it felt amazing and calm"
    terms = extract_terms(text)

    # EN_STOPWORDS (today/for/with/and/felt...) 被濾除；長度 >=3 字母、轉小寫
    assert "today" not in terms
    assert "and" not in terms
    assert "went" in terms
    assert "cat" in terms
    assert "amazing" in terms
    assert all(t == t.lower() for t in terms)


def test_extract_terms_mixed_chinese_and_english():
    text = "今天和 my cat 一起去 walking，超級 happy 的一天"
    terms = extract_terms(text)

    assert "cat" in terms
    assert "happy" in terms
    assert "walking" in terms


def test_extract_terms_deduplicates():
    text = "貓咪貓咪 cat cat 貓咪"
    terms = extract_terms(text)

    assert terms.count("cat") == 1
    assert len(terms) == len(set(terms))


def test_extract_terms_max_terms_cap_at_12():
    text = ("alpha bravo charlie delta echo foxtrot golf hotel india juliet "
            "kilo lima mike november")
    terms = extract_terms(text)

    assert len(terms) == 12
    assert terms == ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot",
                      "golf", "hotel", "india", "juliet", "kilo", "lima"]
    # 第 13、14 個字詞因上限被捨去
    assert "mike" not in terms
    assert "november" not in terms


def test_extract_terms_empty_string_returns_empty_list():
    assert extract_terms("") == []
    assert extract_terms(None) == []


# --- _keyword_match_score -------------------------------------------------------

def test_keyword_match_score_title_hit_scores_three():
    diary = SimpleNamespace(title="我的貓咪日記", summary="沒有相關內容", content="沒有相關內容")
    assert mr._keyword_match_score(diary, ["貓"]) == 3


def test_keyword_match_score_summary_hit_scores_two():
    diary = SimpleNamespace(title="標題", summary="今天看到貓了", content="沒有相關內容")
    assert mr._keyword_match_score(diary, ["貓"]) == 2


def test_keyword_match_score_content_hits_capped_at_three():
    # content 出現 5 次「貓」，但每個詞最多只計 3 分 (min(count, 3))
    diary = SimpleNamespace(title="標題", summary="摘要", content="貓貓貓貓貓咪咪咪")
    assert mr._keyword_match_score(diary, ["貓"]) == 3


def test_keyword_match_score_combines_title_summary_content():
    diary = SimpleNamespace(title="我的貓咪日記", summary="今天沒提到", content="貓貓貓貓貓咪咪咪")
    # title 命中 +3、content count('貓')=5 -> min(5,3)=+3 => 共 6
    assert mr._keyword_match_score(diary, ["貓"]) == 6


# --- _recency_emotion_factor -----------------------------------------------------

def test_recency_emotion_factor_today_is_approximately_one_times_emotion():
    now = mr.get_diary_datetime()
    diary = SimpleNamespace(diary_date=now, valence=0.5)
    # 今天 (days=0) -> recency=1.0；valence=0.5 -> emotion=1.0 => 1.0
    assert mr._recency_emotion_factor(diary) == pytest.approx(1.0)


def test_recency_emotion_factor_30_days_ago_is_half():
    now = mr.get_diary_datetime()
    diary = SimpleNamespace(diary_date=now - timedelta(days=30), valence=0.5)
    # 30 天半衰：recency = 1/(1+30/30) = 0.5；valence=0.5 -> emotion=1.0 => 0.5
    assert mr._recency_emotion_factor(diary) == pytest.approx(0.5)


def test_recency_emotion_factor_extreme_valence_gives_1_5x():
    now = mr.get_diary_datetime()
    diary_low = SimpleNamespace(diary_date=now, valence=0.0)
    diary_high = SimpleNamespace(diary_date=now, valence=1.0)
    assert mr._recency_emotion_factor(diary_low) == pytest.approx(1.5)
    assert mr._recency_emotion_factor(diary_high) == pytest.approx(1.5)


def test_recency_emotion_factor_none_valence_defaults_to_neutral():
    now = mr.get_diary_datetime()
    diary = SimpleNamespace(diary_date=now, valence=None)
    # valence=None 視為 0.5 中性 -> emotion=1.0，今天 recency=1.0 => 1.0
    assert mr._recency_emotion_factor(diary) == pytest.approx(1.0)


# --- get_relevant_memories：交錯合併 / 去重 / TOP_N 截斷 / 例外降級 --------------

def _fake_snapshot(diary_id, title):
    return {
        "id": diary_id,
        "date": mr.get_diary_datetime(),
        "title": title,
        "summary": f"summary-{diary_id}",
        "valence": 0.5,
    }


def test_get_relevant_memories_interleaves_dedupes_and_truncates(monkeypatch):
    # kw 命中 101,102,103；sem 命中 101(重複),201,202
    kw_hits = [(_fake_snapshot(101, "T101"), 10),
               (_fake_snapshot(102, "T102"), 9),
               (_fake_snapshot(103, "T103"), 8)]
    sem_hits = [(_fake_snapshot(101, "T101dup"), 5),
                (_fake_snapshot(201, "T201"), 4),
                (_fake_snapshot(202, "T202"), 3)]

    monkeypatch.setattr(mr, "_keyword_hits", lambda uid, terms, today: kw_hits)
    monkeypatch.setattr(mr, "_semantic_hits", lambda uid, query, today: sem_hits)

    result = mr.get_relevant_memories(1, "hello", semantic=True)

    # 交錯順序 kw1, sem1(id=101 與 kw1 重複，跳過), kw2, sem2 -> 湊滿 TOP_N=3 即停止
    assert result == format_memories([
        _fake_snapshot(101, "T101"),
        _fake_snapshot(102, "T102"),
        _fake_snapshot(201, "T201"),
    ])
    assert "T103" not in result  # 尚未走到就已達 TOP_N 而中止
    assert "T202" not in result
    assert result.count("T101") == 1  # id=101 的重複 (sem1) 已被去重，只留一次


def test_get_relevant_memories_falls_back_to_placeholder_on_internal_exception(monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(mr, "_keyword_hits", boom)
    result = mr.get_relevant_memories(1, "hello")

    assert result == NO_MEMORY_PLACEHOLDER


# --- format_memories -------------------------------------------------------------

def test_format_memories_empty_returns_placeholder():
    assert format_memories([]) == NO_MEMORY_PLACEHOLDER


def test_format_memories_formats_each_snapshot_as_a_line():
    now = mr.get_diary_datetime()
    snap = {"id": 1, "date": now, "title": "標題A", "summary": "摘要A", "valence": 0.5}

    result = format_memories([snap])

    assert result == f"- [{now.strftime('%Y-%m-%d')}]《標題A》摘要A"
