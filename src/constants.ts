// OKIRES2026 ゲーム定数

import type { AreaId, WeatherCondition } from './types';

// ===== 天候トラック =====
// 月別の天候トラック (1-indexed)
export const WEATHER_TRACKS: Record<string, WeatherCondition[]> = {
  summer: ['rain', 'cloudy', 'sunny', 'cloudy', 'rain', 'heavy-rain'], // 7-9月 (6段階)
  transition: ['rain', 'cloudy', 'cloudy', 'sunny', 'sunny', 'sunny', 'cloudy', 'cloudy', 'rain', 'heavy-rain'], // 5,6,10,11月 (10段階)
  winter: ['rain', 'cloudy', 'cloudy', 'sunny', 'cloudy', 'rain'], // 12-4月 (6段階)
};

export function getWeatherTrack(month: number): WeatherCondition[] {
  if (month >= 7 && month <= 9) return WEATHER_TRACKS.summer;
  if ([5, 6, 10, 11].includes(month)) return WEATHER_TRACKS.transition;
  return WEATHER_TRACKS.winter;
}

export function getInitialWeatherIndex(month: number): number {
  if (month >= 7 && month <= 9) return 4; // 曇(4)
  if ([5, 6, 10, 11].includes(month)) return 8; // 曇(8)
  return 4; // 曇(4)
}

// ===== 風速トラック =====
// 3-11月: 8段階、8のみ強風
// 12-2月: 8段階、4と8が強風
export const WIND_SPEED_TRACKS = {
  warmSeason: ['calm', 'calm', 'calm', 'calm', 'calm', 'calm', 'calm', 'strong'] as const,
  coldSeason: ['calm', 'calm', 'calm', 'strong', 'calm', 'calm', 'calm', 'strong'] as const,
};

export function getInitialWindSpeedIndex(month: number): number {
  if (month >= 7 && month <= 9) return 4; // 微風(4)
  if ([5, 6, 10, 11].includes(month)) return 6; // 微風(6)
  return 6; // 微風(6) (12-4月)
}

export function isStrongWind(speedIndex: number, month: number): boolean {
  if (month >= 3 && month <= 11) return speedIndex === 8;
  return speedIndex === 4 || speedIndex === 8; // 12-2月
}

// ===== 風向 =====
// 1=西, 2=北西, 3=北東, 4=東, 5=南東, 6=南西
export const WIND_DIRECTIONS = ['西', '北西', '北東', '東', '南東', '南西'];

export function getInitialWindDirectionIndex(month: number): number {
  if (month >= 12 || month <= 4) return 3; // 北東
  return 5; // 南東
}

// ===== 空港の滑走路方向 =====
// 強風時に離着陸可能な風向
export const AIRPORT_ALLOWED_WIND_DIRECTIONS: Record<string, number[]> = {
  yonaguni: [1, 4],       // 東西方向: 西(1) or 東(4)
  shimoji: [2, 5],        // 北西-南東: 北西(2) or 南東(5)
  shinIshigaki: [3, 6],   // 北東-南西: 北東(3) or 南西(6)
  miyako: [3, 6],         // 北東-南西: 北東(3) or 南西(6)
};

