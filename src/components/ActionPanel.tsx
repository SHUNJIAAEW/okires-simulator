import { useState, useMemo, useCallback } from 'react';
import type { DayPhase1Result, EvacuationOrder, AreaId, AreaState } from '../types';
import { getEffectiveActions, ROUTE_SCHEDULES } from '../constants';
import { useWindowWidth } from '../hooks/useWindowWidth';

interface Props {
  phase1: DayPhase1Result;
  onExecute: (orders: EvacuationOrder[]) => void;
  onAutoExecute: () => void;
}

type PieceType = 'resident' | 'tourist' | 'vulnerable';

const PC: Record<PieceType, { fill: string; stroke: string; label: string }> = {
  resident:   { fill: '#ffffff', stroke: '#555',    label: '住' },
  tourist:    { fill: '#fde68a', stroke: '#d97706', label: '観' },
  vulnerable: { fill: '#93c5fd', stroke: '#1d4ed8', label: '要' },
};

const AREA_IDS: AreaId[] = ['yonaguni', 'taketomi', 'ishigaki', 'miyako'];

interface RouteInfo {
  key: string; label: string; icon: string; dest: string;
  trackColor: string; borderColor: string; textColor: string;
  available: boolean; maxCount: number;
  allowsVulnerable: boolean; phaseRequired: string;
  scheduleLabel: string;    // 出発時刻の表示ラベル (例: "8・12・16時")
  departureTimes: number[]; // 実際の出発時刻 (0-23) — シミュレーション用
}

// 1日の手数 = effectiveActions × 24時間
// 割り当てた1コマ = 1手数消費、1時間ごとにeffectiveActionsまで回復

// ── 1時間ごとシミュレーション ──
interface HourMove { areaId: AreaId; routeKey: string; count: number; staminaBefore: number; staminaAfter: number; }
interface HourEntry { hour: number; moves: HourMove[]; recoveries: Partial<Record<AreaId, number>>; }

function simulateHourly(
  assign: Record<string, number>,
  routes: Record<AreaId, RouteInfo[]>,
  areas: Record<AreaId, AreaState>,
): HourEntry[] {
  const remaining: Record<string, number> = { ...assign };
  const stamina: Partial<Record<AreaId, number>> = {};
  for (const aid of AREA_IDS) {
    stamina[aid] = getEffectiveActions(areas[aid].baseActions, areas[aid].fatigue);
  }

  const log: HourEntry[] = [];

  for (let h = 0; h < 24; h++) {
    const totalLeft = Object.values(remaining).reduce((s, v) => s + v, 0);
    if (totalLeft === 0) break;

    const entry: HourEntry = { hour: h, moves: [], recoveries: {} };

    // 手数回復（2時間目以降）
    if (h > 0) {
      for (const aid of AREA_IDS) {
        const eff = getEffectiveActions(areas[aid].baseActions, areas[aid].fatigue);
        stamina[aid] = eff;
        entry.recoveries[aid] = eff;
      }
    }

    // 各島のルートを処理 (出発時刻に一致するルートのみ)
    for (const aid of AREA_IDS) {
      let stam = stamina[aid] ?? 0;
      for (const route of routes[aid].filter(r => r.available && r.departureTimes.includes(h))) {
        const toMove = Math.min(remaining[route.key] ?? 0, stam);
        if (toMove > 0) {
          entry.moves.push({ areaId: aid, routeKey: route.key, count: toMove, staminaBefore: stam, staminaAfter: stam - toMove });
          remaining[route.key] = (remaining[route.key] ?? 0) - toMove;
          stam -= toMove;
        }
      }
      stamina[aid] = stam;
    }

    if (entry.moves.length > 0 || h === 0) log.push(entry);
  }

  return log;
}

// ─────────────────────────────────────────────────
//  コマ表示
// ─────────────────────────────────────────────────
function Koma({ type, size = 24 }: { type: PieceType; size?: number }) {
  const c = PC[type];
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      border: `2px solid ${c.stroke}`, background: c.fill,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size <= 20 ? 8 : 10, fontWeight: 900, color: '#222',
      flexShrink: 0, boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
      userSelect: 'none',
    }}>{c.label}</div>
  );
}

// 手数トラック（視覚）
function StaminaBar({ eff, used, compact }: { eff: number; used: number; compact?: boolean }) {
  const sq = compact ? 17 : 20;
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: '#374151', marginRight: 2 }}>手数</span>
      {Array.from({ length: eff }, (_, i) => {
        const isUsed = i < used;
        return (
          <div key={i} style={{
            width: sq, height: sq, borderRadius: 3,
            border: `2px solid ${isUsed ? '#dc2626' : '#2563eb'}`,
            background: isUsed ? '#fee2e2' : '#dbeafe',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontWeight: 700,
            color: isUsed ? '#dc2626' : '#1d4ed8',
          }}>{eff - i}</div>
        );
      })}
      {eff === 0 && <span style={{ fontSize: 9, color: '#9ca3af' }}>0（行動不能）</span>}
    </div>
  );
}

