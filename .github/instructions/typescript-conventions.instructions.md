---
description: "TypeScript/React conventions for the Kint attendance system frontend. Use when writing React components, hooks, or TypeScript files in the frontend directory."
applyTo: "frontend/**/*.{ts,tsx}"
---

# TypeScript / React 規約

- 厳格な TypeScript (`strict: true`)、`any` 禁止
- コンポーネントは関数コンポーネント + hooks パターン
- API通信は `frontend/src/api/` に集約し、コンポーネントから直接 fetch しない
- 型定義は `frontend/src/types/` に集約
- ESLint + Prettier でフォーマット
- テストは Vitest + React Testing Library、ファイル名は `*.test.tsx`
- NFC読み取り機能はこのWebアプリには含まない（別途 Windows デスクトップアプリ）
