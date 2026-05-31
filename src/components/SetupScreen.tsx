import React, { useState } from 'react';
import type { SetupConfig } from '../types';
import { TOURIST_BY_MONTH } from '../constants';
import { useWindowWidth } from '../hooks/useWindowWidth';
import { C, FONT } from '../theme';

// divベースのボタン — ブラウザのデフォルトボタンスタイルを完全排除
function NoFocusButton({ style, onClick, children, className }: {
  style?: React.CSSProperties;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="button"
      tabIndex={-1}
      className={className}
      style={{ ...style, userSelect: 'none', WebkitUserSelect: 'none' }}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); }}
    >
      {children}
    </div>
  );
}

// 戦術カードのコーナーブラケット装飾
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

interface Props {
  onStart: (config: SetupConfig) => void;
}

const PREP_DESCRIPTIONS: Record<number, string> = {
  1: '事前準備ほぼなし（現状の沖縄に近い）',
  2: '最低限の準備',
  3: '一般的な有事対応',
  4: '比較的整備された状態',
  5: '高度な事前準備',
  6: 'ほぼ完璧な事前準備（24h空港運用）',
};

const SHELTER_DESCRIPTIONS: Record<number, string> = {
  1: 'シェルターほぼなし・無防備',
  2: '一部シェルター整備',
  3: '標準的な避難所',
  4: '良好なシェルター体制',
  5: '高度なシェルター整備',
};

