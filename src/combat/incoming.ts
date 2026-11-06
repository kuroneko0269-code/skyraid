// 自分を追っている別陣営のミサイルの数（警告用。9-10b で combat-system.ts から分けた: 300 行の目安）。Three.js 非依存
import type { Pool } from './pool';
import { teamOf } from './target';

interface Chaser {
  readonly target: unknown;
  readonly owner: number;
}

/** target を追っている別陣営のミサイルの数 */
export function countIncoming(pool: Pool<Chaser>, target: { readonly team?: number }): number {
  const team = teamOf(target);
  let n = 0;
  for (let i = 0; i < pool.count; i++) {
    const m = pool.get(i);
    if (m.target === target && m.owner !== team) n++;
  }
  return n;
}
