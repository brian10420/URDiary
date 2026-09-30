"""memory_files 純文字引擎 (v2.5 Spec C Task 2)——無 DB、無 LLM。"""
from services import memory_files as mf


def test_constants_and_template():
    assert mf.FILE_LIMITS == {"user_profile": 800, "companion_notes": 600}
    tpl = mf.blank_template("user_profile")
    for key in mf.SECTIONS["user_profile"]:
        assert f"## {mf.section_title('user_profile', key, 'zh-TW')}" in tpl
    assert mf.blank_template("companion_notes").startswith("## 有效的支持方式")


def test_normalize_section():
    # v2.6：正名＝語言無關的 canonical key（原本回中文標題）
    assert mf.normalize_section("user_profile", "## 情緒模式 ") == "emotion_patterns"
    assert mf.normalize_section("user_profile", "情緒模式") == "emotion_patterns"
    assert mf.normalize_section("user_profile", "有效的支持方式") is None  # 別檔的節
    assert mf.normalize_section("companion_notes", "有效的支持方式") == "support"


def test_apply_add_appends_at_section_end():
    content = mf.blank_template("companion_notes")
    r1 = mf.apply_op("companion_notes", content, "add",
                     section="進行中的關注", text="- 口試日期快公布 (2026-08-23)")
    assert r1.ok
    r2 = mf.apply_op("companion_notes", r1.content, "add",
                     section="進行中的關注", text="- 睡眠可以關心 (2026-08-23)")
    assert r2.ok
    idx1 = r2.content.index("口試日期")
    idx2 = r2.content.index("睡眠可以")
    assert idx1 < idx2 < r2.content.index("## 觀察與提醒")  # 依序附加、不越節


def test_apply_add_timeline_prepends():
    content = mf.blank_template("user_profile")
    r1 = mf.apply_op("user_profile", content, "add",
                     section="重要事件時間線", text="- [2026-08-20] 舊事件")
    r2 = mf.apply_op("user_profile", r1.content, "add",
                     section="重要事件時間線", text="- [2026-08-23] 新事件")
    assert r2.ok
    assert r2.content.index("[2026-08-23]") < r2.content.index("[2026-08-20]")  # 最新在前


def test_apply_add_on_empty_content_starts_from_template():
    r = mf.apply_op("user_profile", "", "add", section="稱呼與身分", text="- 小B (2026-08-23)")
    assert r.ok and "## 四大生活領域" in r.content and "小B" in r.content


def test_apply_replace_and_not_found():
    content = mf.blank_template("user_profile")
    content = mf.apply_op("user_profile", content, "add",
                          section="情緒模式", text="- 壓力大時沉默 (2026-08-05)").content
    ok = mf.apply_op("user_profile", content, "replace",
                     target="壓力大時沉默", text="壓力大時傾向沉默，不喜歡被追問")
    assert ok.ok and "不喜歡被追問" in ok.content and "壓力大時沉默 (" not in ok.content.replace("傾向沉默", "")
    miss = mf.apply_op("user_profile", content, "replace", target="不存在的句子", text="x")
    assert not miss.ok and miss.error == "target_not_found" and miss.content == content


def test_apply_remove_cleans_empty_list_line():
    content = mf.blank_template("user_profile")
    content = mf.apply_op("user_profile", content, "add",
                          section="情緒模式", text="- 過時的觀察 (2026-07-01)").content
    r = mf.apply_op("user_profile", content, "remove", target="過時的觀察 (2026-07-01)")
    assert r.ok
    assert "過時的觀察" not in r.content
    assert "\n- \n" not in r.content and "\n-\n" not in r.content  # 不留空彈頭行
    assert "\n\n\n" not in r.content  # 不留三連空行


def test_apply_validation_errors():
    content = mf.blank_template("user_profile")
    assert mf.apply_op("user_profile", content, "explode").error == "bad_action"
    assert mf.apply_op("user_profile", content, "add", section="亂寫", text="x").error == "bad_section"
    assert mf.apply_op("user_profile", content, "add", section="情緒模式").error == "missing_text"
    assert mf.apply_op("user_profile", content, "replace", text="x").error == "missing_target"
    assert mf.apply_op("user_profile", content, "remove").error == "missing_target"


