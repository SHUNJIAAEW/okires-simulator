// OKIRES2026 ゲームエンジン

import type {
  GameState, SetupConfig, AreaId, AreaState,
  WeatherState, MilitaryState, TransportState, InfraState,
  ActiveEvent, DayLog, EvacuationRecord, Phase,
  HourlyRoll, EvacuationOrder, DayCapacities, DayPhase1Result,
  AirRouteKey, ShipRouteKey,
} from './types';
import {
  getWeatherTrack, getInitialWeatherIndex, getInitialWindSpeedIndex,
  getInitialWindDirectionIndex, isStrongWind, AIRPORT_ALLOWED_WIND_DIRECTIONS,
  PREP_LEVEL_SETTINGS, TAKETOMI_TO_ISHIGAKI_FERRY_MAX, YONAGUNI_TO_ISHIGAKI_FERRY,
  handsByFatigue, TOURIST_MAX_BY_AREA, VULNERABLE_TOTAL_MAX,
  TOURIST_BY_MONTH, RESIDENT_TOTAL_BY_AREA, PAC3_BY_LEVEL,
  SHUTTLE_MIN_LEVEL, SHUTTLE_MULTIPLIER,
} from './constants';

// ===== サイコロ =====
export function rollDie(): number {
  return Math.floor(Math.random() * 6) + 1;
}

// 観光客：その月の総数(TOURIST_BY_MONTH)を島別上限(0/2/5/5)内でランダム配分
function randomTourists(month: number): Record<AreaId, number> {
  const result: Record<AreaId, number> = { yonaguni: 0, taketomi: 0, ishigaki: 0, miyako: 0 };
  // 月の観光客総数（8月など=12、その他は少なめ）。上限合計12を超えない
  const maxTotal = TOURIST_MAX_BY_AREA.yonaguni + TOURIST_MAX_BY_AREA.taketomi + TOURIST_MAX_BY_AREA.ishigaki + TOURIST_MAX_BY_AREA.miyako;
  const total = Math.min(TOURIST_BY_MONTH[month] ?? maxTotal, maxTotal);
  // 残容量のある島へ1コマずつランダムに割り当て
  const ids: AreaId[] = ['yonaguni', 'taketomi', 'ishigaki', 'miyako'];
  for (let i = 0; i < total; i++) {
    const avail = ids.filter(id => result[id] < TOURIST_MAX_BY_AREA[id]);
    if (avail.length === 0) break;
    const id = avail[Math.floor(Math.random() * avail.length)];
    result[id] += 1;
  }
  return result;
}

// 要援護者：合計9コマを住民総数で重み付けしてランダム配分（各島の住民総数を超えない＝住民の一部）
function randomVulnerable(residentTotal: Record<AreaId, number>): Record<AreaId, number> {
  const result: Record<AreaId, number> = { yonaguni: 0, taketomi: 0, ishigaki: 0, miyako: 0 };
  const ids = Object.keys(residentTotal) as AreaId[];
  for (let i = 0; i < VULNERABLE_TOTAL_MAX; i++) {
    // まだ住民総数に空きのある島だけを対象に、住民総数で重み付け抽選
    const cand = ids.filter(id => result[id] < residentTotal[id]);
    if (cand.length === 0) break;
    const totalW = cand.reduce((s, id) => s + residentTotal[id], 0);
    let r = Math.random() * totalW;
    for (const id of cand) {
      r -= residentTotal[id];
      if (r <= 0) { result[id] += 1; break; }
    }
  }
  return result;
}

export function rollDice(n: number): number[] {
  return Array.from({ length: n }, rollDie);
}

export function sumDice(n: number): number {
  return rollDice(n).reduce((a, b) => a + b, 0);
}

// ===== 初期状態生成 =====
export function createInitialState(config: SetupConfig): GameState {
  const { prepLevel, shelterLevel, month } = config;
  const settings = PREP_LEVEL_SETTINGS[prepLevel as keyof typeof PREP_LEVEL_SETTINGS];

  // 住民総数はマニュアル2.5準拠(2/9/44/54=109)。要援護者9はこの住民の一部。
  // 観光客はその月の総数を島別上限内で配分。residents=住民総数−要援護者(=健常住民)。
  const tourists = randomTourists(month);
  const vulnerable = randomVulnerable(RESIDENT_TOTAL_BY_AREA);
  const rt = RESIDENT_TOTAL_BY_AREA;

  const areas: Record<AreaId, AreaState> = {
    yonaguni: {
      id: 'yonaguni', name: '与那国島',
      residents: rt.yonaguni - vulnerable.yonaguni, tourists: tourists.yonaguni, vulnerable: vulnerable.yonaguni,
      fatigue: -shelterLevel, baseActions: 2,
      stagingAirport: 0, stagingPort: 0, inTransitToHub: 0,
    },
    taketomi: {
      id: 'taketomi', name: '竹富町全島',
      residents: rt.taketomi - vulnerable.taketomi, tourists: tourists.taketomi, vulnerable: vulnerable.taketomi,
      fatigue: -shelterLevel, baseActions: 2,
      stagingAirport: 0, stagingPort: 0, inTransitToHub: 0,
    },
    ishigaki: {
      id: 'ishigaki', name: '石垣島',
      residents: rt.ishigaki - vulnerable.ishigaki, tourists: tourists.ishigaki, vulnerable: vulnerable.ishigaki,
      fatigue: -shelterLevel, baseActions: 4,
      stagingAirport: 0, stagingPort: 0, inTransitToHub: 0,
    },
    miyako: {
      id: 'miyako', name: '宮古島・多良間',
      residents: rt.miyako - vulnerable.miyako, tourists: tourists.miyako, vulnerable: vulnerable.miyako,
      fatigue: -shelterLevel, baseActions: 3,
      stagingAirport: 0, stagingPort: 0, inTransitToHub: 0,
    },
  };

  const weatherTrack = getWeatherTrack(month);
  const weatherIdx = getInitialWeatherIndex(month);

  return {
    prepLevel, shelterLevel, month,
    day: -3, phase: 'peacetime',
    weather: {
      condition: weatherTrack[weatherIdx - 1],
      conditionIndex: weatherIdx,
      windSpeedIndex: getInitialWindSpeedIndex(month),
      windDirectionIndex: getInitialWindDirectionIndex(month),
    },
    areas,
    infra: {
      shinIshigakiAirport: true, miyakoAirport: true, shimojiAirport: true,
      yonagunAirport: true, haterumaAirport: settings.haterumaAirport,
      taramaAirport: settings.taramaAirport, ishigakiPort: true, hiraraPort: true,
      seaAllAvailable: true, powerYonaguni: true, powerHateruma: true,
      powerIshigaki: true, powerTarama: true, powerMiyako: true,
      bridgeIkema: true, bridgeIrabu: true, bridgeKurima: true,
    },
    military: {
      chineseSea: 0, chineseAir: 0, jsdfSea: 0, jsdfAir: 0,
      // PAC3は事前準備Lv別の数を初期配備。合計を石垣優先(奇数は石垣)で分配。ダイス無関係。
      pac3Ishigaki: Math.ceil((PAC3_BY_LEVEL[prepLevel] ?? 0) / 2),
      pac3Miyako: Math.floor((PAC3_BY_LEVEL[prepLevel] ?? 0) / 2),
      senkakuOccupied: false,
    },
    transport: {
      coastGuardToday: settings.coastGuardTripsPerDay,
      coastGuardMaxPerDay: settings.coastGuardTripsPerDay,
      jmsdfRemaining: settings.jmsdfTotal,
      jasdfRemaining: settings.jasdfTotal,
      jgsdfRemaining: settings.jgsdfTotal,
      civilianAirDisabled: false, civilianShipDisabled: false,
      disabledAirRoutes: {}, disabledShipRoutes: {},
    },
    evacuated: 0, dead: 0, dayLogs: [], activeEvents: [],
    earthquakeDay: null, earthquakeLevel: null, isComplete: false,
    // DMAT派遣トータル回数（事前準備Lv別 1/2/3/4/4/4）
    dmatRemaining: settings.dmat,
    // 一時疲労トラッカー（多良間・波照間）
    taramaTempFatigue: 0, taramaTempApplied: 0, taramaPowerBroken: false, taramaEvacDone: false,
    haterumaTempFatigue: 0, haterumaTempApplied: 0, haterumaPowerBroken: false, haterumaEvacDone: false,
  };
}

// ===== 天候更新 =====
export function updateWeather(weather: WeatherState, month: number, log: string[], timeLabel?: string): WeatherState {
  const track = getWeatherTrack(month);
  const maxIdx = track.length;
  let { conditionIndex, windSpeedIndex, windDirectionIndex } = weather;

  const wRoll = rollDie();
  if (wRoll >= 5) {
    conditionIndex = conditionIndex >= maxIdx ? 1 : conditionIndex + 1;
  }

  const wsRoll = rollDie();
  if (wsRoll >= 2) {
    windSpeedIndex = windSpeedIndex >= 8 ? 1 : windSpeedIndex + 1;
  }
  const strong = isStrongWind(windSpeedIndex, month);

  const wdRoll = rollDie();
  if (wdRoll <= 2) {
    windDirectionIndex = windDirectionIndex <= 1 ? 6 : windDirectionIndex - 1;
  } else if (wdRoll >= 5) {
    windDirectionIndex = windDirectionIndex >= 6 ? 1 : windDirectionIndex + 1;
  }

  const condition = track[conditionIndex - 1];
  const windLabel = ['西', '北西', '北東', '東', '南東', '南西'][windDirectionIndex - 1];
  const speedLabel = strong ? '強風' : '微風';
  const condLabel = condition === 'sunny' ? '晴' : condition === 'cloudy' ? '曇' : condition === 'rain' ? '雨' : '大雨';
  const prefix = timeLabel ? `${timeLabel} ` : '';
  log.push(`${prefix}天候変化ダイス: 天候${wRoll}→${condLabel} / 風速${wsRoll}→${speedLabel}(${windLabel}) / 風向${wdRoll}`);

  return { condition, conditionIndex, windSpeedIndex, windDirectionIndex };
}

// ===== 空港・港の利用可否 =====
export function checkAirportAvailability(
  weather: WeatherState, month: number, infraState: GameState['infra']
): Record<string, boolean> {
  const heavy = weather.condition === 'heavy-rain';
  const strong = isStrongWind(weather.windSpeedIndex, month);

  function airportOk(key: string, infraOk: boolean): boolean {
    if (!infraOk || heavy) return false;
    if (!strong) return true;
    const allowed = AIRPORT_ALLOWED_WIND_DIRECTIONS[key] || [];
    return allowed.includes(weather.windDirectionIndex);
  }

  return {
    shinIshigaki: airportOk('shinIshigaki', infraState.shinIshigakiAirport),
    miyako: airportOk('miyako', infraState.miyakoAirport),
    // 下地島空港は伊良部大橋経由でしか到達できない＝橋が落ちると使用不能
    shimoji: airportOk('shimoji', infraState.shimojiAirport && infraState.bridgeIrabu),
    yonaguni: airportOk('yonaguni', infraState.yonagunAirport),
    hateruma: airportOk('hateruma', infraState.haterumaAirport),
    tarama: airportOk('tarama', infraState.taramaAirport),
  };
}

export function isSeaAvailable(weather: WeatherState, month: number): boolean {
  if (weather.condition === 'heavy-rain') return false;
  if (isStrongWind(weather.windSpeedIndex, month)) return false;
  return true;
}

// ===== フェーズ移行 =====
// 事態モード（平時→存立危機事態→有事）。マニュアル3.1：避難の可否を決める。フェーズ(F1-F4)とは無関係。
//   X日(day 0)以降: 強制的に有事
//   X-3〜X-1(day -3..-1): 1:00のダイスが「1〜事前準備Lv(Lv6はLv5扱い)」なら1段階上昇
export function checkPhaseTransition(state: GameState, log: string[]): Phase {
  const { day, phase, prepLevel } = state;

  if (day >= 0) {
    if (phase !== 'wartime') log.push('X日: 武力攻撃事態を発令 → 有事モードに移行（全エリア24時間避難可能）');
    return 'wartime';
  }

  // X-3〜X-1: ダイスでモード上昇（有事まで上がりうる）
  if (phase === 'wartime') return 'wartime';
  const lv = Math.min(prepLevel, 5);
  const roll = rollDie();
  if (roll <= lv) {
    const next: Phase = phase === 'peacetime' ? 'crisis' : 'wartime';
    log.push(`事態上昇: ダイス${roll} ≤ 事前準備Lv${lv} → ${next === 'crisis' ? '存立危機事態' : '有事'}に移行`);
    return next;
  }
  log.push(`事態維持: ダイス${roll} > 事前準備Lv${lv} → ${phase === 'peacetime' ? '平時' : '存立危機事態'}継続`);
  return phase;
}

// フェーズ(F1-F4)＝日付固定（事態モードとは無関係）。発生し得るイベント種別を決める。
//   F1: X-3〜X-1(A) / F2: X〜X+2(A,B) / F3: X+3〜X+5(A,B,C) / F4: X+6〜X+8(A,B,C,D)
function eventPhase(day: number): number {
  if (day <= -1) return 1;
  if (day <= 2) return 2;
  if (day <= 5) return 3;
  return 4;
}

