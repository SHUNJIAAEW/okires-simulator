import React, { useState } from 'react';
import type { DayLog, HourlyRoll } from '../types';
import { C, FONT } from '../theme';

interface Props {
  logs: DayLog[];
}

const PHASE_LABELS: Record<string, string> = {
  peacetime: '平時',
  crisis: '存立危機事態',
  wartime: '有事',
};

const PHASE_COLORS: Record<string, string> = {
  peacetime: '#4a7a9b',
  crisis: '#ffb300',
  wartime: '#ff3b3b',
};

export function DayLogPanel({ logs }: Props) {
  const [expanded, setExpanded] = useState<number | null>(logs.length > 0 ? logs[logs.length - 1].day : null);

  if (logs.length === 0) {
    return (
      <div style={styles.empty}>
        <div style={styles.emptyIcon}>📋</div>
        <p style={styles.emptyText}>「次の日へ」ボタンを押すとシミュレーションが開始されます</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>📋 日別ログ</h3>
      {[...logs].reverse().map(log => (
        <div key={log.day} style={styles.logCard}>
          <button
            style={styles.logHeader}
            onClick={() => setExpanded(expanded === log.day ? null : log.day)}
          >
            <div style={styles.headerLeft}>
              <span style={styles.dayBadge}>{log.dayLabel}</span>
              <span style={{ ...styles.phaseBadge, background: PHASE_COLORS[log.phase] }}>
                {PHASE_LABELS[log.phase]}
              </span>
              <span style={styles.weatherBadge}>{log.weatherSummary.split('/')[0].trim()}</span>
            </div>
            <div style={styles.headerRight}>
              <span style={styles.evacuatedCount}>✈ {log.evacuations.reduce((s, e) => s + e.count, 0)}コマ避難</span>
              <span style={styles.totalEvac}>累計: {log.totalEvacuatedSoFar}コマ</span>
              <span style={styles.chevron}>{expanded === log.day ? '▲' : '▼'}</span>
            </div>
          </button>

          {expanded === log.day && (
            <div style={styles.logBody}>
              {/* 天候 */}
              <div style={styles.section}>
                <div style={styles.sectionTitle}>🌤 天候・状況</div>
                <p style={styles.sectionContent}>{log.weatherSummary}</p>
              </div>

              {/* 避難実績 */}
              {log.evacuations.length > 0 && (
                <div style={styles.section}>
                  <div style={styles.sectionTitle}>✈ 避難実績</div>
                  {log.evacuations.map((evac, i) => (
                    <div key={i} style={styles.evacRow}>
                      <span style={styles.evacMethod}>{evac.method}</span>
                      <span style={styles.evacFlow}>
                        {evac.from === 'yonaguni' ? '与那国' : evac.from === 'taketomi' ? '竹富町' :
                         evac.from === 'ishigaki' ? '石垣' : '宮古'}
                        → {evac.to}
                      </span>
                      <span style={styles.evacCount}>{evac.count}コマ ({evac.count * 1000}人)</span>
                      {evac.isVulnerable && <span style={styles.vulnTag}>要援護者含む</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* イベント */}
              {log.events.length > 0 && (
                <div style={styles.section}>
                  <div style={styles.sectionTitle}>⚡ イベント・軍事</div>
                  {log.events.map((ev, i) => (
                    <div key={i} style={{
                      ...styles.eventRow,
                      ...(ev.includes('⚠️') || ev.includes('警') ? styles.eventRowDanger : {}),
                    }}>
                      {ev}
                    </div>
                  ))}
                </div>
              )}

              {/* 24時間ダイス */}
              {log.hourlyRolls && log.hourlyRolls.length > 0 && (
                <div style={styles.section}>
                  <div style={styles.sectionTitle}>🎲 24時間ダイス記録</div>
                  <HourlyRollGrid rolls={log.hourlyRolls} />
                </div>
              )}

              {/* 疲労 */}
              <div style={styles.section}>
                <div style={styles.sectionTitle}>💪 疲労度</div>
                <p style={styles.sectionContent}>{log.fatigueSummary}</p>
              </div>

              {/* エリアスナップショット */}
              <div style={styles.section}>
                <div style={styles.sectionTitle}>📍 エリア残員</div>
                <div style={styles.snapGrid}>
                  {Object.entries(log.areaSnapshots).map(([id, snap]) => (
                    <div key={id} style={{ ...styles.snapItem, background: snap.total === 0 ? 'rgba(0,255,136,0.08)' : C.bgCard, borderColor: snap.total === 0 ? 'rgba(0,255,136,0.4)' : C.border }}>
                      <div style={styles.snapArea}>{
                        id === 'yonaguni' ? '与那国' : id === 'taketomi' ? '竹富町' :
                        id === 'ishigaki' ? '石垣' : '宮古'
                      }</div>
                      <div style={{ ...styles.snapTotal, color: snap.total === 0 ? C.green : C.bright }}>
                        {snap.total === 0 ? '✓完了' : `${snap.total}コマ`}
                      </div>
                      {snap.total > 0 && (
                        <div style={styles.snapBreakdown}>
                          住{snap.residents}・観{snap.tourists}・要{snap.vulnerable}{snap.staging > 0 ? `・待${snap.staging}` : ''}
                        </div>
                      )}
                      <div style={styles.snapFatigue}>疲労{snap.fatigue >= 0 ? '+' : ''}{snap.fatigue.toFixed(1)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 累計 */}
              <div style={styles.totalBar}>
                <span>避難完了: <strong style={{ color: C.green }}>{log.totalEvacuatedSoFar}コマ</strong></span>
                <span style={styles.pipe}>|</span>
                <span>死亡: <strong style={{ color: C.red }}>{log.totalDeadSoFar}コマ</strong></span>
                <span style={styles.pipe}>|</span>
                <span style={{ color: C.dim }}>
                  {log.totalDeadSoFar > 0 ? `生存率: ${((log.totalEvacuatedSoFar / (log.totalEvacuatedSoFar + log.totalDeadSoFar)) * 100).toFixed(1)}%` : ''}
                </span>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function HourlyRollGrid({ rolls }: { rolls: HourlyRoll[] }) {
  const [expanded, setExpanded] = useState(false);
  const eventSpaceRolls = rolls.filter(r => r.isEventSpace);
  const triggered = rolls.filter(r => r.eventType !== null);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: C.dim, fontFamily: FONT.mono }}>
          イベントスペース6回 / 発動{triggered.length}件
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{ fontSize: 10, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 3, padding: '2px 6px', cursor: 'pointer', color: C.dim, fontFamily: FONT.mono }}
        >
          {expanded ? '▲ 閉じる' : '▼ 全24時間'}
        </button>
      </div>
      {!expanded && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
          {eventSpaceRolls.map(r => (
            <div key={r.hour} style={{
              border: `1px solid ${r.eventType ? (r.eventType === 'D' ? C.red : r.eventType === 'C' ? '#ff9e3d' : r.eventType === 'B' ? C.amber : C.blue) : C.border}`,
              background: r.eventType ? 'rgba(255,179,0,0.1)' : C.bgCard,
              borderRadius: 4, padding: '4px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 9, color: C.dim, fontFamily: FONT.mono }}>{String(r.hour).padStart(2, '0')}:00</div>
              <div style={{ fontSize: 15, fontWeight: 900, color: r.eventType ? C.amber : C.bright, fontFamily: FONT.mono }}>⚄{r.roll}</div>
              {r.eventType
                ? <div style={{ fontSize: 9, color: C.red, fontWeight: 700 }}>{r.eventType}イベント</div>
                : <div style={{ fontSize: 9, color: C.green }}>なし</div>
              }
            </div>
          ))}
        </div>
      )}
      {expanded && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 2 }}>
          {rolls.map(r => (
            <div key={r.hour} style={{
              border: r.eventType
                ? `1px solid ${r.eventType === 'D' ? C.red : r.eventType === 'C' ? '#ff9e3d' : r.eventType === 'B' ? C.amber : C.blue}`
                : r.isEventSpace ? `1px solid ${C.borderHi}` : `1px solid ${C.border}`,
              background: r.eventType ? 'rgba(255,179,0,0.1)' : r.isEventSpace ? 'rgba(0,255,136,0.06)' : C.bgCard,
              borderRadius: 3, padding: '3px 1px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 7, color: C.dim, fontFamily: FONT.mono }}>{String(r.hour).padStart(2,'0')}時</div>
              <div style={{ fontSize: 12, fontWeight: 900, color: r.eventType ? C.amber : r.isEventSpace ? C.green : C.dim, fontFamily: FONT.mono }}>{r.roll}</div>
              {r.eventType && (
                <div style={{ fontSize: 7, background: r.eventType === 'D' ? C.red : r.eventType === 'C' ? '#ff9e3d' : r.eventType === 'B' ? C.amber : C.blue, color: '#06121f', borderRadius: 2, fontWeight: 700 }}>
                  {r.eventType}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {triggered.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {triggered.map((r, i) => (
            <div key={i} style={{ fontSize: 11, color: C.body, padding: '2px 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontWeight: 700, color: C.amber, fontFamily: FONT.mono }}>[{String(r.hour).padStart(2,'0')}:00 {r.eventType}]</span> {r.outcome}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', gap: 8 },
  title: { fontSize: 14, fontWeight: 700, color: C.bright, marginBottom: 8, fontFamily: FONT.mono, letterSpacing: 1 },
  empty: { textAlign: 'center', padding: '40px 20px', color: C.dim },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 14 },
  logCard: { border: `1px solid ${C.border}`, borderRadius: 4, overflow: 'hidden', background: C.bgPanel },
  logHeader: {
    width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 14px', background: 'rgba(0,0,0,0.2)', border: 'none', cursor: 'pointer',
    borderBottom: `1px solid ${C.border}`,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 8 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 12 },
  dayBadge: { background: C.green, color: '#00150d', padding: '3px 10px', borderRadius: 3, fontSize: 12, fontWeight: 800, fontFamily: FONT.mono },
  phaseBadge: { color: '#06121f', padding: '2px 8px', borderRadius: 3, fontSize: 11, fontWeight: 700, fontFamily: FONT.mono },
  weatherBadge: { color: C.dim, fontSize: 12 },
  evacuatedCount: { color: C.green, fontWeight: 700, fontSize: 13, fontFamily: FONT.mono },
  totalEvac: { color: C.blue, fontSize: 12, fontFamily: FONT.mono },
  chevron: { color: C.dim, fontSize: 12 },
  logBody: { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12, background: C.bgDeep },
  section: { borderBottom: `1px solid ${C.border}`, paddingBottom: 10 },
  sectionTitle: { fontSize: 11, fontWeight: 700, color: C.dim, marginBottom: 6, letterSpacing: 0.5, fontFamily: FONT.mono },
  sectionContent: { fontSize: 13, color: C.body, lineHeight: 1.5 },
  evacRow: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
    borderBottom: `1px solid ${C.border}`, fontSize: 12,
  },
  evacMethod: { background: 'rgba(56,189,248,0.12)', color: C.blue, padding: '2px 8px', borderRadius: 3, fontWeight: 600, whiteSpace: 'nowrap', border: `1px solid ${C.border}` },
  evacFlow: { color: C.body, flex: 1 },
  evacCount: { fontWeight: 700, color: C.white, whiteSpace: 'nowrap', fontFamily: FONT.mono },
  vulnTag: { background: 'rgba(255,107,107,0.15)', color: '#ff8d8d', padding: '1px 6px', borderRadius: 3, fontSize: 10 },
  eventRow: { fontSize: 12, color: C.body, padding: '3px 0', borderBottom: `1px solid ${C.border}`, lineHeight: 1.4 },
  eventRowDanger: { color: '#ff8d8d', fontWeight: 600 },
  snapGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 },
  snapItem: { borderRadius: 4, padding: '6px 8px', borderWidth: 1, borderStyle: 'solid', borderColor: C.border, textAlign: 'center', background: C.bgCard },
  snapArea: { fontSize: 10, color: C.dim, marginBottom: 2 },
  snapTotal: { fontSize: 14, fontWeight: 700, fontFamily: FONT.mono },
  snapBreakdown: { fontSize: 9, color: C.body, marginTop: 1, fontFamily: FONT.mono },
  snapFatigue: { fontSize: 10, color: C.dim, marginTop: 2 },
  totalBar: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'rgba(0,255,136,0.06)', border: `1px solid ${C.border}`, borderRadius: 4, padding: '8px 12px', fontSize: 13, color: C.body,
  },
  pipe: { color: C.border },
};
