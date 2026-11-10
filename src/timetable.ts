// timetable.ts — 便の時刻表（マニュアル ver4.0 2.2 図2 / 4.3 / 4.6）
// 1日の輸送量を「何時の便が出せたか」で数える。午前(1〜12時)は1時の天候、午後(13〜24時)は13時の天候で判定し、
// イベントによる使用不能は「発生時刻から」効く（それより前に出た便は出発済み）。
//
//  民間航空（有事）: 新石垣・宮古 = 8〜20時に毎時1便（1日の上限便数あり）/ 下地島 = 8・12・16時 / 与那国 = 8・16時
//                    波照間(Lv4以上) = 9時 / 多良間 = 15時。Lv6（24時間運用）は主要4空港のみ時刻を問わない。
//  フェリー: 午前便 9〜11時 / 午後便 14〜16時。1日2便の港は午前1便・午後1便、1日1便の港は午前か午後のどちらか。
//  海保輸送船・海自輸送艦・空自輸送機: 24時間いつでも（大雨・強風時を除く）。
//  陸自ヘリ: 大雨・強風時（風向に関係なく）は不可。

import type { AirRouteKey, InfraState, Phase, ShipRouteKey, TaketomiPortKey, WeatherState } from './types';
import { AIRPORT_ALLOWED_WIND_DIRECTIONS, isStrongWind, TAKETOMI_PORT_CAPACITY } from './constants';

export type AirKey = AirRouteKey | 'tarama';

// 時刻つきの使用不能（from〜to 時。両端含む）。
//  air:<空港>      空港そのものが使用不能（サイバー/大乱闘/障害物/錯綜/当日の破壊）＝民間も空自も不可
//  airdep:<空港>   出発のみ不可（ボイコット）。着陸は可
//  civ:<空港>      民間航空便だけ以後使用不能（撃墜・運航拒否）
//  port:<港>       港そのものが使用不能（機雷/海上民兵/臨検/サイバー/大乱闘/錯綜/当日の破壊）＝出入港とも不可
//  portdep:<港>    出港のみ不可（ボイコット）。入港は可
//  civship:<港>    民間船舶便だけ以後使用不能（撃沈・運航拒否）
//  tport:<離島港>  竹富町離島港が使用不能 / tportstop:<離島港> 民間船舶便だけ以後使用不能
//  taramaport      多良間港が使用不能 / taramaportdep 出港のみ不可
export interface TimedClosure { key: string; from: number; to: number }

export const AM_FERRY_HOURS = [9, 10, 11];
export const PM_FERRY_HOURS = [14, 15, 16];
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const ALL_HOURS = range(1, 24);
const AIR_SCHEDULE: Record<AirKey, number[]> = {
  shinIshigaki: range(8, 20), miyako: range(8, 20),
  shimoji: [8, 12, 16], yonaguni: [8, 16], hateruma: [9], tarama: [15],
};
const MAIN_AIRPORTS: AirKey[] = ['shinIshigaki', 'miyako', 'shimoji', 'yonaguni'];
const AIR_INFRA: Record<AirKey, keyof InfraState> = {
  shinIshigaki: 'shinIshigakiAirport', miyako: 'miyakoAirport', shimoji: 'shimojiAirport',
  yonaguni: 'yonagunAirport', hateruma: 'haterumaAirport', tarama: 'taramaAirport',
};

export interface SlotInput {
  am: WeatherState;            // 1時の天候（1〜12時に適用）
  pm: WeatherState;            // 13時の天候（13〜24時に適用）
  month: number;
  phase: Phase;
  prepLevel: number;
  infraStart: InfraState;      // 当日1時時点の施設（前日までの破壊＋当日の地震。当日イベントの破壊は closures で渡す）
  flightLimit: Record<'shinIshigaki' | 'miyako' | 'shimoji' | 'yonaguni', number>; // 1日の上限便数（有事/24h）
  h24: boolean;                // 24時間運用（Lv6）
  crisisEvacOk: boolean;       // 存立危機で石垣港・新石垣空港へ入れるか（Lv2以上）
  civAirStopped: Partial<Record<AirRouteKey, boolean>>;   // 前日までの民間航空 路線停止
  civShipStopped: Partial<Record<ShipRouteKey, boolean>>; // 前日までの民間船舶 路線停止
  tportStopped: Partial<Record<TaketomiPortKey, boolean>>;
  closures: TimedClosure[];    // 当日のイベントによる使用不能
  freezeUntil: number;         // 地震の行動停止（この時刻まで行動不可。0=なし）
}

