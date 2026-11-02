// 記録カード（8-5）の配置（DOM 非依存）: 載せる文（CardModel）と大きさから、描く文字と線の一覧を作る。
// 文字の幅は measure（描画では canvas の measureText、テストでは近似）で測り、枠に収まらない文字は小さくし、
// 下限でも収まらなければ末尾を「…」にする。描画は ui/card/card-canvas.ts
import { CARD_CONFIG } from '../data/card';

export interface CardFact {
  readonly label: string;
  readonly value: string;
}

/** カードに載せる文（今の言語。ui/card/card-model.ts が作る） */
export interface CardModel {
  readonly gameName: string;
  readonly mode: string;
  readonly stage: string;
  /** 大きな見出し（MISSION COMPLETE・FINISH・防衛成功など） */
  readonly headline: string;
  readonly success: boolean;
  readonly rank: string | null;
  /** スコアまたはタイム */
  readonly metric: CardFact;
  /** 添える数値（0〜2 個） */
  readonly facts: readonly CardFact[];
  readonly aircraft: string;
  readonly skin: string;
  /** 載せないときは null */
  readonly pilot: string | null;
  readonly date: string;
  /** 遊べる URL（表示用） */
  readonly url: string;
}

export type CardFontFamily = 'display' | 'body';
export type CardColor = keyof typeof CARD_CONFIG.color;

/** 文字の幅（px）を測る */
export type CardMeasure = (text: string, sizePx: number, family: CardFontFamily) => number;

export interface CardTextOp {
  readonly kind: 'text';
  /** 何の文か（テスト・点検で探す） */
  readonly id: string;
  readonly text: string;
  /** 基準点（align の側の端・文字のベースライン） */
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly family: CardFontFamily;
  readonly color: CardColor;
  readonly align: 'left' | 'right' | 'center';
  /** 測った幅（px） */
  readonly width: number;
}

export interface CardRuleOp {
  readonly kind: 'rule';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly color: CardColor;
}

export type CardOp = CardTextOp | CardRuleOp;

export interface CardLayout {
  readonly width: number;
  readonly height: number;
  /** 下の帯の上端（px） */
  readonly footerTop: number;
  readonly ops: readonly CardOp[];
}

/** 文字の箱（ベースラインから上 0.82・下 0.24。日本語の字面と英字の下がりを含む） */
export function textBox(op: CardTextOp): { x0: number; x1: number; y0: number; y1: number } {
  const x0 =
    op.align === 'left' ? op.x : op.align === 'right' ? op.x - op.width : op.x - op.width / 2;
  return { x0, x1: x0 + op.width, y0: op.y - op.size * 0.82, y1: op.y + op.size * 0.24 };
}

const ELLIPSIS = '…';

/** maxWidth に収まる大きさ（size から minSize まで 4% ずつ下げる）と文。下限でも収まらなければ末尾を「…」に */
export function fitText(
  text: string,
  size: number,
  minSize: number,
  maxWidth: number,
  family: CardFontFamily,
  measure: CardMeasure,
): { text: string; size: number; width: number } {
  let s = size;
  let w = measure(text, s, family);
  while (w > maxWidth && s > minSize) {
    s = Math.max(minSize, s * 0.96);
    w = measure(text, s, family);
  }
  if (w <= maxWidth) return { text, size: s, width: w };
  const chars = Array.from(text);
  while (chars.length > 0) {
    chars.pop();
    const cut = `${chars.join('').trimEnd()}${ELLIPSIS}`;
    w = measure(cut, s, family);
    if (w <= maxWidth) return { text: cut, size: s, width: w };
  }
  return { text: '', size: s, width: 0 };
}

