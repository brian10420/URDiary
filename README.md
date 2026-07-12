# URDiary — Your Local-First AI Diary Companion

<p align="center">
  <img src="desktop/assets/icon.jpg" alt="URDiary toast-diary mascot" width="333">
</p>

**URDiary** is a free, open-source emotional diary that runs entirely on your own computer. You chat with an AI companion that truly listens — it remembers your past entries, checks in on you daily, and turns each conversation into a structured diary entry. Built for students and anyone under pressure who is used to bottling things up, so they can feel heard, remembered, and seen.

**你的資料不離開你的電腦。** 日記存在本機 SQLite 檔案裡，API 金鑰以作業系統金鑰鏈加密存放，沒有雲端伺服器、沒有帳號註冊、沒有追蹤。[繁體中文說明請見下方](#繁體中文)。

## Features

- **A companion that listens** — reflective listening grounded in positive psychology: it validates feelings before offering anything, never lectures, and asks for permission before giving one small suggestion.
- **Long-term memory** — it recalls related past entries and cites them precisely ("What you said reminds me of June 22, *The sleepless night before the piano competition*… does it feel similar?"). Keyword search works out of the box; optional semantic search finds entries by meaning.
- **Daily check-in** — the first time you open the app each day, it greets you personally, aware of yesterday's mood.
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
| Your LLM API keys | OS keychain via Electron safeStorage (`~/.config/desktop/provider-keys.enc` on Linux) |

**Backup = copy the `data/` folder.** Nothing is ever uploaded.

### Configuration (optional)

Everything works with zero configuration. To customize, create `backend/.env` (see `.env.example`): timezone (`URDIARY_TIMEZONE`, default `Asia/Taipei`), data directory, port, or a fallback Grok API key for requests without a provider configured in the UI.

## Privacy

- Diaries and conversations are stored **only** in the local SQLite file.
- API keys are encrypted by your OS keychain and sent only to your local backend, which forwards them directly to the AI provider you chose.
- The only network traffic is between your machine and your chosen AI provider.
- No telemetry, no analytics, no accounts.

## Contributing

Issues and pull requests are welcome. The codebase is intentionally simple: vanilla JS frontend (no build step), flat-import FastAPI backend, prompts as plain text files under `backend/app/services/prompts/{zh-TW,en}/`. To add a language, copy a prompt directory and add a locale to `desktop/js/i18n.js`.

Please note: this project provides emotional companionship, **not** medical or psychological treatment. Changes to crisis-handling prompts (`crisis_mode.txt`, `support_message.txt`) are reviewed with extra care.

## License

[Apache License 2.0](LICENSE.txt)

---

# 繁體中文

**URDiary** 是一個免費、開源、完全在你自己電腦上運行的 AI 情緒日記。它會傾聽你、記得你說過的事、每天主動關心你，並把每次對話寫成一篇日記。為了壓力大、習慣把情緒收起來的學生與大人而做——讓每個人都能被聽見、被記得、被看見。

## 特色

- **懂傾聽的陪伴者**——以正向心理學為基礎的反映式傾聽：先接住情緒再說別的、不說教、給建議前先徵求同意且一次只給一個。
- **長期記憶**——聊天時會想起相關的過往日記並明確點名（「你說的讓我想起 6 月 22 日《鋼琴比賽前的失眠夜》那天……是不是有點像？」）。內建關鍵字檢索，可選配語意檢索。
- **每日開場關心**——每天第一次打開 App，它會依昨天的日記與時段主動打招呼。
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
| 你的 LLM API 金鑰 | 系統金鑰鏈加密（Electron safeStorage） |

**備份＝複製 `data/` 資料夾。** 任何資料都不會上傳。

### 設定（可選）

零設定即可使用。要客製化時建立 `backend/.env`（參考 `.env.example`）：時區（`URDIARY_TIMEZONE`，預設 `Asia/Taipei`，建議安裝時一次決定）、資料目錄、埠號等。

## 隱私

- 日記與對話**只**存在本機 SQLite 檔案。
- API 金鑰由作業系統金鑰鏈加密，只送往本機後端、再直達你選擇的 AI 供應商。
- 唯一的網路流量是你的電腦與 AI 供應商之間。
- 沒有遙測、沒有分析、沒有帳號系統。

## 重要聲明

URDiary 提供的是情緒陪伴，**不是**醫療或心理治療。如果你正處於危機中，請撥打 1925（安心專線，24 小時）、1995（生命線，24 小時）或 119。

## 授權

[Apache License 2.0](LICENSE.txt)
