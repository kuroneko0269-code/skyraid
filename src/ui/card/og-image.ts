// OGP の固定の画像（8-5。public/brand/og-image.jpg）の描画: 記録カードと同じ固定の背景に、ロゴと英語の一言。
// アプリからは使わない（scripts/og-image.js が開発サーバーのページで読み込んで JPEG にする）
import { CARD_CONFIG, CARD_SIZES } from '../../data/card';
import { drawBackground, drawShade, font } from './card-canvas';

/** 英語の固定の文（リンクのプレビューは言語を選べないため英語。docs/decisions.md の 8-5） */
const LINES = {
  kicker: 'BROWSER 3D FLIGHT SHOOTER',
  title: 'Dogfights · Ring Races · Kaiju Raids',
  sub: 'Solo campaign & 2–4 player online — free, no install',
} as const;

/** 1200×630 の canvas に描く。logo は public/brand/logo.png（読めなければ文字のロゴ） */
export function drawOgImage(logo: HTMLImageElement | null): HTMLCanvasElement {
  const { width: w, height: h } = CARD_SIZES.wide;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  const C = CARD_CONFIG.color;
  const footerTop = h - CARD_CONFIG.footerHeight;
  drawBackground(ctx, w, h, null);
  drawShade(ctx, w, h, footerTop);
  const left = Math.round(h * CARD_CONFIG.margin);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 8;
  let y = 150;
  if (logo && logo.naturalWidth > 0) {
    const lw = 760;
    const lh = (lw * logo.naturalHeight) / logo.naturalWidth;
    ctx.drawImage(logo, left, y - lh, lw, lh);
  } else {
    ctx.font = font(110, 'display');
    ctx.fillStyle = C.text;
    ctx.fillText('SkyRaid', left, y);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.accent;
  ctx.font = font(30, 'display');
  ctx.fillText('TITAN SKIES', left, (y += 60));
  ctx.fillRect(left, y + 26, 120, 3);
  ctx.font = font(26, 'body');
  ctx.fillText(LINES.kicker, left, (y += 100));
  ctx.fillStyle = C.text;
  ctx.font = font(50, 'display');
  ctx.fillText(LINES.title, left, (y += 66));
  ctx.fillStyle = C.sub;
  ctx.font = font(26, 'body');
  ctx.fillText(LINES.sub, left, y + 56);
  ctx.fillStyle = C.text;
  ctx.font = font(26, 'display');
  ctx.fillText('SkyRaid: Titan Skies', left, footerTop + 48);
  return canvas;
}
