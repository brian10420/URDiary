FROM python:3.10

WORKDIR /app

# 複製程式碼
COPY app/ /app/

# 安裝依賴
RUN pip install --no-cache-dir -r /app/requirements.txt

EXPOSE 8000

# 設置啟動命令
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
