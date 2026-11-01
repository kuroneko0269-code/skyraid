// 塗装テクスチャ（7-3）のアトラス: 機体の第 2 の UV（uv1）の置き場所。4-3 のパネルラインの UV（uv）は主翼の上下・左右、
// 垂直尾翼の両面が同じ場所を使うので、デカール（上面だけ・両面で読める向き）のために分けた。行（v）の並び:
//   胴体 0〜256 / 右主翼の上面 256〜448・下面 448〜512 / 左主翼の下面 512〜576・上面 576〜768 /
//   垂直尾翼 768〜960（u 0〜0.5 = +X 向きの面、0.5〜1 = −X 向きの面。翼弦が u、高さが v）/
//   水平尾翼の上面 960〜984・下面 984〜1008 / 無地 1008〜1024（u < 0.5 は基本色、u ≥ 0.5 は白）
// 上面と下面は前縁（翼弦 0）を境目で接し、前縁の頂点を共有しても間の色を引き伸ばさない
import { SKIN_TEXTURE } from '../../data/skin-texture';

const H = SKIN_TEXTURE.height;
const R = SKIN_TEXTURE.rows;

export type SkinRegion =
  | 'fuselage'
  | 'wingRightTop'
  | 'wingRightBottom'
  | 'wingLeftBottom'
  | 'wingLeftTop'
  | 'fin'
  | 'stabTop'
  | 'stabBottom'
  | 'clean';

/** 胴体の (前後 s, 周 t) → uv1 */
export function fuselageSkinUv(s: number, t: number): [number, number] {
  return [s, (R.fuselage[0] + t * (R.fuselage[1] - R.fuselage[0])) / H];
}

/** 主翼の (翼幅 u, 翼弦 x) → uv1。side は −1 = 左・+1 = 右、top は上面 */
export function wingSkinUv(side: number, top: boolean, u: number, x: number): [number, number] {
  let row: number;
  if (side > 0)
    row = top
      ? R.wingRightTop[1] - x * span(R.wingRightTop)
      : R.wingRightBottom[0] + x * span(R.wingRightBottom);
  else
    row = top
      ? R.wingLeftTop[0] + x * span(R.wingLeftTop)
      : R.wingLeftBottom[1] - x * span(R.wingLeftBottom);
  return [u, row / H];
}

/** 垂直尾翼の (高さ u, 翼弦 x) → uv1。plusX は +X 向きの面 */
export function finSkinUv(plusX: boolean, u: number, x: number): [number, number] {
  return [plusX ? 0.5 - 0.5 * x : 0.5 + 0.5 * x, (R.fin[0] + u * span(R.fin)) / H];
}

/** 水平尾翼の (翼幅 u, 翼弦 x) → uv1 */
export function stabSkinUv(top: boolean, u: number, x: number): [number, number] {
  const mid = R.stabTop[1];
  return [u, (top ? mid - x * span(R.stabTop) : mid + x * span(R.stabBottom)) / H];
}

/** 無地の場所: paint = 基本色（パイロン・ナセル）、それ以外は白（頂点の色そのまま） */
export function cleanSkinUv(paint: boolean): [number, number] {
  const c = R.clean;
  return [paint ? 0.25 : 0.75, (c[0] + c[1]) / 2 / H];
}

function span(r: readonly [number, number]): number {
  return r[1] - r[0];
}

/**
 * 4-3 の UV（uv）と頂点の色から uv1 を決める（翼は addWingPanel が直接決める）。塗装の頂点の色は白・灰色
 * （塗装の機体では頂点の色が r = g = b ≥ 0.5）。それ以外（インテークの奥・ノズル・ミサイル）は白の場所で色をそのまま
 */
export function defaultSkinUv(
  u: number,
  v: number,
  r: number,
  g: number,
  b: number,
): [number, number] {
  const paint = r === g && g === b && r >= 0.5;
  if (!paint) return cleanSkinUv(false);
  if (v < 0.5) return fuselageSkinUv(Math.min(1, Math.max(0, u)), v * 2);
  return cleanSkinUv(true);
}
