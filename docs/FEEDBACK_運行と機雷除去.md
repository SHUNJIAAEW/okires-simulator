# OKIRES2026 シミュレーター — 開発者向けフィードバック
## テーマ：輸送オペレーション（運行）と機雷敷設・除去（掃海）の現実乖離

> 対象コミット時点の `src/gameEngine.ts` / `src/constants.ts` / `src/types.ts` を実読した上での指摘です。
> 各項目は **(1) 現状の実装 → (2) 現実 → (3) 反映案（データ構造/ロジック）** の順で記載します。
> 監修・査読：Claude（実装トレースベース）／Codex の第三者査読は認証復旧後に追記予定。

---

## 0. 結論（最初に読むべき2点）

1. **機雷は「時間的封鎖」が完全に欠落している。**
   現状、機雷はイベントB・出目5「機雷敷設の疑い」で **宮古に疲労+1 が付くだけ**。港湾閉鎖も、掃海（除去）に要する時間も、掃海部隊という資源も存在しない。
   現実の機雷は「撃たれて終わり」のミサイルと違い、**撒かれた瞬間から掃海完了まで航路を殺し続ける**。離島避難における最大級のボトルネックがモデル化されていない。

2. **運行は「容量の単純加算」になっており、現実の「最弱リンクで決まる」構造が無い。**
   現状、各ルートの日次容量を足し合わせるだけ。`civilianAirDisabled` / `civilianShipDisabled` は **一度 true になると復旧ロジックが存在せず永久停止**。
   現実の輸送は、滑走路スロット・燃料・乗員・天候・受け入れ先のうち **どれか1つが切れれば、他がいくら余っても止まる**。この制約の連鎖が表現されていない。

---

## 1. 機雷（敷設・除去／掃海）

### 現状の実装
- `gameEngine.ts` イベントB・出目5：
  ```
  【機雷敷設の疑い】海上輸送ルートへの脅威 宮古 疲労+1
  → return '【機雷疑い】宮古 疲労+1';
  ```
- 影響は宮古の `fatigue += 1` のみ。`seaOk` も港湾容量も不変。
- 「掃海」「除去」「機雷数」「封鎖日数」を表す変数・ロジックは **コード上に存在しない**（grep 済み）。

### 乖離点と反映案

| # | 乖離点（現状） | 現実ではどうなるか | 反映案 |
|---|---|---|---|
| M1 | 機雷が疲労+1だけ。海路は通常どおり使える | 機雷1個の敷設疑いでも、安全確認まで該当港・航路は **即時運航停止** | `mineState` を追加し、敷設中は当該港の `seaOk=false` |
| M2 | 「疑い」と「実敷設」が区別されない | 疑い＝即時減速/停止、確認＝掃海要。性質が異なる | `status: 'suspected' \| 'confirmed' \| 'clearing'` の3段階 |
| M3 | **掃海部隊が登場しない** | 海自掃海隊群（掃海艇・掃海ヘリ MCH-101）。**1海域の啓開に数日〜数週間**、機雷数に応じて延伸 | `mineClearanceUnits`（隻数）を資源化、`clearDays = mineCount × 係数 ÷ units` |
| M4 | 影響が宮古ローカルのみ | 機雷は **航路（チョークポイント）** に効く。宮古海峡封鎖は石垣・宮古双方の本土航路を同時に断つ | 機雷を「港」でなく「航路セグメント」に紐付け、複数エリアへ波及 |
| M5 | 時間経過で悪化も回復もしない | 掃海完了まで **毎日** 海上避難機会を喪失。逆に掃海完了で回復 | 港閉鎖日数 × 喪失海路容量を集計し、結果画面の損失指標に |

### データ構造案
```ts
// types.ts
export interface MineThreat {
  routeId: 'miyako_main' | 'ishigaki_main' | 'miyako_strait';
  status: 'suspected' | 'confirmed' | 'clearing';
  mineCount: number;        // 敷設規模
  clearDaysRemaining: number; // 掃海完了までの残日数（0で再開）
}
export interface TransportState {
  // ...既存...
  mineThreats: MineThreat[];
  mineClearanceUnits: number; // 投入可能な掃海部隊（隻）
}
```

