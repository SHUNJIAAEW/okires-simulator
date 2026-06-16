import React, { useState } from 'react';
import type { GameState, DayLog } from '../types';
import type { AreaId } from '../types';
import { useWindowWidth } from '../hooks/useWindowWidth';
import { DayLogPanel } from './DayLogPanel';
import { exportDailyReportPdf } from '../dailyReport';
import { C, FONT } from '../theme';

// ── 結果の内訳分析（いつ・なぜ・どのように・どうすべきか）を dayLogs から導出 ──
interface CauseRow { when: string; what: string; count: number; }
function analyzeDeaths(dayLogs: DayLog[]): { rows: CauseRow[]; total: number } {
  const rows: CauseRow[] = [];
  let prevDead = 0;
  for (const log of dayLogs) {
    const delta = log.totalDeadSoFar - prevDead;
    prevDead = log.totalDeadSoFar;
    if (delta <= 0) continue;
    const ev = log.events.join(' ');
    let what = '複合的な要因';
    if (/撃沈|輸送便/.test(ev)) what = '輸送機・船舶の撃墜／撃沈';
    else if (/施設破壊/.test(ev)) what = '空港・港湾の施設破壊';
    else if (/X\+3|竹富以西|期限/.test(ev)) what = 'X+3日 避難期限切れ（竹富以西）';
    else if (/疲労限界|疲労/.test(ev)) what = '住民の疲労限界（避難不能化）';
    else if (/大雨|強風/.test(ev)) what = '大雨・強風による避難停止中の被害';
    rows.push({ when: log.dayLabel, what, count: delta });
  }
  return { rows, total: prevDead };
}
const DEATH_FIX: Record<string, string> = {
  '輸送機・船舶の撃墜／撃沈': '護衛（制空・制海）を伴う輸送に切替え、夜間・分散運航でリスクを下げる。早期に輸送量を前倒し。',
  '空港・港湾の施設破壊': 'PAC3等の防空を該当拠点へ前進配備し、滑走路・岸壁の応急復旧部隊を事前展開する。',
  'X+3日 避難期限切れ（竹富以西）': '与那国・竹富を最優先で先行避難（X-3日から着手）。離島フェリーの増便を平時から準備。',
  '住民の疲労限界（避難不能化）': '抗堪性（シェルター）を引き上げ、避難所での休養と交代要員を確保。連続行動を避ける。',
  '大雨・強風による避難停止中の被害': '大雨に届きやすい7〜9月を避ける／天候の悪化前に前倒しで避難完了。強風時は風向に強い航路・空港へ振り分ける。',
  '複合的な要因': '事前準備レベルを上げ、輸送・防空・気象の各リスクに多重の代替手段を用意する。',
};

// 避難完了：日別の避難数と主な輸送手段を導出
function analyzeEvacuated(dayLogs: DayLog[]): { rows: CauseRow[]; total: number } {
  const rows: CauseRow[] = [];
  let prev = 0;
  for (const log of dayLogs) {
    const delta = log.totalEvacuatedSoFar - prev;
    prev = log.totalEvacuatedSoFar;
    if (delta <= 0) continue;
    const mc: Record<string, number> = {};
    for (const e of log.evacuations) mc[e.method] = (mc[e.method] || 0) + e.count;
    const methods = Object.entries(mc).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([m, c]) => `${m}(${c})`).join('・') || '—';
    rows.push({ when: log.dayLabel, what: methods, count: delta });
  }
  return { rows, total: prev };
}

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

// 取り残し：エリア別の残員と原因を導出
function analyzeStranded(
  areas: GameState['areas'], infra: GameState['infra'], transport: GameState['transport']
): { rows: CauseRow[]; total: number } {
  const rows: CauseRow[] = [];
  let total = 0;
  for (const [id, a] of Object.entries(areas)) {
    const rem = a.residents + a.tourists + a.vulnerable + a.stagingPort;
    if (rem <= 0) continue;
    total += rem;
    let what = '輸送容量が人数に追いつかなかった';
    if (id === 'miyako' && (!infra.bridgeIkema || !infra.bridgeKurima || !infra.bridgeIrabu))
      what = '橋の崩落で離島住民が孤立（移動不可）';
    else if (transport.civilianAirDisabled && transport.civilianShipDisabled)
      what = '民間航空・船舶がともに使用不能';
    else if (transport.civilianAirDisabled) what = '民間航空が使用不能で空路が激減';
    else if (transport.civilianShipDisabled) what = '民間船舶が使用不能で海路が激減';
    else if (a.fatigue >= a.baseActions) what = '疲労限界で避難行動が取れなかった';
    rows.push({ when: AREA_NAMES[id as AreaId], what, count: rem });
  }
  return { rows, total };
}
const STRAND_FIX: Record<string, string> = {
  '橋の崩落で離島住民が孤立（移動不可）': '池間・来間・伊良部の各橋を防空（PAC3前進配備）で守る。橋に依存しない海上ピックアップ手段を準備。',
  '民間航空・船舶がともに使用不能': '自衛隊・海保の輸送を主軸に再編し、護衛付き運航で民間の再開を促す。',
  '民間航空が使用不能で空路が激減': '海路（フェリー・海保・海自）へ振替え、空自輸送機の投入を増やす。',
  '民間船舶が使用不能で海路が激減': '空路（民間増便・空自輸送機）へ振替え、港湾の安全確保を急ぐ。',
  '疲労限界で避難行動が取れなかった': '抗堪性を上げ休養・交代要員を確保。連続行動を避け手数を温存する。',
  '輸送容量が人数に追いつかなかった': '事前準備Lvを上げ便数・港湾処理量を増強。早期着手で日数を稼ぐ。',
};

