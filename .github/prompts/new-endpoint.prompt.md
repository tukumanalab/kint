---
description: "新しいAPIエンドポイントを対話的に作成する"
agent: "agent"
tools: [read, edit, search, execute]
argument-hint: "エンドポイントの目的（例: 従業員の月間勤怠レポート取得）"
---

以下の手順で新しいAPIエンドポイントを作成してください:

1. `src/kint/schemas/` に Pydantic リクエスト/レスポンススキーマを作成
2. `src/kint/services/` にビジネスロジックを実装
3. `src/kint/routers/` にFastAPIエンドポイントを追加
4. `src/kint/main.py` にルーターを登録（未登録の場合）
5. `tests/` にテストを作成
6. テストを実行して動作確認

Router → Service → Repository パターンに従い、型ヒントを必ず付けること。
