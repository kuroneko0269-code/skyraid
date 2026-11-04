// 9-6a: ネフィルガの 3D オブジェクト: 骨格 1 つに皮膚と翼の膜の SkinnedMesh 2 つ、雷球（InstancedMesh）・突風の輪を足す。
// draw call は 体 2 + 雷球 1（出ているときだけ）+ 突風 1（出ているときだけ）= 2〜4（シャドウは体 2 の分だけ別）。
// ヴォルガス（8）より少ない。「低」はジオメトリを作り直す（三角形 5,000 以下）
import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SkinnedMesh,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { AircraftDetail } from '../../data/aircraft-model';
import { KAIJU2_CONFIG } from '../../data/kaiju2';
import { KAIJU2_MODEL_CONFIG } from '../../data/kaiju2-model';
import { MAX_ORBS, type SkyKaiju } from '../../entities/kaiju2/sky-kaiju';
import { createKaiju2Materials, type Kaiju2Materials } from './material';
import { buildKaiju2Membrane, buildKaiju2Skin } from './parts';
import { animateKaiju2, createKaiju2Skeleton, type Kaiju2Skeleton } from './skeleton';

const M = KAIJU2_MODEL_CONFIG;

/** 皮膚と膜のジオメトリ（テストで三角形を数える） */
export function buildKaiju2Geometries(detail: AircraftDetail): {
  skin: BufferGeometry;
  membrane: BufferGeometry;
  triangles: number;
} {
  const d = M.detail[detail];
  const s = buildKaiju2Skin(d);
  const m = buildKaiju2Membrane(d);
  return { skin: s.build(), membrane: m.build(), triangles: s.triangleCount + m.triangleCount };
}

const matrix = new Matrix4();
const quat = new Quaternion();
const roll = new Quaternion();
const scale = new Vector3();
const pos = new Vector3();
const fwd = new Vector3();
const right = new Vector3();
const up = new Vector3();
const back = new Vector3();
const zAxis = new Vector3(0, 0, 1);
const worldUp = new Vector3(0, 1, 0);

export class Kaiju2Object {
  readonly group = new Group();
  private readonly rig: Kaiju2Skeleton;
  private readonly skin: SkinnedMesh;
  private readonly membrane: SkinnedMesh;
  private readonly materials: Kaiju2Materials;
  private readonly orbs: InstancedMesh;
  private readonly gust: Mesh;
  private readonly gustMaterial: MeshBasicMaterial;
  private time = 0;
  /** 三角形の数（今の画質。報告・テスト） */
  triangles = 0;

