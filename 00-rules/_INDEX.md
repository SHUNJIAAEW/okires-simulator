# 00-rules/_INDEX.md — 全ルールの入口

> ここが全社憲法の入口。新規ファイルを作るとき、AIは親→子の順でルールを読み、矛盾なく従う。
> 矛盾発生時は親が優先。変更はPRなしで直接書き換えOK。

## ルールファイル一覧

| ファイル | 役割 |
|---|---|
| [rule-inheritance.md](rule-inheritance.md) | 親子継承の標準プロトコル。`_RULE.md`・MEMORY.md の必須手順 |
| [knowledge-layout.md](knowledge-layout.md) | リポジトリ全体の7層フォルダ憲法。どこに何を置くかの正本 |
| [skill-creation.md](skill-creation.md) | スキル作成方法・スキル番号体系（人ごとに01-から独立採番） |
| [deliverable-flow.md](deliverable-flow.md) | 成果物→ナレッジ→memoryの4段フロー。蓄積メカニズムの中核 |
| [todo-format.md](todo-format.md) | ToDoの必須3要件（期日+時刻+JST / 担当ロール / 完了条件） |
| [verification-loop.md](verification-loop.md) | 検証ループ原則（作る→検証→改善）。全成果物がQAゲートを通る |
| [continuous-learning.md](continuous-learning.md) | 継続学習プロトコル（信頼度付きで学びを蓄積し定義に昇格） |
| [token-budget.md](token-budget.md) | トークン予算ルール（読込上限・再Read禁止・部署別ホワイトリスト） |
| [drift-detection.md](drift-detection.md) | エージェント迷走検知・コンテキスト強制リセットの基準 |
| [codex-config.md](codex-config.md) | Codex CLI 起動設定（`~/.codex/config.toml` テンプレ・運用ルール） |
| [error-memory.md](error-memory.md) | エラー解決策を mcp__memory に蓄積し再発を防ぐルール |
| [deploy-monitor.md](deploy-monitor.md) | Vercel デプロイ失敗の自動検知・ロールバック設計（構想段階） |
| [media-generation.md](media-generation.md) | 動画・画像・音声・3D 生成ツールの選定ガイド（Higgsfield/OpenAI/FLUX/Runway） |

## ループエンジニアリング 5本（2026-06 追加）
| ファイル | 役割 |
|---|---|
| [loop-eligibility.md](loop-eligibility.md) | ループ化判定 4条件 + 30秒チェック + MVL構築順序 |
| [worktrees.md](worktrees.md) | git worktree による並列実行の衝突防止 |
| [state-file.md](state-file.md) | STATE.md パターン（ループの外部脳） |
| [comprehension-debt.md](comprehension-debt.md) | 理解負債と認知の放棄を防ぐ運用ルーティン |
| [security-tax.md](security-tax.md) | 自走ループのセキュリティ税（skill監査・権限再監査・kill switch） |

## 全社の絶対ルール（親憲法）

1. **1エージェント1役割** — 「ついでに〜する」を書いた瞬間に品質が落ちる
2. **入出力を契約** — JSON/YAML/Markdown で形式固定
3. **禁則は明示** — やってほしくない行動は全部書く
4. **ツール権限は最小化** — Read から始め、必要時のみ追加
5. **サブエージェントは互いに spawn しない** — spawn はオーケストレーターのみ
6. **生データは読取専用** — `05-raw-data/` は触らない場所
7. **機密厳守** — `.env` / `secrets/**` は読まない・書かない
