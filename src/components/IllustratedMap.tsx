// IllustratedMap.tsx — 先島諸島の実地図（国土地理院 地理院タイル）上にコマ・施設・避難トークンを重ねるマップ
// 背景は地理院タイル（淡色地図／写真）を SVG <image> として並べる。緯度経度→SVG座標は project() に一本化。
// 自動再生中はコマが島→ハブ→本土（地図範囲外＝上端の方向表示）へ移動し、本土に蓄積して消えない。

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AreaId, AreaState, InfraState, DayLog, TransportState, AirRouteKey, ShipRouteKey } from '../types';
import { FONT } from '../theme';
import { SUB_ISLANDS, apportionArea } from '../islands';
import { facilityMark as facilityMarkShared, type FacilityDef } from '../facilities';

interface Props {
  areas: Record<AreaId, AreaState>;
  infra?: InfraState;
  transport?: TransportState;   // 路線別の恒久停止（💥表示）
  closedToday?: string[];       // 当日限りの使用不能施設（🚫表示）
  weatherClosed?: string[];     // 悪天候で使用不能な施設: '空路キー:理由' / 'sea:理由'（rain=⛈️ 大雨 / wind=💨 強風）
  prepLevel?: number;           // 波照間空港はLv4以上でのみ使用（未満は❌表示）
  evacuated?: number;
  dead?: number;
  dayLogs?: DayLog[];
}

// ─────────────────────────────────────────────────────────────
//  投影（Webメルカトル）: 表示範囲は与那国島〜宮古島。タイル・施設・コマ・ラベルすべて project() で配置する
// ─────────────────────────────────────────────────────────────
const BOUNDS = { west: 122.8, east: 125.6, north: 25.3, south: 23.9 };
const VW = 320;
const mercY = (lat: number) => (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180) / Math.PI;
const SCALE = VW / (BOUNDS.east - BOUNDS.west); // svg単位 / 経度1°
const VH = (mercY(BOUNDS.north) - mercY(BOUNDS.south)) * SCALE; // ≈ 176.0（islands.ts の blob はこの 320×176 座標）

/** 緯度経度 → SVG座標（viewBox 0 0 VW VH） */
function project(lat: number, lng: number): { x: number; y: number } {
  return { x: (lng - BOUNDS.west) * SCALE, y: (mercY(BOUNDS.north) - mercY(lat)) * SCALE };
}

// svg座標→%（HTMLオーバーレイ用）
const px = (x: number) => `${(x / VW) * 100}%`;
const py = (y: number) => `${(y / VH) * 100}%`;
// 文字・アイコンの大きさは地図幅に比例させる（基準=地図幅960pxのときの px 値）。狭い画面でも重なり方が変わらない
const cq = (pxAt960: number) => `${(pxAt960 / 9.6).toFixed(3)}cqw`;

