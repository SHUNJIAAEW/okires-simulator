// IllustratedMap.tsx — 手描き風（水彩・クレヨン調）の先島諸島イラストマップ
// 各島・港・空港の名前入り。自動再生中はコマが島→ハブ→本土へ移動し、本土に蓄積して消えない。

import React, { useMemo } from 'react';
import type { AreaId, AreaState, InfraState, DayLog } from '../types';
import { FONT } from '../theme';

interface Props {
  areas: Record<AreaId, AreaState>;
  infra?: InfraState;
  evacuated?: number;
  dead?: number;
  dayLogs?: DayLog[];
}

const VW = 320, VH = 180;
const FH = "'Yusei Magic', 'Noto Sans JP', sans-serif"; // 太め手書き風
// 文字を読みやすくする白フチ
const HALO = '1px 1px 0 #fff, -1px 1px 0 #fff, 1px -1px 0 #fff, -1px -1px 0 #fff, 0 2px 3px rgba(0,0,0,0.35)';

// svg座標→%（HTMLオーバーレイ用）
const px = (x: number) => `${(x / VW) * 100}%`;
const py = (y: number) => `${(y / VH) * 100}%`;

// ── 島本体（フィルタで手描き風に歪ませる楕円） ──
const ISLANDS: { cx: number; cy: number; rx: number; ry: number }[] = [
  { cx: 38, cy: 100, rx: 18, ry: 13 },   // 与那国島
  { cx: 88, cy: 126, rx: 27, ry: 19 },   // 西表島
  { cx: 80, cy: 100, rx: 5, ry: 4 },     // 鳩間島
  { cx: 116, cy: 104, rx: 5, ry: 4 },    // 小浜島
  { cx: 120, cy: 120, rx: 5, ry: 4 },    // 竹富島
  { cx: 132, cy: 140, rx: 6, ry: 5 },    // 黒島
  { cx: 100, cy: 162, rx: 7, ry: 5 },    // 波照間島
  { cx: 144, cy: 92, rx: 16, ry: 13 },   // 石垣(左ローブ)
  { cx: 164, cy: 84, rx: 17, ry: 14 },   // 石垣(右ローブ)
  { cx: 245, cy: 92, rx: 26, ry: 20 },   // 宮古島
  { cx: 216, cy: 92, rx: 9, ry: 7 },     // 伊良部島
  { cx: 202, cy: 93, rx: 6, ry: 6 },     // 下地島
  { cx: 240, cy: 64, rx: 6, ry: 5 },     // 池間島
  { cx: 236, cy: 118, rx: 5, ry: 4 },    // 来間島
  { cx: 262, cy: 62, rx: 3, ry: 3 },     // 大神島
  { cx: 200, cy: 150, rx: 8, ry: 6 },    // 多良間島
];

// ── 島の名前ラベル ──
// ラベルは島本体（コマ配置領域）に被らないよう、各島の外側へ配置する
const ISLAND_LABELS: { x: number; y: number; name: string; big?: boolean }[] = [
  { x: 36, y: 86, name: '与那国島', big: true },
  { x: 64, y: 144, name: '西表島', big: true },
  { x: 79, y: 92, name: '鳩間島' },
  { x: 114, y: 97, name: '小浜島' },
  { x: 130, y: 122, name: '竹富島' },
  { x: 134, y: 135, name: '黒島' },
  { x: 100, y: 169, name: '波照間島' },
  { x: 162, y: 68, name: '石垣島', big: true },
  { x: 250, y: 74, name: '宮古島', big: true },
  { x: 210, y: 84, name: '伊良部島' },
  { x: 196, y: 104, name: '下地島' },
  { x: 240, y: 56, name: '池間島' },
  { x: 230, y: 124, name: '来間島' },
  { x: 200, y: 160, name: '多良間島' },
];

