// OKIRES2026 AI災害司令官 — エンジン層（第1バッチ）
//
// 設計思想: 正解を教えるAIではなく、人間の判断を鍛えるAI。
//   人間が判断 → エンジン（決定論的な prepareDayPhase1 / autoSelectOrders / executeDayPhase2）が結果を計算
//   → なぜ成功/失敗したかをルールベースで分析する。
// 数値計算はすべて既存エンジンで行い、LLM(Jev) は説明・採点の補助に限定する（src/advisor.ts）。
// ここでは「推奨」フラグを持たせない（AI案を正解として表示しないため）。数値だけを返す。

import type {
  GameState, AreaId, EvacPolicy, DayLog, DayCapacities, EvacuationOrder,
  VulnerableBreakdown, VulnerableCategory,
} from './types';
import {
  prepareDayPhase1, autoSelectOrders, executeDayPhase2,
  emptyBreakdown, breakdownTotal, VULNERABLE_CATEGORIES, VULNERABLE_CATEGORY_JP,
} from './gameEngine';
import { handsByFatigue } from './constants';

// ===== 避難方針のラベル =====
export const EVAC_POLICIES: EvacPolicy[] = ['balanced', 'sea-first', 'air-first', 'vulnerable-first', 'shuttle-first'];

export const POLICY_LABELS: Record<EvacPolicy, { label: string; description: string }> = {
  'balanced': {
    label: 'バランス',
    description: '従来の自動注文と同じ順（空路→海保→空自→海自→フェリー）。往復輸送は不足分と受入余力の小さい方まで。',
  },
  'sea-first': {
    label: '海路優先',
    description: '各エリアで海路（フェリー/海保/海自）を先に割り当て、空路は後に回す。要援護者は海路のみのため相性が良いが、海況に左右される。',
  },
  'air-first': {
    label: '空路優先',
    description: '各エリアで空路（民間航空/空自輸送機）を先に割り当て、海路は後に回す。白コマの回転は速いが、要援護者は航空機に乗れない。',
  },
  'vulnerable-first': {
    label: '要援護者優先',
    description: '各エリアで海路手段の枠をまず要援護者で埋め、住民・観光客は残容量で運ぶ。',
  },
  'shuttle-first': {
    label: '往復輸送優先',
    description: '石垣⇔宮古の往復（ピストン）輸送が発火している日は、往復便の予算を受入側の余力いっぱいまで使う。未発火の日はバランスと同じ。',
  },
};

// ===== 決定論的乱数（mulberry32）=====
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 実行中だけ Math.random を決定論的PRNGへ差し替え、終了後に必ず復元する（例外時も復元）。
// 同期関数専用（Promise を返す関数は型で拒否する。await 中に復元されて決定論が崩れるため）。
export function withSeededRandom<T>(seed: number, fn: T extends PromiseLike<unknown> ? never : () => T): T {
  const original = Math.random;
  const rng = mulberry32(seed);
  Math.random = rng;
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

// ===== 共通ヘルパー =====
const AREA_IDS: AreaId[] = ['yonaguni', 'taketomi', 'ishigaki', 'miyako'];

export function areaRemaining(state: GameState, id: AreaId): number {
  const a = state.areas[id];
  return a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0);
}
export function totalRemaining(state: GameState): number {
  return AREA_IDS.reduce((s, id) => s + areaRemaining(state, id), 0);
}
// 避難率 = 避難完了 / (避難完了 + 死亡 + 残) — ResultScreen と同じ定義
export function evacuationRate(state: GameState): number {
  const denom = state.evacuated + state.dead + totalRemaining(state);
  return denom > 0 ? state.evacuated / denom : 0;
}
// 要援護者の総数（自宅残＋ハブ待機＋本土到着＋死亡）。カテゴリ別
export function vulnerableTotals(state: GameState): VulnerableBreakdown {
  const t = emptyBreakdown();
  for (const id of AREA_IDS) {
    const b = state.areas[id].vulnerableBreakdown;
    if (b) for (const c of VULNERABLE_CATEGORIES) t[c] += b[c];
  }
  for (const c of VULNERABLE_CATEGORIES) {
    t[c] += state.vulnerableInTransit?.[c] ?? 0;
    t[c] += state.vulnerableEvacuated?.[c] ?? 0;
    t[c] += state.vulnerableDead?.[c] ?? 0;
  }
  return t;
}

