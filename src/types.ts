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
  stagingPort: number;
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

export interface TransportState {
  coastGuardToday: number;
  coastGuardMaxPerDay: number;
  jmsdfRemaining: number;
  jasdfRemaining: number;
  jgsdfRemaining: number;
  civilianAirDisabled: boolean;
  civilianShipDisabled: boolean;
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
  to: 'mainland' | 'ishigaki'; // 避難先
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
}

export interface DayLog {
  day: number;
  dayLabel: string;
  phase: Phase;
  weatherSummary: string;
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
  phaseChanged: boolean;
  // DMAT未派遣で確定した追加死者コマ数（当日の死者総数に加算する）
  dmatExtraDead: number;
  // イベント攻撃(市街0.5/撃沈1/上陸1)による死者コマ数（当日の死者総数に加算する）
  eventDead: number;
}