// ─────────────────────────────────────────────────────────────
//  地理院タイル
// ─────────────────────────────────────────────────────────────
type Layer = 'pale' | 'photo';
const TILE_Z = 10;
const TILE_URL: Record<Layer, (z: number, x: number, y: number) => string> = {
  pale: (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/pale/${z}/${x}/${y}.png`,
  photo: (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${z}/${x}/${y}.jpg`,
};
const SEA_COLOR: Record<Layer, string> = { pale: '#b5cdf7', photo: '#0f2f4f' }; // タイル未取得（オフライン等）でも海色は残す

const PALE_FILTER = 'saturate(1.45) contrast(1.12)'; // 淡色地図は陸（白）と海（淡青）の差が小さいので少し強める

interface Tile { key: string; tx: number; ty: number; x: number; y: number; w: number; h: number }
const TILES: Tile[] = (() => {
  const n = 2 ** TILE_Z;
  const lngToX = (lng: number) => ((lng + 180) / 360) * n;
  const latToY = (lat: number) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  const xToLng = (x: number) => (x / n) * 360 - 180;
  const yToLat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const out: Tile[] = [];
  for (let ty = Math.floor(latToY(BOUNDS.north)); ty <= Math.floor(latToY(BOUNDS.south)); ty++) {
    for (let tx = Math.floor(lngToX(BOUNDS.west)); tx <= Math.floor(lngToX(BOUNDS.east)); tx++) {
      const a = project(yToLat(ty), xToLng(tx));
      const b = project(yToLat(ty + 1), xToLng(tx + 1));
      // 継ぎ目の白線防止に 0.04 だけ重ねる
      out.push({ key: `${tx}-${ty}`, tx, ty, x: a.x, y: a.y, w: b.x - a.x + 0.04, h: b.y - a.y + 0.04 });
    }
  }
  return out;
})();

// タイル未取得時の簡易陸地（実位置の楕円。タイルが読めれば下に隠れる）
const FALLBACK_LAND: { lat: number; lng: number; rx: number; ry: number }[] = [
  { lat: 24.455, lng: 122.99, rx: 6.2, ry: 2.4 },   // 与那国島
  { lat: 24.335, lng: 123.81, rx: 14, ry: 11 },     // 西表島
  { lat: 24.4, lng: 124.17, rx: 11, ry: 10 },       // 石垣島（南部）
  { lat: 24.52, lng: 124.28, rx: 5, ry: 9 },        // 石垣島（平久保半島）
  { lat: 24.058, lng: 123.785, rx: 3, ry: 1.8 },    // 波照間島
  { lat: 24.34, lng: 123.98, rx: 2.2, ry: 1.8 },    // 小浜島
  { lat: 24.327, lng: 124.088, rx: 1.4, ry: 1.6 },  // 竹富島
  { lat: 24.24, lng: 124.0, rx: 1.8, ry: 2 },       // 黒島
  { lat: 24.655, lng: 124.7, rx: 3, ry: 3 },        // 多良間島
  { lat: 24.79, lng: 125.33, rx: 10, ry: 11 },      // 宮古島
  { lat: 24.83, lng: 125.19, rx: 4, ry: 3.4 },      // 伊良部島・下地島
];

// ─────────────────────────────────────────────────────────────
//  島名ラベル（アンカー＝実位置。dx/dy は svg単位のずらし量）
// ─────────────────────────────────────────────────────────────
const ISLAND_LABELS: { lat: number; lng: number; dx?: number; dy?: number; name: string; big?: boolean }[] = [
  { lat: 24.455, lng: 122.99, dx: 2, dy: -10.6, name: '与那国島', big: true },
  { lat: 24.33, lng: 123.8, dx: 3.2, dy: 3, name: '西表島', big: true },
  { lat: 24.472, lng: 123.82, dy: -3.6, name: '鳩間島' },
  { lat: 24.336, lng: 123.729, dx: -4, dy: -3.4, name: '船浮' },
  { lat: 24.34, lng: 123.975, dx: -1.5, dy: -4.3, name: '小浜島' },
  { lat: 24.327, lng: 124.088, dx: -0.8, dy: -3.6, name: '竹富島' },
  { lat: 24.24, lng: 124.0, dy: 4.2, name: '黒島' },
  { lat: 24.058, lng: 123.785, dy: 4.6, name: '波照間島' },
  { lat: 24.42, lng: 124.19, dx: 0.5, dy: -4, name: '石垣島', big: true },
  { lat: 24.79, lng: 125.32, dx: 17.5, dy: -6, name: '宮古島', big: true },
  { lat: 24.83, lng: 125.2, dx: 0.8, dy: -6.2, name: '伊良部島' },
  { lat: 24.82, lng: 125.15, dx: -7.6, dy: 5.4, name: '下地島' },
  { lat: 24.93, lng: 125.245, dx: -3.4, dy: -3.6, name: '池間島' },
  { lat: 24.723, lng: 125.25, dx: -4.5, dy: 3.9, name: '来間島' },
  { lat: 24.655, lng: 124.7, dy: -7.2, name: '多良間島' },
];

// ─────────────────────────────────────────────────────────────
//  施設（空港🟡 / 海港🔵）: アイコンは実際の緯度経度に置き、名前だけ lab の向きへ逃がす
// ─────────────────────────────────────────────────────────────
type Fac = { lat: number; lng: number; kind: 'air' | 'sea'; name: string; lab: 't' | 'b' | 'l' | 'r'; air?: AirRouteKey; ship?: ShipRouteKey; infra?: keyof InfraState };
const FACILITIES: Fac[] = [
  { lat: 24.4669, lng: 122.9779, kind: 'air', name: '与那国空港', lab: 't', air: 'yonaguni', infra: 'yonagunAirport' },
  { lat: 24.4525, lng: 122.9445, kind: 'sea', name: '久部良港', lab: 'l', ship: 'kubura', infra: 'kuburaPort' },
  { lat: 24.418, lng: 123.801, kind: 'sea', name: '上原港', lab: 'l' },
  { lat: 24.337, lng: 123.73, kind: 'sea', name: '船浮港', lab: 'r' },
  { lat: 24.275, lng: 123.8815, kind: 'sea', name: '大原港', lab: 'b' },
  { lat: 24.0589, lng: 123.8056, kind: 'air', name: '波照間空港', lab: 'r', air: 'hateruma', infra: 'haterumaAirport' },
  { lat: 24.0683, lng: 123.7672, kind: 'sea', name: '波照間港', lab: 'l' },
  { lat: 24.346, lng: 123.9935, kind: 'sea', name: '小浜港', lab: 'b' },
  { lat: 24.3964, lng: 124.245, kind: 'air', name: '新石垣空港', lab: 'r', air: 'shinIshigaki', infra: 'shinIshigakiAirport' },
  { lat: 24.3375, lng: 124.156, kind: 'sea', name: '石垣港', lab: 'r', ship: 'ishigakiPort', infra: 'ishigakiPort' },
  { lat: 24.7828, lng: 125.295, kind: 'air', name: '宮古空港', lab: 'r', air: 'miyako', infra: 'miyakoAirport' },
  { lat: 24.805, lng: 125.277, kind: 'sea', name: '平良港', lab: 'r', ship: 'hiraraPort', infra: 'hiraraPort' },
  { lat: 24.8267, lng: 125.1447, kind: 'air', name: '下地島空港', lab: 'l', air: 'shimoji', infra: 'shimojiAirport' },
  { lat: 24.6539, lng: 124.6753, kind: 'air', name: '多良間空港', lab: 'l', infra: 'taramaAirport' },
  { lat: 24.6755, lng: 124.7035, kind: 'sea', name: '多良間港', lab: 'r' }, // 多良間港（前泊地区）
];

// ── 橋（宮古衛星島）: a=宮古島側 / b=離島側 の実位置。ラベルは (ldx, ldy) だけずらす ──
const BRIDGES: { key: keyof InfraState; name: string; a: [number, number]; b: [number, number]; ldx: number; ldy: number }[] = [
  { key: 'bridgeIkema', name: '池間大橋', a: [24.9155, 125.2657], b: [24.924, 125.255], ldx: 7.5, ldy: 1.2 },
  { key: 'bridgeIrabu', name: '伊良部大橋', a: [24.8015, 125.259], b: [24.8103, 125.2183], ldx: -1.5, ldy: 3.9 },
  { key: 'bridgeKurima', name: '来間大橋', a: [24.7305, 125.271], b: [24.7217, 125.2565], ldx: 7.5, ldy: 3.6 },
];

// ── 本土（避難先）は地図範囲外 → 上端に方向表示として置く（トークンの行き先） ──
const DESTS: { id: string; x: number; y: number; label: string }[] = [
  { id: 'naha', x: 44, y: 8, label: '↗ 那覇経由・福岡空港' },
  { id: 'fukuoka', x: 178, y: 8, label: '↗ 福岡空港' },
  { id: 'kagoshima', x: 292, y: 8, label: '↗ 鹿児島港・空港' },
];

// 島中心（トークン出発点）
const ISLAND_CENTER: Record<AreaId, { x: number; y: number }> = {
  yonaguni: project(24.455, 122.99),
  taketomi: project(24.33, 123.8),
  ishigaki: project(24.4, 124.19),
  miyako: project(24.79, 125.31),
};
const HUB = ISLAND_CENTER.ishigaki;
// 本土到着トークンの積み上げ中心（方向表示のすぐ下）
const MAINLAND_DEST: Record<AreaId, { x: number; y: number }> = {
  yonaguni: { x: 44, y: 25 },
  taketomi: { x: 178, y: 25 },
  ishigaki: { x: 178, y: 25 },
  miyako: { x: 292, y: 25 },
};

// ── コマ置き場（トレー）: コマの多い島は実縮尺の島内に収まらないため、近くの海上に並べて島へ引き出し線を引く ──
// トレーの範囲は islands.ts の blob（cx±rx, cy±ry）。anchor は引き出し線の島側の端（実位置）
const TRAYS: Record<string, { label: string; anchor: { x: number; y: number } }> = {
  iriomote: { label: '西表島のコマ', anchor: project(24.4, 123.71) },
  ishigaki: { label: '石垣島のコマ', anchor: project(24.455, 124.14) },
  miyako: { label: '宮古島のコマ', anchor: project(24.735, 125.34) },
};
const TRAY_PAD = 1.6;

// 残コマ数バッジの位置（svg座標）
const BADGE_POS: Record<AreaId, { x: number; y: number; name: string }> = {
  yonaguni: { x: 22, y: 118.6, name: '与那国' },
  taketomi: { x: 127, y: 143.5, name: '竹富町' },
  ishigaki: { x: 143, y: 49.1, name: '石垣' },
  miyako: { x: 302, y: 85.6, name: '宮古' },
};

interface Tok { id: string; x0: number; y0: number; x1: number; y1: number; kind: 'r' | 'v'; delay: number; last: boolean }
const TCOLOR = { r: '#2f80ed', v: '#eb5757' } as const;

// 島別のコマ配置領域・按分ウェイト・按分ロジックは src/islands.ts（日報PDFの島別残存表と共通）

// コマ種別の色
const KOMA_COLOR: Record<string, string> = {
  r: '#2f80ed', // 住民
  h: '#2f80ed', // 住民 半コマ（孤立集落の 0.5コマ端数。小さく描く）
  hv: '#eb5757', // 要援護者 半コマ（多良間🔴の 0.5コマ端数）
  t: '#e0a800', // 観光客
  v: '#eb5757', // 要援護者
  s: '#1b8a4b', // 待機
};

interface Cell { x: number; y: number; size: number; kind: string }

// 人コマの統一サイズ（svg座標単位）。全島・全種別で共通。
const KOMA_SIZE = 4.2;
const STEP_X = 4.5, STEP_Y = 5.7; // コマの基本間隔（幅 4.2 × 高さ 5.25 が重ならない間隔）

// 人型シルエット（頭＋胴）。color で塗り分け、白フチで地図上でも視認可能に。
function PersonIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 30" width="100%" height="100%" style={{ display: 'block', overflow: 'visible' }}>
      <g fill={color} stroke="#ffffff" strokeWidth={1.8} strokeLinejoin="round">
        <circle cx="12" cy="6" r="5" />
        <path d="M12 12c-5 0-8 4-8 10v6h16v-6c0-6-3-10-8-10z" />
      </g>
    </svg>
  );
}

