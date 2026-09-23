// AI災害司令官 — 画面層（第2バッチ）
//
// 設計思想: 正解を教えるAIではなく、意思決定を鍛えるAI。
//   ・5方針は数値だけを並べ、「推奨」「正解」バッジは付けない
//   ・予測（forecast×5方針）は日付が変わったときだけ再計算し、方針ごとに setTimeout で分割して描画をブロックしない
//   ・分析（analyzeDay）は「実行」直後に App 側で作り、ここでは表示と AI の見立て（getAdvice）だけを扱う
import React, { useEffect, useMemo, useState } from 'react';
import type { GameState, EvacPolicy, DayCapacities, VulnerableCategory } from '../types';
import { EVAC_POLICIES, POLICY_LABELS, BOTTLENECK_LABELS, forecast, totalRemaining, evacuationRate, vulnerableTotals } from '../commander';
import type { Forecast, DayAnalysis } from '../commander';
import { getAdvice, FOCUS_LABELS } from '../advisor';
import type { Advice } from '../advisor';
import { breakdownTotal, totalCapacityOffered, VULNERABLE_CATEGORY_JP, VULNERABLE_CATEGORIES } from '../gameEngine';
import { C, FONT } from '../theme';

const FORECAST_RUNS = 80;
const LAST_DAY = 8;

// 司令官モードで1日進めた記録（App が保持し、結果画面の「判断ログ」にも使う）
export interface CommanderRecord {
  day: number;
  dayLabel: string;
  policy: EvacPolicy;
  analysis: DayAnalysis;
  capacities: DayCapacities;
}

const POLICY_COLORS: Record<EvacPolicy, string> = {
  'balanced': C.green,
  'sea-first': C.blue,
  'air-first': C.violet,
  'vulnerable-first': C.amber,
  'shuttle-first': '#ff9e3d',
};

const pct = (x: number | null | undefined, digits = 0) => (x == null ? '—' : `${(x * 100).toFixed(digits)}%`);
const fmt1 = (x: number) => { const r = Math.round(x * 10) / 10; return Number.isInteger(r) ? `${r}` : r.toFixed(1); };

