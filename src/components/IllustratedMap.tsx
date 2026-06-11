// IllustratedMap.tsx — イラスト風（観光ガイドマップ調）の先島諸島マップ
// 戦術グリッドの置き換え。座標は%基準で、将来のコマ移動アニメに対応しやすい構造。

import React from 'react';
import type { AreaId, AreaState, InfraState } from '../types';
import { FONT } from '../theme';

interface Props {
  areas: Record<AreaId, AreaState>;
  infra?: InfraState;
}

// ── イラスト用パレット ──────────────────────────────
const P = {
  seaTop: '#7fd4e8',
  seaBottom: '#2a93c4',
  seaDeep: '#1b6fa3',
  land: '#8fd16a',
  landDark: '#5fae45',
  landEdge: '#f4e7c1', // 砂浜
  shadow: 'rgba(10,60,90,0.28)',
  ink: '#1d3b2e',
  airport: '#ffd633', // 🟡
  seaport: '#3b9eff', // 🔵
  white: '#ffffff',
  route: 'rgba(255,255,255,0.85)',
  routeShadow: 'rgba(20,80,110,0.35)',
} as const;

// 島の配置（x,y,w,h は % / blob は border-radius）
interface IslandCfg {
  id: AreaId;
  name: string;
  x: number; y: number;   // 中心 %
  w: number; h: number;   // 大きさ %
  blob: string;           // border-radius
  airport: string;        // 空港名
  seaport: string;        // 海港名
}

const ISLANDS: IslandCfg[] = [
  { id: 'yonaguni', name: '与那国島', x: 10, y: 50, w: 13, h: 17, blob: '54% 46% 60% 40% / 58% 52% 48% 42%', airport: '与那国空港', seaport: '久部良港' },
  { id: 'taketomi', name: '竹富町全島', x: 30, y: 66, w: 20, h: 22, blob: '46% 54% 42% 58% / 60% 44% 56% 40%', airport: '波照間空港', seaport: '石垣港(経由)' },
  { id: 'ishigaki', name: '石垣島', x: 45, y: 40, w: 21, h: 26, blob: '58% 42% 52% 48% / 46% 58% 42% 54%', airport: '新石垣空港', seaport: '石垣港' },
  { id: 'miyako', name: '宮古島・多良間', x: 72, y: 46, w: 23, h: 26, blob: '50% 50% 56% 44% / 52% 48% 52% 48%', airport: '宮古/下地島空港', seaport: '平良港' },
];

// 本土方面（避難先）
const MAINLAND = { x: 90, y: 12 };

// 橋（宮古衛星島）: 中心からのオフセット％
const BRIDGES: { key: keyof InfraState; label: string; dx: number; dy: number }[] = [
  { key: 'bridgeIkema', label: '池間大橋', dx: -2, dy: -13 },
  { key: 'bridgeIrabu', label: '伊良部大橋', dx: -13, dy: -3 },
  { key: 'bridgeKurima', label: '来間大橋', dx: -6, dy: 11 },
];

function totalKoma(a: AreaState): number {
  return a.residents + a.tourists + a.vulnerable + a.stagingPort;
}