// ===== 地震判定 =====
export function checkEarthquake(_state: GameState, log: string[]): number | null {
  const rolls = rollDice(4);
  if (rolls.every(r => r === 6)) {
    const severity = rollDie();
    log.push(`⚠️ 地震発生！ ダイス4個全て6 → 規模ダイス: ${severity}`);
    return severity;
  }
  return null;
}

// ===== 中国軍・自衛隊配置 =====
export function updateMilitary(state: GameState, log: string[]): MilitaryState {
  const mil = { ...state.military };
  const { prepLevel, day } = state;

  const chinaRoll = rollDie();
  if (chinaRoll >= 3 && chinaRoll <= 4) {
    mil.chineseSea = Math.min(6, mil.chineseSea + 1);
    log.push(`[4:00] 中国海軍増強: ダイス${chinaRoll} → 水上艦艇/潜水艦 計${mil.chineseSea}`);
  } else if (chinaRoll >= 5) {
    mil.chineseAir = Math.min(6, mil.chineseAir + 1);
    log.push(`[4:00] 中国空軍増強: ダイス${chinaRoll} → 戦闘機/攻撃機 計${mil.chineseAir}`);
  } else {
    log.push(`[4:00] 中国軍配置ダイス: ${chinaRoll} → 変化なし`);
  }

  if (day >= -2) {
    const jsdfRoll = rollDie();
    const effectiveLevel = Math.min(prepLevel, 5);
    if (jsdfRoll <= effectiveLevel) {
      const seaOrAir = rollDie() <= 3 ? 'sea' : 'air';
      if (seaOrAir === 'sea') {
        mil.jsdfSea = Math.min(effectiveLevel, mil.jsdfSea + 1);
        log.push(`自衛隊配置: ダイス${jsdfRoll} → 海上自衛隊 計${mil.jsdfSea}`);
      } else {
        mil.jsdfAir = Math.min(effectiveLevel, mil.jsdfAir + 1);
        log.push(`自衛隊配置: ダイス${jsdfRoll} → 航空自衛隊 計${mil.jsdfAir}`);
      }
    } else {
      log.push(`自衛隊配置ダイス: ${jsdfRoll} → 今日は増強なし`);
    }

    // PAC3は事前準備Lvで初期配備済み（ダイス配備は廃止）。ここでは増減しない。
  }

  return mil;
}

// ===== 24時間イベントシステム =====
// 1日は1時〜24時（0時始まりではない）。イベント判定マスは毎日ランダムに6時刻へ配置（1〜24時から重複なく抽選）
function pickEventSpaceHours(count = 6): Set<number> {
  const pool = Array.from({ length: 24 }, (_, h) => h + 1); // 1..24時
  // Fisher–Yates で先頭count個をランダム抽出
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return new Set(pool.slice(0, count));
}

export interface EventResult {
  events: ActiveEvent[];
  log: string[];
  fatigueIncrease: Record<AreaId, number>;
  transportPenalty: Partial<TransportState>;
  infraPenalty: Partial<InfraState>;
  // その日のエリア別 輸送容量倍率（1=通常）。軍民運航錯綜=半日停止(0.5)、交通混乱=一部通行不能 等（空海両方）
  capacityMultiplier: Record<AreaId, number>;
  // 海路だけに掛かる倍率（機雷=海上のみ半減。空路は影響しない）
  seaCapacityMultiplier: Record<AreaId, number>;
  // その日だけ使用不能になる空港(airportAvailのキー)。乗員ボイコット等で1空港のみ閉鎖(全空港停止ではない)
  facilityClosedToday: string[];
  newDead: number;
  hourlyRolls: HourlyRoll[];
  senkakuOccupied: boolean;
  // DMAT連動: 空港/海港/市街地集落攻撃による「そのエリアの死者発生」を、発生エリアごとに記録。
  // prepareDayPhase1 でDMAT残と突き合わせ、当該エリア疲労+1／(DMAT未派遣なら)追加死者+疲労+1を確定する。
  dmatDeathAreas: AreaId[];
  // 多良間/波照間の電力設備が当日破壊されたか（一時疲労の発火用）
  taramaPowerBrokenToday: boolean;
  haterumaPowerBrokenToday: boolean;
  // Section1: 撃墜/撃沈/運航拒否/施設破壊で「以後恒久停止」になる路線（prepareDayPhase1でstate.transportへ反映）
  disabledAirRoutes: Partial<Record<AirRouteKey, boolean>>;
  disabledShipRoutes: Partial<Record<ShipRouteKey, boolean>>;
  // 海保輸送船 撃沈による 1日便数-1（負値。coastGuardMaxPerDayへ加算し0未満にしない）
  coastGuardMaxDelta: number;
}

export function generateDailyEvents(state: GameState): EventResult {
  const result: EventResult = {
    events: [],
    log: [],
    fatigueIncrease: { yonaguni: 0, taketomi: 0, ishigaki: 0, miyako: 0 },
    transportPenalty: {},
    infraPenalty: {},
    capacityMultiplier: { yonaguni: 1, taketomi: 1, ishigaki: 1, miyako: 1 },
    seaCapacityMultiplier: { yonaguni: 1, taketomi: 1, ishigaki: 1, miyako: 1 },
    facilityClosedToday: [],
    newDead: 0,
    hourlyRolls: [],
    senkakuOccupied: false,
    dmatDeathAreas: [],
    taramaPowerBrokenToday: false,
    haterumaPowerBrokenToday: false,
    disabledAirRoutes: {},
    disabledShipRoutes: {},
    coastGuardMaxDelta: 0,
  };

  const { prepLevel, military, day } = state;

  // フェーズ(F1-F4)は日付で固定（事態モードとは無関係。マニュアル3.10/図13）。
  //   F1: roll1→A / F2: +roll2→B / F3: +roll3→C / F4: +roll4→D
  const actualPhase = eventPhase(day);

  // 毎日ランダムに6つのイベント判定マスを配置
  const eventSpaceHours = pickEventSpaceHours(6);

  // 24時間ループ（1時〜24時）
  for (let hour = 1; hour <= 24; hour++) {
    const roll = rollDie();
    const isEventSpace = eventSpaceHours.has(hour);

    let eventType: 'A' | 'B' | 'C' | 'D' | null = null;
    // eslint-disable-next-line no-useless-assignment
    let outcome = '';
    if (!isEventSpace) {
      // 非イベントスペース: ダイスを記録するが判定なし
      const timeLabel = hour <= 6 ? '深夜' : hour <= 12 ? '午前' : hour <= 18 ? '午後' : '夜間';
      outcome = `${timeLabel}業務 (出目${roll})`;
      result.hourlyRolls.push({ hour, roll, isEventSpace: false, eventType: null, outcome });
      continue;
    }

    // イベント判定ルール（フェーズによる条件）
    // 平時(1): 出目1 → Aイベント
    // 存立危機(2): 出目1 → A, 出目2 → B
    // 有事初期(3): 出目1 → A, 出目2 → B, 出目3 → C
    // 有事後期(4): 出目1 → A, 出目2 → B, 出目3 → C, 出目4 → D
    if (roll === 1) eventType = 'A';
    else if (actualPhase >= 2 && roll === 2) eventType = 'B';
    else if (actualPhase >= 3 && roll === 3) eventType = 'C';
    else if (actualPhase >= 4 && roll === 4) eventType = 'D';

    if (eventType === null) {
      outcome = `イベントなし (出目${roll} / 閾値${actualPhase})`;
      result.hourlyRolls.push({ hour, roll, isEventSpace: true, eventType: null, outcome });
      continue;
    }

    // イベント処理
    outcome = processEvent(eventType, state, result, prepLevel, military, day);
    result.hourlyRolls.push({ hour, roll, isEventSpace: true, eventType, outcome });
  }

  return result;
}

// ===== Section1: 撃墜/撃沈/運航拒否 共通判定 =====
// 計算値 = (3回ダイス合計) + (中国海軍+中国空軍) - (海自海空警護+空自空域警護)
// 確定条件: 尖閣占領なら計算値≧12、非占領なら≧15
function resolveInterdiction(military: MilitaryState): { calcValue: number; threshold: number; hit: boolean; diceSum: number } {
  const diceSum = sumDice(3);
  const chinaTotal = military.chineseSea + military.chineseAir;
  const jsdfTotal = military.jsdfSea + military.jsdfAir;
  const calcValue = diceSum + chinaTotal - jsdfTotal;
  const threshold = military.senkakuOccupied ? 12 : 15;
  return { calcValue, threshold, hit: calcValue >= threshold, diceSum };
}

// ===== Section1: 路線 ⇔ エリア / インフラキー 対応 =====
const AIR_ROUTE_AREA: Record<AirRouteKey, AreaId> = {
  shinIshigaki: 'ishigaki', miyako: 'miyako', shimoji: 'miyako', yonaguni: 'yonaguni', hateruma: 'taketomi',
};
const SHIP_ROUTE_AREA: Record<ShipRouteKey, AreaId> = {
  ishigakiPort: 'ishigaki', hiraraPort: 'miyako', kubura: 'yonaguni',
};
// airportAvail のキー（=空路キー）を getDayCapacities が参照する。ドローン/不時着等の「当日閉鎖」に使う。
const AIR_ROUTE_INFRA: Record<AirRouteKey, keyof InfraState> = {
  shinIshigaki: 'shinIshigakiAirport', miyako: 'miyakoAirport', shimoji: 'shimojiAirport',
  yonaguni: 'yonagunAirport', hateruma: 'haterumaAirport',
};
// 港インフラ（kubura=久部良港はInfraStateに無いため路線停止のみで表現）
const SHIP_ROUTE_INFRA: Partial<Record<ShipRouteKey, keyof InfraState>> = {
  ishigakiPort: 'ishigakiPort', hiraraPort: 'hiraraPort',
};

const AIR_ROUTE_JP: Record<AirRouteKey, string> = {
  shinIshigaki: '新石垣空港', miyako: '宮古空港', shimoji: '下地島空港', yonaguni: '与那国空港', hateruma: '波照間空港',
};
const SHIP_ROUTE_JP: Record<ShipRouteKey, string> = {
  ishigakiPort: '石垣港', hiraraPort: '平良港', kubura: '久部良港',
};

// ===== Section3: B/C イベントセル定義 =====
type EventCell =
  | { kind: 'none' }
  // 当日その空港の民間航空便を使用不可（ドローン障害物散布 / 不時着による一時閉鎖）。label指定時はログに使用
  | { kind: 'airClosedToday'; air: AirRouteKey; label?: string }
  // 当日そのエリアの避難便を使用不可（空港の無い島での不時着＝竹富島台湾軍機不時着 等）
  | { kind: 'areaClosedToday'; area: AreaId; label: string }
  // 当日その港の船舶便を使用不可（海上民兵海域接近）
  | { kind: 'shipClosedToday'; ship: ShipRouteKey }
  // その港の海路コマを半減（機雷敷設）
  | { kind: 'mine'; ship: ShipRouteKey }
  // その港の船舶便を半減（海域船舶臨検 / 軍民船舶運航錯綜）
  | { kind: 'shipHalf'; ship: ShipRouteKey }
  // その空港航空便を半減（軍民航空機運航錯綜）
  | { kind: 'airHalf'; air: AirRouteKey }
  // 航空便ミサイル攻撃: 撃墜判定→確定でその路線を撃墜(死者+全4疲労)＋以後使用不可
  | { kind: 'airMissileShootdown'; air: AirRouteKey }
  // 船舶便ミサイル攻撃: 撃沈判定→確定でその路線を撃沈(死者+全4疲労)＋以後使用不可
  | { kind: 'shipMissileSink'; air?: never; ship: ShipRouteKey }
  // ミサイル攻撃(空港/港): 施設破壊判定(≧17系)→破壊でその施設の民間便停止
  | { kind: 'airFacilityMissile'; air: AirRouteKey }
  | { kind: 'shipFacilityMissile'; ship: ShipRouteKey }
  // 電力設備ミサイル攻撃
  | { kind: 'power'; power: 'ishigaki' | 'miyako' | 'yonaguni' | 'tarama' | 'hateruma'; jp: string }
  // 橋ミサイル攻撃（避難不可化）
  | { kind: 'bridge'; infra: 'bridgeIrabu' | 'bridgeIkema' | 'bridgeKurima'; jp: string }
  // 運航拒否(空港便): 判定式≧15(尖閣≧12)→確定でその路線を今後使用不可
  | { kind: 'airRefusal'; air: AirRouteKey }
  // 運航拒否(船舶便)
  | { kind: 'shipRefusal'; ship: ShipRouteKey }
  // C行1-2: 輸送アセットへの攻撃（撃墜判定式）
  | { kind: 'attackCoastGuard' }      // 海保輸送船: 便数-1（全4疲労+1）
  | { kind: 'attackAsset'; jp: string }; // 海自輸送船/陸自ヘリ/空自輸送機: 死者+全4疲労+1

