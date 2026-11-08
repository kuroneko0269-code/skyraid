// 10-4a: メカ怪獣ゴウライの 3D オブジェクト: 骨格 1 つに皮の SkinnedMesh 1 つ、弾の InstancedMesh 2 つ（機銃・ミサイル。何発でも 2 回）、
// 回転掃射の危ない高さの輪（出ているときだけ）。draw call は 体 1 + 弾 0〜2 + 輪 0〜1 = 1〜4（シャドウは体の 1 つだけ）。
// 「低」はジオメトリを作り直す。
// 10-7c: 見た目の段（低・中・高）で、起動時に作る金属の板の絵・凹凸・粒（線の粒 1・柔らかい粒 1・光る粒 1・破片と煙 2・影 1。
// どれも出ているときだけ）を切り替える。動きの上乗せ（motion.ts）と演出の進行（gourai-effects.ts）は描画だけ
import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SkinnedMesh,
  Vector3,
  type BufferGeometry,
  type DataTexture,
  type InstancedMesh,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AircraftDetail } from '../../data/aircraft-model';
import { GOURAI_CONFIG, GOURAI_PARTS, GOURAI_TURRETS } from '../../data/gourai';
import { GOURAI_MODEL_CONFIG } from '../../data/gourai-model';
import { GOURAI_VISUAL } from '../../data/gourai-visual';
import { toKaijuTier, type KaijuTier } from '../../data/kaiju-look';
import type { GouraiKaiju } from '../../ai/gourai-ai';
import { KaijuLights } from '../kaiju-look/lights';
import { makeKaijuTexture } from '../kaiju-look/noise';
import { animateGouraiParts } from './gourai-animate';
import { GouraiEffects, type GouraiViewInput } from './gourai-effects';
import { createGouraiMaterial, type GouraiMaterial } from './material';
import { buildGouraiSkin } from './parts';
import { ShotMesh } from './shot-mesh';
import { createGouraiSkeleton, type GouraiSkeleton } from './skeleton';
import { buildGouraiPlatePixels } from './textures';

const M = GOURAI_MODEL_CONFIG;
const G = GOURAI_CONFIG;

/** 皮のジオメトリ（テストで三角形を数える） */
export function buildGouraiGeometry(detail: AircraftDetail): {
  skin: BufferGeometry;
  triangles: number;
} {
  const b = buildGouraiSkin(M.detail[detail === 'low' ? 'low' : 'high']);
  return { skin: b.build(), triangles: b.triangleCount };
}

/** 10-7c: 段ごとの金属の板の絵（作ったら使い回す。一辺 0 は作らない） */
const textureCache = new Map<number, DataTexture>();
export function gouraiTexture(size: number): DataTexture | null {
  if (size <= 0) return null;
  let t = textureCache.get(size);
  if (!t) {
    t = makeKaijuTexture(buildGouraiPlatePixels(size), size, true);
    textureCache.set(size, t);
  }
  return t;
}

const matrix = new Matrix4();
const yaw = new Quaternion();
const tilt = new Quaternion();
const xAxis = new Vector3(1, 0, 0);
const yAxis = new Vector3(0, 1, 0);
const zAxis = new Vector3(0, 0, 1);
const PART = (id: (typeof GOURAI_PARTS)[number]): number => GOURAI_PARTS.indexOf(id);
const DEG = Math.PI / 180;
const aimLocal = new Vector3();
const inverse = new Matrix4();
const V = GOURAI_VISUAL;

export class GouraiObject {
  readonly group = new Group();
  private readonly rig: GouraiSkeleton;
  private readonly skin: SkinnedMesh;
  private material: GouraiMaterial;
  private effects: GouraiEffects;
  private readonly lights = new KaijuLights();
  /** 粒（ワールド座標。段を変えると中身を入れ替える） */
  private readonly fxRoot = new Group();
  private tier: KaijuTier;
  readonly shots: ShotMesh;
  /** 回転掃射の危ない高さの輪（10-4c: 上下 2 つの薄い筒。間がすき間。狙う人の高さ = 0 の上下の幅で、すき間が下なら上下を返す） */
  readonly sweepRing: Mesh;
  private readonly ringMat: MeshBasicMaterial;
  /** 砲台の今の向き（ラジアン。体の向きからの方位。左が正） */
  private readonly turretYaw: number[] = GOURAI_TURRETS.map((t) => t.yawCenterDeg * DEG);
  private time = 0;
  triangles = 0;

