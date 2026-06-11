// IllustratedMap.tsx — 添付PDF(AI判定マップ ver2.0)を忠実なベースマップに、
// ライブ状態（各島の残コマ・橋崩落・避難/死亡）を重ねるマップ。

import React, { useMemo } from 'react';
import type { AreaId, AreaState, InfraState, EvacuationRecord } from '../types';
import { FONT } from '../theme';

interface Props {
  areas: Record<AreaId, AreaState>;
  infra?: InfraState;
  evacuated?: number;
  dead?: number;
  flowKey?: number;                 // 日が進むたびに変わるキー（アニメ発火）
  flowMoves?: EvacuationRecord[];    // その日の避難実績（島→ハブ/本土）
}

// ベースマップ上の位置（画像幅・高さに対する%）。実画像に合わせて調整。
const ISLAND_POS: Record<AreaId, { x: number; y: number; name: string }> = {
  yonaguni: { x: 8.5, y: 33, name: '与那国島' },
  taketomi: { x: 17, y: 70, name: '竹富町全島' },
  ishigaki: { x: 35.5, y: 50, name: '石垣島' },
  miyako: { x: 80, y: 33, name: '宮古島・多良間' },
};

// 本土（避難先）の到達点。PDFの赤矢印の先に対応。
const MAINLAND_DEST: Record<AreaId, { x: number; y: number }> = {
  yonaguni: { x: 10, y: 14 },   // 那覇経由 福岡空港（左上）
  taketomi: { x: 50, y: 50 },   // 主に石垣ハブ経由→福岡空港
  ishigaki: { x: 50, y: 50 },   // 福岡空港（中央）
  miyako: { x: 62, y: 25 },     // 鹿児島港・鹿児島空港（右上）
};

// 移動トークン
interface FlowToken {
  id: string;
  x0: number; y0: number; x1: number; y1: number;
  kind: 'r' | 'v';
  delay: number;
}

const TOKEN_COLOR = { r: '#3b9eff', v: '#ff5a5a' } as const;

const BRIDGE_POS: { key: keyof InfraState; label: string; x: number; y: number }[] = [
  { key: 'bridgeIkema', label: '池間大橋', x: 75, y: 20 },
  { key: 'bridgeIrabu', label: '伊良部大橋', x: 70.5, y: 31 },
  { key: 'bridgeKurima', label: '来間大橋', x: 74, y: 41 },
];

function totalKoma(a: AreaState): number {
  return a.residents + a.tourists + a.vulnerable + a.stagingPort;
}

