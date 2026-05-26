// SimulationMap.tsx — マス目（board game grid）マップ
// 与那国 → 竹富町 → 石垣島(ハブ) → 宮古島・多良間 の配置を再現

import type { AreaId, AreaState } from '../types';
import { getEffectiveActions } from '../constants';
import { useWindowWidth } from '../hooks/useWindowWidth';

interface Props {
  areas: Record<AreaId, AreaState>;
  // optional: 選択中の時間（highlight用）
  selectedHour?: number;
}

type CellType = 'town' | 'staging_air' | 'staging_sea' | 'shelter' | 'empty' | 'label';

interface GridCell {
  type: CellType;
  label?: string;
  // pieces currently in this cell (simplified: evenly distributed)
  residents?: number;
  tourists?: number;
  vulnerable?: number;
}

// ─────────────────────────────────────────────────
//  コマ（ピース）表示
// ─────────────────────────────────────────────────
function Piece({ kind, size = 14 }: { kind: 'r' | 't' | 'v'; size?: number }) {
  const cfg = {
    r: { bg: '#ffffff', border: '#555', label: '住' },
    t: { bg: '#fde68a', border: '#d97706', label: '観' },
    v: { bg: '#93c5fd', border: '#1d4ed8', label: '要' },
  }[kind];
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      border: `1.5px solid ${cfg.border}`, background: cfg.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.max(5, size - 8), fontWeight: 900, color: '#222',
      flexShrink: 0, boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
      userSelect: 'none',
    }}>{cfg.label}</div>
  );
}

// ─────────────────────────────────────────────────
//  1マス表示
// ─────────────────────────────────────────────────
interface CellProps {
  cell: GridCell;
  islandColor: string;
  islandBgLight: string;
  cellSize?: number;
}

