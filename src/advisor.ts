// AI災害司令官 — Jev（typesafe.ai）連携の窓口（キー無しでも動く）
//
// ブラウザからAPIキーを露出させないため、呼び出しは Vercel Serverless Function `/api/jev` を経由する。
// 501（キー未設定）や通信失敗時は analyzeDay の結果からルールベースで採点・重点領域を決める。
// UI では「AIの見立て（信頼度x%）」として出す前提。正解とは表示しない。

import type { DayAnalysis, Forecast, Bottleneck } from './commander';
import type { EvacPolicy } from './types';

export type AdviceFocus = 'air' | 'sea' | 'vulnerable' | 'shuttle' | 'wait';

export const FOCUS_LABELS: Record<AdviceFocus, string> = {
  air: '空路の活用',
  sea: '海路の活用',
  vulnerable: '要援護者の搬出',
  shuttle: '往復（ピストン）輸送',
  wait: '様子見（現状維持）',
};

export interface AdviceContext {
  analysis: DayAnalysis;
  policy: EvacPolicy | null;
  forecasts?: Pick<Forecast, 'policy' | 'finalEvacRate' | 'expectedRemaining' | 'vulnerableArrivalRateMean' | 'expectedDead'>[];
  // 追加の状況要約（UI側で任意に付ける）
  extra?: Record<string, string | number | boolean | null>;
}

export interface Advice {
  source: 'jev' | 'rule';
  score: number;            // 0..100（本日の判断の質の見立て）
  scoreConfidence: number;  // 0..1
  focus: AdviceFocus;       // 翌日に重点を置くべき領域（見立て）
  focusConfidence: number;  // 0..1
  rationale: string;        // 日本語短文（UIがそのまま表示）
  model?: string;
}

interface JevResponse {
  score: number;
  scoreConfidence: number;
  focus: AdviceFocus;
  focusConfidence: number;
  model?: string;
}

const FOCUS_SET: AdviceFocus[] = ['air', 'sea', 'vulnerable', 'shuttle', 'wait'];

// ルールベースのフォールバック: analyzeDay の結果から score と focus を決める
export function ruleBasedAdvice(context: AdviceContext): Advice {
  const a = context.analysis;
  // 採点ルーブリック（0-100）: 要支援者優先 / 容量の使い切り / 天候リスクへの備え
  let score = 50;
  const reasons: string[] = [];
  // 容量の使い切り（提供容量に対する当日避難の割合）
  if (a.capacityOffered > 0) {
    const util = Math.min(1, (a.evacuatedToday + Object.values(a.byArea).reduce((s, x) => s + x.movedToHub, 0)) / a.capacityOffered);
    score += Math.round(util * 25) - 10;
    reasons.push(`容量の使い切り ${Math.round(util * 100)}%`);
  }
  // 要支援者優先（本日 要援護者を出せたか。残る要援護者がいるのに海路容量を使い切れていなければ減点）
  const vulnRemaining = Object.values(a.byArea).reduce((s, x) => s + x.vulnerableRemaining + x.stagingVulnerable, 0);
  const vulnArrived = Object.values(a.vulnerableArrivedToday).reduce((s, x) => s + x, 0);
  if (vulnArrived > 0) { score += 10; reasons.push(`要援護者${vulnArrived}コマ到着`); }
  else if (vulnRemaining > 0 && !a.bottlenecks.includes('weather-sea')) { score -= 10; reasons.push('要援護者の搬出なし'); }
  // 死者
  if (a.deadToday > 0) { score -= Math.min(20, Math.round(a.deadToday * 10)); reasons.push(`死者${a.deadToday}コマ`); }
  // 天候リスクへの備え（悪天候日にボトルネックが天候だけなら不可抗力として大きく減点しない）
  const wx = a.bottlenecks.filter(b => b === 'weather-sea' || b === 'weather-air');
  if (wx.length > 0) { score -= 5; reasons.push('悪天候の影響'); }
  if (a.bottlenecks.includes('shuttle')) { score -= 8; reasons.push('往復便の予算未消化'); }
  if (a.bottlenecks.includes('none') && a.remaining === 0) { score = Math.max(score, 90); reasons.push('全員避難完了'); }
  score = Math.max(0, Math.min(100, score));

  // 翌日の重点領域（最初のボトルネックから）
  const focusOf = (b: Bottleneck): AdviceFocus => {
    switch (b) {
      case 'weather-sea': return 'air';
      case 'weather-air': return 'sea';
      case 'facility-closed': return 'shuttle';
      case 'shuttle': return 'shuttle';
      case 'capacity': return vulnRemaining > 0 ? 'vulnerable' : 'air';
      case 'fatigue': return 'air';
      case 'refusal': return 'wait';
      case 'occupied': return 'sea';
      default: return vulnRemaining > 0 ? 'vulnerable' : 'wait';
    }
  };
  const focus = focusOf(a.bottlenecks[0] ?? 'none');
  return {
    source: 'rule',
    score,
    scoreConfidence: 0.5,
    focus,
    focusConfidence: a.bottlenecks[0] && a.bottlenecks[0] !== 'none' ? 0.6 : 0.4,
    rationale: `ルールベースの見立て: ${reasons.join('・') || '特記なし'}。翌日の重点候補は「${FOCUS_LABELS[focus]}」。`,
  };
}

// /api/jev を呼び、失敗時はルールベースへフォールバックする
export async function getAdvice(context: AdviceContext, options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<Advice> {
  const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  const fallback = ruleBasedAdvice(context);
  if (!fetchImpl) return fallback;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), options.timeoutMs ?? 12000) : undefined;
  try {
    const res = await fetchImpl('/api/jev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context }),
      signal: ctrl?.signal,
    });
    if (!res.ok) return fallback; // 501（キー未設定）やエラー
    const data = (await res.json()) as Partial<JevResponse>;
    const focus = FOCUS_SET.includes(data.focus as AdviceFocus) ? (data.focus as AdviceFocus) : fallback.focus;
    const score = typeof data.score === 'number' && Number.isFinite(data.score) ? Math.max(0, Math.min(100, Math.round(data.score))) : fallback.score;
    return {
      source: 'jev',
      score,
      scoreConfidence: clamp01(data.scoreConfidence, fallback.scoreConfidence),
      focus,
      focusConfidence: clamp01(data.focusConfidence, fallback.focusConfidence),
      rationale: `AIの見立て（Jev）: 本日の判断の質 ${score}点。翌日の重点候補は「${FOCUS_LABELS[focus]}」。${fallback.rationale.replace('ルールベースの見立て: ', '根拠: ')}`,
      model: data.model,
    };
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function clamp01(x: unknown, fallback: number): number {
  return typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : fallback;
}
