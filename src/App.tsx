import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { GameState, SetupConfig, EvacuationOrder, DayPhase1Result } from './types';
import { createInitialState, prepareDayPhase1, executeDayPhase2, autoSelectOrders } from './gameEngine';
import { SetupScreen } from './components/SetupScreen';
import { IslandMap } from './components/IslandMap';
import { DayLogPanel } from './components/DayLogPanel';
import { ResultScreen } from './components/ResultScreen';
import { ActionPanel } from './components/ActionPanel';
import { SimulationMap } from './components/SimulationMap';
import { useWindowWidth } from './hooks/useWindowWidth';

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

  // 2フェーズ管理
  const [pendingPhase1, setPendingPhase1] = useState<DayPhase1Result | null>(null);
  const [showActionPanel, setShowActionPanel] = useState(false);

  const autoPlayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleStart = (config: SetupConfig) => {
    const initialState = createInitialState(config);
    setGameState(initialState);
    setIsComplete(false);
    setAutoPlay(false);
    setPendingPhase1(null);
    setShowActionPanel(false);
    setScreen('simulation');
  };

  // フェーズ1：イベント処理（自動）
  const startDayPhase1 = useCallback(() => {
    if (!gameState || isSimulating || showActionPanel) return;
    setIsSimulating(true);

    setTimeout(() => {
      const phase1 = prepareDayPhase1(gameState);
      setPendingPhase1(phase1);
      setShowActionPanel(true);
      setIsSimulating(false);
    }, 200);
  }, [gameState, isSimulating, showActionPanel]);

  // フェーズ2：避難実行（プレイヤー指示）
  const executePhase2 = useCallback((orders: EvacuationOrder[]) => {
    if (!gameState || !pendingPhase1) return;
    setIsSimulating(true);
    setShowActionPanel(false);
    setPendingPhase1(null);

    setTimeout(() => {
      const { newState } = executeDayPhase2(gameState, pendingPhase1, orders);
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
    }, 200);
  }, [gameState, pendingPhase1]);

  // AI自動実行（1日分）
  const handleAutoExecute = useCallback(() => {
    if (!pendingPhase1) return;
    const orders = autoSelectOrders(pendingPhase1);
    executePhase2(orders);
  }, [pendingPhase1, executePhase2]);

  // AI全日程一括実行（同期ループ・即座に結果へ）
  const handleFullAutoRun = useCallback(() => {
    if (!gameState) return;
    setAutoPlay(false);
    setShowActionPanel(false);
    setPendingPhase1(null);
    setIsSimulating(true);

    setTimeout(() => {
      let state = gameState;
      for (let i = 0; i < 20; i++) { // 最大20日ループ（安全弁）
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
      setIsComplete(true);
      setIsSimulating(false);
      setScreen('result');
    }, 100);
  }, [gameState]);

  // autoplay: フェーズ1→AI実行を繰り返す
  useEffect(() => {
    if (!autoPlay || isComplete || isSimulating || showActionPanel) return;
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
      }, 300);
    }, 800);

    return () => {
      if (autoPlayRef.current) clearTimeout(autoPlayRef.current);
    };
  }, [autoPlay, isComplete, isSimulating, showActionPanel, gameState]);

  const handleRestart = () => {
    setGameState(null);
    setAutoPlay(false);
    setIsComplete(false);
    setPendingPhase1(null);
    setShowActionPanel(false);
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
            {!isMobile && <span style={styles.dayLabel}>({Math.min(dayIndex + 1, 12)}/12日)</span>}
          </div>

          <div style={{ ...styles.miniStats, fontSize: isMobile ? 11 : 13, marginLeft: isMobile ? 0 : 'auto', flexWrap: 'wrap' }}>
            <span style={{ color: '#00ff88' }}>避難 {gameState.evacuated}コマ</span>
            <span style={styles.divider}>|</span>
            <span style={{ color: '#ffb300' }}>残 {totalRemaining}コマ</span>
            {gameState.dead > 0 && (
              <>
                <span style={styles.divider}>|</span>
                <span style={{ color: '#ff3b3b' }}>死亡 {gameState.dead}コマ</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* タイムライン */}
      <div style={{ ...styles.progressSection, padding: isMobile ? '8px 12px' : '12px 20px' }}>
        <div style={{ ...styles.timeline, overflowX: 'auto', paddingBottom: 2 }}>
          {DAY_LABELS.map((label, i) => (
            <div key={label} style={{ ...styles.timelineTick, minWidth: isMobile ? 24 : 'auto' }}>
              <div style={{
                ...styles.timelineDot,
                width: isMobile ? 8 : 12,
                height: isMobile ? 8 : 12,
                background: i < dayIndex ? '#22c55e' : i === dayIndex ? phaseColor : '#1e3a5f',
                boxShadow: i === dayIndex ? `0 0 8px ${phaseColor}` : 'none',
              }} />
              <span style={{ ...styles.timelineLabel, fontSize: isMobile ? 8 : 10, color: '#8eb8d4' }}>{label}</span>
            </div>
          ))}
        </div>
        <div style={styles.evacuationBarWrap}>
          <span style={{ ...styles.evacuationBarLabel, fontSize: isMobile ? 10 : 12 }}>避難完了率 {evacuationRate.toFixed(1)}%</span>
          <div style={styles.evacuationBar}>
            <div style={{ ...styles.evacuationFill, width: `${evacuationRate}%` }} />
          </div>
        </div>
      </div>

      {/* アクションパネル（フェーズ1完了後に表示） */}
      {showActionPanel && pendingPhase1 && (
        <div style={styles.actionPanelOverlay}>
          <div style={{ ...styles.actionPanelWrap, padding: isMobile ? '0 8px' : '0' }}>
            <ActionPanel
              phase1={pendingPhase1}
              onExecute={executePhase2}
              onAutoExecute={handleAutoExecute}
            />
          </div>
        </div>
      )}

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
          <SimulationMap areas={gameState.areas} />
          <IslandMap state={gameState} />

          <div style={styles.controlPanel}>
            {isComplete ? (
              <div style={styles.completeBox}>
                <div style={styles.completeTitle}>シミュレーション完了</div>
                <div style={styles.completeStats}>
                  避難率: {evacuationRate.toFixed(1)}% | 完了 {gameState.evacuated}コマ | 残 {totalRemaining}コマ
                  {gameState.dead > 0 ? ` | 死亡 ${gameState.dead}コマ` : ''}
                </div>
                <button style={styles.resultBtn} onClick={() => setScreen('result')}>
                  結果を見る →
                </button>
              </div>
            ) : showActionPanel ? (
              <div style={styles.waitingBox}>
                <div style={styles.waitingText}>⬆ 上の「避難指示パネル」でコマ数を選んで「実行」してください</div>
              </div>
            ) : (
              <>
                <button
                  style={{
                    ...styles.fullAutoBtn,
                    opacity: isSimulating ? 0.6 : 1,
                    cursor: isSimulating ? 'not-allowed' : 'pointer',
                  }}
                  onClick={handleFullAutoRun}
                  disabled={isSimulating}
                >
                  {isSimulating ? '⏳ 計算中...' : '⚡ AI FULL AUTO — 最終結果へ'}
                </button>
                <button
                  style={{
                    ...styles.nextDayBtn,
                    opacity: isSimulating ? 0.6 : 1,
                    cursor: isSimulating ? 'not-allowed' : 'pointer',
                    fontSize: 14,
                  }}
                  onClick={startDayPhase1}
                  disabled={isSimulating}
                >
                  {isSimulating ? '⏳ 処理中...' : 'NEXT DAY → 手動操作'}
                </button>
                <button
                  style={{ ...styles.autoPlayBtn, background: autoPlay ? '#4a0000' : '#112233', border: autoPlay ? '1px solid #ff3b3b' : '1px solid #1e3a5f' }}
                  onClick={() => {
                    if (showActionPanel) return;
                    setAutoPlay(!autoPlay);
                  }}
                >
                  {autoPlay ? '⏸ 自動再生 停止' : '▶ 自動再生（ゆっくり確認）'}
                </button>
              </>
            )}
            <button style={styles.restartBtn} onClick={handleRestart}>最初から</button>
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

        {/* 右：日別ログ */}
        <div style={styles.rightCol}>
          <DayLogPanel logs={gameState.dayLogs} />
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  appBg: {
    minHeight: '100vh',
    background: '#060d18',
    backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,255,136,0.06) 0px, rgba(0,255,136,0.06) 1px, transparent 1px, transparent 40px), repeating-linear-gradient(90deg, rgba(0,255,136,0.06) 0px, rgba(0,255,136,0.06) 1px, transparent 1px, transparent 40px)',
    fontFamily: '"Noto Sans JP", sans-serif',
  },
  topBar: {
    position: 'sticky', top: 0, zIndex: 100,
    background: 'linear-gradient(180deg, #060d18 0%, #0d1b2a 100%)',
    borderBottom: '1px solid #00ff88',
    boxShadow: '0 0 20px rgba(0,255,136,0.15)',
  },
  topBarInner: {
    maxWidth: 1400, margin: '0 auto', padding: '10px 20px',
    display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
  },
  logoSmall: { display: 'flex', alignItems: 'center', gap: 8 },
  triangle: { fontSize: 22, color: '#00ff88' },
  logoText: { fontSize: 18, fontWeight: 900, color: '#00ff88', letterSpacing: 2, fontFamily: 'monospace' },
  phaseBadge: {
    position: 'relative', padding: '4px 14px', borderRadius: 4,
    color: '#fff', fontSize: 13, fontWeight: 700,
    display: 'flex', alignItems: 'center', gap: 6,
    fontFamily: 'monospace', letterSpacing: 2,
  },
  pulseRing: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#fff' },
  dayBadge: { display: 'flex', alignItems: 'center', gap: 6, background: '#0d1b2a', border: '1px solid #1e3a5f', borderRadius: 4, padding: '4px 12px' },
  dayLabel: { color: '#4a7a9b', fontSize: 11 },
  dayValue: { color: '#00ff88', fontSize: 18, fontWeight: 900 },
  miniStats: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, marginLeft: 'auto' },
  divider: { color: '#1e3a5f' },
  progressSection: { background: '#0d1b2a', padding: '12px 20px', borderBottom: '1px solid #1e3a5f' },
  timeline: {
    display: 'flex', maxWidth: 1400, margin: '0 auto 10px',
    justifyContent: 'space-between',
  },
  timelineTick: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: 1 },
  timelineDot: { width: 12, height: 12, borderRadius: '50%', transition: 'all 0.3s' },
  timelineLabel: { fontSize: 10, transition: 'color 0.3s', color: '#8eb8d4' },
  evacuationBarWrap: {
    maxWidth: 1400, margin: '0 auto',
    display: 'flex', alignItems: 'center', gap: 12,
  },
  evacuationBarLabel: { color: '#8eb8d4', fontSize: 12, whiteSpace: 'nowrap', fontWeight: 600 },
  evacuationBar: { flex: 1, height: 8, background: '#1e3a5f', borderRadius: 4, overflow: 'hidden' },
  evacuationFill: {
    height: '100%', background: 'linear-gradient(90deg, #00ff88, #4ade80)',
    borderRadius: 4, transition: 'width 0.5s ease',
  },
  actionPanelOverlay: {
    background: '#060d18',
    borderBottom: '2px solid #2a6496',
    padding: '0',
  },
  actionPanelWrap: { maxWidth: 1400, margin: '0 auto' },
  mainContent: {
    maxWidth: 1400, margin: '0 auto', padding: '20px',
    display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20, alignItems: 'start',
  },
  leftCol: { display: 'flex', flexDirection: 'column', gap: 16 },
  rightCol: { display: 'flex', flexDirection: 'column', gap: 16 },
  controlPanel: {
    background: '#0d1b2a', borderRadius: 8, padding: 16,
    display: 'flex', flexDirection: 'column', gap: 10,
    boxShadow: '0 0 12px rgba(0,255,136,0.08)', border: '1px solid #1e3a5f',
  },
  fullAutoBtn: {
    padding: '16px 20px',
    background: 'linear-gradient(135deg, #003d7a 0%, #004d2a 100%)',
    color: '#00ff88', border: '1px solid #00ff88', borderRadius: 6,
    fontSize: 16, fontWeight: 800, cursor: 'pointer',
    fontFamily: 'monospace', letterSpacing: 1,
    boxShadow: '0 0 16px rgba(0,255,136,0.2)',
  },
  nextDayBtn: {
    padding: '14px 20px', background: '#003d7a',
    color: '#c8e6f8', border: '1px solid #2a6496', borderRadius: 6,
    fontSize: 16, fontWeight: 700, cursor: 'pointer', fontFamily: 'monospace',
  },
  autoPlayBtn: {
    padding: '10px 20px', color: '#8eb8d4',
    borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
  restartBtn: {
    padding: '8px 20px', background: 'transparent', color: '#4a7a9b',
    border: '1px solid #1e3a5f', borderRadius: 6, fontSize: 13, cursor: 'pointer',
  },
  waitingBox: {
    background: '#0a1f0a', border: '2px solid #00ff88', borderRadius: 8, padding: '14px 16px', textAlign: 'center',
  },
  waitingText: { fontSize: 14, color: '#00ff88', fontWeight: 600 },
  completeBox: { textAlign: 'center', padding: 8 },
  completeTitle: { fontSize: 18, fontWeight: 700, color: '#c8e6f8', marginBottom: 6 },
  completeStats: { fontSize: 13, color: '#8eb8d4', marginBottom: 12 },
  resultBtn: {
    padding: '14px 24px', background: 'linear-gradient(135deg, #003d7a, #004d2a)',
    color: '#00ff88', border: '1px solid #00ff88', borderRadius: 8,
    fontSize: 16, fontWeight: 700, cursor: 'pointer', width: '100%', fontFamily: 'monospace',
  },
  infoPanel: {
    background: '#0d1b2a', borderRadius: 8, padding: '12px 16px',
    display: 'flex', gap: 16, border: '1px solid #1e3a5f',
  },
  infoPanelRow: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 },
  infoLabel: { fontSize: 11, color: '#4a7a9b' },
  infoValue: { fontSize: 16, fontWeight: 700, color: '#c8e6f8' },
};