// ===== 事前準備レベル別設定 =====
export const PREP_LEVEL_SETTINGS = {
  1: {
    dmat: 1,
    mainPortCapacityPerTrip: 0.5, // 石垣港・平良港 1便あたりのコマ数
    haterumaAirport: false,
    taramaAirport: false,
    coastGuardTripsPerDay: 1,
    jmsdfTotal: 0,  // 使用不可
    jasdfTotal: 0,
    jgsdfTotal: 1,
    airFlights: { shinIshigaki: 0, miyako: 0, shimoji: 0, yonaguni: 0 }, // 準有事なし
    airFlightsWartime: { shinIshigaki: 10, miyako: 7, shimoji: 3, yonaguni: 2 },
    crisis24h: false,
  },
  2: {
    dmat: 2,
    mainPortCapacityPerTrip: 0.5,
    haterumaAirport: false,
    taramaAirport: false,
    coastGuardTripsPerDay: 1,
    jmsdfTotal: 1,
    jasdfTotal: 1,
    jgsdfTotal: 1,
    airFlights: { shinIshigaki: 0, miyako: 0, shimoji: 0, yonaguni: 1 },
    airFlightsWartime: { shinIshigaki: 10, miyako: 7, shimoji: 3, yonaguni: 2 },
    crisis24h: false,
  },
  3: {
    dmat: 3,
    mainPortCapacityPerTrip: 1.0,
    haterumaAirport: false,
    taramaAirport: false,
    coastGuardTripsPerDay: 2,
    jmsdfTotal: 2,
    jasdfTotal: 2,
    jgsdfTotal: 2,
    airFlights: { shinIshigaki: 0, miyako: 0, shimoji: 0, yonaguni: 1 },
    airFlightsWartime: { shinIshigaki: 10, miyako: 7, shimoji: 3, yonaguni: 2 },
    crisis24h: false,
  },
  4: {
    dmat: 4,
    mainPortCapacityPerTrip: 1.0,
    haterumaAirport: true,
    taramaAirport: true,
    coastGuardTripsPerDay: 2,
    jmsdfTotal: 3,
    jasdfTotal: 3,
    jgsdfTotal: 3,
    airFlights: { shinIshigaki: 0, miyako: 0, shimoji: 0, yonaguni: 1 },
    airFlightsWartime: { shinIshigaki: 10, miyako: 7, shimoji: 3, yonaguni: 2 },
    crisis24h: false,
  },
  5: {
    dmat: 4,
    mainPortCapacityPerTrip: 1.5,
    haterumaAirport: true,
    taramaAirport: true,
    coastGuardTripsPerDay: 3,
    jmsdfTotal: 4,
    jasdfTotal: 4,
    jgsdfTotal: 4,
    airFlights: { shinIshigaki: 0, miyako: 0, shimoji: 0, yonaguni: 1 },
    airFlightsWartime: { shinIshigaki: 13, miyako: 10, shimoji: 5, yonaguni: 2 },
    crisis24h: false,
  },
  6: {
    dmat: 4,
    mainPortCapacityPerTrip: 1.5,
    haterumaAirport: true,
    taramaAirport: true,
    coastGuardTripsPerDay: 3,
    jmsdfTotal: 4,
    jasdfTotal: 4,
    jgsdfTotal: 4,
    airFlights: { shinIshigaki: 13, miyako: 10, shimoji: 5, yonaguni: 3 }, // 24h
    airFlightsWartime: { shinIshigaki: 13, miyako: 10, shimoji: 5, yonaguni: 3 },
    crisis24h: true,
  },
} as const;

// ===== 島間フェリー容量 =====
// 竹富町各島→石垣 (1日最大)
export const TAKETOMI_TO_ISHIGAKI_FERRY_MAX = 11; // コマ数/日 (全便フル運行時)

// 与那国→石垣 フェリー
export const YONAGUNI_TO_ISHIGAKI_FERRY = 0.5; // コマ/日

// ===== エリア設定 =====
export const AREA_CONFIGS: Record<AreaId, {
  name: string;
  baseActions: number;
  initialResidents: number;
  color: string;
}> = {
  yonaguni: { name: '与那国島', baseActions: 2, initialResidents: 2, color: '#ef4444' },
  taketomi: { name: '竹富町全島', baseActions: 2, initialResidents: 15, color: '#f97316' },
  ishigaki: { name: '石垣島', baseActions: 4, initialResidents: 43, color: '#3b82f6' },
  miyako:   { name: '宮古島・多良間', baseActions: 3, initialResidents: 49, color: '#22c55e' },
};

