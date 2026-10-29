// 当たり判定の幾何（Three.js 非依存）

/**
 * 線分 A→B と球（中心 c・半径 r）の最初の交点の位置を 0〜1 で返す。交差しなければ -1。
 * A がすでに球の中にあれば 0。弾の「前ステップ位置 → 現在位置」に使い、高速弾のすり抜けを防ぐ
 */
export function segmentSphere(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const mx = ax - cx;
  const my = ay - cy;
  const mz = az - cz;
  const c = mx * mx + my * my + mz * mz - r * r;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy + dz * dz;
  if (a === 0) return -1;
  const b = mx * dx + my * dy + mz * dz;
  // 球から遠ざかる向き
  if (b > 0) return -1;
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / a;
  return t <= 1 ? t : -1;
}
