// 手動注文の耐久テスト（開発用）。実行: npx tsx scripts/fuzz-check.mts [GAMES]
// 自動注文を最大10倍に水増しし、でたらめな経路・負数・0.25コマ・孤立集落の指定も混ぜて、実行側が上限を守るかを検査する。
import { createInitialState, prepareDayPhase1, autoSelectOrders, executeDayPhase2 } from '../src/gameEngine';
import { vulnerableTotals } from '../src/commander';
import type { GameState, AreaId, EvacuationOrder } from '../src/types';

const GAMES = Number(process.argv[2] ?? 300);
const AREAS: AreaId[] = ['yonaguni', 'taketomi', 'ishigaki', 'miyako'];
const METHODS = ['与那国空港(民間)', 'フェリー', '竹富→石垣フェリー', '波照間空港(民間)', '新石垣空港(民間)', '空自輸送機', '石垣港フェリー', '宮古空港(民間)', '下地島空港(民間)', '平良港フェリー', '海保輸送船', '海自輸送艦', 'ピストン海保輸送船', 'ピストン海自輸送艦', 'ピストン空自輸送機', 'ピストン民間航空', 'ピストン陸自ヘリ'];
const alive = (s: GameState) => AREAS.reduce((t, id) => { const a = s.areas[id]; return t + a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0) + (a.isolatedPending ?? 0); }, 0);
const vt = (s: GameState) => Object.values(vulnerableTotals(s)).reduce((a, b) => a + b, 0);
const viol: Record<string, { n: number; ex: string[] }> = {};
const V = (k: string, ex: string) => { (viol[k] ??= { n: 0, ex: [] }).n++; if (viol[k].ex.length < 3) viol[k].ex.push(ex); };
const half = (x: number) => Number.isFinite(x) && Number.isInteger(x * 2);
const rnd = (n: number) => Math.floor(Math.random() * n);
let days = 0;
for (let g = 0; g < GAMES; g++) {
  let s = createInitialState({ prepLevel: 1 + g % 6, shelterLevel: 1 + g % 5, month: 1 + g % 12 });
  const init = alive(s); const vt0 = vt(s);
  for (let d = 0; d < 13 && !s.isComplete; d++) {
    const p = prepareDayPhase1(s);
    const orders: EvacuationOrder[] = [];
    for (const o of autoSelectOrders(p, 'balanced')) orders.push({ ...o, residents: o.residents * (1 + rnd(10)), tourists: o.tourists * (1 + rnd(10)), vulnerable: o.vulnerable * (1 + rnd(10)) });
    for (let i = 0; i < 8; i++) {
      const bad = Math.random() < 0.2;
      orders.push({
        from: AREAS[rnd(4)], to: (['mainland', 'ishigaki', 'miyako'] as const)[rnd(3)], method: METHODS[rnd(METHODS.length)],
        residents: bad ? [-1, 0.25, NaN, 0.5000001, Infinity][rnd(5)] : rnd(8), tourists: Math.random() < 0.05 ? -2 : rnd(4), vulnerable: Math.random() < 0.05 ? 0.75 : rnd(4),
        isolated: Math.random() < 0.4 ? { funauki: rnd(3) / 2, hatoma: rnd(3), tarama: rnd(3) / 2, taramaVuln: rnd(3) / 2 } : undefined,
      });
    }
    for (let i = orders.length - 1; i > 0; i--) { const j = rnd(i + 1); [orders[i], orders[j]] = [orders[j], orders[i]]; }
    const r = executeDayPhase2(s, p, orders); const n = r.newState; const dt = `g${g} ${r.log.dayLabel}`; days++;
    if (Math.abs(alive(n) + n.evacuated + n.dead - init) > 1e-6) V('人口保存', dt);
    if (Math.abs(vt(n) - vt0) > 1e-6) V('要援護者総数', dt);
    for (const id of AREAS) { const a = n.areas[id];
      for (const [k, v] of Object.entries({ r: a.residents, t: a.tourists, v: a.vulnerable, sp: a.stagingPort, sv: a.stagingVulnerable ?? 0, iso: a.isolatedPending ?? 0 })) { if (v < -1e-9) V('負値', `${dt} ${id}.${k}=${v}`); if (!half(v)) V('0.5単位でない', `${dt} ${id}.${k}=${v}`); }
      const b = Object.values(a.vulnerableBreakdown ?? {}).reduce((x, y) => x + y, 0); if (Math.abs(b - a.vulnerable) > 1e-6) V('要援護者内訳', `${dt} ${id}`);
    }
    const ev = r.log.evacuations; const sl = p.slots!; const c = p.capacities; const M = 3;
    const sum = (f: (m: string) => boolean) => ev.filter(e => f(e.method)).reduce((t, e) => t + e.count, 0);
    if (p.newPhase === 'peacetime' && ev.length) V('平時に避難', dt);
    if (p.newPhase === 'crisis' && ev.some(e => e.from === 'ishigaki' || e.from === 'miyako')) V('存立危機に石垣・宮古発', `${dt} ${JSON.stringify(ev.filter(e => e.from === 'ishigaki' || e.from === 'miyako'))}`);
    if (sum(m => m.startsWith('新石垣空港')) > c.ishigakiAirMax + 1e-9) V('新石垣>容量', `${dt} ${sum(m => m.startsWith('新石垣空港'))}>${c.ishigakiAirMax}`);
    if (sum(m => m.startsWith('宮古空港')) > c.miyakoAirMax + 1e-9) V('宮古空港>容量', dt);
    if (sum(m => m.startsWith('下地島空港')) > c.shimojAirMax + 1e-9) V('下地島>容量', dt);
    if (sum(m => m.startsWith('与那国空港')) > c.yonaguniAirMax + 1e-9) V('与那国空港>容量', dt);
    if (sum(m => m === '竹富→石垣フェリー') > c.taketomiFerryMax + 1e-9) V('竹富フェリー>容量', dt);
    if (sum(m => m.startsWith('石垣港フェリー')) > c.ishigakiFerryMax + 1e-9) V('石垣港フェリー>容量', dt);
    if (sum(m => m.startsWith('平良港フェリー')) > c.miyakoFerryMax + 1e-9) V('平良港フェリー>容量', dt);
    const cgTrips = ev.filter(e => /海保/.test(e.method)).reduce((t, e) => t + Math.ceil((/ピストン/.test(e.method) ? e.count / M : e.count) - 1e-9), 0);
    if (cgTrips > c.coastGuardTrips) V('海保>便数', `${dt} ${cgTrips}>${c.coastGuardTrips}`);
    if (ev.filter(e => /海自/.test(e.method)).length > 1) V('海自が1日2便', dt);
    if (ev.filter(e => /空自/.test(e.method)).length > 1) V('空自が1日2便', dt);
    if (sum(m => /陸自ヘリ/.test(m)) > 1 + 1e-9) V('陸自ヘリが1日1コマ超', dt);
    if (ev.some(e => !half(e.count))) V('実績が0.5単位でない', dt);
    if (ev.some(e => /海自|空自/.test(e.method) && e.count > (/ピストン/.test(e.method) ? M : 1) + 1e-9)) V('自衛隊1便>上限', dt);
    if (ev.some(e => e.isVulnerable && /空港|空自|ヘリ|航空/.test(e.method))) V('要援護者が空路', dt);
    if (sl.seaHours === 0 && ev.some(e => /フェリー|海保|海自/.test(e.method))) V('海路閉鎖日に船', dt);
    if (n.transport.jmsdfRemaining < 0 || n.transport.jasdfRemaining < 0 || n.transport.jgsdfRemaining < 0) V('自衛隊残数が負', dt);
    // 手数: 出発（1コマ2手。港待機の搬出は1手）＋ハブでの受入（1コマ1手）＋孤立集落の島内移送（1コマ2手）
    const pc = (x: number) => Math.ceil(x - 1e-9);
    const moved = (re: RegExp) => r.log.events.filter(e => /島内移送:/.test(e)).flatMap(e => [...e.matchAll(re)]).reduce((t, m) => t + pc(Number(m[1])), 0);
    for (const id of AREAS) {
      let use = ev.filter(e => e.from === id).reduce((t, e) => t + pc(e.count) * (/待機/.test(e.method) ? 1 : 2), 0);
      use += ev.filter(e => (id === 'ishigaki' && e.to === '石垣島') || (id === 'miyako' && e.to === '宮古島')).reduce((t, e) => t + pc(e.count), 0);
      if (id === 'taketomi') use += 2 * moved(/(?:鳩間|船浮)→西表 ([\d.]+)コマ/g);
      if (id === 'miyako') use += 2 * moved(/多良間(?:空港→宮古空港|港→平良港) (?:🔵|🔴)([\d.]+)コマ/g);
      if (use > c.handBudget[id] + 1e-9) V('手数超過', `${dt} ${id} ${use}>${c.handBudget[id]}`);
    }
    s = n;
  }
}
console.log(`days ${days}`);
console.log(Object.keys(viol).length ? JSON.stringify(viol, null, 1) : '違反0');
process.exitCode = Object.keys(viol).length ? 1 : 0;
