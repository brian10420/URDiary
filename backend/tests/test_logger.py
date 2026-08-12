"""utils/logger.py 的雙重寫入 bug 迴歸測試 (v2.3 task 3.1)。

原本的 bug：`create_logger()` 在 `use_rotating=True` (預設值、四個
production logger 全部走這個分支：app/app.api/app.error/app.error_handler)
時，會同時把 TimedRotatingFileHandler 與 RotatingFileHandler 兩個 handler
掛到同一個 logger 上——每筆記錄因此被寫兩次，兩個 rotator 還會搶著輪轉
同一個檔案 (這正是 backend/app/logs/ 從 13.5MB 長到 44MB 的原因)。

修法：每個 log target 只保留一個 handler (RotatingFileHandler，理由見
utils/logger.py 模組頂部註解)。這裡鎖定兩個屬性：
  1. 建立 logger 之後，檔案 handler 一定恰好一個。
  2. 呼叫一次 `.info(...)` 之後，檔案裡恰好一行 (不是兩行)。
第三個測試額外鎖定「同一個 logger 名稱重複呼叫 create_logger() 不會累積
handler」——這是保護 --reload / 測試重複建構 app 時的既有防護
(`logger.handlers.clear()`)，修 bug 時不能連帶弄壞它。

第四個測試鎖定另一條獨立的重複寫入路徑：Python logging 預設會把子 logger
的記錄往上傳給父 logger 的 handler 再處理一次 (`propagate=True`)。
production 的四個 logger 名稱 (app / app.api / app.error /
app.error_handler) 剛好構成一組父子階層 (app 是另外三個的父)，每個又都
有自己完整的一套 handler——若不關掉 propagation，呼叫 api_logger/
error_logger/error_handler 的 logger 時，記錄會「額外」再被父層的 app
console handler 印一次、寫進 app.log 一次，即使子層本身只掛了一個檔案
handler、完全沒有「單一 logger 兩個 handler」的問題。這條路徑是實際跑
`pytest -v` 觀察 "Captured stderr call" 出現重複行才發現的，用一支獨立
腳本 (直接 import utils.logger、monkeypatch LOG_DIR、呼叫子 logger 一次
再檢查父 logger 的檔案) 複現確認後才加進這裡的迴歸測試。

一律用 monkeypatch 過的 LOG_DIR (tmp_path)，絕不寫進真正的
backend/app/logs/ 或 data/。
"""
import logging

import utils.logger as logger_module


def test_create_logger_attaches_exactly_one_file_handler(tmp_path, monkeypatch):
    monkeypatch.setattr(logger_module, "LOG_DIR", tmp_path)

    logger = logger_module.create_logger("test_single_handler", "single_handler.log")

    file_handlers = [h for h in logger.handlers if isinstance(h, logging.FileHandler)]
    assert len(file_handlers) == 1


def test_single_log_call_writes_exactly_one_line(tmp_path, monkeypatch):
    monkeypatch.setattr(logger_module, "LOG_DIR", tmp_path)

    logger = logger_module.create_logger("test_single_line", "single_line.log")
    logger.info("hello")
    for handler in logger.handlers:
        handler.flush()

    log_file = tmp_path / "single_line.log"
    lines = [line for line in log_file.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert len(lines) == 1


def test_repeated_create_logger_calls_do_not_accumulate_handlers(tmp_path, monkeypatch):
    """`--reload` / 測試重複建構 app 時，同一個 logger 名稱可能被多次呼叫
    `create_logger()`——handler 數量不能因此累加成 2、4、6...。"""
    monkeypatch.setattr(logger_module, "LOG_DIR", tmp_path)

    logger_first = logger_module.create_logger("test_no_accumulation", "no_accumulation.log")
    logger_again = logger_module.create_logger("test_no_accumulation", "no_accumulation.log")

    assert logger_first is logger_again  # logging.getLogger 對同名回傳同一個物件
    file_handlers = [h for h in logger_again.handlers if isinstance(h, logging.FileHandler)]
    assert len(file_handlers) == 1


def test_child_logger_does_not_duplicate_records_into_parent_logger_file(tmp_path, monkeypatch):
    """production 的 app / app.api / app.error / app.error_handler 構成一組
    父子階層 (見模組 docstring)。子 logger 呼叫 .info() 不該讓父 logger
    的檔案也多出一行——每個 logger 各自是獨立的 log target。"""
    monkeypatch.setattr(logger_module, "LOG_DIR", tmp_path)

    parent = logger_module.create_logger("test_no_leak", "parent.log")
    child = logger_module.create_logger("test_no_leak.child", "child.log")

    child.info("only the child should see this")
    for handler in list(parent.handlers) + list(child.handlers):
        handler.flush()

    parent_log = tmp_path / "parent.log"
    parent_content = parent_log.read_text(encoding="utf-8") if parent_log.exists() else ""
    assert "only the child should see this" not in parent_content

    child_content = (tmp_path / "child.log").read_text(encoding="utf-8")
    assert "only the child should see this" in child_content