// ルート割り当てコントロール（+/-ボタン）
interface RouteControlProps {
  route: RouteInfo;
  assigned: number;
  maxAssignable: number;
  vulnerableInArea: number;
  onChange: (v: number) => void;
}
function RouteControl({ route, assigned, maxAssignable, vulnerableInArea, onChange }: RouteControlProps) {
  const unavail = !route.available;
  const bg = unavail ? 'rgba(240,242,248,0.7)' : route.trackColor;
  const border = unavail ? '#c0c8d8' : route.borderColor;
  const textC = unavail ? '#9ca3af' : route.textColor;

  return (
    <div style={{
      border: `2px dashed ${border}`,
      borderRadius: 6,
      background: bg,
      padding: '5px 8px',
      marginBottom: 5,
      opacity: unavail ? 0.6 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: textC }}>
          {route.icon} {route.label}
          {!route.allowsVulnerable && !unavail && <span style={{ fontSize: 8, color: '#ef4444', marginLeft: 3 }}>要援護不可</span>}
        </span>
        {unavail && <span style={{ fontSize: 9, color: '#9ca3af' }}>{route.phaseRequired}</span>}
      </div>
      {/* 要援護者警告 */}
      {!route.allowsVulnerable && !unavail && assigned > 0 && vulnerableInArea > 0 && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 4, padding: '2px 6px', marginBottom: 3, fontSize: 8, color: '#dc2626', fontWeight: 600 }}>
          ⚠ 要援護者{vulnerableInArea}コマはこのルートに含まれません（航空機使用不可）。海路ルートで別途避難させてください。
        </div>
      )}
      {!unavail && route.scheduleLabel && (
        <div style={{ fontSize: 8, color: '#6b7280', marginBottom: 4 }}>
          🕐 {route.scheduleLabel}
        </div>
      )}
      {!unavail && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* - ボタン */}
          <button
            onClick={() => onChange(Math.max(0, assigned - 1))}
            disabled={assigned === 0}
            style={{
              width: 28, height: 28, borderRadius: 4,
              border: '2px solid #d1d5db', background: assigned === 0 ? '#f3f4f6' : '#fff',
              fontSize: 16, fontWeight: 700, cursor: assigned === 0 ? 'default' : 'pointer',
              color: assigned === 0 ? '#d1d5db' : '#374151',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>−</button>

          {/* 割り当て数 / 最大 */}
          <div style={{ display: 'flex', gap: 2, minWidth: 120, flexWrap: 'wrap' }}>
            {Array.from({ length: Math.max(route.maxCount, assigned) }, (_, i) => {
              const filled = i < assigned;
              return (
                <div
                  key={i}
                  onClick={() => onChange(i < assigned ? i : i + 1)}
                  style={{
                    width: 26, height: 26, borderRadius: 4,
                    border: `2px solid ${filled ? route.borderColor : '#c8d0da'}`,
                    background: filled ? 'rgba(255,255,255,0.9)' : 'rgba(245,248,252,0.7)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer',
                    fontSize: 9, fontWeight: 700,
                    color: filled ? route.textColor : '#9ca3af',
                  }}
                >
                  {filled ? assigned - i <= 0 ? i + 1 : i + 1 : i + 1}
                </div>
              );
            })}
          </div>

          {/* + ボタン */}
          <button
            onClick={() => onChange(Math.min(maxAssignable, assigned + 1))}
            disabled={assigned >= maxAssignable}
            style={{
              width: 28, height: 28, borderRadius: 4,
              border: `2px solid ${assigned >= maxAssignable ? '#d1d5db' : route.borderColor}`,
              background: assigned >= maxAssignable ? '#f3f4f6' : route.trackColor,
              fontSize: 16, fontWeight: 700,
              cursor: assigned >= maxAssignable ? 'default' : 'pointer',
              color: assigned >= maxAssignable ? '#d1d5db' : route.textColor,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>＋</button>

          <span style={{ fontSize: 10, color: '#6b7280' }}>{assigned}/{route.maxCount}コマ</span>
        </div>
      )}
    </div>
  );
}

// 市中心部 コマ一覧（非インタラクティブ）
function PieceSummary({ area, compact }: { area: AreaState; compact?: boolean }) {
  const pieceSize = compact ? 22 : 26;
  const pieces: PieceType[] = [
    ...Array(area.residents).fill('resident' as PieceType),
    ...Array(area.tourists).fill('tourist' as PieceType),
    ...Array(area.vulnerable).fill('vulnerable' as PieceType),
  ];
  if (pieces.length === 0) return <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 700, padding: '4px 0' }}>✓ 避難完了</div>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, padding: '4px 6px', background: 'rgba(255,255,255,0.5)', border: '1.5px dashed rgba(0,0,0,0.15)', borderRadius: 5 }}>
      {pieces.map((t, i) => <Koma key={i} type={t} size={pieceSize} />)}
      <div style={{ width: '100%', fontSize: 9, color: '#555', marginTop: 2 }}>
        住民{area.residents} 観光{area.tourists} 要援護{area.vulnerable} = 計{area.residents + area.tourists + area.vulnerable}コマ
      </div>
    </div>
  );
}

