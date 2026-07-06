// SimulationMap.tsx — マス目（board game grid）マップ
// 与那国 → 竹富町 → 石垣島(ハブ) → 宮古島・多良間 の配置を再現

import type { AreaId, AreaState, InfraState } from '../types';
import { handsByFatigue } from '../constants';
import { useWindowWidth } from '../hooks/useWindowWidth';

// ─────────────────────────────────────────────────
//  Design tokens
// ─────────────────────────────────────────────────
const C = {
  bgDeep:    '#060d18',
  bgPanel:   '#0d1b2a',
  bgCard:    '#112233',
  border:    '#1e3a5f',
  borderHi:  '#2a6496',
  green:     '#00ff88',
  amber:     '#ffb300',
  red:       '#ff3b3b',
  airYellow: '#ffd633',   // 🟡 空港
  seaBlue:   '#3b9eff',   // 🔵 海港
  airStage:  '#ff3b3b',   // 🔴 空港の待機場所
  seaStage:  '#ff9e3d',   // 🟠 海港の待機場所
  dimText:   '#4a7a9b',
  bodyText:  '#8eb8d4',
  brightText:'#c8e6f8',
  white:     '#e8f4ff',
  gridLine:  'rgba(0,255,136,0.06)',
} as const;

interface Props {
  areas: Record<AreaId, AreaState>;
  infra?: InfraState;
  selectedHour?: number;
}

type CellType = 'town' | 'airport' | 'seaport' | 'staging_air' | 'staging_sea' | 'shelter' | 'empty' | 'label';

interface GridCell {
  type: CellType;
  label?: string;
  residents?: number;
  tourists?: number;
  vulnerable?: number;
}

