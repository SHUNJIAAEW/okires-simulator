// OKIRES2026 ゲームエンジン

import type {
  GameState, SetupConfig, AreaId, AreaState,
  WeatherState, MilitaryState, TransportState,
  ActiveEvent, DayLog, EvacuationRecord, Phase,
  HourlyRoll, EvacuationOrder, DayCapacities, DayPhase1Result,
} from './types';
import {
  getWeatherTrack, getInitialWeatherIndex, getInitialWindSpeedIndex,
  getInitialWindDirectionIndex, isStrongWind, AIRPORT_ALLOWED_WIND_DIRECTIONS,
  PREP_LEVEL_SETTINGS, TAKETOMI_TO_ISHIGAKI_FERRY_MAX, YONAGUNI_TO_ISHIGAKI_FERRY,
  TOURIST_BY_MONTH, getEffectiveActions,
} from './constants';

// ===== サイコロ =====
export function rollDie(): number {
  return Math.floor(Math.random() * 6) + 1;
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
  const touristTotal = TOURIST_BY_MONTH[month];

  const areas: Record<AreaId, AreaState> = {
    yonaguni: {
      id: 'yonaguni', name: '与那国島',
      residents: 2, tourists: 0, vulnerable: config.vulnerableYonaguni,
      fatigue: -shelterLevel, baseActions: 2,
      stagingAirport: 0, stagingPort: 0, inTransitToHub: 0,
    },
    taketomi: {
      id: 'taketomi', name: '竹富町全島',
      residents: 15, tourists: Math.round(touristTotal * 0.15), vulnerable: config.vulnerableTaketomi,
      fatigue: -shelterLevel, baseActions: 2,
      stagingAirport: 0, stagingPort: 0, inTransitToHub: 0,
    },
    ishigaki: {
      id: 'ishigaki', name: '石垣島',
      residents: 43, tourists: Math.round(touristTotal * 0.5), vulnerable: config.vulnerableIshigaki,
      fatigue: -shelterLevel, baseActions: 4,
      stagingAirport: 0, stagingPort: 0, inTransitToHub: 0,
    },
    miyako: {
      id: 'miyako', name: '宮古島・多良間',
      residents: 49, tourists: Math.round(touristTotal * 0.35), vulnerable: config.vulnerableMiyako,
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
      pac3Ishigaki: false, pac3Miyako: false, senkakuOccupied: false,
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
  };
}

// ===== 天候更新 =====
export function updateWeather(weather: WeatherState, month: number, log: string[]): WeatherState {
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
  log.push(`天候変化ダイス: 天候${wRoll}→${condLabel} / 風速${wsRoll}→${speedLabel}(${windLabel}) / 風向${wdRoll}`);

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
    shimoji: airportOk('shimoji', infraState.shimojiAirport),
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
export function checkPhaseTransition(state: GameState, log: string[]): Phase {
  const { day, phase, prepLevel } = state;

  if (day === 0) {
    if (phase !== 'wartime') {
      log.push('X日: 政府が緊急対処事態を発令。有事モードに移行。全エリア24時間避難行動可能。');
    }
    return 'wartime';
  }

  if (day >= -3 && day <= -1) {
    const roll = rollDie();
    const effectiveLevel = Math.min(prepLevel, 5);
    const canAdvance = roll <= effectiveLevel;

    if (phase === 'peacetime' && canAdvance) {
      log.push(`フェーズ上昇: ダイス${roll} ≤ 事前準備Lv${prepLevel} → 存立危機事態に移行`);
      return 'crisis';
    } else if (phase === 'crisis' && canAdvance) {
      log.push(`フェーズ上昇: ダイス${roll} ≤ 事前準備Lv${prepLevel} → 有事に移行`);
      return 'wartime';
    } else {
      log.push(`フェーズ維持: ダイス${roll} > Lv${effectiveLevel} → ${phase === 'peacetime' ? '平時' : '存立危機事態'}継続`);
    }
  }

  return phase;
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

    if (prepLevel >= 3 && !mil.pac3Ishigaki) {
      const r = rollDie();
      if (r <= prepLevel) {
        mil.pac3Ishigaki = true;
        log.push(`PAC3配備: 石垣・竹富エリアに配備完了 (ダイス${r})`);
      }
    }
    if (prepLevel >= 3 && !mil.pac3Miyako) {
      const r = rollDie();
      if (r <= prepLevel) {
        mil.pac3Miyako = true;
        log.push(`PAC3配備: 宮古・下地島エリアに配備完了 (ダイス${r})`);
      }
    }
  }

  return mil;
}

// ===== 24時間イベントシステム =====
// イベントスペース時刻（各4時間毎、1日6回）
const EVENT_SPACE_HOURS = [2, 6, 10, 14, 18, 22];

export interface EventResult {
  events: ActiveEvent[];
  log: string[];
  fatigueIncrease: Record<AreaId, number>;
  transportPenalty: Partial<TransportState>;
  newDead: number;
  hourlyRolls: HourlyRoll[];
  senkakuOccupied: boolean;
}

export function generateDailyEvents(state: GameState): EventResult {
  const result: EventResult = {
    events: [],
    log: [],
    fatigueIncrease: { yonaguni: 0, taketomi: 0, ishigaki: 0, miyako: 0 },
    transportPenalty: {},
    newDead: 0,
    hourlyRolls: [],
    senkakuOccupied: false,
  };

  const { phase, prepLevel, military, day } = state;

  // フェーズ番号 (1=平時, 2=存立危機, 3=有事初期, 4=有事後期)
  const phaseNum = phase === 'peacetime' ? 1 : phase === 'crisis' ? 2 : 3 + Math.floor(Math.max(0, day) / 3);
  const actualPhase = Math.min(4, Math.max(1, phaseNum));

  // 24時間ループ
  for (let hour = 0; hour < 24; hour++) {
    const roll = rollDie();
    const isEventSpace = EVENT_SPACE_HOURS.includes(hour);

    let eventType: 'A' | 'B' | 'C' | 'D' | null = null;
    // eslint-disable-next-line no-useless-assignment
    let outcome = '';
    if (!isEventSpace) {
      // 非イベントスペース: ダイスを記録するが判定なし
      const timeLabel = hour < 6 ? '深夜' : hour < 12 ? '午前' : hour < 18 ? '午後' : '夜間';
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
      result.log.push(`[イベントA|出目${subRoll}] 【交通混乱】${areaName} — 脱出ルート渋滞 疲労+0.5`);
      result.fatigueIncrease[targetArea] += 0.5;
      return `【交通混乱】${areaName} 疲労+0.5`;
    } else if (subRoll === 3) {
      if (prepLevel < 5) {
        result.log.push(`[イベントA|出目${subRoll}] 【乗員ボイコット】民間空港・海港が本日停止 (Lv${prepLevel}<5)`);
        result.transportPenalty.civilianAirDisabled = true;
        return '【乗員ボイコット】民間輸送停止';
      }
      result.log.push(`[イベントA|出目${subRoll}] 【乗員ボイコット未遂】Lv${prepLevel}≥5で回避`);
      return '【ボイコット未遂】Lv高で回避';
    } else if (subRoll === 4) {
      result.log.push(`[イベントA|出目${subRoll}] 【避難拒否】${areaName} — 説得に時間 疲労+0.5`);
      result.fatigueIncrease[targetArea] += 0.5;
      return `【避難拒否】${areaName} 疲労+0.5`;
    } else if (subRoll === 5) {
      result.log.push(`[イベントA|出目${subRoll}] 【通信障害】指揮系統が一時混乱 — 全エリア疲労+0.3`);
      areas.forEach(a => { result.fatigueIncrease[a] += 0.3; });
      return '【通信障害】全エリア疲労+0.3';
    } else {
      result.log.push(`[イベントA|出目${subRoll}] 【外国人観光客混乱】空港・海港で騒動 石垣/宮古 疲労+0.5`);
      result.fatigueIncrease.ishigaki += 0.5;
      result.fatigueIncrease.miyako += 0.5;
      return '【外国人混乱】石垣/宮古 疲労+0.5';
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
      result.log.push(`[イベントB|出目${subRoll}] 【機雷敷設の疑い】海上輸送ルートへの脅威 宮古 疲労+1`);
      result.fatigueIncrease.miyako += 1;
      return '【機雷疑い】宮古 疲労+1';
    } else {
      result.log.push(`[イベントB|出目${subRoll}] 【軍民運航錯綜】空港・海港の管制が混乱 — 石垣/宮古 疲労+1`);
      result.fatigueIncrease.ishigaki += 1;
      result.fatigueIncrease.miyako += 1;
      return '【軍民混乱】石垣/宮古 疲労+1';
    }
  }

  if (eventType === 'C') {
    // イベントC: 軍事的エスカレーション（ミサイル等）
    // 計算式: サイコロ(3or4個)合計 + 中国軍計 - 自衛隊計 ± PAC3
    const chinaTotal = military.chineseSea + military.chineseAir;
    const jsdfTotal = military.jsdfSea + military.jsdfAir;
    const pac3 = (military.pac3Ishigaki ? 1 : 0) + (military.pac3Miyako ? 1 : 0);
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
      const targets = ['石垣港', '平良港', '新石垣空港', '宮古空港'];
      const target = targets[Math.floor(Math.random() * targets.length)];
      result.log.push(`[イベントC|出目${subRoll}] 【施設ミサイル攻撃 → ${target}】ダイス${diceSum}+中${chinaTotal}-自${jsdfTotal+pac3}+尖${senkakuBonus}=計${calcValue} / 閾値${threshold}`);
      if (calcValue >= threshold) {
        result.log.push(`  ⚠️ 施設破壊! ${target}が使用不能`);
        result.fatigueIncrease.ishigaki += 1.5;
        result.fatigueIncrease.miyako += 1.5;
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
        result.log.push('  ⚠️ 電力設備破壊! 停電・断水 石垣/宮古 疲労+2');
        result.fatigueIncrease.ishigaki += 2;
        result.fatigueIncrease.miyako += 2;
        return `【電力破壊】計${calcValue}≥${threshold} 石垣/宮古 疲労+2`;
      }
      return `【電力攻撃】計${calcValue}<${threshold} 防護成功`;
    }
  }

  if (eventType === 'D') {
    // イベントD: 直接攻撃・占領
    const chinaTotal = military.chineseSea + military.chineseAir;
    const jsdfTotal = military.jsdfSea + military.jsdfAir;
    const pac3num = (military.pac3Ishigaki ? 1 : 0) + (military.pac3Miyako ? 1 : 0);
    const senkakuBonus = military.senkakuOccupied ? 3 : 0;

    if (subRoll <= 2) {
      // 市街ミサイル攻撃 (3ダイス) — 計算式: 合計+中-自-PAC3×2-抗堪性×3
      const diceSum = sumDice(3);
      const calcValue = diceSum + chinaTotal - jsdfTotal - pac3num * 2 - 3 * state.shelterLevel + senkakuBonus;
      result.log.push(`[イベントD|出目${subRoll}] 【市街ミサイル攻撃】ダイス${diceSum}+中${chinaTotal}-自${jsdfTotal}-PAC3×${pac3num*2}-抗堪${state.shelterLevel*3}+尖${senkakuBonus}=計${calcValue}`);
      if (calcValue >= 11) {
        result.log.push('  ⚠️ 重大被害! 0.5コマ死亡');
        result.newDead += 0.5;
        result.fatigueIncrease.ishigaki += 1;
        result.fatigueIncrease.miyako += 1;
        return `【市街攻撃・重大被害】計${calcValue}≥11 0.5コマ死亡`;
      } else if (calcValue >= 1) {
        result.fatigueIncrease.ishigaki += 0.5;
        result.fatigueIncrease.miyako += 0.5;
        return `【市街攻撃・軽微被害】計${calcValue} 疲労+0.5`;
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
  seaOk: boolean
): DayCapacities {
  const { prepLevel, transport, phase } = state;
  const settings = PREP_LEVEL_SETTINGS[prepLevel as keyof typeof PREP_LEVEL_SETTINGS];
  const isWartime = phase === 'wartime';
  const isCrisisOrMore = phase === 'crisis' || isWartime;
  const civAirOk = !transport.civilianAirDisabled;
  const civShipOk = !transport.civilianShipDisabled;

  const yonaguniAirMax = airportAvail.yonaguni && civAirOk
    ? (isCrisisOrMore
      ? (isWartime ? settings.airFlightsWartime.yonaguni : (prepLevel >= 6 ? 3 : 2))
      : 1)
    : 0;

  const yonaguniSeaMax = seaOk && isCrisisOrMore ? YONAGUNI_TO_ISHIGAKI_FERRY : 0;

  const taketomiFerryMax = seaOk && isCrisisOrMore ? TAKETOMI_TO_ISHIGAKI_FERRY_MAX : 0;

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

  return {
    yonaguniAirMax, yonaguniSeaMax,
    taketomiFerryMax,
    ishigakiAirMax, ishigakiJasdfMax, ishigakiCoastGuardMax, ishigakiJmsdfMax, ishigakiFerryMax,
    miyakoAirMax, shimojAirMax, miyakoCoastGuardMax, miyakoJmsdfMax, miyakoFerryMax,
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
  let newWeather = updateWeather(state.weather, month, log);
  newWeather = updateWeather(newWeather, month, log);

  // 4. 空港・港の利用可否
  const airportAvail = checkAirportAvailability(newWeather, month, state.infra);
  const seaOk = isSeaAvailable(newWeather, month);

  const weatherSummary = buildWeatherSummary(newWeather, month, airportAvail, seaOk);
  log.push(`天候: ${weatherSummary}`);

  // 5. 軍事配置 (4:00)
  const newMilitary = updateMilitary({ ...state, phase: newPhase }, log);

  // 6. 24時間イベント
  const eventResult = generateDailyEvents({ ...state, phase: newPhase, military: newMilitary });
  log.push(...eventResult.log);

  // 7. フェーズ変化による疲労
  const areasAfterEvents = JSON.parse(JSON.stringify(state.areas)) as Record<AreaId, AreaState>;
  for (const id of Object.keys(areasAfterEvents) as AreaId[]) {
    areasAfterEvents[id].fatigue += eventResult.fatigueIncrease[id];
    if (phaseChanged) areasAfterEvents[id].fatigue += 1;
  }

  const stateAfterEvents: GameState = {
    ...state,
    phase: newPhase,
    weather: newWeather,
    areas: areasAfterEvents,
    military: {
      ...newMilitary,
      senkakuOccupied: newMilitary.senkakuOccupied || eventResult.senkakuOccupied,
    },
  };

  const capacities = getDayCapacities(stateAfterEvents, airportAvail, seaOk);

  return {
    stateAfterEvents: {
      ...stateAfterEvents,
      transport: {
        ...stateAfterEvents.transport,
        civilianAirDisabled: state.transport.civilianAirDisabled || (eventResult.transportPenalty.civilianAirDisabled ?? false),
        civilianShipDisabled: state.transport.civilianShipDisabled || (eventResult.transportPenalty.civilianShipDisabled ?? false),
      },
    },
    newPhase, newMilitary, newWeather,
    airportAvail, seaOk, capacities,
    hourlyRolls: eventResult.hourlyRolls,
    eventLog: log,
    weatherSummary, phaseChanged,
  } as DayPhase1Result;
}

// ===== フェーズ2: プレイヤーの避難実行 =====
export function executeDayPhase2(
  originalState: GameState,
  phase1: DayPhase1Result,
  orders: EvacuationOrder[]
): { newState: GameState; log: DayLog } {
  const { stateAfterEvents, newPhase, newWeather, newMilitary, airportAvail, hourlyRolls, eventLog, weatherSummary } = phase1;
  const { day, prepLevel } = stateAfterEvents;
  const settings = PREP_LEVEL_SETTINGS[prepLevel as keyof typeof PREP_LEVEL_SETTINGS];
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

    // 石垣空路
    if (airportAvail.shinIshigaki && civAirOk) {
      const airMax = settings.airFlightsWartime.shinIshigaki;
      // 既にordersで石垣→本土を指定していたら空路分を合算するが、
      // stagingPortにある竹富/与那国からの流入コマを優先輸送
      const staging = Math.min(airMax, areas.ishigaki.stagingPort);
      if (staging > 0) {
        areas.ishigaki.stagingPort -= staging;
        evacuatedCount += staging;
        evacuations.push({ from: 'ishigaki', to: '本土', count: staging, method: '新石垣空港(港待機)', isVulnerable: false });
        evacLog.push(`新石垣空港: 待機${staging}コマ → 本土`);
      }
    }

    // 宮古待機コマ
    if (airportAvail.miyako && civAirOk) {
      const staging = Math.min(settings.airFlightsWartime.miyako, areas.miyako.stagingPort);
      if (staging > 0) {
        areas.miyako.stagingPort -= staging;
        evacuatedCount += staging;
        evacLog.push(`宮古空港: 待機${staging}コマ → 本土`);
      }
    }
  }

  fixNegatives(areas);

  // --- 疲労死亡 ---
  let fatigueDead = 0;
  for (const area of Object.values(areas)) {
    const effAct = getEffectiveActions(area.baseActions, area.fatigue);
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

  const totalNewDead = fatigueDead + deadlineDeaths;
  const newEvacuated = originalState.evacuated + evacuatedCount;
  const newDead = originalState.dead + totalNewDead;
  const newDay = day + 1;
  const isComplete = newDay > 8;

  const areaSnapshots = Object.fromEntries(
    Object.entries(areas).map(([id, a]) => [id, {
      total: a.residents + a.tourists + a.vulnerable + a.stagingPort,
      fatigue: a.fatigue,
    }])
  ) as Record<AreaId, { total: number; fatigue: number }>;

  const dLog: DayLog = {
    day,
    dayLabel,
    phase: newPhase,
    weatherSummary,
    events: eventLog,
    evacuations,
    fatigueSummary: Object.entries(areas).map(([, a]) =>
      `${a.name}: 疲労${a.fatigue >= 0 ? '+' : ''}${a.fatigue.toFixed(1)} (手数${getEffectiveActions(a.baseActions, a.fatigue)})`
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

  // 与那国 → 本土(空路)
  if (capacities.yonaguniAirMax > 0) {
    const total = Math.min(capacities.yonaguniAirMax, areas.yonaguni.residents + areas.yonaguni.tourists);
    if (total > 0) {
      const res = Math.min(areas.yonaguni.residents, total);
      const tour = Math.min(areas.yonaguni.tourists, total - res);
      orders.push({ from: 'yonaguni', to: 'mainland', method: '与那国空港(民間)', residents: res, tourists: tour, vulnerable: 0 });
    }
  }

  // 与那国 → 石垣(フェリー)
  if (capacities.yonaguniSeaMax > 0) {
    const vuln = Math.min(areas.yonaguni.vulnerable, capacities.yonaguniSeaMax);
    const res = Math.min(areas.yonaguni.residents, capacities.yonaguniSeaMax - vuln);
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

  // 石垣 → 本土(空路)
  if (capacities.ishigakiAirMax > 0 && civAirOk && airportAvail.shinIshigaki) {
    const total = Math.min(capacities.ishigakiAirMax, areas.ishigaki.residents + areas.ishigaki.tourists);
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

  // 石垣 → 本土(海自)
  if (capacities.ishigakiJmsdfMax > 0) {
    const vuln = Math.min(areas.ishigaki.vulnerable, 1);
    const res = Math.min(areas.ishigaki.residents, 1 - vuln);
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

  // 宮古 → 本土(空路)
  if (capacities.miyakoAirMax > 0 && civAirOk && airportAvail.miyako) {
    const total = Math.min(capacities.miyakoAirMax, areas.miyako.residents + areas.miyako.tourists);
    if (total > 0) {
      const res = Math.min(areas.miyako.residents, total);
      const tour = Math.min(areas.miyako.tourists, total - res);
      orders.push({ from: 'miyako', to: 'mainland', method: '宮古空港(民間)', residents: res, tourists: tour, vulnerable: 0 });
    }
  }

  // 宮古 → 本土(下地島)
  if (capacities.shimojAirMax > 0 && civAirOk && airportAvail.shimoji) {
    const remaining = areas.miyako.residents + areas.miyako.tourists;
    const total = Math.min(capacities.shimojAirMax, remaining);
    if (total > 0) {
      const res = Math.min(areas.miyako.residents, total);
      const tour = Math.min(areas.miyako.tourists, total - res);
      orders.push({ from: 'miyako', to: 'mainland', method: '下地島空港(民間)', residents: res, tourists: tour, vulnerable: 0 });
    }
  }

  // 宮古 → 本土(海保)
  if (capacities.miyakoCoastGuardMax > 0) {
    const vuln = Math.min(areas.miyako.vulnerable, capacities.miyakoCoastGuardMax);
    const res = Math.min(areas.miyako.residents, capacities.miyakoCoastGuardMax - vuln);
    if (vuln + res > 0) {
      orders.push({ from: 'miyako', to: 'mainland', method: '海保輸送船', residents: res, tourists: 0, vulnerable: vuln });
    }
  }

  // 宮古 → 本土(海自)
  if (capacities.miyakoJmsdfMax > 0) {
    const vuln = Math.min(areas.miyako.vulnerable, 1);
    const res = Math.min(areas.miyako.residents, 1 - vuln);
    if (vuln + res > 0) {
      orders.push({ from: 'miyako', to: 'mainland', method: '海自輸送艦', residents: res, tourists: 0, vulnerable: vuln });
    }
  }

  // 宮古 → 本土(民間フェリー)
  if (capacities.miyakoFerryMax > 0) {
    const vuln = Math.min(areas.miyako.vulnerable, capacities.miyakoFerryMax);
    const res = Math.min(areas.miyako.residents, capacities.miyakoFerryMax - vuln);
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
    const effectiveActions = getEffectiveActions(area.baseActions, area.fatigue);
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