// 島カード
interface IslandCardProps {
  areaId: AreaId; name: string; subLabel: string; borderColor: string; compact?: boolean;
  area: AreaState; routes: RouteInfo[];
  assign: Record<string, number>;
  pac3: boolean;
  onAssign: (routeKey: string, v: number) => void;
}
function IslandCard({ name, subLabel, borderColor, compact, area, routes, assign, pac3, onAssign }: IslandCardProps) {
  const eff = getEffectiveActions(area.baseActions, area.fatigue);
  const totalAssigned = routes.reduce((s, r) => s + (assign[r.key] || 0), 0);
  const staminaPerHour = eff;
  const hoursNeeded = staminaPerHour > 0 ? Math.ceil(totalAssigned / staminaPerHour) : (totalAssigned > 0 ? Infinity : 0);

  // 残コマ計算（種別ごと）
  const residentsLeft  = area.residents;
  const touristsLeft   = area.tourists;
  const vulnerableLeft = area.vulnerable;
  const totalLeft = residentsLeft + touristsLeft + vulnerableLeft;

  return (
    <div style={{ background: '#dde8a8', border: `2.5px solid ${borderColor}`, borderRadius: 8, padding: compact ? '7px 8px' : '9px 11px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: compact ? 12 : 14, fontWeight: 800, color: '#14532d', marginBottom: 1 }}>{name}</div>
      <div style={{ fontSize: 8, color: '#166534', marginBottom: 4 }}>{subLabel}</div>
      {pac3 && <div style={{ display: 'inline-block', background: '#1e40af', color: '#fff', fontSize: 8, padding: '1px 6px', borderRadius: 3, marginBottom: 4, width: 'fit-content' }}>PAC3配備</div>}

      {/* 手数トラック */}
      <div style={{ marginBottom: 5 }}>
        <StaminaBar eff={eff} used={Math.min(totalAssigned, eff)} compact={compact} />
        <div style={{ fontSize: 8, color: '#6b7280', marginTop: 2 }}>
          {totalAssigned === 0 ? '未割り当て'
            : hoursNeeded === Infinity ? '⚠ 手数0のため移動不可'
            : hoursNeeded === 1 ? `✓ 1時間で完了 (手数${totalAssigned}/${eff}消費)`
            : `⏱ 約${hoursNeeded}時間必要 (1時間あたり${eff}コマ移動)`}
        </div>
      </div>

      {/* ルートコントロール */}
      <div style={{ marginBottom: 5 }}>
        {routes.map(r => (
          <RouteControl
            key={r.key}
            route={r}
            assigned={assign[r.key] || 0}
            maxAssignable={Math.min(r.maxCount, totalLeft)}
            vulnerableInArea={vulnerableLeft}
            onChange={v => onAssign(r.key, v)}
          />
        ))}
      </div>

      {/* 市中心部 */}
      <div style={{ fontSize: 9, fontWeight: 700, color: '#1a3a00', marginBottom: 3 }}>
        市中心部 <span style={{ fontWeight: 400, color: '#6b7280', fontSize: 8 }}>残 {totalLeft}コマ</span>
      </div>
      <PieceSummary area={area} compact={compact} />
    </div>
  );
}

// 1時間ごとシミュレーションログ
interface SimLogProps {
  log: HourEntry[];
  routes: Record<AreaId, RouteInfo[]>;
  areas: Record<AreaId, AreaState>;
}
const AREA_NAME: Record<AreaId, string> = { yonaguni: '与那国', taketomi: '竹富町', ishigaki: '石垣', miyako: '宮古' };

function SimLog({ log, routes, areas }: SimLogProps) {
  if (log.length === 0) {
    return <div style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', padding: '12px 0' }}>ルートにコマを割り当てるとシミュレーションが表示されます</div>;
  }

  const allRoutes = AREA_IDS.flatMap(aid => routes[aid]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {log.map(entry => {
        const hasRecovery = Object.keys(entry.recoveries).length > 0;
        return (
          <div key={entry.hour}>
            {/* 時刻ヘッダー */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', background: '#1e293b', color: '#f1f5f9' }}>
              <span style={{ fontSize: 13, fontWeight: 900, fontFamily: 'monospace', color: '#38bdf8' }}>
                {String(entry.hour).padStart(2, '0')}:00
              </span>
              {hasRecovery && (
                <span style={{ fontSize: 10, color: '#4ade80', fontWeight: 600 }}>
                  ↺ 手数回復: {AREA_IDS.filter(aid => entry.recoveries[aid]).map(aid => `${AREA_NAME[aid]}${entry.recoveries[aid]}手数`).join(' ')}
                </span>
              )}
              {entry.moves.length === 0 && <span style={{ fontSize: 10, color: '#94a3b8' }}>移動なし</span>}
            </div>
            {/* 移動ログ */}
            {entry.moves.map((m, i) => {
              const route = allRoutes.find(r => r.key === m.routeKey);
              const eff = getEffectiveActions(areas[m.areaId].baseActions, areas[m.areaId].fatigue);
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 14px', background: i % 2 === 0 ? '#f8fafc' : '#f0f9ff', borderBottom: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', minWidth: 40 }}>{AREA_NAME[m.areaId]}</span>
                  <span style={{ fontSize: 11, color: route?.textColor ?? '#555', background: route?.trackColor ?? '#eee', padding: '1px 7px', borderRadius: 4, fontWeight: 600, border: `1px solid ${route?.borderColor ?? '#ccc'}` }}>
                    {route?.icon} {route?.label ?? m.routeKey}
                  </span>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {Array.from({ length: m.count }, (_, ci) => (
                      <div key={ci} style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', border: `2px solid ${route?.borderColor ?? '#555'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, fontWeight: 800, color: route?.textColor ?? '#555' }}>住</div>
                    ))}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#0f172a' }}>{m.count}コマ 出発</span>
                  {/* 手数バー */}
                  <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
                    <span style={{ fontSize: 9, color: '#6b7280', marginRight: 2 }}>手数</span>
                    {Array.from({ length: eff }, (_, i) => (
                      <div key={i} style={{
                        width: 12, height: 12, borderRadius: 2,
                        background: i < m.staminaAfter ? '#dbeafe' : i < m.staminaBefore ? '#fee2e2' : '#f3f4f6',
                        border: `1.5px solid ${i < m.staminaAfter ? '#3b82f6' : i < m.staminaBefore ? '#dc2626' : '#d1d5db'}`,
                      }} />
                    ))}
                    <span style={{ fontSize: 9, color: '#dc2626', marginLeft: 2 }}>−{m.count}</span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      {/* 完了サマリー */}
      <div style={{ padding: '8px 14px', background: '#f0fdf4', borderTop: '2px solid #86efac', fontSize: 12, color: '#15803d', fontWeight: 700 }}>
        ✓ シミュレーション完了 — 計{log.reduce((s, e) => s + e.moves.reduce((ss, m) => ss + m.count, 0), 0)}コマ、{log.length}時間で輸送
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  ActionPanel (main)
// ─────────────────────────────────────────────────────────────
export function ActionPanel({ phase1, onExecute, onAutoExecute }: Props) {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 768;
  const { stateAfterEvents: state, capacities: cap, hourlyRolls, eventLog, weatherSummary, newPhase } = phase1;
  const { areas } = state;

  const isWartime      = newPhase === 'wartime';
  const isCrisisOrMore = newPhase === 'crisis' || isWartime;
  const phaseLabel = newPhase === 'peacetime' ? '平時' : newPhase === 'crisis' ? '存立危機事態' : '有事';
  const phaseColor = newPhase === 'peacetime' ? '#22c55e' : newPhase === 'crisis' ? '#f59e0b' : '#dc2626';

  // ルート割り当て: routeKey → コマ数
  const [assign, setAssign] = useState<Record<string, number>>({});
  const [showLog, setShowLog] = useState(true);
  const [showHourly, setShowHourly] = useState(false);
  const [showEvents, setShowEvents] = useState(false);

  const handleAssign = useCallback((routeKey: string, v: number) => {
    setAssign(prev => ({ ...prev, [routeKey]: v }));
  }, []);

  const routes: Record<AreaId, RouteInfo[]> = useMemo(() => {
    // 与那国空路: 存立危機=8時固定, 有事=8・16時
    const yAirSchedule = isWartime
      ? ROUTE_SCHEDULES.yonaguni_air_wartime
      : ROUTE_SCHEDULES.yonaguni_air_crisis;

    return {
      yonaguni: [
        {
          key: 'y_air', label: '那覇経由 → 福岡空港', icon: '✈', dest: '福岡',
          trackColor: '#dbeafe', borderColor: '#3b82f6', textColor: '#1d4ed8',
          available: isCrisisOrMore && cap.yonaguniAirMax > 0,
          maxCount: Math.max(cap.yonaguniAirMax, 2),
          allowsVulnerable: false, phaseRequired: '存立危機事態以降',
          scheduleLabel: yAirSchedule.label,
          departureTimes: yAirSchedule.hours,
        },
        {
          key: 'y_sea', label: 'フェリー → 石垣島', icon: '⛴', dest: '石垣',
          trackColor: '#dcfce7', borderColor: '#16a34a', textColor: '#15803d',
          available: isCrisisOrMore && cap.seaOk && cap.yonaguniSeaMax > 0,
          maxCount: Math.max(cap.yonaguniSeaMax, 2),
          allowsVulnerable: true, phaseRequired: '存立危機事態以降',
          scheduleLabel: ROUTE_SCHEDULES.ferry_main.label,
          departureTimes: ROUTE_SCHEDULES.ferry_main.hours,
        },
      ],
      taketomi: [
        {
          key: 't_sea', label: 'フェリー → 石垣島', icon: '⛴', dest: '石垣',
          trackColor: '#dcfce7', borderColor: '#16a34a', textColor: '#15803d',
          available: isCrisisOrMore && cap.seaOk && cap.taketomiFerryMax > 0,
          maxCount: Math.max(cap.taketomiFerryMax, 3),
          allowsVulnerable: true, phaseRequired: '存立危機事態以降',
          scheduleLabel: ROUTE_SCHEDULES.ferry_main.label,
          departureTimes: ROUTE_SCHEDULES.ferry_main.hours,
        },
        {
          key: 't_air_hateruma', label: '波照間空港 → 那覇', icon: '✈', dest: '那覇',
          trackColor: '#fef3c7', borderColor: '#d97706', textColor: '#92400e',
          available: isWartime && (cap.airportAvail['hateruma'] ?? false) && cap.civilianAirOk && cap.prepLevel >= 4,
          maxCount: 1,
          allowsVulnerable: false, phaseRequired: '有事・Lv4以上',
          scheduleLabel: ROUTE_SCHEDULES.hateruma_air.label,
          departureTimes: ROUTE_SCHEDULES.hateruma_air.hours,
        },
        {
          key: 't_jgsdf', label: '陸自ヘリ → 島内移動', icon: '🚁', dest: '石垣',
          trackColor: '#d1fae5', borderColor: '#059669', textColor: '#065f46',
          available: isWartime && (cap.jgsdfRemaining ?? 0) > 0,
          maxCount: Math.max(cap.jgsdfRemaining ?? 0, 1),
          allowsVulnerable: true, phaseRequired: '有事以降',
          scheduleLabel: '随時',
          departureTimes: Array.from({ length: 24 }, (_, i) => i),
        },
      ],
      ishigaki: [
        {
          key: 'i_air', label: '新石垣 → 福岡', icon: '✈', dest: '福岡',
          trackColor: '#ede9fe', borderColor: '#7c3aed', textColor: '#6d28d9',
          available: isWartime && cap.civilianAirOk && cap.ishigakiAirMax > 0,
          maxCount: Math.max(cap.ishigakiAirMax, 4),
          allowsVulnerable: false, phaseRequired: '有事以降',
          scheduleLabel: ROUTE_SCHEDULES.shinishigaki_air.label,
          departureTimes: ROUTE_SCHEDULES.shinishigaki_air.hours,
        },
        {
          key: 'i_asdf', label: '空自輸送機 → 本土', icon: '🛩', dest: '本土',
          trackColor: '#e0f2fe', borderColor: '#0284c7', textColor: '#075985',
          available: isWartime && (cap.airportAvail['shinIshigaki'] ?? false) && (cap.ishigakiJasdfMax ?? 0) > 0,
          maxCount: Math.max(cap.ishigakiJasdfMax ?? 0, 1),
          allowsVulnerable: false, phaseRequired: '有事以降',
          scheduleLabel: ROUTE_SCHEDULES.asdf.label,
          departureTimes: ROUTE_SCHEDULES.asdf.hours,
        },
        {
          key: 'i_cg', label: '海上保安庁 → 鹿児島', icon: '🚢', dest: '鹿児島',
          trackColor: '#fce7f3', borderColor: '#be185d', textColor: '#9d174d',
          available: isWartime && cap.seaOk && cap.ishigakiCoastGuardMax > 0,
          maxCount: Math.max(cap.ishigakiCoastGuardMax, 3),
          allowsVulnerable: true, phaseRequired: '有事以降',
          scheduleLabel: ROUTE_SCHEDULES.coast_guard.label,
          departureTimes: ROUTE_SCHEDULES.coast_guard.hours,
        },
        {
          key: 'i_jms', label: '海自輸送艦 → 鹿児島', icon: '⚓', dest: '鹿児島',
          trackColor: '#ffedd5', borderColor: '#ea580c', textColor: '#c2410c',
          available: isWartime && cap.seaOk && cap.ishigakiJmsdfMax > 0,
          maxCount: Math.max(cap.ishigakiJmsdfMax, 3),
          allowsVulnerable: true, phaseRequired: '有事以降',
          scheduleLabel: ROUTE_SCHEDULES.jmsdf.label,
          departureTimes: ROUTE_SCHEDULES.jmsdf.hours,
        },
        {
          key: 'i_jgsdf', label: '陸自ヘリ → 島内移動', icon: '🚁', dest: '本土',
          trackColor: '#d1fae5', borderColor: '#059669', textColor: '#065f46',
          available: isWartime && (cap.jgsdfRemaining ?? 0) > 0,
          maxCount: Math.max(cap.jgsdfRemaining ?? 0, 1),
          allowsVulnerable: true, phaseRequired: '有事以降',
          scheduleLabel: '随時',
          departureTimes: Array.from({ length: 24 }, (_, i) => i),
        },
      ],
      miyako: [
        {
          key: 'm_air1', label: '宮古空港 → 鹿児島', icon: '✈', dest: '鹿児島',
          trackColor: '#ede9fe', borderColor: '#7c3aed', textColor: '#6d28d9',
          available: isWartime && cap.civilianAirOk && cap.airportAvail['miyako'] !== false && cap.miyakoAirMax > 0,
          maxCount: Math.max(cap.miyakoAirMax, 3),
          allowsVulnerable: false, phaseRequired: '有事以降',
          scheduleLabel: ROUTE_SCHEDULES.miyako_air.label,
          departureTimes: ROUTE_SCHEDULES.miyako_air.hours,
        },
        {
          key: 'm_air2', label: '下地島 → 鹿児島', icon: '✈', dest: '鹿児島',
          trackColor: '#f3e8ff', borderColor: '#9333ea', textColor: '#7e22ce',
          available: isWartime && cap.civilianAirOk && cap.airportAvail['shimoji'] !== false && cap.shimojAirMax > 0,
          maxCount: Math.max(cap.shimojAirMax, 3),
          allowsVulnerable: false, phaseRequired: '有事以降',
          scheduleLabel: ROUTE_SCHEDULES.shimoji_air.label,
          departureTimes: ROUTE_SCHEDULES.shimoji_air.hours,
        },
        {
          key: 'm_cg', label: '海上保安庁 → 鹿児島', icon: '🚢', dest: '鹿児島',
          trackColor: '#fce7f3', borderColor: '#be185d', textColor: '#9d174d',
          available: isWartime && cap.seaOk && cap.miyakoCoastGuardMax > 0,
          maxCount: Math.max(cap.miyakoCoastGuardMax, 3),
          allowsVulnerable: true, phaseRequired: '有事以降',
          scheduleLabel: ROUTE_SCHEDULES.coast_guard.label,
          departureTimes: ROUTE_SCHEDULES.coast_guard.hours,
        },
        {
          key: 'm_jms', label: '海自輸送艦 → 鹿児島', icon: '⚓', dest: '鹿児島',
          trackColor: '#ffedd5', borderColor: '#ea580c', textColor: '#c2410c',
          available: isWartime && cap.seaOk && cap.miyakoJmsdfMax > 0,
          maxCount: Math.max(cap.miyakoJmsdfMax, 3),
          allowsVulnerable: true, phaseRequired: '有事以降',
          scheduleLabel: ROUTE_SCHEDULES.jmsdf.label,
          departureTimes: ROUTE_SCHEDULES.jmsdf.hours,
        },
        {
          key: 'm_air_tarama', label: '多良間空港 → 宮古', icon: '✈', dest: '宮古',
          trackColor: '#ecfdf5', borderColor: '#059669', textColor: '#065f46',
          available: isWartime && (cap.airportAvail['tarama'] ?? false),
          maxCount: 1,
          allowsVulnerable: false, phaseRequired: '有事以降',
          scheduleLabel: ROUTE_SCHEDULES.tarama_air.label,
          departureTimes: ROUTE_SCHEDULES.tarama_air.hours,
        },
        {
          key: 'm_jgsdf', label: '陸自ヘリ → 島内移動', icon: '🚁', dest: '宮古',
          trackColor: '#d1fae5', borderColor: '#059669', textColor: '#065f46',
          available: isWartime && (cap.jgsdfRemaining ?? 0) > 0,
          maxCount: Math.max(cap.jgsdfRemaining ?? 0, 1),
          allowsVulnerable: true, phaseRequired: '有事以降',
          scheduleLabel: '随時',
          departureTimes: Array.from({ length: 24 }, (_, i) => i),
        },
      ],
    };
  }, [isCrisisOrMore, isWartime, cap]);

  // 1時間ごとシミュレーション
  const simLog = useMemo(() => simulateHourly(assign, routes, areas), [assign, routes, areas]);

  // 合計集計
  const totalMainland = ['y_air','i_air','i_asdf','i_cg','i_jms','m_air1','m_air2','m_cg','m_jms','t_air_hateruma','m_air_tarama'].reduce((s, k) => s + (assign[k] || 0), 0);
  const totalIshigaki = ['y_sea','t_sea','t_jgsdf','i_jgsdf','m_jgsdf'].reduce((s, k) => s + (assign[k] || 0), 0);
  const totalAll = Object.values(assign).reduce((s, v) => s + v, 0);

  const eventSpaceRolls = hourlyRolls.filter(r => r.isEventSpace);
  const triggeredEvents = hourlyRolls.filter(r => r.eventType !== null);

  // 航空ルート（要援護者不可）
  const AIR_ROUTES = new Set(['y_air', 'i_air', 'i_asdf', 'm_air1', 'm_air2', 't_air_hateruma', 'm_air_tarama']);

  // 実行オーダー生成
  const buildOrders = (): EvacuationOrder[] => {
    const rm: Record<string, { from: AreaId; to: 'mainland' | 'ishigaki'; method: string }> = {
      y_air:           { from: 'yonaguni', to: 'mainland', method: '与那国空港(民間)' },
      y_sea:           { from: 'yonaguni', to: 'ishigaki', method: 'フェリー' },
      t_sea:           { from: 'taketomi', to: 'ishigaki', method: '竹富→石垣フェリー' },
      t_air_hateruma:  { from: 'taketomi', to: 'mainland', method: '波照間空港(民間)' },
      t_jgsdf:         { from: 'taketomi', to: 'ishigaki', method: '陸自ヘリ' },
      i_air:           { from: 'ishigaki', to: 'mainland', method: '新石垣空港(民間)' },
      i_asdf:          { from: 'ishigaki', to: 'mainland', method: '空自輸送機' },
      i_cg:            { from: 'ishigaki', to: 'mainland', method: '海保輸送船' },
      i_jms:           { from: 'ishigaki', to: 'mainland', method: '海自輸送艦' },
      i_jgsdf:         { from: 'ishigaki', to: 'mainland', method: '陸自ヘリ' },
      m_air1:          { from: 'miyako',   to: 'mainland', method: '宮古空港(民間)' },
      m_air2:          { from: 'miyako',   to: 'mainland', method: '下地島空港(民間)' },
      m_cg:            { from: 'miyako',   to: 'mainland', method: '海保輸送船' },
      m_jms:           { from: 'miyako',   to: 'mainland', method: '海自輸送艦' },
      m_air_tarama:    { from: 'miyako',   to: 'mainland', method: '多良間空港(民間)' },
      m_jgsdf:         { from: 'miyako',   to: 'mainland', method: '陸自ヘリ' },
    };
    return Object.entries(assign).flatMap(([rk, count]) => {
      const info = rm[rk];
      if (!info || count === 0) return [];
      // 航空ルートは要援護者不可 → vulnerable=0 で送る
      const isAir = AIR_ROUTES.has(rk);
      const area = areas[info.from];
      let residents = 0, tourists = 0, vulnerable = 0;
      if (isAir) {
        // 住民→観光客の順で割り当て、要援護者は含めない
        residents = Math.min(count, area.residents);
        tourists = Math.min(count - residents, area.tourists);
      } else {
        // 海路・ヘリは要援護者優先
        vulnerable = Math.min(count, area.vulnerable);
        residents = Math.min(count - vulnerable, area.residents);
        tourists = Math.min(count - vulnerable - residents, area.tourists);
      }
      return [{ from: info.from, to: info.to, method: info.method, residents, tourists, vulnerable }];
    });
  };

  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '2px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}>
      {/* ── ヘッダー ── */}
      <div style={{ padding: '10px 14px', background: '#f8fafc', borderBottom: `3px solid ${phaseColor}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 3 }}>
          <span style={{ background: phaseColor, color: '#fff', padding: '3px 12px', borderRadius: 12, fontSize: 12, fontWeight: 700 }}>● {phaseLabel}</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>避難指示マップ</span>
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            ルートの＋/－でコマを割り当て → 手数を消費して1時間ごとに輸送シミュレーション
          </span>
        </div>
        <div style={{ fontSize: 12, color: '#374151' }}>🌤 {weatherSummary}</div>
      </div>

      {/* ── イベントサマリー ── */}
      <div style={{ background: '#fafafa', borderBottom: '1px solid #e5e7eb', padding: '7px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#111' }}>⚡ イベント ({triggeredEvents.length}件)</span>
          <div style={{ display: 'flex', gap: 5 }}>
            <button style={{ padding: '2px 9px', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 10, background: '#fff', cursor: 'pointer' }} onClick={() => setShowHourly(!showHourly)}>
              {showHourly ? '▲ 閉じる' : '▼ 24hダイス'}
            </button>
            <button style={{ padding: '2px 9px', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 10, background: '#fff', cursor: 'pointer' }} onClick={() => setShowEvents(!showEvents)}>
              {showEvents ? '▲ 閉じる' : '▼ 詳細'}
            </button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3,1fr)' : 'repeat(6,1fr)', gap: 3 }}>
          {eventSpaceRolls.map(r => (
            <div key={r.hour} style={{ border: `2px solid ${r.eventType ? '#f59e0b' : '#86efac'}`, background: r.eventType ? '#fef3c7' : '#f0fdf4', borderRadius: 4, padding: '2px', textAlign: 'center' }}>
              <div style={{ fontSize: 8, color: '#9ca3af' }}>{String(r.hour).padStart(2, '0')}:00</div>
              <div style={{ fontSize: 13, fontWeight: 900, color: r.eventType ? '#d97706' : '#111' }}>⚄{r.roll}</div>
              {r.eventType ? <div style={{ fontSize: 8, color: '#dc2626', fontWeight: 700 }}>{r.eventType}イベント</div> : <div style={{ fontSize: 8, color: '#22c55e' }}>なし</div>}
            </div>
          ))}
        </div>
        {showHourly && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12,1fr)', gap: 2, marginTop: 4 }}>
            {hourlyRolls.map(r => (
              <div key={r.hour} style={{ border: r.eventType ? '2px solid #f59e0b' : r.isEventSpace ? '2px solid #86efac' : '1px solid #e5e7eb', background: r.eventType ? '#fef3c7' : r.isEventSpace ? '#f0fdf4' : '#f8fafc', borderRadius: 3, padding: '2px 1px', textAlign: 'center' }}>
                <div style={{ fontSize: 6, color: '#9ca3af' }}>{String(r.hour).padStart(2, '0')}時</div>
                <div style={{ fontSize: 10, fontWeight: 900, color: r.eventType ? '#d97706' : r.isEventSpace ? '#22c55e' : '#9ca3af' }}>{r.roll}</div>
              </div>
            ))}
          </div>
        )}
        {showEvents && (
          <div style={{ maxHeight: 100, overflowY: 'auto', background: '#f1f5f9', borderRadius: 5, padding: '5px 9px', marginTop: 5 }}>
            {eventLog.map((line, i) => (
              <div key={i} style={{ fontSize: 10, padding: '2px 0', borderBottom: '1px solid #e2e8f0', color: line.includes('⚠️') ? '#dc2626' : '#374151' }}>{line}</div>
            ))}
          </div>
        )}
      </div>

      {/* ══ マップ ══ */}
      <div style={{ background: '#5fa8cc', backgroundImage: 'repeating-linear-gradient(0deg,transparent,transparent 30px,rgba(255,255,255,0.05) 30px,rgba(255,255,255,0.05) 31px)', padding: '10px 10px' }}>
        {/* 目的地ラベル */}
        {!isMobile && (
          <div style={{ display: 'grid', gridTemplateColumns: '200px 22px 1fr 155px 1fr', gap: '0 6px', marginBottom: 6 }}>
            <DestLabel bg="#fef9c3" border="#d97706" text="#92400e" title="✈ 那覇経由 福岡空港" sub="← 与那国" />
            <div />
            <div style={{ display: 'flex', gap: 6 }}>
              <DestLabel bg="#fee2e2" border="#dc2626" text="#991b1b" title="⚓ 鹿児島港" sub="← 石垣海路" />
              <DestLabel bg="#fef9c3" border="#d97706" text="#92400e" title="✈ 福岡空港" sub="← 新石垣" />
            </div>
            <div />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <DestLabel bg="#fee2e2" border="#dc2626" text="#991b1b" title="鹿児島空港/港" sub="← 宮古" />
            </div>
          </div>
        )}

        {/* 島グリッド */}
        {isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <IslandCard areaId="yonaguni" name="与那国島" subLabel="✈ 与那国空港  ⛴ 久部良港" borderColor="#16a34a" compact pac3={false} area={areas.yonaguni} routes={routes.yonaguni} assign={assign} onAssign={handleAssign} />
            <IslandCard areaId="taketomi" name="竹富町全島" subLabel="西表・小浜・竹富・黒島・波照間" borderColor="#16a34a" compact pac3={false} area={areas.taketomi} routes={routes.taketomi} assign={assign} onAssign={handleAssign} />
            <IslandCard areaId="ishigaki" name="石垣島" subLabel="✈ 新石垣空港  ⛴ 石垣港  🔥 発電所" borderColor="#2563eb" pac3={state.military.pac3Ishigaki} area={areas.ishigaki} routes={routes.ishigaki} assign={assign} onAssign={handleAssign} />
            <MilPanel state={state} cap={cap} />
            <IslandCard areaId="miyako" name="宮古島・多良間" subLabel="✈ 宮古空港  ✈ 下地島  ⛴ 平良港  🔥 発電所" borderColor="#9333ea" pac3={state.military.pac3Miyako} area={areas.miyako} routes={routes.miyako} assign={assign} onAssign={handleAssign} />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '200px 22px 1fr 155px 1fr', gap: '0 6px', alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <IslandCard areaId="yonaguni" name="与那国島" subLabel="✈ 与那国空港  ⛴ 久部良港" borderColor="#16a34a" compact pac3={false} area={areas.yonaguni} routes={routes.yonaguni} assign={assign} onAssign={handleAssign} />
              <IslandCard areaId="taketomi" name="竹富町全島" subLabel="西表・小浜・竹富・黒島・波照間" borderColor="#16a34a" compact pac3={false} area={areas.taketomi} routes={routes.taketomi} assign={assign} onAssign={handleAssign} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 60, alignItems: 'center' }}>
              <span style={{ fontSize: 20, color: '#d1fae5', fontWeight: 900, textShadow: '0 1px 4px rgba(0,0,0,0.3)' }}>→</span>
              <span style={{ fontSize: 20, color: '#d1fae5', fontWeight: 900, textShadow: '0 1px 4px rgba(0,0,0,0.3)' }}>→</span>
            </div>
            <IslandCard areaId="ishigaki" name="石垣島" subLabel="✈ 新石垣空港  ⛴ 石垣港  🔥 発電所" borderColor="#2563eb" pac3={state.military.pac3Ishigaki} area={areas.ishigaki} routes={routes.ishigaki} assign={assign} onAssign={handleAssign} />
            <MilPanel state={state} cap={cap} />
            <IslandCard areaId="miyako" name="宮古島・多良間" subLabel="✈ 宮古空港  ✈ 下地島  ⛴ 平良港  🔥 発電所" borderColor="#9333ea" pac3={state.military.pac3Miyako} area={areas.miyako} routes={routes.miyako} assign={assign} onAssign={handleAssign} />
          </div>
        )}
      </div>

      {/* ══ 1時間ごとシミュレーションログ ══ */}
      <div style={{ border: '2px solid #e2e8f0' }}>
        <button
          onClick={() => setShowLog(!showLog)}
          style={{ width: '100%', padding: '8px 14px', background: '#1e293b', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>
            🕐 1時間ごとシミュレーションログ
            {simLog.length > 0 && (
              <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 8 }}>
                {simLog.length}時間 / {simLog.reduce((s, e) => s + e.moves.reduce((ss, m) => ss + m.count, 0), 0)}コマ輸送
              </span>
            )}
          </span>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>{showLog ? '▲ 閉じる' : '▼ 開く'}</span>
        </button>
        {showLog && (
          <div style={{ maxHeight: 320, overflowY: 'auto', background: '#fff' }}>
            <SimLog log={simLog} routes={routes} areas={areas} />
          </div>
        )}
      </div>

      {/* ── フッター ── */}
      <div style={{ padding: isMobile ? '10px 10px' : '10px 14px', background: '#f0f9ff', borderTop: '2px solid #bae6fd', display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'stretch' : 'center', gap: 10 }}>
        <div style={{ fontSize: 13, color: '#1f2937' }}>
          本土避難: <strong style={{ color: '#16a34a', fontSize: 15 }}>{totalMainland}コマ</strong>
          　石垣集結: <strong style={{ color: '#2563eb' }}>{totalIshigaki}コマ</strong>
          　合計: <strong>{totalAll}コマ</strong>
        </div>
        <div style={{ display: 'flex', gap: 8, flexDirection: isMobile ? 'column' : 'row' }}>
          <button style={{ padding: '9px 14px', background: '#1f2937', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', width: isMobile ? '100%' : 'auto' }} onClick={onAutoExecute}>⚡ AI最適化</button>
          <button
            style={{ padding: '9px 20px', background: totalAll === 0 ? '#94a3b8' : 'linear-gradient(135deg,#1e40af,#3b82f6)', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: totalAll === 0 ? 'default' : 'pointer', width: isMobile ? '100%' : 'auto' }}
            onClick={() => onExecute(buildOrders())}
            disabled={totalAll === 0}
          >この指示で実行 →</button>
        </div>
      </div>
    </div>
  );
}

// ── ヘルパーコンポーネント (module-level) ──

function DestLabel({ bg, border, text, title, sub }: { bg: string; border: string; text: string; title: string; sub: string }) {
  return (
    <span style={{ display: 'inline-block', background: bg, border: `2px solid ${border}`, borderRadius: 6, padding: '4px 10px' }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: text }}>{title}</div>
      <div style={{ fontSize: 8, color: '#666' }}>{sub}</div>
    </span>
  );
}

function MilPanel({ state, cap }: { state: import('../types').GameState; cap: import('../types').DayCapacities }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.96)', border: '1px solid #d1d5db', borderRadius: 9, padding: '9px 10px', fontSize: 10 }}>
      <div style={{ fontWeight: 800, color: '#111', marginBottom: 6, fontSize: 11, borderBottom: '1px solid #e5e7eb', paddingBottom: 4 }}>軍事・輸送力</div>
      {[['中国海軍', state.military.chineseSea], ['中国空軍', state.military.chineseAir]].map(([label, val]) => (
        <div key={label as string} style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 8, color: '#dc2626', fontWeight: 700, marginBottom: 2 }}>{label as string}</div>
          <div style={{ display: 'flex', gap: 2 }}>
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} style={{ width: 10, height: 10, borderRadius: 2, background: i < (val as number) ? '#dc2626' : '#f3f4f6', border: '1px solid #e5e7eb' }} />
            ))}
          </div>
        </div>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 6px', alignItems: 'center', borderTop: '1px solid #e5e7eb', paddingTop: 5, marginTop: 3 }}>
        {[['海自輸送艦', state.transport.jmsdfRemaining, '#1d4ed8'], ['空自輸送機', state.transport.jasdfRemaining, '#1d4ed8'], ['海保/日', state.transport.coastGuardToday, '#059669']].map(([l, v, c]) => ([
          <span key={`l-${l}`} style={{ color: c as string, fontWeight: 700, fontSize: 9 }}>{l as string}</span>,
          <span key={`v-${l}`} style={{ fontWeight: 700, color: c as string, fontSize: 9 }}>{v as number}回</span>,
        ]))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6, borderTop: '1px solid #e5e7eb', paddingTop: 5 }}>
        {[{ ok: cap.seaOk, label: '海上輸送' }, { ok: cap.civilianAirOk, label: '民間航空' }].map(({ ok, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: ok ? '#22c55e' : '#dc2626' }} />
            <span style={{ fontSize: 9, color: ok ? '#15803d' : '#dc2626', fontWeight: 600 }}>{label}: {ok ? '可' : '不可'}</span>
          </div>
        ))}
      </div>
      {state.military.senkakuOccupied && <div style={{ marginTop: 5, color: '#dc2626', fontWeight: 700, fontSize: 8, background: '#fee2e2', borderRadius: 3, padding: '2px 5px' }}>⚠️ 尖閣占拠中</div>}
      <div style={{ marginTop: 8, background: '#111827', borderRadius: 5, padding: '5px 8px', textAlign: 'center' }}>
        <div style={{ fontSize: 10, fontWeight: 900, color: '#fff' }}>💀 死亡コマ</div>
        <div style={{ fontSize: 14, fontWeight: 900, color: '#f87171' }}>{state.dead}コマ</div>
      </div>
    </div>
  );
}
