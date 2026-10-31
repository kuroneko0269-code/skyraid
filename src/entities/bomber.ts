// 爆撃機（7-2）: 決まった高度を目標の上へ直進し、目標の手前で爆弾を落とす（旋回しない）。通り過ぎたら離脱する。
// 落とす時刻は「目標までの水平距離 ≤ 速さ × 落下時間 + 投下の列の半分」で決まり、始点と目標から決定的に計算できる。
// 爆弾そのものは src/combat/enemy-bombs.ts。Three.js 非依存
import { BOMBER_CONFIG, ENEMY_BOMB_CONFIG } from '../data/defense';
import { vec3, type Vec3 } from '../flight/math';
import { StraightFlyer } from './straight-flyer';

export class Bomber extends StraightFlyer {
  /** 狙う地点（地表）と、その施設の番号（FACILITY_KINDS の添字） */
  readonly target: Vec3 = vec3();
  targetIndex = 0;
  /** 次に落とす爆弾の番号（bombs まで落としたら終わり）と、最初の爆弾を落とす進んだ距離 */
  dropped = 0;
  private dropStart = Infinity;

  constructor() {
    super(BOMBER_CONFIG);
  }

  /** from から目標の上空を通る直線で飛ばす（高度は from.y のまま）。groundAtTarget は目標の地表 */
  attack(
    from: Readonly<Vec3>,
    target: Readonly<Vec3>,
    targetIndex: number,
    despawnDistance: number,
    wave: number,
  ): void {
    const dx = target.x - from.x;
    const dz = target.z - from.z;
    const horizontal = Math.hypot(dx, dz);
    const dir = { x: dx / horizontal, y: 0, z: dz / horizontal };
    this.launch(from, dir, horizontal + despawnDistance, wave);
    this.target.x = target.x;
    this.target.y = target.y;
    this.target.z = target.z;
    this.targetIndex = targetIndex;
    this.dropped = 0;
    // 落下時間（空気抵抗なし）の間に水平に進む距離だけ手前で、列の真ん中の爆弾を落とす
    const fall = Math.sqrt((2 * Math.max(1, from.y - target.y)) / ENEMY_BOMB_CONFIG.gravity);
    const c = BOMBER_CONFIG;
    const half = ((c.bombs - 1) / 2) * c.bombInterval * c.speed;
    this.dropStart = horizontal - c.speed * fall - half;
  }

  /**
   * このステップで落とす爆弾の数（step の後に呼ぶ）。進んだ距離が投下の列の位置を越えた分
   */
  takeDrops(): number {
    if (!this.active) return 0;
    const c = BOMBER_CONFIG;
    let n = 0;
    while (
      this.dropped < c.bombs &&
      this.traveled >= this.dropStart + this.dropped * c.bombInterval * c.speed
    ) {
      this.dropped++;
      n++;
    }
    return n;
  }
}
