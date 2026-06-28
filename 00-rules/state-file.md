# 00-rules/state-file.md — ループ用 STATE.md パターン

> エージェントはセッションを跨ぐと記憶を失う。state file が「外部脳」になる。
> ループを組むなら STATE.md は必須。

## なぜ必要か

- エージェントは毎セッション「ゼロから」始まる
- 進行中タスクの記憶を持ち越せない → 毎回コンテキスト再構築でトークン浪費
- 「前回どこまで」「失敗パターン」「学んだこと」を **外部ファイル**で持つことで、セッションは再開可能になる
- 工場既存の `_progress.yaml` / `log.yaml` は **タスク単位**の状態。STATE.md は **ループ単位**の状態

## 使い分け

| ファイル | 粒度 | 例 |
|---|---|---|
| `_progress.yaml` | 部署別のタスク進捗 | yt-dept の月間10本企画の進行 |
| `log.yaml` | 1動画/1案件の Stage 進捗 | 動画A の Stage1→Stage2 承認履歴 |
| **`STATE.md`** | **ループ単位の運用状態** | GA4月次レポートループの「先月どこまで」 |

## STATE.md テンプレート

ループごとに1ファイル。配置先は `<loop-dir>/STATE.md`。

```markdown
# STATE · <loop-name>

## Last run
2026-07-01 09:00 JST · 5 件処理 / 3 件PASS / 2 件escalated

## In progress
- ニュートーキョー 6月レポート — ga4-data-qa 検査中
- パラッツォ大阪 6月レポート — ga4-collector 取得中

## Completed today
- 別クライアントA 6月レポート → 納品済
- 別クライアントB 6月レポート → 納品済

## Escalated to humans
- ニュートーキョー: GA4プロパティID 変更の可能性（前期比 -90%）
- 別クライアントC: 認証スコープ不足エラー（要再認証）

## Lessons learned （← ここに書く・チャットに残さない）
- 2026-06-30: gcloud auth は `--scopes=...analytics.readonly,...cloud-platform` の **2スコープ同時指定**が必要
- 2026-06-15: 月初2日は GA4 データ反映遅延あり。3日以降に collector 起動推奨

## Stop conditions met since last review
- 「全クライアントの月次レポートPASS」condition was met 2026-07-02 11:30 JST

## Next scheduled run
2026-08-01 09:00 JST （次月分）
```

## セクション設計の意図

| セクション | 役割 |
|---|---|
| Last run | 直近実行の3行サマリー |
| In progress | 中断時の resumability |
| Completed today | 重複起動の防止 |
| Escalated | 人間タスクのキュー |
| **Lessons learned** | **失敗の永続化（最重要）** |
| Stop conditions | `/goal` 達成履歴 |
| Next scheduled | 次回実行の予測可能性 |

## 配置パターン

### パターン1: リポジトリ内 markdown

```
07-routines/ga4-monthly/STATE.md
07-routines/sns-daily/STATE.md
07-routines/pdca-weekly/STATE.md
```

**長所:** 版管理される・差分が読める・diff で過去履歴追える
**短所:** チーム全員に見えてしまう（機密注意）

### パターン2: 外部システム（Notion / Linear / GitHub Issues）

ループの状態を Notion DB や Linear ticket で管理。

**長所:** 横断クエリ可能・チーム全員に可視
**短所:** 復元時に Notion API が必要

## 高レベル仕様との併用（VISION.md / AGENTS.md）

ループが長期化すると目標から drift する。
STATE.md は「**今どこか**」を持ち、`AGENTS.md` / `_RULE.md` は「**どこへ向かうか**」を持つ。
loop 起動時に両方を Read することで drift を防ぐ。

## 必須運用

- loop 起動時: **最初に STATE.md を Read**
- loop 終了時: **Last run / Lessons learned を更新**
- 月1: STATE.md を人間がレビュー（learning が誤った教訓になっていないか）
- 機密情報（APIキー・パスワード）は **絶対に書かない**

## 関連

- ループ判定: [loop-eligibility.md](loop-eligibility.md)
- 継続学習: [continuous-learning.md](continuous-learning.md)
- エラー記憶: [error-memory.md](error-memory.md)
- ドリフト検知: [drift-detection.md](drift-detection.md)
