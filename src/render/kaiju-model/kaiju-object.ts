// 怪獣ヴォルガスの 3D オブジェクト（6-1）: 骨格 1 つに SkinnedMesh を貼り、熱線と岩（InstancedMesh）を足す。
// 10-7e: 部位ごとの皮膚 5 つ（+ 背の骨板）を 1 つのメッシュにまとめた（geometry.ts）。描く回数は 体 2（皮膚 + 結晶）+ 熱線 1 + 岩 1
// + 粒（柔らかい粒・光る粒・破片・煙。どれも出ているときだけ）。6-1b までは体 6（部位 5 + 結晶）。影の描く回数は 皮膚 1 + 岩（6-1b は 5 + 岩）。
// 見た目の段（低・中・高。画質から）で、起動時に作る絵（textures.ts）・骨板・粒の数を切り替える。動きの上乗せ（motion.ts）と
// 演出の進行（vorgas-effects.ts）は描画だけで、判定の値は読むだけ
import {
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SkinnedMesh,
  Vector3,
  type DataTexture,
  type Mesh,
  type Object3D,
} from 'three';
import type { AircraftDetail } from '../../data/aircraft-model';
import { KAIJU_ATTACK_CONFIG, KAIJU_CONFIG } from '../../data/kaiju';
import { KAIJU_MODEL_CONFIG } from '../../data/kaiju-model';
import { toKaijuTier, type KaijuTier } from '../../data/kaiju-look';
import { VORGAS_VISUAL } from '../../data/vorgas-visual';
import type { KaijuBodyView, KaijuEffectsView } from '../../entities/kaiju-display';
import { wrapAngle, type KaijuPose } from '../../entities/kaiju-pose';
import { KaijuLights } from '../kaiju-look/lights';
import { makeKaijuTexture } from '../kaiju-look/noise';
import { VorgasBeam } from './beam';
import { buildKaijuGeometries } from './geometry';
import { createCrystalMaterial, setCrystalGlow } from './material';
import { collapseAmount } from './motion';
import { animate, createKaijuSkeleton, type KaijuSkeleton } from './skeleton';
import { createVorgasSkin, type VorgasSkin } from './skin-material';
import { buildVorgasSkinPixels } from './textures';
import { VorgasEffects } from './vorgas-effects';
import type { VorgasLook, VorgasViewInput } from './vorgas-view';

export { buildKaijuGeometries } from './geometry';

const M = KAIJU_MODEL_CONFIG;
const ROCK_MAX = 3;
const matrix = new Matrix4();
const quat = new Quaternion();
const scale = new Vector3();
const pos = new Vector3();
const yAxis = new Vector3(0, 1, 0);
const lookLocal = new Vector3();

/** 段ごとの絵（作ったら使い回す。一辺 0 は作らない） */
const textureCache = new Map<number, DataTexture>();
export function vorgasTexture(size: number): DataTexture | null {
  if (size <= 0) return null;
  let t = textureCache.get(size);
  if (!t) {
    t = makeKaijuTexture(buildVorgasSkinPixels(size), size, true);
    textureCache.set(size, t);
  }
  return t;
}

/** 演出の入力が無いとき（テスト・読み込み前）の決まった値 */
const DEFAULT_INPUT: VorgasViewInput = {
  camera: { x: 0, y: 200, z: 600 },
  target: null,
  floor: 0,
  deadTime: -1,
  entrance: -1,
  fxDt: 0,
};

export class KaijuObject {
  readonly group = new Group();
  private readonly rig: KaijuSkeleton;
  /** 皮膚（部位をまとめた 1 つ。テストで頂点を測る） */
  readonly skinMesh: SkinnedMesh;
  private skin: VorgasSkin;
  private readonly crystals: SkinnedMesh;
  private readonly crystalMaterial: MeshStandardMaterial;
  private readonly beam = new VorgasBeam();
  private readonly rocks: InstancedMesh;
  private effects: VorgasEffects;
  /** 粒（ワールド座標。段を変えると中身を入れ替える） */
  private readonly fxRoot = new Group();
  private readonly lights = new KaijuLights();
  private readonly deadPose: KaijuPose = {
    bodyDrop: 0,
    headLift: 0,
    tailLift: 0,
    crystalGlow: 0.15,
    armLift: 0,
  };
  private time = 0;
  private walking = 0;
  private wasVisible = false;
  tier: KaijuTier;
  /** 三角形の数（今の段。報告・テスト） */
  triangles = 0;

