---
description: "Test file conventions for pytest (backend/desktop) and Vitest (frontend). Use when writing or modifying test files."
applyTo: ["tests/**/*.py", "desktop/tests/**/*.py", "frontend/src/**/*.test.{ts,tsx}"]
---

# テスト規約

## Backend (pytest)
- pytest + pytest-asyncio を使用する
- テストファイル名: `test_<module>.py`
- テスト関数名: `test_<対象>_<条件>` (例: `test_check_in_with_valid_card`)
- Arrange-Act-Assert パターンで書く
- フィクスチャは `conftest.py` に集約する
- DB依存テストは SQLite in-memory を使う
- API テストは `httpx.AsyncClient` を使う

## Desktop App (pytest)
- NFCリーダーはモックする（nfcpyは実デバイスが必要）
- APIクライアントは `httpx.MockTransport` でテスト
- テストは `desktop/tests/` に配置

## Frontend (Vitest)
- Vitest + React Testing Library を使用する
- テストファイル名: `<Component>.test.tsx`
