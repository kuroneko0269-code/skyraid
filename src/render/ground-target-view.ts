// 地上目標（2-6）の描画: 種類ごとの部品（箱・円柱）を、全目標ぶんまとめて InstancedMesh 2 つ（箱 1・円柱 1）で描く。
// 対空砲の砲塔・砲身は自機（予測位置）を向き、レーダーのアンテナは回る。壊れると部品を低く暗くした残骸になり、
// 30 秒の黒煙（InstancedMesh 1 つ）を出す。追加の draw call は最大 3。破片は 2-1 の撃墜の演出（combat-view.ts）
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { Pool } from '../combat/pool';
import {
  GROUND_SMOKE_CONFIG as SMOKE,
  GROUND_TARGET_CONFIG,
  GROUND_WRECK_CONFIG as WRECK,
  type GroundTargetPart,
} from '../data/ground-targets';
import { WIND_CONFIG } from '../data/wind';
import type { GroundTarget } from '../entities/ground-target';

const WHITE = new Color(0xffffff);
const FLASH = 0.75;
const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);
/** 1 つの目標の部品の数の上限（箱・円柱それぞれ） */
const PARTS_PER_TARGET = 4;

const color = new Color();
const world = new Matrix4();
const local = new Matrix4();
const tmp = new Matrix4();
const pos = new Vector3();
const scale = new Vector3();
const quat = new Quaternion();
const turn = new Quaternion();

interface Puff {
  x: number;
  y: number;
  z: number;
  age: number;
}

function createInstanced(geometry: BufferGeometry, count: number): InstancedMesh {
  const mesh = new InstancedMesh(
    geometry,
    new MeshStandardMaterial({ roughness: 0.8, metalness: 0.15 }),
    count,
  );
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  for (let i = 0; i < count; i++) mesh.setColorAt(i, WHITE);
  mesh.count = 0;
  mesh.visible = false;
  return mesh;
}

export class GroundTargetView {
  private readonly boxes: InstancedMesh;
  private readonly cylinders: InstancedMesh;
  private readonly smoke: InstancedMesh;
  private readonly puffs = new Pool<Puff>(SMOKE.max, () => ({ x: 0, y: 0, z: 0, age: 0 }));
  /** 目標ごとの、次の煙の玉までの時間 */
  private readonly smokeTimers: number[];
  private readonly drift: { x: number; z: number };
  private boxCount = 0;
  private cylinderCount = 0;

  constructor(
    scene: Scene,
    private readonly targets: readonly GroundTarget[],
  ) {
    const n = Math.max(1, targets.length) * PARTS_PER_TARGET;
    this.boxes = createInstanced(new BoxGeometry(1, 1, 1), n);
    this.cylinders = createInstanced(new CylinderGeometry(0.5, 0.5, 1, 20), n);
    const material = new MeshStandardMaterial({
      color: SMOKE.color,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: SMOKE.opacity,
      depthWrite: false,
    });
    this.smoke = new InstancedMesh(new IcosahedronGeometry(0.5, 1), material, SMOKE.max);
    this.smoke.instanceMatrix.setUsage(DynamicDrawUsage);
    this.smoke.frustumCulled = false;
    this.smoke.count = 0;
    this.smoke.visible = false;
    this.smokeTimers = targets.map(() => 0);
    const a = (WIND_CONFIG.direction * Math.PI) / 180;
    this.drift = { x: Math.cos(a) * SMOKE.driftSpeed, z: Math.sin(a) * SMOKE.driftSpeed };
    scene.add(this.boxes, this.cylinders, this.smoke);
  }

  /** 描画フレームごとに呼ぶ。frameSeconds は煙を進める時間（ポーズ中 0） */
  update(frameSeconds: number): void {
    this.boxCount = this.cylinderCount = 0;
    this.targets.forEach((t, i) => {
      if (!t.deployed) {
        this.smokeTimers[i] = 0;
        return;
      }
      this.placeTarget(t);
      if (t.wrecked && t.wreckSeconds < GROUND_TARGET_CONFIG.smokeSeconds)
        this.emitSmoke(t, i, frameSeconds);
    });
    finish(this.boxes, this.boxCount);
    finish(this.cylinders, this.cylinderCount);
    this.updateSmoke(frameSeconds);
  }

  /** 煙を全部消す（飛行のやり直し） */
  reset(): void {
    this.puffs.clear();
    this.smoke.count = 0;
    this.smoke.visible = false;
  }

