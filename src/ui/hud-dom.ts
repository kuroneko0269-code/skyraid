// HUD の DOM 組み立ての補助（要素の生成・ゲージ・CSS 変数）。本体は src/ui/hud.ts
import { HUD_CONFIG } from '../data/hud';
import { TOUCH_CONFIG } from '../data/touch';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent: HTMLElement,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

/** 縦のゲージ（スロットル・アフターバーナー）。fill を scaleY で伸縮する */
export function gauge(parent: HTMLElement, label: string, extraClass = ''): HTMLDivElement {
  const wrap = el('div', extraClass ? `hud-gauge ${extraClass}` : 'hud-gauge', parent);
  const track = el('div', 'hud-gauge-track', wrap);
  const fill = el('div', 'hud-gauge-fill', track);
  el('div', 'hud-gauge-label', wrap, label);
  return fill;
}

/** 数値パラメータを CSS 変数で渡す */
export function applyCssVariables(root: HTMLElement): void {
  const l = HUD_CONFIG.ladder;
  const r = HUD_CONFIG.radar;
  const vars: Record<string, number> = {
    '--hud-ppd-normal': l.pxPerDeg,
    '--hud-ppd-compact': l.compactPxPerDeg,
    '--hud-ladder-w-normal': l.width,
    '--hud-ladder-h-normal': l.height,
    '--hud-ladder-w-compact': l.compactWidth,
    '--hud-ladder-h-compact': l.compactHeight,
    '--hud-rung-w-normal': l.rungWidth,
    '--hud-rung-w-compact': l.compactRungWidth,
    '--hud-horizon-w-normal': l.horizonWidth,
    '--hud-horizon-w-compact': l.compactHorizonWidth,
    '--hud-radar-normal': r.size,
    '--hud-radar-compact': r.compactSize,
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, String(value));
  root.style.setProperty('--hud-touch-shift', `${touchGapShift()}px`);
}

/**
 * タッチ操作中にレーダーを置く横位置のずれ（画面中央から、px）。
 * 左下のスティック（待機位置）の右端と、右下のボタン群・スロットルの左端の間の中央に置く
 */
function touchGapShift(): number {
  const t = TOUCH_CONFIG;
  // + 16 は touch-controls.css の .tc-stick-base の left と同じ余白
  const stickRight = t.edgeMargin + t.stick.radius * 2 + 16;
  const buttonsWidth =
    t.edgeMargin +
    t.throttle.width +
    t.buttons.sliderGap +
    t.buttons.size +
    t.buttons.gap +
    t.buttons.fireSize;
  return (stickRight - buttonsWidth) / 2;
}