export function IllustratedMap({ areas, infra }: Props) {
  // SVG航路（島→ハブ/本土）。viewBox 0..100。
  const hub = ISLANDS.find(i => i.id === 'ishigaki')!;
  const miyako = ISLANDS.find(i => i.id === 'miyako')!;
  const routes = [
    { from: ISLANDS[0], to: hub },                       // 与那国→石垣
    { from: ISLANDS[1], to: hub },                       // 竹富→石垣
    { from: hub, to: MAINLAND, hub: true },              // 石垣→本土
    { from: miyako, to: MAINLAND, hub: true },           // 宮古→本土
  ];

  return (
    <div style={styles.frame}>
      {/* タイトル帯 */}
      <div style={styles.titleBar}>
        <span style={styles.titleMain}>🗺 先島諸島 避難オペレーションマップ</span>
        <span style={styles.titleSub}>ILLUSTRATED OPS MAP</span>
      </div>

      {/* マップ本体（アスペクト比固定） */}
      <div style={styles.stage}>
        {/* 海（背景グラデ＋波） */}
        <div style={styles.ocean} />
        <svg viewBox="0 0 100 56" preserveAspectRatio="none" style={styles.waveLayer} aria-hidden>
          <defs>
            <pattern id="waves" width="8" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(0)">
              <path d="M0 2 q 2 -2 4 0 t 4 0" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="0.25" />
            </pattern>
          </defs>
          <rect width="100" height="56" fill="url(#waves)" />
        </svg>

        {/* 航路（SVG・点線＋矢印） */}
        <svg viewBox="0 0 100 56" preserveAspectRatio="none" style={styles.routeLayer} aria-hidden>
          <defs>
            <marker id="arrow" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto">
              <path d="M0 0 L6 3 L0 6 Z" fill={P.route} />
            </marker>
          </defs>
          {routes.map((r, i) => {
            const x1 = r.from.x, y1 = r.from.y * 0.56;
            const x2 = r.to.x, y2 = r.to.y * 0.56;
            const mx = (x1 + x2) / 2, my = Math.min(y1, y2) - 6;
            const d = `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
            return (
              <g key={i}>
                <path d={d} fill="none" stroke={P.routeShadow} strokeWidth="1.6" strokeLinecap="round" />
                <path d={d} fill="none" stroke={P.route} strokeWidth="0.8" strokeDasharray="1.4 1.2" strokeLinecap="round" markerEnd="url(#arrow)" />
              </g>
            );
          })}
        </svg>

        {/* 本土方面（避難先） */}
        <div style={{ ...styles.mainland, left: `${MAINLAND.x}%`, top: `${MAINLAND.y}%` }}>
          <div style={styles.mainlandBlob}>🗾</div>
          <div style={styles.mainlandLabel}>本土・九州<br />（避難先）</div>
        </div>

        {/* 島 */}
        {ISLANDS.map(cfg => {
          const a = areas[cfg.id];
          const total = totalKoma(a);
          const done = total === 0;
          return (
            <div key={cfg.id} style={{ ...styles.islandWrap, left: `${cfg.x}%`, top: `${cfg.y}%`, width: `${cfg.w}%` }}>
              {/* 島の本体（blob） */}
              <div style={{ ...styles.island, paddingBottom: `${(cfg.h / cfg.w) * 100}%`, borderRadius: cfg.blob }}>
                <div style={{ ...styles.islandInner, borderRadius: cfg.blob }}>
                  {/* 施設アイコン */}
                  <div style={styles.facilities}>
                    <span style={styles.airportDot} title={cfg.airport}>✈</span>
                    <span style={styles.seaportDot} title={cfg.seaport}>⚓</span>
                  </div>
                </div>
              </div>

              {/* 橋（宮古のみ） */}
              {cfg.id === 'miyako' && infra && BRIDGES.map(b => {
                const ok = infra[b.key] as boolean;
                return (
                  <div key={b.label} title={b.label}
                    style={{
                      ...styles.bridge,
                      left: `${50 + b.dx * 2}%`, top: `${40 + b.dy * 2}%`,
                      background: ok ? 'rgba(0,180,90,0.9)' : 'rgba(255,59,59,0.92)',
                      borderColor: ok ? '#0a5' : '#a11',
                    }}>
                    {ok ? '🌉' : '🚧'}
                  </div>
                );
              })}

              {/* 島名＋コマ数バッジ */}
              <div style={styles.islandLabel}>
                <span style={styles.islandName}>{cfg.name}</span>
                <span style={{ ...styles.komaBadge, background: done ? '#16a34a' : '#ef7d00' }}>
                  {done ? '✓ 完了' : `${total}コマ`}
                </span>
              </div>

              {/* コマ内訳（住/観/要/待） */}
              {!done && (
                <div style={styles.breakdown}>
                  {a.residents > 0 && <Token c="#e8f4ff" label="住" n={a.residents} />}
                  {a.tourists > 0 && <Token c={P.airport} label="観" n={a.tourists} />}
                  {a.vulnerable > 0 && <Token c="#ff8d8d" label="要" n={a.vulnerable} />}
                  {a.stagingPort > 0 && <Token c="#7fe0b0" label="待" n={a.stagingPort} />}
                </div>
              )}
            </div>
          );
        })}

        {/* 凡例 */}
        <div style={styles.legend}>
          <LegendItem color={P.airport} icon="✈" label="空港" />
          <LegendItem color={P.seaport} icon="⚓" label="海港" />
          <LegendItem color="#16a34a" icon="🌉" label="橋(健全)" />
          <LegendItem color="#ef4444" icon="🚧" label="橋(崩落)" />
        </div>
      </div>
    </div>
  );
}

function Token({ c, label, n }: { c: string; label: string; n: number }) {
  return (
    <span style={{ ...styles.token, background: c }}>
      {label}<b style={{ marginLeft: 1 }}>{n}</b>
    </span>
  );
}

function LegendItem({ color, icon, label }: { color: string; icon: string; label: string }) {
  return (
    <span style={styles.legendItem}>
      <span style={{ ...styles.legendDot, background: color }}>{icon}</span>
      {label}
    </span>
  );
}

const styles: Record<string, React.CSSProperties> = {
  frame: {
    borderRadius: 12, overflow: 'hidden',
    border: '3px solid #fffaf0',
    boxShadow: '0 10px 30px rgba(10,60,90,0.35)',
    background: '#fffaf0',
  },
  titleBar: {
    display: 'flex', alignItems: 'baseline', gap: 10,
    padding: '8px 14px', background: 'linear-gradient(90deg,#1b6fa3,#2a93c4)',
  },
  titleMain: { fontFamily: FONT.jp, fontWeight: 800, fontSize: 14, color: '#fffaf0' },
  titleSub: { fontFamily: FONT.mono, fontSize: 10, letterSpacing: 2, color: 'rgba(255,255,255,0.7)', marginLeft: 'auto' },

  stage: { position: 'relative', width: '100%', paddingBottom: '56%', overflow: 'hidden' },
  ocean: {
    position: 'absolute', inset: 0,
    background: `radial-gradient(120% 100% at 50% -10%, ${P.seaTop}, ${P.seaBottom} 55%, ${P.seaDeep} 100%)`,
  },
  waveLayer: { position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.6 },
  routeLayer: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' },

  mainland: { position: 'absolute', transform: 'translate(-50%,-50%)', textAlign: 'center', width: '16%' },
  mainlandBlob: {
    fontSize: 26, lineHeight: 1, filter: 'drop-shadow(0 3px 4px rgba(10,60,90,0.4))',
  },
  mainlandLabel: { fontFamily: FONT.jp, fontWeight: 700, fontSize: 9, color: '#0b3a52', background: 'rgba(255,250,240,0.85)', borderRadius: 6, padding: '2px 4px', marginTop: 2, lineHeight: 1.2 },

  islandWrap: { position: 'absolute', transform: 'translate(-50%,-50%)' },
  island: { position: 'relative', width: '100%', height: 0, filter: `drop-shadow(0 6px 8px ${P.shadow})` },
  islandInner: {
    position: 'absolute', inset: 0,
    background: `radial-gradient(80% 70% at 40% 30%, ${P.land}, ${P.landDark})`,
    border: `3px solid ${P.landEdge}`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  facilities: { display: 'flex', gap: 4 },
  airportDot: {
    width: 18, height: 18, borderRadius: '50%', background: '#ffd633',
    border: '2px solid #b88a00', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 9, boxShadow: '0 0 6px rgba(255,214,51,0.8)',
  },
  seaportDot: {
    width: 18, height: 18, borderRadius: '50%', background: '#3b9eff',
    border: '2px solid #1763a8', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 9, boxShadow: '0 0 6px rgba(59,158,255,0.8)',
  },
  bridge: {
    position: 'absolute', transform: 'translate(-50%,-50%)',
    width: 16, height: 16, borderRadius: '50%',
    border: '1.5px solid', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 9, boxShadow: '0 1px 3px rgba(0,0,0,0.3)', zIndex: 3,
  },

  islandLabel: { position: 'absolute', left: '50%', top: '100%', transform: 'translate(-50%,4px)', textAlign: 'center', whiteSpace: 'nowrap' },
  islandName: { display: 'block', fontFamily: FONT.jp, fontWeight: 800, fontSize: 11, color: '#0b3a52', textShadow: '0 1px 2px rgba(255,255,255,0.8)' },
  komaBadge: { display: 'inline-block', marginTop: 2, color: '#fff', fontFamily: FONT.mono, fontWeight: 800, fontSize: 10, borderRadius: 8, padding: '1px 7px' },

  breakdown: { position: 'absolute', left: '50%', top: '100%', transform: 'translate(-50%,30px)', display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center', width: 120 },
  token: { fontFamily: FONT.mono, fontSize: 8.5, fontWeight: 700, color: '#0b2030', borderRadius: 4, padding: '1px 4px', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' },

  legend: {
    position: 'absolute', left: 8, bottom: 8, display: 'flex', gap: 8, flexWrap: 'wrap',
    background: 'rgba(255,250,240,0.9)', borderRadius: 8, padding: '4px 8px',
  },
  legendItem: { display: 'flex', alignItems: 'center', gap: 3, fontFamily: FONT.jp, fontSize: 9, fontWeight: 700, color: '#0b3a52' },
  legendDot: { width: 14, height: 14, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8 },
};
