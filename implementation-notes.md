# 実装メモ (マニュアル ver2.0 対応)

## 実装内容

### 1. `ROUTE_SCHEDULES` 定数の追加 (`constants.ts`)

マニュアル第3.3節の出発時刻スロットを `ROUTE_SCHEDULES` として定義した。
各エントリーは `{ type: 'fixed' | 'hourly', hours: number[], label: string }` 形式。

- `fixed` … 固定便（例: 下地島空港 8・12・16時）
- `hourly` … 毎時運行（例: 新石垣・宮古空港 8〜18時毎時、海保・海自 24時間）

### 2. `RouteInfo` インターフェースへのフィールド追加 (`ActionPanel.tsx`)

`scheduleLabel`（UI表示用の日本語時刻ラベル）と `departureTimes`（シミュレーション用の時刻配列）を追加。

### 3. `simulateHourly` の時刻フィルタリング

各時間ループ内で `r.departureTimes.includes(h)` によって、その時刻に出発できるルートのみを処理するよう変更。
これにより「フェリーは午前9時・午後14時のみ」「下地島空港は8・12・16時のみ」等の制約がシミュレーション上で機能する。

### 4. `RouteControl` コンポーネントへの時刻表示

ルートが利用可能な場合、ルート名の直下に `🕐 <scheduleLabel>` を小さく表示。
利用不可ルートには表示しない（フェーズ制限メッセージを優先）。

---

## 判断・省略事項

### ルートと時刻スケジュールの対応付け（判断が必要だった箇所）

| ルートキー | 使用した ROUTE_SCHEDULES キー | 理由・根拠 |
|---|---|---|
| `y_air` (与那国空港) | 有事:`yonaguni_air_wartime`(8・16時), 存立危機:`yonaguni_air_crisis`(8時) | マニュアル3.3: 有事2便/日, 存立危機1便/日(8時固定) |
| `y_sea` (与那国フェリー) | `ferry_main` (9時・14時) | マニュアル3.3 Route G: 午前便9-11時・午後便14-16時の代表値として9時・14時を採用 |
| `t_sea` (竹富→石垣フェリー) | `ferry_main` (9時・14時) | 上記と同様。竹富町内フェリーの詳細スケジュールはマニュアル未記載のため同一扱い |
| `i_air` (新石垣空港) | `shinishigaki_air` (8〜18時毎時) | マニュアル3.3 Route F: 8-18時毎時 |
| `i_cg` (石垣・海保) | `coast_guard` (24時間) | マニュアル3.3 Route A: 24時間運用 |
| `i_jms` (石垣・海自) | `jmsdf` (24時間) | マニュアル3.3 Route B: 24時間運用 |
| `m_air1` (宮古空港) | `miyako_air` (8〜18時毎時) | マニュアル3.3 Route F: 8-18時毎時 |
| `m_air2` (下地島空港) | `shimoji_air` (8・12・16時) | マニュアル3.3 Route E: 8,12,16時 固定3便 |
| `m_cg` (宮古・海保) | `coast_guard` (24時間) | Route A: 24時間 |
| `m_jms` (宮古・海自) | `jmsdf` (24時間) | Route B: 24時間 |

### 省略・簡略化した仕様

1. **フェリー出発時刻の窓**: マニュアルは「午前便 9-11時、午後便 14-16時」と幅を持たせているが、シミュレーターでは9時・14時の代表値を採用。実際の窓幅（±1〜2時間の遅延余地）は未実装。

2. **Route C (空自輸送機)**: `ROUTE_SCHEDULES.asdf`（8〜18時）を定義したが、現在の `ActionPanel.tsx` には空自専用ルートキーが存在しない（`i_cg`/`m_cg` が海保、`i_jms`/`m_jms` が海自に対応）。空自は別途ルートとして追加する必要があるが、既存UIとの整合が取れないため今回は ROUTE_SCHEDULES の定義のみ行い、UIへの組み込みは保留。

3. **要援護者（青コマ）の乗り物制限**: マニュアル上、要援護者は航空機不可・海上輸送のみ。既存コードの `allowsVulnerable: false` が航空ルートに設定されているが、UIでの強制（違反時エラー）は未実装。現状は視覚的な「要援護不可」ラベル表示のみ。

4. **Lv6 の24時間航空運用**: `PREP_LEVEL_SETTINGS[6].crisis24h = true` が既存定数にあるが、シミュレーターの時刻フィルタリングでLvによる航空便時間帯拡張（Lv6のみ24時間）は未実装。現在は常に `shinishigaki_air`（8〜18時毎時）を使用。

5. **波照間・多良間空港**: `ROUTE_SCHEDULES.hateruma_air`・`ROUTE_SCHEDULES.tarama_air` を定数として定義したが、現UIに対応ルートがないため参照されていない。竹富町の内部輸送として将来実装予定。

6. **1コマ = 1手数消費**: マニュアルの「各コマは1手数消費」原則は既存の `stamina` 減算ロジックで実現されており、変更なし。

7. **フェリー容量係数 (0.5/1.0/1.5コマ/便)**: `PREP_LEVEL_SETTINGS` の `mainPortCapacityPerTrip` に定義済みだが、`simulateHourly` のコマ単位計算と統合されていない。容量は `cap.taketomiFerryMax` 等の上限値で間接的に反映。

### 存立危機事態での与那国空港スケジュール

マニュアルには「存立危機: 与那国空港 1便/day (flexible)」と記載されており、flexible の意味が曖昧。本実装では「8時発・1便のみ」（`yonaguni_air_crisis.hours = [8]`）と解釈した。プレイヤーが任意時刻を選べる運用は現UIでサポートしていない。

### フェーズ判定の簡略化

`simulateHourly` は `isWartime` フラグに依存せず、渡された `routes` の `departureTimes` のみで動作する。フェーズ切り替え時のルート差し替えは `useMemo` の `isCrisisOrMore`/`isWartime` フラグで制御されている。

---

## ビルド検証

```
npm run build
✓ built in 190ms (TypeScriptエラーなし)
```