// B表: 1投目=列(1..6), 2投目=行(1..5)。B[row][col]（row/col は1始まり）。
const EVENT_B_TABLE: EventCell[][] = [
  // 行1
  [
    { kind: 'airClosedToday', air: 'yonaguni' },
    { kind: 'airClosedToday', air: 'shinIshigaki' },
    { kind: 'airClosedToday', air: 'shimoji' },
    { kind: 'airClosedToday', air: 'miyako' },
    { kind: 'shipClosedToday', ship: 'kubura' },       // 久部良港 海上民兵海域接近
    { kind: 'shipClosedToday', ship: 'ishigakiPort' }, // 石垣港 海上民兵海域接近
  ],
  // 行2
  [
    { kind: 'shipClosedToday', ship: 'hiraraPort' },   // 平良港 海上民兵海域接近
    { kind: 'mine', ship: 'kubura' },                  // 久部良港 機雷敷設
    { kind: 'mine', ship: 'ishigakiPort' },            // 石垣港 機雷敷設
    { kind: 'mine', ship: 'hiraraPort' },              // 平良港 機雷敷設
    { kind: 'shipHalf', ship: 'kubura' },              // 久部良港 海域船舶臨検
    { kind: 'shipHalf', ship: 'ishigakiPort' },        // 石垣港 海域船舶臨検
  ],
  // 行3
  [
    { kind: 'shipHalf', ship: 'hiraraPort' },          // 平良港 海域船舶臨検
    { kind: 'airHalf', air: 'yonaguni' },              // 与那国空港 軍民航空機運航錯綜
    { kind: 'airHalf', air: 'shinIshigaki' },
    { kind: 'airHalf', air: 'shimoji' },
    { kind: 'airHalf', air: 'miyako' },
    { kind: 'shipHalf', ship: 'kubura' },              // 久部良港 軍民船舶運航錯綜
  ],
  // 行4
  [
    { kind: 'shipHalf', ship: 'ishigakiPort' },        // 石垣港 軍民船舶運航錯綜
    { kind: 'shipHalf', ship: 'hiraraPort' },          // 平良港 軍民船舶運航錯綜
    { kind: 'airMissileShootdown', air: 'yonaguni' },  // 与那国空港 航空便ミサイル攻撃
    { kind: 'airMissileShootdown', air: 'shimoji' },   // 下地島空港 航空便ミサイル攻撃
    { kind: 'airFacilityMissile', air: 'miyako' },     // 宮古空港ミサイル攻撃(施設)
    { kind: 'shipFacilityMissile', ship: 'kubura' },   // 久部良港ミサイル攻撃(施設)
  ],
  // 行5
  [
    { kind: 'power', power: 'yonaguni', jp: '那覇国島(与那国)' }, // 那覇国島電力設備ミサイル攻撃
    { kind: 'airClosedToday', air: 'yonaguni' },       // 与那国空港 台湾封鎖不時着(当日閉鎖)
    { kind: 'airClosedToday', air: 'yonaguni' },       // 与那国空港 中国軍機不時着(当日閉鎖)
    { kind: 'airRefusal', air: 'yonaguni' },           // 与那国空港 航空便運航拒否
    { kind: 'shipRefusal', ship: 'kubura' },           // 久部良港 船舶便運航拒否
    { kind: 'none' },                                  // 空欄
  ],
];

// C表: 1投目=列(1..6), 2投目=行(1..6)。
const EVENT_C_TABLE: EventCell[][] = [
  // 行1
  [
    { kind: 'airMissileShootdown', air: 'shinIshigaki' }, // 新石垣空港 航空便に攻撃
    { kind: 'airMissileShootdown', air: 'shimoji' },      // 下地島空港 航空便に攻撃
    { kind: 'airMissileShootdown', air: 'miyako' },       // 宮古空港 航空便に攻撃
    { kind: 'shipMissileSink', ship: 'ishigakiPort' },    // 石垣港 船舶便に攻撃
    { kind: 'shipMissileSink', ship: 'hiraraPort' },      // 平良港 船舶便に攻撃
    { kind: 'attackCoastGuard' },                         // 海保輸送船に攻撃
  ],
  // 行2
  [
    { kind: 'attackAsset', jp: '空自輸送機' },
    { kind: 'attackAsset', jp: '海自輸送船' },
    { kind: 'attackAsset', jp: '陸自ヘリ' },
    { kind: 'airFacilityMissile', air: 'shinIshigaki' },  // 新石垣空港ミサイル攻撃(施設)
    { kind: 'airFacilityMissile', air: 'shimoji' },       // 下地島空港ミサイル攻撃(施設)
    { kind: 'airFacilityMissile', air: 'miyako' },        // 宮古空港ミサイル攻撃(施設)
  ],
  // 行3
  [
    { kind: 'shipFacilityMissile', ship: 'ishigakiPort' }, // 石垣港ミサイル攻撃(施設)
    { kind: 'shipFacilityMissile', ship: 'hiraraPort' },   // 平良港ミサイル攻撃(施設)
    { kind: 'power', power: 'miyako', jp: '宮古島' },
    { kind: 'power', power: 'hateruma', jp: '竹富島各島(波照間)' },
    { kind: 'power', power: 'miyako', jp: '宮古島' },
    { kind: 'power', power: 'miyako', jp: '宮古島' },
  ],
  // 行4
  [
    { kind: 'bridge', infra: 'bridgeIrabu', jp: '伊良部大橋' },
    { kind: 'bridge', infra: 'bridgeIkema', jp: '池間大橋' },
    { kind: 'bridge', infra: 'bridgeKurima', jp: '来間大橋' },
    { kind: 'areaClosedToday', area: 'taketomi', label: '竹富島 台湾軍機不時着' }, // 竹富島は空港なし→竹富の当日避難便停止
    { kind: 'airClosedToday', air: 'miyako', label: '宮古島 台湾軍機不時着(宮古空港 当日使用不可)' },
    { kind: 'airClosedToday', air: 'miyako', label: '宮古島 台湾軍機不時着(宮古空港 当日使用不可)' },
  ],
  // 行5
  [
    { kind: 'airClosedToday', air: 'shinIshigaki' }, // 新石垣空港 中国軍機不時着
    { kind: 'airClosedToday', air: 'shimoji' },       // 下地島空港 中国軍機不時着
    { kind: 'airClosedToday', air: 'miyako' },        // 宮古空港 不時着
    { kind: 'airRefusal', air: 'shinIshigaki' },      // 新石垣空港 航空便運航拒否
    { kind: 'airRefusal', air: 'shimoji' },           // 下地島空港 航空便運航拒否
    { kind: 'airRefusal', air: 'miyako' },            // 宮古空港 航空便運航拒否
  ],
  // 行6
  [
    { kind: 'shipRefusal', ship: 'ishigakiPort' },    // 石垣港 船舶便運航拒否
    { kind: 'shipRefusal', ship: 'hiraraPort' },      // 平良港 船舶便運航拒否
    { kind: 'none' }, { kind: 'none' }, { kind: 'none' }, { kind: 'none' },
  ],
];

// B/C 施設破壊判定（既存の施設破壊閾値17系: 4ダイス + 中 - (自+PAC3)）。
function resolveFacilityMissile(military: MilitaryState): { calcValue: number; threshold: number; hit: boolean } {
  const diceSum = sumDice(4);
  const chinaTotal = military.chineseSea + military.chineseAir;
  const jsdfTotal = military.jsdfSea + military.jsdfAir;
  const pac3 = military.pac3Ishigaki + military.pac3Miyako;
  const senkakuBonus = military.senkakuOccupied ? 3 : 0;
  const calcValue = diceSum + chinaTotal - (jsdfTotal + pac3) + senkakuBonus;
  return { calcValue, threshold: 17, hit: calcValue >= 17 };
}