def test_limits_and_find_section():
    long = "x" * 801
    assert mf.over_limit("user_profile", long) and not mf.over_limit("user_profile", "x" * 800)
    assert mf.near_limit("user_profile", "x" * 640) and not mf.near_limit("user_profile", "x" * 639)
    assert mf.char_count("abc") == 3
    content = mf.apply_op("user_profile", "", "add", section="情緒模式", text="- 找我 (2026-08-23)").content
    assert mf.find_section_of(content, "找我") == "情緒模式"
    assert mf.find_section_of(content, "無此字") is None


# --- v2.6：區段標題依介面語言 (canonical key × 每語言標題) -----------------------

ZH_PROFILE_TPL = "## 稱呼與身分\n\n## 四大生活領域\n\n## 情緒模式\n\n## 重要事件時間線\n\n## 優勢與關鍵洞察\n"
EN_PROFILE_TPL = ("## Name & identity\n\n## Four life domains\n\n## Emotional patterns\n\n"
                  "## Key events timeline\n\n## Strengths & key insights\n")
EN_COMPANION_TPL = "## Support that works\n\n## Ongoing follow-ups\n\n## Observations & reminders\n"


def test_section_keys_and_titles_per_lang():
    assert mf.SECTIONS == {
        "user_profile": ("identity", "life_domains", "emotion_patterns", "timeline", "strengths"),
        "companion_notes": ("support", "follow_ups", "observations"),
    }
    assert mf.section_titles("user_profile", "zh-TW") == (
        "稱呼與身分", "四大生活領域", "情緒模式", "重要事件時間線", "優勢與關鍵洞察")
    assert mf.section_titles("companion_notes", "en") == (
        "Support that works", "Ongoing follow-ups", "Observations & reminders")
    assert mf.section_title("user_profile", "timeline", "en") == "Key events timeline"
    # 未知語言一律落回 zh-TW (同 prompt_loader 的預設)
    assert mf.section_title("user_profile", "timeline", "fr") == "重要事件時間線"


def test_blank_template_per_lang():
    assert mf.blank_template("user_profile") == ZH_PROFILE_TPL          # 預設＝舊行為，逐位元組不變
    assert mf.blank_template("user_profile", "zh-TW") == ZH_PROFILE_TPL
    assert mf.blank_template("user_profile", "en") == EN_PROFILE_TPL
    assert mf.blank_template("companion_notes", "en") == EN_COMPANION_TPL


def test_normalize_section_accepts_zh_en_and_key():
    for name in ("情緒模式", "Emotional patterns", "emotion_patterns",
                 "## Emotional patterns ", "  emotional PATTERNS", "## 情緒模式"):
        assert mf.normalize_section("user_profile", name) == "emotion_patterns", name
    assert mf.normalize_section("companion_notes", "Ongoing follow-ups") == "follow_ups"
    assert mf.normalize_section("companion_notes", "Emotional patterns") is None  # 別檔的節
    assert mf.normalize_section("user_profile", "support") is None                # 別檔的 key
    for bad in ("Key events", "亂寫", "", None, 3):
        assert mf.normalize_section("user_profile", bad) is None, bad


def test_canonical_section_keeps_unknown_raw():
    assert mf.canonical_section("user_profile", "Key events timeline") == "timeline"
    assert mf.canonical_section("user_profile", "重要事件時間線") == "timeline"
    assert mf.canonical_section("user_profile", "壞節") == "壞節"       # 帳本保留模型原文
    assert mf.canonical_section("第三個檔", "情緒模式") == "情緒模式"
    assert mf.canonical_section("user_profile", None) is None
    # 模型送來非字串的 file (list/dict 不可雜湊) 也不能炸：原樣保留
    assert mf.canonical_section(["user_profile"], "情緒模式") == "情緒模式"
    assert mf.normalize_section({"f": 1}, "情緒模式") is None


