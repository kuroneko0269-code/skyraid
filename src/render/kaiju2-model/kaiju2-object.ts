// 9-6a: ネフィルガの 3D オブジェクト: 骨格 1 つに皮膚と翼の膜の SkinnedMesh 2 つ、雷球（InstancedMesh）・突風の輪を足す。
// draw call は 体 2 + 雷球 1（出ているときだけ）+ 突風 1（出ているときだけ）= 2〜4（シャドウは体 2 の分だけ別）。
// ヴォルガス（8）より少ない。「低」はジオメトリを作り直す（三角形 5,000 以下）。
// 10-7a: 見た目の段（低・中・高）で、起動時に作る絵（textures.ts）・とげの作り込み・粒（雨と風の筋 1・電気の弧 1・破片と煙 2。
// どれも出ているときだけ）を切り替える。動きの上乗せ（motion.ts）と演出の進行（kaiju2-effects.ts）は描画だけ
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
} from 'three';
import type { Object3D } from 'three';
import { KaijuLights } from '../kaiju-look/lights';
import type { AircraftDetail } from '../../data/aircraft-model';
import { KAIJU2_VISUAL, type Kaiju2Tier } from '../../data/kaiju2-visual';
import { KAIJU2_CONFIG } from '../../data/kaiju2';
import { KAIJU2_MODEL_CONFIG } from '../../data/kaiju2-model';
import { MAX_ORBS, type SkyKaiju } from '../../entities/kaiju2/sky-kaiju';
import { createKaiju2Materials, type Kaiju2Materials } from './material';
import { Kaiju2Effects } from './kaiju2-effects';
import type { Kaiju2ViewInput } from './kaiju2-view-input';
import { buildKaiju2Geometries, kaiju2Textures, toTier } from './assets';

export { buildKaiju2Geometries } from './assets';
import {
  animateKaiju2,
  applyKaiju2Broken,
  createKaiju2Skeleton,
  type Kaiju2Skeleton,
} from './skeleton';

const M = KAIJU2_MODEL_CONFIG;

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
const inv = new Quaternion();
const lookLocal = new Vector3();

export class Kaiju2Object {
  readonly group = new Group();
  private readonly rig: Kaiju2Skeleton;
  private readonly skin: SkinnedMesh;
  private readonly membrane: SkinnedMesh;
  private materials: Kaiju2Materials;
  private effects: Kaiju2Effects;
  /** 粒（ワールド座標。段を変えると中身を入れ替える） */
  private readonly fxRoot = new Group();
  private tier: Kaiju2Tier;
  private readonly lights = new KaijuLights();
  private readonly orbs: InstancedMesh;
  private readonly gust: Mesh;
  private readonly gustMaterial: MeshBasicMaterial;
  private time = 0;
  /** 三角形の数（今の画質。報告・テスト） */
  triangles = 0;

