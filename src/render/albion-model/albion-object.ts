// 10-3a: 白鯨アルビオンの 3D オブジェクト: 骨格 1 つに皮膚の SkinnedMesh 1 つ、子分の InstancedMesh 1 つ（何匹でも 1 回）、
// 攻撃の見た目（柱・扇・雲。出ているときだけ）。draw call は 体 1 + 子分 1 + 効果 0〜2 = 1〜4（シャドウは体の 1 つだけ）。
// ネフィルガ（体 2 + 効果）・ヴォルガス（8）より少ない。「低」はジオメトリを作り直す。
// 10-7b: 見た目の段（低・中・高）で、起動時に作る皮の絵・凹凸・粒（線の粒 1・柔らかい粒 1・破片と煙 2・鳥 1・影 1。どれも
// 出ているときだけ）を切り替える。動きの上乗せ（motion.ts）と演出の進行（albion-effects.ts）は描画だけ
import {
  Group,
  Matrix4,
  Quaternion,
  SkinnedMesh,
  Vector3,
  type BufferGeometry,
  type DataTexture,
  type InstancedMesh,
  type Mesh,
  type Object3D,
} from 'three';
import type { AircraftDetail } from '../../data/aircraft-model';
import { ALBION_CONFIG } from '../../data/albion';
import { ALBION_MODEL_CONFIG } from '../../data/albion-model';
import { ALBION_VISUAL } from '../../data/albion-visual';
import { toKaijuTier, type KaijuTier } from '../../data/kaiju-look';
import type { AlbionKaiju } from '../../ai/albion-ai';
import { KaijuLights } from '../kaiju-look/lights';
import { makeKaijuTexture } from '../kaiju-look/noise';
import { AlbionEffects, type AlbionViewInput } from './albion-effects';
import { AlbionFx } from './albion-fx';
import { createAlbionMaterial, type AlbionMaterial } from './material';
import { MinionMesh } from './minion-mesh';
import { buildAlbionSkin } from './parts';
import { animateAlbion, createAlbionSkeleton, type AlbionSkeleton } from './skeleton';
import { buildAlbionSkinPixels } from './textures';

const M = ALBION_MODEL_CONFIG;

/** 皮膚のジオメトリ（テストで三角形を数える） */
export function buildAlbionGeometry(detail: AircraftDetail): {
  skin: BufferGeometry;
  triangles: number;
} {
  const b = buildAlbionSkin(M.detail[detail === 'low' ? 'low' : 'high']);
  return { skin: b.build(), triangles: b.triangleCount };
}

