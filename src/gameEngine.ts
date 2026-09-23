// OKIRES2026 ゲームエンジン

import type {
  GameState, SetupConfig, AreaId, AreaState,
  WeatherState, MilitaryState, TransportState, InfraState,
  ActiveEvent, DayLog, EvacuationRecord, Phase,
  HourlyRoll, EvacuationOrder, DayCapacities, DayPhase1Result,
  AirRouteKey, ShipRouteKey, HandPenalty, ReinforcementMeans, WeatherCondition } from './types';
import {
  getWeatherTrack, getInitialWeatherIndex, getInitialWindSpeedIndex,
  getInitialWindDirectionIndex, isStrongWind, AIRPORT_ALLOWED_WIND_DIRECTIONS,
  PREP_LEVEL_SETTINGS, TAKETOMI_TO_ISHIGAKI_FERRY_MAX, YONAGUNI_TO_ISHIGAKI_FERRY,
  handsByFatigue, TOURIST_MAX_BY_AREA, VULNERABLE_TOTAL_MAX,
  TOURIST_BY_MONTH, RESIDENT_TOTAL_BY_AREA, PAC3_BY_LEVEL,
  SHUTTLE_MIN_LEVEL, SHUTTLE_MULTIPLIER,
  HATERUMA_AIR_FLIGHTS_BY_LEVEL, SEA_GUARD_MAX_BY_LEVEL, AIR_GUARD_MAX_BY_LEVEL,
  CRISIS_EVAC_MIN_LEVEL, REINFORCEMENT_MIN_LEVEL,
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
      stagingAirport: 0, stagingPort: 0, stagingVulnerable: 0, inTransitToHub: 0,
    },
    taketomi: {
      id: 'taketomi', name: '竹富町全島',
      residents: rt.taketomi - vulnerable.taketomi, tourists: tourists.taketomi, vulnerable: vulnerable.taketomi,
      fatigue: -shelterLevel, baseActions: 2,
      stagingAirport: 0, stagingPort: 0, stagingVulnerable: 0, inTransitToHub: 0,
    },
    ishigaki: {
      id: 'ishigaki', name: '石垣島',
      residents: rt.ishigaki - vulnerable.ishigaki, tourists: tourists.ishigaki, vulnerable: vulnerable.ishigaki,
      fatigue: -shelterLevel, baseActions: 4,
      stagingAirport: 0, stagingPort: 0, stagingVulnerable: 0, inTransitToHub: 0,
    },
    miyako: {
      id: 'miyako', name: '宮古島・多良間',
      residents: rt.miyako - vulnerable.miyako, tourists: tourists.miyako, vulnerable: vulnerable.miyako,
      fatigue: -shelterLevel, baseActions: 3,
      stagingAirport: 0, stagingPort: 0, stagingVulnerable: 0, inTransitToHub: 0,
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
      // 施設としては全Lvで健在。波照間空港の使用可否は Lv（HATERUMA_AIR_FLIGHTS_BY_LEVEL: Lv4以上）で制御し、
      // 多良間空港はマニュアル4.6.1でレベル制限なし。infra=false は「破壊」を意味するため Lv 不足をここで表さない。
      yonagunAirport: true, haterumaAirport: true,
      taramaAirport: true, ishigakiPort: true, hiraraPort: true, kuburaPort: true,
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
    // 自衛隊輸送臨時増援交渉（ver4.0 4.9）: 手段別の直近交渉記録。未交渉。
    reinforcement: { jgsdf: null, jmsdf: null, jasdf: null },
    // 不時着による一時手数ペナルティ（ver4.0 6.3.6）
    handPenalty: { yonaguni: [], taketomi: [], ishigaki: [], miyako: [] },
    // 占領状態（上陸・ヘリボーン成立で true）
    occupied: { yonaguni: false, taketomi: false, ishigaki: false, miyako: false },
    // PAC3 再配備（一度だけ）
    pac3Relocated: false,
    closedFacilitiesToday: [],
  };
}

// ===== PAC3 防護範囲（ver4.0 4.12）=====
// 石垣PAC3 = 石垣・西表・小浜・竹富・黒島（= ishigaki / taketomi エリア）
// 宮古PAC3 = 宮古・下地・伊良部・池間・来間（= miyako エリア）
// 多良間・与那国・波照間・鳩間は範囲外（与那国=0。多良間/波照間は各エリアの一部として近似）
// routeKey 指定時: 波照間空港(hateruma)は範囲外→0（多良間も範囲外だが専用路線キーは無い）。
// routeKey: 'hateruma'（波照間空港）や 'outside'（波照間/多良間の電力設備など防護範囲外の施設）は PAC3 を適用しない
export function pac3For(area: AreaId, military: MilitaryState, routeKey?: AirRouteKey | ShipRouteKey | 'outside'): number {
  if (routeKey === 'hateruma' || routeKey === 'outside') return 0;
  if (area === 'ishigaki' || area === 'taketomi') return military.pac3Ishigaki;
  if (area === 'miyako') return military.pac3Miyako;
  return 0;
}

// エリアが占領済みか（旧stateに occupied が無い場合も安全に false）
function isOccupied(state: GameState, area: AreaId): boolean {
  return !!state.occupied?.[area];
}

// ===== 不時着 手数ペナルティ（ver4.0 6.3.6）=====
// 指定日に有効なペナルティ数（同じ国は何機でも−1、中国＋台湾なら−2＝最大2）。旧stateに handPenalty が無ければ0。
export function activeHandPenalty(state: GameState, area: AreaId, day: number = state.day): number {
  return penaltyCount(state.handPenalty?.[area] ?? [], day);
}

// ペナルティ配列から指定日の有効手数減を数える（不時着=国数で最大2 ＋ 交渉1手消費=件数）
function penaltyCount(list: HandPenalty[], day: number): number {
  const active = list.filter(p => p.untilDay >= day);
  const countries = new Set(active.filter(p => p.country !== 'negotiation').map(p => p.country));
  const negotiations = active.filter(p => p.country === 'negotiation').length;
  return Math.min(2, countries.size) + negotiations;
}

// ===== 臨時増援交渉（ver4.0 4.9）共通処理 =====
// 有事・Lv3以上で、残回数0かつ当日未交渉の手段ごとにダイス1回（出目≤min(Lv,5)で成功→+1）。
// 交渉1回につき「任意エリアの1手」を消費: 残存の多い石垣/宮古（無ければ人のいるエリア）に handPenalty{negotiation, untilDay} を積む。
// when='beforeEvac'（1時〜避難前）は untilDay=当日、when='afterEvac'（避難実行後）は翌日の1手として untilDay=翌日。
function negotiateReinforcement(
  opts: {
    day: number; phase: Phase; prepLevel: number;
    remaining: Record<ReinforcementMeans, number>;
    areas: Record<AreaId, AreaState>;
    occupied: Record<AreaId, boolean>;
    reinforcement: GameState['reinforcement'];
    handPenalty: Record<AreaId, HandPenalty[]>;
    when: 'beforeEvac' | 'afterEvac';
  },
  log: string[]
): { gain: Record<ReinforcementMeans, number>; reinforcement: GameState['reinforcement']; handPenalty: Record<AreaId, HandPenalty[]> } {
  const gain: Record<ReinforcementMeans, number> = { jgsdf: 0, jmsdf: 0, jasdf: 0 };
  const reinforcement = { ...(opts.reinforcement ?? { jgsdf: null, jmsdf: null, jasdf: null }) };
  const handPenalty: Record<AreaId, HandPenalty[]> = {
    yonaguni: [...(opts.handPenalty?.yonaguni ?? [])], taketomi: [...(opts.handPenalty?.taketomi ?? [])],
    ishigaki: [...(opts.handPenalty?.ishigaki ?? [])], miyako: [...(opts.handPenalty?.miyako ?? [])],
  };
  if (opts.phase !== 'wartime' || opts.prepLevel < REINFORCEMENT_MIN_LEVEL) return { gain, reinforcement, handPenalty };
  const meansJp: Record<ReinforcementMeans, string> = { jgsdf: '陸自ヘリ', jmsdf: '海自輸送艦', jasdf: '空自輸送機' };
  const threshold = Math.min(opts.prepLevel, 5);
  const alive = (id: AreaId) => {
    const a = opts.areas[id];
    return opts.occupied[id] ? 0 : a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0);
  };
  const pickArea = (): AreaId | null => {
    const hubs = (['ishigaki', 'miyako'] as AreaId[]).filter(id => alive(id) > 0).sort((a, b) => alive(b) - alive(a));
    if (hubs.length) return hubs[0];
    const others = (['taketomi', 'yonaguni'] as AreaId[]).filter(id => alive(id) > 0).sort((a, b) => alive(b) - alive(a));
    return others[0] ?? null;
  };
  // マニュアル4.9 の根拠（Codex再検証で確認・維持）:
  //  - 避難前(1時〜)の交渉で得た+1は当日使用可（4.9「翌日以降に使用しても良い」＝当日使用も可）。
  //  - 1手消費は「対象の4エリアのいずれか任意の手数を1手」なので、石垣/宮古が無人なら竹富/与那国から消費してよい。
  const untilDay = opts.when === 'beforeEvac' ? opts.day : opts.day + 1;
  const timing = opts.when === 'beforeEvac' ? '' : '（避難実行後に残0）';
  for (const m of ['jgsdf', 'jmsdf', 'jasdf'] as ReinforcementMeans[]) {
    if (opts.remaining[m] > 0) continue;               // 使い切っていない（獲得分未消化を含む）
    if (reinforcement[m]?.day === opts.day) continue;  // 1日1回
    const roll = rollDie();
    const success = roll <= threshold;
    reinforcement[m] = { day: opts.day, roll, success };
    if (success) gain[m] = 1;
    const area = pickArea();
    let handJp = '（人のいるエリアなし・手消費なし）';
    if (area) {
      handPenalty[area].push({ country: 'negotiation', untilDay });
      handJp = `交渉に${opts.areas[area].name}の1手を消費${opts.when === 'afterEvac' ? '（翌日分）' : ''}`;
    }
    log.push(`自衛隊輸送臨時増援交渉（${meansJp[m]}）${timing}: 残0のため交渉・${handJp}。ダイス${roll}${success ? `≤${threshold} → 成功: ${meansJp[m]}+1コマ（使い切り${opts.when === 'afterEvac' ? '・翌日から使用可' : ''}）` : `>${threshold} → 失敗（翌日再交渉可）`}`);
  }
  return { gain, reinforcement, handPenalty };
}

// 不時着ペナルティ反映後の実効手数（UI/ログ表示用）。0未満にはしない。
export function effectiveHands(state: GameState, area: AreaId, fatigue?: number, day: number = state.day): number {
  const base = handsByFatigue(area, fatigue ?? state.areas[area].fatigue);
  return Math.max(0, base - activeHandPenalty(state, area, day));
}

// ===== イベント発生判定式①（ver4.0 6.5）=====
// サイバー攻撃・観光客大乱闘・ボイコット(A)、空港障害物/海上民兵/機雷/臨検/軍民錯綜(B)、不時着(B/C) は
// セルを引いた後にダイス1回: 1〜事前準備Lv(Lv6は5として計算) → 発生しない ／ Lv+1〜6 → 発生する。
function rollOccurrence(prepLevel: number, log: string[], label: string): boolean {
  const threshold = Math.min(prepLevel, 5);
  const die = rollDie();
  const occurs = die > threshold;
  log.push(`  判定式①(${label}): ダイス${die} / 事前準備Lv${prepLevel}${prepLevel >= 6 ? '(5として計算)' : ''} → ${occurs ? `${die}≥${threshold + 1} 発生` : `${die}≤${threshold} 発生せず`}`);
  return occurs;
}

