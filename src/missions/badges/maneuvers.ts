// 勲章（9-10）の操縦の判定（Three.js・DOM 非依存）: 宙返り・インメルマン・低空飛行・背面飛行・最高速。
// 固定ステップの後の自機の位置・向き・速さと地表の高さだけを読む（どれも決まった計算の値）ので、同じ記録を再生すれば同じ結果になる。
// 判定の状態（GamePlay）には入れない観測役: リプレイのハッシュ・キーフレームは変わらない
import { BADGE_CONFIG } from '../../data/badges';
import { crossVec3, rotateVec3, vec3, type Quat, type Vec3 } from '../../flight/math';

export const MANEUVERS = ['loop', 'immelmann', 'lowPass', 'inverted', 'topSpeed'] as const;
export type Maneuver = (typeof MANEUVERS)[number];

const FORWARD: Readonly<Vec3> = { x: 0, y: 0, z: -1 };
const UP: Readonly<Vec3> = { x: 0, y: 1, z: 0 };
const RIGHT: Readonly<Vec3> = { x: 1, y: 0, z: 0 };
const RAD = 180 / Math.PI;

/** 1 ステップ分の自機の状態 */
export interface ManeuverSample {
  readonly position: Readonly<Vec3>;
  readonly orientation: Readonly<Quat>;
  readonly speed: number;
  /** 地表・海面からの高さ（m） */
  readonly agl: number;
  /** 撃墜されていない */
  readonly active: boolean;
  /** 撃墜（墜落も）の回数（変わったらやり直す） */
  readonly downs: number;
}

export class ManeuverWatch {
  /** 取った操縦（飛行 1 回の中で） */
  readonly done = new Set<Maneuver>();
  private readonly f = vec3();
  private readonly u = vec3();
  private readonly r = vec3();
  private readonly prevF = vec3();
  private readonly prevPos = vec3();
  private readonly axis = vec3();
  private hasPrev = false;
  private downs = 0;
  /** 機首を上げる向きの回転の足し合わせ（度。0 未満にしない）と、その間に通った姿勢・始めの向きと高さ・経過 */
  private pitch = 0;
  private sawUp = false;
  private sawInverted = false;
  private sawDown = false;
  private readonly startHeading = { x: 0, z: 0 };
  private startY = 0;
  private time = 0;
  private lowTime = 0;
  private invTime = 0;

  /** 飛行の始め */
  reset(): void {
    this.done.clear();
    this.hasPrev = false;
    this.restart();
  }

  /** 固定ステップ 1 回分（dt 秒） */
  step(s: ManeuverSample, dt: number): void {
    const c = BADGE_CONFIG;
    rotateVec3(this.f, s.orientation, FORWARD);
    rotateVec3(this.u, s.orientation, UP);
    rotateVec3(this.r, s.orientation, RIGHT);
    const p = s.position;
    const moved = this.hasPrev
      ? Math.hypot(p.x - this.prevPos.x, p.y - this.prevPos.y, p.z - this.prevPos.z)
      : 0;
    // 撃墜・復帰・置き直し（レースの墜落・練習場の始め）はやり直す
    const jump = moved > s.speed * dt + c.teleportM;
    if (!s.active || !this.hasPrev || jump || s.downs !== this.downs) {
      this.downs = s.downs;
      this.restart();
      this.keep(p);
      this.hasPrev = s.active;
      return;
    }
    if (s.speed >= c.topSpeed) this.done.add('topSpeed');
    this.stepLow(s, dt);
    this.stepInverted(s, dt);
    this.stepPitch(p, dt);
    this.keep(p);
  }

  private keep(p: Readonly<Vec3>): void {
    this.prevPos.x = p.x;
    this.prevPos.y = p.y;
    this.prevPos.z = p.z;
    this.prevF.x = this.f.x;
    this.prevF.y = this.f.y;
    this.prevF.z = this.f.z;
  }

  private restart(): void {
    this.resetPitch(0);
    this.lowTime = 0;
    this.invTime = 0;
  }

  private stepLow(s: ManeuverSample, dt: number): void {
    const c = BADGE_CONFIG.lowPass;
    if (s.agl > 0 && s.agl < c.maxAglM && s.speed >= c.minSpeed) this.lowTime += dt;
    else this.lowTime = 0;
    if (this.lowTime >= c.seconds) this.done.add('lowPass');
  }

  private stepInverted(s: ManeuverSample, dt: number): void {
    const c = BADGE_CONFIG.inverted;
    if (this.u.y <= c.upY && s.agl >= c.minAglM) this.invTime += dt;
    else this.invTime = 0;
    if (this.invTime >= c.seconds) this.done.add('inverted');
  }

  /** 機首を上げる向きの回転を足し、宙返り・インメルマンを見る */
  private stepPitch(p: Readonly<Vec3>, dt: number): void {
    const c = BADGE_CONFIG;
    // 前の向きから今の向きへの回転の軸が右の向きなら機首上げ（前 −Z を上 +Y へ回すと軸は +X）
    crossVec3(this.axis, this.prevF, this.f);
    const sin = Math.hypot(this.axis.x, this.axis.y, this.axis.z);
    const along = this.axis.x * this.r.x + this.axis.y * this.r.y + this.axis.z * this.r.z;
    const deg = Math.asin(Math.min(1, sin)) * RAD * (along >= 0 ? 1 : -1);
    const next = this.pitch + deg;
    // 上を向いた水平の間（まだ真上を通っていない）は始めの位置を置き直す: 旋回の引きの回転を数えに持ち込まない
    if (next <= 0 || (!this.sawUp && this.u.y > 0.5 && Math.abs(this.f.y) < c.immelmann.level)) {
      // 機首を下げた（足し合わせが 0 に戻った）・水平に戻ったら、ここから数え直す
      this.resetPitch(p.y);
      return;
    }
    this.pitch = next;
    this.time += dt;
    if (this.time > c.loop.windowSeconds) {
      this.resetPitch(p.y);
      return;
    }
    if (this.f.y >= c.loop.noseUp) this.sawUp = true;
    if (this.u.y <= c.loop.inverted) this.sawInverted = true;
    if (this.sawUp && this.sawInverted && this.f.y <= c.loop.noseDown) this.sawDown = true;
    if (this.pitch >= c.loop.pitchDeg && this.sawUp && this.sawInverted && this.sawDown) {
      this.done.add('loop');
      this.resetPitch(p.y);
      return;
    }
    this.checkImmelmann(p);
  }

  private checkImmelmann(p: Readonly<Vec3>): void {
    const c = BADGE_CONFIG.immelmann;
    if (this.time > c.windowSeconds || this.pitch < c.pitchDeg) return;
    if (!this.sawUp || !this.sawInverted) return;
    if (this.u.y < c.upright || Math.abs(this.f.y) > c.level) return;
    const h = Math.hypot(this.f.x, this.f.z);
    if (h <= 0) return;
    const dot = (this.f.x * this.startHeading.x + this.f.z * this.startHeading.z) / h;
    if (dot <= c.reverse && p.y - this.startY >= c.climbM) {
      this.done.add('immelmann');
      this.resetPitch(p.y);
    }
  }

  /** 機首上げの数えを 0 から（始めの向き・高さはここ） */
  private resetPitch(y: number): void {
    this.pitch = 0;
    this.time = 0;
    this.sawUp = false;
    this.sawInverted = false;
    this.sawDown = false;
    this.startY = y;
    const h = Math.hypot(this.f.x, this.f.z);
    this.startHeading.x = h > 0 ? this.f.x / h : 0;
    this.startHeading.z = h > 0 ? this.f.z / h : 0;
  }
}