/** 段ごとの皮の絵（作ったら使い回す。一辺 0 は作らない） */
const textureCache = new Map<number, DataTexture>();
export function albionTexture(size: number): DataTexture | null {
  if (size <= 0) return null;
  let t = textureCache.get(size);
  if (!t) {
    t = makeKaijuTexture(buildAlbionSkinPixels(size), size, true);
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
const lookLocal = new Vector3();
const brokenLook = { dorsal: false, tail: false };

export class AlbionObject {
  readonly group = new Group();
  private readonly rig: AlbionSkeleton;
  private readonly skin: SkinnedMesh;
  private material: AlbionMaterial;
  private effects: AlbionEffects;
  private readonly lights = new KaijuLights();
  /** 粒（ワールド座標。段を変えると中身を入れ替える） */
  private readonly fxRoot = new Group();
  private tier: KaijuTier;
  readonly minions: MinionMesh;
  readonly fx = new AlbionFx();
  private time = 0;
  private bankPending = false;
  private wispsPending = false;
  /** 三角形の数（今の画質の体。報告・テスト） */
  triangles = 0;

  constructor(detail: AircraftDetail | KaijuTier = 'high') {
    this.rig = createAlbionSkeleton();
    this.group.add(this.rig.root);
    this.tier = toKaijuTier(detail);
    const spec = ALBION_VISUAL.tiers[this.tier];
    const g = buildAlbionGeometry(this.tier === 'low' ? 'low' : 'high');
    this.triangles = g.triangles;
    this.material = createAlbionMaterial(spec, albionTexture(spec.textureSize));
    this.skin = new SkinnedMesh(g.skin, this.material.skin);
    this.skin.bind(this.rig.skeleton, matrix.identity());
    this.skin.frustumCulled = false;
    this.skin.castShadow = true;
    this.skin.receiveShadow = true;
    // 10-7b: 日と稲光の向きを描くカメラの向きへ直す
    this.skin.onBeforeRender = (_r, _s, camera) => {
      this.material.toView(camera.matrixWorldInverse);
    };
    this.group.add(this.skin);
    this.minions = new MinionMesh(ALBION_CONFIG.minions.cap);
    this.effects = new AlbionEffects(spec, this.rig, this.lights);
    this.fxRoot.add(...this.effects.objects);
    this.group.visible = false;
  }

  /** シーンに足すもの（体・子分・攻撃の効果・粒。子分と効果と粒はワールド座標で置く） */
  get objects(): readonly (Group | Mesh | InstancedMesh)[] {
    return [this.group, this.minions.mesh, ...this.fx.objects, this.fxRoot];
  }

  /** 10-7b: 演出の粒（数える・テスト） */
  get effectObjects(): readonly Object3D[] {
    return this.effects.objects;
  }

  /** 今の見た目の段 */
  get visualTier(): KaijuTier {
    return this.tier;
  }

  /** 10-7b: 日と空の光（縁の光・白い体の照り・雲の色）をシーンから探す */
  attachLights(scene: { readonly children: readonly Object3D[] }): void {
    this.lights.attach(scene);
  }

  /** 画質（LOD）を変える: ジオメトリ・絵・粒を作り直す（機体の細かさか、10-7b の見た目の段） */
  setDetail(detail: AircraftDetail | KaijuTier): void {
    const tier = toKaijuTier(detail);
    if (tier === this.tier) return;
    this.tier = tier;
    const spec = ALBION_VISUAL.tiers[tier];
    const g = buildAlbionGeometry(tier === 'low' ? 'low' : 'high');
    this.skin.geometry.dispose();
    this.skin.geometry = g.skin;
    this.triangles = g.triangles;
    this.material.dispose();
    this.material = createAlbionMaterial(spec, albionTexture(spec.textureSize));
    this.skin.material = this.material.skin;
    this.fxRoot.remove(...this.effects.objects);
    this.effects.dispose();
    this.effects = new AlbionEffects(spec, this.rig, this.lights);
    this.fxRoot.add(...this.effects.objects);
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
    this.fxRoot.visible = v;
    if (!v) {
      this.fx.hide();
      this.minions.mesh.visible = false;
    }
  }

  /** 10-7b: 新しく出した（レイドの始め・再生のシーク）: 破片・煙・身じろぎの残りを消す */
  resetEffects(k: AlbionKaiju): void {
    this.effects.reset(k);
    this.wispsPending = true;
  }

  /** 10-7b: 粒だけ消す（撮影の場面の切り替え） */
  clearParticles(): void {
    this.effects.debris.clear();
    this.effects.puffs.clear();
    this.wispsPending = true;
  }

  /** 10-7b: 登場の場面の始め（体の前を雲の塊で包む。次の描画で体を置いてから出す） */
  cloudBank(): void {
    this.bankPending = true;
  }

  /** 10-7b: 体に沿って流れる雲を前から出ていたことにする（レイドの始め・撮影の場面） */
  warmWisps(): void {
    this.wispsPending = true;
  }

  /**
   * 描画フレームごと。前ステップとの間を alpha で補間し、骨を動かす。prevMinion は子分の前の位置、flash は被弾の光（0〜1）。
   * view は 10-7b の演出の入力（カメラ・頭が追う相手・雨・撃破・海に着いた・雲の幕・演出の秒数。省略は粒を dt で進めて追わない）
   */
  update(
    k: AlbionKaiju,
    alpha: number,
    dt: number,
    prevMinion: (i: number) => Readonly<{ x: number; y: number; z: number }>,
    flash = 0,
    view?: AlbionViewInput,
  ): void {
    this.time += dt;
    if (!this.group.visible) return;
    const b = k.body;
    const p = b.position;
    const q = b.prevPosition;
    this.group.position.set(
      q.x + (p.x - q.x) * alpha,
      q.y + (p.y - q.y) * alpha - b.pose.sink,
      q.z + (p.z - q.z) * alpha,
    );
    // 向き: 方位（Y 軸回り。前 −Z を回す）→ 上下（X 軸）→ 傾き（前後の軸。正で右が下がる）
    let dh = b.heading - b.prevHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const heading = b.prevHeading + dh * alpha;
    yaw.setFromAxisAngle(yAxis, heading);
    tilt.setFromAxisAngle(xAxis, b.pitch);
    yaw.multiply(tilt);
    tilt.setFromAxisAngle(zAxis, -(b.prevBank + (b.bank - b.prevBank) * alpha));
    this.group.quaternion.copy(yaw).multiply(tilt);
    const input: AlbionViewInput = view ?? {
      camera: { x: p.x, y: p.y + 200, z: p.z + 1200 },
      rain: 0,
      dead: false,
      landed: false,
      veil: 0,
      fxDt: dt,
    };
    const parts = k.parts;
    brokenLook.dorsal = parts.isBroken(parts.indexOf('dorsal'));
    brokenLook.tail = parts.isBroken(parts.indexOf('tail'));
    animateAlbion(this.rig, b.pose, brokenLook);
    // 10-7b: 動きの上乗せ（泳ぎの上下の揺れ・胸びれの舵・口。当たりの形からのずれは小さく収める）
    const motion = this.effects.motion;
    motion.apply(
      this.rig,
      { pose: b.pose, bank: b.bank, roar: this.effects.roarAmount, dead: input.dead },
      this.time,
      input.fxDt,
    );
    this.group.position.y += motion.bob;
    this.group.updateMatrixWorld(true);
    const l = this.lights.read();
    if (this.bankPending || this.wispsPending) {
      const f = lookLocal.set(0, 0, -1).applyQuaternion(this.group.quaternion);
      f.y = 0;
      f.normalize();
      if (this.bankPending) this.effects.cloudBank(f);
      if (this.wispsPending) this.effects.warmWisps(k, f);
      this.bankPending = this.wispsPending = false;
    }
    this.effects.update(k, this.group.position, heading, Math.min(1, flash), input, this.time);
    this.material.set(this.effects.look, this.time);
    this.material.setSun(l.sunDir, l.sunColor, l.skyColor);
    this.minions.update(k.swarm.minions, prevMinion, alpha, this.time, true);
    this.fx.update(k, this.time);
  }
}
