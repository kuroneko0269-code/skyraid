// 9-1 操作の診断: 「人の手」の模擬。ボット（AI）の出したい操縦を、画面のスティックを指で動かす人に近い入力に変える。
// - 反応の遅れ: delay 秒前の「出したい操縦」を出す（遅れがあると、追い過ぎて戻す往復が起きる）
// - 指のぶれ: スティックの上の指の位置に OU 過程（相関 tau 秒・大きさ noise。半径 = 1）を足す
// - スティック: 指の位置 → 半径方向のデッドゾーン → 感度のカーブ（倒し具合^curve）→ 感度（1 で頭打ち）
//   人は今のスティックの効き方に慣れている（出したい値になる指の位置へ動かす）とし、ぶれだけが残るとする
// - ヨー: タッチのヨーはボタン（押すと ±1）なので、人はほとんど使わない → 0
import { applyRadialDeadzone, type Vec2Out } from '../../src/core/analog';
import type { AircraftControls } from '../../src/entities/aircraft';

export interface HandsSpec {
  /** 指のぶれの大きさ（スティックの半径に対する比。標準偏差） */
  readonly noise: number;
  /** ぶれの相関の時間（秒） */
  readonly tau: number;
  /** 反応の遅れ（秒） */
  readonly delay: number;
  /** 感度のカーブの指数（1 = 今の直線。2 なら中央付近が細かい） */
  readonly curve: number;
  /** 感度（今の設定の初期値 1.0） */
  readonly sensitivity: number;
  /** デッドゾーン（今の初期値 0.12） */
  readonly deadzone: number;
  /** ヨーを使うか（タッチのヨーはボタンなので、人はほとんど使わない。false なら 0） */
  readonly yaw: boolean;
}

export const DEFAULT_HANDS: HandsSpec = {
  noise: 0.12,
  tau: 0.35,
  delay: 0.2,
  curve: 1,
  sensitivity: 1,
  deadzone: 0.12,
  yaw: false,
};

/** スティックの出力（倒し具合 0〜1、デッドゾーン適用後）→ 操縦の大きさ */
export function stickOutput(m: number, curve: number, sensitivity: number): number {
  return Math.min(1, Math.pow(m, curve) * sensitivity);
}

export class Hands {
  private readonly bufP: Float64Array;
  private readonly bufR: Float64Array;
  private head = 0;
  private nx = 0;
  private ny = 0;
  private readonly out: Vec2Out = { x: 0, y: 0 };

  constructor(
    readonly spec: HandsSpec,
    private readonly rng: () => number,
    private readonly dt = 1 / 60,
  ) {
    const n = Math.max(1, Math.round(spec.delay / dt) + 1);
    this.bufP = new Float64Array(n);
    this.bufR = new Float64Array(n);
  }

  private gauss(): number {
    const u = Math.max(1e-12, this.rng());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rng());
  }

  /** intent（AI の操縦）を人の入力にして out へ書く（ピッチ・ロール・ヨー以外はそのまま写す） */
  apply(intent: Readonly<AircraftControls>, out: AircraftControls): void {
    const s = this.spec;
    const n = this.bufP.length;
    this.bufP[this.head] = intent.pitch;
    this.bufR[this.head] = intent.roll;
    const old = (this.head + 1) % n;
    this.head = old;
    const p = this.bufP[old] ?? 0;
    const r = this.bufR[old] ?? 0;
    // 出したい操縦になる指の位置（今の効き方の逆）
    const len = Math.min(1, Math.hypot(p, r));
    let fx = 0;
    let fy = 0;
    if (len > 1e-6) {
      const m = Math.pow(Math.min(1, len / s.sensitivity), 1 / s.curve);
      const finger = s.deadzone + m * (1 - s.deadzone);
      fx = (r / len) * finger;
      fy = (p / len) * finger;
    }
    // 指のぶれ（OU 過程）
    const a = this.dt / s.tau;
    const k = s.noise * Math.sqrt(2 * a);
    this.nx += -this.nx * a + k * this.gauss();
    this.ny += -this.ny * a + k * this.gauss();
    fx += this.nx;
    fy += this.ny;
    const fl = Math.hypot(fx, fy);
    if (fl > 1) {
      fx /= fl;
      fy /= fl;
    }
    // スティック → 操縦
    const v = applyRadialDeadzone(fx, fy, s.deadzone, this.out);
    const vm = Math.hypot(v.x, v.y);
    const gain = vm > 0 ? stickOutput(vm, s.curve, s.sensitivity) / vm : 0;
    out.pitch = v.y * gain;
    out.roll = v.x * gain;
    out.yaw = s.yaw ? intent.yaw : 0;
    out.throttle = intent.throttle;
    out.afterburner = intent.afterburner;
    out.throttleTarget = intent.throttleTarget;
  }
}
