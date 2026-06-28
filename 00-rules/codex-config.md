# 00-rules/codex-config.md — Codex CLI 起動設定ガイド

> Codex CLI を本工場で安全に動かすための `~/.codex/config.toml` テンプレと運用ルール。

## なぜ Codex も使うのか

- Claude Code（Anthropic）と Codex CLI（OpenAI）はモデルの得意分野が違う
- 同じ問題に2つの視点で当てて「別の答え」が出るのがレビューに効く
- Codex の `--full-auto` モードは小規模タスクで非常に高速

## 役割分担（本工場の運用）

| 場面 | 担当 |
|---|---|
| 設計・統括・部署振り分け | **Claude Code** （CxO 系・オーケストレーター） |
| 大規模実装・自己修正ループ | **Claude Code** （builder 系） |
| 高速な単機能実装・小規模 fix | **Codex CLI** （`codex` skill 経由） |
| コードレビュー第二意見 | **Codex CLI** （`codex` skill 経由） |
| 文言レビュー | **Codex CLI** （`codex` skill 経由） |

## `~/.codex/config.toml` 推奨設定

```toml
# AI社員工場での Codex CLI 標準設定
[default]
model = "gpt-5-codex"     # 利用可能な最新モデル
approval_policy = "on-failure"   # 通常は自動、失敗時のみ承認
sandbox_policy = "workspace-write"  # workspace 外への書き込みは禁止

[sandbox]
# 編集禁止パス（本工場の絶対禁則と一致）
deny_paths = [
  "**/.env",
  "**/.env.*",
  "**/secrets/**",
  "**/05-raw-data/**",       # 生データは読取専用
]

# 危険コマンドの自動拒否
deny_commands = [
  "rm -rf",
  "git push --force",
  "git reset --hard",
  "git clean -f",
  "git branch -D",
]

[behavior]
research_first = true       # ファイル編集前にコード読込を強制
self_correction = true      # ビルド/テスト失敗時に自力修正
commit_language = "japanese"

[token_budget]
# 00-rules/token-budget.md と一致
max_read_lines_per_file = 2000
discourage_redundant_reads = true
```

## 起動例

| 用途 | コマンド |
|---|---|
| 単機能実装（自動） | `codex --full-auto "src/components/Button.tsx に variant prop を追加"` |
| 大規模変更（承認あり） | `codex "認証フローをリファクタ"` |
| レビュー第二意見 | `codex "git diff の内容をレビュー"` |
| 文言相談 | `codex skill 経由（Claude Code から起動）` |

## 本工場での使い分けフロー

```
人間 →（指示）→ Claude Code（オーケストレーター）
                  ├──→ 部署エージェント spawn（Task tool）
                  ├──→ 自分で実装/設計（直接）
                  └──→ Codex 呼び出し（codex skill）
                          └──→ 高速単機能実装 / 第二意見
                                  └──→ 結果を Claude Code に返す
```

**重要**: Codex を呼ぶのは Claude Code（または人間）。エージェント同士が直接 spawn し合うのは禁止（無限ループ防止）。

## 安全のための運用ルール

1. **本番デプロイ・送信・公開は Codex でも人間承認後**（Claude と同じ）
2. **`.env`/`secrets/` は Codex 側でも deny_paths に列挙**（このテンプレ通り）
3. **`--full-auto` は workspace 内で完結するタスクのみ**（外部通信を伴うなら承認モード）
4. **同じ問題で Claude と Codex の答えが食い違ったら人間が判断**（多数決にしない）

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| `Billing hard limit reached` | OpenAI ダッシュボードで残高チャージ |
| `permission denied` | `deny_paths` / `deny_commands` のいずれかに該当 → 必要なら設定見直し |
| Codex が古い情報を返す | `--full-auto` をやめて、ファイルを明示指定して再実行 |
| 同じファイルを何度も読み直す | `00-rules/token-budget.md` のルール再確認 |

## 関連

- 部署発動ルール: `~/.claude/CLAUDE.md`
- codex skill: `~/.claude/skills/codex/`
- 検証ループ: `verification-loop.md`
- ドリフト検知: `drift-detection.md`
