// OKIRES2026 ゲームエンジン

import type {
  GameState, SetupConfig, AreaId, AreaState,
  WeatherState, MilitaryState, TransportState, InfraState,
  ActiveEvent, DayLog, EvacuationRecord, Phase,
  HourlyRoll, EvacuationOrder, DayCapacities, DayPhase1Result,
} from './types';
import {
  getWeatherTrack, getInitialWeatherIndex, getInitialWindSpeedIndex,
  getInitialWindDirectionIndex, isStrongWind, AIRPORT_ALLOWED_WIND_DIRECTIONS,
  PREP_LEVEL_SETTINGS, TAKETOMI_TO_ISHIGAKI_FERRY_MAX, YONAGUNI_TO_ISHIGAKI_FERRY,
  handsByFatigue, TOURIST_MAX_BY_AREA, VULNERABLE_TOTAL_MAX,
  TOURIST_BY_MONTH, RESIDENT_TOTAL_BY_AREA, PAC3_BY_LEVEL,
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

function processEvent(
  eventType: 'A' | 'B' | 'C' | 'D',
  state: GameState,
  result: EventResult,
  prepLevel: number,
  military: MilitaryState,
  day: number
): string {
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

  if (eventType === 'B') {
    // イベントB: ハイブリッド脅威（6種類）
    // 出目1-2: 滑走路障害 / 3-4: 海上民兵 / 5: 機雷敷設 / 6: 軍民混乱
    if (subRoll <= 2) {
      result.log.push(`[イベントB|出目${subRoll}] 【ドローン/障害物散布】空港滑走路に障害 啓開に手数消費 疲労+1`);
      result.fatigueIncrease.ishigaki += 1;
      return '【滑走路障害】石垣 疲労+1';
    } else if (subRoll <= 4) {
      result.log.push(`[イベントB|出目${subRoll}] 【海上民兵接近】漁船偽装の民兵が港湾周辺に — 石垣/宮古 疲労+0.5`);
      result.fatigueIncrease.ishigaki += 0.5;
      result.fatigueIncrease.miyako += 0.5;
      return '【海上民兵】石垣/宮古 疲労+0.5';
    } else if (subRoll === 5) {
      // 機雷敷設: 発生した港(航路)を明記。その港のあるエリアの海上輸送が当日大きく低下(疲労ではない)
      const mineSpots: { port: string; area: AreaId }[] = [
        { port: '平良港(宮古)', area: 'miyako' },
        { port: '石垣港(石垣)', area: 'ishigaki' },
        { port: '久部良港(与那国)', area: 'yonaguni' },
        { port: '大原港(竹富・西表)', area: 'taketomi' },
      ];
      const spot = mineSpots[Math.floor(Math.random() * mineSpots.length)];
      result.seaCapacityMultiplier[spot.area] *= 0.5; // 海路のみ半減（空路は影響なし）
      result.log.push(`[イベントB|出目${subRoll}] 【機雷敷設の疑い】${spot.port}の航路で機雷の脅威 → 当日の海上輸送のみ半減（空路は影響なし・要掃海）`);
      return `【機雷】${spot.port} 海路半減`;
    } else {
      // 軍民運航錯綜: 空港・海港が半日間 使用不能になるだけ（疲労上昇なし）→ 石垣/宮古の輸送容量を半減
      result.log.push(`[イベントB|出目${subRoll}] 【軍民運航錯綜】管制混乱で空港・海港が半日使用不能 — 石垣/宮古の本日の輸送量50%減`);
      result.capacityMultiplier.ishigaki *= 0.5;
      result.capacityMultiplier.miyako *= 0.5;
      return '【軍民運航錯綜】石垣/宮古 半日使用不能';
    }
  }

  if (eventType === 'C') {
    // イベントC: 軍事的エスカレーション（ミサイル等）
    // 計算式: サイコロ(3or4個)合計 + 中国軍計 - 自衛隊計 ± PAC3
    const chinaTotal = military.chineseSea + military.chineseAir;
    const jsdfTotal = military.jsdfSea + military.jsdfAir;
    const pac3 = military.pac3Ishigaki + military.pac3Miyako;
    const senkakuBonus = military.senkakuOccupied ? 3 : 0;

    if (subRoll <= 2) {
      // 輸送手段攻撃
      const diceSum = sumDice(3);
      const calcValue = diceSum + chinaTotal - jsdfTotal + senkakuBonus;
      const threshold = 15;
      result.log.push(`[イベントC|出目${subRoll}] 【輸送便攻撃】ダイス合計${diceSum}+中国軍${chinaTotal}-自衛隊${jsdfTotal}+尖閣${senkakuBonus}=計${calcValue} / 閾値${threshold}`);
      if (calcValue >= threshold) {
        result.log.push(`  ⚠️ 撃沈成立! 民間航空・船舶が使用不能化`);
        result.transportPenalty.civilianAirDisabled = true;
        result.transportPenalty.civilianShipDisabled = true;
        result.newDead += 1;
        areas.forEach(a => { result.fatigueIncrease[a] += 1; });
        return `【輸送便撃沈】計${calcValue}≥${threshold} 民間輸送壊滅+死亡1コマ`;
      }
      return `【輸送便攻撃】計${calcValue}<${threshold} 撃沈免れる`;
    } else if (subRoll <= 4) {
      // 施設ミサイル攻撃 (4ダイス)
      const diceSum = sumDice(4);
      const calcValue = diceSum + chinaTotal - (jsdfTotal + pac3) + senkakuBonus;
      const threshold = 17;
      const targets = ['石垣港', '平良港', '新石垣空港', '宮古空港', '池間大橋', '来間大橋', '伊良部大橋'];
      const target = targets[Math.floor(Math.random() * targets.length)];
      result.log.push(`[イベントC|出目${subRoll}] 【施設ミサイル攻撃 → ${target}】ダイス${diceSum}+中${chinaTotal}-自${jsdfTotal+pac3}+尖${senkakuBonus}=計${calcValue} / 閾値${threshold}`);
      if (calcValue >= threshold) {
        result.log.push(`  ⚠️ 施設破壊! ${target}が使用不能`);
        result.fatigueIncrease.ishigaki += 1.5;
        result.fatigueIncrease.miyako += 1.5;
        // 対象施設を実際に使用不能化（B1修正: ログと実挙動を一致させる）
        const FACILITY_INFRA: Record<string, keyof InfraState> = {
          '石垣港': 'ishigakiPort',
          '平良港': 'hiraraPort',
          '新石垣空港': 'shinIshigakiAirport',
          '宮古空港': 'miyakoAirport',
          '池間大橋': 'bridgeIkema',
          '来間大橋': 'bridgeKurima',
          '伊良部大橋': 'bridgeIrabu',
        };
        const infraKey = FACILITY_INFRA[target];
        if (infraKey) result.infraPenalty[infraKey] = false;
        return `【施設破壊】${target} 計${calcValue}≥${threshold}`;
      }
      return `【ミサイル攻撃】${target} 計${calcValue}<${threshold} 耐えた`;
    } else {
      // 電力設備攻撃 (4ダイス)
      const diceSum = sumDice(4);
      const calcValue = diceSum + chinaTotal - (jsdfTotal + pac3) + senkakuBonus;
      const threshold = 17;
      result.log.push(`[イベントC|出目${subRoll}] 【電力設備攻撃】ダイス${diceSum}+中${chinaTotal}-自${jsdfTotal+pac3}+尖${senkakuBonus}=計${calcValue} / 閾値${threshold}`);
      if (calcValue >= threshold) {
        // 発電所破壊→停電。発生エリアの発電所infraをfalse化。即時+1、以後毎日+1(夏季+2)はprepareDayPhase1で加算。
        // 多良間/波照間は「一時疲労」ルール（避難完了で戻す）を使うため kind='temp' で別扱い。
        const powerTargets: { key: keyof InfraState; area: AreaId | null; jp: string; kind: 'normal' | 'tarama' | 'hateruma' }[] = [
          { key: 'powerIshigaki', area: 'ishigaki', jp: '石垣島', kind: 'normal' },
          { key: 'powerMiyako', area: 'miyako', jp: '宮古島', kind: 'normal' },
          { key: 'powerYonaguni', area: 'yonaguni', jp: '与那国島', kind: 'normal' },
          { key: 'powerTarama', area: null, jp: '多良間島', kind: 'tarama' },
          { key: 'powerHateruma', area: null, jp: '波照間島', kind: 'hateruma' },
        ];
        const pt = powerTargets[Math.floor(Math.random() * powerTargets.length)];
        result.infraPenalty[pt.key] = false;
        if (pt.kind === 'tarama') {
          result.taramaPowerBrokenToday = true;
          result.log.push(`  ⚠️ 発電所破壊! 多良間島が停電 → 多良間島疲労度を宮古・多良間へ加算(即時+1・翌日+1・最大2)。多良間→宮古 避難完了で解除`);
          return `【電力破壊】多良間島 停電(一時疲労)`;
        }
        if (pt.kind === 'hateruma') {
          result.haterumaPowerBrokenToday = true;
          result.log.push(`  ⚠️ 発電所破壊! 波照間島が停電 → 波照間島疲労度を竹富町各島へ加算(即時+1・翌日+1・最大2)。波照間→石垣 避難完了で解除`);
          return `【電力破壊】波照間島 停電(一時疲労)`;
        }
        result.fatigueIncrease[pt.area!] += 1; // 即時+1
        result.log.push(`  ⚠️ 発電所破壊! ${pt.jp}が停電・断水 → 即時 疲労+1、以後毎日 疲労+1(夏季+2)`);
        return `【電力破壊】${pt.jp} 停電(以後毎日疲労)`;
      }
      return `【電力攻撃】計${calcValue}<${threshold} 防護成功`;
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
  const civAirOk = !transport.civilianAirDisabled;
  const civShipOk = !transport.civilianShipDisabled;
  // マニュアル3.1: 平時は島外避難不可(全0)。存立危機は与那国・竹富のみ(石垣港入港はLv2以上)。有事は全可。
  // 石垣港が破壊されている場合は受け入れ不可。
  const ishigakiPortOpen = state.infra.ishigakiPort && (isWartime || (isCrisis && prepLevel >= 2));

  // 与那国空港→本土: 平時0 / 存立危機1便 / 有事は便数表
  const yonaguniAirMax = airportAvail.yonaguni && civAirOk
    ? (isWartime ? settings.airFlightsWartime.yonaguni : isCrisis ? 1 : 0)
    : 0;

  // 与那国→石垣フェリー: 石垣港が開いている時のみ(存立危機はLv2+、有事は常時)
  const yonaguniSeaMax = seaOk && ishigakiPortOpen ? YONAGUNI_TO_ISHIGAKI_FERRY : 0;

  // 竹富→石垣フェリー: 同上(存立危機Lv2+ / 有事)
  const taketomiFerryMax = seaOk && ishigakiPortOpen ? TAKETOMI_TO_ISHIGAKI_FERRY_MAX : 0;

  const ishigakiAirMax = isWartime && airportAvail.shinIshigaki && civAirOk
    ? settings.airFlightsWartime.shinIshigaki : 0;

  const ishigakiJasdfMax = isWartime && airportAvail.shinIshigaki ? transport.jasdfRemaining : 0;

  // 海保と海自は石垣/宮古で分け合う → 全体で使える分を表示
  const ishigakiCoastGuardMax = isWartime && seaOk ? Math.ceil(transport.coastGuardToday / 2) : 0;
  const ishigakiJmsdfMax = isWartime && seaOk && transport.jmsdfRemaining > 0 ? 1 : 0;
  const ishigakiFerryMax = isWartime && seaOk && civShipOk && state.infra.ishigakiPort
    ? settings.mainPortCapacityPerTrip : 0;

  const miyakoAirMax = isWartime && airportAvail.miyako && civAirOk
    ? settings.airFlightsWartime.miyako : 0;
  const shimojAirMax = isWartime && airportAvail.shimoji && civAirOk
    ? settings.airFlightsWartime.shimoji : 0;
  const miyakoCoastGuardMax = isWartime && seaOk ? Math.floor(transport.coastGuardToday / 2) : 0;
  const miyakoJmsdfMax = isWartime && seaOk && transport.jmsdfRemaining > 0 ? 1 : 0;
  const miyakoFerryMax = isWartime && seaOk && civShipOk && state.infra.hiraraPort
    ? settings.mainPortCapacityPerTrip : 0;

  // イベント由来の容量倍率（軍民運航錯綜=0.5 / 交通混乱=0.7 等）をエリア別に適用。
  // 任意小数を避けるため 0.5 コマ単位へ丸める（通常日=倍率1では整数/0.5のまま無変化）。
  const r05 = (x: number) => Math.round(x * 2) / 2;
  const my = capMul.yonaguni, mt = capMul.taketomi, mi = capMul.ishigaki, mm = capMul.miyako;
  // 海路専用倍率(機雷など)。海路フィールドにのみ追加で掛ける。空路には掛けない。
  const sy = seaMul.yonaguni, st = seaMul.taketomi, si = seaMul.ishigaki, sm = seaMul.miyako;
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

    const destLabel = order.to === 'mainland' ? '本土' : '石垣島';
    if (order.to === 'ishigaki') {
      areas.ishigaki.stagingPort += cappedTotal;
    } else {
      evacuatedCount += cappedTotal;
    }

    evacuations.push({
      from: order.from,
      to: order.to === 'mainland' ? '本土' : '石垣島',
      count: cappedTotal,
      method: order.method,
      isVulnerable: cappedVuln > 0,
    });
    evacLog.push(`${order.method}: ${order.from === 'yonaguni' ? '与那国' : order.from === 'taketomi' ? '竹富町' : order.from === 'ishigaki' ? '石垣' : '宮古'} ${cappedTotal}コマ → ${destLabel}`);

    // 輸送アセット消費
    if (order.method === '海保輸送船') {
      transport.coastGuardToday = Math.max(0, transport.coastGuardToday - Math.ceil(cappedTotal));
    } else if (order.method === '海自輸送艦') {
      transport.jmsdfRemaining = Math.max(0, transport.jmsdfRemaining - 1);
    } else if (order.method === '空自輸送機') {
      transport.jasdfRemaining = Math.max(0, transport.jasdfRemaining - Math.ceil(cappedTotal));
    }
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

  // 輸送アセットリセット（翌日分）
  const newTransport: TransportState = {
    ...transport,
    coastGuardToday: originalState.transport.coastGuardMaxPerDay,
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

  // 石垣 → 本土(海保)
  if (capacities.ishigakiCoastGuardMax > 0) {
    const vuln = Math.min(areas.ishigaki.vulnerable, capacities.ishigakiCoastGuardMax);
    const rest = capacities.ishigakiCoastGuardMax - vuln;
    const res = Math.min(areas.ishigaki.residents, rest);
    if (vuln + res > 0) {
      orders.push({ from: 'ishigaki', to: 'mainland', method: '海保輸送船', residents: res, tourists: 0, vulnerable: vuln });
    }
  }

  // 石垣 → 本土(空自輸送機) ※積極使用。要援護者(空路だが軍用機で搬送可)＋住民・観光客
  if (capacities.ishigakiJasdfMax > 0 && airportAvail.shinIshigaki) {
    const cap = capacities.ishigakiJasdfMax;
    const vuln = Math.min(areas.ishigaki.vulnerable, cap);
    const rest = cap - vuln;
    const res = Math.min(areas.ishigaki.residents, rest);
    const tour = Math.min(areas.ishigaki.tourists, rest - res);
    if (vuln + res + tour > 0) {
      orders.push({ from: 'ishigaki', to: 'mainland', method: '空自輸送機', residents: res, tourists: tour, vulnerable: vuln });
    }
  }

  // 石垣 → 本土(海自) ※容量倍率を反映（固定1ではなく容量上限を使用）
  if (capacities.ishigakiJmsdfMax > 0) {
    const cap = capacities.ishigakiJmsdfMax;
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

  // 宮古 → 本土(海保)
  if (capacities.miyakoCoastGuardMax > 0) {
    const vuln = Math.min(areas.miyako.vulnerable, capacities.miyakoCoastGuardMax);
    const res = Math.min(mRes, capacities.miyakoCoastGuardMax - vuln);
    if (vuln + res > 0) {
      orders.push({ from: 'miyako', to: 'mainland', method: '海保輸送船', residents: res, tourists: 0, vulnerable: vuln });
    }
  }

  // 宮古 → 本土(海自) ※容量倍率を反映（固定1ではなく容量上限を使用）
  if (capacities.miyakoJmsdfMax > 0) {
    const cap = capacities.miyakoJmsdfMax;
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