  constructor(detail: AircraftDetail | KaijuTier = 'high') {
    this.tier = toKaijuTier(detail);
    this.rig = createKaijuSkeleton();
    this.group.add(this.rig.root);
    const g = buildKaijuGeometries(this.tier);
    this.triangles = g.triangles;
    g.scutes?.dispose();
    this.skin = createVorgasSkin(vorgasTexture(VORGAS_VISUAL.tiers[this.tier].textureSize));
    this.skinMesh = this.prepare(new SkinnedMesh(g.skin, this.skin.material));
    this.skinMesh.onBeforeRender = (_r, _s, camera) => {
      this.skin.toView(camera.matrixWorldInverse);
    };
    this.crystalMaterial = createCrystalMaterial();
    this.crystals = this.prepare(new SkinnedMesh(g.crystals, this.crystalMaterial));
    this.crystals.castShadow = false;
    this.effects = new VorgasEffects(VORGAS_VISUAL.tiers[this.tier], this.rig);
    this.fxRoot.add(...this.effects.objects);
    this.rocks = new InstancedMesh(
      new IcosahedronGeometry(1, 1),
      new MeshStandardMaterial({ color: M.colors.rock, roughness: 0.95, flatShading: true }),
      ROCK_MAX,
    );
    this.rocks.instanceMatrix.setUsage(DynamicDrawUsage);
    this.rocks.frustumCulled = false;
    this.rocks.castShadow = true;
    this.rocks.count = 0;
    this.group.visible = false;
  }

  /** シーンに足すもの（怪獣の体・熱線・岩・粒。熱線と岩と粒はワールド座標で置く） */
  get objects(): readonly (Group | Mesh | InstancedMesh)[] {
    return [this.group, this.beam.mesh, this.rocks, this.fxRoot];
  }

  /** 描く物（テスト: 体・熱線・岩・粒） */
  get drawables(): readonly Object3D[] {
    return [this.skinMesh, this.crystals, this.beam.mesh, this.rocks, ...this.effects.objects];
  }

  /** 日と空の光（縁の光の向きと色）をシーンから探す */
  attachLights(scene: { readonly children: readonly Object3D[] }): void {
    this.lights.attach(scene);
  }

