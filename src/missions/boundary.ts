// 戦域の境界（2-4、Three.js 非依存）。水平の円の外に出ると警告し、猶予（returnSeconds）を数える。
// 戻れば猶予は満タンに戻る。failOnExpire が false（フリーフライト）なら数えず、警告だけ
import type { MapDef } from '../data/maps';

export class BoundaryWatch {
  /** 境界の外にいるか */
  outside = false;
  /** 失敗までの残り（秒）。中にいる間は returnSeconds */
  secondsLeft: number;
  /** 猶予を使い切った（ミッション失敗） */
  expired = false;

  constructor(
    readonly map: MapDef,
    readonly failOnExpire: boolean,
  ) {
    this.secondsLeft = map.returnSeconds;
  }

  reset(): void {
    this.outside = false;
    this.expired = false;
    this.secondsLeft = this.map.returnSeconds;
  }

  /** 境界の中心からの水平距離 */
  distance(x: number, z: number): number {
    return Math.hypot(x - this.map.center.x, z - this.map.center.z);
  }

  /** 固定ステップ 1 回分。(x, z) は自機の水平位置 */
  step(x: number, z: number, dt: number): void {
    if (this.expired) return;
    this.outside = this.distance(x, z) > this.map.radius;
    if (!this.outside) {
      this.secondsLeft = this.map.returnSeconds;
      return;
    }
    if (!this.failOnExpire) return;
    this.secondsLeft = Math.max(0, this.secondsLeft - dt);
    if (this.secondsLeft <= 1e-9) this.expired = true;
  }
}
