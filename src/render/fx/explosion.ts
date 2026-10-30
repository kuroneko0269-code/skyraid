// 爆発（4-4）: 閃光（1 描画フレームの白い球）→ 火球（膨らみながら白 → 橙 → 黒煙の色へ、0.6 秒）→ 黒煙（上がりながら
// 8 秒で消える）。破片は 2-1 の撃墜の演出（combat-view.ts）。規模は small（着弾）と 機体 / 地上目標 / 燃料タンクの 3 段階。
// 全部の爆発の閃光・火球（フラック・ミサイル発射の閃光も）を InstancedMesh 1 つ、黒煙を SmokeField 1 つ = 2 draw call
import {
  Color,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  type InstancedBufferAttribute,
} from 'three';
import { Pool } from '../../combat/pool';
import {
  FIREBALL_CONFIG as F,
  SMOKE_FIELD_CONFIG,
  type ExplosionScale,
  type ExplosionSpec,
} from '../../data/fx';
import type { Vec3 } from '../../flight/math';
import { emissiveScale } from '../materials';
import { randomDirection } from '../particles';
import { explosionSpec, fireballColor, type Rgb } from './explosion-scale';
import { addAlphaAttribute, useInstanceAlpha } from './instance-alpha';
import type { SmokeField } from './smoke-field';

interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  s0: number;
  s1: number;
  /** 閃光: 1 描画フレームだけ（時間が進んだ次のフレームで消す） */
  flash: boolean;
  drawn: boolean;
  /** 閃光の明るさ（露出後） */
  intensity: number;
  /** 寿命の割合のずれ（火球ごとに色の進み方を少しずらす） */
  delay: number;
}

const IDENTITY = new Quaternion();
const pos = new Vector3();
const scale = new Vector3();
const matrix = new Matrix4();
const color = new Color();
const rgb: Rgb = { r: 0, g: 0, b: 0 };
const dir: Vec3 = { x: 0, y: 0, z: 0 };
const FLASH_COLOR = new Color(F.flashColor);

export class ExplosionField {
  readonly fireballs: InstancedMesh;
  private readonly pool: Pool<Ball>;
  private readonly alpha: InstancedBufferAttribute;

