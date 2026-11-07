// 10-2: 光線（レイドの怪獣の共通の部品。UFO を想定）。2 つの撃ち方:
// - なぎ払い（sweep）: 予兆（warn 秒。撃つ線の向きの始めと終わりを見せる）→ 撃つ（fire 秒の間に始めの方位から終わりの方位へ回す）
// - 溜め撃ち（charged）: ロック警告（warn 秒。狙う人を追って向きを変える。HUD に警告）→ 溜め（charge 秒。向きを止める = 避けどき）
//   → 撃つ（fire 秒。止めた向きのまま）
// 予兆と溜めの間は当たらない（理不尽にしない: 予兆を必ず見せる）。当たりは線分からの距離（半径 radius）。撃つ間は
// 1 人に 1 回だけ当てる（hitIds）。決まった計算・状態は数と配列だけ。Three.js・DOM 非依存
import { vec3, type Vec3 } from '../../flight/math';
import { bodyDirection, relativeAim, segmentDistance, type BodyFrame } from './frame';

export type BeamPhase = 'idle' | 'warn' | 'charge' | 'fire' | 'recover';
export type BeamKind = 'sweep' | 'charged';

export interface BeamSpec {
  readonly warn: number;
  /** 溜め（溜め撃ちだけ。なぎ払いは 0） */
  readonly charge: number;
  readonly fire: number;
  readonly recover: number;
  readonly length: number;
  readonly radius: number;
  readonly damage: number;
}

const PHASES: readonly BeamPhase[] = ['idle', 'warn', 'charge', 'fire', 'recover'];

export class Beam {
  phase: BeamPhase = 'idle';
  kind: BeamKind = 'sweep';
  /** 今の段の経過秒 */
  time = 0;
  /** 向き（体の向きからの相対の方位・仰角の度）。なぎ払いは始めと終わり */
  yawDeg = 0;
  pitchDeg = 0;
  fromYawDeg = 0;
  toYawDeg = 0;
  /** 狙う人（溜め撃ちのロック警告。-1 は無し） */
  targetId = -1;
  /** この撃ちで当てた人 */
  readonly hitIds: number[] = [];
  /** 撃った回数（なぎ払い・溜め撃ち） */
  shots = 0;
  /** 線の始まり（口）と向き（世界。step で更新） */
  readonly origin: Vec3 = vec3();
  readonly direction: Vec3 = vec3(0, 0, -1);

  constructor(
    readonly sweep: BeamSpec,
    readonly charged: BeamSpec,
  ) {}

  get spec(): BeamSpec {
    return this.kind === 'sweep' ? this.sweep : this.charged;
  }

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  /** 協力の state の番号（PHASES の順） */
  get phaseIndex(): number {
    return PHASES.indexOf(this.phase);
  }

  /** なぎ払いを始める（方位は体の向きからの相対の度。仰角は固定） */
  startSweep(fromYawDeg: number, toYawDeg: number, pitchDeg: number): boolean {
    if (this.busy) return false;
    this.kind = 'sweep';
    this.fromYawDeg = fromYawDeg;
    this.toYawDeg = toYawDeg;
    this.yawDeg = fromYawDeg;
    this.pitchDeg = pitchDeg;
    this.begin();
    return true;
  }

  /** 溜め撃ちを始める（狙う人を追うのはロック警告の間だけ） */
  startCharged(targetId: number): boolean {
    if (this.busy) return false;
    this.kind = 'charged';
    this.targetId = targetId;
    this.begin();
    return true;
  }

  private begin(): void {
    this.phase = 'warn';
    this.time = 0;
    this.hitIds.length = 0;
  }

  /** 1 ステップ。mouth は口の位置、target は狙う人の位置（溜め撃ちのロック警告で追う。いなければ null） */
  step(dt: number, body: BodyFrame, mouth: Readonly<Vec3>, target: Readonly<Vec3> | null): void {
    this.origin.x = mouth.x;
    this.origin.y = mouth.y;
    this.origin.z = mouth.z;
    if (this.phase === 'idle') return;
    this.time += dt;
    const s = this.spec;
    if (this.kind === 'charged' && this.phase === 'warn' && target) {
      const aim = relativeAim(body, mouth, target);
      this.yawDeg = aim.yawDeg;
      this.pitchDeg = aim.pitchDeg;
    }
    if (this.phase === 'fire' && this.kind === 'sweep') {
      const k = s.fire > 0 ? Math.min(1, this.time / s.fire) : 1;
      this.yawDeg = this.fromYawDeg + (this.toYawDeg - this.fromYawDeg) * k;
    }
    bodyDirection(this.direction, body, this.yawDeg, this.pitchDeg);
    if (this.phase === 'warn' && this.time >= s.warn) this.next(s.charge > 0 ? 'charge' : 'fire');
    else if (this.phase === 'charge' && this.time >= s.charge) this.next('fire');
    else if (this.phase === 'fire' && this.time >= s.fire) {
      this.shots++;
      this.next('recover');
    } else if (this.phase === 'recover' && this.time >= s.recover) {
      this.next('idle');
      this.targetId = -1;
    }
  }

  private next(phase: BeamPhase): void {
    this.phase = phase;
    this.time = 0;
  }

  /** 撃つ間に当たったか（当たったら hitIds に入れ、同じ撃ちではもう当たらない）。予兆・溜めの間は当たらない */
  hits(id: number, point: Readonly<Vec3>, radius: number): boolean {
    if (this.phase !== 'fire' || this.hitIds.includes(id)) return false;
    const s = this.spec;
    if (segmentDistance(point, this.origin, this.direction, s.length) > s.radius + radius)
      return false;
    this.hitIds.push(id);
    return true;
  }

  /** 撃つまでの残り秒（予兆・溜めの間。HUD の警告の数字。撃っている・休んでいるときは 0） */
  get untilFire(): number {
    const s = this.spec;
    if (this.phase === 'warn') return s.warn - this.time + s.charge;
    if (this.phase === 'charge') return s.charge - this.time;
    return 0;
  }

  /** やめる（瞬間移動・怯みなど。撃つ前ならまだ当たっていない） */
  cancel(): void {
    this.phase = 'idle';
    this.time = 0;
    this.targetId = -1;
  }
}
