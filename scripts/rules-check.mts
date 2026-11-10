// 時刻表・強制イベントのルール検査（開発用）。実行: npx tsx scripts/rules-check.mts
import { createInitialState, prepareDayPhase1, autoSelectOrders, executeDayPhase2, forcedEventOptions } from '../src/gameEngine';
import { computeDaySlots, civFlightsBefore, type SlotInput } from '../src/timetable';
import type { ForcedEvent, GameState, WeatherState, InfraState } from '../src/types';

let fail = 0;
const ok = (name: string, cond: boolean, detail = '') => { if (!cond) { fail++; console.log(`NG  ${name} ${detail}`); } else console.log(`ok  ${name}`); };
const cell = (table: 'A' | 'B' | 'C' | 'D', label: string) => { const o = forcedEventOptions(table).find(x => x.label === label); if (!o) throw new Error(`no cell ${label}`); return { table, col: o.col, row: o.row }; };
const ev = (day: number, hour: number, table: 'A' | 'B' | 'C' | 'D', label: string): ForcedEvent => ({ kind: 'event', day, hour, ...cell(table, label) });

// ---- 時刻表の単体検査 ----
const INFRA: InfraState = { shinIshigakiAirport: true, miyakoAirport: true, shimojiAirport: true, yonagunAirport: true, haterumaAirport: true, taramaAirport: true, ishigakiPort: true, hiraraPort: true, kuburaPort: true, seaAllAvailable: true, powerYonaguni: true, powerHateruma: true, powerIshigaki: true, powerTarama: true, powerMiyako: true, bridgeIkema: true, bridgeIrabu: true, bridgeKurima: true };
const fine: WeatherState = { condition: 'cloudy', conditionIndex: 4, windSpeedIndex: 1, windDirectionIndex: 3 };
const rain: WeatherState = { condition: 'heavy-rain', conditionIndex: 6, windSpeedIndex: 1, windDirectionIndex: 3 };
const windNE: WeatherState = { condition: 'cloudy', conditionIndex: 4, windSpeedIndex: 8, windDirectionIndex: 3 }; // 強風・北東
const base = (o: Partial<SlotInput>): SlotInput => ({ am: fine, pm: fine, month: 8, phase: 'wartime', prepLevel: 4, infraStart: INFRA, flightLimit: { shinIshigaki: 10, miyako: 7, shimoji: 3, yonaguni: 2 }, h24: false, crisisEvacOk: true, civAirStopped: {}, civShipStopped: {}, tportStopped: {}, closures: [], freezeUntil: 0, ...o });
{
  const s = computeDaySlots(base({}));
  ok('通常日: 新石垣10・宮古7・下地島3・与那国2・波照間1・多良間1', s.civ.shinIshigaki === 10 && s.civ.miyako === 7 && s.civ.shimoji === 3 && s.civ.yonaguni === 2 && s.civ.hateruma === 1 && s.civ.tarama === 1, JSON.stringify(s.civ));
  ok('通常日: 石垣港1便・大原2便・波照間港1便・海24時間', s.mainFerry.ishigakiPort === 1 && s.tport.ohara === 2 && s.tport.hateruma === 1 && s.seaHours === 24);
}
{
  const s = computeDaySlots(base({ am: rain }));
  ok('午前大雨→午後回復: 新石垣8便(13〜20時)・宮古7・下地島1(16時)・与那国1・波照間0(9時)・多良間1(15時)', s.civ.shinIshigaki === 8 && s.civ.miyako === 7 && s.civ.shimoji === 1 && s.civ.yonaguni === 1 && s.civ.hateruma === 0 && s.civ.tarama === 1, JSON.stringify(s.civ));
  ok('午前大雨→午後回復: フェリーは午後便のみ（大原1・石垣港1）・海12時間', s.tport.ohara === 1 && s.mainFerry.ishigakiPort === 1 && s.seaHours === 12);
}
{
  const s = computeDaySlots(base({ pm: rain }));
  ok('午後から大雨: 新石垣5便(8〜12時)・宮古5・下地島2・与那国1・波照間1・多良間0', s.civ.shinIshigaki === 5 && s.civ.miyako === 5 && s.civ.shimoji === 2 && s.civ.yonaguni === 1 && s.civ.hateruma === 1 && s.civ.tarama === 0, JSON.stringify(s.civ));
}
{
  const s = computeDaySlots(base({ am: windNE, pm: windNE }));
  ok('終日強風(北東): 新石垣・宮古は可、下地島・与那国・波照間・多良間・海路は不可', s.civ.shinIshigaki === 10 && s.civ.miyako === 7 && s.civ.shimoji === 0 && s.civ.yonaguni === 0 && s.civ.hateruma === 0 && s.civ.tarama === 0 && s.seaHours === 0 && !s.heliOk, JSON.stringify(s.civ));
}
{
  const s = computeDaySlots(base({ closures: [{ key: 'air:shinIshigaki', from: 19, to: 24 }] }));
  ok('19時から新石垣閉鎖: それまでに10便出発済み', s.civ.shinIshigaki === 10);
  const s2 = computeDaySlots(base({ closures: [{ key: 'air:shinIshigaki', from: 11, to: 24 }] }));
  ok('11時から新石垣閉鎖: 8〜10時の3便のみ', s2.civ.shinIshigaki === 3, String(s2.civ.shinIshigaki));
  const s3 = computeDaySlots(base({ closures: [{ key: 'air:shinIshigaki', from: 9, to: 12 }] }));
  ok('錯綜 9〜12時: 8時＋13〜20時＝9便', s3.civ.shinIshigaki === 9, String(s3.civ.shinIshigaki));
  ok('1時時点で出発済み0便 / 9時時点で1便', civFlightsBefore(base({}), 'miyako', 1) === 0 && civFlightsBefore(base({}), 'miyako', 9) === 1);
}
{
  const s = computeDaySlots(base({ h24: true, flightLimit: { shinIshigaki: 13, miyako: 10, shimoji: 5, yonaguni: 3 }, prepLevel: 6 }));
  ok('Lv6(24h): 13/10/5/3', s.civ.shinIshigaki === 13 && s.civ.miyako === 10 && s.civ.shimoji === 5 && s.civ.yonaguni === 3);
  const c = computeDaySlots(base({ phase: 'crisis', prepLevel: 1, crisisEvacOk: false }));
  ok('存立危機Lv1: 与那国空港1便のみ・石垣行きフェリー不可・鳩間/船浮の島内移動は可', c.civ.yonaguni === 1 && c.civ.shinIshigaki === 0 && c.tport.ohara === 0 && c.mainFerry.kubura === 0 && c.tport.hatoma === 1 && c.tport.funauki === 1, JSON.stringify(c));
  const f = computeDaySlots(base({ freezeUntil: 12 }));
  ok('地震 行動停止12時間: 新石垣8便・行動12時間', f.civ.shinIshigaki === 8 && f.actionHours === 12);
}

