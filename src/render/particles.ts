// プールで管理する小さなパーティクル（火花・破片）。1 種類につき InstancedMesh 1 つ = 1 draw call
import {
  BoxGeometry,
  DynamicDrawUsage,
  Euler,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type Material,
} from 'three';
import { Pool } from '../combat/pool';
import type { Vec3 } from '../flight/math';

export interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** 回転（rad）と回転の速さ（rad/s） */
  rx: number;
  ry: number;
  rz: number;
  wx: number;
  wy: number;
  wz: number;
  /** 寸法（箱の各辺） */
  sx: number;
  sy: number;
  sz: number;
  age: number;
  life: number;
}

export interface ParticleStyle {
  gravity: number;
  /** 寿命のうち最後のこの割合で小さくなって消える（1 なら最初から縮む） */
  shrinkFraction: number;
  /** カメラからの距離 × この値を寸法の下限にする（0 なら下限なし） */
  sizePerMeter: number;
}

const pos = new Vector3();
const scale = new Vector3();
const quat = new Quaternion();
const euler = new Euler();
const matrix = new Matrix4();

export class ParticleSystem {
  readonly mesh: InstancedMesh;
  readonly pool: Pool<Particle>;

  constructor(
    capacity: number,
    material: Material,
    private readonly style: ParticleStyle,
  ) {
    this.pool = new Pool(capacity, newParticle);
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    // インスタンスが毎フレーム動くので、作成時の境界球での視錐台カリングはしない
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** 新しいパーティクルを取り出す（満杯なら null）。位置などは呼び出し側で入れる */
  spawn(life: number): Particle | null {
    const p = this.pool.acquire();
    if (!p) return null;
    p.age = 0;
    p.life = life;
    p.rx = p.ry = p.rz = 0;
    p.wx = p.wy = p.wz = 0;
    return p;
  }

  clear(): void {
    this.pool.clear();
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** dt 秒進めてインスタンス行列を書く。dt = 0（ポーズ中）でも描画は更新する */
  update(dt: number, camera: Readonly<Vec3>): void {
    const pool = this.pool;
    const s = this.style;
    for (let i = pool.count - 1; i >= 0; i--) {
      const p = pool.get(i);
      p.age += dt;
      if (p.age >= p.life) {
        pool.release(i);
        continue;
      }
      p.vy -= s.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rx += p.wx * dt;
      p.ry += p.wy * dt;
      p.rz += p.wz * dt;
    }
    for (let i = 0; i < pool.count; i++) {
      const p = pool.get(i);
      const remain = 1 - p.age / p.life;
      let k = Math.min(1, remain / s.shrinkFraction);
      if (s.sizePerMeter > 0) {
        const d = Math.hypot(p.x - camera.x, p.y - camera.y, p.z - camera.z);
        k *= Math.max(1, (d * s.sizePerMeter) / p.sx);
      }
      pos.set(p.x, p.y, p.z);
      quat.setFromEuler(euler.set(p.rx, p.ry, p.rz));
      scale.set(p.sx * k, p.sy * k, p.sz * k);
      this.mesh.setMatrixAt(i, matrix.compose(pos, quat, scale));
    }
    this.mesh.count = pool.count;
    this.mesh.visible = pool.count > 0;
    if (pool.count > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function newParticle(): Particle {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    wx: 0,
    wy: 0,
    wz: 0,
    sx: 1,
    sy: 1,
    sz: 1,
    age: 0,
    life: 1,
  };
}

/** 球の中のランダムな向き（単位ベクトル）を out に入れる */
export function randomDirection(out: Vec3, rng: () => number = Math.random): Vec3 {
  const z = rng() * 2 - 1;
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  out.x = r * Math.cos(a);
  out.y = r * Math.sin(a);
  out.z = z;
  return out;
}