### ロジック案（イベントB・出目5 を置換）
```ts
// 旧：疲労+1のみ
// 新：航路に機雷を敷設し、確認後に掃海日数を発生させる
const mineCount = 1 + Math.floor(subRoll / 3); // 規模をダイスに連動
result.mineThreat = {
  routeId: 'miyako_main',
  status: 'suspected',
  mineCount,
  clearDaysRemaining: 0,
};
result.log.push(`[イベントB|出目${subRoll}] 【機雷敷設疑い】平良港 海上輸送 即時停止（安全確認中）`);
return '【機雷】平良港 海上輸送停止';

// executeDayPhase2 冒頭の港利用可否判定で：
const blocked = transport.mineThreats.some(
  m => m.routeId === 'miyako_main' && m.status !== 'cleared'
);
const miyakoSeaOk = seaOk && !blocked;

// 毎日の更新：掃海部隊を投入していれば残日数を減らす
for (const m of transport.mineThreats) {
  if (m.status === 'confirmed') {
    m.clearDaysRemaining = Math.ceil(m.mineCount * 3 / Math.max(1, transport.mineClearanceUnits));
    m.status = 'clearing';
  } else if (m.status === 'clearing') {
    m.clearDaysRemaining -= 1;
    if (m.clearDaysRemaining <= 0) m.status = 'cleared'; // 港再開
  }
}
```

---

## 2. 輸送オペレーション（運行・発着・容量・スケジュール）

### 現状の実装
- 容量は日次の理想値：`mainPortCapacityPerTrip`、`TAKETOMI_TO_ISHIGAKI_FERRY_MAX=11` など。
- スケジュールは `ROUTE_SCHEDULES` の固定スロット（例：新石垣 8〜18時毎時、フェリー 9・14時）。
- `civilianAirDisabled` / `civilianShipDisabled`：**true 化後に false へ戻す処理がコードに無い → 不可逆停止**。

### 乖離点と反映案

| # | 乖離点（現状） | 現実ではどうなるか | 反映案 |
|---|---|---|---|
| T1 | 輸送停止が **不可逆**（撃沈/ボイコット後ずっと0） | 滑走路被弾も応急啓開で **部分復旧**（数時間〜1日）。航空再開は現実的にあり得る | `disabledUntilDay` を持たせ、`prepLevel`/工兵で復旧日を短縮 |
| T2 | **燃料・整備・乗員交代** が無い | JET A-1 の島内備蓄は数日分。給油が切れれば **容量があっても飛べない** | `fuelDays` を毎日減少、補給イベントで回復、枯渇で容量0 |
| T3 | 管制・スロットの **飽和** が無い（容量は単純加算） | 滑走路1本・誘導路・駐機スポット数で **1日の発着回数に上限**。民間＋自衛隊が同一空港を奪い合う | `airport.slotsPerDay` を上限に、軍民で配分 |
| T4 | 悪天候が容量に直接効かない（疲労経由のみ） | 台風接近で **全便欠航**。波照間・多良間は定期1便/日が即孤立 | `weather.typhoon` 時に該当ルート容量を ×0〜0.3 |
| T5 | 下地島の **軍民競合** が表現されない | 有事は自衛隊使用が優先、民間発着枠が圧縮 | 有事フェーズで `shimojCivilianShare` を低下 |
| T6 | 受け入れ側（本土・九州）の処理能力が無限 | 福岡・鹿児島側の **スループットにも上限**。超過分は港で滞留 | 着地側 `intakePerDay` を設け、超過は staging に滞留 |

### データ構造案
```ts
// types.ts（TransportState 拡張）
export interface AirportOps {
  id: 'shinishigaki' | 'miyako' | 'shimoji' | 'yonaguni' | 'hateruma' | 'tarama';
  slotsPerDay: number;     // 1日の最大発着回数（管制・駐機の上限）
  fuelDays: number;        // 残燃料（日数換算）
  disabledUntilDay: number | null; // 被弾→応急復旧の目標日
  militaryPriority: boolean; // 有事の軍優先
}
export interface TransportState {
  // ...既存...
  airports: AirportOps[];
  mainlandIntakePerDay: number; // 本土受け入れ上限（コマ/日）
}
```

### ロジック案
```ts
// 容量算出を「単純加算」から「最弱リンク」に変更
function effectiveAirCapacity(ap: AirportOps, demand: number, isWartime: boolean): number {
  if (ap.disabledUntilDay !== null && ap.disabledUntilDay > 0) return 0; // 復旧前
  if (ap.fuelDays <= 0) return 0;                                        // 燃料切れ
  let cap = Math.min(demand, ap.slotsPerDay);                            // スロット上限
  if (isWartime && ap.militaryPriority) cap = Math.floor(cap * 0.4);     // 軍優先で民間枠圧縮
  return cap;
}

// 毎日の更新
for (const ap of transport.airports) {
  ap.fuelDays -= 1;                                   // 燃料消費
  if (ap.disabledUntilDay !== null) ap.disabledUntilDay -= 1; // 応急復旧の進行
}

// 天候（台風）で全ルート容量を圧縮
const wx = weather.typhoon ? 0.0 : weather.rough ? 0.3 : 1.0;

// 受け入れ側のボトルネック：本土到着がintakeを超えたら港に滞留
const arrived = Math.min(totalToMainland, transport.mainlandIntakePerDay);
const stuck = totalToMainland - arrived; // staging に戻す
```

