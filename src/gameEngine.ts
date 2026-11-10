// OKIRES2026 ゲームエンジン

import { facilityStatusAll } from './facilities';
import { islandSnapshot, isolatedByOf, isolatedSum } from './islands';
import {
  computeDaySlots, civFlightsBefore, ferryDepartures, seaWeatherOk, airWeatherOk, tportKomaPerTrip,
  type TimedClosure, type SlotInput, type DaySlots, type AirKey,
} from './timetable';
import type {
  GameState, SetupConfig, AreaId, AreaState,
  WeatherState, MilitaryState, TransportState, InfraState,
  ActiveEvent, DayLog, EvacuationRecord, Phase, ForcedEvent,
  HourlyRoll, EvacuationOrder, DayCapacities, DayPhase1Result,
  AirRouteKey, ShipRouteKey, HandPenalty, ReinforcementMeans, WeatherCondition,
  EvacPolicy, VulnerableBreakdown, VulnerableCategory, TaketomiPortKey, AirportLanding } from './types';
import {
  getWeatherTrack, getInitialWeatherIndex, getInitialWindSpeedIndex,
  getInitialWindDirectionIndex, isStrongWind, AIRPORT_ALLOWED_WIND_DIRECTIONS,
  PREP_LEVEL_SETTINGS, YONAGUNI_TO_ISHIGAKI_FERRY,
  TAKETOMI_PORT_CAPACITY, TARAMA_TRANSFER_CAPACITY, TAKETOMI_PORT_JP, SETTLEMENT_SHARE, SETTLEMENT_COST_FACTOR, MIYAKO_ISLAND_SHARE,
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

// ===== 要支援者モデル（④）: 要援護者コマのカテゴリ内訳 =====
// 比率: 乳幼児15% / 高齢者55% / 車椅子15% / 医療依存15%（端数は高齢者へ）
export const VULNERABLE_CATEGORIES: VulnerableCategory[] = ['infant', 'elderly', 'wheelchair', 'medical'];
export const VULNERABLE_RATIO: VulnerableBreakdown = { infant: 0.15, elderly: 0.55, wheelchair: 0.15, medical: 0.15 };
export const VULNERABLE_CATEGORY_JP: Record<VulnerableCategory, string> = {
  infant: '乳幼児', elderly: '高齢者', wheelchair: '車椅子', medical: '医療依存',
};
export function emptyBreakdown(): VulnerableBreakdown {
  return { infant: 0, elderly: 0, wheelchair: 0, medical: 0 };
}
export function breakdownTotal(b: VulnerableBreakdown | undefined): number {
  return b ? b.infant + b.elderly + b.wheelchair + b.medical : 0;
}
export function addBreakdown(dst: VulnerableBreakdown, src: VulnerableBreakdown): VulnerableBreakdown {
  for (const c of VULNERABLE_CATEGORIES) dst[c] += src[c];
  return dst;
}
// 整数 n コマを比率で配分（端数は高齢者へ）
export function allocateBreakdown(n: number): VulnerableBreakdown {
  const b = emptyBreakdown();
  let assigned = 0;
  for (const c of ['infant', 'wheelchair', 'medical'] as VulnerableCategory[]) {
    const v = Math.floor(n * VULNERABLE_RATIO[c]);
    b[c] = v; assigned += v;
  }
  b.elderly = Math.max(0, n - assigned);
  return b;
}
// 全島合計の内訳（allocateBreakdown(合計)）を、各エリアの要援護者数に応じて配る（乱数不使用・決定論的）。
// 各エリア単独で比率配分すると少人数の島で乳幼児/車椅子/医療依存が全く現れないため、合計で配分してから割り当てる。
function distributeBreakdown(perArea: Record<AreaId, number>): Record<AreaId, VulnerableBreakdown> {
  const ids = Object.keys(perArea) as AreaId[];
  const total = ids.reduce((s, id) => s + perArea[id], 0);
  const tb = allocateBreakdown(total);
  const result = Object.fromEntries(ids.map(id => [id, emptyBreakdown()])) as Record<AreaId, VulnerableBreakdown>;
  const need: Record<AreaId, number> = { ...perArea };
  // 希少カテゴリ（医療依存→車椅子→乳幼児）を先に、要援護者の多い島から順に配り、残りは高齢者
  const tokens: VulnerableCategory[] = [];
  for (const c of ['medical', 'wheelchair', 'infant', 'elderly'] as VulnerableCategory[]) for (let i = 0; i < tb[c]; i++) tokens.push(c);
  for (const c of tokens) {
    // 未充足率（残り/元の数）が最大の島へ。同率なら要援護者数が多い島へ
    let best: AreaId | null = null; let bestKey = -1;
    for (const id of ids) {
      if (need[id] <= 0) continue;
      const key = need[id] / perArea[id] + perArea[id] * 1e-6;
      if (key > bestKey) { bestKey = key; best = id; }
    }
    if (!best) break;
    result[best][c] += 1; need[best] -= 1;
  }
  return result;
}
// 内訳 b から n コマを比例配分で取り出す（b を減らし、取り出した内訳を返す）。合計の不変条件を保つ。
export function takeFromBreakdown(b: VulnerableBreakdown, n: number): VulnerableBreakdown {
  const taken = emptyBreakdown();
  const total = breakdownTotal(b);
  if (n <= 0 || total <= 0) return taken;
  if (n >= total - 1e-9) {
    for (const c of VULNERABLE_CATEGORIES) { taken[c] = b[c]; b[c] = 0; }
    return taken;
  }
  let rest = n;
  const cats = VULNERABLE_CATEGORIES;
  for (let i = 0; i < cats.length; i++) {
    const c = cats[i];
    const t = i === cats.length - 1 ? Math.min(rest, b[c]) : Math.min(b[c], n * b[c] / total);
    taken[c] = t; b[c] -= t; rest -= t;
  }
  // 浮動小数の残差は高齢者（最大カテゴリ）で吸収
  if (Math.abs(rest) > 1e-12) {
    const t = Math.min(rest, b.elderly);
    taken.elderly += t; b.elderly -= t;
  }
  for (const c of cats) if (b[c] < 1e-12) b[c] = 0;
  return taken;
}
// 内訳を持たない state（旧セーブ/手組み）への安全網。減算より前に呼ぶこと（prepareDayPhase1 / executeDayPhase2 の
// 深コピー直後に全エリアへ適用する）。減算後に呼ぶと「減った後の vulnerable」で内訳を作ってしまい不変条件が崩れる。
function ensureBreakdown(a: AreaState): VulnerableBreakdown {
  if (!a.vulnerableBreakdown) a.vulnerableBreakdown = allocateBreakdown(a.vulnerable);
  return a.vulnerableBreakdown;
}
function ensureAllBreakdowns(areas: Record<AreaId, AreaState>): void {
  for (const id of Object.keys(areas) as AreaId[]) ensureBreakdown(areas[id]);
}
// 自宅エリアの要援護者内訳から n コマ分を比例で取り出す（area.vulnerable 自体は呼び出し側が減らす）
export function takeVulnerableBreakdown(area: AreaState, n: number): VulnerableBreakdown {
  return takeFromBreakdown(ensureBreakdown(area), n);
}
// 要援護者の所在台帳（ハブ待機中 / 死亡）。prepareDayPhase1 / executeDayPhase2 の除去処理で更新する
interface VulnLedger { inTransit: VulnerableBreakdown; dead: VulnerableBreakdown }
function ledgerOf(state: GameState): VulnLedger {
  return {
    inTransit: { ...(state.vulnerableInTransit ?? emptyBreakdown()) },
    dead: { ...(state.vulnerableDead ?? emptyBreakdown()) },
  };
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
  const vb = distributeBreakdown(vulnerable);

  // 孤立集落モデル: 竹富町の健常住民から 鳩間島1コマ・船浮1コマ を isolatedPending に移す（residents が足りなければある分だけ）。
  // 総数（人口保存則）は変えない: 残存 = residents + tourists + vulnerable + staging + isolatedPending
  const taketomiRes = rt.taketomi - vulnerable.taketomi;
  const isoHatoma = Math.min(1, Math.max(0, taketomiRes));
  const isoFunauki = Math.min(1, Math.max(0, taketomiRes - isoHatoma));
  const areas: Record<AreaId, AreaState> = {
    yonaguni: {
      id: 'yonaguni', name: '与那国島',
      residents: rt.yonaguni - vulnerable.yonaguni, tourists: tourists.yonaguni, vulnerable: vulnerable.yonaguni,
      vulnerableBreakdown: vb.yonaguni,
      fatigue: -shelterLevel, baseActions: 2,
      stagingAirport: 0, stagingPort: 0, stagingVulnerable: 0, inTransitToHub: 0,
    },
    taketomi: {
      id: 'taketomi', name: '竹富町全島',
      residents: taketomiRes - isoHatoma - isoFunauki, tourists: tourists.taketomi, vulnerable: vulnerable.taketomi,
      vulnerableBreakdown: vb.taketomi,
      fatigue: -shelterLevel, baseActions: 2,
      stagingAirport: 0, stagingPort: 0, stagingVulnerable: 0, inTransitToHub: 0,
      isolatedPending: isoHatoma + isoFunauki, isolatedPendingBy: { hatoma: isoHatoma, funauki: isoFunauki },
    },
    ishigaki: {
      id: 'ishigaki', name: '石垣島',
      residents: rt.ishigaki - vulnerable.ishigaki, tourists: tourists.ishigaki, vulnerable: vulnerable.ishigaki,
      vulnerableBreakdown: vb.ishigaki,
      fatigue: -shelterLevel, baseActions: 4,
      stagingAirport: 0, stagingPort: 0, stagingVulnerable: 0, inTransitToHub: 0,
    },
    miyako: {
      id: 'miyako', name: '宮古島・多良間',
      residents: rt.miyako - vulnerable.miyako, tourists: tourists.miyako, vulnerable: vulnerable.miyako,
      vulnerableBreakdown: vb.miyako,
      fatigue: -shelterLevel, baseActions: 3,
      stagingAirport: 0, stagingPort: 0, stagingVulnerable: 0, inTransitToHub: 0,
    },
  };
  // 孤立集落モデル（多良間島）: 宮古エリアから1コマを多良間島に置く。🔵住民か🔴要援護者かは宮古エリアの人口比でランダム。
  // 有事に 多良間空港→宮古空港(🔵のみ 0.5コマ/日)・多良間港→平良港フェリー(🔵🔴 0.5コマ/日) で宮古島へ渡るまで本土便に乗れない。
  {
    const mk = areas.miyako;
    const total = mk.residents + mk.vulnerable;
    if (total >= 1) {
      const vulnPick = mk.vulnerable >= 1 && Math.random() * total < mk.vulnerable;
      if (vulnPick) {
        mk.vulnerable -= 1;
        mk.isolatedVulnBreakdown = takeVulnerableBreakdown(mk, 1);
        mk.isolatedPendingBy = { hatoma: 0, funauki: 0, tarama: 0, taramaVuln: 1 };
      } else {
        mk.residents -= 1;
        mk.isolatedPendingBy = { hatoma: 0, funauki: 0, tarama: 1, taramaVuln: 0 };
      }
      mk.isolatedPending = 1;
    }
  }

  const weatherTrack = getWeatherTrack(month);
  const weatherIdx = getInitialWeatherIndex(month);

  return {
    prepLevel, shelterLevel, month,
    forcedEvents: config.forcedEvents,
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
      disabledAirRoutes: {}, disabledShipRoutes: {}, disabledTaketomiPorts: {},
    },
    evacuated: 0, dead: 0, dayLogs: [], activeEvents: [],
    // 初期総人口（固定）。避難率の分母と人口保存則の検査に使う
    initialTotal: Object.values(areas).reduce((t, a) => t + a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0) + (a.isolatedPending ?? 0), 0),
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
    // 不時着（マニュアル2026.9）: 空港別×国別。当該空港の輸送能力 −25%/国（最大−50%）を翌日24時まで
    airportLandings: [],
    // 占領状態（上陸・ヘリボーン成立で true）
    occupied: { yonaguni: false, taketomi: false, ishigaki: false, miyako: false },
    // PAC3 再配備（一度だけ）
    pac3Relocated: false,
    closedFacilitiesToday: [],
    // 要支援者モデル（④）
    vulnerableInTransit: emptyBreakdown(),
    vulnerableEvacuated: emptyBreakdown(),
    vulnerableDead: emptyBreakdown(),
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
// 交渉1回につき「任意エリアの1手」を消費: 余裕のある（残存の少ない・無人の）未占領の石垣/宮古（両方占領なら竹富/与那国）に handPenalty{negotiation, untilDay} を積む。
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
    // 陸自ヘリはピストン輸送専用のため、ピストンが起こり得る状況（Lv2以上かつハブ空港の破壊/路線停止）でのみ交渉する
    infra?: InfraState;
    disabledAirRoutes?: TransportState['disabledAirRoutes'];
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
    return opts.occupied[id] ? 0 : a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0) + (a.isolatedPending ?? 0);
  };
  // AIの交渉判断（自動実行の方針。ルール自体は「任意の4エリアの1手」を消費）:
  //  1手は「無人で手数が残っている未占領エリア」からだけ払う。人のいるエリアの1手を使うとその日の輸送力が
  //  (手数−1)/手数 に落ち、得られる+1コマより損失が大きい（全シミュ検証: Lv3で避難率が約1.3pt低下）ため、払える無人エリアが無ければ交渉を見送る。
  //  無人エリアが複数あれば石垣/宮古を優先し、次に残り手数の多い順。
  const spareHands = (id: AreaId) => handsByFatigue(id, opts.areas[id].fatigue) - penaltyCount(handPenalty[id], untilDay);
  const pickArea = (): AreaId | null => {
    const order: AreaId[] = ['ishigaki', 'miyako', 'taketomi', 'yonaguni'];
    const cands = order.filter(id => !opts.occupied[id] && alive(id) === 0 && spareHands(id) > 0);
    cands.sort((a, b) => spareHands(b) - spareHands(a) || order.indexOf(a) - order.indexOf(b));
    return cands[0] ?? null;
  };
  // 交渉する価値がある手段か: 避難待ちの人がいること。陸自ヘリはピストン輸送の発火条件（Lv2以上・新石垣/宮古/下地島の破壊か路線停止）も要する。
  const anyoneLeft = (['yonaguni', 'taketomi', 'ishigaki', 'miyako'] as AreaId[]).some(id => alive(id) > 0);
  const hubAirDown = !!opts.infra && (!opts.infra.shinIshigakiAirport || !opts.infra.miyakoAirport || !opts.infra.shimojiAirport
    || !!opts.disabledAirRoutes?.shinIshigaki || !!opts.disabledAirRoutes?.miyako || !!opts.disabledAirRoutes?.shimoji);
  // 交渉の方針（依頼仕様 2026-11-10）: 民間機が健在なうちは貴重な手数を増援交渉に使わず、民間機での避難を優先する。
  // 新石垣・宮古・下地島のいずれかが破壊・撃墜・運航拒否で民間便を出せなくなってから交渉する（それからでも遅くない）。
  const useful: Record<ReinforcementMeans, boolean> = {
    jgsdf: anyoneLeft && opts.prepLevel >= SHUTTLE_MIN_LEVEL && hubAirDown,
    jmsdf: anyoneLeft && hubAirDown,
    jasdf: anyoneLeft && hubAirDown,
  };
  // マニュアル4.9 の根拠（Codex再検証で確認・維持）:
  //  - 避難前(1時〜)の交渉で得た+1は当日使用可（4.9「翌日以降に使用しても良い」＝当日使用も可）。
  //  - 1手消費は「対象の4エリアのいずれか任意の手数を1手」なので、取り残しの多いエリアを避け、余裕のある(無人・少人数の)ハブから消費する。
  const untilDay = opts.when === 'beforeEvac' ? opts.day : opts.day + 1;
  const timing = opts.when === 'beforeEvac' ? '' : '（避難実行後に残0）';
  const skipped: string[] = [];
  for (const m of ['jgsdf', 'jmsdf', 'jasdf'] as ReinforcementMeans[]) {
    if (opts.remaining[m] > 0) continue;               // 使い切っていない（獲得分未消化を含む）
    if (reinforcement[m]?.day === opts.day) continue;  // 1日1回
    if (!useful[m]) continue;                          // 使い道が無い手段は交渉しない（1手の無駄遣い防止）
    const payer = pickArea();
    if (!payer) {
      // 人のいるエリアの1手を削ると当日の輸送力が下がるため見送る。交渉済みにはしない（避難後に無人エリアができれば同日に再判断）
      skipped.push(meansJp[m]);
      continue;
    }
    const roll = rollDie();
    const success = roll <= threshold;
    reinforcement[m] = { day: opts.day, roll, success };
    if (success) gain[m] = 1;
    const area = payer;
    let handJp = '（人のいるエリアなし・手消費なし）';
    if (area) {
      handPenalty[area].push({ country: 'negotiation', untilDay });
      handJp = `交渉に${opts.areas[area].name}の1手を消費${opts.when === 'afterEvac' ? '（翌日分）' : ''}`;
    }
    log.push(`自衛隊輸送臨時増援交渉（${meansJp[m]}）${timing}: 残0のため交渉・${handJp}。ダイス${roll}${success ? `≤${threshold} → 成功: ${meansJp[m]}+1コマ（使い切り${opts.when === 'afterEvac' ? '・翌日から使用可' : ''}）` : `>${threshold} → 失敗（翌日再交渉可）`}`);
  }
  if (skipped.length) log.push(`自衛隊輸送臨時増援交渉${timing}: ${skipped.join('・')}は残0だが、1手を払える無人エリアが無いため見送り（人のいるエリアの手数を削ると輸送力が落ちるため）`);
  return { gain, reinforcement, handPenalty };
}

// ===== 不時着 空港別容量倍率（マニュアル 2026.9 B/C表）=====
// 指定日に有効な不時着（untilDay ≧ day）の国数を数え、1国=−25%・2国=−50%。旧stateに airportLandings が無ければ 1。
export function airportLandingFactor(state: GameState, air: AirRouteKey, day: number = state.day): number {
  const countries = new Set((state.airportLandings ?? []).filter(l => l.air === air && l.untilDay >= day).map(l => l.country));
  return Math.max(0.5, 1 - 0.25 * countries.size);
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
  stopH: number;                     // 行動停止時間（3/6/12/24/36/48時間）
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
  seaAllAvailable: '竹富町各離島港・多良間港・全漁港',
};

// マニュアル(2026.9) 地震: 出目1=1m(被害なし・3h) / 2=3m(全海港・漁港・6h・死者1・DMAT石垣宮古) / 3=15m(+下地島/多良間/波照間空港・多良間/宮古/石垣発電所・12h・死者2・DMAT石垣宮古)
//   / 4=24m(+与那国空港・24h・死者4・DMAT宮古のみ) / 5=32m(+新石垣空港・36h・死者8・DMAT不可) / 6=42m(+宮古空港・波照間/与那国発電所=全空港全発電所・48h・死者12・DMAT不可)
// seaAllAvailable=false は「竹富町各離島港・多良間港・漁港を含む全海港が破壊」（民間船舶不可。海保・海自は破壊された港にも入れる）。
export function resolveEarthquake(severity: number, infra: InfraState): EarthquakeEffect {
  const destroyKeys: (keyof InfraState)[] = [];
  if (severity >= 2) destroyKeys.push('ishigakiPort', 'hiraraPort', 'kuburaPort', 'seaAllAvailable');
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
  return { severity, tsunamiM: t.tsunamiM, infra: infraPatch, capMul, nextDayCapMul, stopH: t.stopH, deaths: t.deaths, dmatAreas: t.dmat, destroyedJp };
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
// マニュアル3 ポイント4「毎時のダイスイベント」/ 6 図19: 毎時ダイスを1回振り、出目とフェーズでイベント表(A〜D)を決める。
// ＝1日24回の判定。（旧実装は1日6回だけ判定しており、イベントがマニュアルの1/4しか起きていなかった）
export const EVENT_ROLLS_PER_DAY = 24;
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
  // 海路だけに掛かる倍率（エリア単位）。石垣港の閉鎖/混雑が竹富町・与那国からの着港フェリーへ波及する分（taketomi/yonaguni）に使う
  seaCapacityMultiplier: Record<AreaId, number>;
  // 空港別の出発容量倍率（軍民錯綜=0.5 / インフラ表 1/1.5・1/2 / ボイコット=0）。民間・空自・往復便に掛かる。空港自体は開いている（受け入れ可）
  airRouteMultiplier: Record<AirRouteKey, number>;
  // 港別の民間船舶便倍率（機雷/民兵/臨検/サイバー等=0 / 錯綜=0.5 / インフラ表 1/1.5・1/2 / ボイコット=0）
  shipRouteMultiplier: Record<ShipRouteKey, number>;
  // 竹富町離島港別の倍率（機雷/ボイコット=0、インフラ表 1/1.5・1/2）。竹富→石垣フェリー合計 = Σ 港容量×倍率
  taketomiPortMultiplier: Record<TaketomiPortKey, number>;
  // 多良間島→宮古島の島内移送の当日倍率（インフラ表の多良間空港/多良間港）
  taramaRouteMultiplier: { air: number; sea: number };
  // 漁港表（西表漁港/細崎漁港/前泊港）: 海保輸送船・海自輸送艦の避難コスト×1.5/×2 → ハブの海保・海自容量に 1/1.5・1/2
  hubSeaMultiplier: Record<'ishigaki' | 'miyako', number>;
  // 多良間港が当日閉鎖（ボイコット）されたか（漁港表「前泊港」の条件判定用）
  taramaPortClosedToday: boolean;
  // 竹富町離島港（大原/上原）発の船舶便 恒久停止（船舶便攻撃）
  disabledTaketomiPorts: Partial<Record<TaketomiPortKey, boolean>>;
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
  // 死傷の発生順の記録（輸送アセット攻撃等の死者 'asset' と、DMAT対象の死傷者 'dmat'）。prepareDayPhase1 はこの順で人口除去・DMAT判定を行う
  casualtyTimeline: ({ kind: 'asset'; area: AreaId; n: number } | { kind: 'dmat'; area: AreaId; severity: 'minor' | 'major' })[];
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
  // マニュアル(2026.9): 当日発生した不時着（空港・国）。prepareDayPhase1 で state.airportLandings（翌日24時まで）へ反映
  landingsToday: { air: AirRouteKey; country: 'china' | 'taiwan' }[];
  // ver4.0 6.1 A表 住民の避難拒否: 当日そのエリア発の避難注文を無効化（容量は残す＝他エリアの通過・ハブ待機コマの搬出は可）
  refusalToday: Partial<Record<AreaId, boolean>>;
  // 当日1時の地震死者の予約配分（エリア別コマ数）。無人判定(alivePop)で差し引く。実際の人口除去は prepareDayPhase1 7b0 で1回のみ。
  reservedDead: Record<AreaId, number>;
  // 時刻表モデル（timetable.ts）: イベントによる使用不能を「発生時刻から」記録する。それより前に出た便は出発済み
  closures: TimedClosure[];
  // 撃墜・撃沈された便（その便の枠は当日の輸送量から除く）。キー 'air:<空港>' / 'ship:<港>' / 'tport:<離島港>'
  lostTrips: Record<string, number>;
  // 竹富町離島港の当日閉鎖（機雷・ボイコット）。漁港表の条件判定用
  tportClosedToday: Partial<Record<TaketomiPortKey, boolean>>;
  // 当日、攻撃で失った自衛隊の便（その便は使用済み＝残回数−1。海自・空自は1日1便なので当日はもう使えない）
  assetLost: { jmsdf: number; jasdf: number; jgsdf: number };
  // 当日の時刻表の前提（天候・モード・前日までの路線停止）。撃墜・撃沈の「当日すでに出発した便があるか」の判定に使う
  slotBase?: SlotInput;
}

