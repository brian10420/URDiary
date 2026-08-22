"""memory_files 純文字引擎 (v2.5 Spec C Task 2)——無 DB、無 LLM。"""
from services import memory_files as mf


def test_constants_and_template():
    assert mf.FILE_LIMITS == {"user_profile": 800, "companion_notes": 600}
    tpl = mf.blank_template("user_profile")
    for sec in mf.SECTIONS["user_profile"]:
        assert f"## {sec}" in tpl
    assert mf.blank_template("companion_notes").startswith("## 有效的支持方式")


def test_normalize_section():
    assert mf.normalize_section("user_profile", "## 情緒模式 ") == "情緒模式"
    assert mf.normalize_section("user_profile", "情緒模式") == "情緒模式"
    assert mf.normalize_section("user_profile", "有效的支持方式") is None  # 別檔的節
    assert mf.normalize_section("companion_notes", "有效的支持方式") == "有效的支持方式"


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
