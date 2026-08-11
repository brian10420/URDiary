# URDiary — Your Local-First AI Diary Companion

<p align="center">
  <img src="desktop/assets/icon.jpg" alt="URDiary toast-diary mascot" width="333">
</p>

**URDiary** is a free, open-source emotional diary that runs entirely on your own computer. You chat with an AI companion that truly listens — it remembers your past entries, checks in on you daily, and turns each conversation into a structured diary entry. Built for students and anyone under pressure who is used to bottling things up, so they can feel heard, remembered, and seen.

**你的資料不離開你的電腦。** 日記存在本機 SQLite 檔案裡，API 金鑰加密存在你自己的機器上，沒有雲端伺服器、沒有帳號註冊、沒有追蹤。[繁體中文說明請見下方](#繁體中文)。

## Features

- **A companion that listens** — reflective listening grounded in positive psychology: it validates feelings before offering anything, never lectures, and asks for permission before giving one small suggestion.
- **Long-term memory** — it recalls related past entries and cites them precisely ("What you said reminds me of June 22, *The sleepless night before the piano competition*… does it feel similar?"). Keyword search works out of the box; optional semantic search finds entries by meaning.
- **Daily check-in** — the first time you open the app each day, it greets you personally, aware of yesterday's mood.
- **Calendar** — log events with a category (work, study, health, family, anniversary, or other), an optional repeat (daily/weekly/monthly/yearly), and a reminder. Your companion is aware of it: it naturally brings up today's or upcoming plans during check-ins and chats ("Isn't your presentation this afternoon?"), and gently follows up on how something went — at most once, and only when the conversation actually goes there.
- **Automatic diary** — end a chat and it writes a first-person diary entry with a title, one-line summary, and emotion scores (valence/arousal).
- **Crisis-aware** — recognizes signs of acute distress and responds with local crisis resources (Taiwan: 1925/1995/1980; US: 988), without lecturing.
- **Bring your own AI** — works with Claude, ChatGPT, Gemini, Grok, or any local OpenAI-compatible server (Ollama, LM Studio…). Your API key stays on your machine.
- **Bilingual** — full Traditional Chinese and English support for both the interface and the AI conversation.

## Architecture

Two local processes, no Docker, no external services:

```
┌─────────────────────┐         ┌──────────────────────────┐
│  Electron desktop   │  HTTP   │  FastAPI backend          │
│  (desktop/)         │ ──────► │  (backend/app/)      │
│  UI + your API keys │  :8001  │  memory · diary · prompts │
└─────────────────────┘         └───────────┬──────────────┘
                                            │
                                   ┌────────▼────────┐
                                   │  data/urdiary.db │  ← single SQLite file
                                   │  (your diaries)  │     = your whole diary
                                   └─────────────────┘
```

## Getting Started

Requirements: **Python 3.10+** and **Node.js 18+**.

```bash
# 1. Clone
git clone https://github.com/brian10420/URDiary.git
cd URDiary

# 2. Start the backend (first run creates a venv and installs dependencies)
cd backend
./start-backend.sh        # Windows: start-backend.bat

# 3. In another terminal, start the desktop app
cd desktop
npm install
npm start
```

Then in the app:

1. Create a user (any username + a strong password — everything stays local).
2. Open **Settings** (gear icon), pick your AI provider, paste your API key, save.
3. Start chatting. Press **"End chat & create diary"** when you're done for the day.

API docs are at http://localhost:8001/docs while the backend is running.

### Calendar

Open the **Calendar** tab to jot down events: give each one a category (work, study, health, family, anniversary, or other), an optional repeat (daily/weekly/monthly/yearly), and a reminder (fires only while URDiary is running). Your companion knows what's on it — the same way it remembers your diary entries, it'll naturally bring up today's or upcoming plans during a daily check-in or a chat, and ask how something went afterward. It only comes up when it fits the conversation, and at most once — it's context your companion already has, not a nagging assistant.

### Optional: semantic memory search

By meaning, not just keywords — "work stuff" can recall an entry about your boss:

```bash
.venv/bin/pip install fastembed        # or: uv pip install -p .venv fastembed
# then enable "Advanced memory (semantic search)" in Settings
# first use downloads a ~220 MB multilingual model in the background
# index pre-existing diaries:  cd backend/app && ../../.venv/bin/python -m services.memory_retrieval --backfill
```

### Where is my data?

| What | Where |
|---|---|
| Diaries, chat history, memory notes | `data/urdiary.db` (SQLite, single file) |
| Auto-generated server secrets | `data/secrets.json` |
| Your LLM API keys (desktop app) | OS keychain via Electron safeStorage (`~/.config/desktop/provider-keys.enc` on Linux) |
| Your LLM API keys (phone / browser) | `data/urdiary.db`, encrypted at rest with a key derived from your server's `SECRET_KEY` |

**Backup = copy the `data/` folder.** Nothing is ever uploaded.

Browsers have no OS keychain, so a key you save from a phone is stored — encrypted — in your own database on your own machine. You can remove it at any time from Settings. Rotating `SECRET_KEY` (or deleting `data/secrets.json`) makes those stored keys unreadable; the app keeps working and simply asks you to enter the key again.

### Configuration (optional)

Everything works with zero configuration. To customize, create `backend/.env` (see `.env.example`): timezone (`URDIARY_TIMEZONE`, default `Asia/Taipei`), data directory, port, or a fallback Grok API key for requests without a provider configured in the UI.

Sharing your instance with family? Set one server-side key so they need no setup at all — accounts without their own key fall back to it:

```bash
.venv/bin/python backend/scripts/urdiary_admin.py set-server-key --provider grok   # prompts for the key, never takes it from argv
.venv/bin/python backend/scripts/urdiary_admin.py show-server-key                  # masked status only
```

## Running tests

Both suites run fully offline: no LLM API key required, and neither touches your real `data/` folder (the backend tests use an isolated temporary database).

```bash
# Backend (from the backend/ directory; installs pytest the first time):
cd backend
../.venv/bin/python -m pip install -r app/requirements-dev.txt   # or: uv pip install -p ../.venv -r app/requirements-dev.txt
../.venv/bin/python -m pytest -q          # Windows: ..\.venv\Scripts\python -m pytest -q

# Frontend:
cd desktop
npm test
```

## Privacy

- Diaries and conversations are stored **only** in the local SQLite file.
- API keys are encrypted at rest on your own machine — by your OS keychain in the desktop app, or in your own database (Fernet, keyed from your `SECRET_KEY`) when you save one from a phone browser. They are never sent anywhere except the AI provider you chose.
- Keys are never returned by the API, never written to logs, and never shown again in full — only the last 4 characters.
- The only network traffic is between your machine and your chosen AI provider.
- No telemetry, no analytics, no accounts.

## Contributing

Issues and pull requests are welcome. The codebase is intentionally simple: vanilla JS frontend (no build step), flat-import FastAPI backend, prompts as plain text files under `backend/app/services/prompts/{zh-TW,en}/`. To add a language, copy a prompt directory and add a locale to `desktop/js/i18n.js`.

Please note: this project provides emotional companionship, **not** medical or psychological treatment. Changes to crisis-handling prompts (`crisis_mode.txt`, `support_message.txt`) are reviewed with extra care.

## Learn more

[`docs/deployment-feasibility.md`](docs/deployment-feasibility.md) — an honest look at what it would take to reach URDiary from a phone or ship it as a packaged desktop installer: what already works, what's a config change, and what's a real engineering decision. Written as an assessment, not a promise — nothing in it is implemented yet.

## License

[Apache License 2.0](LICENSE.txt)

---

# 繁體中文

**URDiary** 是一個免費、開源、完全在你自己電腦上運行的 AI 情緒日記。它會傾聽你、記得你說過的事、每天主動關心你，並把每次對話寫成一篇日記。為了壓力大、習慣把情緒收起來的學生與大人而做——讓每個人都能被聽見、被記得、被看見。

## 特色

- **懂傾聽的陪伴者**——以正向心理學為基礎的反映式傾聽：先接住情緒再說別的、不說教、給建議前先徵求同意且一次只給一個。
- **長期記憶**——聊天時會想起相關的過往日記並明確點名（「你說的讓我想起 6 月 22 日《鋼琴比賽前的失眠夜》那天……是不是有點像？」）。內建關鍵字檢索，可選配語意檢索。
- **每日開場關心**——每天第一次打開 App，它會依昨天的日記與時段主動打招呼。
- **行事曆**——記事件、選分類（工作／學業／健康／家人／紀念日／其他）、可設定重複（每天／每週／每月／每年）與提醒。陪伴者看得到這些：問候與聊天時會自然提到今天或最近的安排（「你不是今天下午要報告嗎？」），事後也會輕輕問一句後續——順著話題才提、最多一次，不是在查勤。
- **自動日記**——按下「結束對話並生成日記」，它以第一人稱寫下今天：含標題、一行摘要與情緒分數。
- **危機感知**——辨識高風險訊號並分級回應，附上在地求助資源（1925 安心專線／1995 生命線／1980 張老師）。
- **自帶 AI 金鑰**——支援 Claude／ChatGPT／Gemini／Grok／本地模型（Ollama 等 OpenAI 相容端點），金鑰加密存在你的電腦。
- **中英雙語**——介面與 AI 對話皆可切換。

## 安裝（免 Docker）

需求：**Python 3.10+** 與 **Node.js 18+**。

```bash
# 1. 下載
git clone https://github.com/brian10420/URDiary.git
cd URDiary

# 2. 啟動後端（首次執行會自動建立虛擬環境並安裝依賴）
cd backend
./start-backend.sh        # Windows 用 start-backend.bat

# 3. 開另一個終端機，啟動桌面 App
cd desktop
npm install
npm start
```

接著在 App 裡：

1. 建立使用者（任意帳號＋強密碼，一切都在本機）。
2. 打開右上角 **設定**，選擇 AI 供應商、貼上你的 API Key、儲存。
3. 開始聊天；當天想收尾時按 **「結束對話並生成日記」**。

### 行事曆

打開**行事曆**分頁記事：選個分類（工作／學業／健康／家人／紀念日／其他）、可以設定重複（每天／每週／每月／每年）、加個提醒（限 App 仍在執行時才會觸發）。陪伴者也看得到這些——就像它記得你的日記一樣，問候或聊天聊到相關話題時，會自然提起今天或接下來的安排，事後也會問一句後續怎麼樣。只在順著話題時才提，而且最多一次——這是它本來就知道的事，不是多一個催你辦事的助理。

### 選配：語意記憶檢索

用「意思」找日記而不只是關鍵字（說「上班的事」能找到寫主管的那篇）：

```bash
.venv/bin/pip install fastembed
# 然後在設定面板開啟「進階記憶（語意檢索）」
# 首次使用會在背景下載約 220MB 的多語模型
# 為既有日記補索引：cd backend/app && ../../.venv/bin/python -m services.memory_retrieval --backfill
```

### 我的資料在哪裡？

| 內容 | 位置 |
|---|---|
| 日記、對話、記憶筆記 | `data/urdiary.db`（單一 SQLite 檔） |
| 自動生成的伺服器密鑰 | `data/secrets.json` |
| 你的 LLM API 金鑰（桌面版） | 系統金鑰鏈加密（Electron safeStorage） |
| 你的 LLM API 金鑰（手機／瀏覽器） | `data/urdiary.db`，以伺服器 `SECRET_KEY` 導出的金鑰加密後存放 |

**備份＝複製 `data/` 資料夾。** 任何資料都不會上傳。

瀏覽器沒有系統金鑰鏈可用，所以從手機儲存的金鑰會加密後存進你自己機器上的資料庫，隨時可以在設定面板刪除。輪換 `SECRET_KEY`（或刪掉 `data/secrets.json`）會讓這些金鑰解不開；App 仍然可以正常使用，只是會請你重新填一次金鑰。

### 設定（可選）

零設定即可使用。要客製化時建立 `backend/.env`（參考 `.env.example`）：時區（`URDIARY_TIMEZONE`，預設 `Asia/Taipei`，建議安裝時一次決定）、資料目錄、埠號等。

要分享給家人用？設定一組「伺服器預設金鑰」，他們就完全不必自己設定——沒有自己金鑰的帳號會自動用這一組：

```bash
.venv/bin/python backend/scripts/urdiary_admin.py set-server-key --provider grok   # 會提示輸入金鑰，不從命令列參數讀
.venv/bin/python backend/scripts/urdiary_admin.py show-server-key                  # 只顯示遮罩後的狀態
```

## 執行測試

兩套測試都完全離線：不需要 LLM API 金鑰，也不會動到你真實的 `data/` 資料夾（後端測試會用獨立的暫存資料庫）。

```bash
# 後端（在 backend/ 目錄下執行；第一次要先裝 pytest）：
cd backend
../.venv/bin/python -m pip install -r app/requirements-dev.txt   # 或：uv pip install -p ../.venv -r app/requirements-dev.txt
../.venv/bin/python -m pytest -q          # Windows: ..\.venv\Scripts\python -m pytest -q

# 前端：
cd desktop
npm test
```

## 隱私

- 日記與對話**只**存在本機 SQLite 檔案。
- API 金鑰一律加密存在你自己的機器上——桌面版用作業系統金鑰鏈，從手機瀏覽器儲存的則加密存在你自己的資料庫（Fernet，金鑰由 `SECRET_KEY` 導出）。除了你選擇的 AI 供應商之外，不會送去任何地方。
- 金鑰不會被 API 回傳、不會寫進日誌，之後也不會再完整顯示——只看得到最後 4 碼。
- 唯一的網路流量是你的電腦與 AI 供應商之間。
- 沒有遙測、沒有分析、沒有帳號系統。

## 重要聲明

URDiary 提供的是情緒陪伴，**不是**醫療或心理治療。如果你正處於危機中，請撥打 1925（安心專線，24 小時）、1995（生命線，24 小時）或 119。

## 延伸閱讀

[`docs/deployment-feasibility.md`](docs/deployment-feasibility.md)——手機連線與桌面安裝檔的可行性評估：什麼已經可行、什麼只是設定、什麼需要真正的產品決策，都誠實列出來。這是一份評估報告，不是承諾——目前都還沒有實作。

## 授權

[Apache License 2.0](LICENSE.txt)
