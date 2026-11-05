// タッチ操作（仮想コントローラー）の寸法を CSS 変数にする（touch-controls.ts から分けた。9-2 で 300 行を超えたため。値は変えていない）
import { TOUCH_CONFIG } from '../data/touch';

/** data/touch.ts の数値を CSS 変数にする（配置は CSS 側で safe-area と合わせて計算） */
export function applyCssVariables(root: HTMLElement): void {
  const c = TOUCH_CONFIG;
  const vars: Record<string, string> = {
    '--tc-margin': `${c.edgeMargin}px`,
    '--tc-stick-size': `${c.stick.radius * 2}px`,
    '--tc-knob-size': `${c.stick.knobSize}px`,
    '--tc-zone-width': `${c.stick.zoneWidthRatio * 100}%`,
    '--tc-zone-top': `${c.stick.zoneTopRatio * 100}%`,
    // ボタン・スロットル・ヨーは操作設定の大きさ（--tc-scale。4-11）を掛ける
    '--tc-button-size': `calc(${c.buttons.size}px * var(--tc-scale, 1))`,
    '--tc-fire-size': `calc(${c.buttons.fireSize}px * var(--tc-scale, 1))`,
    '--tc-gap': `${c.buttons.gap}px`,
    '--tc-slider-gap': `${c.buttons.sliderGap}px`,
    '--tc-throttle-width': `calc(${c.throttle.width}px * var(--tc-scale, 1))`,
    '--tc-throttle-height': `min(${c.throttle.heightRatio * 100}cqh, ${c.throttle.maxHeight}px)`,
    '--tc-yaw-size': `calc(${c.yaw.size}px * var(--tc-scale, 1))`,
    '--tc-yaw-top': `${c.yaw.top}px`,
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
}