// ===== 観光客数 (月別) =====
export const TOURIST_BY_MONTH: Record<number, number> = {
  1: 12, 2: 8, 3: 8, 4: 8, 5: 12,
  6: 8, 7: 12, 8: 12, 9: 8, 10: 8,
  11: 8, 12: 12,
};

// ===== フェーズ別イベント発生確率 =====
// フェーズ1でダイス出目1=A, フェーズ2で1-2=B, フェーズ3で1-3=C, フェーズ4で1-4=D
// (簡略化: 各フェーズの発生しうるイベントタイプ)

// ===== 疲労度による手数変動 =====
// 実効疲労 = fatigue (負の値はボーナス)
// 実効手数 = max(0, baseActions - max(0, effectiveFatigue))
// effectiveFatigue = fatigue (起算: -shelterLevel からスタート)
export function getEffectiveActions(baseActions: number, fatigue: number): number {
  return Math.max(0, baseActions - Math.max(0, fatigue));
}

// ===== 死傷者計算 =====
// 市街攻撃: (3ダイス合計) + 中国軍計 - 自衛隊計 - PAC3数 - 3×抗堪性
// 施設破壊: (4ダイス合計) + ... >= 17 → 破壊
// ヘリボーン/上陸: (3ダイス合計) + ... >= 15 → 発生

export const CASUALTY_THRESHOLDS = {
  urban: {
    low: 0,    // 死傷者なし
    mid: 10,   // 数十名
    high: 11,  // 0.5コマ死亡
  },
  facility: {
    threshold: 17,  // 破壊
    senkakuBonus: 3, // 尖閣占領時
  },
  transport: {
    threshold: 15,  // 撃墜
    senkakuBonus: 3,
  },
  heliborne: {
    threshold: 15,
    senkakuBonus: 3,
  }
};

// ===== X+3日の竹富町以西避難期限 =====
export const TAKETOMI_EVACUATION_DEADLINE = 3; // X+3日24時まで

// ===== 出発時刻スロット =====
// null = 24時間いつでも, number[] = 固定時刻, hourly = N〜M時毎時
export const ROUTE_SCHEDULES: Record<string, { type: 'fixed' | 'hourly'; hours: number[]; label: string }> = {
  shimoji_air:          { type: 'fixed',  hours: [8, 12, 16],                                    label: '8・12・16時' },
  yonaguni_air_wartime: { type: 'fixed',  hours: [8, 16],                                        label: '8・16時' },
  yonaguni_air_crisis:  { type: 'fixed',  hours: [8],                                            label: '8時' },
  hateruma_air:         { type: 'fixed',  hours: [9],                                            label: '9時' },
  tarama_air:           { type: 'fixed',  hours: [15],                                           label: '15時' },
  shinishigaki_air:     { type: 'hourly', hours: Array.from({ length: 11 }, (_, i) => i + 8),   label: '8〜18時(毎時)' },
  miyako_air:           { type: 'hourly', hours: Array.from({ length: 11 }, (_, i) => i + 8),   label: '8〜18時(毎時)' },
  ferry_main:           { type: 'fixed',  hours: [9, 14],                                        label: '午前(9時)・午後(14時)' },
  coast_guard:          { type: 'hourly', hours: Array.from({ length: 24 }, (_, i) => i),        label: '24時間' },
  jmsdf:                { type: 'hourly', hours: Array.from({ length: 24 }, (_, i) => i),        label: '24時間' },
  asdf:                 { type: 'hourly', hours: Array.from({ length: 11 }, (_, i) => i + 8),   label: '8〜18時' },
};

// ===== 輸送方法ラベル =====
export const TRANSPORT_LABELS: Record<string, string> = {
  civilian_air: '民間航空',
  jsdf_air: '空自輸送機',
  coast_guard: '海保輸送船',
  jsdf_ship: '海自輸送艦',
  jgsdf_heli: '陸自ヘリ',
  ferry: 'フェリー',
  island_ferry: '離島間フェリー',
};
