/// <reference types="node" />
// Vercel Serverless Function: AI災害司令官の採点・重点領域を Jev（typesafe.ai）に問い合わせる窓口。
// ブラウザへ API キーを露出させないため、サーバ側で TYPESAFE_API_KEY を使う。キー未設定なら 501 を返し、
// フロント（src/advisor.ts）はルールベースへフォールバックする。
// api/ は tsconfig の対象外。Vercel がそのまま解釈できる素直な TS で書く。

import { TypeSafeClient, score, choice } from '@typesafe-ai/sdk';

interface VercelRequestLike {
  method?: string;
  body?: unknown;
}
interface VercelResponseLike {
  status(code: number): VercelResponseLike;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
}

type JsonObject = { [key: string]: JsonValue };
type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

// 採点ルーブリック（0〜10 の11段階。SDK の score は「0から始まる順序付きルーブリック」を取るため、
// 期待値 score(0..10) を 10倍して 0-100 に換算する）。観点: 要支援者優先 / 容量の使い切り / 天候リスクへの備え
const QUALITY_RUBRIC = [
  '0: 提供容量をほぼ使わず、要援護者を放置し、天候リスクへの備えもない',
  '1: 容量の大半を未使用。要援護者の搬出なし',
  '2: 容量の使い切りが低く、要援護者の優先も弱い',
  '3: 容量の半分程度を使用。要援護者は後回し',
  '4: 容量をある程度使ったが、要援護者や天候への備えに抜けがある',
  '5: 容量・要援護者・天候のいずれも平均的',
  '6: 容量をおおむね使い切り、要援護者も一部搬出',
  '7: 容量を使い切り、要援護者を優先。天候リスクへの備えは部分的',
  '8: 容量の使い切り・要援護者優先・天候リスクへの備えがそろっている',
  '9: 上記に加え、往復輸送や増援など状況に応じた手段選択ができている',
  '10: 取り残しなし、または不可抗力を除き最善に近い判断',
] as const;

export default async function handler(req: VercelRequestLike, res: VercelResponseLike): Promise<void> {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    res.status(501).json({ error: 'TYPESAFE_API_KEY is not configured', source: 'none' });
    return;
  }
  let body: unknown = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const context = (body && typeof body === 'object' && 'context' in body)
    ? (body as { context: unknown }).context
    : null;
  if (!context || typeof context !== 'object') {
    res.status(400).json({ error: 'context (object) is required' });
    return;
  }

  try {
    const client = new TypeSafeClient({ apiKey, timeout: 15000 });
    const result = await client.systemOne({
      state: {
        role: 'OKIRES2026 先島諸島 住民避難シミュレーターの司令官支援。数値はエンジンが確定済み。正解を断定せず、判断の質と翌日の重点領域を見立てる。',
        context: context as JsonObject,
      },
      questions: {
        quality: score(
          '本日の避難判断の質を採点してください。観点: 要支援者優先 / 提供容量の使い切り / 天候リスクへの備え。悪天候など不可抗力は減点しすぎない。',
          QUALITY_RUBRIC,
        ),
        focus: choice('翌日に重点を置くべき領域', {
          air: '空路（民間航空・空自輸送機）の活用',
          sea: '海路（フェリー・海保・海自）の活用',
          vulnerable: '要援護者（海路のみ）の搬出',
          shuttle: '石垣⇔宮古の往復（ピストン）輸送',
          wait: '現状維持・様子見（天候回復待ち など）',
        }),
      },
    });
    const q = result.answers.quality;
    const f = result.answers.focus;
    res.status(200).json({
      score: Math.round((q.score / (QUALITY_RUBRIC.length - 1)) * 100),
      scoreConfidence: q.confidence,
      focus: f.choice,
      focusConfidence: f.confidence,
      focusProbabilities: f.probabilities,
      model: result.model,
      source: 'jev',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: 'jev request failed', detail: message });
  }
}
