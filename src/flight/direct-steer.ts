// 「方向へ倒す」操縦（9-2。Three.js 非依存）: タッチのスティックを倒した向き（画面の上の向き。右 = 右へ曲がる・上 = 上がる）を、
// 飛行モデルの入力（ピッチ・ロール・ヨー）に組み立てる。数値は src/data/steer.ts の DIRECT_STEER_CONFIG。
//
// 組み立て方:
// 1. 機首の向きを「方位（水平の向き）」と「上下の角度」に分け、スティックの左右で方位を・上下で上下の角度をずらした向きを
//    「行きたい向き」にする（端まで倒すと fullDeg 度）。毎ステップ機首から測るので、倒している間は曲がり続ける。
//    離すと方位は今のまま、上下は水平へ戻す（上下に倒していない分だけ、最大 levelDeg 度ずつ）
// 2. 上下の角度は ±maxElevationDeg まで。低空では地面・海面までの余裕で下向きを制限し、余裕が無ければ引き起こす。
//    9-3: 上へ端まで倒し続けると、速さが足りれば上限を越えて宙返り（loop-steer.ts。下は今のまま -maxElevationDeg で止まる）
// 3. 行きたい向きを機体から見た向きにして、ピッチ（上下）とヨー（左右）で合わせる。ロールは機首を動かしたい向きへ背中を
//    向けるバンク角へ（真横へ曲がるなら 90°。離すと水平に戻す。背面からも戻る）。バンクしていると引きで横へ曲がる
//
// 不安定になりやすい場面の扱い（tests/direct-steer.test.ts）:
// - 背面: バンク角は ±180° で測るので、まず水平まで回して戻す。方位は背面でも機首から決まる
// - 真上・真下: 方位を機体の上下の向きから取る（機首が真上でも、来た方向が分かる）。バンクを合わせるのは弱める
// - 真後ろの敵: 行きたい向きは機首から fullDeg 度より離れないので、真後ろでも向きが反転して揺れることはない（人は倒し続けるだけ）
import type { AircraftSpec } from '../data/aircraft';
import { DIRECT_STEER_CONFIG } from '../data/steer';
import type { GroundHeightFn } from '../entities/aircraft';
import { LoopSteer } from './loop-steer';
import { LOCAL_FORWARD, LOCAL_RIGHT, LOCAL_UP, type FlightState } from './flight-model';
import { clamp, inverseRotateVec3, rotateVec3, smoothstep, vec3 } from './math';

export type DirectSteerConfig = typeof DIRECT_STEER_CONFIG;

export interface SteerCommand {
  pitch: number;
  roll: number;
  yaw: number;
}

const DEG = Math.PI / 180;

export class DirectSteer {
  /** 直前の組み立てで低空の安全が上下の角度を持ち上げた量（度。0 は効いていない。HUD・テスト用） */
  groundAssistDeg = 0;
  /** 宙返り（9-3） */
  readonly loop: LoopSteer;
  private readonly forward = vec3();
  private readonly up = vec3();
  private readonly right = vec3();
  private readonly goal = vec3();
  // 宙返りの下りで使う低空の安全（毎ステップ関数を作らない）
  private floorState: Readonly<FlightState> | null = null;
  private floorGround: GroundHeightFn | null = null;
  private readonly floorFn = (): number =>
    this.floorState && this.floorGround
      ? this.groundFloor(this.floorState, this.floorGround)
      : -Math.PI / 2;

  constructor(private readonly cfg: DirectSteerConfig = DIRECT_STEER_CONFIG) {
    this.loop = new LoopSteer(cfg.loop);
  }

  /** 宙返りの途中の状態を捨てる（飛行の始め・復帰・方式を切り替えたとき） */
  reset(): void {
    this.loop.reset();
  }

