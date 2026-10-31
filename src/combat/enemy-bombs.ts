// 爆撃機（7-2）の爆弾: 投下した機体の速度のまま放し、重力だけの放物線（空気抵抗なし）で落ちる。
// 地表（海の上は海面）に着いたら起爆を知らせる（ダメージは呼び出し側。協力のクライアントは見た目だけ）。Three.js 非依存
import { ENEMY_BOMB_CONFIG } from '../data/defense';
import type { Vec3 } from '../flight/math';
import type { GroundHeightFn } from './gun';
import { Pool } from './pool';

export interface EnemyBomb {
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
}

export class EnemyBombs {
  readonly bombs: Pool<EnemyBomb>;

  constructor(
    private readonly groundHeight: GroundHeightFn,
    private readonly onImpact: (x: number, y: number, z: number) => void,
  ) {
    this.bombs = new Pool(ENEMY_BOMB_CONFIG.maxCount, () => ({
      x: 0,
      y: 0,
      z: 0,
      px: 0,
      py: 0,
      pz: 0,
      vx: 0,
      vy: 0,
      vz: 0,
    }));
  }

  reset(): void {
    this.bombs.clear();
  }

  /** at から velocity で放す（満杯なら落とさない） */
  drop(at: Readonly<Vec3>, velocity: Readonly<Vec3>): void {
    const b = this.bombs.acquire();
    if (!b) return;
    b.x = b.px = at.x;
    b.y = b.py = at.y - 2;
    b.z = b.pz = at.z;
    b.vx = velocity.x;
    b.vy = velocity.y;
    b.vz = velocity.z;
  }

  step(dt: number): void {
    const g = ENEMY_BOMB_CONFIG.gravity;
    const pool = this.bombs;
    for (let i = pool.count - 1; i >= 0; i--) {
      const b = pool.get(i);
      b.px = b.x;
      b.py = b.y;
      b.pz = b.z;
      b.x += b.vx * dt;
      b.y += b.vy * dt - (g * dt * dt) / 2;
      b.z += b.vz * dt;
      b.vy -= g * dt;
      const ground = Math.max(0, this.groundHeight(b.x, b.z));
      if (b.y <= ground) {
        this.onImpact(b.x, ground, b.z);
        pool.release(i);
      }
    }
  }
}
