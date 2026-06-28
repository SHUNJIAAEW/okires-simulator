# AGENTS.md — Codex CLI 用エージェント指示書

> このファイルは Codex CLI（OpenAI）が読み込む共通指示書です。
> Claude Code は `CLAUDE.md` を、Codex は `AGENTS.md` を自動読み込みします。
> **本ファイルと `CLAUDE.md` は同期させる**（同じプロジェクト憲法を両エージェントが共有）。

## プロジェクト概要

「AI社員工場」リポジトリ。AI駆動でクライアントのデジタルマーケティングを自動化する。
主力3事業：AI駆動SNS運用 / AI YouTube動画制作運用 / GA4レポート制作。

詳細な憲法は `CLAUDE.md` を参照（7層モデル・10部署63体・全社固定値）。

## エージェントへの基本ルール（Codex/Claude 共通）

1. **Research First**: ファイル編集前に必ず `code-researcher` の発想で対象コードを読む（既存構造の把握なき改変は禁止）
2. **Self-Correction Loop**: ビルド/テスト失敗時は、ログを読んで自力修正してから報告する（毎回人間に聞かない）
3. **Verification Loop**: 実装→検証→改善（`00-rules/verification-loop.md` の RED→GREEN→IMPROVE 遵守）
4. **Commit Granularity**: 小さく論理的なコミット。メッセージは日本語で意図を書く
5. **Safety First**: `.env` / `.env.*` / `secrets/**` は読まない・書かない・コミットしない
6. **No Destructive Ops**: `git push --force` / `rm -rf` / `git reset --hard` は人間承認必須
7. **不可逆操作は人間承認後**: 送信・公開・本番デプロイは必ず人間が最終ボタンを押す

## ディレクトリ構造（7層モデル）

| 層 | ディレクトリ | 役割 |
|---|---|---|
| ① ルール層 | `00-rules/` | 親→子 `_RULE.md` 継承プロトコル |
| ② 生データ層 | `05-raw-data/` | Calendar/Gmail/Docs 同期（**読取専用**） |
| ③ 業務ハブ層 | `06-todo/` | ToDo / Projects |
| ④ 会社知識層 | `02-company_knowledge/` | 事業・人・案件・取引先の正本 |
| ⑤ AI組織層 | `03-AI_departments/` + `.claude/agents/` | 部署CxO + 実行ロール |
| ⑥ memory層 | `.claude/memory/MEMORY.md` | セッション横断フィードバック |
| ⑦ ルーティン層 | `07-routines/` | 定期実行 |

## 部署発動ルール

ユーザーが「〜〜部署でやって」と指示したら、`~/.claude/CLAUDE.md` の部署マッピング表に従い該当エージェントを Task で spawn する（人間チームに依頼する文書を書かない）。

## トークン予算（重要）

- 一度に Read するファイルは原則 **2000行以下**（必要な箇所だけ offset/limit で読む）
- 上流成果物（outline/copy/design）を確認せず builder が創作するのは禁止
- 不要な再 Read は禁止（既に context にあるなら使う）
- 詳細: `00-rules/token-budget.md`

## ドリフト検知

3回同じ方向のパッチを当てても解決しないときは、立ち止まり根本設計を見直す。
詳細: `00-rules/drift-detection.md`

## 共通コマンド

| 用途 | コマンド |
|---|---|
| 工場ヘルス診断 | `python3 scripts/factory-doctor.py` |
| GA4 認証 | `gcloud auth application-default login --scopes=https://www.googleapis.com/auth/analytics.readonly,https://www.googleapis.com/auth/cloud-platform` |
| Mercari/Yahoo スクレイプ | `node resale/scripts/market-scout.mjs` （WebFetchはSPAで不可・Playwright必須） |
| 画像生成（白背景資料用） | `python3 ~/.claude/tools/fal_image.py` または OpenAI gpt-image-1 |

## 全社固定値（抜粋）

- YouTube: ショート60秒以下 / 1080×1920 / BGM音量 0.10 / -16 LUFS
- X: 280字 / HT 2-3個
- Instagram: 2200字 / HT 20-30個
- TikTok: 2200字 / HT 4-6個
- タイムゾーン: JST

## 入口リンク

- 全ルール: `00-rules/_INDEX.md`
- 成果物蓄積: `00-rules/deliverable-flow.md`
- 継続学習: `00-rules/continuous-learning.md`
- 検証ループ: `00-rules/verification-loop.md`
- トークン予算: `00-rules/token-budget.md`
- ドリフト検知: `00-rules/drift-detection.md`
- メディア生成: `00-rules/media-generation.md`
- ループ判定: `00-rules/loop-eligibility.md`
- worktree: `00-rules/worktrees.md`
- state file: `00-rules/state-file.md`
- 理解負債: `00-rules/comprehension-debt.md`
- セキュリティ税: `00-rules/security-tax.md`
- Codex 設定: `00-rules/codex-config.md`
- memory索引: `.claude/memory/MEMORY.md`
