import { STARTER_AIRCRAFT, type AircraftSpec } from '../data/aircraft';
import { FLIGHT_CONFIG } from '../data/flight';
import {
  FlightModel,
  LOCAL_FORWARD,
  cruiseThrottle,
  hitsGround,
  type FlightConfig,
  type FlightInput,
  type FlightOptions,
  type FlightState,
} from '../flight/flight-model';
import {
  clamp,
  copyQuat,
  copyVec3,
  quatIdentity,
  rotateVec3,
  vec3,
  type Quat,
  type Vec3,
} from '../flight/math';

/** プレイヤーの操作（キーボード等から作る）。throttle はスロットルを上げ下げする向き（-1〜+1） */
export interface AircraftControls {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  afterburner: boolean;
  /** スロットル位置（0〜1）の直接指定（タッチのスライダー）。null / 省略なら変えない */
  throttleTarget?: number | null;
}

/** 何も操作していない操作（毎ステップ書き換えて使う入れ物） */
export function createControls(): AircraftControls {
  return { pitch: 0, roll: 0, yaw: 0, throttle: 0, afterburner: false, throttleTarget: null };
}

/** (x, z) の地表の高さ（m）。海の上なら海面の高さ */
export type GroundHeightFn = (x: number, z: number) => number;

/**
 * 機体エンティティ。飛行モデルとスロットル位置を持ち、固定ステップで更新する。
 * 描画補間のため、直前のステップの位置・姿勢も保持する
 */
export class Aircraft {
  readonly flight: FlightModel;
  /** スロットル位置（0〜1） */
  throttle: number;
  /** 地面に衝突してリセットした回数 */
  crashCount = 0;
  readonly prevPosition: Vec3 = vec3();
  readonly prevOrientation: Quat = quatIdentity();

  private readonly flightInput: FlightInput = {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttle: 0,
    afterburner: false,
  };
  private readonly resetPosition: Vec3 = vec3();

  constructor(
    spec: AircraftSpec = STARTER_AIRCRAFT,
    options: Partial<FlightOptions> = {},
    private readonly config: FlightConfig = FLIGHT_CONFIG,
    // 地形は render/terrain-height.ts の関数を main.ts から渡す（entities/ から render/ を参照しない）
    private readonly groundHeight: GroundHeightFn = () => config.groundAltitude,
  ) {
    this.flight = new FlightModel(spec, options, config);
    this.throttle = cruiseThrottle(spec);
    this.savePrevious();
  }

  get state(): FlightState {
    return this.flight.state;
  }

  /** 速度ベクトル（m/s）を out に書く。機首方向 × 速さ + 失速の沈下（横滑りなし） */
  velocity(out: Vec3): Vec3 {
    const s = this.state;
    rotateVec3(out, s.orientation, LOCAL_FORWARD);
    out.x *= s.speed;
    out.y = out.y * s.speed - this.config.stall.sinkSpeed * s.stall;
    out.z *= s.speed;
    return out;
  }

  step(controls: Readonly<AircraftControls>, dt: number): void {
    this.savePrevious();
    const target = controls.throttleTarget ?? null;
    if (target !== null) this.throttle = clamp(target, 0, 1);
    this.throttle = clamp(this.throttle + controls.throttle * this.config.throttleRate * dt, 0, 1);

    const input = this.flightInput;
    input.pitch = controls.pitch;
    input.roll = controls.roll;
    input.yaw = controls.yaw;
    input.throttle = this.throttle;
    input.afterburner = controls.afterburner;
    this.flight.step(input, dt);

    const p = this.state.position;
    if (hitsGround(p, this.groundHeight(p.x, p.z))) this.crash();
  }

  /** 指定位置に初期姿勢（または orientation）・巡航速度で置き直す（補間しない） */
  respawn(position: Readonly<Vec3>, orientation: Readonly<Quat> | null = null): void {
    this.flight.reset(position);
    if (orientation) copyQuat(this.flight.state.orientation, orientation);
    this.throttle = cruiseThrottle(this.flight.spec);
    this.savePrevious();
  }

  /** 墜落地点の地表から spawn.position.y 上空に初期姿勢で戻す（演出なし） */
  private crash(): void {
    this.crashCount++;
    const p = this.state.position;
    this.resetPosition.x = p.x;
    this.resetPosition.y = this.groundHeight(p.x, p.z) + this.config.spawn.position.y;
    this.resetPosition.z = p.z;
    this.respawn(this.resetPosition);
  }

  private savePrevious(): void {
    copyVec3(this.prevPosition, this.state.position);
    copyQuat(this.prevOrientation, this.state.orientation);
  }
}
