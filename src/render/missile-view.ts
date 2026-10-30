// ミサイル（2-2）の描画: 本体・煙の尾・フレアの光点。
// 追加の draw call は 本体 1 + 煙 1 + フレア 1 の最大 3（数によらない）。破片・火花は combat-view.ts。
// 起爆の閃光は 4-4 から爆発（src/render/fx/explosion.ts）の閃光・火球に置き換えた
import {
  BoxGeometry,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import type { CombatSystem } from '../combat/combat-system';
import type { Missile } from '../combat/missile';
import { FLARE_VIEW_CONFIG, MISSILE_VIEW_CONFIG, SMOKE_CONFIG } from '../data/effects';
import type { Vec3 } from '../flight/math';
import { EMISSIVE_CONFIG } from '../data/sky';
import { createEmissiveMaterial } from './materials';
import { SmokeTrail } from './smoke';

/** ミサイルごとの煙の出し方の状態（発射の通し番号が変わったら作り直す） */
interface TrailState {
  serial: number;
  timer: number;
  x: number;
  y: number;
  z: number;
}

const AXIS_Z = new Vector3(0, 0, 1);
const dir = new Vector3();
const pos = new Vector3();
const scale = new Vector3();
const quat = new Quaternion();
const matrix = new Matrix4();

export class MissileView {
  private readonly bodies: InstancedMesh;
  private readonly smoke = new SmokeTrail();
  private readonly flares: InstancedMesh;
  private readonly trails = new Map<Missile, TrailState>();

  constructor(
    scene: Scene,
    private readonly combat: CombatSystem,
  ) {
    const m = MISSILE_VIEW_CONFIG;
    const missileCount = combat.missiles.missiles.capacity;
    this.bodies = new InstancedMesh(
      new BoxGeometry(m.width, m.width, m.length),
      new MeshStandardMaterial({ color: m.color, roughness: 0.5, metalness: 0.2 }),
      missileCount,
    );
    this.bodies.instanceMatrix.setUsage(DynamicDrawUsage);
    this.bodies.frustumCulled = false;
    this.bodies.count = 0;
    this.bodies.visible = false;

    this.flares = new InstancedMesh(
      new IcosahedronGeometry(0.5, 0),
      createEmissiveMaterial(FLARE_VIEW_CONFIG.color, EMISSIVE_CONFIG.flare),
      combat.flares.flares.capacity,
    );
    this.flares.instanceMatrix.setUsage(DynamicDrawUsage);
    this.flares.frustumCulled = false;
    this.flares.count = 0;
    this.flares.visible = false;

    scene.add(this.bodies, this.smoke.mesh, this.flares);
  }

  /** 描画フレームごとに呼ぶ。alpha は固定ステップの補間係数、frameSeconds はポーズ中 0 */
  update(alpha: number, frameSeconds: number, camera: Readonly<Vec3>): void {
    this.updateMissiles(alpha, frameSeconds);
    this.smoke.update(frameSeconds);
    this.updateFlares(alpha, camera);
  }

  reset(): void {
    this.smoke.clear();
    this.trails.clear();
  }

  private updateMissiles(alpha: number, frameSeconds: number): void {
    const pool = this.combat.missiles.missiles;
    const len = MISSILE_VIEW_CONFIG.length;
    for (let i = 0; i < pool.count; i++) {
      const m = pool.get(i);
      const p = m.position;
      const q = m.prevPosition;
      const x = q.x + (p.x - q.x) * alpha;
      const y = q.y + (p.y - q.y) * alpha;
      const z = q.z + (p.z - q.z) * alpha;
      dir.set(m.velocity.x, m.velocity.y, m.velocity.z).normalize();
      quat.setFromUnitVectors(AXIS_Z, dir);
      pos.set(x, y, z);
      scale.set(1, 1, 1);
      this.bodies.setMatrixAt(i, matrix.compose(pos, quat, scale));
      if (this.combat.missiles.isBurning(m)) {
        // 煙は機体の尾部から出す
        this.emitSmoke(
          m,
          x - dir.x * len * 0.5,
          y - dir.y * len * 0.5,
          z - dir.z * len * 0.5,
          frameSeconds,
        );
      }
    }
    this.bodies.count = pool.count;
    this.bodies.visible = pool.count > 0;
    if (pool.count > 0) this.bodies.instanceMatrix.needsUpdate = true;
  }

  /** 前回出した位置から今の位置までの間に、ゲーム内時間 interval ごとに 1 つずつ並べて出す */
  private emitSmoke(m: Missile, x: number, y: number, z: number, frameSeconds: number): void {
    let s = this.trails.get(m);
    if (!s) {
      s = { serial: -1, timer: 0, x, y, z };
      this.trails.set(m, s);
    }
    if (s.serial !== m.serial) {
      s.serial = m.serial;
      s.timer = 0;
      s.x = x;
      s.y = y;
      s.z = z;
    }
    const interval = SMOKE_CONFIG.interval;
    s.timer += frameSeconds;
    let n = 0;
    while (s.timer >= interval) {
      s.timer -= interval;
      n++;
    }
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      this.smoke.emit(s.x + (x - s.x) * t, s.y + (y - s.y) * t, s.z + (z - s.z) * t);
    }
    if (n > 0) {
      s.x = x;
      s.y = y;
      s.z = z;
    }
  }

  private updateFlares(alpha: number, camera: Readonly<Vec3>): void {
    const c = FLARE_VIEW_CONFIG;
    const pool = this.combat.flares.flares;
    for (let i = 0; i < pool.count; i++) {
      const f = pool.get(i);
      const p = f.position;
      const q = f.prevPosition;
      pos.set(q.x + (p.x - q.x) * alpha, q.y + (p.y - q.y) * alpha, q.z + (p.z - q.z) * alpha);
      const d = Math.hypot(pos.x - camera.x, pos.y - camera.y, pos.z - camera.z);
      const k = 1 + (Math.random() * 2 - 1) * c.flicker;
      const size = Math.max(c.size, d * c.sizePerMeter) * k;
      scale.set(size, size, size);
      this.flares.setMatrixAt(i, matrix.compose(pos, quat.identity(), scale));
    }
    this.flares.count = pool.count;
    this.flares.visible = pool.count > 0;
    if (pool.count > 0) this.flares.instanceMatrix.needsUpdate = true;
  }
}