// B/C セル1つを処理する（2ダイス表引きの結果）。
function processEventCell(
  cell: EventCell,
  tag: 'B' | 'C',
  colRow: string,
  result: EventResult,
  military: MilitaryState
): string {
  const areas = ['yonaguni', 'taketomi', 'ishigaki', 'miyako'] as AreaId[];
  const allAreasFatigue = (n: number) => areas.forEach(a => { result.fatigueIncrease[a] += n; });

  switch (cell.kind) {
    case 'none':
      return `[イベント${tag}|${colRow}] イベントなし`;

    case 'airClosedToday': {
      const jp = AIR_ROUTE_JP[cell.air];
      result.facilityClosedToday.push(cell.air);
      const desc = cell.label ?? `${jp} 民間航空便 当日使用不可`;
      result.log.push(`[イベント${tag}|${colRow}] 【${desc}】(ドローン/不時着等)`);
      return `【当日閉鎖】${cell.label ?? jp + ' 航空便'}`;
    }
    case 'areaClosedToday': {
      // 空港の無い島での不時着: 当該エリアの当日避難便(空路/海路)を0化
      result.capacityMultiplier[cell.area] *= 0;
      result.log.push(`[イベント${tag}|${colRow}] 【${cell.label} → ${cell.area} の当日避難便 使用不可】`);
      return `【当日停止】${cell.label}`;
    }
    case 'shipClosedToday': {
      const jp = SHIP_ROUTE_JP[cell.ship];
      const area = SHIP_ROUTE_AREA[cell.ship];
      result.seaCapacityMultiplier[area] *= 0; // 当日その港の船舶便を0に
      result.log.push(`[イベント${tag}|${colRow}] 【${jp} 海上民兵海域接近 → 当日の船舶便 使用不可】`);
      return `【当日閉鎖】${jp} 船舶便`;
    }
    case 'mine': {
      const jp = SHIP_ROUTE_JP[cell.ship];
      const area = SHIP_ROUTE_AREA[cell.ship];
      result.seaCapacityMultiplier[area] *= 0.5;
      result.log.push(`[イベント${tag}|${colRow}] 【機雷敷設の疑い】${jp}の航路 → 当日の海路コマ半減（要掃海・空路は影響なし）`);
      return `【機雷】${jp} 海路半減`;
    }
    case 'shipHalf': {
      const jp = SHIP_ROUTE_JP[cell.ship];
      const area = SHIP_ROUTE_AREA[cell.ship];
      result.seaCapacityMultiplier[area] *= 0.5;
      result.log.push(`[イベント${tag}|${colRow}] 【${jp} 船舶便 半減】(海域船舶臨検/軍民船舶運航錯綜)`);
      return `【半減】${jp} 船舶便`;
    }
    case 'airHalf': {
      const jp = AIR_ROUTE_JP[cell.air];
      const area = AIR_ROUTE_AREA[cell.air];
      result.capacityMultiplier[area] *= 0.5;
      result.log.push(`[イベント${tag}|${colRow}] 【${jp} 軍民航空機運航錯綜 → 航空便 半減】`);
      return `【半減】${jp} 航空便`;
    }
    case 'airMissileShootdown': {
      const jp = AIR_ROUTE_JP[cell.air];
      const r = resolveInterdiction(military);
      result.log.push(`[イベント${tag}|${colRow}] 【${jp} 航空便ミサイル攻撃(撃墜判定)】計${r.calcValue} / 閾値${r.threshold}`);
      if (r.hit) {
        result.disabledAirRoutes[cell.air] = true;
        result.newDead += 1;
        allAreasFatigue(1);
        result.log.push(`  ⚠️ 撃墜成立! ${jp}の航空便を以後使用不可・死者1コマ・全4エリア疲労+1`);
        return `【撃墜】${jp} 航空便 計${r.calcValue}≥${r.threshold}`;
      }
      return `【航空便攻撃】${jp} 計${r.calcValue}<${r.threshold} 回避`;
    }
    case 'shipMissileSink': {
      const jp = SHIP_ROUTE_JP[cell.ship];
      const r = resolveInterdiction(military);
      result.log.push(`[イベント${tag}|${colRow}] 【${jp} 船舶便ミサイル攻撃(撃沈判定)】計${r.calcValue} / 閾値${r.threshold}`);
      if (r.hit) {
        result.disabledShipRoutes[cell.ship] = true;
        result.newDead += 1;
        allAreasFatigue(1);
        result.log.push(`  ⚠️ 撃沈成立! ${jp}の船舶便を以後使用不可・死者1コマ・全4エリア疲労+1`);
        return `【撃沈】${jp} 船舶便 計${r.calcValue}≥${r.threshold}`;
      }
      return `【船舶便攻撃】${jp} 計${r.calcValue}<${r.threshold} 回避`;
    }
    case 'airFacilityMissile': {
      const jp = AIR_ROUTE_JP[cell.air];
      const r = resolveFacilityMissile(military);
      result.log.push(`[イベント${tag}|${colRow}] 【${jp} ミサイル攻撃(施設破壊判定)】計${r.calcValue} / 閾値${r.threshold}`);
      if (r.hit) {
        result.infraPenalty[AIR_ROUTE_INFRA[cell.air]] = false;
        result.log.push(`  ⚠️ 施設破壊! ${jp}の民間便を使用不可`);
        return `【施設破壊】${jp} 計${r.calcValue}≥${r.threshold}`;
      }
      return `【ミサイル攻撃】${jp} 計${r.calcValue}<${r.threshold} 耐えた`;
    }
    case 'shipFacilityMissile': {
      const jp = SHIP_ROUTE_JP[cell.ship];
      const r = resolveFacilityMissile(military);
      result.log.push(`[イベント${tag}|${colRow}] 【${jp} ミサイル攻撃(施設破壊判定)】計${r.calcValue} / 閾値${r.threshold}`);
      if (r.hit) {
        const infraKey = SHIP_ROUTE_INFRA[cell.ship];
        if (infraKey) result.infraPenalty[infraKey] = false;
        else result.disabledShipRoutes[cell.ship] = true; // 久部良港はInfra無 → 路線停止
        result.log.push(`  ⚠️ 施設破壊! ${jp}の民間便を使用不可`);
        return `【施設破壊】${jp} 計${r.calcValue}≥${r.threshold}`;
      }
      return `【ミサイル攻撃】${jp} 計${r.calcValue}<${r.threshold} 耐えた`;
    }
    case 'power': {
      const r = resolveFacilityMissile(military);
      result.log.push(`[イベント${tag}|${colRow}] 【${cell.jp} 電力設備ミサイル攻撃】計${r.calcValue} / 閾値${r.threshold}`);
      if (!r.hit) return `【電力攻撃】${cell.jp} 計${r.calcValue}<${r.threshold} 防護成功`;
      if (cell.power === 'tarama') {
        result.infraPenalty.powerTarama = false;
        result.taramaPowerBrokenToday = true;
        result.log.push(`  ⚠️ 発電所破壊! 多良間島が停電 → 多良間島疲労度を宮古・多良間へ加算(即時+1・翌日+1・最大2)。避難完了で解除`);
        return `【電力破壊】多良間島(一時疲労)`;
      }
      if (cell.power === 'hateruma') {
        result.infraPenalty.powerHateruma = false;
        result.haterumaPowerBrokenToday = true;
        result.log.push(`  ⚠️ 発電所破壊! 波照間島が停電 → 波照間島疲労度を竹富町各島へ加算(即時+1・翌日+1・最大2)。避難完了で解除`);
        return `【電力破壊】波照間島(一時疲労)`;
      }
      const powerInfra: Record<'ishigaki' | 'miyako' | 'yonaguni', keyof InfraState> = {
        ishigaki: 'powerIshigaki', miyako: 'powerMiyako', yonaguni: 'powerYonaguni',
      };
      const areaMap: Record<'ishigaki' | 'miyako' | 'yonaguni', AreaId> = {
        ishigaki: 'ishigaki', miyako: 'miyako', yonaguni: 'yonaguni',
      };
      result.infraPenalty[powerInfra[cell.power]] = false;
      result.fatigueIncrease[areaMap[cell.power]] += 1; // 即時+1
      result.log.push(`  ⚠️ 発電所破壊! ${cell.jp}が停電・断水 → 即時 疲労+1、以後毎日 疲労+1(夏季+2)`);
      return `【電力破壊】${cell.jp} 停電`;
    }
    case 'bridge': {
      const r = resolveFacilityMissile(military);
      result.log.push(`[イベント${tag}|${colRow}] 【${cell.jp} ミサイル攻撃(施設破壊判定)】計${r.calcValue} / 閾値${r.threshold}`);
      if (r.hit) {
        result.infraPenalty[cell.infra] = false;
        result.log.push(`  ⚠️ 橋破壊! ${cell.jp}が通行不能（避難不可化）`);
        return `【橋破壊】${cell.jp} 計${r.calcValue}≥${r.threshold}`;
      }
      return `【橋攻撃】${cell.jp} 計${r.calcValue}<${r.threshold} 耐えた`;
    }
    case 'airRefusal': {
      const jp = AIR_ROUTE_JP[cell.air];
      const r = resolveInterdiction(military);
      result.log.push(`[イベント${tag}|${colRow}] 【${jp} 航空便運航拒否(判定)】計${r.calcValue} / 閾値${r.threshold}`);
      if (r.hit) {
        result.disabledAirRoutes[cell.air] = true;
        result.log.push(`  ⚠️ 運航拒否確定! ${jp}の航空便を以後使用不可`);
        return `【運航拒否】${jp} 航空便 計${r.calcValue}≥${r.threshold}`;
      }
      return `【運航拒否判定】${jp} 航空便 計${r.calcValue}<${r.threshold} 継続`;
    }
    case 'shipRefusal': {
      const jp = SHIP_ROUTE_JP[cell.ship];
      const r = resolveInterdiction(military);
      result.log.push(`[イベント${tag}|${colRow}] 【${jp} 船舶便運航拒否(判定)】計${r.calcValue} / 閾値${r.threshold}`);
      if (r.hit) {
        result.disabledShipRoutes[cell.ship] = true;
        result.log.push(`  ⚠️ 運航拒否確定! ${jp}の船舶便を以後使用不可`);
        return `【運航拒否】${jp} 船舶便 計${r.calcValue}≥${r.threshold}`;
      }
      return `【運航拒否判定】${jp} 船舶便 計${r.calcValue}<${r.threshold} 継続`;
    }
    case 'attackCoastGuard': {
      const r = resolveInterdiction(military);
      result.log.push(`[イベント${tag}|${colRow}] 【海保輸送船に攻撃(撃沈判定)】計${r.calcValue} / 閾値${r.threshold}`);
      if (r.hit) {
        result.coastGuardMaxDelta -= 1;
        result.newDead += 1;
        allAreasFatigue(1);
        result.log.push(`  ⚠️ 撃沈成立! 海保輸送船の1日便数-1・死者1コマ・全4エリア疲労+1`);
        return `【海保撃沈】便数-1 計${r.calcValue}≥${r.threshold}`;
      }
      return `【海保攻撃】計${r.calcValue}<${r.threshold} 回避`;
    }
    case 'attackAsset': {
      const r = resolveInterdiction(military);
      result.log.push(`[イベント${tag}|${colRow}] 【${cell.jp}に攻撃(撃墜判定)】計${r.calcValue} / 閾値${r.threshold}`);
      if (r.hit) {
        result.newDead += 1;
        allAreasFatigue(1);
        result.log.push(`  ⚠️ 撃墜成立! ${cell.jp}被害・死者1コマ・全4エリア疲労+1（次便から継続使用可）`);
        return `【${cell.jp}被害】計${r.calcValue}≥${r.threshold}`;
      }
      return `【${cell.jp}攻撃】計${r.calcValue}<${r.threshold} 回避`;
    }
  }
}

function processEvent(
  eventType: 'A' | 'B' | 'C' | 'D',
  state: GameState,
  result: EventResult,
  prepLevel: number,
  military: MilitaryState,
  day: number
): string {
  // B/C は Section3 の 2ダイス表駆動（1投目=列, 2投目=行）
  if (eventType === 'B' || eventType === 'C') {
    const table = eventType === 'B' ? EVENT_B_TABLE : EVENT_C_TABLE;
    const col = rollDie(); // 1投目=列(1..6)
    const row = rollDie(); // 2投目=行(1..6)
    // B表は5行のみ（1投目6列×2投目5行）。行6はイベントなしとして扱う。C表は6行。
    const cell: EventCell = (table[row - 1]?.[col - 1]) ?? { kind: 'none' };
    return processEventCell(cell, eventType, `列${col}行${row}`, result, military);
  }

  const subRoll = rollDie();
  const areas = ['yonaguni', 'taketomi', 'ishigaki', 'miyako'] as AreaId[];
  const targetArea = areas[Math.floor(Math.random() * 4)];
  const areaName = state.areas[targetArea].name;

  if (eventType === 'A') {
    // イベントA: 社会的混乱系（6種類）
    // 出目1: パニック / 2: 交通混乱 / 3: 乗員ボイコット / 4: 避難拒否 / 5: 通信障害 / 6: 外国人乱闘
    if (subRoll === 1) {
      result.log.push(`[イベントA|出目${subRoll}] 【パニック発生】${areaName} — 住民が混乱し疲労+0.5`);
      result.fatigueIncrease[targetArea] += 0.5;
      result.events.push({
        id: `panic-${Date.now()}`, type: 'panic', location: targetArea,
        description: 'パニック', expiresDay: day, expiresHour: 24, penaltyActions: 1
      });
      return `【パニック】${areaName} 疲労+0.5`;
    } else if (subRoll === 2) {
      // 交通混乱: 一部の脱出ルートが通行不能になるだけ（疲労上昇なし）→ 当該エリアの輸送容量を一部減
      result.log.push(`[イベントA|出目${subRoll}] 【交通混乱】${areaName} — 脱出ルートの一部が通行不能（本日の輸送量30%減）`);
      result.capacityMultiplier[targetArea] *= 0.7;
      return `【交通混乱】${areaName} 一部通行不能`;
    } else if (subRoll === 3) {
      // 乗員ボイコット: ダイスで決めた1空港だけが本日24時まで使用不能（全空港停止ではない）。Lv5以上で未遂
      if (prepLevel >= 5) {
        result.log.push(`[イベントA|出目${subRoll}] 【乗員ボイコット未遂】Lv${prepLevel}≥5で回避`);
        return '【ボイコット未遂】Lv高で回避';
      }
      const apts = ['shinIshigaki', 'miyako', 'shimoji', 'yonaguni'];
      const apt = apts[Math.floor(Math.random() * apts.length)];
      const aptJp = { shinIshigaki: '新石垣空港', miyako: '宮古空港', shimoji: '下地島空港', yonaguni: '与那国空港' }[apt];
      result.facilityClosedToday.push(apt);
      result.log.push(`[イベントA|出目${subRoll}] 【乗員ボイコット】${aptJp}が本日24時まで使用不能（他空港は通常運用）`);
      return `【乗員ボイコット】${aptJp}停止`;
    } else if (subRoll === 4) {
      result.log.push(`[イベントA|出目${subRoll}] 【避難拒否】${areaName} — 説得に時間 疲労+0.5`);
      result.fatigueIncrease[targetArea] += 0.5;
      return `【避難拒否】${areaName} 疲労+0.5`;
    } else if (subRoll === 5) {
      result.log.push(`[イベントA|出目${subRoll}] 【通信障害】指揮系統が一時混乱 — 全エリア疲労+0.3`);
      areas.forEach(a => { result.fatigueIncrease[a] += 0.3; });
      return '【通信障害】全エリア疲労+0.3';
    } else {
      // 外国人観光客 大乱闘: ダイスで決めた1空港だけが本日24時まで使用不能（全空港停止ではない・疲労上昇なし）
      const apts = ['shinIshigaki', 'miyako', 'shimoji', 'yonaguni'];
      const apt = apts[Math.floor(Math.random() * apts.length)];
      const aptJp = { shinIshigaki: '新石垣空港', miyako: '宮古空港', shimoji: '下地島空港', yonaguni: '与那国空港' }[apt];
      result.facilityClosedToday.push(apt);
      result.log.push(`[イベントA|出目${subRoll}] 【外国人観光客大乱闘】${aptJp}で騒動 → 本日24時まで使用不能（他空港は通常運用）`);
      return `【観光客大乱闘】${aptJp}停止`;
    }
  }

  if (eventType === 'D') {
    // イベントD: 直接攻撃・占領
    const chinaTotal = military.chineseSea + military.chineseAir;
    const jsdfTotal = military.jsdfSea + military.jsdfAir;
    const pac3num = military.pac3Ishigaki + military.pac3Miyako;
    const senkakuBonus = military.senkakuOccupied ? 3 : 0;

    if (subRoll <= 2) {
      // 市街ミサイル攻撃 (3ダイス) — 計算式: 合計+中-自-PAC3×2-抗堪性×3
      const diceSum = sumDice(3);
      const calcValue = diceSum + chinaTotal - jsdfTotal - pac3num * 2 - 3 * state.shelterLevel + senkakuBonus;
      result.log.push(`[イベントD|出目${subRoll}] 【市街ミサイル攻撃】ダイス${diceSum}+中${chinaTotal}-自${jsdfTotal}-PAC3×${pac3num*2}-抗堪${state.shelterLevel*3}+尖${senkakuBonus}=計${calcValue}`);
      if (calcValue >= 11) {
        result.log.push('  ⚠️ 重大被害! 0.5コマ死亡');
        result.newDead += 0.5;
        // DMAT連動: 市街地集落攻撃の死者発生を当該エリアに記録（当該エリア疲労+1／DMAT未派遣なら追加死者+疲労）。
        // 仕様2026.7.6 Sec5: 疲労は「攻撃を受けた当該エリア」に付く（石垣/宮古への固定加算はしない）。
        result.dmatDeathAreas.push(targetArea);
        return `【市街攻撃・重大被害】計${calcValue}≥11 0.5コマ死亡`;
      } else if (calcValue >= 1) {
        result.fatigueIncrease[targetArea] += 0.5;
        return `【市街攻撃・軽微被害】計${calcValue} ${targetArea} 疲労+0.5`;
      }
      return `【市街攻撃】計${calcValue}≤0 被害なし`;
    } else if (subRoll <= 4) {
      // 島上陸・ヘリボーン (3ダイス) — 計算式: 合計+中-自+尖
      const diceSum = sumDice(3);
      const calcValue = diceSum + chinaTotal - jsdfTotal + senkakuBonus;
      const threshold = 15;
      result.log.push(`[イベントD|出目${subRoll}] 【上陸/ヘリボーン】ダイス${diceSum}+中${chinaTotal}-自${jsdfTotal}+尖${senkakuBonus}=計${calcValue} / 閾値${threshold}`);
      if (calcValue >= threshold) {
        result.log.push('  ⚠️ 上陸成立! 1コマ死亡 全エリア疲労+2');
        result.newDead += 1;
        areas.forEach(a => { result.fatigueIncrease[a] += 2; });
        return `【島上陸成立】計${calcValue}≥${threshold} 1コマ死亡`;
      }
      return `【上陸試み】計${calcValue}<${threshold} 撃退`;
    } else if (subRoll === 5) {
      // 自衛隊喪失 (2ダイス)
      const diceSum = sumDice(2);
      const calcValue = diceSum + chinaTotal - jsdfTotal + senkakuBonus;
      const threshold = 13;
      result.log.push(`[イベントD|出目${subRoll}] 【自衛隊喪失判定】ダイス${diceSum}+中${chinaTotal}-自${jsdfTotal}+尖${senkakuBonus}=計${calcValue} / 閾値${threshold}`);
      if (calcValue >= threshold) {
        result.log.push('  ⚠️ 自衛隊戦力-1');
        return `【自衛隊喪失】計${calcValue}≥${threshold}`;
      }
      return `【自衛隊喪失回避】計${calcValue}<${threshold}`;
    } else {
      // 尖閣諸島占領
      if (!military.senkakuOccupied) {
        const diceSum = sumDice(3);
        const calcValue = diceSum + chinaTotal - jsdfTotal;
        const threshold = 15;
        result.log.push(`[イベントD|出目${subRoll}] 【尖閣占領判定】ダイス${diceSum}+中${chinaTotal}-自${jsdfTotal}=計${calcValue} / 閾値${threshold}`);
        if (calcValue >= threshold) {
          result.log.push('  ⚠️ 尖閣諸島占領! 以後の計算値に不利補正+3');
          result.senkakuOccupied = true;
          return `【尖閣占領】計${calcValue}≥${threshold}`;
        }
        return `【尖閣占領回避】計${calcValue}<${threshold}`;
      }
      return '【尖閣】既に占領済み';
    }
  }

  return 'unknown';
}

