// 自機の見た目（4-3）: 出撃する機体の手続き生成モデルを、固定ステップの間を補間して置く。操舵面は操作に比例して動き、
// 撃ったミサイルはパイロンから消え、アフターバーナーで炎、高 G 旋回で翼端から飛行機雲、巡航中はノズルの後ろに陽炎（4-4）
import { Group, Vector3, type Camera, type Object3D, type Scene } from 'three';
import type { AircraftModel } from '../data/aircraft';
import { CONTRAIL_CONFIG, type AircraftDetail } from '../data/aircraft-model';
import type { Aircraft, AircraftControls } from '../entities/aircraft';
import { applyInterpolatedPose } from './aircraft-mesh';
import { AircraftObject } from './aircraft-model/aircraft-object';
import { loadFactor } from './aircraft-model/planform';
import { SmokeTrail } from './smoke';
import { hazeLevel, type HazeSegment } from './fx/heat-haze';

const tip = new Vector3();
const heading = new Vector3();
/** 前フレームの翼端からこれ以上離れたら（リスポーンなど）補間しない */
const MAX_GAP = 60;

export class PlayerView {
  /** 自機の位置・姿勢（中のモデルは機体が変わると作り直す。マズルフラッシュなどはここに付ける） */
  readonly mesh = new Group();
  readonly model = new AircraftObject();
  private readonly contrails = new SmokeTrail(CONTRAIL_CONFIG);
  /** 飛行機雲（フォトモード（7-A）の「エフェクト」の表示の切替） */
  get trailMesh(): Object3D {
    return this.contrails.mesh;
  }
  /** 今と前フレームの左右の翼端（ワールド）。hasPrev が false なら前フレームはない */
  private readonly tips = [new Vector3(), new Vector3()];
  private readonly prevTips = [new Vector3(), new Vector3()];
  private hasPrev = false;
  private modelOf: AircraftModel | null = null;
  private detail: AircraftDetail = 'high';

  constructor(scene: Scene) {
    this.mesh.add(this.model.group);
    scene.add(this.mesh, this.contrails.mesh);
  }

  /** 見た目を機体の形とパイロンの数（積める数）にする。同じなら作り直さない */
  setModel(model: AircraftModel, missiles: number): void {
    this.modelOf = model;
    this.model.build(model.shape, this.detail, missiles);
  }

  /** 画質（「低」は LOD） */
  setDetail(detail: AircraftDetail): void {
    this.detail = detail;
    if (this.modelOf) this.model.setDetail(detail);
  }

  /** 飛行のやり直しで飛行機雲を消す */
  reset(): void {
    this.contrails.clear();
    this.hasPrev = false;
    this.model.neutral();
  }

  /**
   * リスポーン（撃墜・墜落。4-12b）: 機体を新しい位置・姿勢へ補間なしで置き、飛行機雲を前の位置からつながない。
   * 炎・陽炎は機体の子なので一緒に移る。飛行機雲の残りは消さない（撃墜された空に残す）
   */
  respawn(aircraft: Aircraft): void {
    const s = aircraft.state;
    applyInterpolatedPose(this.mesh, s.position, s.position, s.orientation, s.orientation, 1);
    this.mesh.updateMatrixWorld(true);
    this.hasPrev = false;
    this.model.neutral();
  }

  /**
   * 描画フレームごとに呼ぶ（飛行中）。前ステップと現ステップの間を alpha で補間して置き、操舵面・残りのミサイル・
   * 炎・飛行機雲を合わせる。dt は演出の時間（ポーズ中 0）
   */
  update(
    aircraft: Aircraft,
    controls: Readonly<AircraftControls>,
    missiles: number,
    alpha: number,
    dt: number,
  ): void {
    applyInterpolatedPose(
      this.mesh,
      aircraft.prevPosition,
      aircraft.state.position,
      aircraft.prevOrientation,
      aircraft.state.orientation,
      alpha,
    );
    const alive = this.mesh.visible;
    // ピッチの反転（?invert）は飛行モデルと同じ向きに直す
    const invert = aircraft.flight.options.invertPitch ? -1 : 1;
    if (alive) this.model.steer(controls.pitch * invert, controls.roll, controls.yaw, dt);
    this.model.setMissiles(missiles);
    this.model.flame.update(alive && aircraft.state.afterburnerActive, dt);
    this.model.haze.update(
      alive ? hazeLevel(aircraft.throttle, this.model.flame.intensity) : 0,
      dt,
    );
    const s = aircraft.state;
    const g = loadFactor(s.angularRate.x, s.speed);
    this.updateContrails(alive && dt > 0 && g >= CONTRAIL_CONFIG.minLoadFactor, dt);
  }

  /** 陽炎を画面の屈折にするか（画質「高」。4-4） */
  setHazeRefraction(on: boolean): void {
    this.model.haze.refraction = on;
  }

  /** 屈折の陽炎の画面上の帯（屈折しないときは strength 0）。update の後に呼ぶ */
  hazeSegment(camera: Camera, aspect: number, out: HazeSegment): HazeSegment {
    this.mesh.updateMatrixWorld(true);
    return this.model.haze.segment(this.mesh, camera, aspect, out);
  }

  /** 高 G の間、両翼端から前フレームの位置との間を spacing ごとに埋めて玉を出す */
  private updateContrails(emit: boolean, dt: number): void {
    if (emit) {
      this.mesh.updateMatrixWorld(true);
      const local = this.model.wingTips;
      const spacing = CONTRAIL_CONFIG.spacing;
      for (let i = 0; i < 2; i++) {
        const p = local[i];
        const t = this.tips[i];
        const from = this.prevTips[i];
        if (!p || !t || !from) continue;
        this.mesh.localToWorld(t.set(p.x, p.y, p.z));
        const d = from.distanceTo(t);
        const n = this.hasPrev && d <= MAX_GAP ? Math.max(1, Math.round(d / spacing)) : 1;
        // 伸ばす向きは前フレームからの動き（なければ機首の向き）
        if (this.hasPrev && d > 1e-3) heading.subVectors(t, from).divideScalar(d);
        else heading.set(0, 0, -1).applyQuaternion(this.mesh.quaternion);
        for (let k = 1; k <= n; k++) {
          tip.lerpVectors(from, t, this.hasPrev ? k / n : 1);
          this.contrails.emit(tip.x, tip.y, tip.z, heading.x, heading.y, heading.z);
        }
        from.copy(t);
      }
    }
    this.hasPrev = emit;
    this.contrails.update(dt);
  }
}
