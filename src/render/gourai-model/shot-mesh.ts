// 10-4a: メカ怪獣ゴウライの弾の見た目: 機銃の曳光（細長い菱形の棒）とミサイル（白い胴と赤い炎）を、それぞれ InstancedMesh 1 つで
// まとめて描く（弾が何百発でも描画は 2 回）。向きは弾の速度、位置は前のステップとの間を alpha で補間（速度から戻す）
import {
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { Shot } from '../../ai/raid-kit/shots';
import { GOURAI_MODEL_CONFIG } from '../../data/gourai-model';

const M = GOURAI_MODEL_CONFIG;
const STEP = 1 / 60;

/** 前 −Z・長さ 1・太さ 1 の細長い八面体（先が明るく、後ろが暗い頂点の色）。三角形 8 */
export function buildShotGeometry(head: number, tail: number): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const h = new Color(head);
  const t = new Color(tail);
  const nose = [0, 0, -0.5];
  const back = [0, 0, 0.5];
  const ring = [
    [0.5, 0, 0],
    [0, 0.5, 0],
    [-0.5, 0, 0],
    [0, -0.5, 0],
  ];
  for (let i = 0; i < 4; i++) {
    const a = ring[i] ?? [0, 0, 0];
    const b = ring[(i + 1) % 4] ?? [0, 0, 0];
    pos.push(...nose, ...a, ...b, ...back, ...b, ...a);
    for (const c of [h, h, h, t, h, h]) col.push(c.r, c.g, c.b);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  return g;
}

const matrix = new Matrix4();
const quat = new Quaternion();
const scale = new Vector3();
const p = new Vector3();
const dir = new Vector3();
const fwd = new Vector3(0, 0, -1);

class ShotLayer {
  readonly mesh: InstancedMesh;
  constructor(
    geo: BufferGeometry,
    cap: number,
    private readonly length: number,
    private readonly width: number,
  ) {
    const mat = new MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: true });
    this.mesh = new InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  begin(): void {
    this.mesh.count = 0;
  }

  add(s: Readonly<Shot>, alpha: number): void {
    const back = (1 - alpha) * STEP;
    p.set(
      s.position.x - s.velocity.x * back,
      s.position.y - s.velocity.y * back,
      s.position.z - s.velocity.z * back,
    );
    dir.set(s.velocity.x, s.velocity.y, s.velocity.z);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    quat.setFromUnitVectors(fwd, dir.normalize());
    scale.set(this.width, this.width, this.length);
    matrix.compose(p, quat, scale);
    this.mesh.setMatrixAt(this.mesh.count++, matrix);
  }

  end(): void {
    this.mesh.visible = this.mesh.count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class ShotMesh {
  private readonly gun: ShotLayer;
  private readonly missile: ShotLayer;
  readonly triangles = 8;

  constructor(cap: number) {
    const s = M.shot;
    this.gun = new ShotLayer(
      buildShotGeometry(M.colors.tracer, 0x803010),
      cap,
      s.tracerLength,
      s.tracerWidth,
    );
    this.missile = new ShotLayer(
      buildShotGeometry(M.colors.missile, M.colors.hatch),
      cap,
      s.missileLength,
      s.missileWidth,
    );
  }

  get meshes(): readonly InstancedMesh[] {
    return [this.gun.mesh, this.missile.mesh];
  }

  /** 飛んでいる弾を並べる（show が false なら全部隠す） */
  update(shots: readonly Shot[], alpha: number, show: boolean): void {
    this.gun.begin();
    this.missile.begin();
    if (show)
      for (const s of shots) {
        if (!s.active) continue;
        (s.kind === 'gun' ? this.gun : this.missile).add(s, alpha);
      }
    this.gun.end();
    this.missile.end();
  }
}