// ── 施設（空港🟡 / 海港🔵）＋名前 ──
type Fac = { x: number; y: number; kind: 'air' | 'sea'; name: string };
const FACILITIES: Fac[] = [
  { x: 45, y: 95, kind: 'air', name: '与那国空港' },
  { x: 30, y: 105, kind: 'sea', name: '久部良港' },
  { x: 76, y: 118, kind: 'sea', name: '上原港' },
  { x: 99, y: 136, kind: 'sea', name: '大原港' },
  { x: 104, y: 164, kind: 'air', name: '波照間空港' },
  { x: 93, y: 158, kind: 'sea', name: '波照間港' },
  { x: 116, y: 109, kind: 'sea', name: '小浜港' },
  { x: 168, y: 88, kind: 'air', name: '新石垣空港' },
  { x: 140, y: 100, kind: 'sea', name: '石垣港' },
  { x: 252, y: 98, kind: 'air', name: '宮古空港' },
  { x: 232, y: 100, kind: 'sea', name: '平良港' },
  { x: 197, y: 93, kind: 'air', name: '下地島空港' },
  { x: 205, y: 147, kind: 'air', name: '多良間空港' },
  { x: 195, y: 153, kind: 'sea', name: '多良間港' },
];

// ── 橋（宮古衛星島） ──
const BRIDGES: { key: keyof InfraState; name: string; x1: number; y1: number; x2: number; y2: number; lx: number; ly: number }[] = [
  { key: 'bridgeIkema', name: '池間大橋', x1: 240, y1: 69, x2: 242, y2: 76, lx: 250, ly: 70 },
  { key: 'bridgeIrabu', name: '伊良部大橋', x1: 224, y1: 92, x2: 232, y2: 92, lx: 216, ly: 104 },
  { key: 'bridgeKurima', name: '来間大橋', x1: 236, y1: 114, x2: 238, y2: 106, lx: 226, ly: 116 },
];

// ── 本土（避難先） ──
const DESTS: { id: string; x: number; y: number; label: string }[] = [
  { id: 'naha', x: 26, y: 22, label: '那覇経由\n福岡空港' },
  { id: 'fukuoka', x: 150, y: 18, label: '福岡空港' },
  { id: 'kagoshima', x: 292, y: 24, label: '鹿児島港・空港' },
];

// 島中心（トークン出発点）
const ISLAND_CENTER: Record<AreaId, { x: number; y: number }> = {
  yonaguni: { x: 38, y: 100 },
  taketomi: { x: 95, y: 126 },
  ishigaki: { x: 154, y: 88 },
  miyako: { x: 245, y: 92 },
};
const HUB = { x: 154, y: 88 };
const MAINLAND_DEST: Record<AreaId, { x: number; y: number }> = {
  yonaguni: { x: 26, y: 26 },
  taketomi: { x: 150, y: 22 },
  ishigaki: { x: 150, y: 22 },
  miyako: { x: 292, y: 28 },
};

interface Tok { id: string; x0: number; y0: number; x1: number; y1: number; kind: 'r' | 'v'; delay: number; last: boolean }
const TCOLOR = { r: '#2f80ed', v: '#eb5757' } as const;

// エリア内の個別島ごとのコマ配置領域＋按分ウェイト（svg座標・楕円範囲）
// 比率は SimulationMap のボード盤（以前共有した公式マップ）由来:
//  竹富町＝西表6/竹富2/波照間3/黒島2/小浜2(計15)、宮古は人口比で多良間・伊良部等にも配置
type SubBlob = { cx: number; cy: number; rx: number; ry: number };
const SUB_ISLANDS: Record<AreaId, { blob: SubBlob; weight: number }[]> = {
  yonaguni: [
    { blob: { cx: 36, cy: 104, rx: 14, ry: 8 }, weight: 1 }, // 与那国島（ラベル上・港左を避け島中央下に）
  ],
  taketomi: [
    { blob: { cx: 86, cy: 131, rx: 18, ry: 10 }, weight: 6 }, // 西表島
    { blob: { cx: 124, cy: 124, rx: 4, ry: 3 }, weight: 2 },  // 竹富島
    { blob: { cx: 100, cy: 159, rx: 5, ry: 4 }, weight: 3 },  // 波照間島
    { blob: { cx: 134, cy: 144, rx: 5, ry: 4 }, weight: 2 },  // 黒島
    { blob: { cx: 114, cy: 106, rx: 4, ry: 3 }, weight: 2 },  // 小浜島
    { blob: { cx: 79, cy: 102, rx: 4, ry: 3 }, weight: 1 },   // 鳩間島
  ],
  ishigaki: [
    { blob: { cx: 154, cy: 92, rx: 23, ry: 14 }, weight: 1 }, // 石垣島（港・空港アイコンを縁に残すため内側に）
  ],
  miyako: [
    { blob: { cx: 246, cy: 95, rx: 18, ry: 11 }, weight: 85 }, // 宮古島（同上）
    { blob: { cx: 216, cy: 94, rx: 6, ry: 4 }, weight: 6 },    // 伊良部島
    { blob: { cx: 203, cy: 96, rx: 4, ry: 3 }, weight: 1 },    // 下地島
    { blob: { cx: 200, cy: 151, rx: 7, ry: 4 }, weight: 3 },   // 多良間島
    { blob: { cx: 240, cy: 65, rx: 4, ry: 3 }, weight: 1 },    // 池間島
    { blob: { cx: 236, cy: 119, rx: 4, ry: 3 }, weight: 1 },   // 来間島
  ],
};

