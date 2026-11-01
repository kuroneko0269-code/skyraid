// 1 機ぶんの機体モデル（自機・ハンガー・他プレイヤー・ゴースト）: 機体（不透明・操舵面とミサイルはシェーダー・色は塗装
// テクスチャ（7-3））+ キャノピー（半透明）+ アフターバーナーの炎 + 陽炎（4-4）。
// draw call は機体 1・キャノピー 1・炎 1（点火中だけ）・陽炎 1（巡航中・画質「高」以外）
import { Group, Mesh, MeshStandardMaterial } from 'three';
import type { AircraftShape } from '../../data/aircraft-shapes';
import { AIRCRAFT_MODEL_CONFIG, type AircraftDetail } from '../../data/aircraft-model';
import { buildAircraft, type BuiltAircraft } from './build';
import { HeatHaze } from '../fx/heat-haze';
import { AfterburnerFlame } from './flame';
import {
  animatePaint,
  createCanopyMaterial,
  createPaintMaterial,
  createSurfaceUniforms,
  setHinges,
} from './material';
import { controlSurfaceAngles, type Point3, type SurfaceAngles } from './planform';
import { defaultPaint, type Paint } from '../../progression/paint';
import { SkinTexture, applySkinSurface } from '../skin/skin-material';

const zeroAngles = (): SurfaceAngles => ({
  aileronLeft: 0,
  aileronRight: 0,
  elevator: 0,
  rudder: 0,
});

export class AircraftObject {
  readonly group = new Group();
  readonly flame = new AfterburnerFlame();
  readonly haze = new HeatHaze();
  private readonly body: Mesh;
  private readonly canopy: Mesh;
  private readonly uniforms = createSurfaceUniforms();
  private readonly angles = zeroAngles();
  private readonly target = zeroAngles();
  private built: BuiltAircraft | null = null;
  private shape: Readonly<AircraftShape> | null = null;
  private detail: AircraftDetail = 'high';
  private missiles = -1;
  private opacity = 1;
  private canopyOpacity: number | null = null;
  private readonly skin = new SkinTexture();
  private readonly paintMaterial: MeshStandardMaterial;
  /** 塗装（null は機体の初期の塗装・番号 00） */
  private paint: Paint | null = null;
  private paintRef: Readonly<Paint> | null = null;

  constructor() {
    const paint = createPaintMaterial();
    this.paintMaterial = paint;
    this.body = new Mesh(undefined, paint);
    this.body.customDepthMaterial = animatePaint(paint, this.uniforms, this.skin.texture);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.canopy = new Mesh(undefined, createCanopyMaterial());
    this.canopy.receiveShadow = true;
    this.group.add(this.body, this.canopy, this.flame.mesh, this.haze.mesh);
  }

  /** 三角形の数（機体 + キャノピー。炎は除く） */
  get triangles(): number {
    return this.built?.triangles ?? 0;
  }

  /** 左右の翼端（機体のローカル）。作る前は空 */
  get wingTips(): readonly Point3[] {
    return this.built?.wingTips ?? [];
  }

  /** 形・細かさ・パイロンの数が変わったときだけ作り直す */
  build(shape: Readonly<AircraftShape>, detail: AircraftDetail, missiles: number): void {
    if (this.shape === shape && this.detail === detail && this.missiles === missiles) return;
    this.shape = shape;
    this.detail = detail;
    this.missiles = missiles;
    this.body.geometry.dispose();
    this.canopy.geometry.dispose();
    const b = buildAircraft(shape, { detail, missiles, mergeCanopy: false, skinned: true });
    this.built = b;
    this.body.geometry = b.body;
    if (b.canopy) this.canopy.geometry = b.canopy;
    setHinges(this.uniforms, b.hinges);
    this.flame.setNozzles(b.nozzles);
    this.haze.setNozzles(b.nozzles);
    this.uniforms.uMissiles.value = missiles;
    this.refreshSkin();
  }

  /** 塗装（7-3）。null は機体の初期の塗装。変わったときだけテクスチャを作り直す（形を作る前でもよい） */
  setPaint(paint: Readonly<Paint> | null): void {
    // 他プレイヤーは描画フレームごとに同じ値を渡すので、同じ入れ物なら何もしない
    if (paint !== null && paint === this.paintRef) return;
    this.paintRef = paint;
    this.paint = paint ? { ...paint, wing: { ...paint.wing }, fin: { ...paint.fin } } : null;
    this.refreshSkin();
  }

  private refreshSkin(): void {
    const shape = this.shape;
    if (!shape) return;
    const paint = this.paint ?? defaultPaint(shape, 0);
    this.skin.update(shape, paint);
    applySkinSurface(this.paintMaterial, paint);
  }

  /** 細かさだけ変える（画質の切り替え） */
  setDetail(detail: AircraftDetail): void {
    if (this.shape) this.build(this.shape, detail, this.missiles);
  }

  /** 不透明度（PvP の復帰後の無敵。5-3）。1 で元の不透明に戻す。変わったときだけマテリアルを作り直す */
  setOpacity(opacity: number): void {
    if (opacity === this.opacity) return;
    this.opacity = opacity;
    const body = this.body.material;
    const canopy = this.canopy.material;
    if (!(body instanceof MeshStandardMaterial) || !(canopy instanceof MeshStandardMaterial))
      return;
    this.canopyOpacity ??= canopy.opacity;
    const fade = opacity < 1;
    if (body.transparent !== fade) {
      body.transparent = fade;
      body.needsUpdate = true;
    }
    body.opacity = opacity;
    canopy.opacity = this.canopyOpacity * opacity;
    this.body.castShadow = !fade;
  }

  /** 見えるミサイルの数（撃った分だけ消える） */
  setMissiles(remaining: number): void {
    this.uniforms.uMissiles.value = remaining;
  }

  /**
   * 操舵面を操作に比例した角度へ（ピッチ +1 = 機首上げ、ロール +1 = 右、ヨー +1 = 機首右）。
   * 見た目は response の速さで追いつく。dt = 0 なら動かさない
   */
  steer(pitch: number, roll: number, yaw: number, dt: number): void {
    const t = controlSurfaceAngles(pitch, roll, yaw, this.target);
    const a = this.angles;
    const k = Math.min(1, AIRCRAFT_MODEL_CONFIG.surfaces.response * dt);
    a.aileronLeft += (t.aileronLeft - a.aileronLeft) * k;
    a.aileronRight += (t.aileronRight - a.aileronRight) * k;
    a.elevator += (t.elevator - a.elevator) * k;
    a.rudder += (t.rudder - a.rudder) * k;
    this.writeAngles();
  }

  /** 操舵面を中立に戻す（すぐに） */
  neutral(): void {
    Object.assign(this.angles, zeroAngles());
    this.writeAngles();
  }

  private writeAngles(): void {
    const a = this.angles;
    const v = this.uniforms.uHingeAngle.value;
    // 部品番号の順: 左右のエルロン・左右の水平尾翼・左右のラダー
    v[0] = a.aileronLeft;
    v[1] = a.aileronRight;
    v[2] = a.elevator;
    v[3] = a.elevator;
    v[4] = a.rudder;
    v[5] = a.rudder;
  }
}
