// 10-5a: UFO ゼノリスの 3D オブジェクト: 骨格 1 つに皮の SkinnedMesh 1 つ（銀の円盤・縁の帯・ドーム・発光体・砲口・発生器）、
// バリアの殻・光線（InstancedMesh 1 つ）・瞬間移動の柱と輪・光の弾（どれも出ているときだけ）。シャドウは体の 1 つだけ。
// 10-7d: 見た目の段（低・中・高）で、鏡の金属と虹色の板・光の筋（chrome-material.ts）・六角のバリア（holo.ts）・粒と演出
// （xenolith-effects.ts: きらめく粒・光の波・光の尾・ほどける / 組み上がる・破片・電気の弧・目印・影）を切り替える。
// 足した飾り（結晶・浮かぶ光の輪）は体の当たりの中。動き（浮かぶ揺れ・つんのめり・輪の回転）と演出は描画だけ
import {
  Color,
  Group,
  Matrix4,
  Quaternion,
  SkinnedMesh,
  Vector3,
  type BufferGeometry,
  type Mesh,
  type Object3D,
} from 'three';
import type { AircraftDetail } from '../../data/aircraft-model';
import { XENOLITH_CONFIG } from '../../data/xenolith';
import { XENOLITH_MODEL_CONFIG } from '../../data/xenolith-model';
import { XENOLITH_VISUAL } from '../../data/xenolith-visual';
import { toKaijuTier, type KaijuTier } from '../../data/kaiju-look';
import type { XenolithKaiju } from '../../ai/xenolith-ai';
import { KaijuLights } from '../kaiju-look/lights';
import { drawBeam, drawOrbHalos } from './attack-fx';
import { BeamFx } from './beam-fx';
import { createXenolithMaterial, type XenolithMaterial } from './chrome-material';
import { createBarrierMesh, createWarpFx } from './holo';
import { OrbMesh } from './orb-mesh';
import { buildXenolithSkin } from './parts';
import {
  createXenolithSkeleton,
  XENOLITH_BONE,
  type XenolithBoneName,
  type XenolithSkeleton,
} from './skeleton';
import { XenolithEffects, type XenolithViewInput } from './xenolith-effects';
import { setXenolithBarrier, setXenolithGlow, animateXenolithParts } from './xenolith-animate';

const M = XENOLITH_MODEL_CONFIG;
const X = XENOLITH_CONFIG;
const V = XENOLITH_VISUAL;

/** 皮のジオメトリ（テストで三角形を数える） */
export function buildXenolithGeometry(detail: AircraftDetail): {
  skin: BufferGeometry;
  triangles: number;
} {
  const b = buildXenolithSkin(M.detail[detail === 'low' ? 'low' : 'high']);
  return { skin: b.build(), triangles: b.triangleCount };
}

const matrix = new Matrix4();
const yawQ = new Quaternion();
const tilt = new Quaternion();
const xAxis = new Vector3(1, 0, 0);
const yAxis = new Vector3(0, 1, 0);
const zAxis = new Vector3(0, 0, 1);
const coreWorld = new Vector3();
const horizon = new Color();
const sea = new Color();
const sun = new Color();

export class XenolithObject {
  readonly group = new Group();
  private readonly rig: XenolithSkeleton;
  private readonly skin: SkinnedMesh;
  private material: XenolithMaterial;
  private effects: XenolithEffects;
  private readonly lights = new KaijuLights();
  /** 粒（ワールド座標。段を変えると中身を入れ替える） */
  private readonly fxRoot = new Group();
  /** バリアの殻（段を変えると中身を入れ替える。barrier は今の殻） */
  private readonly barrierRoot = new Group();
  barrier: Mesh;
  private barrierFx: ReturnType<typeof createBarrierMesh>;
  readonly beam = new BeamFx();
  private readonly warp = createWarpFx();
  /** 10-5b: 光の弾（出ているときだけ描く） */
  readonly orbs = new OrbMesh(X.orbs.cap);
  private tier: KaijuTier;
  private time = 0;
  triangles = 0;

