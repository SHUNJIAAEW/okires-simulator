# 00-rules/error-memory.md — エラー解決策ベクター記憶ルール

> 「同じバグを2度踏まない」ための仕組み。
> エラーに遭遇 → 解決 → mcp__memory に保存 → 次回ヒット時に自動検索。

## なぜ必要か

- セッションが終わるとエージェントは記憶を失う
- 過去に解決した同じエラーを毎回ゼロから調査するのは非効率
- MEMORY.md（テキスト）はキーワード検索のみ＝類似エラーが見つからない
- mcp__memory（ナレッジグラフ）はエンティティ＋関係＋観察を保存できる

## スコープ

**保存対象**: 解決に30分以上かかった or 同じ問題を2回以上踏んだエラー
**保存不要**: タイポ・1分で解けた軽微なエラー・コードに痕跡が残るバグ

## 保存フォーマット（mcp__memory）

エラー1件 = 1エンティティ。type は `error-solution`。

```
entity name: "<technology>-<short-id>"   例: "mercari-spa-fetch-fail"
type:        "error-solution"
observations:
  - "error_signature: <代表的なエラーメッセージ抜粋>"
  - "context: <発生した状況・部署・技術スタック>"
  - "root_cause: <原因の一行説明>"
  - "solution: <解決手順>"
  - "date_solved: 2026-06-19"
  - "tags: <検索用タグ・カンマ区切り>"
  - "trust_score: 1"   # 同じ解決策が再ヒットするたび+1
```

## 運用フロー

### 保存フロー

1. エラーに遭遇
2. 解決策を見つけて適用
3. `mcp__memory__create_entities` で保存
4. 関連エンティティ（部署・技術スタック）と `mcp__memory__create_relations` で繋ぐ

### 検索フロー（次回エラー時）

1. エラーメッセージを抜粋
2. `mcp__memory__search_nodes` で類似エラーを検索
3. ヒットしたら solution を適用
4. 成功したら trust_score を +1（`add_observations`）
5. 失敗したら新規エラーとして別エンティティで保存

## 信頼度スコアでの自己進化

| trust_score | 扱い |
|---|---|
| 1 | 初回保存・参考程度に提示 |
| 2-3 | 「過去に同様の解決例あり」と提示 |
| 4+ | 確立ルール候補 → `00-rules/` か該当エージェント定義に昇格 |

これは `continuous-learning.md` の信頼度スコア学習と同じ思想を「エラー解決」に特化したもの。

## 既に保存推奨のエラー（初回登録例）

過去のセッションで踏んだ以下は早期に登録すべき：

| エラー署名 | 解決策 |
|---|---|
| `ACCESS_TOKEN_SCOPE_INSUFFICIENT` (GA4) | `gcloud auth ...login --scopes=...analytics.readonly` |
| Mercari/Yahoo WebFetch で 0 items | Playwright 必須（SPA） |
| OpenAI `billing_hard_limit_reached` | OpenAI ダッシュボードでチャージ |
| `git rebase --no-edit` invalid flag | `--no-edit` は git rebase に存在しない |
| python3 `externally-managed-environment` | `--break-system-packages` か venv |
| Codex marketplace add 失敗 | スキーマ不一致・手動 link で代替 |

## エージェント定義に組み込む際の指示

各 builder/debugger 系エージェントに以下を追記：

> エラー解決時は `mcp__memory__search_nodes` で過去事例を先に検索すること。
> 解決後（30分以上かかった or 2回目以降のエラー）は `mcp__memory__create_entities` で保存すること。

## 禁則

- 機密情報（APIキー・パスワード・個人情報）を observations に保存しない
- 解決していないエラーを「解決済み」として保存しない
- 同じエラーを別entityで重複保存しない（既存を探して `add_observations`）

## 関連

- 継続学習: `continuous-learning.md`
- ドリフト検知: `drift-detection.md`
- mcp__memory: 既に接続済み MCP サーバ
