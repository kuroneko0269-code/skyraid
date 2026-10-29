import type { AircraftSpec, TurnCurvePoint } from '../data/aircraft';
import { FLIGHT_CONFIG } from '../data/flight';
import {
  approachFactor,
  clamp,
  copyQuat,
  copyVec3,
  crossVec3,
  lengthVec3,
  multiplyQuat,
  normalizeQuat,
  quatFromRotationVector,
  quatIdentity,
  rotateVec3,
  smoothstep,
  vec3,
  type Quat,
  type Vec3,
} from './math';

export type FlightConfig = typeof FLIGHT_CONFIG;

/** 操作入力。pitch +1 = 機首上げ、roll +1 = 右ロール、yaw +1 = 機首右 */
export interface FlightInput {
  pitch: number;
  roll: number;
  yaw: number;
  /** 0〜1 */
  throttle: number;
  afterburner: boolean;
}

export interface FlightOptions {
  autoLevel: boolean;
  /** true なら pitch 入力の符号を反転する */
  invertPitch: boolean;
}

export interface FlightState {
  /** 位置（m）。y が高度 */
  readonly position: Vec3;
  /** 姿勢。機体ローカルで前方 -Z、上 +Y、右 +X */
  readonly orientation: Quat;
  /** 進行方向の速度（m/s） */
  speed: number;
  /** アフターバーナーゲージ（0〜1） */
  afterburnerGauge: number;
  afterburnerActive: boolean;
  /** ゲージを使い切って再点火待ちか */
  afterburnerLocked: boolean;
  /** 失速の度合い（0 = なし、1 = 最大） */
  stall: number;
  /** 機体ローカルの角速度（rad/s）。x = ピッチ、y = ヨー、z = ロール（Three.js の回転方向） */
  readonly angularRate: Vec3;
}

export const LOCAL_FORWARD: Readonly<Vec3> = { x: 0, y: 0, z: -1 };
export const LOCAL_UP: Readonly<Vec3> = { x: 0, y: 1, z: 0 };
export const LOCAL_RIGHT: Readonly<Vec3> = { x: 1, y: 0, z: 0 };
const WORLD_DOWN: Readonly<Vec3> = { x: 0, y: -1, z: 0 };
const DEG = Math.PI / 180;

/** 速度に対する旋回率の係数を折れ線で求める。範囲外は端の値 */
export function turnFactor(curve: readonly TurnCurvePoint[], speed: number): number {
  const first = curve[0];
  if (!first) return 1;
  if (speed <= first.speed) return first.factor;
  for (let i = 1; i < curve.length; i++) {
    const b = curve[i];
    const a = curve[i - 1];
    if (!a || !b) break;
    if (speed <= b.speed) {
      const t = (speed - a.speed) / (b.speed - a.speed);
      return a.factor + (b.factor - a.factor) * t;
    }
  }
  return curve[curve.length - 1]?.factor ?? 1;
}

/** 水平飛行で cruise 速度に落ち着くスロットル値 */
export function cruiseThrottle(spec: AircraftSpec): number {
  const { idle, military, cruise } = spec.speed;
  return clamp((cruise - idle) / (military - idle), 0, 1);
}

/** 地面衝突判定 */
export function hitsGround(position: Readonly<Vec3>, groundAltitude: number): boolean {
  return position.y <= groundAltitude;
}

/**
 * アーケード飛行モデル。速度は進行方向のスカラーで、横滑りはない。
 * step() は固定タイムステップ（1/60 秒）で呼ぶ前提
 */
export class FlightModel {
  readonly state: FlightState;
  readonly options: FlightOptions;

  private rechargeTimer = 0;
  // 毎ステップのアロケーションを避けるための作業領域
  private readonly forward = vec3();
  private readonly up = vec3();
  private readonly right = vec3();
  private readonly axis = vec3();
  private readonly dq = quatIdentity();

  constructor(
    readonly spec: AircraftSpec,
    options: Partial<FlightOptions> = {},
    readonly config: FlightConfig = FLIGHT_CONFIG,
  ) {
    this.options = { ...config.defaults, ...options };
    this.state = {
      position: vec3(),
      orientation: quatIdentity(),
      speed: 0,
      afterburnerGauge: 1,
      afterburnerActive: false,
      afterburnerLocked: false,
      stall: 0,
      angularRate: vec3(),
    };
    this.reset(config.spawn.position);
  }

