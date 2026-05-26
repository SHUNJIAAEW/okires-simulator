import React from 'react';
import type { GameState, AreaId } from '../types';
import { getEffectiveActions } from '../constants';

interface Props {
  state: GameState;
}

const AREA_COLORS: Record<AreaId, string> = {
  yonaguni: '#ef4444',
  taketomi: '#f97316',
  ishigaki: '#3b82f6',
  miyako: '#22c55e',
};

const AREA_LIGHT_COLORS: Record<AreaId, string> = {
  yonaguni: '#fee2e2',
  taketomi: '#ffedd5',
  ishigaki: '#dbeafe',
  miyako: '#dcfce7',
};

function PieceDisplay({ count, color, label, size = 'normal' }: { count: number; color: string; label: string; size?: 'small' | 'normal' }) {
  if (count <= 0) return null;
  const dotSize = size === 'small' ? 12 : 14;
  const maxDots = 12;
  const dots = Math.min(Math.ceil(count), maxDots);
  const overflow = count > maxDots;

  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>{label}: {count}コマ</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        {Array.from({ length: dots }, (_, i) => (
          <div key={i} style={{
            width: dotSize, height: dotSize, borderRadius: '50%',
            background: color, border: '1px solid rgba(0,0,0,0.2)',
            flexShrink: 0,
          }} />
        ))}
        {overflow && (
          <div style={{ fontSize: 10, color: '#94a3b8', display: 'flex', alignItems: 'center' }}>
            +{(count - maxDots)}
          </div>
        )}
      </div>
    </div>
  );
}

