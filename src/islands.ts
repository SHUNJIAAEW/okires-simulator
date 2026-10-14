// islands.ts — エリア(与那国/竹富/石垣/宮古)のコマを島別に按分する共通モジュール
// 地図（IllustratedMap）と日報PDFの「孤立島・集落 残存表」で同じ計算を使う。
// エンジンはエリア単位のため、鳩間島・船浮（isolatedPendingBy の実数）以外は人口比による按分の参考値。

import type { AreaId, AreaState } from './types';

export type SubBlob = { cx: number; cy: number; rx: number; ry: number };
export type SubIsland = { key: string; name: string; blob: SubBlob; weight: number; tourist?: number; isolated?: boolean };

// 鳩間島・船浮は isolatedPendingBy の実数を描く（按分しない・最低1コマ保証も適用しない）
export const ISOLATED_KEYS = ['hatoma', 'funauki'] as const;
export type IsolatedKey = (typeof ISOLATED_KEYS)[number];

// エリア内の個別島ごとのコマ配置領域（svg座標・楕円範囲）＋按分ウェイト
// 比率は SimulationMap のボード盤（公式マップ）由来:
//  竹富町＝西表6/竹富2/波照間3/黒島2/小浜2(計15)、宮古は人口比で多良間・伊良部等にも配置
// tourist: 観光客の配置ウェイト（ver4.0: 西表1・竹富1・石垣5・宮古島5 のみ。波照間・与那国・その他小島には置かない）
export const SUB_ISLANDS: Record<AreaId, SubIsland[]> = {
  yonaguni: [
    { key: 'yonaguni', name: '与那国島', blob: { cx: 36, cy: 104, rx: 14, ry: 8 }, weight: 1 }, // 観光客なし
  ],
  taketomi: [
    { key: 'iriomote', name: '西表島', blob: { cx: 86, cy: 131, rx: 18, ry: 10 }, weight: 6, tourist: 1 }, // 観光最大1
    { key: 'taketomi', name: '竹富島', blob: { cx: 124, cy: 124, rx: 4, ry: 3 }, weight: 2, tourist: 1 },  // 観光最大1
    { key: 'hateruma', name: '波照間島', blob: { cx: 100, cy: 159, rx: 5, ry: 4 }, weight: 3 },
    { key: 'kuroshima', name: '黒島', blob: { cx: 134, cy: 144, rx: 5, ry: 4 }, weight: 2 },
    { key: 'kohama', name: '小浜島', blob: { cx: 114, cy: 106, rx: 4, ry: 3 }, weight: 2 },
    // 鳩間島・船浮: 孤立集落（AreaState.isolatedPendingBy の実数を表示）。weight は按分に使わない
    { key: 'hatoma', name: '鳩間島', blob: { cx: 79, cy: 102, rx: 4, ry: 3 }, weight: 1, isolated: true },
    { key: 'funauki', name: '船浮', blob: { cx: 65, cy: 128, rx: 3, ry: 2.5 }, weight: 1, isolated: true },
  ],
  ishigaki: [
    { key: 'ishigaki', name: '石垣島', blob: { cx: 154, cy: 92, rx: 23, ry: 14 }, weight: 1, tourist: 1 }, // 観光最大5
  ],
  miyako: [
    { key: 'miyako', name: '宮古島', blob: { cx: 246, cy: 95, rx: 18, ry: 11 }, weight: 85, tourist: 1 }, // 観光最大5
    { key: 'irabu', name: '伊良部島', blob: { cx: 216, cy: 94, rx: 6, ry: 4 }, weight: 6 },
    { key: 'shimoji', name: '下地島', blob: { cx: 203, cy: 96, rx: 4, ry: 3 }, weight: 1 },
    // 多良間島: 初期配置（住民54・要援護者込み）で1コマになるよう weight 2（3だと2コマになる）
    { key: 'tarama', name: '多良間島', blob: { cx: 200, cy: 151, rx: 7, ry: 4 }, weight: 2 },
    { key: 'ikema', name: '池間島', blob: { cx: 240, cy: 65, rx: 4, ry: 3 }, weight: 1 },
    { key: 'kurima', name: '来間島', blob: { cx: 236, cy: 119, rx: 4, ry: 3 }, weight: 1 },
  ],
};

// 整数 total を weights で按分（最大剰余法）。総数を保ったまま各島へ配分する。
export function apportion(total: number, weights: number[]): number[] {
  // 負の weight は 0 に丸めて防御（負の配分を返さない）
  const w = weights.map(x => Math.max(0, x));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return w.map(() => 0);
  const raw = w.map(x => (total * x) / sum);
  const base = raw.map(Math.floor);
  let rem = total - base.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; rem > 0 && order.length > 0; k++, rem--) base[order[k % order.length].i]++;
  return base;
}

export interface SubCounts { res: number; tou: number; vul: number; stg: number; half?: number } // half: 住民の 0.5コマ端数の個数（半コマとして描く）

// 小数（死亡0.5コマ等）や負値で Array() が落ちないよう整数化
const ci = (x: number) => Math.max(0, Math.round(x));

