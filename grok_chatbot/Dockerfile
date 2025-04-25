# 第一階段：構建環境
FROM python:3.12.10-alpine AS builder

# 構建環境優化
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

# 更新 Alpine 並安裝構建依賴
RUN apk update && \
    apk upgrade --no-cache && \
    apk add --no-cache --virtual .build-deps \
    gcc \
    musl-dev \
    python3-dev \
    postgresql-dev \
    build-base

# 安裝依賴
COPY app/requirements.txt .
RUN pip install --upgrade pip && \
    pip wheel --no-cache-dir --no-deps --wheel-dir /build/wheels -r requirements.txt

# 第二階段：運行環境 - 也更新為 3.21
FROM python:3.12.10-alpine

# 運行環境優化
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

# 全面更新 Alpine 並安裝運行時所需的最小依賴
RUN apk update && \
    apk upgrade --no-cache && \
    apk add --no-cache \
    libpq \
    curl \
    tini \
    tzdata && \  
    rm -rf /var/cache/apk/*

# 從構建階段複製依賴
COPY --from=builder /build/wheels /wheels
RUN pip install --upgrade pip && \
    pip install --no-cache-dir /wheels/*

# 創建非 root 用戶
RUN addgroup -g 1000 -S appuser && \
    adduser -u 1000 -S appuser -G appuser && \
    mkdir -p /app/logs /app/uploads /app/scripts && \
    chown -R appuser:appuser /app/logs

# 複製應用代碼
COPY --chown=appuser:appuser app/ /app/

# 健康檢查腳本
COPY --chown=appuser:appuser app/Scripts/health_check.py /app/scripts/
RUN chmod +x /app/scripts/health_check.py

# 切換用戶
USER appuser

EXPOSE 8000

# 健康檢查
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD python /app/scripts/health_check.py

# 使用 tini 作為 init 系統
ENTRYPOINT ["/sbin/tini", "--"]

# 啟動命令
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]