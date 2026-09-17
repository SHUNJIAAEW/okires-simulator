// OKIRES2026 シミュレーター 型定義

export type Phase = 'peacetime' | 'crisis' | 'wartime';

export type WeatherCondition = 'sunny' | 'cloudy' | 'rain' | 'heavy-rain';

export type AreaId = 'yonaguni' | 'taketomi' | 'ishigaki' | 'miyako';

export interface WeatherState {
  condition: WeatherCondition;
  conditionIndex: number;
  windSpeedIndex: number;
  windDirectionIndex: number;
}

export interface AreaState {
  id: AreaId;
  name: string;
  residents: number;
  tourists: number;
  vulnerable: number;
  fatigue: number;
  baseActions: number;
  stagingAirport: number;
  stagingPort: number;         // ハブ(石垣/宮古)で本土便待ちの白コマ（住民・観光客）
  stagingVulnerable: number;   // ハブで本土便待ちの要援護者（海路でのみ搬出可。航空機不可）
  inTransitToHub: number;
}

export interface InfraState {
  shinIshigakiAirport: boolean;
  miyakoAirport: boolean;
  shimojiAirport: boolean;
  yonagunAirport: boolean;
  haterumaAirport: boolean;
  taramaAirport: boolean;
  ishigakiPort: boolean;
  hiraraPort: boolean;
  kuburaPort: boolean;   // 久部良港（与那国）施設。破壊は路線停止(disabledShipRoutes.kubura)と区別して持つ
  seaAllAvailable: boolean;
  powerYonaguni: boolean;
  powerHateruma: boolean;
  powerIshigaki: boolean;
  powerTarama: boolean;
  powerMiyako: boolean;
  bridgeIkema: boolean;
  bridgeIrabu: boolean;
  bridgeKurima: boolean;
}

export interface MilitaryState {
  chineseSea: number;
  chineseAir: number;
  jsdfSea: number;
  jsdfAir: number;
  pac3Ishigaki: number; // PAC3配備数(石垣・竹富)。事前準備Lvで決定、奇数は石垣優先
  pac3Miyako: number;   // PAC3配備数(宮古・下地島)
  senkakuOccupied: boolean;
}

// 路線キー（Section1 改定案: 撃墜/撃沈/運航拒否は路線別に停止する）
// 空路: shinIshigaki / miyako / shimoji / yonaguni / hateruma
// 海路: ishigakiPort / hiraraPort(平良) / kubura(久部良)
export type AirRouteKey = 'shinIshigaki' | 'miyako' | 'shimoji' | 'yonaguni' | 'hateruma';
export type ShipRouteKey = 'ishigakiPort' | 'hiraraPort' | 'kubura';

export interface TransportState {
  coastGuardToday: number;
  coastGuardMaxPerDay: number;
  jmsdfRemaining: number;
  jasdfRemaining: number;
  jgsdfRemaining: number;
  // 後方互換（旧・全便停止フラグ）。現在は路線別停止(disabledAirRoutes/disabledShipRoutes)を正とし、
  // これらは常に false のまま保持する（互換のため残置）。
  civilianAirDisabled: boolean;
  civilianShipDisabled: boolean;
  // 路線別の恒久停止（撃墜/撃沈/運航拒否/施設破壊で当該路線のみ以後使用不可）
  disabledAirRoutes: Partial<Record<AirRouteKey, boolean>>;
  disabledShipRoutes: Partial<Record<ShipRouteKey, boolean>>;
}

// 臨時増援交渉の対象手段（海保は対象外）
export type ReinforcementMeans = 'jgsdf' | 'jmsdf' | 'jasdf';

// 手数ペナルティ: 不時着（ver4.0 6.3.6）は軍機の国（同国は何機でも−1、異国で−2）、
// 'negotiation' は臨時増援交渉（4.9）で消費した1手（1件=−1）。untilDay=その日の24時まで有効。
export interface HandPenalty {
  country: 'china' | 'taiwan' | 'negotiation';
  untilDay: number;
}

export interface ActiveEvent {
  id: string;
  type: string;
  location: string;
  description: string;
  expiresDay: number;
  expiresHour: number;
  penaltyActions: number;
}

export interface EvacuationRecord {
  from: AreaId;
  to: string;
  count: number;
  method: string;
  isVulnerable: boolean;
}

// 時間別ダイス記録
export interface HourlyRoll {
  hour: number;         // 1-24（1日は1時〜24時）
  roll: number;         // 1-6
  isEventSpace: boolean; // このマスでイベント判定あり
  eventType: 'A' | 'B' | 'C' | 'D' | null;
  outcome: string;      // 結果の短い説明
}

