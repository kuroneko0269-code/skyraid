// 10-3a: 白鯨アルビオンの子分（小さな飛ぶ怪獣）の形: 胴・翼 2 枚・尾・目の 1 つのジオメトリ（三角形 40 個ほど）を
// InstancedMesh でまとめて描く（何匹出ても描画は 1 回）。羽ばたきは匹ごとの横の縮み（翼を上げ下げして見える）
import {
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { ALBION_MODEL_CONFIG } from '../../data/albion-model';
import type { Minion } from '../../ai/raid-kit/minions';

const M = ALBION_MODEL_CONFIG;

/** 子分 1 匹のジオメトリ（前 −Z。翼の端から端 1） */
export function buildMinionGeometry(): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const body = new Color(M.colors.minion);
  const wing = new Color(M.colors.minionWing);
  const eye = new Color(M.colors.minionEye);
  const tri = (
    a: readonly number[],
    b: readonly number[],
    c: readonly number[],
    color: Color,
  ): void => {
    pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) col.push(color.r, color.g, color.b);
  };
  // 胴: 前後に尖った八面体の細長いもの（幅 0.1・高さ 0.08・長さ 0.6）
  const nose = [0, 0, -0.32];
  const tailEnd = [0, 0, 0.3];
  const ring = [
    [0.06, 0, 0],
    [0, 0.05, 0],
    [-0.06, 0, 0],
    [0, -0.04, 0],
  ];
  for (let i = 0; i < 4; i++) {
    const a = ring[i] ?? [0, 0, 0];
    const b = ring[(i + 1) % 4] ?? [0, 0, 0];
    tri(nose, a, b, body);
    tri(tailEnd, b, a, body);
  }
  // 翼（後ろへ流れた三角形 2 枚ずつ。両面）
  for (const s of [-1, 1]) {
    tri([0.04 * s, 0.01, -0.12], [0.5 * s, 0.03, 0.08], [0.04 * s, 0.01, 0.1], wing);
    tri([0.04 * s, 0.01, 0.1], [0.5 * s, 0.03, 0.08], [0.3 * s, 0.02, 0.2], wing);
    // 目（赤い小さな三角形）
    tri([0.03 * s, 0.03, -0.22], [0.05 * s, 0.02, -0.18], [0.02 * s, 0.045, -0.17], eye);
  }
  // 尾びれ（縦）
  tri([0, 0, 0.22], [0, 0.1, 0.42], [0, -0.04, 0.4], wing);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

const matrix = new Matrix4();
const quat = new Quaternion();
const scale = new Vector3();
const p = new Vector3();
const dir = new Vector3();
const zAxis = new Vector3(0, 0, -1);

export class MinionMesh {
  readonly mesh: InstancedMesh;
  readonly triangles: number;

  constructor(cap: number) {
    const geo = buildMinionGeometry();
    this.triangles = geo.getAttribute('position').count / 3;
    const mat = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
    this.mesh = new InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** 飛んでいる子分を並べる（alpha は補間。prev は前のステップの位置: 撃てる物の prevPosition） */
  update(
    minions: readonly Minion[],
    prev: (i: number) => Readonly<{ x: number; y: number; z: number }>,
    alpha: number,
    time: number,
    show: boolean,
  ): void {
    let n = 0;
    if (show) {
      const span = M.minion.span;
      for (let i = 0; i < minions.length; i++) {
        const m = minions[i];
        if (!m?.active) continue;
        const q = prev(i);
        p.set(
          q.x + (m.position.x - q.x) * alpha,
          q.y + (m.position.y - q.y) * alpha,
          q.z + (m.position.z - q.z) * alpha,
        );
        dir.set(m.velocity.x, m.velocity.y, m.velocity.z);
        if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
        quat.setFromUnitVectors(zAxis, dir.normalize());
        const flap = Math.sin(time * M.minion.flapHz * Math.PI * 2 + m.id * 1.7);
        scale.set(span * (0.72 + 0.28 * flap), span * (1 + 0.5 * Math.abs(flap)), span);
        matrix.compose(p, quat, scale);
        this.mesh.setMatrixAt(n++, matrix);
      }
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
