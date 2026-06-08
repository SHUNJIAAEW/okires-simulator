const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  Footer, PageNumber,
} = require('docx');

// ── デザイントークン ──────────────────────────────
const JP = 'Yu Gothic';            // 日本語フォント
const NAVY = '0F2C4D';
const TEAL = '0E7C66';
const RED = 'B42318';
const AMBER = 'B25E00';
const GREY = '475569';
const LIGHT = 'EEF3F8';
const RULE = 'CBD5E1';
const CONTENT_W = 9360;            // US Letter, 1" margins

// ── ヘルパ ────────────────────────────────────────
function t(text, opts = {}) {
  return new TextRun({ text, font: JP, ...opts });
}

function spacer(h = 80) {
  return new Paragraph({ spacing: { after: h }, children: [t('')] });
}

function h1(num, text) {
  return new Paragraph({
    spacing: { before: 260, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: NAVY, space: 4 } },
    children: [
      new TextRun({ text: num, font: JP, bold: true, size: 26, color: TEAL }),
      new TextRun({ text: '  ' + text, font: JP, bold: true, size: 26, color: NAVY }),
    ],
  });
}

// 「シミュレーション」「現実」の対比ブロック（2行テーブル）
function contrast(simText, realLines) {
  function cell(labelText, labelColor, fill, bodyChildren) {
    return new TableCell({
      width: { size: CONTENT_W, type: WidthType.DXA },
      shading: { fill, type: ShadingType.CLEAR },
      margins: { top: 110, bottom: 110, left: 160, right: 160 },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: RULE },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: RULE },
        left: { style: BorderStyle.SINGLE, size: 12, color: labelColor },
        right: { style: BorderStyle.SINGLE, size: 1, color: RULE },
      },
      children: bodyChildren,
    });
  }

  const simPara = new Paragraph({
    spacing: { after: 40 },
    children: [
      new TextRun({ text: '▍シミュレーションでは', font: JP, bold: true, size: 20, color: GREY }),
    ],
  });
  const simBody = new Paragraph({
    children: [t(simText, { size: 21 })],
  });

  const realHead = new Paragraph({
    spacing: { after: 40 },
    children: [
      new TextRun({ text: '▍でも現実は', font: JP, bold: true, size: 20, color: RED }),
    ],
  });
  const realBody = realLines.map((line, i) =>
    new Paragraph({
      spacing: { after: i === realLines.length - 1 ? 0 : 40 },
      indent: line.startsWith('・') ? { left: 200 } : undefined,
      children: [t(line, { size: 21 })],
    })
  );

  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONTENT_W],
    rows: [
      new TableRow({ children: [cell('sim', GREY, LIGHT, [simPara, simBody])] }),
      new TableRow({ children: [cell('real', RED, 'FFFFFF', [realHead, ...realBody])] }),
    ],
  });
}

// ── 本文データ ────────────────────────────────────
const items = [
  {
    n: '1', title: '空港や港が壊れたとき',
    sim: '攻撃で空港や港が壊れると「使えない」になり、そのままずっと使えないままになります。',
    real: [
      '壊れ方には程度があります。滑走路の一部だけ穴が空いた、管制塔が壊れた、燃料設備だけやられた——など場所によって影響が違います。',
      '多くは応急工事で「一部だけ再開」「昼間だけ運用」など、数時間〜数日で部分的に復旧します。「全部ダメ」か「全部OK」の二択ではありません。',
    ],
  },
  {
    n: '2', title: '停電したとき',
    sim: '電力施設が攻撃されても、住民が「疲れる」だけで、空港や港の動きには影響しません。',
    real: [
      '停電すると、管制・照明・給油ポンプ・搭乗手続き・通信・港の荷役などが一斉に止まります。',
      '電気が止まれば、施設が無事でも飛行機や船は動かせません。',
    ],
  },
  {
    n: '3', title: '飛行機・船の「便」の考え方',
    sim: '「1日に運べる人数」だけを見ていて、何時の便か、折り返しに何時間かかるか、燃料補給や乗員の休憩、夜に飛べるか——は考えていません。',
    real: [
      '避難は「便」の積み重ねです。朝の便はもう飛んだ後、夕方の便はまだ、という時間差があります。',
      '折り返し時間・給油・乗員交代・夜間運用の可否で、実際に運べる数は大きく変わります。',
      '（例：攻撃が夕方なら、その日の昼の便はもう飛び終えています）',
    ],
  },
  {
    n: '4', title: '民間の飛行機・船の止まり方',
    sim: '攻撃を受けると、民間の航空も船も「いっせいに全部停止」します。',
    real: [
      '会社ごと・路線ごと・港ごとに判断が分かれます。',
      'リスクの低い路線は動かす、危ない路線は止める、減便する、護衛をつけて運ぶ——など、段階的でまだら模様になります。全部が同時に止まる／動くわけではありません。',
    ],
  },
  {
    n: '5', title: '体の弱い人（高齢者・障がい者・妊婦など）の避難',
    sim: '体の弱い人は「船でしか避難できない」ことになっています。',
    real: [
      '重症の方や寝たきりの方は、むしろ飛行機やヘリでの医療搬送が必要な場合があります。',
      '酸素・担架・付き添い・搬送先の病院の空き状況など、健康な人とは別の制約がたくさんあります。',
    ],
  },
  {
    n: '6', title: '港や空港まで「たどり着く」までの移動',
    sim: '島の中のバスや道路、橋、ガソリン不足は考えていません。また、避難した先（本土・九州）の受け入れ能力も無限の前提です。',
    real: [
      '「港・空港に人を集めること自体」が大きな壁です。車のない高齢者や観光客は移動手段がなく、橋が落ちたりガソリンが切れれば動けません。',
      '受け入れる本土側にも、宿泊・医療・交通の限界があり、そこが詰まれば避難は完結しません。',
    ],
  },
  {
    n: '7', title: '機雷（海に仕掛けられる爆発物）― ここが最大の弱点',
    sim: '機雷は「機雷の疑いあり」で住民が少し疲れるだけ。港が閉鎖されることも、機雷を取り除く作業も登場しません。',
    real: [
      '機雷はミサイルと違い「撒かれた瞬間から、取り除き終わるまでずっと海路を塞ぎ続ける」最もやっかいな脅威です。',
      '・疑いがあるだけで、安全確認まで港・航路は即停止します。',
      '・取り除く（掃海）には専門の部隊が必要で、数日〜数週間かかります。',
      '・宮古海峡のような要所に撒かれると、石垣・宮古の両方の本土ルートが同時に断たれます。',
      'つまり、海からの避難がここで丸ごと止まる可能性があります。',
    ],
    emphasis: true,
  },
  {
    n: '8', title: '海の状態の見方',
    sim: '「海全体」をひとまとめにして、悪天候なら一律に「海は使えない」と判断します。',
    real: [
      '航路ごとに波の高さ・風向き・港の内外で状況が違います。',
      '波照間島や多良間島のような小さな船しか出せない航路は、少し荒れただけで欠航し、すぐ孤立します。',
    ],
  },
];

