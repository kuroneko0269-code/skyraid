// 防衛戦（7-2）の描画: 爆撃機（輸送機と同じ機体モデルを暗い色で）・巡航ミサイル（細い円柱 + 赤い先端）・爆撃機の爆弾（暗い箱）。
// どれも InstancedMesh 1 つずつ（draw call 3）。出ていないものは描かない。味方の対空砲の曳光弾は enemy-view.ts（色違いの弾）
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AircraftDetail } from '../data/aircraft-model';
import { TRANSPORT_SHAPE } from '../data/aircraft-shapes';
import { DEFENSE_VIEW } from '../data/defense';
import type { StraightFlyer } from '../entities/straight-flyer';
import type { MissionProps } from '../missions/mission-props';
import { buildAircraft } from './aircraft-model/build';
import { createPaintMaterial } from './aircraft-model/material';

const matrix = new Matrix4();
const forward = new Vector3();
const up = new Vector3(0, 1, 0);
const right = new Vector3();
const back = new Vector3();
const upv = new Vector3();
const pos = new Vector3();
const quat = new Quaternion();
const scale = new Vector3(1, 1, 1);
const AXIS_Z = new Vector3(0, 0, -1);
const BOMBER = new Color(DEFENSE_VIEW.bomberTint);
const FLASH = new Color(0xffffff);

function createInstanced(
  geometry: BufferGeometry,
  material: Material,
  count: number,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  for (let i = 0; i < count; i++) mesh.setColorAt(i, FLASH);
  mesh.count = 0;
  mesh.visible = false;
  return mesh;
}

/** 巡航ミサイル: 前方 −Z を向いた円柱（長さ 6.5m）+ 先端の円錐 + 小さな翼 */
function createCruiseGeometry(): BufferGeometry {
  const body = new CylinderGeometry(0.32, 0.32, 5.4, 10);
  body.rotateX(Math.PI / 2);
  const nose = new CylinderGeometry(0, 0.32, 1.1, 10);
  nose.rotateX(-Math.PI / 2);
  nose.translate(0, 0, -3.25);
  const wing = new BoxGeometry(2.4, 0.06, 0.6);
  wing.translate(0, 0, 0.4);
  const fin = new BoxGeometry(0.06, 0.8, 0.5);
  fin.translate(0, 0.35, 2.4);
  const g = mergeGeometries([
    body.toNonIndexed(),
    nose.toNonIndexed(),
    wing.toNonIndexed(),
    fin.toNonIndexed(),
  ]);
  return g;
}

export class DefenseView {
  private readonly bombers: InstancedMesh;
  private readonly cruise: InstancedMesh;
  private readonly bombs: InstancedMesh;
  private detail: AircraftDetail = 'high';

  constructor(
    scene: Scene,
    private readonly props: MissionProps,
  ) {
    this.bombers = createInstanced(
      buildAircraft(TRANSPORT_SHAPE, { detail: 'high', missiles: 0, mergeCanopy: true }).body,
      createPaintMaterial(),
      props.bombers.length,
    );
    this.cruise = createInstanced(
      createCruiseGeometry(),
      new MeshStandardMaterial({ color: DEFENSE_VIEW.cruiseColor, roughness: 0.5, metalness: 0.3 }),
      props.cruiseMissiles.length,
    );
    this.bombs = createInstanced(
      new BoxGeometry(0.5, 0.5, 2.2),
      new MeshStandardMaterial({ color: DEFENSE_VIEW.bombColor, roughness: 0.8 }),
      props.enemyBombs.bombs.capacity,
    );
    scene.add(this.bombers, this.cruise, this.bombs);
  }

  setDetail(detail: AircraftDetail): void {
    if (detail === this.detail) return;
    this.detail = detail;
    this.bombers.geometry.dispose();
    this.bombers.geometry = buildAircraft(TRANSPORT_SHAPE, {
      detail,
      missiles: 0,
      mergeCanopy: true,
    }).body;
  }

  update(alpha: number): void {
    this.flyers(this.bombers, this.props.bombers, alpha, BOMBER);
    this.flyers(this.cruise, this.props.cruiseMissiles, alpha, null);
    const pool = this.props.enemyBombs.bombs;
    for (let i = 0; i < pool.count; i++) {
      const b = pool.get(i);
      forward.set(b.vx, b.vy, b.vz).normalize();
      quat.setFromUnitVectors(AXIS_Z, forward);
      pos.set(
        b.px + (b.x - b.px) * alpha,
        b.py + (b.y - b.py) * alpha,
        b.pz + (b.z - b.pz) * alpha,
      );
      matrix.compose(pos, quat, scale);
      this.bombs.setMatrixAt(i, matrix);
    }
    finish(this.bombs, pool.count);
  }

  private flyers(
    mesh: InstancedMesh,
    list: readonly StraightFlyer[],
    alpha: number,
    tint: Color | null,
  ): void {
    let n = 0;
    for (const t of list) {
      if (!t.active) continue;
      const p = t.position;
      const q = t.prevPosition;
      const d = t.direction;
      forward.set(d.x, d.y, d.z).normalize();
      right.crossVectors(forward, up).normalize();
      upv.crossVectors(right, forward);
      back.copy(forward).negate();
      matrix
        .makeBasis(right, upv, back)
        .setPosition(
          q.x + (p.x - q.x) * alpha,
          q.y + (p.y - q.y) * alpha,
          q.z + (p.z - q.z) * alpha,
        );
      mesh.setMatrixAt(n, matrix);
      if (tint) mesh.setColorAt(n, t.flashTimer > 0 ? FLASH : tint);
      n++;
    }
    finish(mesh, n);
  }
}

function finish(mesh: InstancedMesh, n: number): void {
  mesh.count = n;
  mesh.visible = n > 0;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