export function SetupScreen({ onStart }: Props) {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 768;
  const [prepLevel, setPrepLevel] = useState(3);
  const [shelterLevel, setShelterLevel] = useState(3);
  const [month, setMonth] = useState(8);
  const [vulnerableYonaguni, setVulnerableYonaguni] = useState(0);
  const [vulnerableTaketomi, setVulnerableTaketomi] = useState(1);
  const [vulnerableIshigaki, setVulnerableIshigaki] = useState(4);
  const [vulnerableMiyako, setVulnerableMiyako] = useState(5);

  const tourists = TOURIST_BY_MONTH[month];
  const dangerSeason = month >= 6 && month <= 10;

  const handleStart = () => {
    onStart({ prepLevel, shelterLevel, month, vulnerableYonaguni, vulnerableTaketomi, vulnerableIshigaki, vulnerableMiyako });
  };

  const totalKoma = 2 + 15 + 43 + 49 + tourists + vulnerableYonaguni + vulnerableTaketomi + vulnerableIshigaki + vulnerableMiyako;

  return (
    <div style={{ ...styles.container, padding: isMobile ? '0 0 40px' : '0 0 56px' }}>
      {/* 機密バナー */}
      <div style={styles.classBar}>
        <span style={styles.classDot} />
        <span style={styles.classText}>RESTRICTED // 先島諸島 広域避難 作戦シミュレーター</span>
        <span style={{ ...styles.classText, marginLeft: 'auto', color: C.dim }}>SYS.READY</span>
      </div>

      <div style={{ ...styles.inner, padding: isMobile ? '24px 14px 0' : '40px 24px 0' }}>
        {/* ヘッダー */}
        <header className="tac-fade" style={styles.header}>
          <div style={{ ...styles.logoRow, gap: isMobile ? 12 : 18 }}>
            <span style={{ ...styles.triangle, fontSize: isMobile ? 38 : 54 }}>▲</span>
            <div style={styles.logoStack}>
              <div style={styles.logoLine}>
                <span style={{ ...styles.logoOkires, fontSize: isMobile ? 38 : 60 }}>OKIRES</span>
                <span style={styles.logoYear}>2026</span>
              </div>
              <div style={styles.logoSub}>沖縄・先島諸島 住民避難シミュレーター</div>
            </div>
          </div>
          <p style={styles.description}>
            台湾有事を想定した先島諸島 <strong style={styles.descHi}>約12万人</strong> の広域避難オペレーション。
            <span style={styles.descMono}> X-3 </span>日から <span style={styles.descMono}>X+8</span> 日まで、計12日間をAIが最適行動で実行します。
          </p>
        </header>

        {/* パラメータカード */}
        <div className="tac-card tac-fade" style={{ ...styles.card, padding: isMobile ? 18 : 30, animationDelay: '0.08s' }}>
          <Corners />
          <div style={styles.sectionHead}>
            <span style={styles.sectionIndex}>SECTOR 00</span>
            <h2 style={styles.sectionTitle}>MISSION PARAMETERS</h2>
            <span style={styles.sectionJp}>初期設定</span>
          </div>

          {/* 事前準備Lv */}
          <Param index="01" title="事前準備レベル" en="PREPAREDNESS" value={`Lv.${prepLevel}`} valueColor={C.green}>
            <p style={styles.desc}>{PREP_DESCRIPTIONS[prepLevel]}</p>
            <input type="range" min={1} max={6} value={prepLevel}
              onChange={e => setPrepLevel(Number(e.target.value))} style={styles.slider} />
            <div style={styles.segGrid}>
              {[1, 2, 3, 4, 5, 6].map(lv => {
                const active = prepLevel === lv;
                return (
                  <NoFocusButton key={lv} className="tac-seg"
                    style={{ ...styles.seg, ...(active ? styles.segGreen : {}) }}
                    onClick={() => setPrepLevel(lv)}>Lv.{lv}</NoFocusButton>
                );
              })}
            </div>
          </Param>

          {/* 抗堪性Lv */}
          <Param index="02" title="抗堪性レベル" en="HARDENING" value={`Lv.${shelterLevel}`} valueColor={C.blue} hint="シェルター普及度">
            <p style={styles.desc}>{SHELTER_DESCRIPTIONS[shelterLevel]}</p>
            <input type="range" min={1} max={5} value={shelterLevel}
              onChange={e => setShelterLevel(Number(e.target.value))} style={styles.slider} />
            <div style={styles.segGrid}>
              {[1, 2, 3, 4, 5].map(lv => {
                const active = shelterLevel === lv;
                return (
                  <NoFocusButton key={lv} className="tac-seg"
                    style={{ ...styles.seg, ...(active ? styles.segBlue : {}) }}
                    onClick={() => setShelterLevel(lv)}>Lv.{lv}</NoFocusButton>
                );
              })}
            </div>
          </Param>

          {/* 月 */}
          <Param index="03" title="事態発生月" en="ONSET MONTH" value={`${month}月`} valueColor={dangerSeason ? C.amber : C.bright}>
            <p style={styles.desc}>
              観光客 最大 <span style={styles.mono}>{tourists}</span> コマ ／{' '}
              {dangerSeason
                ? <span style={{ color: C.amber, fontWeight: 700 }}>⚠ 台風・大雨の発生確率が高い季節</span>
                : <span>比較的安定した気象</span>}
            </p>
            <div style={{ ...styles.monthGrid, gridTemplateColumns: isMobile ? 'repeat(4, 1fr)' : 'repeat(6, 1fr)' }}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
                const danger = [6, 7, 8, 9, 10].includes(m);
                const active = month === m;
                return (
                  <NoFocusButton key={m} className="tac-seg"
                    style={{
                      ...styles.seg,
                      ...(danger && !active ? styles.segDangerIdle : {}),
                      ...(active ? (danger ? styles.segAmber : styles.segBlue) : {}),
                    }}
                    onClick={() => setMonth(m)}>{m}月</NoFocusButton>
                );
              })}
            </div>
          </Param>

          {/* 要援護者配置 */}
          <Param index="04" title="要援護者の配置" en="VULNERABLE UNITS" value={`${vulnerableYonaguni + vulnerableTaketomi + vulnerableIshigaki + vulnerableMiyako}`} valueColor="#ff6b6b">
            <p style={styles.desc}>高齢者・障がい者・妊産婦など。<strong style={{ color: '#ff6b6b' }}>船のみ利用可</strong>（航空機不可）。</p>
            <div style={{ ...styles.fourCol, gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)' }}>
              <VulnSlider name="与那国島" dot="#ff5a5a" value={vulnerableYonaguni} max={2} onChange={setVulnerableYonaguni} />
              <VulnSlider name="竹富町" dot="#ff9e3d" value={vulnerableTaketomi} max={5} onChange={setVulnerableTaketomi} />
              <VulnSlider name="石垣島" dot="#38bdf8" value={vulnerableIshigaki} max={8} onChange={setVulnerableIshigaki} />
              <VulnSlider name="宮古島" dot="#00ff88" value={vulnerableMiyako} max={8} onChange={setVulnerableMiyako} />
            </div>
          </Param>

          {/* 初期配置概要 */}
          <div style={styles.readout}>
            <div style={styles.readoutHead}>
              <span style={styles.readoutTitle}>INITIAL DEPLOYMENT // 初期配置概要</span>
            </div>
            <div style={{ ...styles.readoutGrid, gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr' }}>
              <ReadoutRow dot="#ff5a5a" label="与那国島" detail={`住民2 + 要援護${vulnerableYonaguni}`} />
              <ReadoutRow dot="#ff9e3d" label="竹富町全島" detail={`住民15 + 観光${Math.round(tourists * 0.15)} + 要援護${vulnerableTaketomi}`} />
              <ReadoutRow dot="#38bdf8" label="石垣島" detail={`住民43 + 観光${Math.round(tourists * 0.5)} + 要援護${vulnerableIshigaki}`} />
              <ReadoutRow dot="#00ff88" label="宮古島・多良間" detail={`住民49 + 観光${Math.round(tourists * 0.35)} + 要援護${vulnerableMiyako}`} />
            </div>
            <div style={styles.totalLine}>
              <span style={styles.totalLabel}>TOTAL FORCE</span>
              <span style={styles.totalValue}>
                ≈ <span style={{ color: C.green }}>{totalKoma}</span> コマ
                <span style={styles.totalPeople}> ≒ {(totalKoma * 1000).toLocaleString()} 人</span>
              </span>
            </div>
          </div>

          <NoFocusButton className="tac-cta" style={styles.startBtn} onClick={handleStart}>
            <span style={styles.startMain}>▶ 作戦開始</span>
            <span style={styles.startSub}>INITIATE SIMULATION</span>
          </NoFocusButton>
        </div>

        <footer style={styles.footer}>
          OKIRES2026 ver2.0 デジタルシミュレーター ／ ルール原典: OKIRES製作委員会
        </footer>
      </div>
    </div>
  );
}

function Param({ index, title, en, value, valueColor, hint, children }: {
  index: string; title: string; en: string; value: string; valueColor: string;
  hint?: string; children: React.ReactNode;
}) {
  return (
    <div style={styles.param}>
      <div style={styles.paramHead}>
        <span style={styles.paramIndex}>{index}</span>
        <div style={styles.paramTitleWrap}>
          <span style={styles.paramTitle}>{title}</span>
          <span style={styles.paramEn}>{en}{hint ? ` · ${hint}` : ''}</span>
        </div>
        <span style={{ ...styles.paramValue, color: valueColor, textShadow: `0 0 12px ${valueColor}55` }}>{value}</span>
      </div>
      {children}
    </div>
  );
}

function VulnSlider({ name, dot, value, max, onChange }: {
  name: string; dot: string; value: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <div style={styles.vuln}>
      <div style={styles.vulnLabel}>
        <span style={{ ...styles.vulnDot, background: dot, boxShadow: `0 0 6px ${dot}` }} />
        <span>{name}</span>
        <span style={{ ...styles.vulnValue, color: dot }}>{value}</span>
      </div>
      <input type="range" min={0} max={max} value={value}
        onChange={e => onChange(Number(e.target.value))} style={styles.slider} />
    </div>
  );
}

function ReadoutRow({ dot, label, detail }: { dot: string; label: string; detail: string }) {
  return (
    <div style={styles.readoutRow}>
      <span style={{ ...styles.readoutDot, background: dot, boxShadow: `0 0 6px ${dot}` }} />
      <span style={styles.readoutLabel}>{label}</span>
      <span style={styles.readoutDetail}>{detail}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { minHeight: '100vh', fontFamily: FONT.jp },
  inner: { maxWidth: 860, margin: '0 auto' },
  classBar: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 16px', background: 'rgba(255,179,0,0.07)',
    borderBottom: `1px solid ${C.border}`, fontFamily: FONT.mono,
  },
  classDot: { width: 7, height: 7, borderRadius: '50%', background: C.amber, boxShadow: `0 0 8px ${C.amber}`, animation: 'okires-blink 1.6s infinite' },
  classText: { fontSize: 10.5, letterSpacing: 1, color: C.amber, fontWeight: 700 },

  header: { textAlign: 'center', marginBottom: 28 },
  logoRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  triangle: { color: C.green, filter: `drop-shadow(0 0 14px ${C.green})`, lineHeight: 1 },
  logoStack: { textAlign: 'left' },
  logoLine: { display: 'flex', alignItems: 'baseline', gap: 12 },
  logoOkires: { fontFamily: FONT.display, fontWeight: 700, color: C.white, letterSpacing: 1, lineHeight: 1, textShadow: '0 0 30px rgba(0,255,136,0.25)' },
  logoYear: { fontFamily: FONT.mono, fontSize: 16, fontWeight: 700, color: C.bgDeep, background: C.green, padding: '2px 8px', borderRadius: 3, letterSpacing: 1 },
  logoSub: { fontSize: 13, color: C.dim, letterSpacing: 2, marginTop: 6, fontFamily: FONT.mono },
  description: { color: C.body, lineHeight: 1.9, fontSize: 14, maxWidth: 620, margin: '0 auto' },
  descHi: { color: C.white, fontWeight: 700 },
  descMono: { fontFamily: FONT.mono, color: C.green, fontWeight: 700 },

  card: {
    background: `linear-gradient(180deg, ${C.bgPanel}, ${C.bgDeep})`,
    border: `1px solid ${C.border}`, borderRadius: 4,
    boxShadow: '0 24px 60px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.03)',
  },
  sectionHead: { display: 'flex', alignItems: 'baseline', gap: 12, paddingBottom: 14, marginBottom: 22, borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' },
  sectionIndex: { fontFamily: FONT.mono, fontSize: 11, color: C.dim, letterSpacing: 1 },
  sectionTitle: { fontFamily: FONT.display, fontSize: 20, fontWeight: 700, color: C.white, letterSpacing: 2, margin: 0 },
  sectionJp: { fontSize: 13, color: C.dim, marginLeft: 'auto' },

  param: { marginBottom: 26 },
  paramHead: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 },
  paramIndex: { fontFamily: FONT.mono, fontSize: 12, fontWeight: 700, color: C.dim, border: `1px solid ${C.border}`, borderRadius: 3, padding: '2px 6px', flexShrink: 0 },
  paramTitleWrap: { display: 'flex', flexDirection: 'column', lineHeight: 1.25 },
  paramTitle: { fontSize: 15, fontWeight: 700, color: C.bright },
  paramEn: { fontFamily: FONT.mono, fontSize: 10, color: C.dim, letterSpacing: 1.2 },
  paramValue: { marginLeft: 'auto', fontFamily: FONT.mono, fontSize: 22, fontWeight: 800, lineHeight: 1 },
  desc: { color: C.body, fontSize: 12.5, margin: '0 0 12px', lineHeight: 1.6 },
  mono: { fontFamily: FONT.mono, color: C.bright, fontWeight: 700 },

  slider: { width: '100%', margin: '4px 0 12px' },
  segGrid: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  seg: {
    flex: 1, minWidth: 46, textAlign: 'center', padding: '9px 4px',
    border: `1px solid ${C.border}`, borderRadius: 3, background: C.bgCard,
    cursor: 'pointer', fontWeight: 700, fontSize: 13, color: C.dim,
    fontFamily: FONT.mono, letterSpacing: 0.5,
  },
  segGreen: { background: C.green, color: '#00150d', borderColor: C.green, boxShadow: `0 0 16px ${C.green}66` },
  segBlue: { background: C.blue, color: '#001a26', borderColor: C.blue, boxShadow: `0 0 16px ${C.blue}66` },
  segAmber: { background: C.amber, color: '#1a1000', borderColor: C.amber, boxShadow: `0 0 16px ${C.amber}66` },
  segDangerIdle: { borderColor: 'rgba(255,179,0,0.4)', color: C.amber },
  monthGrid: { display: 'grid', gap: 6 },

  fourCol: { display: 'grid', gap: 14 },
  vuln: {},
  vulnLabel: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: C.body, marginBottom: 4 },
  vulnDot: { width: 8, height: 8, borderRadius: 2, flexShrink: 0 },
  vulnValue: { marginLeft: 'auto', fontFamily: FONT.mono, fontWeight: 800, fontSize: 15 },

  readout: {
    marginTop: 22, background: 'rgba(0,0,0,0.25)', border: `1px solid ${C.border}`,
    borderRadius: 4, padding: 16,
  },
  readoutHead: { marginBottom: 12 },
  readoutTitle: { fontFamily: FONT.mono, fontSize: 11, color: C.green, letterSpacing: 1, fontWeight: 700 },
  readoutGrid: { display: 'grid', gap: 9 },
  readoutRow: { display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5 },
  readoutDot: { width: 9, height: 9, borderRadius: 2, flexShrink: 0 },
  readoutLabel: { color: C.bright, fontWeight: 700, minWidth: 118 },
  readoutDetail: { color: C.dim, fontFamily: FONT.mono, fontSize: 11.5 },
  totalLine: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTop: `1px dashed ${C.border}`, flexWrap: 'wrap', gap: 6 },
  totalLabel: { fontFamily: FONT.mono, fontSize: 11, color: C.dim, letterSpacing: 1.5 },
  totalValue: { fontFamily: FONT.mono, fontSize: 18, fontWeight: 800, color: C.white },
  totalPeople: { fontSize: 12, color: C.body, fontWeight: 500 },

  startBtn: {
    width: '100%', marginTop: 24, padding: '16px',
    background: `linear-gradient(135deg, ${C.green}, #00c46a)`,
    color: '#00150d', border: 'none', borderRadius: 4, cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    boxShadow: '0 8px 28px rgba(0,255,136,0.28)',
  },
  startMain: { fontSize: 19, fontWeight: 900, letterSpacing: 1, fontFamily: FONT.jp },
  startSub: { fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, letterSpacing: 3, opacity: 0.7 },

  footer: { textAlign: 'center', color: C.dim, fontSize: 11, marginTop: 26, fontFamily: FONT.mono, letterSpacing: 0.5 },
};