  constructor(detail: AircraftDetail | KaijuTier = 'high') {
    this.rig = createXenolithSkeleton();
    this.group.add(this.rig.root);
    this.tier = toKaijuTier(detail);
    const spec = V.tiers[this.tier];
    const g = buildXenolithGeometry(this.tier === 'low' ? 'low' : 'high');
    this.triangles = g.triangles;
    this.material = createXenolithMaterial(spec);
    this.skin = new SkinnedMesh(g.skin, this.material.skin);
    this.skin.bind(this.rig.skeleton, matrix.identity());
    this.skin.frustumCulled = false;
    this.skin.castShadow = true;
    this.skin.receiveShadow = true;
    // 日の向き・ドームの核の中心を描くカメラの向きへ直す
    this.skin.onBeforeRender = (_r, _s, camera) => {
      const dome = this.bone('dome');
      if (dome) coreWorld.set(0, 9, 0).applyMatrix4(dome.matrixWorld);
      this.material.toView(camera.matrixWorldInverse, coreWorld);
    };
    this.group.add(this.skin);
    this.effects = new XenolithEffects(spec);
    this.fxRoot.add(...this.effects.objects);
    this.barrierFx = createBarrierMesh(M.detail.high.segments, spec.surfaceDetail);
    this.barrier = this.barrierFx.mesh;
    this.barrierRoot.add(this.barrier);
    this.group.visible = false;
  }

  /** シーンに足すもの（体・殻・光線・柱と輪・光の弾・粒。体のほかはワールド座標で置く） */
  get objects(): readonly Object3D[] {
    return [
      this.group,
      this.barrierRoot,
      this.beam.mesh,
      this.warp.pillar,
      this.warp.ring,
      this.orbs.mesh,
      this.fxRoot,
    ];
  }

  /** 10-7d: 演出の粒（数える・テスト） */
  get effectObjects(): readonly Object3D[] {
    return this.effects.objects;
  }

  /** 今の描画の回数（体 1 + 出ている効果と粒） */
  get draws(): number {
    if (!this.group.visible) return 0;
    return (
      1 +
      [this.barrier, this.beam.mesh, this.warp.pillar, this.warp.ring, this.orbs.mesh].filter(
        (m) => m.visible,
      ).length +
      this.effects.objects.filter((m) => m.visible).length
    );
  }

  /** 今の見た目の段 */
  get visualTier(): KaijuTier {
    return this.tier;
  }

  /** 10-7d: 日と空の光をシーンから探す（映り込みの空・水平線の色） */
  attachLights(scene: { readonly children: readonly Object3D[] }): void {
    this.lights.attach(scene);
  }

  /** 画質（LOD）を変える: ジオメトリ・マテリアル・殻・粒を作り直す（機体の細かさか、10-7d の見た目の段） */
  setDetail(detail: AircraftDetail | KaijuTier): void {
    const tier = toKaijuTier(detail);
    if (tier === this.tier) return;
    const wasLow = this.tier === 'low';
    this.tier = tier;
    const spec = V.tiers[tier];
    if (wasLow !== (tier === 'low')) {
      const g = buildXenolithGeometry(tier === 'low' ? 'low' : 'high');
      this.skin.geometry.dispose();
      this.skin.geometry = g.skin;
      this.triangles = g.triangles;
    }
    this.material.dispose();
    this.material = createXenolithMaterial(spec);
    this.skin.material = this.material.skin;
    this.fxRoot.remove(...this.effects.objects);
    this.effects.dispose();
    this.effects = new XenolithEffects(spec);
    this.fxRoot.add(...this.effects.objects);
    this.barrierRoot.remove(this.barrier);
    this.barrier.geometry.dispose();
    this.barrierFx = createBarrierMesh(M.detail.high.segments, spec.surfaceDetail);
    this.barrier = this.barrierFx.mesh;
    this.barrierRoot.add(this.barrier);
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
    this.fxRoot.visible = v;
    if (!v) {
      this.barrier.visible = false;
      this.beam.begin(this.time);
      this.beam.end();
      this.warp.set(false, 0, 0, 0, 0, 0);
      this.orbs.update([], 0, 0, false);
      this.effects.hide();
    }
  }

  /** 10-7d: 新しく出した（レイドの始め・再生のシーク）: 粒・光の残りを消す */
  resetEffects(k: XenolithKaiju): void {
    this.effects.reset(k);
  }