  /**
   * stickX（右が正）・stickY（画面の上が正）は感度・カーブを掛けた後の値（合成の大きさ 1 まで）。
   * 書く pitch は機首上げが正（ピッチ反転は呼ぶ側で）。spec は機体の数値（宙返りの速さ・引きの判定。null は宙返りしない）
   */
  apply(
    out: SteerCommand,
    state: Readonly<FlightState>,
    stickX: number,
    stickY: number,
    ground: GroundHeightFn,
    spec: Readonly<AircraftSpec> | null = null,
  ): SteerCommand {
    const cfg = this.cfg;
    const q = state.orientation;
    const f = rotateVec3(this.forward, q, LOCAL_FORWARD);
    const u = rotateVec3(this.up, q, LOCAL_UP);
    const r = rotateVec3(this.right, q, LOCAL_RIGHT);

    // 方位: 機首の水平成分 + 機体の上下の向きの水平成分（機首が上なら背中の反対側が来た方向）
    let hx = f.x - u.x * f.y;
    let hz = f.z - u.z * f.y;
    const hl = Math.hypot(hx, hz);
    if (hl > 1e-6) {
      hx /= hl;
      hz /= hl;
    } else {
      hx = 0;
      hz = -1;
    }
    const full = cfg.fullDeg * DEG;
    const maxElev = cfg.maxElevationDeg * DEG;
    const yawTurn = clamp(stickX, -1, 1) * full;
    const elev = Math.asin(clamp(f.y, -1, 1));
    const sy = clamp(stickY, -1, 1);
    this.floorState = state;
    this.floorGround = ground;
    if (this.loop.apply(out, state, spec, sy, f, u, r, hx, hz, elev, this.floorFn)) {
      this.groundAssistDeg = 0;
      return out;
    }
    // 上下に倒していない分だけ水平へ戻す（旋回の引きで機首が少しずつ上がるのを溜めない。離すと水平飛行に戻る）
    const level = (1 - Math.abs(sy)) * clamp(elev, -cfg.levelDeg * DEG, cfg.levelDeg * DEG);
    let goalElev = clamp(elev + sy * full - level, -maxElev, maxElev);
    // 行きたい向き（ワールド）: 方位を右へ yawTurn 回し、上下の角度を goalElev に
    const c = Math.cos(yawTurn);
    const s = Math.sin(yawTurn);
    // 右回り（上から見て時計回り）: -Z（北）→ +X（東）
    const gx = hx * c - hz * s;
    const gz = hz * c + hx * s;
    const ce = Math.cos(goalElev);
    const g = this.goal;
    g.x = gx * ce;
    g.y = Math.sin(goalElev);
    g.z = gz * ce;
    // 低空の安全: 行きたい向きの下向きを、引き起こせる角度までにする
    const floor = this.groundFloor(state, ground);
    const gElev = Math.asin(clamp(g.y / Math.hypot(g.x, g.y, g.z), -1, 1));
    this.groundAssistDeg = floor > gElev ? (floor - gElev) / DEG : 0;
    if (floor > gElev) {
      const horiz = Math.hypot(g.x, g.z);
      g.x = horiz > 1e-6 ? (g.x / horiz) * Math.cos(floor) : hx * Math.cos(floor);
      g.z = horiz > 1e-6 ? (g.z / horiz) * Math.cos(floor) : hz * Math.cos(floor);
      g.y = Math.sin(floor);
      goalElev = Math.max(goalElev, floor);
    }
    // 機体から見た向き: 上下のずれ → ピッチ、左右のずれ → ヨー
    inverseRotateVec3(g, q, g);
    const w = state.angularRate;
    const pitchError = Math.atan2(g.y, -g.z);
    out.pitch = clamp(cfg.pitchGain * pitchError - cfg.pitchDamping * w.x, -cfg.pushLimit, 1);
    const yawError = Math.atan2(g.x, -g.z);
    out.yaw = g.z < 0 ? clamp(cfg.yawGain * yawError + 0.1 * w.y, -1, 1) : 0;

    // ロール: 機首を動かしたい向き（左右 = 方位のずれ・上下 = 上下の角度のずれ）へ背中を向けるバンク角へ。引くとその向きへ曲がる。
    // 真横なら 90°（水平旋回）、上を含めば浅く（maxBankDeg まで）。左右のずれが小さいと弱め、
    // 真下（左右のずれ 0）は水平のまま押す。背面からは ±180° で測るので水平の側へ回して戻る
    const bank = Math.atan2(-r.y, u.y) / DEG;
    const dx = yawTurn / DEG;
    const dy = (goalElev - elev) / DEG;
    const weight = smooth01(Math.abs(dx) / cfg.bankFullDeg);
    const target = clamp(Math.atan2(dx, dy) / DEG, -cfg.maxBankDeg, cfg.maxBankDeg) * weight;
    let diff = target - bank;
    if (diff > 180) diff -= 360;
    else if (diff < -180) diff += 360;
    const fade = 1 - smoothstep(cfg.vertical.rollStart, cfg.vertical.rollEnd, Math.abs(f.y));
    // 右ロールの角速度 = -angularRate.z
    out.roll = clamp(cfg.bankGain * diff * fade - cfg.rollDamping * -w.z, -1, 1);
    return out;
  }

  /** 低空の安全: 行きたい上下の角度の下限（rad。真下まで許すときは -π/2） */
  private groundFloor(state: Readonly<FlightState>, ground: GroundHeightFn): number {
    const g = this.cfg.ground;
    const p = state.position;
    const f = this.forward;
    const ahead = state.speed * g.aheadSeconds;
    const h = Math.max(ground(p.x, p.z), ground(p.x + f.x * ahead, p.z + f.z * ahead));
    const margin = p.y - h - g.clearance;
    if (margin < 0) return Math.min(1, -margin / g.clearance) * g.climbDeg * DEG;
    // 下向き θ から引き起こすのに失う高さ: 引き起こしの円弧 R(1 - cos θ)（R = 速さ / 引きの角速度）+ 効き始めるまでの降下。
    // これが余裕（margin）に収まる最も深い θ まで（二分法）
    const v = Math.max(1, state.speed);
    const radius = v / (g.pullRateDeg * DEG);
    const lost = (a: number): number =>
      radius * (1 - Math.cos(a)) + v * Math.sin(a) * g.reactSeconds;
    let lo = 0;
    let hi = Math.PI / 2;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (lost(mid) <= margin) lo = mid;
      else hi = mid;
    }
    return -lo;
  }
}

function smooth01(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}
