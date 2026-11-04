// 「方向へ倒す」方式の宙返り（9-3。Three.js 非依存）: 上へ端まで倒し続けて上下の角度の上限の近くまで上がると、上限を越えて縦に回る。
// 数値は src/data/steer.ts の DIRECT_STEER_CONFIG.loop。DirectSteer（direct-steer.ts）が毎ステップ呼ぶ
//
// - 入る: stickY ≥ entryStick・上下の角度 ≥ entryElevationDeg・背中が上・速さが足りる（canLoop）。入った時の方位と真上を含む縦の面で回る
// - 回る: 翼を水平に（機体の右 = 面の法線）・機首を面の中に（ヨー）・引きは輪の半径から（失速しないよう、遅いほど小さい輪 = 強く引く）
// - 抜ける: stickY < holdStick（離した）・1 回転した・面から大きく外れた（復帰など）。抜けた後は DirectSteer の普通の組み立て
//   （頂点の背面で離すと、ロールで水平に戻って反対向きに飛ぶ = インメルマン）
// - 下へ倒し続けたときは今までどおり -maxElevationDeg で止まる（低空の安全を優先。スプリット S は入れない: docs/decisions.md の 9-3）
import { FLIGHT_CONFIG } from '../data/flight';
import type { AircraftSpec } from '../data/aircraft';
import { DIRECT_STEER_CONFIG } from '../data/steer';
import { turnFactor, type FlightState } from './flight-model';
import { clamp, type Vec3 } from './math';
import type { SteerCommand } from './direct-steer';

export type LoopConfig = (typeof DIRECT_STEER_CONFIG)['loop'];

const DEG = Math.PI / 180;
/** 速さの増減に効く重力（m/s²。飛行モデルと同じ: 重力 × 速度の倍率）。高さ Δh 上がると v² が 2 × これ × Δh 減る */
const GRAVITY_SPEED = FLIGHT_CONFIG.gravity * FLIGHT_CONFIG.gravitySpeedScale;

/** 機体の今の引きの角速度の最大（rad/s。速さと失速で変わる。飛行モデルと同じ式） */
export function maxPitchRate(spec: Readonly<AircraftSpec>, state: Readonly<FlightState>): number {
  const authority = 1 - (1 - FLIGHT_CONFIG.stall.minAuthority) * state.stall;
  return spec.rates.pitch * turnFactor(spec.turnCurve, state.speed) * authority * DEG;
}

/**
 * 失速しない輪の半径の上限（m）: 進み具合 theta（rad。0 = 入った向きで水平、π/2 = 真上、π = 頂点の背面）から頂点までの残りの高さで
 * 失う速さを引いて、頂点で 失速速度 × topSpeedRatio が残る半径。頂点を過ぎたら（下りは速くなる）制限なし
 */
export function safeLoopRadius(
  spec: Readonly<AircraftSpec>,
  speed: number,
  theta: number,
  cfg: LoopConfig = DIRECT_STEER_CONFIG.loop,
): number {
  if (theta >= Math.PI) return Infinity;
  const vMin = spec.speed.stall * cfg.topSpeedRatio;
  const rise = 1 + Math.cos(theta);
  if (rise < 1e-6) return Infinity;
  return Math.max(0, (speed * speed - vMin * vMin) / (2 * GRAVITY_SPEED * rise));
}

/** 宙返りに入れる速さか: 端まで倒した輪（失速しない大きさまで）で回るのに要る角速度が、引きの角速度 × entryMargin 以下 */
export function canLoop(
  spec: Readonly<AircraftSpec>,
  state: Readonly<FlightState>,
  theta: number,
  cfg: LoopConfig = DIRECT_STEER_CONFIG.loop,
): boolean {
  const r = Math.min(cfg.radius, safeLoopRadius(spec, state.speed, theta, cfg));
  if (r <= 0) return false;
  return state.speed / r <= maxPitchRate(spec, state) * cfg.entryMargin;
}

export class LoopSteer {
  /** 宙返りの途中か */
  active = false;
  /** 上へ端まで倒して上限の近くにいるのに、速さが足りなくて入れない（HUD の「速度不足」） */
  blocked = false;
  /** 回る面の「前」（水平の単位ベクトル。入ったときの方位）と法線（= 前 × 真上。入ったときの機体の右） */
  private readonly dir: Vec3 = { x: 0, y: 0, z: -1 };
  private readonly normal: Vec3 = { x: 1, y: 0, z: 0 };
  /** 進み具合（rad。面の「前」で水平が 0、真上 π/2、頂点の背面 π、真下 3π/2。2π で抜ける） */
  private theta = 0;

  constructor(private readonly cfg: LoopConfig = DIRECT_STEER_CONFIG.loop) {}

  reset(): void {
    this.active = false;
    this.blocked = false;
  }