export function generateDailyEvents(
  state: GameState,
  reservedDead: Record<AreaId, number> = { yonaguni: 0, taketomi: 0, ishigaki: 0, miyako: 0 },
  slotBase?: SlotInput,
  // 強制イベント（検証用）: 指定時刻に指定の表・セルを必ず発生させる
  forced: ForcedEvent[] = []
): EventResult {
  const result: EventResult = {
    reservedDead: { ...reservedDead },
    closures: [], lostTrips: {}, tportClosedToday: {}, assetLost: { jmsdf: 0, jasdf: 0, jgsdf: 0 }, slotBase,
    events: [],
    log: [],
    fatigueIncrease: { yonaguni: 0, taketomi: 0, ishigaki: 0, miyako: 0 },
    transportPenalty: {},
    infraPenalty: {},
    capacityMultiplier: { yonaguni: 1, taketomi: 1, ishigaki: 1, miyako: 1 },
    seaCapacityMultiplier: { yonaguni: 1, taketomi: 1, ishigaki: 1, miyako: 1 },
    airRouteMultiplier: { shinIshigaki: 1, miyako: 1, shimoji: 1, yonaguni: 1, hateruma: 1 },
    shipRouteMultiplier: { ishigakiPort: 1, hiraraPort: 1, kubura: 1 },
    taketomiPortMultiplier: { ohara: 1, uehara: 1, kohama: 1, taketomi: 1, kuroshima: 1, hateruma: 1, hatoma: 1, funauki: 1 },
    taramaRouteMultiplier: { air: 1, sea: 1 },
    hubSeaMultiplier: { ishigaki: 1, miyako: 1 },
    taramaPortClosedToday: false,
    disabledTaketomiPorts: {},
    facilityClosedToday: [],
    portClosedToday: [],
    newDead: 0,
    hourlyRolls: [],
    senkakuOccupied: false,
    dmatDeathAreas: [],
    casualtyTimeline: [],
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
  const eventSpaceHours = pickEventSpaceHours(EVENT_ROLLS_PER_DAY);

  // 24時間ループ（1時〜24時）
  for (let hour = 1; hour <= 24; hour++) {
    const roll = rollDie();
    // 強制イベント（検証用）: この日・この時刻に指定があれば、ダイスに関係なく指定の表・セルを発生させる
    const forcedNow = forced.find(f => f.kind === 'event' && f.day === day && f.hour === hour);
    if (forcedNow && forcedNow.kind === 'event') {
      result.log.push(`🎯 強制イベント: ${hour}時に イベント${forcedNow.table}（1投目${forcedNow.col}・2投目${forcedNow.row}）を発生させる`);
      const outcome = processEvent(forcedNow.table, state, result, military, hour, forcedNow.col, forcedNow.row);
      result.hourlyRolls.push({ hour, roll, isEventSpace: true, eventType: forcedNow.table, outcome });
      continue;
    }
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

    // イベント処理（発生時刻 hour は軍民運航錯綜の「同日12時まで/24時まで」判定に使う）
    outcome = processEvent(eventType, state, result, military, hour);
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

// ===== Section3: イベント表（マニュアル 2026.9 準拠）=====
// 全表とも 1投目=列(col 1..6)・2投目=行(row 1..6)。TABLE[col-1][row-1] でセルを引く。空欄セルは { kind: 'none' }＝「発生無し」。
// 判定式①（rollOccurrence）: ダイス1回 1〜Lv(Lv6は5) → 発生しない。
// 3ダイス判定（resolveInterdiction）: 合計+中−自 ≧15（尖閣≧12）。4ダイス判定（resolveFacilityMissile）: ≧17（尖閣≧14）。

type AEffect = 'panic' | 'comms' | 'traffic';

type EventCell =
  | { kind: 'none' }
  // A: 集落・市街地表を2ダイス。孤島集落なら当該集落からの避難コスト×2（refusal=その集落からの避難が同日不可）。それ以外は影響なし
  | { kind: 'aSettlement'; effect: AEffect | 'refusal' }
  // A: ダイス1回 1・2→漁港表 / 3〜6→インフラ表 を2ダイス。係数 panic/traffic=1.5, comms=2
  | { kind: 'aInfraFishing'; effect: AEffect }
  // A: サイバー攻撃 / 観光客大乱闘（判定式①→当該施設は同日24時まで使用不可）
  | { kind: 'aCyber'; air?: AirRouteKey; ship?: ShipRouteKey }
  | { kind: 'aBrawl'; air?: AirRouteKey; ship?: ShipRouteKey }
  // A: 乗員船員のボイコット（判定式①→インフラ表2ダイス。発生無し/橋なら不発。それ以外はそのインフラからの出発が同日不可・受け入れは可）
  | { kind: 'aBoycott' }
  // B: ドローン障害物散布（判定式①→空港 同日24時まで使用不可）
  | { kind: 'airClosedToday'; air: AirRouteKey }
  // B: 海上民兵海域接近 / 海域船舶臨検（判定式①→港 同日24時まで使用不可）
  | { kind: 'shipClosedToday'; ship: ShipRouteKey; jp: '海上民兵海域接近' | '海域船舶臨検' }
  // B: 軍民運航錯綜（判定式①。発生1〜12時→同日12時まで / 13〜24時→同日24時まで使用不可 ⇒ 当日容量×0.5）
  | { kind: 'airCongestion'; air: AirRouteKey }
  | { kind: 'shipCongestion'; ship: ShipRouteKey }
  // B: 機雷敷設（判定式①→当該港は同日24時まで使用不可）。港=久部良/石垣/平良 または 竹富町離島港=大原/上原
  | { kind: 'mine'; ship?: ShipRouteKey; tport?: TaketomiPortKey }
  // B/C: 不時着（判定式①）。当該空港の輸送能力を翌日24時まで −25%（他国機も不時着中なら合計 −50%）
  | { kind: 'emergencyLanding'; air: AirRouteKey; country: 'china' | 'taiwan' }
  // B/C: 航空便/船舶便に攻撃（3ダイス≧15/尖閣≧12）。同日既出発の1コマ死亡・当該路線は以後使用不能・全4疲労+1
  | { kind: 'airMissileShootdown'; air: AirRouteKey }
  | { kind: 'shipMissileSink'; ship?: ShipRouteKey; tport?: TaketomiPortKey }
  // B/C: 運航拒否（3ダイス≧15/尖閣≧12 → 当該路線は以後使用不能）
  | { kind: 'airRefusal'; air: AirRouteKey }
  | { kind: 'shipRefusal'; ship: ShipRouteKey }
  // B/C: 施設ミサイル攻撃（4ダイス≧17/尖閣≧14 → 以後使用不能。空港は翌日から空自輸送機・陸自ヘリのみ可）
  | { kind: 'airFacilityMissile'; air: AirRouteKey }
  | { kind: 'shipFacilityMissile'; ship: ShipRouteKey }
  // B/C: 電力設備ミサイル攻撃（4ダイス）。与那国/石垣島竹富町/宮古島=即時+1・毎日+1(夏季+2)。波照間/多良間=避難完了まで+2固定
  | { kind: 'power'; power: 'ishigaki' | 'miyako' | 'yonaguni' | 'tarama' | 'hateruma'; jp: string }
  // C: 橋ミサイル攻撃（4ダイス・宮古PAC3を減算）
  | { kind: 'bridge'; infra: 'bridgeIrabu' | 'bridgeIkema' | 'bridgeKurima'; jp: string }
  // C: 輸送アセット攻撃（3ダイス≧15/尖閣≧12）: 海保=死者1・全4疲労+1・便数−1 ／ 海自艦/空自機/陸自ヘリ=死者1・全4疲労+1（翌日から使用可）
  | { kind: 'attackCoastGuard' }
  | { kind: 'attackAsset'; jp: '空自輸送機' | '海自輸送艦' | '陸自ヘリ' }
  // D: 市街ミサイル攻撃 / ヘリボーン / 上陸 / 警護喪失 / 尖閣占領
  | { kind: 'dUrbanMissile'; area: 'ishigaki' | 'miyako'; jp: string }
  | { kind: 'dHeliborne'; airport: 'miyako' | 'shinIshigaki' | 'shimoji'; jp: string }
  | { kind: 'dLanding'; area: 'ishigaki' | 'miyako'; jp: string }
  | { kind: 'dGuardLoss'; target: 'sea' | 'air' }
  | { kind: 'dSenkaku' };

const N: EventCell = { kind: 'none' };

// ===== イベントA（フェーズ1〜4・ダイス1）=====
const EVENT_A_TABLE: EventCell[][] = [
  // 1投目1: 集落市街パニック / 集落市街通信不良 / 久部良港サイバー攻撃 / 宮古空港観光客大乱闘 / 発生無し / 発生無し
  [{ kind: 'aSettlement', effect: 'panic' }, { kind: 'aSettlement', effect: 'comms' }, { kind: 'aCyber', ship: 'kubura' }, { kind: 'aBrawl', air: 'miyako' }, N, N],
  // 1投目2: インフラ漁港パニック / インフラ漁港通信不良 / 石垣港サイバー攻撃 / 久部良港観光客大乱闘 / 発生無し / 発生無し
  [{ kind: 'aInfraFishing', effect: 'panic' }, { kind: 'aInfraFishing', effect: 'comms' }, { kind: 'aCyber', ship: 'ishigakiPort' }, { kind: 'aBrawl', ship: 'kubura' }, N, N],
  // 1投目3: 集落市街交通混乱 / 与那国空港サイバー攻撃 / 平良港サイバー攻撃 / 石垣港観光客大乱闘 / 発生無し / 発生無し
  [{ kind: 'aSettlement', effect: 'traffic' }, { kind: 'aCyber', air: 'yonaguni' }, { kind: 'aCyber', ship: 'hiraraPort' }, { kind: 'aBrawl', ship: 'ishigakiPort' }, N, N],
  // 1投目4: インフラ漁港交通混乱 / 新石垣空港サイバー攻撃 / 与那国空港観光客大乱闘 / 平良港観光客大乱闘 / 発生無し / 発生無し
  [{ kind: 'aInfraFishing', effect: 'traffic' }, { kind: 'aCyber', air: 'shinIshigaki' }, { kind: 'aBrawl', air: 'yonaguni' }, { kind: 'aBrawl', ship: 'hiraraPort' }, N, N],
  // 1投目5: 空港/海港乗員船員のボイコット / 下地島空港サイバー攻撃 / 新石垣空港観光客大乱闘 / 発生無し / 発生無し / 発生無し
  [{ kind: 'aBoycott' }, { kind: 'aCyber', air: 'shimoji' }, { kind: 'aBrawl', air: 'shinIshigaki' }, N, N, N],
  // 1投目6: 集落市街で住民の避難拒否 / 宮古空港サイバー攻撃 / 下地島空港観光客大乱闘 / 発生無し / 発生無し / 発生無し
  [{ kind: 'aSettlement', effect: 'refusal' }, { kind: 'aCyber', air: 'miyako' }, { kind: 'aBrawl', air: 'shimoji' }, N, N, N],
];

// ===== イベントB（フェーズ2〜4・ダイス2）=====
const EVENT_B_TABLE: EventCell[][] = [
  // 1投目1: 与那国空港ドローン / 平良港海上民兵 / 平良港臨検 / 石垣港軍民船舶錯綜 / 与那国島電力設備ミサイル / 大原港機雷敷設
  [{ kind: 'airClosedToday', air: 'yonaguni' }, { kind: 'shipClosedToday', ship: 'hiraraPort', jp: '海上民兵海域接近' }, { kind: 'shipClosedToday', ship: 'hiraraPort', jp: '海域船舶臨検' },
   { kind: 'shipCongestion', ship: 'ishigakiPort' }, { kind: 'power', power: 'yonaguni', jp: '与那国島' }, { kind: 'mine', tport: 'ohara' }],
  // 1投目2: 新石垣空港ドローン / 久部良港機雷敷設 / 与那国空港軍民航空機錯綜 / 平良港軍民船舶錯綜 / 与那国空港台湾軍機不時着 / 上原港船舶便に攻撃
  [{ kind: 'airClosedToday', air: 'shinIshigaki' }, { kind: 'mine', ship: 'kubura' }, { kind: 'airCongestion', air: 'yonaguni' },
   { kind: 'shipCongestion', ship: 'hiraraPort' }, { kind: 'emergencyLanding', air: 'yonaguni', country: 'taiwan' }, { kind: 'shipMissileSink', tport: 'uehara' }],
  // 1投目3: 下地島空港ドローン / 石垣港機雷敷設 / 新石垣空港軍民航空機錯綜 / 与那国空港航空便に攻撃 / 与那国空港中国軍機不時着 / 大原港船舶便に攻撃
  [{ kind: 'airClosedToday', air: 'shimoji' }, { kind: 'mine', ship: 'ishigakiPort' }, { kind: 'airCongestion', air: 'shinIshigaki' },
   { kind: 'airMissileShootdown', air: 'yonaguni' }, { kind: 'emergencyLanding', air: 'yonaguni', country: 'china' }, { kind: 'shipMissileSink', tport: 'ohara' }],
  // 1投目4: 宮古空港ドローン / 平良港機雷敷設 / 下地島空港軍民航空機錯綜 / 久部良港船舶便に攻撃 / 与那国空港航空便運航拒否 / 発生無し
  [{ kind: 'airClosedToday', air: 'miyako' }, { kind: 'mine', ship: 'hiraraPort' }, { kind: 'airCongestion', air: 'shimoji' },
   { kind: 'shipMissileSink', ship: 'kubura' }, { kind: 'airRefusal', air: 'yonaguni' }, N],
  // 1投目5: 久部良港海上民兵 / 久部良港臨検 / 宮古空港軍民航空機錯綜 / 与那国空港ミサイル攻撃(施設) / 久部良港船舶便運航拒否 / 発生無し
  [{ kind: 'shipClosedToday', ship: 'kubura', jp: '海上民兵海域接近' }, { kind: 'shipClosedToday', ship: 'kubura', jp: '海域船舶臨検' }, { kind: 'airCongestion', air: 'miyako' },
   { kind: 'airFacilityMissile', air: 'yonaguni' }, { kind: 'shipRefusal', ship: 'kubura' }, N],
  // 1投目6: 石垣港海上民兵 / 石垣港臨検 / 久部良港軍民船舶錯綜 / 久部良港ミサイル攻撃(施設) / 上原港機雷敷設 / 発生無し
  [{ kind: 'shipClosedToday', ship: 'ishigakiPort', jp: '海上民兵海域接近' }, { kind: 'shipClosedToday', ship: 'ishigakiPort', jp: '海域船舶臨検' }, { kind: 'shipCongestion', ship: 'kubura' },
   { kind: 'shipFacilityMissile', ship: 'kubura' }, { kind: 'mine', tport: 'uehara' }, N],
];

// ===== イベントC（フェーズ3〜4・ダイス3）=====
const EVENT_C_TABLE: EventCell[][] = [
  // 1投目1: 新石垣空港航空便に攻撃 / 空自輸送機に攻撃 / 石垣港ミサイル攻撃(施設・石垣PAC3) / 伊良部大橋ミサイル(宮古PAC3) / 新石垣空港中国軍機不時着 / 石垣港船舶便運航拒否
  [{ kind: 'airMissileShootdown', air: 'shinIshigaki' }, { kind: 'attackAsset', jp: '空自輸送機' }, { kind: 'shipFacilityMissile', ship: 'ishigakiPort' },
   { kind: 'bridge', infra: 'bridgeIrabu', jp: '伊良部大橋' }, { kind: 'emergencyLanding', air: 'shinIshigaki', country: 'china' }, { kind: 'shipRefusal', ship: 'ishigakiPort' }],
  // 1投目2: 下地島空港航空便に攻撃 / 海自輸送艦に攻撃 / 平良港ミサイル攻撃(施設・宮古PAC3) / 池間大橋ミサイル(宮古PAC3) / 下地島空港中国軍機不時着 / 平良港船舶便運航拒否
  [{ kind: 'airMissileShootdown', air: 'shimoji' }, { kind: 'attackAsset', jp: '海自輸送艦' }, { kind: 'shipFacilityMissile', ship: 'hiraraPort' },
   { kind: 'bridge', infra: 'bridgeIkema', jp: '池間大橋' }, { kind: 'emergencyLanding', air: 'shimoji', country: 'china' }, { kind: 'shipRefusal', ship: 'hiraraPort' }],
  // 1投目3: 宮古空港航空便に攻撃 / 陸自ヘリに攻撃 / 波照間島電力設備ミサイル(PAC3なし) / 来間大橋ミサイル(宮古PAC3) / 宮古空港中国軍機不時着 / 発生無し
  [{ kind: 'airMissileShootdown', air: 'miyako' }, { kind: 'attackAsset', jp: '陸自ヘリ' }, { kind: 'power', power: 'hateruma', jp: '波照間島' },
   { kind: 'bridge', infra: 'bridgeKurima', jp: '来間大橋' }, { kind: 'emergencyLanding', air: 'miyako', country: 'china' }, N],
  // 1投目4: 石垣港船舶便に攻撃 / 新石垣空港ミサイル攻撃(施設・石垣PAC3) / 石垣島竹富町各島電力設備ミサイル(石垣PAC3) / 新石垣空港台湾軍機不時着 / 新石垣空港航空便運航拒否 / 発生無し
  [{ kind: 'shipMissileSink', ship: 'ishigakiPort' }, { kind: 'airFacilityMissile', air: 'shinIshigaki' }, { kind: 'power', power: 'ishigaki', jp: '石垣島・竹富町各島' },
   { kind: 'emergencyLanding', air: 'shinIshigaki', country: 'taiwan' }, { kind: 'airRefusal', air: 'shinIshigaki' }, N],
  // 1投目5: 平良港船舶便に攻撃 / 下地島空港ミサイル攻撃(施設・宮古PAC3) / 多良間島電力設備ミサイル(PAC3なし) / 下地島空港台湾軍機不時着 / 下地島空港航空便運航拒否 / 発生無し
  [{ kind: 'shipMissileSink', ship: 'hiraraPort' }, { kind: 'airFacilityMissile', air: 'shimoji' }, { kind: 'power', power: 'tarama', jp: '多良間島' },
   { kind: 'emergencyLanding', air: 'shimoji', country: 'taiwan' }, { kind: 'airRefusal', air: 'shimoji' }, N],
  // 1投目6: 海保輸送船に攻撃 / 宮古空港ミサイル攻撃(施設・宮古PAC3) / 宮古島電力設備ミサイル(宮古PAC3) / 宮古空港台湾軍機不時着 / 宮古空港航空便運航拒否 / 発生無し
  [{ kind: 'attackCoastGuard' }, { kind: 'airFacilityMissile', air: 'miyako' }, { kind: 'power', power: 'miyako', jp: '宮古島' },
   { kind: 'emergencyLanding', air: 'miyako', country: 'taiwan' }, { kind: 'airRefusal', air: 'miyako' }, N],
];

// ===== イベントD（フェーズ4・ダイス4）=====
const EVENT_D_TABLE: EventCell[][] = [
  // 1投目1: 石垣市街ミサイル攻撃 / 宮古空港ヘリボーン / 発生無し×4
  [{ kind: 'dUrbanMissile', area: 'ishigaki', jp: '石垣市街' }, { kind: 'dHeliborne', airport: 'miyako', jp: '宮古空港ヘリボーン' }, N, N, N, N],
  // 1投目2: 宮古市街ミサイル攻撃 / 海上自衛隊海空警護喪失-1 / 発生無し×4
  [{ kind: 'dUrbanMissile', area: 'miyako', jp: '宮古市街' }, { kind: 'dGuardLoss', target: 'sea' }, N, N, N, N],
  // 1投目3: 石垣島上陸 / 航空自衛隊空域警護喪失-1 / 発生無し×4
  [{ kind: 'dLanding', area: 'ishigaki', jp: '石垣島上陸' }, { kind: 'dGuardLoss', target: 'air' }, N, N, N, N],
  // 1投目4: 宮古島上陸 / 尖閣諸島占領 / 発生無し×4
  [{ kind: 'dLanding', area: 'miyako', jp: '宮古島上陸' }, { kind: 'dSenkaku' }, N, N, N, N],
  // 1投目5: 新石垣空港ヘリボーン / 発生無し×5
  [{ kind: 'dHeliborne', airport: 'shinIshigaki', jp: '新石垣空港ヘリボーン' }, N, N, N, N, N],
  // 1投目6: 下地島空港ヘリボーン / 発生無し×5
  [{ kind: 'dHeliborne', airport: 'shimoji', jp: '下地島空港ヘリボーン' }, N, N, N, N, N],
];

// ===== 漁港表（2ダイス）=====
// 避難に影響するのは 西表漁港（大原港と上原港が使用不能の時）/ 細崎漁港（小浜港が使用不能の時）/ 前泊港（多良間港が使用不能の時）のみ。
type FishingPort = { jp: string; key: 'iriomote' | 'hosozaki' | 'maedomari' | null };
const FP = (jp: string, key: FishingPort['key'] = null): FishingPort => ({ jp, key });
const FISHING_PORT_TABLE: (FishingPort | null)[][] = [
  [FP('西表漁港（西表島）', 'iriomote'), FP('細崎漁港（小浜島）', 'hosozaki'), FP('登野城漁港（石垣島）'), FP('伊野田漁港（石垣島）'), FP('船越漁港（石垣島）'), FP('前泊港（多良間島）', 'maedomari')],
  [FP('佐和田漁港（伊良部島）'), FP('佐良浜漁港（伊良部島）'), FP('池間漁港（池間島）'), FP('狩俣漁港（宮古島）'), FP('大神漁港（大神島）'), FP('島尻漁港（宮古島）')],
  [FP('真謝漁港（宮古島）'), FP('高野漁港（宮古島）'), FP('浦底漁港（宮古島）'), FP('保良漁港（宮古島）'), FP('友利漁港（宮古島）'), FP('宮園漁港（宮古島）')],
  [FP('棚根漁港（宮古島）'), FP('川満漁港（宮古島）'), FP('久松漁港（宮古島）'), FP('荷川取漁港（宮古島）'), FP('上地漁港（新城島）'), FP('下地漁港（新城島）')],
  [FP('水納漁港（水納島）'), null, null, null, null, null],
  [null, null, null, null, null, null],
];

// ===== インフラ表（空港・海港・陸橋・2ダイス）=====
type InfraTarget = { jp: string } & (
  | { air: AirRouteKey }
  | { ship: ShipRouteKey }
  | { tport: TaketomiPortKey }
  | { special: 'taramaAirport' | 'taramaPort' | 'shirahamaPort' }
  | { bridge: 'bridgeKurima' | 'bridgeIrabu' | 'bridgeIkema' }
);
const INFRA_TABLE: (InfraTarget | null)[][] = [
  [{ jp: '与那国空港', air: 'yonaguni' }, { jp: '新石垣空港', air: 'shinIshigaki' }, { jp: '宮古空港', air: 'miyako' }, { jp: '下地島空港', air: 'shimoji' }, { jp: '多良間空港', special: 'taramaAirport' }, { jp: '波照間空港', air: 'hateruma' }],
  [{ jp: '久部良港', ship: 'kubura' }, { jp: '船浮港', tport: 'funauki' }, { jp: '鳩間港', tport: 'hatoma' }, { jp: '上原港', tport: 'uehara' }, { jp: '大原港', tport: 'ohara' }, { jp: '波照間港', tport: 'hateruma' }],
  [{ jp: '黒島港', tport: 'kuroshima' }, { jp: '小浜港', tport: 'kohama' }, { jp: '竹富港', tport: 'taketomi' }, { jp: '石垣港', ship: 'ishigakiPort' }, { jp: '多良間港', special: 'taramaPort' }, { jp: '平良港', ship: 'hiraraPort' }],
  [{ jp: '来間大橋', bridge: 'bridgeKurima' }, { jp: '伊良部大橋', bridge: 'bridgeIrabu' }, { jp: '池間大橋', bridge: 'bridgeIkema' }, { jp: '白浜港', special: 'shirahamaPort' }, null, null],
  [null, null, null, null, null, null],
  [null, null, null, null, null, null],
];

// ===== 集落・市街地表（2ダイス）=====
// isolated = 孤島集落（SETTLEMENT_SHARE のキー）。それ以外の集落は「避難に影響しない」。
type Settlement = { jp: string; isolated?: keyof typeof SETTLEMENT_SHARE };
const S = (jp: string, isolated?: keyof typeof SETTLEMENT_SHARE): Settlement => (isolated ? { jp, isolated } : { jp });
const SETTLEMENT_TABLE: (Settlement | null)[][] = [
  [S('祖納（与那国島）', 'sonai'), S('船浮（西表島外縁）', 'funauki'), S('白浜（西表島）'), S('上原（西表島）'), S('鳩間（鳩間島）', 'hatoma'), S('古見（西表島）')],
  [S('大原（西表島）'), S('波照間（波照間島）', 'hateruma'), S('黒島（黒島）', 'kuroshima'), S('小浜（小浜島）', 'kohama'), S('竹富（竹富島）', 'taketomi'), S('富崎（石垣島）')],
  [S('崎枝（石垣島）'), S('川平（石垣島）'), S('名蔵（石垣島）'), S('富野（石垣島）'), S('野底（石垣島）'), S('伊原間（石垣島）')],
  [S('平久保（石垣島）'), S('伊野田（石垣島）'), S('大浜（石垣島）'), S('石垣市中心部（石垣島）'), S('塩川（多良間島）', 'shiokawa'), S('来間（来間島）', 'kurima')],
  [S('伊良部（下地島）'), S('佐良浜（伊良部島）'), S('池間（池間島）', 'ikema'), S('下地（宮古島）'), S('上野（宮古島）'), S('城辺（宮古島）')],
  [S('大浦（宮古島）'), S('狩俣（宮古島）'), S('宮古島市中心部（宮古島）'), null, null, null],
];

// 検証用（Codex/スクリプトでマニュアルとセル単位に突き合わせる）
export const EVENT_TABLES_FOR_VERIFY = { A: EVENT_A_TABLE, B: EVENT_B_TABLE, C: EVENT_C_TABLE, D: EVENT_D_TABLE, FISHING: FISHING_PORT_TABLE, INFRA: INFRA_TABLE, SETTLEMENT: SETTLEMENT_TABLE };

// イベント表のセル名（強制イベントの選択肢用）。空欄は null
function eventCellLabel(c: EventCell): string | null {
  const fac = (air?: AirRouteKey, ship?: ShipRouteKey, tport?: TaketomiPortKey) =>
    air ? AIR_ROUTE_JP[air] : ship ? SHIP_ROUTE_JP[ship] : tport ? TAKETOMI_PORT_JP[tport] : '';
  const eff = { panic: 'パニック', traffic: '交通混乱', comms: '通信不良', refusal: '住民の避難拒否' } as const;
  switch (c.kind) {
    case 'none': return null;
    case 'aSettlement': return `集落市街で${eff[c.effect]}`;
    case 'aInfraFishing': return `インフラ漁港で${eff[c.effect]}`;
    case 'aCyber': return `${fac(c.air, c.ship)} サイバー攻撃`;
    case 'aBrawl': return `${fac(c.air, c.ship)} 観光客大乱闘`;
    case 'aBoycott': return '空港/海港 乗員船員のボイコット';
    case 'airClosedToday': return `${fac(c.air)} ドローン障害物散布`;
    case 'shipClosedToday': return `${fac(undefined, c.ship)} ${c.jp}`;
    case 'airCongestion': return `${fac(c.air)} 軍民航空機運航錯綜`;
    case 'shipCongestion': return `${fac(undefined, c.ship)} 軍民船舶運航錯綜`;
    case 'mine': return `${fac(undefined, c.ship, c.tport)} 機雷敷設`;
    case 'emergencyLanding': return `${fac(c.air)} ${c.country === 'china' ? '中国軍機' : '台湾軍機'}不時着`;
    case 'airMissileShootdown': return `${fac(c.air)} 航空便に攻撃`;
    case 'shipMissileSink': return `${fac(undefined, c.ship, c.tport)} 船舶便に攻撃`;
    case 'airRefusal': return `${fac(c.air)} 航空便運航拒否`;
    case 'shipRefusal': return `${fac(undefined, c.ship)} 船舶便運航拒否`;
    case 'airFacilityMissile': return `${fac(c.air)} ミサイル攻撃（施設）`;
    case 'shipFacilityMissile': return `${fac(undefined, c.ship)} ミサイル攻撃（施設）`;
    case 'power': return `${c.jp} 電力設備ミサイル攻撃`;
    case 'bridge': return `${c.jp} ミサイル攻撃`;
    case 'attackCoastGuard': return '海保輸送船に攻撃';
    case 'attackAsset': return `${c.jp}に攻撃`;
    case 'dUrbanMissile': return `${c.jp} ミサイル攻撃`;
    case 'dHeliborne': return c.jp;
    case 'dLanding': return c.jp;
    case 'dGuardLoss': return c.target === 'sea' ? '海上自衛隊 海空警護 喪失−1' : '航空自衛隊 空域警護 喪失−1';
    case 'dSenkaku': return '尖閣諸島占領';
  }
}
// 強制イベントの選択肢: 表(A〜D)ごとの { 1投目, 2投目, 名前 }（空欄セルは除く）
export function forcedEventOptions(table: 'A' | 'B' | 'C' | 'D'): { col: number; row: number; label: string }[] {
  const t = table === 'A' ? EVENT_A_TABLE : table === 'B' ? EVENT_B_TABLE : table === 'C' ? EVENT_C_TABLE : EVENT_D_TABLE;
  const out: { col: number; row: number; label: string }[] = [];
  t.forEach((colCells, ci) => colCells.forEach((cell, ri) => {
    const label = eventCellLabel(cell);
    if (label) out.push({ col: ci + 1, row: ri + 1, label });
  }));
  return out;
}

// 2ダイス表引き（1投目=列, 2投目=行）
function lookup2<T>(table: (T | null)[][], log: string[], tableJp: string): { col: number; row: number; hit: T | null } {
  const col = rollDie();
  const row = rollDie();
  const hit = table[col - 1]?.[row - 1] ?? null;
  log.push(`  ${tableJp}: 1投目${col}・2投目${row} → ${hit ? (hit as { jp?: string }).jp ?? '' : '発生無し'}`);
  return { col, row, hit };
}

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
    result.casualtyTimeline.push({ kind: 'dmat', area, severity: 'major' });
    result.log.push(`  ${formula} ≥12 → 数百名の死傷者: 0.5コマ死亡・当該エリア疲労+1・DMAT対象`);
    return '死傷者:数百名(0.5コマ)';
  }
  if (v >= 8) {
    result.dmatDeathAreas.push({ area, severity: 'minor' });
    result.casualtyTimeline.push({ kind: 'dmat', area, severity: 'minor' });
    result.log.push(`  ${formula} 8〜11 → 数十名の死傷者: 当該エリア疲労+1・DMAT対象（コマ除去なし）`);
    return '死傷者:数十名';
  }
  result.log.push(`  ${formula} ≤7 → 死傷者なし`);
  return '死傷者なし';
}

// 輸送アセット（海保輸送船/海自輸送艦/陸自ヘリ/空自輸送機）攻撃の死者1コマを「人のいるエリア」に帰属させる。
// 優先: 石垣→宮古→竹富→与那国（待機コマ含む）。当日既に計上した deadByArea を差し引いた残存で判定。どこにも人がいなければ死者0。
function assetDeathArea(state: GameState, result: EventResult): AreaId | null {
  for (const id of ['ishigaki', 'miyako', 'taketomi', 'yonaguni'] as AreaId[]) {
    const a = state.areas[id];
    const pop = a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0) + (a.isolatedPending ?? 0) - result.deadByArea[id];
    if (pop > 0 && !result.occupiedToday[id]) {
      result.newDead += 1;
      result.deadByArea[id] += 1;
      result.casualtyTimeline.push({ kind: 'asset', area: id, n: 1 });
      return id;
    }
  }
  return null;
}

// エリアの当日残存人口（当日既に計上した死者を差し引く）。無人判定に使う。
// 差し引き対象: 当日既計上の撃墜/撃沈/アセット死/部分占領死(deadByArea)、市街攻撃/施設死傷の major 0.5コマ(dmatDeathAreas・当該エリア)、
// 当日占領（=0）、当日1時の地震死者の予約配分(reservedDead。人口除去は prepareDayPhase1 7b0 で行うが判定用に先に差し引く）。
function alivePop(state: GameState, result: EventResult, id: AreaId): number {
  if (result.occupiedToday[id]) return 0;
  const a = state.areas[id];
  const majorDead = result.dmatDeathAreas.filter(d => d.area === id && d.severity === 'major').length * 0.5;
  return a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0) + (a.isolatedPending ?? 0)
    - result.deadByArea[id] - majorDead - (result.reservedDead[id] ?? 0);
}

// 発生時刻から軍民運航錯綜の使用不可時間帯を返す（1〜12時発生→同日12時まで / 13〜24時発生→同日24時まで）
function congestionWindow(hour: number): string {
  return hour <= 12 ? `${hour}時発生 → 同日12時まで使用不可` : `${hour}時発生 → 同日24時まで使用不可`;
}