  private prepare(mesh: SkinnedMesh): SkinnedMesh {
    mesh.bind(this.rig.skeleton, new Matrix4());
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  /** 画質を変える: ジオメトリ・絵・粒を作り直す（9-6a の機体の細かさか、10-7e の見た目の段） */
  setDetail(d: AircraftDetail | KaijuTier): void {
    const tier = toKaijuTier(d);
    if (tier === this.tier) return;
    this.tier = tier;
    const g = buildKaijuGeometries(tier);
    g.scutes?.dispose();
    this.triangles = g.triangles;
    this.skinMesh.geometry.dispose();
    this.skinMesh.geometry = g.skin;
    this.crystals.geometry.dispose();
    this.crystals.geometry = g.crystals;
    this.skin.dispose();
    this.skin = createVorgasSkin(vorgasTexture(VORGAS_VISUAL.tiers[tier].textureSize));
    this.skinMesh.material = this.skin.material;
    this.fxRoot.remove(...this.effects.objects);
    this.effects.dispose();
    this.effects = new VorgasEffects(VORGAS_VISUAL.tiers[tier], this.rig);
    this.fxRoot.add(...this.effects.objects);
  }

  /** 演出の時間だけ進める（8-2: モデルを遅れて作ったとき、それまでの時間を足す。update の隠れている間と同じ） */
  advanceTime(seconds: number): void {
    this.time += seconds;
  }

  /** 隠す（撮影の計測） */
  hide(): void {
    this.group.visible = false;
    this.beam.mesh.visible = false;
    this.rocks.visible = false;
    this.fxRoot.visible = false;
  }

  /**
   * 描画フレームごと。body の前ステップとの間を alpha で補間し、骨を動かす。view は 10-7e の演出の入力（無ければ決まった値で
   * 粒を dt で進める）、look は足が着いたときなどの揺れの知らせ先
   */
  update(
    body: KaijuBodyView,
    fx: KaijuEffectsView | null,
    alpha: number,
    dt: number,
    view?: VorgasViewInput,
    look?: VorgasLook,
  ): void {
    this.group.visible = body.visible;
    this.fxRoot.visible = true;
    this.time += dt;
    const input = view ?? { ...DEFAULT_INPUT, fxDt: dt };
    this.beam.update(fx, body.visible, this.time);
    this.updateRocks(fx, body.visible);
    if (body.visible && !this.wasVisible) this.effects.reset(body);
    else if (look?.takeReset()) this.effects.clearFx();
    this.wasVisible = body.visible;
    if (!body.visible) {
      this.effects.update(body, input, 0, null, this.time);
      return;
    }
    const p = body.feet;
    const q = body.prevFeet;
    this.group.position.set(
      q.x + (p.x - q.x) * alpha,
      q.y + (p.y - q.y) * alpha,
      q.z + (p.z - q.z) * alpha,
    );
    const heading = body.prevHeading + wrapAngle(body.heading - body.prevHeading) * alpha;
    this.group.rotation.set(0, heading, 0);
    const moving = Math.hypot(body.velocity.x, body.velocity.z) > 0.5 ? 1 : 0;
    this.walking += (moving - this.walking) * Math.min(1, dt * 3);
    // 倒した後は膝が折れる（描画だけの姿勢。判定の姿勢の値は読むだけ）
    const dead = input.deadTime;
    let pose = body.pose;
    if (dead >= 0) {
      const c = collapseAmount(dead);
      Object.assign(this.deadPose, body.pose);
      this.deadPose.bodyDrop = Math.max(body.pose.bodyDrop, KAIJU_CONFIG.down.bodyDrop * c.kneel);
      this.deadPose.headLift = 0;
      this.deadPose.tailLift = 0;
      this.deadPose.armLift = 0;
      pose = this.deadPose;
    }
    animate(this.rig, {
      pose,
      walkPhase: body.walkPhase,
      walking: dead >= 0 ? 0 : this.walking,
      time: this.time,
      roaring: dead < 0 && body.attack === 'roar' && body.attackStep === 'active',
    });
    // 動きの上乗せ（頭が追う相手は体の座標へ）
    let target: Vector3 | null = null;
    if (input.target) {
      const t = input.target;
      const c = Math.cos(-heading);
      const s = Math.sin(-heading);
      const dx = t.x - this.group.position.x;
      const dz = t.z - this.group.position.z;
      target = lookLocal.set(dx * c + dz * s, t.y - this.group.position.y, -dx * s + dz * c);
    }
    this.effects.motion.apply(this.rig, target, dead, input.fxDt, this.time);
    this.group.updateMatrixWorld(true);
    const flash = body.flashTimer > 0 ? 1 : 0;
    this.effects.update(body, input, flash, look ?? null, this.time);
    this.skin.set(this.effects.look, this.time);
    const l = this.lights.read();
    this.skin.setSun(l.sunDir, l.sunColor, l.skyColor);
    // 結晶: 熱線の溜めで明るく、撃つ直前はちらつく。倒れると消える
    const flicker = this.effects.look.heat > 0.6 ? 0.85 + 0.15 * Math.sin(this.time * 47) : 1;
    setCrystalGlow(this.crystalMaterial, body.pose.crystalGlow, body.parts[1]?.broken ?? false);
    this.crystalMaterial.emissiveIntensity *= flicker * (1 - 0.85 * this.effects.look.dead);
  }

  private updateRocks(fx: KaijuEffectsView | null, visible: boolean): void {
    let n = 0;
    if (fx && visible) {
      const rr = KAIJU_ATTACK_CONFIG.throw.rockRadius;
      for (const rock of fx.rocks) {
        if (!rock.active || n >= ROCK_MAX) continue;
        pos.set(rock.position.x, rock.position.y, rock.position.z);
        quat.setFromAxisAngle(yAxis, this.time * 2 + n);
        scale.setScalar(rr);
        matrix.compose(pos, quat, scale);
        this.rocks.setMatrixAt(n++, matrix);
      }
    }
    this.rocks.count = n;
    this.rocks.visible = n > 0;
    this.rocks.instanceMatrix.needsUpdate = true;
  }
}