// ===== 天候更新 =====
export function updateWeather(weather: WeatherState, month: number, log: string[], timeLabel?: string): WeatherState {
  const track = getWeatherTrack(month);
  const maxIdx = track.length;
  let { conditionIndex, windSpeedIndex, windDirectionIndex } = weather;
  const DIRS = ['西', '北西', '北東', '東', '南東', '南西'];
  const condJp = (c: WeatherCondition) => c === 'sunny' ? '晴' : c === 'cloudy' ? '曇' : c === 'rain' ? '雨' : '大雨';
  // 変化前のラベル（検証用ログ: 天候ダイス5 : 曇8⇒雨9 形式）
  const beforeCond = `${condJp(track[conditionIndex - 1])}${conditionIndex}`;
  const beforeSpeed = `${isStrongWind(windSpeedIndex, month) ? '強風' : '微風'}${windSpeedIndex}`;
  const beforeDir = `${DIRS[windDirectionIndex - 1]}${windDirectionIndex}`;

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
  const windLabel = DIRS[windDirectionIndex - 1];
  const speedLabel = strong ? '強風' : '微風';
  const condLabel = condJp(condition);
  const prefix = timeLabel ? `${timeLabel}：` : '';
  const pad = timeLabel ? '　　　' : '';
  log.push(`${prefix}天候ダイス${wRoll} : ${beforeCond}⇒${condLabel}${conditionIndex}`);
  log.push(`${pad}風速ダイス${wsRoll} : ${beforeSpeed}⇒${speedLabel}${windSpeedIndex}`);
  log.push(`${pad}風向ダイス${wdRoll} : ${beforeDir}⇒${windLabel}${windDirectionIndex}`);

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
export function eventPhase(day: number): number {
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

// ===== 地震の効果（ver4.0 4.10）=====
// 規模1〜6 → 津波高・破壊施設・行動停止時間・死者コマ・DMAT可否。人口除去は prepareDayPhase1 側（removeFromArea）で行う。
interface EarthquakeEffect {
  severity: number;
  tsunamiM: number;
  infra: Partial<InfraState>;        // 破壊施設（既破壊分は含めない）
  capMul: number;                    // 当日の全エリア容量倍率（行動停止時間の近似）
  nextDayCapMul: number;             // 翌日の全エリア容量倍率（規模5=0.5 / 規模6=0）
  deaths: number;                    // 死者コマ（人口比で分配）
  dmatAreas: AreaId[];               // DMAT派遣可能エリア（石垣/宮古）。空=派遣不可
  destroyedJp: string[];
}

const EQ_INFRA_JP: Partial<Record<keyof InfraState, string>> = {
  ishigakiPort: '石垣港', hiraraPort: '平良港', kuburaPort: '久部良港',
  shimojiAirport: '下地島空港', taramaAirport: '多良間空港', haterumaAirport: '波照間空港',
  yonagunAirport: '与那国空港', shinIshigakiAirport: '新石垣空港', miyakoAirport: '宮古空港',
  powerTarama: '多良間発電所', powerMiyako: '宮古島発電所', powerIshigaki: '石垣島発電所',
  powerHateruma: '波照間発電所', powerYonaguni: '与那国発電所',
};

export function resolveEarthquake(severity: number, infra: InfraState): EarthquakeEffect {
  const destroyKeys: (keyof InfraState)[] = [];
  if (severity >= 2) destroyKeys.push('ishigakiPort', 'hiraraPort', 'kuburaPort');
  if (severity >= 3) destroyKeys.push('shimojiAirport', 'taramaAirport', 'haterumaAirport', 'powerTarama', 'powerMiyako', 'powerIshigaki');
  if (severity >= 4) destroyKeys.push('yonagunAirport');
  if (severity >= 5) destroyKeys.push('shinIshigakiAirport');
  if (severity >= 6) destroyKeys.push('miyakoAirport', 'powerHateruma', 'powerYonaguni');
  const infraPatch: Partial<InfraState> = {};
  const destroyedJp: string[] = [];
  for (const k of destroyKeys) {
    if (infra[k] === false) continue; // 既破壊は無効
    (infraPatch as Record<string, boolean>)[k] = false;
    destroyedJp.push(EQ_INFRA_JP[k] ?? k);
  }
  const table: Record<number, { tsunamiM: number; stopH: number; deaths: number; dmat: AreaId[] }> = {
    1: { tsunamiM: 1, stopH: 3, deaths: 0, dmat: [] },
    2: { tsunamiM: 3, stopH: 6, deaths: 1, dmat: ['ishigaki', 'miyako'] },
    3: { tsunamiM: 15, stopH: 12, deaths: 2, dmat: ['ishigaki', 'miyako'] },
    4: { tsunamiM: 24, stopH: 24, deaths: 4, dmat: ['miyako'] },   // 石垣は病院水没で不可
    5: { tsunamiM: 32, stopH: 36, deaths: 8, dmat: [] },
    6: { tsunamiM: 42, stopH: 48, deaths: 12, dmat: [] },
  };
  const t = table[Math.min(6, Math.max(1, severity))];
  const capMul = Math.max(0, (24 - Math.min(24, t.stopH)) / 24);
  const nextDayCapMul = t.stopH <= 24 ? 1 : Math.max(0, (48 - t.stopH) / 24);
  return { severity, tsunamiM: t.tsunamiM, infra: infraPatch, capMul, nextDayCapMul, deaths: t.deaths, dmatAreas: t.dmat, destroyedJp };
}

// 死者 n コマを「人のいるエリア」へ人口比で分配（0.5コマ刻み・最大剰余法・各エリアの残存人口を上限）。
// 総人口が n 未満なら全員（人口ぶん）。内部は半コマ単位の整数で計算する。
function distributeDeaths(n: number, alive: Record<AreaId, number>): Record<AreaId, number> {
  const ids = Object.keys(alive) as AreaId[];
  const out: Record<AreaId, number> = { yonaguni: 0, taketomi: 0, ishigaki: 0, miyako: 0 };
  const cap: Record<AreaId, number> = { yonaguni: 0, taketomi: 0, ishigaki: 0, miyako: 0 };
  for (const id of ids) cap[id] = Math.max(0, Math.floor(alive[id] * 2 + 1e-9)); // 半コマ単位の上限
  const total = ids.reduce((s, id) => s + cap[id], 0);
  const n2 = Math.round(n * 2);
  if (total <= 0 || n2 <= 0) return out;
  let remaining = Math.min(n2, total);
  const quota = ids.map(id => ({ id, q: (cap[id] / total) * remaining }));
  const half: Record<AreaId, number> = { yonaguni: 0, taketomi: 0, ishigaki: 0, miyako: 0 };
  for (const { id, q } of quota) {
    const base = Math.min(Math.floor(q), cap[id]);
    half[id] = base; remaining -= base;
  }
  // 剰余の大きい順に半コマずつ（人口上限内）
  quota.sort((a, b) => (b.q - Math.floor(b.q)) - (a.q - Math.floor(a.q)));
  let guard = 0;
  while (remaining > 0 && guard++ < 256) {
    let placed = false;
    for (const { id } of quota) {
      if (remaining <= 0) break;
      if (half[id] + 1 <= cap[id]) { half[id] += 1; remaining -= 1; placed = true; }
    }
    if (!placed) break;
  }
  for (const id of ids) out[id] = half[id] / 2;
  return out;
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
    // ver4.0 4.2: 毎日4時に自衛隊配備のダイスを「1回」振る。出目 <= 事前準備Lv(Lv6は5扱い) なら
    // 海自(海空警護) か 空自(空域警護) の「どちらか1つ」に+1。各上限はレベル別最大部隊数（図3）。
    // どちらに置くかはAI判断: 少ない方を優先（同数なら海自）。上限に達した側には置けない（両方上限なら増強なし）。
    const rollThreshold = Math.min(prepLevel, 5);
    const seaMax = SEA_GUARD_MAX_BY_LEVEL[prepLevel] ?? 0;
    const airMax = AIR_GUARD_MAX_BY_LEVEL[prepLevel] ?? 0;
    // レベル別最大を厳守: 既存値が(旧state/手動構築等で)最大超過していても上限へクランプする。
    mil.jsdfSea = Math.min(mil.jsdfSea, seaMax);
    mil.jsdfAir = Math.min(mil.jsdfAir, airMax);

    const jsdfRoll = rollDie();
    if (jsdfRoll <= rollThreshold) {
      const canSea = mil.jsdfSea < seaMax;
      const canAir = mil.jsdfAir < airMax;
      let pick: 'sea' | 'air' | null = null;
      if (canSea && canAir) pick = mil.jsdfAir < mil.jsdfSea ? 'air' : 'sea';
      else if (canSea) pick = 'sea';
      else if (canAir) pick = 'air';

      if (pick === 'sea') {
        mil.jsdfSea += 1;
        log.push(`[4:00] 自衛隊配備: ダイス${jsdfRoll}≤${rollThreshold} → 海自 海空警護+1（海自${mil.jsdfSea}/${seaMax}・空自${mil.jsdfAir}/${airMax}）`);
      } else if (pick === 'air') {
        mil.jsdfAir += 1;
        log.push(`[4:00] 自衛隊配備: ダイス${jsdfRoll}≤${rollThreshold} → 空自 空域警護+1（海自${mil.jsdfSea}/${seaMax}・空自${mil.jsdfAir}/${airMax}）`);
      } else {
        log.push(`[4:00] 自衛隊配備: ダイス${jsdfRoll}≤${rollThreshold} だが海自・空自とも最大数(${seaMax}/${airMax})に達済み → 増強なし`);
      }
    } else {
      log.push(`[4:00] 自衛隊配備: ダイス${jsdfRoll}>${rollThreshold} → 今日は増強なし（海自${mil.jsdfSea}/${seaMax}・空自${mil.jsdfAir}/${airMax}）`);
    }

    // PAC3は事前準備Lvで初期配備済み（ダイス配備は廃止）。ここでは増減しない（再配備は prepareDayPhase1）。
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
  // その日だけ船舶便が使用不能になる港（海上民兵海域接近）。マップの🚫表示用
  portClosedToday: ShipRouteKey[];
  newDead: number;
  hourlyRolls: HourlyRoll[];
  senkakuOccupied: boolean;
  // DMAT連動: 市街攻撃/施設破壊による「そのエリアの死傷者発生」を、発生エリアと規模ごとに記録。
  // minor=数十名（コマ除去なし） / major=数百名（0.5コマ死亡）。
  // prepareDayPhase1 でDMAT残と突き合わせ、当該エリア疲労+1／(DMAT未派遣・派遣不可なら)追加死者(major:0.5/minor:0)+疲労+1を確定する。
  dmatDeathAreas: { area: AreaId; severity: 'minor' | 'major' }[];
  // ver4.0 6.4.5: 自衛隊喪失-1 を反映した後の軍事状態（当日以降のイベント判定にも即時反映・翌日へ引き継ぐ）
  military: MilitaryState;
  // ver4.0 6.4.2/3: 当日 上陸・ヘリボーンで占領されたエリア（prepareDayPhase1 で残存コマを0にし occupied へ反映。
  // 全滅死者数もそこで「当日既にそのエリアで計上した死者」を差し引いて確定する＝二重計上防止）
  occupiedToday: Partial<Record<AreaId, boolean>>;
  // 当日エリア別に計上した死者（市街攻撃/施設破壊死傷）。占領時の全滅数から差し引く。
  deadByArea: Record<AreaId, number>;
  // 多良間/波照間の電力設備が当日破壊されたか（一時疲労の発火用）
  taramaPowerBrokenToday: boolean;
  haterumaPowerBrokenToday: boolean;
  // Section1: 撃墜/撃沈/運航拒否/施設破壊で「以後恒久停止」になる路線（prepareDayPhase1でstate.transportへ反映）
  disabledAirRoutes: Partial<Record<AirRouteKey, boolean>>;
  disabledShipRoutes: Partial<Record<ShipRouteKey, boolean>>;
  // 海保輸送船 撃沈による 1日便数-1（負値。coastGuardMaxPerDayへ加算し0未満にしない）
  coastGuardMaxDelta: number;
  // ver4.0 6.3.6: 当日発生した不時着（エリア・国）。prepareDayPhase1 で state.handPenalty（当日＋翌日24時まで）へ反映
  landingsToday: { area: AreaId; country: 'china' | 'taiwan' }[];
  // ver4.0 6.1 A表 住民の避難拒否: 当日そのエリア発の避難注文を無効化（容量は残す＝他エリアの通過・ハブ待機コマの搬出は可）
  refusalToday: Partial<Record<AreaId, boolean>>;
  // 当日1時の地震死者の予約配分（エリア別コマ数）。無人判定(alivePop)で差し引く。実際の人口除去は prepareDayPhase1 7b0 で1回のみ。
  reservedDead: Record<AreaId, number>;
}

export function generateDailyEvents(
  state: GameState,
  reservedDead: Record<AreaId, number> = { yonaguni: 0, taketomi: 0, ishigaki: 0, miyako: 0 }
): EventResult {
  const result: EventResult = {
    reservedDead: { ...reservedDead },
    events: [],
    log: [],
    fatigueIncrease: { yonaguni: 0, taketomi: 0, ishigaki: 0, miyako: 0 },
    transportPenalty: {},
    infraPenalty: {},
    capacityMultiplier: { yonaguni: 1, taketomi: 1, ishigaki: 1, miyako: 1 },
    seaCapacityMultiplier: { yonaguni: 1, taketomi: 1, ishigaki: 1, miyako: 1 },
    facilityClosedToday: [],
    portClosedToday: [],
    newDead: 0,
    hourlyRolls: [],
    senkakuOccupied: false,
    dmatDeathAreas: [],
    military: { ...state.military },
    occupiedToday: {},
    deadByArea: { yonaguni: 0, taketomi: 0, ishigaki: 0, miyako: 0 },
    taramaPowerBrokenToday: false,
    haterumaPowerBrokenToday: false,
    disabledAirRoutes: {},
    disabledShipRoutes: {},
    coastGuardMaxDelta: 0,
    landingsToday: [],
    refusalToday: {},
  };

  const { day } = state;
  // 当日の喪失(-1)を後続イベントへ即時反映するため、result.military（コピー）を判定に使う。
  const military = result.military;

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
    outcome = processEvent(eventType, state, result, military);
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
// 港インフラ（久部良港も専用フラグ kuburaPort で施設破壊を持つ。路線停止 disabledShipRoutes とは区別）
const SHIP_ROUTE_INFRA: Record<ShipRouteKey, keyof InfraState> = {
  ishigakiPort: 'ishigakiPort', hiraraPort: 'hiraraPort', kubura: 'kuburaPort',
};

const AIR_ROUTE_JP: Record<AirRouteKey, string> = {
  shinIshigaki: '新石垣空港', miyako: '宮古空港', shimoji: '下地島空港', yonaguni: '与那国空港', hateruma: '波照間空港',
};
const SHIP_ROUTE_JP: Record<ShipRouteKey, string> = {
  ishigakiPort: '石垣港', hiraraPort: '平良港', kubura: '久部良港',
};

// ===== Section3: A/B/C イベントセル定義 =====
type EventCell =
  | { kind: 'none' }
  // 当日その空港の民間航空便を使用不可（ドローン障害物散布）。判定式①の対象
  | { kind: 'airClosedToday'; air: AirRouteKey; label?: string }
  // ver4.0 6.3.6: 中国/台湾軍機 不時着。空港は運航可。当該エリアの手数を当日と翌日24時まで−1（異国なら−2）。
  // air 指定時: その空港が破壊済みなら発生しない。竹富島（空港なし）は air 無しでエリア手数減のみ。判定式①の対象
  | { kind: 'emergencyLanding'; area: AreaId; country: 'china' | 'taiwan'; air?: AirRouteKey; label: string }
  // 当日その港の船舶便を使用不可（海上民兵海域接近）。判定式①の対象
  | { kind: 'shipClosedToday'; ship: ShipRouteKey }
  // ===== A表（ver4.0 6.1 図20）=====
  // 集落市街/インフラ漁港で パニック・交通混乱・通信不良: 判定式なし。人のいるエリアからランダムに1つ → 当日容量×0.5（脱出に1手多く必要）
  | { kind: 'aSocial'; effect: 'panic' | 'traffic' | 'comms'; scope: 'village' | 'infra' }
  // 集落市街で住民の避難拒否: 判定式なし。人のいるエリアからランダムに1つ → 当日避難不可（容量×0）。他エリアの通過は可
  | { kind: 'aRefusal' }
  // 空港/海港サイバー攻撃: 判定式①。当該施設は同日24時まで入出航不能（当日その施設の便0）
  | { kind: 'aCyber'; air?: AirRouteKey; ship?: ShipRouteKey }
  // 空港/海港 観光客大乱闘: 判定式①。当該施設は当日使用不能
  | { kind: 'aBrawl'; air?: AirRouteKey; ship?: ShipRouteKey }
  // 空港/海港 乗員船員のボイコット: 判定式①。対象施設は空港4＋海港3からランダムに1つ → 当日その施設の便0
  | { kind: 'aBoycott' }
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

// A表（ver4.0 6.1 図20）: 1投目=列(1..6), 2投目=行(1..4)。A[row][col]（row/col は1始まり）。
const EVENT_A_TABLE: EventCell[][] = [
  // 行1
  [
    { kind: 'aSocial', effect: 'panic', scope: 'village' },    // 集落市街でパニック
    { kind: 'aSocial', effect: 'panic', scope: 'infra' },      // インフラ漁港でパニック
    { kind: 'aSocial', effect: 'traffic', scope: 'village' },  // 集落市街で交通混乱
    { kind: 'aSocial', effect: 'traffic', scope: 'infra' },    // インフラ漁港で交通混乱
    { kind: 'aBoycott' },                                      // 空港/海港 乗員船員のボイコット
    { kind: 'aRefusal' },                                      // 集落市街で住民の避難拒否
  ],
  // 行2
  [
    { kind: 'aSocial', effect: 'comms', scope: 'village' },    // 集落市街で通信不良
    { kind: 'aSocial', effect: 'comms', scope: 'infra' },      // インフラ漁港で通信不良
    { kind: 'aCyber', air: 'miyako' },                         // 宮古空港サイバー攻撃
    { kind: 'aCyber', air: 'shimoji' },                        // 下地島空港サイバー攻撃
    { kind: 'aCyber', air: 'shinIshigaki' },                   // 新石垣空港サイバー攻撃
    { kind: 'aCyber', air: 'yonaguni' },                       // 与那国空港サイバー攻撃
  ],
  // 行3
  [
    { kind: 'aCyber', ship: 'hiraraPort' },                    // 平良港サイバー攻撃
    { kind: 'aCyber', ship: 'ishigakiPort' },                  // 石垣港サイバー攻撃
    { kind: 'aCyber', ship: 'kubura' },                        // 久部良港サイバー攻撃
    { kind: 'aBrawl', air: 'miyako' },                         // 宮古空港 観光客大乱闘
    { kind: 'aBrawl', air: 'shimoji' },                        // 下地島空港 観光客大乱闘
    { kind: 'aBrawl', air: 'shinIshigaki' },                   // 新石垣空港 観光客大乱闘
  ],
  // 行4
  [
    { kind: 'aBrawl', air: 'yonaguni' },                       // 与那国空港 観光客大乱闘
    { kind: 'aBrawl', ship: 'hiraraPort' },                    // 平良港 観光客大乱闘
    { kind: 'aBrawl', ship: 'ishigakiPort' },                  // 石垣港 観光客大乱闘
    { kind: 'aBrawl', ship: 'kubura' },                        // 久部良港 観光客大乱闘
    { kind: 'none' },                                          // 空欄
    { kind: 'none' },                                          // 空欄
  ],
];

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
    { kind: 'emergencyLanding', area: 'yonaguni', country: 'taiwan', air: 'yonaguni', label: '与那国空港 台湾封鎖不時着(台湾軍機)' },
    { kind: 'emergencyLanding', area: 'yonaguni', country: 'china', air: 'yonaguni', label: '与那国空港 中国軍機不時着' },
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
    { kind: 'emergencyLanding', area: 'taketomi', country: 'taiwan', label: '竹富島 台湾軍機不時着' }, // 竹富島は空港なし→エリア手数−1のみ
    { kind: 'emergencyLanding', area: 'miyako', country: 'taiwan', air: 'miyako', label: '宮古島 台湾軍機不時着' },
    { kind: 'emergencyLanding', area: 'miyako', country: 'taiwan', air: 'miyako', label: '宮古島 台湾軍機不時着' },
  ],
  // 行5
  [
    { kind: 'emergencyLanding', area: 'ishigaki', country: 'china', air: 'shinIshigaki', label: '新石垣空港 中国軍機不時着' },
    { kind: 'emergencyLanding', area: 'miyako', country: 'china', air: 'shimoji', label: '下地島空港 中国軍機不時着' },
    { kind: 'emergencyLanding', area: 'miyako', country: 'china', air: 'miyako', label: '宮古空港 中国軍機不時着' },
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

// B/C 施設破壊判定（ver4.0 6.7）: 4ダイス + 中国軍 − (海自海空警護+空自空域警護 + 防護範囲内PAC3) ≧17（尖閣占領なら ≧14）。
// PAC3は対象エリアの防護範囲内のみ（pac3For）。
function resolveFacilityMissile(military: MilitaryState, area: AreaId, routeKey?: AirRouteKey | ShipRouteKey | 'outside'): { calcValue: number; threshold: number; hit: boolean; detail: string } {
  const diceSum = sumDice(4);
  const chinaTotal = military.chineseSea + military.chineseAir;
  const jsdfTotal = military.jsdfSea + military.jsdfAir;
  const pac3 = pac3For(area, military, routeKey);
  const threshold = military.senkakuOccupied ? 14 : 17;
  const calcValue = diceSum + chinaTotal - (jsdfTotal + pac3);
  const detail = `ダイス${diceSum}+中${chinaTotal}-(自${jsdfTotal}+PAC3${pac3})=計${calcValue} / 閾値${threshold}${military.senkakuOccupied ? '(尖閣占領)' : ''}`;
  return { calcValue, threshold, hit: calcValue >= threshold, detail };
}

// 施設破壊成立時の死傷者判定（ver4.0 6.7）: 1ダイス − 抗堪性×2 + 9
//   ≦7 なし ／ 8〜11 数十名 → 当該疲労+1・DMAT対象(minor) ／ ≧12 数百名 → 0.5コマ死亡・当該疲労+1・DMAT対象(major)
// 疲労+1 は DMAT処理(prepareDayPhase1 7b)側で dmatDeathAreas に基づき加算する（二重加算しない）。
// 無人エリア（ver4.0 4.4④ 無人集落）では死傷者判定を行わない。
function resolveFacilityCasualty(area: AreaId, state: GameState, result: EventResult): string {
  const shelterLevel = state.shelterLevel;
  // 当日既計上の撃墜/撃沈死者(deadByArea)・当日占領を差し引いた残存で無人判定
  if (alivePop(state, result, area) <= 0 || result.occupiedToday[area]) {
    result.log.push('  死傷者判定: 無人エリアのため死傷者なし');
    return '死傷者なし(無人)';
  }
  const die = rollDie();
  const v = die - shelterLevel * 2 + 9;
  const formula = `死傷者判定: ダイス${die}-抗堪${shelterLevel}×2+9=${v}`;
  if (v >= 12) {
    result.newDead += 0.5; // 計上値（人口除去と死者確定は prepareDayPhase1 7b' の逐次DMAT処理で行う）
    result.dmatDeathAreas.push({ area, severity: 'major' });
    result.log.push(`  ${formula} ≥12 → 数百名の死傷者: 0.5コマ死亡・当該エリア疲労+1・DMAT対象`);
    return '死傷者:数百名(0.5コマ)';
  }
  if (v >= 8) {
    result.dmatDeathAreas.push({ area, severity: 'minor' });
    result.log.push(`  ${formula} 8〜11 → 数十名の死傷者: 当該エリア疲労+1・DMAT対象（コマ除去なし）`);
    return '死傷者:数十名';
  }
  result.log.push(`  ${formula} ≤7 → 死傷者なし`);
  return '死傷者なし';
}

// 輸送アセット（海保輸送船/海自輸送船/陸自ヘリ/空自輸送機）攻撃の死者1コマを「人のいるエリア」に帰属させる。
// 優先: 石垣→宮古→竹富→与那国（待機コマ含む）。当日既に計上した deadByArea を差し引いた残存で判定。どこにも人がいなければ死者0。
function assetDeathArea(state: GameState, result: EventResult): AreaId | null {
  for (const id of ['ishigaki', 'miyako', 'taketomi', 'yonaguni'] as AreaId[]) {
    const a = state.areas[id];
    const pop = a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0) - result.deadByArea[id];
    if (pop > 0 && !result.occupiedToday[id]) {
      result.newDead += 1;
      result.deadByArea[id] += 1;
      return id;
    }
  }
  return null;
}

// B/C セル1つを処理する（2ダイス表引きの結果）。
// エリアの当日残存人口（当日既に計上した死者を差し引く）。無人判定に使う。
// 差し引き対象: 当日既計上の撃墜/撃沈/アセット死(deadByArea)、市街攻撃/施設死傷の major 0.5コマ(dmatDeathAreas・当該エリア)、
// 当日占領（=0）、当日1時の地震死者の予約配分(reservedDead。人口除去は prepareDayPhase1 7b0 で行うが判定用に先に差し引く）。
function alivePop(state: GameState, result: EventResult, id: AreaId): number {
  if (result.occupiedToday[id]) return 0;
  const a = state.areas[id];
  const majorDead = result.dmatDeathAreas.filter(d => d.area === id && d.severity === 'major').length * 0.5;
  return a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0)
    - result.deadByArea[id] - majorDead - (result.reservedDead[id] ?? 0);
}

// 「人のいるエリア」（未占領・当日残存>0）からランダムに1つ選ぶ。無ければ null。
function pickPopulatedArea(state: GameState, result: EventResult): AreaId | null {
  const cands = (['yonaguni', 'taketomi', 'ishigaki', 'miyako'] as AreaId[])
    .filter(id => alivePop(state, result, id) > 0 && !isOccupied(state, id) && !result.occupiedToday[id]);
  if (cands.length === 0) return null;
  return cands[Math.floor(Math.random() * cands.length)];
}

function processEventCell(
  cell: EventCell,
  tag: 'A' | 'B' | 'C',
  colRow: string,
  result: EventResult,
  military: MilitaryState,
  state: GameState
): string {
  const areas = ['yonaguni', 'taketomi', 'ishigaki', 'miyako'] as AreaId[];
  const allAreasFatigue = (n: number) => areas.forEach(a => { result.fatigueIncrease[a] += n; });
  // 既占領エリアへの攻撃は無効（ver4.0 4.4④）
  const occupied = (a: AreaId) => isOccupied(state, a) || !!result.occupiedToday[a];
  // 既に破壊済み(前日まで or 当日先行イベント)のインフラか。
  // 運航拒否/撃墜による「路線停止」は施設破壊ではない（施設は健全で軍用機・ピストンは使える）ため、ここでは見ない。
  // 旧stateに kuburaPort が無い場合は健全(true)とみなす。
  const infraBroken = (k: keyof InfraState) => state.infra[k] === false || result.infraPenalty[k] === false;
  const prepLevel = state.prepLevel;
  const head = `[イベント${tag}|${colRow}]`;

  // 施設系イベント（A/B）の共通前提: 既破壊・既占領の施設では無効（ver4.0 4.4④）。無効なら理由文字列を返す。
  const facilityInvalid = (air?: AirRouteKey, ship?: ShipRouteKey): string | null => {
    if (air) {
      if (occupied(AIR_ROUTE_AREA[air])) return `${AIR_ROUTE_JP[air]} は既に占領済みエリア`;
      if (infraBroken(AIR_ROUTE_INFRA[air])) return `${AIR_ROUTE_JP[air]} は既に破壊済み`;
    }
    if (ship) {
      if (occupied(SHIP_ROUTE_AREA[ship])) return `${SHIP_ROUTE_JP[ship]} は既に占領済みエリア`;
      if (infraBroken(SHIP_ROUTE_INFRA[ship])) return `${SHIP_ROUTE_JP[ship]} は既に破壊済み`;
    }
    return null;
  };
  // 便（路線）系イベントの無効判定: 施設が既破壊/占領（facilityInvalid）に加え、既に路線停止済み(disabled)なら「便は無い」ので無効
  const routeInvalid = (air?: AirRouteKey, ship?: ShipRouteKey): string | null => {
    const f = facilityInvalid(air, ship);
    if (f) return f;
    if (air && (state.transport.disabledAirRoutes?.[air] || result.disabledAirRoutes[air])) return `${AIR_ROUTE_JP[air]} の航空便は既に停止済み`;
    if (ship && (state.transport.disabledShipRoutes?.[ship] || result.disabledShipRoutes[ship])) return `${SHIP_ROUTE_JP[ship]} の船舶便は既に停止済み`;
    return null;
  };
  // 港の海路倍率を掛ける（×0=当日閉鎖 / ×0.5=半減）。石垣港は竹富町各島・与那国からのフェリーの着港でもあるため、
  // 石垣港の閉鎖/半減は taketomi・yonaguni の海路倍率にも同じ係数を掛ける（入出航不能＝入港も不可）。
  const applyPortSeaMul = (ship: ShipRouteKey, factor: number) => {
    result.seaCapacityMultiplier[SHIP_ROUTE_AREA[ship]] *= factor;
    if (ship === 'ishigakiPort') {
      result.seaCapacityMultiplier.taketomi *= factor;
      result.seaCapacityMultiplier.yonaguni *= factor;
    }
  };
  // 施設を当日閉鎖（空港=airportAvailを当日false / 港=海路倍率×0）
  const closeFacilityToday = (air?: AirRouteKey, ship?: ShipRouteKey): string => {
    if (air) { result.facilityClosedToday.push(air); return AIR_ROUTE_JP[air]; }
    if (ship) { applyPortSeaMul(ship, 0); result.portClosedToday.push(ship); return SHIP_ROUTE_JP[ship]; }
    return '';
  };

  switch (cell.kind) {
    case 'none':
      return `${head} イベントなし`;

    // ===== A表（ver4.0 6.1）=====
    case 'aSocial': {
      const effJp = { panic: 'パニック', traffic: '交通混乱', comms: '通信不良' }[cell.effect];
      const scopeJp = cell.scope === 'village' ? '集落市街' : 'インフラ漁港';
      const target = pickPopulatedArea(state, result);
      if (!target) {
        result.log.push(`${head} 【${scopeJp}で${effJp}】対象となる人のいるエリアなし → 効力なし`);
        return `【${effJp}】効力なし(全エリア無人)`;
      }
      const name = state.areas[target].name;
      result.capacityMultiplier[target] *= 0.5;
      result.log.push(`${head} 【${scopeJp}で${effJp}】${name} — 脱出に1手多く必要（本日の輸送容量×0.5）※判定式なし`);
      return `【${effJp}】${name} 容量×0.5`;
    }
    case 'aRefusal': {
      const target = pickPopulatedArea(state, result);
      if (!target) {
        result.log.push(`${head} 【集落市街で住民の避難拒否】対象となる人のいるエリアなし → 効力なし`);
        return '【避難拒否】効力なし(全エリア無人)';
      }
      const name = state.areas[target].name;
      // 容量は残す（他エリアの通過＝ハブ待機コマの搬出は可）。当該エリア発の避難注文のみ executeDayPhase2/autoSelectOrders で無効化。
      result.refusalToday[target] = true;
      result.log.push(`${head} 【集落市街で住民の避難拒否】${name} — 本日は当該エリア住民の避難不可（他エリアの通過・待機コマの搬出は可）※判定式なし`);
      return `【避難拒否】${name} 本日避難不可`;
    }
    case 'aCyber':
    case 'aBrawl': {
      const evJp = cell.kind === 'aCyber' ? 'サイバー攻撃' : '観光客大乱闘';
      const fjp = cell.air ? AIR_ROUTE_JP[cell.air] : cell.ship ? SHIP_ROUTE_JP[cell.ship] : '';
      const inv = facilityInvalid(cell.air, cell.ship);
      if (inv) {
        result.log.push(`${head} 【${fjp} ${evJp}】${inv} → 無効`);
        return `【${evJp}無効】${inv}`;
      }
      result.log.push(`${head} 【${fjp} ${evJp}】`);
      if (!rollOccurrence(prepLevel, result.log, evJp)) return `【${evJp}未遂】${fjp}`;
      closeFacilityToday(cell.air, cell.ship);
      result.log.push(`  ⚠️ ${fjp} は同日24時まで${cell.kind === 'aCyber' ? '入出航不能' : '使用不能'}（当日の便0）`);
      return `【${evJp}】${fjp} 当日閉鎖`;
    }
    case 'aBoycott': {
      // 対象施設をダイスでランダムに1つ（空港4＋海港3）
      const facilities: { air?: AirRouteKey; ship?: ShipRouteKey }[] = [
        { air: 'shinIshigaki' }, { air: 'miyako' }, { air: 'shimoji' }, { air: 'yonaguni' },
        { ship: 'ishigakiPort' }, { ship: 'hiraraPort' }, { ship: 'kubura' },
      ];
      const pick = facilities[Math.floor(Math.random() * facilities.length)];
      const fjp = pick.air ? AIR_ROUTE_JP[pick.air] : SHIP_ROUTE_JP[pick.ship!];
      const inv = facilityInvalid(pick.air, pick.ship);
      if (inv) {
        result.log.push(`${head} 【乗員船員のボイコット】対象=${fjp}: ${inv} → 無効`);
        return `【ボイコット無効】${inv}`;
      }
      result.log.push(`${head} 【乗員船員のボイコット】対象施設=${fjp}`);
      if (!rollOccurrence(prepLevel, result.log, 'ボイコット')) return `【ボイコット未遂】${fjp}`;
      closeFacilityToday(pick.air, pick.ship);
      result.log.push(`  ⚠️ ${fjp} は本日24時まで使用不能（当日の便0・他施設は通常運用）`);
      return `【ボイコット】${fjp} 当日閉鎖`;
    }

    // ===== B/C表 =====
    case 'airClosedToday': {
      const jp = AIR_ROUTE_JP[cell.air];
      const inv = facilityInvalid(cell.air);
      if (inv) {
        result.log.push(`${head} 【${jp} 障害物散布(ドローン)】${inv} → 無効`);
        return `【障害物散布無効】${inv}`;
      }
      result.log.push(`${head} 【${jp} 障害物散布(ドローン)】`);
      if (!rollOccurrence(prepLevel, result.log, '障害物散布')) return `【障害物散布未遂】${jp}`;
      result.facilityClosedToday.push(cell.air);
      result.log.push(`  ⚠️ ${cell.label ?? `${jp} 民間航空便 当日使用不可`}`);
      return `【当日閉鎖】${cell.label ?? jp + ' 航空便'}`;
    }
    case 'emergencyLanding': {
      // ver4.0 6.3.6: 空港の運航は可能。当該エリアの手数を当日と翌日24時まで−1（同国複数は−1、中国＋台湾なら−2）。
      // 破壊された空港では発生しない（応急復旧後は発生）。既占領エリアは無効。
      const cJp = cell.country === 'china' ? '中国' : '台湾';
      if (occupied(cell.area)) {
        result.log.push(`${head} 【${cell.label}】既に占領済みエリア → 無効`);
        return `【不時着無効】${cell.label} 既に占領済み`;
      }
      if (cell.air && infraBroken(AIR_ROUTE_INFRA[cell.air])) {
        result.log.push(`${head} 【${cell.label}】${AIR_ROUTE_JP[cell.air]}は破壊済み（応急復旧前）→ 発生しない`);
        return `【不時着無効】${AIR_ROUTE_JP[cell.air]} 破壊済み`;
      }
      result.log.push(`${head} 【${cell.label}】`);
      if (!rollOccurrence(prepLevel, result.log, '不時着')) return `【不時着未遂】${cell.label}`;
      result.landingsToday.push({ area: cell.area, country: cell.country });
      const prior = (state.handPenalty?.[cell.area] ?? []).filter(p => p.untilDay >= state.day && p.country !== 'negotiation').map(p => p.country);
      const countries = new Set([...prior, ...result.landingsToday.filter(l => l.area === cell.area).map(l => l.country)]);
      const pen = Math.min(2, countries.size);
      const name = state.areas[cell.area].name;
      result.log.push(`  ⚠️ ${cJp}軍機が${name}に不時着 → 空港の運航は可・${name}の手数を当日と翌日24時まで−${pen}${pen >= 2 ? '（中国・台湾の2か国）' : ''}`);
      return `【不時着】${cell.label} 手数−${pen}(2日間)`;
    }
    case 'shipClosedToday': {
      const jp = SHIP_ROUTE_JP[cell.ship];
      const inv = facilityInvalid(undefined, cell.ship);
      if (inv) {
        result.log.push(`${head} 【${jp} 海上民兵海域接近】${inv} → 無効`);
        return `【海上民兵無効】${inv}`;
      }
      result.log.push(`${head} 【${jp} 海上民兵海域接近】`);
      if (!rollOccurrence(prepLevel, result.log, '海上民兵')) return `【海上民兵未遂】${jp}`;
      applyPortSeaMul(cell.ship, 0); // 当日その港の船舶便を0に（石垣港なら着港する竹富/与那国フェリーも）
      result.portClosedToday.push(cell.ship);
      result.log.push(`  ⚠️ ${jp} の当日の船舶便 使用不可`);
      return `【当日閉鎖】${jp} 船舶便`;
    }
    case 'mine': {
      const jp = SHIP_ROUTE_JP[cell.ship];
      const inv = facilityInvalid(undefined, cell.ship);
      if (inv) {
        result.log.push(`${head} 【${jp} 機雷敷設】${inv} → 無効`);
        return `【機雷無効】${inv}`;
      }
      result.log.push(`${head} 【${jp}の航路 機雷敷設の疑い】`);
      if (!rollOccurrence(prepLevel, result.log, '機雷敷設')) return `【機雷未遂】${jp}`;
      applyPortSeaMul(cell.ship, 0.5);
      result.log.push(`  ⚠️ ${jp}の航路 → 当日の海路コマ半減（要掃海・空路は影響なし）`);
      return `【機雷】${jp} 海路半減`;
    }
    case 'shipHalf': {
      const jp = SHIP_ROUTE_JP[cell.ship];
      const inv = facilityInvalid(undefined, cell.ship);
      if (inv) {
        result.log.push(`${head} 【${jp} 海域船舶臨検/軍民船舶運航錯綜】${inv} → 無効`);
        return `【臨検/錯綜無効】${inv}`;
      }
      result.log.push(`${head} 【${jp} 海域船舶臨検/軍民船舶運航錯綜】`);
      if (!rollOccurrence(prepLevel, result.log, '臨検/錯綜')) return `【臨検/錯綜未遂】${jp}`;
      applyPortSeaMul(cell.ship, 0.5);
      result.log.push(`  ⚠️ ${jp} 船舶便 半減`);
      return `【半減】${jp} 船舶便`;
    }
    case 'airHalf': {
      const jp = AIR_ROUTE_JP[cell.air];
      const area = AIR_ROUTE_AREA[cell.air];
      const inv = facilityInvalid(cell.air);
      if (inv) {
        result.log.push(`${head} 【${jp} 軍民航空機運航錯綜】${inv} → 無効`);
        return `【錯綜無効】${inv}`;
      }
      result.log.push(`${head} 【${jp} 軍民航空機運航錯綜】`);
      if (!rollOccurrence(prepLevel, result.log, '軍民錯綜')) return `【錯綜未遂】${jp}`;
      result.capacityMultiplier[area] *= 0.5;
      result.log.push(`  ⚠️ ${jp} 航空便 半減`);
      return `【半減】${jp} 航空便`;
    }
    case 'airMissileShootdown': {
      const jp = AIR_ROUTE_JP[cell.air];
      const inv = routeInvalid(cell.air, undefined);
      if (inv) {
        result.log.push(`${head} 【${jp} 航空便ミサイル攻撃】${inv} → 無効`);
        return `【航空便攻撃無効】${inv}`;
      }
      const r = resolveInterdiction(military);
      result.log.push(`[イベント${tag}|${colRow}] 【${jp} 航空便ミサイル攻撃(撃墜判定)】計${r.calcValue} / 閾値${r.threshold}`);
      if (r.hit) {
        result.disabledAirRoutes[cell.air] = true;
        result.newDead += 1;
        result.deadByArea[AIR_ROUTE_AREA[cell.air]] += 1; // 出発エリアの人口から除去（prepareDayPhase1）
        allAreasFatigue(1);
        result.log.push(`  ⚠️ 撃墜成立! ${jp}の航空便を以後使用不可・死者1コマ(${AIR_ROUTE_AREA[cell.air]})・全4エリア疲労+1`);
        return `【撃墜】${jp} 航空便 計${r.calcValue}≥${r.threshold}`;
      }
      return `【航空便攻撃】${jp} 計${r.calcValue}<${r.threshold} 回避`;
    }
    case 'shipMissileSink': {
      const jp = SHIP_ROUTE_JP[cell.ship];
      const inv = routeInvalid(undefined, cell.ship);
      if (inv) {
        result.log.push(`${head} 【${jp} 船舶便ミサイル攻撃】${inv} → 無効`);
        return `【船舶便攻撃無効】${inv}`;
      }
      const r = resolveInterdiction(military);
      result.log.push(`[イベント${tag}|${colRow}] 【${jp} 船舶便ミサイル攻撃(撃沈判定)】計${r.calcValue} / 閾値${r.threshold}`);
      if (r.hit) {
        result.disabledShipRoutes[cell.ship] = true;
        result.newDead += 1;
        result.deadByArea[SHIP_ROUTE_AREA[cell.ship]] += 1; // 出発エリアの人口から除去（prepareDayPhase1）
        allAreasFatigue(1);
        result.log.push(`  ⚠️ 撃沈成立! ${jp}の船舶便を以後使用不可・死者1コマ(${SHIP_ROUTE_AREA[cell.ship]})・全4エリア疲労+1`);
        return `【撃沈】${jp} 船舶便 計${r.calcValue}≥${r.threshold}`;
      }
      return `【船舶便攻撃】${jp} 計${r.calcValue}<${r.threshold} 回避`;
    }
    case 'airFacilityMissile': {
      const jp = AIR_ROUTE_JP[cell.air];
      const area = AIR_ROUTE_AREA[cell.air];
      const infraKey = AIR_ROUTE_INFRA[cell.air];
      const routeKey = cell.air;
      if (occupied(area)) {
        result.log.push(`[イベント${tag}|${colRow}] 【${jp} ミサイル攻撃(施設)】既に占領済みエリア → 無効`);
        return `【施設攻撃無効】${jp} 既に占領済み`;
      }
      if (infraBroken(infraKey)) {
        result.log.push(`[イベント${tag}|${colRow}] 【${jp} ミサイル攻撃(施設)】既に破壊済み・無効`);
        return `【施設攻撃無効】${jp} 既に破壊済み`;
      }
      const r = resolveFacilityMissile(military, area, routeKey);
      result.log.push(`[イベント${tag}|${colRow}] 【${jp} ミサイル攻撃(施設破壊判定)】${r.detail}`);
      if (r.hit) {
        result.infraPenalty[infraKey] = false;
        result.log.push(`  ⚠️ 施設破壊! ${jp}の民間便を使用不可`);
        const c = resolveFacilityCasualty(area, state, result);
        return `【施設破壊】${jp} 計${r.calcValue}≥${r.threshold} ${c}`;
      }
      return `【ミサイル攻撃】${jp} 計${r.calcValue}<${r.threshold} 耐えた`;
    }
    case 'shipFacilityMissile': {
      const jp = SHIP_ROUTE_JP[cell.ship];
      const area = SHIP_ROUTE_AREA[cell.ship];
      const infraKey = SHIP_ROUTE_INFRA[cell.ship];
      if (occupied(area)) {
        result.log.push(`[イベント${tag}|${colRow}] 【${jp} ミサイル攻撃(施設)】既に占領済みエリア → 無効`);
        return `【施設攻撃無効】${jp} 既に占領済み`;
      }
      if (infraBroken(infraKey)) {
        result.log.push(`[イベント${tag}|${colRow}] 【${jp} ミサイル攻撃(施設)】既に破壊済み・無効`);
        return `【施設攻撃無効】${jp} 既に破壊済み`;
      }
      const r = resolveFacilityMissile(military, area);
      result.log.push(`[イベント${tag}|${colRow}] 【${jp} ミサイル攻撃(施設破壊判定)】${r.detail}`);
      if (r.hit) {
        result.infraPenalty[infraKey] = false;
        result.log.push(`  ⚠️ 施設破壊! ${jp}の民間便を使用不可`);
        const c = resolveFacilityCasualty(area, state, result);
        return `【施設破壊】${jp} 計${r.calcValue}≥${r.threshold} ${c}`;
      }
      return `【ミサイル攻撃】${jp} 計${r.calcValue}<${r.threshold} 耐えた`;
    }
    case 'power': {
      type PowerKey = 'ishigaki' | 'miyako' | 'yonaguni' | 'tarama' | 'hateruma';
      const powerInfraAll: Record<PowerKey, keyof InfraState> = {
        ishigaki: 'powerIshigaki', miyako: 'powerMiyako', yonaguni: 'powerYonaguni', tarama: 'powerTarama', hateruma: 'powerHateruma',
      };
      const powerArea: Record<PowerKey, AreaId> = {
        ishigaki: 'ishigaki', miyako: 'miyako', yonaguni: 'yonaguni', tarama: 'miyako', hateruma: 'taketomi',
      };
      const area = powerArea[cell.power];
      const infraKey = powerInfraAll[cell.power];
      if (occupied(area)) {
        result.log.push(`[イベント${tag}|${colRow}] 【${cell.jp} 電力設備ミサイル攻撃】既に占領済みエリア → 無効`);
        return `【電力攻撃無効】${cell.jp} 既に占領済み`;
      }
      if (infraBroken(infraKey)) {
        result.log.push(`[イベント${tag}|${colRow}] 【${cell.jp} 電力設備ミサイル攻撃】既に破壊済み・無効`);
        return `【電力攻撃無効】${cell.jp} 既に破壊済み`;
      }
      // ver4.0 4.12: 波照間発電所・多良間発電所は PAC3 防護範囲外（石垣PAC3=石垣/西表/小浜/竹富/黒島、宮古PAC3=宮古/下地/伊良部/池間/来間）
      const pac3Scope = (cell.power === 'tarama' || cell.power === 'hateruma') ? 'outside' : undefined;
      const r = resolveFacilityMissile(military, area, pac3Scope);
      result.log.push(`[イベント${tag}|${colRow}] 【${cell.jp} 電力設備ミサイル攻撃】${r.detail}`);
      if (!r.hit) return `【電力攻撃】${cell.jp} 計${r.calcValue}<${r.threshold} 防護成功`;
      if (cell.power === 'tarama') {
        result.infraPenalty.powerTarama = false;
        result.taramaPowerBrokenToday = true;
        result.log.push(`  ⚠️ 発電所破壊! 多良間島が停電 → 多良間島疲労度を宮古・多良間へ加算(即時+1・翌日+1・最大2)。避難完了で解除`);
        // ver4.0 6.7: 施設破壊時の死傷者判定は「空港・海港」限定。電力設備には適用しない
        return `【電力破壊】多良間島(一時疲労)`;
      }
      if (cell.power === 'hateruma') {
        result.infraPenalty.powerHateruma = false;
        result.haterumaPowerBrokenToday = true;
        result.log.push(`  ⚠️ 発電所破壊! 波照間島が停電 → 波照間島疲労度を竹富町各島へ加算(即時+1・翌日+1・最大2)。避難完了で解除`);
        return `【電力破壊】波照間島(一時疲労)`;
      }
      result.infraPenalty[infraKey] = false;
      result.fatigueIncrease[area] += 1; // 即時+1
      result.log.push(`  ⚠️ 発電所破壊! ${cell.jp}が停電・断水 → 即時 疲労+1、以後毎日 疲労+1(夏季+2)`);
      return `【電力破壊】${cell.jp} 停電`;
    }
    case 'bridge': {
      const area: AreaId = 'miyako';
      if (occupied(area)) {
        result.log.push(`[イベント${tag}|${colRow}] 【${cell.jp} ミサイル攻撃(施設)】既に占領済みエリア → 無効`);
        return `【橋攻撃無効】${cell.jp} 既に占領済み`;
      }
      if (infraBroken(cell.infra)) {
        result.log.push(`[イベント${tag}|${colRow}] 【${cell.jp} ミサイル攻撃(施設)】既に破壊済み・無効`);
        return `【橋攻撃無効】${cell.jp} 既に破壊済み`;
      }
      const r = resolveFacilityMissile(military, area);
      result.log.push(`[イベント${tag}|${colRow}] 【${cell.jp} ミサイル攻撃(施設破壊判定)】${r.detail}`);
      if (r.hit) {
        result.infraPenalty[cell.infra] = false;
        result.log.push(`  ⚠️ 橋破壊! ${cell.jp}が通行不能（避難不可化）`);
        // ver4.0 6.7: 死傷者判定は空港・海港限定。陸橋には適用しない
        return `【橋破壊】${cell.jp} 計${r.calcValue}≥${r.threshold}`;
      }
      return `【橋攻撃】${cell.jp} 計${r.calcValue}<${r.threshold} 耐えた`;
    }
    case 'airRefusal': {
      const jp = AIR_ROUTE_JP[cell.air];
      const inv = routeInvalid(cell.air, undefined);
      if (inv) {
        result.log.push(`${head} 【${jp} 航空便運航拒否】${inv} → 無効`);
        return `【運航拒否無効】${inv}`;
      }
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
      const inv = routeInvalid(undefined, cell.ship);
      if (inv) {
        result.log.push(`${head} 【${jp} 船舶便運航拒否】${inv} → 無効`);
        return `【運航拒否無効】${inv}`;
      }
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
        const from = assetDeathArea(state, result);
        allAreasFatigue(1);
        result.log.push(`  ⚠️ 撃沈成立! 海保輸送船の1日便数-1・死者${from ? `1コマ(${from})` : '0(乗客なし)'}・全4エリア疲労+1`);
        return `【海保撃沈】便数-1 計${r.calcValue}≥${r.threshold}`;
      }
      return `【海保攻撃】計${r.calcValue}<${r.threshold} 回避`;
    }
    case 'attackAsset': {
      const r = resolveInterdiction(military);
      result.log.push(`[イベント${tag}|${colRow}] 【${cell.jp}に攻撃(撃墜判定)】計${r.calcValue} / 閾値${r.threshold}`);
      if (r.hit) {
        const from = assetDeathArea(state, result);
        allAreasFatigue(1);
        result.log.push(`  ⚠️ 撃墜成立! ${cell.jp}被害・死者${from ? `1コマ(${from})` : '0(乗客なし)'}・全4エリア疲労+1（次便から継続使用可）`);
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
  military: MilitaryState
): string {
  // A/B/C は 2ダイス表駆動（1投目=列, 2投目=行）。A表=4行（ver4.0 6.1 図20）/ B表=5行 / C表=6行。
  // 表の行数を超える2投目は「イベントなし」として扱う。
  if (eventType === 'A' || eventType === 'B' || eventType === 'C') {
    const table = eventType === 'A' ? EVENT_A_TABLE : eventType === 'B' ? EVENT_B_TABLE : EVENT_C_TABLE;
    const col = rollDie(); // 1投目=列(1..6)
    const row = rollDie(); // 2投目=行(1..6)
    const cell: EventCell = (table[row - 1]?.[col - 1]) ?? { kind: 'none' };
    return processEventCell(cell, eventType, `列${col}行${row}`, result, military, state);
  }

  const subRoll = rollDie();
  const areas = ['yonaguni', 'taketomi', 'ishigaki', 'miyako'] as AreaId[];
  const targetArea = areas[Math.floor(Math.random() * 4)];
  const areaName = state.areas[targetArea].name;

  if (eventType === 'D') {
    // イベントD: 直接攻撃・占領
    const chinaTotal = military.chineseSea + military.chineseAir;
    const jsdfTotal = military.jsdfSea + military.jsdfAir;
    const areaOccupied = isOccupied(state, targetArea) || !!result.occupiedToday[targetArea];

    if (subRoll <= 2) {
      // 市街ミサイル攻撃 (ver4.0 6.6): 3ダイス + 中国軍 − (警護 + 防護範囲内PAC3×1) − 3×抗堪性。尖閣補正なし。
      if (areaOccupied) {
        result.log.push(`[イベントD|出目${subRoll}] 【市街ミサイル攻撃】${areaName} は既に占領済み → 無効`);
        return `【市街攻撃無効】${areaName} 既に占領済み`;
      }
      // ver4.0 4.4④: 無人集落への攻撃は無効（当日既計上の撃墜/撃沈死者 deadByArea を差し引いた残存で判定）
      if (alivePop(state, result, targetArea) <= 0) {
        result.log.push(`[イベントD|出目${subRoll}] 【市街ミサイル攻撃】${areaName} は無人 → 無効`);
        return `【市街攻撃無効】${areaName} 無人`;
      }
      const pac3 = pac3For(targetArea, military);
      const diceSum = sumDice(3);
      const calcValue = diceSum + chinaTotal - (jsdfTotal + pac3) - 3 * state.shelterLevel;
      result.log.push(`[イベントD|出目${subRoll}] 【市街ミサイル攻撃】${areaName}: ダイス${diceSum}+中${chinaTotal}-(自${jsdfTotal}+PAC3${pac3})-抗堪${state.shelterLevel}×3=計${calcValue}`);
      if (calcValue >= 11) {
        // ③ 数百名: 0.5コマ死亡・当該疲労+1(DMAT処理側で加算)・DMAT対象(major)
        result.log.push('  ⚠️ 数百名の死傷者! 0.5コマ死亡・当該エリア疲労+1・DMAT対象');
        result.newDead += 0.5; // 計上値（人口除去と死者確定は prepareDayPhase1 7b' の逐次DMAT処理で行う）
        result.dmatDeathAreas.push({ area: targetArea, severity: 'major' });
        return `【市街攻撃・数百名】${areaName} 計${calcValue}≥11 0.5コマ死亡`;
      } else if (calcValue >= 1) {
        // ② 数十名: コマ除去なし・当該疲労+1(DMAT処理側で加算)・DMAT対象(minor)
        result.log.push('  ⚠️ 数十名の死傷者。コマ除去なし・当該エリア疲労+1・DMAT対象');
        result.dmatDeathAreas.push({ area: targetArea, severity: 'minor' });
        return `【市街攻撃・数十名】${areaName} 計${calcValue}(1〜10) 疲労+1・DMAT対象`;
      }
      return `【市街攻撃】${areaName} 計${calcValue}≤0 被害なし`;
    } else if (subRoll <= 4) {
      // 島上陸・ヘリボーン (3ダイス): 合計+中−自 ≧15（尖閣占領なら ≧12）
      if (areaOccupied) {
        result.log.push(`[イベントD|出目${subRoll}] 【上陸/ヘリボーン】${areaName} は既に占領済み → 無効`);
        return `【上陸無効】${areaName} 既に占領済み`;
      }
      const diceSum = sumDice(3);
      const calcValue = diceSum + chinaTotal - jsdfTotal;
      const threshold = military.senkakuOccupied ? 12 : 15;
      result.log.push(`[イベントD|出目${subRoll}] 【上陸/ヘリボーン】${areaName}: ダイス${diceSum}+中${chinaTotal}-自${jsdfTotal}=計${calcValue} / 閾値${threshold}${military.senkakuOccupied ? '(尖閣占領)' : ''}`);
      if (calcValue >= threshold) {
        // ver4.0 6.4.2/3: エリア全域占領 = 残存コマは全員死傷。全4エリア疲労+2。以後そのエリアは占領状態。
        // 全滅死者数の確定と人口の0化は prepareDayPhase1 7a（当日既計上の死者を差し引き二重計上を防ぐ）。
        result.occupiedToday[targetArea] = true;
        areas.forEach(x => { result.fatigueIncrease[x] += 2; });
        result.log.push(`  ⚠️ 上陸成立! ${areaName} を占領 → 残存コマ全員死傷・全4エリア疲労+2・以後このエリアへの攻撃/避難は無効`);
        return `【島上陸成立】${areaName} 占領 計${calcValue}≥${threshold} 残存コマ全滅`;
      }
      return `【上陸試み】${areaName} 計${calcValue}<${threshold} 撃退`;
    } else if (subRoll === 5) {
      // 自衛隊喪失-1 (ver4.0 6.4.5): 2ダイス + 中国軍 − 警護 ≧13（尖閣占領なら ≧11）
      const diceSum = sumDice(2);
      const calcValue = diceSum + chinaTotal - jsdfTotal;
      const threshold = military.senkakuOccupied ? 11 : 13;
      result.log.push(`[イベントD|出目${subRoll}] 【自衛隊喪失判定】ダイス${diceSum}+中${chinaTotal}-自${jsdfTotal}=計${calcValue} / 閾値${threshold}${military.senkakuOccupied ? '(尖閣占領)' : ''}`);
      if (calcValue >= threshold) {
        // 海自/空自のうち多い方を−1（同数なら海自）。対象が0なら無効。
        if (military.jsdfSea <= 0 && military.jsdfAir <= 0) {
          result.log.push('  自衛隊喪失成立だが海自・空自とも0 → 無効');
          return `【自衛隊喪失】計${calcValue}≥${threshold} 対象なし(無効)`;
        }
        if (military.jsdfSea >= military.jsdfAir) {
          military.jsdfSea -= 1;
          result.log.push(`  ⚠️ 海自 海空警護 −1 → 海自${military.jsdfSea}・空自${military.jsdfAir}`);
          return `【自衛隊喪失】計${calcValue}≥${threshold} 海自−1`;
        }
        military.jsdfAir -= 1;
        result.log.push(`  ⚠️ 空自 空域警護 −1 → 海自${military.jsdfSea}・空自${military.jsdfAir}`);
        return `【自衛隊喪失】計${calcValue}≥${threshold} 空自−1`;
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
          result.log.push('  ⚠️ 尖閣諸島占領! 以後の各判定閾値が不利側へ(撃墜/上陸≧12・施設≧14・喪失≧11)');
          result.senkakuOccupied = true;
          military.senkakuOccupied = true; // 当日以降のイベントにも即時反映
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
  seaMul: Record<AreaId, number> = { yonaguni: 1, taketomi: 1, ishigaki: 1, miyako: 1 },
  // ピストン発火判定用の空港可否（当日限りの一時閉鎖=サイバー/大乱闘/ボイコット/ドローンを含めない）。省略時は airportAvail
  hubAirportAvail: Record<string, boolean> = airportAvail
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
  // 存立危機で竹富町各島・与那国→石垣港/新石垣空港 への避難が可能なのは Lv2以上(CRISIS_EVAC_MIN_LEVEL)。
  // ver4.0 6.4.2/3: 占領済みエリアは避難容量0（送出側）。占領済みハブ(石垣/宮古)への集約も不可。
  const occFactor = (a: AreaId) => (isOccupied(state, a) ? 0 : 1);
  const ishigakiPortOpen = state.infra.ishigakiPort && !isOccupied(state, 'ishigaki') && (isWartime || (isCrisis && prepLevel >= CRISIS_EVAC_MIN_LEVEL));

  // 与那国空港→本土: 平時0 / 存立危機(Lv2+)1便 / 有事は便数表
  const yonaguniAirMax = airportAvail.yonaguni && airRouteOk('yonaguni')
    ? (isWartime ? settings.airFlightsWartime.yonaguni : (isCrisis && prepLevel >= CRISIS_EVAC_MIN_LEVEL) ? 1 : 0)
    : 0;

  // 与那国→石垣フェリー(久部良港発): 石垣港が開いている時のみ(存立危機はLv2+、有事は常時)
  const yonaguniSeaMax = seaOk && ishigakiPortOpen && shipRouteOk('kubura') && state.infra.kuburaPort !== false ? YONAGUNI_TO_ISHIGAKI_FERRY : 0;

  // 竹富→石垣フェリー: 同上(存立危機Lv2+ / 有事)。路線名指し無しのため路線別停止は適用しない。
  const taketomiFerryMax = seaOk && ishigakiPortOpen ? TAKETOMI_TO_ISHIGAKI_FERRY_MAX : 0;

  // 波照間空港→新石垣空港 民間航空便（仕様2026.7.6 Sec4）。Lv4以上で 0.5コマ/日。竹富エリアの避難補助。
  // 条件: Lv別便数>0 かつ 波照間空港が利用可(infra.haterumaAirport & 天候OK) かつ 路線停止でない(disabledAirRoutes.hateruma)
  //       かつ 民間航空全停止でない。空港破壊/強風/大雨/路線停止時は0。
  // 島外避難の可否は本土便と同じゲート(有事は常時 / 存立危機はLv2以上)に整合させる。
  //       着側(新石垣空港)も使用可でなければ着陸できないため airportAvail.shinIshigaki & airRouteOk('shinIshigaki') も条件に含める。
  const haterumaLevelFlights = HATERUMA_AIR_FLIGHTS_BY_LEVEL[prepLevel] ?? 0;
  const haterumaEvacAllowed = isWartime || (isCrisis && prepLevel >= CRISIS_EVAC_MIN_LEVEL);
  const haterumaAirMax =
    haterumaLevelFlights > 0 && haterumaEvacAllowed && !isOccupied(state, 'ishigaki') &&
    airportAvail.hateruma && airRouteOk('hateruma') &&
    airportAvail.shinIshigaki && airRouteOk('shinIshigaki')
      ? haterumaLevelFlights
      : 0;

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
  // 一時閉鎖（当日限り）ではハブ機能喪失とみなさない（hubAirportAvail）。
  // ver4.0 4.8: 新石垣空港・宮古空港・下地島空港の「いずれか」が破壊／運航拒否／撃墜されたら発動可能。
  //   新石垣がダウン → 石垣→宮古（宮古・下地島のどちらかが使えること）
  //   宮古または下地島がダウン → 宮古→石垣（新石垣が使えること）
  const shinOk = hubAirportAvail.shinIshigaki && airRouteOk('shinIshigaki');
  const miyakoAptOk = hubAirportAvail.miyako && airRouteOk('miyako');
  const shimojiAptOk = hubAirportAvail.shimoji && airRouteOk('shimoji');
  let shuttleActive = false;
  let shuttleFrom: AreaId | null = null;
  let shuttleTo: AreaId | null = null;
  const shuttleDir: [AreaId, AreaId] | null =
    !shinOk && (miyakoAptOk || shimojiAptOk) ? ['ishigaki', 'miyako']
    : shinOk && (!miyakoAptOk || !shimojiAptOk) ? ['miyako', 'ishigaki']
    : null;
  if (isWartime && prepLevel >= SHUTTLE_MIN_LEVEL && shuttleDir) {
    [shuttleFrom, shuttleTo] = shuttleDir;
    // 占領済みハブへは集約不可／占領済みハブからは送出不可
    shuttleActive = !isOccupied(state, shuttleFrom) && !isOccupied(state, shuttleTo);
    if (!shuttleActive) { shuttleFrom = null; shuttleTo = null; }
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
  // ver4.0 6.3.6 不時着ペナルティ: 当該エリアの手数 h=handsByFatigue に対し (h−penalty)/h を容量に掛ける（h=0なら0）。
  // ペナルティが無いエリアは従来どおり（手数は疲労限界判定にのみ使う）。
  const penFactor = (a: AreaId): number => {
    const pen = activeHandPenalty(state, a);
    if (pen <= 0) return 1;
    const h = handsByFatigue(a, state.areas[a].fatigue);
    return h > 0 ? Math.max(0, (h - pen) / h) : 0;
  };
  // 占領済みエリアは全容量0（occFactor）
  const my = capMul.yonaguni * occFactor('yonaguni') * penFactor('yonaguni'), mt = capMul.taketomi * occFactor('taketomi') * penFactor('taketomi'),
    mi = capMul.ishigaki * occFactor('ishigaki') * penFactor('ishigaki'), mm = capMul.miyako * occFactor('miyako') * penFactor('miyako');
  // 海路専用倍率(機雷など)。海路フィールドにのみ追加で掛ける。空路には掛けない。
  const sy = seaMul.yonaguni, st = seaMul.taketomi, si = seaMul.ishigaki, sm = seaMul.miyako;
  // ピストン輸送は送出側ハブ(shuttleFrom)のイベント倍率を適用する。
  const cmSF = shuttleFrom ? capMul[shuttleFrom] * occFactor(shuttleFrom) * penFactor(shuttleFrom) : 1;
  const smSF = shuttleFrom ? seaMul[shuttleFrom] : 1;
  return {
    yonaguniAirMax: r05(yonaguniAirMax * my), yonaguniSeaMax: r05(yonaguniSeaMax * my * sy),
    taketomiFerryMax: r05(taketomiFerryMax * mt * st),
    // 波照間航空便は空路なので海路倍率(st)は掛けず、竹富エリアのイベント容量倍率(mt)のみ適用。
    haterumaAirMax: r05(haterumaAirMax * mt),
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

  // 2. 地震（ver4.0 4.10）: 1時に4ダイス 6-6-6-6 で発生 → 規模ダイス1〜6。
  //    施設破壊は当日のイベント判定にも反映（破壊済み施設への攻撃は無効）。死者は 7b で人口比に実除去。
  //    行動停止時間は当日容量倍率で近似（規模5=翌日半分・規模6=翌日0 は翌日の prepareDayPhase1 で state.earthquakeLevel から適用）。
  const eqSeverity = checkEarthquake(state, log);
  let earthquakeDay = state.earthquakeDay;
  let earthquakeLevel = state.earthquakeLevel;
  let eq: EarthquakeEffect | null = null;
  if (eqSeverity !== null) {
    eq = resolveEarthquake(eqSeverity, state.infra);
    earthquakeDay = day;
    earthquakeLevel = eqSeverity;
    const stopJp = { 1: '3時間', 2: '6時間', 3: '12時間', 4: '24時間', 5: '36時間', 6: '48時間' }[eqSeverity] ?? '';
    log.push(`🌊 地震 規模${eqSeverity}: 津波${eq.tsunamiM}m。行動停止${stopJp}（本日の輸送容量×${eq.capMul.toFixed(2)}${eq.nextDayCapMul < 1 ? `・翌日×${eq.nextDayCapMul}` : ''}）`);
    log.push(eq.destroyedJp.length ? `  破壊施設: ${eq.destroyedJp.join('・')}${eqSeverity >= 2 ? '（民間船舶不可。海保・海自はボート等で継続可）' : ''}` : '  破壊施設: なし');
    log.push(eq.deaths > 0
      ? `  死者${eq.deaths}コマ（人のいるエリアへ人口比で分配・1コマごとに当該エリア疲労+1）／DMAT派遣: ${eq.dmatAreas.length ? eq.dmatAreas.map(a => state.areas[a].name).join('・') + ' のみ可' : '不可'}`
      : '  被害なし');
  }
  // 翌日への持ち越し停止（規模5=翌日半分・規模6=翌日0）
  let eqCarryMul = 1;
  if (state.earthquakeDay === day - 1 && state.earthquakeLevel !== null) {
    eqCarryMul = resolveEarthquake(state.earthquakeLevel, state.infra).nextDayCapMul; // 規模5=0.5 / 規模6=0（表と一元管理）
    if (eqCarryMul < 1) log.push(`🌊 前日の地震（規模${state.earthquakeLevel}）の行動停止が継続 → 本日の輸送容量×${eqCarryMul}`);
  }
  const infraAfterEq: InfraState = { ...state.infra, ...(eq?.infra ?? {}) };

  // 3. 天候更新 (1:00 & 13:00)。午前(1時)と午後(13時)の風速・風向は日別ログに併記する
  // 天候ダイスの行は日報の「午前」「午後」欄へ分けて載せる（イベントログには混ぜない）
  const amDice: string[] = [];
  const pmDice: string[] = [];
  const amWeather = updateWeather(state.weather, month, amDice);
  const newWeather = updateWeather(amWeather, month, pmDice);
  const windSummary = `午前 ${windLabelOf(amWeather, month)} ／ 午後 ${windLabelOf(newWeather, month)}`;

  // 4. 空港・港の利用可否（大雨＝海路全停止+空港閉鎖 / 強風＝海路停止+風向次第で欠航。両者は独立）
  const airportAvail = checkAirportAvailability(newWeather, month, infraAfterEq);
  const seaOk = isSeaAvailable(newWeather, month);

  const weatherSummary = buildWeatherSummary(newWeather, month, airportAvail, seaOk);
  // 天候は日報の「午前」「午後」欄に集約（イベントログには重複して載せない）

  // 5. 軍事配置 (4:00)
  const newMilitary = updateMilitary({ ...state, phase: newPhase }, log);

  // 5a. PAC3 撤収・再配備（ver4.0 4.12）: 有事に片方ハブ(石垣/宮古)の避難が完了し、もう一方が未完了なら
  //     完了側のPAC3を全て未完了側へ移す（通常上限2は撤廃）。一度だけ。
  let pac3Relocated = state.pac3Relocated ?? false;
  if (!pac3Relocated && newPhase === 'wartime') {
    const areaTotal = (id: AreaId) => {
      const a = state.areas[id];
      return a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0);
    };
    // 占領による全滅は「避難完了」ではない（占領エリアからPAC3は回収できない）
    const ishigakiDone = areaTotal('ishigaki') === 0 && !isOccupied(state, 'ishigaki');
    const miyakoDone = areaTotal('miyako') === 0 && !isOccupied(state, 'miyako');
    // 移送先が占領済みなら再配備しない
    if (ishigakiDone && !miyakoDone && !isOccupied(state, 'miyako') && newMilitary.pac3Ishigaki > 0) {
      const moved = newMilitary.pac3Ishigaki;
      newMilitary.pac3Miyako += moved;
      newMilitary.pac3Ishigaki = 0;
      pac3Relocated = true;
      log.push(`PAC3再配備: 石垣島の避難完了 → 石垣PAC3 ${moved}基を宮古島へ撤収・再配備（宮古PAC3 計${newMilitary.pac3Miyako}）`);
    } else if (miyakoDone && !ishigakiDone && !isOccupied(state, 'ishigaki') && newMilitary.pac3Miyako > 0) {
      const moved = newMilitary.pac3Miyako;
      newMilitary.pac3Ishigaki += moved;
      newMilitary.pac3Miyako = 0;
      pac3Relocated = true;
      log.push(`PAC3再配備: 宮古島の避難完了 → 宮古PAC3 ${moved}基を石垣島へ撤収・再配備（石垣PAC3 計${newMilitary.pac3Ishigaki}）`);
    }
  }

  // 5b. 自衛隊輸送臨時増援交渉（ver4.0 4.9）: 事前準備Lv3以上。対象は陸自ヘリ・海自輸送艦・空自輸送機（海保は対象外）。
  //     ある手段の残回数が0のとき、その手段について1日1回交渉できる（任意エリアの1手消費＝本モデルでは表現不要・ログのみ）。
  //     ダイス1回: 出目1〜Lv(Lv6は5) → 成功でその手段+1コマ使い切り。失敗は翌日再試行。獲得分を使い切る（残0）まで次の交渉は不可。
  //     自衛隊輸送手段は有事でのみ使うため、交渉は有事に限る（平時・存立危機で初期0の手段に毎日+1が付くのを防ぐ）。
  //     避難実行後に残0になった手段は executeDayPhase2 側で同日中に交渉する（当日成功分は翌日から使用可）。
  //     1手消費は handPenalty{negotiation} で表現（当日=untilDay=当日 → 当日容量に反映）。
  const rein1 = negotiateReinforcement({
    day, phase: newPhase, prepLevel: state.prepLevel,
    remaining: { jgsdf: state.transport.jgsdfRemaining, jmsdf: state.transport.jmsdfRemaining, jasdf: state.transport.jasdfRemaining },
    areas: state.areas,
    occupied: { yonaguni: isOccupied(state, 'yonaguni'), taketomi: isOccupied(state, 'taketomi'), ishigaki: isOccupied(state, 'ishigaki'), miyako: isOccupied(state, 'miyako') },
    reinforcement: state.reinforcement, handPenalty: state.handPenalty, when: 'beforeEvac',
  }, log);
  const reinforcement = rein1.reinforcement;
  const reinGain = rein1.gain;

  // 6. 24時間イベント（地震で破壊された施設は当日のイベント判定で「既破壊」として扱う）
  // 地震死者の配分は1時の地震判定直後に確定し（eqDist）、当日のイベント無人判定(alivePop)で予約量として差し引く。
  // 実際の人口除去は 7b0 で eqDist を使って1回のみ行う（二重除去なし）。
  let eqDist: Record<AreaId, number> = { yonaguni: 0, taketomi: 0, ishigaki: 0, miyako: 0 };
  if (eq && eq.deaths > 0) {
    const aliveMap: Record<AreaId, number> = { yonaguni: 0, taketomi: 0, ishigaki: 0, miyako: 0 };
    for (const id of Object.keys(state.areas) as AreaId[]) {
      const a = state.areas[id];
      aliveMap[id] = isOccupied(state, id) ? 0 : a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0);
    }
    eqDist = distributeDeaths(eq.deaths, aliveMap);
  }
  const eventResult = generateDailyEvents({ ...state, phase: newPhase, military: newMilitary, infra: infraAfterEq }, eqDist);
  log.push(...eventResult.log);
  // 地震の発電所破壊を既存の停電疲労機構へ接続: 石垣/宮古は即時+1（以後毎日は 7 の powerOutage）、多良間/波照間は一時疲労
  if (eq) {
    if (eq.infra.powerIshigaki === false) { eventResult.fatigueIncrease.ishigaki += 1; log.push('  地震: 石垣島発電所破壊 → 停電・断水 即時 疲労+1、以後毎日 疲労+1(夏季+2)'); }
    if (eq.infra.powerMiyako === false) { eventResult.fatigueIncrease.miyako += 1; log.push('  地震: 宮古島発電所破壊 → 停電・断水 即時 疲労+1、以後毎日 疲労+1(夏季+2)'); }
    if (eq.infra.powerYonaguni === false) { eventResult.fatigueIncrease.yonaguni += 1; log.push('  地震: 与那国発電所破壊 → 停電・断水 即時 疲労+1、以後毎日 疲労+1(夏季+2)'); }
    if (eq.infra.powerTarama === false) { eventResult.taramaPowerBrokenToday = true; log.push('  地震: 多良間発電所破壊 → 多良間島疲労度を宮古・多良間へ加算(即時+1・翌日+1・最大2)'); }
    if (eq.infra.powerHateruma === false) { eventResult.haterumaPowerBrokenToday = true; log.push('  地震: 波照間発電所破壊 → 波照間島疲労度を竹富町各島へ加算(即時+1・翌日+1・最大2)'); }
  }
  // 行動停止時間（当日＋前日からの持ち越し）を全エリアの容量倍率へ
  {
    const stopMul = (eq?.capMul ?? 1) * eqCarryMul;
    if (stopMul < 1) for (const id of Object.keys(eventResult.capacityMultiplier) as AreaId[]) eventResult.capacityMultiplier[id] *= stopMul;
  }

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
  if (fRose) log.push(`フェーズ${eventPhase(day)}に上昇 → 全エリア疲労+1`);

  // 7a. 占領状態の引き継ぎ（当日占領分の全滅処理は DMAT処理後の 7b' で確定する）
  const occupied: Record<AreaId, boolean> = {
    yonaguni: isOccupied(state, 'yonaguni'), taketomi: isOccupied(state, 'taketomi'),
    ishigaki: isOccupied(state, 'ishigaki'), miyako: isOccupied(state, 'miyako'),
  };

  // 7b0. 地震死者（ver4.0 4.10）: 1時発生のため攻撃死より先に処理。人のいるエリアへ人口比で分配し removeFromArea で実除去。
  //      1コマ死亡ごとに当該エリア疲労+1。DMAT可能エリア（規模2/3=石垣・宮古、4=宮古のみ、5/6=不可）で未派遣なら追加死+1コマ・疲労+1。
  let dmatRemaining = state.dmatRemaining;
  let dmatExtraDead = 0;
  let attackRemoved = 0;
  if (eq && eq.deaths > 0) {
    const dist = eqDist; // 1時に確定した配分（イベント無人判定で予約済み）をそのまま除去する
    let eqRemovedTotal = 0;
    for (const id of Object.keys(dist) as AreaId[]) {
      const n = dist[id];
      if (n <= 0) continue;
      const aa = areasAfterEvents[id];
      const removed = removeFromArea(aa, n);
      eqRemovedTotal += removed;
      attackRemoved += removed;
      const fat = Math.ceil(removed); // 1コマ死亡ごとに疲労+1（残存0.5コマの端数死も1件として+1）
      aa.fatigue += fat;
      const name = state.areas[id].name;
      log.push(`🌊 地震死者: ${name} ${removed}コマ死亡・疲労+${fat}`);
      if (removed <= 0) continue;
      const alive = aa.residents + aa.tourists + aa.vulnerable + aa.stagingPort + (aa.stagingVulnerable ?? 0);
      if (alive <= 0) { log.push(`  ${name}: 無人になったため追加被害なし（DMAT消費なし）`); continue; }
      const dmatAllowed = eq.dmatAreas.includes(id);
      if (dmatAllowed && dmatRemaining > 0) {
        dmatRemaining -= 1;
        log.push(`  DMAT派遣: ${name}の地震被害に対応（残り${dmatRemaining}回）→ 追加被害を防止`);
      } else {
        const extra = removeFromArea(aa, 1);
        dmatExtraDead += extra;
        aa.fatigue += 1;
        const reason = dmatAllowed ? 'DMAT未派遣(残0)' : (eq.severity >= 5 ? 'DMAT派遣不可(規模5以上)' : eq.severity === 4 && id === 'ishigaki' ? 'DMAT派遣不可(石垣病院水没)' : 'DMAT派遣不可(石垣・宮古以外)');
        log.push(`  ⚠️ ${reason}: ${name} → 追加死者${extra}コマ・疲労+1`);
      }
    }
    if (eqRemovedTotal < eq.deaths) log.push(`🌊 地震死者${eq.deaths}コマのうち残存人口を超える${eq.deaths - eqRemovedTotal}コマは発生しない（実死者${eqRemovedTotal}）`);
  }

  // 7b. 撃墜/撃沈/輸送アセット攻撃の死者（deadByArea）を当該エリアの人口から実際に除去する。
  //     当日死者は「実際に除去できた数」で集計する（無人エリアでは死者は発生しない＝人口保存則）。
  for (const id of Object.keys(areasAfterEvents) as AreaId[]) {
    const atk = eventResult.deadByArea[id];
    if (atk <= 0) continue;
    const r1 = removeFromArea(areasAfterEvents[id], atk);
    attackRemoved += r1;
    if (atk - r1 > 0) log.push(`${state.areas[id].name}: 死者${atk}コマ計上のうち残存人口を超える${atk - r1}コマは発生しない（実死者${r1}）`);
  }

  // 7b'. DMAT連動（ver4.0 4.11/6.6/6.7）: 市街攻撃/施設破壊の死傷者を発生順に1件ずつ逐次処理する。
  //      「攻撃死(major 0.5)を人口除去 → 除去後に無人なら被害なし(DMAT不要・疲労なし) → 当該疲労+1 → DMAT判定」。
  //      派遣可能は石垣島・宮古島のみ（与那国・竹富は派遣不可＝常に追加被害）。DMAT残>0なら1消費して追加被害を防ぐ。
  //      追加被害（未派遣/派遣不可）: major → 追加死者0.5コマ＋当該疲労+1 ／ minor → 追加死者0＋当該疲労+1。除去後の人口を次の判定に使う。
  const alive = (a: AreaState) => a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0);
  for (const { area, severity } of eventResult.dmatDeathAreas) {
    const name = state.areas[area].name;
    const sevJp = severity === 'major' ? '数百名' : '数十名';
    const aa = areasAfterEvents[area];
    if (alive(aa) <= 0) {
      log.push(`${name}の死傷者(${sevJp}): 無人エリアのため被害なし（DMAT消費なし）`);
      continue;
    }
    // 攻撃死（major=0.5コマ）を人口から実除去
    const atkDead = severity === 'major' ? 0.5 : 0;
    attackRemoved += removeFromArea(aa, atkDead);
    aa.fatigue += 1; // 死傷者発生 → 当該エリア疲労+1
    if (alive(aa) <= 0) {
      // 攻撃死で無人になった → 追加被害は起こり得ず、DMAT派遣も不要（消費しない）
      log.push(`${name}の死傷者(${sevJp}): 攻撃死で無人になったため追加被害なし（DMAT消費なし）`);
      continue;
    }
    const dmatAllowed = area === 'ishigaki' || area === 'miyako';
    if (dmatAllowed && dmatRemaining > 0) {
      dmatRemaining -= 1;
      log.push(`DMAT派遣: ${name}の死傷者(${sevJp})に対応（残り${dmatRemaining}回）→ 追加被害を防止（疲労+1のみ）`);
      continue;
    }
    const extra = removeFromArea(aa, severity === 'major' ? 0.5 : 0); // 追加死者は残存人口の範囲で
    dmatExtraDead += extra;
    aa.fatigue += 1; // 追加被害 → 当該エリア疲労+1
    const reason = dmatAllowed ? 'DMAT未派遣(残0)' : 'DMAT派遣不可(石垣・宮古以外)';
    log.push(`⚠️ ${reason}: ${name}の死傷者(${sevJp}) → 追加死者${extra}コマ・疲労+1`);
  }

  // 7b'''. 上陸・ヘリボーンによる占領（ver4.0 6.4.2/3）: 当該エリアの残存コマ（死者除去後）を全滅させ0にする。
  let occupationDead = 0;
  for (const id of Object.keys(eventResult.occupiedToday) as AreaId[]) {
    if (!eventResult.occupiedToday[id]) continue;
    occupied[id] = true;
    const a = areasAfterEvents[id];
    const wiped = a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0) + a.stagingAirport;
    occupationDead += wiped;
    a.residents = 0; a.tourists = 0; a.vulnerable = 0; a.stagingPort = 0; a.stagingVulnerable = 0; a.stagingAirport = 0; a.inTransitToHub = 0;
    log.push(`⚠️ ${state.areas[id].name} 占領 → 残存${wiped}コマ全滅（死者+${wiped}）。以後このエリアの避難注文・攻撃判定は無効`);
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

  // 施設破壊などインフラ被害を反映（B1修正）し、被害後の空港利用可否を再計算（地震破壊分 infraAfterEq を含む）
  const damagedInfra: InfraState = { ...infraAfterEq, ...eventResult.infraPenalty };
  // 午前(1時の天候・地震後の施設) / 午後(13時の天候・当日イベント後の施設) を別々に要約
  // 悪天候（大雨/強風）で使えない施設（施設自体は健在）。マップの⛈️表示用。午後(13時)の天候で判定
  const wxAvail = checkAirportAvailability(newWeather, month, damagedInfra);
  const AIR_INFRA_FOR_WX: Record<string, keyof InfraState> = {
    shinIshigaki: 'shinIshigakiAirport', miyako: 'miyakoAirport', shimoji: 'shimojiAirport',
    yonaguni: 'yonagunAirport', hateruma: 'haterumaAirport', tarama: 'taramaAirport',
  };
  const weatherClosed: string[] = Object.entries(AIR_INFRA_FOR_WX)
    // 下地島空港は伊良部大橋経由でしか到達できない。橋の崩落による停止は悪天候ではないので除外
    .filter(([k, infraKey]) => damagedInfra[infraKey] && (k !== 'shimoji' || damagedInfra.bridgeIrabu) && !wxAvail[k])
    .map(([k]) => k);
  if (!isSeaAvailable(newWeather, month)) weatherClosed.push('sea');
  const halfDay = {
    am: { summary: halfDaySummary('午前', amWeather, month, checkAirportAvailability(amWeather, month, infraAfterEq), isSeaAvailable(amWeather, month), state.prepLevel), dice: amDice },
    pm: { summary: halfDaySummary('午後', newWeather, month, checkAirportAvailability(newWeather, month, damagedInfra), isSeaAvailable(newWeather, month), state.prepLevel), dice: pmDice },
  };
  const airportAvailFinal = checkAirportAvailability(newWeather, month, damagedInfra);
  // ピストン輸送の発火判定（ハブ機能喪失=破壊/運航拒否）には当日限りの一時閉鎖を含めない（コピーを保持）
  // ハブ機能喪失の判定は施設破壊・路線停止のみ（天候・一時閉鎖は含めない）。ver4.0 4.8: 破壊/運航拒否/撃墜が発火条件
  const airportAvailForHub: Record<string, boolean> = {
    ...airportAvailFinal,
    shinIshigaki: damagedInfra.shinIshigakiAirport,
    miyako: damagedInfra.miyakoAirport,
    shimoji: damagedInfra.shimojiAirport,
  };
  // ドローン・サイバー攻撃・乗員ボイコット・観光客大乱闘で当日のみ閉鎖される空港を反映（その空港だけ／同日24時まで）
  for (const apt of eventResult.facilityClosedToday) {
    if (apt in airportAvailFinal) airportAvailFinal[apt] = false;
  }

  // 7e. 不時着 手数ペナルティ（ver4.0 6.3.6）: 期限切れを除き、当日分（当日と翌日24時まで＝untilDay=day+1）を追加
  //     交渉(5b)の1手消費ペナルティ(rein1.handPenalty)を土台にする。
  const handPenalty: Record<AreaId, HandPenalty[]> = { yonaguni: [], taketomi: [], ishigaki: [], miyako: [] };
  for (const id of Object.keys(handPenalty) as AreaId[]) {
    handPenalty[id] = (rein1.handPenalty[id] ?? []).filter(p => p.untilDay >= day);
  }
  for (const l of eventResult.landingsToday) handPenalty[l.area].push({ country: l.country, untilDay: day + 1 });
  for (const id of Object.keys(handPenalty) as AreaId[]) {
    const pen = penaltyCount(handPenalty[id], day);
    if (pen > 0) {
      const h = handsByFatigue(id, areasAfterEvents[id].fatigue);
      const jp = (p: HandPenalty) => `${p.country === 'china' ? '中国機' : p.country === 'taiwan' ? '台湾機' : '交渉1手'} ${p.untilDay === day ? '本日' : '翌日'}24時まで`;
      log.push(`手数ペナルティ: ${state.areas[id].name} 手数${h}−${pen}=${Math.max(0, h - pen)}（${handPenalty[id].filter(p => p.untilDay >= day).map(jp).join('・')}）`);
    }
  }

  const stateAfterEvents: GameState = {
    ...state,
    phase: newPhase,
    weather: newWeather,
    areas: areasAfterEvents,
    infra: damagedInfra,
    // マップ表示用: 当日限りの使用不能施設（空港=空路キー / 港='ship:'+海路キー）。毎日上書き
    closedFacilitiesToday: [...eventResult.facilityClosedToday, ...eventResult.portClosedToday.map(p => `ship:${p}`)],
    // 4:00配備(newMilitary) → 当日イベント（自衛隊喪失-1・尖閣占領）を反映した eventResult.military を正とする。
    military: {
      ...eventResult.military,
      senkakuOccupied: newMilitary.senkakuOccupied || eventResult.senkakuOccupied || eventResult.military.senkakuOccupied,
    },
    occupied,
    pac3Relocated,
    earthquakeDay, earthquakeLevel,
    handPenalty,
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
      // 5b: 臨時増援交渉が成功した手段は +1コマ（使い切り）
      jgsdfRemaining: state.transport.jgsdfRemaining + reinGain.jgsdf,
      jmsdfRemaining: state.transport.jmsdfRemaining + reinGain.jmsdf,
      jasdfRemaining: state.transport.jasdfRemaining + reinGain.jasdf,
    },
    // DMAT残・一時疲労トラッカーを更新（冪等な戻し用に applied 量も保持）
    dmatRemaining,
    taramaTempFatigue, taramaTempApplied, taramaPowerBroken, taramaEvacDone,
    haterumaTempFatigue, haterumaTempApplied, haterumaPowerBroken, haterumaEvacDone,
    reinforcement,
  };

  // B2修正: 輸送停止フラグ・インフラ被害を反映した後で容量を計算する
  const capacities = getDayCapacities(stateAfterEvents, airportAvailFinal, seaOk, eventResult.capacityMultiplier, eventResult.seaCapacityMultiplier, airportAvailForHub);
  const evacRefusedToday = (Object.keys(eventResult.refusalToday) as AreaId[]).filter(a => eventResult.refusalToday[a]);

  return {
    evacRefusedToday,
    stateAfterEvents,
    newPhase, newMilitary, newWeather,
    airportAvail: airportAvailFinal, seaOk, capacities,
    capacityMultiplier: eventResult.capacityMultiplier,
    hourlyRolls: eventResult.hourlyRolls,
    eventLog: log,
    weatherSummary, windSummary, halfDay, weatherClosed, phaseChanged,
    dmatExtraDead,
    // 地震死＋攻撃死(人口から実際に除去できた分)＋占領によるエリア全滅。全て人口除去と一致（保存則）
    eventDead: attackRemoved + occupationDead,
  } as DayPhase1Result;
}

// ===== フェーズ2: プレイヤーの避難実行 =====
export function executeDayPhase2(
  originalState: GameState,
  phase1: DayPhase1Result,
  orders: EvacuationOrder[]
): { newState: GameState; log: DayLog } {
  const { stateAfterEvents, newPhase, newWeather, newMilitary, airportAvail, hourlyRolls, eventLog, weatherSummary, windSummary, halfDay, weatherClosed, capacities } = phase1;
  const { day } = stateAfterEvents;
  const dayLabel = day === 0 ? 'X日' : day > 0 ? `X+${day}日` : `X${day}日`;

  const evacLog: string[] = [];
  const evacuations: EvacuationRecord[] = [];
  let evacuatedCount = 0;

  // 深コピー
  const areas = JSON.parse(JSON.stringify(stateAfterEvents.areas)) as Record<AreaId, AreaState>;
  const transport = { ...stateAfterEvents.transport };

  // --- 避難オーダー実行 ---
  // 航空機手段（民間航空・空自輸送機・陸自ヘリ）は要援護者不可（ver4.0 4.6.5: 要援護者はフェリー/海保/海自のみ）
  const isAircraftMethod = (m: string) =>
    m.includes('空自輸送機') || m.includes('陸自ヘリ') || m.includes('民間航空') || (m.includes('空港') && m.includes('民間'));
  for (const order of orders) {
    // 占領済みエリアからの避難・占領済みハブへの集約は無効（自動注文以外の手動注文も実行側で弾く）
    if (isOccupied(stateAfterEvents, order.from)) {
      evacLog.push(`${order.method}: ${areas[order.from].name} は占領済みのため避難不可（注文無効）`);
      continue;
    }
    if (order.to !== 'mainland' && isOccupied(stateAfterEvents, order.to)) {
      evacLog.push(`${order.method}: 集約先 ${areas[order.to].name} は占領済みのため搬入不可（注文無効）`);
      continue;
    }
    // A表 住民の避難拒否: 当日その地区住民は避難しない（手動注文も無効化。ハブ待機コマの搬出は下で継続）
    if ((phase1.evacRefusedToday ?? []).includes(order.from)) {
      evacLog.push(`${order.method}: ${areas[order.from].name} は本日 住民の避難拒否のため避難不可（注文無効）`);
      continue;
    }
    const area = areas[order.from];
    let orderVuln = order.vulnerable;
    if (orderVuln > 0 && isAircraftMethod(order.method)) {
      evacLog.push(`${order.method}: 要援護者${orderVuln}コマは航空機不可のため搭載しない`);
      orderVuln = 0;
    }
    const total = order.residents + order.tourists + orderVuln;
    if (total <= 0) continue;

    // 要援護者は海路のみ
    const actualVuln = orderVuln;
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
    if (order.to === 'ishigaki' || order.to === 'miyako') {
      // 中継ハブ集約（西側フェリー流入 or ピストン）→ ハブで待機し、当日残の本土便容量があれば当日、無ければ翌以降に本土へ。
      // 要援護者は stagingVulnerable に分けて積む（海路のみで搬出・航空機不可）。
      areas[order.to].stagingPort += cappedRes + cappedTour;
      areas[order.to].stagingVulnerable = (areas[order.to].stagingVulnerable ?? 0) + cappedVuln;
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

    // 待機コマの海路搬出（ver4.0 4.6.5: 要援護者は海路のみ）。同日ordersが使った海路分を差し引いた残容量で、
    // 待機要援護者(stagingVulnerable)を優先し、残りで待機白コマ(stagingPort)を本土へ。民間フェリー → 海保輸送船 の順。
    const seaStaging = (hub: 'ishigaki' | 'miyako') => {
      const a = areas[hub];
      const used = (m: string) => evacuations.filter(e => e.from === hub && e.method === m).reduce((s, e) => s + e.count, 0);
      const ferryName = hub === 'ishigaki' ? '石垣港フェリー' : '平良港フェリー';
      const ferryCap = hub === 'ishigaki' ? capacities.ishigakiFerryMax : capacities.miyakoFerryMax;
      const cgCap = hub === 'ishigaki' ? capacities.ishigakiCoastGuardMax : capacities.miyakoCoastGuardMax;
      const jmsdfCap = hub === 'ishigaki' ? capacities.ishigakiJmsdfMax : capacities.miyakoJmsdfMax;
      // 海自輸送艦: 当日容量(同日注文使用分を差し引き) かつ 実残隻数>0 のとき1便
      const jmsdfLeg = transport.jmsdfRemaining > 0 ? Math.max(0, jmsdfCap - used('海自輸送艦')) : 0;
      const legs: Array<{ label: string; cap: number; consume: 'none' | 'cg' | 'jmsdf' }> = [
        { label: `${ferryName}(港待機)`, cap: Math.max(0, ferryCap - used(ferryName)), consume: 'none' },
        { label: '海保輸送船(港待機)', cap: Math.min(Math.max(0, cgCap - used('海保輸送船')), transport.coastGuardToday), consume: 'cg' },
        { label: '海自輸送艦(港待機)', cap: jmsdfLeg, consume: 'jmsdf' },
      ];
      for (const leg of legs) {
        if (leg.cap <= 0) continue;
        const sv = a.stagingVulnerable ?? 0;
        const v = Math.min(leg.cap, sv);
        const w = Math.min(leg.cap - v, a.stagingPort);
        if (v + w <= 0) continue;
        a.stagingVulnerable = sv - v;
        a.stagingPort -= w;
        evacuatedCount += v + w;
        if (leg.consume === 'cg') transport.coastGuardToday = Math.max(0, transport.coastGuardToday - Math.ceil(v + w));
        else if (leg.consume === 'jmsdf') transport.jmsdfRemaining = Math.max(0, transport.jmsdfRemaining - 1);
        evacuations.push({ from: hub, to: '本土', count: v + w, method: leg.label, isVulnerable: v > 0 });
        evacLog.push(`${leg.label}: 待機${v + w}コマ(要援護者${v}) → 本土`);
      }
    };
    seaStaging('ishigaki');
    seaStaging('miyako');
  }

  fixNegatives(areas);

  // --- 臨時増援交渉（ver4.0 4.9）: 当日の輸送で残0になった手段は同日中に交渉（当日未交渉のもののみ）。
  //     成功分は翌日から使用可（newTransport へ+1）。1手消費は翌日の1手（untilDay=翌日）として handPenalty に積む。
  const rein2 = negotiateReinforcement({
    day, phase: newPhase, prepLevel: stateAfterEvents.prepLevel,
    remaining: { jgsdf: transport.jgsdfRemaining, jmsdf: transport.jmsdfRemaining, jasdf: transport.jasdfRemaining },
    areas, occupied: stateAfterEvents.occupied ?? { yonaguni: false, taketomi: false, ishigaki: false, miyako: false },
    reinforcement: stateAfterEvents.reinforcement, handPenalty: stateAfterEvents.handPenalty, when: 'afterEvac',
  }, evacLog);
  transport.jgsdfRemaining += rein2.gain.jgsdf;
  transport.jmsdfRemaining += rein2.gain.jmsdf;
  transport.jasdfRemaining += rein2.gain.jasdf;

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
    // 死者0.5コマは人口から実際に除去する（翌日の占領全滅等で再計上しない）。
    const effAct = handsByFatigue(area.id, area.fatigue);
    // 判定対象は removeFromArea の除去対象と同じ（港待機コマも含む）
    const alive = area.residents + area.tourists + area.vulnerable + area.stagingPort + (area.stagingVulnerable ?? 0);
    if (effAct <= 0 && alive > 0) {
      fatigueDead += removeFromArea(area, 0.5);
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
      total: a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0),
      residents: a.residents,
      tourists: a.tourists,
      vulnerable: a.vulnerable,
      staging: a.stagingPort + (a.stagingVulnerable ?? 0),
      fatigue: a.fatigue,
    }])
  ) as DayLog['areaSnapshots'];

  const dLog: DayLog = {
    day,
    dayLabel,
    phase: newPhase,
    eventPhase: eventPhase(day),
    closedFacilities: stateAfterEvents.closedFacilitiesToday ?? [],
    weatherSummary,
    windSummary,
    halfDay,
    weatherClosed,
    // 避難実行後のログ（注文無効・避難後の増援交渉・一時疲労解除・疲労限界・X+3期限）も日次ログに含める
    events: [...eventLog, ...evacLog],
    evacuations,
    fatigueSummary: Object.values(areas).map((a) => {
      const h = handsByFatigue(a.id, a.fatigue);
      const pen = activeHandPenalty(stateAfterEvents, a.id, day);
      const hands = pen > 0 ? `手数${h}−${pen}(不時着)=${Math.max(0, h - pen)}` : `手数${h}`;
      return `${a.name}: 疲労${a.fatigue >= 0 ? '+' : ''}${a.fatigue.toFixed(1)} (${hands})`;
    }).join(' | '),
    totalEvacuatedSoFar: newEvacuated,
    totalDeadSoFar: newDead,
    areaSnapshots,
    hourlyRolls,
  };

  const newState: GameState = {
    ...stateAfterEvents,
    closedFacilitiesToday: [], // 当日限りの閉鎖マークは翌日へ持ち越さない（翌日の prepareDayPhase1 で再設定）
    day: newDay,
    phase: newPhase,
    weather: newWeather,
    areas,
    // stateAfterEvents.military は 4:00配備 + 当日イベント（自衛隊喪失-1・尖閣占領）を反映済み。
    // newMilitary で上書きすると当日の喪失/占領が翌日に引き継がれないため、stateAfterEvents.military を正とする。
    military: { ...stateAfterEvents.military, senkakuOccupied: newMilitary.senkakuOccupied || stateAfterEvents.military.senkakuOccupied },
    transport: newTransport,
    evacuated: newEvacuated,
    dead: newDead,
    dayLogs: [...originalState.dayLogs, dLog],
    isComplete,
    // 地震は prepareDayPhase1 で記録（翌日の持ち越し停止判定に使う）
    earthquakeDay: stateAfterEvents.earthquakeDay,
    earthquakeLevel: stateAfterEvents.earthquakeLevel,
    // 避難実行後の増援交渉（記録・翌日1手消費ペナルティ）
    reinforcement: rein2.reinforcement,
    handPenalty: rein2.handPenalty,
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
    // 輸送量の上限: 送出側が自力で本土へ出せない見込み分（不足）と、受け入れ側が本土へ出せる余力の小さい方。
    // 当日限りの閉鎖では発火しないが、発火時も必要以上に集約して受け入れ側があふれないようにする。
    const daysLeft = Math.max(1, 8 - state.day + 1);
    const popOf = (id: AreaId) => { const a = areas[id]; return a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0); };
    const hubDailyCap = (id: AreaId) => id === 'ishigaki'
      ? capacities.ishigakiAirMax + capacities.ishigakiCoastGuardMax + capacities.ishigakiFerryMax
      : capacities.miyakoAirMax + capacities.shimojAirMax + capacities.miyakoCoastGuardMax + capacities.miyakoFerryMax;
    const fromPop = popOf(fromId);
    const toPop = toDest === 'ishigaki' ? popOf('ishigaki') + popOf('taketomi') : popOf('miyako');
    // 受入側の余力は民間航空・フェリーのみで見積もる。海保・海自・空自は往復輸送と本土便で同じ便を共有するため、
    // 往復に回すとその分だけ受入側の本土便が減る（余力に含めると集約しすぎて取り残しが出る）。
    const hubCivilCap = (id: AreaId) => id === 'ishigaki'
      ? capacities.ishigakiAirMax + capacities.ishigakiFerryMax
      : capacities.miyakoAirMax + capacities.shimojAirMax + capacities.miyakoFerryMax;
    const fromDeficit = fromPop - hubDailyCap(fromId) * daysLeft;
    const toSpare = hubCivilCap(toDest) * daysLeft - toPop;
    let shuttleBudget = Math.max(0, Math.min(fromDeficit, toSpare));
    // 送出可能な人数（宮古発は橋孤立分を差し引く）。要援護者は船舶手段を優先的に割り当てる。
    const availRes = fromId === 'miyako' ? mRes : fromArea.residents;
    let remainingVuln = fromArea.vulnerable;
    let remainingRes = availRes;
    let remainingTour = fromArea.tourists;
    // (method, 容量, 要援護者可否). 船舶(海保/海自)・空自輸送機は要援護者可。民間航空/陸自ヘリは住民・観光客。
    // ver4.0 4.6.5: 空自輸送機は白コマのみ（要援護者は航空機不可）。要援護者はフェリー/海保/海自のみ。
    const legs: Array<{ method: string; cap: number; vulnOk: boolean }> = [
      { method: 'ピストン海保輸送船', cap: capacities.shuttleCoastGuardMax, vulnOk: true },
      { method: 'ピストン海自輸送艦', cap: capacities.shuttleJmsdfMax, vulnOk: true },
      { method: 'ピストン空自輸送機', cap: capacities.shuttleJasdfMax, vulnOk: false },
      { method: 'ピストン民間航空', cap: capacities.shuttleCivAirMax, vulnOk: false },
      { method: 'ピストン陸自ヘリ', cap: capacities.shuttleJgsdfMax, vulnOk: false },
    ];
    for (const leg of legs) {
      if (leg.cap <= 0 || shuttleBudget <= 0) continue;
      let budget = Math.min(leg.cap, shuttleBudget);
      const vuln = leg.vulnOk ? Math.min(remainingVuln, budget) : 0;
      budget -= vuln;
      const res = Math.min(remainingRes, budget);
      budget -= res;
      const tour = Math.min(remainingTour, budget);
      if (vuln + res + tour <= 0) continue;
      const moved = vuln + res + tour;
      shuttleBudget -= moved;
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
  let taketomiFerryRes = 0;
  let taketomiFerryTour = 0;
  if (capacities.taketomiFerryMax > 0) {
    const total = Math.min(capacities.taketomiFerryMax, areas.taketomi.residents + areas.taketomi.tourists);
    if (total > 0) {
      const res = Math.min(areas.taketomi.residents, total);
      const tour = Math.min(areas.taketomi.tourists, total - res);
      taketomiFerryRes = res;
      taketomiFerryTour = tour;
      orders.push({ from: 'taketomi', to: 'ishigaki', method: '竹富→石垣フェリー', residents: res, tourists: tour, vulnerable: 0 });
    }
  }

  // 波照間空港 → 新石垣空港 民間航空便（Lv4+ 0.5コマ/日）。竹富エリアの避難補助。
  // フェリーで運びきれなかった竹富住民・観光客を空輸する（海路停止時に特に有効。二重計上を避ける）。
  if (capacities.haterumaAirMax > 0 && airportAvail.hateruma && airportAvail.shinIshigaki) {
    const remainRes = Math.max(0, areas.taketomi.residents - taketomiFerryRes);
    const remainTour = Math.max(0, areas.taketomi.tourists - taketomiFerryTour);
    const total = Math.min(capacities.haterumaAirMax, remainRes + remainTour);
    if (total > 0) {
      const res = Math.min(remainRes, total);
      const tour = Math.min(remainTour, total - res);
      orders.push({ from: 'taketomi', to: 'ishigaki', method: '波照間空港(民間)', residents: res, tourists: tour, vulnerable: 0 });
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

  // 石垣 → 本土(空自輸送機) ※積極使用。ver4.0 4.6.5: 白コマ(住民・観光客)のみ。要援護者は航空機不可。
  if (jasdfIshigakiCap > 0 && airportAvail.shinIshigaki) {
    const cap = jasdfIshigakiCap;
    const res = Math.min(areas.ishigaki.residents, cap);
    const tour = Math.min(areas.ishigaki.tourists, cap - res);
    if (res + tour > 0) {
      orders.push({ from: 'ishigaki', to: 'mainland', method: '空自輸送機', residents: res, tourists: tour, vulnerable: 0 });
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

  // ver4.0 6.4.2/3: 占領済みエリアからの避難注文・占領済みハブへの集約注文は生成しない（容量0とも整合）
  // 占領済み・当日避難拒否（A表）のエリア発は除外。避難拒否は当該エリア発のみ（ハブ待機コマの搬出は executeDayPhase2 で継続）
  const refused = new Set(phase1.evacRefusedToday ?? []);
  return orders.filter(o => !isOccupied(state, o.from) && !refused.has(o.from) && !(o.to !== 'mainland' && isOccupied(state, o.to)));
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
    areas[key].stagingVulnerable = Math.max(0, areas[key].stagingVulnerable ?? 0);
    areas[key].stagingAirport = Math.max(0, areas[key].stagingAirport);
  }
}

// エリア人口から n コマを除去（住民→観光客→要援護者→待機白コマ→待機要援護者の順）。実際に除去できた数を返す。
function removeFromArea(a: AreaState, n: number): number {
  if (n <= 0) return 0;
  let r = n;
  const rRes = Math.min(r, a.residents); a.residents -= rRes; r -= rRes;
  const rTour = Math.min(r, a.tourists); a.tourists -= rTour; r -= rTour;
  const rVuln = Math.min(r, a.vulnerable); a.vulnerable -= rVuln; r -= rVuln;
  const rStg = Math.min(r, a.stagingPort); a.stagingPort -= rStg; r -= rStg;
  const sv = a.stagingVulnerable ?? 0;
  const rStgV = Math.min(r, sv); a.stagingVulnerable = sv - rStgV; r -= rStgV;
  return n - r;
}

// 風速・風向ラベル（例: 微風(北東)）。午前/午後の併記に使う
function windLabelOf(weather: WeatherState, month: number): string {
  const dir = ['西', '北西', '北東', '東', '南東', '南西'][weather.windDirectionIndex - 1];
  const spd = isStrongWind(weather.windSpeedIndex, month) ? '強風' : '微風';
  return `${spd}(${dir})`;
}

// 半日（午前/午後）の要約: 「午前 大雨 微風 北東 閉鎖 海港、与那国、新石垣、宮古、下地島」（区切りは全角スペース）
function halfDaySummary(
  label: string, weather: WeatherState, month: number,
  airportAvail: Record<string, boolean>, seaOk: boolean, prepLevel: number
): string {
  const cond = weather.condition === 'sunny' ? '晴' : weather.condition === 'cloudy' ? '曇' : weather.condition === 'rain' ? '雨' : '大雨';
  const speed = isStrongWind(weather.windSpeedIndex, month) ? '強風' : '微風';
  const dir = ['西', '北西', '北東', '東', '南東', '南西'][weather.windDirectionIndex - 1];
  const closed: string[] = [];
  if (!seaOk) closed.push('海港');
  if (!airportAvail.yonaguni) closed.push('与那国');
  if (!airportAvail.shinIshigaki) closed.push('新石垣');
  if (!airportAvail.miyako) closed.push('宮古');
  if (!airportAvail.shimoji) closed.push('下地島');
  if (!airportAvail.tarama) closed.push('多良間');
  if (prepLevel >= 4 && !airportAvail.hateruma) closed.push('波照間'); // 波照間空港はLv4以上のみ使用
  const sp = '\u3000'; // 全角スペース
  return [label, cond, speed, dir, '閉鎖', closed.length ? closed.join('、') : 'なし'].join(sp);
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