  /** 指定位置に初期姿勢（水平・-Z 向き）・巡航速度・ゲージ満タンで置き直す */
  reset(position: Readonly<Vec3>): void {
    const s = this.state;
    copyVec3(s.position, position);
    copyQuat(s.orientation, quatIdentity());
    s.speed = this.spec.speed.cruise;
    s.afterburnerGauge = 1;
    s.afterburnerActive = false;
    s.afterburnerLocked = false;
    s.stall = 0;
    copyVec3(s.angularRate, vec3());
    this.rechargeTimer = 0;
  }

  /** バンク角（度）。右に傾くと正、範囲は -180〜180 */
  bankAngle(): number {
    const q = this.state.orientation;
    rotateVec3(this.right, q, LOCAL_RIGHT);
    rotateVec3(this.up, q, LOCAL_UP);
    return Math.atan2(-this.right.y, this.up.y) / DEG;
  }

  /** 機首の上下角（度）。上向きが正 */
  pitchAngle(): number {
    rotateVec3(this.forward, this.state.orientation, LOCAL_FORWARD);
    return Math.asin(clamp(this.forward.y, -1, 1)) / DEG;
  }

  step(input: Readonly<FlightInput>, dt: number): void {
    const s = this.state;
    const q = s.orientation;
    rotateVec3(this.forward, q, LOCAL_FORWARD);

    this.updateAfterburner(input.afterburner, dt);
    this.updateSpeed(input.throttle, dt);
    this.updateRotation(input, dt);

    // 位置: 進行方向へ速度分、失速中は沈下を足す
    rotateVec3(this.forward, q, LOCAL_FORWARD);
    s.position.x += this.forward.x * s.speed * dt;
    s.position.y += (this.forward.y * s.speed - this.config.stall.sinkSpeed * s.stall) * dt;
    s.position.z += this.forward.z * s.speed * dt;
    if (s.position.y > this.config.ceiling.end) s.position.y = this.config.ceiling.end;
  }

  private updateAfterburner(pressed: boolean, dt: number): void {
    const s = this.state;
    const ab = this.spec.afterburner;
    if (s.afterburnerLocked && s.afterburnerGauge >= ab.restartThreshold) {
      s.afterburnerLocked = false;
    }
    if (pressed && !s.afterburnerLocked && s.afterburnerGauge > 0) {
      s.afterburnerActive = true;
      s.afterburnerGauge -= dt / ab.durationSeconds;
      this.rechargeTimer = 0;
      if (s.afterburnerGauge <= 0) {
        s.afterburnerGauge = 0;
        s.afterburnerLocked = true;
      }
      return;
    }
    s.afterburnerActive = false;
    this.rechargeTimer += dt;
    if (this.rechargeTimer >= ab.rechargeDelaySeconds) {
      s.afterburnerGauge = Math.min(1, s.afterburnerGauge + dt / ab.rechargeSeconds);
    }
  }

  private updateSpeed(throttle: number, dt: number): void {
    const s = this.state;
    const sp = this.spec.speed;
    const t = clamp(throttle, 0, 1);
    const target = s.afterburnerActive ? sp.afterburner : sp.idle + (sp.military - sp.idle) * t;
    const response = s.afterburnerActive ? sp.afterburnerResponse : sp.response;
    const maxAccel = s.afterburnerActive ? sp.afterburnerMaxAccel : sp.maxAccel;
    // エンジン: 目標速度へ追従（加減速に上限）。重力: 機首が上なら減速、下なら加速
    const engine = clamp((target - s.speed) * response, -sp.maxDecel, maxAccel);
    const gravity = this.config.gravity * this.config.gravitySpeedScale * this.forward.y;
    const accel = engine - gravity;
    s.speed = clamp(s.speed + accel * dt, 0, sp.limit);
    s.stall = smoothstep(0, this.config.stall.range, sp.stall - s.speed);
  }

