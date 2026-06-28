# 00-rules/worktrees.md — git worktree 並列実行ルール

> エージェントを2体以上同時に動かすときの「ファイル衝突」防止プロトコル。

## なぜ必要か

複数エージェントが同じファイルを編集すると、2人のエンジニアが調整なしに同じ行を変えるのと同じ事故が起きる。
`git worktree` は同じリポジトリ履歴を共有しつつ別のディレクトリ・別ブランチで作業させる仕組みで、エージェントの編集が互いに触れない。

## 使うべき場面

| シチュエーション | worktree 必須？ |
|---|---|
| Agent 1体で順次実行 | 不要 |
| **同じ部署の複数案件を並列処理**（例: 3クライアントの GA4 レポート同時生成） | **必須** |
| **複数部署を並列起動**（例: yt-dept と sns-dept を同時に） | 不要（出力先が別なら） |
| **同じファイルを editor と reviewer が同時に触る** | **必須** |
| 重要シーンの video Bake-Off（出力先は別） | 不要 |

## 基本コマンド

```bash
# 新しい worktree を作る
git worktree add ../sns-with-ai-driven-client-a -b client-a-ga4

# worktree 一覧
git worktree list

# 作業後に削除
git worktree remove ../sns-with-ai-driven-client-a
```

## Claude Code での使い方

### サブエージェント単位での隔離

エージェント spawn 時に `isolation: "worktree"` を指定すると、
そのエージェントは fresh worktree で動き、編集なしなら自動で worktree が削除される。

```yaml
# Agent ツール呼び出し時のオプション例
isolation: "worktree"
```

**注意:**
- worktree 作成は ~200-500ms + ディスク消費が発生する
- **編集が並列で衝突するときだけ**使う（コスト見合いで判断）
- 1回限りの読み取り作業には不要

### セッション単位での隔離

```bash
claude --worktree ./feature-x
```

このセッション全体が独立 worktree で動く。

## 工場での典型パターン

### パターン1: 複数クライアント GA4 並列

```bash
# ニュートーキョー
git worktree add ../ga4-newtokyo -b ga4/newtokyo-202607
# 別クライアント
git worktree add ../ga4-clientb -b ga4/clientb-202607
# それぞれで ga4-collector を起動
```

### パターン2: web-dept + deck-dept 並列（出力先が別）

worktree 不要（`web/<project>/` と `decks/<project>/` で衝突しない）

### パターン3: 複数ブランチで同じ修正を試す

```bash
git worktree add ../approach-a -b try/approach-a
git worktree add ../approach-b -b try/approach-b
# A案・B案を別エージェントで実装させて比較
```

## 自動クリーンアップ

`isolation: "worktree"` を使ったサブエージェントは、編集なしの場合自動で worktree を削除する。
手動 worktree は使い終わったら必ず `git worktree remove` する（ディスク肥大化防止）。

## 禁則

- worktree を **未マージのまま放置しない**（最大3並列まで）
- 同じブランチを2つの worktree で開かない（git が拒否する）
- `git worktree remove --force` は中の作業が消える。`--force` は人間承認後

## 関連

- ループ判定: [loop-eligibility.md](loop-eligibility.md)
- ドリフト検知: [drift-detection.md](drift-detection.md)
- トークン予算: [token-budget.md](token-budget.md)