// ===== 1日の輸送容量計算 =====
export function getDayCapacities(
  state: GameState,
  airportAvail: Record<string, boolean>,
  seaOk: boolean,
  capMul: Record<AreaId, number> = { yonaguni: 1, taketomi: 1, ishigaki: 1, miyako: 1 },
  seaMul: Record<AreaId, number> = { yonaguni: 1, taketomi: 1, ishigaki: 1, miyako: 1 }
): DayCapacities {
  const { prepLevel, transport, phase } = state;
  const settings = PREP_LEVEL_SETTINGS[prepLevel as keyof typeof PREP_LEVEL_SETTINGS];
  const isWartime = phase === 'wartime';
  const isCrisis = phase === 'crisis';
  // 後方互換フラグ。現在は路線別停止(disabledAirRoutes/disabledShipRoutes)を正とする。
  const civAirOk = !transport.civilianAirDisabled;
  const civShipOk = !transport.civilianShipDisabled;
  // Section1: 路線別の恒久停止（撃墜/撃沈/運航拒否/施設破壊）。該当路線の便を0にする。
  const airRouteOk = (r: AirRouteKey) => civAirOk && !transport.disabledAirRoutes[r];
  const shipRouteOk = (r: ShipRouteKey) => civShipOk && !transport.disabledShipRoutes[r];
  // マニュアル3.1: 平時は島外避難不可(全0)。存立危機は与那国・竹富のみ(石垣港入港はLv2以上)。有事は全可。
  // 石垣港が破壊されている場合は受け入れ不可。
  const ishigakiPortOpen = state.infra.ishigakiPort && (isWartime || (isCrisis && prepLevel >= 2));

  // 与那国空港→本土: 平時0 / 存立危機1便 / 有事は便数表
  const yonaguniAirMax = airportAvail.yonaguni && airRouteOk('yonaguni')
    ? (isWartime ? settings.airFlightsWartime.yonaguni : isCrisis ? 1 : 0)
    : 0;

  // 与那国→石垣フェリー(久部良港発): 石垣港が開いている時のみ(存立危機はLv2+、有事は常時)
  const yonaguniSeaMax = seaOk && ishigakiPortOpen && shipRouteOk('kubura') ? YONAGUNI_TO_ISHIGAKI_FERRY : 0;

  // 竹富→石垣フェリー: 同上(存立危機Lv2+ / 有事)。路線名指し無しのため路線別停止は適用しない。
  const taketomiFerryMax = seaOk && ishigakiPortOpen ? TAKETOMI_TO_ISHIGAKI_FERRY_MAX : 0;

  const ishigakiAirMax = isWartime && airportAvail.shinIshigaki && airRouteOk('shinIshigaki')
    ? settings.airFlightsWartime.shinIshigaki : 0;

  const ishigakiJasdfMax = isWartime && airportAvail.shinIshigaki ? transport.jasdfRemaining : 0;

  // 海保と海自は石垣/宮古で分け合う → 全体で使える分を表示
  const ishigakiCoastGuardMax = isWartime && seaOk ? Math.ceil(transport.coastGuardToday / 2) : 0;
  const ishigakiJmsdfMax = isWartime && seaOk && transport.jmsdfRemaining > 0 ? 1 : 0;
  const ishigakiFerryMax = isWartime && seaOk && shipRouteOk('ishigakiPort') && state.infra.ishigakiPort
    ? settings.mainPortCapacityPerTrip : 0;

  const miyakoAirMax = isWartime && airportAvail.miyako && airRouteOk('miyako')
    ? settings.airFlightsWartime.miyako : 0;
  const shimojAirMax = isWartime && airportAvail.shimoji && airRouteOk('shimoji')
    ? settings.airFlightsWartime.shimoji : 0;
  const miyakoCoastGuardMax = isWartime && seaOk ? Math.floor(transport.coastGuardToday / 2) : 0;
  const miyakoJmsdfMax = isWartime && seaOk && transport.jmsdfRemaining > 0 ? 1 : 0;
  const miyakoFerryMax = isWartime && seaOk && shipRouteOk('hiraraPort') && state.infra.hiraraPort
    ? settings.mainPortCapacityPerTrip : 0;

  // ===== Section2: 石垣島⇔宮古島 2島間往復(ピストン)輸送 の容量算定 =====
  // 発火: 有事 かつ Lv>=SHUTTLE_MIN_LEVEL かつ 片方ハブの本土向け民間空路が破壊/運航拒否で出せない。
  // 破壊された側ハブ(shuttleFrom)の住民を、機能している側ハブ(shuttleTo)へ集約 → 集約先の当日残本土便容量があれば当日、無ければ翌以降に本土へ。
  // ハブ空路が「本土便を出せない」= 空港破壊(airportAvail=false) or 路線停止(disabledAirRoutes)。
  const ishigakiHubDown = !(airportAvail.shinIshigaki && airRouteOk('shinIshigaki'));
  // 宮古ハブは宮古空港・下地島空港の2空港。両方とも本土便が出せない時に「ハブ機能喪失」とみなす。
  const miyakoHubDown =
    !(airportAvail.miyako && airRouteOk('miyako')) &&
    !(airportAvail.shimoji && airRouteOk('shimoji'));
  let shuttleActive = false;
  let shuttleFrom: AreaId | null = null;
  let shuttleTo: AreaId | null = null;
  // 両ハブ同時ダウンは中継先が無いので不可。片方だけダウン時に発火。
  if (isWartime && prepLevel >= SHUTTLE_MIN_LEVEL && ishigakiHubDown !== miyakoHubDown) {
    if (ishigakiHubDown) { shuttleFrom = 'ishigaki'; shuttleTo = 'miyako'; }
    else { shuttleFrom = 'miyako'; shuttleTo = 'ishigaki'; }
    shuttleActive = true;
  }
  // 港が使えるか（石垣港/平良港が破壊 or 船舶運航拒否なら 船舶手段は往復適用外）。送出側・集約先の両端で判定する。
  const portOk = (id: AreaId | null): boolean => {
    if (id === 'ishigaki') return state.infra.ishigakiPort && shipRouteOk('ishigakiPort');
    if (id === 'miyako') return state.infra.hiraraPort && shipRouteOk('hiraraPort');
    return false;
  };
  // ハブの民間空港が民間便を出せるか（空港infra破壊 or 路線運航拒否(disabledAirRoutes)なら不可）。
  // 空港施設が無事でも路線が運航拒否されていれば民間航空は使えない（仕様「空港破壊/運航拒否時は民間航空×」）。
  const civAirHubOk = (id: AreaId | null): boolean => {
    if (id === 'ishigaki') return airportAvail.shinIshigaki && airRouteOk('shinIshigaki');
    if (id === 'miyako')
      return (airportAvail.miyako && airRouteOk('miyako')) || (airportAvail.shimoji && airRouteOk('shimoji'));
    return false;
  };
  // 送出側ハブの空港施設が使えるか（空自輸送機=応急修理後の空港前提。軍用機は路線運航拒否の影響を受けない）。
  const fromAirfieldOk = (id: AreaId | null): boolean => {
    if (id === 'ishigaki') return airportAvail.shinIshigaki;
    if (id === 'miyako') return airportAvail.miyako || airportAvail.shimoji;
    return false;
  };
  // 送出側ハブが民間便で出せる基準便数（宮古発は宮古+（無事かつ路線可なら）下地島を加算）。
  const fromCivAirFlights = (id: AreaId | null): number => {
    if (id === 'ishigaki') return airportAvail.shinIshigaki && airRouteOk('shinIshigaki') ? settings.airFlightsWartime.shinIshigaki : 0;
    if (id === 'miyako') {
      let f = 0;
      if (airportAvail.miyako && airRouteOk('miyako')) f += settings.airFlightsWartime.miyako;
      if (airportAvail.shimoji && airRouteOk('shimoji')) f += settings.airFlightsWartime.shimoji;
      return f;
    }
    return 0;
  };
  const M = SHUTTLE_MULTIPLIER;
  // 海保/海自は船舶。仕様: 送出側・集約先の両端の港が使えることが条件（どちらか一方でも破壊/運航拒否なら往復適用外）。
  const shipUsable = shuttleActive && seaOk && portOk(shuttleFrom) && portOk(shuttleTo);
  const shuttleCoastGuardMax = shipUsable ? transport.coastGuardToday * M : 0;
  const shuttleJmsdfMax = shipUsable && transport.jmsdfRemaining > 0 ? 1 * M : 0;
  const shuttleJasdfMax = shuttleActive && fromAirfieldOk(shuttleFrom) ? transport.jasdfRemaining * M : 0;
  const shuttleJgsdfMax = shuttleActive ? transport.jgsdfRemaining * 1 : 0; // 陸自ヘリ 1便1コマ
  // 民間航空3倍: 集約先ハブと送出側ハブの双方が民間便を出せる（空港無事かつ路線運航拒否でない）時のみ。
  // 基準便数は「送出側ハブが出せる方向便数」を使う（宮古発なら宮古(+下地島)、石垣発なら新石垣）。
  const shuttleCivAirMax =
    shuttleActive && civAirOk && civAirHubOk(shuttleTo) && civAirHubOk(shuttleFrom)
      ? fromCivAirFlights(shuttleFrom) * M
      : 0;

  // イベント由来の容量倍率（軍民運航錯綜=0.5 / 交通混乱=0.7 等）をエリア別に適用。
  // 任意小数を避けるため 0.5 コマ単位へ丸める（通常日=倍率1では整数/0.5のまま無変化）。
  const r05 = (x: number) => Math.round(x * 2) / 2;
  const my = capMul.yonaguni, mt = capMul.taketomi, mi = capMul.ishigaki, mm = capMul.miyako;
  // 海路専用倍率(機雷など)。海路フィールドにのみ追加で掛ける。空路には掛けない。
  const sy = seaMul.yonaguni, st = seaMul.taketomi, si = seaMul.ishigaki, sm = seaMul.miyako;
  // ピストン輸送は送出側ハブ(shuttleFrom)のイベント倍率を適用する。
  const cmSF = shuttleFrom ? capMul[shuttleFrom] : 1;
  const smSF = shuttleFrom ? seaMul[shuttleFrom] : 1;
  return {
    yonaguniAirMax: r05(yonaguniAirMax * my), yonaguniSeaMax: r05(yonaguniSeaMax * my * sy),
    taketomiFerryMax: r05(taketomiFerryMax * mt * st),
    ishigakiAirMax: r05(ishigakiAirMax * mi), ishigakiJasdfMax: r05(ishigakiJasdfMax * mi),
    ishigakiCoastGuardMax: r05(ishigakiCoastGuardMax * mi * si), ishigakiJmsdfMax: r05(ishigakiJmsdfMax * mi * si),
    ishigakiFerryMax: r05(ishigakiFerryMax * mi * si),
    miyakoAirMax: r05(miyakoAirMax * mm), shimojAirMax: r05(shimojAirMax * mm),
    miyakoCoastGuardMax: r05(miyakoCoastGuardMax * mm * sm), miyakoJmsdfMax: r05(miyakoJmsdfMax * mm * sm),
    miyakoFerryMax: r05(miyakoFerryMax * mm * sm),
    seaOk, airportAvail, civilianAirOk: civAirOk, civilianShipOk: civShipOk,
    phase,
    prepLevel,
    jgsdfRemaining: transport.jgsdfRemaining,
    jmsdfRemaining: transport.jmsdfRemaining,
    shuttleActive, shuttleFrom, shuttleTo,
    // イベント由来の容量倍率(軍民運航錯綜=0.5/交通混乱等)を送出側ハブ(shuttleFrom)にも適用する。
    // 海路系(海保/海自)は海路倍率も併せて掛ける。0.5コマ丸めで小数の暴走を防ぐ。
    shuttleCoastGuardMax: r05(shuttleCoastGuardMax * cmSF * smSF),
    shuttleJmsdfMax: r05(shuttleJmsdfMax * cmSF * smSF),
    shuttleJasdfMax: r05(shuttleJasdfMax * cmSF),
    shuttleJgsdfMax: r05(shuttleJgsdfMax * cmSF),
    shuttleCivAirMax: r05(shuttleCivAirMax * cmSF),
  };
}

