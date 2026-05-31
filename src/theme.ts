// ─────────────────────────────────────────────────────────────
//  OKIRES 2026 — shared design tokens (Tactical Defense Console)
// ─────────────────────────────────────────────────────────────

export const C = {
  bgDeep: '#060d18',
  bgPanel: '#0d1b2a',
  bgCard: '#112233',
  bgCardHi: '#16304a',
  border: '#1e3a5f',
  borderHi: '#2a6496',
  green: '#00ff88',
  amber: '#ffb300',
  red: '#ff3b3b',
  blue: '#38bdf8',
  violet: '#a78bfa',
  dim: '#4a7a9b',
  body: '#8eb8d4',
  bright: '#c8e6f8',
  white: '#e8f4ff',
} as const;

export const FONT = {
  display: "'Chakra Petch', 'Noto Sans JP', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
  jp: "'Noto Sans JP', sans-serif",
} as const;

// area accent colors (kept consistent across all screens)
export const AREA_COLOR = {
  yonaguni: '#ff5a5a',
  taketomi: '#ff9e3d',
  ishigaki: '#38bdf8',
  miyako: '#00ff88',
} as const;