function processEventCell(
  cell: EventCell,
  tag: 'A' | 'B' | 'C' | 'D',
  colRow: string,
  result: EventResult,
  military: MilitaryState,
  state: GameState,
  hour: number
): string {
  const areas = ['yonaguni', 'taketomi', 'ishigaki', 'miyako'] as AreaId[];
  const allAreasFatigue = (n: number) => areas.forEach(a => { result.fatigueIncrease[a] += n; });
  // 既占領エリアへの攻撃は無効（ver4.0 4.4④）
  const occupied = (a: AreaId) => isOccupied(state, a) || !!result.occupiedToday[a];
  // 既に破壊済み(前日まで or 当日先行イベント)のインフラか。
  // 運航拒否/撃墜による「路線停止」は施設破壊ではない（施設は健全で軍用機・ピストンは使える）ため、ここでは見ない。
  // 旧stateに kuburaPort が無い場合は健全(true)とみなす。
  const infraBroken = (k: keyof InfraState) => state.infra[k] === false || result.infraPenalty[k] === false;
  // 離島港（竹富町各港・多良間港）が地震で全破壊されているか（infra.seaAllAvailable=false）
  const islandPortsDestroyed = state.infra.seaAllAvailable === false;
  const prepLevel = state.prepLevel;
  const head = `[イベント${tag}|${colRow}|${hour}時]`;

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
  // 竹富町離島港の無効判定（占領/地震全破壊）
  const tportInvalid = (k: TaketomiPortKey): string | null => {
    if (occupied('taketomi')) return `${TAKETOMI_PORT_JP[k]} は既に占領済みエリア`;
    if (islandPortsDestroyed) return `${TAKETOMI_PORT_JP[k]} は地震で破壊済み`;
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
  // 港の民間船舶便に倍率を掛ける（×0=当日閉鎖 / ×0.5=半減 / ×1/1.5 等）。石垣港は竹富町各島・与那国からのフェリーの着港でもあるため、
  // cascade=true（使用不可・混雑）なら taketomi・yonaguni の海路倍率にも同じ係数を掛ける（入港も不可）。ボイコットは出発のみ不可＝cascade=false。
  const applyShipMul = (ship: ShipRouteKey, factor: number, cascade = true) => {
    result.shipRouteMultiplier[ship] *= factor;
    if (ship === 'ishigakiPort' && cascade) {
      result.seaCapacityMultiplier.taketomi *= factor;
      result.seaCapacityMultiplier.yonaguni *= factor;
    }
    // 平良港は多良間港→平良港フェリー（多良間島の島内移送）の着港でもある
    if (ship === 'hiraraPort' && cascade) result.taramaRouteMultiplier.sea *= factor;
  };
  // 時刻表モデル: この時刻から to 時まで使用不能（それより前に出た便は出発済み）
  const win = (key: string, to = 24) => { result.closures.push({ key, from: hour, to }); };
  // 当日この時刻より前に出発した便があるか（マニュアル6.3.3/6.8: 当日まだ1便も出発していなければセーフ）
  const slotNow = (): SlotInput | null => (result.slotBase ? { ...result.slotBase, closures: [...result.slotBase.closures, ...result.closures] } : null);
  const airDepartedBefore = (air: AirRouteKey): boolean => {
    const sl = slotNow();
    if (!sl) return true;
    return civFlightsBefore(sl, air, hour) - (result.lostTrips[`air:${air}`] ?? 0) > 0;
  };
  const shipDepartedBefore = (ship?: ShipRouteKey, tport?: TaketomiPortKey): boolean => {
    const sl = slotNow();
    if (!sl) return true;
    const mode = sl.phase === 'wartime' || (sl.phase === 'crisis' && sl.crisisEvacOk && (ship === 'kubura' || !!tport));
    if (!mode) return false;
    const dep = ship
      ? ferryDepartures(sl, { kind: 'main', key: ship }, ship === 'kubura' ? 'ishigakiPort' : undefined)
      : ferryDepartures(sl, { kind: 'tport', key: tport! }, 'ishigakiPort');
    const n = (dep.am !== null && dep.am < hour ? 1 : 0) + (dep.pm !== null && dep.pm < hour ? 1 : 0);
    return n - (result.lostTrips[ship ? `ship:${ship}` : `tport:${tport}`] ?? 0) > 0;
  };
  // 海保・海自・空自・陸自ヘリは24時間いつでも出られる（天候が許す限り）ため、当日の便は使える最初の時刻に出たものとみなす。
  // この時刻より前に「その手段が実際に出られた」か: モード（海保=有事/存立危機、自衛隊=有事）・残回数・当日すでに失った便・天候・地震の行動停止を確認する
  const assetDepartedBefore = (asset: 'cg' | 'jmsdf' | 'jasdf' | 'jgsdf'): boolean => {
    const sl = slotNow();
    if (!sl) return true;
    if (asset === 'cg') {
      if (sl.phase === 'peacetime') return false;
      if (state.transport.coastGuardToday + result.coastGuardMaxDelta <= 0) return false;
    } else {
      if (sl.phase !== 'wartime') return false;
      const remaining = asset === 'jmsdf' ? state.transport.jmsdfRemaining : asset === 'jasdf' ? state.transport.jasdfRemaining : state.transport.jgsdfRemaining;
      if (remaining - result.assetLost[asset] <= 0) return false;
      if (result.assetLost[asset] > 0) return false; // 1日1便: 当日の便は既に失った
      // 陸自ヘリは2島間往復輸送でしか飛ばない（本土脱出不可）。往復輸送が発動できる状況（Lv2以上・新石垣/宮古/下地島の破壊か路線停止）でなければ出発していない
      if (asset === 'jgsdf') {
        const down = (air: AirRouteKey) => infraBroken(AIR_ROUTE_INFRA[air]) || !!state.transport.disabledAirRoutes?.[air] || !!result.disabledAirRoutes[air];
        if (prepLevel < SHUTTLE_MIN_LEVEL || !(down('shinIshigaki') || down('miyako') || down('shimoji'))) return false;
        if (occupied('ishigaki') || occupied('miyako')) return false;
      }
    }
    const runwayKeys: AirKey[] = ['shinIshigaki', 'miyako', 'shimoji', 'yonaguni'];
    for (let h = sl.freezeUntil + 1; h < hour; h++) {
      const w = h <= 12 ? sl.am : sl.pm;
      if (asset === 'jasdf') {
        if (runwayKeys.some(k => airWeatherOk(w, sl.month, k) && !sl.closures.some(c => c.key === `air:${k}` && h >= c.from && h <= c.to))) return true;
      } else if (seaWeatherOk(w, sl.month)) return true; // 海保・海自（船）と陸自ヘリは大雨・強風で不可
    }
    return false;
  };
  // 空港の出発容量（民間・空自・往復便）に倍率を掛ける。空港自体は開いている（受け入れ可）
  const applyAirMul = (air: AirRouteKey, factor: number) => { result.airRouteMultiplier[air] *= factor; };
  // 施設を当日閉鎖（空港=airportAvailを当日false / 港=海路倍率×0）
  const closeFacilityToday = (air?: AirRouteKey, ship?: ShipRouteKey): string => {
    if (air) { result.facilityClosedToday.push(air); win(`air:${air}`); return AIR_ROUTE_JP[air]; }
    if (ship) { win(`port:${ship}`); result.portClosedToday.push(ship); return SHIP_ROUTE_JP[ship]; }
    return '';
  };
  // 集落人口シェアによるエリア容量の近似（コスト×factor → ×1/(1+share×(factor−1)) ／ 閉鎖 → ×(1−share)）
  const applyShareCost = (area: AreaId, share: number, factor: number): number => {
    const m = 1 / (1 + share * (factor - 1));
    result.capacityMultiplier[area] *= m;
    return m;
  };
  const applyShareClosed = (area: AreaId, share: number): number => {
    const m = Math.max(0, 1 - share);
    result.capacityMultiplier[area] *= m;
    return m;
  };
  const pct = (m: number) => `×${m.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`;
  // 竹富町離島港が使用不能か（地震全破壊 / B表による恒久停止（前日まで・当日） / 当日閉鎖=機雷・ボイコット）
  const tportUnusable = (k: TaketomiPortKey) =>
    islandPortsDestroyed ||
    !!state.transport.disabledTaketomiPorts?.[k] ||
    !!result.disabledTaketomiPorts[k] ||
    !!result.tportClosedToday[k];
  // 漁港表の3港が「避難に影響する」条件（大原港と上原港 / 小浜港 / 多良間港 が使用不能の時）
  const fishingCondition = (key: 'iriomote' | 'hosozaki' | 'maedomari'): { ok: boolean; hub: 'ishigaki' | 'miyako'; cond: string } => {
    if (key === 'iriomote') return { ok: tportUnusable('ohara') && tportUnusable('uehara'), hub: 'ishigaki', cond: '大原港と上原港が使用不能' };
    if (key === 'hosozaki') return { ok: tportUnusable('kohama'), hub: 'ishigaki', cond: '小浜港が使用不能' };
    return { ok: islandPortsDestroyed || result.taramaPortClosedToday, hub: 'miyako', cond: '多良間港が使用不能' };
  };
  // インフラ表の対象に係数（1.5 / 2）または閉鎖（出発不可）を適用する。ログ文字列を返す。
  const applyInfraTarget = (t: InfraTarget, mode: { factor: number } | { closed: true }): string => {
    const closed = 'closed' in mode;
    const f = closed ? 0 : 1 / mode.factor;
    const fjp = closed ? '出発不可（受け入れは可）' : `容量×1/${mode.factor}`;
    if ('air' in t) {
      const inv = facilityInvalid(t.air);
      if (inv) return `${inv} → 効力なし`;
      if (closed) win(`airdep:${t.air}`); else applyAirMul(t.air, f);
      return `${t.jp} 経由の出発（民間・空自・往復便）${fjp}`;
    }
    if ('ship' in t) {
      const inv = facilityInvalid(undefined, t.ship);
      if (inv) return `${inv} → 効力なし`;
      // ボイコット(閉鎖)は出発のみ不可＝着港(竹富/与那国フェリー)は可
      if (closed) { win(`portdep:${t.ship}`); result.portClosedToday.push(t.ship); } else applyShipMul(t.ship, f);
      return `${t.jp} 発の民間船舶便${fjp}${t.ship === 'ishigakiPort' && !closed ? '（竹富町・与那国からの着港フェリーにも同係数）' : ''}`;
    }
    if ('tport' in t) {
      const inv = tportInvalid(t.tport);
      if (inv) return `${inv} → 効力なし`;
      if (t.tport === 'funauki') {
        // 船浮→白浜は島内移動（石垣便合計に含めない）。船浮は孤立集落として実数で持つため、船浮→西表の島内移送だけに反映する
        if (closed) { win('tport:funauki'); result.tportClosedToday.funauki = true; } else result.taketomiPortMultiplier.funauki *= f;
        return `${t.jp}（船浮→白浜・島内）${fjp}・船浮→西表 島内移送${closed ? '不可' : `容量×${f.toFixed(2)}`}`;
      }
      if (closed) { win(`tport:${t.tport}`); result.tportClosedToday[t.tport] = true; } else result.taketomiPortMultiplier[t.tport] *= f;
      return `${t.jp} 発の石垣便${fjp}（竹富→石垣フェリー合計から当該港${TAKETOMI_PORT_CAPACITY[t.tport]}コマ分を${closed ? '除く' : '減算'}）`;
    }
    if ('special' in t) {
      if (t.special === 'shirahamaPort') return `${t.jp}: 西表島内の港（船浮→白浜の着港）のため石垣便合計に影響なし（ログのみ）`;
      if (occupied('miyako')) return `${t.jp} は既に占領済みエリア → 効力なし`;
      if (t.special === 'taramaPort' && islandPortsDestroyed) return `${t.jp} は地震で破壊済み → 効力なし`;
      if (t.special === 'taramaPort' && closed) result.taramaPortClosedToday = true;
      // 多良間島は孤立集落（isolatedPendingBy.tarama/taramaVuln）として島内移送するため、当該経路の当日倍率に直接掛ける
      if (t.special === 'taramaAirport') { if (closed) win('airdep:tarama'); else result.taramaRouteMultiplier.air *= f; }
      else if (closed) win('taramaportdep'); else result.taramaRouteMultiplier.sea *= f;
      return `${t.jp} 発の多良間→宮古 島内移送${fjp}（${t.special === 'taramaAirport' ? '空路' : 'フェリー'}）`;
    }
    // 橋: 通行コスト増はエリア容量に反映しない（ログのみ）。ボイコットの対象外は呼び出し側で除外
    return `${t.jp}: 通行コスト${closed ? '' : `×${mode.factor}`}（陸橋は避難容量に反映せずログのみ）`;
  };

  switch (cell.kind) {
    case 'none':
      // 24時間ダイス枠に出たイベントは、表の空欄（発生無し）でも「イベント・軍事」欄に必ず記録する
      result.log.push(`${head} 発生無し（イベント${tag}表の空欄）`);
      return `${head} 発生無し`;

    // ===== A表 =====
    case 'aSettlement': {
      const effJp = cell.effect === 'refusal' ? '住民の避難拒否' : { panic: 'パニック', traffic: '交通混乱', comms: '通信不良' }[cell.effect];
      result.log.push(`${head} 【集落市街で${effJp}】`);
      const { hit } = lookup2(SETTLEMENT_TABLE, result.log, '集落・市街地表');
      if (!hit) return `【${effJp}】集落・市街地表=発生無し`;
      if (!hit.isolated) {
        result.log.push(`  ${hit.jp} は孤島集落ではない → 避難に影響なし`);
        return `【${effJp}】${hit.jp} 影響なし`;
      }
      const { area, share } = SETTLEMENT_SHARE[hit.isolated];
      const name = state.areas[area].name;
      if (occupied(area) || alivePop(state, result, area) <= 0) {
        result.log.push(`  ${hit.jp}（${name}）は占領済み/無人 → 効力なし`);
        return `【${effJp}】${hit.jp} 効力なし`;
      }
      if (cell.effect === 'refusal') {
        const m = applyShareClosed(area, share);
        result.log.push(`  ⚠️ ${hit.jp} からの避難は同日24時まで不可 ≒ ${name} の本日容量${pct(m)}（集落の人口シェア${(share * 100).toFixed(1)}%で近似・他集落の避難は可）`);
        return `【避難拒否】${hit.jp} ${name}容量${pct(m)}`;
      }
      const m = applyShareCost(area, share, SETTLEMENT_COST_FACTOR);
      result.log.push(`  ⚠️ ${hit.jp} からの避難コスト×${SETTLEMENT_COST_FACTOR}（同日24時まで）≒ ${name} の本日容量${pct(m)}（集落の人口シェア${(share * 100).toFixed(1)}%で近似）`);
      return `【${effJp}】${hit.jp} ${name}容量${pct(m)}`;
    }
    case 'aInfraFishing': {
      const effJp = { panic: 'パニック', traffic: '交通混乱', comms: '通信不良' }[cell.effect];
      const factor = cell.effect === 'comms' ? 2 : 1.5;
      const die = rollDie();
      result.log.push(`${head} 【インフラ漁港で${effJp}】ダイス${die} → ${die <= 2 ? '漁港表' : 'インフラ表'}を参照`);
      if (die <= 2) {
        const { hit } = lookup2(FISHING_PORT_TABLE, result.log, '漁港表');
        if (!hit) return `【${effJp}】漁港表=発生無し`;
        if (!hit.key) {
          result.log.push(`  ${hit.jp} は避難に影響しない漁港 → 影響なし`);
          return `【${effJp}】${hit.jp} 影響なし`;
        }
        const c = fishingCondition(hit.key);
        if (!c.ok) {
          result.log.push(`  ${hit.jp}: 条件「${c.cond}」を満たさない（通常港が使用可能）→ 影響なし`);
          return `【${effJp}】${hit.jp} 条件未成立・影響なし`;
        }
        result.hubSeaMultiplier[c.hub] *= 1 / factor;
        result.log.push(`  ⚠️ ${hit.jp}: ${c.cond}のため海保輸送船・海自輸送艦で脱出する際の避難コスト×${factor}（同日24時まで）→ ${state.areas[c.hub].name} の海保・海自容量×1/${factor}（近似）`);
        return `【${effJp}】${hit.jp} 海保・海自×1/${factor}`;
      }
      const { hit } = lookup2(INFRA_TABLE, result.log, 'インフラ表');
      if (!hit) return `【${effJp}】インフラ表=発生無し`;
      const msg = applyInfraTarget(hit, { factor });
      result.log.push(`  ⚠️ 輸送コスト×${factor}（同日24時まで）: ${msg}`);
      return `【${effJp}】${hit.jp} ×1/${factor}`;
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
      result.log.push(`  ⚠️ ${fjp} は同日24時まで使用不可能（当日の便0）`);
      return `【${evJp}】${fjp} 当日閉鎖`;
    }
    case 'aBoycott': {
      result.log.push(`${head} 【空港/海港乗員船員のボイコット】`);
      if (!rollOccurrence(prepLevel, result.log, 'ボイコット')) return '【ボイコット未遂】';
      const { hit } = lookup2(INFRA_TABLE, result.log, 'インフラ表');
      if (!hit) return '【ボイコット】インフラ表=発生無し';
      if ('bridge' in hit) {
        result.log.push(`  ${hit.jp} は陸橋のため発生しない`);
        return `【ボイコット不発】${hit.jp}`;
      }
      const msg = applyInfraTarget(hit, { closed: true });
      result.log.push(`  ⚠️ ${hit.jp} からの出発は同日24時まで不可能（受け入れは通常通り可）: ${msg}`);
      return `【ボイコット】${hit.jp} 出発不可`;
    }

    // ===== B/C表 =====
    case 'airClosedToday': {
      const jp = AIR_ROUTE_JP[cell.air];
      const inv = facilityInvalid(cell.air);
      if (inv) {
        result.log.push(`${head} 【${jp} ドローン障害物散布】${inv} → 無効`);
        return `【障害物散布無効】${inv}`;
      }
      result.log.push(`${head} 【${jp} ドローン障害物散布】`);
      if (!rollOccurrence(prepLevel, result.log, '障害物散布')) return `【障害物散布未遂】${jp}`;
      closeFacilityToday(cell.air);
      result.log.push(`  ⚠️ ${jp} は同日24時まで使用不可能`);
      return `【当日閉鎖】${jp}`;
    }
    case 'shipClosedToday': {
      const jp = SHIP_ROUTE_JP[cell.ship];
      const inv = facilityInvalid(undefined, cell.ship);
      if (inv) {
        result.log.push(`${head} 【${jp} ${cell.jp}】${inv} → 無効`);
        return `【${cell.jp}無効】${inv}`;
      }
      result.log.push(`${head} 【${jp} ${cell.jp}】`);
      if (!rollOccurrence(prepLevel, result.log, cell.jp)) return `【${cell.jp}未遂】${jp}`;
      closeFacilityToday(undefined, cell.ship);
      result.log.push(`  ⚠️ ${jp} は同日24時まで使用不可能（当日の船舶便0${cell.ship === 'ishigakiPort' ? '・竹富町/与那国からの着港も不可' : ''}）`);
      return `【当日閉鎖】${jp} ${cell.jp}`;
    }
    case 'airCongestion': {
      const jp = AIR_ROUTE_JP[cell.air];
      const inv = facilityInvalid(cell.air);
      if (inv) {
        result.log.push(`${head} 【${jp} 軍民航空機運航錯綜】${inv} → 無効`);
        return `【錯綜無効】${inv}`;
      }
      result.log.push(`${head} 【${jp} 軍民航空機運航錯綜】`);
      if (!rollOccurrence(prepLevel, result.log, '軍民錯綜')) return `【錯綜未遂】${jp}`;
      win(`air:${cell.air}`, hour <= 12 ? 12 : 24);
      result.log.push(`  ⚠️ ${jp}: ${congestionWindow(hour)}（この時間帯の離着陸不可。それ以外の時刻の便は通常通り）`);
      return `【錯綜】${jp} ${hour <= 12 ? '12時まで' : '24時まで'} 容量×0.5`;
    }
    case 'shipCongestion': {
      const jp = SHIP_ROUTE_JP[cell.ship];
      const inv = facilityInvalid(undefined, cell.ship);
      if (inv) {
        result.log.push(`${head} 【${jp} 軍民船舶運航錯綜】${inv} → 無効`);
        return `【錯綜無効】${inv}`;
      }
      result.log.push(`${head} 【${jp} 軍民船舶運航錯綜】`);
      if (!rollOccurrence(prepLevel, result.log, '軍民錯綜')) return `【錯綜未遂】${jp}`;
      win(`port:${cell.ship}`, hour <= 12 ? 12 : 24);
      result.log.push(`  ⚠️ ${jp}: ${congestionWindow(hour)}（この時間帯の出入港不可${cell.ship === 'ishigakiPort' ? '・竹富町/与那国からの着港も不可' : ''}。それ以外の時刻の便は通常通り）`);
      return `【錯綜】${jp} ${hour <= 12 ? '12時まで' : '24時まで'} 船舶便×0.5`;
    }
    case 'mine': {
      const jp = cell.ship ? SHIP_ROUTE_JP[cell.ship] : TAKETOMI_PORT_JP[cell.tport!];
      const inv = cell.ship ? facilityInvalid(undefined, cell.ship) : tportInvalid(cell.tport!);
      if (inv) {
        result.log.push(`${head} 【${jp} 機雷敷設】${inv} → 無効`);
        return `【機雷無効】${inv}`;
      }
      result.log.push(`${head} 【${jp} 機雷敷設】`);
      if (!rollOccurrence(prepLevel, result.log, '機雷敷設')) return `【機雷未遂】${jp}`;
      if (cell.ship) {
        closeFacilityToday(undefined, cell.ship);
        result.log.push(`  ⚠️ ${jp} は同日24時まで使用不可能（当日の船舶便0${cell.ship === 'ishigakiPort' ? '・竹富町/与那国からの着港も不可' : ''}）`);
      } else {
        win(`tport:${cell.tport!}`); result.tportClosedToday[cell.tport!] = true;
        result.log.push(`  ⚠️ ${jp} は${hour}時から同日24時まで使用不可能（それより前に出た便は出発済み）`);
      }
      return `【機雷】${jp} 当日閉鎖`;
    }
    case 'emergencyLanding': {
      // マニュアル(2026.9): 当該空港の輸送能力を翌日24時まで −25%。同じ空港に他国機も不時着中なら合計 −50%。
      // 破壊された空港では発生しない（応急復旧前）。既占領エリアは無効。
      const jp = AIR_ROUTE_JP[cell.air];
      const cJp = cell.country === 'china' ? '中国軍機' : '台湾軍機';
      const label = `${jp} ${cJp}不時着`;
      const inv = facilityInvalid(cell.air);
      if (inv) {
        result.log.push(`${head} 【${label}】${inv} → 発生しない`);
        return `【不時着無効】${inv}`;
      }
      result.log.push(`${head} 【${label}】`);
      if (!rollOccurrence(prepLevel, result.log, '不時着')) return `【不時着未遂】${label}`;
      result.landingsToday.push({ air: cell.air, country: cell.country });
      const prior = (state.airportLandings ?? []).filter(l => l.air === cell.air && l.untilDay >= state.day).map(l => l.country);
      const countries = new Set([...prior, ...result.landingsToday.filter(l => l.air === cell.air).map(l => l.country)]);
      const pctDown = Math.min(50, 25 * countries.size);
      result.log.push(`  ⚠️ ${cJp}が${jp}に不時着 → ${jp}からの輸送能力を翌日24時まで −25%${countries.size >= 2 ? `（他国機も不時着中のため合計 −${pctDown}%）` : ''}`);
      return `【不時着】${label} 輸送能力−${pctDown}%(翌日24時まで)`;
    }
    case 'airMissileShootdown': {
      const jp = AIR_ROUTE_JP[cell.air];
      const inv = routeInvalid(cell.air, undefined);
      if (inv) {
        result.log.push(`${head} 【${jp} 航空便に攻撃】${inv} → 無効`);
        return `【航空便攻撃無効】${inv}`;
      }
      if (!airDepartedBefore(cell.air)) {
        result.log.push(`${head} 【${jp} 航空便に攻撃】当日${hour}時より前に出発した便が無い → セーフ（発生せず）`);
        return `【航空便攻撃不成立】${jp} 当日まだ1便も出発していない`;
      }
      const r = resolveInterdiction(military);
      result.log.push(`${head} 【${jp} 航空便に攻撃(撃墜判定)】計${r.calcValue} / 閾値${r.threshold}`);
      if (r.hit) {
        result.disabledAirRoutes[cell.air] = true;
        win(`civ:${cell.air}`); result.lostTrips[`air:${cell.air}`] = (result.lostTrips[`air:${cell.air}`] ?? 0) + 1;
        result.newDead += 1;
        result.deadByArea[AIR_ROUTE_AREA[cell.air]] += 1; // 出発エリアの人口から除去（prepareDayPhase1）
        result.casualtyTimeline.push({ kind: 'asset', area: AIR_ROUTE_AREA[cell.air], n: 1 });
        allAreasFatigue(1);
        result.log.push(`  ⚠️ 撃墜成立! ${jp}から同日に出発した1コマ死亡(${state.areas[AIR_ROUTE_AREA[cell.air]].name})・${jp}発の民間航空便は今後一切使用不能・全4エリア疲労+1`);
        return `【撃墜】${jp} 航空便 計${r.calcValue}≥${r.threshold}`;
      }
      return `【航空便攻撃】${jp} 計${r.calcValue}<${r.threshold} 回避`;
    }
    case 'shipMissileSink': {
      const jp = cell.ship ? SHIP_ROUTE_JP[cell.ship] : TAKETOMI_PORT_JP[cell.tport!];
      let inv = cell.ship ? routeInvalid(undefined, cell.ship) : tportInvalid(cell.tport!);
      if (!inv && cell.tport && (state.transport.disabledTaketomiPorts?.[cell.tport] || result.disabledTaketomiPorts[cell.tport])) inv = `${jp} の船舶便は既に停止済み`;
      if (inv) {
        result.log.push(`${head} 【${jp} 船舶便に攻撃】${inv} → 無効`);
        return `【船舶便攻撃無効】${inv}`;
      }
      if (!shipDepartedBefore(cell.ship, cell.tport)) {
        result.log.push(`${head} 【${jp} 船舶便に攻撃】当日${hour}時より前に出発した便が無い → セーフ（発生せず）`);
        return `【船舶便攻撃不成立】${jp} 当日まだ1便も出発していない`;
      }
      const r = resolveInterdiction(military);
      result.log.push(`${head} 【${jp} 船舶便に攻撃(撃沈判定)】計${r.calcValue} / 閾値${r.threshold}`);
      if (r.hit) {
        const area: AreaId = cell.ship ? SHIP_ROUTE_AREA[cell.ship] : 'taketomi';
        if (cell.ship) { result.disabledShipRoutes[cell.ship] = true; win(`civship:${cell.ship}`); result.lostTrips[`ship:${cell.ship}`] = (result.lostTrips[`ship:${cell.ship}`] ?? 0) + 1; }
        else { result.disabledTaketomiPorts[cell.tport!] = true; win(`tportstop:${cell.tport!}`); result.lostTrips[`tport:${cell.tport!}`] = (result.lostTrips[`tport:${cell.tport!}`] ?? 0) + 1; }
        result.newDead += 1;
        result.deadByArea[area] += 1; // 出発エリアの人口から除去（prepareDayPhase1）
        result.casualtyTimeline.push({ kind: 'asset', area, n: 1 });
        allAreasFatigue(1);
        result.log.push(`  ⚠️ 撃沈成立! ${jp}から同日に出発した1コマ死亡(${state.areas[area].name})・${jp}発の民間船舶便は今後一切使用不能・全4エリア疲労+1`);
        return `【撃沈】${jp} 船舶便 計${r.calcValue}≥${r.threshold}`;
      }
      return `【船舶便攻撃】${jp} 計${r.calcValue}<${r.threshold} 回避`;
    }
    case 'airFacilityMissile': {
      const jp = AIR_ROUTE_JP[cell.air];
      const area = AIR_ROUTE_AREA[cell.air];
      const infraKey = AIR_ROUTE_INFRA[cell.air];
      if (occupied(area)) {
        result.log.push(`${head} 【${jp} ミサイル攻撃(施設)】既に占領済みエリア → 無効`);
        return `【施設攻撃無効】${jp} 既に占領済み`;
      }
      if (infraBroken(infraKey)) {
        result.log.push(`${head} 【${jp} ミサイル攻撃(施設)】既に破壊済み・無効`);
        return `【施設攻撃無効】${jp} 既に破壊済み`;
      }
      const r = resolveFacilityMissile(military, area, cell.air);
      result.log.push(`${head} 【${jp} ミサイル攻撃(施設破壊判定)】${r.detail}`);
      if (r.hit) {
        result.infraPenalty[infraKey] = false;
        win(`air:${cell.air}`);
        result.log.push(`  ⚠️ 施設破壊! ${jp}は${hour}時以後使用不能（同日24時まで応急復旧 → 翌日1時から空自輸送機・陸自ヘリのみ使用可）`);
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
        result.log.push(`${head} 【${jp} ミサイル攻撃(施設)】既に占領済みエリア → 無効`);
        return `【施設攻撃無効】${jp} 既に占領済み`;
      }
      if (infraBroken(infraKey)) {
        result.log.push(`${head} 【${jp} ミサイル攻撃(施設)】既に破壊済み・無効`);
        return `【施設攻撃無効】${jp} 既に破壊済み`;
      }
      const r = resolveFacilityMissile(military, area);
      result.log.push(`${head} 【${jp} ミサイル攻撃(施設破壊判定)】${r.detail}`);
      if (r.hit) {
        result.infraPenalty[infraKey] = false;
        win(`port:${cell.ship}`);
        result.log.push(`  ⚠️ 施設破壊! ${jp}は${hour}時以後使用不能`);
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
        result.log.push(`${head} 【${cell.jp} 電力設備ミサイル攻撃】既に占領済みエリア → 無効`);
        return `【電力攻撃無効】${cell.jp} 既に占領済み`;
      }
      if (infraBroken(infraKey)) {
        result.log.push(`${head} 【${cell.jp} 電力設備ミサイル攻撃】既に破壊済み・無効`);
        return `【電力攻撃無効】${cell.jp} 既に破壊済み`;
      }
      // PAC3: 石垣島竹富町電力=石垣PAC3 / 宮古島電力=宮古PAC3 / 波照間・多良間・与那国=無し（pac3For: 与那国は範囲外=0）
      const pac3Scope = (cell.power === 'tarama' || cell.power === 'hateruma') ? 'outside' : undefined;
      const r = resolveFacilityMissile(military, area, pac3Scope);
      result.log.push(`${head} 【${cell.jp} 電力設備ミサイル攻撃】${r.detail}`);
      if (!r.hit) return `【電力攻撃】${cell.jp} 計${r.calcValue}<${r.threshold} 防護成功`;
      if (cell.power === 'tarama') {
        result.infraPenalty.powerTarama = false;
        result.taramaPowerBrokenToday = true;
        result.log.push('  ⚠️ 発電所破壊! 多良間島は以後停電 → 多良間島の住民が全員宮古島に避難完了するまで 宮古島・多良間エリア疲労+2（完了で0）');
        // ver4.0 6.7: 施設破壊時の死傷者判定は「空港・海港」限定。電力設備には適用しない
        return '【電力破壊】多良間島(避難完了まで+2)';
      }
      if (cell.power === 'hateruma') {
        result.infraPenalty.powerHateruma = false;
        result.haterumaPowerBrokenToday = true;
        result.log.push('  ⚠️ 発電所破壊! 波照間島は以後停電 → 波照間島の住民が全員石垣島に避難完了するまで 竹富町全島エリア疲労+2（完了で0）');
        return '【電力破壊】波照間島(避難完了まで+2)';
      }
      result.infraPenalty[infraKey] = false;
      result.fatigueIncrease[area] += 1; // 即時+1
      if (cell.power === 'ishigaki') result.fatigueIncrease.taketomi += 1; // 石垣島電力は竹富町全島エリアにも即時+1・毎日+1
      result.log.push(`  ⚠️ 発電所破壊! ${cell.jp}が停電・断水 → 即時 疲労+1、以後毎日1:00に 疲労+1(6〜10月の夏季+2)${cell.power === 'ishigaki' ? '（石垣島・竹富町全島の両エリア）' : ''}`);
      return `【電力破壊】${cell.jp} 停電`;
    }
    case 'bridge': {
      const area: AreaId = 'miyako';
      if (occupied(area)) {
        result.log.push(`${head} 【${cell.jp} ミサイル攻撃(施設)】既に占領済みエリア → 無効`);
        return `【橋攻撃無効】${cell.jp} 既に占領済み`;
      }
      if (infraBroken(cell.infra)) {
        result.log.push(`${head} 【${cell.jp} ミサイル攻撃(施設)】既に破壊済み・無効`);
        return `【橋攻撃無効】${cell.jp} 既に破壊済み`;
      }
      const r = resolveFacilityMissile(military, area);
      result.log.push(`${head} 【${cell.jp} ミサイル攻撃(施設破壊判定・宮古PAC3)】${r.detail}`);
      if (r.hit) {
        result.infraPenalty[cell.infra] = false;
        if (cell.infra === 'bridgeIrabu') win('air:shimoji'); // 下地島空港は伊良部大橋経由でしか行けない
        result.log.push(`  ⚠️ 橋破壊! ${cell.jp}は以後通行不能`);
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
      result.log.push(`${head} 【${jp} 航空便運航拒否(判定)】計${r.calcValue} / 閾値${r.threshold}`);
      if (r.hit) {
        result.disabledAirRoutes[cell.air] = true;
        win(`civ:${cell.air}`);
        result.log.push(`  ⚠️ 運航拒否確定! ${jp}発の民間航空便は${hour}時以後一切使用不能`);
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
      result.log.push(`${head} 【${jp} 船舶便運航拒否(判定)】計${r.calcValue} / 閾値${r.threshold}`);
      if (r.hit) {
        result.disabledShipRoutes[cell.ship] = true;
        win(`civship:${cell.ship}`);
        result.log.push(`  ⚠️ 運航拒否確定! ${jp}発の民間船舶便は${hour}時以後一切使用不能`);
        return `【運航拒否】${jp} 船舶便 計${r.calcValue}≥${r.threshold}`;
      }
      return `【運航拒否判定】${jp} 船舶便 計${r.calcValue}<${r.threshold} 継続`;
    }
    case 'attackCoastGuard': {
      if (!assetDepartedBefore('cg')) {
        result.log.push(`${head} 【海保輸送船に攻撃】当日${hour}時より前に出発した便が無い → セーフ（発生せず）`);
        return '【海保攻撃不成立】当日まだ1便も出発していない';
      }
      const r = resolveInterdiction(military);
      result.log.push(`${head} 【海保輸送船に攻撃(撃沈判定)】計${r.calcValue} / 閾値${r.threshold}`);
      if (r.hit) {
        result.coastGuardMaxDelta -= 1;
        const from = assetDeathArea(state, result);
        allAreasFatigue(1);
        result.log.push(`  ⚠️ 撃沈成立! 同日に出発した1コマ死亡${from ? `(${state.areas[from].name})` : '→ 乗客なしのため死者0'}・全4エリア疲労+1・海保輸送船の1日便数−1`);
        return `【海保撃沈】便数-1 計${r.calcValue}≥${r.threshold}`;
      }
      return `【海保攻撃】計${r.calcValue}<${r.threshold} 回避`;
    }
    case 'attackAsset': {
      const assetKey = cell.jp === '海自輸送艦' ? 'jmsdf' : cell.jp === '空自輸送機' ? 'jasdf' : 'jgsdf';
      if (!assetDepartedBefore(assetKey)) {
        result.log.push(`${head} 【${cell.jp}に攻撃】当日${hour}時より前に出発した便が無い → セーフ（発生せず）`);
        return `【${cell.jp}攻撃不成立】当日まだ1便も出発していない`;
      }
      const r = resolveInterdiction(military);
      result.log.push(`${head} 【${cell.jp}に攻撃(撃墜判定)】計${r.calcValue} / 閾値${r.threshold}`);
      if (r.hit) {
        const from = assetDeathArea(state, result);
        allAreasFatigue(1);
        result.assetLost[assetKey] += 1; // その便は使用済み（残回数−1）。海自・空自は当日の1便を失ったので本日はもう使えない
        result.log.push(`  ⚠️ 攻撃成立! ${cell.jp}で同日に輸送した1コマ死亡${from ? `(${state.areas[from].name})` : '→ 乗客なしのため死者0'}・全4エリア疲労+1（翌日からも${cell.jp}は通常通り使用可）`);
        return `【${cell.jp}被害】計${r.calcValue}≥${r.threshold}`;
      }
      return `【${cell.jp}攻撃】計${r.calcValue}<${r.threshold} 回避`;
    }

    // ===== D表 =====
    case 'dUrbanMissile': {
      // 死傷者計算数 = 3ダイス + 中国軍 − (海空警護 + 当該島PAC3) − 3×抗堪性。≤0 なし / 1〜10 疲労+1(DMAT未派遣でさらに+1) / ≥11 0.5コマ死亡・+1(DMAT未派遣でさらに0.5死亡+1)
      const targetArea = cell.area;
      const areaName = state.areas[targetArea].name;
      if (occupied(targetArea)) {
        result.log.push(`${head} 【${cell.jp}ミサイル攻撃】${areaName} は既に占領済み → 無効`);
        return `【市街攻撃無効】${areaName} 既に占領済み`;
      }
      // ver4.0 4.4④: 無人集落への攻撃は無効（当日既計上の死者を差し引いた残存で判定）
      if (alivePop(state, result, targetArea) <= 0) {
        result.log.push(`${head} 【${cell.jp}ミサイル攻撃】${areaName} は無人 → 無効`);
        return `【市街攻撃無効】${areaName} 無人`;
      }
      const chinaTotal = military.chineseSea + military.chineseAir;
      const jsdfTotal = military.jsdfSea + military.jsdfAir;
      const pac3 = pac3For(targetArea, military);
      const diceSum = sumDice(3);
      const calcValue = diceSum + chinaTotal - (jsdfTotal + pac3) - 3 * state.shelterLevel;
      result.log.push(`${head} 【${cell.jp}ミサイル攻撃】死傷者計算数: ダイス${diceSum}+中${chinaTotal}-(自${jsdfTotal}+PAC3${pac3})-抗堪${state.shelterLevel}×3=計${calcValue}`);
      if (calcValue >= 11) {
        result.log.push(`  ⚠️ 計${calcValue}≥11 → 0.5コマ死亡・${areaName}疲労+1・DMAT対象（未派遣ならさらに0.5コマ死亡・疲労+1）`);
        result.newDead += 0.5; // 計上値（人口除去と死者確定は prepareDayPhase1 7b' の逐次DMAT処理で行う）
        result.dmatDeathAreas.push({ area: targetArea, severity: 'major' });
        result.casualtyTimeline.push({ kind: 'dmat', area: targetArea, severity: 'major' });
        return `【市街攻撃・0.5コマ死亡】${areaName} 計${calcValue}≥11`;
      } else if (calcValue >= 1) {
        result.log.push(`  ⚠️ 計${calcValue}(1〜10) → コマ死亡なし・${areaName}疲労+1・DMAT対象（未派遣ならさらに疲労+1）`);
        result.dmatDeathAreas.push({ area: targetArea, severity: 'minor' });
        result.casualtyTimeline.push({ kind: 'dmat', area: targetArea, severity: 'minor' });
        return `【市街攻撃・疲労+1】${areaName} 計${calcValue}(1〜10)`;
      }
      return `【市街攻撃】${areaName} 計${calcValue}≤0 被害なし`;
    }
    case 'dLanding':
    case 'dHeliborne': {
      // 上陸/ヘリボーン (3ダイス): 合計+中−自 ≧15（尖閣占領なら ≧12）。成立で占領＝残存住民全員死亡・全4エリア疲労+2。既占領は無効。
      // ヘリボーンの占領範囲: 宮古空港→宮古島＋陸続き（橋が無事な 来間/伊良部・下地/池間）／新石垣→石垣島／下地島→伊良部・下地島＋陸続き（伊良部大橋が無事なら宮古島＋来間/池間）。
      // エンジンはエリア単位のため、橋が破壊されて陸続きでない離島の人口シェア(MIYAKO_ISLAND_SHARE)を占領から除く近似。
      const targetArea: AreaId = cell.kind === 'dLanding' ? cell.area : cell.airport === 'shinIshigaki' ? 'ishigaki' : 'miyako';
      const areaName = state.areas[targetArea].name;
      if (occupied(targetArea)) {
        result.log.push(`${head} 【${cell.jp}】${areaName} は既に占領済み → 無効`);
        return `【${cell.jp}無効】${areaName} 既に占領済み`;
      }
      // 占領シェア（1=エリア全域）
      let share = 1;
      const spared: string[] = [];
      if (cell.kind === 'dHeliborne' && targetArea === 'miyako') {
        const kurimaOk = !infraBroken('bridgeKurima');
        const irabuOk = !infraBroken('bridgeIrabu');
        const ikemaOk = !infraBroken('bridgeIkema');
        if (cell.airport === 'miyako') {
          if (!kurimaOk) { share -= MIYAKO_ISLAND_SHARE.kurima; spared.push('来間島(来間大橋破壊)'); }
          if (!irabuOk) { share -= MIYAKO_ISLAND_SHARE.irabuShimoji; spared.push('伊良部島・下地島(伊良部大橋破壊)'); }
          if (!ikemaOk) { share -= MIYAKO_ISLAND_SHARE.ikema; spared.push('池間島(池間大橋破壊)'); }
        } else {
          // 下地島空港: 伊良部大橋が無事なら宮古島も占領（来間/池間は各橋次第）。破壊済みなら伊良部・下地島のみ
          if (irabuOk) {
            if (!kurimaOk) { share -= MIYAKO_ISLAND_SHARE.kurima; spared.push('来間島(来間大橋破壊)'); }
            if (!ikemaOk) { share -= MIYAKO_ISLAND_SHARE.ikema; spared.push('池間島(池間大橋破壊)'); }
          } else {
            share = MIYAKO_ISLAND_SHARE.irabuShimoji;
            spared.push('宮古島・来間島・池間島(伊良部大橋破壊で陸続きでない)');
          }
        }
      }
      const chinaTotal = military.chineseSea + military.chineseAir;
      const jsdfTotal = military.jsdfSea + military.jsdfAir;
      const diceSum = sumDice(3);
      const calcValue = diceSum + chinaTotal - jsdfTotal;
      const threshold = military.senkakuOccupied ? 12 : 15;
      result.log.push(`${head} 【${cell.jp}】${areaName}: ダイス${diceSum}+中${chinaTotal}-自${jsdfTotal}=計${calcValue} / 閾値${threshold}${military.senkakuOccupied ? '(尖閣占領)' : ''}`);
      if (calcValue < threshold) return `【${cell.jp}】${areaName} 計${calcValue}<${threshold} 撃退`;
      areas.forEach(x => { result.fatigueIncrease[x] += 2; });
      if (share >= 1 - 1e-9) {
        // ver4.0 6.4.2/3: エリア全域占領 = 残存コマは全員死傷。全4エリア疲労+2。以後そのエリアは占領状態。
        // 全滅死者数の確定と人口の0化は prepareDayPhase1 7b'''（当日既計上の死者を差し引き二重計上を防ぐ）。
        result.occupiedToday[targetArea] = true;
        result.log.push(`  ⚠️ ${cell.jp}成立! ${areaName} 全域を占領 → 残存住民全員死亡・全4エリア疲労+2・以後このエリアへの攻撃/避難は無効`);
        return `【${cell.jp}成立】${areaName} 占領 計${calcValue}≥${threshold} 残存コマ全滅`;
      }
      // 部分占領（陸続きでない離島は免れる）: 当日残存の share ぶんを死者として計上（0.5コマ単位・切り捨て）。エリアは占領状態にしない
      const alive = alivePop(state, result, targetArea);
      const n = Math.floor(alive * share * 2 + 1e-9) / 2;
      result.newDead += n;
      result.deadByArea[targetArea] += n;
      if (n > 0) result.casualtyTimeline.push({ kind: 'asset', area: targetArea, n });
      result.log.push(`  ⚠️ ${cell.jp}成立! ${areaName} の一部（人口シェア${(share * 100).toFixed(1)}%）を占領 → 死者${n}コマ・全4エリア疲労+2。免れた地域: ${spared.join('・')}（エリア単位の近似。エリア自体は占領状態にしない）`);
      return `【${cell.jp}成立】${areaName} 一部占領(${(share * 100).toFixed(0)}%) 死者${n}コマ`;
    }
    case 'dGuardLoss': {
      // 2ダイス + 中国軍 − 警護 ≧13（尖閣占領なら ≧11）→ 対象（海自 or 空自）を −1。翌日4時のダイスで復活可
      const chinaTotal = military.chineseSea + military.chineseAir;
      const jsdfTotal = military.jsdfSea + military.jsdfAir;
      const jp = cell.target === 'sea' ? '海上自衛隊海空警護' : '航空自衛隊空域警護';
      const diceSum = sumDice(2);
      const calcValue = diceSum + chinaTotal - jsdfTotal;
      const threshold = military.senkakuOccupied ? 11 : 13;
      result.log.push(`${head} 【${jp}喪失-1】ダイス${diceSum}+中${chinaTotal}-自${jsdfTotal}=計${calcValue} / 閾値${threshold}${military.senkakuOccupied ? '(尖閣占領)' : ''}`);
      if (calcValue < threshold) return `【${jp}喪失回避】計${calcValue}<${threshold}`;
      if (cell.target === 'sea') {
        if (military.jsdfSea <= 0) { result.log.push('  喪失成立だが海自 海空警護は0 → 無効'); return `【${jp}喪失】対象0(無効)`; }
        military.jsdfSea -= 1;
      } else {
        if (military.jsdfAir <= 0) { result.log.push('  喪失成立だが空自 空域警護は0 → 無効'); return `【${jp}喪失】対象0(無効)`; }
        military.jsdfAir -= 1;
      }
      result.log.push(`  ⚠️ ${jp} −1 → 海自${military.jsdfSea}・空自${military.jsdfAir}（翌日4時のダイスで復活可）`);
      return `【${jp}喪失】計${calcValue}≥${threshold} −1`;
    }
    case 'dSenkaku': {
      if (military.senkakuOccupied) {
        result.log.push(`${head} 【尖閣諸島占領】既に占領済み → 無効`);
        return '【尖閣】既に占領済み';
      }
      const chinaTotal = military.chineseSea + military.chineseAir;
      const jsdfTotal = military.jsdfSea + military.jsdfAir;
      const diceSum = sumDice(3);
      const calcValue = diceSum + chinaTotal - jsdfTotal;
      const threshold = 15;
      result.log.push(`${head} 【尖閣諸島占領判定】ダイス${diceSum}+中${chinaTotal}-自${jsdfTotal}=計${calcValue} / 閾値${threshold}`);
      if (calcValue >= threshold) {
        result.log.push('  ⚠️ 尖閣諸島占領! 以後の各判定閾値が不利側へ(撃墜/上陸≧12・施設≧14・喪失≧11)');
        result.senkakuOccupied = true;
        military.senkakuOccupied = true; // 当日以降のイベントにも即時反映
        return `【尖閣占領】計${calcValue}≥${threshold}`;
      }
      return `【尖閣占領回避】計${calcValue}<${threshold}`;
    }
  }
}

function processEvent(
  eventType: 'A' | 'B' | 'C' | 'D',
  state: GameState,
  result: EventResult,
  military: MilitaryState,
  hour: number,
  forcedCol?: number,
  forcedRow?: number
): string {
  // A/B/C/D は 2ダイス表駆動（1投目=列, 2投目=行）。各表 6×6（マニュアル 2026.9）。
  const table = eventType === 'A' ? EVENT_A_TABLE : eventType === 'B' ? EVENT_B_TABLE : eventType === 'C' ? EVENT_C_TABLE : EVENT_D_TABLE;
  const col = forcedCol ?? rollDie(); // 1投目=列(1..6)
  const row = forcedRow ?? rollDie(); // 2投目=行(1..6)
  const cell: EventCell = (table[col - 1]?.[row - 1]) ?? { kind: 'none' };
  return processEventCell(cell, eventType, `1投目${col}・2投目${row}`, result, military, state, hour);
}

// ===== 1日の輸送容量計算 =====
// 路線別のイベント倍率（マニュアル2026.9）。省略時は全て1。
export interface RouteMultipliers {
  air: Record<AirRouteKey, number>;                 // 空港別の出発容量倍率（錯綜0.5 / インフラ表 / ボイコット0）
  ship: Record<ShipRouteKey, number>;               // 港別の民間船舶便倍率
  tport: Record<TaketomiPortKey, number>;           // 竹富町離島港別倍率（機雷/ボイコット=0 等）
  hubSea: Record<'ishigaki' | 'miyako', number>;    // 漁港表: ハブの海保・海自容量倍率
  closedAir: AirRouteKey[];                         // 当日限りの空港閉鎖（サイバー/大乱闘/ドローン）。応急復旧後の空自運用にも適用
  destroyedTodayAir: Partial<Record<AirRouteKey, boolean>>; // 当日破壊された空港（応急復旧は同日24時までかかるため当日は空自も不可）
}
const UNIT_ROUTE_MUL: RouteMultipliers = {
  air: { shinIshigaki: 1, miyako: 1, shimoji: 1, yonaguni: 1, hateruma: 1 },
  ship: { ishigakiPort: 1, hiraraPort: 1, kubura: 1 },
  tport: { ohara: 1, uehara: 1, kohama: 1, taketomi: 1, kuroshima: 1, hateruma: 1, hatoma: 1, funauki: 1 },
  hubSea: { ishigaki: 1, miyako: 1 },
  closedAir: [], destroyedTodayAir: {},
};

export function getDayCapacities(
  state: GameState,
  airportAvail: Record<string, boolean>,
  seaOk: boolean,
  capMul: Record<AreaId, number> = { yonaguni: 1, taketomi: 1, ishigaki: 1, miyako: 1 },
  seaMul: Record<AreaId, number> = { yonaguni: 1, taketomi: 1, ishigaki: 1, miyako: 1 },
  // ピストン発火判定用の空港可否（当日限りの一時閉鎖=サイバー/大乱闘/ボイコット/ドローンを含めない）。省略時は airportAvail
  hubAirportAvail: Record<string, boolean> = airportAvail,
  routeMul: RouteMultipliers = UNIT_ROUTE_MUL,
  // 当日の時刻表（便数）。省略時は state.weather を終日の天候とみなし、イベントなしで算出する
  slots?: DaySlots
): DayCapacities {
  const { prepLevel, transport, phase } = state;
  const settings = PREP_LEVEL_SETTINGS[prepLevel as keyof typeof PREP_LEVEL_SETTINGS];
  const isWartime = phase === 'wartime';
  const isCrisis = phase === 'crisis';
  // 空港別の出発容量倍率 = イベント倍率（錯綜/インフラ表/ボイコット）× 不時着倍率（−25%/国・最大−50%・翌日24時まで）
  const am = (r: AirRouteKey) => routeMul.air[r] * airportLandingFactor(state, r);
  // 空自輸送機の空港使用可否: 通常は airportAvail。破壊済み空港は「同日24時まで応急復旧」後＝翌日から空自輸送機・陸自ヘリのみ使用可
  // （民間便は不可のまま）。当日破壊・当日閉鎖（サイバー等）・悪天候（風向/大雨）では不可。
  // 時刻表モデル: 便数は「出発時刻に空港・港が開いていたか」で数える（午前=1時の天候 / 午後=13時の天候 / イベントは発生時刻から）
  const sl: DaySlots = slots ?? computeDaySlots({
    am: state.weather, pm: state.weather, month: state.month, phase, prepLevel,
    infraStart: { ...state.infra, shimojiAirport: state.infra.shimojiAirport && state.infra.bridgeIrabu },
    flightLimit: settings.airFlightsWartime, h24: settings.crisis24h, crisisEvacOk: prepLevel >= CRISIS_EVAC_MIN_LEVEL,
    civAirStopped: transport.civilianAirDisabled ? { shinIshigaki: true, miyako: true, shimoji: true, yonaguni: true, hateruma: true } : transport.disabledAirRoutes,
    civShipStopped: transport.civilianShipDisabled ? { ishigakiPort: true, hiraraPort: true, kubura: true } : transport.disabledShipRoutes,
    tportStopped: transport.disabledTaketomiPorts ?? {}, closures: [], freezeUntil: 0,
  });
  // 空自輸送機は、滑走路が使える時間帯が1時間でもあれば離着陸できる（破壊された空港も応急復旧後＝翌日以降は可。
  // 当日の破壊は発生時刻から不可）。下地島は伊良部大橋が落ちると到達できない。
  const jasdfAirfieldOk = (r: AirRouteKey): boolean => {
    if (r === 'shimoji' && !state.infra.bridgeIrabu) return false;
    return sl.airfield[r];
  };
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
  // 石垣港の破壊・閉鎖は時刻表側（着く時刻に入港できるか）で判定済み。ここで日末の破壊フラグを重ねると、破壊前に着いた便まで取り消してしまう
  const ishigakiPortOpen = !isOccupied(state, 'ishigaki') && (isWartime || (isCrisis && prepLevel >= CRISIS_EVAC_MIN_LEVEL));
  // 海自輸送艦・空自輸送機は1日1便。当日の便を攻撃で失っていたら本日はもう使えない
  const jmsdfOkToday = transport.jmsdfRemaining > 0 && !transport.sdfLostToday?.jmsdf;
  const jasdfTripToday = transport.sdfLostToday?.jasdf ? 0 : Math.min(1, transport.jasdfRemaining);

  // 与那国空港→本土: 平時0 / 存立危機(Lv2+)1便 / 有事は便数表
  // 存立危機の与那国空港1便はLvを問わない（マニュアル3.1。Lv制限は石垣港・新石垣空港への入航のみ）
  const yonaguniAirMax = sl.civ.yonaguni * am('yonaguni');

  // 与那国→石垣フェリー(久部良港発): 石垣港が開いている時のみ(存立危機はLv2+、有事は常時)
  const yonaguniSeaMax = (ishigakiPortOpen ? sl.mainFerry.kubura * YONAGUNI_TO_ISHIGAKI_FERRY : 0) * routeMul.ship.kubura;

  // 竹富→石垣フェリー: 同上(存立危機Lv2+ / 有事)。マニュアルの計11コマ/日から、孤立集落の港（鳩間港1・船浮港0.5）を除いた
  // 使用可能な離島港の容量合計（最大10コマ/日）。鳩間港・船浮港は西表島への島内移送専用（二重計上防止）。
  // 機雷/ボイコット（当日）・船舶便攻撃（恒久）・地震の全海港破壊(seaAllAvailable=false)でその港の分を除く。
  // 港ごとに「当日出せた便数 × 1便のコマ数」（午前便 9〜11時・午後便 14〜16時。1日2便の港は午前1便＋午後1便）
  const taketomiFerryMax = ishigakiPortOpen
    ? (Object.keys(TAKETOMI_PORT_CAPACITY) as TaketomiPortKey[])
        .filter(k => k !== 'funauki' && k !== 'hatoma')
        .reduce((s, k) => s + sl.tport[k] * tportKomaPerTrip(k) * routeMul.tport[k], 0)
    : 0;

  // 波照間空港→新石垣空港 民間航空便（仕様2026.7.6 Sec4）。Lv4以上で 0.5コマ/日。竹富エリアの避難補助。
  // 条件: Lv別便数>0 かつ 波照間空港が利用可(infra.haterumaAirport & 天候OK) かつ 路線停止でない(disabledAirRoutes.hateruma)
  //       かつ 民間航空全停止でない。空港破壊/強風/大雨/路線停止時は0。
  // 島外避難の可否は本土便と同じゲート(有事は常時 / 存立危機はLv2以上)に整合させる。
  //       着側(新石垣空港)も使用可でなければ着陸できないため airportAvail.shinIshigaki & airRouteOk('shinIshigaki') も条件に含める。
  const haterumaLevelFlights = HATERUMA_AIR_FLIGHTS_BY_LEVEL[prepLevel] ?? 0;
  const haterumaEvacAllowed = isWartime || (isCrisis && prepLevel >= CRISIS_EVAC_MIN_LEVEL);
  //       着側（新石垣）のボイコット/錯綜/不時着は「出発」倍率(airRouteMultiplier/不時着)であり受け入れには影響しない。
  //       ただし新石垣の民間航空路線が恒久停止(disabledAirRoutes)なら民間便自体が無いため従来通り0（既存設計）。
  const haterumaAirMax =
    (haterumaLevelFlights > 0 && haterumaEvacAllowed && !isOccupied(state, 'ishigaki')
      ? sl.civ.hateruma * haterumaLevelFlights // 9時の1便（0.5コマ）
      : 0) * am('hateruma');

  const ishigakiAirMax = sl.civ.shinIshigaki * am('shinIshigaki');

  // 空自輸送機: 空港破壊後は応急復旧（翌日から）で使用可。出発容量倍率（錯綜/不時着等）は空港からの全輸送に掛かる
  // 自衛隊輸送枠は「シミュレーション通して jasdfTotal コマ・1日1コマ」。残数を1日の容量にしない（Math.min(1, 残)）
  const ishigakiJasdfMax = (isWartime && jasdfAirfieldOk('shinIshigaki') ? jasdfTripToday : 0) * am('shinIshigaki');

  // 海保と海自は石垣/宮古で分け合う → 全体で使える分を表示。漁港表（西表/細崎/前泊）の避難コスト増はハブ別倍率 hubSea で反映
  // 海保輸送船は24時間いつでも（大雨・強風時を除く）1時間1便。当日の便数 = min(1日便数, 海が開いている時間数)
  const cgTrips = Math.min(transport.coastGuardToday, sl.seaHours);
  // 便は全エリア共通のプール（coastGuardTrips）。各エリアの値は「そのエリアから当日出せる上限」
  const ishigakiCoastGuardMax = (isWartime ? cgTrips : 0) * routeMul.hubSea.ishigaki;
  // 海自輸送艦: 石垣/宮古で分け合い、合算で1日1コマまで（autoSelectOrders / executeDayPhase2 で合算上限1を適用）
  const ishigakiJmsdfMax = (isWartime && sl.seaHours > 0 && jmsdfOkToday ? 1 : 0) * routeMul.hubSea.ishigaki;
  const ishigakiFerryMax = sl.mainFerry.ishigakiPort * settings.mainPortCapacityPerTrip * routeMul.ship.ishigakiPort;

  const miyakoAirMax = sl.civ.miyako * am('miyako');
  const shimojAirMax = sl.civ.shimoji * am('shimoji');
  const miyakoCoastGuardMax = (isWartime ? cgTrips : 0) * routeMul.hubSea.miyako;
  const miyakoJmsdfMax = (isWartime && sl.seaHours > 0 && jmsdfOkToday ? 1 : 0) * routeMul.hubSea.miyako;
  const miyakoFerryMax = sl.mainFerry.hiraraPort * settings.mainPortCapacityPerTrip * routeMul.ship.hiraraPort;

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
  // 港の破壊・当日閉鎖・天候は時刻で判定する（下の bothPortHours）。ここでは路線の運航拒否・撃沈だけを見る
  const portOk = (id: AreaId | null): boolean => {
    if (id === 'ishigaki') return shipRouteOk('ishigakiPort');
    if (id === 'miyako') return shipRouteOk('hiraraPort');
    return false;
  };
  // 2島間往復は「出る側と着く側が同じ時刻に使える」ことが条件（午前だけ使える港と午後だけ使える港の間は往復できない）
  const both = (a: number[], b: number[]) => a.filter(h => b.includes(h));
  const bothPortList = both(sl.portHours.ishigakiPort, sl.portHours.hiraraPort);
  const bothPortHours = bothPortList.length;
  const hubFields = (id: AreaId | null): AirRouteKey[] =>
    id === 'ishigaki' ? ['shinIshigaki'] : id === 'miyako' ? (['miyako', 'shimoji'] as AirRouteKey[]).filter(r => r !== 'shimoji' || state.infra.bridgeIrabu) : [];
  const fieldHours = (id: AreaId | null) => [...new Set(hubFields(id).flatMap(r => sl.airfieldHours[r]))];
  const bothFieldList = both(fieldHours(shuttleDir?.[0] ?? null), fieldHours(shuttleDir?.[1] ?? null)).sort((a, b) => a - b);
  const bothFieldHours = bothFieldList.length;
  // ハブの民間空港が民間便を出せるか（空港infra破壊 or 路線運航拒否(disabledAirRoutes)なら不可）。
  // 空港施設が無事でも路線が運航拒否されていれば民間航空は使えない（仕様「空港破壊/運航拒否時は民間航空×」）。
  const civAirHubOk = (id: AreaId | null): boolean => {
    if (id === 'ishigaki') return sl.civ.shinIshigaki > 0;
    if (id === 'miyako') return sl.civ.miyako > 0 || sl.civ.shimoji > 0;
    return false;
  };
  // 送出側ハブの空港出発倍率（空自/民間の往復便に適用）。宮古は使える方の最大
  const fromAirMul = (id: AreaId | null, forJasdf: boolean): number => {
    if (id === 'ishigaki') return am('shinIshigaki');
    if (id === 'miyako') {
      const ok = (r: AirRouteKey) => (forJasdf ? jasdfAirfieldOk(r) : sl.civ[r] > 0);
      return Math.max(ok('miyako') ? am('miyako') : 0, ok('shimoji') ? am('shimoji') : 0);
    }
    return 1;
  };
  // 送出側ハブが民間便で出せる基準便数（宮古発は宮古+（無事かつ路線可なら）下地島を加算）。
  // 民間便の往復: 出発空港の便の時刻に、着く側の滑走路も開いていること
  const fromCivAirFlights = (id: AreaId | null): number => {
    const dest = fieldHours(id === 'ishigaki' ? 'miyako' : 'ishigaki');
    return hubFields(id).reduce((t, r) => t + Math.min(sl.civ[r], sl.civHours[r].filter(h => dest.includes(h)).length), 0);
  };
  const M = SHUTTLE_MULTIPLIER;
  // 海保/海自は船舶。仕様: 送出側・集約先の両端の港が使えることが条件（どちらか一方でも破壊/運航拒否なら往復適用外）。
  const shipUsable = shuttleActive && bothPortHours > 0 && portOk(shuttleFrom) && portOk(shuttleTo);
  const hubSeaFrom = shuttleFrom === 'ishigaki' || shuttleFrom === 'miyako' ? routeMul.hubSea[shuttleFrom] : 1;
  const shuttleCoastGuardMax = (shipUsable ? Math.min(cgTrips, bothPortHours) * M : 0) * hubSeaFrom;
  const shuttleJmsdfMax = (shipUsable && jmsdfOkToday ? 1 * M : 0) * hubSeaFrom;
  // 空自の往復便も1日1便（=1コマ分の枠×M）。海自(shuttleJmsdfMax)と同じく残数を1日容量にしない
  // 送出側・集約先の両端の飛行場が使えること（着側が当日閉鎖・悪天候なら着陸できない）
  const shuttleJasdfMax = (shuttleActive && bothFieldHours > 0 ? jasdfTripToday * M : 0) * fromAirMul(shuttleFrom, true);
  // 陸自ヘリ 1便1コマ。マニュアル: 大雨・強風では使えない（輸送量は13時の天候で判定）
  // 陸自ヘリは1日1便・1コマ（マニュアル4.6.6。ピストンでも通常通り1コマ）。当日の便を攻撃で失っていたら本日は使えない
  const shuttleJgsdfMax = shuttleActive && sl.heliOk && !transport.sdfLostToday?.jgsdf ? Math.min(1, transport.jgsdfRemaining) : 0;
  // 民間航空3倍: 集約先ハブと送出側ハブの双方が民間便を出せる（空港無事かつ路線運航拒否でない）時のみ。
  // 基準便数は「送出側ハブが出せる方向便数」を使う（宮古発なら宮古(+下地島)、石垣発なら新石垣）。
  const shuttleCivAirMax =
    (shuttleActive && civAirOk && civAirHubOk(shuttleTo) && civAirHubOk(shuttleFrom)
      ? fromCivAirFlights(shuttleFrom) * M
      : 0) * fromAirMul(shuttleFrom, false);

  // イベント由来の容量倍率（軍民運航錯綜=0.5 / 交通混乱=0.7 等）をエリア別に適用。
  // 任意小数を避けるため 0.5 コマ単位へ丸める（通常日=倍率1では整数/0.5のまま無変化）。
  // 最も近い0.5単位へ丸める。ちょうど中間（0.25/0.75 等）は小さい方へ寄せる
  // （例: 不時着−25%で空自1×0.75=0.75 → 0.5。Math.round だと 1 に戻り減少が消えていた。中間以外は従来どおり最寄り: 0.7→0.5、0.8→1）
  const r05 = (x: number) => Math.max(0, Math.ceil(x * 2 - 0.5 - 1e-9) / 2);
  // 手数ペナルティ（臨時増援交渉の1手消費。旧仕様の不時着エントリも互換で数える）: 当該エリアの手数 h=handsByFatigue に対し
  // (h−penalty)/h を容量に掛ける（h=0なら0）。ペナルティが無いエリアは従来どおり（手数は疲労限界判定にのみ使う）。
  // 不時着（マニュアル2026.9）は空港別倍率 am() で扱う。
  // 疲労限界（基本手数0）のエリアは避難行動不可 → ペナルティの有無にかかわらず容量0。
  const penFactor = (a: AreaId): number => {
    const h = handsByFatigue(a, state.areas[a].fatigue);
    if (h <= 0) return 0;
    const pen = activeHandPenalty(state, a);
    if (pen <= 0) return 1;
    return Math.max(0, (h - pen) / h);
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
    coastGuardTrips: cgTrips,
    // 海保: 有事は全エリア、存立危機事態は与那国・竹富町のみ（マニュアル3.1）。海自・空自は有事のみ
    cgFrom: {
      yonaguni: r05((isWartime || isCrisis ? cgTrips : 0) * my * sy), taketomi: r05((isWartime || isCrisis ? cgTrips : 0) * mt * st),
      ishigaki: r05(ishigakiCoastGuardMax * mi * si), miyako: r05(miyakoCoastGuardMax * mm * sm),
    },
    jmsdfFrom: {
      yonaguni: r05((isWartime && sl.seaHours > 0 && jmsdfOkToday ? 1 : 0) * my * sy),
      taketomi: r05((isWartime && sl.seaHours > 0 && jmsdfOkToday ? 1 : 0) * mt * st),
      ishigaki: r05(ishigakiJmsdfMax * mi * si), miyako: r05(miyakoJmsdfMax * mm * sm),
    },
    jasdfFrom: {
      yonaguni: r05((isWartime && jasdfAirfieldOk('yonaguni') ? jasdfTripToday : 0) * am('yonaguni') * my),
      // 竹富町は波照間空港から（マニュアル4.6.5「破壊されていない空港（波照間空港、多良間空港含む）」。Lvを問わない）
      taketomi: r05((isWartime && sl.airfield.hateruma ? jasdfTripToday : 0) * am('hateruma') * mt),
      ishigaki: r05(ishigakiJasdfMax * mi),
      miyako: r05((isWartime && (jasdfAirfieldOk('miyako') || jasdfAirfieldOk('shimoji')) ? jasdfTripToday : 0) * fromAirMul('miyako', true) * mm),
    },
    jasdfTarama: r05((isWartime && sl.airfield.tarama ? jasdfTripToday : 0) * mm),
    handBudget: (() => {
      const o = {} as Record<AreaId, number>;
      for (const id of ['yonaguni', 'taketomi', 'ishigaki', 'miyako'] as AreaId[]) {
        o[id] = occFactor(id) > 0 ? handsByFatigue(id, state.areas[id].fatigue) * sl.actionHours : 0;
      }
      return o;
    })(),
    phase,
    prepLevel,
    jgsdfRemaining: transport.jgsdfRemaining,
    jmsdfRemaining: transport.jmsdfRemaining,
    shuttleActive, shuttleFrom, shuttleTo,
    shuttleHours: {
      sea: bothPortList,
      air: bothFieldList,
      civ: [...new Set(hubFields(shuttleFrom).flatMap(r => sl.civHours[r].filter(h => fieldHours(shuttleTo).includes(h))))].sort((a, b) => a - b),
      heli: sl.seaOpenHours, // 陸自ヘリは港を使わない。大雨・強風でない時刻ならいつでも
    },
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
  const forced = state.forcedEvents ?? [];
  const forcedEq = forced.find(f => f.kind === 'earthquake' && f.day === day);
  if (forcedEq && forcedEq.kind === 'earthquake') log.push(`🎯 強制イベント: 1時に 規模${forcedEq.level} の地震を発生させる`);
  const eqSeverity = forcedEq && forcedEq.kind === 'earthquake' ? Math.min(6, Math.max(1, Math.round(forcedEq.level))) : checkEarthquake(state, log);
  let earthquakeDay = state.earthquakeDay;
  let earthquakeLevel = state.earthquakeLevel;
  let eq: EarthquakeEffect | null = null;
  if (eqSeverity !== null) {
    eq = resolveEarthquake(eqSeverity, state.infra);
    earthquakeDay = day;
    earthquakeLevel = eqSeverity;
    const stopJp = { 1: '3時間', 2: '6時間', 3: '12時間', 4: '24時間', 5: '36時間', 6: '48時間' }[eqSeverity] ?? '';
    log.push(`🌊 地震 規模${eqSeverity}: 津波${eq.tsunamiM}m。行動停止${stopJp}（1時から${stopJp}は避難行動不可${eq.stopH > 24 ? `・翌日${eq.stopH - 24}時まで継続` : ''}）`);
    log.push(eq.destroyedJp.length ? `  破壊施設: ${eq.destroyedJp.join('・')}${eqSeverity >= 2 ? '（民間船舶不可。海保・海自はボート等で継続可）' : ''}` : '  破壊施設: なし');
    log.push(eq.deaths > 0
      ? `  死者${eq.deaths}コマ（人のいるエリアへ人口比で分配・1コマごとに当該エリア疲労+1）／DMAT派遣: ${eq.dmatAreas.length ? eq.dmatAreas.map(a => state.areas[a].name).join('・') + ' のみ可' : '不可'}`
      : '  被害なし');
  }
  // 翌日への持ち越し停止（規模5=翌日半分・規模6=翌日0）
  // 行動停止は時刻で扱う: 当日の地震は1時から stopH 時間、前日の地震（36/48時間）は当日 stopH−24 時まで行動不可
  let freezeUntil = eq ? Math.min(24, eq.stopH) : 0;
  if (state.earthquakeDay === day - 1 && state.earthquakeLevel !== null) {
    const carry = resolveEarthquake(state.earthquakeLevel, state.infra).stopH - 24; // 規模5=12時まで / 規模6=24時まで
    if (carry > 0) {
      freezeUntil = Math.max(freezeUntil, Math.min(24, carry));
      log.push(`🌊 前日の地震（規模${state.earthquakeLevel}）の行動停止が継続 → 本日${Math.min(24, carry)}時まで避難行動不可`);
    }
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
      return a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0) + (a.isolatedPending ?? 0);
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
    infra: state.infra, disabledAirRoutes: state.transport.disabledAirRoutes,
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
      aliveMap[id] = isOccupied(state, id) ? 0 : a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0) + (a.isolatedPending ?? 0);
    }
    eqDist = distributeDeaths(eq.deaths, aliveMap);
  }
  // 当日の時刻表の前提（午前=1時の天候 / 午後=13時の天候・モード・前日までの路線停止・地震の行動停止）
  const lvSettings = PREP_LEVEL_SETTINGS[state.prepLevel as keyof typeof PREP_LEVEL_SETTINGS];
  const allCivAirStopped = state.transport.civilianAirDisabled;
  const allCivShipStopped = state.transport.civilianShipDisabled;
  const slotBase: SlotInput = {
    am: amWeather, pm: newWeather, month, phase: newPhase, prepLevel: state.prepLevel,
    // 下地島空港は伊良部大橋が落ちると到達できない
    infraStart: { ...infraAfterEq, shimojiAirport: infraAfterEq.shimojiAirport && infraAfterEq.bridgeIrabu },
    flightLimit: lvSettings.airFlightsWartime, h24: lvSettings.crisis24h,
    crisisEvacOk: state.prepLevel >= CRISIS_EVAC_MIN_LEVEL,
    civAirStopped: allCivAirStopped ? { shinIshigaki: true, miyako: true, shimoji: true, yonaguni: true, hateruma: true } : { ...state.transport.disabledAirRoutes },
    civShipStopped: allCivShipStopped ? { ishigakiPort: true, hiraraPort: true, kubura: true } : { ...state.transport.disabledShipRoutes },
    tportStopped: { ...(state.transport.disabledTaketomiPorts ?? {}) },
    // 当日の地震で新たに破壊された空港は、応急復旧（1日）が済むまで空自輸送機も使えない＝当日は終日使用不能
    closures: (['shinIshigaki', 'miyako', 'shimoji', 'yonaguni', 'hateruma', 'tarama'] as AirKey[])
      .filter(k => eq?.infra[k === 'shinIshigaki' ? 'shinIshigakiAirport' : k === 'miyako' ? 'miyakoAirport' : k === 'shimoji' ? 'shimojiAirport' : k === 'yonaguni' ? 'yonagunAirport' : k === 'hateruma' ? 'haterumaAirport' : 'taramaAirport'] === false)
      .map(k => ({ key: `air:${k}`, from: 1, to: 24 })),
    freezeUntil,
  };
  // 朝（避難前）の増援交渉で得た便は当日から使える＝当日の攻撃対象にもなる
  const transportAvail: TransportState = {
    ...state.transport,
    jgsdfRemaining: state.transport.jgsdfRemaining + reinGain.jgsdf,
    jmsdfRemaining: state.transport.jmsdfRemaining + reinGain.jmsdf,
    jasdfRemaining: state.transport.jasdfRemaining + reinGain.jasdf,
  };
  const eventResult = generateDailyEvents({ ...state, phase: newPhase, military: newMilitary, infra: infraAfterEq, transport: transportAvail }, eqDist, slotBase, forced);
  log.push(...eventResult.log);
  // 地震の発電所破壊を既存の停電疲労機構へ接続: 石垣/宮古は即時+1（以後毎日は 7 の powerOutage）、多良間/波照間は一時疲労
  if (eq) {
    if (eq.infra.powerIshigaki === false) { eventResult.fatigueIncrease.ishigaki += 1; eventResult.fatigueIncrease.taketomi += 1; log.push('  地震: 石垣島発電所破壊 → 停電・断水 即時 疲労+1（石垣島・竹富町全島）、以後毎日 疲労+1(夏季+2)'); }
    if (eq.infra.powerMiyako === false) { eventResult.fatigueIncrease.miyako += 1; log.push('  地震: 宮古島発電所破壊 → 停電・断水 即時 疲労+1、以後毎日 疲労+1(夏季+2)'); }
    if (eq.infra.powerYonaguni === false) { eventResult.fatigueIncrease.yonaguni += 1; log.push('  地震: 与那国発電所破壊 → 停電・断水 即時 疲労+1、以後毎日 疲労+1(夏季+2)'); }
    if (eq.infra.powerTarama === false) { eventResult.taramaPowerBrokenToday = true; log.push('  地震: 多良間発電所破壊 → 多良間→宮古の避難完了まで 宮古島・多良間エリア疲労+2（完了で0）'); }
    if (eq.infra.powerHateruma === false) { eventResult.haterumaPowerBrokenToday = true; log.push('  地震: 波照間発電所破壊 → 波照間→石垣の避難完了まで 竹富町全島エリア疲労+2（完了で0）'); }
  }
  // 地震の行動停止時間は時刻表（slotBase.freezeUntil）で扱う＝その時刻までの便は出せない

  // 7. 疲労度の上昇（マニュアル3.9）。回復はしない。
  const areasAfterEvents = JSON.parse(JSON.stringify(state.areas)) as Record<AreaId, AreaState>;
  // 要援護者の所在台帳（④）: 当日の死者除去で内訳を更新する。内訳の無い旧stateは減算前にここで補う
  ensureAllBreakdowns(areasAfterEvents);
  const ledger = ledgerOf(state);
  // フェーズ(F)が1上昇する日(X=F2, X+3=F3, X+6=F4)は全エリア+1
  const fRose = eventPhase(day) > eventPhase(day - 1);
  // 発電所破壊で停電中のエリアは毎日1:00に+1(6〜10月の夏季は+2)。
  // 多良間(→宮古)・波照間(→竹富)は別途「一時疲労」ルールで扱うため、この持続停電加算からは除外する。
  const outageInc = (month >= 6 && month <= 10) ? 2 : 1;
  // 石垣島電力設備（マニュアル「石垣島竹富町各島電力設備」）は石垣島・竹富町全島の両エリアに毎日+1(夏季+2)。
  const powerOutage: Record<AreaId, boolean> = {
    yonaguni: !state.infra.powerYonaguni,
    taketomi: !state.infra.powerIshigaki,
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
      const removed = removeFromArea(aa, n, ledger);
      eqRemovedTotal += removed;
      attackRemoved += removed;
      const fat = Math.ceil(removed); // 1コマ死亡ごとに疲労+1（残存0.5コマの端数死も1件として+1）
      aa.fatigue += fat;
      const name = state.areas[id].name;
      log.push(`🌊 地震死者: ${name} ${removed}コマ死亡・疲労+${fat}`);
      if (removed <= 0) continue;
      const alive = aa.residents + aa.tourists + aa.vulnerable + aa.stagingPort + (aa.stagingVulnerable ?? 0)  + (aa.isolatedPending ?? 0);
      if (alive <= 0) { log.push(`  ${name}: 無人になったため追加被害なし（DMAT消費なし）`); continue; }
      const dmatAllowed = eq.dmatAreas.includes(id);
      if (dmatAllowed && dmatRemaining > 0) {
        dmatRemaining -= 1;
        log.push(`  DMAT派遣: ${name}の地震被害に対応（残り${dmatRemaining}回）→ 追加被害を防止`);
      } else {
        const extra = removeFromArea(aa, 1, ledger);
        dmatExtraDead += extra;
        aa.fatigue += 1;
        const reason = dmatAllowed ? 'DMAT未派遣(残0)' : (eq.severity >= 5 ? 'DMAT派遣不可(規模5以上)' : eq.severity === 4 && id === 'ishigaki' ? 'DMAT派遣不可(石垣病院水没)' : 'DMAT派遣不可(石垣・宮古以外)');
        log.push(`  ⚠️ ${reason}: ${name} → 追加死者${extra}コマ・疲労+1`);
      }
    }
    if (eqRemovedTotal < eq.deaths) log.push(`🌊 地震死者${eq.deaths}コマのうち残存人口を超える${eq.deaths - eqRemovedTotal}コマは発生しない（実死者${eqRemovedTotal}）`);
  }

  // 7b/7b'. 死傷の逐次処理（発生順 = casualtyTimeline）。
  //   'asset' : 撃墜/撃沈/輸送アセット攻撃/部分占領の死者を当該エリアの人口から実除去（無人なら死者は発生しない＝人口保存則）。
  //   'dmat'  : 市街攻撃/施設破壊の死傷者（ver4.0 4.11/6.6/6.7）。「攻撃死(major 0.5)を人口除去 → 除去後に無人なら被害なし(DMAT不要・疲労なし)
  //             → 当該疲労+1 → DMAT判定」。派遣可能は石垣島・宮古島のみ。DMAT残>0なら1消費して追加被害を防ぐ。
  //             追加被害（未派遣/派遣不可）: major → 追加死者0.5コマ＋当該疲労+1 ／ minor → 追加死者0＋当該疲労+1。
  //   以前は種類別に「アセット死を全部 → DMAT対象を全部」の順で処理しており、後から起きたアセット死が先の市街攻撃を無人扱いにしていた。
  const alive = (a: AreaState) => a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0) + (a.isolatedPending ?? 0);
  const timeline = eventResult.casualtyTimeline ?? [
    ...(Object.keys(eventResult.deadByArea) as AreaId[]).filter(id => eventResult.deadByArea[id] > 0).map(id => ({ kind: 'asset' as const, area: id, n: eventResult.deadByArea[id] })),
    ...eventResult.dmatDeathAreas.map(d => ({ kind: 'dmat' as const, ...d })),
  ];
  for (const ev of timeline) {
    const name = state.areas[ev.area].name;
    const aa = areasAfterEvents[ev.area];
    if (ev.kind === 'asset') {
      const r1 = removeFromArea(aa, ev.n, ledger);
      attackRemoved += r1;
      if (ev.n - r1 > 0) log.push(`${name}: 死者${ev.n}コマ計上のうち残存人口を超える${ev.n - r1}コマは発生しない（実死者${r1}）`);
      continue;
    }
    const severity = ev.severity;
    const sevJp = severity === 'major' ? '数百名' : '数十名';
    if (alive(aa) <= 0) {
      log.push(`${name}の死傷者(${sevJp}): 無人エリアのため被害なし（DMAT消費なし）`);
      continue;
    }
    // 攻撃死（major=0.5コマ）を人口から実除去
    const atkDead = severity === 'major' ? 0.5 : 0;
    attackRemoved += removeFromArea(aa, atkDead, ledger);
    aa.fatigue += 1; // 死傷者発生 → 当該エリア疲労+1
    if (alive(aa) <= 0) {
      // 攻撃死で無人になった → 追加被害は起こり得ず、DMAT派遣も不要（消費しない）
      log.push(`${name}の死傷者(${sevJp}): 攻撃死で無人になったため追加被害なし（DMAT消費なし）`);
      continue;
    }
    const dmatAllowed = ev.area === 'ishigaki' || ev.area === 'miyako';
    if (dmatAllowed && dmatRemaining > 0) {
      dmatRemaining -= 1;
      log.push(`DMAT派遣: ${name}の死傷者(${sevJp})に対応（残り${dmatRemaining}回）→ 追加被害を防止（疲労+1のみ）`);
      continue;
    }
    const extra = removeFromArea(aa, severity === 'major' ? 0.5 : 0, ledger); // 追加死者は残存人口の範囲で
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
    const wiped = a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0) + (a.isolatedPending ?? 0) + a.stagingAirport;
    occupationDead += wiped;
    // 要援護者内訳も全滅→死亡へ（自宅分は内訳から、ハブ待機分は台帳から）
    addBreakdown(ledger.dead, takeVulnerableBreakdown(a, a.vulnerable));
    addBreakdown(ledger.dead, takeFromBreakdown(ledger.inTransit, a.stagingVulnerable ?? 0));
    takeIsolated(a, a.isolatedPending ?? 0, ledger); // 孤立集落（多良間🔴の内訳も死亡へ）
    a.residents = 0; a.tourists = 0; a.vulnerable = 0; a.stagingPort = 0; a.stagingVulnerable = 0; a.stagingAirport = 0; a.inTransitToHub = 0;
    a.isolatedPending = 0; a.isolatedPendingBy = { hatoma: 0, funauki: 0, tarama: 0, taramaVuln: 0 };
    log.push(`⚠️ ${state.areas[id].name} 占領 → 残存${wiped}コマ全滅（死者+${wiped}）。以後このエリアの避難注文・攻撃判定は無効`);
  }

  // 7c. 多良間島 一時疲労（マニュアル2026.9: 電力破壊で「多良間の住民が全員宮古島に避難完了するまで」宮古島・多良間=miyakoエリア +2 固定。完了で0）
  const TEMP_FATIGUE_FIXED = 2;
  let taramaPowerBroken = state.taramaPowerBroken || eventResult.taramaPowerBrokenToday;
  const taramaEvacDone = state.taramaEvacDone;
  let taramaTempFatigue = state.taramaTempFatigue;
  let taramaTempApplied = state.taramaTempApplied;
  if (taramaEvacDone) {
    taramaTempFatigue = 0; // 避難完了 → 目標0（適用分を戻す）
  } else if (taramaPowerBroken) {
    taramaTempFatigue = TEMP_FATIGUE_FIXED; // 破壊当日から即時+2（以後は固定。冪等）
  }
  {
    const delta = taramaTempFatigue - taramaTempApplied; // 冪等: 適用済み量との差分だけを宮古へ反映
    if (delta !== 0) {
      areasAfterEvents.miyako.fatigue += delta;
      taramaTempApplied = taramaTempFatigue;
      if (delta > 0) log.push(`多良間島電力破壊 → 宮古島・多良間 疲労+${delta}（多良間→宮古の避難完了まで固定・計+${taramaTempApplied}）`);
      else log.push(`多良間→宮古 避難完了 → 一時疲労を解除（宮古島・多良間 疲労${delta}）`);
    }
  }
  if (taramaEvacDone) taramaPowerBroken = false;

  // 7d. 波照間島 一時疲労（電力破壊で「波照間の住民が全員石垣島に避難完了するまで」竹富町全島=taketomiエリア +2 固定。完了で0）
  let haterumaPowerBroken = state.haterumaPowerBroken || eventResult.haterumaPowerBrokenToday;
  const haterumaEvacDone = state.haterumaEvacDone;
  let haterumaTempFatigue = state.haterumaTempFatigue;
  let haterumaTempApplied = state.haterumaTempApplied;
  if (haterumaEvacDone) {
    haterumaTempFatigue = 0;
  } else if (haterumaPowerBroken) {
    haterumaTempFatigue = TEMP_FATIGUE_FIXED;
  }
  {
    const delta = haterumaTempFatigue - haterumaTempApplied;
    if (delta !== 0) {
      areasAfterEvents.taketomi.fatigue += delta;
      haterumaTempApplied = haterumaTempFatigue;
      if (delta > 0) log.push(`波照間島電力破壊 → 竹富町全島 疲労+${delta}（波照間→石垣の避難完了まで固定・計+${haterumaTempApplied}）`);
      else log.push(`波照間→石垣 避難完了 → 一時疲労を解除（竹富町全島 疲労${delta}）`);
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
  // 要素は '施設キー:理由'（理由 rain=大雨⛈️ / wind=強風💨）。13時の天候が大雨なら全空港・全海港が rain、それ以外で強風なら wind
  // （海港は全停止、空港は風向次第で checkAirportAvailability が false のもの）。
  const wxReason: 'rain' | 'wind' = newWeather.condition === 'heavy-rain' ? 'rain' : 'wind';
  const weatherClosed: string[] = Object.entries(AIR_INFRA_FOR_WX)
    // 下地島空港は伊良部大橋経由でしか到達できない。橋の崩落による停止は悪天候ではないので除外
    .filter(([k, infraKey]) => damagedInfra[infraKey] && (k !== 'shimoji' || damagedInfra.bridgeIrabu) && !wxAvail[k])
    .map(([k]) => `${k}:${wxReason}`);
  if (!isSeaAvailable(newWeather, month)) weatherClosed.push(`sea:${wxReason}`);
  // 午前(1時)の天候で使えない施設（日報の主要インフラ状況表で午前/午後を分けて表示する用。容量計算には使わない）
  const wxAvailAm = checkAirportAvailability(amWeather, month, infraAfterEq);
  const wxReasonAm: 'rain' | 'wind' = amWeather.condition === 'heavy-rain' ? 'rain' : 'wind';
  const weatherClosedAm: string[] = Object.entries(AIR_INFRA_FOR_WX)
    .filter(([k, infraKey]) => infraAfterEq[infraKey] && (k !== 'shimoji' || infraAfterEq.bridgeIrabu) && !wxAvailAm[k])
    .map(([k]) => `${k}:${wxReasonAm}`);
  if (!isSeaAvailable(amWeather, month)) weatherClosedAm.push(`sea:${wxReasonAm}`);
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
  // 当日の時刻表: イベントによる使用不能（発生時刻から）を反映した便数。撃墜・撃沈された便の枠は除く
  const slots: DaySlots = computeDaySlots({ ...slotBase, closures: [...slotBase.closures, ...eventResult.closures] });
  for (const k of Object.keys(eventResult.lostTrips)) {
    const [kind, key] = k.split(':');
    const n = eventResult.lostTrips[k];
    if (kind === 'air') slots.civ[key as AirKey] = Math.max(0, slots.civ[key as AirKey] - n);
    else if (kind === 'ship') slots.mainFerry[key as ShipRouteKey] = Math.max(0, slots.mainFerry[key as ShipRouteKey] - n);
    else slots.tport[key as TaketomiPortKey] = Math.max(0, slots.tport[key as TaketomiPortKey] - n);
  }
  // 「その空港から当日1便でも民間便を出せるか」を空港可否とする（午前だけ・午後だけ使える日も可）
  for (const apt of Object.keys(airportAvailFinal)) airportAvailFinal[apt] = (slots.civ[apt as AirKey] ?? 0) > 0;

  // 7e. 手数ペナルティ（臨時増援交渉の1手消費。期限切れを除く）。交渉(5b)のペナルティ(rein1.handPenalty)を土台にする。
  const handPenalty: Record<AreaId, HandPenalty[]> = { yonaguni: [], taketomi: [], ishigaki: [], miyako: [] };
  for (const id of Object.keys(handPenalty) as AreaId[]) {
    handPenalty[id] = (rein1.handPenalty[id] ?? []).filter(p => p.untilDay >= day);
  }
  for (const id of Object.keys(handPenalty) as AreaId[]) {
    const pen = penaltyCount(handPenalty[id], day);
    if (pen > 0) {
      const h = handsByFatigue(id, areasAfterEvents[id].fatigue);
      const jp = (p: HandPenalty) => `${p.country === 'china' ? '中国機' : p.country === 'taiwan' ? '台湾機' : '交渉1手'} ${p.untilDay === day ? '本日' : '翌日'}24時まで`;
      log.push(`手数ペナルティ: ${state.areas[id].name} 手数${h}−${pen}=${Math.max(0, h - pen)}（${handPenalty[id].filter(p => p.untilDay >= day).map(jp).join('・')}）`);
    }
  }
  // 7f. 不時着（マニュアル2026.9）: 期限切れ（前々日以前）を除き、当日分を「翌日24時まで」(untilDay=day+1) で追加。
  //     空港別×国別に −25%（合計最大 −50%）を getDayCapacities の airportLandingFactor で当日・翌日の容量に掛ける。
  const airportLandings: AirportLanding[] = (state.airportLandings ?? []).filter(l => l.untilDay >= day);
  for (const l of eventResult.landingsToday) airportLandings.push({ air: l.air, country: l.country, untilDay: day + 1 });
  for (const air of ['yonaguni', 'shinIshigaki', 'miyako', 'shimoji', 'hateruma'] as AirRouteKey[]) {
    const active = airportLandings.filter(l => l.air === air);
    if (active.length === 0) continue;
    const countries = new Set(active.map(l => l.country));
    const pctDown = Math.min(50, 25 * countries.size);
    const jp = (l: AirportLanding) => `${l.country === 'china' ? '中国軍機' : '台湾軍機'}(${l.untilDay === day ? '本日' : '翌日'}24時まで)`;
    log.push(`不時着中: ${AIR_ROUTE_JP[air]} 輸送能力 −${pctDown}%（${active.map(jp).join('・')}）`);
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
    airportLandings,
    transport: {
      ...state.transport,
      civilianAirDisabled: state.transport.civilianAirDisabled || (eventResult.transportPenalty.civilianAirDisabled ?? false),
      civilianShipDisabled: state.transport.civilianShipDisabled || (eventResult.transportPenalty.civilianShipDisabled ?? false),
      // Section1: 路線別の恒久停止をマージ（撃墜/撃沈/運航拒否）
      disabledAirRoutes: { ...state.transport.disabledAirRoutes, ...eventResult.disabledAirRoutes },
      disabledShipRoutes: { ...state.transport.disabledShipRoutes, ...eventResult.disabledShipRoutes },
      // 竹富町離島港（大原/上原）発の船舶便 恒久停止（船舶便攻撃）
      disabledTaketomiPorts: { ...(state.transport.disabledTaketomiPorts ?? {}), ...eventResult.disabledTaketomiPorts },
      // Section1: 海保輸送船 撃沈 → 1日便数-1（0未満にしない）。当日残・翌日リセット値の双方へ反映。
      coastGuardMaxPerDay: Math.max(0, state.transport.coastGuardMaxPerDay + eventResult.coastGuardMaxDelta),
      coastGuardToday: Math.max(0, state.transport.coastGuardToday + eventResult.coastGuardMaxDelta),
      // 5b: 臨時増援交渉が成功した手段は +1コマ（使い切り）
      // 攻撃で失った便は使用済み（残回数−1）
      jgsdfRemaining: Math.max(0, transportAvail.jgsdfRemaining - eventResult.assetLost.jgsdf),
      jmsdfRemaining: Math.max(0, transportAvail.jmsdfRemaining - eventResult.assetLost.jmsdf),
      jasdfRemaining: Math.max(0, transportAvail.jasdfRemaining - eventResult.assetLost.jasdf),
      sdfLostToday: { jmsdf: eventResult.assetLost.jmsdf > 0, jasdf: eventResult.assetLost.jasdf > 0, jgsdf: eventResult.assetLost.jgsdf > 0 },
    },
    // DMAT残・一時疲労トラッカーを更新（冪等な戻し用に applied 量も保持）
    dmatRemaining,
    taramaTempFatigue, taramaTempApplied, taramaPowerBroken, taramaEvacDone,
    haterumaTempFatigue, haterumaTempApplied, haterumaPowerBroken, haterumaEvacDone,
    reinforcement,
    // 要支援者モデル（④）
    vulnerableInTransit: ledger.inTransit,
    vulnerableDead: ledger.dead,
    vulnerableEvacuated: { ...(state.vulnerableEvacuated ?? emptyBreakdown()) },
  };

  // B2修正: 輸送停止フラグ・インフラ被害を反映した後で容量を計算する。
  // 路線別倍率（空港/港/離島港/漁港）・当日閉鎖・当日破壊（応急復旧は同日24時まで＝当日は空自も不可）を渡す。
  const routeMul: RouteMultipliers = {
    air: eventResult.airRouteMultiplier,
    ship: eventResult.shipRouteMultiplier,
    tport: eventResult.taketomiPortMultiplier,
    hubSea: eventResult.hubSeaMultiplier,
    closedAir: eventResult.facilityClosedToday.filter((k): k is AirRouteKey => k in AIR_ROUTE_JP),
    destroyedTodayAir: {
      shinIshigaki: eventResult.infraPenalty.shinIshigakiAirport === false || eq?.infra.shinIshigakiAirport === false,
      miyako: eventResult.infraPenalty.miyakoAirport === false || eq?.infra.miyakoAirport === false,
      shimoji: eventResult.infraPenalty.shimojiAirport === false || eq?.infra.shimojiAirport === false,
      yonaguni: eventResult.infraPenalty.yonagunAirport === false || eq?.infra.yonagunAirport === false,
      hateruma: eventResult.infraPenalty.haterumaAirport === false || eq?.infra.haterumaAirport === false,
    },
  };
  const seaOkToday = slots.seaHours > 0; // 午前か午後のどちらかで海が開いていれば、その時間帯の便は出せる
  const capacities = getDayCapacities(stateAfterEvents, airportAvailFinal, seaOkToday, eventResult.capacityMultiplier, eventResult.seaCapacityMultiplier, airportAvailForHub, routeMul, slots);
  const evacRefusedToday = (Object.keys(eventResult.refusalToday) as AreaId[]).filter(a => eventResult.refusalToday[a]);

  return {
    evacRefusedToday,
    stateAfterEvents,
    newPhase, newMilitary, newWeather,
    airportAvail: airportAvailFinal, seaOk: seaOkToday, capacities, slots,
    capacityMultiplier: eventResult.capacityMultiplier,
    hourlyRolls: eventResult.hourlyRolls,
    eventLog: log,
    weatherSummary, windSummary, halfDay, weatherClosed, weatherClosedAm, phaseChanged,
    taketomiPortMultiplier: eventResult.taketomiPortMultiplier,
    taramaRouteMultiplier: eventResult.taramaRouteMultiplier,
    dmatExtraDead,
    // 地震死＋攻撃死(人口から実際に除去できた分)＋占領によるエリア全滅。全て人口除去と一致（保存則）
    eventDead: attackRemoved + occupationDead,
  } as DayPhase1Result;
}

// ===== フェーズ2: プレイヤーの避難実行 =====
export function executeDayPhase2(
  originalState: GameState,
  phase1: DayPhase1Result,
  orders: EvacuationOrder[],
  // 記録用: 自動注文に使った避難方針（手動注文の日は省略）。計算には影響しない
  policy?: EvacPolicy
): { newState: GameState; log: DayLog } {
  const { stateAfterEvents, newPhase, newWeather, newMilitary, airportAvail, hourlyRolls, eventLog, weatherSummary, windSummary, halfDay, weatherClosed, capacities } = phase1;
  const { day } = stateAfterEvents;
  const dayLabel = day === 0 ? 'X日' : day > 0 ? `X+${day}日` : `X${day}日`;

  const evacLog: string[] = [];
  const evacuations: EvacuationRecord[] = [];
  let evacuatedCount = 0;
  // 自衛隊輸送枠: 空自輸送機・海自輸送艦は「1日1便（=1コマ。往復便は1便=Mコマ）」。注文・港待機搬出の合計で超えないよう当日の便数を数える
  let jmsdfTripsToday = 0;
  let jasdfTripsToday = 0;

  // 深コピー
  const areas = JSON.parse(JSON.stringify(stateAfterEvents.areas)) as Record<AreaId, AreaState>;
  const transport = { ...stateAfterEvents.transport };
  // 要援護者の所在台帳（④）: 避難注文・待機搬出・死亡で内訳を移す。内訳の無い旧stateは減算前にここで補う
  ensureAllBreakdowns(areas);
  const ledger = ledgerOf(stateAfterEvents);
  const vulnArrived = emptyBreakdown(); // 本日 本土到着（カテゴリ別）

  // --- 避難オーダー実行 ---
  // 航空機手段（民間航空・空自輸送機・陸自ヘリ）は要援護者不可（ver4.0 4.6.5: 要援護者はフェリー/海保/海自のみ）
  const isAircraftMethod = (m: string) =>
    m.includes('空自輸送機') || m.includes('陸自ヘリ') || m.includes('民間航空') || (m.includes('空港') && m.includes('民間'));
  // 実行側の経路・容量検証: 手段ごとに「出発エリア・行き先・当日容量プール」を定め、注文の合計が当日容量を超えないようにする。
  // 自動注文(autoSelectOrders)は容量内で生成されるため結果は変わらない。手動・水増し・重複注文でも容量と経路を越えない最終防衛線。
  const shFrom = capacities.shuttleFrom, shTo = capacities.shuttleTo as EvacuationOrder['to'] | null;
  const ORDER_ROUTES: Record<string, { from: AreaId[]; to: EvacuationOrder['to'][]; pool: string }> = {
    '与那国空港(民間)': { from: ['yonaguni'], to: ['mainland'], pool: 'yonaguniAir' },
    'フェリー': { from: ['yonaguni'], to: ['ishigaki'], pool: 'yonaguniSea' },
    '竹富→石垣フェリー': { from: ['taketomi'], to: ['ishigaki'], pool: 'taketomiFerry' },
    '波照間空港(民間)': { from: ['taketomi'], to: ['ishigaki'], pool: 'haterumaAir' },
    '新石垣空港(民間)': { from: ['ishigaki'], to: ['mainland'], pool: 'ishigakiAir' },
    '空自輸送機': { from: ['ishigaki', 'miyako', 'yonaguni', 'taketomi'], to: ['mainland'], pool: 'jasdf' },
    '石垣港フェリー': { from: ['ishigaki'], to: ['mainland'], pool: 'ishigakiFerry' },
    '宮古空港(民間)': { from: ['miyako'], to: ['mainland'], pool: 'miyakoAir' },
    '下地島空港(民間)': { from: ['miyako'], to: ['mainland'], pool: 'shimojiAir' },
    '平良港フェリー': { from: ['miyako'], to: ['mainland'], pool: 'miyakoFerry' },
    // 海保輸送船・海自輸送艦は破壊されていない全ての海港・漁港から本土へ出せる（マニュアル4.6.3/4.6.4）
    '海保輸送船': { from: ['yonaguni', 'taketomi', 'ishigaki', 'miyako'], to: ['mainland'], pool: 'cg' },
    '海自輸送艦': { from: ['yonaguni', 'taketomi', 'ishigaki', 'miyako'], to: ['mainland'], pool: 'jmsdf' },
    'ピストン海保輸送船': { from: shFrom ? [shFrom] : [], to: shTo ? [shTo] : [], pool: 'shCg' },
    'ピストン海自輸送艦': { from: shFrom ? [shFrom] : [], to: shTo ? [shTo] : [], pool: 'shJmsdf' },
    'ピストン空自輸送機': { from: shFrom ? [shFrom] : [], to: shTo ? [shTo] : [], pool: 'shJasdf' },
    'ピストン民間航空': { from: shFrom ? [shFrom] : [], to: shTo ? [shTo] : [], pool: 'shCiv' },
    'ピストン陸自ヘリ': { from: shFrom ? [shFrom] : [], to: shTo ? [shTo] : [], pool: 'shJgsdf' },
  };
  // 海保・海自・空自は出発エリア別に当日上限を持つ（便そのものは全エリア共通: 海保=cgTripsLeft、海自・空自=1日1便）
  const poolKey = (route: { pool: string }, from: AreaId) => (route.pool === 'cg' || route.pool === 'jmsdf' || route.pool === 'jasdf') ? `${route.pool}:${from}` : route.pool;
  let cgTripsLeft = capacities.coastGuardTrips;
  // 手数（マニュアル3 ポイント5 / 4.5 / 4.6）: 島外へ1コマ出すには 島内移動1手＋出発1手。エリア別の1日の手数（毎時の手数×行動できる時間数）を超えて動かせない
  const handLeft: Record<AreaId, number> = { ...capacities.handBudget };
  // 当日ハブ（石垣島・宮古島）へ着いたコマ。着いた時刻より後に出る便にしか乗り継げない（前日までに着いていた待機コマは制限なし）
  const arrivals: Record<'ishigaki' | 'miyako', { white: number; vuln: number; from: number }[]> = { ishigaki: [], miyako: [] };
  const slx = phase1.slots;
  const minHour = (hs: (number | null)[]) => hs.filter((h): h is number => h !== null).reduce((m, h) => Math.min(m, h), 99);
  // 竹富町→石垣フェリーの午前便で運べるコマ数（残り）と、午前便・午後便の出発時刻
  const tkPorts = (Object.keys(TAKETOMI_PORT_CAPACITY) as TaketomiPortKey[]).filter(k => k !== 'hatoma' && k !== 'funauki');
  let tkAmLeft = slx ? tkPorts.reduce((t, k) => t + (slx.tportDep[k].am !== null ? tportKomaPerTrip(k) : 0), 0) : Infinity;
  const tkAmHour = slx ? minHour(tkPorts.map(k => slx.tportDep[k].am)) : 0;
  const tkPmHour = slx ? minHour(tkPorts.map(k => slx.tportDep[k].pm)) : 0;
  const arrivalHour = (method: string): number => {
    if (!slx) return 0;
    if (method === 'フェリー') return minHour([slx.mainDep.kubura.am ?? slx.mainDep.kubura.pm]);
    if (method === '波照間空港(民間)') return 9;
    return 99;
  };
  // 2島間往復の到着時刻: 両端が同時に使える時刻のうち、使った便数ぶん進んだ時刻（その便で着いたコマは、それより後の便にしか乗り継げない）
  const shuttleTripsUsed: Record<string, number> = { sea: 0, air: 0, heli: 0 };
  const shuttleArrival = (method: string, count: number, from: AreaId): number => {
    if (method === 'ピストン民間航空') {
      // 民間便は本土便と往復便で同じ便（時刻）を分け合う。その空港群でこれまでに使った便数（この注文を含む）ぶん進んだ時刻の便で着く
      const fromHours = (from === 'ishigaki' ? [...(slx?.civHours.shinIshigaki ?? [])] : [...(slx?.civHours.miyako ?? []), ...(slx?.civHours.shimoji ?? [])]).sort((a, b) => a - b);
      const slot = fromHours[Math.min(fromHours.length, Math.ceil((civFlightsUsed[from] ?? 0) - 1e-9)) - 1] ?? 99;
      return (capacities.shuttleHours?.civ ?? []).find(h => h >= slot) ?? 99;
    }
    const kind = method === 'ピストン陸自ヘリ' ? 'heli' : method === 'ピストン空自輸送機' ? 'air' : 'sea';
    const hours = capacities.shuttleHours?.[kind] ?? [];
    shuttleTripsUsed[kind] += kind === 'heli' ? pieces(count) : Math.ceil(count / SHUTTLE_MULTIPLIER - 1e-9);
    return hours[Math.min(hours.length, shuttleTripsUsed[kind]) - 1] ?? 99;
  };
  const POOL_CAP: Record<string, number> = {
    yonaguniAir: capacities.yonaguniAirMax, yonaguniSea: capacities.yonaguniSeaMax,
    taketomiFerry: capacities.taketomiFerryMax, haterumaAir: capacities.haterumaAirMax,
    ishigakiAir: capacities.ishigakiAirMax, ishigakiFerry: capacities.ishigakiFerryMax,
    miyakoAir: capacities.miyakoAirMax, shimojiAir: capacities.shimojAirMax, miyakoFerry: capacities.miyakoFerryMax,
    ...Object.fromEntries((['yonaguni', 'taketomi', 'ishigaki', 'miyako'] as AreaId[]).flatMap(id => [
      [`cg:${id}`, capacities.cgFrom[id]], [`jmsdf:${id}`, capacities.jmsdfFrom[id]], [`jasdf:${id}`, capacities.jasdfFrom[id]],
    ])),
    'jasdf:tarama': capacities.jasdfTarama,
    shCg: capacities.shuttleCoastGuardMax, shJmsdf: capacities.shuttleJmsdfMax, shJasdf: capacities.shuttleJasdfMax,
    shCiv: capacities.shuttleCivAirMax, shJgsdf: capacities.shuttleJgsdfMax,
  };
  const poolUsed: Record<string, number> = {};
  // 民間航空の便数はハブ単位で共有（本土民間便1コマ=1便、民間ピストン1コマ=1/M便）。同じ機材を本土便とピストンに二重使用させない
  const CIV_FLIGHTS: Record<string, number> = { ishigaki: capacities.ishigakiAirMax, miyako: capacities.miyakoAirMax + capacities.shimojAirMax };
  const civFlightsUsed: Record<string, number> = { ishigaki: 0, miyako: 0 };
  // 民間ピストンの便数消費は0.5便単位に切り上げる（1/3便などの端数で本土便の残りが0.5コマ単位から外れないように）
  const ceil05 = (x: number) => Math.ceil(x * 2 - 1e-9) / 2;
  const civHubOf = (pool: string, from: AreaId): string | null =>
    pool === 'ishigakiAir' ? 'ishigaki' : (pool === 'miyakoAir' || pool === 'shimojiAir') ? 'miyako' : pool === 'shCiv' ? from : null;
  // 注文のコマ数は 0以上・0.5コマ単位のみ（負数や0.25コマなどの手動注文は無効）
  const validCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && Number.isInteger(n * 2);
  // 手数1手で動かせるのは1コマ（ハーフコマも1手）
  const pieces = (n: number) => Math.ceil(n - 1e-9);
  for (const order of orders) {
    if (![order.residents, order.tourists, order.vulnerable, ...Object.values(order.isolated ?? {})].every(validCount)) {
      evacLog.push(`${order.method}: コマ数の指定が不正（負数または0.5コマ単位でない）のため注文無効`);
      continue;
    }
    // 占領済みエリアからの避難・占領済みハブへの集約は無効（自動注文以外の手動注文も実行側で弾く）
    if (isOccupied(stateAfterEvents, order.from)) {
      evacLog.push(`${order.method}: ${areas[order.from].name} は占領済みのため避難不可（注文無効）`);
      continue;
    }
    if (order.to !== 'mainland' && isOccupied(stateAfterEvents, order.to)) {
      evacLog.push(`${order.method}: 集約先 ${areas[order.to].name} は占領済みのため搬入不可（注文無効）`);
      continue;
    }
    // 疲労限界・手数切れ: 実効手数（疲労による手数−増援交渉の1手消費）が0のエリアは避難行動不可（容量側 penFactor=0 と一致）
    if (effectiveHands(stateAfterEvents, order.from) <= 0) {
      evacLog.push(`${order.method}: ${areas[order.from].name} は手数0（疲労限界または交渉で消費）のため避難行動不可（注文無効）`);
      continue;
    }
    // 経路検証（手段に対して出発エリア・行き先が正しいか）と当日容量の残り
    const route = ORDER_ROUTES[order.method];
    if (!route || !route.from.includes(order.from) || !route.to.includes(order.to)) {
      evacLog.push(`${order.method}: ${areas[order.from]?.name ?? order.from}→${order.to} はこの手段の経路ではないため注文無効`);
      continue;
    }
    // 空自輸送機で多良間空港から多良間島の孤立コマ🔵だけを直接出す便（宮古空港が破壊されていても可）
    const taramaDirect = order.method === '空自輸送機' && order.from === 'miyako' && (order.isolated?.tarama ?? 0) > 0
      && order.residents + order.tourists + order.vulnerable === 0;
    const pk = taramaDirect ? 'jasdf:tarama' : poolKey(route, order.from);
    let poolRoom = Math.max(0, (POOL_CAP[pk] ?? 0) - (poolUsed[pk] ?? 0));
    // 海保は1日の便数(coastGuardToday)も上限（本土便1便=1コマ、ピストン1便=Mコマ）
    if (route.pool === 'cg') poolRoom = Math.min(poolRoom, transport.coastGuardToday, cgTripsLeft);
    if (route.pool === 'shCg') poolRoom = Math.min(poolRoom, Math.min(transport.coastGuardToday, cgTripsLeft) * SHUTTLE_MULTIPLIER);
    // 手数の残り（1コマ＝島内移動1手＋出発1手）。ハブへ送る便は、着いた先で港・空港を空ける手数（1コマ1手）も要る
    poolRoom = Math.min(poolRoom, Math.floor(handLeft[order.from] / 2 + 1e-9));
    if (order.to !== 'mainland') poolRoom = Math.min(poolRoom, Math.floor(handLeft[order.to] + 1e-9));
    const civHub = civHubOf(route.pool, order.from);
    const civCost = route.pool === 'shCiv' ? 1 / SHUTTLE_MULTIPLIER : 1;
    if (civHub && CIV_FLIGHTS[civHub] !== undefined) poolRoom = Math.min(poolRoom, Math.floor(Math.max(0, CIV_FLIGHTS[civHub] - civFlightsUsed[civHub]) / civCost * 2 + 1e-9) / 2);
    if (poolRoom <= 0) {
      evacLog.push(handLeft[order.from] < 2
        ? `${order.method}: ${areas[order.from].name} は本日の手数を使い切ったため注文無効`
        : `${order.method}: 本日の容量を使い切った（または容量0）ため注文無効`);
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
    // 孤立集落（鳩間・船浮・多良間）から直接乗せるコマ: 海保輸送船・海自輸送艦のみ（多良間🔵は空自輸送機も可）
    const iso = order.isolated ?? {};
    const isoAllowed = order.to === 'mainland' && (order.method === '海保輸送船' || order.method === '海自輸送艦'
      || taramaDirect);
    const isoWant = isoAllowed
      ? { funauki: iso.funauki ?? 0, hatoma: iso.hatoma ?? 0, taramaVuln: order.method === '空自輸送機' ? 0 : iso.taramaVuln ?? 0, tarama: iso.tarama ?? 0 }
      : { funauki: 0, hatoma: 0, taramaVuln: 0, tarama: 0 };
    const total = order.residents + order.tourists + orderVuln + isoWant.funauki + isoWant.hatoma + isoWant.taramaVuln + isoWant.tarama;
    if (total <= 0) continue;
    // 空自/海自は1日1便まで（本土便・往復便の合算）。2便目以降の注文は無効
    const isJmsdf = order.method === '海自輸送艦' || order.method === 'ピストン海自輸送艦';
    const isJasdf = order.method === '空自輸送機' || order.method === 'ピストン空自輸送機';
    if (isJmsdf && (jmsdfTripsToday >= 1 || transport.jmsdfRemaining <= 0)) {
      evacLog.push(`${order.method}: 海自輸送艦は1日1便（残${transport.jmsdfRemaining}隻）のため本日は使用不可（注文無効）`);
      continue;
    }
    if (isJasdf && (jasdfTripsToday >= 1 || transport.jasdfRemaining <= 0)) {
      evacLog.push(`${order.method}: 空自輸送機は1日1便（残${transport.jasdfRemaining}機）のため本日は使用不可（注文無効）`);
      continue;
    }
    // 実行側ガード: 当日容量(getDayCapacities)が0の自衛隊便は手動注文でも使えない（空港破壊/悪天候/平時/占領/錯綜0等）。
    // 正の場合も当日容量（不時着−25%・錯綜×0.5 等の倍率反映後）を1便の搭載上限にする（下の tripCap）。
    let sdfCapToday = Infinity;
    if (isJasdf || isJmsdf) {
      const capToday = taramaDirect ? capacities.jasdfTarama
        : order.method === '空自輸送機' ? capacities.jasdfFrom[order.from]
        : order.method === 'ピストン空自輸送機' ? capacities.shuttleJasdfMax
        : order.method === 'ピストン海自輸送艦' ? capacities.shuttleJmsdfMax
        : capacities.jmsdfFrom[order.from];
      if (!(capToday > 0)) {
        evacLog.push(`${order.method}: 本日は${isJasdf ? '空自輸送機' : '海自輸送艦'}の当日容量が0（空港/海路の使用不能・平時 等）のため使用不可（注文無効）`);
        continue;
      }
      sdfCapToday = capToday;
    }

    // 要援護者は海路のみ
    const actualVuln = orderVuln;
    const actualRes = order.residents;
    const actualTour = order.tourists;

    // コマ数上限チェック
    // 空自/海自の1便あたり上限: 本土便1コマ・往復便Mコマ（要援護者→住民→観光客の順で積む）
    const tripCap = Math.min(isJmsdf || isJasdf ? Math.min(order.method.startsWith('ピストン') ? SHUTTLE_MULTIPLIER : 1, sdfCapToday) : Infinity, poolRoom);
    let tripRoom = tripCap;
    // 孤立集落のコマを先に積む（船浮→鳩間→多良間🔴→多良間🔵）
    const isoBy = isolatedByOf(area);
    const isoTaken = { funauki: 0, hatoma: 0, taramaVuln: 0, tarama: 0 };
    for (const k of ['funauki', 'hatoma', 'taramaVuln', 'tarama'] as const) {
      const n = Math.min(isoWant[k], Math.max(0, isoBy[k]), tripRoom);
      if (n <= 0) continue;
      isoTaken[k] = n; isoBy[k] -= n; tripRoom -= n;
    }
    const isoTotal = isoTaken.funauki + isoTaken.hatoma + isoTaken.taramaVuln + isoTaken.tarama;
    if (isoTotal > 0) {
      area.isolatedPendingBy = isoBy;
      area.isolatedPending = isolatedSum(isoBy);
      if (isoTaken.taramaVuln > 0) addBreakdown(vulnArrived, takeFromBreakdown(area.isolatedVulnBreakdown ??= allocateBreakdown(isoTaken.taramaVuln + isoBy.taramaVuln), isoTaken.taramaVuln));
    }
    const cappedVuln = Math.min(actualVuln, area.vulnerable, tripRoom); tripRoom -= cappedVuln;
    const cappedRes = Math.min(actualRes, area.residents, tripRoom); tripRoom -= cappedRes;
    const cappedTour = Math.min(actualTour, area.tourists, tripRoom);
    const cappedTotal = cappedVuln + cappedRes + cappedTour + isoTotal;
    if (cappedTotal <= 0) continue;
    handLeft[order.from] -= 2 * pieces(cappedTotal);
    // ハブへ着いたコマは、港・空港を空けるためにハブ側の手数で島内移動させる（1コマ1手）
    if (order.to !== 'mainland') handLeft[order.to] -= pieces(cappedTotal);
    poolUsed[pk] = (poolUsed[pk] ?? 0) + cappedTotal;
    if (civHub && civFlightsUsed[civHub] !== undefined) civFlightsUsed[civHub] += civCost === 1 ? cappedTotal : ceil05(cappedTotal / SHUTTLE_MULTIPLIER);

    area.vulnerable -= cappedVuln;
    area.residents -= cappedRes;
    area.tourists -= cappedTour;
    const takenVuln = takeVulnerableBreakdown(area, cappedVuln);

    const destLabel = order.to === 'mainland' ? '本土' : order.to === 'ishigaki' ? '石垣島' : '宮古島';
    if (order.to === 'ishigaki' || order.to === 'miyako') {
      // 中継ハブ集約（西側フェリー流入 or ピストン）→ ハブで待機し、当日残の本土便容量があれば当日、無ければ翌以降に本土へ。
      // 要援護者は stagingVulnerable に分けて積む（海路のみで搬出・航空機不可）。
      areas[order.to].stagingPort += cappedRes + cappedTour;
      areas[order.to].stagingVulnerable = (areas[order.to].stagingVulnerable ?? 0) + cappedVuln;
      addBreakdown(ledger.inTransit, takenVuln);
      // 着いた時刻を記録（竹富町フェリーは午前便から埋め、あふれた分は午後便。要援護者を先の便に乗せる）
      if (order.method === '竹富→石垣フェリー') {
        const am = Math.min(cappedTotal, Math.max(0, tkAmLeft)); tkAmLeft -= am;
        const vAm = Math.min(cappedVuln, am);
        if (am > 0) arrivals[order.to].push({ white: am - vAm, vuln: vAm, from: tkAmHour });
        if (cappedTotal - am > 0) arrivals[order.to].push({ white: cappedTotal - am - (cappedVuln - vAm), vuln: cappedVuln - vAm, from: tkPmHour });
      } else {
        arrivals[order.to].push({ white: cappedRes + cappedTour, vuln: cappedVuln, from: order.method.startsWith('ピストン') ? shuttleArrival(order.method, cappedTotal, order.from) : arrivalHour(order.method) });
      }
    } else {
      evacuatedCount += cappedTotal; // 孤立集落から直接乗せたコマを含む
      addBreakdown(vulnArrived, takenVuln);
    }

    evacuations.push({
      from: order.from,
      to: destLabel,
      count: cappedTotal,
      method: order.method,
      isVulnerable: cappedVuln + isoTaken.taramaVuln > 0,
    });
    const isoJp = [isoTaken.funauki > 0 ? `船浮${isoTaken.funauki}` : '', isoTaken.hatoma > 0 ? `鳩間島${isoTaken.hatoma}` : '',
      isoTaken.taramaVuln + isoTaken.tarama > 0 ? `多良間島${isoTaken.taramaVuln + isoTaken.tarama}` : ''].filter(Boolean).join('・');
    evacLog.push(`${order.method}: ${order.from === 'yonaguni' ? '与那国' : order.from === 'taketomi' ? '竹富町' : order.from === 'ishigaki' ? '石垣' : '宮古'} ${cappedTotal}コマ${isoJp ? `（うち${isoJp}から直接乗船）` : ''} → ${destLabel}`);

    // 輸送アセット消費
    const M = SHUTTLE_MULTIPLIER;
    if (order.method === '海保輸送船') {
      transport.coastGuardToday = Math.max(0, transport.coastGuardToday - Math.ceil(cappedTotal));
      cgTripsLeft = Math.max(0, cgTripsLeft - Math.ceil(cappedTotal));
    } else if (order.method === '海自輸送艦') {
      transport.jmsdfRemaining = Math.max(0, transport.jmsdfRemaining - 1); jmsdfTripsToday += 1;
    } else if (order.method === '空自輸送機') {
      transport.jasdfRemaining = Math.max(0, transport.jasdfRemaining - 1); jasdfTripsToday += 1; // 1便=1コマ(上限で保証)
    } else if (order.method === 'ピストン海保輸送船') {
      // 近距離3倍: 1便=3コマ。運んだコマ数を便数(=/3切上げ)に換算して消費。
      transport.coastGuardToday = Math.max(0, transport.coastGuardToday - Math.ceil(cappedTotal / M));
      cgTripsLeft = Math.max(0, cgTripsLeft - Math.ceil(cappedTotal / M));
    } else if (order.method === 'ピストン海自輸送艦') {
      transport.jmsdfRemaining = Math.max(0, transport.jmsdfRemaining - 1); jmsdfTripsToday += 1; // 1便=Mコマ(上限で保証)
    } else if (order.method === 'ピストン空自輸送機') {
      transport.jasdfRemaining = Math.max(0, transport.jasdfRemaining - 1); jasdfTripsToday += 1;
    } else if (order.method === 'ピストン陸自ヘリ') {
      // 陸自ヘリ 1便1コマ（通常）。運んだコマ数=便数を消費。
      transport.jgsdfRemaining = Math.max(0, transport.jgsdfRemaining - Math.ceil(cappedTotal));
    }
    // ピストン民間航空 は民間便のため自衛隊アセットを消費しない。
  }

  // 待機コマ（石垣島・宮古島の港・空港で本土便を待つコマ）→ 本土。有事の場合、残っている便で自動的に送り出す。
  // 当日着いたコマは「着いた時刻より後に出る便」にしか乗れない（午後のフェリーで着いたコマは午前の便には乗れない）。
  if (newPhase === 'wartime') {
    const civAirOk = !transport.civilianAirDisabled;
    // 待機コマから n コマまで取り出す。grant(着いた時刻, 希望数) が認めた数だけ対象（前日までの待機コマは常に対象）
    const takeStaged = (hub: 'ishigaki' | 'miyako', kind: 'white' | 'vuln', n: number, grant: (from: number, want: number) => number): number => {
      const a = areas[hub];
      const total = kind === 'white' ? a.stagingPort : a.stagingVulnerable ?? 0;
      const today = arrivals[hub].reduce((t, b) => t + b[kind], 0);
      let left = Math.max(0, n);
      const old = Math.min(left, Math.max(0, total - today)); left -= old;
      let got = old;
      // 遅く着いたコマから先に割り当てる（遅い便しか使えないコマを優先）
      for (const b of [...arrivals[hub]].sort((x, y) => y.from - x.from)) {
        if (left <= 0) break;
        const t = Math.max(0, Math.min(left, b[kind], grant(b.from, Math.min(left, b[kind]))));
        b[kind] -= t; left -= t; got += t;
      }
      if (kind === 'white') a.stagingPort -= got; else a.stagingVulnerable = (a.stagingVulnerable ?? 0) - got;
      return got;
    };
    // 民間空路: 同じ日の注文は早い時刻の便から使ったものとみなし、残った便（遅い時刻）を待機コマに充てる
    const airStaging = (hub: 'ishigaki' | 'miyako', label: string, hours: number[], usedFlights: number, room: number) => {
      const cap = Math.min(room, Math.floor(handLeft[hub] + 1e-9));
      if (cap <= 0) return;
      const rest = hours.slice(Math.floor(usedFlights + 1e-9)); // まだ出ていない便の時刻
      // 当日着いたコマは、着いた時刻より後の便の数まで（遅く着いたコマから順に、遅い便を割り当てる）
      let assigned = 0;
      const n = takeStaged(hub, 'white', cap, (from, want) => {
        const g = Math.max(0, Math.min(want, rest.filter(h => h > from).length - assigned));
        assigned += g;
        return g;
      });
      if (n <= 0) return;
      handLeft[hub] -= pieces(n); // 待機コマは港・空港にいるので出発の1手のみ
      evacuatedCount += n;
      evacuations.push({ from: hub, to: '本土', count: n, method: `${label}(港待機)`, isVulnerable: false });
      evacLog.push(`${label}(港待機): 待機${n}コマ → 本土（${label}の民間便 本日分の内数。${hub === 'ishigaki' ? '石垣島' : '宮古島'}発の「${label}(民間)」と合わせて上限）`);
      civFlightsUsed[hub] += n;
    };
    const usedBy = (m: string) => evacuations.filter(e => e.method === m).reduce((t, e) => t + e.count, 0);
    if (airportAvail.shinIshigaki && civAirOk) {
      airStaging('ishigaki', '新石垣空港', slx?.civHours.shinIshigaki ?? [], civFlightsUsed.ishigaki, Math.max(0, CIV_FLIGHTS.ishigaki - civFlightsUsed.ishigaki));
    }
    // 石垣の待機コマ → 空自輸送機（応急復旧後は民間便が止まっていても飛べる）。1日1便・当日容量まで。要援護者は航空機不可なので白コマのみ
    if (capacities.jasdfFrom.ishigaki > 0 && jasdfTripsToday < 1 && transport.jasdfRemaining > 0 && areas.ishigaki.stagingPort > 0 && handLeft.ishigaki >= 1) {
      const fieldH = slx?.airfieldHours.shinIshigaki ?? [];
      const n = takeStaged('ishigaki', 'white', Math.min(1, capacities.jasdfFrom.ishigaki), (from, want) => (fieldH.some(h => h > from) ? want : 0));
      if (n > 0) {
        handLeft.ishigaki -= pieces(n);
        evacuatedCount += n;
        evacuations.push({ from: 'ishigaki', to: '本土', count: n, method: '空自輸送機(港待機)', isVulnerable: false });
        evacLog.push(`空自輸送機: 石垣の待機${n}コマ → 本土`);
        transport.jasdfRemaining = Math.max(0, transport.jasdfRemaining - 1); // 当日の空自はこれで1便使用（以降に空自の搬出は無い）
      }
    }
    // 宮古の待機コマ: 宮古空港 → 下地島空港（宮古空港が破壊・閉鎖でも下地島が使えれば搬出）
    if (airportAvail.miyako && civAirOk) {
      const used = usedBy('宮古空港(民間)');
      airStaging('miyako', '宮古空港', slx?.civHours.miyako ?? [], used, Math.max(0, Math.min(capacities.miyakoAirMax - used, CIV_FLIGHTS.miyako - civFlightsUsed.miyako)));
    }
    if (airportAvail.shimoji && civAirOk && areas.miyako.stagingPort > 0) {
      const used = usedBy('下地島空港(民間)');
      airStaging('miyako', '下地島空港', slx?.civHours.shimoji ?? [], used, Math.max(0, Math.min(capacities.shimojAirMax - used, CIV_FLIGHTS.miyako - civFlightsUsed.miyako)));
    }

    // 待機コマの海路搬出（要援護者は海路のみ）。同日の注文が使った分を差し引いた残りで、待機要援護者を優先し、残りで待機白コマを本土へ。
    // 民間フェリー → 海保輸送船 → 海自輸送艦 の順。
    const seaStaging = (hub: 'ishigaki' | 'miyako') => {
      const used = (m: string) => evacuations.filter(e => e.from === hub && e.method === m).reduce((t, e) => t + e.count, 0);
      const ferryName = hub === 'ishigaki' ? '石垣港フェリー' : '平良港フェリー';
      const ferryCap = hub === 'ishigaki' ? capacities.ishigakiFerryMax : capacities.miyakoFerryMax;
      const cgCap = capacities.cgFrom[hub];
      const jmsdfCap = capacities.jmsdfFrom[hub];
      // 本土行きフェリーは1日1便（午前か午後のどちらか）。同じ日の注文が既にその便を使っていれば、便は早い方の時刻に出発済み
      // （その残席に乗れるのは出発前に着いていたコマだけ）。まだ使っていなければ、待機コマ用に遅い方の便を選べる
      const dep = slx?.mainDep[hub === 'ishigaki' ? 'ishigakiPort' : 'hiraraPort'];
      const ferryHour = !dep ? 99 : used(ferryName) > 0 ? (dep.am ?? dep.pm ?? 0) : (dep.pm ?? dep.am ?? 0);
      const lastSea = slx ? slx.seaOpenHours.reduce((m, h) => Math.max(m, h), 0) : 99;
      // 海自輸送艦: 当日容量 かつ 実残隻数>0 かつ 本日まだ1便も使っていない（全エリアで1日1便）とき1便(1コマ)
      const jmsdfLeg = transport.jmsdfRemaining > 0 && jmsdfTripsToday < 1 ? Math.min(1, Math.max(0, jmsdfCap - used('海自輸送艦'))) : 0;
      const legs: Array<{ label: string; cap: number; consume: 'none' | 'cg' | 'jmsdf'; last: number }> = [
        { label: `${ferryName}(港待機)`, cap: Math.max(0, ferryCap - used(ferryName)), consume: 'none', last: ferryHour },
        { label: '海保輸送船(港待機)', cap: Math.min(Math.max(0, cgCap - used('海保輸送船')), transport.coastGuardToday, cgTripsLeft), consume: 'cg', last: lastSea },
        { label: '海自輸送艦(港待機)', cap: jmsdfLeg, consume: 'jmsdf', last: lastSea },
      ];
      for (const leg of legs) {
        const legCap = Math.min(leg.cap, Math.floor(handLeft[hub] + 1e-9));
        if (legCap <= 0) continue;
        const v = takeStaged(hub, 'vuln', legCap, (from, want) => (leg.last > from ? want : 0));
        const w = takeStaged(hub, 'white', legCap - v, (from, want) => (leg.last > from ? want : 0));
        if (v + w <= 0) continue;
        handLeft[hub] -= pieces(v + w);
        evacuatedCount += v + w;
        if (v > 0) addBreakdown(vulnArrived, takeFromBreakdown(ledger.inTransit, v));
        if (leg.consume === 'cg') { transport.coastGuardToday = Math.max(0, transport.coastGuardToday - Math.ceil(v + w)); cgTripsLeft = Math.max(0, cgTripsLeft - Math.ceil(v + w)); }
        else if (leg.consume === 'jmsdf') { transport.jmsdfRemaining = Math.max(0, transport.jmsdfRemaining - 1); jmsdfTripsToday += 1; }
        evacuations.push({ from: hub, to: '本土', count: v + w, method: leg.label, isVulnerable: v > 0 });
        evacLog.push(`${leg.label}: 待機${v + w}コマ(要援護者${v}) → 本土`);
      }
    };
    seaStaging('ishigaki');
    seaStaging('miyako');
  }

  // --- 孤立集落の島内移送（鳩間島→西表島・船浮→西表島・多良間島→宮古島）---
  // 孤立集落のコマは、本島（西表島／宮古島）へ渡るまで本土向けの便には乗れない。渡ったコマは翌日から通常の住民・要援護者として扱う。
  // 便は時刻表（phase1.slots）で数える: フェリーは午前便 9〜11時・午後便 14〜16時のどちらか1便、多良間空港は15時の1便。
  //   鳩間港→上原港 1コマ/便 ・ 船浮港→白浜港 0.5コマ/便（西表島内の移動。存立危機事態ならLvを問わず可）
  //   多良間空港→宮古空港 0.5コマ/便（🔵のみ）・多良間港→平良港 0.5コマ/便（🔴優先）。多良間・宮古は有事のみ
  // インフラ表のコスト増（×1/1.5 等）は港別倍率で掛け、0.5コマ単位に切り捨てる。
  {
    const sl = phase1.slots;
    const f05 = (x: number) => Math.floor(x * 2 + 1e-9) / 2;
    const blockOf = (area: AreaId, jp: string): string | null => isOccupied(stateAfterEvents, area) ? `${jp} 占領`
      : effectiveHands(stateAfterEvents, area) <= 0 ? `${jp} 手数0（避難行動不可）`
      : (phase1.evacRefusedToday ?? []).includes(area) ? `${jp} 本日避難拒否`
      : null;
    const seaWhy = !phase1.seaOk ? '大雨・強風で海路閉鎖' : '港が使用不能（破壊・閉鎖・運航停止）';
    // 竹富町: 鳩間・船浮
    {
      const tk = areas.taketomi;
      const by = isolatedByOf(tk);
      if (by.hatoma + by.funauki > 0 && newPhase !== 'peacetime') {
        const common = blockOf('taketomi', '竹富町');
        const moved: string[] = [];
        const blocked: string[] = [];
        for (const k of ['hatoma', 'funauki'] as const) {
          const pend = Math.max(0, by[k]);
          if (pend <= 0) continue;
          const jp = k === 'hatoma' ? '鳩間→西表' : '船浮→西表';
          if (common) { blocked.push(`${jp}: ${common}`); continue; }
          const trips = sl?.tport[k] ?? 0;
          if (trips <= 0) { blocked.push(`${jp}: ${seaWhy}`); continue; }
          if (handLeft.taketomi < 2) { blocked.push(`${jp}: 竹富町の本日の手数を使い切った`); continue; }
          const n = Math.min(f05(trips * tportKomaPerTrip(k) * (phase1.taketomiPortMultiplier?.[k] ?? 1)), pend);
          if (n <= 0) { blocked.push(`${jp}: 減便で本日の移送容量0`); continue; }
          handLeft.taketomi -= 2 * pieces(n); // 島内移動1手＋出航1手
          by[k] = pend - n;
          tk.residents += n;
          moved.push(`${jp} ${n}コマ（${TAKETOMI_PORT_JP[k]}）`);
        }
        tk.isolatedPendingBy = by;
        tk.isolatedPending = isolatedSum(by);
        if (moved.length) evacLog.push(`🚢 島内移送: ${moved.join('／')}（西表島着。石垣行きフェリーは翌日から）`);
        if (blocked.length) evacLog.push(`🚫 島内移送不可: ${blocked.join('／')}`);
      }
    }
    // 宮古エリア: 多良間島（有事のみ）
    {
      const mk = areas.miyako;
      const by = isolatedByOf(mk);
      if (by.tarama + by.taramaVuln > 0 && newPhase === 'wartime') {
        const mul = phase1.taramaRouteMultiplier ?? { air: 1, sea: 1 };
        const handsOut = () => (handLeft.miyako < 2 ? '宮古島・多良間の本日の手数を使い切った' : null);
        let common = blockOf('miyako', '宮古島・多良間') ?? handsOut();
        const moved: string[] = [];
        const blocked: string[] = [];
        // 空路（15時の1便・🔵のみ）
        if (by.tarama > 0) {
          const n = common ? 0 : Math.min(f05((sl?.civ.tarama ?? 0) * TARAMA_TRANSFER_CAPACITY.air * mul.air), by.tarama);
          if (n > 0) { by.tarama -= n; mk.residents += n; handLeft.miyako -= 2 * pieces(n); common = handsOut(); moved.push(`多良間空港→宮古空港 🔵${n}コマ`); }
          else blocked.push(`空路: ${common ?? (stateAfterEvents.infra.taramaAirport === false ? '多良間空港 破壊' : '15時に多良間空港か宮古空港が使用不能（大雨・強風・閉鎖・破壊・運航停止）')}`);
        }
        // 海路（🔴優先→🔵）
        if (by.tarama + by.taramaVuln > 0) {
          let room = common ? 0 : f05((sl?.taramaSea ?? 0) * TARAMA_TRANSFER_CAPACITY.sea * mul.sea);
          if (room <= 0) blocked.push(`フェリー: ${common ?? seaWhy}`);
          const v = Math.min(room, by.taramaVuln);
          if (v > 0) {
            by.taramaVuln -= v; room -= v;
            mk.vulnerable += v;
            handLeft.miyako -= 2 * pieces(v);
            addBreakdown(ensureBreakdown(mk), takeFromBreakdown(mk.isolatedVulnBreakdown ??= allocateBreakdown(v + by.taramaVuln), v));
            moved.push(`多良間港→平良港 🔴${v}コマ`);
          }
          const r = Math.min(room, by.tarama);
          if (r > 0 && handLeft.miyako >= 2) { by.tarama -= r; mk.residents += r; handLeft.miyako -= 2 * pieces(r); moved.push(`多良間港→平良港 🔵${r}コマ`); }
        }
        mk.isolatedPendingBy = by;
        mk.isolatedPending = isolatedSum(by);
        if (moved.length) evacLog.push(`✈🚢 島内移送: ${moved.join('／')}（宮古島着。本土便は翌日から）`);
        if (blocked.length && by.tarama + by.taramaVuln > 0) evacLog.push(`🚫 多良間→宮古 移送不可: ${blocked.join('／')}`);
      }
    }
  }

  fixNegatives(areas);

  // --- 臨時増援交渉（ver4.0 4.9）: 当日の輸送で残0になった手段は同日中に交渉（当日未交渉のもののみ）。
  //     成功分は翌日から使用可（newTransport へ+1）。1手消費は翌日の1手（untilDay=翌日）として handPenalty に積む。
  const rein2 = negotiateReinforcement({
    day, phase: newPhase, prepLevel: stateAfterEvents.prepLevel,
    remaining: { jgsdf: transport.jgsdfRemaining, jmsdf: transport.jmsdfRemaining, jasdf: transport.jasdfRemaining },
    areas, occupied: stateAfterEvents.occupied ?? { yonaguni: false, taketomi: false, ishigaki: false, miyako: false },
    reinforcement: stateAfterEvents.reinforcement, handPenalty: stateAfterEvents.handPenalty, when: 'afterEvac',
    infra: stateAfterEvents.infra, disabledAirRoutes: transport.disabledAirRoutes,
  }, evacLog);
  transport.jgsdfRemaining += rein2.gain.jgsdf;
  transport.jmsdfRemaining += rein2.gain.jmsdf;
  transport.jasdfRemaining += rein2.gain.jasdf;

  // --- 一時疲労の解除（避難完了）を「その日のうちに」反映 ---
  // 多良間→宮古（多良間島の孤立集落コマが0）・波照間→石垣(竹富町各島=taketomiエリアが無人)になったら避難完了とみなし、
  // 加算済みの一時疲労(*Applied)を当該エリアから差し引く（冪等・疲労死判定より前に戻す）。
  // 多良間島の避難完了 = 多良間島の孤立集落コマ（🔵🔴）が全て宮古島へ渡った（または死亡した）
  const taramaIsoEmpty = isolatedByOf(areas.miyako).tarama + isolatedByOf(areas.miyako).taramaVuln <= 0;
  const taketomiEmpty = areas.taketomi.residents + areas.taketomi.tourists + areas.taketomi.vulnerable + (areas.taketomi.isolatedPending ?? 0) === 0;
  let taramaEvacDone = stateAfterEvents.taramaEvacDone || taramaIsoEmpty;
  let haterumaEvacDone = stateAfterEvents.haterumaEvacDone || (stateAfterEvents.haterumaPowerBroken && taketomiEmpty);
  let taramaTempApplied = stateAfterEvents.taramaTempApplied;
  let taramaTempFatigue = stateAfterEvents.taramaTempFatigue;
  let haterumaTempApplied = stateAfterEvents.haterumaTempApplied;
  let haterumaTempFatigue = stateAfterEvents.haterumaTempFatigue;
  const releaseTempFatigue = (why: string) => {
    if (taramaEvacDone && taramaTempApplied > 0) {
      areas.miyako.fatigue -= taramaTempApplied;
      evacLog.push(`多良間→宮古 ${why} → 一時疲労 -${taramaTempApplied}(宮古島・多良間)`);
      taramaTempApplied = 0; taramaTempFatigue = 0;
    }
    if (haterumaEvacDone && haterumaTempApplied > 0) {
      areas.taketomi.fatigue -= haterumaTempApplied;
      evacLog.push(`波照間→石垣 ${why} → 一時疲労 -${haterumaTempApplied}(竹富町各島)`);
      haterumaTempApplied = 0; haterumaTempFatigue = 0;
    }
  };
  releaseTempFatigue('避難完了');
  fixNegatives(areas);

  // --- 疲労度最大（手数0）---
  // マニュアル2.1 終了条件②: 「そのエリアの疲労度最大（手数ゼロ）は避難不能につき死亡確定」。
  // 手数が0になったエリアは以後いっさい避難行動ができず、疲労度は回復しない（5.1）ため、残っているコマは全て死亡確定とする。
  let fatigueDead = 0;
  for (const area of Object.values(areas)) {
    const effAct = handsByFatigue(area.id, area.fatigue);
    // 判定対象は removeFromArea の除去対象と同じ（港待機コマ・孤立集落のコマも含む）
    const alive = area.residents + area.tourists + area.vulnerable + area.stagingPort + (area.stagingVulnerable ?? 0)  + (area.isolatedPending ?? 0);
    if (effAct <= 0 && alive > 0) {
      const removed = removeFromArea(area, alive, ledger);
      fatigueDead += removed;
      evacLog.push(`⚠️ 疲労度最大（手数0）: ${area.name} は避難不能 → 残り${removed}コマ死亡確定`);
    }
  }

  // --- X+3日 竹富島以西 避難完了期限（マニュアル5.3）---
  // X+3日24時までに避難が終わらなかった与那国島・竹富町全島の住民は死亡（占領）扱い。全4エリア疲労+2（避難完了なら発生しない）。
  let deadlineDeaths = 0;
  const occupiedOut: Record<AreaId, boolean> = { ...(stateAfterEvents.occupied ?? { yonaguni: false, taketomi: false, ishigaki: false, miyako: false }) };
  if (day === 3) {
    const parts: string[] = [];
    for (const id of ['yonaguni', 'taketomi'] as AreaId[]) {
      const a = areas[id];
      const left = a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0) + (a.isolatedPending ?? 0);
      if (left <= 0 || occupiedOut[id]) continue;
      const removed = removeFromArea(a, left, ledger);
      deadlineDeaths += removed;
      occupiedOut[id] = true;
      parts.push(`${a.name} ${removed}コマ`);
    }
    if (deadlineDeaths > 0) {
      evacLog.push(`⚠️ X+3日24時: 竹富島以西の避難期限 → 避難が終わらなかった ${parts.join('・')} は死亡（占領）扱い・全エリア疲労+2`);
      for (const id of Object.keys(areas) as AreaId[]) areas[id].fatigue += 2;
    }
  }

  // 疲労死・期限死で多良間島/竹富町が無人になった場合も、その日のうちに一時疲労を解除する（翌日の手数に残さない）
  {
    const iso = isolatedByOf(areas.miyako);
    if (!taramaEvacDone && iso.tarama + iso.taramaVuln <= 0) taramaEvacDone = true;
    const tk = areas.taketomi;
    if (!haterumaEvacDone && stateAfterEvents.haterumaPowerBroken && tk.residents + tk.tourists + tk.vulnerable + (tk.isolatedPending ?? 0) === 0) haterumaEvacDone = true;
    releaseTempFatigue('無人化（死亡）');
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
      total: a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0) + (a.isolatedPending ?? 0),
      residents: a.residents,
      tourists: a.tourists,
      vulnerable: a.vulnerable,
      staging: a.stagingPort + (a.stagingVulnerable ?? 0),
      isolated: a.isolatedPending ?? 0, // 鳩間・船浮の島内移送待ち（total に含む）
      fatigue: a.fatigue,
      handsBase: handsByFatigue(a.id, a.fatigue),
      hands: Math.max(0, handsByFatigue(a.id, a.fatigue) - activeHandPenalty(stateAfterEvents, a.id, day)),
    }])
  ) as DayLog['areaSnapshots'];

  // 人口保存則の自己検査（初期総数 = 残存 + 累計避難 + 累計死亡）。崩れたら日報に警告を残す（通常は発生しない）
  if (stateAfterEvents.initialTotal !== undefined) {
    const aliveNow = Object.values(areas).reduce((t, a) => t + a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0) + (a.isolatedPending ?? 0), 0);
    const gap = stateAfterEvents.initialTotal - (aliveNow + newEvacuated + newDead);
    if (Math.abs(gap) > 1e-6) evacLog.push(`⚠️ 人口保存則の不一致: 初期${stateAfterEvents.initialTotal} − (残存${aliveNow}+避難${newEvacuated}+死亡${newDead}) = ${gap}`);
  }

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
      // pen は臨時増援交渉の1手消費（handPenalty には negotiation のみ積まれる。不時着は空港別容量倍率で扱う）
      const hands = pen > 0 ? `手数${h}−${pen}(増援交渉1手)=${Math.max(0, h - pen)}` : `手数${h}`;
      return `${a.name}: 疲労${a.fatigue >= 0 ? '+' : ''}${a.fatigue.toFixed(1)} (${hands})`;
    }).join(' | '),
    totalEvacuatedSoFar: newEvacuated,
    totalDeadSoFar: newDead,
    areaSnapshots,
    hourlyRolls,
    // AI災害司令官（指標用）
    capacityOffered: totalCapacityOffered(capacities),
    vulnerableArrived: vulnArrived,
    vulnerableDiedToday: (() => {
      const d = emptyBreakdown();
      const before = originalState.vulnerableDead ?? emptyBreakdown();
      for (const c of VULNERABLE_CATEGORIES) d[c] = Math.max(0, ledger.dead[c] - before[c]);
      return d;
    })(),
    stagingVulnerableByHub: {
      yonaguni: areas.yonaguni.stagingVulnerable ?? 0, taketomi: areas.taketomi.stagingVulnerable ?? 0,
      ishigaki: areas.ishigaki.stagingVulnerable ?? 0, miyako: areas.miyako.stagingVulnerable ?? 0,
    },
    policy,
    // 日報PDF 一覧表用（日末）: 施設マークは地図(IllustratedMap)と同じ判定（facilities.ts）、島別残存は地図と同じ按分（islands.ts）
    facilityStatus: facilityStatusAll({
      infra: stateAfterEvents.infra, transport: newTransport,
      closedToday: stateAfterEvents.closedFacilitiesToday ?? [], weatherClosed, prepLevel: stateAfterEvents.prepLevel,
    }, phase1.weatherClosedAm),
    islandSnapshot: islandSnapshot(areas),
    forceSnapshot: {
      jgsdfRemaining: newTransport.jgsdfRemaining, jmsdfRemaining: newTransport.jmsdfRemaining, jasdfRemaining: newTransport.jasdfRemaining,
      jsdfSea: stateAfterEvents.military.jsdfSea, jsdfAir: stateAfterEvents.military.jsdfAir,
      chineseSea: stateAfterEvents.military.chineseSea, chineseAir: stateAfterEvents.military.chineseAir,
      pac3Ishigaki: stateAfterEvents.military.pac3Ishigaki, pac3Miyako: stateAfterEvents.military.pac3Miyako,
      senkakuOccupied: newMilitary.senkakuOccupied || stateAfterEvents.military.senkakuOccupied,
    },
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
    occupied: occupiedOut, // X+3日の期限で占領扱いになった与那国島・竹富町全島を含む
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
    // 要支援者モデル（④）
    vulnerableInTransit: ledger.inTransit,
    vulnerableDead: ledger.dead,
    vulnerableEvacuated: addBreakdown({ ...(stateAfterEvents.vulnerableEvacuated ?? emptyBreakdown()) }, vulnArrived),
  };

  return { newState, log: dLog };
}

