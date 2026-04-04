---
description: "コードレビューを実行する"
agent: "reviewer"
tools: [read, search, execute]
argument-hint: "レビュー対象（例: src/kint/services/attendance.py）"
---

指定されたファイルまたはディレクトリに対して以下の観点でコードレビューを実行してください:

## セキュリティ
- SQLインジェクション・XSS・CSRF
- 認証・認可の適切性
- 機密データの取り扱い

## コード品質
- 型ヒントの網羅性
- エラーハンドリング
- DRY原則・単一責任
- テストカバレッジ

## パフォーマンス
- N+1クエリ
- 不要な同期処理
- インデックスの欠如

結果は Critical / Warning / Suggestion の3段階で報告してください。