def test_zh_behavior_byte_identical():
    """既有 zh 路徑 (不帶 lang 與帶 zh-TW) 的輸出與 v2.5 逐位元組相同。"""
    golden = ("## 稱呼與身分\n- 小B (2026-08-23)\n\n## 四大生活領域\n\n## 情緒模式\n"
              "- 壓力大時傾向沉默 (2026-08-05)\n\n## 重要事件時間線\n- [2026-08-23] 新事件\n\n"
              "## 優勢與關鍵洞察\n")
    seq = [("add", "稱呼與身分", None, "- 小B (2026-08-23)"),
           ("add", "重要事件時間線", None, "- [2026-08-20] 舊事件"),
           ("add", "## 重要事件時間線 ", None, "- [2026-08-23] 新事件"),
           ("add", "情緒模式", None, "- 壓力大時沉默 (2026-08-05)"),
           ("replace", None, "壓力大時沉默", "壓力大時傾向沉默"),
           ("remove", None, "- [2026-08-20] 舊事件", None)]
    for lang_kw in ({}, {"lang": "zh-TW"}):
        content = ""
        for action, sec, target, text in seq:
            r = mf.apply_op("user_profile", content, action, section=sec, target=target, text=text, **lang_kw)
            assert r.ok
            content = r.content
        assert content == golden, lang_kw


def test_apply_add_en_on_empty_uses_en_template():
    r = mf.apply_op("user_profile", "", "add", section="Name & identity",
                    text="- Maya (2026-09-30)", lang="en")
    assert r.ok
    assert r.content == EN_PROFILE_TPL.replace("## Name & identity\n", "## Name & identity\n- Maya (2026-09-30)\n")


def test_apply_add_en_timeline_prepends():
    c = mf.apply_op("user_profile", "", "add", section="timeline", text="- [2026-09-01] old", lang="en").content
    c = mf.apply_op("user_profile", c, "add", section="Key events timeline", text="- [2026-09-30] new", lang="en").content
    assert c.index("[2026-09-30]") < c.index("[2026-09-01]") < c.index("## Strengths & key insights")


def test_apply_add_finds_header_in_any_language_without_lang():
    """不帶 lang (舊呼叫端)：en 標題的 op 也找得到 zh 標頭，標頭原樣不動。"""
    r = mf.apply_op("user_profile", ZH_PROFILE_TPL, "add", section="Emotional patterns", text="- x (2026-09-30)")
    assert r.ok and "## 情緒模式\n- x (2026-09-30)\n" in r.content
    assert "Emotional patterns" not in r.content


def test_apply_with_other_lang_migrates_all_headers():
    zh = mf.apply_op("user_profile", "", "add", section="情緒模式", text="- 雨天想家 (2026-09-01)").content
    zh = mf.apply_op("user_profile", zh, "add", section="重要事件時間線", text="- [2026-09-01] 搬家").content
    r = mf.apply_op("user_profile", zh, "add", section="Name & identity", text="- Maya (2026-09-30)", lang="en")
    assert r.ok
    assert r.content == ("## Name & identity\n- Maya (2026-09-30)\n\n## Four life domains\n\n"
                         "## Emotional patterns\n- 雨天想家 (2026-09-01)\n\n"
                         "## Key events timeline\n- [2026-09-01] 搬家\n\n## Strengths & key insights\n")
    # 反方向：en 檔被 zh 請求寫入 → 全部換回 zh 標頭
    back = mf.apply_op("user_profile", r.content, "remove", target="- Maya (2026-09-30)", lang="zh-TW")
    assert back.ok and back.content.startswith("## 稱呼與身分\n") and "Four life domains" not in back.content


def test_replace_and_remove_with_lang_migrate_headers():
    zh = mf.apply_op("companion_notes", "", "add", section="觀察與提醒", text="- 累了會說還好 (2026-09-01)").content
    r = mf.apply_op("companion_notes", zh, "replace", target="累了會說還好", text="\"I'm fine\" = tired", lang="en")
    assert r.ok and r.content.startswith("## Support that works\n") and "## 觀察與提醒" not in r.content
    assert "## Observations & reminders\n- \"I'm fine\" = tired (2026-09-01)" in r.content
    # 失敗的 op 不動檔案 (也不遷移標頭)
    miss = mf.apply_op("companion_notes", zh, "remove", target="沒有這句", lang="en")
    assert not miss.ok and miss.content == zh


