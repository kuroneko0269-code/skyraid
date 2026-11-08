// 10-7b: 怪獣の破片と煙（描画だけ。10-7a のネフィルガの kaiju2-debris.ts から共通にした）: 部位を壊したときの破片と、墜ちるときの煙。
// 破片は光を受ける小さな四面体（InstancedMesh 1 つ）、煙はインスタンスごとに薄くなる球（InstancedMesh 1 つ）。どちらも出ているときだけ描く
import {
  Color,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  TetrahedronGeometry,
  Vector3,
  type InstancedBufferAttribute,
} from 'three';
import type { KaijuDebrisSpec } from '../../data/kaiju-look';
import { addAlphaAttribute, useInstanceAlpha } from '../fx/instance-alpha';

const GRAVITY = 30;

interface Bit {
  readonly p: Vector3;
  readonly v: Vector3;
  readonly axis: Vector3;
  age: number;
  life: number;
  size: number;
  spin: number;
  readonly color: Color;
}

const m4 = new Matrix4();
const q = new Quaternion();
const s3 = new Vector3();

function bits(n: number): Bit[] {
  return Array.from({ length: n }, () => ({
    p: new Vector3(),
    v: new Vector3(),
    axis: new Vector3(0, 1, 0),
    age: 1,
    life: 0,
    size: 1,
    spin: 0,
    color: new Color(),
  }));
}

export class KaijuDebris {
  readonly shards: InstancedMesh;
  readonly smoke: InstancedMesh;
  private readonly smokeAlpha: InstancedBufferAttribute;
  private readonly shardBits: Bit[];
  private readonly smokeBits: Bit[];
  private nextShard = 0;
  private nextSmoke = 0;
  private readonly shardColors: Color[];
  private readonly smokeColor: Color;

  constructor(
    capacity: number,
    private readonly fx: KaijuDebrisSpec,
  ) {
    this.shardColors = fx.shardColors.map((c) => new Color(c));
    this.smokeColor = new Color(fx.smokeColor);
    const n = Math.max(1, Math.floor(capacity / 2));
    this.shards = new InstancedMesh(
      new TetrahedronGeometry(1, 0),
      new MeshStandardMaterial({ roughness: 0.75, metalness: 0, flatShading: true }),
      n,
    );
    this.smoke = new InstancedMesh(
      new IcosahedronGeometry(1, 1),
      useInstanceAlpha(new MeshBasicMaterial({ transparent: true, depthWrite: false })),
      n,
    );
    this.smokeAlpha = addAlphaAttribute(this.smoke, n);
    for (const m of [this.shards, this.smoke]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      m.visible = false;
    }
    this.shards.castShadow = true;
    this.shardBits = bits(n);
    this.smokeBits = bits(n);
  }

  /** 破片をまとめて（at を中心に、vel の速さに散る速さを足す）。membrane は 2 つ目の色（膜のかけら）を多く混ぜる */
  burst(at: Readonly<Vector3>, vel: Readonly<Vector3>, count: number, membrane: boolean): void {
    for (let i = 0; i < count; i++) {
      const b = this.shardBits[this.nextShard];
      this.nextShard = (this.nextShard + 1) % this.shardBits.length;
      if (!b) continue;
      b.p
        .copy(at)
        .set(
          at.x + (Math.random() - 0.5) * 16,
          at.y + (Math.random() - 0.5) * 10,
          at.z + (Math.random() - 0.5) * 16,
        );
      b.v
        .set(Math.random() - 0.5, Math.random() * 0.8 - 0.2, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(this.fx.debrisSpeed * (0.3 + Math.random() * 0.7))
        .add(vel);
      b.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      b.age = 0;
      b.life = this.fx.debrisLife * (0.6 + Math.random() * 0.4);
      b.size = 1.2 + Math.random() * 3.2;
      b.spin = (Math.random() - 0.5) * 12;
      const pick = membrane && Math.random() < 0.5 ? 1 : Math.random() < 0.7 ? 0 : 2;
      b.color.copy(this.shardColors[pick] ?? this.smokeColor);
    }
  }

  /** 煙を 1 つ（墜ちるとき・壊れた所から） */
  puff(at: Readonly<Vector3>, vel: Readonly<Vector3>, size = 8): void {
    const b = this.smokeBits[this.nextSmoke];
    this.nextSmoke = (this.nextSmoke + 1) % this.smokeBits.length;
    if (!b) return;
    b.p.copy(at);
    b.v.copy(vel);
    b.v.y += 6;
    b.age = 0;
    b.life = this.fx.smokeLife * (0.7 + Math.random() * 0.6);
    b.size = size * (0.7 + Math.random() * 0.6);
    b.axis.set(Math.random(), Math.random(), Math.random()).normalize();
    b.spin = 0;
    b.color.copy(this.smokeColor).multiplyScalar(0.8 + Math.random() * 0.5);
  }

  update(dt: number): void {
    let n = 0;
    for (const b of this.shardBits) {
      if (b.age >= b.life) continue;
      b.age += dt;
      b.v.y -= GRAVITY * dt;
      b.v.multiplyScalar(1 - Math.min(1, dt * 0.4));
      b.p.addScaledVector(b.v, dt);
      q.setFromAxisAngle(b.axis, b.spin * b.age);
      const k = b.size * Math.min(1, (b.life - b.age) * 2);
      m4.compose(b.p, q, s3.set(k, k * 0.35, k * 0.8));
      this.shards.setMatrixAt(n, m4);
      this.shards.setColorAt(n, b.color);
      n++;
    }
    this.finish(this.shards, n);
    n = 0;
    for (const b of this.smokeBits) {
      if (b.age >= b.life) continue;
      b.age += dt;
      b.p.addScaledVector(b.v, dt);
      b.v.multiplyScalar(1 - Math.min(1, dt * 1.5));
      const t = b.age / b.life;
      q.setFromAxisAngle(b.axis, t * 2);
      const k = b.size * (0.6 + 1.6 * t);
      m4.compose(b.p, q, s3.set(k, k, k));
      this.smoke.setMatrixAt(n, m4);
      this.smoke.setColorAt(n, b.color);
      this.smokeAlpha.setX(n, 0.55 * (1 - t) * Math.min(1, t * 8));
      n++;
    }
    this.smokeAlpha.needsUpdate = true;
    this.finish(this.smoke, n);
  }

  private finish(m: InstancedMesh, n: number): void {
    m.count = n;
    m.visible = n > 0;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  clear(): void {
    for (const b of this.shardBits) b.age = b.life;
    for (const b of this.smokeBits) b.age = b.life;
    this.update(0);
  }

  dispose(): void {
    this.shards.geometry.dispose();
    this.smoke.geometry.dispose();
  }
}
