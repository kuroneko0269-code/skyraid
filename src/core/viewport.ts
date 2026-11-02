// ゲームの描画の大きさ（8-6）。canvas は CSS で画面いっぱいに置き（index.html の #app > canvas。端まで描く）、
// 描画バッファとカメラの縦横比・HUD の投影は canvas の実際の大きさ（CSS px）に合わせる。
// それまでは window.innerWidth / innerHeight を px で canvas に書いていたが、iOS は起動直後・向きを変えた直後に古い値を返し、
// その後に resize が来ないことがあるので、canvas が画面より小さいまま残って横や下に黒い余白ができていた。
// 測り直すのは canvas の大きさが変わったとき（ResizeObserver）・resize・向きの変更・visualViewport の resize と、
// その少し後（iOS は向きの変更の後に値が遅れて変わる）
import { VIEWPORT_CONFIG } from '../data/app';

/** 今の描画の大きさ（CSS px）。HUD の投影・フォトモードの保存の大きさに使う */
export const viewport = { width: 1, height: 1 };

/** 測った大きさ（0 や NaN なら代わりの値）を整数の CSS px に */
export function pickViewportSize(
  measured: { readonly width: number; readonly height: number },
  fallback: { readonly width: number; readonly height: number },
): { width: number; height: number } {
  const ok = (v: number): boolean => Number.isFinite(v) && v >= 1;
  return {
    width: Math.round(ok(measured.width) ? measured.width : Math.max(1, fallback.width)),
    height: Math.round(ok(measured.height) ? measured.height : Math.max(1, fallback.height)),
  };
}

/** 今の canvas の大きさを測って viewport に入れる。変わっていれば true */
export function measureViewport(canvas: Element): boolean {
  const rect = canvas.getBoundingClientRect();
  const s = pickViewportSize(rect, { width: window.innerWidth, height: window.innerHeight });
  if (s.width === viewport.width && s.height === viewport.height) return false;
  viewport.width = s.width;
  viewport.height = s.height;
  return true;
}

/** canvas の大きさが変わるたびに onChange（最初に 1 回すぐ呼ぶ） */
export function watchViewport(
  canvas: Element,
  onChange: (width: number, height: number) => void,
): void {
  const check = (): void => {
    if (measureViewport(canvas)) onChange(viewport.width, viewport.height);
  };
  measureViewport(canvas);
  onChange(viewport.width, viewport.height);
  // 次の描画の前と、少し後にもう一度（iOS の向きの変更・ツールバーの出入り）
  const later = (): void => {
    requestAnimationFrame(check);
    for (const ms of VIEWPORT_CONFIG.recheckMs) setTimeout(check, ms);
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(check).observe(canvas);
  window.addEventListener('resize', later);
  window.addEventListener('orientationchange', later);
  window.addEventListener('pageshow', later);
  window.visualViewport?.addEventListener('resize', later);
  // 向きの API が無い環境（古いブラウザ・8-3 の compat）では resize と orientationchange だけ
  const orientation: unknown = Reflect.get(screen, 'orientation');
  if (orientation instanceof EventTarget) orientation.addEventListener('change', later);
}
