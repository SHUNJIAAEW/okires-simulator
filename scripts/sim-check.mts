// シミュレーション全体の不変条件チェック（開発用）。実行: npx tsx scripts/sim-check.mts [SEEDS]
// 全レベル×抗堪性×月を自動実行し、人口保存・0.5コマ単位・容量超過・モード別の可否・時刻表ルールを検査する。
import { createInitialState, prepareDayPhase1, autoSelectOrders, executeDayPhase2 } from '../src/gameEngine';
import { vulnerableTotals } from '../src/commander';
import type { GameState, AreaId } from '../src/types';

const SEEDS = Number(process.argv[2] ?? 3);
const AREAS: AreaId[] = ['yonaguni', 'taketomi', 'ishigaki', 'miyako'];
const alive = (s: GameState) => AREAS.reduce((t, id) => { const a = s.areas[id]; return t + a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0) + (a.isolatedPending ?? 0); }, 0);
const viol: Record<string, { n: number; ex: string[] }> = {};
const V = (k: string, ex: string) => { (viol[k] ??= { n: 0, ex: [] }).n++; if (viol[k].ex.length < 3) viol[k].ex.push(ex); };
const half = (x: number) => Math.abs(x * 2 - Math.round(x * 2)) < 1e-6;
const vt = (s: GameState) => Object.values(vulnerableTotals(s)).reduce((a, b) => a + b, 0);
const stats: Record<number, { runs: number; rate: number; dead: number; left: number; days: number }> = {};

for (let lv = 1; lv <= 6; lv++) for (let sh = 1; sh <= 5; sh++) for (let m = 1; m <= 12; m++) for (let k = 0; k < SEEDS; k++) {
  let s = createInitialState({ prepLevel: lv, shelterLevel: sh, month: m });
  const tag = `Lv${lv}/抗${sh}/${m}月#${k}`;
  const init = alive(s); const vt0 = vt(s);
  if (init !== s.initialTotal) V('初期総数', tag);
  let d = 0;
  for (; d < 14 && !s.isComplete; d++) {
    const p = prepareDayPhase1(s);
    const orders = autoSelectOrders(p, 'balanced');
    const r = executeDayPhase2(s, p, orders);
    const n = r.newState; const dt = `${tag} ${r.log.dayLabel}`;
    if (Math.abs(alive(n) + n.evacuated + n.dead - init) > 1e-6) V('人口保存', `${dt} ${alive(n)}+${n.evacuated}+${n.dead}≠${init}`);
    if (Math.abs(vt(n) - vt0) > 1e-6) V('要援護者総数', dt);
    for (const id of AREAS) {
      const a = n.areas[id];
      for (const [key, v] of Object.entries({ r: a.residents, t: a.tourists, v: a.vulnerable, sp: a.stagingPort, sv: a.stagingVulnerable ?? 0, iso: a.isolatedPending ?? 0 })) {
        if (v < -1e-9) V('負値', `${dt} ${id}.${key}=${v}`);
        if (!half(v)) V('0.5単位でない', `${dt} ${id}.${key}=${v}`);
      }
      const bsum = Object.values(a.vulnerableBreakdown ?? {}).reduce((x, y) => x + y, 0);
      if (Math.abs(bsum - a.vulnerable) > 1e-6) V('要援護者内訳', `${dt} ${id}`);
    }
    const ev = r.log.evacuations;
    const evTotal = ev.filter(e => e.to === '本土' || e.to === 'mainland').reduce((t, e) => t + e.count, 0);
    if (Math.abs(evTotal - (n.evacuated - s.evacuated)) > 1e-6) V('避難実績と累計の差', `${dt} ${evTotal} vs ${n.evacuated - s.evacuated}`);
    if (p.newPhase === 'peacetime' && ev.length) V('平時に避難', dt);
    if (p.newPhase === 'crisis' && ev.some(e => e.from === 'ishigaki' && !/待機/.test(e.method) || e.from === 'miyako')) V('存立危機に石垣宮古発', dt);
    // 民間航空の便数上限（時刻表）
    const sum = (re: RegExp, from?: AreaId) => ev.filter(e => re.test(e.method) && (!from || e.from === from)).reduce((t, e) => t + e.count, 0);
    const sl = p.slots!;
    if (sum(/新石垣空港/) > sl.civ.shinIshigaki + 1e-9) V('新石垣>時刻表', `${dt} ${sum(/新石垣空港/)}>${sl.civ.shinIshigaki}`);
    if (sum(/^宮古空港/) > sl.civ.miyako + 1e-9) V('宮古空港>時刻表', dt);
    if (sum(/下地島空港/) > sl.civ.shimoji + 1e-9) V('下地島>時刻表', dt);
    if (sum(/与那国空港/) > sl.civ.yonaguni + 1e-9) V('与那国空港>時刻表', dt);
    if (sum(/海保/) > p.stateAfterEvents.transport.coastGuardToday * (p.capacities.shuttleActive ? 3 : 1) + 1e-9) V('海保>便数', dt);
    if (sl.seaHours === 0 && ev.some(e => /フェリー|海保|海自/.test(e.method))) V('海路閉鎖日に船', dt);
    if (ev.some(e => e.isVulnerable && /空港|空自|ヘリ|航空/.test(e.method))) V('要援護者が空路', dt);
    // 24時間ダイス枠のイベントは必ずログにある
    for (const h of r.log.hourlyRolls ?? []) if (h.eventType && !r.log.events.some(e => e.includes(`[イベント${h.eventType}|`) && e.includes(`|${h.hour}時]`))) V('イベントのログ欠落', `${dt} ${h.hour}時`);
    if (r.log.events.some(e => /人口保存則の不一致/.test(e))) V('保存則ログ', dt);
    s = n;
  }
  const st = (stats[lv] ??= { runs: 0, rate: 0, dead: 0, left: 0, days: 0 });
  st.runs++; st.rate += s.evacuated / init; st.dead += s.dead; st.left += alive(s); st.days += d;
}
for (let lv = 1; lv <= 6; lv++) { const t = stats[lv]; console.log(`Lv${lv}: 避難率${(t.rate / t.runs * 100).toFixed(1)}% 死亡${(t.dead / t.runs).toFixed(2)} 取残${(t.left / t.runs).toFixed(2)} 平均${(t.days / t.runs).toFixed(1)}日 (${t.runs}回)`); }
console.log(Object.keys(viol).length ? JSON.stringify(viol, null, 1) : '違反0');
process.exitCode = Object.keys(viol).length ? 1 : 0;
