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

  // 地域別盲点データ
  const regionalInsights: {
    id: AreaId;
    name: string;
    color: string;
    icon: string;
    blindspots: string[];
    lessons: string[];
  }[] = [
    {
      id: 'yonaguni',
      name: '与那国島',
      color: '#ef4444',
      icon: '🔴',
      blindspots: [
        '台湾まで111km——有事認定前の段階から既に脅威圏内に入る。「X-3日」開始時点で実質的な安全が保障されない',
        '空港滑走路は1,500m（ATR機クラスのみ対応）。C-130等の大型輸送機は着陸不可能で航空輸送量に構造的な上限がある',
        '島の人口2,000人のうち高齢化率は約40%超。自力での港・空港移動が困難な住民が想定以上に多い',
        '与那国→石垣のフェリーは週3便程度（約4時間）。有事での増便体制が整っていない',
        '島外に生活拠点を持たない世帯が多く、避難先での仮住まい・仕事を確保できないとして「避難拒否」するケースが現実には存在する',
      ],
      lessons: [
        '「住民2コマ」という数字は小さく見えるが、離島の脆弱性・孤立リスクは他の島の数倍',
        'X-3日の準有事段階では民間フェリーのみ。早期避難勧告が出ても輸送手段が事実上存在しない日がある',
        '台湾有事では与那国が最初の攻撃目標になり得る。「避難中の攻撃」というリスクはシミュレーションに含まれていない',
      ],
    },
    {
      id: 'taketomi',
      name: '竹富町全島',
      color: '#f97316',
      icon: '🟠',
      blindspots: [
        '竹富町は西表・竹富・波照間・小浜・黒島など11の有人島で構成。各島から石垣港まで集めるだけで1日以上かかる',
        'X+3日の避難期限（72時間）は現実的に不可能に近い。特に波照間島は最南端で定期便が1日1往復しかなく、悪天候で即座に孤立する',
        '黒島・小浜島・鳩間島などは港湾整備が不十分で、大型船が着岸できない島がある',
        '西表島は面積が大きく山間部の住民は港まで数時間かかる道路事情がある。島内の「集結」自体がボトルネック',
        '観光客の多くは旅行中でパスポートや重要書類を宿に預けている。非常時の身分確認・搭乗手続きに時間がかかる',
        'ペット・家畜（西表には農業従事者が多い）を残して避難できないとする住民は現実に存在する',
      ],
      lessons: [
        '「竹富町15コマ」は15の地区に分散。石垣への集結コストがシミュレーションでは単純化されている',
        '波照間・与那国は「X+3日期限内に本土へ」という目標が、交通網だけ見ても達成困難なことを示している',
        '島ごとの住民把握（特に観光客）が事前に行われていないと、避難完了の確認自体できない',
      ],
    },
    {
      id: 'ishigaki',
      name: '石垣島',
      color: '#3b82f6',
      icon: '🔵',
      blindspots: [
        'ハブ機能を担いながら島民自身も避難する二重負荷が発生。与那国・竹富からの避難民受け入れと島民脱出が同時進行',
        '新石垣空港は滑走路が1本のみ。爆撃や誤射で滑走路1カ所が破損すれば航空機能は完全停止',
        '石垣港（離島ターミナル）は市街地に近く、混雑・交通渋滞が避難をさらに遅らせるリスク',
        '外国人観光客（特に台湾・中国・韓国・欧米）が常時数千人規模で滞在。多言語対応・出国手続きの混乱は未考慮',
        'PAC3（地対空ミサイル）が配備されても、中国巡航ミサイルの飽和攻撃には対処しきれない可能性がある',
        '医療：八重山病院が1カ所しかなく、重症患者の本土搬送が輸送能力を圧迫する',
      ],
      lessons: [
        '石垣は「すべての避難の中継点」。石垣が詰まれば沖縄全体の避難が詰まる。石垣の港・空港容量こそが最大のボトルネック',
        '輸送機の発着時間・民間機の増便だけでなく、「誰が捌くか」という地上オペレーションの人員計画が欠如している',
        '有事になってからの準備は遅すぎる。施設・人員・訓練はX-3日より前、平時から整備する必要がある',
      ],
    },
    {
      id: 'miyako',
      name: '宮古島・多良間',
      color: '#22c55e',
      icon: '🟢',
      blindspots: [
        '49コマ（49,000人）と最大規模だが、石垣と異なる独立ルートを持つ。「独立しているから安全」ではなく、むしろ孤立した状態で自力で対処する必要がある',
        '下地島空港は有事になれば自衛隊使用が優先され、民間機の発着枠が大幅に制限される可能性がある',
        '平良港は台湾有事において、中国海軍潜水艦による機雷封鎖リスクがある。機雷1つで港が使用不能になる',
        '多良間島は宮古島から約67km離れており、有事時は小型船の往来が危険になる。多良間の住民1,000人超が孤立するリスクがある',
        '宮古島の医療体制は本土と比較して非常に脆弱。重症患者の域外搬送は天候・有事状況に左右される',
        '島内の交通インフラ（バス・タクシー）が少なく、車を持たない高齢者・観光客が港や空港へ自力移動できない',
      ],
      lessons: [
        '宮古島は「直接本土へ」というルートを持つ点が石垣と異なる強み。しかし平良港の機雷リスクがこれを無効化しうる',
        '下地島空港の軍民共用化が議論されているが、有事においては軍優先になるトレードオフが存在する',
        '多良間島の避難は宮古への集結→本土という二段階。X+3日期限内の対処は現実的に見て極めて困難',
      ],
    },
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
          <span style={styles.logo}>OKIRES 2026</span>
        </div>
        <h1 style={styles.title}>シミュレーション結果</h1>
        <p style={styles.subtitle}>
          事前準備Lv.{prepLevel} / 抗堪性Lv.{shelterLevel} / {month}月 発生
        </p>
      </div>

      {/* スコア */}
      <div style={{ ...styles.scoreCard, border: `3px solid ${rating.color}` }}>
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
            <span style={{ ...styles.legendLine, borderTop: '2px dashed #6366f1' }}></span>
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
                const barColor = d.delta >= GOV_BENCHMARK ? '#22c55e' : d.delta > 0 ? '#3b82f6' : '#e2e8f0';
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
                borderColor: remaining === 0 ? '#22c55e' : '#f97316',
                background: remaining === 0 ? '#f0fdf4' : '#fff7ed',
              }}>
                <div style={styles.areaName}>{AREA_NAMES[id as AreaId]}</div>
                {remaining === 0 ? (
                  <div style={styles.complete}>✓ 避難完了</div>
                ) : (
                  <>
                    <div style={{ color: '#f97316', fontSize: 18, fontWeight: 700 }}>{remaining}コマ残存</div>
                    <div style={{ color: '#94a3b8', fontSize: 12 }}>({remaining * 1000}人)</div>
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

      {/* 地域別 盲点・学習ポイント */}
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>📚 このシミュレーションから学ぶこと — 地域別の盲点と見えていないリスク</h2>
        <div style={styles.policyNote}>
          <strong>日本政府の避難計画：</strong>「1日2万人、6日間で12万人避難完了」
          —— このシミュレーションはAIが最適行動をとった場合の結果です。現実の避難はさらに多くの不確実性を含みます。
        </div>

        {regionalInsights.map((region) => {
          const area = areas[region.id];
          const remaining = area.residents + area.tourists + area.vulnerable + area.stagingPort;
          return (
            <div key={region.id} style={{ ...styles.regionBlock, borderLeft: `4px solid ${region.color}` }}>
              <div style={{ ...styles.regionHeader, color: region.color }}>
                {region.icon} {region.name}
                <span style={styles.regionResult}>
                  {remaining === 0 ? '✅ 避難完了' : `⚠️ ${remaining}コマ残存`}
                </span>
              </div>

              <div style={styles.regionSubtitle}>🔍 シミュレーションに含まれていない盲点</div>
              {region.blindspots.map((bp, i) => (
                <div key={i} style={styles.blindspotRow}>
                  <span style={{ ...styles.blindspotDot, background: region.color }} />
                  <span>{bp}</span>
                </div>
              ))}

              <div style={{ ...styles.regionSubtitle, marginTop: 12 }}>💡 このシミュレーションから得られる学び</div>
              {region.lessons.map((lesson, i) => (
                <div key={i} style={styles.lessonRow}>
                  <span style={{ ...styles.lessonNum, background: region.color }}>{i + 1}</span>
                  <span>{lesson}</span>
                </div>
              ))}
            </div>
          );
        })}

        <div style={{ ...styles.regionBlock, borderLeft: '4px solid #8b5cf6', marginTop: 8 }}>
          <div style={{ ...styles.regionHeader, color: '#8b5cf6' }}>
            🟣 シミュレーション全体で見えていないこと
          </div>
          {[
            '避難拒否者の存在：「島を守る」「財産を残せない」として避難しない住民が現実には一定数いる。強制力は現行法では非常に限定的',
            '情報伝達の崩壊：停電・通信遮断・デマの拡散により、住民が正確な避難情報を受け取れない事態は未考慮',
            '燃料の枯渇：有事初日から燃料の奪い合いが起きる。航空機・船舶への給油が確保できなければ輸送能力はゼロになる',
            '本土受け入れ体制：「避難先の九州での住居・生活支援・医療」の計画がなければ避難は完結しない。12万人の受け入れ準備は現状ほぼ未整備',
            '外国人観光客：中国・台湾・韓国・欧米からの観光客への対応言語、出国手続き、大使館との連携はシミュレーション外',
            '二次避難後の生活再建：「避難」はゴールではなく、長期的な生活再建・精神的支援・帰島の判断まで含めた計画が必要',
          ].map((item, i) => (
            <div key={i} style={styles.blindspotRow}>
              <span style={{ ...styles.blindspotDot, background: '#8b5cf6' }} />
              <span>{item}</span>
            </div>
          ))}
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
    <div style={{ background: '#fff', border: `2px solid ${color}`, borderRadius: 10, padding: 16, textAlign: 'center' }}>
      <div style={{ fontSize: 24, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: 12, color: '#94a3b8' }}>{sub}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 900, margin: '0 auto', padding: 20, fontFamily: '"Noto Sans JP", sans-serif', display: 'flex', flexDirection: 'column', gap: 20 },
  header: { textAlign: 'center', background: 'linear-gradient(135deg, #1e293b, #334155)', borderRadius: 12, padding: 32, color: '#fff' },
  logoRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 12 },
  triangle: { fontSize: 40, color: '#a78bfa' },
  logo: { fontSize: 36, fontWeight: 900, color: '#60a5fa' },
  title: { fontSize: 28, fontWeight: 700, margin: '8px 0' },
  subtitle: { color: '#94a3b8', fontSize: 14 },
  scoreCard: { background: '#fff', borderRadius: 12, padding: 24 },
  ratingRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  rating: { fontSize: 32, fontWeight: 900 },
  score: { fontSize: 24, fontWeight: 700, color: '#1e293b' },
  ratingDesc: { color: '#475569', marginBottom: 16 },
  progressLabel: { display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 6 },
  progressBar: { background: '#e2e8f0', borderRadius: 8, height: 16, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 8, transition: 'width 1s' },
  statsGrid: { display: 'grid', gap: 12 },
  card: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0' },
  cardTitle: { fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 16, borderBottom: '2px solid #3b82f6', paddingBottom: 8 },
  areaGrid: { display: 'grid', gap: 12 },
  areaCard: { border: '2px solid', borderRadius: 8, padding: 12, textAlign: 'center' },
  areaName: { fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 },
  complete: { fontSize: 16, fontWeight: 700, color: '#22c55e' },
  areaFatigue: { fontSize: 11, color: '#94a3b8', marginTop: 4 },
  bottleneckRow: { display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid #f1f5f9', color: '#dc2626', fontSize: 13 },
  bottleneckBullet: { fontWeight: 700, flexShrink: 0 },
  lessonRow: { display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#334155', alignItems: 'flex-start' },
  lessonNum: { background: '#3b82f6', color: '#fff', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 },
  policyNote: { background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13, color: '#92400e' },
  regionBlock: { background: '#f8fafc', borderRadius: 8, padding: '12px 14px', marginTop: 12, border: '1px solid #e2e8f0' },
  regionHeader: { fontSize: 16, fontWeight: 800, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' as const, gap: 8 },
  regionResult: { fontSize: 12, fontWeight: 600, color: '#475569' },
  regionSubtitle: { fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 6, marginTop: 4 },
  blindspotRow: { display: 'flex', gap: 10, padding: '5px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12, color: '#374151', lineHeight: 1.6, alignItems: 'flex-start' },
  blindspotDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 5 },
  restartBtn: { padding: 18, background: 'linear-gradient(135deg, #1e40af, #3b82f6)', color: '#fff', border: 'none', borderRadius: 12, fontSize: 18, fontWeight: 700, cursor: 'pointer' },
  footer: { textAlign: 'center', color: '#94a3b8', fontSize: 11 },
  // Chart styles
  chartLegend: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 12, color: '#64748b', flexWrap: 'wrap' },
  legendBar: { display: 'inline-block', width: 16, height: 16, background: '#3b82f6', borderRadius: 3, flexShrink: 0 },
  legendLine: { display: 'inline-block', width: 24, flexShrink: 0 },
  legendText: { marginRight: 12 },
  chartWrapper: { position: 'relative', paddingBottom: 8 },
  benchmarkLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTop: '2px dashed #6366f1',
    zIndex: 1,
    pointerEvents: 'none',
  },
  benchmarkLabel: {
    position: 'absolute',
    right: 0,
    top: -18,
    fontSize: 10,
    color: '#6366f1',
    fontWeight: 700,
    background: '#fff',
    padding: '0 4px',
  },
  barsRow: { display: 'flex', alignItems: 'flex-end', gap: 4, height: 180, overflowX: 'auto', paddingTop: 24 },
  barColumn: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '1 0 32px', minWidth: 32 },
  barOuter: { width: '100%', height: 140, display: 'flex', alignItems: 'flex-end', background: '#f8fafc', borderRadius: '4px 4px 0 0', border: '1px solid #e2e8f0', position: 'relative' },
  barInner: { width: '100%', borderRadius: '4px 4px 0 0', transition: 'height 0.5s ease', minHeight: 2 },
  barValue: { fontSize: 10, color: '#475569', fontWeight: 700, marginTop: 2, textAlign: 'center' },
  barLabel: { fontSize: 9, color: '#94a3b8', textAlign: 'center', marginTop: 2 },
  chartNote: { fontSize: 11, color: '#94a3b8', marginTop: 12, lineHeight: 1.5 },
};
