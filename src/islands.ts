// islands.ts — エリア(与那国/竹富/石垣/宮古)のコマを島別に按分する共通モジュール
// 地図（IllustratedMap）と日報PDFの「孤立島・集落 残存表」で同じ計算を使う。
// エンジンはエリア単位のため、鳩間島・船浮・多良間島（isolatedPendingBy の実数）以外は人口比による按分の参考値。

import type { AreaId, AreaState } from './types';

export type SubBlob = { cx: number; cy: number; rx: number; ry: number };
export type SubIsland = { key: string; name: string; blob: SubBlob; weight: number; tourist?: number; isolated?: boolean; max?: number }; // max: 島に置くコマの上限（住民+要援護者+待機の合計。超過分は最大ウェイトの島へ）

// 鳩間島・船浮・多良間島は isolatedPendingBy の実数を描く（按分しない・最低1コマ保証も適用しない）
export const ISOLATED_KEYS = ['hatoma', 'funauki', 'tarama'] as const;
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
    { key: 'hateruma', name: '波照間島', blob: { cx: 100, cy: 159, rx: 5, ry: 4 }, weight: 3, max: 1 }, // 観光客なし。住民🔵+要援護者🔴 合計で最大1コマ
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
    // 多良間島: 孤立集落（isolatedPendingBy.tarama🔵 / taramaVuln🔴 の実数。初期1コマ）。weight は按分に使わない
    { key: 'tarama', name: '多良間島', blob: { cx: 200, cy: 151, rx: 7, ry: 4 }, weight: 2, isolated: true },
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

export type IsolatedBy = { hatoma: number; funauki: number; tarama: number; taramaVuln: number };
// 旧state互換: isolatedPendingBy が無く合計 isolatedPending だけある場合は、竹富町は鳩間・宮古は多良間🔵に全量を置く
export function isolatedByOf(a: AreaState): IsolatedBy {
  const b = a.isolatedPendingBy;
  if (b) return { hatoma: b.hatoma ?? 0, funauki: b.funauki ?? 0, tarama: b.tarama ?? 0, taramaVuln: b.taramaVuln ?? 0 };
  const n = Math.max(0, a.isolatedPending ?? 0);
  return a.id === 'miyako' ? { hatoma: 0, funauki: 0, tarama: n, taramaVuln: 0 } : { hatoma: n, funauki: 0, tarama: 0, taramaVuln: 0 };
}
export const isolatedSum = (by: IsolatedBy): number =>
  Math.max(0, by.hatoma) + Math.max(0, by.funauki) + Math.max(0, by.tarama) + Math.max(0, by.taramaVuln);

export interface SubCounts { res: number; tou: number; vul: number; stg: number; half?: number; vulnHalf?: number } // half: 0.5コマ端数の個数（半コマとして描く）。vulnHalf: 多良間🔴の 0.5コマ端数（赤い半コマ）


