// facilities.ts — 空港・海港の使用可否マークの共通判定
// 地図（IllustratedMap の施設アイコン）と日報PDFの「主要インフラ状況表」で同じロジックを使う。
//
// 優先順位: 💥 恒久使用不能（破壊/撃墜・撃沈/運航拒否） > ❌ 事前準備Lv不足で使用不可 > 🚫 当日限り使用不能（乱闘/サイバー/障害物散布/海上民兵等）
//           > ⛈️ 大雨 / 💨 強風（悪天候）。無事なら null。

import type { InfraState, TransportState, AirRouteKey, ShipRouteKey } from './types';

export type FacilityMark = '💥' | '❌' | '🚫' | '⛈️' | '💨';

export interface FacilityDef {
  key: string;            // 日報の列キー
  name: string;           // 表示名
  kind: 'air' | 'sea';
  air?: AirRouteKey;      // 空路キー（当日閉鎖 closedToday / 路線停止 disabledAirRoutes / 悪天候 weatherClosed の参照キー）
  ship?: ShipRouteKey;    // 海路キー（'ship:'+key で当日閉鎖、disabledShipRoutes で路線停止）
  wxKey?: string;         // 悪天候キー（省略時: sea→'sea' / air→air キー）。多良間空港は 'tarama'
  infra?: keyof InfraState; // 施設破壊フラグ
  minPrepLevel?: number;  // この Lv 未満は ❌（波照間空港=4）
}

export interface FacilityContext {
  infra?: InfraState;
  transport?: TransportState;
  closedToday?: string[];   // 当日限りの使用不能施設（空港=空路キー / 港='ship:'+海路キー）
  weatherClosed?: string[]; // '施設キー:rain' / '施設キー:wind' / 'sea:rain' / 'sea:wind'
  prepLevel?: number;
}

// 日報「主要インフラ状況表」の列（表示順）
export const FACILITY_COLUMNS: FacilityDef[] = [
  { key: 'yonaguniAirport', name: '与那国空港', kind: 'air', air: 'yonaguni', infra: 'yonagunAirport' },
  { key: 'shinIshigakiAirport', name: '新石垣空港', kind: 'air', air: 'shinIshigaki', infra: 'shinIshigakiAirport' },
  { key: 'miyakoAirport', name: '宮古空港', kind: 'air', air: 'miyako', infra: 'miyakoAirport' },
  { key: 'shimojiAirport', name: '下地島空港', kind: 'air', air: 'shimoji', infra: 'shimojiAirport' },
  { key: 'haterumaAirport', name: '波照間空港', kind: 'air', air: 'hateruma', infra: 'haterumaAirport', minPrepLevel: 4 },
  { key: 'taramaAirport', name: '多良間空港', kind: 'air', wxKey: 'tarama', infra: 'taramaAirport' },
  { key: 'kuburaPort', name: '久部良港', kind: 'sea', ship: 'kubura', infra: 'kuburaPort' },
  { key: 'ishigakiPort', name: '石垣港', kind: 'sea', ship: 'ishigakiPort', infra: 'ishigakiPort' },
  { key: 'hiraraPort', name: '平良港', kind: 'sea', ship: 'hiraraPort', infra: 'hiraraPort' },
  // 海路全体: 地震で離島港が全破壊(seaAllAvailable=false)なら 💥、大雨/強風で全海港停止なら ⛈️/💨
  { key: 'seaAll', name: '海路全体', kind: 'sea', infra: 'seaAllAvailable' },
];

export function facilityMark(f: FacilityDef, ctx: FacilityContext): FacilityMark | null {
  const { infra, transport, closedToday = [], weatherClosed = [], prepLevel = 6 } = ctx;
  const destroyed = !!(f.infra && infra && infra[f.infra] === false);
  const routeDown = !!((f.air && transport?.disabledAirRoutes?.[f.air]) || (f.ship && transport?.disabledShipRoutes?.[f.ship]));
  if (destroyed || routeDown) return '💥';
  if (f.minPrepLevel !== undefined && prepLevel < f.minPrepLevel) return '❌'; // 事前準備Lv不足で使用不可（破壊ではない）
  if ((f.air && closedToday.includes(f.air)) || (f.ship && closedToday.includes(`ship:${f.ship}`))) return '🚫';
  // 悪天候（大雨=全空港・全海港 / 強風=風向次第で空港、海港は全停止）
  const wxKey = f.wxKey ?? (f.kind === 'sea' ? 'sea' : f.air);
  if (wxKey) {
    if (weatherClosed.includes(`${wxKey}:rain`)) return '⛈️';
    if (weatherClosed.includes(`${wxKey}:wind`)) return '💨';
  }
  return null;
}

// 日報用: 午前/午後の悪天候リストが異なれば「午前⛈️/午後○」のように併記。同じなら単一マーク。無事は '○'
export function facilityStatusCell(f: FacilityDef, ctx: FacilityContext, weatherClosedAm?: string[]): string {
  const pm = facilityMark(f, ctx);
  if (!weatherClosedAm) return pm ?? '○';
  const am = facilityMark(f, { ...ctx, weatherClosed: weatherClosedAm });
  if (am === pm) return pm ?? '○';
  return `午前${am ?? '○'}/午後${pm ?? '○'}`;
}

// 全施設列のマークをまとめて算出（DayLog.facilityStatus 用）
export function facilityStatusAll(ctx: FacilityContext, weatherClosedAm?: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of FACILITY_COLUMNS) out[f.key] = facilityStatusCell(f, ctx, weatherClosedAm);
  return out;
}