function isDone(state: GameState): boolean {
  return state.isComplete || state.day > 8 || totalRemaining(state) === 0;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function deepCopy<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

// ===== 1日実行（方針＋seed）=====
export interface DayRunResult {
  policy: EvacPolicy;
  orders: EvacuationOrder[];
  capacities: DayCapacities;
  newState: GameState;
  log: DayLog;
  evacuatedToday: number;
  deadToday: number;
  remaining: number;
  remainingByArea: Record<AreaId, number>;
  vulnerableArrivedToday: number;
}

// 現在の state から1日だけ進める。seed を与えると同じダイスで再現できる（withSeededRandom）。
// 入力 state は変更しない（deep copy）。
export function runDay(state: GameState, policy: EvacPolicy, seed?: number): DayRunResult {
  const run = (): DayRunResult => {
    const base = deepCopy(state);
    const phase1 = prepareDayPhase1(base);
    const orders = autoSelectOrders(phase1, policy);
    const { newState, log } = executeDayPhase2(base, phase1, orders, policy);
    const remainingByArea = Object.fromEntries(AREA_IDS.map(id => [id, areaRemaining(newState, id)])) as Record<AreaId, number>;
    return {
      policy, orders, capacities: phase1.capacities, newState, log,
      evacuatedToday: newState.evacuated - state.evacuated,
      deadToday: newState.dead - state.dead,
      remaining: totalRemaining(newState),
      remainingByArea,
      vulnerableArrivedToday: breakdownTotal(log.vulnerableArrived),
    };
  };
  return seed === undefined ? run() : withSeededRandom(seed, run);
}

// 同じダイス（同じ seed）で1日だけ再計算し、方針を変えた場合の当日の避難数・取り残しを返す（③「代替案なら…」用）。
export function replayDayWithPolicy(state: GameState, policy: EvacPolicy, seed: number): DayRunResult {
  return runDay(state, policy, seed);
}

// ===== ②未来予測（モンテカルロ）=====
export interface ForecastDayStat {
  day: number;
  dayLabel: string;
  evacRateMean: number;   // 0..1
  evacRateP10: number;
  evacRateP90: number;
  seaClosedRate: number;      // その日 海路が停止していた試行の割合
  airportClosedRate: number;  // その日 ハブ空港（新石垣/宮古/下地島）のいずれかが使えなかった試行の割合
  remainingMean: number;
}
export interface Forecast {
  policy: EvacPolicy;
  runs: number;
  seedBase: number;
  fromDay: number;
  days: ForecastDayStat[];
  finalEvacRate: { mean: number; p10: number; p90: number };
  expectedRemainingByArea: Record<AreaId, number>;
  expectedRemaining: number;
  vulnerableArrivalRateMean: number; // 要援護者の本土到着率（総数に対する）
  expectedDead: number;
  elapsedMs: number;
}

const DEFAULT_SEED_BASE = 20260923;
const SEED_STRIDE = 7919;

function dayLabelOf(day: number): string {
  return day === 0 ? 'X日' : day > 0 ? `X+${day}日` : `X${day}日`;
}

// 現在の state から X+8日24時（または全員避難）まで、毎日 prepareDayPhase1→autoSelectOrders(policy)→executeDayPhase2 を回す。
// 各試行は seedBase + i*SEED_STRIDE の決定論的乱数で実行するため、同じ seedBase なら方針間で同じダイス列を共有する。
export function forecast(state: GameState, policy: EvacPolicy, runs = 120, seedBase: number = DEFAULT_SEED_BASE): Forecast {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const fromDay = state.day;
  const lastDay = 8;
  const dayCount = Math.max(0, lastDay - fromDay + 1);
  // day index → 試行ごとの値
  const rateByDay: number[][] = Array.from({ length: dayCount }, () => []);
  const remByDay: number[][] = Array.from({ length: dayCount }, () => []);
  const seaClosed: number[] = Array(dayCount).fill(0);
  const aptClosed: number[] = Array(dayCount).fill(0);
  const finalRates: number[] = [];
  const finalRemByArea: Record<AreaId, number[]> = { yonaguni: [], taketomi: [], ishigaki: [], miyako: [] };
  const finalDead: number[] = [];
  const vulnRates: number[] = [];
  const vulnTotal = breakdownTotal(vulnerableTotals(state));

  for (let i = 0; i < runs; i++) {
    const seed = seedBase + i * SEED_STRIDE;
    withSeededRandom(seed, () => {
      let cur = deepCopy(state);
      let lastRate = evacuationRate(cur);
      let lastRem = totalRemaining(cur);
      for (let d = 0; d < dayCount; d++) {
        if (!isDone(cur)) {
          const phase1 = prepareDayPhase1(cur);
          if (!phase1.seaOk) seaClosed[d] += 1;
          const av = phase1.airportAvail;
          if (!av.shinIshigaki || !av.miyako || !av.shimoji) aptClosed[d] += 1;
          const orders = autoSelectOrders(phase1, policy);
          cur = executeDayPhase2(cur, phase1, orders, policy).newState;
          lastRate = evacuationRate(cur);
          lastRem = totalRemaining(cur);
        }
        rateByDay[d].push(lastRate);
        remByDay[d].push(lastRem);
      }
      finalRates.push(lastRate);
      for (const id of AREA_IDS) finalRemByArea[id].push(areaRemaining(cur, id));
      finalDead.push(cur.dead);
      vulnRates.push(vulnTotal > 0 ? breakdownTotal(cur.vulnerableEvacuated) / vulnTotal : 0);
    });
  }

  const days: ForecastDayStat[] = rateByDay.map((rates, d) => {
    const sorted = [...rates].sort((a, b) => a - b);
    return {
      day: fromDay + d,
      dayLabel: dayLabelOf(fromDay + d),
      evacRateMean: mean(rates),
      evacRateP10: percentile(sorted, 0.1),
      evacRateP90: percentile(sorted, 0.9),
      seaClosedRate: runs > 0 ? seaClosed[d] / runs : 0,
      airportClosedRate: runs > 0 ? aptClosed[d] / runs : 0,
      remainingMean: mean(remByDay[d]),
    };
  });
  const sortedFinal = [...finalRates].sort((a, b) => a - b);
  const expectedRemainingByArea = Object.fromEntries(AREA_IDS.map(id => [id, mean(finalRemByArea[id])])) as Record<AreaId, number>;
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    policy, runs, seedBase, fromDay, days,
    finalEvacRate: { mean: mean(finalRates), p10: percentile(sortedFinal, 0.1), p90: percentile(sortedFinal, 0.9) },
    expectedRemainingByArea,
    expectedRemaining: AREA_IDS.reduce((s, id) => s + expectedRemainingByArea[id], 0),
    vulnerableArrivalRateMean: mean(vulnRates),
    expectedDead: mean(finalDead),
    elapsedMs: t1 - t0,
  };
}

