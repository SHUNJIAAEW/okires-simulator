import React from 'react';
import type { GameState } from '../types';
import type { AreaId } from '../types';
import { useWindowWidth } from '../hooks/useWindowWidth';

interface Props {
  state: GameState;
  onRestart: () => void;
}

const AREA_NAMES: Record<AreaId, string> = {
  yonaguni: '与那国島',
  taketomi: '竹富町全島',
  ishigaki: '石垣島',
  miyako: '宮古島・多良間',
};

const GOV_BENCHMARK = 20; // コマ/day (= 2万人/day)

export function ResultScreen({ state, onRestart }: Props) {
  const { evacuated, dead, areas, dayLogs, prepLevel, shelterLevel, month } = state;
  const isMobile = useWindowWidth() < 768;

  const totalRemaining = Object.values(areas).reduce((sum, a) =>
    sum + a.residents + a.tourists + a.vulnerable + a.stagingPort, 0
  );
  const maxEvacuated = evacuated + dead + totalRemaining;
  const evacuationRate = maxEvacuated > 0 ? (evacuated / maxEvacuated * 100) : 0;

  // スコア計算
  const score = Math.round(evacuationRate);

  const getRating = (rate: number) => {
    if (rate >= 95) return { label: 'S ランク', color: '#f59e0b', desc: '驚異的な避難達成率！日本政府の計画を完全実証' };
    if (rate >= 80) return { label: 'A ランク', color: '#22c55e', desc: '優秀な避難実施。6日間12万人計画を概ね達成' };
    if (rate >= 60) return { label: 'B ランク', color: '#3b82f6', desc: '一定の避難達成。改善の余地あり' };
    if (rate >= 40) return { label: 'C ランク', color: '#f97316', desc: '半数以上が取り残された。事前準備の重要性を実感' };
    return { label: 'D ランク', color: '#dc2626', desc: '深刻な避難失敗。事前準備なしでは住民を守れない' };
  };

  const rating = getRating(evacuationRate);

  // ボトルネック分析
  const bottlenecks: string[] = [];
  if (state.transport.civilianAirDisabled) bottlenecks.push('民間航空路が攻撃により使用不能になった');
  if (state.transport.civilianShipDisabled) bottlenecks.push('民間船舶が攻撃により使用不能になった');
  if (Object.values(areas).some(a => a.fatigue >= a.baseActions)) bottlenecks.push('住民疲労が限界に達し避難不能エリアが発生した');
  if (state.military.chineseSea >= 5 || state.military.chineseAir >= 5) bottlenecks.push('中国軍兵力が非常に強力になった');
  if (!state.military.pac3Ishigaki || !state.military.pac3Miyako) bottlenecks.push('PAC3が一部エリアに未配備だった');
  if (prepLevel <= 2) bottlenecks.push(`事前準備Lv.${prepLevel}が低すぎ、モード移行・輸送能力が著しく制限された`);

  // 学習ポイント
  const lessons: string[] = [
    '飛行機が主力輸送手段。空港の安全確保が最重要。',
    '要援護者（青コマ）は船のみ輸送可能。船便の確保が必要。',
    '竹富町以西（与那国・西表・波照間等）はX+3日が避難期限。',
    '石垣港→石垣島→本土が最大のボトルネック。',
    '大雨・強風で全港湾停止。台風シーズンは特に危険。',
    `事前準備Lv.${prepLevel}での今回の避難率: ${evacuationRate.toFixed(1)}%`,
  ];

  // Day-by-day chart data
  const dailyDeltas = dayLogs.map((log, i) => {
    const prev = i === 0 ? 0 : dayLogs[i - 1].totalEvacuatedSoFar;
    return {
      day: log.day,
      dayLabel: log.dayLabel,
      delta: log.totalEvacuatedSoFar - prev,
      cumulative: log.totalEvacuatedSoFar,
    };
  });

  const maxDelta = Math.max(...dailyDeltas.map(d => d.delta), GOV_BENCHMARK, 1);

  // Average コマ/day (only days with positive delta to be fair)
  const activeDays = dailyDeltas.filter(d => d.delta > 0);
  const avgPerDay = activeDays.length > 0
    ? activeDays.reduce((s, d) => s + d.delta, 0) / activeDays.length
    : 0;

  const benchmarkPct = (GOV_BENCHMARK / maxDelta) * 100;

  return (
    <div style={styles.container}>
      {/* ヘッダー */}
      <div style={styles.header}>
        <div style={styles.logoRow}>
          <span style={styles.triangle}>▲</span>
          <span style={styles.logo}>OKIRES-2026</span>
        </div>
        <div style={styles.aarSubtitle}>AFTER ACTION REPORT</div>
        <h1 style={styles.title}>シミュレーション結果</h1>
        <p style={styles.subtitle}>
          事前準備Lv.{prepLevel} / 抗堪性Lv.{shelterLevel} / {month}月 発生
        </p>
      </div>

      {/* スコア */}
      <div style={{ ...styles.scoreCard, border: `2px solid ${rating.color}` }}>
        <div style={styles.ratingRow}>
          <span style={{ ...styles.rating, color: rating.color }}>{rating.label}</span>
          <span style={styles.score}>{score}点</span>
        </div>
        <p style={styles.ratingDesc}>{rating.desc}</p>

        {/* 避難率バー */}
        <div style={styles.progressLabel}>
          <span>避難完了率</span>
          <span style={{ fontWeight: 700, color: rating.color }}>{evacuationRate.toFixed(1)}%</span>
        </div>
        <div style={styles.progressBar}>
          <div style={{ ...styles.progressFill, width: `${evacuationRate}%`, background: rating.color }} />
        </div>
      </div>

      {/* 統計 */}
      <div style={{ ...styles.statsGrid, gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)' }}>
        <StatCard
          label="避難完了"
          value={`${evacuated}コマ`}
          sub={`${(evacuated * 1000).toLocaleString()}人`}
          color="#22c55e"
          icon="✈"
        />
        <StatCard
          label="取り残し"
          value={`${totalRemaining}コマ`}
          sub={`${(totalRemaining * 1000).toLocaleString()}人`}
          color="#f97316"
          icon="⏳"
        />
        <StatCard
          label="死亡"
          value={`${dead}コマ`}
          sub={`${(dead * 1000).toLocaleString()}人`}
          color="#dc2626"
          icon="💀"
        />
        <StatCard
          label="シミュ期間"
          value={`${dayLogs.length}日間`}
          sub="X-3日〜X+8日"
          color="#3b82f6"
          icon="📅"
        />
        <StatCard
          label="実績 平均/日"
          value={`${avgPerDay.toFixed(1)}コマ`}
          sub={`${(avgPerDay * 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })}人/日`}
          color={avgPerDay >= GOV_BENCHMARK ? '#22c55e' : '#f97316'}
          icon="📊"
        />
        <StatCard
          label="政府目標 平均/日"
          value={`${GOV_BENCHMARK}コマ`}
          sub="2万人/日"
          color="#6366f1"
          icon="🎯"
        />
        <StatCard
          label="目標比"
          value={`${avgPerDay > 0 ? ((avgPerDay / GOV_BENCHMARK) * 100).toFixed(0) : 0}%`}
          sub={avgPerDay >= GOV_BENCHMARK ? '目標達成' : '目標未達'}
          color={avgPerDay >= GOV_BENCHMARK ? '#22c55e' : '#dc2626'}
          icon={avgPerDay >= GOV_BENCHMARK ? '✅' : '❌'}
        />
      </div>

      {/* Day-by-day 避難チャート */}
      {dailyDeltas.length > 0 && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>📈 日別避難数チャート（コマ数）</h2>
          <div style={styles.chartLegend}>
            <span style={styles.legendBar}></span>
            <span style={styles.legendText}>実績避難数</span>
            <span style={{ ...styles.legendLine, borderTop: '2px dashed #ffb300' }}></span>
            <span style={styles.legendText}>政府目標（20コマ/日）</span>
          </div>
          <div style={styles.chartWrapper}>
            {/* Benchmark line */}
            <div
              style={{
                ...styles.benchmarkLine,
                bottom: `${benchmarkPct}%`,
              }}
            >
              <span style={styles.benchmarkLabel}>目標 20コマ</span>
            </div>
            {/* Bars */}
            <div style={styles.barsRow}>
              {dailyDeltas.map((d) => {
                const barHeight = (d.delta / maxDelta) * 100;
                const barColor = d.delta >= GOV_BENCHMARK ? '#00ff88' : d.delta > 0 ? '#003d7a' : '#1e3a5f';
                return (
                  <div key={d.dayLabel} style={styles.barColumn}>
                    <div style={styles.barOuter}>
                      <div
                        style={{
                          ...styles.barInner,
                          height: `${barHeight}%`,
                          background: barColor,
                        }}
                        title={`${d.dayLabel}: ${d.delta}コマ (${(d.delta * 1000).toLocaleString()}人)`}
                      />
                    </div>
                    <div style={styles.barValue}>{d.delta > 0 ? d.delta : '–'}</div>
                    <div style={styles.barLabel}>{d.dayLabel}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={styles.chartNote}>
            各バーはその日に新たに避難完了したコマ数。緑＝政府目標達成、青＝目標未達、灰＝避難なし。
          </div>
        </div>
      )}

      {/* エリア別結果 */}
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>エリア別残員状況</h2>
        <div style={{ ...styles.areaGrid, gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)' }}>
          {Object.entries(areas).map(([id, area]) => {
            const remaining = area.residents + area.tourists + area.vulnerable + area.stagingPort;
            return (
              <div key={id} style={{
                ...styles.areaCard,
                borderColor: remaining === 0 ? '#00ff88' : '#ffb300',
                background: remaining === 0 ? '#0a1f0a' : '#1a1200',
              }}>
                <div style={styles.areaName}>{AREA_NAMES[id as AreaId]}</div>
                {remaining === 0 ? (
                  <div style={styles.complete}>✓ 避難完了</div>
                ) : (
                  <>
                    <div style={{ color: '#ffb300', fontSize: 18, fontWeight: 700 }}>{remaining}コマ残存</div>
                    <div style={{ color: '#8eb8d4', fontSize: 12 }}>({remaining * 1000}人)</div>
                  </>
                )}
                <div style={styles.areaFatigue}>
                  疲労度: {area.fatigue >= 0 ? '+' : ''}{area.fatigue.toFixed(1)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ボトルネック分析 */}
      {bottlenecks.length > 0 && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>⚠️ ボトルネック分析</h2>
          {bottlenecks.map((bn, i) => (
            <div key={i} style={styles.bottleneckRow}>
              <span style={styles.bottleneckBullet}>→</span>
              <span>{bn}</span>
            </div>
          ))}
        </div>
      )}

      {/* 学習ポイント */}
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>📚 このシミュレーションから学ぶこと</h2>
        {lessons.map((lesson, i) => (
          <div key={i} style={styles.lessonRow}>
            <span style={styles.lessonNum}>{i + 1}</span>
            <span>{lesson}</span>
          </div>
        ))}
        <div style={styles.policyNote}>
          <strong>日本政府の避難計画：</strong>「1日2万人、6日間で12万人避難完了」
          —— このシミュレーションを通じて、その達成可能性を検証してください。
        </div>
      </div>

      {/* 再スタートボタン */}
      <button
        style={styles.restartBtn}
        onClick={onRestart}
        onFocus={e => e.currentTarget.blur()}
        onMouseDown={e => e.preventDefault()}
      >
        もう一度シミュレーション →
      </button>

      <div style={styles.footer}>
        OKIRES2026 デジタルシミュレーター | ルール: OKIRES製作委員会 (okires2025@gmail.com)
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color, icon }: {
  label: string; value: string; sub: string; color: string; icon: string;
}) {
  return (
    <div style={{ background: '#0d1b2a', border: `1px solid ${color}`, borderRadius: 6, padding: 16, textAlign: 'center' }}>
      <div style={{ fontSize: 24, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 12, color: '#4a7a9b', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: 12, color: '#8eb8d4' }}>{sub}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 900, margin: '0 auto', padding: 20, fontFamily: '"Noto Sans JP", sans-serif', display: 'flex', flexDirection: 'column', gap: 20, color: '#8eb8d4' },
  header: { textAlign: 'center', background: 'linear-gradient(135deg, #060d18, #0d1b2a)', borderRadius: 8, padding: 32, color: '#c8e6f8', border: '1px solid #00ff88' },
  logoRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 8 },
  triangle: { fontSize: 40, color: '#00ff88' },
  logo: { fontSize: 36, fontWeight: 900, color: '#00ff88', fontFamily: 'monospace', letterSpacing: 2 },
  aarSubtitle: { fontFamily: 'monospace', letterSpacing: 4, color: '#ffb300', fontSize: 13, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: 700, margin: '8px 0', color: '#c8e6f8' },
  subtitle: { color: '#4a7a9b', fontSize: 14 },
  scoreCard: { background: '#0d1b2a', borderRadius: 8, padding: 24 },
  ratingRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  rating: { fontSize: 32, fontWeight: 900 },
  score: { fontSize: 24, fontWeight: 700, color: '#c8e6f8' },
  ratingDesc: { color: '#8eb8d4', marginBottom: 16 },
  progressLabel: { display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 6, color: '#8eb8d4' },
  progressBar: { background: '#1e3a5f', borderRadius: 8, height: 16, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 8, transition: 'width 1s' },
  statsGrid: { display: 'grid', gap: 12 },
  card: { background: '#0d1b2a', borderRadius: 8, padding: 20, border: '1px solid #1e3a5f' },
  cardTitle: { fontSize: 18, fontWeight: 700, color: '#ffb300', marginBottom: 16, borderLeft: '4px solid #00ff88', paddingBottom: 8, paddingLeft: 10 },
  areaGrid: { display: 'grid', gap: 12 },
  areaCard: { border: '2px solid', borderRadius: 6, padding: 12, textAlign: 'center' },
  areaName: { fontSize: 12, fontWeight: 600, color: '#4a7a9b', marginBottom: 6 },
  complete: { fontSize: 16, fontWeight: 700, color: '#00ff88' },
  areaFatigue: { fontSize: 11, color: '#4a7a9b', marginTop: 4 },
  bottleneckRow: { display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid #112233', color: '#ff6b6b', fontSize: 13 },
  bottleneckBullet: { fontWeight: 700, flexShrink: 0 },
  lessonRow: { display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid #112233', fontSize: 13, color: '#8eb8d4' },
  lessonNum: { background: '#003d7a', color: '#00ff88', border: '1px solid #00ff88', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 },
  policyNote: { background: '#0a1a00', border: '1px solid #00aa55', borderRadius: 6, padding: 12, marginTop: 12, fontSize: 13, color: '#ffb300' },
  restartBtn: { padding: 18, background: 'linear-gradient(135deg, #003d7a 0%, #004d2a 100%)', color: '#00ff88', border: '1px solid #00ff88', borderRadius: 8, fontSize: 18, fontWeight: 700, cursor: 'pointer', fontFamily: 'monospace', letterSpacing: 1 },
  footer: { textAlign: 'center', color: '#4a7a9b', fontSize: 11 },
  // Chart styles
  chartLegend: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 12, color: '#8eb8d4', flexWrap: 'wrap' },
  legendBar: { display: 'inline-block', width: 16, height: 16, background: '#003d7a', borderRadius: 3, flexShrink: 0 },
  legendLine: { display: 'inline-block', width: 24, flexShrink: 0 },
  legendText: { marginRight: 12 },
  chartWrapper: { position: 'relative', paddingBottom: 8 },
  benchmarkLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTop: '2px dashed #ffb300',
    zIndex: 1,
    pointerEvents: 'none',
  },
  benchmarkLabel: {
    position: 'absolute',
    right: 0,
    top: -18,
    fontSize: 10,
    color: '#ffb300',
    fontWeight: 700,
    background: '#0d1b2a',
    padding: '0 4px',
  },
  barsRow: { display: 'flex', alignItems: 'flex-end', gap: 4, height: 180, overflowX: 'auto', paddingTop: 24 },
  barColumn: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '1 0 32px', minWidth: 32 },
  barOuter: { width: '100%', height: 140, display: 'flex', alignItems: 'flex-end', background: '#112233', borderRadius: '4px 4px 0 0', border: '1px solid #1e3a5f', position: 'relative' },
  barInner: { width: '100%', borderRadius: '4px 4px 0 0', transition: 'height 0.5s ease', minHeight: 2 },
  barValue: { fontSize: 10, color: '#8eb8d4', fontWeight: 700, marginTop: 2, textAlign: 'center' },
  barLabel: { fontSize: 9, color: '#4a7a9b', textAlign: 'center', marginTop: 2 },
  chartNote: { fontSize: 11, color: '#4a7a9b', marginTop: 12, lineHeight: 1.5 },
};
