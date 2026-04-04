---
description: "新しいReactページコンポーネントを作成する"
agent: "agent"
tools: [read, edit, search, execute]
argument-hint: "ページの目的（例: 管理者用の従業員一覧ページ）"
---

以下の手順で新しいページを作成してください:

1. `frontend/src/types/` に必要な型定義を追加
2. `frontend/src/api/` にAPIクライアント関数を作成
3. `frontend/src/pages/` にページコンポーネントを作成
4. 必要に応じて `frontend/src/components/` に子コンポーネントを作成
5. ルーティングにページを追加
6. テストを作成

TypeScript strict モード、`any` 禁止、関数コンポーネント + hooks パターンで実装すること。