// 全方針を同じ seedBase で予測して並べる。推奨フラグは持たせない（数値だけ）。
export function compareScenarios(state: GameState, runs = 120, seedBase: number = DEFAULT_SEED_BASE): Forecast[] {
  return EVAC_POLICIES.map(p => forecast(state, p, runs, seedBase));
}

// ===== ①分析（ルールベース）=====
export type Bottleneck =
  | 'weather-sea' | 'weather-air' | 'facility-closed' | 'capacity'
  | 'occupied' | 'refusal' | 'fatigue' | 'shuttle' | 'none';

export const BOTTLENECK_LABELS: Record<Bottleneck, string> = {
  'weather-sea': '悪天候で海路停止',
  'weather-air': '悪天候で空港閉鎖',
  'facility-closed': '施設の破壊・閉鎖・路線停止',
  'capacity': '輸送容量が需要を下回った',
  'occupied': 'エリア占領',
  'refusal': '住民の避難拒否',
  'fatigue': '疲労限界',
  'shuttle': '往復輸送の予算未消化',
  'none': 'ボトルネックなし',
};

export interface AreaDayStat {
  evacuatedToMainland: number; // 当該エリア発で本土到着（ハブ待機分の搬出はハブ発として計上）
  movedToHub: number;          // ハブへ集約した数
  dead: number;                // 当該エリアで減った死亡（推定: 収支から算出）
  remaining: number;
  vulnerableRemaining: number;
  stagingVulnerable: number;
}

