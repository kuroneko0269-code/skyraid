// メニューのタップの判定（8-6。DOM 非依存。DOM は src/ui/tap-rescue.ts、数値は src/data/touch.ts の TAP_CONFIG）
import { TAP_CONFIG } from '../data/touch';

export interface TapGesture {
  /** 押した点から離した点まで・途中の最大の移動（CSS px） */
  readonly moved: number;
  /** 押していた時間（ms） */
  readonly ms: number;
  /** 離した点とボタンの枠（CSS px） */
  readonly end: { readonly x: number; readonly y: number };
  readonly rect: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
  /** 押している間に、上の要素がスクロールした量（CSS px） */
  readonly scrolled: number;
}

/** ボタンのタップとして扱うか */
export function isTap(g: TapGesture, c: typeof TAP_CONFIG = TAP_CONFIG): boolean {
  if (!(g.moved <= c.slopPx) || !(g.ms <= c.maxMs) || !(g.scrolled <= c.scrollPx)) return false;
  const m = c.marginPx;
  const r = g.rect;
  return (
    g.end.x >= r.left - m &&
    g.end.x <= r.right + m &&
    g.end.y >= r.top - m &&
    g.end.y <= r.bottom + m
  );
}
