// 敵機 AI の操縦（Three.js 非依存）: 状態機械（enemy-fighter.ts）が決めた状態と、判断のときに見た相手・脅威から、
// 毎ステップの入力（AiCommand の pitch / roll / yaw / throttle / afterburner / trigger）を作る
import { AI_CONFIG, type DifficultySpec, type PatrolPoint } from '../data/ai';
import type { AircraftSpec } from '../data/aircraft';
import type { GunSpec } from '../data/weapons';
import { copyVec3, crossVec3, vec3, type Vec3 } from '../flight/math';
import { canFireGun, distance, gunLeadPoint, needsGroundAvoid, pursuitPoint } from './perception';
import { pitchLimitForG, steerToward, turnRates } from './steering';
import { sub, unit, type AiCommand, type AiSelf, type AiState } from './ai-types';

/** 状態機械が判断のとき（反応時間ごと）に決めた、操縦に使う情報 */
export interface PilotIntent {
  readonly state: AiState;
  /** 相手が見えているか。estimate はその今の位置の見積もり（判断のときの位置を速度で外挿） */
  readonly seen: boolean;
  readonly estimate: Readonly<Vec3>;
  readonly seenVel: Readonly<Vec3>;
  readonly seenAcc: Readonly<Vec3>;
  /** 自分を追うミサイルに気づいているか。threatPos は判断のときの位置 */
  readonly threatSeen: boolean;
  readonly threatPos: Readonly<Vec3>;
  /** 回避の種類（バレルロールか急旋回）と向き */
  readonly evadeBarrel: boolean;
  readonly evadeSide: number;
  /** 機銃の狙いのずれ（rad、左右と上下） */
  readonly aimYaw: number;
  readonly aimPitch: number;
}

const UP: Readonly<Vec3> = { x: 0, y: 1, z: 0 };
const DEG = Math.PI / 180;

export class AiPilot {
  private waypoint = 0;
  private gunPhase = 0;
  private gunFiring = true;
  private readonly aim = vec3();
  private readonly dir = vec3();
  private readonly side = vec3();
  private readonly lift = vec3();
  // 狙いの向きの回転（フィードフォワード）
  private readonly prevAim = vec3();
  private prevAimValid = false;
  private readonly aimRate = vec3();
  private readonly rates = { pitch: 0, yaw: 0 };

  constructor(
    private readonly spec: AircraftSpec,
    private patrol: readonly PatrolPoint[],
    private readonly gun: GunSpec,
    private readonly config: typeof AI_CONFIG = AI_CONFIG,
  ) {}

  /** 巡航の経路を差し替える（ミッションの敵機。2-4）。最初の点から回る */
  setPatrol(patrol: readonly PatrolPoint[]): void {
    this.patrol = patrol;
    this.waypoint = 0;
  }

  reset(): void {
    this.waypoint = 0;
    this.gunPhase = 0;
    this.gunFiring = true;
    this.prevAimValid = false;
  }

  /** 状態ごとの操縦（毎ステップ）。forward は機首方向の単位ベクトル */
  fly(
    i: PilotIntent,
    d: DifficultySpec,
    self: AiSelf,
    forward: Readonly<Vec3>,
    dt: number,
    out: AiCommand,
  ): void {
    const cfg = this.config;
    const dir = this.dir;
    out.trigger = false;
    out.afterburner = false;
    out.throttle = 1;
    const maxPitch = pitchLimitForG(this.spec, self.speed, d.maxG);
    const p = self.position;

    if (needsGroundAvoid(self.agl, self.verticalSpeed, cfg.ground)) {
      // 何より先に上昇: 機首の水平方向 + 上
      dir.x = forward.x;
      dir.y = 0;
      dir.z = forward.z;
      unit(dir, dir);
      dir.y = cfg.ground.climb;
      this.prevAimValid = false;
      steerToward(out, self.orientation, self.angularRate, dir, maxPitch, cfg.steer);
      return;
    }

    switch (i.state) {
      case 'patrol':
        this.flyPatrol(p, forward, out);
        break;
      case 'engage': {
        const e = cfg.engage;
        pursuitPoint(
          this.aim,
          p,
          self.speed,
          i.estimate,
          i.seenVel,
          e.rearOffset,
          e.maxPredictSeconds,
        );
        sub(dir, this.aim, p);
        out.afterburner =
          distance(p, i.estimate) > e.afterburnerDistance &&
          self.afterburnerGauge > e.afterburnerMinGauge;
        break;
      }
      case 'attack':
        this.flyAttack(i, d, self, forward, dt, out);
        break;
      case 'evade':
        out.afterburner = self.afterburnerGauge > 0.1;
        if (i.evadeBarrel) {
          // バレルロール: ロールし続けながら引く
          out.roll = i.evadeSide;
          out.pitch = cfg.evade.barrelRollPitch * maxPitch;
          out.yaw = 0;
          this.prevAimValid = false;
          return;
        }
        this.breakTurn(i, p, forward);
        break;
      case 'disengage':
        // 相手と反対の水平方向へ、少し上りながら
        if (i.seen) sub(dir, p, i.estimate);
        else copyVec3(dir, forward);
        dir.y = 0;
        unit(dir, dir);
        dir.y = cfg.disengage.climb;
        out.afterburner = self.afterburnerGauge > 0.2;
        break;
    }
    const tracking = i.state === 'engage' || i.state === 'attack';
    const rate = this.trackAimRate(dir, tracking, dt);
    turnRates(this.rates, this.spec, self.speed);
    steerToward(
      out,
      self.orientation,
      self.angularRate,
      dir,
      maxPitch,
      cfg.steer,
      rate,
      this.rates,
    );
  }

