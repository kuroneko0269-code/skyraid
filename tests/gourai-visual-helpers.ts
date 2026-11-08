// 10-7c: メカ怪獣ゴウライの見た目のテストの道具: 体の当たりの箱からの外への距離・撃てる球の中の頂点の割合
import type { Vector3 } from 'three';
import { GOURAI_HULL, GOURAI_TARGET_SPHERES } from '../src/data/gourai';

/** 体の座標の点（前 −Z・右 +X）が体の当たりの箱（armored は前の装甲の箱も）から外へ出ている距離（m） */
export function outside(p: Readonly<Vector3>, armored: boolean): number {
  const f = -p.z;
  let best = Infinity;
  for (const b of GOURAI_HULL) {
    if (b.armor && !armored) continue;
    const d = Math.max(
      b.forward[0] - f,
      f - b.forward[1],
      b.right[0] - p.x,
      p.x - b.right[1],
      b.up[0] - p.y,
      p.y - b.up[1],
      0,
    );
    best = Math.min(best, d);
  }
  return best;
}

/** 頂点のうち、撃てる球（+3m）の中にある割合 */
export function inSpheres(pos: {
  readonly count: number;
  getX(i: number): number;
  getY(i: number): number;
  getZ(i: number): number;
}): number {
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const f = -pos.getZ(i);
    if (
      GOURAI_TARGET_SPHERES.some(
        (s) => Math.hypot(s.forward - f, s.right - x, s.up - y) <= s.radius + 3,
      )
    )
      n++;
  }
  return pos.count > 0 ? n / pos.count : 0;
}