// ===== フェーズ1: 自動処理（イベント前半）=====
export function prepareDayPhase1(state: GameState): DayPhase1Result {
  const log: string[] = [];
  const { day, month } = state;
  const dayLabel = day === 0 ? 'X日' : day > 0 ? `X+${day}日` : `X${day}日`;
  log.push(`=== ${dayLabel} ===`);

  // 1. フェーズ移行
  const newPhase = checkPhaseTransition(state, log);
  const phaseChanged = newPhase !== state.phase;

  // 2. 地震
  checkEarthquake(state, log); // ログのみ、結果は phase2 で使う

  // 3. 天候更新 (1:00 & 13:00)
  let newWeather = updateWeather(state.weather, month, log, '1時');
  newWeather = updateWeather(newWeather, month, log, '13時');

  // 4. 空港・港の利用可否（大雨＝海路全停止+空港閉鎖 / 強風＝海路停止+風向次第で欠航。両者は独立）
  const airportAvail = checkAirportAvailability(newWeather, month, state.infra);
  const seaOk = isSeaAvailable(newWeather, month);

  const weatherSummary = buildWeatherSummary(newWeather, month, airportAvail, seaOk);
  log.push(`天候: ${weatherSummary}`);

  // 5. 軍事配置 (4:00)
  const newMilitary = updateMilitary({ ...state, phase: newPhase }, log);

  // 6. 24時間イベント
  const eventResult = generateDailyEvents({ ...state, phase: newPhase, military: newMilitary });
  log.push(...eventResult.log);

  // 7. 疲労度の上昇（マニュアル3.9）。回復はしない。
  const areasAfterEvents = JSON.parse(JSON.stringify(state.areas)) as Record<AreaId, AreaState>;
  // フェーズ(F)が1上昇する日(X=F2, X+3=F3, X+6=F4)は全エリア+1
  const fRose = eventPhase(day) > eventPhase(day - 1);
  // 発電所破壊で停電中のエリアは毎日1:00に+1(6〜10月の夏季は+2)。
  // 多良間(→宮古)・波照間(→竹富)は別途「一時疲労」ルールで扱うため、この持続停電加算からは除外する。
  const outageInc = (month >= 6 && month <= 10) ? 2 : 1;
  const powerOutage: Record<AreaId, boolean> = {
    yonaguni: !state.infra.powerYonaguni,
    taketomi: false,
    ishigaki: !state.infra.powerIshigaki,
    miyako: !state.infra.powerMiyako,
  };
  for (const id of Object.keys(areasAfterEvents) as AreaId[]) {
    areasAfterEvents[id].fatigue += eventResult.fatigueIncrease[id];
    if (fRose) areasAfterEvents[id].fatigue += 1;
    if (powerOutage[id]) areasAfterEvents[id].fatigue += outageInc;
  }
  if (fRose) log.push(`フェーズF${eventPhase(day)}に上昇 → 全エリア疲労+1`);

  // 7b. DMAT連動: 空港/海港/市街地集落攻撃による当該エリアの死者発生ごとに疲労+1。
  //     DMAT残>0なら1消費して追加死者を防ぐ。残0なら追加死者1コマ＋当該エリア疲労+1。
  let dmatRemaining = state.dmatRemaining;
  let dmatExtraDead = 0;
  for (const area of eventResult.dmatDeathAreas) {
    areasAfterEvents[area].fatigue += 1; // 死者発生 → 当該エリア疲労+1
    if (dmatRemaining > 0) {
      dmatRemaining -= 1;
      log.push(`DMAT派遣: ${state.areas[area].name}の死者に対応（残り${dmatRemaining}回）→ 追加被害を防止`);
    } else {
      dmatExtraDead += 1;
      areasAfterEvents[area].fatigue += 1; // 追加死者 → 当該エリア疲労+1
      log.push(`⚠️ DMAT未派遣: ${state.areas[area].name}で追加死者1コマ・疲労+1`);
    }
  }

  // 7c. 多良間島 一時疲労（電力破壊で宮古・多良間=miyakoエリアへ加算。即時+1・翌日1:00に+1・最大2。避難完了で戻す）
  let taramaPowerBroken = state.taramaPowerBroken || eventResult.taramaPowerBrokenToday;
  const taramaEvacDone = state.taramaEvacDone;
  let taramaTempFatigue = state.taramaTempFatigue;
  let taramaTempApplied = state.taramaTempApplied;
  if (taramaEvacDone) {
    taramaTempFatigue = 0; // 避難完了 → 目標0（適用分を戻す）
  } else if (eventResult.taramaPowerBrokenToday) {
    taramaTempFatigue = Math.min(2, taramaTempFatigue + 1); // 破壊当日: 即時+1
  } else if (taramaPowerBroken) {
    taramaTempFatigue = Math.min(2, taramaTempFatigue + 1); // 以後 毎日1:00に+1（最大2）
  }
  {
    const delta = taramaTempFatigue - taramaTempApplied; // 冪等: 適用済み量との差分だけを宮古へ反映
    if (delta !== 0) {
      areasAfterEvents.miyako.fatigue += delta;
      taramaTempApplied = taramaTempFatigue;
      if (delta > 0) log.push(`多良間島疲労度 +${delta} → 宮古島・多良間 疲労に加算（一時・計+${taramaTempApplied}）`);
      else log.push(`多良間→宮古 避難完了 → 一時疲労を解除（宮古島・多良間 疲労${delta}）`);
    }
  }
  if (taramaEvacDone) taramaPowerBroken = false;

  // 7d. 波照間島 一時疲労（電力破壊で竹富町各島=taketomiエリアへ加算。即時+1・翌日+1・最大2。避難完了で戻す）
  let haterumaPowerBroken = state.haterumaPowerBroken || eventResult.haterumaPowerBrokenToday;
  const haterumaEvacDone = state.haterumaEvacDone;
  let haterumaTempFatigue = state.haterumaTempFatigue;
  let haterumaTempApplied = state.haterumaTempApplied;
  if (haterumaEvacDone) {
    haterumaTempFatigue = 0;
  } else if (eventResult.haterumaPowerBrokenToday) {
    haterumaTempFatigue = Math.min(2, haterumaTempFatigue + 1);
  } else if (haterumaPowerBroken) {
    haterumaTempFatigue = Math.min(2, haterumaTempFatigue + 1);
  }
  {
    const delta = haterumaTempFatigue - haterumaTempApplied;
    if (delta !== 0) {
      areasAfterEvents.taketomi.fatigue += delta;
      haterumaTempApplied = haterumaTempFatigue;
      if (delta > 0) log.push(`波照間島疲労度 +${delta} → 竹富町各島 疲労に加算（一時・計+${haterumaTempApplied}）`);
      else log.push(`波照間→石垣 避難完了 → 一時疲労を解除（竹富町各島 疲労${delta}）`);
    }
  }
  if (haterumaEvacDone) haterumaPowerBroken = false;

  // 施設破壊などインフラ被害を反映（B1修正）し、被害後の空港利用可否を再計算
  const damagedInfra: InfraState = { ...state.infra, ...eventResult.infraPenalty };
  const airportAvailFinal = checkAirportAvailability(newWeather, month, damagedInfra);
  // 乗員ボイコット・観光客大乱闘で当日のみ閉鎖される空港を反映（その空港だけ／同日24時まで）
  for (const apt of eventResult.facilityClosedToday) {
    if (apt in airportAvailFinal) airportAvailFinal[apt] = false;
  }

  const stateAfterEvents: GameState = {
    ...state,
    phase: newPhase,
    weather: newWeather,
    areas: areasAfterEvents,
    infra: damagedInfra,
    military: {
      ...newMilitary,
      senkakuOccupied: newMilitary.senkakuOccupied || eventResult.senkakuOccupied,
    },
    transport: {
      ...state.transport,
      civilianAirDisabled: state.transport.civilianAirDisabled || (eventResult.transportPenalty.civilianAirDisabled ?? false),
      civilianShipDisabled: state.transport.civilianShipDisabled || (eventResult.transportPenalty.civilianShipDisabled ?? false),
      // Section1: 路線別の恒久停止をマージ（撃墜/撃沈/運航拒否）
      disabledAirRoutes: { ...state.transport.disabledAirRoutes, ...eventResult.disabledAirRoutes },
      disabledShipRoutes: { ...state.transport.disabledShipRoutes, ...eventResult.disabledShipRoutes },
      // Section1: 海保輸送船 撃沈 → 1日便数-1（0未満にしない）。当日残・翌日リセット値の双方へ反映。
      coastGuardMaxPerDay: Math.max(0, state.transport.coastGuardMaxPerDay + eventResult.coastGuardMaxDelta),
      coastGuardToday: Math.max(0, state.transport.coastGuardToday + eventResult.coastGuardMaxDelta),
    },
    // DMAT残・一時疲労トラッカーを更新（冪等な戻し用に applied 量も保持）
    dmatRemaining,
    taramaTempFatigue, taramaTempApplied, taramaPowerBroken, taramaEvacDone,
    haterumaTempFatigue, haterumaTempApplied, haterumaPowerBroken, haterumaEvacDone,
  };

  // B2修正: 輸送停止フラグ・インフラ被害を反映した後で容量を計算する
  const capacities = getDayCapacities(stateAfterEvents, airportAvailFinal, seaOk, eventResult.capacityMultiplier, eventResult.seaCapacityMultiplier);

  return {
    stateAfterEvents,
    newPhase, newMilitary, newWeather,
    airportAvail: airportAvailFinal, seaOk, capacities,
    capacityMultiplier: eventResult.capacityMultiplier,
    hourlyRolls: eventResult.hourlyRolls,
    eventLog: log,
    weatherSummary, phaseChanged,
    dmatExtraDead,
    eventDead: eventResult.newDead, // 攻撃(市街0.5/撃沈1/上陸1)による死者。当日死者に加算する
  } as DayPhase1Result;
}