// プレイヤーが指定する避難指示
export interface EvacuationOrder {
  from: AreaId;
  // 避難先。'mainland'=本土脱出、'ishigaki'/'miyako'=2島間往復(ピストン)の中継ハブへ集約。
  // 破壊された側ハブの住民を機能している側ハブの stagingPort へ積み、当日残の本土便容量があれば当日、無ければ翌以降に本土へ出す。
  to: 'mainland' | 'ishigaki' | 'miyako';
  method: string;      // 'civilian_air' | 'jmsdf_air' | 'coast_guard' | 'jmsdf_ship' | 'ferry'
  residents: number;
  tourists: number;
  vulnerable: number;
}

// UIに渡す1日の輸送容量
export interface DayCapacities {
  // 与那国
  yonaguniAirMax: number;    // 空路→本土 (民間or自衛隊)
  yonaguniSeaMax: number;    // フェリー→石垣
  // 竹富
  taketomiFerryMax: number;  // フェリー→石垣
  haterumaAirMax: number;    // 波照間空港→新石垣空港 民間航空便(Lv4+ 0.5コマ/日)。竹富エリアの避難補助
  // 石垣
  ishigakiAirMax: number;    // 空路→本土 (新石垣空港)
  ishigakiJasdfMax: number;  // 空自輸送機→本土
  ishigakiCoastGuardMax: number; // 海保→本土
  ishigakiJmsdfMax: number;  // 海自→本土
  ishigakiFerryMax: number;  // 民間フェリー→本土
  // 宮古
  miyakoAirMax: number;      // 宮古空港
  shimojAirMax: number;      // 下地島空港
  miyakoCoastGuardMax: number;
  miyakoJmsdfMax: number;
  miyakoFerryMax: number;
  // 状況
  seaOk: boolean;
  airportAvail: Record<string, boolean>;
  civilianAirOk: boolean;
  civilianShipOk: boolean;
  phase: Phase;
  prepLevel: number;
  jgsdfRemaining: number;
  jmsdfRemaining: number; // 海自輸送艦の実残隻数（石垣/宮古で1隻を2コマに二重計上しないための上限）
  // ===== Section2: 石垣島⇔宮古島 2島間往復(ピストン)輸送 =====
  // 発火可否(Lv>=SHUTTLE_MIN_LEVEL かつ 有事、片方ハブの本土空路が破壊/運航拒否)と輸送元/先。
  shuttleActive: boolean;
  shuttleFrom: AreaId | null;   // 破壊された側ハブ（住民を送り出す島）
  shuttleTo: AreaId | null;     // 機能している側ハブ（集約先。ここから当日または翌以降 本土へ）
  // 近距離ピストン容量（3倍=海保/海自/空自、1倍=陸自ヘリ、無事なら民間航空3倍）。中継便で使う合計コマ。
  shuttleCoastGuardMax: number; // 海保輸送船 1便3コマ
  shuttleJmsdfMax: number;      // 海自輸送艦 1便3コマ
  shuttleJasdfMax: number;      // 空自輸送機 1便3コマ（空港破壊時は応急修理後＝ハブ空港利用可なら）
  shuttleJgsdfMax: number;      // 陸自ヘリ 1便1コマ（通常）
  shuttleCivAirMax: number;     // 民間航空（往復先/送出側の空港が無事なら 1便3コマ）
}

// 半日（午前=1時 / 午後=13時）の天候・風・閉鎖の要約と、その時刻の天候ダイス
export interface HalfDayWeather { summary: string; dice: string[] }

export interface DayLog {
  day: number;
  dayLabel: string;
  phase: Phase;
  closedFacilities: string[]; // その日に当日限りで使用不能だった施設（空港=空路キー / 港='ship:'+海路キー）。マップの🚫表示用
  eventPhase: number;   // フェーズ1〜4（日付固定: X-3〜X-1=1 / X〜X+2=2 / X+3〜X+5=3 / X+6〜X+8=4）
  weatherSummary: string;
  windSummary: string;  // 午前(1時)/午後(13時)の風速・風向（例: 午前 微風(北東) ／ 午後 強風(南東)）
  halfDay: { am: HalfDayWeather; pm: HalfDayWeather };
  events: string[];
  evacuations: EvacuationRecord[];
  fatigueSummary: string;
  totalEvacuatedSoFar: number;
  totalDeadSoFar: number;
  areaSnapshots: Record<AreaId, {
    total: number;
    residents: number;
    tourists: number;
    vulnerable: number;
    staging: number;
    fatigue: number;
  }>;
  hourlyRolls: HourlyRoll[];  // 24時間別ダイス
}

