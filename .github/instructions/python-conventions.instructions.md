---
description: "Python code conventions for the Kint attendance system. Use when writing or modifying Python files."
applyTo: "**/*.py"
---

# Python コーディング規約

- 型ヒント必須（全関数の引数・返り値）
- Ruff でフォーマット (line-length = 100)
- docstring は日本語で簡潔に書く
- import 順: 標準ライブラリ → サードパーティ → ローカル
- async/await を使う（DB操作は全て非同期）
- f-string を使う（format() や % は使わない）
- パスワードや秘密情報をハードコードしない
