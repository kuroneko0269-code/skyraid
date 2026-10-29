// 機銃の熱ゲージ（Three.js 非依存）
import type { GunHeatSpec } from '../data/weapons';

/**
 * 1 発ごとに perShot 上がり、撃っていない状態が coolDelay 秒続くと coolRate/秒で下がる。
 * 1 に達するとオーバーヒートで撃てなくなり、recoverBelow まで冷えると解除（引き金を離していなくても）
 */
export class GunHeat {
  /** 0〜1 */
  value = 0;
  overheated = false;
  private sinceShot = Infinity;

  constructor(private readonly spec: GunHeatSpec) {}

  get canFire(): boolean {
    return !this.overheated;
  }

  /** 1 発撃った。上限に達したらオーバーヒート */
  addShot(): void {
    this.sinceShot = 0;
    this.value = Math.min(1, this.value + this.spec.perShot);
    if (this.value >= 1) this.overheated = true;
  }

  /** 固定ステップの終わりに呼ぶ。このステップで撃ったかどうかは addShot で分かる */
  step(dt: number): void {
    // オーバーヒート中は待ち時間なしで冷やし始める（撃てないので）
    if (this.overheated || this.sinceShot >= this.spec.coolDelay) {
      this.value = Math.max(0, this.value - this.spec.coolRate * dt);
    }
    this.sinceShot += dt;
    if (this.overheated && this.value <= this.spec.recoverBelow) this.overheated = false;
  }

  reset(): void {
    this.value = 0;
    this.overheated = false;
    this.sinceShot = Infinity;
  }
}
