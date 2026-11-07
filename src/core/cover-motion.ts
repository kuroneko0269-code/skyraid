// 10-1b: 幕のロゴの動きの計算（DOM 非依存。テストする）。ロゴは中心と幅（高さは縦横比から）で表し、
// 測り直しの間はばねで幕の中央を追い（大きさ・位置が変わると少し行き過ぎて戻る = 揺れ）、試みが終わったら
// ばねの形の曲線で決まった時間にタイトルの文字の位置と大きさへ移る（最後は目標にぴたりと合わせる）

/** ロゴの箱: 中心（px）と幅（px） */
export interface LogoBox {
  cx: number;
  cy: number;
  w: number;
}

/** 画面の矩形（getBoundingClientRect の形） */
export interface RectLike {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface CoverLogoSize {
  readonly widthRatio: number;
  readonly heightRatio: number;
  readonly maxWidth: number;
}

/**
 * 幕の中のロゴの箱（幕の中央。幅は幕の幅の widthRatio・maxWidth・高さ heightRatio に収まる幅の小さい方。
 * タイトルの .title-logo-image（width: min(46cqw, 760px); max-height: 24cqh; object-fit: contain）の見える大きさと同じ式）
 */
export function coverLogoBox(cover: RectLike, aspect: number, c: CoverLogoSize): LogoBox {
  const w = Math.min(cover.width * c.widthRatio, c.maxWidth, cover.height * c.heightRatio * aspect);
  return { cx: cover.left + cover.width / 2, cy: cover.top + cover.height / 2, w: Math.max(1, w) };
}

/**
 * 要素の中で実際に見える画像の箱（object-fit: contain。余白は除く）。aspect が 0 以下（文字）なら要素の箱そのまま
 */
export function visibleBox(rect: RectLike, aspect: number): LogoBox {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  if (!(aspect > 0) || rect.height <= 0) return { cx, cy, w: rect.width };
  return { cx, cy, w: Math.min(rect.width, rect.height * aspect) };
}

/** ばねで追う状態（軸ごとの位置と速さ） */
export interface SpringState {
  box: LogoBox;
  v: LogoBox;
}

export interface SpringConfig {
  readonly stiffness: number;
  readonly damping: number;
}

/** ばねで target へ dt 秒進める（細かく刻んで安定させる。半陰的オイラー） */
export function stepSpring(s: SpringState, target: LogoBox, dt: number, c: SpringConfig): void {
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    for (const k of ['cx', 'cy', 'w'] as const) {
      const a = c.stiffness * (target[k] - s.box[k]) - c.damping * s.v[k];
      s.v[k] += a * h;
      s.box[k] += s.v[k] * h;
    }
  }
}

/**
 * 移る間の進み具合（0 → 1）。ばね（同じ硬さ・減衰）の 0 から 1 への応答を、durationMs で必ず 1 になるように
 * 最後の残りを均して足す（少し行き過ぎてから着く）
 */
export function landProgress(ms: number, durationMs: number, c: SpringConfig): number {
  if (ms >= durationMs) return 1;
  if (ms <= 0) return 0;
  const response = (tSec: number): number => {
    const w = Math.sqrt(c.stiffness);
    const z = c.damping / (2 * w);
    if (z >= 1) return 1 - Math.exp(-w * tSec) * (1 + w * tSec);
    const wd = w * Math.sqrt(1 - z * z);
    return (
      1 -
      Math.exp(-z * w * tSec) *
        (Math.cos(wd * tSec) + (z / Math.sqrt(1 - z * z)) * Math.sin(wd * tSec))
    );
  };
  const end = response(durationMs / 1000);
  // 終わりの時刻に 1 へ合うよう、残り（1 - end）を時間に比例して足す
  return response(ms / 1000) + (1 - end) * (ms / durationMs);
}

/** from から to へ p だけ進めた箱 */
export function mixBox(from: LogoBox, to: LogoBox, p: number): LogoBox {
  return {
    cx: from.cx + (to.cx - from.cx) * p,
    cy: from.cy + (to.cy - from.cy) * p,
    w: from.w + (to.w - from.w) * p,
  };
}

/** 2 つの箱のずれ（px。中心の x・y と幅の差の大きい方） */
export function boxError(a: LogoBox, b: LogoBox): number {
  return Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy), Math.abs(a.w - b.w));
}
