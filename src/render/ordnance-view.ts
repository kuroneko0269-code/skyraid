// ロケット・爆弾（2-6）の描画: 両方を InstancedMesh 1 つ（細長い箱、インスタンスごとの色と大きさ）で描く。
// 追加の draw call は 1。起爆の閃光・火花は missile-view.ts / combat-view.ts（CombatSystem.onExplosion）
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import type { CombatSystem } from '../combat/combat-system';
import type { Pool } from '../combat/pool';
import type { Projectile } from '../combat/projectile';
import { ORDNANCE_VIEW_CONFIG } from '../data/ordnance';

const AXIS_Z = new Vector3(0, 0, 1);
const dir = new Vector3();
const pos = new Vector3();
const scale = new Vector3();
const quat = new Quaternion();
const matrix = new Matrix4();

interface Style {
  readonly length: number;
  readonly width: number;
  readonly color: Color;
}

export class OrdnanceView {
  private readonly mesh: InstancedMesh;
  private readonly rocket: Style;
  private readonly bomb: Style;

  constructor(
    scene: Scene,
    private readonly combat: CombatSystem,
  ) {
    const c = ORDNANCE_VIEW_CONFIG;
    this.rocket = { ...c.rocket, color: new Color(c.rocket.color) };
    this.bomb = { ...c.bomb, color: new Color(c.bomb.color) };
    const capacity = combat.rockets.rockets.capacity + combat.bombs.bombs.capacity;
    this.mesh = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ roughness: 0.5, metalness: 0.3 }),
      capacity,
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    for (let i = 0; i < capacity; i++) this.mesh.setColorAt(i, this.rocket.color);
    this.mesh.count = 0;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** 描画フレームごとに呼ぶ。前ステップ → 今の位置を alpha で補間し、進む向きに向ける */
  update(alpha: number): void {
    let n = this.place(this.combat.rockets.rockets, this.rocket, alpha, 0);
    n = this.place(this.combat.bombs.bombs, this.bomb, alpha, n);
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  private place(pool: Pool<Projectile>, style: Style, alpha: number, start: number): number {
    let n = start;
    for (let i = 0; i < pool.count; i++) {
      const p = pool.get(i);
      pos.set(
        p.px + (p.x - p.px) * alpha,
        p.py + (p.y - p.py) * alpha,
        p.pz + (p.z - p.pz) * alpha,
      );
      dir.set(p.vx, p.vy, p.vz).normalize();
      quat.setFromUnitVectors(AXIS_Z, dir);
      scale.set(style.width, style.width, style.length);
      this.mesh.setMatrixAt(n, matrix.compose(pos, quat, scale));
      this.mesh.setColorAt(n, style.color);
      n++;
    }
    return n;
  }
}
