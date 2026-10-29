// 地形の LOD 選択（Three.js 非依存）。描画距離から段の境目を決め、距離で段を選ぶ

/** 描画しない段 */
export const LOD_HIDDEN = -1;

export interface Box3Like {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/**
 * 段 i を使う距離の上限の列。ratios は段 0..n-2 の上限（描画距離に対する比）で、
 * 最後の段は描画距離まで使う
 */
export function lodThresholds(drawDistance: number, ratios: readonly number[]): number[] {
  return [...ratios.map((r) => r * drawDistance), drawDistance];
}

/**
 * 距離に応じた LOD の段を選ぶ。thresholds は lodThresholds() の戻り値。
 * minLevel より細かい段は使わない（画質「低」用）。描画距離より遠ければ LOD_HIDDEN。
 * current（今の段）を渡すと、粗くする（または消す）ときだけ hysteresis m 余分に待つ
 */
export function selectLod(
  distance: number,
  thresholds: readonly number[],
  minLevel = 0,
  current: number = LOD_HIDDEN,
  hysteresis = 0,
): number {
  let level = thresholds.findIndex((limit) => distance < limit);
  if (level === LOD_HIDDEN) level = thresholds.length; // 描画距離の外
  // 今より粗い段になるときは、今の段の上限 + hysteresis を超えるまで今の段を保つ
  const currentLimit = thresholds[current];
  if (current !== LOD_HIDDEN && level > current && currentLimit !== undefined) {
    if (distance < currentLimit + hysteresis) level = current;
  }
  if (level >= thresholds.length) return LOD_HIDDEN;
  return Math.max(level, Math.min(minLevel, thresholds.length - 1));
}

/** 点から軸平行な箱までの最短距離（中なら 0） */
export function distanceToBox(x: number, y: number, z: number, box: Readonly<Box3Like>): number {
  const dx = Math.max(box.minX - x, 0, x - box.maxX);
  const dy = Math.max(box.minY - y, 0, y - box.maxY);
  const dz = Math.max(box.minZ - z, 0, z - box.maxZ);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** 一辺 segments 分割のチャンク 1 枚の三角形数 */
export function chunkTriangles(segments: number): number {
  return 2 * segments * segments;
}

/** チャンクの縁。0 = -Z 側、1 = +X 側、2 = +Z 側、3 = -X 側 */
export type ChunkEdge = 0 | 1 | 2 | 3;
export const CHUNK_EDGES: readonly ChunkEdge[] = [0, 1, 2, 3];

/** 縁の k 番目（0..segments）の頂点の番号。格子は x 方向に i、z 方向に j で j * (segments + 1) + i */
export function edgeVertexIndex(segments: number, edge: ChunkEdge, k: number): number {
  const row = segments + 1;
  switch (edge) {
    case 0:
      return k;
    case 1:
      return k * row + segments;
    case 2:
      return segments * row + k;
    case 3:
      return k * row;
  }
}

/**
 * 隣のチャンクが粗い段（頂点が step 個おき）のとき、縁の頂点の高さを隣の縁の直線上に寄せて
 * ひび割れ（T 字の継ぎ目の隙間）をなくす。step = 1 で元の高さに戻す。
 * positions は xyz の並び、baseHeights は元の高さ（頂点番号順）
 */
export function stitchEdge(
  positions: Float32Array,
  baseHeights: Readonly<Float32Array>,
  segments: number,
  edge: ChunkEdge,
  step: number,
): void {
  for (let k = 0; k <= segments; k++) {
    const v = edgeVertexIndex(segments, edge, k);
    const offset = k % step;
    if (offset === 0) {
      positions[v * 3 + 1] = baseHeights[v] ?? 0;
      continue;
    }
    const a = baseHeights[edgeVertexIndex(segments, edge, k - offset)] ?? 0;
    const b = baseHeights[edgeVertexIndex(segments, edge, k - offset + step)] ?? 0;
    positions[v * 3 + 1] = a + ((b - a) * offset) / step;
  }
}