function AreaPanel({ areaId, state }: { areaId: AreaId; state: GameState }) {
  const area = state.areas[areaId];
  const total = area.residents + area.tourists + area.vulnerable;
  const staging = area.stagingPort + area.stagingAirport;
  const effActions = getEffectiveActions(area.baseActions, area.fatigue);
  const color = AREA_COLORS[areaId];
  const bgColor = AREA_LIGHT_COLORS[areaId];
  const isCritical = area.fatigue >= area.baseActions;

  return (
    <div style={{
      background: bgColor,
      border: `2px solid ${isCritical ? '#dc2626' : color}`,
      borderRadius: 10,
      padding: 12,
      position: 'relative',
    }}>
      {isCritical && (
        <div style={{
          position: 'absolute', top: -10, right: 8,
          background: '#dc2626', color: '#fff', fontSize: 11, fontWeight: 700,
          padding: '2px 8px', borderRadius: 10,
        }}>避難不能危機</div>
      )}
      <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b', marginBottom: 8 }}>
        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: color, marginRight: 6 }} />
        {area.name}
      </div>

      {/* 疲労バー */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginBottom: 2 }}>
          <span>疲労度: {area.fatigue >= 0 ? '+' : ''}{area.fatigue.toFixed(1)}</span>
          <span>手数: {effActions}/{area.baseActions}</span>
        </div>
        <div style={{ background: '#e2e8f0', borderRadius: 4, height: 6, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${Math.min(100, (effActions / area.baseActions) * 100)}%`,
            background: effActions <= 1 ? '#dc2626' : effActions <= 2 ? '#f97316' : '#22c55e',
            transition: 'width 0.3s',
            borderRadius: 4,
          }} />
        </div>
      </div>

      {/* コマ表示 */}
      <div style={{ minHeight: 50 }}>
        {area.residents > 0 && (
          <PieceDisplay count={area.residents} color="white" label="住民(白)" />
        )}
        {area.tourists > 0 && (
          <PieceDisplay count={area.tourists} color="#fde047" label="観光客(黄)" />
        )}
        {area.vulnerable > 0 && (
          <PieceDisplay count={area.vulnerable} color="#60a5fa" label="要援護者(青)" />
        )}
        {staging > 0 && (
          <PieceDisplay count={staging} color="#d1d5db" label="港/空港待機" size="small" />
        )}
        {total === 0 && staging === 0 && (
          <div style={{ color: '#22c55e', fontWeight: 700, fontSize: 13, textAlign: 'center', padding: '8px 0' }}>
            ✓ 避難完了
          </div>
        )}
      </div>

      {/* 合計 */}
      <div style={{
        borderTop: `1px solid ${color}40`, marginTop: 8, paddingTop: 8,
        display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600
      }}>
        <span>残: {total + staging}コマ</span>
        <span>{(total + staging) * 1000}人</span>
      </div>
    </div>
  );
}

export function IslandMap({ state }: Props) {
  const { areas, military, weather, transport, evacuated, dead, month } = state;

  const weatherIcon = weather.condition === 'sunny' ? '☀️' :
    weather.condition === 'cloudy' ? '☁️' :
    weather.condition === 'rain' ? '🌧️' : '⛈️';
  const windStr = ['西', '北西', '北東', '東', '南東', '南西'][weather.windDirectionIndex - 1];
  const isStrong = (month >= 3 && month <= 11) ? weather.windSpeedIndex === 8 : (weather.windSpeedIndex === 4 || weather.windSpeedIndex === 8);

  return (
    <div style={styles.container}>
      {/* ヘッダーステータス */}
      <div style={styles.statusBar}>
        <div style={styles.statusItem}>
          <span style={styles.statusLabel}>天候</span>
          <span style={styles.statusValue}>{weatherIcon} {weather.condition === 'heavy-rain' ? '大雨' : weather.condition === 'rain' ? '雨' : weather.condition === 'cloudy' ? '曇' : '晴'}</span>
        </div>
        <div style={styles.statusItem}>
          <span style={styles.statusLabel}>風</span>
          <span style={{ ...styles.statusValue, color: isStrong ? '#dc2626' : '#22c55e' }}>
            {isStrong ? '💨強風' : '微風'}({windStr})
          </span>
        </div>
        <div style={styles.statusItem}>
          <span style={styles.statusLabel}>中国海軍</span>
          <span style={{ ...styles.statusValue, color: '#dc2626' }}>{military.chineseSea}/6</span>
        </div>
        <div style={styles.statusItem}>
          <span style={styles.statusLabel}>中国空軍</span>
          <span style={{ ...styles.statusValue, color: '#dc2626' }}>{military.chineseAir}/6</span>
        </div>
        <div style={styles.statusItem}>
          <span style={styles.statusLabel}>海上自衛隊</span>
          <span style={{ ...styles.statusValue, color: '#3b82f6' }}>{military.jsdfSea}</span>
        </div>
        <div style={styles.statusItem}>
          <span style={styles.statusLabel}>航空自衛隊</span>
          <span style={{ ...styles.statusValue, color: '#3b82f6' }}>{military.jsdfAir}</span>
        </div>
        <div style={styles.statusItem}>
          <span style={styles.statusLabel}>PAC3</span>
          <span style={styles.statusValue}>
            石垣{military.pac3Ishigaki ? '✓' : '×'} 宮古{military.pac3Miyako ? '✓' : '×'}
          </span>
        </div>
      </div>

      {/* SVGマップ */}
      <div style={styles.mapContainer}>
        <svg viewBox="0 0 800 300" style={styles.svg}>
          {/* 背景 - 海 */}
          <rect x="0" y="0" width="800" height="300" fill="#e0f2fe" rx="8" />

          {/* 本土への矢印 */}
          <text x="400" y="25" textAnchor="middle" fill="#475569" fontSize="12">日本本土（鹿児島・福岡）→ 避難完了</text>
          <line x1="100" y1="35" x2="700" y2="35" stroke="#3b82f6" strokeWidth="2" strokeDasharray="6,4" markerEnd="url(#arrow)" />

          {/* 矢印マーカー */}
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#3b82f6" />
            </marker>
            <marker id="arrowGray" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#94a3b8" />
            </marker>
          </defs>

          {/* 与那国島 */}
          <g transform="translate(60, 90)">
            <ellipse cx="40" cy="35" rx="38" ry="22" fill="#fee2e2" stroke="#ef4444" strokeWidth="2" />
            <text x="40" y="20" textAnchor="middle" fill="#991b1b" fontSize="10" fontWeight="bold">与那国島</text>
            <text x="40" y="50" textAnchor="middle" fill="#ef4444" fontSize="11" fontWeight="bold">
              {areas.yonaguni.residents + areas.yonaguni.tourists}コマ
            </text>
            {/* 空港 */}
            <rect x="10" y="60" width="60" height="14" fill="#fef2f2" stroke="#ef4444" strokeWidth="1" rx="3" />
            <text x="40" y="71" textAnchor="middle" fill="#991b1b" fontSize="9">与那国空港✈</text>
          </g>

          {/* 石垣→与那国の矢印 */}
          <line x1="148" y1="125" x2="208" y2="125" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4,3" markerEnd="url(#arrowGray)" />
          <text x="178" y="118" textAnchor="middle" fill="#94a3b8" fontSize="8">フェリー↔</text>

          {/* 竹富町エリア */}
          <g transform="translate(160, 160)">
            <ellipse cx="60" cy="45" rx="62" ry="35" fill="#ffedd5" stroke="#f97316" strokeWidth="2" />
            <text x="60" y="22" textAnchor="middle" fill="#9a3412" fontSize="10" fontWeight="bold">竹富町全島</text>
            <text x="60" y="36" textAnchor="middle" fill="#ea580c" fontSize="9">(西表・竹富・波照間等)</text>
            <text x="60" y="55" textAnchor="middle" fill="#f97316" fontSize="11" fontWeight="bold">
              {areas.taketomi.residents + areas.taketomi.tourists}コマ
            </text>
          </g>

          {/* 竹富→石垣の矢印 */}
          <line x1="284" y1="195" x2="340" y2="195" stroke="#f97316" strokeWidth="2" markerEnd="url(#arrow)" />
          <text x="312" y="188" textAnchor="middle" fill="#ea580c" fontSize="8">島間フェリー</text>
          <text x="312" y="208" textAnchor="middle" fill="#ea580c" fontSize="8">最大11コマ/日</text>

          {/* 石垣島 */}
          <g transform="translate(330, 100)">
            <ellipse cx="65" cy="55" rx="65" ry="45" fill="#dbeafe" stroke="#3b82f6" strokeWidth="2.5" />
            <text x="65" y="30" textAnchor="middle" fill="#1e3a8a" fontSize="11" fontWeight="bold">石垣島</text>
            <text x="65" y="50" textAnchor="middle" fill="#3b82f6" fontSize="13" fontWeight="bold">
              {areas.ishigaki.residents + areas.ishigaki.tourists + areas.ishigaki.vulnerable}コマ
            </text>
            {areas.ishigaki.stagingPort > 0 && (
              <text x="65" y="68" textAnchor="middle" fill="#1d4ed8" fontSize="9">
                (港待機:{areas.ishigaki.stagingPort}コマ)
              </text>
            )}
            {/* 要援護者 */}
            {areas.ishigaki.vulnerable > 0 && (
              <text x="65" y="80" textAnchor="middle" fill="#60a5fa" fontSize="9">
                青:{areas.ishigaki.vulnerable}コマ
              </text>
            )}
            {/* 空港・港 */}
            <rect x="5" y="97" width="120" height="12" fill="#eff6ff" stroke="#3b82f6" strokeWidth="1" rx="3" />
            <text x="65" y="106" textAnchor="middle" fill="#1e3a8a" fontSize="8">新石垣空港✈ / 石垣港⚓</text>
            {/* PAC3 */}
            {military.pac3Ishigaki && (
              <text x="65" y="118" textAnchor="middle" fill="#7c3aed" fontSize="8" fontWeight="bold">🛡️PAC3配備済</text>
            )}
          </g>

          {/* 石垣→本土の矢印 */}
          <line x1="460" y1="130" x2="540" y2="60" stroke="#3b82f6" strokeWidth="2" markerEnd="url(#arrow)" />
          <text x="510" y="80" textAnchor="middle" fill="#1d4ed8" fontSize="9">空路✈海路⚓</text>

          {/* 宮古島・多良間 */}
          <g transform="translate(540, 100)">
            <ellipse cx="80" cy="60" rx="80" ry="50" fill="#dcfce7" stroke="#22c55e" strokeWidth="2.5" />
            <text x="80" y="30" textAnchor="middle" fill="#14532d" fontSize="11" fontWeight="bold">宮古島・多良間</text>
            <text x="80" y="50" textAnchor="middle" fill="#22c55e" fontSize="13" fontWeight="bold">
              {areas.miyako.residents + areas.miyako.tourists + areas.miyako.vulnerable}コマ
            </text>
            {areas.miyako.stagingPort > 0 && (
              <text x="80" y="68" textAnchor="middle" fill="#15803d" fontSize="9">
                (港待機:{areas.miyako.stagingPort}コマ)
              </text>
            )}
            {areas.miyako.vulnerable > 0 && (
              <text x="80" y="82" textAnchor="middle" fill="#60a5fa" fontSize="9">
                青:{areas.miyako.vulnerable}コマ
              </text>
            )}
            <rect x="5" y="108" width="150" height="12" fill="#f0fdf4" stroke="#22c55e" strokeWidth="1" rx="3" />
            <text x="80" y="117" textAnchor="middle" fill="#14532d" fontSize="8">宮古空港✈ / 下地島空港✈ / 平良港⚓</text>
            {military.pac3Miyako && (
              <text x="80" y="130" textAnchor="middle" fill="#7c3aed" fontSize="8" fontWeight="bold">🛡️PAC3配備済</text>
            )}
          </g>

          {/* 宮古→本土の矢印 */}
          <line x1="700" y1="140" x2="760" y2="70" stroke="#22c55e" strokeWidth="2" markerEnd="url(#arrow)" />
          <text x="745" y="95" textAnchor="middle" fill="#15803d" fontSize="9">本土へ</text>

          {/* 避難完了エリア */}
          <rect x="650" y="0" width="145" height="45" fill="#f0fdf4" stroke="#22c55e" strokeWidth="2" rx="6" />
          <text x="722" y="14" textAnchor="middle" fill="#15803d" fontSize="10" fontWeight="bold">✓ 避難完了</text>
          <text x="722" y="28" textAnchor="middle" fill="#22c55e" fontSize="13" fontWeight="bold">{evacuated}コマ</text>
          <text x="722" y="40" textAnchor="middle" fill="#64748b" fontSize="9">{evacuated * 1000}人</text>

          {/* 死亡エリア */}
          <rect x="0" y="250" width="120" height="40" fill="#fef2f2" stroke="#dc2626" strokeWidth="2" rx="6" />
          <text x="60" y="264" textAnchor="middle" fill="#991b1b" fontSize="10" fontWeight="bold">💀 死亡コマ</text>
          <text x="60" y="282" textAnchor="middle" fill="#dc2626" fontSize="13" fontWeight="bold">{dead}コマ</text>

          {/* 民間輸送禁止マーカー */}
          {transport.civilianAirDisabled && (
            <>
              <rect x="290" y="250" width="130" height="40" fill="#fef2f2" stroke="#dc2626" strokeWidth="2" rx="6" />
              <text x="355" y="265" textAnchor="middle" fill="#991b1b" fontSize="10" fontWeight="bold">⚠️ 民間航空</text>
              <text x="355" y="280" textAnchor="middle" fill="#dc2626" fontSize="10">使用不能</text>
            </>
          )}
          {transport.civilianShipDisabled && (
            <>
              <rect x="440" y="250" width="120" height="40" fill="#fef2f2" stroke="#dc2626" strokeWidth="2" rx="6" />
              <text x="500" y="265" textAnchor="middle" fill="#991b1b" fontSize="10" fontWeight="bold">⚠️ 民間船舶</text>
              <text x="500" y="280" textAnchor="middle" fill="#dc2626" fontSize="10">使用不能</text>
            </>
          )}
        </svg>
      </div>

      {/* エリアカード (4列) */}
      <div style={styles.areaGrid}>
        {(['yonaguni', 'taketomi', 'ishigaki', 'miyako'] as AreaId[]).map(id => (
          <AreaPanel key={id} areaId={id} state={state} />
        ))}
      </div>

      {/* 輸送資産 */}
      <div style={styles.transportPanel}>
        <h3 style={styles.transportTitle}>輸送アセット</h3>
        <div style={styles.transportGrid}>
          <TransportItem label="海保輸送船" value={`本日残${state.transport.coastGuardToday}便`} color="#0369a1" />
          <TransportItem label="海自輸送艦" value={`残${state.transport.jmsdfRemaining}回`} color="#1e40af" />
          <TransportItem label="空自輸送機" value={`残${state.transport.jasdfRemaining}回`} color="#5b21b6" />
          <TransportItem label="陸自ヘリ" value={`残${state.transport.jgsdfRemaining}回`} color="#854d0e" />
        </div>
      </div>
    </div>
  );
}

function TransportItem({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: '#f8fafc', border: `1px solid ${color}40`, borderRadius: 6, padding: '8px 12px' }}>
      <div style={{ fontSize: 11, color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', gap: 12 },
  statusBar: {
    display: 'flex', flexWrap: 'wrap', gap: 8,
    background: '#1e293b', borderRadius: 8, padding: '10px 16px',
  },
  statusItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 70 },
  statusLabel: { fontSize: 10, color: '#94a3b8' },
  statusValue: { fontSize: 13, fontWeight: 700, color: '#f1f5f9' },
  mapContainer: { background: '#e0f2fe', borderRadius: 10, overflow: 'hidden', border: '2px solid #7dd3fc' },
  svg: { width: '100%', height: 'auto' },
  areaGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 },
  transportPanel: { background: '#f8fafc', borderRadius: 8, padding: 12, border: '1px solid #e2e8f0' },
  transportTitle: { fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 },
  transportGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 },
};
