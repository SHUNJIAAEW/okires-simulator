# 00-rules/token-budget.md — トークン予算ルール

> 自律型エージェントを長く・安く・正確に動かすための「読み方/書き方」の上限。
> 全部署・全エージェントが従う。

## なぜ必要か

- エージェントが自律的に動く＝AIモデルへのリクエスト数が増える＝コスト跳ね上がり
- 大規模ファイル全読みは「文脈ノイズ」を増やし、誤推論の温床になる
- 一度に持つ context が大きいほど、後半の判断精度が落ちる

## ルール

### 1. 読み込み上限

| 状況 | 上限 | やり方 |
|---|---|---|
| 通常のファイル参照 | 2000行 | Read tool 既定 |
| 大規模ファイル | 必要箇所のみ | `offset` / `limit` で部分Read |
| ディレクトリ走査 | 関係箇所のみ | Explore agent or `grep` で先に絞る |
| MEMORY.md 索引 | 200行以内 | 索引は1行150字以内・本文は別ファイル |

### 2. 不要な再Readを禁止

- 既に context にあるファイルを再 Read しない（Edit/Write は再Readなしで通せる）
- 同じ MEMORY.md を1セッション内で2回以上Readしない
- Bash `cat`/`head`/`tail` での再表示も禁止

### 3. 上流成果物を確認せず創作する builder/writer を禁止

各部署の builder/writer は、必ず先行ロールの成果物（outline.md / copy.md / design.md）が揃っていることを確認してから着手。
揃っていなければ「揃えてから来てください」と返す（自作しない）。

### 4. 部署ごとの読込ホワイトリスト

各部署エージェントは自分の入力ファイル以外を**原則として読まない**：

| 部署 | 読んでよい場所 |
|---|---|
| ga4-* | `02-company_knowledge/` / `.claude/memory/<client>-ga4.md` / `05-raw-data/ga4/` |
| sns-* | `sns/<channel>/` / `channels/<channel>/` / 該当 memory |
| yt-* | `channels/<channel>/` / 該当 memory |
| web-* | `web/<project>/` / `02-company_knowledge/` |
| deck-* | `decks/<project>/` / `02-company_knowledge/` |
| resale-* | `resale/` / `02-company_knowledge/` |
| agency-* | `agency/<lead>/` / `02-company_knowledge/` |

スコープ外を読む必要がある場合は、CxO 経由で明示的に依頼する。

### 5. オーケストレーター（人間 or Claude本体）の責務

- サブエージェントに spawn する際は、必要なファイルパスを **prompt に明記**して、無駄探索を防ぐ
- 1タスクに対し1サブエージェント原則（並列もコンテキスト隔離のために有効）
- サブエージェントの返答が長すぎる場合は「要約だけ返して」と指示する

## 効果

- 1セッションあたりの平均トークンを 30-50% 削減できる目標
- 誤推論率の低下（文脈ノイズが減るため）
- Codex の `--full-auto` モードでも安定して動作

## 関連

- 検証ループ: `verification-loop.md`
- ドリフト検知: `drift-detection.md`
- 継続学習: `continuous-learning.md`