---

## 3. 優先度（開発者向け推奨着手順）

| 優先 | 項目 | 理由 | 規模感 |
|---|---|---|---|
| ★★★ | **M1〜M3 機雷→港閉鎖＋掃海日数** | 避難の最大ボトルネックが丸ごと未実装。教育的インパクト最大 | 中（state追加＋日次更新） |
| ★★★ | **T1 輸送停止の復旧** | 「不可逆停止」は明確なロジック欠落。少改修で現実性が大きく向上 | 小 |
| ★★☆ | **T2 燃料 / T3 スロット飽和** | 「最弱リンク」構造の核。容量加算モデルからの脱却 | 中 |
| ★★☆ | **T6 本土受け入れ上限** | 結果画面の「見えていないこと」と整合。滞留を可視化できる | 小〜中 |
| ★☆☆ | **M4 航路チョークポイント / T4 天候欠航 / T5 下地島軍民競合** | 精緻化フェーズ。上記実装後に拡張 | 中 |

---

## 4. 補足：結果画面（学び）との接続
`ResultScreen.tsx` の「シミュレーションで見えていないこと」に
**「燃料の枯渇」「機雷封鎖」** が既にテキストで言及されている。
本フィードバックの実装はそのテキストを **実際の数値根拠つきの体験** に変える位置づけ。
（例：「機雷により平良港が N 日封鎖 → 海上避難 X コマ喪失」を結果に表示）

---

## 5. Codex査読（第三者・セカンドオピニオン）

Codex CLI（OpenAI）による独立査読。実コード行を参照し、国交省「離島避難の基本的考え方」・海自掃海隊群・海保災害対策を外部前提として分析。
**総評：** 「港湾・空港・航路・機材・乗員・受入地・掃海を個別リソースとして持っていないため、現実で最も詰まる『どの経路を、どの状態の港湾/空港で、どの機材が、何時間後に、何回転できるか』が表現できない」。

### Codexが追加で挙げた論点（Claude分析に無かった視点）

| # | 論点 | 現状 | 反映案 |
|---|---|---|---|
| CX1 | **海保/海自の任務競合** | 海保は日次回数、海自/空自は残数のみ | 同一アセットを **輸送/護衛/掃海/救難で取り合う任務割当制** に |
| CX2 | **航路別の海象** | `seaOk` は全海域一括（大雨/強風で一律不可） | 航路別 `seaState` ＋ 船型別耐候性。波照間・多良間の小型船は別判定 |
| CX3 | **施設破壊の部位別** | 破壊は一括 | 滑走路/燃料設備/岸壁/旅客ターミナル/航行援助施設を **部位別 `FacilityDamage`** に |
| CX4 | **要援護者の輸送手段制限が未強制** | コメントは「海路のみ」だが注文検証で方法制限なし | `PassengerClass` 別に必要設備・処理時間・搬送先医療容量 |
| CX5 | 受入側CIQ/保安検査/地上交通/宿泊/医療トリアージ | 上限なし | `DestinationCapacity` で到着処理上限、超過は翌日滞留 |

### 🐛 Codexが発見し、Claudeが実コードで検証したバグ（要修正）

| # | バグ | 該当箇所 | 検証結果 | 深刻度 | 状態 |
|---|---|---|---|---|---|
| **B1** | **施設破壊が無効果（no-op）** | `gameEngine.ts:433-438` | ✅ 実在。`【施設破壊】新石垣空港が使用不能` とログ出力するが、実処理は `fatigue += 1.5` のみで **空港/港は使用可能なまま**。破壊が見かけ倒し | **高** | ✅ **修正済** |
| **B2** | **容量計算の順序ズレ** | `gameEngine.ts:630` | ✅ 実在。`getDayCapacities()` を輸送停止フラグ（`civilianAirDisabled`等）の反映**前**の `stateAfterEvents` で呼んでいる。当日の表示/ログ容量が停止を織り込めずズレる（※避難の実計算はphase2で正しいフラグを読むため、主にUI/ログ層の不整合） | 中 | ✅ **修正済** |

