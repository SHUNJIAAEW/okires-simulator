import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { GameState, SetupConfig } from './types';
import { createInitialState, prepareDayPhase1, executeDayPhase2, autoSelectOrders } from './gameEngine';
import { SetupScreen } from './components/SetupScreen';
import { DayLogPanel } from './components/DayLogPanel';
import { ResultScreen } from './components/ResultScreen';
import { IllustratedMap } from './components/IllustratedMap';
import { useWindowWidth } from './hooks/useWindowWidth';
import { C, FONT } from './theme';

type Screen = 'setup' | 'simulation' | 'result';

const DAY_LABELS = [
  'X-3', 'X-2', 'X-1', 'X', 'X+1', 'X+2', 'X+3',
  'X+4', 'X+5', 'X+6', 'X+7', 'X+8',
];

const PHASE_COLORS: Record<string, string> = {
  peacetime: '#22c55e',
  crisis: '#f59e0b',
  wartime: '#dc2626',
};

const PHASE_LABELS: Record<string, string> = {
  peacetime: '平時',
  crisis: '存立危機事態',
  wartime: '有事',
};

export default function App() {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 768;
  const [screen, setScreen] = useState<Screen>('setup');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const autoPlayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleStart = (config: SetupConfig) => {
    const initialState = createInitialState(config);
    setGameState(initialState);
    setIsComplete(false);
    setAutoPlay(false);
    setScreen('simulation');
  };

  // AI全日程一括実行（同期ループ・即座に結果へ）
  const handleFullAutoRun = useCallback(() => {
    if (!gameState) return;
    setAutoPlay(false);
    setIsSimulating(true);

    setTimeout(() => {
      let state = gameState;
      for (let i = 0; i < 20; i++) {
        const phase1 = prepareDayPhase1(state);
        const orders = autoSelectOrders(phase1);
        const { newState } = executeDayPhase2(state, phase1, orders);
        state = newState;
        const remaining = Object.values(state.areas).reduce(
          (s, a) => s + a.residents + a.tourists + a.vulnerable + a.stagingPort, 0
        );
        if (state.day > 8 || remaining === 0) break;
      }
      setGameState(state);
      setIsSimulating(false);
      setScreen('result');
    }, 100);
  }, [gameState]);

  // 自動再生（1日ずつAI実行・マップを更新しながら進む）
  useEffect(() => {
    if (!autoPlay || isComplete || isSimulating) return;
    autoPlayRef.current = setTimeout(() => {
      if (!gameState || !autoPlay) return;
      setIsSimulating(true);
      setTimeout(() => {
        const phase1 = prepareDayPhase1(gameState);
        const orders = autoSelectOrders(phase1);
        const { newState } = executeDayPhase2(gameState, phase1, orders);
        setGameState(newState);
        const totalRemaining = Object.values(newState.areas).reduce(
          (s, a) => s + a.residents + a.tourists + a.vulnerable + a.stagingPort, 0
        );
        const done = newState.day > 8 || totalRemaining === 0;
        if (done) {
          setIsComplete(true);
          setAutoPlay(false);
        }
        setIsSimulating(false);
      }, 400);
    }, 1800); // コマ移動アニメ（約1.8秒）を見せるため間隔を確保
    return () => { if (autoPlayRef.current) clearTimeout(autoPlayRef.current); };
  }, [autoPlay, isComplete, isSimulating, gameState]);

  const handleRestart = () => {
    setGameState(null);
    setAutoPlay(false);
    setIsComplete(false);
    setScreen('setup');
  };

  if (screen === 'setup') {
    return (
      <div style={styles.appBg}>
        <SetupScreen onStart={handleStart} />
      </div>
    );
  }

  if (screen === 'result' && gameState) {
    return (
      <div style={styles.appBg}>
        <ResultScreen state={gameState} onRestart={handleRestart} />
      </div>
    );
  }

  if (!gameState) return null;

  const totalRemaining = Object.values(gameState.areas).reduce(
    (s, a) => s + a.residents + a.tourists + a.vulnerable + a.stagingPort, 0
  );
  const totalInitial = gameState.evacuated + gameState.dead + totalRemaining;
  const evacuationRate = totalInitial > 0 ? (gameState.evacuated / totalInitial * 100) : 0;
  const dayIndex = gameState.day + 3;
  const currentDayLabel = DAY_LABELS[dayIndex] ?? `Day ${gameState.day}`;
  const phaseColor = PHASE_COLORS[gameState.phase];
  const phaseLabel = PHASE_LABELS[gameState.phase];

  return (
    <div style={styles.appBg}>
      {/* Top bar */}
      <div style={styles.topBar}>
        <div style={{
          ...styles.topBarInner,
          padding: isMobile ? '8px 12px' : '10px 20px',
          gap: isMobile ? 8 : 20,
        }}>
          <div style={styles.logoSmall}>
            <span style={{ ...styles.triangle, fontSize: isMobile ? 16 : 22 }}>▲</span>
            <span style={{ ...styles.logoText, fontSize: isMobile ? 14 : 18 }}>OKIRES 2026</span>
          </div>
          <div style={{ ...styles.phaseBadge, background: phaseColor, fontSize: isMobile ? 11 : 13, padding: isMobile ? '3px 10px' : '4px 14px' }}>
            {gameState.phase === 'wartime' && <span style={styles.pulseRing} />}
            {phaseLabel}
          </div>
          <div style={{ ...styles.dayBadge, padding: isMobile ? '3px 8px' : '4px 12px' }}>
            <span style={styles.dayLabel}>現在</span>
            <span style={{ ...styles.dayValue, fontSize: isMobile ? 14 : 18 }}>{currentDayLabel}</span>
          </div>
          <div style={{ ...styles.miniStats, fontSize: isMobile ? 11 : 13, marginLeft: isMobile ? 0 : 'auto' }}>
            <span style={{ color: C.green }}>避難 {gameState.evacuated}コマ</span>
            <span style={styles.divider}>|</span>
            <span style={{ color: C.amber }}>残 {totalRemaining}コマ</span>
            {gameState.dead > 0 && <>
              <span style={styles.divider}>|</span>
              <span style={{ color: C.red }}>死亡 {gameState.dead}コマ</span>
            </>}
          </div>
        </div>
      </div>

      {/* タイムライン + 避難率バー */}
      <div style={{ ...styles.progressSection, padding: isMobile ? '8px 12px' : '10px 20px' }}>
        <div style={{ ...styles.timeline, overflowX: 'auto', paddingBottom: 2 }}>
          {DAY_LABELS.map((label, i) => (
            <div key={label} style={{ ...styles.timelineTick, minWidth: isMobile ? 24 : 'auto' }}>
              <div style={{
                ...styles.timelineDot,
                width: isMobile ? 8 : 12,
                height: isMobile ? 8 : 12,
                background: i < dayIndex ? C.green : i === dayIndex ? phaseColor : C.bgCard,
                boxShadow: i === dayIndex ? `0 0 8px ${phaseColor}` : 'none',
              }} />
              <span style={{ ...styles.timelineLabel, fontSize: isMobile ? 8 : 10 }}>{label}</span>
            </div>
          ))}
        </div>
        <div style={styles.evacuationBarWrap}>
          <span style={{ ...styles.evacuationBarLabel, fontSize: isMobile ? 10 : 12 }}>
            避難完了率 {evacuationRate.toFixed(1)}% ({Math.min(dayIndex + 1, 12)}/12日)
          </span>
          <div style={styles.evacuationBar}>
            <div style={{ ...styles.evacuationFill, width: `${evacuationRate}%` }} />
          </div>
        </div>
      </div>

      {/* メインコンテンツ */}
      <div style={{
        ...styles.mainContent,
        gridTemplateColumns: isMobile ? '1fr' : '1fr 380px',
        display: isMobile ? 'flex' : 'grid',
        flexDirection: isMobile ? 'column' : undefined,
        padding: isMobile ? '12px 8px' : '20px',
      }}>
        {/* 左：マップ + コントロール */}
        <div style={styles.leftCol}>
          <IllustratedMap
            areas={gameState.areas}
            infra={gameState.infra}
            evacuated={gameState.evacuated}
            dead={gameState.dead}
            dayLogs={gameState.dayLogs}
          />

          <div style={styles.controlPanel}>
            {isComplete ? (
              <button className="tac-cta" style={styles.fullAutoBtn} onClick={() => setScreen('result')}>
                ✅ シミュレーション完了 → 結果を見る
              </button>
            ) : (
              <>
                <button
                  className="tac-cta"
                  style={{
                    ...styles.fullAutoBtn,
                    opacity: isSimulating ? 0.6 : 1,
                    cursor: isSimulating ? 'not-allowed' : 'pointer',
                  }}
                  onClick={handleFullAutoRun}
                  disabled={isSimulating}
                >
                  {isSimulating ? '⏳ AI計算中...' : '⚡ 一括実行 → 結果へ'}
                </button>
                <button
                  className="tac-ghost"
                  style={{
                    ...styles.autoPlayBtn,
                    background: autoPlay ? 'rgba(255,59,59,0.18)' : 'rgba(42,100,150,0.12)',
                    borderColor: autoPlay ? C.red : C.borderHi,
                    color: autoPlay ? '#ff8d8d' : C.white,
                    opacity: isSimulating && !autoPlay ? 0.6 : 1,
                    cursor: isSimulating && !autoPlay ? 'not-allowed' : 'pointer',
                  }}
                  onClick={() => setAutoPlay(p => !p)}
                  disabled={isSimulating && !autoPlay}
                >
                  {autoPlay ? '⏸ 自動再生 停止' : '▶ 自動再生（1日ずつ確認）'}
                </button>
              </>
            )}
            <button className="tac-ghost" style={styles.restartBtn} onClick={handleRestart}>← 設定に戻る</button>
          </div>

          <div style={styles.infoPanel}>
            <div style={styles.infoPanelRow}>
              <span style={styles.infoLabel}>事前準備</span>
              <span style={styles.infoValue}>Lv.{gameState.prepLevel}</span>
            </div>
            <div style={styles.infoPanelRow}>
              <span style={styles.infoLabel}>抗堪性</span>
              <span style={styles.infoValue}>Lv.{gameState.shelterLevel}</span>
            </div>
            <div style={styles.infoPanelRow}>
              <span style={styles.infoLabel}>発生月</span>
              <span style={styles.infoValue}>{gameState.month}月</span>
            </div>
          </div>
        </div>

        {/* 右：説明 */}
        <div style={styles.rightCol}>
          <DayLogPanel logs={gameState.dayLogs} />
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  appBg: { minHeight: '100vh', background: 'transparent', fontFamily: FONT.jp, color: C.body },
  topBar: {
    position: 'sticky', top: 0, zIndex: 100,
    background: 'linear-gradient(180deg, rgba(13,27,42,0.96), rgba(6,13,24,0.92))',
    backdropFilter: 'blur(8px)',
    borderBottom: `1px solid ${C.border}`,
    boxShadow: '0 4px 18px rgba(0,0,0,0.45)',
  },
  topBarInner: {
    maxWidth: 1400, margin: '0 auto', padding: '10px 20px',
    display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
  },
  logoSmall: { display: 'flex', alignItems: 'center', gap: 8 },
  triangle: { fontSize: 22, color: C.green, filter: `drop-shadow(0 0 8px ${C.green})` },
  logoText: { fontSize: 18, fontWeight: 700, color: C.white, letterSpacing: 1, fontFamily: FONT.display },
  phaseBadge: {
    position: 'relative', padding: '4px 14px', borderRadius: 3,
    color: '#06121f', fontSize: 12, fontWeight: 800,
    display: 'flex', alignItems: 'center', gap: 6, fontFamily: FONT.mono, letterSpacing: 0.5,
  },
  pulseRing: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#06121f', animation: 'okires-blink 1s infinite' },
  dayBadge: { display: 'flex', alignItems: 'center', gap: 8, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 3, padding: '4px 12px' },
  dayLabel: { color: C.dim, fontSize: 10, fontFamily: FONT.mono, letterSpacing: 1 },
  dayValue: { color: C.white, fontSize: 18, fontWeight: 800, fontFamily: FONT.mono },
  miniStats: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, marginLeft: 'auto', fontFamily: FONT.mono },
  divider: { color: C.border },
  progressSection: { background: 'rgba(13,27,42,0.5)', padding: '10px 20px', borderBottom: `1px solid ${C.border}` },
  timeline: { display: 'flex', maxWidth: 1400, margin: '0 auto 8px', justifyContent: 'space-between' },
  timelineTick: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: 1 },
  timelineDot: { width: 12, height: 12, borderRadius: '50%', transition: 'all 0.3s' },
  timelineLabel: { fontSize: 10, color: C.dim, transition: 'color 0.3s', fontFamily: FONT.mono },
  evacuationBarWrap: { maxWidth: 1400, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12 },
  evacuationBarLabel: { color: C.body, fontSize: 12, whiteSpace: 'nowrap' as const, fontWeight: 600, fontFamily: FONT.mono },
  evacuationBar: { flex: 1, height: 8, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 4, overflow: 'hidden' },
  evacuationFill: { height: '100%', background: `linear-gradient(90deg, ${C.green}, #4dffa8)`, borderRadius: 4, transition: 'width 0.5s ease', boxShadow: `0 0 12px ${C.green}88` },
  mainContent: {
    maxWidth: 1400, margin: '0 auto', padding: '20px',
    display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20, alignItems: 'start',
  },
  leftCol: { display: 'flex', flexDirection: 'column', gap: 16 },
  rightCol: { display: 'flex', flexDirection: 'column', gap: 16 },
  controlPanel: {
    background: `linear-gradient(180deg, ${C.bgPanel}, ${C.bgDeep})`, borderRadius: 4, padding: 16,
    display: 'flex', flexDirection: 'column', gap: 10,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)', border: `1px solid ${C.border}`,
  },
  fullAutoBtn: {
    padding: '16px 20px', background: `linear-gradient(135deg, ${C.green}, #00c46a)`,
    color: '#00150d', border: 'none', borderRadius: 4, fontSize: 16, fontWeight: 900, cursor: 'pointer',
    boxShadow: '0 6px 20px rgba(0,255,136,0.28)', letterSpacing: 0.5, fontFamily: FONT.jp,
  },
  autoPlayBtn: {
    padding: '12px 20px', color: C.white, borderWidth: 1, borderStyle: 'solid', borderColor: C.borderHi,
    borderRadius: 4, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: FONT.jp,
  },
  restartBtn: {
    padding: '8px 20px', background: 'transparent', color: C.dim,
    border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 13, cursor: 'pointer', fontFamily: FONT.mono, letterSpacing: 0.5,
  },
  infoPanel: {
    background: `linear-gradient(180deg, ${C.bgPanel}, ${C.bgDeep})`, borderRadius: 4, padding: '12px 16px',
    display: 'flex', gap: 16, boxShadow: '0 4px 16px rgba(0,0,0,0.35)', border: `1px solid ${C.border}`,
  },
  infoPanelRow: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, gap: 2 },
  infoLabel: { fontSize: 10, color: C.dim, fontFamily: FONT.mono, letterSpacing: 1 },
  infoValue: { fontSize: 16, fontWeight: 800, color: C.bright, fontFamily: FONT.mono },
};