// ===== フェーズ2: プレイヤーの避難実行 =====
export function executeDayPhase2(
  originalState: GameState,
  phase1: DayPhase1Result,
  orders: EvacuationOrder[]
): { newState: GameState; log: DayLog } {
  const { stateAfterEvents, newPhase, newWeather, newMilitary, airportAvail, hourlyRolls, eventLog, weatherSummary, capacities } = phase1;
  const { day } = stateAfterEvents;
  const dayLabel = day === 0 ? 'X日' : day > 0 ? `X+${day}日` : `X${day}日`;

  const evacLog: string[] = [];
  const evacuations: EvacuationRecord[] = [];
  let evacuatedCount = 0;

  // 深コピー
  const areas = JSON.parse(JSON.stringify(stateAfterEvents.areas)) as Record<AreaId, AreaState>;
  const transport = { ...stateAfterEvents.transport };

  // --- 避難オーダー実行 ---
  for (const order of orders) {
    const area = areas[order.from];
    const total = order.residents + order.tourists + order.vulnerable;
    if (total <= 0) continue;

    // 要援護者は海路のみ
    const actualVuln = order.vulnerable;
    const actualRes = order.residents;
    const actualTour = order.tourists;

    // コマ数上限チェック
    const cappedVuln = Math.min(actualVuln, area.vulnerable);
    const cappedRes = Math.min(actualRes, area.residents);
    const cappedTour = Math.min(actualTour, area.tourists);
    const cappedTotal = cappedVuln + cappedRes + cappedTour;
    if (cappedTotal <= 0) continue;

    area.vulnerable -= cappedVuln;
    area.residents -= cappedRes;
    area.tourists -= cappedTour;

    const destLabel = order.to === 'mainland' ? '本土' : order.to === 'ishigaki' ? '石垣島' : '宮古島';
    if (order.to === 'ishigaki') {
      // 中継ハブ集約（西側フェリー流入 or 宮古→石垣ピストン）→ 石垣で待機し、当日残の本土便容量があれば当日、無ければ翌以降に本土へ。
      areas.ishigaki.stagingPort += cappedTotal;
    } else if (order.to === 'miyako') {
      // 石垣→宮古ピストン（新石垣空港破壊時）→ 宮古で待機し、当日残の本土便容量があれば当日、無ければ翌以降に本土へ。
      areas.miyako.stagingPort += cappedTotal;
    } else {
      evacuatedCount += cappedTotal;
    }

    evacuations.push({
      from: order.from,
      to: destLabel,
      count: cappedTotal,
      method: order.method,
      isVulnerable: cappedVuln > 0,
    });
    evacLog.push(`${order.method}: ${order.from === 'yonaguni' ? '与那国' : order.from === 'taketomi' ? '竹富町' : order.from === 'ishigaki' ? '石垣' : '宮古'} ${cappedTotal}コマ → ${destLabel}`);

    // 輸送アセット消費
    const M = SHUTTLE_MULTIPLIER;
    if (order.method === '海保輸送船') {
      transport.coastGuardToday = Math.max(0, transport.coastGuardToday - Math.ceil(cappedTotal));
    } else if (order.method === '海自輸送艦') {
      transport.jmsdfRemaining = Math.max(0, transport.jmsdfRemaining - 1);
    } else if (order.method === '空自輸送機') {
      transport.jasdfRemaining = Math.max(0, transport.jasdfRemaining - Math.ceil(cappedTotal));
    } else if (order.method === 'ピストン海保輸送船') {
      // 近距離3倍: 1便=3コマ。運んだコマ数を便数(=/3切上げ)に換算して消費。
      transport.coastGuardToday = Math.max(0, transport.coastGuardToday - Math.ceil(cappedTotal / M));
    } else if (order.method === 'ピストン海自輸送艦') {
      transport.jmsdfRemaining = Math.max(0, transport.jmsdfRemaining - Math.ceil(cappedTotal / M));
    } else if (order.method === 'ピストン空自輸送機') {
      transport.jasdfRemaining = Math.max(0, transport.jasdfRemaining - Math.ceil(cappedTotal / M));
    } else if (order.method === 'ピストン陸自ヘリ') {
      // 陸自ヘリ 1便1コマ（通常）。運んだコマ数=便数を消費。
      transport.jgsdfRemaining = Math.max(0, transport.jgsdfRemaining - Math.ceil(cappedTotal));
    }
    // ピストン民間航空 は民間便のため自衛隊アセットを消費しない。
  }

  // 石垣待機コマ → 本土 (石垣の民間空路 / 海路で自動輸送)
  // 有事の場合、石垣待機コマは自動的に輸送される
  if (newPhase === 'wartime') {
    const civAirOk = !transport.civilianAirDisabled;

    // 石垣空路（容量は phase1.capacities=倍率反映＋0.5丸め済を使用。同日ordersが使った空路分を差し引き二重使用を防止）
    if (airportAvail.shinIshigaki && civAirOk) {
      const usedByOrders = evacuations.filter(e => e.method === '新石垣空港(民間)').reduce((s, e) => s + e.count, 0);
      const airMax = Math.max(0, capacities.ishigakiAirMax - usedByOrders);
      // 残り容量で stagingPort(竹富/与那国からの流入コマ)を本土へ輸送
      const staging = Math.min(airMax, areas.ishigaki.stagingPort);
      if (staging > 0) {
        areas.ishigaki.stagingPort -= staging;
        evacuatedCount += staging;
        evacuations.push({ from: 'ishigaki', to: '本土', count: staging, method: '新石垣空港(港待機)', isVulnerable: false });
        evacLog.push(`新石垣空港: 待機${staging}コマ → 本土`);
      }
    }

    // 宮古待機コマ（同上。同日ordersが使った空路分を差し引く）
    if (airportAvail.miyako && civAirOk) {
      const usedByOrders = evacuations.filter(e => e.method === '宮古空港(民間)').reduce((s, e) => s + e.count, 0);
      const miyakoAirMax = Math.max(0, capacities.miyakoAirMax - usedByOrders);
      const staging = Math.min(miyakoAirMax, areas.miyako.stagingPort);
      if (staging > 0) {
        areas.miyako.stagingPort -= staging;
        evacuatedCount += staging;
        evacuations.push({ from: 'miyako', to: '本土', count: staging, method: '宮古空港(港待機)', isVulnerable: false });
        evacLog.push(`宮古空港: 待機${staging}コマ → 本土`);
      }
    }
  }

  fixNegatives(areas);

  // --- 一時疲労の解除（避難完了）を「その日のうちに」反映 ---
  // 多良間→宮古(=miyakoエリア)・波照間→石垣(竹富町各島=taketomiエリア)が無人になったら避難完了とみなし、
  // 加算済みの一時疲労(*Applied)を当該エリアから差し引く（冪等・疲労死判定より前に戻す）。
  const miyakoEmpty = areas.miyako.residents + areas.miyako.tourists + areas.miyako.vulnerable === 0;
  const taketomiEmpty = areas.taketomi.residents + areas.taketomi.tourists + areas.taketomi.vulnerable === 0;
  const taramaEvacDone = stateAfterEvents.taramaEvacDone || (stateAfterEvents.taramaPowerBroken && miyakoEmpty);
  const haterumaEvacDone = stateAfterEvents.haterumaEvacDone || (stateAfterEvents.haterumaPowerBroken && taketomiEmpty);
  let taramaTempApplied = stateAfterEvents.taramaTempApplied;
  let taramaTempFatigue = stateAfterEvents.taramaTempFatigue;
  let haterumaTempApplied = stateAfterEvents.haterumaTempApplied;
  let haterumaTempFatigue = stateAfterEvents.haterumaTempFatigue;
  if (taramaEvacDone && taramaTempApplied > 0) {
    areas.miyako.fatigue -= taramaTempApplied;
    evacLog.push(`多良間→宮古 避難完了 → 一時疲労 -${taramaTempApplied}(宮古島・多良間)`);
    taramaTempApplied = 0; taramaTempFatigue = 0;
  }
  if (haterumaEvacDone && haterumaTempApplied > 0) {
    areas.taketomi.fatigue -= haterumaTempApplied;
    evacLog.push(`波照間→石垣 避難完了 → 一時疲労 -${haterumaTempApplied}(竹富町各島)`);
    haterumaTempApplied = 0; haterumaTempFatigue = 0;
  }
  fixNegatives(areas);

  // --- 疲労死亡 ---
  let fatigueDead = 0;
  for (const area of Object.values(areas)) {
    // 島別テーブル handsByFatigue が正。手数=0＝避難行動不可＝疲労限界(死亡)。
    const effAct = handsByFatigue(area.id, area.fatigue);
    if (effAct <= 0 && (area.residents + area.tourists + area.vulnerable) > 0) {
      fatigueDead += 0.5;
    }
  }
  if (fatigueDead > 0) evacLog.push(`疲労限界: ${fatigueDead}コマ死亡`);

  // --- X+3日 竹富以西期限 ---
  let deadlineDeaths = 0;
  if (day === 3) {
    const remaining = areas.taketomi.residents + areas.taketomi.tourists + areas.taketomi.vulnerable +
      areas.yonaguni.residents + areas.yonaguni.tourists + areas.yonaguni.vulnerable;
    if (remaining > 0) {
      deadlineDeaths = Math.min(remaining, 2);
      evacLog.push(`⚠️ X+3日24時: 竹富以西 ${remaining}コマ未避難 → ${deadlineDeaths}コマ死亡・全エリア疲労+2`);
      // 死亡コマをエリア人口から除去（与那国→竹富の順）
      let toRemove = deadlineDeaths;
      for (const id of ['yonaguni', 'taketomi'] as AreaId[]) {
        if (toRemove <= 0) break;
        const areaTotal = areas[id].residents + areas[id].tourists + areas[id].vulnerable;
        const removed = Math.min(toRemove, areaTotal);
        // 住民→観光客→要援護者の順で除去
        let r = removed;
        const rRes = Math.min(r, areas[id].residents); areas[id].residents -= rRes; r -= rRes;
        const rTour = Math.min(r, areas[id].tourists); areas[id].tourists -= rTour; r -= rTour;
        const rVuln = Math.min(r, areas[id].vulnerable); areas[id].vulnerable -= rVuln;
        toRemove -= removed;
      }
      for (const id of Object.keys(areas) as AreaId[]) areas[id].fatigue += 2;
    }
  }

  // 輸送アセットリセット（翌日分）。海保便数はイベント後の(減便済み)coastGuardMaxPerDayでリセットする。
  const newTransport: TransportState = {
    ...transport,
    coastGuardToday: transport.coastGuardMaxPerDay,
  };

  // 当日死者 = 疲労限界死 + X+3期限死 + DMAT未派遣の追加死 + イベント攻撃死(市街/撃沈/上陸)
  const totalNewDead = fatigueDead + deadlineDeaths + phase1.dmatExtraDead + phase1.eventDead;
  const newEvacuated = originalState.evacuated + evacuatedCount;
  const newDead = originalState.dead + totalNewDead;
  const newDay = day + 1;
  const isComplete = newDay > 8;

  const areaSnapshots = Object.fromEntries(
    Object.entries(areas).map(([id, a]) => [id, {
      total: a.residents + a.tourists + a.vulnerable + a.stagingPort,
      residents: a.residents,
      tourists: a.tourists,
      vulnerable: a.vulnerable,
      staging: a.stagingPort,
      fatigue: a.fatigue,
    }])
  ) as DayLog['areaSnapshots'];

  const dLog: DayLog = {
    day,
    dayLabel,
    phase: newPhase,
    weatherSummary,
    events: eventLog,
    evacuations,
    fatigueSummary: Object.values(areas).map((a) =>
      `${a.name}: 疲労${a.fatigue >= 0 ? '+' : ''}${a.fatigue.toFixed(1)} (手数${handsByFatigue(a.id, a.fatigue)})`
    ).join(' | '),
    totalEvacuatedSoFar: newEvacuated,
    totalDeadSoFar: newDead,
    areaSnapshots,
    hourlyRolls,
  };

  const newState: GameState = {
    ...stateAfterEvents,
    day: newDay,
    phase: newPhase,
    weather: newWeather,
    areas,
    military: newMilitary,
    transport: newTransport,
    evacuated: newEvacuated,
    dead: newDead,
    dayLogs: [...originalState.dayLogs, dLog],
    isComplete,
    earthquakeDay: originalState.earthquakeDay,
    earthquakeLevel: originalState.earthquakeLevel,
    // 避難完了フラグと、解除後の一時疲労トラッカーを引き継ぐ（翌日 prepareDayPhase1 は冪等な no-op になる）
    taramaEvacDone, haterumaEvacDone,
    taramaTempApplied, taramaTempFatigue,
    haterumaTempApplied, haterumaTempFatigue,
  };

  return { newState, log: dLog };
}