// ===== KPIバー（司令官モードOFFでも表示可）=====
export function CommanderKpiBar({ state, lastCapacities, isMobile }: { state: GameState; lastCapacities: DayCapacities | null; isMobile: boolean }) {
  const remaining = totalRemaining(state);
  const rate = evacuationRate(state);
  const vTotals = vulnerableTotals(state);
  const vHome = (Object.keys(state.areas) as (keyof typeof state.areas)[]).reduce((s, id) => s + state.areas[id].vulnerable, 0);
  const vWait = breakdownTotal(state.vulnerableInTransit);
  const vRemaining = vHome + vWait;
  const staging = Object.values(state.areas).reduce((s, a) => s + a.stagingPort + (a.stagingVulnerable ?? 0), 0);
  const daysLeft = Math.max(0, LAST_DAY - state.day + 1);
  const cap = lastCapacities ? totalCapacityOffered(lastCapacities) : (state.dayLogs[state.dayLogs.length - 1]?.capacityOffered ?? null);
  const capDetail = lastCapacities ? capacityBreakdown(lastCapacities) : null;

  const items: { label: string; value: string; sub?: string; color: string }[] = [
    { label: '現在人口', value: `${fmt1(remaining)}`, sub: 'コマ（島内残）', color: C.bright },
    { label: '避難完了', value: `${fmt1(state.evacuated)}`, sub: pct(rate, 1), color: C.green },
    { label: '要支援者', value: `${fmt1(vRemaining)}`, sub: `残${fmt1(vHome)}／待機${fmt1(vWait)}（計${fmt1(breakdownTotal(vTotals))}）`, color: C.amber },
    { label: '輸送待ち', value: `${fmt1(staging)}`, sub: 'ハブ待機（白＋要援護）', color: C.blue },
    { label: '残り日数', value: `${daysLeft}`, sub: 'X+8日まで', color: daysLeft <= 2 ? C.red : C.bright },
    { label: '輸送能力', value: cap == null ? '—' : `${fmt1(cap)}`, sub: capDetail ?? (cap == null ? '未実行' : '直近日の提供容量'), color: C.violet },
  ];
  return (
    <div style={{ ...kpi.bar, gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(6, 1fr)', padding: isMobile ? '8px 12px' : '8px 20px' }}>
      {items.map(it => (
        <div key={it.label} style={kpi.item}>
          <span style={kpi.label}>{it.label}</span>
          <span style={{ ...kpi.value, color: it.color }}>{it.value}</span>
          {it.sub && <span style={kpi.sub} title={it.sub}>{it.sub}</span>}
        </div>
      ))}
    </div>
  );
}

function capacityBreakdown(c: DayCapacities): string {
  const air = c.yonaguniAirMax + c.haterumaAirMax + c.ishigakiAirMax + c.miyakoAirMax + c.shimojAirMax;
  const jsdf = c.ishigakiJasdfMax + Math.min(c.ishigakiJmsdfMax + c.miyakoJmsdfMax, c.jmsdfRemaining);
  const sea = c.yonaguniSeaMax + c.taketomiFerryMax + c.ishigakiCoastGuardMax + c.ishigakiFerryMax + c.miyakoCoastGuardMax + c.miyakoFerryMax;
  return `空路${fmt1(air)}／海路${fmt1(sea)}／自衛隊${fmt1(jsdf)}（直近日）`;
}

// ===== 司令官パネル =====
interface PanelProps {
  state: GameState;
  isMobile: boolean;
  policy: EvacPolicy;
  onPolicyChange: (p: EvacPolicy) => void;
  onExecute: () => void;
  disabled: boolean;
  isComplete: boolean;
  lastRecord: CommanderRecord | null;
}

export function CommanderPanel({ state, isMobile, policy, onPolicyChange, onExecute, disabled, isComplete, lastRecord }: PanelProps) {
  // 予測は state（=日付）ごとに1回だけ計算。forecasts.source と state を比べて「計算中」を導出する（effect 内で setState しない）。
  const [forecasts, setForecasts] = useState<{ source: GameState; list: Forecast[]; elapsedMs: number } | null>(null);
  const [comparePolicyRaw, setComparePolicy] = useState<EvacPolicy>('sea-first');
  const comparePolicy = comparePolicyRaw === policy ? (EVAC_POLICIES.find(p => p !== policy) ?? 'balanced') : comparePolicyRaw;

  // 予測は日付が変わったとき（= state が更新されたとき）だけ再計算。setTimeout で描画を先に済ませる。
  useEffect(() => {
    if (isComplete) return;
    // 方針ごとに別のマクロタスクへ分割し、UIスレッドを長く占有しない（途中で state が変われば破棄）
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const list: Forecast[] = [];
    const t0 = performance.now();
    EVAC_POLICIES.forEach((p, i) => {
      timers.push(setTimeout(() => {
        if (cancelled) return;
        list.push(forecast(state, p, FORECAST_RUNS));
        if (list.length === EVAC_POLICIES.length) setForecasts({ source: state, list, elapsedMs: performance.now() - t0 });
      }, 30 + i * 16));
    });
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [state, isComplete]);

  const current = forecasts && forecasts.source === state ? forecasts : null;
  const forecastLoading = !isComplete && current === null;

  const byPolicy = useMemo(() => {
    const m = {} as Partial<Record<EvacPolicy, Forecast>>;
    for (const f of current?.list ?? []) m[f.policy] = f;
    return m;
  }, [current]);

  const todayLabel = isComplete ? '完了' : dayLabelOf(state.day);

  return (
    <div style={s.panel}>
      <div style={s.head}>
        <span style={s.headAccent} />
        <span style={s.headTitle}>🎖 司令官モード</span>
        <span style={s.headEn}>COMMANDER // {todayLabel}</span>
      </div>
      <p style={s.note}>
        AIは答えを決めません。5つの方針の「予測される結果」を並べるだけです。判断はあなたが下し、実行後にAIが結果を分析します。
      </p>

      {/* あなたの判断 */}
      {!isComplete && (
        <div style={s.section}>
          <div style={s.sectionTitle}>
            <span>① あなたの判断 — {todayLabel}の避難方針</span>
            <span style={s.sectionMeta}>
              {forecastLoading ? `予測を計算中…（${FORECAST_RUNS}試行×5方針）` : current ? `${FORECAST_RUNS}試行×5方針・同一ダイス列・${Math.round(current.elapsedMs)}ms` : ''}
            </span>
          </div>
          <div style={{ ...s.policyGrid, gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(190px, 1fr))' }}>
            {EVAC_POLICIES.map(p => {
              const f = byPolicy[p];
              const selected = p === policy;
              const color = POLICY_COLORS[p];
              return (
                <button
                  key={p}
                  className="tac-seg"
                  onClick={() => onPolicyChange(p)}
                  disabled={disabled}
                  style={{
                    ...s.policyCard,
                    borderColor: selected ? color : C.border,
                    background: selected ? `${color}14` : 'rgba(0,0,0,0.25)',
                    boxShadow: selected ? `0 0 0 1px ${color}66, 0 6px 18px rgba(0,0,0,0.35)` : 'none',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  <div style={s.policyTop}>
                    <span style={{ ...s.policyDot, background: color, boxShadow: `0 0 8px ${color}` }} />
                    <span style={{ ...s.policyLabel, color: selected ? C.white : C.bright }}>{POLICY_LABELS[p].label}</span>
                    {selected && <span style={{ ...s.selectedTag, color, borderColor: color }}>選択中</span>}
                  </div>
                  <div style={s.policyDesc}>{POLICY_LABELS[p].description}</div>
                  {f ? (
                    <div style={s.policyStats}>
                      <Stat k={`${todayLabel}末 避難率`} v={pct(f.days[0]?.evacRateMean)} />
                      <Stat k="X+8日 最終避難率" v={`${pct(f.finalEvacRate.mean)}`} sub={`p10 ${pct(f.finalEvacRate.p10)} 〜 p90 ${pct(f.finalEvacRate.p90)}`} />
                      <Stat k="要援護者到着率" v={pct(f.vulnerableArrivalRateMean)} />
                      <Stat k={`海路停止確率（${todayLabel}）`} v={pct(f.days[0]?.seaClosedRate)} warn={(f.days[0]?.seaClosedRate ?? 0) > 0.3} />
                    </div>
                  ) : (
                    <div style={s.policyLoading}>{forecastLoading ? '予測を計算中…' : '—'}</div>
                  )}
                </button>
              );
            })}
          </div>
          <button
            className="tac-cta"
            style={{ ...s.execBtn, opacity: disabled ? 0.6 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
            onClick={onExecute}
            disabled={disabled}
          >
            {disabled ? '⏳ 実行中…' : `🎖 「${POLICY_LABELS[policy].label}」で ${todayLabel} を実行`}
          </button>
        </div>
      )}

      {/* AI分析 */}
      {lastRecord && (
        <AnalysisCard record={lastRecord} forecasts={current?.list ?? null} isMobile={isMobile} />
      )}

      {/* 未来予測タイムライン */}
      {!isComplete && (
        <div style={s.section}>
          <div style={s.sectionTitle}>
            <span>③ 未来予測タイムライン — 避難率（平均と p10〜p90 帯）</span>
          </div>
          <div style={s.compareRow}>
            <span style={s.compareLabel}>
              <span style={{ ...s.legendSwatch, background: POLICY_COLORS[policy] }} />
              現在の計画: {POLICY_LABELS[policy].label}
            </span>
            <span style={s.compareLabel}>
              <span style={{ ...s.legendSwatch, background: POLICY_COLORS[comparePolicy], opacity: 0.9 }} />
              比較:
              <select
                value={comparePolicy}
                onChange={e => setComparePolicy(e.target.value as EvacPolicy)}
                style={s.select}
              >
                {EVAC_POLICIES.filter(p => p !== policy).map(p => (
                  <option key={p} value={p}>{POLICY_LABELS[p].label}</option>
                ))}
              </select>
            </span>
            <span style={{ ...s.compareLabel, color: C.dim }}>
              <span style={{ ...s.legendSwatch, background: C.dim }} />実績
            </span>
          </div>
          {current && byPolicy[policy] ? (
            <ForecastChart
              state={state}
              primary={byPolicy[policy]!}
              secondary={byPolicy[comparePolicy] ?? null}
              primaryColor={POLICY_COLORS[policy]}
              secondaryColor={POLICY_COLORS[comparePolicy]}
              isMobile={isMobile}
            />
          ) : (
            <div style={s.policyLoading}>{forecastLoading ? '予測を計算中…' : '—'}</div>
          )}
          <div style={s.chartNote}>⛈️ 海路停止の確率が30%超の日 ／ 💨 ハブ空港（新石垣/宮古/下地島）閉鎖の確率が30%超の日。帯は同一ダイス列で回した{FORECAST_RUNS}試行の p10〜p90。</div>
        </div>
      )}
    </div>
  );
}

function Stat({ k, v, sub, warn }: { k: string; v: string; sub?: string; warn?: boolean }) {
  return (
    <div style={s.stat}>
      <span style={s.statKey}>{k}</span>
      <span style={{ ...s.statVal, color: warn ? C.amber : C.bright }}>{v}</span>
      {sub && <span style={s.statSub}>{sub}</span>}
    </div>
  );
}

// ===== AI分析カード =====
function AnalysisCard({ record, forecasts, isMobile }: { record: CommanderRecord; forecasts: Forecast[] | null; isMobile: boolean }) {
  const a = record.analysis;
  // 見立ては分析の日ごとに1回取得。advice.day !== a.day の間は「計算中」と表示する（effect 内で setState しない）
  const [advice, setAdvice] = useState<{ day: number; value: Advice } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fc = forecasts?.map(f => ({
      policy: f.policy, finalEvacRate: f.finalEvacRate, expectedRemaining: f.expectedRemaining,
      vulnerableArrivalRateMean: f.vulnerableArrivalRateMean, expectedDead: f.expectedDead,
    }));
    getAdvice({ analysis: a, policy: record.policy, forecasts: fc })
      .then(v => { if (!cancelled) setAdvice({ day: a.day, value: v }); });
    return () => { cancelled = true; };
    // forecasts は次の日の予測（分析時点では未確定）のため依存に含めず、分析の日が変わったときだけ取得する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.day]);

  const vArr = breakdownTotal(a.vulnerableArrivedToday);
  const vDied = breakdownTotal(a.vulnerableDiedToday);
  const catText = (b: Record<VulnerableCategory, number>) =>
    VULNERABLE_CATEGORIES.filter(c => b[c] > 0).map(c => `${VULNERABLE_CATEGORY_JP[c]}${fmt1(b[c])}`).join('・') || '—';
  const cap = record.capacities;
  const util = a.capacityOffered > 0
    ? Math.min(1, (a.evacuatedToday + Object.values(a.byArea).reduce((s2, x) => s2 + x.movedToHub, 0)) / a.capacityOffered)
    : null;

  return (
    <div style={s.section}>
      <div style={s.sectionTitle}>
        <span>② AI分析 — {a.dayLabel}（方針: {POLICY_LABELS[record.policy].label}）</span>
        <span style={s.sectionMeta}>ルールベース（エンジン再計算）</span>
      </div>
      <div style={{ ...s.analysisGrid, gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)' }}>
        <Stat k="本日の避難" v={`${fmt1(a.evacuatedToday)}コマ`} sub={`要援護者 ${fmt1(vArr)}（${catText(a.vulnerableArrivedToday)}）`} />
        <Stat k="本日の死亡" v={`${fmt1(a.deadToday)}コマ`} sub={vDied > 0 ? `要援護者 ${fmt1(vDied)}（${catText(a.vulnerableDiedToday)}）` : undefined} warn={a.deadToday > 0} />
        <Stat k="残" v={`${fmt1(a.remaining)}コマ`} sub={`需要${fmt1(a.demandBefore)} → 提供${fmt1(a.capacityOffered)}`} />
        <Stat k="容量の使い切り" v={util == null ? '—' : pct(util)} sub={capacityBreakdown(cap).replace('（直近日）', '')} />
      </div>

      <div style={s.subTitle}>ボトルネック</div>
      <div style={s.badgeRow}>
        {a.bottlenecks.map(b => (
          <span key={b} style={{ ...s.badge, borderColor: b === 'none' ? C.green : C.red, color: b === 'none' ? C.green : '#ff8d8d' }}>
            {BOTTLENECK_LABELS[b]}
          </span>
        ))}
      </div>
      {a.bottleneckNotes.map((n, i) => (
        <div key={i} style={s.noteRow}><span style={s.bullet}>▶</span><span>{n}</span></div>
      ))}

      {a.options.length > 0 && (
        <>
          <div style={s.subTitle}>次に検討できること</div>
          {a.options.map((o, i) => (
            <div key={i} style={s.noteRow}><span style={{ ...s.bullet, color: C.blue }}>◇</span><span>{o}</span></div>
          ))}
        </>
      )}

      {a.alternatives.length > 0 && (
        <>
          <div style={s.subTitle}>もし別の方針だったら（同じダイスで当日を再計算）</div>
          <div style={{ ...s.altGrid, gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)' }}>
            {a.alternatives.map(alt => (
              <div key={alt.policy} style={{ ...s.altCard, borderColor: POLICY_COLORS[alt.policy] + '66' }}>
                <div style={{ ...s.altLabel, color: POLICY_COLORS[alt.policy] }}>{alt.label}</div>
                <div style={s.altLine}>避難 {fmt1(alt.evacuatedToday)}（<Delta n={alt.deltaEvacuated} goodWhenPositive />）</div>
                <div style={s.altLine}>残 {fmt1(alt.remaining)}（<Delta n={alt.deltaRemaining} goodWhenPositive={false} />）</div>
                {alt.deadToday !== a.deadToday && <div style={s.altLine}>死亡 {fmt1(alt.deadToday)}</div>}
              </div>
            ))}
          </div>
          <div style={s.chartNote}>差は「当日だけ」の比較です。翌日以降の天候・イベントは含みません。</div>
        </>
      )}

      {/* AIの見立て */}
      <div style={s.adviceBox}>
        {!advice || advice.day !== a.day ? (
          <span style={s.adviceText}>🤖 見立てを計算中…</span>
        ) : (
          <>
            <div style={s.adviceHead}>
              <span>🤖 AIの見立て</span>
              <span style={s.adviceMeta}>
                出典: {advice.value.source === 'jev' ? `Jev${advice.value.model ? `（${advice.value.model}）` : ''}` : 'ルール'}
                ・信頼度 {Math.round(advice.value.scoreConfidence * 100)}%
                ・翌日の重点候補「{FOCUS_LABELS[advice.value.focus]}」（{Math.round(advice.value.focusConfidence * 100)}%）
              </span>
            </div>
            <span style={s.adviceText}>{advice.value.rationale}</span>
          </>
        )}
      </div>
    </div>
  );
}

function Delta({ n, goodWhenPositive }: { n: number; goodWhenPositive: boolean }) {
  const good = n === 0 ? null : (n > 0) === goodWhenPositive;
  const color = good == null ? C.dim : good ? C.green : '#ff8d8d';
  return <span style={{ color, fontFamily: FONT.mono, fontWeight: 700 }}>{n > 0 ? `+${fmt1(n)}` : fmt1(n)}</span>;
}

// ===== 未来予測タイムライン（SVG）=====
function dayLabelOf(day: number): string {
  return day === 0 ? 'X日' : day > 0 ? `X+${day}日` : `X${day}日`;
}

function ForecastChart({ state, primary, secondary, primaryColor, secondaryColor, isMobile }: {
  state: GameState; primary: Forecast; secondary: Forecast | null; primaryColor: string; secondaryColor: string; isMobile: boolean;
}) {
  const W = 640, H = isMobile ? 220 : 240;
  const padL = 40, padR = 14, padT = 26, padB = 26;
  const firstDay = -3;
  const lastDay = LAST_DAY;
  const x = (day: number) => padL + ((day - firstDay) / (lastDay - firstDay)) * (W - padL - padR);
  const y = (rate: number) => padT + (1 - Math.max(0, Math.min(1, rate))) * (H - padT - padB);

  // 実績（過去日）
  const total = state.evacuated + state.dead + totalRemaining(state);
  const history = state.dayLogs.map(l => ({ day: l.day, rate: total > 0 ? l.totalEvacuatedSoFar / total : 0 }));
  const startRate = evacuationRate(state);
  const startDay = Math.max(firstDay, state.day - 1); // 直近の実績日（初日は X-3 の軸上から始める）

  const bandPath = (f: Forecast) => {
    const pts = [{ day: startDay, lo: startRate, hi: startRate }, ...f.days.map(d => ({ day: d.day, lo: d.evacRateP10, hi: d.evacRateP90 }))];
    const top = pts.map(p => `${x(p.day).toFixed(1)},${y(p.hi).toFixed(1)}`);
    const bottom = [...pts].reverse().map(p => `${x(p.day).toFixed(1)},${y(p.lo).toFixed(1)}`);
    return `M${top.join(' L')} L${bottom.join(' L')} Z`;
  };
  const meanPts = (f: Forecast) => [{ day: startDay, r: startRate }, ...f.days.map(d => ({ day: d.day, r: d.evacRateMean }))]
    .map(p => `${x(p.day).toFixed(1)},${y(p.r).toFixed(1)}`).join(' ');
  const histPts = history.map(h => `${x(h.day).toFixed(1)},${y(h.rate).toFixed(1)}`).join(' ');

  const risks = primary.days.map(d => ({ day: d.day, sea: d.seaClosedRate > 0.3, air: d.airportClosedRate > 0.3 })).filter(r => r.sea || r.air);
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', minWidth: isMobile ? 520 : undefined, fontFamily: FONT.mono }}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={C.border} strokeWidth={1} strokeDasharray={t === 0 || t === 1 ? undefined : '3 4'} />
            <text x={padL - 6} y={y(t) + 3.5} fontSize={9} fill={C.dim} textAnchor="end">{Math.round(t * 100)}%</text>
          </g>
        ))}
        {Array.from({ length: lastDay - firstDay + 1 }, (_, i) => firstDay + i).map(d => (
          <g key={d}>
            <line x1={x(d)} x2={x(d)} y1={padT} y2={H - padB} stroke={C.border} strokeWidth={d === state.day ? 1.5 : 0.5} strokeDasharray={d === state.day ? '2 3' : undefined} />
            <text x={x(d)} y={H - padB + 13} fontSize={9} fill={d === state.day ? C.bright : C.dim} textAnchor="middle" fontWeight={d === state.day ? 700 : 400}>
              {dayLabelOf(d).replace('日', '')}
            </text>
          </g>
        ))}
        {/* 今日 */}
        <text x={x(state.day)} y={padT - 12} fontSize={9} fill={C.bright} textAnchor="middle">▼ 本日</text>
        {/* 天候リスク */}
        {risks.map(r => (
          <text key={r.day} x={x(r.day)} y={padT - 2} fontSize={11} textAnchor="middle" style={{ fontFamily: FONT.jp }}>
            {r.sea ? '⛈️' : ''}{r.air ? '💨' : ''}
          </text>
        ))}
        {/* 帯 */}
        {secondary && <path d={bandPath(secondary)} fill={secondaryColor} opacity={0.12} />}
        <path d={bandPath(primary)} fill={primaryColor} opacity={0.16} />
        {/* 実績 */}
        {history.length > 1 && <polyline points={histPts} fill="none" stroke={C.dim} strokeWidth={2} />}
        {history.map(h => <circle key={h.day} cx={x(h.day)} cy={y(h.rate)} r={2.5} fill={C.dim} />)}
        {/* 平均線 */}
        {secondary && <polyline points={meanPts(secondary)} fill="none" stroke={secondaryColor} strokeWidth={2} strokeDasharray="5 4" opacity={0.9} />}
        <polyline points={meanPts(primary)} fill="none" stroke={primaryColor} strokeWidth={2.5} />
        {primary.days.map(d => <circle key={d.day} cx={x(d.day)} cy={y(d.evacRateMean)} r={2.5} fill={primaryColor} />)}
        {/* 最終値ラベル */}
        <text x={W - padR - 2} y={y(primary.finalEvacRate.mean) - 5} fontSize={10} fill={primaryColor} textAnchor="end" fontWeight={700}>
          {pct(primary.finalEvacRate.mean)}
        </text>
        {secondary && (
          <text x={W - padR - 2} y={y(secondary.finalEvacRate.mean) + 12} fontSize={10} fill={secondaryColor} textAnchor="end" fontWeight={700}>
            {pct(secondary.finalEvacRate.mean)}
          </text>
        )}
      </svg>
    </div>
  );
}

// ===== styles =====
const kpi: Record<string, React.CSSProperties> = {
  bar: {
    display: 'grid', gap: 8, maxWidth: 1400, margin: '0 auto',
    background: 'rgba(13,27,42,0.55)', borderBottom: `1px solid ${C.border}`,
  },
  item: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, minWidth: 0 },
  label: { fontSize: 9.5, color: C.dim, fontFamily: FONT.mono, letterSpacing: 1 },
  value: { fontSize: 17, fontWeight: 800, fontFamily: FONT.mono, lineHeight: 1.1 },
  sub: { fontSize: 9.5, color: C.dim, fontFamily: FONT.mono, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' },
};

const s: Record<string, React.CSSProperties> = {
  panel: {
    position: 'relative', background: `linear-gradient(180deg, ${C.bgPanel}, ${C.bgDeep})`, borderRadius: 4,
    padding: 16, display: 'flex', flexDirection: 'column', gap: 14,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)', border: `1px solid ${C.borderHi}`,
  },
  head: { display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 10, borderBottom: `1px solid ${C.border}` },
  headAccent: { width: 4, height: 18, borderRadius: 2, background: C.amber, boxShadow: `0 0 10px ${C.amber}` },
  headTitle: { fontSize: 16, fontWeight: 800, color: C.white, fontFamily: FONT.jp },
  headEn: { marginLeft: 'auto', fontFamily: FONT.mono, fontSize: 10, color: C.dim, letterSpacing: 1.5 },
  note: { margin: 0, fontSize: 12, color: C.body, lineHeight: 1.6 },
  section: { display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(0,0,0,0.22)', border: `1px solid ${C.border}`, borderRadius: 4, padding: 12 },
  sectionTitle: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontSize: 13, fontWeight: 800, color: C.bright, fontFamily: FONT.jp },
  sectionMeta: { fontSize: 10, color: C.dim, fontFamily: FONT.mono, fontWeight: 400 },
  policyGrid: { display: 'grid', gap: 8 },
  policyCard: {
    textAlign: 'left', borderWidth: 1, borderStyle: 'solid', borderRadius: 4, padding: '10px 12px',
    display: 'flex', flexDirection: 'column', gap: 6, color: C.body, fontFamily: FONT.jp, minWidth: 0,
  },
  policyTop: { display: 'flex', alignItems: 'center', gap: 6 },
  policyDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  policyLabel: { fontSize: 14, fontWeight: 800 },
  selectedTag: { marginLeft: 'auto', fontSize: 9, fontFamily: FONT.mono, border: '1px solid', borderRadius: 3, padding: '1px 5px', letterSpacing: 1 },
  policyDesc: { fontSize: 10.5, color: C.dim, lineHeight: 1.5 },
  policyStats: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 2 },
  policyLoading: { fontSize: 11, color: C.dim, fontFamily: FONT.mono, padding: '6px 0' },
  stat: { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 },
  statKey: { fontSize: 9.5, color: C.dim, fontFamily: FONT.mono },
  statVal: { fontSize: 14, fontWeight: 800, fontFamily: FONT.mono, color: C.bright },
  statSub: { fontSize: 9.5, color: C.dim, fontFamily: FONT.mono, whiteSpace: 'normal', lineHeight: 1.3 },
  execBtn: {
    marginTop: 4, padding: '14px 18px', background: `linear-gradient(135deg, ${C.amber}, #ff9e3d)`,
    color: '#1a1200', border: 'none', borderRadius: 4, fontSize: 15, fontWeight: 900,
    boxShadow: '0 6px 20px rgba(255,179,0,0.25)', fontFamily: FONT.jp, letterSpacing: 0.5,
  },
  analysisGrid: { display: 'grid', gap: 10, padding: '4px 0 6px' },
  subTitle: { fontSize: 11, fontWeight: 700, color: C.dim, fontFamily: FONT.mono, letterSpacing: 0.5, marginTop: 4 },
  badgeRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  badge: { fontSize: 11, fontWeight: 700, border: '1px solid', borderRadius: 3, padding: '2px 8px', fontFamily: FONT.jp, background: 'rgba(0,0,0,0.25)' },
  noteRow: { display: 'flex', gap: 8, fontSize: 12, color: C.body, lineHeight: 1.55, alignItems: 'flex-start' },
  bullet: { color: C.red, flexShrink: 0, fontSize: 10, marginTop: 3 },
  altGrid: { display: 'grid', gap: 6 },
  altCard: { border: '1px solid', borderRadius: 4, padding: '6px 8px', background: 'rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', gap: 2 },
  altLabel: { fontSize: 11.5, fontWeight: 800, fontFamily: FONT.jp },
  altLine: { fontSize: 11, color: C.body, fontFamily: FONT.mono },
  adviceBox: { marginTop: 6, background: 'rgba(167,139,250,0.07)', border: `1px solid ${C.border}`, borderRadius: 4, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 },
  adviceHead: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline', fontSize: 11.5, fontWeight: 800, color: C.violet },
  adviceMeta: { fontSize: 9.5, color: C.dim, fontFamily: FONT.mono, fontWeight: 400 },
  adviceText: { fontSize: 11.5, color: C.body, lineHeight: 1.55 },
  compareRow: { display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', fontSize: 11, color: C.body, fontFamily: FONT.mono },
  compareLabel: { display: 'flex', alignItems: 'center', gap: 6 },
  legendSwatch: { display: 'inline-block', width: 14, height: 4, borderRadius: 2 },
  select: { background: C.bgCard, color: C.white, border: `1px solid ${C.borderHi}`, borderRadius: 3, padding: '2px 6px', fontSize: 11, fontFamily: FONT.jp },
  chartNote: { fontSize: 10.5, color: C.dim, lineHeight: 1.5 },
};