export interface PolicyAlternative {
  policy: EvacPolicy;
  label: string;
  evacuatedToday: number;
  remaining: number;
  deadToday: number;
  deltaEvacuated: number; // 実際との差
  deltaRemaining: number;
  text: string;
}

export interface DayAnalysis {
  day: number;
  dayLabel: string;
  policy: EvacPolicy | null;
  evacuatedToday: number;
  deadToday: number;
  remaining: number;
  vulnerableArrivedToday: VulnerableBreakdown;
  vulnerableDiedToday: VulnerableBreakdown;
  byArea: Record<AreaId, AreaDayStat>;
  capacityOffered: number;
  demandBefore: number;
  bottlenecks: Bottleneck[];
  bottleneckNotes: string[];
  options: string[];
  alternatives: PolicyAlternative[];
  summary: string;
}

const HUB_LABEL: Record<string, AreaId> = { '石垣島': 'ishigaki', '宮古島': 'miyako' };

// before=当日開始前の state / after=当日終了後の state / log=当日の DayLog / capacities=当日の容量 / policy=当日使った方針
// seed を与えると、同じダイスで他方針を再計算した差分（alternatives）を付ける。
export function analyzeDay(
  before: GameState, after: GameState, log: DayLog, capacities: DayCapacities,
  policy: EvacPolicy | null, seed?: number
): DayAnalysis {
  const evacuatedToday = after.evacuated - before.evacuated;
  const deadToday = after.dead - before.dead;
  const remaining = totalRemaining(after);

  // エリア別収支
  const byArea = {} as Record<AreaId, AreaDayStat>;
  for (const id of AREA_IDS) {
    const outMain = log.evacuations.filter(e => e.from === id && e.to === '本土').reduce((s, e) => s + e.count, 0);
    const outHub = log.evacuations.filter(e => e.from === id && e.to !== '本土').reduce((s, e) => s + e.count, 0);
    const inHub = log.evacuations.filter(e => e.to !== '本土' && HUB_LABEL[e.to] === id).reduce((s, e) => s + e.count, 0);
    const b = areaRemaining(before, id);
    const a = areaRemaining(after, id);
    byArea[id] = {
      evacuatedToMainland: outMain,
      movedToHub: outHub,
      dead: Math.max(0, b + inHub - outMain - outHub - a),
      remaining: a,
      vulnerableRemaining: after.areas[id].vulnerable,
      stagingVulnerable: after.areas[id].stagingVulnerable ?? 0,
    };
  }

  const demandBefore = AREA_IDS.filter(id => !before.occupied?.[id]).reduce((s, id) => s + areaRemaining(before, id), 0);
  const capacityOffered = log.capacityOffered ?? 0;

  // ボトルネック分類
  const bottlenecks: Bottleneck[] = [];
  const notes: string[] = [];
  const options: string[] = [];
  const push = (b: Bottleneck, note: string, ...opts: string[]) => {
    if (!bottlenecks.includes(b)) bottlenecks.push(b);
    notes.push(note);
    for (const o of opts) if (!options.includes(o)) options.push(o);
  };
  const wx = log.weatherClosed ?? [];
  const seaWx = wx.find(k => k === 'sea' || k.startsWith('sea:'));
  const airKeys = wx.filter(k => !(k === 'sea' || k.startsWith('sea:'))).map(k => k.split(':')[0]);
  const evStr = (log.events ?? []).join('\n');

  if (remaining > 0) {
    if (seaWx) {
      const why = seaWx.endsWith(':rain') ? '大雨' : seaWx.endsWith(':wind') ? '強風' : '悪天候';
      push('weather-sea', `${why}で全海港が停止。フェリー・海保・海自が使えず、要援護者（海路のみ）はハブ待機のまま。`,
        '空路の残容量（民間航空・空自輸送機）を白コマに回せるか確認する',
        '要援護者は海路のみ。翌日の海況回復を待つか、往復輸送で集約先を変えるかを比較する');
    }
    if (airKeys.length > 0) {
      push('weather-air', `悪天候で空港閉鎖: ${airKeys.join('・')}。空路容量がその分ゼロになった。`,
        '海路（フェリー/海保/海自）へ振り替える余地を確認する',
        '与那国・竹富→石垣のフェリー集約を先行させる案を検討する');
    }
    const infra = after.infra;
    const brokenFacilities: string[] = [];
    if (!infra.shinIshigakiAirport) brokenFacilities.push('新石垣空港');
    if (!infra.miyakoAirport) brokenFacilities.push('宮古空港');
    if (!infra.shimojiAirport) brokenFacilities.push('下地島空港');
    if (!infra.yonagunAirport) brokenFacilities.push('与那国空港');
    if (!infra.ishigakiPort) brokenFacilities.push('石垣港');
    if (!infra.hiraraPort) brokenFacilities.push('平良港');
    if (!infra.kuburaPort) brokenFacilities.push('久部良港');
    const disabledAir = Object.entries(after.transport.disabledAirRoutes ?? {}).filter(([, v]) => v).map(([k]) => k);
    const disabledShip = Object.entries(after.transport.disabledShipRoutes ?? {}).filter(([, v]) => v).map(([k]) => k);
    if ((log.closedFacilities ?? []).length > 0 || brokenFacilities.length > 0 || disabledAir.length > 0 || disabledShip.length > 0) {
      const parts: string[] = [];
      if ((log.closedFacilities ?? []).length > 0) parts.push(`当日閉鎖🚫: ${log.closedFacilities.join('・')}`);
      if (brokenFacilities.length > 0) parts.push(`破壊💥: ${brokenFacilities.join('・')}`);
      if (disabledAir.length > 0) parts.push(`空路停止: ${disabledAir.join('・')}`);
      if (disabledShip.length > 0) parts.push(`海路停止: ${disabledShip.join('・')}`);
      push('facility-closed', parts.join(' / '),
        '往復（ピストン）輸送の発火条件（Lv2以上・有事・片方ハブの空路喪失）を確認する',
        '路線別停止の影響範囲（他の空港/港で代替できるか）を確認する');
    }
    if (log.phase === 'peacetime') {
      push('capacity', '平時は島外避難ができない（容量0）。存立危機/有事への移行を待つ段階。',
        '存立危機（Lv2以上）で与那国・竹富→石垣の集約が可能になる点を確認する');
    } else if (capacityOffered < demandBefore && !bottlenecks.some(b => b === 'weather-sea' || b === 'weather-air' || b === 'facility-closed')) {
      // 天候停止・施設閉鎖が既に主因なら、その結果としての容量不足を別原因として重ねない（原因分類の優先順位）
      push('capacity', `提供容量${capacityOffered}コマ ＜ 需要${demandBefore}コマ。容量が需要を下回った。`,
        '要援護者・竹富以西（X+3日期限）の優先順位を見直す',
        '臨時増援交渉（Lv3以上・残0の手段）の余地を確認する');
    }
    const occ = AREA_IDS.filter(id => after.occupied?.[id]);
    if (occ.length > 0) {
      push('occupied', `占領: ${occ.map(id => after.areas[id].name).join('・')}。以後このエリアの避難・攻撃判定は無効。`,
        '占領エリアは避難不可。残るエリアへ輸送資源を集中させる案を検討する',
        'PAC3 撤収・再配備の条件（片方ハブの避難完了）を確認する');
    }
    if (evStr.includes('避難拒否')) {
      push('refusal', '住民の避難拒否（当日限り）で当該エリア発の注文が無効になった。ハブ待機コマの搬出は継続。',
        '避難拒否は当日限り。翌日の注文で当該エリアを優先する案を検討する');
    }
    const lowHands = AREA_IDS.filter(id => areaRemaining(after, id) > 0 && handsByFatigue(id, after.areas[id].fatigue) <= 1);
    if (evStr.includes('疲労限界') || lowHands.length > 0) {
      push('fatigue', evStr.includes('疲労限界')
        ? `疲労限界（手数0）で死者が出た。手数が少ないエリア: ${lowHands.map(id => after.areas[id].name).join('・') || 'なし'}`
        : `手数が1以下のエリア: ${lowHands.map(id => after.areas[id].name).join('・')}。翌日に疲労限界の恐れ。`,
        '停電・一時疲労（多良間/波照間）の要因と、避難完了による解除条件を確認する',
        '手数が減るエリアから先に出す案を検討する');
    }
    if (capacities.shuttleActive && capacities.shuttleFrom) {
      const shuttleCap = capacities.shuttleCoastGuardMax + capacities.shuttleJmsdfMax + capacities.shuttleJasdfMax + capacities.shuttleJgsdfMax + capacities.shuttleCivAirMax;
      const used = log.evacuations.filter(e => e.method.startsWith('ピストン')).reduce((s, e) => s + e.count, 0);
      const fromRem = areaRemaining(after, capacities.shuttleFrom);
      if (fromRem > 0 && used < shuttleCap) {
        push('shuttle', `往復輸送: 容量${shuttleCap}コマのうち${used}コマ使用。送出側（${after.areas[capacities.shuttleFrom].name}）に${fromRem}コマ残。`,
          '往復便の予算を余力いっぱいまで使う案（往復輸送優先）と、受入側の本土便を圧迫しない案を比較する');
      }
    }
  }
  if (bottlenecks.length === 0) {
    bottlenecks.push('none');
    notes.push(remaining === 0 ? '取り残しなし。全員の避難が完了した。' : '明確なボトルネックは検出されなかった。容量どおりに避難が進んだ。');
    if (remaining > 0) options.push('翌日も同じ方針で進めるか、予測（②）で方針間の差を見る');
  }

  // 代替方針（同じダイス）
  const alternatives: PolicyAlternative[] = [];
  if (seed !== undefined) {
    for (const p of EVAC_POLICIES) {
      if (p === policy) continue;
      const r = replayDayWithPolicy(before, p, seed);
      const dE = r.evacuatedToday - evacuatedToday;
      const dR = r.remaining - remaining;
      const sign = (x: number) => (x > 0 ? `+${x}` : `${x}`);
      alternatives.push({
        policy: p, label: POLICY_LABELS[p].label,
        evacuatedToday: r.evacuatedToday, remaining: r.remaining, deadToday: r.deadToday,
        deltaEvacuated: dE, deltaRemaining: dR,
        text: `${POLICY_LABELS[p].label}なら 本日避難${r.evacuatedToday}コマ（${sign(dE)}）・残${r.remaining}コマ（${sign(dR)}）`,
      });
    }
  }

  const vulnArrived = breakdownTotal(log.vulnerableArrived);
  const summary = `${log.dayLabel}: 避難${evacuatedToday}コマ（要援護者${vulnArrived}）・死亡${deadToday}コマ・残${remaining}コマ。`
    + (bottlenecks[0] === 'none' ? '' : `主因: ${bottlenecks.map(b => BOTTLENECK_LABELS[b]).join('／')}`);

  return {
    day: log.day, dayLabel: log.dayLabel, policy,
    evacuatedToday, deadToday, remaining,
    vulnerableArrivedToday: log.vulnerableArrived ?? emptyBreakdown(),
    vulnerableDiedToday: log.vulnerableDiedToday ?? emptyBreakdown(),
    byArea, capacityOffered, demandBefore,
    bottlenecks, bottleneckNotes: notes, options, alternatives, summary,
  };
}