// ─────────────────────────────────────────────────
//  コマ（ピース）表示 — NATO-style rectangle tokens
// ─────────────────────────────────────────────────
function Piece({ kind, size = 14 }: { kind: 'r' | 't' | 'v'; size?: number }) {
  const cfg = {
    r: { bg: C.brightText, border: '#4a9fd4', label: '住' },
    t: { bg: C.amber,      border: '#996800', label: '観' },
    v: { bg: '#ff6b6b',    border: '#cc2222', label: '要' },
  }[kind];
  const w = Math.round(size * 1.2);
  const h = size;
  return (
    <div style={{
      width: w, height: h, borderRadius: 2,
      border: `1.5px solid ${cfg.border}`, background: cfg.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.max(5, size - 8), fontWeight: 900, color: '#111',
      flexShrink: 0, boxShadow: `0 0 4px ${cfg.border}55`,
      userSelect: 'none', fontFamily: 'monospace',
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

function Cell({ cell, islandColor, cellSize = 32 }: CellProps) {
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
        fontSize: 7, fontWeight: 700, color: islandColor,
        background: 'transparent', fontFamily: 'monospace',
      }}>{cell.label}</div>
    );
  }

  const isAirport    = cell.type === 'airport';
  const isSeaport    = cell.type === 'seaport';
  const isStagingAir = cell.type === 'staging_air';
  const isStagingSea = cell.type === 'staging_sea';
  const isShelter    = cell.type === 'shelter';
  // 施設・待機マスは円形（PDF準拠）。待機マスは点線。
  const isFacility   = isAirport || isSeaport;
  const isRound      = isFacility || isStagingAir || isStagingSea;

  // PDF配色: 🟡空港 / 🔵海港 / 🔴空港待機 / 🟠海港待機
  const accent = isAirport ? C.airYellow
    : isSeaport    ? C.seaBlue
    : isStagingAir ? C.airStage
    : isStagingSea ? C.seaStage
    : isShelter    ? C.amber
    : islandColor;

  const bg = isAirport ? 'rgba(255,214,51,0.14)'
    : isSeaport    ? 'rgba(59,158,255,0.14)'
    : isStagingAir ? 'rgba(255,59,59,0.14)'
    : isStagingSea ? 'rgba(255,158,61,0.14)'
    : isShelter    ? '#1a1000'
    : C.bgPanel;

  const borderColor = accent;

  const icon = (isAirport || isStagingAir) ? '✈' : (isSeaport || isStagingSea) ? '⚓' : isShelter ? '🏠' : null;

  const totalPieces = (cell.residents ?? 0) + (cell.tourists ?? 0) + (cell.vulnerable ?? 0);
  const pieceSize = cellSize <= 20 ? 8 : 10;

  return (
    <div style={{
      width: CELL, height: CELL, flexShrink: 0,
      border: `1.5px ${(isStagingAir || isStagingSea || isShelter) ? 'dashed' : 'solid'} ${borderColor}`,
      background: bg,
      borderRadius: isRound ? '50%' : 3,
      boxShadow: isFacility ? `0 0 6px ${accent}66` : 'none',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {icon && (
        <span style={{ fontSize: cellSize <= 20 ? 7 : 9, lineHeight: 1, marginBottom: 1 }}>{icon}</span>
      )}
      {cell.label && (
        <span style={{
          fontSize: cellSize <= 20 ? 4.5 : 5.5, color: borderColor,
          fontWeight: 700, textAlign: 'center', lineHeight: 1.1,
          maxWidth: CELL - 2, fontFamily: 'monospace',
        }}>
          {cell.label}
        </span>
      )}
      {totalPieces > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center', marginTop: cell.label ? 0 : 1 }}>
          {Array.from({ length: Math.min(cell.residents ?? 0, 2) }, (_, i) => <Piece key={`r${i}`} kind="r" size={pieceSize} />)}
          {Array.from({ length: Math.min(cell.tourists ?? 0, 1) }, (_, i) => <Piece key={`t${i}`} kind="t" size={pieceSize} />)}
          {Array.from({ length: Math.min(cell.vulnerable ?? 0, 1) }, (_, i) => <Piece key={`v${i}`} kind="v" size={pieceSize} />)}
          {totalPieces > 4 && <span style={{ fontSize: 6, fontWeight: 700, color: C.amber, fontFamily: 'monospace' }}>+{totalPieces - 4}</span>}
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
  color: string;
  bgLight: string;
  bgDark: string;
  rows: GridCell[][];
  cellSize?: number;
  compact?: boolean;
}

function IslandGrid({ title, subtitle, color, rows, cellSize = 32, compact = false }: IslandGridProps) {
  const GAP = 2;
  return (
    <div style={{
      border: `1px solid ${C.border}`,
      borderLeft: `4px solid ${color}`,
      borderRadius: 4,
      overflow: 'hidden',
      background: C.bgPanel,
      flexShrink: 0,
      width: '100%',
    }}>
      {/* ヘッダー */}
      <div style={{
        background: C.bgCard, padding: compact ? '3px 6px' : '4px 8px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{
          fontSize: compact ? 10 : 11, fontWeight: 800, color: color,
          fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase',
        }}>{title}</div>
        {subtitle && <div style={{ fontSize: 7, color: C.dimText, fontFamily: 'monospace' }}>{subtitle}</div>}
      </div>
      {/* グリッド */}
      <div style={{ padding: compact ? 4 : 6, display: 'flex', flexDirection: 'column', gap: GAP, background: C.bgPanel }}>
        {rows.map((row, ri) => (
          <div key={ri} style={{ display: 'flex', gap: GAP }}>
            {row.map((cell, ci) => (
              <Cell key={ci} cell={cell} islandColor={color} islandBgLight={C.bgCard} cellSize={cellSize} />
            ))}
          </div>
        ))}
      </div>
      {/* 凡例（コンパクト時は省略） */}
      {!compact && (
        <div style={{ padding: '3px 6px', background: C.bgDeep, display: 'flex', gap: 5, flexWrap: 'wrap', borderTop: `1px solid ${C.border}` }}>
          {[
            { border: C.borderHi,  label: '市街地', dashed: false, round: false },
            { border: C.airYellow, label: '空港',   dashed: false, round: true },
            { border: C.seaBlue,   label: '海港',   dashed: false, round: true },
            { border: C.airStage,  label: '空港待機', dashed: true,  round: true },
            { border: C.seaStage,  label: '海港待機', dashed: true,  round: true },
          ].map(leg => (
            <div key={leg.label} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <div style={{
                width: 8, height: 8, border: `1.5px ${leg.dashed ? 'dashed' : 'solid'} ${leg.border}`,
                background: 'transparent', borderRadius: leg.round ? '50%' : 2,
              }} />
              <span style={{ fontSize: 7, color: C.dimText, fontFamily: 'monospace' }}>{leg.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────
//  矢印コネクタ
// ─────────────────────────────────────────────────
function Arrow({ label, vertical = false, compact = false }: { label: string; vertical?: boolean; compact?: boolean }) {
  if (vertical) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 4, padding: compact ? '2px 4px' : '4px 8px',
        background: `${C.green}11`, borderRadius: 4, border: `1px solid ${C.green}33`,
      }}>
        <span style={{ fontSize: compact ? 14 : 18, color: C.green, fontWeight: 900 }}>▼</span>
        <span style={{ fontSize: compact ? 7 : 8, color: C.green, fontWeight: 700, fontFamily: 'monospace' }}>{label}</span>
      </div>
    );
  }
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 2, padding: '0 2px', flexShrink: 0,
    }}>
      <span style={{ fontSize: compact ? 16 : 20, color: C.green, fontWeight: 900 }}>▶</span>
      <span style={{ fontSize: 7, color: C.green, fontWeight: 700, textAlign: 'center', maxWidth: 40, fontFamily: 'monospace' }}>{label}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────
//  本土ゴール表示
// ─────────────────────────────────────────────────
function MainlandBox({ label, sub, compact = false }: { label: string; sub: string; color: string; compact?: boolean }) {
  return (
    <div style={{
      border: `2px dashed ${C.amber}`,
      borderRadius: 4,
      background: '#110900',
      padding: compact ? '4px 6px' : '6px 10px',
      textAlign: 'center',
      flex: 1,
      minWidth: 0,
    }}>
      <div style={{
        fontSize: compact ? 9 : 10, fontWeight: 800, color: C.amber,
        fontFamily: 'monospace', whiteSpace: 'nowrap', letterSpacing: 1,
      }}>{label}</div>
      {!compact && <div style={{ fontSize: 7.5, color: C.dimText, marginTop: 2, fontFamily: 'monospace' }}>{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────
//  コマ凡例
// ─────────────────────────────────────────────────
function PieceLegend({ compact = false }: { compact?: boolean }) {
  return (
    <div style={{
      display: 'flex', gap: compact ? 6 : 10, alignItems: 'center',
      padding: compact ? '3px 6px' : '5px 10px',
      background: C.bgCard, borderRadius: 4,
      border: `1px solid ${C.border}`,
      flexWrap: 'wrap',
    }}>
      {!compact && <span style={{ fontSize: 9, fontWeight: 700, color: C.dimText, fontFamily: 'monospace' }}>UNIT:</span>}
      {[
        { kind: 'r' as const, label: '住民' },
        { kind: 't' as const, label: '観光客' },
        { kind: 'v' as const, label: '要援護者' },
      ].map(({ kind, label }) => (
        <div key={kind} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <Piece kind={kind} size={compact ? 12 : 14} />
          <span style={{ fontSize: compact ? 8 : 8, color: C.bodyText, fontFamily: 'monospace' }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────
//  疲労バー — military health bar
// ─────────────────────────────────────────────────
function FatigueBar({ area, compact = false }: { area: AreaState; color?: string; compact?: boolean }) {
  const eff = handsByFatigue(area.id, area.fatigue);
  // バーは島別手数テーブル基準（手数が減るほど疲労度=充填率が上がる）。ACT表示と一致させる。
  const lostRatio = area.baseActions > 0 ? Math.max(0, Math.min(1, 1 - eff / area.baseActions)) : 0;
  const pct = lostRatio * 100;
  const barColor = eff <= 0 ? C.red : pct > 50 ? C.amber : C.green;

  return (
    <div style={{
      background: C.bgCard, borderRadius: 3, padding: compact ? '3px 5px' : '4px 6px',
      border: `1px solid ${C.border}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontSize: 7, color: C.dimText, fontWeight: 700, fontFamily: 'monospace' }}>
          STAMINA
        </span>
        <span style={{ fontSize: 7, color: C.bodyText, fontFamily: 'monospace' }}>
          ACT {eff}/{area.baseActions} | FAT {area.fatigue.toFixed(1)}
        </span>
      </div>
      <div style={{ height: 4, background: C.bgDeep, borderRadius: 2, overflow: 'hidden', border: `1px solid ${C.border}` }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: barColor,
          borderRadius: 2, transition: 'width 0.4s',
          boxShadow: `0 0 6px ${barColor}88`,
        }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────
//  ピース分散ロジック
// ─────────────────────────────────────────────────
function distributePieces(area: AreaState, townCells: number): { res: number[]; tour: number[]; vuln: number[] } {
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
    [town(0), town(1), { type: 'airport', label: '与那国空港' }, { type: 'staging_air' }],
    [{ type: 'empty' }, { type: 'empty' }, { type: 'seaport', label: '久部良港' }, { type: 'empty' }],
  ];
}

// ─────────────────────────────────────────────────
//  竹富町グリッド生成
// ─────────────────────────────────────────────────
function buildTaketomiGrid(area: AreaState): GridCell[][] {
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

  return [
    [
      { type: 'label', label: '西表島' },
      { type: 'town', residents: Math.ceil(iriomoteR / 2), tourists: Math.ceil(iriomoteT / 2), vulnerable: Math.ceil(iriomoteV / 2) },
      { type: 'town', residents: Math.floor(iriomoteR / 2), tourists: Math.floor(iriomoteT / 2), vulnerable: Math.floor(iriomoteV / 2) },
      { type: 'seaport', label: '大原港' },
      { type: 'seaport', label: '上原港' },
    ],
    [
      { type: 'label', label: '竹富島' },
      { type: 'town', residents: takeR, tourists: takeT, vulnerable: takeV },
      { type: 'seaport', label: '竹富港' },
      { type: 'label', label: '黒島' },
      { type: 'town', residents: kuroR, tourists: kuroT, vulnerable: kuroV },
    ],
    [
      { type: 'label', label: '波照間' },
      { type: 'town', residents: Math.ceil(hatR / 2), tourists: Math.ceil(hatT / 2), vulnerable: Math.ceil(hatV / 2) },
      { type: 'town', residents: Math.floor(hatR / 2), tourists: Math.floor(hatT / 2), vulnerable: Math.floor(hatV / 2) },
      { type: 'airport', label: '波照間空港' },
      { type: 'seaport', label: '波照間港' },
    ],
  ];
}

// ─────────────────────────────────────────────────
//  石垣島グリッド生成（列数可変）
// ─────────────────────────────────────────────────
function buildIshigakiGrid(area: AreaState, cols: number = 8): GridCell[][] {
  const dist = distributePieces(area, 43);
  let idx = 0;

  const makeRow = (count: number): GridCell[] => {
    const row: GridCell[] = [];
    for (let c = 0; c < cols; c++) {
      if (idx < 43 && c < count) {
        row.push({ type: 'town', residents: dist.res[idx], tourists: dist.tour[idx], vulnerable: dist.vuln[idx] });
        idx++;
      } else {
        row.push({ type: 'empty' });
      }
    }
    return row;
  };

  const fullRows = Math.floor(43 / cols);
  const remainder = 43 % cols;
  const rows: GridCell[][] = [];
  for (let i = 0; i < fullRows; i++) rows.push(makeRow(cols));
  if (remainder > 0) rows.push(makeRow(remainder));

  // 空港・港待機行（列数に合わせる）
  const airportRow: GridCell[] = [
    { type: 'shelter', label: '中央運動公園' },
    { type: 'airport', label: '新石垣空港' },
  ];
  for (let c = 2; c < Math.min(cols, 6); c++) airportRow.push({ type: 'staging_air' });
  while (airportRow.length < cols) airportRow.push({ type: 'empty' });
  rows.push(airportRow);

  const seaRow: GridCell[] = [{ type: 'seaport', label: '石垣港' }];
  for (let c = 1; c < Math.min(cols, 4); c++) seaRow.push({ type: 'staging_sea' });
  while (seaRow.length < cols) seaRow.push({ type: 'empty' });
  rows.push(seaRow);

  return rows;
}

// ─────────────────────────────────────────────────
//  宮古島・多良間グリッド生成（列数可変）
// ─────────────────────────────────────────────────
function buildMiyakoGrid(area: AreaState, cols: number = 8): GridCell[][] {
  const dist = distributePieces(area, 49);
  let idx = 0;

  const makeRow = (count: number): GridCell[] => {
    const row: GridCell[] = [];
    for (let c = 0; c < cols; c++) {
      if (idx < 49 && c < count) {
        row.push({ type: 'town', residents: dist.res[idx], tourists: dist.tour[idx], vulnerable: dist.vuln[idx] });
        idx++;
      } else {
        row.push({ type: 'empty' });
      }
    }
    return row;
  };

  const fullRows = Math.floor(49 / cols);
  const remainder = 49 % cols;
  const rows: GridCell[][] = [];
  for (let i = 0; i < fullRows; i++) rows.push(makeRow(cols));
  if (remainder > 0) rows.push(makeRow(remainder));

  // 多良間島
  const taramaRow: GridCell[] = [
    { type: 'label', label: '多良間島' },
    { type: 'town' }, { type: 'town' },
    { type: 'airport', label: '多良間空港' },
    { type: 'seaport', label: '多良間港' },
  ];
  while (taramaRow.length < cols) taramaRow.push({ type: 'empty' });
  rows.push(taramaRow);

  // 下地島
  const shimojiRow: GridCell[] = [
    { type: 'label', label: '下地島' },
    { type: 'town' }, { type: 'town' },
    { type: 'airport', label: '下地島空港' },
    { type: 'staging_air' },
  ];
  while (shimojiRow.length < cols) shimojiRow.push({ type: 'empty' });
  rows.push(shimojiRow);

  // 宮古空港・平良港
  const airportRow: GridCell[] = [
    { type: 'shelter', label: 'JTAドーム' },
    { type: 'airport', label: '宮古空港' },
  ];
  for (let c = 2; c < Math.min(cols, 6); c++) airportRow.push({ type: 'staging_air' });
  while (airportRow.length < cols) airportRow.push({ type: 'empty' });
  rows.push(airportRow);

  const seaRow: GridCell[] = [{ type: 'seaport', label: '平良港' }];
  for (let c = 1; c < Math.min(cols, 3); c++) seaRow.push({ type: 'staging_sea' });
  while (seaRow.length < cols) seaRow.push({ type: 'empty' });
  rows.push(seaRow);

  return rows;
}

// ─────────────────────────────────────────────────
//  島カード（モバイル縦積み用ラッパー）
// ─────────────────────────────────────────────────
interface IslandCardProps {
  area: AreaState;
  title: string;
  subtitle: string;
  color: string;
  bgLight: string;
  bgDark: string;
  rows: GridCell[][];
  cellSize: number;
  compact: boolean;
}

function IslandCard({ area, title, subtitle, color, bgLight, bgDark, rows, cellSize, compact }: IslandCardProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: '100%' }}>
      <IslandGrid
        title={title}
        subtitle={subtitle}
        color={color}
        bgLight={bgLight}
        bgDark={bgDark}
        rows={rows}
        cellSize={cellSize}
        compact={compact}
      />
      <FatigueBar area={area} color={color} compact={compact} />
    </div>
  );
}

// ─────────────────────────────────────────────────
//  SimulationMap (main export)
// ─────────────────────────────────────────────────
export function SimulationMap({ areas, infra }: Props) {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 768;
  const isSmall = windowWidth < 480;

  // セルサイズ: 小画面ほど小さく
  const cellSize = isSmall ? 18 : isMobile ? 22 : 28;
  // グリッド列数: モバイルは4列、デスクトップは8列
  const gridCols = isMobile ? 4 : 8;

  const yonaRows = buildYonagunGrid(areas.yonaguni);
  const takeRows = buildTaketomiGrid(areas.taketomi);
  const ishiRows = buildIshigakiGrid(areas.ishigaki, gridCols);
  const miyaRows = buildMiyakoGrid(areas.miyako, gridCols);

  // Island color assignments — tactical palette
  const yonaColor  = '#00cc66';
  const takeColor  = C.amber;
  const ishiColor  = '#4a9fd4';
  const miyaColor  = '#cc66ff';

  return (
    <div style={{
      background: C.bgDeep,
      backgroundImage: [
        `repeating-linear-gradient(0deg, transparent, transparent 29px, ${C.gridLine} 29px, ${C.gridLine} 30px)`,
        `repeating-linear-gradient(90deg, transparent, transparent 29px, ${C.gridLine} 29px, ${C.gridLine} 30px)`,
      ].join(','),
      borderRadius: 6,
      border: `2px solid ${C.border}`,
      padding: isMobile ? 8 : 12,
      overflow: 'hidden',
    }}>

      {/* タイトル + 凡例 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 4 }}>
        <div style={{
          fontSize: isMobile ? 11 : 13, fontWeight: 800, color: C.brightText,
          fontFamily: 'monospace', letterSpacing: 2, textTransform: 'uppercase',
          textShadow: `0 0 8px ${C.green}55`,
        }}>
          🗺 TACTICAL MAP — 先島諸島
        </div>
        <PieceLegend compact={isMobile} />
      </div>

      {/* 本土ゴール */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <MainlandBox label="✈ 福岡" sub="与那国・石垣 空路" color={C.amber} compact={isMobile} />
        <MainlandBox label="⚓ 鹿児島" sub="石垣・宮古 海路" color={C.amber} compact={isMobile} />
        <MainlandBox label="✈ 鹿児島" sub="宮古 空路" color={C.amber} compact={isMobile} />
      </div>

      {/* ─── レイアウト分岐 ─── */}
      {isMobile ? (
        /* モバイル: 縦積み */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* 与那国 */}
          <IslandCard
            area={areas.yonaguni}
            title="与那国島"
            subtitle={`住${areas.yonaguni.residents} 観${areas.yonaguni.tourists} 要${areas.yonaguni.vulnerable}`}
            color={yonaColor} bgLight={C.bgPanel} bgDark={C.bgCard}
            rows={yonaRows} cellSize={cellSize} compact={isSmall}
          />
          <Arrow label="フェリー → 石垣" vertical={true} compact={isSmall} />

          {/* 竹富 */}
          <IslandCard
            area={areas.taketomi}
            title="竹富町全島"
            subtitle={`住${areas.taketomi.residents} 観${areas.taketomi.tourists} 要${areas.taketomi.vulnerable}`}
            color={takeColor} bgLight={C.bgPanel} bgDark={C.bgCard}
            rows={takeRows} cellSize={cellSize} compact={isSmall}
          />
          <Arrow label="フェリー/空路 → 石垣" vertical={true} compact={isSmall} />

          {/* 石垣 */}
          <IslandCard
            area={areas.ishigaki}
            title="石垣島（ハブ）"
            subtitle={`住${areas.ishigaki.residents} 観${areas.ishigaki.tourists} 要${areas.ishigaki.vulnerable} 待${areas.ishigaki.stagingPort}`}
            color={ishiColor} bgLight={C.bgPanel} bgDark={C.bgCard}
            rows={ishiRows} cellSize={cellSize} compact={isSmall}
          />
          <Arrow label="独立ルート" vertical={true} compact={isSmall} />

          {/* 宮古 */}
          <IslandCard
            area={areas.miyako}
            title="宮古島・多良間"
            subtitle={`住${areas.miyako.residents} 観${areas.miyako.tourists} 要${areas.miyako.vulnerable} 待${areas.miyako.stagingPort}`}
            color={miyaColor} bgLight={C.bgPanel} bgDark={C.bgCard}
            rows={miyaRows} cellSize={cellSize} compact={isSmall}
          />
        </div>
      ) : (
        /* デスクトップ: 横並び */
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, overflowX: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
            <IslandGrid
              title="与那国島"
              subtitle={`住${areas.yonaguni.residents} 観${areas.yonaguni.tourists} 要${areas.yonaguni.vulnerable}`}
              color={yonaColor} bgLight={C.bgPanel} bgDark={C.bgCard}
              rows={yonaRows} cellSize={cellSize}
            />
            <FatigueBar area={areas.yonaguni} color={yonaColor} />
          </div>

          <Arrow label="フェリー" />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
            <IslandGrid
              title="竹富町全島"
              subtitle={`住${areas.taketomi.residents} 観${areas.taketomi.tourists} 要${areas.taketomi.vulnerable}`}
              color={takeColor} bgLight={C.bgPanel} bgDark={C.bgCard}
              rows={takeRows} cellSize={cellSize}
            />
            <FatigueBar area={areas.taketomi} color={takeColor} />
          </div>

          <Arrow label="フェリー/空路" />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
            <IslandGrid
              title="石垣島（ハブ）"
              subtitle={`住${areas.ishigaki.residents} 観${areas.ishigaki.tourists} 要${areas.ishigaki.vulnerable} 待${areas.ishigaki.stagingPort}`}
              color={ishiColor} bgLight={C.bgPanel} bgDark={C.bgCard}
              rows={ishiRows} cellSize={cellSize}
            />
            <FatigueBar area={areas.ishigaki} color={ishiColor} />
          </div>

          <Arrow label="独立" />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
            <IslandGrid
              title="宮古島・多良間"
              subtitle={`住${areas.miyako.residents} 観${areas.miyako.tourists} 要${areas.miyako.vulnerable} 待${areas.miyako.stagingPort}`}
              color={miyaColor} bgLight={C.bgPanel} bgDark={C.bgCard}
              rows={miyaRows} cellSize={cellSize}
            />
            <FatigueBar area={areas.miyako} color={miyaColor} />
          </div>
        </div>
      )}

      {/* ルート凡例（モバイルは省略） */}
      {!isSmall && (
        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { icon: '✈', label: '空路(民間)', color: '#818cf8' },
            { icon: '🛩', label: '空自輸送機', color: '#38bdf8' },
            { icon: '🚁', label: '陸自ヘリ',  color: C.green },
            { icon: '⚓', label: '海自輸送艦', color: C.amber },
            { icon: '🚢', label: '海保',       color: '#f472b6' },
            { icon: '⛴', label: 'フェリー',   color: C.bodyText },
          ].map(r => (
            <div key={r.label} style={{
              display: 'flex', alignItems: 'center', gap: 2,
              background: C.bgCard, borderRadius: 4, padding: '2px 6px',
              border: `1px solid ${C.border}`,
            }}>
              <span style={{ fontSize: 9 }}>{r.icon}</span>
              <span style={{ fontSize: 7, color: r.color, fontWeight: 600, fontFamily: 'monospace' }}>{r.label}</span>
            </div>
          ))}
          <div style={{ marginLeft: 'auto', fontSize: 7, color: C.dimText, fontFamily: 'monospace' }}>
            ※ 要援護者は海路のみ
          </div>
        </div>
      )}

      {/* 橋ステータス（宮古圏：池間・来間・伊良部/下地） */}
      {infra && (
        <div style={{
          marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          background: C.bgPanel, border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 8px',
        }}>
          <span style={{ fontSize: 8, color: C.dimText, fontFamily: 'monospace', letterSpacing: 1 }}>🌉 宮古圏の橋</span>
          {[
            { ok: infra.bridgeIkema, label: '池間大橋' },
            { ok: infra.bridgeKurima, label: '来間大橋' },
            { ok: infra.bridgeIrabu, label: '伊良部大橋(→下地島空港)' },
          ].map(b => (
            <div key={b.label} style={{
              display: 'flex', alignItems: 'center', gap: 3,
              background: b.ok ? 'rgba(0,255,136,0.08)' : 'rgba(255,59,59,0.12)',
              border: `1px solid ${b.ok ? 'rgba(0,255,136,0.4)' : C.red}`,
              borderRadius: 3, padding: '2px 6px',
            }}>
              <span style={{ fontSize: 9 }}>{b.ok ? '🌉' : '🚧'}</span>
              <span style={{ fontSize: 8, fontWeight: 700, fontFamily: 'monospace', color: b.ok ? C.green : C.red }}>
                {b.label}{b.ok ? '' : ' 崩落・通行不可'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
