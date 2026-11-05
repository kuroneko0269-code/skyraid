// 9-6d: 狙われているか（ネフィルガが巡航の間に避ける判断）。9-7 で kaiju2-raid.ts が 300 行を超えたので分けた（Three.js 非依存）
import { KAIJU2_CONFIG } from '../data/kaiju2';
import type { Vec3 } from '../flight/math';

/**
 * 9-6d: 機首（forward。単位）から怪獣（at）が evade.coneDeg 以内・evade.range m 以内か（狙われている。巡航の間に避ける）
 */
export function aimedAt(
  at: Readonly<Vec3>,
  from: Readonly<Vec3>,
  forward: Readonly<Vec3>,
): boolean {
  const e = KAIJU2_CONFIG.evade;
  const dx = at.x - from.x;
  const dy = at.y - from.y;
  const dz = at.z - from.z;
  const d = Math.hypot(dx, dy, dz);
  if (d > e.range || d < 1) return false;
  return (
    (dx * forward.x + dy * forward.y + dz * forward.z) / d >= Math.cos((e.coneDeg * Math.PI) / 180)
  );
}
