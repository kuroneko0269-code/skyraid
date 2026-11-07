// 10-3a: 白鯨アルビオンの 3D オブジェクト: 骨格 1 つに皮膚の SkinnedMesh 1 つ、子分の InstancedMesh 1 つ（何匹でも 1 回）、
// 攻撃の見た目（柱・扇・雲。出ているときだけ）。draw call は 体 1 + 子分 1 + 効果 0〜2 = 1〜4（シャドウは体の 1 つだけ）。
// ネフィルガ（体 2 + 効果）・ヴォルガス（8）より少ない。「低」はジオメトリを作り直す
import {
  Group,
  Matrix4,
  Quaternion,
  SkinnedMesh,
  Vector3,
  type BufferGeometry,
  type Mesh,
  type InstancedMesh,
} from 'three';
import type { AircraftDetail } from '../../data/aircraft-model';
import { ALBION_CONFIG, ALBION_NESTS, ALBION_PARTS } from '../../data/albion';
import { ALBION_MODEL_CONFIG } from '../../data/albion-model';
import type { AlbionKaiju } from '../../ai/albion-ai';
import { AlbionFx } from './albion-fx';
import { createAlbionMaterial, type AlbionMaterial } from './material';
import { MinionMesh } from './minion-mesh';
import { buildAlbionSkin } from './parts';
import { animateAlbion, createAlbionSkeleton, type AlbionSkeleton } from './skeleton';

const M = ALBION_MODEL_CONFIG;

/** 皮膚のジオメトリ（テストで三角形を数える） */
export function buildAlbionGeometry(detail: AircraftDetail): {
  skin: BufferGeometry;
  triangles: number;
} {
  const b = buildAlbionSkin(M.detail[detail]);
  return { skin: b.build(), triangles: b.triangleCount };
}

const matrix = new Matrix4();
const yaw = new Quaternion();
const tilt = new Quaternion();
const xAxis = new Vector3(1, 0, 0);
const yAxis = new Vector3(0, 1, 0);
const zAxis = new Vector3(0, 0, 1);
const nestGlow = [1, 1, 1];
const brokenLook = { dorsal: false, tail: false };
const PART = (id: (typeof ALBION_PARTS)[number]): number => ALBION_PARTS.indexOf(id);

export class AlbionObject {
  readonly group = new Group();
  private readonly rig: AlbionSkeleton;
  private readonly skin: SkinnedMesh;
  private readonly material: AlbionMaterial;
  readonly minions: MinionMesh;
  readonly fx = new AlbionFx();
  private time = 0;
  /** 三角形の数（今の画質の体。報告・テスト） */
  triangles = 0;

  constructor(detail: AircraftDetail = 'high') {
    this.rig = createAlbionSkeleton();
    this.group.add(this.rig.root);
    const g = buildAlbionGeometry(detail);
    this.triangles = g.triangles;
    this.material = createAlbionMaterial();
    this.skin = new SkinnedMesh(g.skin, this.material.skin);
    this.skin.bind(this.rig.skeleton, matrix.identity());
    this.skin.frustumCulled = false;
    this.skin.castShadow = true;
    this.skin.receiveShadow = true;
    this.group.add(this.skin);
    this.minions = new MinionMesh(ALBION_CONFIG.minions.cap);
    this.group.visible = false;
  }

  /** シーンに足すもの（体・子分・効果。子分と効果はワールド座標で置く） */
  get objects(): readonly (Group | Mesh | InstancedMesh)[] {
    return [this.group, this.minions.mesh, ...this.fx.objects];
  }

  setDetail(detail: AircraftDetail): void {
    const g = buildAlbionGeometry(detail);
    this.skin.geometry.dispose();
    this.skin.geometry = g.skin;
    this.triangles = g.triangles;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
    if (!v) {
      this.fx.hide();
      this.minions.mesh.visible = false;
    }
  }

  /**
   * 描画フレームごと。前ステップとの間を alpha で補間し、骨を動かす。prevMinion は子分の前の位置、flash は被弾の光（0〜1）
   */
  update(
    k: AlbionKaiju,
    alpha: number,
    dt: number,
    prevMinion: (i: number) => Readonly<{ x: number; y: number; z: number }>,
    flash = 0,
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
    yaw.setFromAxisAngle(yAxis, b.prevHeading + dh * alpha);
    tilt.setFromAxisAngle(xAxis, b.pitch);
    yaw.multiply(tilt);
    tilt.setFromAxisAngle(zAxis, -(b.prevBank + (b.bank - b.prevBank) * alpha));
    this.group.quaternion.copy(yaw).multiply(tilt);
    const parts = k.parts;
    brokenLook.dorsal = parts.isBroken(PART('dorsal'));
    brokenLook.tail = parts.isBroken(PART('tail'));
    animateAlbion(this.rig, b.pose, brokenLook);
    const pulse = 0.65 + 0.35 * Math.sin(this.time * M.glow.nestPulseHz * Math.PI * 2);
    ALBION_NESTS.forEach((n, i) => {
      nestGlow[i] = parts.isBroken(n.part) ? 0 : M.glow.nest * pulse;
    });
    this.material.set(b.pose.spoutSwell, nestGlow, parts.isBroken(PART('head')) ? 0.15 : 1, flash);
    this.minions.update(k.swarm.minions, prevMinion, alpha, this.time, true);
    this.fx.update(k, this.time);
  }
}
