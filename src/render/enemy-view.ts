// 敵機（2-3）の描画: 機体モデル（4-3。Kestrel 型の濃い灰色 + 赤いアクセント、キャノピーも入れた 1 つのジオメトリ）を
// InstancedMesh 1 つ、敵の曳光弾を InstancedMesh 1 つ。
// 対空砲の曳光弾（黄色、2-6）も敵の曳光弾と同じ InstancedMesh で描く。追加の draw call は 2（機数・弾数によらない）
import {
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import type { Bullet } from '../combat/gun';
import type { Pool } from '../combat/pool';
import { TRACER_CONFIG } from '../data/effects';
import { ENEMY_VIEW_CONFIG } from '../data/scene';
import { AIRCRAFT_MODEL_CONFIG, type AircraftDetail } from '../data/aircraft-model';
import { ENEMY_SHAPE } from '../data/aircraft-shapes';
import type { EnemyAircraft } from '../entities/enemy-aircraft';
import type { Vec3 } from '../flight/math';
import { hitFlashScale } from './aircraft-model/accumulator';
import { buildAircraft } from './aircraft-model/build';
import { createPaintMaterial } from './aircraft-model/material';
import { TracerRenderer } from './tracers';

const WHITE = new Color(0xffffff);
const FLASH = new Color().setScalar(
  hitFlashScale(ENEMY_SHAPE.bodyColor, ENEMY_VIEW_CONFIG.hitFlash),
);
const matrix = new Matrix4();
const pos = new Vector3();
const prevPos = new Vector3();
const quat = new Quaternion();
const prevQuat = new Quaternion();
const scale = new Vector3(1, 1, 1);

export class EnemyView {
  private readonly mesh: InstancedMesh;
  private readonly tracers: TracerRenderer;
  private detail: AircraftDetail = 'high';
  private readonly allPools: readonly Pool<Bullet>[];

  constructor(
    scene: Scene,
    private readonly enemies: readonly EnemyAircraft[],
    bulletPools: readonly Pool<Bullet>[],
    /** 色の違う敵の弾（対空砲。2-6）。bulletPools の後に描く */
    extraPools: readonly { pool: Pool<Bullet>; color: number }[] = [],
  ) {
    this.mesh = new InstancedMesh(
      enemyGeometry('high'),
      createPaintMaterial(),
      Math.max(1, enemies.length),
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    for (let i = 0; i < enemies.length; i++) this.mesh.setColorAt(i, WHITE);
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

  /** 画質（「低」は LOD）。変わったらジオメトリを作り直す */
  setDetail(detail: AircraftDetail): void {
    if (detail === this.detail) return;
    this.detail = detail;
    this.mesh.geometry.dispose();
    this.mesh.geometry = enemyGeometry(detail);
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
      // 色は頂点の色。被弾中はインスタンスの色を明るくする
      this.mesh.setColorAt(n, e.flashTimer > 0 ? FLASH : WHITE);
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

/** 敵機のジオメトリ（翼端のミサイル 2 発は見た目だけ。キャノピーは不透明の暗い色で機体に入れる） */
function enemyGeometry(detail: AircraftDetail): BufferGeometry {
  return buildAircraft(ENEMY_SHAPE, {
    detail,
    missiles: AIRCRAFT_MODEL_CONFIG.enemyMissiles,
    mergeCanopy: true,
  }).body;
}