// その日に提供された総輸送容量（本土便＋島間フィーダー便）。海自は表示容量合算を実残隻数でクランプ。
// 往復(ピストン)便は海保/海自/空自と同じ便を共有するため含めない。輸送資源効率 = 避難コマ / この値。
export function totalCapacityOffered(c: DayCapacities): number {
  return c.yonaguniAirMax + c.yonaguniSeaMax + c.taketomiFerryMax + c.haterumaAirMax
    + c.ishigakiAirMax + c.ishigakiJasdfMax + c.coastGuardTrips + c.ishigakiFerryMax
    + Math.min(c.ishigakiJmsdfMax + c.miyakoJmsdfMax, c.jmsdfRemaining, 1)
    + c.miyakoAirMax + c.shimojAirMax + c.miyakoFerryMax;
}

// ===== AI自動選択（autoplay用）=====
// 避難方針(EvacPolicy)で「手段ブロックの試行順」を切り替える。'balanced' は従来実装と完全に同一の注文を返す。
//   balanced         : 従来順（空路→海保→空自→海自→フェリー）。全方針で各エリアの残人口を追跡して注文する
//   sea-first        : 各エリアで海路（フェリー/海保/海自）を先に試し、空路は後
//   air-first        : 各エリアで空路（民間航空/空自）を先に試し、海路は後
//   vulnerable-first : 各エリアで海路手段の枠をまず要援護者で埋め、白コマ（住民・観光客）は残容量で
//   shuttle-first    : 往復(ピストン)輸送が発火している日は往復便の予算を上限式の余力いっぱいまで使う。未発火なら balanced と同一
// 既存の制約（要援護者は航空機不可 / 容量 / 共有便プール差引 / 占領・避難拒否除外 / 往復輸送）はそのまま守る。
interface EvacLeg {
  area: AreaId;
  to: 'mainland' | 'ishigaki' | 'miyako';
  method: string;
  kind: 'air' | 'sea';
  cap: number;      // 残容量（割り当てで減る）
  vulnOk: boolean;
  tourOk: boolean;
  vuln: number; res: number; tour: number; // 割り当て済み
  // 全エリア共通の便プール（海保輸送船の当日便数 / 海自輸送艦・空自輸送機の1日1便）。割り当てるとプールも減る
  shared?: { left: number };
  // 1日1便の手段（海自・空自）: どこか1エリアで使ったら当日は終わり
  single?: boolean;
}

