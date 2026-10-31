// 巡航ミサイル（7-2）: 低空を司令部へ直進する。撃墜されないまま司令部に着くと司令部にダメージ（判定は src/missions/defense/）。
// 小さく速い。Three.js 非依存
import { CRUISE_CONFIG } from '../data/defense';
import type { Vec3 } from '../flight/math';
import { StraightFlyer } from './straight-flyer';

export class CruiseMissile extends StraightFlyer {
  constructor() {
    super(CRUISE_CONFIG);
  }

  /** from から司令部の当たり判定の中心 hq へ（当たり判定の球の手前 hqRadius で着弾） */
  aim(from: Readonly<Vec3>, hq: Readonly<Vec3>, hqRadius: number, wave: number): void {
    const dx = hq.x - from.x;
    const dy = hq.y - from.y;
    const dz = hq.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    this.launch(from, { x: dx / len, y: dy / len, z: dz / len }, Math.max(0, len - hqRadius), wave);
  }
}