// ── ドキュメント構築 ──────────────────────────────
const children = [];

// 表紙ヘッダ
children.push(new Paragraph({
  spacing: { after: 40 },
  children: [new TextRun({ text: '避難シミュレーション「OKIRES 2026」', font: JP, bold: true, size: 20, color: TEAL })],
}));
children.push(new Paragraph({
  spacing: { after: 60 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: NAVY, space: 6 } },
  children: [new TextRun({ text: '現実と違っている部分の やさしい解説', font: JP, bold: true, size: 36, color: NAVY })],
}));
children.push(new Paragraph({
  spacing: { before: 120, after: 60 },
  shading: { fill: LIGHT, type: ShadingType.CLEAR },
  border: {
    top: { style: BorderStyle.SINGLE, size: 1, color: RULE },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: RULE },
    left: { style: BorderStyle.SINGLE, size: 1, color: RULE },
    right: { style: BorderStyle.SINGLE, size: 1, color: RULE },
  },
  indent: { left: 160, right: 160 },
  children: [
    t('このシミュレーションは、台湾有事を想定して沖縄・先島諸島の約12万人がどう避難できるかを試すものです。ただし、現実の避難はもっと複雑です。本資料では、', { size: 21 }),
    t('「ゲームの中では単純にしている部分」', { size: 21, bold: true, color: NAVY }),
    t('を、専門用語を使わずにまとめました。', { size: 21 }),
  ],
}));
children.push(spacer(80));

// 各項目
for (const it of items) {
  children.push(h1(it.n, it.title));
  children.push(contrast(it.sim, it.real));
  children.push(spacer(140));
}

// まとめ
children.push(new Paragraph({
  spacing: { before: 200, after: 120 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: TEAL, space: 4 } },
  children: [new TextRun({ text: 'まとめ', font: JP, bold: true, size: 28, color: TEAL })],
}));
children.push(new Paragraph({
  spacing: { after: 80 },
  children: [t('このシミュレーションは「うまくいった場合」をざっくり試すものです。現実の避難では、次のような「見えていない壁」が数多くあります。', { size: 21 })],
}));
const summary = [
  '施設は段階的に壊れ、段階的に直る',
  '飛行機や船は「時間」と「便」で動く',
  '体の弱い人ほど、特別な避難手段が要る',
  '港にたどり着くこと、受け入れ先の準備も壁になる',
  'そして機雷は、海からの避難を長期間止めうる',
];
for (const s of summary) {
  children.push(new Paragraph({
    spacing: { after: 50 },
    indent: { left: 240, hanging: 200 },
    children: [
      new TextRun({ text: '◆ ', font: JP, color: AMBER, bold: true, size: 21 }),
      t(s, { size: 21 }),
    ],
  }));
}
children.push(new Paragraph({
  spacing: { before: 140 },
  shading: { fill: NAVY, type: ShadingType.CLEAR },
  indent: { left: 160, right: 160 },
  border: {
    top: { style: BorderStyle.SINGLE, size: 1, color: NAVY },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: NAVY },
    left: { style: BorderStyle.SINGLE, size: 1, color: NAVY },
    right: { style: BorderStyle.SINGLE, size: 1, color: NAVY },
  },
  children: [
    t('数字だけを見て「これだけ避難できる」と考えるのは危険——というのが、この資料の最大のメッセージです。', { size: 22, bold: true, color: 'FFFFFF' }),
  ],
}));

const doc = new Document({
  creator: 'OKIRES2026',
  title: '現実と違っている部分のやさしい解説',
  styles: { default: { document: { run: { font: JP, size: 21 } } } },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: '避難シミュレーション OKIRES 2026 ｜ 現実との乖離 解説資料　—　', font: JP, size: 16, color: GREY }),
            new TextRun({ children: [PageNumber.CURRENT], font: JP, size: 16, color: GREY }),
          ],
        })],
      }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  const out = path.join(__dirname, '..', 'docs', 'OKIRES2026_現実との乖離_やさしい解説.docx');
  fs.writeFileSync(out, buf);
  console.log('WROTE', out, buf.length, 'bytes');
});
