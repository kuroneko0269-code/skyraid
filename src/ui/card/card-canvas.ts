// 記録カード（8-5）の描画: Canvas 2D だけで描く（外部サービス・追加のライブラリなし）。背景は結果の時点の場面（レンダラーの
// 出力を 1 枚）、描けなければ固定のデザイン。その上に文字の側を暗くする帯を重ね、core/card-layout.ts の配置で文字を描く。
// フォント（Rajdhani）の読み込みを待ってから描く（オフラインで読めなければ上限の時間の後に代わりのフォントで描く）
import {
  layoutCard,
  type CardFontFamily,
  type CardLayout,
  type CardModel,
} from '../../core/card-layout';
import { CARD_CONFIG } from '../../data/card';

const C = CARD_CONFIG.color;

export function font(size: number, family: CardFontFamily): string {
  const weight = CARD_CONFIG.fontWeight[family];
  return `${weight} ${Math.round(size * 10) / 10}px ${CARD_CONFIG.fontFamily[family]}`;
}

/** フォントの読み込みを待つ（上限 fontWaitMs。失敗・非対応でも先へ進む） */
export async function waitForCardFonts(): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts) return;
  const loads = Promise.all(CARD_CONFIG.waitFonts.map((f) => fonts.load(f).catch(() => [])))
    .then(() => fonts.ready)
    .then(() => undefined);
  await Promise.race([
    loads,
    new Promise<void>((resolve) => {
      setTimeout(resolve, CARD_CONFIG.fontWaitMs);
    }),
  ]);
}

/** カードを描いた canvas と、その配置（点検用） */
export function drawCard(
  model: CardModel,
  size: { readonly width: number; readonly height: number },
  scene: HTMLCanvasElement | null,
): { canvas: HTMLCanvasElement; layout: CardLayout } {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  const measure = (text: string, px: number, family: CardFontFamily): number => {
    ctx.font = font(px, family);
    return ctx.measureText(text).width;
  };
  const layout = layoutCard(model, size, measure);
  drawBackground(ctx, size.width, size.height, scene);
  drawShade(ctx, size.width, size.height, layout.footerTop);
  for (const op of layout.ops) {
    if (op.kind === 'rule') {
      ctx.fillStyle = C[op.color];
      ctx.fillRect(op.x, op.y, op.w, op.h);
      continue;
    }
    ctx.font = font(op.size, op.family);
    ctx.textAlign = op.align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C[op.color];
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = Math.max(2, op.size * 0.12);
    ctx.fillText(op.text, op.x, op.y);
  }
  ctx.shadowBlur = 0;
  return { canvas, layout };
}

/** 場面の画像を枠いっぱいに（はみ出す分は切る）。無ければ固定のデザイン（夜明けの空・地平線・薄い格子） */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scene: HTMLCanvasElement | null,
): void {
  ctx.fillStyle = C.background;
  ctx.fillRect(0, 0, w, h);
  if (scene && scene.width > 0 && scene.height > 0) {
    const s = Math.max(w / scene.width, h / scene.height);
    const sw = w / s;
    const sh = h / s;
    ctx.drawImage(scene, (scene.width - sw) / 2, (scene.height - sh) / 2, sw, sh, 0, 0, w, h);
    return;
  }
  const horizon = h * 0.68;
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, CARD_CONFIG.sky[0]);
  sky.addColorStop(0.6, CARD_CONFIG.sky[1]);
  sky.addColorStop(1, CARD_CONFIG.sky[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon);
  const glow = ctx.createRadialGradient(w * 0.78, horizon, 0, w * 0.78, horizon, w * 0.45);
  glow.addColorStop(0, 'rgba(255, 190, 120, 0.55)');
  glow.addColorStop(1, 'rgba(255, 190, 120, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, horizon);
  const sea = ctx.createLinearGradient(0, horizon, 0, h);
  sea.addColorStop(0, '#0a2236');
  sea.addColorStop(1, C.background);
  ctx.fillStyle = sea;
  ctx.fillRect(0, horizon, w, h - horizon);
  // 海面の遠近の線
  ctx.strokeStyle = 'rgba(110, 240, 255, 0.12)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 8; i++) {
    const y = horizon + (h - horizon) * (i / 8) ** 1.8;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  for (let i = -8; i <= 8; i++) {
    ctx.beginPath();
    ctx.moveTo(w * 0.78 + i * w * 0.012, horizon);
    ctx.lineTo(w * 0.78 + i * w * 0.18, h);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255, 220, 170, 0.7)';
  ctx.fillRect(0, horizon - 1, w, 2);
}

/** 文字の側（左）と下の帯を暗くする */
export function drawShade(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  footerTop: number,
): void {
  const s = CARD_CONFIG.shade;
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, `rgba(3, 8, 15, ${s.left})`);
  g.addColorStop(0.55, `rgba(3, 8, 15, ${(s.left + s.right) / 2})`);
  g.addColorStop(1, `rgba(3, 8, 15, ${s.right})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, footerTop);
  ctx.fillStyle = `rgba(3, 8, 15, ${s.footer})`;
  ctx.fillRect(0, footerTop, w, h - footerTop);
  ctx.fillStyle = C.line;
  ctx.fillRect(0, footerTop, w, Math.max(1, Math.round(h / 315)));
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Failed to create PNG'));
    }, 'image/png');
  });
}