// ===== ④指標 =====
export interface EvacMetrics {
  vulnerableEvacRate: number | null;                       // 要支援者避難率（全体）
  vulnerableEvacRateByCategory: Record<VulnerableCategory, number | null>;
  vulnerableTotals: VulnerableBreakdown;                   // 総数（カテゴリ別）
  vulnerableEvacuated: VulnerableBreakdown;
  vulnerableDead: VulnerableBreakdown;
  medicalTransportRate: number | null;                     // 医療搬送成功率（medical の本土到着率）
  avgEvacuationDay: number | null;                         // 平均避難日数（全避難コマ）: 本土到着日（X基準。0=X日）の平均
  avgEvacuationDaysFromStart: number | null;               // 同上を X-3日=1日目として数えた日数
  avgVulnerableEvacuationDay: number | null;               // 要援護者だけの平均到着日（X基準）
  maxVulnerableWaitDays: number;                           // 最大待機日数（ハブ待機の要援護者が連続して残った最大日数）
  transportEfficiency: number | null;                      // 輸送資源効率 = 本土避難コマ / 提供総容量
  capacityOfferedTotal: number;
  evacuated: number;
  dead: number;
  remaining: number;
  evacRate: number;
  categoryLabels: Record<VulnerableCategory, string>;
}

export function computeMetrics(state: GameState): EvacMetrics {
  const totals = vulnerableTotals(state);
  const evac = state.vulnerableEvacuated ?? emptyBreakdown();
  const dead = state.vulnerableDead ?? emptyBreakdown();
  const byCat = {} as Record<VulnerableCategory, number | null>;
  for (const c of VULNERABLE_CATEGORIES) byCat[c] = totals[c] > 0 ? evac[c] / totals[c] : null;
  const vTotal = breakdownTotal(totals);

  // 平均避難日数（全避難コマ＝住民・観光客・要援護者の本土到着日の加重平均）と、要援護者だけの平均到着日
  let dayWeighted = 0; let arrived = 0;
  let vDayWeighted = 0; let vArrived = 0;
  let capacityOfferedTotal = 0;
  for (const log of state.dayLogs) {
    for (const e of log.evacuations) {
      if (e.to !== '本土') continue;
      dayWeighted += e.count * log.day; arrived += e.count;
    }
    const va = breakdownTotal(log.vulnerableArrived);
    vDayWeighted += va * log.day; vArrived += va;
    capacityOfferedTotal += log.capacityOffered ?? 0;
  }
  // 最大待機日数（ハブ別に stagingVulnerable>0 の連続日数の最大）
  let maxWait = 0;
  for (const hub of ['ishigaki', 'miyako'] as AreaId[]) {
    let streak = 0;
    for (const log of state.dayLogs) {
      const sv = log.stagingVulnerableByHub?.[hub] ?? 0;
      streak = sv > 0 ? streak + 1 : 0;
      if (streak > maxWait) maxWait = streak;
    }
  }
  const remaining = totalRemaining(state);
  return {
    vulnerableEvacRate: vTotal > 0 ? breakdownTotal(evac) / vTotal : null,
    vulnerableEvacRateByCategory: byCat,
    vulnerableTotals: totals,
    vulnerableEvacuated: evac,
    vulnerableDead: dead,
    medicalTransportRate: byCat.medical,
    avgEvacuationDay: arrived > 0 ? dayWeighted / arrived : null,
    avgEvacuationDaysFromStart: arrived > 0 ? dayWeighted / arrived + 4 : null,
    avgVulnerableEvacuationDay: vArrived > 0 ? vDayWeighted / vArrived : null,
    maxVulnerableWaitDays: maxWait,
    transportEfficiency: capacityOfferedTotal > 0 ? arrived / capacityOfferedTotal : null,
    capacityOfferedTotal,
    evacuated: state.evacuated,
    dead: state.dead,
    remaining,
    evacRate: evacuationRate(state),
    categoryLabels: VULNERABLE_CATEGORY_JP,
  };
}