  private updateRotation(input: Readonly<FlightInput>, dt: number): void {
    const s = this.state;
    const cfg = this.config;
    const rates = this.spec.rates;
    const q = s.orientation;

    const factor = turnFactor(this.spec.turnCurve, s.speed);
    const authority = 1 - (1 - cfg.stall.minAuthority) * s.stall;
    const rollFactor = 1 - rates.rollSpeedSensitivity * (1 - factor);
    const pitchIn = clamp(input.pitch, -1, 1) * (this.options.invertPitch ? -1 : 1);
    const rollIn = clamp(input.roll, -1, 1);
    const yawIn = clamp(input.yaw, -1, 1);

    let rollTarget = rollIn * rates.roll * rollFactor * authority;
    const bank = this.bankAngle();
    if (this.options.autoLevel && pitchIn === 0 && rollIn === 0) {
      rollTarget = this.autoLevelRate(bank);
    }
    const pitchTarget = pitchIn * rates.pitch * factor * authority;
    const yawTarget = yawIn * rates.yaw * factor * authority;

    // 角速度は入力に遅れて立ち上がる（機体の重さ）。Three.js の回転方向に合わせる:
    // ピッチ上げ = +X 回り、右ロール = -Z 回り、右ヨー = -Y 回り
    const k = approachFactor(cfg.rateResponse, dt);
    const w = s.angularRate;
    w.x += (pitchTarget * DEG - w.x) * k;
    w.y += (-yawTarget * DEG - w.y) * k;
    w.z += (-rollTarget * DEG - w.z) * k;
    multiplyQuat(q, q, quatFromRotationVector(this.dq, w.x * dt, w.y * dt, w.z * dt));

    // バンクしていると機首が自然に横へ向く（世界の上下軸回り）
    const bankTurn = -Math.sin(bank * DEG) * cfg.bankTurnRate * factor * authority * DEG * dt;
    multiplyQuat(q, quatFromRotationVector(this.dq, 0, bankTurn, 0), q);

    // 失速: 機首を真下へ向ける
    if (s.stall > 0) this.pitchTowardDown(cfg.stall.noseDropRate * s.stall * DEG * dt);
    // 高度上限: 機首が上を向いていれば下げる
    const ceiling = smoothstep(cfg.ceiling.start, cfg.ceiling.end, s.position.y);
    rotateVec3(this.forward, q, LOCAL_FORWARD);
    if (ceiling > 0 && this.forward.y > 0) {
      this.pitchTowardDown(cfg.ceiling.pushRate * ceiling * DEG * dt);
    }
    normalizeQuat(q);
  }

  /** 入力がないときにバンクを戻すロール角速度（度/秒、右ロールが正） */
  private autoLevelRate(bank: number): number {
    const cfg = this.config.autoLevel;
    rotateVec3(this.forward, this.state.orientation, LOCAL_FORWARD);
    const vertical = Math.abs(this.forward.y);
    // 機首が真上・真下に近いとバンク角が定まらないので効果を弱める
    const fade = 1 - smoothstep(cfg.maxNoseVertical * 0.7, cfg.maxNoseVertical, vertical);
    return clamp(-bank * cfg.gain, -cfg.maxRate, cfg.maxRate) * fade;
  }

  /** 機首を世界の真下へ向けて angle（rad）だけ回す。行き過ぎない */
  private pitchTowardDown(angle: number): void {
    const q = this.state.orientation;
    rotateVec3(this.forward, q, LOCAL_FORWARD);
    crossVec3(this.axis, this.forward, WORLD_DOWN);
    let len = lengthVec3(this.axis);
    if (len < 1e-4) {
      if (this.forward.y < 0) return; // すでに真下
      // 真上を向いているときは機体の右軸回りに倒す（腹側へ機首下げ）
      rotateVec3(this.axis, q, LOCAL_RIGHT);
      this.axis.x = -this.axis.x;
      this.axis.y = -this.axis.y;
      this.axis.z = -this.axis.z;
      len = 1;
    }
    const remaining = Math.acos(clamp(-this.forward.y, -1, 1));
    const a = Math.min(angle, remaining) / len;
    quatFromRotationVector(this.dq, this.axis.x * a, this.axis.y * a, this.axis.z * a);
    multiplyQuat(q, this.dq, q);
  }
}