export interface DaySlots {
  civ: Record<AirKey, number>;            // 当日出せる民間航空の便数（上限便数と時刻表・天候・イベントを反映）
  airfield: Record<AirKey, boolean>;      // 空自輸送機が離着陸できる時間帯が1時間でもあるか
  seaHours: number;                       // 海が開いていて行動できる時間数（海保・海自の便数上限）
  mainFerry: Record<ShipRouteKey, number>; // 石垣港・平良港（本土便）/ 久部良港（→石垣）の便数 0 or 1
  tport: Record<TaketomiPortKey, number>; // 竹富町離島港の便数（0〜2）
  taramaSea: number;                      // 多良間港→平良港フェリー 0 or 1
  heliOk: boolean;                        // 陸自ヘリが飛べる時間帯があるか
  actionHours: number;                    // 行動できる時間数（24 − 地震の行動停止）
  // --- 時刻の一覧（同じ日のうちの「乗り継ぎ」や2島間往復の両端の時刻合わせに使う）---
  civHours: Record<AirKey, number[]>;     // 民間便を出せる時刻（時刻表のうち開いている時刻。上限便数で切る前）
  airfieldHours: Record<AirKey, number[]>; // 空自輸送機が離着陸できる時刻
  seaOpenHours: number[];                 // 海が開いていて行動できる時刻
  portHours: Record<'ishigakiPort' | 'hiraraPort', number[]>; // 石垣港・平良港に出入りできる時刻（海保・海自の2島間往復用）
  mainDep: Record<ShipRouteKey, { am: number | null; pm: number | null }>;      // 石垣港・平良港・久部良港フェリーの出発時刻
  tportDep: Record<TaketomiPortKey, { am: number | null; pm: number | null }>; // 竹富町離島港フェリーの出発時刻
}

function inClosure(closures: TimedClosure[], key: string, h: number): boolean {
  return closures.some(c => c.key === key && h >= c.from && h <= c.to);
}
const wxOf = (inp: SlotInput, h: number) => (h <= 12 ? inp.am : inp.pm);

// 空港が天候で使えるか（大雨=全空港不可 / 強風=滑走路方向の風向以外は不可。波照間・多良間は海港と同じ＝強風なら常に不可）
export function airWeatherOk(w: WeatherState, month: number, key: AirKey): boolean {
  if (w.condition === 'heavy-rain') return false;
  if (!isStrongWind(w.windSpeedIndex, month)) return true;
  return (AIRPORT_ALLOWED_WIND_DIRECTIONS[key] ?? []).includes(w.windDirectionIndex);
}
export function seaWeatherOk(w: WeatherState, month: number): boolean {
  return w.condition !== 'heavy-rain' && !isStrongWind(w.windSpeedIndex, month);
}

// 空港の滑走路が h 時に使えるか（天候・イベント閉鎖・地震の行動停止）。施設破壊は呼び出し側で判定
function runwayOpen(inp: SlotInput, key: AirKey, h: number): boolean {
  if (h <= inp.freezeUntil) return false;
  if (!airWeatherOk(wxOf(inp, h), inp.month, key)) return false;
  return !inClosure(inp.closures, `air:${key}`, h);
}
// 民間航空便が h 時に出発できるか
export function civFlightOpen(inp: SlotInput, key: AirKey, h: number): boolean {
  if (inp.infraStart[AIR_INFRA[key]] === false) return false;                 // 破壊済み（民間は復旧不可）
  if (key !== 'tarama' && inp.civAirStopped[key]) return false;               // 撃墜・運航拒否で路線停止
  if (!runwayOpen(inp, key, h)) return false;
  if (inClosure(inp.closures, `airdep:${key}`, h) || inClosure(inp.closures, `civ:${key}`, h)) return false;
  // 波照間→新石垣・多良間→宮古は着く側の空港も使えること（マニュアル4.6.1）
  const arr: AirKey | null = key === 'hateruma' ? 'shinIshigaki' : key === 'tarama' ? 'miyako' : null;
  if (arr) {
    if (inp.infraStart[AIR_INFRA[arr]] === false || inp.civAirStopped[arr as AirRouteKey]) return false;
    if (!runwayOpen(inp, arr, h) || inClosure(inp.closures, `civ:${arr}`, h)) return false;
  }
  return true;
}
// その空港の民間便の時刻表（当日のモードで出せる時刻）と上限便数
export function civSchedule(inp: SlotInput, key: AirKey): { hours: number[]; limit: number } {
  const wartime = inp.phase === 'wartime';
  const crisis = inp.phase === 'crisis';
  if (key === 'hateruma') {
    const ok = inp.prepLevel >= 4 && (wartime || (crisis && inp.crisisEvacOk));
    return { hours: ok ? AIR_SCHEDULE.hateruma : [], limit: 1 };
  }
  if (key === 'tarama') return { hours: wartime ? AIR_SCHEDULE.tarama : [], limit: 1 };
  if (key === 'yonaguni') {
    // 存立危機事態は1日1便（Lvを問わない）。有事は便数表
    if (crisis) return { hours: AIR_SCHEDULE.yonaguni, limit: 1 };
    if (!wartime) return { hours: [], limit: 0 };
    return { hours: inp.h24 ? ALL_HOURS : AIR_SCHEDULE.yonaguni, limit: inp.flightLimit.yonaguni };
  }
  if (!wartime) return { hours: [], limit: 0 };
  return { hours: inp.h24 && MAIN_AIRPORTS.includes(key) ? ALL_HOURS : AIR_SCHEDULE[key], limit: inp.flightLimit[key] };
}
// h 時より前（または全日）に出発できた民間便の数
export function civFlightsBefore(inp: SlotInput, key: AirKey, beforeHour = 25): number {
  const { hours, limit } = civSchedule(inp, key);
  return Math.min(limit, hours.filter(h => h < beforeHour && civFlightOpen(inp, key, h)).length);
}