> **修正内容（実装済み）：**
> - **B1**：`EventResult` に `infraPenalty: Partial<InfraState>` を追加。施設破壊時に対象（石垣港/平良港/新石垣空港/宮古空港）の `infra` フラグを `false` 化し、`prepareDayPhase1` で被害後インフラから `checkAirportAvailability` を再計算。「使用不能」表示が実挙動と一致。
> - **B2**：輸送停止フラグ・インフラ被害を `stateAfterEvents` にマージした**後**で `getDayCapacities()` を呼ぶよう順序を修正。
> - ※いずれも現状は「破壊＝以後ずっと使用不能（不可逆）」。可逆復旧（`disabledUntilDay`）は本フィードバックT1の今後拡張で対応。

#### B1 修正例
```ts
// 施設破壊時に対象施設を実際に使用不能化する
if (calcValue >= threshold) {
  result.log.push(`  ⚠️ 施設破壊! ${target}が使用不能`);
  result.fatigueIncrease.ishigaki += 1.5;
  result.fatigueIncrease.miyako += 1.5;
  // ↓ 追加：対象施設を無効化（disabledUntilDayで応急復旧も表現）
  result.facilityDamage = { target, disabledUntilDay: state.day + 2 };
  return `【施設破壊】${target} 計${calcValue}≥${threshold}`;
}
```

#### B2 修正例
```ts
// 輸送停止フラグを先にマージしてから容量を計算する
const transportAfter = {
  ...stateAfterEvents.transport,
  civilianAirDisabled: state.transport.civilianAirDisabled || (eventResult.transportPenalty.civilianAirDisabled ?? false),
  civilianShipDisabled: state.transport.civilianShipDisabled || (eventResult.transportPenalty.civilianShipDisabled ?? false),
};
const finalState = { ...stateAfterEvents, transport: transportAfter };
const capacities = getDayCapacities(finalState, airportAvail, seaOk); // ← フラグ反映後で呼ぶ
```

### Codexの優先実装順
1. `civilianAirDisabled: boolean` → `civilianAirStatus: { level: 'normal'|'reduced'|'stopped'; untilDay?; reason? }` で可逆化
2. 容量計算順を修正（B2）
3. 機雷を疲労イベント→航路イベントへ昇格（`mineThreats` を `GameState` に）
4. 掃海をプレイヤー選択可能な任務に（海自戦力を輸送/掃海/護衛でトレードオフ）
5. 日次容量→時間スロット容量（`ROUTE_SCHEDULES` を実際の便生成に使い欠航/折返し/到着滞留をログ化）

> 参照（Codex提示）：国交省「離島の住民の避難に係る運送事業者の…基本的な考え方」/ 海自掃海隊群 / 海自「機雷掃海」/ 海保「災害対策」

---

## 6. Claude × Codex 突き合わせ

### ✅ 両者一致（確度が高い＝最優先で正しい）
- **機雷は「航路単位の状態マシン」にすべき**（suspected→confirmed→clearing→cleared）。疲労+1は過小。
- **掃海部隊をリソース化**し、機雷規模に応じた啓開日数で港を封鎖。
- **輸送停止は可逆化**（`disabledUntilDay`／status化）。現状の不可逆停止は明確な欠陥。
- **容量は「単純加算」でなく制約の連鎖**で決まる（燃料・スロット・受入側上限）。

### 🔵 Codexが上乗せした価値
- **実コードのバグ2件（B1施設破壊no-op／B2容量順序）** ← Claudeは設計乖離に集中し、この実装バグは未指摘。最大の収穫。
- **任務競合（CX1）**：同一アセットを輸送/護衛/掃海/救難で取り合う構造。
- **航路別海象（CX2）／施設の部位別破壊（CX3）** の粒度の細かさ。

### 🟢 Claudeが上乗せした価値
- **機雷のチョークポイント波及**（宮古海峡封鎖が石垣・宮古の本土航路を同時に断つ）。
- **結果画面（学び）テキストとの接続**：「燃料枯渇」「機雷封鎖」を数値根拠つき体験に変換する位置づけ。
- **優先度×規模感の工数マトリクス**（開発者の着手判断用）。

### ⚪ 両者の共通スコープ外（今回は対象外と明示）
- 避難拒否者の心理、情報伝達崩壊、デマ拡散 → 別軸（社会・情報）の課題として切り分け。

### 🎯 統合：開発者が最初に着手すべき3つ
1. **B1（施設破壊no-op）を修正** — バグであり安価。「使用不能」表示と実挙動を一致させる。
2. **輸送停止の可逆化（T1）** — 小改修で現実性が大きく向上。
3. **機雷→航路封鎖＋掃海日数（M1-M3 / CX）** — 避難最大のボトルネックを初めて体験可能にする。

---

_作成：Claude（コード実読ベース）＋ Codex（独立査読・外部資料参照）。バグB1/B2はClaudeが実コードで再検証済み。_
