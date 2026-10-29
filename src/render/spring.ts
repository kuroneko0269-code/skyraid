// カメラ用の臨界減衰スプリング（Three.js 非依存）
import type { Vec3 } from '../flight/math';

/**
 * 臨界減衰スプリング 1 軸分を dt 秒進める（厳密解なので dt が大きくても発散しない）。
 * omega は固有角振動数（1/秒）。結果は state に書き込む
 */
export function stepCriticalSpring(
  state: { value: number; velocity: number },
  target: number,
  omega: number,
  dt: number,
): void {
  const x0 = state.value - target;
  const v0 = state.velocity;
  const e = Math.exp(-omega * dt);
  const k = v0 + omega * x0;
  state.value = target + (x0 + k * dt) * e;
  state.velocity = (v0 - omega * k * dt) * e;
}

/** 3 軸のスプリング。毎フレームのアロケーションを避けるため状態を持ち回す */
export class SpringVec3 {
  readonly value: Vec3 = { x: 0, y: 0, z: 0 };
  readonly velocity: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly axis = { value: 0, velocity: 0 };

  /** 速度 0 で target に置く */
  reset(target: Readonly<Vec3>): void {
    this.value.x = target.x;
    this.value.y = target.y;
    this.value.z = target.z;
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.velocity.z = 0;
  }

  update(target: Readonly<Vec3>, omega: number, dt: number): Readonly<Vec3> {
    this.stepAxis('x', target.x, omega, dt);
    this.stepAxis('y', target.y, omega, dt);
    this.stepAxis('z', target.z, omega, dt);
    return this.value;
  }

  private stepAxis(key: 'x' | 'y' | 'z', target: number, omega: number, dt: number): void {
    const a = this.axis;
    a.value = this.value[key];
    a.velocity = this.velocity[key];
    stepCriticalSpring(a, target, omega, dt);
    this.value[key] = a.value;
    this.velocity[key] = a.velocity;
  }
}