  private placeTarget(t: GroundTarget): void {
    const wrecked = t.wrecked;
    const flash = t.flashTimer > 0 ? FLASH : 0;
    // 目標の足元・向き（方位は -Z から +X へ回る向きが正。Y 軸まわりの回転は逆向き）
    const b = t.base;
    pos.set(b.x, b.y, b.z);
    world.compose(pos, quat.setFromAxisAngle(AXIS_Y, -t.heading), scale.set(1, 1, 1));
    for (const part of t.spec.parts) {
      if (wrecked && part.role) continue;
      partMatrix(local, part, t, wrecked);
      tmp.multiplyMatrices(world, local);
      color.set(part.color);
      if (wrecked) color.multiplyScalar(WRECK.colorScale);
      else color.lerp(WHITE, flash);
      const mesh = part.shape === 'box' ? this.boxes : this.cylinders;
      const index = part.shape === 'box' ? this.boxCount++ : this.cylinderCount++;
      if (index >= mesh.instanceMatrix.count) continue;
      mesh.setMatrixAt(index, tmp);
      mesh.setColorAt(index, color);
    }
  }

  private emitSmoke(t: GroundTarget, i: number, dt: number): void {
    let timer = (this.smokeTimers[i] ?? 0) - dt;
    const r = t.spec.visualRadius * 0.5;
    while (timer <= 0) {
      timer += SMOKE.interval;
      const p = this.puffs.acquire();
      if (!p) break;
      p.x = t.base.x + (Math.random() * 2 - 1) * r;
      p.y = t.base.y + t.spec.centerHeight * 0.5;
      p.z = t.base.z + (Math.random() * 2 - 1) * r;
      p.age = 0;
    }
    this.smokeTimers[i] = timer;
  }

  private updateSmoke(dt: number): void {
    const pool = this.puffs;
    for (let i = pool.count - 1; i >= 0; i--) {
      const p = pool.get(i);
      p.age += dt;
      if (p.age >= SMOKE.life) {
        pool.release(i);
        continue;
      }
      p.x += this.drift.x * dt;
      p.y += SMOKE.riseSpeed * dt;
      p.z += this.drift.z * dt;
    }
    quat.identity();
    for (let i = 0; i < pool.count; i++) {
      const p = pool.get(i);
      const k = p.age / SMOKE.life;
      let size = SMOKE.startSize + (SMOKE.endSize - SMOKE.startSize) * Math.sqrt(k);
      const remain = 1 - k;
      if (remain < SMOKE.fadeFraction) size *= remain / SMOKE.fadeFraction;
      this.smoke.setMatrixAt(i, world.compose(pos.set(p.x, p.y, p.z), quat, scale.setScalar(size)));
    }
    this.smoke.count = pool.count;
    this.smoke.visible = pool.count > 0;
    if (pool.count > 0) this.smoke.instanceMatrix.needsUpdate = true;
  }
}

/** 部品 1 つの、目標の足元から見た行列（残骸は高さ方向に縮める） */
function partMatrix(
  out: Matrix4,
  part: GroundTargetPart,
  t: GroundTarget,
  wrecked: boolean,
): Matrix4 {
  const s = part.size;
  const o = part.offset;
  const squash = wrecked ? WRECK.heightScale : 1;
  pos.set(o.x, o.y * squash, o.z);
  quat.identity();
  if (part.shape === 'cylinder' && part.axis === 'x') {
    // 縦の円柱を Z 軸まわりに倒して、長さを X 方向へ（ローカルの x・y・z = 高さの直径・長さ・奥行きの直径）
    quat.setFromAxisAngle(AXIS_Z, -Math.PI / 2);
    scale.set(s.y * squash, s.x, s.z);
  } else scale.set(s.x, s.y * squash, s.z);
  if (part.role === 'dish') quat.setFromAxisAngle(AXIS_Y, t.dishAngle);
  else if (part.role === 'turret' || part.role === 'barrel') {
    // 砲塔は方位だけ、砲身は方位 + 仰角。どちらも砲塔の軸（足元の真上）を中心に回す
    turn.setFromAxisAngle(AXIS_Y, -(t.gun.yaw - t.heading));
    if (part.role === 'barrel') {
      pos.set(o.x, 0, o.z).applyQuaternion(turn);
      pos.y = o.y;
      quat.copy(turn).multiply(tmpQuat.setFromAxisAngle(AXIS_X, t.gun.pitch));
      // 根元から前（-Z）へ長さの半分
      pos.add(tmpVec.set(0, 0, -s.z / 2).applyQuaternion(quat));
    } else quat.copy(turn);
  }
  return out.compose(pos, quat, scale);
}

const tmpQuat = new Quaternion();
const tmpVec = new Vector3();

function finish(mesh: InstancedMesh, n: number): void {
  const count = Math.min(n, mesh.instanceMatrix.count);
  mesh.count = count;
  mesh.visible = count > 0;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
