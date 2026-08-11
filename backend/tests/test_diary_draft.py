"""鎖定 services/diary_draft.py 的解析行為 (parse_diary_output 與後備推導)。

這裡的斷言全部先用互動式執行實際程式碼驗證過期望值，以現行程式碼輸出為準；
不是憑正則表達式手算猜測的「應該」行為。
"""
from services.diary_draft import parse_diary_output, derive_title, derive_summary


# --- ① 正文 + JSON tail --------------------------------------------------------

def test_parse_json_tail_extracts_four_fields_and_strips_tail():
    text = (
        '今天天氣很好，和朋友出去散步聊天，心情很放鬆。\n'
        '{"title": "散步的午後", "summary": "和朋友散步聊天，心情放鬆", '
        '"valence": 0.7, "arousal": 0.4}'
    )
    draft = parse_diary_output(text)

    assert draft.title == "散步的午後"
    assert draft.summary == "和朋友散步聊天，心情放鬆"
    assert draft.valence == 0.7
    assert draft.arousal == 0.4
    # JSON tail 已從內文剝除，只留正文
    assert draft.content == "今天天氣很好，和朋友出去散步聊天，心情很放鬆。"
    assert "valence" not in draft.content


# --- ② tail 含單引號 / 內嵌換行（第二層容錯） -----------------------------------

def test_parse_json_tail_tolerates_single_quotes():
    """單引號 JSON 讓第一次 json.loads 失敗，第二層 replace(\"'\", '\"') 後成功。"""
    text = (
        "今天心情不錯，出去走走。\n"
        "{'title': '不錯的一天', 'summary': '心情愉快', 'valence': 0.8, 'arousal': 0.3}"
    )
    draft = parse_diary_output(text)

    assert draft.title == "不錯的一天"
    assert draft.summary == "心情愉快"
    assert draft.valence == 0.8
    assert draft.arousal == 0.3


def test_parse_json_tail_tolerates_embedded_newline():
    """tail 字串值內含未跳脫的真實換行，第一次 json.loads 因控制字元失敗，
    第二層 replace("\\n", " ") 後成功解析。"""
    text = (
        '正文開頭。\n'
        '{"title": "line1\nline2", "summary": "s", "valence": 0.6, "arousal": 0.4}'
    )
    draft = parse_diary_output(text)

    assert draft.title == "line1 line2"
    assert draft.summary == "s"
    assert draft.valence == 0.6
    assert draft.arousal == 0.4
    assert draft.content == "正文開頭。"


# --- ③ 正文中段有其他 {...} 區塊時，取「最後一個」含 valence 的 -------------------

def test_parse_json_tail_uses_last_block_containing_valence():
    text = (
        '這是雜訊 {"valence": 0.1} 之後才是正文。\n'
        '{"title": "標題", "summary": "摘要", "valence": 0.7, "arousal": 0.4}'
    )
    draft = parse_diary_output(text)

    # 取最後一個含 valence 的區塊 (0.7)，不是中段雜訊區塊的 0.1
    assert draft.valence == 0.7
    assert draft.arousal == 0.4
    assert draft.title == "標題"
    assert draft.summary == "摘要"
    # 只有「最後一個」tail 區塊被剝除；中段的雜訊區塊仍留在 content 內
    assert '{"valence": 0.1}' in draft.content


# --- ④ 舊版「情緒評分：valence: 0.7」格式 ---------------------------------------

def test_parse_legacy_emotion_score_format_and_strips_segment():
    """先讀 diary_draft.py 現行程式碼確認：沒有 JSON tail 時，走正則抓
    valence/arousal 純文字格式，並把「情緒評分」之後的段落從內文剝除。"""
    text = "今天很開心，做了很多事。\n情緒評分：valence: 0.7, arousal: 0.4"
    draft = parse_diary_output(text)

    assert draft.valence == 0.7
    assert draft.arousal == 0.4
    assert draft.content == "今天很開心，做了很多事。"
    assert "情緒評分" not in draft.content


# --- ⑤ 無任何 metadata → derive_title / derive_summary 後備 --------------------

def test_parse_without_any_metadata_falls_back_to_derived_title_and_summary():
    text = "今天天氣很好，我去公園散步。"
    draft = parse_diary_output(text)

    assert draft.content == text
    assert draft.title == derive_title(text)
    assert draft.summary == derive_summary(text)
    # 沒有任何 valence/arousal 來源時維持預設中性值 0.5
    assert draft.valence == 0.5
    assert draft.arousal == 0.5


# --- ⑥ valence/arousal 超出 [0,1] 時夾住 ----------------------------------------

def test_parse_clamps_out_of_range_valence_and_arousal():
    text = '心情普通。\n{"title":"t","summary":"s","valence":1.5,"arousal":-0.2}'
    draft = parse_diary_output(text)

    assert draft.valence == 1.0  # 1.5 夾到上限 1.0
    assert draft.arousal == 0.0  # -0.2 夾到下限 0.0


# --- ⑦ 非數字 valence → 預設 0.5 ------------------------------------------------

def test_parse_non_numeric_valence_defaults_to_half():
    text = '心情普通。\n{"title":"t","summary":"s","valence":"high","arousal":0.4}'
    draft = parse_diary_output(text)

    assert draft.valence == 0.5
    assert draft.arousal == 0.4


# --- ⑧ 空輸入 → 佔位內容 --------------------------------------------------------

def test_parse_empty_input_produces_placeholder_content():
    draft = parse_diary_output("")
    assert draft.content == "（生成內容為空）"

    draft_none = parse_diary_output(None)
    assert draft_none.content == "（生成內容為空）"


# --- ⑨ derive_title：markdown 前綴剝除、24 字截斷、空 → 無標題日記 ----------------

def test_derive_title_strips_markdown_prefix():
    assert derive_title("# 標題行\n內文其他東西") == "標題行"
    assert derive_title("- 列表項目當標題") == "列表項目當標題"
    assert derive_title("1. 數字列表標題") == "數字列表標題"


def test_derive_title_truncates_to_24_chars():
    long_line = "這是超過二十四個字元的一段標題文字用來測試截斷效果是否正確"
    assert len(long_line) > 24
    result = derive_title(long_line)
    assert result == long_line[:24]
    assert len(result) == 24


def test_derive_title_empty_or_blank_falls_back_to_placeholder():
    assert derive_title("") == "無標題日記"
    assert derive_title("   \n\t  ") == "無標題日記"


# --- ⑩ derive_summary：空白摺疊 + 100 字截斷 ------------------------------------

def test_derive_summary_collapses_whitespace_and_truncates_to_100():
    content = "# 標題\n\n這是   內容    有很多空白\n\n和換行\n" + ("文" * 120)
    result = derive_summary(content)

    assert len(result) == 100
    assert "  " not in result  # 連續空白已摺疊成單一空格
    assert result.startswith("標題 這是 內容 有很多空白 和換行 ")


def test_derive_summary_empty_input():
    assert derive_summary("") == ""
    assert derive_summary(None) == ""
