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

/**
 * 9-9b: クリックの押し始めの時刻。直前（touchWindowMs 以内）にタッチがあれば、そのクリックはタッチから作られたもの
 * （iOS の互換のクリック。その前に互換の mousedown も来るので、マウスの押し始めは使わない）としてタッチの押し始めを、
 * なければマウスの押し始めを使う
 */
export function pressTimeOf(
  touchAt: number,
  mouseAt: number,
  now: number,
  touchWindowMs: number = TAP_CONFIG.maxMs * 2,
): number {
  return now - touchAt <= touchWindowMs ? touchAt : mouseAt;
}

/** 9-9b: クリックが来たときの押し始めと画面の切り替えの時刻（ms。performance.now()） */
export interface ClickTiming {
  /** 最後に押し始めた時刻（touchstart・pointerdown） */
  readonly pressAt: number;
  /** 最後に画面が切り替わった（新しい画面が出た）時刻 */
  readonly switchAt: number;
  readonly now: number;
  /** 指・マウスのクリックか（キーボードの Enter / Space のクリックは detail が 0 で、捨てない） */
  readonly fromPointer: boolean;
  /**
   * 10-2: 押し始めがまだタップの長さの内のタッチか（pressTimeOf がタッチの時刻を選んだ）。そのタップのクリックは、切り替えから
   * 見張りの時間を過ぎていても捨てる（ハンガーの機体の用意など、切り替えの処理で主スレッドが 1 秒を超えてふさがると、
   * 互換のクリックが見張りの時間の後に届いて、次の画面の同じ位置のボタン（ハンガーの「‹ 戻る」）が押されていた）
   */
  readonly fromTouch?: boolean;
}

/**
 * 画面の切り替えの前に押し始めたタップのクリックか（9-9b）。そのクリックは切り替わる前の画面のためのものなので、
 * 切り替わった後の画面には届けない（iOS はタップの後に互換のクリックを作り、その時点の画面で当たる要素を決める）
 */
export function isStaleClick(c: ClickTiming, guardMs: number = TAP_CONFIG.switchGuardMs): boolean {
  if (!c.fromPointer || c.pressAt >= c.switchAt) return false;
  return c.fromTouch === true || c.now - c.switchAt <= guardMs;
}