// 整数 total を weights で按分（最大剰余法）。総数を保ったまま各島へ配分する。
function apportion(total: number, weights: number[]): number[] {
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

// コマ種別の色（白マスに乗るコマ）
const KOMA_COLOR: Record<string, string> = {
  r: '#2f80ed', // 住民
  t: '#e0a800', // 観光客
  v: '#eb5757', // 要援護者
  s: '#1b8a4b', // 待機
};

interface Cell { x: number; y: number; size: number; kind: string }

// 人コマの統一サイズ（svg座標単位）。全島・全種別で共通。
const KOMA_SIZE = 4.4;

// 人型シルエット（頭＋胴）。color で塗り分け、白フチで島背景でも視認可能に。
function PersonIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 30" width="100%" height="100%" style={{ display: 'block', overflow: 'visible' }}>
      <g fill={color} stroke="#ffffff" strokeWidth={1.6} strokeLinejoin="round">
        <circle cx="12" cy="6" r="5" />
        <path d="M12 12c-5 0-8 4-8 10v6h16v-6c0-6-3-10-8-10z" />
      </g>
    </svg>
  );
}

// 島の中に白マスを格子配置し、現在のコマを種別色で乗せる
function buildCells(area: AreaState, blob: { cx: number; cy: number; rx: number; ry: number }): Cell[] {
  // 小数（死亡0.5コマ等）や負値で Array() が落ちないよう整数化
  const ci = (x: number) => Math.max(0, Math.round(x));
  const kinds: string[] = [
    ...Array(ci(area.residents)).fill('r'),
    ...Array(ci(area.tourists)).fill('t'),
    ...Array(ci(area.vulnerable)).fill('v'),
    ...Array(ci(area.stagingPort)).fill('s'),
  ];
  const n = kinds.length;
  if (n === 0) return [];
  // 種別を散らす（初期配置をランダムに見せる：決定的シャッフル）
  for (let i = n - 1; i > 0; i--) {
    const j = (i * 7 + 3) % (i + 1);
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  const cols = Math.max(1, Math.round(Math.sqrt(n * (blob.rx / blob.ry))));
  const rows = Math.ceil(n / cols);
  const spanX = blob.rx * 1.5, spanY = blob.ry * 1.4;
  const stepX = spanX / cols, stepY = spanY / rows;
  // コマ（人型）のサイズは全島で統一。配置はグリッドで散らす。
  const size = KOMA_SIZE;
  const cells: Cell[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const jx = ((i * 13 + 5) % 7 - 3) * 0.18;
    const jy = ((i * 11 + 2) % 7 - 3) * 0.18;
    cells.push({
      x: blob.cx + (col - (cols - 1) / 2) * stepX + jx,
      y: blob.cy + (row - (rows - 1) / 2) * stepY + jy,
      size, kind: kinds[i],
    });
  }
  return cells;
}

function totalKoma(a: AreaState): number {
  return a.residents + a.tourists + a.vulnerable + a.stagingPort;
}

export function IllustratedMap({ areas, infra, evacuated = 0, dead = 0, dayLogs }: Props) {
  // 全日程の避難実績からトークンを生成（蓄積＝消えない）。最新日のみアニメ、過去日は到達点で静止。
  const tokens = useMemo<Tok[]>(() => {
    const out: Tok[] = [];
    if (!dayLogs || dayLogs.length === 0) return out;
    const lastDay = dayLogs[dayLogs.length - 1].day;
    const pileCount: Record<string, number> = {};
    dayLogs.forEach(log => {
      log.evacuations.forEach((mv, i) => {
        const from = ISLAND_CENTER[mv.from];
        if (!from) return;
        const destBase = mv.to === '石垣島' ? HUB : MAINLAND_DEST[mv.from];
        const destKey = mv.to === '石垣島' ? 'hub' : (MAINLAND_DEST[mv.from] === MAINLAND_DEST.miyako ? 'kg' : 'main') + mv.from;
        const n = Math.max(1, Math.min(mv.count, 6));
        for (let k = 0; k < n; k++) {
          const c = (pileCount[destKey] = (pileCount[destKey] ?? 0) + 1);
          // 到達点で格子状にばらけて積み上がる
          const col = c % 6, row = Math.floor(c / 6) % 6;
          const ox = (col - 2.5) * 4.2;
          const oy = (row - 2.5) * 4.0;
          out.push({
            id: `${log.day}-${i}-${k}`,
            x0: from.x, y0: from.y,
            x1: destBase.x + ox, y1: destBase.y + oy,
            kind: mv.isVulnerable ? 'v' : 'r',
            delay: i * 70 + k * 50,
            last: log.day === lastDay,
          });
        }
      });
    });
    return out;
  }, [dayLogs]);

  // 各島の白マス（現在のコマ配置）
  const cellsByArea = useMemo(() => {
    const ci = (x: number) => Math.max(0, Math.round(x));
    const out: { id: string; cells: Cell[] }[] = [];
    (Object.keys(SUB_ISLANDS) as AreaId[]).forEach(id => {
      const a = areas[id];
      const subs = SUB_ISLANDS[id];
      const w = subs.map(s => s.weight);
      const res = apportion(ci(a.residents), w);
      const tou = apportion(ci(a.tourists), w);
      const vul = apportion(ci(a.vulnerable), w);
      const stg = apportion(ci(a.stagingPort), w);
      // 描画された各島が空にならないよう、weight>0 の島へ最低1コマを保証する
      // （住民を最多の島から1つ移して総数は保持。住民が足りる時のみ実施）
      const totalOf = (i: number) => res[i] + tou[i] + vul[i] + stg[i];
      subs.forEach((_s, i) => {
        if (w[i] > 0 && totalOf(i) === 0) {
          let donor = -1;
          for (let j = 0; j < subs.length; j++) {
            if (res[j] > (donor === -1 ? 1 : res[donor])) donor = j;
          }
          if (donor !== -1 && res[donor] > 1) { res[donor]--; res[i]++; }
        }
      });
      subs.forEach((s, si) => {
        const subArea: AreaState = {
          ...a, residents: res[si], tourists: tou[si], vulnerable: vul[si], stagingPort: stg[si],
        };
        out.push({ id: `${id}-${si}`, cells: buildCells(subArea, s.blob) });
      });
    });
    return out;
  }, [areas]);

  return (
    <div style={styles.frame}>
      <div style={styles.titleBar}>
        <span style={styles.liveBadges}>
          <span style={{ ...styles.liveBadge, color: '#1b8a4b' }}>避難 {evacuated}</span>
          <span style={{ ...styles.liveBadge, color: '#c0392b' }}>死亡 {dead}</span>
        </span>
      </div>

      <div style={styles.stage}>
        {/* 手描き風SVG（海＋島） */}
        <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" style={styles.svg}>
          <defs>
            <filter id="rough">
              <feTurbulence type="fractalNoise" baseFrequency="0.016" numOctaves={2} seed={7} result="n" />
              <feDisplacementMap in="SourceGraphic" in2="n" scale="6" />
            </filter>
            <radialGradient id="sea" cx="50%" cy="0%" r="120%">
              <stop offset="0%" stopColor="#bff0f2" />
              <stop offset="55%" stopColor="#8fd7e0" />
              <stop offset="100%" stopColor="#6cc1d4" />
            </radialGradient>
            <radialGradient id="land" cx="42%" cy="34%" r="75%">
              <stop offset="0%" stopColor="#bfe389" />
              <stop offset="100%" stopColor="#86c258" />
            </radialGradient>
            <marker id="amk" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto">
              <path d="M0 0 L6 3 L0 6 Z" fill="rgba(255,255,255,0.9)" />
            </marker>
          </defs>

          {/* 海 */}
          <rect x="0" y="0" width={VW} height={VH} fill="url(#sea)" />
          {/* 手描きの波 */}
          <g stroke="rgba(255,255,255,0.45)" strokeWidth="0.7" fill="none" filter="url(#rough)">
            {Array.from({ length: 9 }, (_, r) => (
              <path key={r} d={`M ${10 + (r % 2) * 12} ${20 + r * 18} q 6 -4 12 0 t 12 0 t 12 0`} />
            ))}
            {Array.from({ length: 6 }, (_, r) => (
              <path key={`b${r}`} d={`M ${180 + (r % 2) * 12} ${130 - r * 16} q 6 -4 12 0 t 12 0`} />
            ))}
          </g>

          {/* 航路（流れる点線で移動方向を表示） */}
          <g className="route-flow" stroke="rgba(255,255,255,0.92)" strokeWidth="1.4" fill="none" filter="url(#rough)">
            <path d={`M ${ISLAND_CENTER.yonaguni.x} ${ISLAND_CENTER.yonaguni.y} Q 95 70 ${HUB.x} ${HUB.y}`} markerEnd="url(#amk)" />
            <path d={`M ${ISLAND_CENTER.taketomi.x} ${ISLAND_CENTER.taketomi.y} Q 130 100 ${HUB.x} ${HUB.y}`} markerEnd="url(#amk)" />
            <path d={`M ${HUB.x} ${HUB.y} Q 150 45 150 22`} markerEnd="url(#amk)" />
            <path d={`M ${ISLAND_CENTER.miyako.x} ${ISLAND_CENTER.miyako.y} Q 280 55 292 28`} markerEnd="url(#amk)" />
          </g>

          {/* 砂浜（島の少し大きい影） */}
          <g filter="url(#rough)">
            {ISLANDS.map((is, i) => (
              <ellipse key={`s${i}`} cx={is.cx} cy={is.cy} rx={is.rx + 1.6} ry={is.ry + 1.6} fill="#f3e6c0" opacity={0.9} />
            ))}
          </g>
          {/* 島本体 */}
          <g filter="url(#rough)" stroke="#5a8a3a" strokeWidth="1.2">
            {ISLANDS.map((is, i) => (
              <ellipse key={i} cx={is.cx} cy={is.cy} rx={is.rx} ry={is.ry} fill="url(#land)" />
            ))}
          </g>

          {/* 橋 */}
          {infra && BRIDGES.map(b => {
            const ok = infra[b.key] as boolean;
            return (
              <line key={b.name} x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2}
                stroke={ok ? '#7a5230' : '#e03131'} strokeWidth={ok ? 1.6 : 2.2}
                strokeDasharray={ok ? undefined : '1.5 1.5'} strokeLinecap="round" />
            );
          })}
        </svg>

        {/* HTMLオーバーレイ：白マス・トークン・ラベル・施設・残数 */}
        <div style={styles.overlay}>
          {/* 人コマ（人型・統一サイズ）。種別色で塗り分け、初期配置＝ランダム散らし */}
          {cellsByArea.map(g => g.cells.map((c, i) => (
            <div key={`${g.id}-${i}`} style={{
              position: 'absolute',
              left: px(c.x), top: py(c.y), transform: 'translate(-50%,-50%)',
              width: `${(c.size / VW) * 100}%`, aspectRatio: '24 / 30',
              filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.35))',
              zIndex: 5,
            }}>
              <PersonIcon color={KOMA_COLOR[c.kind]} />
            </div>
          )))}

          {/* 移動トークン（蓄積して消えない）。移動中(最新日)は大きく光らせて見やすく */}
          {tokens.map(t => {
            const sz = t.last ? 15 : 9;
            return (
              <div key={t.id} style={{
                position: 'absolute',
                width: sz, height: sz, borderRadius: '50%',
                background: TCOLOR[t.kind], border: `${t.last ? 2.5 : 1.5}px solid #fff`,
                boxShadow: t.last
                  ? `0 0 12px ${TCOLOR[t.kind]}, 0 0 4px #fff, 0 1px 3px rgba(0,0,0,0.5)`
                  : `0 0 4px ${TCOLOR[t.kind]}, 0 1px 2px rgba(0,0,0,0.4)`,
                zIndex: t.last ? 7 : 5,
                animation: t.last
                  ? `okires-token-stay 1.9s cubic-bezier(0.45,0,0.2,1) ${t.delay}ms both`
                  : undefined,
                left: t.last ? undefined : px(t.x1),
                top: t.last ? undefined : py(t.y1),
                transform: t.last ? undefined : 'translate(-50%,-50%)',
                ['--x0' as string]: px(t.x0),
                ['--y0' as string]: py(t.y0),
                ['--x1' as string]: px(t.x1),
                ['--y1' as string]: py(t.y1),
              } as React.CSSProperties} />
            );
          })}

          {/* 施設アイコン＋名前（コマより前面に出して常に視認可能に） */}
          {FACILITIES.map(f => (
            <div key={f.name} style={{ position: 'absolute', left: px(f.x), top: py(f.y), transform: 'translate(-50%,-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 7 }}>
              <span style={f.kind === 'air' ? styles.airDot : styles.seaDot}>{f.kind === 'air' ? '✈' : '⚓'}</span>
              <span style={styles.facLabel}>{f.name}</span>
            </div>
          ))}

          {/* 橋ラベル */}
          {infra && BRIDGES.map(b => {
            const ok = infra[b.key] as boolean;
            return (
              <div key={b.name} style={{ position: 'absolute', left: px(b.lx), top: py(b.ly), transform: 'translate(-50%,-50%)', zIndex: 4 }}>
                <span style={{ ...styles.bridgeLabel, color: ok ? '#7a5230' : '#fff', background: ok ? 'rgba(255,250,240,0.85)' : 'rgba(224,49,49,0.95)' }}>
                  {ok ? '🌉' : '🚧'}{b.name}
                </span>
              </div>
            );
          })}

          {/* 島名ラベル */}
          {ISLAND_LABELS.map(l => (
            <div key={l.name} style={{ position: 'absolute', left: px(l.x), top: py(l.y), transform: 'translate(-50%,-50%)', zIndex: 4 }}>
              <span style={{ ...styles.islandLabel, fontSize: l.big ? 13 : 9.5 }}>{l.name}</span>
            </div>
          ))}

          {/* 各島の残コマ */}
          {(Object.keys(ISLAND_CENTER) as AreaId[]).map(id => {
            const a = areas[id]; const c = ISLAND_CENTER[id];
            const total = totalKoma(a); const done = total === 0;
            return (
              <div key={id} style={{ position: 'absolute', left: px(c.x), top: py(c.y + 20), transform: 'translate(-50%,-50%)', zIndex: 6 }}>
                <span style={{ ...styles.komaBadge, background: done ? '#1b8a4b' : '#ef7d00' }}>
                  {done ? '✓完了' : `残${total}`}
                </span>
              </div>
            );
          })}

          {/* 本土（避難先）ラベル */}
          {DESTS.map(d => (
            <div key={d.id} style={{ position: 'absolute', left: px(d.x), top: py(d.y), transform: 'translate(-50%,-50%)', zIndex: 4 }}>
              <span style={styles.destLabel}>{d.label.split('\n').map((s, i) => <React.Fragment key={i}>{i > 0 && <br />}{s}</React.Fragment>)}</span>
            </div>
          ))}

          {/* 死亡コマ枠（右下） */}
          <div style={styles.deathBox}>
            <div style={styles.deathLabel}>💀 死亡コマ <b>{Math.round(dead * 10) / 10}</b></div>
            {dead > 0 && (
              <div style={styles.deathGrid}>
                {Array.from({ length: Math.min(Math.round(dead), 28) }, (_, i) => (
                  <span key={i} style={styles.deathDot} />
                ))}
                {Math.round(dead) > 28 && <span style={styles.deathMore}>+{Math.round(dead) - 28}</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={styles.caption}>
        コマ：<b style={{ color: '#2f80ed' }}>●青＝住民</b> ／ <b style={{ color: '#c98f00' }}>●黄＝観光客</b> ／ <b style={{ color: '#eb5757' }}>●赤＝要援護者</b> ／ <b style={{ color: '#1b8a4b' }}>●緑＝待機（石垣ハブ等に集結し避難手段を待つ避難民）</b>。
        施設：🟡空港 ／ 🔵海港 ／ 🌉橋（崩落で🚧＝該当島は避難不可）。自動再生中、避難したコマは本土へ移動して積み上がり、死亡は右下の枠に入ります。
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  frame: { borderRadius: 14, overflow: 'hidden', border: '3px solid #fffaf0', boxShadow: '0 10px 30px rgba(10,60,90,0.3)', background: '#fffaf0' },
  titleBar: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: 'linear-gradient(90deg,#3aa0b8,#5cc0d0)' },
  titleMain: { fontFamily: FH, fontWeight: 700, fontSize: 16, color: '#fffaf0', letterSpacing: 1 },
  liveBadges: { marginLeft: 'auto', display: 'flex', gap: 8 },
  liveBadge: { background: '#fffaf0', borderRadius: 10, padding: '2px 9px', fontFamily: FONT.mono, fontWeight: 800, fontSize: 12 },

  stage: { position: 'relative', width: '100%', paddingBottom: '56.25%' },
  svg: { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' },
  overlay: { position: 'absolute', inset: 0, pointerEvents: 'none' },

  airDot: { width: 15, height: 15, borderRadius: '50%', background: '#ffd633', border: '2px solid #8f6a00', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, boxShadow: '0 0 5px rgba(255,214,51,0.9)' },
  seaDot: { width: 15, height: 15, borderRadius: '50%', background: '#3b9eff', border: '2px solid #0f4f8f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, boxShadow: '0 0 5px rgba(59,158,255,0.9)' },
  facLabel: { fontFamily: FH, fontSize: 8, color: '#173a17', fontWeight: 700, marginTop: 1, whiteSpace: 'nowrap', textShadow: HALO },

  islandLabel: { fontFamily: FH, fontWeight: 700, color: '#0e2f47', whiteSpace: 'nowrap', textShadow: HALO },
  komaBadge: { fontFamily: FONT.jp, fontWeight: 900, fontSize: 9.5, color: '#fff', borderRadius: 8, padding: '1px 7px', whiteSpace: 'nowrap', boxShadow: '0 1px 3px rgba(0,0,0,0.35)', border: '1.5px solid rgba(255,255,255,0.6)' },
  bridgeLabel: { fontFamily: FH, fontWeight: 700, fontSize: 8.5, borderRadius: 6, padding: '1px 5px', whiteSpace: 'nowrap', boxShadow: '0 1px 3px rgba(0,0,0,0.25)', border: '1px solid rgba(0,0,0,0.15)' },
  destLabel: { fontFamily: FH, fontWeight: 700, fontSize: 11, color: '#9c3d12', background: 'rgba(255,250,240,0.96)', border: '2px dashed #e07a2e', borderRadius: 10, padding: '3px 8px', whiteSpace: 'nowrap', textAlign: 'center', lineHeight: 1.2, boxShadow: '0 2px 6px rgba(0,0,0,0.22)' },

  caption: { padding: '6px 12px', background: '#fffaf0', fontFamily: FONT.jp, fontSize: 10.5, color: '#334155', lineHeight: 1.5, borderTop: '1px solid #eadfc8' },

  // 死亡コマ枠（右下）
  deathBox: {
    position: 'absolute', right: '1.5%', bottom: '2.5%', width: '20%', maxWidth: 190,
    background: 'rgba(38,34,40,0.92)', borderWidth: 2, borderStyle: 'dashed', borderColor: '#c0392b',
    borderRadius: 8, padding: '4px 6px', zIndex: 6, boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
  },
  deathLabel: { fontFamily: FH, fontWeight: 700, fontSize: 9.5, color: '#fff', textAlign: 'center', marginBottom: 3, textShadow: '0 1px 2px rgba(0,0,0,0.6)' },
  deathGrid: { display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'center', alignItems: 'center' },
  deathDot: { width: 7, height: 7, borderRadius: '50%', background: '#1a1a1f', borderWidth: 1.5, borderStyle: 'solid', borderColor: '#e74c3c', boxShadow: '0 0 3px rgba(231,76,60,0.6)' },
  deathMore: { fontFamily: FONT.mono, fontSize: 8, fontWeight: 800, color: '#ff9d9d', marginLeft: 2 },
};