// ===== AI自動選択（autoplay用）=====
export function autoSelectOrders(phase1: DayPhase1Result): EvacuationOrder[] {
  const { stateAfterEvents: state, capacities, airportAvail } = phase1;
  const orders: EvacuationOrder[] = [];
  const areas = state.areas;
  const { transport } = state;
  const civAirOk = !transport.civilianAirDisabled;

  // 橋（池間・来間・伊良部）が落ちると、その離島住民は宮古本島へ渡れず移動不可＝孤立
  const lockedMiyako = (state.infra.bridgeIkema ? 0 : 1)
    + (state.infra.bridgeKurima ? 0 : 1)
    + (state.infra.bridgeIrabu ? 0 : 1);
  // 宮古の「避難可能な住民数」（孤立分を差し引く）
  const mRes = Math.max(0, areas.miyako.residents - lockedMiyako);

  const M = SHUTTLE_MULTIPLIER;
  // 海保/海自/空自は「石垣・宮古の本土便」と「ピストン便」で同一の実アセット(便)を共有する。
  // ピストンで消費した「便数」分を本土便プール(本土便は1便1コマ)から差し引き、二重使用・過剰削減の両方を防ぐ。
  let cgMainland = capacities.ishigakiCoastGuardMax + capacities.miyakoCoastGuardMax; // 海保 合計本土容量
  // 海自は石垣/宮古それぞれ1コマ表示になり得るが、実残隻数(jmsdfRemaining)を超えて同時に使えない。
  // 表示容量合算(=最大2)を実残隻数でクランプし、1隻を2コマに二重計上して過剰輸送するのを防ぐ。
  let jmsdfMainland = Math.min(capacities.ishigakiJmsdfMax + capacities.miyakoJmsdfMax, capacities.jmsdfRemaining);
  let jasdfMainland = capacities.ishigakiJasdfMax;                                      // 空自 (石垣のみ)

  // ===== Section2: 石垣島⇔宮古島 2島間往復(ピストン)輸送 =====
  // 片方ハブの本土空路が破壊/運航拒否の時、破壊された側ハブの住民を機能している側ハブへ集約する。
  // 本土避難ロジックより前に発火し、破壊された側ハブの人口を先に中継便へ積む（手分けは下流の本土便が担う）。
  if (capacities.shuttleActive && capacities.shuttleFrom && capacities.shuttleTo) {
    const fromId = capacities.shuttleFrom;
    // 中継先ハブは石垣/宮古のみ（getDayCapacities が保証）。EvacuationOrder.to へ渡すため型を絞る。
    const toDest = capacities.shuttleTo as 'ishigaki' | 'miyako';
    const fromArea = areas[fromId];
    // 送出可能な人数（宮古発は橋孤立分を差し引く）。要援護者は船舶手段を優先的に割り当てる。
    const availRes = fromId === 'miyako' ? mRes : fromArea.residents;
    let remainingVuln = fromArea.vulnerable;
    let remainingRes = availRes;
    let remainingTour = fromArea.tourists;
    // (method, 容量, 要援護者可否). 船舶(海保/海自)・空自輸送機は要援護者可。民間航空/陸自ヘリは住民・観光客。
    const legs: Array<{ method: string; cap: number; vulnOk: boolean }> = [
      { method: 'ピストン海保輸送船', cap: capacities.shuttleCoastGuardMax, vulnOk: true },
      { method: 'ピストン海自輸送艦', cap: capacities.shuttleJmsdfMax, vulnOk: true },
      { method: 'ピストン空自輸送機', cap: capacities.shuttleJasdfMax, vulnOk: true },
      { method: 'ピストン民間航空', cap: capacities.shuttleCivAirMax, vulnOk: false },
      { method: 'ピストン陸自ヘリ', cap: capacities.shuttleJgsdfMax, vulnOk: false },
    ];
    for (const leg of legs) {
      if (leg.cap <= 0) continue;
      let budget = leg.cap;
      const vuln = leg.vulnOk ? Math.min(remainingVuln, budget) : 0;
      budget -= vuln;
      const res = Math.min(remainingRes, budget);
      budget -= res;
      const tour = Math.min(remainingTour, budget);
      if (vuln + res + tour <= 0) continue;
      const moved = vuln + res + tour;
      remainingVuln -= vuln; remainingRes -= res; remainingTour -= tour;
      // ピストンで消費した「便数」を本土便プールから差し引く。3倍手段は moved コマで ceil(moved/M) 便を消費し、
      // その各便は本土便なら1便1コマなので、本土プールからは ceil(moved/M) コマ分を減らす（二重使用・過剰削減の防止）。
      if (leg.method === 'ピストン海保輸送船') cgMainland = Math.max(0, cgMainland - Math.ceil(moved / M));
      else if (leg.method === 'ピストン海自輸送艦') jmsdfMainland = Math.max(0, jmsdfMainland - Math.ceil(moved / M));
      else if (leg.method === 'ピストン空自輸送機') jasdfMainland = Math.max(0, jasdfMainland - Math.ceil(moved / M));
      // 陸自ヘリ(1倍: moved=便数)は本土プールを消費しない別枠。民間航空も本土海保/海自/空自プールを消費しない。
      orders.push({ from: fromId, to: toDest, method: leg.method, residents: res, tourists: tour, vulnerable: vuln });
    }
  }

  // ピストン消費後の本土便プールを、石垣/宮古の本土海保・海自・空自容量へ再配分する。
  // 元の分割比(石垣ceil/宮古floor)を保ったまま、共有プールの残量にクランプする。
  const cgIshigakiCap = Math.min(capacities.ishigakiCoastGuardMax, cgMainland);
  const cgMiyakoCap = Math.min(capacities.miyakoCoastGuardMax, Math.max(0, cgMainland - cgIshigakiCap));
  const jmsdfIshigakiCap = Math.min(capacities.ishigakiJmsdfMax, jmsdfMainland);
  const jmsdfMiyakoCap = Math.min(capacities.miyakoJmsdfMax, Math.max(0, jmsdfMainland - jmsdfIshigakiCap));
  const jasdfIshigakiCap = Math.min(capacities.ishigakiJasdfMax, jasdfMainland);

  // 与那国 → 本土(空路) ※存立危機・有事では直行便が使えるので住民・観光客を最優先で直送
  let yonaAirRes = 0;
  if (capacities.yonaguniAirMax > 0) {
    const total = Math.min(capacities.yonaguniAirMax, areas.yonaguni.residents + areas.yonaguni.tourists);
    if (total > 0) {
      const res = Math.min(areas.yonaguni.residents, total);
      const tour = Math.min(areas.yonaguni.tourists, total - res);
      yonaAirRes = res;
      orders.push({ from: 'yonaguni', to: 'mainland', method: '与那国空港(民間)', residents: res, tourists: tour, vulnerable: 0 });
    }
  }

  // 与那国 → 石垣(フェリー) ※航空不可の要援護者＋直行便に乗りきれなかった住民のみ（むやみに石垣へ送らない）
  if (capacities.yonaguniSeaMax > 0) {
    const vuln = Math.min(areas.yonaguni.vulnerable, capacities.yonaguniSeaMax);
    const remainRes = Math.max(0, areas.yonaguni.residents - yonaAirRes);
    const res = Math.min(remainRes, capacities.yonaguniSeaMax - vuln);
    if (vuln + res > 0) {
      orders.push({ from: 'yonaguni', to: 'ishigaki', method: 'フェリー', residents: res, tourists: 0, vulnerable: vuln });
    }
  }

  // 竹富 → 石垣(フェリー)
  if (capacities.taketomiFerryMax > 0) {
    const total = Math.min(capacities.taketomiFerryMax, areas.taketomi.residents + areas.taketomi.tourists);
    if (total > 0) {
      const res = Math.min(areas.taketomi.residents, total);
      const tour = Math.min(areas.taketomi.tourists, total - res);
      orders.push({ from: 'taketomi', to: 'ishigaki', method: '竹富→石垣フェリー', residents: res, tourists: tour, vulnerable: 0 });
    }
  }

  // 石垣 → 本土(空路) ※与那国・竹富からの待機コマ(stagingPort)を優先確保
  if (capacities.ishigakiAirMax > 0 && civAirOk && airportAvail.shinIshigaki) {
    const reservedForWest = areas.ishigaki.stagingPort; // 西側避難民を優先
    const ishigakiOwnAir = Math.max(0, capacities.ishigakiAirMax - reservedForWest);
    const total = Math.min(ishigakiOwnAir, areas.ishigaki.residents + areas.ishigaki.tourists);
    if (total > 0) {
      const res = Math.min(areas.ishigaki.residents, total);
      const tour = Math.min(areas.ishigaki.tourists, total - res);
      orders.push({ from: 'ishigaki', to: 'mainland', method: '新石垣空港(民間)', residents: res, tourists: tour, vulnerable: 0 });
    }
  }

  // 石垣 → 本土(海保) ※ピストン消費後の残プールを反映
  if (cgIshigakiCap > 0) {
    const vuln = Math.min(areas.ishigaki.vulnerable, cgIshigakiCap);
    const rest = cgIshigakiCap - vuln;
    const res = Math.min(areas.ishigaki.residents, rest);
    if (vuln + res > 0) {
      orders.push({ from: 'ishigaki', to: 'mainland', method: '海保輸送船', residents: res, tourists: 0, vulnerable: vuln });
    }
  }

  // 石垣 → 本土(空自輸送機) ※積極使用。要援護者(空路だが軍用機で搬送可)＋住民・観光客
  if (jasdfIshigakiCap > 0 && airportAvail.shinIshigaki) {
    const cap = jasdfIshigakiCap;
    const vuln = Math.min(areas.ishigaki.vulnerable, cap);
    const rest = cap - vuln;
    const res = Math.min(areas.ishigaki.residents, rest);
    const tour = Math.min(areas.ishigaki.tourists, rest - res);
    if (vuln + res + tour > 0) {
      orders.push({ from: 'ishigaki', to: 'mainland', method: '空自輸送機', residents: res, tourists: tour, vulnerable: vuln });
    }
  }

  // 石垣 → 本土(海自) ※ピストン消費後の残プールを反映
  if (jmsdfIshigakiCap > 0) {
    const cap = jmsdfIshigakiCap;
    const vuln = Math.min(areas.ishigaki.vulnerable, cap);
    const res = Math.min(areas.ishigaki.residents, cap - vuln);
    if (vuln + res > 0) {
      orders.push({ from: 'ishigaki', to: 'mainland', method: '海自輸送艦', residents: res, tourists: 0, vulnerable: vuln });
    }
  }

  // 石垣 → 本土(民間フェリー)
  if (capacities.ishigakiFerryMax > 0) {
    const vuln = Math.min(areas.ishigaki.vulnerable, capacities.ishigakiFerryMax);
    const res = Math.min(areas.ishigaki.residents, capacities.ishigakiFerryMax - vuln);
    if (vuln + res > 0) {
      orders.push({ from: 'ishigaki', to: 'mainland', method: '石垣港フェリー', residents: res, tourists: 0, vulnerable: vuln });
    }
  }

  // 宮古 → 本土(空路) ※橋崩落で孤立した住民(mRes)は移動不可
  if (capacities.miyakoAirMax > 0 && civAirOk && airportAvail.miyako) {
    const total = Math.min(capacities.miyakoAirMax, mRes + areas.miyako.tourists);
    if (total > 0) {
      const res = Math.min(mRes, total);
      const tour = Math.min(areas.miyako.tourists, total - res);
      orders.push({ from: 'miyako', to: 'mainland', method: '宮古空港(民間)', residents: res, tourists: tour, vulnerable: 0 });
    }
  }

  // 宮古 → 本土(下地島)
  if (capacities.shimojAirMax > 0 && civAirOk && airportAvail.shimoji) {
    const remaining = mRes + areas.miyako.tourists;
    const total = Math.min(capacities.shimojAirMax, remaining);
    if (total > 0) {
      const res = Math.min(mRes, total);
      const tour = Math.min(areas.miyako.tourists, total - res);
      orders.push({ from: 'miyako', to: 'mainland', method: '下地島空港(民間)', residents: res, tourists: tour, vulnerable: 0 });
    }
  }

  // 宮古 → 本土(海保) ※ピストン消費後の残プールを反映
  if (cgMiyakoCap > 0) {
    const vuln = Math.min(areas.miyako.vulnerable, cgMiyakoCap);
    const res = Math.min(mRes, cgMiyakoCap - vuln);
    if (vuln + res > 0) {
      orders.push({ from: 'miyako', to: 'mainland', method: '海保輸送船', residents: res, tourists: 0, vulnerable: vuln });
    }
  }

  // 宮古 → 本土(海自) ※ピストン消費後の残プールを反映
  if (jmsdfMiyakoCap > 0) {
    const cap = jmsdfMiyakoCap;
    const vuln = Math.min(areas.miyako.vulnerable, cap);
    const res = Math.min(mRes, cap - vuln);
    if (vuln + res > 0) {
      orders.push({ from: 'miyako', to: 'mainland', method: '海自輸送艦', residents: res, tourists: 0, vulnerable: vuln });
    }
  }

  // 宮古 → 本土(民間フェリー)
  if (capacities.miyakoFerryMax > 0) {
    const vuln = Math.min(areas.miyako.vulnerable, capacities.miyakoFerryMax);
    const res = Math.min(mRes, capacities.miyakoFerryMax - vuln);
    if (vuln + res > 0) {
      orders.push({ from: 'miyako', to: 'mainland', method: '平良港フェリー', residents: res, tourists: 0, vulnerable: vuln });
    }
  }

  return orders;
}

// ===== 後方互換ラッパー（autoplay用）=====
export function simulateDay(state: GameState): { newState: GameState; log: DayLog } {
  const phase1 = prepareDayPhase1(state);
  const orders = autoSelectOrders(phase1);
  return executeDayPhase2(state, phase1, orders);
}

// ===== 疲労・死亡チェック =====
export function updateFatigue(state: GameState, fatigueIncrease: Record<AreaId, number>): Record<AreaId, AreaState> {
  const areas = JSON.parse(JSON.stringify(state.areas)) as Record<AreaId, AreaState>;
  for (const areaId of Object.keys(areas) as AreaId[]) {
    areas[areaId].fatigue += fatigueIncrease[areaId];
  }
  return areas;
}

export function checkFatigueDeath(areas: Record<AreaId, AreaState>): number {
  let dead = 0;
  for (const area of Object.values(areas)) {
    // 島別テーブル handsByFatigue が正。手数=0＝疲労限界(死亡)。
    const effectiveActions = handsByFatigue(area.id, area.fatigue);
    if (effectiveActions <= 0 && (area.residents + area.tourists + area.vulnerable) > 0) {
      dead += 0.5;
    }
  }
  return dead;
}

// ===== ヘルパー =====
function fixNegatives(areas: Record<AreaId, AreaState>): void {
  for (const key of Object.keys(areas) as AreaId[]) {
    areas[key].residents = Math.max(0, areas[key].residents);
    areas[key].tourists = Math.max(0, areas[key].tourists);
    areas[key].vulnerable = Math.max(0, areas[key].vulnerable);
    areas[key].stagingPort = Math.max(0, areas[key].stagingPort);
    areas[key].stagingAirport = Math.max(0, areas[key].stagingAirport);
  }
}

function buildWeatherSummary(
  weather: WeatherState, month: number,
  airportAvail: Record<string, boolean>, seaOk: boolean
): string {
  const cond = weather.condition === 'sunny' ? '晴' :
    weather.condition === 'cloudy' ? '曇' :
    weather.condition === 'rain' ? '雨' : '大雨';
  const windLabel = ['西', '北西', '北東', '東', '南東', '南西'][weather.windDirectionIndex - 1];
  const speedLabel = isStrongWind(weather.windSpeedIndex, month) ? '強風' : '微風';
  const seaLabel = seaOk ? '海上◯' : '海上× (大雨/強風)';

  const closedAirports: string[] = [];
  if (!airportAvail.shinIshigaki) closedAirports.push('新石垣');
  if (!airportAvail.miyako) closedAirports.push('宮古');
  if (!airportAvail.shimoji) closedAirports.push('下地島');
  if (!airportAvail.yonaguni) closedAirports.push('与那国');
  const airLabel = closedAirports.length > 0 ? `閉鎖: ${closedAirports.join('/')}` : '全空港◯';

  return `${cond} / ${speedLabel}(${windLabel}) / ${seaLabel} / ${airLabel}`;
}
