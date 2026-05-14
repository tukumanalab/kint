# =============================================================
# Stage 1: フロントエンドビルド (Node.js)
# =============================================================
FROM node:20-slim AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# ビルド時の環境変数 (Google Client ID など)
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}

RUN npm run build

# =============================================================
# Stage 2: Python ランタイム
# =============================================================
FROM python:3.12-slim

WORKDIR /app

# uv インストール
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Python 依存関係インストール
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# アプリケーションコードをコピー
COPY src/ ./src/
COPY alembic/ ./alembic/
COPY alembic.ini ./

# フロントエンドビルド成果物を FastAPI の静的ファイルディレクトリに配置
COPY --from=frontend-builder /app/frontend/dist ./src/kint/static/

# SQLite データ用ディレクトリを作成
RUN mkdir -p /data

# non-root ユーザーで実行
RUN useradd --system --no-create-home --uid 1001 kint \
    && chown -R kint:kint /app /data
USER kint

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# マイグレーション実行後にサーバー起動
CMD ["sh", "-c", "uv run alembic upgrade head && uv run uvicorn src.kint.main:app --host 0.0.0.0 --port 8000"]