export interface GameState {
  prepLevel: number;
  shelterLevel: number;
  month: number;
  day: number;
  phase: Phase;
  weather: WeatherState;
  areas: Record<AreaId, AreaState>;
  infra: InfraState;
  military: MilitaryState;
  transport: TransportState;
  evacuated: number;
  dead: number;
  dayLogs: DayLog[];
  activeEvents: ActiveEvent[];
  earthquakeDay: number | null;
  earthquakeLevel: number | null;
  isComplete: boolean;
  // DMAT派遣の残回数（宮古/下地/石垣トータル）。空港/海港/市街地集落攻撃の死者発生時に1消費で追加死者+疲労を防ぐ。
  dmatRemaining: number;
  // 多良間島 一時疲労（0..2）。多良間電力破壊で宮古・多良間へ加算、多良間→宮古 避難完了で戻す。
  taramaTempFatigue: number;
  // 多良間の一時疲労を「現在areasに加算済みの量」（冪等な戻し用トラッカー）。宮古・多良間 各エリアに同量加算されている。
  taramaTempApplied: number;
  // 多良間電力が破壊されたか（一時疲労の発火・翌日+1判定用）
  taramaPowerBroken: boolean;
  // 多良間→宮古 住民避難が完了したか（完了で一時疲労を戻す）
  taramaEvacDone: boolean;
  // 波照間島 一時疲労（0..2）。波照間電力破壊で竹富町各島へ加算、波照間→石垣 避難完了で戻す。
  haterumaTempFatigue: number;
  haterumaTempApplied: number;
  haterumaPowerBroken: boolean;
  haterumaEvacDone: boolean;
  // ver4.0 4.9: 自衛隊輸送臨時増援交渉。手段(陸自ヘリ/海自輸送艦/空自輸送機)ごとの直近の交渉記録
  // （残回数0で1日1回交渉。ダイス1〜Lv(Lv6は5)で成功→その手段+1回）。null=未交渉。
  reinforcement: Record<ReinforcementMeans, { day: number; roll: number; success: boolean } | null>;
  // ver4.0 6.3.6: 中国/台湾軍機 不時着による一時手数ペナルティ（当日と翌日24時まで有効。国別に最大1、合計最大2）
  handPenalty: Record<AreaId, HandPenalty[]>;
  // ver4.0 6.4.2/3: 上陸・ヘリボーン成立で当該エリアは「占領」状態（残存コマ全滅・以後の攻撃/避難注文は無効）
  occupied: Record<AreaId, boolean>;
  // ver4.0 4.12: PAC3 撤収・再配備（片方ハブの避難完了後、もう一方へ全数移動）。一度だけ。
  pac3Relocated: boolean;
  // マップ表示用: 当日限りの使用不能施設（空港=空路キー / 港='ship:'+海路キー）
  closedFacilitiesToday: string[];
}

export interface SetupConfig {
  prepLevel: number;
  shelterLevel: number;
  month: number;
  // 観光客・要援護者は createInitialState で毎回ランダム配置（島別上限内）
}

// フェーズ1完了後の中間状態（プレイヤーへの提示用）
export interface DayPhase1Result {
  stateAfterEvents: GameState;       // イベント処理後（避難前）の状態
  newPhase: Phase;
  newMilitary: MilitaryState;
  newWeather: WeatherState;
  airportAvail: Record<string, boolean>;
  seaOk: boolean;
  capacities: DayCapacities;
  capacityMultiplier: Record<AreaId, number>; // イベント由来のエリア別容量倍率
  hourlyRolls: HourlyRoll[];
  eventLog: string[];
  weatherSummary: string;
  windSummary: string;   // 午前/午後の風速・風向
  halfDay: { am: HalfDayWeather; pm: HalfDayWeather };
  phaseChanged: boolean;
  // DMAT未派遣で確定した追加死者コマ数（当日の死者総数に加算する）
  dmatExtraDead: number;
  // イベント攻撃(市街0.5/撃沈1/上陸=エリア全滅/施設破壊死傷0.5)＋地震死者による死者コマ数（当日の死者総数に加算する）
  eventDead: number;
  // ver4.0 6.1 A表「住民の避難拒否」: 当日そのエリア発の避難注文を無効にする（他エリアの通過＝ハブ待機コマの搬出は可）
  evacRefusedToday: AreaId[];
}