  constructor(private readonly smoke: SmokeField) {
    // 色はインスタンスの色（明るさ込み）で決める。マテリアルの色は露出を打ち消す倍率
    const material = useInstanceAlpha(
      new MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false }),
    );
    material.color.setScalar(emissiveScale(1));
    this.fireballs = new InstancedMesh(new IcosahedronGeometry(0.5, 2), material, F.max);
    this.fireballs.instanceMatrix.setUsage(DynamicDrawUsage);
    this.fireballs.frustumCulled = false;
    this.fireballs.renderOrder = 2;
    this.fireballs.setColorAt(0, FLASH_COLOR);
    this.fireballs.instanceColor?.setUsage(DynamicDrawUsage);
    this.alpha = addAlphaAttribute(this.fireballs, F.max);
    this.fireballs.count = 0;
    this.fireballs.visible = false;
    this.pool = new Pool(F.max, () => ({
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      age: 0,
      life: 1,
      s0: 1,
      s1: 1,
      flash: false,
      drawn: false,
      intensity: 1,
      delay: 0,
    }));
  }

  get count(): number {
    return this.pool.count;
  }

  /** 爆発 1 回: 閃光 → 火球 → 黒煙 */
  explode(x: number, y: number, z: number, scaleName: ExplosionScale): void {
    const s = explosionSpec(scaleName);
    this.flash(x, y, z, s.flashSize);
    for (let i = 0; i < s.fireballs; i++) this.spawnFireball(x, y, z, s, i === 0);
    this.spawnSmoke(x, y, z, s);
  }

  /** 1 描画フレームだけの白い球（ミサイル発射の閃光にも使う） */
  flash(x: number, y: number, z: number, size: number, intensity: number = F.flashIntensity): void {
    const b = this.pool.acquire();
    if (!b) return;
    place(b, x, y, z, 0, 0, 0);
    b.life = 1;
    b.s0 = b.s1 = size;
    b.flash = true;
    b.intensity = intensity;
  }

  /** 短い火球（色は白 → 橙 → 黒煙の色）。フラックとミサイル発射の閃光の続き */
  burst(x: number, y: number, z: number, start: number, end: number, life: number = F.life): void {
    const b = this.pool.acquire();
    if (!b) return;
    place(b, x, y, z, 0, 0, 0);
    b.life = life;
    b.s0 = start;
    b.s1 = end;
  }

  clear(): void {
    this.pool.clear();
    this.fireballs.count = 0;
    this.fireballs.visible = false;
  }

  /** dt 秒進めて描く（dt = 0 のポーズ中も描画は更新する） */
  update(dt: number): void {
    const pool = this.pool;
    const damp = Math.exp(-F.drag * dt);
    for (let i = pool.count - 1; i >= 0; i--) {
      const b = pool.get(i);
      if (b.flash) {
        // 1 度描いたら、時間が進んだフレームで消す
        if (b.drawn && dt > 0) pool.release(i);
        continue;
      }
      b.age += dt;
      if (b.age >= b.life) {
        pool.release(i);
        continue;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      b.vx *= damp;
      b.vy *= damp;
      b.vz *= damp;
    }
    const alpha = this.alpha.array;
    for (let i = 0; i < pool.count; i++) {
      const b = pool.get(i);
      let size = b.s0;
      let a = 1;
      if (b.flash) {
        b.drawn = true;
        color.copy(FLASH_COLOR).multiplyScalar(b.intensity);
      } else {
        const t = b.age / b.life;
        // 膨らみは最初が速い（1 − (1 − t)²）
        size = b.s0 + (b.s1 - b.s0) * (1 - (1 - t) * (1 - t));
        const intensity = fireballColor(Math.min(1, t + b.delay), rgb);
        color.setRGB(rgb.r, rgb.g, rgb.b).convertSRGBToLinear().multiplyScalar(intensity);
        const remain = 1 - t;
        if (remain < F.fadeFraction) a = remain / F.fadeFraction;
      }
      pos.set(b.x, b.y, b.z);
      scale.set(size, size, size);
      this.fireballs.setMatrixAt(i, matrix.compose(pos, IDENTITY, scale));
      this.fireballs.setColorAt(i, color);
      alpha[i] = a;
    }
    this.fireballs.count = pool.count;
    this.fireballs.visible = pool.count > 0;
    if (pool.count === 0) return;
    this.fireballs.instanceMatrix.needsUpdate = true;
    if (this.fireballs.instanceColor) this.fireballs.instanceColor.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }

  private spawnFireball(x: number, y: number, z: number, s: ExplosionSpec, center: boolean): void {
    const b = this.pool.acquire();
    if (!b) return;
    randomDirection(dir);
    const r = center ? 0 : s.spread * Math.cbrt(Math.random());
    const v = center ? 0 : s.fireballSpeed * (0.5 + Math.random() * 0.5);
    place(b, x + dir.x * r, y + dir.y * r, z + dir.z * r, dir.x * v, dir.y * v, dir.z * v);
    const k = center ? 1 : 0.6 + Math.random() * 0.4;
    b.life = F.life * (center ? 1 : 0.8 + Math.random() * 0.3);
    b.s0 = s.fireballStart * k;
    b.s1 = s.fireballEnd * k;
    b.delay = center ? 0 : Math.random() * 0.12;
  }

  /** 黒煙: 火球が黒煙の色に変わるころ（寿命の smokeHandoff）から見え始め、上がりながら 8 秒で消える */
  private spawnSmoke(x: number, y: number, z: number, s: ExplosionSpec): void {
    const style = {
      life: SMOKE_FIELD_CONFIG.life,
      start: s.smokeStart,
      end: s.smokeEnd,
      opacity: SMOKE_FIELD_CONFIG.opacity,
      color: SMOKE_FIELD_CONFIG.color,
    };
    const delay = F.life * F.smokeHandoff;
    for (let i = 0; i < s.smokePuffs; i++) {
      randomDirection(dir);
      const r = s.spread * Math.cbrt(Math.random());
      const v = s.fireballSpeed * 0.4 * Math.random();
      const rise = s.smokeRise * (0.7 + Math.random() * 0.6);
      this.smoke.emit(
        x + dir.x * r,
        y + Math.abs(dir.y) * r,
        z + dir.z * r,
        style,
        dir.x * v,
        Math.abs(dir.y) * v,
        dir.z * v,
        rise,
        delay * (0.8 + Math.random() * 0.4),
      );
    }
  }
}

function place(b: Ball, x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
  b.x = x;
  b.y = y;
  b.z = z;
  b.vx = vx;
  b.vy = vy;
  b.vz = vz;
  b.age = 0;
  b.flash = false;
  b.drawn = false;
  b.intensity = 1;
  b.delay = 0;
}
