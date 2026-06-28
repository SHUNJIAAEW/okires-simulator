# 00-rules/loop-eligibility.md — ループ化判定 + MVL構築順序

> 「この作業、ループ（自走）化していいか？」を判定するチェックリスト。
> 不適切なループ化は人間より遅く・高くつく。順序を守ること。

## なぜ必要か

- ループは固定費（設定・状態管理・検証ゲート）がかかる
- 一度きりの仕事は良いプロンプト1本のほうが速い・安い
- 検証が自動化できないループは「エージェントが自分の答えに賛同し続ける」だけ
- 検証なしで loop に任せた成果物は、誰も理解していないコード債を生む

---

## ① 4条件テスト（戦略判定）

**4つすべて YES なら ループ化可。1つでも NO なら 手動プロンプトのまま。**

| # | 条件 | YES の例 | NO の例 |
|---|---|---|---|
| 1 | **タスクが繰り返す**（最低でも週1） | GA4月次レポート / 日次SNS投稿 / 競合定点観測 | 1回きりの新規案件提案書 |
| 2 | **検証が自動化されている** | テスト / 文字数チェック / リンター / lighthouse スコア | 「いい感じか人間判断」 |
| 3 | **トークン予算が waste を吸収できる** | Plus/Pro契約・無制限モデル中心 | 個人 $20 プラン・metered |
| 4 | **エージェントがシニアエンジニアのツールを持つ** | logs / 再現環境 / コード実行 / DB参照 | 何も実行できない・閉じた sandbox |

## ② 30秒タクティカルチェック

具体タスクをループ化する直前に5項目チェック。1つでも欠ければ手動のまま：

- [ ] このタスクは**週1以上**発生する
- [ ] **テスト / 型 / ビルド / リンター**のいずれかが不合格を機械判定できる
- [ ] エージェントが**変更したコードを実行**できる
- [ ] **ハードストップ**（トークン上限 / 反復回数 / 時間制限）が設定済み
- [ ] **不可逆操作（merge / deploy / 依存変更）の前に人間承認ゲート**がある

## ③ Good first loops（推奨）

| 候補 | 部署 | 検証ゲート |
|---|---|---|
| GA4 月次レポート | ga4-dept | ga4-qa が数値整合チェック |
| SNS 日次投稿企画 | sns-dept | sns-qa が文字数/HT/BLOCK語チェック |
| 競合定点観測 | pdca-dept | pdca-competitor の出力スキーマ整合 |
| YouTubeサムネ生成 | yt-dept | yt-thumb-qa で客観N項目 |
| 物販リサーチ（71キーワード） | resale-dept | resale-data-qa で欠損/重複/異常値検知 |

## ④ Bad first loops（やってはいけない）

- アーキテクチャの書き換え
- 認証・決済まわりのコード
- 本番デプロイ
- 曖昧なプロダクト判断
- 「Done が判断問題」になるもの
- 「3回連続で出力が違う」もの（ドリフト誘発）

## ⑤ MVL（Minimum Viable Loop）構築順序

**ショートカット禁止。順番に上がる。**

```
Step 1: 手動で1回成功させる
   ↓ （結果に再現性ある？）
Step 2: skill 化（SKILL.md に成功手順を書く）
   ↓ （別セッションで skill を起動して同じ結果が出る？）
Step 3: loop 化（オーケストレーターが繰り返し実行）
   ↓ （5回連続成功する？）
Step 4: schedule 化（cron / routine で自走）
   ↓ （1週間放置して accepted-change rate > 50%？）
Step 5: 並列化（worktree で複数並列）
```

**スキップしてはいけない理由:**
- Step 1 を飛ばす → 何が成功か定義されない
- Step 2 を飛ばす → 毎回コンテキスト再構築でトークン浪費
- Step 3 を飛ばす → 失敗パターンの可視化なしに自動化
- Step 4 を飛ばす → 人間トリガーのまま「ループ」と誤認
- Step 5 を飛ばす → 並列衝突で全部壊れる

## ⑥ ループの健全性指標

唯一見るべき指標は **accepted-change rate**:

```
accepted-change rate = (人間がそのまま受け入れた成果物数) / (loop が生成した成果物数)
```

- **50% 未満**: loop が削減したはずのレビュー工数を人間が払い直している → 設計見直し
- **50-80%**: 通常運用範囲
- **80% 以上**: ゲートが緩すぎる可能性（comprehension debt 進行中）

詳細: [comprehension-debt.md](comprehension-debt.md)

## ⑦ Ralph Wiggum loop（要注意な失敗モード）

完了トークンを早く出して途中終了する典型失敗。
回避策:
- 完了判定を**書き手とは別のエージェント（checker）**にやらせる
- 客観ゲート（test / lint / build）を必ず通す
- `/goal` で停止条件を明示

詳細: [drift-detection.md](drift-detection.md)

## 関連

- ドリフト検知: [drift-detection.md](drift-detection.md)
- 検証ループ: [verification-loop.md](verification-loop.md)
- 継続学習: [continuous-learning.md](continuous-learning.md)
- worktree並列: [worktrees.md](worktrees.md)
- state file: [state-file.md](state-file.md)
- comprehension debt: [comprehension-debt.md](comprehension-debt.md)
- security tax: [security-tax.md](security-tax.md)
