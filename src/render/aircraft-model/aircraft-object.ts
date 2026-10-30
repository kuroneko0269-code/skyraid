// 1 機ぶんの機体モデル（自機・ハンガー）: 機体（不透明・操舵面とミサイルはシェーダー）+ キャノピー（半透明）+
// アフターバーナーの炎。draw call は機体 1・キャノピー 1・炎 1（点火中だけ）
import { Group, Mesh } from 'three';
import type { AircraftShape } from '../../data/aircraft-shapes';
import { AIRCRAFT_MODEL_CONFIG, type AircraftDetail } from '../../data/aircraft-model';
import { buildAircraft, type BuiltAircraft } from './build';
import { AfterburnerFlame } from './flame';
import {
  animatePaint,
  createCanopyMaterial,
  createPaintMaterial,
  createSurfaceUniforms,
  setHinges,
} from './material';
import { controlSurfaceAngles, type Point3, type SurfaceAngles } from './planform';

const zeroAngles = (): SurfaceAngles => ({
  aileronLeft: 0,
  aileronRight: 0,
  elevator: 0,
  rudder: 0,
});

export class AircraftObject {
  readonly group = new Group();
  readonly flame = new AfterburnerFlame();
  private readonly body: Mesh;
  private readonly canopy: Mesh;
  private readonly uniforms = createSurfaceUniforms();
  private readonly angles = zeroAngles();
  private readonly target = zeroAngles();
  private built: BuiltAircraft | null = null;
  private shape: Readonly<AircraftShape> | null = null;
  private detail: AircraftDetail = 'high';
  private missiles = -1;

  constructor() {
    const paint = createPaintMaterial();
    this.body = new Mesh(undefined, paint);
    this.body.customDepthMaterial = animatePaint(paint, this.uniforms);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.canopy = new Mesh(undefined, createCanopyMaterial());
    this.canopy.receiveShadow = true;
    this.group.add(this.body, this.canopy, this.flame.mesh);
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
    const b = buildAircraft(shape, { detail, missiles, mergeCanopy: false });
    this.built = b;
    this.body.geometry = b.body;
    if (b.canopy) this.canopy.geometry = b.canopy;
    setHinges(this.uniforms, b.hinges);
    this.flame.setNozzles(b.nozzles);
    this.uniforms.uMissiles.value = missiles;
  }

  /** 細かさだけ変える（画質の切り替え） */
  setDetail(detail: AircraftDetail): void {
    if (this.shape) this.build(this.shape, detail, this.missiles);
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