export function autoSelectOrders(phase1: DayPhase1Result, policy: EvacPolicy = 'balanced'): EvacuationOrder[] {
  const { stateAfterEvents: state, capacities, airportAvail } = phase1;
  const orders: EvacuationOrder[] = [];
  const areas = state.areas;
  const { transport } = state;
  const civAirOk = !transport.civilianAirDisabled;
  // 方針別の挙動スイッチ
  // 全方針で石垣/宮古の残人口を追跡する（旧 balanced/shuttle-first は未追跡で、同じ要援護者を2つの注文が取り合い、
  // 空いた海路枠を住民に使わず残すことがあった。同乱数の対比較で Lv3 +0.05pt・Lv4 +0.17pt、悪化するレベルなし）
  const trackHubs = true;
  const shuttleFirst = policy === 'shuttle-first';

  // 橋（池間・来間・伊良部）が落ちると、その離島住民は宮古本島へ渡れず移動不可＝孤立
  const lockedMiyako = (state.infra.bridgeIkema ? 0 : 1)
    + (state.infra.bridgeKurima ? 0 : 1)
    + (state.infra.bridgeIrabu ? 0 : 1);
  // 宮古の「避難可能な住民数」（孤立分を差し引く）
  const mRes = Math.max(0, areas.miyako.residents - lockedMiyako);

  // エリア別の残人口プール（与那国・竹富は従来から残人口追跡。石垣・宮古は trackHubs のときのみ追跡）
  const pool: Record<AreaId, { vuln: number; res: number; tour: number }> = {
    yonaguni: { vuln: areas.yonaguni.vulnerable, res: areas.yonaguni.residents, tour: areas.yonaguni.tourists },
    taketomi: { vuln: areas.taketomi.vulnerable, res: areas.taketomi.residents, tour: areas.taketomi.tourists },
    ishigaki: { vuln: areas.ishigaki.vulnerable, res: areas.ishigaki.residents, tour: areas.ishigaki.tourists },
    miyako: { vuln: areas.miyako.vulnerable, res: mRes, tour: areas.miyako.tourists },
  };
  const tracked = (id: AreaId) => id === 'yonaguni' || id === 'taketomi' || trackHubs;

  const M = SHUTTLE_MULTIPLIER;
  // 海保/海自/空自は「石垣・宮古の本土便」と「ピストン便」で同一の実アセット(便)を共有する。
  // ピストンで消費した「便数」分を本土便プール(本土便は1便1コマ)から差し引き、二重使用・過剰削減の両方を防ぐ。
  // 便は全エリア共通: 海保=当日便数（1便1コマ）、海自・空自=1日1便（1コマ）。どのエリアから出すかは下の優先順で決める
  const cgPool = { left: capacities.coastGuardTrips };
  const jmsdfPool = { left: Math.min(1, capacities.jmsdfRemaining) };
  const jasdfPool = { left: Math.min(1, transport.jasdfRemaining) };
  // エリア別の手数の残り（1コマ＝島内移動1手＋出発1手）
  const handRoom: Record<AreaId, number> = {
    yonaguni: Math.floor(capacities.handBudget.yonaguni / 2), taketomi: Math.floor(capacities.handBudget.taketomi / 2),
    ishigaki: Math.floor(capacities.handBudget.ishigaki / 2), miyako: Math.floor(capacities.handBudget.miyako / 2),
  };
  // 民間ピストンで使った便数（送出側ハブ別）。同じ空港の民間便なので本土民間便の容量から差し引く（宮古は宮古空港→下地島の順に充当）
  const civShuttleFlights: Record<AreaId, number> = { yonaguni: 0, taketomi: 0, ishigaki: 0, miyako: 0 };

  // ===== Section2: 石垣島⇔宮古島 2島間往復(ピストン)輸送 =====
  // 片方ハブの本土空路が破壊/運航拒否の時、破壊された側ハブの住民を機能している側ハブへ集約する。
  // 本土避難ロジックより前に発火し、破壊された側ハブの人口を先に中継便へ積む（手分けは下流の本土便が担う）。
  // （海保輸送船は離島・多良間島を優先するため、往復便の割り当ては下の planShuttle() を離島の後に呼ぶ）
  const planShuttle = () => {
  if (capacities.shuttleActive && capacities.shuttleFrom && capacities.shuttleTo) {
    const fromId = capacities.shuttleFrom;
    // 中継先ハブは石垣/宮古のみ（getDayCapacities が保証）。EvacuationOrder.to へ渡すため型を絞る。
    const toDest = capacities.shuttleTo as 'ishigaki' | 'miyako';
    // 輸送量の上限: 送出側が自力で本土へ出せない見込み分（不足）と、受け入れ側が本土へ出せる余力の小さい方。
    // 当日限りの閉鎖では発火しないが、発火時も必要以上に集約して受け入れ側があふれないようにする。
    const daysLeft = Math.max(1, 8 - state.day + 1);
    const popOf = (id: AreaId) => { const a = areas[id]; return a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0) + (a.isolatedPending ?? 0); };
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
    // shuttle-first: 上限式の余力（受入側の全手段×残日数−受入側人口）を全て往復便に使う（送出側の不足見込みで絞らない）
    let shuttleBudget = shuttleFirst
      ? Math.max(0, hubDailyCap(toDest) * daysLeft - toPop)
      : Math.max(0, Math.min(fromDeficit, toSpare));
    // 送出可能な人数（宮古発は橋孤立分を差し引く）。要援護者は船舶手段を優先的に割り当てる。
    let remainingVuln = pool[fromId].vuln;
    let remainingRes = pool[fromId].res;
    let remainingTour = pool[fromId].tour;
    // (method, 容量, 要援護者可否). 船舶(海保/海自)は要援護者可。
    // ver4.0 4.6.5: 空自輸送機は白コマのみ（要援護者は航空機不可）。要援護者はフェリー/海保/海自のみ。
    const legs: Array<{ method: string; cap: number; vulnOk: boolean }> = [
      { method: 'ピストン海保輸送船', cap: capacities.shuttleCoastGuardMax, vulnOk: true },
      { method: 'ピストン海自輸送艦', cap: capacities.shuttleJmsdfMax, vulnOk: true },
      { method: 'ピストン空自輸送機', cap: capacities.shuttleJasdfMax, vulnOk: false },
      { method: 'ピストン民間航空', cap: capacities.shuttleCivAirMax, vulnOk: false },
      { method: 'ピストン陸自ヘリ', cap: capacities.shuttleJgsdfMax, vulnOk: false },
    ];
    for (const leg of legs) {
      // 離島・多良間島に回した後の残りの便だけを使う（海保は残り便数×3コマ、海自・空自は当日の1便が残っていれば）
      const sharedCap = leg.method === 'ピストン海保輸送船' ? cgPool.left * M
        : leg.method === 'ピストン海自輸送艦' ? jmsdfPool.left * M
        : leg.method === 'ピストン空自輸送機' ? jasdfPool.left * M
        : Infinity;
      if (leg.cap <= 0 || sharedCap <= 0 || shuttleBudget <= 0 || handRoom[fromId] <= 0) continue;
      let budget = Math.min(leg.cap, sharedCap, shuttleBudget, handRoom[fromId]);
      const vuln = leg.vulnOk ? Math.min(remainingVuln, budget) : 0;
      budget -= vuln;
      const res = Math.min(remainingRes, budget);
      budget -= res;
      const tour = Math.min(remainingTour, budget);
      if (vuln + res + tour <= 0) continue;
      const moved = vuln + res + tour;
      shuttleBudget -= moved;
      handRoom[fromId] -= Math.ceil(moved - 1e-9);
      remainingVuln -= vuln; remainingRes -= res; remainingTour -= tour;
      // ピストンで消費した「便数」を本土便プールから差し引く。3倍手段は moved コマで ceil(moved/M) 便を消費し、
      // その各便は本土便なら1便1コマなので、本土プールからは ceil(moved/M) コマ分を減らす（二重使用・過剰削減の防止）。
      if (leg.method === 'ピストン海保輸送船') cgPool.left = Math.max(0, cgPool.left - Math.ceil(moved / M));
      else if (leg.method === 'ピストン海自輸送艦') jmsdfPool.left = 0;
      else if (leg.method === 'ピストン空自輸送機') jasdfPool.left = 0;
      else if (leg.method === 'ピストン民間航空') civShuttleFlights[fromId] += Math.ceil(moved / M * 2 - 1e-9) / 2; // 同じ空港の便を使う → 本土民間便から差し引く（0.5便単位に切り上げ）
      // 陸自ヘリ(1倍: moved=便数)は本土プールを消費しない別枠。民間航空も本土海保/海自/空自プールを消費しない。
      orders.push({ from: fromId, to: toDest, method: leg.method, residents: res, tourists: tour, vulnerable: vuln });
    }
    // 残人口追跡する方針では、往復便に積んだ分を送出側ハブの本土便プールから差し引く
    if (tracked(fromId)) pool[fromId] = { vuln: remainingVuln, res: remainingRes, tour: remainingTour };
  }
  };

  // ===== 手段ブロック（正準順＝balanced の試行順・注文の出力順）=====
  // 竹富→石垣フェリーは海路なので全方針で要援護者を積む（ver4.0 4.6.5: 要援護者はフェリー/海保/海自）。
  // 旧実装は balanced/shuttle-first で積まず、竹富の要援護者がX+3日期限で死亡していた（全シミュ検証で発見）。
  const taketomiFerryVulnOk = true;
  const mk = (area: AreaId, to: EvacLeg['to'], method: string, kind: EvacLeg['kind'], cap: number, vulnOk: boolean, tourOk: boolean, shared?: { left: number }, single = false): EvacLeg =>
    ({ area, to, method, kind, cap: Math.max(0, cap), vulnOk, tourOk, vuln: 0, res: 0, tour: 0, shared, single });
  // 海保輸送船・海自輸送艦・空自輸送機（全エリア共通の便プール）。船は白コマ（住民・観光客）も要援護者も可、空自は白コマのみ
  const cgLeg = (area: AreaId) => mk(area, 'mainland', '海保輸送船', 'sea', capacities.cgFrom[area], true, true, cgPool);
  const jmsdfLeg = (area: AreaId) => mk(area, 'mainland', '海自輸送艦', 'sea', capacities.jmsdfFrom[area], true, true, jmsdfPool, true);
  const jasdfLeg = (area: AreaId) => mk(area, 'mainland', '空自輸送機', 'air', capacities.jasdfFrom[area], false, true, jasdfPool, true);
  // 宮古発の民間ピストン便を宮古空港→下地島空港の順に割り当てる（使えない空港には割り当てない）
  const miyakoShuttleSplit = () => {
    let f = civShuttleFlights.miyako;
    const mCap = civAirOk && airportAvail.miyako ? capacities.miyakoAirMax : 0;
    const m = Math.min(f, mCap); f -= m;
    return { miyako: m, shimoji: f };
  };
  const legsByArea: Record<AreaId, EvacLeg[]> = {
    yonaguni: [
      // 与那国 → 本土(空路) ※存立危機・有事では直行便が使えるので住民・観光客を最優先で直送
      mk('yonaguni', 'mainland', '与那国空港(民間)', 'air', capacities.yonaguniAirMax, false, true),
      // 与那国 → 石垣(フェリー) ※航空不可の要援護者＋直行便に乗りきれなかった住民のみ（むやみに石垣へ送らない）
      mk('yonaguni', 'ishigaki', 'フェリー', 'sea', capacities.yonaguniSeaMax, true, true),
      // 民間便で運びきれない分は海保輸送船（存立危機事態でも可）・空自輸送機・海自輸送艦で本土へ直接
      cgLeg('yonaguni'), jasdfLeg('yonaguni'), jmsdfLeg('yonaguni'),
    ],
    taketomi: [
      // 竹富 → 石垣(フェリー)
      mk('taketomi', 'ishigaki', '竹富→石垣フェリー', 'sea', capacities.taketomiFerryMax, taketomiFerryVulnOk, true),
      // 波照間空港 → 新石垣空港 民間航空便（Lv4+ 0.5コマ/日）。フェリーで運びきれなかった竹富住民・観光客を空輸する
      mk('taketomi', 'ishigaki', '波照間空港(民間)', 'air',
        capacities.haterumaAirMax > 0 && airportAvail.hateruma && airportAvail.shinIshigaki ? capacities.haterumaAirMax : 0, false, true),
      // フェリーで運びきれない分は海保輸送船（存立危機事態でも可）・海自輸送艦で本土へ直接
      cgLeg('taketomi'), jasdfLeg('taketomi'), jmsdfLeg('taketomi'),
    ],
    ishigaki: [
      // 石垣 → 本土(空路) ※与那国・竹富からの待機コマ(stagingPort)を優先確保
      mk('ishigaki', 'mainland', '新石垣空港(民間)', 'air',
        capacities.ishigakiAirMax > 0 && civAirOk && airportAvail.shinIshigaki ? capacities.ishigakiAirMax - areas.ishigaki.stagingPort : 0, false, true),
      // 石垣 → 本土(海保)
      cgLeg('ishigaki'),
      // 石垣 → 本土(空自輸送機) ※白コマ(住民・観光客)のみ。要援護者は航空機不可
      // 空自は破壊後の応急復旧（翌日以降）で民間便が止まっていても飛べる。可否は容量計算（jasdfAirfieldOk）済みの値に従う
      jasdfLeg('ishigaki'),
      // 石垣 → 本土(海自)
      jmsdfLeg('ishigaki'),
      // 石垣 → 本土(民間フェリー)。白コマ・青コマとも可（マニュアル4.6.2）
      mk('ishigaki', 'mainland', '石垣港フェリー', 'sea', capacities.ishigakiFerryMax, true, true),
    ],
    miyako: [
      // 宮古 → 本土(空路) ※橋崩落で孤立した住民(mRes)は移動不可
      mk('miyako', 'mainland', '宮古空港(民間)', 'air', civAirOk && airportAvail.miyako ? capacities.miyakoAirMax : 0, false, true),
      // 宮古 → 本土(下地島)
      mk('miyako', 'mainland', '下地島空港(民間)', 'air', civAirOk && airportAvail.shimoji ? capacities.shimojAirMax : 0, false, true),
      // 宮古 → 本土(海保/空自/海自)
      cgLeg('miyako'), jasdfLeg('miyako'), jmsdfLeg('miyako'),
      // 宮古 → 本土(民間フェリー)。白コマ・青コマとも可
      mk('miyako', 'mainland', '平良港フェリー', 'sea', capacities.miyakoFerryMax, true, true),
    ],
  };

  // 1つの手段ブロックへ残人口を割り当てる（優先: 要援護者→住民→観光客）。cats で当該パスの対象を絞る。
  const allocate = (leg: EvacLeg, cats: { vuln: boolean; white: boolean }) => {
    if (leg.cap <= 0) return;
    const p = pool[leg.area];
    // 残容量・共有プールの残り・そのエリアの手数の残り の最小
    let cap = Math.min(leg.cap, leg.shared ? leg.shared.left : Infinity, handRoom[leg.area]);
    if (cap <= 0) return;
    const cap0 = cap;
    const vuln = cats.vuln && leg.vulnOk ? Math.min(p.vuln, cap) : 0; cap -= vuln;
    const res = cats.white ? Math.min(p.res, cap) : 0; cap -= res;
    const tour = cats.white && leg.tourOk ? Math.min(p.tour, cap) : 0; cap -= tour;
    if (vuln + res + tour <= 0) return;
    const used = cap0 - cap;
    leg.vuln += vuln; leg.res += res; leg.tour += tour; leg.cap -= used;
    handRoom[leg.area] -= Math.ceil(used - 1e-9);
    if (leg.shared) leg.shared.left = leg.single ? 0 : Math.max(0, leg.shared.left - Math.ceil(used - 1e-9)); // 1便1コマ（ハーフコマでも1便）
    if (leg.single) leg.cap = 0;
    if (tracked(leg.area)) { p.vuln -= vuln; p.res -= res; p.tour -= tour; }
  };

  const refusedToday = new Set(phase1.evacRefusedToday ?? []);
  const canLeave = (id: AreaId) => !isOccupied(state, id) && !refusedToday.has(id);
  // 海保輸送船の優先順（依頼仕様 2026-11-10）: ①竹富町の離島（船浮・鳩間島など自力で石垣へ出にくい所）→ ②多良間島 → ③石垣港・平良港。
  // ①-a 孤立集落（船浮→鳩間島）から直接本土へ
  if (canLeave('taketomi')) {
    const by = isolatedByOf(areas.taketomi);
    let room = Math.min(cgPool.left, capacities.cgFrom.taketomi, handRoom.taketomi);
    const fu = Math.min(room, Math.ceil(by.funauki - 1e-9) > 0 ? by.funauki : 0); room -= Math.ceil(fu - 1e-9);
    const ha = Math.min(Math.max(0, room), by.hatoma);
    if (fu + ha > 0) {
      const trips = Math.ceil(fu - 1e-9) + Math.ceil(ha - 1e-9);
      cgPool.left -= trips; handRoom.taketomi -= trips;
      orders.push({ from: 'taketomi', to: 'mainland', method: '海保輸送船', residents: 0, tourists: 0, vulnerable: 0, isolated: { funauki: fu, hatoma: ha } });
    }
  }

  // 方針別の試行順
  const areaIds: AreaId[] = ['yonaguni', 'taketomi', 'ishigaki', 'miyako'];
  const both = { vuln: true, white: true };
  const runArea = (id: AreaId) => {
    if (!canLeave(id)) return; // 占領・当日避難拒否のエリアは注文しない（共有の便プールも消費しない）
    const legs = legsByArea[id];
    if (policy === 'sea-first') {
      for (const l of legs) if (l.kind === 'sea') allocate(l, both);
      for (const l of legs) if (l.kind === 'air') allocate(l, both);
    } else if (policy === 'air-first') {
      for (const l of legs) if (l.kind === 'air') allocate(l, both);
      for (const l of legs) if (l.kind === 'sea') allocate(l, both);
    } else if (policy === 'vulnerable-first') {
      // 海路の枠をまず要援護者で埋め、白コマは残容量で（正準順）
      for (const l of legs) if (l.kind === 'sea') allocate(l, { vuln: true, white: false });
      for (const l of legs) allocate(l, { vuln: false, white: true });
    } else {
      // balanced / shuttle-first: 正準順
      for (const l of legs) allocate(l, both);
    }
  };
  // ①-b 与那国島・竹富町: 自前の民間便（空路・フェリー）を先に使い、運びきれない分を海保→空自→海自で本土へ
  runArea('yonaguni');
  runArea('taketomi');
  // ② 多良間島: 海保輸送船で直接本土へ（🔴優先→🔵）。宮古空港が破壊されている時は空自輸送機で多良間空港から🔵を出す
  if (canLeave('miyako')) {
    const by = isolatedByOf(areas.miyako);
    let room = Math.min(cgPool.left, capacities.cgFrom.miyako, handRoom.miyako);
    const tv = Math.min(Math.max(0, room), by.taramaVuln); room -= Math.ceil(tv - 1e-9);
    const tr = Math.min(Math.max(0, room), by.tarama);
    if (tv + tr > 0) {
      const trips = Math.ceil(tv - 1e-9) + Math.ceil(tr - 1e-9);
      cgPool.left -= trips; handRoom.miyako -= trips;
      orders.push({ from: 'miyako', to: 'mainland', method: '海保輸送船', residents: 0, tourists: 0, vulnerable: 0, isolated: { taramaVuln: tv, tarama: tr } });
    }
    const trLeft = by.tarama - tr;
    if (trLeft > 0 && !state.infra.miyakoAirport && jasdfPool.left > 0 && capacities.jasdfTarama > 0 && handRoom.miyako > 0) {
      const n = Math.min(1, trLeft, capacities.jasdfTarama);
      jasdfPool.left = 0; handRoom.miyako -= 1;
      orders.push({ from: 'miyako', to: 'mainland', method: '空自輸送機', residents: 0, tourists: 0, vulnerable: 0, isolated: { tarama: n } });
    }
  }
  // ③-0 石垣島⇔宮古島の2島間往復（発動中のみ）。離島・多良間島に回した残りの海保便を使う。
  //      民間便を往復に使った分は、同じ空港の本土便の枠から差し引く（宮古は宮古空港→下地島空港の順）
  planShuttle();
  {
    const sub = (area: AreaId, method: string, n: number) => {
      const l = legsByArea[area].find(x => x.method === method);
      if (l) l.cap = Math.max(0, l.cap - n);
    };
    sub('ishigaki', '新石垣空港(民間)', civShuttleFlights.ishigaki);
    const ms = miyakoShuttleSplit();
    sub('miyako', '宮古空港(民間)', ms.miyako);
    sub('miyako', '下地島空港(民間)', ms.shimoji);
  }
  // ③ 石垣港・平良港。ハブに待機している要援護者（竹富町・与那国から到着済み）は海路でしか出られないので、
  //    その分のフェリー枠・海保便を先に空けておき（待機コマの搬出は実行側が行う）、次に両ハブの要援護者を海路へ割り当てる
  for (const hub of ['ishigaki', 'miyako'] as const) {
    if (isOccupied(state, hub)) continue;
    let staged = areas[hub].stagingVulnerable ?? 0;
    if (staged <= 0) continue;
    const ferry = legsByArea[hub].find(l => l.method === (hub === 'ishigaki' ? '石垣港フェリー' : '平良港フェリー'));
    if (ferry) { const n = Math.min(staged, ferry.cap); ferry.cap -= n; staged -= n; }
    if (staged > 0) cgPool.left = Math.max(0, cgPool.left - Math.ceil(staged - 1e-9));
  }
  if (policy !== 'air-first') {
    for (const hub of ['ishigaki', 'miyako'] as const) {
      if (!canLeave(hub)) continue;
      for (const l of legsByArea[hub]) if (l.kind === 'sea') allocate(l, { vuln: true, white: false });
    }
  }
  runArea('ishigaki');
  runArea('miyako');

  // 注文は正準順で出力（実行側は残人口で上限確定するため方針間で出力順は共通）
  for (const id of areaIds) {
    for (const l of legsByArea[id]) {
      if (l.vuln + l.res + l.tour <= 0) continue;
      orders.push({ from: l.area, to: l.to, method: l.method, residents: l.res, tourists: l.tour, vulnerable: l.vuln });
    }
  }

  // ver4.0 6.4.2/3: 占領済みエリアからの避難注文・占領済みハブへの集約注文は生成しない（容量0とも整合）
  // 占領済み・当日避難拒否（A表）のエリア発は除外。避難拒否は当該エリア発のみ（ハブ待機コマの搬出は executeDayPhase2 で継続）
  return orders.filter(o => !isOccupied(state, o.from) && !refusedToday.has(o.from) && !(o.to !== 'mainland' && isOccupied(state, o.to)));
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
    if (effectiveActions <= 0 && (area.residents + area.tourists + area.vulnerable + (area.isolatedPending ?? 0)) > 0) {
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
    if (areas[key].isolatedPendingBy) {
      const by = isolatedByOf(areas[key]);
      by.hatoma = Math.max(0, by.hatoma); by.funauki = Math.max(0, by.funauki);
      by.tarama = Math.max(0, by.tarama); by.taramaVuln = Math.max(0, by.taramaVuln);
      areas[key].isolatedPendingBy = by;
      areas[key].isolatedPending = isolatedSum(by);
    } else {
      areas[key].isolatedPending = Math.max(0, areas[key].isolatedPending ?? 0);
    }
    const b = ensureBreakdown(areas[key]);
    for (const c of VULNERABLE_CATEGORIES) b[c] = Math.max(0, b[c]);
  }
}