export function layoutCard(
  m: CardModel,
  size: { readonly width: number; readonly height: number },
  measure: CardMeasure,
): CardLayout {
  const W = size.width;
  const H = size.height;
  const f = CARD_CONFIG.font;
  // 文字の倍率: 1200×630 を 1 として、幅と高さの小さい方に合わせる
  const k = Math.min(W / 1200, H / 630);
  const margin = Math.round(Math.min(W, H) * CARD_CONFIG.margin);
  const footerH = Math.round(CARD_CONFIG.footerHeight * k * (H > W ? 1.25 : 1));
  const footerTop = H - footerH;
  const ops: CardOp[] = [];
  const text = (
    id: string,
    t: string,
    x: number,
    y: number,
    px: number,
    family: CardFontFamily,
    color: CardColor,
    maxWidth: number,
    o: { min?: number; align?: CardTextOp['align'] } = {},
  ): CardTextOp | null => {
    const fit = fitText(t, px, o.min ?? px, maxWidth, family, measure);
    if (!fit.text) return null;
    const op: CardTextOp = {
      kind: 'text',
      id,
      text: fit.text,
      x,
      y,
      size: fit.size,
      family,
      color,
      align: o.align ?? 'left',
      width: fit.width,
    };
    ops.push(op);
    return op;
  };

  // 右の列: 評価（ランク）。無ければ左の列が全幅
  const rankCol = m.rank ? Math.round(W * 0.27) : 0;
  const left = margin;
  const contentW = W - margin * 2 - (rankCol > 0 ? rankCol + margin * 0.5 : 0);
  // 縦の並び: 上の余白から帯の上までに、ゲーム名 → 線 → モード → ステージ → 見出し → 数値の見出し → 数値 → 添える数値
  const steps = [
    f.brand,
    34,
    f.mode + 22,
    f.stage + 14,
    f.headline + 26,
    f.metricLabel + 34,
    f.metric + 6,
    f.fact + 26,
  ];
  const used = steps.reduce((a, b) => a + b, 0) * k;
  // 縦に余る分（正方形など）は各段に配る
  const spare = Math.max(0, footerTop - margin * 1.4 - used);
  const gap = spare / steps.length;
  let y = margin;
  const step = (i: number): number => {
    y += (steps[i] ?? 0) * k + (i === 0 ? 0 : gap);
    return y;
  };

  text('game', m.gameName, left, step(0), f.brand * k, 'display', 'accent', contentW);
  ops.push({
    kind: 'rule',
    x: left,
    y: step(1) - 22 * k,
    w: Math.min(contentW, 120 * k),
    h: 3 * k,
    color: 'line',
  });
  text('mode', m.mode, left, step(2), f.mode * k, 'body', 'accent', contentW);
  text('stage', m.stage, left, step(3), f.stage * k, 'display', 'text', contentW, {
    min: f.stageMin * k,
  });
  text(
    'headline',
    m.headline,
    left,
    step(4),
    f.headline * k,
    'display',
    m.success ? 'success' : 'fail',
    contentW,
  );
  text('metricLabel', m.metric.label, left, step(5), f.metricLabel * k, 'body', 'sub', contentW);
  const metricY = step(6);
  const metric = text(
    'metric',
    m.metric.value,
    left,
    metricY,
    f.metric * k,
    'display',
    'text',
    contentW,
    {
      min: f.metricMin * k,
    },
  );
  // 添える数値: 1 行に「・」なしで並べる（収まらなければ縮める）
  const factY = step(7);
  let fx = left;
  m.facts.forEach((fact, i) => {
    const t = fact.value ? `${fact.label} ${fact.value}` : fact.label;
    const op = text(`fact${i}`, t, fx, factY, f.fact * k, 'body', 'sub', left + contentW - fx, {
      min: f.fact * k * 0.7,
    });
    if (op) fx += op.width + 28 * k;
  });

  if (m.rank && rankCol > 0) {
    const cx = W - margin - rankCol / 2;
    const rankSize = Math.min(f.rank * k, (footerTop - margin) * 0.62);
    const baseY = (metric ? metricY : footerTop - margin) + 4 * k;
    text(
      'rankLabel',
      'RANK',
      cx,
      baseY - rankSize * 0.86,
      f.mode * k,
      'display',
      'accent',
      rankCol,
      {
        align: 'center',
      },
    );
    text(
      'rank',
      m.rank,
      cx,
      baseY,
      rankSize,
      'display',
      m.rank === 'S' ? 'rankS' : 'rank',
      rankCol,
      {
        align: 'center',
        min: rankSize * 0.5,
      },
    );
  }

  // 下の帯: 1 行目 機体・塗装 ／ 日付、2 行目 パイロット ／ URL（右揃え）
  const fs = f.footer * k * (H > W ? 1.15 : 1);
  const fMin = f.footerMin * k;
  const row1 = footerTop + footerH * 0.42;
  const row2 = footerTop + footerH * 0.82;
  const right = W - margin;
  const date = text('date', m.date, right, row1, fs, 'body', 'sub', W * 0.3, {
    align: 'right',
    min: fMin,
  });
  const url = text('url', m.url, right, row2, fs, 'body', 'accent', W * 0.45, {
    align: 'right',
    min: fMin,
  });
  const room = (op: CardTextOp | null): number => right - left - (op ? op.width + 32 * k : 0);
  text('machine', `${m.aircraft}${CARD_SEP}${m.skin}`, left, row1, fs, 'body', 'text', room(date), {
    min: fMin,
  });
  if (m.pilot)
    text('pilot', `PILOT  ${m.pilot}`, left, row2, fs, 'body', 'text', room(url), { min: fMin });
  return { width: W, height: H, footerTop, ops };
}

/** 機体と塗装の間 */
const CARD_SEP = '  /  ';
