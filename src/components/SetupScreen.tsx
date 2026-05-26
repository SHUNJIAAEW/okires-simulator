import React, { useState } from 'react';
import type { SetupConfig } from '../types';
import { TOURIST_BY_MONTH } from '../constants';
import { useWindowWidth } from '../hooks/useWindowWidth';

interface Props {
  onStart: (config: SetupConfig) => void;
}


const PREP_DESCRIPTIONS: Record<number, string> = {
  1: 'Lv.1 - 事前準備ほぼなし（現状の沖縄に近い）',
  2: 'Lv.2 - 最低限の準備',
  3: 'Lv.3 - 一般的な有事対応',
  4: 'Lv.4 - 比較的整備された状態',
  5: 'Lv.5 - 高度な事前準備',
  6: 'Lv.6 - ほぼ完璧な事前準備 (24h空港運用)',
};

const SHELTER_DESCRIPTIONS: Record<number, string> = {
  1: 'Lv.1 - シェルターほぼなし・無防備',
  2: 'Lv.2 - 一部シェルター整備',
  3: 'Lv.3 - 標準的な避難所',
  4: 'Lv.4 - 良好なシェルター体制',
  5: 'Lv.5 - 高度なシェルター整備',
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

  const handleStart = () => {
    onStart({ prepLevel, shelterLevel, month, vulnerableYonaguni, vulnerableTaketomi, vulnerableIshigaki, vulnerableMiyako });
  };

  return (
    <div style={{ ...styles.container, padding: isMobile ? '12px' : '20px' }}>
      <div style={styles.header}>
        <div style={{ ...styles.logo, gap: isMobile ? 8 : 16 }}>
          <span style={{ ...styles.logoTriangle, fontSize: isMobile ? 40 : 64 }}>▲</span>
          <div>
            <div style={{ ...styles.logoOkires, fontSize: isMobile ? 32 : 48 }}>OKIRES</div>
            <div style={{ ...styles.logoSub, fontSize: isMobile ? 13 : 16 }}>沖縄住民避難シミュレーター 2026</div>
          </div>
        </div>
        <p style={styles.description}>
          台湾有事を想定した沖縄先島諸島 約12万人の広域避難シミュレーションです。
          X-3日から始まり、X+8日までの計12日間をシミュレートします。
        </p>
      </div>

      <div style={{ ...styles.card, padding: isMobile ? 16 : 32 }}>
        <h2 style={styles.sectionTitle}>初期設定</h2>

        {/* 事前準備Lv */}
        <div style={styles.formGroup}>
          <label style={styles.label}>
            事前準備 Lv. <span style={styles.value}>{prepLevel}</span>
          </label>
          <p style={styles.desc}>{PREP_DESCRIPTIONS[prepLevel]}</p>
          <div style={styles.sliderRow}>
            <span style={styles.sliderLabel}>1 (無準備)</span>
            <input
              type="range" min={1} max={6} value={prepLevel}
              onChange={e => setPrepLevel(Number(e.target.value))}
              style={styles.slider}
            />
            <span style={styles.sliderLabel}>6 (完璧)</span>
          </div>
          <div style={{ ...styles.levelGrid, flexWrap: 'wrap' }}>
            {[1,2,3,4,5,6].map(lv => (
              <button
                key={lv}
                style={{ ...styles.levelBtn, ...(prepLevel === lv ? styles.levelBtnActive : {}) }}
                onClick={() => setPrepLevel(lv)}
              >Lv.{lv}</button>
            ))}
          </div>

        </div>

        {/* 抗堪性Lv */}
        <div style={styles.formGroup}>
          <label style={styles.label}>
            抗堪性 Lv. <span style={styles.value}>{shelterLevel}</span>
            <span style={styles.hint}>(シェルター普及度)</span>
          </label>
          <p style={styles.desc}>{SHELTER_DESCRIPTIONS[shelterLevel]}</p>
          <div style={styles.sliderRow}>
            <span style={styles.sliderLabel}>1 (無防備)</span>
            <input
              type="range" min={1} max={5} value={shelterLevel}
              onChange={e => setShelterLevel(Number(e.target.value))}
              style={styles.slider}
            />
            <span style={styles.sliderLabel}>5 (充実)</span>
          </div>
          <div style={{ ...styles.levelGrid, flexWrap: 'wrap' }}>
            {[1,2,3,4,5].map(lv => (
              <button
                key={lv}
                style={{ ...styles.levelBtn, ...(shelterLevel === lv ? styles.levelBtnGreen : {}) }}
                onClick={() => setShelterLevel(lv)}
              >Lv.{lv}</button>
            ))}
          </div>
        </div>

        {/* 月 */}
        <div style={styles.formGroup}>
          <label style={styles.label}>
            事態発生月 <span style={styles.value}>{month}月</span>
          </label>
          <p style={styles.desc}>
            観光客数: 最大{tourists}コマ | {month >= 6 && month <= 10 ? '⚠️ 台風・大雨の発生確率が高い季節' : '比較的安定した気象'}
          </p>
          <div style={{ ...styles.monthGrid, gridTemplateColumns: isMobile ? 'repeat(4, 1fr)' : 'repeat(6, 1fr)' }}>
            {Array.from({length: 12}, (_, i) => i + 1).map(m => (
              <button
                key={m}
                style={{
                  ...styles.monthBtn,
                  ...([6,7,8,9,10].includes(m) ? styles.monthBtnDanger : {}),
                  ...(month === m ? styles.monthBtnActive : {}),
                }}
                onClick={() => setMonth(m)}
              >{m}月</button>
            ))}
          </div>
        </div>

        {/* 要援護者配置 */}
        <div style={styles.formGroup}>
          <label style={styles.label}>青コマ（要援護者）配置</label>
          <p style={styles.desc}>高齢者・障がい者・妊産婦など。船のみ利用可能（航空機不可）。</p>
          <div style={{ ...styles.fourCol, gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)' }}>
            <div>
              <label style={styles.subLabel}>与那国島: {vulnerableYonaguni}コマ</label>
              <input type="range" min={0} max={2} value={vulnerableYonaguni}
                onChange={e => setVulnerableYonaguni(Number(e.target.value))}
                style={styles.slider} />
            </div>
            <div>
              <label style={styles.subLabel}>竹富町: {vulnerableTaketomi}コマ</label>
              <input type="range" min={0} max={5} value={vulnerableTaketomi}
                onChange={e => setVulnerableTaketomi(Number(e.target.value))}
                style={styles.slider} />
            </div>
            <div>
              <label style={styles.subLabel}>石垣島: {vulnerableIshigaki}コマ</label>
              <input type="range" min={0} max={8} value={vulnerableIshigaki}
                onChange={e => setVulnerableIshigaki(Number(e.target.value))}
                style={styles.slider} />
            </div>
            <div>
              <label style={styles.subLabel}>宮古島: {vulnerableMiyako}コマ</label>
              <input type="range" min={0} max={8} value={vulnerableMiyako}
                onChange={e => setVulnerableMiyako(Number(e.target.value))}
                style={styles.slider} />
            </div>
          </div>
        </div>

        {/* 初期人口まとめ */}
        <div style={styles.summaryBox}>
          <h3 style={styles.summaryTitle}>初期配置概要</h3>
          <div style={{ ...styles.summaryGrid, gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr' }}>
            <div style={styles.summaryItem}>
              <span style={{...styles.dot, background:'#ef4444'}}></span>
              <span>与那国島: 住民2コマ + 要援護者{vulnerableYonaguni}コマ</span>
            </div>
            <div style={styles.summaryItem}>
              <span style={{...styles.dot, background:'#f97316'}}></span>
              <span>竹富町全島: 住民15コマ + 観光{Math.round(tourists*0.15)}コマ + 要援護者{vulnerableTaketomi}コマ</span>
            </div>
            <div style={styles.summaryItem}>
              <span style={{...styles.dot, background:'#3b82f6'}}></span>
              <span>石垣島: 住民43コマ + 観光{Math.round(tourists*0.5)}コマ + 要援護者{vulnerableIshigaki}コマ</span>
            </div>
            <div style={styles.summaryItem}>
              <span style={{...styles.dot, background:'#22c55e'}}></span>
              <span>宮古島・多良間: 住民49コマ + 観光{Math.round(tourists*0.35)}コマ + 要援護者{vulnerableMiyako}コマ</span>
            </div>
          </div>
          <div style={styles.totalLine}>
            合計: 約 {2 + 15 + 43 + 49 + tourists + vulnerableYonaguni + vulnerableTaketomi + vulnerableIshigaki + vulnerableMiyako}コマ ≒{' '}
            {(2 + 15 + 43 + 49 + tourists + vulnerableYonaguni + vulnerableTaketomi + vulnerableIshigaki + vulnerableMiyako) * 1000}人
          </div>
        </div>

        <button style={styles.startBtn} onClick={handleStart}>
          シミュレーション開始 →
        </button>
      </div>

      <div style={styles.footer}>
        <p>OKIRES2026 ver2.0 デジタルシミュレーター | ルール原典: OKIRES製作委員会</p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 800, margin: '0 auto', padding: '20px', fontFamily: '"Noto Sans JP", sans-serif' },
  header: { textAlign: 'center', marginBottom: 32 },
  logo: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 16 },
  logoTriangle: { fontSize: 64, color: '#7c3aed' },
  logoOkires: { fontSize: 48, fontWeight: 900, color: '#1e40af', letterSpacing: -2 },
  logoSub: { fontSize: 16, color: '#64748b' },
  description: { color: '#475569', lineHeight: 1.6 },
  card: { background: '#fff', borderRadius: 12, padding: 32, boxShadow: '0 4px 20px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0' },
  sectionTitle: { fontSize: 20, fontWeight: 700, color: '#1e293b', marginBottom: 24, borderBottom: '2px solid #3b82f6', paddingBottom: 8 },
  formGroup: { marginBottom: 28 },
  label: { display: 'block', fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 8 },
  value: { color: '#3b82f6', fontSize: 20, fontWeight: 900, marginLeft: 8 },
  hint: { color: '#94a3b8', fontSize: 13, fontWeight: 400, marginLeft: 4 },
  desc: { color: '#64748b', fontSize: 14, marginBottom: 12 },
  sliderRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 },
  sliderLabel: { color: '#64748b', fontSize: 12, whiteSpace: 'nowrap' },
  slider: { flex: 1, accentColor: '#3b82f6' },
  levelGrid: { display: 'flex', gap: 8 },
  levelBtn: { flex: 1, padding: '8px 4px', border: '2px solid #e2e8f0', borderRadius: 8, background: '#f8fafc', cursor: 'pointer', fontWeight: 600, color: '#111', transition: 'all 0.2s', outline: 'none' },
  levelBtnActive: { background: '#3b82f6', borderColor: '#3b82f6', color: '#fff', outline: 'none' },
  levelBtnGreen: { background: '#22c55e', borderColor: '#22c55e', color: '#fff', outline: 'none' },
  monthGrid: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 },
  monthBtn: { padding: '8px 4px', border: '2px solid #e2e8f0', borderRadius: 8, background: '#f8fafc', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#111', outline: 'none', transition: 'all 0.2s' },
  monthBtnActive: { background: '#0ea5e9', borderColor: '#0ea5e9', color: '#fff', fontWeight: 700, outline: 'none' },
  monthBtnDanger: { borderColor: '#e2e8f0', background: '#f8fafc' },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  fourCol: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 },
  subLabel: { display: 'block', fontSize: 14, fontWeight: 600, color: '#475569', marginBottom: 6 },
  summaryBox: { background: '#f0f9ff', borderRadius: 8, padding: 16, marginTop: 24, border: '1px solid #bae6fd' },
  summaryTitle: { fontSize: 14, fontWeight: 700, color: '#0369a1', marginBottom: 12 },
  summaryGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  summaryItem: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155' },
  dot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  totalLine: { marginTop: 12, fontWeight: 700, color: '#0369a1', fontSize: 15, borderTop: '1px solid #bae6fd', paddingTop: 8 },
  startBtn: { width: '100%', padding: '16px', background: 'linear-gradient(135deg, #1e40af, #3b82f6)', color: '#fff', border: 'none', borderRadius: 12, fontSize: 18, fontWeight: 700, cursor: 'pointer', marginTop: 24, letterSpacing: 1, outline: 'none' },
  footer: { textAlign: 'center', color: '#94a3b8', fontSize: 12, marginTop: 24 },
};