// エリア人口から n コマを除去（住民→観光客→要援護者→待機白コマ→待機要援護者の順）。実際に除去できた数を返す。
// 要援護者が減った分は内訳(vulnerableBreakdown / ledger.inTransit)から比例で取り出し ledger.dead へ移す（④保存則）。
function removeFromArea(a: AreaState, n: number, ledger: VulnLedger): number {
  if (n <= 0) return 0;
  let r = n;
  const rRes = Math.min(r, a.residents); a.residents -= rRes; r -= rRes;
  const rTour = Math.min(r, a.tourists); a.tourists -= rTour; r -= rTour;
  const rVuln = Math.min(r, a.vulnerable); a.vulnerable -= rVuln; r -= rVuln;
  if (rVuln > 0) addBreakdown(ledger.dead, takeVulnerableBreakdown(a, rVuln));
  const rStg = Math.min(r, a.stagingPort); a.stagingPort -= rStg; r -= rStg;
  const sv = a.stagingVulnerable ?? 0;
  const rStgV = Math.min(r, sv); a.stagingVulnerable = sv - rStgV; r -= rStgV;
  if (rStgV > 0) addBreakdown(ledger.dead, takeFromBreakdown(ledger.inTransit, rStgV));
  // 最後に孤立集落（鳩間→船浮→多良間🔵→多良間🔴の順）
  if (r > 0) r -= takeIsolated(a, r, ledger);
  return n - r;
}