// ---- 強制イベントを使ったエンジン検査 ----
const run = (cfg: { prepLevel: number; shelterLevel: number; month: number; forcedEvents: ForcedEvent[] }, untilDay: number) => {
  let s: GameState = createInitialState(cfg); const logs: ReturnType<typeof executeDayPhase2>['log'][] = []; const p1s: ReturnType<typeof prepareDayPhase1>[] = [];
  while (s.day <= untilDay && !s.isComplete) { const p = prepareDayPhase1(s); const r = executeDayPhase2(s, p, autoSelectOrders(p, 'balanced')); logs.push(r.log); p1s.push(p); s = r.newState; }
  return { s, logs, p1s, last: logs[logs.length - 1], lastP: p1s[p1s.length - 1] };
};
for (let i = 0; i < 20; i++) {
  const r = run({ prepLevel: 3, shelterLevel: 3, month: 4, forcedEvents: [ev(0, 1, 'C', '宮古空港 航空便に攻撃')] }, 0);
  const line = r.last.events.find(e => e.includes('|1時]') && e.includes('宮古空港 航空便に攻撃')) ?? '';
  if (i === 0) ok('X日1時の宮古空港 航空便攻撃 → セーフ（発生せず）', /セーフ/.test(line) && !r.s.transport.disabledAirRoutes.miyako, line);
  else if (!/セーフ|無効/.test(line) || r.s.transport.disabledAirRoutes.miyako) { ok('1時の撃墜は常に不成立', false, line); break; }
}
{
  // 19時のサイバー攻撃は、それまでに出た便を取り消さない: 当日の閉鎖記録(closures)を「19時以降だけ」にした時刻表と一致すること
  let checked = false;
  for (let i = 0; i < 600 && !checked; i++) {
    const r = run({ prepLevel: 1, shelterLevel: 1, month: 4, forcedEvents: [ev(0, 19, 'A', '新石垣空港 サイバー攻撃')] }, 0);
    if (!r.last.events.some(e => e.includes('|19時]') && /サイバー攻撃/.test(e)) || !r.last.events.some(e => /新石垣空港 は同日24時まで使用不可能/.test(e))) continue;
    const others = r.last.events.filter(e => /新石垣空港/.test(e) && !e.includes('|19時]') && /\[イベント/.test(e)).length;
    const wxOk = !/新石垣/.test(r.last.halfDay.am.summary.split('閉鎖')[1] ?? '') && !/新石垣/.test(r.last.halfDay.pm.summary.split('閉鎖')[1] ?? '');
    if (others > 0 || !wxOk || r.s.infra.shinIshigakiAirport === false || r.s.transport.disabledAirRoutes.shinIshigaki) continue;
    ok('19時のサイバー攻撃が発生しても、当日の新石垣は10便（8〜17時に出発済み）', r.lastP.slots!.civ.shinIshigaki === 10, String(r.lastP.slots!.civ.shinIshigaki));
    checked = true;
  }
  ok('19時サイバー攻撃の検査を実施できた', checked);
}
{
  const r = run({ prepLevel: 3, shelterLevel: 3, month: 4, forcedEvents: [{ kind: 'earthquake', day: 0, level: 2 }] }, 0);
  ok('強制地震 規模2: 発生・全海港破壊・行動停止6時間', r.s.earthquakeLevel === 2 && r.s.infra.ishigakiPort === false && r.lastP.slots!.actionHours === 18, JSON.stringify({ lv: r.s.earthquakeLevel, port: r.s.infra.ishigakiPort, h: r.lastP.slots!.actionHours }));
}
{
  const r = run({ prepLevel: 4, shelterLevel: 3, month: 4, forcedEvents: [ev(-3, 10, 'A', '集落市街でパニック'), ev(-3, 23, 'D', '尖閣諸島占領')] }, -3);
  ok('強制イベント2件が指定時刻にログへ出る', r.last.events.some(e => e.includes('|10時]')) && r.last.events.some(e => e.includes('|23時]')));
  ok('毎時24回のイベント判定', r.last.hourlyRolls.length === 24 && r.last.hourlyRolls.every(h => h.isEventSpace));
}
{
  // 当日の地震（規模3）で破壊された波照間・多良間空港は、応急復旧まで空自輸送機も使えない
  let r = run({ prepLevel: 4, shelterLevel: 3, month: 4, forcedEvents: [{ kind: 'earthquake', day: 0, level: 3 }] }, 0);
  ok('地震 規模3の当日: 波照間・多良間空港から空自輸送機は出せない', r.lastP.capacities.jasdfFrom.taketomi === 0 && r.lastP.capacities.jasdfTarama === 0, JSON.stringify([r.lastP.capacities.jasdfFrom.taketomi, r.lastP.capacities.jasdfTarama]));
  // 陸自ヘリは1日1便・1コマ
  let heliMax = 0;
  for (let i = 0; i < 60; i++) { r = run({ prepLevel: 5, shelterLevel: 2, month: 4, forcedEvents: [ev(0, 3, 'C', '新石垣空港 航空便運航拒否')] }, 4); for (const p of r.p1s) heliMax = Math.max(heliMax, p.capacities.shuttleJgsdfMax); }
  ok('陸自ヘリの当日容量は最大1コマ', heliMax <= 1, String(heliMax));
  // 0.5コマ単位でない・負数の手動注文は無効
  const s0 = createInitialState({ prepLevel: 3, shelterLevel: 3, month: 4, forcedEvents: [] });
  let st: GameState = s0; let pp = prepareDayPhase1(st);
  while (pp.newPhase !== 'wartime') { st = executeDayPhase2(st, pp, []).newState; pp = prepareDayPhase1(st); }
  const before = pp.stateAfterEvents.areas.ishigaki;
  const res = executeDayPhase2(st, pp, [
    { from: 'ishigaki', to: 'mainland', method: '新石垣空港(民間)', residents: 0.5000001, tourists: 0, vulnerable: 0 },
    { from: 'ishigaki', to: 'mainland', method: '新石垣空港(民間)', residents: 2, tourists: -1, vulnerable: 0 },
    { from: 'ishigaki', to: 'mainland', method: '新石垣空港(民間)', residents: 0.25, tourists: 0, vulnerable: 0 },
  ]);
  const after = res.newState.areas.ishigaki;
  ok('不正なコマ数（0.5000001・負数・0.25）の注文は無効', res.log.evacuations.filter(e => e.method === '新石垣空港(民間)').length === 0 && after.tourists === before.tourists, JSON.stringify(res.log.evacuations));
}
console.log(fail ? `\n${fail} 件 NG` : '\n全て ok');
process.exit(fail ? 1 : 0);
