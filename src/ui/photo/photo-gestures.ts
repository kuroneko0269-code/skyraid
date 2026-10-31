// フォトモード（7-A）のカメラの操作: 1 本指 / 左ドラッグで回転、2 本指ドラッグ / 右ドラッグ（中ドラッグ）で平行移動、
// ピンチ / ホイールでズーム。ダブルタップ（「UI を隠す」から戻す）。canvas の上だけで受ける
import { PHOTO_UI } from '../../data/photo';

export interface PhotoGestureHandlers {
  rotate(dx: number, dy: number): void;
  pan(dx: number, dy: number): void;
  /** 距離の倍率（> 1 で離れる） */
  zoom(factor: number): void;
  wheel(deltaY: number): void;
  doubleTap(): void;
}

interface Pointer {
  x: number;
  y: number;
  button: number;
}

export function attachPhotoGestures(
  el: HTMLElement,
  enabled: () => boolean,
  h: PhotoGestureHandlers,
): void {
  const pointers = new Map<number, Pointer>();
  let lastTap = 0;
  let pinch = 0;
  let mid = { x: 0, y: 0 };
  let moved = false;

  const twoFinger = (): { d: number; x: number; y: number } | null => {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return null;
    return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  el.addEventListener('pointerdown', (e) => {
    if (!enabled()) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
    moved = false;
    const t = twoFinger();
    if (t) {
      pinch = t.d;
      mid = { x: t.x, y: t.y };
    }
  });

  el.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p || !enabled()) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    if (pointers.size >= 2) {
      p.x = e.clientX;
      p.y = e.clientY;
      const t = twoFinger();
      if (!t) return;
      if (pinch > 0 && t.d > 0) h.zoom(pinch / t.d);
      h.pan(t.x - mid.x, t.y - mid.y);
      pinch = t.d;
      mid = { x: t.x, y: t.y };
      return;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    // 右・中ボタン（マウス）は平行移動、左ボタンと指は回転
    if (p.button === 1 || p.button === 2) h.pan(dx, dy);
    else h.rotate(dx, dy);
  });

  const end = (e: PointerEvent): void => {
    if (!pointers.delete(e.pointerId)) return;
    if (e.type === 'pointerup' && !moved && pointers.size === 0 && enabled()) {
      const now = performance.now();
      if (now - lastTap < PHOTO_UI.doubleTapMs) {
        lastTap = 0;
        h.doubleTap();
      } else lastTap = now;
    }
    const t = twoFinger();
    pinch = t ? t.d : 0;
    if (t) mid = { x: t.x, y: t.y };
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  el.addEventListener(
    'wheel',
    (e) => {
      if (!enabled()) return;
      e.preventDefault();
      h.wheel(e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY);
    },
    { passive: false },
  );
  el.addEventListener('contextmenu', (e) => {
    if (enabled()) e.preventDefault();
  });
}
