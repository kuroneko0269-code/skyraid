// 敵機（2-3）の描画: プレースホルダー機体と同じ形を赤で InstancedMesh 1 つ、敵の曳光弾を InstancedMesh 1 つ。
// 対空砲の曳光弾（黄色、2-6）も敵の曳光弾と同じ InstancedMesh で描く。追加の draw call は 2（機数・弾数によらない）
import {
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import type { Bullet } from '../combat/gun';
import type { Pool } from '../combat/pool';
import { TRACER_CONFIG } from '../data/effects';
import { ENEMY_VIEW_CONFIG } from '../data/scene';
import type { EnemyAircraft } from '../entities/enemy-aircraft';
import type { Vec3 } from '../flight/math';
import { createPlaceholderAircraftGeometry } from './aircraft-mesh';
import { TracerRenderer } from './tracers';

const WHITE = new Color(0xffffff);
const color = new Color();
const matrix = new Matrix4();
const pos = new Vector3();
const prevPos = new Vector3();
const quat = new Quaternion();
const prevQuat = new Quaternion();
const scale = new Vector3(1, 1, 1);

export class EnemyView {
  private readonly mesh: InstancedMesh;
  private readonly tracers: TracerRenderer;
  private readonly baseColor = new Color(ENEMY_VIEW_CONFIG.color);
  private readonly allPools: readonly Pool<Bullet>[];

  constructor(
    scene: Scene,
    private readonly enemies: readonly EnemyAircraft[],
    bulletPools: readonly Pool<Bullet>[],
    /** 色の違う敵の弾（対空砲。2-6）。bulletPools の後に描く */
    extraPools: readonly { pool: Pool<Bullet>; color: number }[] = [],
  ) {
    const material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.6,
      metalness: 0.3,
    });
    this.mesh = new InstancedMesh(
      createPlaceholderAircraftGeometry(),
      material,
      Math.max(1, enemies.length),
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    for (let i = 0; i < enemies.length; i++) this.mesh.setColorAt(i, this.baseColor);
    this.mesh.count = 0;
    this.mesh.visible = false;

    this.allPools = [...bulletPools, ...extraPools.map((e) => e.pool)];
    const capacity = this.allPools.reduce((sum, p) => sum + p.capacity, 0);
    const colors = [
      ...bulletPools.map(() => TRACER_CONFIG.enemyColor),
      ...extraPools.map((e) => e.color),
    ];
    this.tracers = new TracerRenderer(
      Math.max(1, capacity),
      TRACER_CONFIG.enemyColor,
      extraPools.length > 0 ? colors : null,
    );
    scene.add(this.mesh, this.tracers.mesh);
  }

  /** 描画フレームごとに呼ぶ。前ステップと現ステップの間を alpha で補間する */
  update(alpha: number, camera: Readonly<Vec3>): void {
    let n = 0;
    for (const e of this.enemies) {
      if (!e.active) continue;
      const a = e.aircraft;
      const p = a.state.position;
      const q = a.prevPosition;
      prevPos.set(q.x, q.y, q.z);
      pos.set(p.x, p.y, p.z);
      pos.lerpVectors(prevPos, pos, alpha);
      const o = a.state.orientation;
      const po = a.prevOrientation;
      prevQuat.set(po.x, po.y, po.z, po.w);
      quat.set(o.x, o.y, o.z, o.w);
      quat.slerpQuaternions(prevQuat, quat, alpha);
      this.mesh.setMatrixAt(n, matrix.compose(pos, quat, scale));
      const flash = e.flashTimer > 0 ? ENEMY_VIEW_CONFIG.hitFlash : 0;
      this.mesh.setColorAt(n, color.copy(this.baseColor).lerp(WHITE, flash));
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
    this.tracers.update(this.allPools, alpha, camera);
  }
}
