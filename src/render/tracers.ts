// 曳光弾の描画。全弾を InstancedMesh 1 つ（1 draw call）で、前後に長い発光する棒（emissive の PBR）として描く。
// プールごとに色を変えるとき（敵の機銃の赤 + 対空砲の黄色。2-6）は、発光色をインスタンスの色で掛ける
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import type { Bullet } from '../combat/gun';
import type { Pool } from '../combat/pool';
import { TRACER_CONFIG } from '../data/effects';
import { EMISSIVE_CONFIG } from '../data/sky';
import { createEmissiveMaterial } from './materials';
import type { Vec3 } from '../flight/math';

const AXIS_Z = new Vector3(0, 0, 1);
const dir = new Vector3();
const pos = new Vector3();
const scale = new Vector3();
const quat = new Quaternion();
const matrix = new Matrix4();
const white = new Color(0xffffff);

export class TracerRenderer {
  readonly mesh: InstancedMesh;
  /** プールごとの色（poolColors を渡したときだけ） */
  private readonly tints: Color[] | null;

  /**
   * poolColors: update に渡すプールの順に色。渡すと発光色（白 × 強さ）をインスタンスの色で掛ける
   * （同じ色なら 1 色のときと見た目は同じ）
   */
  constructor(
    capacity: number,
    color: number = TRACER_CONFIG.color,
    poolColors: readonly number[] | null = null,
  ) {
    const material = createEmissiveMaterial(poolColors ? 0xffffff : color, EMISSIVE_CONFIG.tracer);
    this.tints = poolColors ? poolColors.map((c) => new Color(c)) : null;
    if (this.tints) {
      material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vColor.rgb;',
        );
      };
      material.customProgramCacheKey = () => 'tinted-tracer';
    }
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    if (this.tints)
      for (let i = 0; i < capacity; i++) this.mesh.setColorAt(i, this.tints[0] ?? white);
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** 弾を前ステップ位置と現在位置の間（alpha）に描く。棒の先端が弾の位置。複数のプールをまとめて 1 つで描ける */
  update(pools: readonly Pool<Bullet>[], alpha: number, camera: Readonly<Vec3>): void {
    const capacity = this.mesh.instanceMatrix.count;
    let n = 0;
    pools.forEach((bullets, p) => {
      const tint = this.tints?.[p];
      for (let i = 0; i < bullets.count && n < capacity; i++) {
        if (tint) this.mesh.setColorAt(n, tint);
        this.place(n++, bullets.get(i), alpha, camera);
      }
    });
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.tints && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  private place(index: number, b: Bullet, alpha: number, camera: Readonly<Vec3>): void {
    const c = TRACER_CONFIG;
    const hx = b.px + (b.x - b.px) * alpha;
    const hy = b.py + (b.y - b.py) * alpha;
    const hz = b.pz + (b.z - b.pz) * alpha;
    dir.set(b.vx, b.vy, b.vz).normalize();
    // 撃った直後は機体にめり込まないよう、飛んだ距離までの長さにする
    const len = Math.max(0.5, Math.min(c.length, b.traveled));
    pos.set(hx - (dir.x * len) / 2, hy - (dir.y * len) / 2, hz - (dir.z * len) / 2);
    const d = Math.hypot(hx - camera.x, hy - camera.y, hz - camera.z);
    const w = Math.max(c.width, d * c.widthPerMeter);
    quat.setFromUnitVectors(AXIS_Z, dir);
    scale.set(w, w, len);
    this.mesh.setMatrixAt(index, matrix.compose(pos, quat, scale));
  }
}
