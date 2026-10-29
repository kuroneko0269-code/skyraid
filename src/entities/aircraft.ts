import { STARTER_AIRCRAFT, type AircraftSpec } from '../data/aircraft';
import { FLIGHT_CONFIG } from '../data/flight';
import {
  FlightModel,
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

  /** 指定位置に初期姿勢・巡航速度で置き直す（補間しない） */
  respawn(position: Readonly<Vec3>): void {
    this.flight.reset(position);
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
