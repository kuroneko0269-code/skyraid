// PvP の復帰の出現位置の選び方（5-3。5-4 で pvp-arena.ts から分けた）。Three.js 非依存
import { PVP_SPAWN_POINTS } from '../data/pvp';
import type { Vec3 } from '../flight/math';

interface Placed {
  readonly id: number;
  readonly alive: boolean;
  readonly position: Readonly<Vec3>;
}

/** 出現位置のうち、生きている他機（excludeId 以外）までの最短距離が最も大きい所の番号 */
export function farthestSpawn(list: readonly Placed[], excludeId: number): number {
  let best = 0;
  let bestDist = -1;
  PVP_SPAWN_POINTS.forEach((s, i) => {
    let d = Infinity;
    for (const f of list) {
      if (f.id === excludeId || !f.alive) continue;
      const p = f.position;
      d = Math.min(d, Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z));
    }
    if (d > bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}