// 孤立集落（鳩間島・船浮・多良間島）の待機コマから n を取り出す（鳩間→船浮→多良間🔵→多良間🔴の順）。
// 実際に取れた数を返し、内訳と合計を同期する。多良間🔴の内訳は isolatedVulnBreakdown から ledger.dead へ移す。
function takeIsolated(a: AreaState, n: number, ledger: VulnLedger): number {
  const by = isolatedByOf(a); // 旧state（内訳なし）でも合計を内訳へ正規化してから除去（死亡計上なしの消失を防ぐ）
  let r = Math.max(0, n);
  const h = Math.min(r, Math.max(0, by.hatoma)); by.hatoma -= h; r -= h;
  const f = Math.min(r, Math.max(0, by.funauki)); by.funauki -= f; r -= f;
  const t = Math.min(r, Math.max(0, by.tarama)); by.tarama -= t; r -= t;
  const tv = Math.min(r, Math.max(0, by.taramaVuln)); by.taramaVuln -= tv; r -= tv;
  if (tv > 0) addBreakdown(ledger.dead, takeFromBreakdown(a.isolatedVulnBreakdown ??= allocateBreakdown(tv + by.taramaVuln), tv));
  a.isolatedPendingBy = by;
  a.isolatedPending = isolatedSum(by);
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