// エリアのコマを SUB_ISLANDS の各島へ按分する（地図と日報で共通）。
// - 鳩間島・船浮(isolated) は isolatedPendingBy の実数（住民扱い）。按分ウェイトから除外し、最低1コマ保証も適用しない
// - それ以外は residents/tourists/vulnerable/staging を weight（観光客は tourist）で按分
// - 描画された各島が空にならないよう、weight>0 の島へ最低1コマを保証（住民を最多の島から1つ移して総数は保持）
export function apportionArea(a: AreaState, subs: SubIsland[]): SubCounts[] {
  const w = subs.map(s => (s.isolated ? 0 : s.weight));
  const tw = subs.map(s => (s.isolated ? 0 : (s.tourist ?? 0)));
  // 住民の 0.5コマ端数（船浮→西表 0.5コマ移送後など）は四捨五入せず、最大ウェイトの島（西表島等）へ半コマとして置く
  const resInt = Math.floor(Math.max(0, a.residents) + 1e-9);
  const resHalf = Math.max(0, a.residents) - resInt > 1e-9 ? 1 : 0;
  const res = apportion(resInt, w);
  const half = subs.map(() => 0);
  if (resHalf) {
    let best = -1;
    w.forEach((x, i) => { if (x > 0 && (best === -1 || x > w[best])) best = i; });
    if (best !== -1) half[best] = 1;
  }
  const tou = apportion(ci(a.tourists), tw.some(x => x > 0) ? tw : w);
  const vul = apportion(ci(a.vulnerable), w);
  const stg = apportion(ci(a.stagingPort + (a.stagingVulnerable ?? 0)), w);
  const by = a.isolatedPendingBy;
  subs.forEach((s, i) => {
    if (!s.isolated) return;
    // 実数（0.5刻み）を保持: 整数部は通常コマ、0.5端数は半コマとして別枠（四捨五入で 0.5→1 に増やさない）
    const n = Math.max(0, by ? (by[s.key as IsolatedKey] ?? 0) : 0);
    res[i] = Math.floor(n + 1e-9); half[i] = n - res[i] > 1e-9 ? 1 : 0; tou[i] = 0; vul[i] = 0; stg[i] = 0;
  });
  const totalOf = (i: number) => res[i] + tou[i] + vul[i] + stg[i] + half[i];
  subs.forEach((s, i) => {
    if (s.isolated || w[i] <= 0 || totalOf(i) !== 0) return;
    let donor = -1;
    for (let j = 0; j < subs.length; j++) {
      if (subs[j].isolated) continue;
      if (res[j] > (donor === -1 ? 1 : res[donor])) donor = j;
    }
    if (donor !== -1 && res[donor] > 1) { res[donor]--; res[i]++; }
  });
  return subs.map((_s, i) => ({ res: res[i], tou: tou[i], vul: vul[i], stg: stg[i], half: half[i] }));
}

// 日報「孤立島・集落 残存表」の列（表示順）。irabuShimoji は伊良部島＋下地島の合算
export const ISLAND_COLUMNS: { key: string; label: string; area: AreaId; subKeys: string[] }[] = [
  { key: 'hatoma', label: '鳩間', area: 'taketomi', subKeys: ['hatoma'] },
  { key: 'funauki', label: '船浮', area: 'taketomi', subKeys: ['funauki'] },
  { key: 'kohama', label: '小浜', area: 'taketomi', subKeys: ['kohama'] },
  { key: 'taketomi', label: '竹富', area: 'taketomi', subKeys: ['taketomi'] },
  { key: 'kuroshima', label: '黒島', area: 'taketomi', subKeys: ['kuroshima'] },
  { key: 'hateruma', label: '波照間', area: 'taketomi', subKeys: ['hateruma'] },
  { key: 'tarama', label: '多良間', area: 'miyako', subKeys: ['tarama'] },
  { key: 'ikema', label: '池間', area: 'miyako', subKeys: ['ikema'] },
  { key: 'kurima', label: '来間', area: 'miyako', subKeys: ['kurima'] },
  { key: 'irabuShimoji', label: '伊良部/下地', area: 'miyako', subKeys: ['irabu', 'shimoji'] },
];

// 日末の島別残存コマ（ISLAND_COLUMNS.key → コマ数）。鳩間・船浮は isolatedPendingBy の実数（0.5刻みを保持）、他は按分の参考値
export function islandSnapshot(areas: Record<AreaId, AreaState>): Record<string, number> {
  const out: Record<string, number> = {};
  const cache: Partial<Record<AreaId, SubCounts[]>> = {};
  for (const col of ISLAND_COLUMNS) {
    const a = areas[col.area];
    const subs = SUB_ISLANDS[col.area];
    let n = 0;
    for (const k of col.subKeys) {
      const i = subs.findIndex(s => s.key === k);
      if (i < 0) continue;
      if (subs[i].isolated) {
        n += Math.max(0, a.isolatedPendingBy?.[k as IsolatedKey] ?? 0);
      } else {
        const c = (cache[col.area] ??= apportionArea(a, subs))[i];
        n += c.res + c.tou + c.vul + c.stg + (c.half ?? 0) * 0.5;
      }
    }
    out[col.key] = n;
  }
  return out;
}