// 空自輸送機が h 時に離着陸できるか（破壊済み空港は応急復旧後＝翌日以降は可。当日の破壊は closures の air: で不可）
export function airfieldOpen(inp: SlotInput, key: AirKey, h: number): boolean {
  return runwayOpen(inp, key, h);
}

function seaOpen(inp: SlotInput, h: number): boolean {
  return h > inp.freezeUntil && seaWeatherOk(wxOf(inp, h), inp.month);
}
type PortRef = { kind: 'main'; key: ShipRouteKey } | { kind: 'tport'; key: TaketomiPortKey } | { kind: 'tarama' };
// 民間フェリーが h 時にその港を出られるか
function ferryDepOpen(inp: SlotInput, p: PortRef, h: number): boolean {
  if (!seaOpen(inp, h)) return false;
  if (p.kind === 'main') {
    const infraKey: keyof InfraState = p.key === 'ishigakiPort' ? 'ishigakiPort' : p.key === 'hiraraPort' ? 'hiraraPort' : 'kuburaPort';
    if (inp.infraStart[infraKey] === false || inp.civShipStopped[p.key]) return false;
    return !inClosure(inp.closures, `port:${p.key}`, h) && !inClosure(inp.closures, `portdep:${p.key}`, h) && !inClosure(inp.closures, `civship:${p.key}`, h);
  }
  if (inp.infraStart.seaAllAvailable === false) return false; // 地震で離島港が全破壊
  if (p.kind === 'tport') {
    if (inp.tportStopped[p.key]) return false;
    return !inClosure(inp.closures, `tport:${p.key}`, h) && !inClosure(inp.closures, `tportstop:${p.key}`, h);
  }
  return !inClosure(inp.closures, 'taramaport', h) && !inClosure(inp.closures, 'taramaportdep', h);
}
// 着く側の港（石垣港/平良港）に h 時に入れるか（ボイコット＝出港のみ不可 は入港可）
function portArrOpen(inp: SlotInput, key: 'ishigakiPort' | 'hiraraPort', h: number): boolean {
  return inp.infraStart[key] !== false && !inClosure(inp.closures, `port:${key}`, h);
}
// フェリーの出発時刻（午前便・午後便それぞれ最初に出せる時刻。出せなければ null）
export function ferryDepartures(inp: SlotInput, p: PortRef, arrive?: 'ishigakiPort' | 'hiraraPort'): { am: number | null; pm: number | null } {
  const first = (hs: number[]) => hs.find(h => ferryDepOpen(inp, p, h) && (!arrive || portArrOpen(inp, arrive, h))) ?? null;
  return { am: first(AM_FERRY_HOURS), pm: first(PM_FERRY_HOURS) };
}
// 1日の便数（tripsPerDay=1 なら午前か午後のどちらか1便、2なら午前1便＋午後1便）
function ferryTrips(dep: { am: number | null; pm: number | null }, tripsPerDay: number): number {
  const n = (dep.am !== null ? 1 : 0) + (dep.pm !== null ? 1 : 0);
  return Math.min(tripsPerDay, n);
}
// 竹富町離島港の1日便数（マニュアル図15: 大原・上原・小浜・竹富=2便、その他=1便）
export const TPORT_TRIPS_PER_DAY: Record<TaketomiPortKey, number> = {
  ohara: 2, uehara: 2, kohama: 2, taketomi: 2, kuroshima: 1, hateruma: 1, hatoma: 1, funauki: 1,
};
// 1便あたりのコマ数（＝港の1日容量 ÷ 1日便数）
export const tportKomaPerTrip = (k: TaketomiPortKey) => TAKETOMI_PORT_CAPACITY[k] / TPORT_TRIPS_PER_DAY[k];