// エリアのコマを SUB_ISLANDS の各島へ按分する（地図と日報で共通）。
// - 鳩間島・船浮・多良間島(isolated) は isolatedPendingBy の実数（多良間の taramaVuln は要援護者、他は住民）。按分ウェイトから除外し、最低1コマ保証も適用しない
// - それ以外は residents/tourists/vulnerable/staging を weight（観光客は tourist）で按分
// - 描画された各島が空にならないよう、weight>0 の島へ最低1コマを保証（住民を最多の島から1つ移して総数は保持）
export function apportionArea(a: AreaState, subs: SubIsland[]): SubCounts[] {
  const w = subs.map(s => (s.isolated ? 0 : s.weight));
  const tw = subs.map(s => (s.isolated ? 0 : (s.tourist ?? 0)));
  // 0.5コマ端数（死亡0.5・船浮0.5移送など）は種別ごとに四捨五入せず、全種別の端数を合計して半コマとして
  // 最大ウェイトの島（西表島/宮古島等）へ置く（例: 要援護0.5＋待機0.5 を 1＋1=2 に水増ししない）
  const fl = (x: number) => Math.floor(Math.max(0, x) + 1e-9);
  const stgAll = a.stagingPort + (a.stagingVulnerable ?? 0);
  const resInt = fl(a.residents), touInt = fl(a.tourists), vulInt = fl(a.vulnerable), stgInt = fl(stgAll);
  const fracSum = (Math.max(0, a.residents) - resInt) + (Math.max(0, a.tourists) - touInt) + (Math.max(0, a.vulnerable) - vulInt) + (Math.max(0, stgAll) - stgInt);
  const halves = Math.round(fracSum * 2);
  const res = apportion(resInt, w);
  const half = subs.map(() => 0);
  const vulnHalf = subs.map(() => 0);
  if (halves > 0) {
    let best = -1;
    w.forEach((x, i) => { if (x > 0 && (best === -1 || x > w[best])) best = i; });
    if (best !== -1) half[best] = halves;
  }
  const tou = apportion(touInt, tw.some(x => x > 0) ? tw : w);
  const vul = apportion(vulInt, w);
  const stg = apportion(stgInt, w);
  const by = isolatedByOf(a);
  subs.forEach((s, i) => {
    if (!s.isolated) return;
    // 実数（0.5刻み）を保持: 整数部は通常コマ、0.5端数は半コマとして別枠（四捨五入で 0.5→1 に増やさない）
    const n = Math.max(0, by[s.key as IsolatedKey] ?? 0);
    const v = s.key === 'tarama' ? Math.max(0, by.taramaVuln) : 0;
    const vi = Math.floor(v + 1e-9);
    res[i] = Math.floor(n + 1e-9); vul[i] = vi; tou[i] = 0; stg[i] = 0;
    half[i] = n - res[i] > 1e-9 ? 1 : 0;
    vulnHalf[i] = v - vi > 1e-9 ? 1 : 0;
  });
  const totalOf = (i: number) => res[i] + tou[i] + vul[i] + stg[i] + half[i] + vulnHalf[i];
  // 島ごとの上限（波照間=1）: 住民・要援護者・待機を別々に按分すると合計が上限を超え得るため、
  // 超過分（要援護者→待機→観光→住民→半コマの順）を最大ウェイトの島（西表島/宮古島）へ移す（総数は保持）
  let sink = -1;
  w.forEach((x, i) => { if (x > 0 && subs[i].max === undefined && (sink === -1 || x > w[sink])) sink = i; });
  if (sink !== -1) {
    subs.forEach((s, i) => {
      if (s.isolated || s.max === undefined) return;
      let over = totalOf(i) - s.max;
      const shift = (arr: number[]) => { const n = Math.min(over, arr[i]); arr[i] -= n; arr[sink] += n; over -= n; };
      if (over > 0) shift(vul);
      if (over > 0) shift(stg);
      if (over > 0) shift(tou);
      if (over > 0) shift(res);
      if (over > 0 && half[i] > 0) { half[i] = 0; half[sink] += 1; }
    });
  }
  subs.forEach((s, i) => {
    if (s.isolated || w[i] <= 0 || totalOf(i) !== 0) return;
    let donor = -1;
    for (let j = 0; j < subs.length; j++) {
      if (subs[j].isolated) continue;
      if (res[j] > (donor === -1 ? 1 : res[donor])) donor = j;
    }
    if (donor !== -1 && res[donor] > 1) { res[donor]--; res[i]++; }
  });
  return subs.map((_s, i) => ({ res: res[i], tou: tou[i], vul: vul[i], stg: stg[i], half: half[i], vulnHalf: vulnHalf[i] }));
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

// 日末の島別残存コマ（ISLAND_COLUMNS.key → コマ数）。鳩間・船浮・多良間は isolatedPendingBy の実数（0.5刻みを保持）、他は按分の参考値
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
        const by = isolatedByOf(a);
        n += Math.max(0, by[k as IsolatedKey] ?? 0) + (k === 'tarama' ? Math.max(0, by.taramaVuln) : 0);
      } else {
        const c = (cache[col.area] ??= apportionArea(a, subs))[i];
        n += c.res + c.tou + c.vul + c.stg + (c.half ?? 0) * 0.5;
      }
    }
    out[col.key] = n;
  }
  return out;
}