  constructor(detail: AircraftDetail | KaijuTier = 'high') {
    this.rig = createGouraiSkeleton();
    this.group.add(this.rig.root);
    this.tier = toKaijuTier(detail);
    const spec = V.tiers[this.tier];
    const g = buildGouraiGeometry(this.tier === 'low' ? 'low' : 'high');
    this.triangles = g.triangles;
    this.material = createGouraiMaterial(spec, gouraiTexture(spec.textureSize));
    this.skin = new SkinnedMesh(g.skin, this.material.skin);
    this.skin.bind(this.rig.skeleton, matrix.identity());
    this.skin.frustumCulled = false;
    this.skin.castShadow = true;
    this.skin.receiveShadow = true;
    // 10-7c: 日と稲光の向きを描くカメラの向きへ直す
    this.skin.onBeforeRender = (_r, _s, camera) => {
      this.material.toView(camera.matrixWorldInverse);
    };
    this.group.add(this.skin);
    this.effects = new GouraiEffects(spec, this.rig, this.lights);
    this.fxRoot.add(...this.effects.objects);
    this.shots = new ShotMesh(G.shotCap);
    const s = G.attacks.sweep;
    const tube = (r: readonly [number, number]): CylinderGeometry => {
      const g = new CylinderGeometry(1, 1, r[1] - r[0], 48, 1, true);
      g.translate(0, (r[0] + r[1]) / 2, 0);
      return g;
    };
    const near = tube(s.near);
    const far = tube(s.far);
    const ring = mergeGeometries([near, far]);
    near.dispose();
    far.dispose();
    this.ringMat = new MeshBasicMaterial({
      color: M.colors.sweepWarn,
      transparent: true,
      opacity: 0,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    this.sweepRing = new Mesh(ring, this.ringMat);
    this.sweepRing.frustumCulled = false;
    this.sweepRing.visible = false;
    this.group.visible = false;
  }

  /** シーンに足すもの（体・弾・輪・粒。弾と輪と粒はワールド座標で置く） */
  get objects(): readonly (Group | Mesh | InstancedMesh)[] {
    return [this.group, ...this.shots.meshes, this.sweepRing, this.fxRoot];
  }

  /** 10-7c: 演出の粒（数える・テスト） */
  get effectObjects(): readonly Object3D[] {
    return this.effects.objects;
  }

  /** 今の描画の回数（体 1 + 出ている弾の層 + 輪 + 出ている粒・影） */
  get draws(): number {
    if (!this.group.visible) return 0;
    return (
      1 +
      this.shots.meshes.filter((m) => m.visible).length +
      (this.sweepRing.visible ? 1 : 0) +
      this.effects.objects.filter((m) => m.visible).length
    );
  }

  /** 今の見た目の段 */
  get visualTier(): KaijuTier {
    return this.tier;
  }

  /** 10-7c: 日と空の光（縁の光・煙と蒸気の色）をシーンから探す */
  attachLights(scene: { readonly children: readonly Object3D[] }): void {
    this.lights.attach(scene);
  }

  /** 画質（LOD）を変える: ジオメトリ・絵・粒を作り直す（機体の細かさか、10-7c の見た目の段） */
  setDetail(detail: AircraftDetail | KaijuTier): void {
    const tier = toKaijuTier(detail);
    if (tier === this.tier) return;
    this.tier = tier;
    const spec = V.tiers[tier];
    const g = buildGouraiGeometry(tier === 'low' ? 'low' : 'high');
    this.skin.geometry.dispose();
    this.skin.geometry = g.skin;
    this.triangles = g.triangles;
    this.material.dispose();
    this.material = createGouraiMaterial(spec, gouraiTexture(spec.textureSize));
    this.skin.material = this.material.skin;
    this.fxRoot.remove(...this.effects.objects);
    this.effects.dispose();
    this.effects = new GouraiEffects(spec, this.rig, this.lights);
    this.fxRoot.add(...this.effects.objects);
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
    this.fxRoot.visible = v;
    if (!v) {
      this.sweepRing.visible = false;
      this.shots.update([], 0, false);
      this.effects.hide();
    }
  }

  /** 10-7c: 新しく出した（レイドの始め・再生のシーク）: 破片・煙・身じろぎの残りを消す */
  resetEffects(k: GouraiKaiju): void {
    this.effects.reset(k);
  }

  /** 10-7c: 粒だけ消す（撮影の場面の切り替え） */
  clearParticles(): void {
    this.effects.clearParticles();
  }

  /**
   * 描画フレームごと。前ステップとの間を alpha で補間し、骨を動かす。aimAt は砲台が向く人（自機）、flash は被弾の光（0〜1）。
   * view は 10-7c の演出の入力（カメラ・雨・撃破・海に着いた・沈む・登場の浮かび上がりと目・演出の秒数。省略は粒を dt で進める）
   */
  update(
    k: GouraiKaiju,
    alpha: number,
    dt: number,
    aimAt: Readonly<{ x: number; y: number; z: number }> | null,
    flash = 0,
    view?: GouraiViewInput,
  ): void {
    this.time += dt;
    if (!this.group.visible) return;
    const b = k.body;
    const p = b.position;
    const q = b.prevPosition;
    this.group.position.set(
      q.x + (p.x - q.x) * alpha,
      q.y + (p.y - q.y) * alpha,
      q.z + (p.z - q.z) * alpha,
    );
    let dh = b.heading - b.prevHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    yaw.setFromAxisAngle(yAxis, b.prevHeading + dh * alpha);
    tilt.setFromAxisAngle(xAxis, b.pitch);
    yaw.multiply(tilt);
    tilt.setFromAxisAngle(zAxis, -b.roll);
    this.group.quaternion.copy(yaw).multiply(tilt);
    const input: GouraiViewInput = view ?? {
      camera: { x: p.x + 300, y: p.y + 120, z: p.z + 300 },
      rain: 0,
      dead: false,
      landed: false,
      sink: 0,
      rise: 0,
      eyes: 1,
      fxDt: dt,
    };
    // 10-7c: 登場は水の下から浮かび上がる・撃破は海に着いてから沈む（描画だけ）
    this.group.position.y -= input.rise * V.rise.depth + input.sink * V.splash.sink;
    animateGouraiParts(this.rig, k, this.turretYaw, this.time, dt, aimAt);
    // 10-7c: 動きの上乗せ（頭・あご・腕・爪・背の放熱板・尾・重い揺れ。体の当たりの中に収まる）
    this.group.updateMatrixWorld(true);
    let aim: Vector3 | null = null;
    if (aimAt) {
      inverse.copy(this.group.matrixWorld).invert();
      aim = aimLocal.set(aimAt.x, aimAt.y, aimAt.z).applyMatrix4(inverse);
    }
    const motion = this.effects.motion;
    motion.apply(
      this.rig,
      {
        action: k.action,
        attack: k.attack,
        actionTime: k.actionTime,
        phase: k.phase,
        heat: Math.min(1, k.heat / 100),
        dead: input.dead,
        purge: b.pose.purge,
        aim: input.dead ? null : aim,
      },
      this.time,
      input.fxDt,
    );
    this.group.position.y += motion.bob;
    this.group.updateMatrixWorld(true);
    let heading = b.prevHeading + dh * alpha;
    heading = Math.atan2(Math.sin(heading), Math.cos(heading));
    this.effects.update(k, this.group.position, heading, Math.min(1, flash), input);
    const glow = this.effects.glow;
    const pose = b.pose;
    const parts = k.parts;
    const ex = M.glow.exhaustMin + (M.glow.exhaustMax - M.glow.exhaustMin) * pose.exhaust;
    glow.core = k.parts.isBroken(PART('core'))
      ? 0
      : M.glow.coreClosed +
        (M.glow.coreOpen - M.glow.coreClosed) *
          Math.max(pose.armorOpen, pose.purge) *
          (0.85 + 0.15 * Math.sin(this.time * 9));
    glow.exhaustL = parts.isBroken(PART('exhaustL')) ? 0 : ex;
    glow.exhaustR = parts.isBroken(PART('exhaustR')) ? 0 : ex;
    glow.hatch = pose.hatch * (Math.sin(this.time * M.glow.hatchHz * Math.PI * 2) > 0 ? 3 : 0.6);
    glow.gun = pose.gunGlow * 3;
    this.material.set(glow, this.time);
    const l = this.lights.read();
    this.material.setSun(l.sunDir, l.sunColor, l.skyColor);
    this.shots.update(k.shots.shots, alpha, true);
    this.updateRing(k);
  }

  private updateRing(k: GouraiKaiju): void {
    const s = G.attacks.sweep;
    const on = k.attack === 'sweep' && (k.action === 'windup' || k.action === 'active');
    this.sweepRing.visible = on && this.group.visible;
    if (!on) return;
    const t = k.action === 'windup' ? Math.min(1, k.actionTime / s.windup) : 1;
    // 10-4c: 狙う人の距離 + beyond（弾が消える所）まで広がる（輪の高さは狙う人の距離で決めた高さ）
    const r = 120 + (k.sweepRange + s.beyond - 120) * t;
    this.sweepRing.position.copy(this.group.position);
    // 10-4b: 掃射の面の傾きの分だけ、広がった半径での高さへ上下にずらす（危ない所は狙う人の高さ）
    this.sweepRing.position.y += r * Math.tan(k.sweepPitch * DEG);
    // 10-4c: すき間が下なら上下を返す（両面の加算なので向きは見た目に出ない）
    this.sweepRing.scale.set(r, k.sweepSide >= 0 ? 1 : -1, r);
    const blink = k.action === 'windup' ? 0.6 + 0.4 * Math.sin(this.time * 14) : 1;
    this.ringMat.opacity = (k.action === 'windup' ? M.fx.sweepWarn : M.fx.sweepActive) * blink;
  }
}