export function IllustratedMap({ areas, infra, evacuated = 0, dead = 0, flowKey, flowMoves }: Props) {
  // その日の避難実績からトークンを導出（CSSアニメで島→ハブ/本土へ移動。終端で消える）
  const tokens = useMemo<FlowToken[]>(() => {
    const built: FlowToken[] = [];
    if (flowKey === undefined || !flowMoves) return built;
    flowMoves.forEach((mv, i) => {
      const from = ISLAND_POS[mv.from];
      if (!from) return;
      const to = mv.to === '石垣島' ? ISLAND_POS.ishigaki : MAINLAND_DEST[mv.from];
      const n = Math.max(1, Math.min(mv.count, 5)); // 表示は最大5トークン
      for (let k = 0; k < n; k++) {
        // 出発位置を少しばらけさせる（番号で決定的＝再描画でも安定）
        const jx = ((i * 7 + k * 13) % 7 - 3) * 0.7;
        const jy = ((i * 5 + k * 11) % 7 - 3) * 0.7;
        built.push({
          id: `${flowKey}-${i}-${k}`,
          x0: from.x + jx, y0: from.y + jy,
          x1: to.x + jx, y1: to.y + jy,
          kind: mv.isVulnerable ? 'v' : 'r',
          delay: i * 90 + k * 70,
        });
      }
    });
    return built;
  }, [flowKey, flowMoves]);

  return (
    <div style={styles.frame}>
      <div style={styles.titleBar}>
        <span style={styles.titleMain}>🗺 先島諸島 避難判定マップ</span>
        <span style={styles.titleSub}>OKIRES2026 MAP ver2.0</span>
        <span style={styles.liveBadges}>
          <span style={{ ...styles.liveBadge, color: '#16a34a' }}>避難 {evacuated}</span>
          <span style={{ ...styles.liveBadge, color: '#dc2626' }}>死亡 {dead}</span>
        </span>
      </div>

      <div style={styles.stage}>
        {/* 忠実なベースマップ（PDF由来） */}
        <img src="/sakishima-basemap.jpg" alt="先島諸島 避難判定マップ" style={styles.basemap} />

        {/* 移動トークン（信長の野望風：島→ハブ/本土へ） */}
        <div style={styles.overlay}>
          {tokens.map(t => (
            <div key={t.id} style={{
              position: 'absolute',
              transform: 'translate(-50%,-50%)',
              width: 12, height: 12, borderRadius: '50%',
              background: TOKEN_COLOR[t.kind],
              border: '2px solid #fff',
              boxShadow: `0 0 8px ${TOKEN_COLOR[t.kind]}, 0 1px 3px rgba(0,0,0,0.4)`,
              zIndex: 6,
              animation: `okires-token 1.6s cubic-bezier(0.4,0,0.2,1) ${t.delay}ms both`,
              ['--x0' as string]: `${t.x0}%`,
              ['--y0' as string]: `${t.y0}%`,
              ['--x1' as string]: `${t.x1}%`,
              ['--y1' as string]: `${t.y1}%`,
            } as React.CSSProperties} />
          ))}
        </div>

        {/* ライブ状態オーバーレイ */}
        <div style={styles.overlay}>
          {/* 各島の残コマ */}
          {(Object.keys(ISLAND_POS) as AreaId[]).map(id => {
            const a = areas[id];
            const pos = ISLAND_POS[id];
            const total = totalKoma(a);
            const done = total === 0;
            return (
              <div key={id} style={{ ...styles.islandTag, left: `${pos.x}%`, top: `${pos.y}%`, borderColor: done ? '#16a34a' : '#ef7d00' }}>
                <span style={styles.islandTagName}>{pos.name}</span>
                <span style={{ ...styles.islandTagKoma, color: done ? '#16a34a' : '#d9480f' }}>
                  {done ? '✓ 避難完了' : `残 ${total} コマ`}
                </span>
                {!done && (
                  <span style={styles.islandTagBreak}>
                    住{a.residents}・観{a.tourists}・要{a.vulnerable}{a.stagingPort > 0 ? `・待${a.stagingPort}` : ''}
                  </span>
                )}
              </div>
            );
          })}

          {/* 橋の崩落表示 */}
          {infra && BRIDGE_POS.map(b => {
            const ok = infra[b.key] as boolean;
            if (ok) return null; // 健全な橋は何も出さない（PDFに描かれている）
            return (
              <div key={b.label} style={{ ...styles.bridgeBroken, left: `${b.x}%`, top: `${b.y}%` }}>
                🚧 {b.label}<br />崩落・通行不可
              </div>
            );
          })}
        </div>
      </div>

      <div style={styles.caption}>
        🟡 空港 ／ 🔵 海港 ／ 🔴 空港待機 ／ 🟠 海港待機 ／ 赤矢印＝避難先（福岡・鹿児島）。
        橋（池間・伊良部・来間）が崩落すると該当島は避難不可。
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  frame: {
    borderRadius: 12, overflow: 'hidden',
    border: '3px solid #fffaf0',
    boxShadow: '0 10px 30px rgba(10,60,90,0.35)',
    background: '#eaf6fb',
  },
  titleBar: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 14px', background: 'linear-gradient(90deg,#1b6fa3,#2a93c4)',
  },
  titleMain: { fontFamily: FONT.jp, fontWeight: 800, fontSize: 14, color: '#fffaf0' },
  titleSub: { fontFamily: FONT.mono, fontSize: 10, letterSpacing: 1.5, color: 'rgba(255,255,255,0.7)' },
  liveBadges: { marginLeft: 'auto', display: 'flex', gap: 8 },
  liveBadge: { background: '#fffaf0', borderRadius: 8, padding: '2px 8px', fontFamily: FONT.mono, fontWeight: 800, fontSize: 12 },

  stage: { position: 'relative', width: '100%', lineHeight: 0 },
  basemap: { width: '100%', height: 'auto', display: 'block' },
  overlay: { position: 'absolute', inset: 0, pointerEvents: 'none' },

  islandTag: {
    position: 'absolute', transform: 'translate(-50%,-50%)',
    background: 'rgba(255,250,240,0.92)', borderWidth: 2, borderStyle: 'solid', borderRadius: 8,
    padding: '2px 6px', textAlign: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
    display: 'flex', flexDirection: 'column', lineHeight: 1.2, whiteSpace: 'nowrap',
  },
  islandTagName: { fontFamily: FONT.jp, fontWeight: 800, fontSize: 9, color: '#0b3a52' },
  islandTagKoma: { fontFamily: FONT.mono, fontWeight: 800, fontSize: 11 },
  islandTagBreak: { fontFamily: FONT.mono, fontSize: 7.5, color: '#475569' },

  bridgeBroken: {
    position: 'absolute', transform: 'translate(-50%,-50%)',
    background: 'rgba(255,59,59,0.95)', color: '#fff', borderRadius: 6,
    padding: '2px 5px', fontFamily: FONT.jp, fontWeight: 800, fontSize: 8, textAlign: 'center',
    lineHeight: 1.15, boxShadow: '0 1px 4px rgba(0,0,0,0.4)', border: '1px solid #a11',
  },

  caption: {
    padding: '6px 12px', background: '#fffaf0', fontFamily: FONT.jp, fontSize: 10.5,
    color: '#334155', lineHeight: 1.5, borderTop: '1px solid #e2e8f0',
  },
};