  /** 10-7d: 粒だけ消す（撮影の場面の切り替え） */
  clearParticles(): void {
    this.effects.clearParticles();
  }

  /**
   * 描画フレームごと。前ステップとの間を alpha で補間し、骨と効果を動かす。flash は被弾の光（0〜1）。view は 10-7d の演出の入力
   * （カメラ・雨・撃破・海に着いた・沈む・登場の高さ・演出の秒数。省略は粒を dt で進める）
   */
  update(k: XenolithKaiju, alpha: number, dt: number, flash = 0, view?: XenolithViewInput): void {
    this.time += dt;
    if (!this.group.visible) return;
    const b = k.body;
    const p = b.position;
    const q = b.prevPosition;
    const input: XenolithViewInput = view ?? {
      camera: { x: p.x + 300, y: p.y + 120, z: p.z + 300 },
      rain: 0,
      dead: false,
      landed: false,
      sink: 0,
      descend: 0,
      fxDt: dt,
    };
    const fx = this.effects;
    this.group.position.set(
      q.x + (p.x - q.x) * alpha,
      q.y + (p.y - q.y) * alpha + fx.bob + input.descend * V.descend.height - input.sink * 25,
      q.z + (p.z - q.z) * alpha,
    );
    let dh = b.heading - b.prevHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const heading = b.prevHeading + dh * alpha;
    yawQ.setFromAxisAngle(yAxis, heading);
    tilt.setFromAxisAngle(xAxis, b.pitch - fx.tilt);
    yawQ.multiply(tilt);
    tilt.setFromAxisAngle(zAxis, -b.roll);
    this.group.quaternion.copy(yawQ).multiply(tilt);
    animateXenolithParts(this.rig, k, alpha, this.time);
    this.group.updateMatrixWorld(true);
    // 演出（粒・波・尾・ほどける）
    const l = this.lights.read();
    fx.update(k, this.group.position, heading, Math.min(1, flash), input, l.sunDir);
    const glow = fx.glow;
    setXenolithGlow(glow, k, flash, this.time);
    this.material.set(glow, this.time);
    this.readSky();
    this.material.setSky(l.sunDir, l.sunColor, l.skyColor, horizon, sea);
    setXenolithBarrier(this.barrierFx, this.barrier, k, this.group.position, this.time);
    drawBeam(k, this.beam, fx.sprites, this.time, input.fxDt);
    // 瞬間移動の予兆（移る先の柱と輪）・登場（空から体までの光の柱）
    const w = k.warp;
    const d = w.destination;
    const cam = fx.camera;
    if (input.descend > 0) {
      const floor = b.floorAt(p.x, p.z);
      const top = this.group.position.y + 900;
      const k2 = 0.15 + 0.25 * (1 - input.descend);
      this.warp.set(
        true,
        p.x,
        (top + floor) / 2,
        p.z,
        floor,
        k2,
        V.descend.pillar,
        top - floor,
        this.time,
      );
    } else
      this.warp.set(
        w.phase === 'telegraph',
        d.x,
        d.y,
        d.z,
        b.floorAt(d.x, d.z),
        w.glow,
        undefined,
        undefined,
        this.time,
      );
    this.orbs.update(k.orbs.shots, alpha, dt, true);
    if (V.tiers[this.tier].orbHalo) drawOrbHalos(k, fx.sprites, cam, alpha, this.time);
    fx.sprites.end();
  }

  private bone(name: XenolithBoneName) {
    return this.rig.bones[XENOLITH_BONE[name]];
  }

  /**
   * 水平線の色と海の色（空の光と日の光から。シーンの霧の色は大気散乱の値を入れているので使わない）
   */
  private readSky(): void {
    const l = this.lights;
    const sm = Math.max(1, l.sunColor.r, l.sunColor.g, l.sunColor.b);
    const km = Math.max(1, l.skyColor.r, l.skyColor.g, l.skyColor.b);
    horizon
      .copy(l.skyColor)
      .multiplyScalar(0.55 / km)
      .add(sun.copy(l.sunColor).multiplyScalar(0.4 / sm));
    sea.set(V.colors.sea).lerp(horizon, 0.15);
  }
}
