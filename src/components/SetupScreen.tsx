import React, { useState } from 'react';
import type { SetupConfig } from '../types';
import { TOURIST_BY_MONTH } from '../constants';
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
  dimText:   '#4a7a9b',
  bodyText:  '#8eb8d4',
  brightText:'#c8e6f8',
  white:     '#e8f4ff',
} as const;

// divベースのボタン — ブラウザのデフォルトbuttonスタイルを完全排除
function NoFocusButton({ style, onClick, children }: {
  style?: React.CSSProperties;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={-1}
      style={{ ...style, userSelect: 'none', WebkitUserSelect: 'none' }}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); }}
    >
      {children}
    </div>
  );
}

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
    <div style={{
      maxWidth: 800, margin: '0 auto',
      padding: isMobile ? '12px' : '20px',
      fontFamily: 'system-ui, sans-serif',
      background: C.bgDeep,
      minHeight: '100vh',
    }}>
      {/* ─── ロゴ / ヘッダー ─── */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: isMobile ? 8 : 16, marginBottom: 12,
        }}>
          <span style={{ fontSize: isMobile ? 40 : 64, color: C.green, fontFamily: 'monospace', lineHeight: 1 }}>▲</span>
          <div>
            <div style={{
              fontSize: isMobile ? 32 : 48, fontWeight: 900, color: C.green,
              fontFamily: 'monospace', letterSpacing: 4,
            }}>OKIRES</div>
            <div style={{ fontSize: isMobile ? 11 : 13, color: C.amber, fontFamily: 'monospace', letterSpacing: 2, marginTop: 2 }}>
              OPERATION BRIEFING — 先島諸島広域避難計画 2026
            </div>
          </div>
        </div>
        {/* Tactical rule */}
        <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${C.green}, transparent)`, marginBottom: 16 }} />
        <p style={{ color: C.bodyText, lineHeight: 1.6, fontSize: isMobile ? 13 : 14, fontFamily: 'monospace', margin: 0 }}>
          台湾有事を想定した沖縄先島諸島 約12万人の広域避難シミュレーションです。<br />
          X-3日から始まり、X+8日までの計12日間をシミュレートします。
        </p>
      </div>

      {/* ─── メインカード ─── */}
      <div style={{
        background: C.bgPanel,
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        padding: isMobile ? 16 : 32,
        position: 'relative',
        /* corner accent */
        boxShadow: `inset 0 0 0 1px ${C.border}`,
      }}>
        {/* Corner accent dots */}
        {[
          { top: 4, left: 4 }, { top: 4, right: 4 },
          { bottom: 4, left: 4 }, { bottom: 4, right: 4 },
        ].map((pos, i) => (
          <div key={i} style={{
            position: 'absolute', width: 6, height: 6,
            background: C.green, borderRadius: 1,
            ...pos,
          }} />
        ))}

        <h2 style={{
          fontSize: 12, fontWeight: 800, color: C.amber,
          fontFamily: 'monospace', letterSpacing: 3, textTransform: 'uppercase',
          borderLeft: `3px solid ${C.green}`, paddingLeft: 10,
          marginBottom: 24, marginTop: 0,
        }}>
          MISSION PARAMETERS
        </h2>

        {/* ── 事前準備Lv ── */}
        <div style={formGroup}>
          <SectionLabel>PRE-OPERATION READINESS LEVEL</SectionLabel>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 700, color: C.brightText, marginBottom: 4, fontFamily: 'monospace' }}>
            事前準備 Lv. <span style={{ color: C.green, fontSize: 20, fontWeight: 900 }}>{prepLevel}</span>
          </label>
          <p style={{ color: C.dimText, fontSize: 13, marginBottom: 12, fontFamily: 'monospace' }}>{PREP_DESCRIPTIONS[prepLevel]}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ color: C.dimText, fontSize: 12, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>1 (無準備)</span>
            <input
              type="range" min={1} max={6} value={prepLevel}
              onChange={e => setPrepLevel(Number(e.target.value))}
              style={{ flex: 1, accentColor: C.green }}
            />
            <span style={{ color: C.dimText, fontSize: 12, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>6 (完璧)</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[1,2,3,4,5,6].map(lv => (
              <NoFocusButton
                key={lv}
                style={{
                  flex: 1, padding: '8px 4px', borderRadius: 4, cursor: 'pointer',
                  fontWeight: 700, fontSize: 13, textAlign: 'center',
                  fontFamily: 'monospace', transition: 'all 0.15s',
                  ...(prepLevel === lv
                    ? { background: '#003d7a', border: `1px solid ${C.borderHi}`, color: C.brightText }
                    : { background: C.bgCard, border: `1px solid ${C.border}`, color: C.dimText }
                  ),
                }}
                onClick={() => setPrepLevel(lv)}
              >Lv.{lv}</NoFocusButton>
            ))}
          </div>
        </div>

        {/* ── 抗堪性Lv ── */}
        <div style={formGroup}>
          <SectionLabel>SHELTER / HARDENING LEVEL</SectionLabel>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 700, color: C.brightText, marginBottom: 4, fontFamily: 'monospace' }}>
            抗堪性 Lv. <span style={{ color: C.green, fontSize: 20, fontWeight: 900 }}>{shelterLevel}</span>
            <span style={{ color: C.dimText, fontSize: 13, fontWeight: 400, marginLeft: 4, fontFamily: 'monospace' }}>(シェルター普及度)</span>
          </label>
          <p style={{ color: C.dimText, fontSize: 13, marginBottom: 12, fontFamily: 'monospace' }}>{SHELTER_DESCRIPTIONS[shelterLevel]}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ color: C.dimText, fontSize: 12, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>1 (無防備)</span>
            <input
              type="range" min={1} max={5} value={shelterLevel}
              onChange={e => setShelterLevel(Number(e.target.value))}
              style={{ flex: 1, accentColor: C.green }}
            />
            <span style={{ color: C.dimText, fontSize: 12, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>5 (充実)</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[1,2,3,4,5].map(lv => (
              <NoFocusButton
                key={lv}
                style={{
                  flex: 1, padding: '8px 4px', borderRadius: 4, cursor: 'pointer',
                  fontWeight: 700, fontSize: 13, textAlign: 'center',
                  fontFamily: 'monospace', transition: 'all 0.15s',
                  ...(shelterLevel === lv
                    ? { background: '#003320', border: `1px solid #00aa55`, color: C.green }
                    : { background: C.bgCard, border: `1px solid ${C.border}`, color: C.dimText }
                  ),
                }}
                onClick={() => setShelterLevel(lv)}
              >Lv.{lv}</NoFocusButton>
            ))}
          </div>
        </div>

        {/* ── 月 ── */}
        <div style={formGroup}>
          <SectionLabel>INCIDENT MONTH / SEASONAL CONDITIONS</SectionLabel>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 700, color: C.brightText, marginBottom: 4, fontFamily: 'monospace' }}>
            事態発生月 <span style={{ color: C.green, fontSize: 20, fontWeight: 900 }}>{month}月</span>
          </label>
          <p style={{ color: C.dimText, fontSize: 13, marginBottom: 12, fontFamily: 'monospace' }}>
            観光客数: 最大{tourists}コマ | {month >= 6 && month <= 10 ? '⚠ 台風・大雨の発生確率が高い季節' : '比較的安定した気象'}
          </p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(4, 1fr)' : 'repeat(6, 1fr)',
            gap: 8,
          }}>
            {Array.from({length: 12}, (_, i) => i + 1).map(m => (
              <NoFocusButton
                key={m}
                style={{
                  padding: '8px 4px', borderRadius: 4, cursor: 'pointer',
                  fontSize: 13, fontWeight: 700, textAlign: 'center',
                  fontFamily: 'monospace', transition: 'all 0.15s',
                  ...(month === m
                    ? { background: '#003344', border: `1px solid #00aacc`, color: '#00ddff' }
                    : { background: C.bgCard, border: `1px solid ${C.border}`, color: C.dimText }
                  ),
                }}
                onClick={() => setMonth(m)}
              >{m}月</NoFocusButton>
            ))}
          </div>
        </div>

        {/* ── 要援護者配置 ── */}
        <div style={formGroup}>
          <SectionLabel>VULNERABLE UNIT PLACEMENT</SectionLabel>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 700, color: C.brightText, marginBottom: 4, fontFamily: 'monospace' }}>
            青コマ（要援護者）配置
          </label>
          <p style={{ color: C.dimText, fontSize: 13, marginBottom: 12, fontFamily: 'monospace' }}>高齢者・障がい者・妊産婦など。船のみ利用可能（航空機不可）。</p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
            gap: 12,
          }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.bodyText, marginBottom: 6, fontFamily: 'monospace' }}>与那国島: {vulnerableYonaguni}コマ</label>
              <input type="range" min={0} max={2} value={vulnerableYonaguni}
                onChange={e => setVulnerableYonaguni(Number(e.target.value))}
                style={{ width: '100%', accentColor: C.green }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.bodyText, marginBottom: 6, fontFamily: 'monospace' }}>竹富町: {vulnerableTaketomi}コマ</label>
              <input type="range" min={0} max={5} value={vulnerableTaketomi}
                onChange={e => setVulnerableTaketomi(Number(e.target.value))}
                style={{ width: '100%', accentColor: C.green }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.bodyText, marginBottom: 6, fontFamily: 'monospace' }}>石垣島: {vulnerableIshigaki}コマ</label>
              <input type="range" min={0} max={8} value={vulnerableIshigaki}
                onChange={e => setVulnerableIshigaki(Number(e.target.value))}
                style={{ width: '100%', accentColor: C.green }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.bodyText, marginBottom: 6, fontFamily: 'monospace' }}>宮古島: {vulnerableMiyako}コマ</label>
              <input type="range" min={0} max={8} value={vulnerableMiyako}
                onChange={e => setVulnerableMiyako(Number(e.target.value))}
                style={{ width: '100%', accentColor: C.green }} />
            </div>
          </div>
        </div>

        {/* ── 初期配置概要 ── */}
        <div style={{
          background: C.bgCard,
          border: `1px solid ${C.green}55`,
          borderLeft: `3px solid ${C.green}`,
          borderRadius: 4,
          padding: 16,
          marginTop: 24,
          marginBottom: 24,
        }}>
          <h3 style={{
            fontSize: 11, fontWeight: 800, color: C.green,
            fontFamily: 'monospace', letterSpacing: 2, textTransform: 'uppercase',
            marginBottom: 12, marginTop: 0,
          }}>INITIAL DEPLOYMENT SUMMARY</h3>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
            gap: 8,
          }}>
            {[
              { dot: C.red,      text: `与那国島: 住民2コマ + 要援護者${vulnerableYonaguni}コマ` },
              { dot: C.amber,    text: `竹富町全島: 住民15コマ + 観光${Math.round(tourists*0.15)}コマ + 要援護者${vulnerableTaketomi}コマ` },
              { dot: '#4a9fd4',  text: `石垣島: 住民43コマ + 観光${Math.round(tourists*0.5)}コマ + 要援護者${vulnerableIshigaki}コマ` },
              { dot: C.green,    text: `宮古島・多良間: 住民49コマ + 観光${Math.round(tourists*0.35)}コマ + 要援護者${vulnerableMiyako}コマ` },
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.bodyText, fontFamily: 'monospace' }}>
                <div style={{ width: 8, height: 8, borderRadius: 1, background: item.dot, flexShrink: 0 }} />
                <span>{item.text}</span>
              </div>
            ))}
          </div>
          <div style={{
            marginTop: 12, fontWeight: 700, color: C.green, fontSize: 14,
            borderTop: `1px solid ${C.border}`, paddingTop: 8, fontFamily: 'monospace',
            letterSpacing: 1,
          }}>
            TOTAL: {2 + 15 + 43 + 49 + tourists + vulnerableYonaguni + vulnerableTaketomi + vulnerableIshigaki + vulnerableMiyako} UNITS
            {' ≒ '}
            {(2 + 15 + 43 + 49 + tourists + vulnerableYonaguni + vulnerableTaketomi + vulnerableIshigaki + vulnerableMiyako) * 1000}人
          </div>
        </div>

        {/* ── START ── */}
        <NoFocusButton
          style={{
            width: '100%', padding: '16px',
            background: 'linear-gradient(135deg, #003d7a, #00aa55)',
            color: C.white, border: 'none', borderRadius: 6,
            fontSize: 16, fontWeight: 800, cursor: 'pointer',
            letterSpacing: 3, textAlign: 'center', fontFamily: 'monospace',
            boxShadow: `0 0 20px ${C.green}33`,
            textTransform: 'uppercase',
          }}
          onClick={handleStart}
        >
          ▶ COMMENCE SIMULATION
        </NoFocusButton>
      </div>

      {/* ─── フッター ─── */}
      <div style={{ textAlign: 'center', color: C.dimText, fontSize: 11, marginTop: 24, fontFamily: 'monospace', letterSpacing: 1 }}>
        <p>OKIRES2026 ver2.0 | DIGITAL SIMULATOR | RULE SOURCE: OKIRES PRODUCTION COMMITTEE</p>
      </div>
    </div>
  );
}

// ─── Helper sub-components ───

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 800, color: C.amber,
      fontFamily: 'monospace', letterSpacing: 2, textTransform: 'uppercase',
      borderLeft: `3px solid ${C.green}`, paddingLeft: 8,
      marginBottom: 10,
    }}>
      {children}
    </div>
  );
}

const formGroup: React.CSSProperties = {
  marginBottom: 28,
  paddingBottom: 24,
  borderBottom: `1px solid ${C.border}`,
};