  /**
   * 宙返りの操縦を out に書いたら true（普通の組み立てをしない）。f・u・r は機体の前・上・右（ワールド）、hx・hz は今の方位、
   * elev は上下の角度（rad）。groundFloor は低空の安全の下向きの下限（rad）
   */
  apply(
    out: SteerCommand,
    state: Readonly<FlightState>,
    spec: Readonly<AircraftSpec> | null,
    stickY: number,
    f: Readonly<Vec3>,
    u: Readonly<Vec3>,
    r: Readonly<Vec3>,
    hx: number,
    hz: number,
    elev: number,
    groundFloor: () => number,
  ): boolean {
    const cfg = this.cfg;
    this.blocked = false;
    if (!spec) {
      this.active = false;
      return false;
    }
    if (!this.active && !this.enter(state, spec, stickY, u, hx, hz, elev)) return false;
    // 進み具合: 面の中の機首の角度（前回から近い側へ続ける）
    const along = f.x * this.dir.x + f.z * this.dir.z;
    const raw = Math.atan2(f.y, along);
    let d = raw - (this.theta % (2 * Math.PI));
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.theta += d;
    const n = this.normal;
    const off = f.x * n.x + f.y * n.y + f.z * n.z;
    const released = stickY < cfg.holdStick;
    if (this.theta >= 2 * Math.PI || Math.abs(off) > 0.5 || (released && this.canRelease())) {
      this.active = false;
      return false;
    }
    // 翼を水平に: 機体の右を面の法線へ（法線が機体の下側にあれば右ロール）
    const w = state.angularRate;
    const rollError = Math.atan2(
      -(n.x * u.x + n.y * u.y + n.z * u.z),
      n.x * r.x + n.y * r.y + n.z * r.z,
    );
    out.roll = clamp(cfg.rollGain * rollError - cfg.rollDamping * -w.z, -1, 1);
    // 機首を面の中へ（右へずれていれば左へ）
    out.yaw = clamp(-cfg.yawGain * off, -1, 1);
    // 引き: 倒し具合で輪の半径（端 = radius、holdStick = 2 倍）。失速しない大きさまで・下りで地面が近ければ目一杯。
    // 抜けられない所で離したら、抜けられる所まで端の輪で回る。翼が面に合うまでは引かない（横へ曲がらない）
    const s = released ? 1 : clamp((stickY - cfg.holdStick) / (1 - cfg.holdStick), 0, 1);
    const radius = Math.min(
      cfg.radius / (0.5 + 0.5 * s),
      safeLoopRadius(spec, state.speed, this.theta, cfg),
    );
    const rate = radius > 0 ? state.speed / radius : Infinity;
    const descending = this.theta > Math.PI;
    const low = descending && groundFloor() > Math.asin(clamp(f.y, -1, 1));
    const pull =
      low || state.stall > 0 ? 1 : clamp(rate / Math.max(1e-3, maxPitchRate(spec, state)), 0, 1);
    const aligned = Math.max(0, Math.cos(rollError));
    out.pitch = pull * aligned * aligned;
    return true;
  }

  /** 入る条件（上へ端まで・上限の近く・背中が上・速さが足りる）を満たしていれば入って true。速さだけ足りなければ blocked */
  private enter(
    state: Readonly<FlightState>,
    spec: Readonly<AircraftSpec>,
    stickY: number,
    u: Readonly<Vec3>,
    hx: number,
    hz: number,
    elev: number,
  ): boolean {
    const cfg = this.cfg;
    if (stickY < cfg.entryStick || elev < cfg.entryElevationDeg * DEG || u.y <= 0) return false;
    if (!canLoop(spec, state, elev, cfg)) {
      this.blocked = true;
      return false;
    }
    this.begin(hx, hz, elev);
    return true;
  }

  private begin(dx: number, dz: number, theta: number): void {
    this.active = true;
    this.dir.x = dx;
    this.dir.y = 0;
    this.dir.z = dz;
    // 法線 = 前 × 真上（前が -Z なら +X）
    this.normal.x = -dz;
    this.normal.y = 0;
    this.normal.z = dx;
    this.theta = theta;
  }

  /**
   * 離して抜けてよい所: 真上の手前（上がる前に戻る）・頂点の前後（背面から水平に戻る = インメルマン）・下りで背中が上を向いた後
   * （引き起こしは普通の組み立てで）。真上を過ぎて背面で上がっている所・背面で下っている所で抜けると、
   * 真上・真下の近くでロールして方位がずれるので、抜けられる所まで回る
   */
  private canRelease(): boolean {
    const t = this.theta;
    const w = this.cfg.release;
    return (
      t <= Math.PI / 2 + w.verticalDeg * DEG ||
      Math.abs(t - Math.PI) <= w.topDeg * DEG ||
      t >= 2 * Math.PI - w.pullOutDeg * DEG
    );
  }
}