  constructor(detail: AircraftDetail | Kaiju2Tier = 'high') {
    this.rig = createKaiju2Skeleton();
    this.group.add(this.rig.root);
    this.tier = toTier(detail);
    const spec = KAIJU2_VISUAL.tiers[this.tier];
    const g = buildKaiju2Geometries(this.tier === 'low' ? 'low' : 'high', spec.extraSpikes);
    this.triangles = g.triangles;
    this.materials = createKaiju2Materials(this.tier, kaiju2Textures(spec.textureSize));
    this.skin = this.prepare(new SkinnedMesh(g.skin, this.materials.skin));
    this.membrane = this.prepare(new SkinnedMesh(g.membrane, this.materials.membrane));
    this.effects = new Kaiju2Effects(spec, this.rig);
    this.fxRoot.add(...this.effects.objects);
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

  /** シーンに足すもの（体・雷球・突風・粒。雷球・突風・粒はワールド座標で置く） */
  get objects(): readonly (Group | Mesh | InstancedMesh)[] {
    return [this.group, this.orbs, this.gust, this.fxRoot];
  }

  /** 今の見た目の段 */
  get visualTier(): Kaiju2Tier {
    return this.tier;
  }

  /** 10-7a: 日と空の光（縁の光・膜の透けの向きと色）をシーンから探す */
  attachLights(scene: { readonly children: readonly Object3D[] }): void {
    this.lights.attach(scene);
  }

  private prepare(mesh: SkinnedMesh): SkinnedMesh {
    // 10-7a: 日と稲光の向きを描くカメラの向きへ直す
    mesh.onBeforeRender = (_r, _s, camera) => {
      this.materials.toView(camera.matrixWorldInverse);
    };
    mesh.bind(this.rig.skeleton, new Matrix4());
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  /** 画質（LOD）を変える: ジオメトリ・絵・粒を作り直す（9-6a の機体の細かさか、10-7a の見た目の段） */
  setDetail(detail: AircraftDetail | Kaiju2Tier): void {
    const tier = toTier(detail);
    if (tier === this.tier) return;
    this.tier = tier;
    const spec = KAIJU2_VISUAL.tiers[tier];
    const g = buildKaiju2Geometries(tier === 'low' ? 'low' : 'high', spec.extraSpikes);
    this.skin.geometry.dispose();
    this.skin.geometry = g.skin;
    this.membrane.geometry.dispose();
    this.membrane.geometry = g.membrane;
    this.triangles = g.triangles;
    this.materials.dispose();
    this.materials = createKaiju2Materials(tier, kaiju2Textures(spec.textureSize));
    this.skin.material = this.materials.skin;
    this.membrane.material = this.materials.membrane;
    this.fxRoot.remove(...this.effects.objects);
    this.effects.dispose();
    this.effects = new Kaiju2Effects(spec, this.rig);
    this.fxRoot.add(...this.effects.objects);
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
    this.fxRoot.visible = v;
    if (!v) {
      this.orbs.visible = false;
      this.gust.visible = false;
    }
  }

  /** 10-7a: 新しく出した（レイドの始め・再生のシーク）: 破片・煙・身じろぎの残りを消す */
  resetEffects(k: SkyKaiju): void {
    this.effects.reset(k);
  }

  /**
   * 描画フレームごと。前ステップとの間を alpha で補間し、骨を動かす。flash は被弾で白く光る残り（0〜1。9-6b）。
   * view は 10-7a の演出の入力（カメラ・頭が追う相手・雨・撃破・咆哮・演出の秒数。省略は粒を dt で進めて追わない）
   */
  update(k: SkyKaiju, alpha: number, dt: number, flash = 0, view?: Kaiju2ViewInput): void {
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
    const input: Kaiju2ViewInput = view ?? {
      camera: { x: p.x, y: p.y + 100, z: p.z + 500 },
      target: null,
      rain: 0,
      dead: false,
      shout: false,
      fxDt: dt,
    };
    animateKaiju2(this.rig, k.pose, this.time);
    // 10-7a: 動きの上乗せ（頭が追う相手は体の座標へ）
    let look: Vector3 | null = null;
    if (input.target) {
      inv.copy(this.group.quaternion).invert();
      look = lookLocal
        .set(input.target.x - p.x, input.target.y - p.y, input.target.z - p.z)
        .applyQuaternion(inv);
    }
    this.effects.motion.apply(
      this.rig,
      { pose: k.pose, bank, look, roar: this.effects.roarAmount, dead: input.dead },
      this.time,
      dt,
    );
    applyKaiju2Broken(this.rig, k.broken);
    this.group.updateMatrixWorld(true);
    this.effects.update(k, this.group.position, Math.min(1, flash), input, this.time);
    const look2 = this.effects.look;
    look2.throat = k.pose.throatGlow;
    look2.vein = k.attack === 'orbs' ? k.pose.throatGlow : 0;
    this.materials.setLook(look2, this.time);
    this.materials.setFlash(Math.min(1, flash), k.broken.head);
    this.updateLights();
    this.updateOrbs(k, alpha);
    this.updateGust(k);
  }

  /** 日の向き・色と空の色をマテリアルへ（強さを色に掛ける） */
  private updateLights(): void {
    const l = this.lights.read();
    this.materials.setSun(l.sunDir, l.sunColor, l.skyColor);
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