// コマ配置領域（blob）の中にコマを格子状に並べる
function buildCells(area: AreaState, blob: { cx: number; cy: number; rx: number; ry: number }, halfKoma = 0, vulnHalfKoma = 0): Cell[] {
  // 小数（死亡0.5コマ等）や負値で Array() が落ちないよう整数化
  const ci = (x: number) => Math.max(0, Math.round(x));
  const kinds: string[] = [
    ...Array(ci(area.residents)).fill('r'),
    ...Array(ci(area.tourists)).fill('t'),
    ...Array(ci(area.vulnerable)).fill('v'),
    ...Array(ci(area.stagingPort + (area.stagingVulnerable ?? 0))).fill('s'),
    ...Array(ci(halfKoma)).fill('h'),
    ...Array(ci(vulnHalfKoma)).fill('hv'),
  ];
  const n = kinds.length;
  if (n === 0) return [];
  // 種別を散らす（初期配置をランダムに見せる：決定的シャッフル）
  for (let i = n - 1; i > 0; i--) {
    const j = (i * 7 + 3) % (i + 1);
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  // 領域に基本間隔で収まらない数になったら、コマ自体を縮小して（下限 60%）重ならない格子にする。
  // それでも入らない場合は領域の外（上下）へ行を足す＝コマ同士は常に重ならない
  const w = blob.rx * 2, h = blob.ry * 2;
  const fit = (k: number) => Math.max(1, Math.floor((w + 0.01) / (STEP_X * k))) * Math.max(1, Math.floor((h + 0.01) / (STEP_Y * k)));
  let k = 1;
  while (k > 0.6 && fit(k) < n) k = Math.max(0.6, k - 0.05);
  const stepX = STEP_X * k, stepY = STEP_Y * k;
  const cols = Math.min(n, Math.max(1, Math.floor((w + 0.01) / stepX)));
  const rows = Math.ceil(n / cols);
  const cells: Cell[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols; // 最終行は中央寄せ
    cells.push({
      x: blob.cx + (col - (inRow - 1) / 2) * stepX,
      y: blob.cy + (row - (rows - 1) / 2) * stepY,
      size: (kinds[i] === 'h' || kinds[i] === 'hv' ? KOMA_SIZE * 0.7 : KOMA_SIZE) * k, kind: kinds[i],
    });
  }
  return cells;
}

function totalKoma(a: AreaState): number {
  return a.residents + a.tourists + a.vulnerable + a.stagingPort + (a.stagingVulnerable ?? 0) + (a.isolatedPending ?? 0);
}

const LABEL_POS: Record<Fac['lab'], React.CSSProperties> = {
  t: { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: '0.05em' },
  b: { top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: '0.05em' },
  l: { right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: '0.25em' },
  r: { left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: '0.25em' },
};

export function IllustratedMap({ areas, infra, transport, closedToday = [], weatherClosed = [], prepLevel = 6, evacuated = 0, dead = 0, dayLogs }: Props) {
  const [layer, setLayer] = useState<Layer>('pale');
  // 狭い画面では地図を横スクロールにする（文字が潰れないよう最小幅を確保）。初期位置は中央付近（石垣島）
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let centered = false;
    const ro = new ResizeObserver(() => {
      const over = el.scrollWidth - el.clientWidth;
      setScrollable(over > 1);
      if (over > 1 && !centered) { centered = true; el.scrollLeft = over * 0.42; }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 施設の使用可否マーク（facilities.ts と共通。日報PDFの主要インフラ状況表と同じ判定）:
  // 💥=恒久使用不能（破壊/撃墜・撃沈/運航拒否） > ❌=Lv不足 > 🚫=当日限り使用不能 > ⛈️/💨=悪天候
  const facilityMark = (f: Fac): '💥' | '🚫' | '❌' | '⛈️' | '💨' | null => {
    const def: FacilityDef = {
      key: f.name, name: f.name, kind: f.kind, air: f.air, ship: f.ship, infra: f.infra,
      wxKey: f.kind === 'sea' ? 'sea' : (f.air ?? (f.name === '多良間空港' ? 'tarama' : undefined)),
      minPrepLevel: f.air === 'hateruma' ? 4 : undefined,
      needsInfra: f.air === 'shimoji' ? 'bridgeIrabu' : undefined, // 伊良部大橋が落ちると下地島空港は使えない
    };
    return facilityMarkShared(def, { infra, transport, closedToday, weatherClosed, prepLevel });
  };
  // 全日程の避難実績からトークンを生成。本土到着分は蓄積（消えない）。最新日のみアニメ、過去日は到達点で静止。
  // 中継ハブ（石垣/宮古）到着は「その日だけ」表示する：到着後は島の緑（待機）コマとして既に描画されるため、
  // 蓄積させると避難完了後も青●赤●がハブに残って見える二重表示になる。
  const tokens = useMemo<Tok[]>(() => {
    const out: Tok[] = [];
    if (!dayLogs || dayLogs.length === 0) return out;
    const lastDay = dayLogs[dayLogs.length - 1].day;
    const pileCount: Record<string, number> = {};
    dayLogs.forEach(log => {
      log.evacuations.forEach((mv, i) => {
        const from = ISLAND_CENTER[mv.from];
        if (!from) return;
        const isHub = mv.to === '石垣島' || mv.to === '宮古島';
        if (isHub && log.day !== lastDay) return; // ハブ到着は当日のみ（蓄積しない）
        const hubPos = mv.to === '宮古島' ? ISLAND_CENTER.miyako : HUB;
        const destBase = isHub ? hubPos : MAINLAND_DEST[mv.from];
        const destKey = isHub ? `hub-${mv.to}` : (MAINLAND_DEST[mv.from] === MAINLAND_DEST.miyako ? 'kg' : 'main') + mv.from;
        const n = Math.max(1, Math.min(mv.count, 6));
        for (let k = 0; k < n; k++) {
          const c = (pileCount[destKey] = (pileCount[destKey] ?? 0) + 1);
          // 到達点で格子状にばらけて積み上がる
          const col = c % 6, row = Math.floor(c / 6) % 6;
          const ox = (col - 2.5) * 3.3;
          const oy = (row - 2.5) * 3.3;
          out.push({
            id: `${log.day}-${i}-${k}`,
            x0: from.x, y0: from.y,
            x1: destBase.x + ox, y1: destBase.y + oy,
            kind: mv.isVulnerable ? 'v' : 'r',
            delay: i * 70 + k * 50,
            last: log.day === lastDay,
          });
        }
      });
    });
    return out;
  }, [dayLogs]);

  // 各島のコマ配置。按分は islands.ts の apportionArea（鳩間・船浮・多良間は isolatedPendingBy の実数、他は人口比按分）
  const cellsByArea = useMemo(() => {
    const out: { id: string; cells: Cell[] }[] = [];
    (Object.keys(SUB_ISLANDS) as AreaId[]).forEach(id => {
      const a = areas[id];
      const subs = SUB_ISLANDS[id];
      const counts = apportionArea(a, subs);
      subs.forEach((s, si) => {
        const c = counts[si];
        const subArea: AreaState = {
          ...a, residents: c.res, tourists: c.tou, vulnerable: c.vul, stagingPort: c.stg, stagingVulnerable: 0,
          isolatedPending: 0, isolatedPendingBy: undefined,
        };
        out.push({ id: `${id}-${si}`, cells: buildCells(subArea, s.blob, c.half ?? 0, c.vulnHalf ?? 0) });
      });
    });
    return out;
  }, [areas]);

  // コマ置き場（トレー）の矩形と引き出し線
  const trays = useMemo(() => {
    const out: { key: string; label: string; x: number; y: number; w: number; h: number; lx: number; ly: number; ax: number; ay: number }[] = [];
    (Object.keys(SUB_ISLANDS) as AreaId[]).forEach(id => SUB_ISLANDS[id].forEach(s => {
      const t = TRAYS[s.key];
      if (!t) return;
      const x = s.blob.cx - s.blob.rx - TRAY_PAD, y = s.blob.cy - s.blob.ry - TRAY_PAD;
      const w = (s.blob.rx + TRAY_PAD) * 2, h = (s.blob.ry + TRAY_PAD) * 2;
      // 引き出し線のトレー側の端＝島側アンカーに最も近いトレー外周の点
      const lx = Math.max(x, Math.min(x + w, t.anchor.x)), ly = Math.max(y, Math.min(y + h, t.anchor.y));
      out.push({ key: s.key, label: t.label, x, y, w, h, lx, ly, ax: t.anchor.x, ay: t.anchor.y });
    }));
    return out;
  }, []);

  const photo = layer === 'photo';

  return (
    <div style={styles.frame}>
      <div style={styles.titleBar}>
        {/* 背景の切替（地図／写真） */}
        <div style={styles.layerToggle} role="group" aria-label="背景地図の切替">
          {(['pale', 'photo'] as Layer[]).map(l => (
            <button key={l} type="button" onClick={() => setLayer(l)} aria-pressed={layer === l}
              style={{ ...styles.layerBtn, ...(layer === l ? styles.layerBtnOn : null) }}>
              {l === 'pale' ? '地図' : '写真'}
            </button>
          ))}
        </div>
        {scrollable && <span style={styles.scrollHint}>↔ 横にスクロール</span>}
        <span style={styles.liveBadges}>
          <span style={{ ...styles.liveBadge, color: '#1b8a4b' }}>避難 {evacuated}</span>
          <span style={{ ...styles.liveBadge, color: '#c0392b' }}>死亡 {dead}</span>
        </span>
      </div>

      <div ref={scrollRef} style={styles.scroll}>
        <div style={styles.stage}>
          {/* 実地図（地理院タイル）＋航路・橋・コマ置き場 */}
          <svg viewBox={`0 0 ${VW} ${VH}`} style={styles.svg}>
            <defs>
              <marker id="amk" markerUnits="userSpaceOnUse" markerWidth="2.6" markerHeight="2.6" refX="1.8" refY="1.3" orient="auto">
                <path d="M0 0 L2.6 1.3 L0 2.6 Z" fill="#d9601a" />
              </marker>
            </defs>

            {/* 海（タイルが読めなくても真っ白にしない） */}
            <rect x="0" y="0" width={VW} height={VH} fill={SEA_COLOR[layer]} />
            <g fill={photo ? '#3f5f3a' : '#f3f1e6'} stroke={photo ? '#2c4428' : '#b8b39b'} strokeWidth="0.3">
              {FALLBACK_LAND.map((l, i) => {
                const p = project(l.lat, l.lng);
                return <ellipse key={i} cx={p.x} cy={p.y} rx={l.rx} ry={l.ry} />;
              })}
            </g>

            {/* 地理院タイル（z=10）。読み込み失敗したタイルは非表示にして海色を見せる */}
            <g key={layer} style={photo ? undefined : { filter: PALE_FILTER }}>
              {TILES.map(t => (
                <image key={t.key} href={TILE_URL[layer](TILE_Z, t.tx, t.ty)} x={t.x} y={t.y} width={t.w} height={t.h}
                  preserveAspectRatio="none"
                  onError={e => { e.currentTarget.style.display = 'none'; }} />
              ))}
            </g>

            {/* 航路（流れる点線で移動方向を表示） */}
            <g className="route-flow" stroke="#d9601a" strokeOpacity={0.75} strokeWidth="0.9" fill="none">
              <path d={`M ${ISLAND_CENTER.yonaguni.x + 7} ${ISLAND_CENTER.yonaguni.y - 2} Q 90 86 ${HUB.x - 14} ${HUB.y - 5}`} markerEnd="url(#amk)" />
              <path d={`M ${ISLAND_CENTER.taketomi.x + 14} ${ISLAND_CENTER.taketomi.y - 6} Q 138 106 ${HUB.x - 13} ${HUB.y - 1}`} markerEnd="url(#amk)" />
              <path d={`M ${HUB.x + 6} ${HUB.y - 12} Q 180 60 ${MAINLAND_DEST.ishigaki.x} ${DESTS[1].y + 5}`} markerEnd="url(#amk)" />
              <path d={`M ${ISLAND_CENTER.miyako.x + 6} ${ISLAND_CENTER.miyako.y - 12} Q 300 36 ${MAINLAND_DEST.miyako.x} ${DESTS[2].y + 5}`} markerEnd="url(#amk)" />
              <path d={`M ${ISLAND_CENTER.yonaguni.x + 1} ${ISLAND_CENTER.yonaguni.y - 15} Q 24 50 ${MAINLAND_DEST.yonaguni.x} ${DESTS[0].y + 5}`} markerEnd="url(#amk)" />
            </g>

            {/* コマ置き場（半透明の白いトレー＋島への引き出し線） */}
            {trays.map(t => (
              <g key={t.key}>
                <line x1={t.lx} y1={t.ly} x2={t.ax} y2={t.ay} stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
                <line x1={t.lx} y1={t.ly} x2={t.ax} y2={t.ay} stroke="#33526e" strokeWidth="0.6" strokeLinecap="round" />
                <circle cx={t.ax} cy={t.ay} r="1.1" fill="#33526e" stroke="#fff" strokeWidth="0.4" />
                <rect x={t.x} y={t.y} width={t.w} height={t.h} rx="2" fill="rgba(255,255,255,0.78)" stroke="#33526e" strokeWidth="0.5" strokeDasharray="1.6 1" />
              </g>
            ))}

            {/* 橋（実位置。崩落は赤い破線） */}
            {infra && BRIDGES.map(b => {
              const ok = infra[b.key] as boolean;
              const p = project(b.a[0], b.a[1]), q = project(b.b[0], b.b[1]);
              return (
                <g key={b.name}>
                  <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#fff" strokeWidth="1.9" strokeLinecap="round" />
                  <line x1={p.x} y1={p.y} x2={q.x} y2={q.y}
                    stroke={ok ? '#7a5230' : '#e03131'} strokeWidth="1.1"
                    strokeDasharray={ok ? undefined : '0.9 0.9'} strokeLinecap={ok ? 'round' : 'butt'} />
                </g>
              );
            })}
          </svg>

          {/* HTMLオーバーレイ：コマ・トークン・ラベル・施設・残数 */}
          <div style={styles.overlay}>
            {/* 人コマ（人型・統一サイズ）。種別色で塗り分け */}
            {cellsByArea.map(g => g.cells.map((c, i) => (
              <div key={`${g.id}-${i}`} style={{
                position: 'absolute',
                left: px(c.x), top: py(c.y), transform: 'translate(-50%,-50%)',
                width: `${(c.size / VW) * 100}%`, aspectRatio: '24 / 30',
                filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.45))',
                zIndex: 5,
              }}>
                <PersonIcon color={KOMA_COLOR[c.kind]} />
              </div>
            )))}

            {/* 移動トークン（蓄積して消えない）。移動中(最新日)は大きく光らせて見やすく */}
            {tokens.map(t => {
              const sz = cq(t.last ? 13 : 8);
              return (
                <div key={t.id} style={{
                  position: 'absolute',
                  width: sz, height: sz, borderRadius: '50%', boxSizing: 'border-box',
                  background: TCOLOR[t.kind], border: `${cq(t.last ? 2.2 : 1.3)} solid #fff`,
                  boxShadow: t.last
                    ? `0 0 10px ${TCOLOR[t.kind]}, 0 0 4px #fff, 0 1px 3px rgba(0,0,0,0.5)`
                    : `0 0 3px ${TCOLOR[t.kind]}, 0 1px 2px rgba(0,0,0,0.4)`,
                  zIndex: t.last ? 8 : 5,
                  animation: t.last
                    ? `okires-token-stay 1.9s cubic-bezier(0.45,0,0.2,1) ${t.delay}ms both`
                    : undefined,
                  left: t.last ? undefined : px(t.x1),
                  top: t.last ? undefined : py(t.y1),
                  transform: t.last ? undefined : 'translate(-50%,-50%)',
                  ['--x0' as string]: px(t.x0),
                  ['--y0' as string]: py(t.y0),
                  ['--x1' as string]: px(t.x1),
                  ['--y1' as string]: py(t.y1),
                } as React.CSSProperties} />
              );
            })}

            {/* 施設アイコン（実位置）＋名前（コマより前面に出して常に視認可能に） */}
            {FACILITIES.map(f => {
              const p = project(f.lat, f.lng);
              const mark = facilityMark(f);
              return (
                <div key={f.name} style={{ position: 'absolute', left: px(p.x), top: py(p.y), transform: 'translate(-50%,-50%)', zIndex: 7 }}>
                  <span style={{ position: 'relative', display: 'inline-flex' }}>
                    <span style={f.kind === 'air' ? styles.airDot : styles.seaDot}>{f.kind === 'air' ? '✈' : '⚓'}</span>
                    {mark && <span style={styles.facMark} title={mark === '💥' ? '使用不能（破壊/撃墜・撃沈/運航拒否）' : mark === '❌' ? '事前準備Lv4未満のため使用不可' : mark === '⛈️' ? '大雨で使用不能' : mark === '💨' ? '強風で使用不能' : '当日使用不能'}>{mark}</span>}
                  </span>
                  <span style={{ ...styles.facLabel, ...LABEL_POS[f.lab] }}>{f.name}</span>
                </div>
              );
            })}

            {/* 橋ラベル */}
            {infra && BRIDGES.map(b => {
              const ok = infra[b.key] as boolean;
              const p = project(b.a[0], b.a[1]), q = project(b.b[0], b.b[1]);
              return (
                <div key={b.name} style={{ position: 'absolute', left: px((p.x + q.x) / 2 + b.ldx), top: py((p.y + q.y) / 2 + b.ldy), transform: 'translate(-50%,-50%)', zIndex: 6 }}>
                  <span style={{ ...styles.bridgeLabel, color: ok ? '#6b4423' : '#fff', background: ok ? 'rgba(255,250,240,0.9)' : 'rgba(224,49,49,0.95)' }}>
                    {ok ? '' : '🚧'}{b.name}{ok ? '' : ' 崩落'}
                  </span>
                </div>
              );
            })}

            {/* 島名ラベル */}
            {ISLAND_LABELS.map(l => {
              const p = project(l.lat, l.lng);
              return (
                <div key={l.name} style={{ position: 'absolute', left: px(p.x + (l.dx ?? 0)), top: py(p.y + (l.dy ?? 0)), transform: 'translate(-50%,-50%)', zIndex: 6 }}>
                  <span style={{ ...styles.islandLabel, fontSize: cq(l.big ? 12.5 : 9) }}>{l.name}</span>
                </div>
              );
            })}

            {/* コマ置き場の見出し */}
            {trays.map(t => (
              <div key={t.key} style={{ position: 'absolute', left: px(t.x + 1.2), top: py(t.y), transform: 'translateY(-55%)', zIndex: 6 }}>
                <span style={styles.trayLabel}>{t.label}</span>
              </div>
            ))}

            {/* 各エリアの残コマ */}
            {(Object.keys(BADGE_POS) as AreaId[]).map(id => {
              const a = areas[id]; const c = BADGE_POS[id];
              const total = totalKoma(a); const done = total === 0;
              return (
                <div key={id} style={{ position: 'absolute', left: px(c.x), top: py(c.y), transform: 'translate(-50%,-50%)', zIndex: 6 }}>
                  <span style={{ ...styles.komaBadge, background: done ? '#1b8a4b' : '#ef7d00' }}>
                    {c.name} {done ? '✓完了' : `残${total}`}
                  </span>
                </div>
              );
            })}

            {/* 本土（避難先）＝地図範囲外への方向表示 */}
            {DESTS.map(d => (
              <div key={d.id} style={{ position: 'absolute', left: px(d.x), top: py(d.y), transform: 'translate(-50%,-50%)', zIndex: 6 }}>
                <span style={styles.destLabel}>{d.label}</span>
              </div>
            ))}

            {/* 死亡コマ枠（右下） */}
            <div style={styles.deathBox}>
              <div style={styles.deathLabel}>💀 死亡コマ <b>{Math.round(dead * 10) / 10}</b></div>
              {dead > 0 && (
                <div style={styles.deathGrid}>
                  {Array.from({ length: Math.min(Math.round(dead), 28) }, (_, i) => (
                    <span key={i} style={styles.deathDot} />
                  ))}
                  {Math.round(dead) > 28 && <span style={styles.deathMore}>+{Math.round(dead) - 28}</span>}
                </div>
              )}
            </div>

            {/* 出典表記（地理院タイル利用規約） */}
            <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer" style={styles.attribution}>
              出典：国土地理院（地理院タイル）
            </a>
          </div>
        </div>
      </div>

      <div style={styles.caption}>
        コマ：<b style={{ color: '#2f80ed' }}>●青＝住民</b> ／ <b style={{ color: '#c98f00' }}>●黄＝観光客</b> ／ <b style={{ color: '#eb5757' }}>●赤＝要援護者</b> ／ <b style={{ color: '#1b8a4b' }}>●緑＝待機（石垣ハブ等に集結し避難手段を待つ避難民）</b>。小さいコマ＝0.5コマ。
        石垣島・宮古島・西表島のコマは実縮尺の島に収まらないため、近くの海上の「コマ置き場」（白い枠）に並べています。
        施設：🟡空港 ／ 🔵海港 ／ 茶色の線＝橋（崩落で🚧赤破線＝該当島は避難不可） ／ 🚫＝当日使用不能（乱闘・サイバー・障害物散布・海上民兵・ボイコット等） ／ 💥＝使用不能（破壊・撃墜/撃沈・運航拒否） ／ ❌＝事前準備Lv不足で使用不可（波照間空港はLv4以上） ／ ⛈️＝大雨で使用不能 ／ 💨＝強風で使用不能。
        本土（那覇・福岡・鹿児島）は地図の範囲外のため上端に方向（↗）で示します。自動再生中、避難したコマは上端の本土へ移動して積み上がり、死亡は右下の枠に入ります。
      </div>
    </div>
  );
}

const HALO = '1px 1px 0 #fff, -1px 1px 0 #fff, 1px -1px 0 #fff, -1px -1px 0 #fff, 0 1px 0 #fff, 0 -1px 0 #fff, 1px 0 0 #fff, -1px 0 0 #fff, 0 0 3px #fff';
const DOT: React.CSSProperties = {
  width: cq(10.5), height: cq(10.5), borderRadius: '50%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: cq(5.6), lineHeight: 1, borderStyle: 'solid', borderWidth: cq(1.4),
};

const styles: Record<string, React.CSSProperties> = {
  frame: { borderRadius: 14, overflow: 'hidden', border: '3px solid #fffaf0', boxShadow: '0 10px 30px rgba(10,60,90,0.3)', background: '#fffaf0' },
  titleBar: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'linear-gradient(90deg,#3aa0b8,#5cc0d0)' },
  scrollHint: { fontFamily: FONT.jp, fontWeight: 700, fontSize: 10.5, color: '#fffaf0', whiteSpace: 'nowrap' },
  liveBadges: { marginLeft: 'auto', display: 'flex', gap: 8 },
  liveBadge: { background: '#fffaf0', borderRadius: 10, padding: '2px 9px', fontFamily: FONT.mono, fontWeight: 800, fontSize: 12 },
  layerToggle: { display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1.5px solid #fffaf0', background: 'rgba(255,250,240,0.25)' },
  layerBtn: { appearance: 'none', border: 'none', background: 'rgba(12,74,92,0.55)', color: '#fffaf0', fontFamily: FONT.jp, fontWeight: 800, fontSize: 12, padding: '3px 12px', cursor: 'pointer', lineHeight: 1.4 },
  layerBtnOn: { background: '#fffaf0', color: '#1c6f85' },

  // 狭い画面では横スクロール（最小幅 840px）。stage は実範囲の縦横比（320 : 176）
  // contain: inline-size ＝ 中身の最小幅（840px）が親レイアウトを押し広げないようにする
  scroll: { overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch', contain: 'inline-size' },
  stage: { position: 'relative', width: '100%', minWidth: 720, aspectRatio: `${VW} / ${VH}`, containerType: 'inline-size', overflow: 'hidden', background: SEA_COLOR.pale },
  svg: { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' },
  overlay: { position: 'absolute', inset: 0, pointerEvents: 'none' },

  airDot: { ...DOT, background: '#ffd633', borderColor: '#8f6a00', color: '#3d2c00', boxShadow: '0 0 0 1px #fff, 0 1px 3px rgba(0,0,0,0.45)' },
  seaDot: { ...DOT, background: '#3b9eff', borderColor: '#0f4f8f', color: '#fff', boxShadow: '0 0 0 1px #fff, 0 1px 3px rgba(0,0,0,0.45)' },
  facMark: { position: 'absolute', left: '50%', bottom: '55%', transform: 'translateX(-50%)', fontSize: cq(12), lineHeight: 1, zIndex: 9, filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.5))', pointerEvents: 'none' },
  facLabel: { position: 'absolute', fontFamily: FONT.jp, fontSize: cq(7.6), lineHeight: 1.15, color: '#173a17', fontWeight: 800, whiteSpace: 'nowrap', textShadow: HALO },

  islandLabel: { fontFamily: FONT.jp, fontWeight: 900, color: '#0e2f47', whiteSpace: 'nowrap', textShadow: HALO, lineHeight: 1.1, display: 'block' },
  trayLabel: { display: 'block', fontFamily: FONT.jp, fontWeight: 800, fontSize: cq(7.5), lineHeight: 1.2, color: '#fff', background: '#33526e', borderRadius: cq(4), padding: `0 ${cq(4)}`, whiteSpace: 'nowrap' },
  komaBadge: { display: 'block', fontFamily: FONT.jp, fontWeight: 900, fontSize: cq(9), lineHeight: 1.35, color: '#fff', borderRadius: cq(8), padding: `0 ${cq(6)}`, whiteSpace: 'nowrap', boxShadow: '0 1px 3px rgba(0,0,0,0.35)', border: `${cq(1.3)} solid rgba(255,255,255,0.75)` },
  bridgeLabel: { display: 'block', fontFamily: FONT.jp, fontWeight: 800, fontSize: cq(7), lineHeight: 1.25, borderRadius: cq(3), padding: `0 ${cq(2.5)}`, whiteSpace: 'nowrap', border: '1px solid rgba(107,68,35,0.35)' },
  destLabel: { display: 'block', fontFamily: FONT.jp, fontWeight: 900, fontSize: cq(10.5), color: '#9c3d12', background: 'rgba(255,250,240,0.96)', border: `${cq(1.6)} dashed #e07a2e`, borderRadius: cq(9), padding: `${cq(2)} ${cq(8)}`, whiteSpace: 'nowrap', textAlign: 'center', lineHeight: 1.2, boxShadow: '0 2px 6px rgba(0,0,0,0.22)' },
  attribution: { position: 'absolute', left: 0, bottom: 0, pointerEvents: 'auto', fontFamily: FONT.jp, fontSize: cq(8.5), lineHeight: 1.3, color: '#1f2d3d', background: 'rgba(255,255,255,0.82)', padding: `${cq(1)} ${cq(6)}`, borderTopRightRadius: cq(5), textDecoration: 'none', zIndex: 9 },

  caption: { padding: '6px 12px', background: '#fffaf0', fontFamily: FONT.jp, fontSize: 10.5, color: '#334155', lineHeight: 1.5, borderTop: '1px solid #eadfc8' },

  // 死亡コマ枠（右下）
  deathBox: {
    position: 'absolute', right: '1.5%', bottom: '2.5%', width: '20%',
    background: 'rgba(38,34,40,0.92)', borderWidth: cq(2), borderStyle: 'dashed', borderColor: '#c0392b',
    borderRadius: cq(8), padding: `${cq(4)} ${cq(6)}`, zIndex: 6, boxShadow: '0 2px 6px rgba(0,0,0,0.35)', boxSizing: 'border-box',
  },
  deathLabel: { fontFamily: FONT.jp, fontWeight: 800, fontSize: cq(9.5), color: '#fff', textAlign: 'center', marginBottom: cq(3), textShadow: '0 1px 2px rgba(0,0,0,0.6)' },
  deathGrid: { display: 'flex', flexWrap: 'wrap', gap: cq(2), justifyContent: 'center', alignItems: 'center' },
  deathDot: { width: cq(7), height: cq(7), borderRadius: '50%', boxSizing: 'border-box', background: '#1a1a1f', borderWidth: cq(1.5), borderStyle: 'solid', borderColor: '#e74c3c', boxShadow: '0 0 3px rgba(231,76,60,0.6)' },
  deathMore: { fontFamily: FONT.mono, fontSize: cq(8), fontWeight: 800, color: '#ff9d9d', marginLeft: cq(2) },
};