export function computeDaySlots(inp: SlotInput): DaySlots {
  const wartime = inp.phase === 'wartime';
  const crisis = inp.phase === 'crisis';
  const civ = {} as Record<AirKey, number>;
  const airfield = {} as Record<AirKey, boolean>;
  const civHours = {} as Record<AirKey, number[]>;
  const airfieldHours = {} as Record<AirKey, number[]>;
  for (const k of Object.keys(AIR_SCHEDULE) as AirKey[]) {
    civ[k] = civFlightsBefore(inp, k);
    civHours[k] = civSchedule(inp, k).hours.filter(h => civFlightOpen(inp, k, h));
    airfieldHours[k] = ALL_HOURS.filter(h => airfieldOpen(inp, k, h));
    airfield[k] = airfieldHours[k].length > 0;
  }
  const seaOpenHours = ALL_HOURS.filter(h => seaOpen(inp, h));
  const seaHours = seaOpenHours.length;
  const portHours = {
    ishigakiPort: seaOpenHours.filter(h => portArrOpen(inp, 'ishigakiPort', h)),
    hiraraPort: seaOpenHours.filter(h => portArrOpen(inp, 'hiraraPort', h)),
  };
  // 石垣港へ入るフェリー（竹富町・与那国発）は、存立危機ではLv2以上のみ
  const toIshigakiOk = wartime || (crisis && inp.crisisEvacOk);
  const NONE = { am: null, pm: null };
  const mainDep: Record<ShipRouteKey, { am: number | null; pm: number | null }> = {
    ishigakiPort: wartime ? ferryDepartures(inp, { kind: 'main', key: 'ishigakiPort' }) : NONE,
    hiraraPort: wartime ? ferryDepartures(inp, { kind: 'main', key: 'hiraraPort' }) : NONE,
    kubura: toIshigakiOk ? ferryDepartures(inp, { kind: 'main', key: 'kubura' }, 'ishigakiPort') : NONE,
  };
  const mainFerry: Record<ShipRouteKey, number> = {
    ishigakiPort: ferryTrips(mainDep.ishigakiPort, 1), hiraraPort: ferryTrips(mainDep.hiraraPort, 1), kubura: ferryTrips(mainDep.kubura, 1),
  };
  const tport = {} as Record<TaketomiPortKey, number>;
  const tportDep = {} as Record<TaketomiPortKey, { am: number | null; pm: number | null }>;
  for (const k of Object.keys(TPORT_TRIPS_PER_DAY) as TaketomiPortKey[]) {
    // 鳩間港→上原港・船浮港→白浜港は西表島内の移動（存立危機なら Lv を問わず可）。それ以外は石垣港行き
    const internal = k === 'hatoma' || k === 'funauki';
    const allowed = wartime || (crisis && (internal || inp.crisisEvacOk));
    tportDep[k] = allowed ? ferryDepartures(inp, { kind: 'tport', key: k }, internal ? undefined : 'ishigakiPort') : NONE;
    tport[k] = ferryTrips(tportDep[k], TPORT_TRIPS_PER_DAY[k]);
  }
  const taramaSea = wartime ? ferryTrips(ferryDepartures(inp, { kind: 'tarama' }, 'hiraraPort'), 1) : 0;
  const heliOk = ALL_HOURS.some(h => seaOpen(inp, h)); // 陸自ヘリの天候条件は海港と同じ（大雨・強風は不可）
  return {
    civ, airfield, seaHours, mainFerry, tport, taramaSea, heliOk, actionHours: Math.max(0, 24 - Math.min(24, inp.freezeUntil)),
    civHours, airfieldHours, seaOpenHours, portHours, mainDep, tportDep,
  };
}
