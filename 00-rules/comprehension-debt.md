# 00-rules/comprehension-debt.md — 理解負債と認知の放棄を防ぐ

> ループが「うまく回るほど」増える借金がある。それを返済するルーティン。

## 2つの危険な状態

### 1. Comprehension debt（理解負債）

> ループが速く出すほど、リポジトリの中身と自分の理解の距離が広がる。
> トークン代より痛いのは、誰も読んでいないシステムをデバッグする日。

工場で起こりうるシナリオ:
- yt-dept が毎月10本動画を自動生成 → 半年後「なぜこのキャラ設定？」を誰も説明できない
- sns-dept が日次投稿を自走 → クライアントに「この表現の根拠は？」と聞かれて答えられない
- web-dept が LP を自動生成 → 修正依頼が来ても元の意図がわからない

### 2. Cognitive surrender（認知の放棄）

> ループが返したものに反論することをやめる引力。
> 同じ「ループ設計」も、判断付きでやれば治療、判断回避でやれば加速剤。

工場で起こりうるシナリオ:
- 「QA PASS したから OK」で diff を読まなくなる
- 「学習済みパターンだから」で出力をそのまま採用
- 「他に時間ない」で人間判断ゲートを形骸化

---

## 必須ルーティン（人間側の運用）

### 週1: Diff Reading Friday

毎週金曜の30分、loop が生成した成果物の diff を1つだけ精読する。
- 「これ自分なら書いた？」と問う
- 違和感があれば skill / agent 定義を更新
- 結果を `STATE.md` の Lessons learned に書く

### 月1: Gate Rot Check

ゲート（*-qa）が腐っていないか抜き打ちチェック:
1. 直近 PASS した成果物を3つランダム選択
2. 「もし自分が同じ成果物を悪意持って submit したら通る？」を試す
3. 通ってしまったら gate 強化（テスト追加・FAIL項目追加）

例:
- yt-qa: 音量チェックだけ通る動画を出して通るか確認
- sns-qa: 文字数だけ OK で内容空っぽの投稿を出して通るか確認
- ga4-qa: 数値を1つだけ書き換えて通るか確認

### 四半期: Loop Audit

ループごとに以下を点検:
- [ ] **accepted-change rate** は 50% 以上か（[loop-eligibility.md](loop-eligibility.md) 参照）
- [ ] STATE.md の Lessons learned が `_RULE.md` / SKILL.md に昇格しているか
- [ ] 廃止すべき loop が動き続けていないか
- [ ] 権限スコープが膨らんでいないか（[security-tax.md](security-tax.md) 参照）

---

## エージェント側の運用

### loop は判断仕事に手を出さない

ループ化していい:
- lint / format / typo修正
- 機械検証可能なリファクタ
- データ収集 / 集計 / レポート生成

ループ化してはいけない:
- アーキテクチャの書き換え
- 認証 / 決済まわりのコード
- 「ユーザー価値」の判断
- ブランドトーンの最終決定
- クライアントへの送信文面の最終承認

詳細: [loop-eligibility.md](loop-eligibility.md) の Bad first loops

### 上流仕様の再Read

loop 起動時に必ず最初に Read:
1. `STATE.md` （直近の状態）
2. 部署 `_RULE.md` / `AGENTS.md` （向かう方向）

これにより goal drift が防げる。

---

## ペア設計

新規 loop を作るときは1人で設計しない:
- 人間 + Claude
- 人間 + Codex
- Claude + Codex

理由: 1人/1モデル設計は盲点を内包する。loop は盲点を**永遠に exploit する**。

---

## 関連

- ループ判定: [loop-eligibility.md](loop-eligibility.md)
- state file: [state-file.md](state-file.md)
- 継続学習: [continuous-learning.md](continuous-learning.md)
- security tax: [security-tax.md](security-tax.md)