  constructor(detail: AircraftDetail = 'high') {
    this.rig = createKaiju2Skeleton();
    this.group.add(this.rig.root);
    const g = buildKaiju2Geometries(detail);
    this.triangles = g.triangles;
    this.materials = createKaiju2Materials();
    this.skin = this.prepare(new SkinnedMesh(g.skin, this.materials.skin));
    this.membrane = this.prepare(new SkinnedMesh(g.membrane, this.materials.membrane));
    const orbMaterial = new MeshBasicMaterial({
      color: M.colors.orb,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    orbMaterial.color.multiplyScalar(5);
    this.orbs = new InstancedMesh(new IcosahedronGeometry(1, 2), orbMaterial, MAX_ORBS);
    this.orbs.instanceMatrix.setUsage(DynamicDrawUsage);
    this.orbs.frustumCulled = false;
    this.orbs.count = 0;
    // 突風: 前へ広がる円錐の筒（底が原点、+Y 向き）を怪獣の前に向けて伸ばす
    this.gustMaterial = new MeshBasicMaterial({
      color: M.colors.gust,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    const tan = Math.tan((KAIJU2_CONFIG.attacks.gust.halfAngleDeg * Math.PI) / 180);
    this.gust = new Mesh(
      new CylinderGeometry(tan, 0.04, 1, 24, 1, true).translate(0, 0.5, 0),
      this.gustMaterial,
    );
    this.gust.frustumCulled = false;
    this.gust.visible = false;
    this.group.visible = false;
  }

  /** シーンに足すもの（体・雷球・突風。雷球と突風はワールド座標で置く） */
  get objects(): readonly (Group | Mesh | InstancedMesh)[] {
    return [this.group, this.orbs, this.gust];
  }

  private prepare(mesh: SkinnedMesh): SkinnedMesh {
    mesh.bind(this.rig.skeleton, new Matrix4());
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  /** 画質（LOD）を変える: ジオメトリを作り直す */
  setDetail(detail: AircraftDetail): void {
    const g = buildKaiju2Geometries(detail);
    this.skin.geometry.dispose();
    this.skin.geometry = g.skin;
    this.membrane.geometry.dispose();
    this.membrane.geometry = g.membrane;
    this.triangles = g.triangles;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
    if (!v) {
      this.orbs.visible = false;
      this.gust.visible = false;
    }
  }

  /** 描画フレームごと。前ステップとの間を alpha で補間し、骨を動かす */
  update(k: SkyKaiju, alpha: number, dt: number): void {
    this.time += dt;
    if (!this.group.visible) return;
    const p = k.position;
    const q = k.prevPosition;
    this.group.position.set(
      q.x + (p.x - q.x) * alpha,
      q.y + (p.y - q.y) * alpha,
      q.z + (p.z - q.z) * alpha,
    );
    const pf = k.prevForward;
    fwd
      .set(
        pf.x + (k.forward.x - pf.x) * alpha,
        pf.y + (k.forward.y - pf.y) * alpha,
        pf.z + (k.forward.z - pf.z) * alpha,
      )
      .normalize();
    right.crossVectors(fwd, worldUp);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    up.crossVectors(right, fwd).normalize();
    back.copy(fwd).negate();
    matrix.makeBasis(right, up, back);
    quat.setFromRotationMatrix(matrix);
    // 傾き: 正で右翼が下がる（後ろ向きの Z 軸回りに −bank）
    const bank = k.prevBank + (k.bank - k.prevBank) * alpha;
    roll.setFromAxisAngle(zAxis, -bank);
    this.group.quaternion.copy(quat).multiply(roll);
    animateKaiju2(this.rig, k.pose, this.time);
    this.materials.setGlow(
      k.pose.throatGlow,
      k.attack === 'orbs' ? k.pose.throatGlow : 0,
      this.time,
    );
    this.updateOrbs(k, alpha);
    this.updateGust(k);
  }

  private updateOrbs(k: SkyKaiju, alpha: number): void {
    let n = 0;
    const r = KAIJU2_CONFIG.attacks.orbs.radius * M.orbScale;
    for (const o of k.orbs) {
      if (!o.active) continue;
      pos.set(
        o.prevPosition.x + (o.position.x - o.prevPosition.x) * alpha,
        o.prevPosition.y + (o.position.y - o.prevPosition.y) * alpha,
        o.prevPosition.z + (o.position.z - o.prevPosition.z) * alpha,
      );
      quat.setFromAxisAngle(worldUp, this.time * 7 + n);
      scale.setScalar(r * (1 + 0.15 * Math.sin(this.time * 31 + n * 2)));
      matrix.compose(pos, quat, scale);
      this.orbs.setMatrixAt(n++, matrix);
    }
    this.orbs.count = n;
    this.orbs.visible = n > 0;
    this.orbs.instanceMatrix.needsUpdate = true;
  }

  private updateGust(k: SkyKaiju): void {
    const on = k.attack === 'gust' && k.state === 'attack';
    this.gust.visible = on;
    if (!on) return;
    const g = KAIJU2_CONFIG.attacks.gust;
    const t = Math.min(1, k.stateTime / g.active);
    const len = g.range * (0.25 + 0.75 * t);
    this.gustMaterial.opacity = M.gustOpacity * (1 - t * 0.8);
    this.gust.position.copy(this.group.position);
    this.gust.quaternion.setFromUnitVectors(worldUp, fwd);
    this.gust.scale.set(len, len, len);
  }
}
