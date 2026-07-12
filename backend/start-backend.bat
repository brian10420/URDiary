@echo off
rem URDiary 後端一鍵啟動腳本 (Windows，純本地，免 Docker)
rem 用法: start-backend.bat
rem 首次執行會自動建立虛擬環境並安裝依賴；資料存於專案根目錄 data\
chcp 65001 >nul
cd /d "%~dp0"

set "VENV_DIR=%~dp0..\.venv"
set "PY=%VENV_DIR%\Scripts\python.exe"

rem 1. 首次執行：建立虛擬環境
if not exist "%PY%" (
  echo 首次執行：建立 Python 虛擬環境...
  python -m venv "%VENV_DIR%"
  if errorlevel 1 (
    echo 找不到 python，請先安裝 Python 3.10+ 並勾選「Add to PATH」
    pause
    exit /b 1
  )
)

rem 2. 確保依賴齊全
"%PY%" -c "import fastapi, uvicorn, sqlalchemy" >nul 2>&1
if errorlevel 1 (
  echo 安裝依賴中 ^(首次約需幾分鐘^)...
  "%PY%" -m pip install -r app\requirements.txt
)

rem 3. 啟動 FastAPI (扁平匯入需以 app\ 為工作目錄)
if "%API_PORT%"=="" set API_PORT=8001
echo 啟動後端於 http://127.0.0.1:%API_PORT% (API 文件: /docs)
cd app
"%PY%" -m uvicorn main:app --host 127.0.0.1 --port %API_PORT% --reload