def test_localize_headers_mixed_and_unknown():
    mixed = "## Name & identity\n- a\n\n## 情緒模式\n- b\n\n## 我自己加的節\n- c\n### 情緒模式 (h3 不是節)\n"
    out = mf.localize_headers("user_profile", mixed, "en")
    assert out == ("## Name & identity\n- a\n\n## Emotional patterns\n- b\n\n"
                   "## 我自己加的節\n- c\n### 情緒模式 (h3 不是節)\n")
    # 已是目標語言：原樣回傳 (含行尾空白這種無關緊要的差異也不碰)
    assert mf.localize_headers("user_profile", "## 情緒模式  \n- b\n", "zh-TW") == "## 情緒模式  \n- b\n"
    assert mf.localize_headers("user_profile", "", "en") == ""
    # 行首縮排的節標頭：找節時認得 (_is_header_of)，遷移時也要認得
    assert mf.localize_headers("user_profile", "  ## 情緒模式\n- b\n", "en") == "## Emotional patterns\n- b\n"


def test_unknown_section_rejected_in_every_language():
    for lang in (None, "zh-TW", "en"):
        r = mf.apply_op("user_profile", EN_PROFILE_TPL, "add", section="Hobbies", text="- x", lang=lang)
        assert not r.ok and r.error == "bad_section" and r.content == EN_PROFILE_TPL


# --- v2.6 fix1：標頭遷移不吃字數上限；檔內節標頭只認標題 (不認 key) ------------------

def _near_cap_zh_profile(total=790):
    """zh 標頭、總長剛好 total 的使用者檔案 (含一條可刪的短句)。"""
    base = mf.apply_op("user_profile", "", "add", section="情緒模式", text="- 小事 (2026-09-30)").content
    filler = "- " + "字" * (total - len(base) - len("- ") - 1)
    content = mf.apply_op("user_profile", base, "add", section="稱呼與身分", text=filler).content
    assert len(content) == total
    return content


def test_migration_skipped_when_localized_content_would_exceed_cap():
    content = _near_cap_zh_profile()
    r = mf.apply_op("user_profile", content, "remove", target="- 小事 (2026-09-30)", lang="en")
    assert r.ok and not mf.over_limit("user_profile", r.content)
    assert r.content.startswith("## 稱呼與身分\n") and "Name & identity" not in r.content  # 標頭留 zh
    # 同一份檔若有空間 → 照常遷移
    roomy = mf.apply_op("user_profile", "", "add", section="情緒模式", text="- 小事 (2026-09-30)").content
    moved = mf.apply_op("user_profile", roomy, "add", section="情緒模式", text="- b (2026-09-30)", lang="en")
    assert moved.content.startswith("## Name & identity\n")


def test_migration_still_applied_when_result_already_over_cap():
    """套用前就超標 (呼叫端反正會拒絕)：照常遷移，不需要特判。"""
    content = _near_cap_zh_profile()
    r = mf.apply_op("user_profile", content, "add", section="情緒模式", text="- " + "x" * 40, lang="en")
    assert r.ok and mf.over_limit("user_profile", r.content) and r.content.startswith("## Name & identity\n")


def test_user_header_matching_a_key_is_not_a_section():
    """使用者手打的 `## Timeline` 不是 canonical 節：op 落在真正的節，使用者標頭不動。"""
    content = "## Timeline\n- 我自己的清單\n\n## 重要事件時間線\n- [2026-09-01] 舊事件\n"
    for lang in (None, "zh-TW"):
        r = mf.apply_op("user_profile", content, "add", section="timeline", text="- [2026-09-30] 新事件", lang=lang)
        assert r.ok
        assert r.content == ("## Timeline\n- 我自己的清單\n\n## 重要事件時間線\n- [2026-09-30] 新事件\n"
                             "- [2026-09-01] 舊事件\n"), lang
    for lang in ("en", "zh-TW"):
        out = mf.localize_headers("user_profile", "## Timeline\n## Strengths\n## identity\n", lang)
        assert out == "## Timeline\n## Strengths\n## identity\n"
    assert mf.localize_headers("companion_notes", "## Support\n## Observations\n", "zh-TW") == "## Support\n## Observations\n"
    # op 驗證仍接受 key (模型可以送 key)
    assert mf.normalize_section("user_profile", "Timeline") == "timeline"
