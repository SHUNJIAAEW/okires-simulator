// 毎日の詳細な行動記録をまとめてPDF保存（印刷用の独立ウィンドウを開く）
import type { GameState, AreaId, DayLog } from './types';

const AREA_JP: Record<AreaId, string> = {
  yonaguni: '与那国島', taketomi: '竹富町全島', ishigaki: '石垣島', miyako: '宮古島・多良間',
};
const PHASE_JP: Record<string, string> = { peacetime: '平時(F1)', crisis: '存立危機(F2)', wartime: '有事(F3/4)' };

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function dayBlock(log: DayLog, prevEvac: number, prevDead: number): string {
  const evacToday = log.totalEvacuatedSoFar - prevEvac;
  const deadToday = log.totalDeadSoFar - prevDead;

  const events = log.events.length
    ? `<ul class="ev">${log.events.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`
    : '<div class="muted">イベントなし</div>';

  const evacs = log.evacuations.length
    ? `<table class="t"><tr><th>出発</th><th>到着</th><th>手段</th><th>コマ</th><th>要援護</th></tr>${
        log.evacuations.map(v => `<tr><td>${AREA_JP[v.from]}</td><td>${esc(v.to)}</td><td>${esc(v.method)}</td><td class="r">${v.count}</td><td>${v.isVulnerable ? '○' : ''}</td></tr>`).join('')
      }</table>`
    : '<div class="muted">本日の避難実績なし</div>';

  const dice = log.hourlyRolls && log.hourlyRolls.length
    ? `<div class="dice">${log.hourlyRolls.map(r => {
        const cls = r.eventType ? 'hit' : r.isEventSpace ? 'space' : 'plain';
        return `<span class="d ${cls}"><b>${String(r.hour).padStart(2, '0')}時</b> ${r.roll}${r.eventType ? ' ' + r.eventType : ''}</span>`;
      }).join('')}</div>`
    : '';

  const snaps = `<table class="t"><tr><th>エリア</th><th>残</th><th>住</th><th>観</th><th>要</th><th>待</th><th>疲労</th></tr>${
    (Object.keys(AREA_JP) as AreaId[]).map(id => {
      const s = log.areaSnapshots[id];
      return `<tr><td>${AREA_JP[id]}</td><td class="r">${s.total}</td><td class="r">${s.residents}</td><td class="r">${s.tourists}</td><td class="r">${s.vulnerable}</td><td class="r">${s.staging}</td><td class="r">${s.fatigue >= 0 ? '+' : ''}${s.fatigue.toFixed(1)}</td></tr>`;
    }).join('')
  }</table>`;

  return `
  <section class="day">
    <h2>${esc(log.dayLabel)} <span class="ph">${PHASE_JP[log.phase] ?? log.phase}</span>
      <span class="kpi">本日 避難+${evacToday} / 死亡+${deadToday} ／ 累計 避難${log.totalEvacuatedSoFar}・死亡${log.totalDeadSoFar}</span></h2>
    <div class="row"><b>天候・状況</b><div>${esc(log.weatherSummary)}</div></div>
    <div class="row"><b>イベント・軍事</b><div>${events}</div></div>
    <div class="row"><b>避難実績</b><div>${evacs}</div></div>
    ${dice ? `<div class="row"><b>24時間ダイス</b><div>${dice}</div></div>` : ''}
    <div class="row"><b>疲労度</b><div>${esc(log.fatigueSummary)}</div></div>
    <div class="row"><b>エリア残員</b><div>${snaps}</div></div>
  </section>`;
}

export function exportDailyReportPdf(state: GameState): void {
  const { dayLogs, prepLevel, shelterLevel, month, evacuated, dead } = state;
  if (!dayLogs || dayLogs.length === 0) {
    alert('まだ行動記録がありません。シミュレーションを進めてから保存してください。');
    return;
  }
  const totalRemaining = Object.values(state.areas).reduce((s, a) => s + a.residents + a.tourists + a.vulnerable + a.stagingPort, 0);
  const maxK = evacuated + dead + totalRemaining;
  const rate = maxK > 0 ? (evacuated / maxK * 100).toFixed(1) : '0';

  let prevE = 0, prevD = 0;
  const body = dayLogs.map(l => {
    const html = dayBlock(l, prevE, prevD);
    prevE = l.totalEvacuatedSoFar; prevD = l.totalDeadSoFar;
    return html;
  }).join('');

  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
  <title>OKIRES2026 毎日の行動記録</title>
  <style>
    @page { margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: "Hiragino Sans","Yu Gothic",sans-serif; color:#16202b; font-size:11px; line-height:1.5; margin:0; }
    h1 { font-size:18px; margin:0 0 2px; }
    .head { border-bottom:3px solid #1b6fa3; padding-bottom:6px; margin-bottom:10px; }
    .sub { color:#475569; font-size:11px; }
    .summary { background:#eef6fb; border:1px solid #cfe3ef; border-radius:6px; padding:6px 10px; margin:8px 0 14px; font-weight:700; }
    section.day { border:1px solid #d4dde6; border-radius:6px; padding:8px 10px; margin-bottom:10px; break-inside:avoid; page-break-inside:avoid; }
    h2 { font-size:13px; margin:0 0 6px; border-bottom:1px solid #e2e8f0; padding-bottom:3px; }
    h2 .ph { font-size:10px; color:#0e7c66; margin-left:6px; }
    h2 .kpi { float:right; font-size:10px; color:#475569; font-weight:500; }
    .row { display:flex; gap:8px; padding:3px 0; border-bottom:1px dashed #eef2f6; }
    .row > b { flex:0 0 92px; color:#1b6fa3; font-size:10px; }
    .row > div { flex:1; }
    .muted { color:#94a3b8; }
    ul.ev { margin:0; padding-left:16px; }
    table.t { border-collapse:collapse; width:100%; }
    table.t th, table.t td { border:1px solid #dbe4ec; padding:2px 5px; font-size:10px; text-align:left; }
    table.t th { background:#f1f6fa; }
    td.r { text-align:right; font-variant-numeric:tabular-nums; }
    .dice { display:flex; flex-wrap:wrap; gap:3px; }
    .d { border:1px solid #d4dde6; border-radius:3px; padding:1px 4px; font-size:9px; }
    .d b { color:#64748b; }
    .d.hit { background:#fff3d6; border-color:#e0a800; }
    .d.space { background:#eef2f6; }
    @media print { .noprint { display:none; } }
    .noprint { text-align:center; margin:10px 0 16px; }
    .noprint button { font-size:14px; padding:8px 18px; border:none; border-radius:6px; background:#1b6fa3; color:#fff; cursor:pointer; }
  </style></head>
  <body>
    <div class="head">
      <h1>🗾 OKIRES2026 毎日の詳細な行動記録</h1>
      <div class="sub">事前準備 Lv.${prepLevel} ／ 抗堪性 Lv.${shelterLevel} ／ ${month}月発生 ／ 全${dayLogs.length}日</div>
    </div>
    <div class="summary">最終結果：避難完了 ${evacuated}コマ ／ 取り残し ${totalRemaining}コマ ／ 死亡 ${dead}コマ ／ 避難完了率 ${rate}%</div>
    <div class="noprint"><button onclick="window.print()">🖨 PDFで保存 / 印刷</button></div>
    ${body}
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('ポップアップがブロックされました。ブラウザのポップアップ許可を有効にしてください。'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