  /** 巡航: 経路点を順に回る（水平距離 arriveRadius 以内で次へ） */
  private flyPatrol(p: Readonly<Vec3>, forward: Readonly<Vec3>, out: AiCommand): void {
    const dir = this.dir;
    const wp = this.patrol[this.waypoint % Math.max(1, this.patrol.length)];
    if (!wp) {
      copyVec3(dir, forward);
      dir.y = 0;
    } else {
      if (Math.hypot(wp.x - p.x, wp.z - p.z) < this.config.patrol.arriveRadius) this.waypoint++;
      dir.x = wp.x - p.x;
      dir.y = wp.y - p.y;
      dir.z = wp.z - p.z;
    }
    out.throttle = this.config.patrol.throttle;
  }

  /** 攻撃: 予測照準点（+ 狙いのずれ）へ機首を向け、条件を満たせばバーストで撃つ */
  private flyAttack(
    i: PilotIntent,
    d: DifficultySpec,
    self: AiSelf,
    forward: Readonly<Vec3>,
    dt: number,
    out: AiCommand,
  ): void {
    const a = this.config.attack;
    const p = self.position;
    const t = i.estimate;
    const dir = this.dir;
    const dist = distance(p, t);
    const lead = gunLeadPoint(
      this.aim,
      p,
      self.speed,
      t,
      i.seenVel,
      this.gun,
      i.seenAcc,
      d.leadAccelWeight,
    );
    const hasLead = lead >= 0;
    if (!hasLead) copyVec3(this.aim, t);
    sub(dir, this.aim, p);
    unit(dir, dir);
    // 狙いのずれ: 狙いの向きを左右・上下に傾ける
    const side = unit(this.side, crossVec3(this.side, dir, UP));
    const lift = crossVec3(this.lift, side, dir);
    const ty = Math.tan(i.aimYaw);
    const tp = Math.tan(i.aimPitch);
    dir.x += side.x * ty + lift.x * tp;
    dir.y += side.y * ty + lift.y * tp;
    dir.z += side.z * ty + lift.z * tp;
    unit(dir, dir);

    // 機銃のバースト（撃つ → 休む）
    this.gunPhase += dt;
    if (this.gunPhase >= (this.gunFiring ? d.gunBurstSeconds : d.gunPauseSeconds)) {
      this.gunPhase = 0;
      this.gunFiring = !this.gunFiring;
    }
    const f = forward;
    const noseDeg = Math.acos(Math.min(1, f.x * dir.x + f.y * dir.y + f.z * dir.z)) / DEG;
    out.trigger = hasLead && this.gunFiring && canFireGun(noseDeg, dist, d, a);
    out.throttle = dist < a.closeDistance ? a.closeThrottle : 1;
  }

  /** 急旋回: 脅威（ミサイル、なければ相手）への向きと上方向に直交する向きのうち、機首に近い側へ */
  private breakTurn(i: PilotIntent, p: Readonly<Vec3>, forward: Readonly<Vec3>): void {
    const threat = i.threatSeen ? i.threatPos : i.estimate;
    const toThreat = sub(this.aim, threat, p);
    const dir = unit(this.dir, crossVec3(this.dir, toThreat, UP));
    if (dir.x * forward.x + dir.z * forward.z < 0) {
      dir.x = -dir.x;
      dir.y = -dir.y;
      dir.z = -dir.z;
    }
  }

  /** 狙いの向き（単位ベクトルにする）の前ステップからの回転（rad/s）。追尾・攻撃のときだけ */
  private trackAimRate(dir: Vec3, tracking: boolean, dt: number): Vec3 | null {
    unit(dir, dir);
    const prev = this.prevAim;
    let rate: Vec3 | null = null;
    const valid = tracking && this.prevAimValid && dt > 0;
    // 狙いが大きく飛んだ（状態が変わった・相手を見直した）ステップは使わない
    if (valid && prev.x * dir.x + prev.y * dir.y + prev.z * dir.z > Math.cos(10 * DEG)) {
      rate = crossVec3(this.aimRate, prev, dir);
      rate.x /= dt;
      rate.y /= dt;
      rate.z /= dt;
    }
    copyVec3(prev, dir);
    this.prevAimValid = tracking;
    return rate;
  }
}
