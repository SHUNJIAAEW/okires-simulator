import React, { useState } from 'react';
import type { DayLog, HourlyRoll } from '../types';

interface Props {
  logs: DayLog[];
}

const PHASE_LABELS: Record<string, string> = {
  peacetime: '平時',
  crisis: '存立危機事態',
  wartime: '有事',
};

const PHASE_COLORS: Record<string, string> = {
  peacetime: '#64748b',
  crisis: '#d97706',
  wartime: '#dc2626',
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
                    <div key={id} style={{ ...styles.snapItem, background: snap.total === 0 ? '#f0fdf4' : '#f8fafc' }}>
                      <div style={styles.snapArea}>{
                        id === 'yonaguni' ? '与那国' : id === 'taketomi' ? '竹富町' :
                        id === 'ishigaki' ? '石垣' : '宮古'
                      }</div>
                      <div style={{ ...styles.snapTotal, color: snap.total === 0 ? '#22c55e' : '#1e293b' }}>
                        {snap.total === 0 ? '✓完了' : `${snap.total}コマ`}
                      </div>
                      <div style={styles.snapFatigue}>疲労{snap.fatigue >= 0 ? '+' : ''}{snap.fatigue.toFixed(1)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 累計 */}
              <div style={styles.totalBar}>
                <span>避難完了: <strong>{log.totalEvacuatedSoFar}コマ</strong></span>
                <span style={styles.pipe}>|</span>
                <span>死亡: <strong style={{ color: '#dc2626' }}>{log.totalDeadSoFar}コマ</strong></span>
                <span style={styles.pipe}>|</span>
                <span style={{ color: '#64748b' }}>
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
        <span style={{ fontSize: 11, color: '#64748b' }}>
          イベントスペース6回 / 発動{triggered.length}件
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{ fontSize: 10, background: 'transparent', border: '1px solid #e2e8f0', borderRadius: 4, padding: '2px 6px', cursor: 'pointer', color: '#64748b' }}
        >
          {expanded ? '▲ 閉じる' : '▼ 全24時間'}
        </button>
      </div>
      {!expanded && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
          {eventSpaceRolls.map(r => (
            <div key={r.hour} style={{
              border: `2px solid ${r.eventType ? (r.eventType === 'D' ? '#dc2626' : r.eventType === 'C' ? '#f97316' : r.eventType === 'B' ? '#f59e0b' : '#3b82f6') : '#86efac'}`,
              background: r.eventType ? '#fef3c7' : '#f0fdf4',
              borderRadius: 5, padding: '4px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 9, color: '#94a3b8' }}>{String(r.hour).padStart(2, '0')}:00</div>
              <div style={{ fontSize: 15, fontWeight: 900, color: r.eventType ? '#dc2626' : '#334155' }}>⚄{r.roll}</div>
              {r.eventType
                ? <div style={{ fontSize: 9, color: '#dc2626', fontWeight: 700 }}>{r.eventType}イベント</div>
                : <div style={{ fontSize: 9, color: '#22c55e' }}>なし</div>
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
                ? `2px solid ${r.eventType === 'D' ? '#dc2626' : r.eventType === 'C' ? '#f97316' : r.eventType === 'B' ? '#f59e0b' : '#3b82f6'}`
                : r.isEventSpace ? '2px solid #86efac' : '1px solid #e2e8f0',
              background: r.eventType ? '#fef3c7' : r.isEventSpace ? '#f0fdf4' : '#f8fafc',
              borderRadius: 3, padding: '3px 1px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 7, color: '#94a3b8' }}>{String(r.hour).padStart(2,'0')}時</div>
              <div style={{ fontSize: 12, fontWeight: 900, color: r.eventType ? '#dc2626' : r.isEventSpace ? '#22c55e' : '#94a3b8' }}>{r.roll}</div>
              {r.eventType && (
                <div style={{ fontSize: 7, background: r.eventType === 'D' ? '#dc2626' : r.eventType === 'C' ? '#f97316' : r.eventType === 'B' ? '#f59e0b' : '#3b82f6', color: '#fff', borderRadius: 2 }}>
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
            <div key={i} style={{ fontSize: 11, color: '#475569', padding: '2px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ fontWeight: 700, color: '#dc2626' }}>[{String(r.hour).padStart(2,'0')}:00 {r.eventType}]</span> {r.outcome}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', gap: 8 },
  title: { fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 8 },
  empty: { textAlign: 'center', padding: '40px 20px', color: '#94a3b8' },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 14 },
  logCard: { border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', background: '#fff' },
  logHeader: {
    width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 16px', background: '#f8fafc', border: 'none', cursor: 'pointer',
    borderBottom: '1px solid #e2e8f0',
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 8 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 12 },
  dayBadge: { background: '#1e293b', color: '#fff', padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 700 },
  phaseBadge: { color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 },
  weatherBadge: { color: '#64748b', fontSize: 12 },
  evacuatedCount: { color: '#22c55e', fontWeight: 700, fontSize: 13 },
  totalEvac: { color: '#3b82f6', fontSize: 12 },
  chevron: { color: '#94a3b8', fontSize: 12 },
  logBody: { padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 },
  section: { borderBottom: '1px solid #f1f5f9', paddingBottom: 10 },
  sectionTitle: { fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionContent: { fontSize: 13, color: '#334155', lineHeight: 1.5 },
  evacRow: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
    borderBottom: '1px solid #f8fafc', fontSize: 12,
  },
  evacMethod: { background: '#eff6ff', color: '#1d4ed8', padding: '2px 8px', borderRadius: 8, fontWeight: 600, whiteSpace: 'nowrap' },
  evacFlow: { color: '#475569', flex: 1 },
  evacCount: { fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' },
  vulnTag: { background: '#dbeafe', color: '#1d4ed8', padding: '1px 6px', borderRadius: 6, fontSize: 10 },
  eventRow: { fontSize: 12, color: '#334155', padding: '3px 0', borderBottom: '1px solid #f8fafc', lineHeight: 1.4 },
  eventRowDanger: { color: '#dc2626', fontWeight: 600 },
  snapGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 },
  snapItem: { borderRadius: 6, padding: '6px 8px', border: '1px solid #e2e8f0', textAlign: 'center' },
  snapArea: { fontSize: 10, color: '#64748b', marginBottom: 2 },
  snapTotal: { fontSize: 14, fontWeight: 700 },
  snapFatigue: { fontSize: 10, color: '#94a3b8', marginTop: 2 },
  totalBar: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: '#f0f9ff', borderRadius: 6, padding: '8px 12px', fontSize: 13,
  },
  pipe: { color: '#cbd5e1' },
};