function Cell({ cell, islandColor, islandBgLight, cellSize = 32 }: CellProps) {
  const CELL = cellSize;
  const GAP = 2;

  if (cell.type === 'empty') {
    return <div style={{ width: CELL, height: CELL, flexShrink: 0 }} />;
  }
  if (cell.type === 'label') {
    return (
      <div style={{
        width: CELL * 2 + GAP, height: CELL, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 8, fontWeight: 700, color: islandColor,
        background: 'transparent',
      }}>{cell.label}</div>
    );
  }

  const isStagingAir = cell.type === 'staging_air';
  const isStagingSea = cell.type === 'staging_sea';
  const isShelter = cell.type === 'shelter';
  const isStaging = isStagingAir || isStagingSea || isShelter;

  const bg = isStagingAir ? '#dbeafe'
    : isStagingSea ? '#d1fae5'
    : isShelter ? '#fef3c7'
    : islandBgLight;

  const borderColor = isStagingAir ? '#3b82f6'
    : isStagingSea ? '#16a34a'
    : isShelter ? '#d97706'
    : islandColor;

  const icon = isStagingAir ? '✈' : isStagingSea ? '⚓' : isShelter ? '🏠' : null;

  const totalPieces = (cell.residents ?? 0) + (cell.tourists ?? 0) + (cell.vulnerable ?? 0);

  return (
    <div style={{
      width: CELL, height: CELL, flexShrink: 0,
      border: `2px solid ${borderColor}`,
      borderStyle: isStaging ? 'dashed' : 'solid',
      background: bg,
      borderRadius: 4,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* label上の小アイコン */}
      {icon && (
        <span style={{ fontSize: 8, lineHeight: 1, marginBottom: 1 }}>{icon}</span>
      )}
      {cell.label && (
        <span style={{ fontSize: 5.5, color: '#374151', fontWeight: 700, textAlign: 'center', lineHeight: 1.1, maxWidth: 30 }}>
          {cell.label}
        </span>
      )}
      {/* コマを表示 (最大4個まで) */}
      {totalPieces > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center', marginTop: cell.label ? 0 : 2 }}>
          {Array.from({ length: Math.min(cell.residents ?? 0, 3) }, (_, i) => <Piece key={`r${i}`} kind="r" size={10} />)}
          {Array.from({ length: Math.min(cell.tourists ?? 0, 2) }, (_, i) => <Piece key={`t${i}`} kind="t" size={10} />)}
          {Array.from({ length: Math.min(cell.vulnerable ?? 0, 2) }, (_, i) => <Piece key={`v${i}`} kind="v" size={10} />)}
          {totalPieces > 7 && <span style={{ fontSize: 7, fontWeight: 700, color: '#374151' }}>+{totalPieces - 7}</span>}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────
//  島グリッドパネル
// ─────────────────────────────────────────────────
interface IslandGridProps {
  title: string;
  subtitle?: string;
  color: string;        // border/text color
  bgLight: string;      // town cell bg
  bgDark: string;       // panel header bg
  rows: GridCell[][];
  width?: number;
  cellSize?: number;
}

function IslandGrid({ title, subtitle, color, bgLight, bgDark, rows, width, cellSize = 32 }: IslandGridProps) {
  const GAP = 2;
  return (
    <div style={{
      border: `2.5px solid ${color}`,
      borderRadius: 8,
      overflow: 'hidden',
      background: bgLight,
      width: width ? width : 'auto',
      flexShrink: 0,
    }}>
      {/* ヘッダー */}
      <div style={{ background: bgDark, padding: '4px 8px' }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#fff' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.75)', marginTop: 1 }}>{subtitle}</div>}
      </div>
      {/* グリッド */}
      <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: GAP }}>
        {rows.map((row, ri) => (
          <div key={ri} style={{ display: 'flex', gap: GAP }}>
            {row.map((cell, ci) => (
              <Cell key={ci} cell={cell} islandColor={color} islandBgLight={bgLight} cellSize={cellSize} />
            ))}
          </div>
        ))}
      </div>
      {/* 凡例 */}
      <div style={{ padding: '3px 6px', background: 'rgba(0,0,0,0.07)', display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {[
          { color: bgLight, border: color, label: '市街地' },
          { color: '#dbeafe', border: '#3b82f6', label: '空港準備', dashed: true },
          { color: '#d1fae5', border: '#16a34a', label: '港準備', dashed: true },
        ].map(leg => (
          <div key={leg.label} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <div style={{
              width: 10, height: 10, border: `1.5px ${leg.dashed ? 'dashed' : 'solid'} ${leg.border}`,
              background: leg.color, borderRadius: 2,
            }} />
            <span style={{ fontSize: 7, color: '#374151' }}>{leg.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────
//  矢印コネクタ
// ─────────────────────────────────────────────────
function Arrow({ label, vertical = false }: { label: string; vertical?: boolean }) {
  if (vertical) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: '0 4px' }}>
        <span style={{ fontSize: 18, color: '#d1fae5', fontWeight: 900, textShadow: '0 1px 4px rgba(0,0,0,0.3)' }}>↓</span>
        <span style={{ fontSize: 7.5, color: '#d1fae5', fontWeight: 700, textAlign: 'center', textShadow: '0 1px 3px rgba(0,0,0,0.4)', whiteSpace: 'nowrap' }}>{label}</span>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: '0 2px' }}>
      <span style={{ fontSize: 20, color: '#d1fae5', fontWeight: 900, textShadow: '0 1px 4px rgba(0,0,0,0.3)' }}>→</span>
      <span style={{ fontSize: 7, color: '#d1fae5', fontWeight: 700, textAlign: 'center', textShadow: '0 1px 3px rgba(0,0,0,0.4)', maxWidth: 40 }}>{label}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────
//  本土ゴール表示
// ─────────────────────────────────────────────────
function MainlandBox({ label, sub, color }: { label: string; sub: string; color: string }) {
  return (
    <div style={{
      border: `2px dashed ${color}`,
      borderRadius: 8,
      background: 'rgba(255,255,255,0.15)',
      padding: '6px 10px',
      textAlign: 'center',
      minWidth: 70,
    }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>{label}</div>
      <div style={{ fontSize: 7.5, color: 'rgba(255,255,255,0.8)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────
//  ピース分散ロジック（area → セルに均等配分）
// ─────────────────────────────────────────────────
function distributePieces(
  area: AreaState,
  townCells: number,  // 市街地マス数
): { res: number[]; tour: number[]; vuln: number[] } {
  const res = Array(townCells).fill(0);
  const tour = Array(townCells).fill(0);
  const vuln = Array(townCells).fill(0);
  for (let i = 0; i < area.residents; i++) res[i % townCells]++;
  for (let i = 0; i < area.tourists; i++) tour[i % townCells]++;
  for (let i = 0; i < area.vulnerable; i++) vuln[i % townCells]++;
  return { res, tour, vuln };
}

// ─────────────────────────────────────────────────
//  与那国島グリッド生成
// ─────────────────────────────────────────────────
function buildYonagunGrid(area: AreaState): GridCell[][] {
  const dist = distributePieces(area, 2);
  const town = (i: number): GridCell => ({ type: 'town', residents: dist.res[i], tourists: dist.tour[i], vulnerable: dist.vuln[i] });
  return [
    [town(0), town(1), { type: 'staging_air', label: '与那国空港' }, { type: 'staging_air' }],
    [{ type: 'empty' }, { type: 'empty' }, { type: 'staging_sea', label: '久部良港' }, { type: 'empty' }],
  ];
}

// ─────────────────────────────────────────────────
//  竹富町グリッド生成
// ─────────────────────────────────────────────────
function buildTaketomiGrid(area: AreaState): GridCell[][] {
  // 15コマを各島に配分: 西表6, 竹富2, 波照間3, 黒島2, 小浜2
  const total = area.residents + area.tourists + area.vulnerable;
  const ratio = (n: number) => (total > 0 ? n / 15 : 0);
  const sub = (base: number) => Math.round(total * ratio(base));

  // 各島の住民比率を近似
  const iriomoteR = Math.round(area.residents * 6 / 15);
  const iriomoteT = Math.round(area.tourists * 6 / 15);
  const iriomoteV = Math.round(area.vulnerable * 6 / 15);

  const takeR = Math.round(area.residents * 2 / 15);
  const takeT = Math.round(area.tourists * 2 / 15);
  const takeV = Math.round(area.vulnerable * 2 / 15);

  const hatR = Math.round(area.residents * 3 / 15);
  const hatT = Math.round(area.tourists * 3 / 15);
  const hatV = Math.round(area.vulnerable * 3 / 15);

  const kuroR = Math.round(area.residents * 2 / 15);
  const kuroT = Math.round(area.tourists * 2 / 15);
  const kuroV = Math.round(area.vulnerable * 2 / 15);

  void sub; void ratio;

  return [
    // 行1: 西表島
    [
      { type: 'label', label: '西表島' },
      { type: 'town', residents: Math.ceil(iriomoteR / 2), tourists: Math.ceil(iriomoteT / 2), vulnerable: Math.ceil(iriomoteV / 2) },
      { type: 'town', residents: Math.floor(iriomoteR / 2), tourists: Math.floor(iriomoteT / 2), vulnerable: Math.floor(iriomoteV / 2) },
      { type: 'staging_sea', label: '大原港' },
      { type: 'staging_sea', label: '上原港' },
    ],
    // 行2: 竹富島・黒島
    [
      { type: 'label', label: '竹富島' },
      { type: 'town', residents: takeR, tourists: takeT, vulnerable: takeV },
      { type: 'staging_sea', label: '竹富港' },
      { type: 'label', label: '黒島' },
      { type: 'town', residents: kuroR, tourists: kuroT, vulnerable: kuroV },
    ],
    // 行3: 波照間島 (空港あり)
    [
      { type: 'label', label: '波照間島' },
      { type: 'town', residents: Math.ceil(hatR / 2), tourists: Math.ceil(hatT / 2), vulnerable: Math.ceil(hatV / 2) },
      { type: 'town', residents: Math.floor(hatR / 2), tourists: Math.floor(hatT / 2), vulnerable: Math.floor(hatV / 2) },
      { type: 'staging_air', label: '波照間空港' },
      { type: 'staging_sea', label: '波照間港' },
    ],
  ];
}

// ─────────────────────────────────────────────────
//  石垣島グリッド生成
// ─────────────────────────────────────────────────
function buildIshigakiGrid(area: AreaState): GridCell[][] {
  // 43コマを 8×6グリッドに配分（空のマスは empty）
  const COLS = 8;
  const dist = distributePieces(area, 43);
  let idx = 0;

  const makeRow = (count: number): GridCell[] => {
    const row: GridCell[] = [];
    for (let c = 0; c < COLS; c++) {
      if (idx < 43 && c < count) {
        row.push({ type: 'town', residents: dist.res[idx], tourists: dist.tour[idx], vulnerable: dist.vuln[idx] });
        idx++;
      } else {
        row.push({ type: 'empty' });
      }
    }
    return row;
  };

  return [
    makeRow(8), // 8コマ
    makeRow(8), // 8コマ
    makeRow(8), // 8コマ
    makeRow(8), // 8コマ
    makeRow(8), // 8コマ
    makeRow(3), // 3コマ (残)
    // 待機マス行
    [
      { type: 'shelter', label: '中央運動\n公園' }, { type: 'shelter' },
      { type: 'staging_air', label: '新石垣空港' },
      { type: 'staging_air' }, { type: 'staging_air' }, { type: 'staging_air' }, { type: 'staging_air' }, { type: 'staging_air' },
    ],
    [
      { type: 'staging_sea', label: '石垣港' }, { type: 'staging_sea' }, { type: 'staging_sea' }, { type: 'staging_sea' },
      { type: 'empty' }, { type: 'empty' }, { type: 'empty' }, { type: 'empty' },
    ],
  ];
}

// ─────────────────────────────────────────────────
//  宮古島・多良間グリッド生成
// ─────────────────────────────────────────────────
function buildMiyakoGrid(area: AreaState): GridCell[][] {
  // 49コマ宮古 + 多良間 3コマ を 8×7グリッド
  const COLS = 8;
  const dist = distributePieces(area, 49);
  let idx = 0;

  const makeRow = (count: number): GridCell[] => {
    const row: GridCell[] = [];
    for (let c = 0; c < COLS; c++) {
      if (idx < 49 && c < count) {
        row.push({ type: 'town', residents: dist.res[idx], tourists: dist.tour[idx], vulnerable: dist.vuln[idx] });
        idx++;
      } else {
        row.push({ type: 'empty' });
      }
    }
    return row;
  };

  return [
    makeRow(8),
    makeRow(8),
    makeRow(8),
    makeRow(8),
    makeRow(8),
    makeRow(8),
    makeRow(1), // 残1
    // 多良間島
    [
      { type: 'label', label: '多良間島' },
      { type: 'town', residents: 0, tourists: 0, vulnerable: 0 },
      { type: 'town' },
      { type: 'staging_air', label: '多良間空港' },
      { type: 'staging_sea', label: '多良間港' },
      { type: 'empty' }, { type: 'empty' }, { type: 'empty' },
    ],
    // 下地島
    [
      { type: 'label', label: '下地島' },
      { type: 'town' }, { type: 'town' }, { type: 'town' },
      { type: 'staging_air', label: '下地島空港' }, { type: 'staging_air' }, { type: 'staging_air' },
      { type: 'empty' },
    ],
    // 待機マス
    [
      { type: 'shelter', label: 'JTAドーム' }, { type: 'shelter' },
      { type: 'staging_air', label: '宮古空港' },
      { type: 'staging_air' }, { type: 'staging_air' }, { type: 'staging_air' }, { type: 'staging_air' },
      { type: 'empty' },
    ],
    [
      { type: 'staging_sea', label: '平良港' }, { type: 'staging_sea' }, { type: 'staging_sea' },
      { type: 'empty' }, { type: 'empty' }, { type: 'empty' }, { type: 'empty' }, { type: 'empty' },
    ],
  ];
}

// ─────────────────────────────────────────────────
//  コマ凡例
// ─────────────────────────────────────────────────
function PieceLegend() {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '5px 10px', background: 'rgba(255,255,255,0.15)', borderRadius: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: '#fff' }}>コマ凡例:</span>
      {[
        { kind: 'r' as const, label: '住民' },
        { kind: 't' as const, label: '観光客' },
        { kind: 'v' as const, label: '要援護者' },
      ].map(({ kind, label }) => (
        <div key={kind} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <Piece kind={kind} size={14} />
          <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.9)' }}>{label}</span>
        </div>
      ))}
      <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.6)', marginLeft: 4 }}>
        ✈=空港待機  ⚓=港待機  🏠=避難所
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────
//  SimulationMap (main export)
// ─────────────────────────────────────────────────
export function SimulationMap({ areas }: Props) {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 768;
  const cellSize = isMobile ? 24 : 32;

  const yonaRows = buildYonagunGrid(areas.yonaguni);
  const takeRows = buildTaketomiGrid(areas.taketomi);
  const ishiRows = buildIshigakiGrid(areas.ishigaki);
  const miyaRows = buildMiyakoGrid(areas.miyako);

  return (
    <div style={{
      background: '#1e7ab8',
      backgroundImage: [
        'radial-gradient(ellipse at 20% 50%, rgba(30,58,138,0.35) 0%, transparent 60%)',
        'radial-gradient(ellipse at 80% 50%, rgba(5,150,105,0.2) 0%, transparent 60%)',
        'repeating-linear-gradient(0deg,transparent,transparent 30px,rgba(255,255,255,0.03) 30px,rgba(255,255,255,0.03) 31px)',
        'repeating-linear-gradient(90deg,transparent,transparent 30px,rgba(255,255,255,0.03) 30px,rgba(255,255,255,0.03) 31px)',
      ].join(','),
      borderRadius: 10,
      border: '2px solid #1d4ed8',
      padding: isMobile ? 8 : 12,
      overflow: 'auto',
    }}>
      {/* タイトル */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
        <div style={{ fontSize: isMobile ? 11 : 13, fontWeight: 800, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.4)' }}>
          🗺 先島諸島 避難マップ
        </div>
        <PieceLegend />
      </div>

      {/* 本土ゴール（上段） */}
      <div style={{ display: 'flex', gap: isMobile ? 6 : 12, marginBottom: 8, justifyContent: 'space-around', flexWrap: 'wrap' }}>
        <MainlandBox label="✈ 福岡空港" sub="← 与那国・石垣 空路" color="#fbbf24" />
        <MainlandBox label="⚓ 鹿児島港" sub="← 石垣・宮古 海路" color="#f87171" />
        <MainlandBox label="✈ 鹿児島空港" sub="← 宮古 空路" color="#a78bfa" />
      </div>

      {/* ─── メインマップ行 ─── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'nowrap', overflowX: 'auto' }}>

        {/* 与那国島 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <IslandGrid
            title="与那国島"
            subtitle={`住${areas.yonaguni.residents} 観${areas.yonaguni.tourists} 要${areas.yonaguni.vulnerable}`}
            color="#16a34a"
            bgLight="#f0fdf4"
            bgDark="#15803d"
            rows={yonaRows}
            cellSize={cellSize}
          />
          {/* 疲労表示 */}
          <FatigueBar area={areas.yonaguni} color="#16a34a" />
        </div>

        {/* 矢印 → 竹富 */}
        <Arrow label="フェリー" />

        {/* 竹富町全島 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <IslandGrid
            title="竹富町全島"
            subtitle={`住${areas.taketomi.residents} 観${areas.taketomi.tourists} 要${areas.taketomi.vulnerable}`}
            color="#f97316"
            bgLight="#fff7ed"
            bgDark="#ea580c"
            rows={takeRows}
            cellSize={cellSize}
          />
          <FatigueBar area={areas.taketomi} color="#f97316" />
        </div>

        {/* 矢印 → 石垣 */}
        <Arrow label="フェリー/空路" />

        {/* 石垣島 (ハブ) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <IslandGrid
            title="石垣島 (ハブ)"
            subtitle={`住${areas.ishigaki.residents} 観${areas.ishigaki.tourists} 要${areas.ishigaki.vulnerable} 待${areas.ishigaki.stagingPort}`}
            color="#2563eb"
            bgLight="#eff6ff"
            bgDark="#1d4ed8"
            rows={ishiRows}
            cellSize={cellSize}
          />
          <FatigueBar area={areas.ishigaki} color="#2563eb" />
        </div>

        {/* 石垣↔宮古は独立 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
          <Arrow label="独立" />
        </div>

        {/* 宮古島・多良間 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <IslandGrid
            title="宮古島・多良間"
            subtitle={`住${areas.miyako.residents} 観${areas.miyako.tourists} 要${areas.miyako.vulnerable} 待${areas.miyako.stagingPort}`}
            color="#9333ea"
            bgLight="#faf5ff"
            bgDark="#7c3aed"
            rows={miyaRows}
            cellSize={cellSize}
          />
          <FatigueBar area={areas.miyako} color="#9333ea" />
        </div>

      </div>

      {/* ─── ルート凡例 ─── */}
      <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[
          { icon: '✈', label: '空路(民間)', color: '#818cf8' },
          { icon: '🛩', label: '空自輸送機', color: '#38bdf8' },
          { icon: '🚁', label: '陸自ヘリ', color: '#4ade80' },
          { icon: '⚓', label: '海自輸送艦', color: '#fb923c' },
          { icon: '🚢', label: '海上保安庁', color: '#f472b6' },
          { icon: '⛴', label: 'フェリー', color: '#86efac' },
        ].map(r => (
          <div key={r.label} style={{
            display: 'flex', alignItems: 'center', gap: 3,
            background: 'rgba(255,255,255,0.12)', borderRadius: 4, padding: '2px 6px',
          }}>
            <span style={{ fontSize: 10 }}>{r.icon}</span>
            <span style={{ fontSize: 8, color: r.color, fontWeight: 600 }}>{r.label}</span>
          </div>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: 8, color: 'rgba(255,255,255,0.5)' }}>
          ※ 要援護者は航空機使用不可（海路のみ）
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────
//  疲労バー（島ごと）
// ─────────────────────────────────────────────────
function FatigueBar({ area, color }: { area: AreaState; color: string }) {
  const eff = getEffectiveActions(area.baseActions, area.fatigue);
  const fatigueVal = Math.max(0, area.fatigue);
  const pct = area.baseActions > 0 ? Math.min(100, (fatigueVal / area.baseActions) * 100) : 0;

  return (
    <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 5, padding: '4px 6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontSize: 7.5, color: '#fff', fontWeight: 700 }}>疲労: {area.fatigue.toFixed(1)}</span>
        <span style={{ fontSize: 7.5, color: '#fff' }}>手数: {eff}/{area.baseActions}</span>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: pct > 75 ? '#dc2626' : pct > 40 ? '#f59e0b' : color,
          borderRadius: 2, transition: 'width 0.4s',
        }} />
      </div>
    </div>
  );
}