const GOV_BENCHMARK = 20; // コマ/day (= 2万人/day)

function Corners({ color = C.borderHi }: { color?: string }) {
  const base: React.CSSProperties = { position: 'absolute', width: 12, height: 12, pointerEvents: 'none' };
  return (
    <>
      <span style={{ ...base, top: -1, left: -1, borderTop: `2px solid ${color}`, borderLeft: `2px solid ${color}` }} />
      <span style={{ ...base, top: -1, right: -1, borderTop: `2px solid ${color}`, borderRight: `2px solid ${color}` }} />
      <span style={{ ...base, bottom: -1, left: -1, borderBottom: `2px solid ${color}`, borderLeft: `2px solid ${color}` }} />
      <span style={{ ...base, bottom: -1, right: -1, borderBottom: `2px solid ${color}`, borderRight: `2px solid ${color}` }} />
    </>
  );
}

export function ResultScreen({ state, onRestart }: Props) {
  const { evacuated, dead, areas, dayLogs, prepLevel, shelterLevel, month } = state;
  const isMobile = useWindowWidth() < 768;

  const totalRemaining = Object.values(areas).reduce((sum, a) =>
    sum + a.residents + a.tourists + a.vulnerable + a.stagingPort, 0
  );
  const maxEvacuated = evacuated + dead + totalRemaining;
  const evacuationRate = maxEvacuated > 0 ? (evacuated / maxEvacuated * 100) : 0;
  const score = Math.round(evacuationRate);

  const getRating = (rate: number) => {
    if (rate >= 95) return { label: 'S', color: C.amber, desc: '驚異的な避難達成率。日本政府の計画を完全実証' };
    if (rate >= 80) return { label: 'A', color: C.green, desc: '優秀な避難実施。6日間12万人計画を概ね達成' };
    if (rate >= 60) return { label: 'B', color: C.blue, desc: '一定の避難達成。改善の余地あり' };
    if (rate >= 40) return { label: 'C', color: '#ff9e3d', desc: '半数以上が取り残された。事前準備の重要性を実感' };
    return { label: 'D', color: C.red, desc: '深刻な避難失敗。事前準備なしでは住民を守れない' };
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
    id: AreaId; name: string; color: string; icon: string;
    blindspots: string[]; lessons: string[];
  }[] = [
    {
      id: 'yonaguni', name: '与那国島', color: '#ff5a5a', icon: '🔴',
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
      id: 'taketomi', name: '竹富町全島', color: '#ff9e3d', icon: '🟠',
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
      id: 'ishigaki', name: '石垣島', color: '#38bdf8', icon: '🔵',
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
      id: 'miyako', name: '宮古島・多良間', color: '#00ff88', icon: '🟢',
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
    return { day: log.day, dayLabel: log.dayLabel, delta: log.totalEvacuatedSoFar - prev, cumulative: log.totalEvacuatedSoFar };
  });
  const maxDelta = Math.max(...dailyDeltas.map(d => d.delta), GOV_BENCHMARK, 1);
  const activeDays = dailyDeltas.filter(d => d.delta > 0);
  const avgPerDay = activeDays.length > 0 ? activeDays.reduce((s, d) => s + d.delta, 0) / activeDays.length : 0;
  const benchmarkPct = (GOV_BENCHMARK / maxDelta) * 100;

  // 内訳分析データ（死亡・取り残し・避難完了を同形式で）
  const deathAnalysis = analyzeDeaths(dayLogs);
  const evacAnalysis = analyzeEvacuated(dayLogs);
  const strandedAnalysis = analyzeStranded(areas, state.infra, state.transport);
  const [showDays, setShowDays] = useState(false);

  const handlePrint = () => window.print();

  return (
    <div className="result-print-root" style={styles.page}>
      {/* 機密バナー */}
      <div style={styles.classBar}>
        <span style={styles.classDot} />
        <span style={styles.classText}>AFTER-ACTION REPORT // 作戦事後評価 — 先島諸島 広域避難</span>
        <span style={{ ...styles.classText, marginLeft: 'auto', color: C.dim }}>EOF.MISSION</span>
      </div>

      <div className="result-container" style={{ ...styles.container, padding: isMobile ? '20px 14px 48px' : '32px 24px 56px' }}>
        {/* ヘッダー */}
        <div className="tac-fade" style={styles.header}>
          <div style={styles.logoRow}>
            <span style={styles.triangle}>▲</span>
            <span style={styles.logo}>OKIRES</span>
            <span style={styles.logoYear}>2026</span>
          </div>
          <h1 style={styles.title}>シミュレーション結果</h1>
          <p style={styles.subtitle}>
            事前準備 <b style={styles.subHi}>Lv.{prepLevel}</b> ／ 抗堪性 <b style={styles.subHi}>Lv.{shelterLevel}</b> ／ <b style={styles.subHi}>{month}月</b> 発生
          </p>
          <button className="no-print tac-ghost" style={styles.pdfBtn} onClick={handlePrint}>
            🖨 結果をPDFで出力
          </button>
          <button className="no-print tac-ghost" style={{ ...styles.pdfBtn, marginLeft: 8 }} onClick={() => exportDailyReportPdf(state)}>
            📄 毎日の行動記録をPDF保存
          </button>
        </div>

        {/* スコア */}
        <div className="tac-card tac-fade" style={{ ...styles.scoreCard, borderColor: rating.color, boxShadow: `0 0 0 1px ${rating.color}44, 0 16px 48px rgba(0,0,0,0.5)`, animationDelay: '0.05s' }}>
          <Corners color={rating.color} />
          <div style={{ ...styles.ratingRow, flexDirection: isMobile ? 'column' : 'row' }}>
            <div style={styles.ratingBlock}>
              <div style={styles.ratingLabel}>EVALUATION</div>
              <div style={{ ...styles.ratingBadge, color: rating.color, borderColor: rating.color, textShadow: `0 0 24px ${rating.color}` }}>
                {rating.label}
                <span style={styles.ratingRank}>RANK</span>
              </div>
            </div>
            <div style={styles.scoreBlock}>
              <div style={styles.scoreLabel}>避難完了率</div>
              <div style={{ ...styles.scoreValue, color: rating.color }}>
                {evacuationRate.toFixed(1)}<span style={styles.scoreUnit}>%</span>
              </div>
              <div style={styles.scoreSub}>SCORE {score} / 100</div>
            </div>
          </div>
          <p style={styles.ratingDesc}>{rating.desc}</p>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${evacuationRate}%`, background: rating.color, boxShadow: `0 0 14px ${rating.color}aa` }} />
          </div>
        </div>

        {/* 統計 */}
        <div style={{ ...styles.statsGrid, gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)' }}>
          <StatCard label="避難完了" value={`${evacuated}`} unit="コマ" sub={`${(evacuated * 1000).toLocaleString()}人`} color={C.green} icon="✈" />
          <StatCard label="取り残し" value={`${totalRemaining}`} unit="コマ" sub={`${(totalRemaining * 1000).toLocaleString()}人`} color={C.amber} icon="⏳" />
          <StatCard label="死亡" value={`${dead}`} unit="コマ" sub={`${(dead * 1000).toLocaleString()}人`} color={C.red} icon="💀" />
          <StatCard label="シミュ期間" value={`${dayLogs.length}`} unit="日" sub="X-3〜X+8" color={C.blue} icon="📅" />
          <StatCard label="実績 平均/日" value={`${avgPerDay.toFixed(1)}`} unit="コマ" sub={`${(avgPerDay * 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })}人/日`} color={avgPerDay >= GOV_BENCHMARK ? C.green : C.amber} icon="📊" />
          <StatCard label="政府目標 平均/日" value={`${GOV_BENCHMARK}`} unit="コマ" sub="2万人/日" color={C.violet} icon="🎯" />
          <StatCard label="目標比" value={`${avgPerDay > 0 ? ((avgPerDay / GOV_BENCHMARK) * 100).toFixed(0) : 0}`} unit="%" sub={avgPerDay >= GOV_BENCHMARK ? '目標達成' : '目標未達'} color={avgPerDay >= GOV_BENCHMARK ? C.green : C.red} icon={avgPerDay >= GOV_BENCHMARK ? '✅' : '❌'} />
          <StatCard label="生存率" value={`${maxEvacuated > 0 ? (((evacuated + totalRemaining) / maxEvacuated) * 100).toFixed(0) : 100}`} unit="%" sub={`死亡${dead}コマ`} color={dead === 0 ? C.green : C.amber} icon="🛟" />
        </div>

        {/* Day-by-day 避難チャート */}
        {dailyDeltas.length > 0 && (
          <Card title="日別避難数チャート" en="DAILY THROUGHPUT" accent={C.green}>
            <div style={styles.chartLegend}>
              <span style={{ ...styles.legendBar, background: C.green }} /> <span style={styles.legendText}>目標達成</span>
              <span style={{ ...styles.legendBar, background: C.blue }} /> <span style={styles.legendText}>目標未達</span>
              <span style={{ ...styles.legendLine }} /> <span style={styles.legendText}>政府目標 20コマ/日</span>
            </div>
            <div style={styles.chartWrapper}>
              <div style={{ ...styles.benchmarkLine, bottom: `${benchmarkPct}%` }}>
                <span style={styles.benchmarkLabel}>目標 20</span>
              </div>
              <div style={styles.barsRow}>
                {dailyDeltas.map((d) => {
                  const barHeight = (d.delta / maxDelta) * 100;
                  const barColor = d.delta >= GOV_BENCHMARK ? C.green : d.delta > 0 ? C.blue : C.border;
                  return (
                    <div key={d.dayLabel} style={styles.barColumn}>
                      <div style={styles.barOuter}>
                        <div style={{ ...styles.barInner, height: `${barHeight}%`, background: barColor, boxShadow: d.delta > 0 ? `0 0 10px ${barColor}88` : 'none' }}
                          title={`${d.dayLabel}: ${d.delta}コマ (${(d.delta * 1000).toLocaleString()}人)`} />
                      </div>
                      <div style={styles.barValue}>{d.delta > 0 ? d.delta : '–'}</div>
                      <div style={styles.barLabel}>{d.dayLabel}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={styles.chartNote}>各バー＝その日に新たに避難完了したコマ数。緑＝政府目標達成、青＝目標未達、灰＝避難なし。</div>
          </Card>
        )}

        {/* 内訳分析 ― いつ・なぜ・どのように・どうすべきか */}
        <Card title="結果の内訳分析 ― いつ・なぜ・どのように・どうすべきか" en="WHEN / WHY / HOW / FIX" accent={C.amber}>
          {/* 避難完了（日別×輸送手段） */}
          <BreakdownBlock
            color={C.green} icon="✈" title="避難完了" totalKoma={evacuated} colLabel="いつ（日）"
            rows={evacAnalysis.rows} emptyText="避難実績なし"
            recHead="どうすべきか"
            recs={[
              { k: 'いつ・どのように', v: `実績平均 ${avgPerDay.toFixed(1)}コマ/日（政府目標 ${GOV_BENCHMARK}コマ/日）。上表のとおり日別・手段別に避難。` },
              { k: '改善', v: avgPerDay >= GOV_BENCHMARK ? 'この水準を維持。大雨・強風の悪天候前に前倒しで安全余裕を確保。' : '目標未達。事前準備Lvと輸送手段の多重化で日次スループットを底上げ。' },
            ]}
          />

          {/* 取り残し（エリア別×原因） */}
          <BreakdownBlock
            color={C.amber} icon="⏳" title="取り残し" totalKoma={strandedAnalysis.total} colLabel="どこ（エリア）"
            rows={strandedAnalysis.rows} emptyText="取り残しなし（全員避難）"
            recHead="どうすべきか（原因別）"
            recs={[...new Set(strandedAnalysis.rows.map(r => r.what))].map(reason => ({
              k: reason, v: STRAND_FIX[reason] ?? STRAND_FIX['輸送容量が人数に追いつかなかった'],
            }))}
          />

          {/* 死亡（日別×原因） */}
          <BreakdownBlock
            color={C.red} icon="💀" title="死亡" totalKoma={deathAnalysis.total} colLabel="いつ（日）"
            rows={deathAnalysis.rows} emptyText="死者なし（人的損失ゼロで避難を完遂）"
            recHead="どうすべきか（原因別）"
            recs={[...new Set(deathAnalysis.rows.map(r => r.what))].map(cause => ({
              k: cause, v: DEATH_FIX[cause] ?? DEATH_FIX['複合的な要因'],
            }))}
          />
        </Card>

        {/* 1日ごとの詳細（各コマの振り返り） */}
        <Card title="1日ごとの詳細 ― 各コマの振り返り" en="DAY-BY-DAY REVIEW" accent={C.blue}>
          <button className="no-print tac-ghost" style={styles.dayToggle} onClick={() => setShowDays(s => !s)}>
            {showDays ? '▲ 日別の詳細を閉じる' : `▼ 全${dayLogs.length}日分の詳細（天候・避難実績・イベント・24hダイス・エリア別残員）を開く`}
          </button>
          <div className={showDays ? undefined : 'no-print'} style={{ display: showDays ? 'block' : 'none', marginTop: 12 }}>
            <DayLogPanel logs={dayLogs} />
          </div>
        </Card>

        {/* エリア別結果 */}
        <Card title="エリア別残員状況" en="SECTOR STATUS" accent={C.blue}>
          <div style={{ ...styles.areaGrid, gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)' }}>
            {Object.entries(areas).map(([id, area]) => {
              const remaining = area.residents + area.tourists + area.vulnerable + area.stagingPort;
              const done = remaining === 0;
              return (
                <div key={id} style={{ ...styles.areaCard, borderColor: done ? C.green : C.amber, background: done ? 'rgba(0,255,136,0.06)' : 'rgba(255,179,0,0.06)' }}>
                  <div style={styles.areaName}>{AREA_NAMES[id as AreaId]}</div>
                  {done ? (
                    <div style={{ ...styles.areaStat, color: C.green }}>✓ 避難完了</div>
                  ) : (
                    <>
                      <div style={{ ...styles.areaStat, color: C.amber }}>{remaining}<span style={styles.areaUnit}>コマ残存</span></div>
                      <div style={styles.areaPeople}>{(remaining * 1000).toLocaleString()}人</div>
                    </>
                  )}
                  <div style={styles.areaFatigue}>疲労 {area.fatigue >= 0 ? '+' : ''}{area.fatigue.toFixed(1)}</div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* ボトルネック分析 */}
        {bottlenecks.length > 0 && (
          <Card title="ボトルネック分析" en="CRITICAL FAILURES" accent={C.red}>
            {bottlenecks.map((bn, i) => (
              <div key={i} style={styles.bottleneckRow}>
                <span style={styles.bottleneckBullet}>▶</span>
                <span>{bn}</span>
              </div>
            ))}
          </Card>
        )}

        {/* 地域別 盲点・学習ポイント */}
        <Card title="地域別の盲点と見えていないリスク" en="INTELLIGENCE GAPS" accent={C.violet}>
          <div style={styles.policyNote}>
            <strong style={{ color: C.amber }}>日本政府の避難計画：</strong>「1日2万人、6日間で12万人避難完了」——
            このシミュレーションはAIが最適行動をとった場合の結果です。現実の避難はさらに多くの不確実性を含みます。
          </div>

          {regionalInsights.map((region) => {
            const area = areas[region.id];
            const remaining = area.residents + area.tourists + area.vulnerable + area.stagingPort;
            return (
              <div key={region.id} style={{ ...styles.regionBlock, borderLeft: `3px solid ${region.color}` }}>
                <div style={styles.regionHeader}>
                  <span style={{ color: region.color, fontWeight: 800, fontSize: 15 }}>{region.icon} {region.name}</span>
                  <span style={{ ...styles.regionResult, color: remaining === 0 ? C.green : C.amber }}>
                    {remaining === 0 ? '✅ 避難完了' : `⚠ ${remaining}コマ残存`}
                  </span>
                </div>
                <div style={styles.regionSubtitle}>🔍 シミュレーションに含まれていない盲点</div>
                {region.blindspots.map((bp, i) => (
                  <div key={i} style={styles.blindspotRow}>
                    <span style={{ ...styles.blindspotDot, background: region.color, boxShadow: `0 0 6px ${region.color}` }} />
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

          <div style={{ ...styles.regionBlock, borderLeft: `3px solid ${C.violet}`, marginTop: 10 }}>
            <div style={styles.regionHeader}>
              <span style={{ color: C.violet, fontWeight: 800, fontSize: 15 }}>🟣 シミュレーション全体で見えていないこと</span>
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
                <span style={{ ...styles.blindspotDot, background: C.violet, boxShadow: `0 0 6px ${C.violet}` }} />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </Card>

        <button className="no-print tac-cta" style={styles.restartBtn} onClick={onRestart} onFocus={e => e.currentTarget.blur()} onMouseDown={e => e.preventDefault()}>
          <span style={styles.restartMain}>↻ もう一度シミュレーション</span>
          <span style={styles.restartSub}>RE-RUN MISSION</span>
        </button>

        <div style={styles.footer}>OKIRES2026 デジタルシミュレーター ／ ルール: OKIRES製作委員会 (okires2025@gmail.com)</div>
      </div>
    </div>
  );
}

function AnaRow({ k, v }: { k: string; v: string }) {
  return (
    <div style={styles.anaRow}>
      <span style={styles.anaKey}>{k}</span>
      <span style={styles.anaVal}>{v}</span>
    </div>
  );
}

// 死亡・取り残し・避難完了で共通の内訳ブロック（行＋原因別の改善策）
function BreakdownBlock({ color, icon, title, totalKoma, colLabel, rows, recHead, recs, emptyText }: {
  color: string; icon: string; title: string; totalKoma: number; colLabel: string;
  rows: { when: string; what: string; count: number }[];
  recHead: string; recs: { k: string; v: string }[]; emptyText?: string;
}) {
  return (
    <div style={{ ...styles.anaBlock, borderLeft: `3px solid ${color}` }}>
      <div style={{ ...styles.anaHead, color }}>{icon} {title} — {totalKoma}コマ（{(totalKoma * 1000).toLocaleString()}人）</div>
      {rows.length > 0 ? (
        <>
          <div style={styles.brHeadRow}>
            <span style={styles.brHeadWhen}>{colLabel}</span>
            <span style={styles.brHeadWhat}>内容・原因</span>
            <span style={styles.brHeadCount}>コマ</span>
          </div>
          {rows.map((r, i) => (
            <div key={i} style={styles.deathRow}>
              <span style={{ ...styles.deathWhen, color }}>{r.when}</span>
              <span style={styles.deathWhat}>{r.what}</span>
              <span style={{ ...styles.deathCount, color }}>{r.count}</span>
            </div>
          ))}
        </>
      ) : (
        <AnaRow k="—" v={emptyText ?? '該当なし'} />
      )}
      {recs.length > 0 && <div style={{ ...styles.anaSubHead, color }}>{recHead}</div>}
      {recs.map((rc, i) => <AnaRow key={i} k={rc.k} v={rc.v} />)}
    </div>
  );
}

function Card({ title, en, accent, children }: { title: string; en: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="tac-card tac-fade" style={styles.card}>
      <div style={styles.cardHead}>
        <span style={{ ...styles.cardAccent, background: accent, boxShadow: `0 0 10px ${accent}` }} />
        <h2 style={styles.cardTitle}>{title}</h2>
        <span style={styles.cardEn}>{en}</span>
      </div>
      {children}
    </div>
  );
}

function StatCard({ label, value, unit, sub, color, icon }: {
  label: string; value: string; unit: string; sub: string; color: string; icon: string;
}) {
  return (
    <div className="tac-card" style={{ ...styles.statCard, borderColor: color + '55' }}>
      <div style={styles.statTop}>
        <span style={styles.statIcon}>{icon}</span>
        <span style={styles.statLabel}>{label}</span>
      </div>
      <div style={{ ...styles.statValue, color, textShadow: `0 0 16px ${color}55` }}>
        {value}<span style={styles.statUnit}>{unit}</span>
      </div>
      <div style={styles.statSub}>{sub}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', fontFamily: FONT.jp, color: C.body },
  classBar: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px',
    background: 'rgba(167,139,250,0.07)', borderBottom: `1px solid ${C.border}`, fontFamily: FONT.mono,
  },
  classDot: { width: 7, height: 7, borderRadius: '50%', background: C.violet, boxShadow: `0 0 8px ${C.violet}`, animation: 'okires-blink 1.6s infinite' },
  classText: { fontSize: 10.5, letterSpacing: 1, color: C.violet, fontWeight: 700 },
  container: { maxWidth: 920, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 },

  header: { textAlign: 'center', padding: '8px 0 4px' },
  logoRow: { display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 10, marginBottom: 8 },
  triangle: { fontSize: 26, color: C.green, filter: `drop-shadow(0 0 10px ${C.green})`, alignSelf: 'center' },
  logo: { fontSize: 30, fontWeight: 700, color: C.white, fontFamily: FONT.display, letterSpacing: 1 },
  logoYear: { fontFamily: FONT.mono, fontSize: 13, fontWeight: 700, color: C.bgDeep, background: C.green, padding: '2px 7px', borderRadius: 3 },
  title: { fontSize: 24, fontWeight: 700, color: C.white, margin: '6px 0', fontFamily: FONT.jp },
  subtitle: { color: C.dim, fontSize: 13, fontFamily: FONT.mono },
  subHi: { color: C.bright },

  scoreCard: { position: 'relative', background: `linear-gradient(180deg, ${C.bgPanel}, ${C.bgDeep})`, borderWidth: 1, borderStyle: 'solid', borderRadius: 4, padding: 24 },
  ratingRow: { display: 'flex', alignItems: 'center', gap: 20, marginBottom: 14 },
  ratingBlock: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 },
  ratingLabel: { fontFamily: FONT.mono, fontSize: 10, color: C.dim, letterSpacing: 2 },
  ratingBadge: { position: 'relative', fontFamily: FONT.display, fontSize: 64, fontWeight: 700, lineHeight: 1, border: '2px solid', borderRadius: 6, width: 110, height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  ratingRank: { position: 'absolute', bottom: 8, fontFamily: FONT.mono, fontSize: 9, letterSpacing: 2, opacity: 0.7 },
  scoreBlock: { flex: 1, textAlign: 'center' },
  scoreLabel: { fontSize: 12, color: C.dim, marginBottom: 2 },
  scoreValue: { fontFamily: FONT.mono, fontSize: 56, fontWeight: 800, lineHeight: 1 },
  scoreUnit: { fontSize: 26, marginLeft: 2 },
  scoreSub: { fontFamily: FONT.mono, fontSize: 11, color: C.dim, letterSpacing: 1, marginTop: 4 },
  ratingDesc: { color: C.body, marginBottom: 14, fontSize: 13, textAlign: 'center', lineHeight: 1.6 },
  progressBar: { background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, height: 14, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 8, transition: 'width 1s ease' },

  statsGrid: { display: 'grid', gap: 10 },
  statCard: { background: `linear-gradient(180deg, ${C.bgPanel}, ${C.bgDeep})`, borderWidth: 1, borderStyle: 'solid', borderRadius: 4, padding: '12px 14px' },
  statTop: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 },
  statIcon: { fontSize: 14 },
  statLabel: { fontSize: 10.5, color: C.dim, fontFamily: FONT.mono, letterSpacing: 0.5 },
  statValue: { fontFamily: FONT.mono, fontSize: 26, fontWeight: 800, lineHeight: 1 },
  statUnit: { fontSize: 12, marginLeft: 3, fontWeight: 600 },
  statSub: { fontSize: 11, color: C.dim, marginTop: 4, fontFamily: FONT.mono },

  card: { position: 'relative', background: `linear-gradient(180deg, ${C.bgPanel}, ${C.bgDeep})`, borderRadius: 4, padding: 18, border: `1px solid ${C.border}`, boxShadow: '0 12px 36px rgba(0,0,0,0.4)' },
  cardHead: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, paddingBottom: 10, borderBottom: `1px solid ${C.border}` },
  cardAccent: { width: 4, height: 18, borderRadius: 2, flexShrink: 0 },
  cardTitle: { fontSize: 16, fontWeight: 700, color: C.white, margin: 0, fontFamily: FONT.jp },
  cardEn: { fontFamily: FONT.mono, fontSize: 10, color: C.dim, letterSpacing: 1.5, marginLeft: 'auto' },

  areaGrid: { display: 'grid', gap: 10 },
  areaCard: { borderWidth: 1, borderStyle: 'solid', borderRadius: 4, padding: 12, textAlign: 'center' },
  areaName: { fontSize: 12, fontWeight: 700, color: C.bright, marginBottom: 6 },
  areaStat: { fontSize: 17, fontWeight: 800, fontFamily: FONT.mono },
  areaUnit: { fontSize: 11, marginLeft: 3, fontWeight: 600 },
  areaPeople: { color: C.dim, fontSize: 11, fontFamily: FONT.mono },
  areaFatigue: { fontSize: 10, color: C.dim, marginTop: 6, fontFamily: FONT.mono },

  bottleneckRow: { display: 'flex', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.border}`, color: '#ff8d8d', fontSize: 13, lineHeight: 1.5, alignItems: 'flex-start' },
  bottleneckBullet: { color: C.red, flexShrink: 0, fontSize: 11, marginTop: 2 },

  policyNote: { background: 'rgba(255,179,0,0.07)', border: `1px solid ${C.border}`, borderRadius: 4, padding: 12, marginBottom: 14, fontSize: 12.5, color: C.body, lineHeight: 1.7 },
  regionBlock: { background: 'rgba(0,0,0,0.25)', borderRadius: 4, padding: '12px 14px', marginTop: 10, border: `1px solid ${C.border}` },
  regionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  regionResult: { fontSize: 12, fontWeight: 700, fontFamily: FONT.mono },
  regionSubtitle: { fontSize: 11.5, fontWeight: 700, color: C.dim, marginBottom: 6, marginTop: 4, fontFamily: FONT.mono, letterSpacing: 0.5 },
  blindspotRow: { display: 'flex', gap: 10, padding: '5px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.body, lineHeight: 1.65, alignItems: 'flex-start' },
  blindspotDot: { width: 7, height: 7, borderRadius: 2, flexShrink: 0, marginTop: 5 },
  lessonRow: { display: 'flex', gap: 10, padding: '5px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.bright, alignItems: 'flex-start', lineHeight: 1.6 },
  lessonNum: { color: '#06121f', width: 20, height: 20, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0, fontFamily: FONT.mono },

  restartBtn: {
    marginTop: 4, padding: 16, background: `linear-gradient(135deg, ${C.blue}, #2a8fd0)`,
    color: '#001a26', border: 'none', borderRadius: 4, cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    boxShadow: '0 8px 28px rgba(56,189,248,0.25)',
  },
  restartMain: { fontSize: 17, fontWeight: 900, fontFamily: FONT.jp, letterSpacing: 0.5 },
  restartSub: { fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, letterSpacing: 3, opacity: 0.7 },
  footer: { textAlign: 'center', color: C.dim, fontSize: 11, fontFamily: FONT.mono, marginTop: 4 },

  // 内訳分析
  pdfBtn: { marginTop: 12, padding: '8px 18px', background: 'rgba(42,100,150,0.12)', color: C.white, borderWidth: 1, borderStyle: 'solid', borderColor: C.borderHi, borderRadius: 4, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT.jp },
  anaBlock: { background: 'rgba(0,0,0,0.25)', borderRadius: 4, padding: '12px 14px', marginTop: 10, border: `1px solid ${C.border}` },
  anaHead: { fontSize: 15, fontWeight: 800, marginBottom: 8 },
  anaSubHead: { fontSize: 12, fontWeight: 700, marginTop: 10, marginBottom: 4, fontFamily: FONT.mono },
  anaRow: { display: 'flex', gap: 10, padding: '4px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12.5, alignItems: 'flex-start', lineHeight: 1.6 },
  anaKey: { color: C.bright, fontWeight: 700, minWidth: 84, flexShrink: 0 },
  anaVal: { color: C.body },
  brHeadRow: { display: 'flex', gap: 10, padding: '2px 0 4px', fontSize: 10, color: C.dim, fontFamily: FONT.mono, letterSpacing: 0.5, borderBottom: `1px solid ${C.border}` },
  brHeadWhen: { minWidth: 92, fontWeight: 700 },
  brHeadWhat: { flex: 1, fontWeight: 700 },
  brHeadCount: { minWidth: 34, textAlign: 'right', fontWeight: 700 },
  deathRow: { display: 'flex', gap: 10, padding: '4px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12.5, alignItems: 'center' },
  deathWhen: { fontFamily: FONT.mono, color: C.amber, fontWeight: 700, minWidth: 92, lineHeight: 1.4 },
  deathWhat: { color: C.body, flex: 1, lineHeight: 1.5 },
  deathCount: { fontFamily: FONT.mono, color: C.red, fontWeight: 800, minWidth: 34, textAlign: 'right' },
  dayToggle: { width: '100%', padding: '10px 14px', background: 'rgba(42,100,150,0.12)', color: C.white, borderWidth: 1, borderStyle: 'solid', borderColor: C.borderHi, borderRadius: 4, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT.jp, textAlign: 'left' },
  // Chart
  chartLegend: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: 11, color: C.dim, flexWrap: 'wrap', fontFamily: FONT.mono },
  legendBar: { display: 'inline-block', width: 12, height: 12, borderRadius: 2, flexShrink: 0 },
  legendLine: { display: 'inline-block', width: 20, borderTop: `2px dashed ${C.violet}`, flexShrink: 0 },
  legendText: { marginRight: 10 },
  chartWrapper: { position: 'relative', paddingBottom: 8 },
  benchmarkLine: { position: 'absolute', left: 0, right: 0, borderTop: `2px dashed ${C.violet}`, zIndex: 1, pointerEvents: 'none' },
  benchmarkLabel: { position: 'absolute', right: 0, top: -16, fontSize: 9, color: C.violet, fontWeight: 700, background: C.bgDeep, padding: '0 4px', fontFamily: FONT.mono },
  barsRow: { display: 'flex', alignItems: 'flex-end', gap: 4, height: 180, overflowX: 'auto', paddingTop: 24 },
  barColumn: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '1 0 30px', minWidth: 30 },
  barOuter: { width: '100%', height: 140, display: 'flex', alignItems: 'flex-end', background: 'rgba(0,0,0,0.25)', borderRadius: '3px 3px 0 0', border: `1px solid ${C.border}`, position: 'relative' },
  barInner: { width: '100%', borderRadius: '3px 3px 0 0', transition: 'height 0.6s ease', minHeight: 2 },
  barValue: { fontSize: 10, color: C.bright, fontWeight: 700, marginTop: 3, fontFamily: FONT.mono },
  barLabel: { fontSize: 8.5, color: C.dim, marginTop: 2, fontFamily: FONT.mono },
  chartNote: { fontSize: 11, color: C.dim, marginTop: 12, lineHeight: 1.5 },
};
