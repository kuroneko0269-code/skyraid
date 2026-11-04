// 傾き操作（9-4。DOM・Three.js 非依存）: deviceorientation の角度（β・γ）と画面の向きから「画面から見た上の向き」を出し、
// 飛び始めたときの持ち方（中立）からの左右・手前と奥の傾きを、「方向へ倒す」方式のスティックの値（右・上が正）にする。
// 数値は src/data/steer.ts の TILT_CONFIG。DOM の側（イベント・許可）は src/ui/tilt-source.ts
import { TILT_CONFIG } from '../data/steer';
import { applyRadialDeadzone, applyStickCurve, type Vec2Out } from './analog';

const DEG = Math.PI / 180;

export interface Vec3Out {
  x: number;
  y: number;
  z: number;
}

/**
 * 世界の上の向きを、画面の座標（x = 画面の右・y = 画面の上・z = 画面の手前）で書く。
 * beta・gamma は deviceorientation の値（度。端末の座標: x = 右・y = 端末の上・z = 画面の手前。回転は Z(α)・X(β)・Y(γ) の順）。
 * screenAngle は画面の回転（度。screen.orientation.angle: 90 = 端末を左へ倒した横向き（上端が左）、270 = 右へ倒した横向き）
 */
export function screenUp(beta: number, gamma: number, screenAngle: number, out: Vec3Out): Vec3Out {
  const b = beta * DEG;
  const g = gamma * DEG;
  // 端末の座標での上の向き = Rᵀ (0, 0, 1)（α は上の向きに効かない）
  const dx = -Math.sin(g) * Math.cos(b);
  const dy = Math.sin(b);
  const dz = Math.cos(g) * Math.cos(b);
  // 画面の座標へ: 画面が端末に対して反時計回りに θ 回っている（θ = 90 なら画面の右 = 端末の下 −y、画面の上 = 端末の右 +x）
  const th = screenAngle * DEG;
  const c = Math.cos(th);
  const s = Math.sin(th);
  out.x = dx * c - dy * s;
  out.y = dx * s + dy * c;
  out.z = dz;
  return out;
}

/** 画面の向きの値（0 / 90 / 180 / 270）にそろえる（-90 = 270） */
export function normalizeScreenAngle(angle: number): number {
  const a = Math.round(angle / 90) * 90;
  return ((a % 360) + 360) % 360;
}

/**
 * 上の向き（画面の座標）から、2 つの傾きの角度（度）:
 * - roll: 画面の右端が下がっている角度（右へ傾けると正）。画面の左右の軸と水平のなす角
 * - pitch: 画面の上端を手前へ傾けると正。画面の左右の軸まわりの回転（手前 = 画面が立つ向き）
 */
export function tiltAngles(u: Readonly<Vec3Out>, out: { roll: number; pitch: number }): void {
  out.roll = Math.asin(Math.max(-1, Math.min(1, -u.x))) / DEG;
  // 画面が奥へ寝るほど atan2(z, y) が大きい → 手前へ傾けると小さくなる
  out.pitch = -Math.atan2(u.z, u.y) / DEG;
}

function wrap180(a: number): number {
  let x = a;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}

export interface TiltOptions {
  /** デッドゾーン（端の角度に対する比。スティックの設定と同じ 0.05〜0.25） */
  deadzone: number;
  /** 感度のカーブの指数（スティックの設定と同じ） */
  curve: number;
}

/**
 * 傾きの読み取り: 値（β・γ・画面の向き・時刻）を受け取り、平滑して、中立からのずれをスティックの値にする。
 * 中立は calibrate の後の最初の値（飛び始め・合わせ直し・画面の向きが変わったとき）
 */
export class TiltReader {
  /** スティックの値（右・上が正。デッドゾーン・カーブの後、感度の前） */
  readonly value: Vec2Out = { x: 0, y: 0 };
  /** 値を受け取ったことがあるか（傾きを読める端末か） */
  received = false;
  private neutral: { roll: number; pitch: number } | null = null;
  private readonly angles = { roll: 0, pitch: 0 };
  private readonly smooth = { roll: 0, pitch: 0 };
  private readonly up: Vec3Out = { x: 0, y: 0, z: 1 };
  private lastMs: number | null = null;
  private angle = 0;
  private calibratePending = true;

  constructor(
    private readonly options: TiltOptions = { deadzone: 0.12, curve: 1.5 },
    private readonly cfg = TILT_CONFIG,
  ) {}

  setOptions(o: Readonly<TiltOptions>): void {
    this.options.deadzone = o.deadzone;
    this.options.curve = o.curve;
  }

  /** 次の値を中立にする（飛び始め・ポーズの「傾きを合わせ直す」） */
  calibrate(): void {
    this.calibratePending = true;
  }

  /** 中立が決まっているか */
  get calibrated(): boolean {
    return this.neutral !== null && !this.calibratePending;
  }

  /** 値を受け取る（beta・gamma が null の端末は傾きを読めない）。スティックの値が変わったら true */
  read(beta: number | null, gamma: number | null, screenAngle: number, nowMs: number): boolean {
    if (beta === null || gamma === null || !Number.isFinite(beta) || !Number.isFinite(gamma))
      return false;
    this.received = true;
    const angle = normalizeScreenAngle(screenAngle);
    // 画面の向きが変わったら（横向きの左右の持ち替え）、今の持ち方を中立にし直す
    if (angle !== this.angle) {
      this.angle = angle;
      this.calibratePending = true;
    }
    tiltAngles(screenUp(beta, gamma, angle, this.up), this.angles);
    const sm = this.smooth;
    if (this.calibratePending || this.neutral === null || this.lastMs === null) {
      sm.roll = this.angles.roll;
      sm.pitch = this.angles.pitch;
    } else {
      const dt = Math.max(0, Math.min(0.5, (nowMs - this.lastMs) / 1000));
      const k = 1 - Math.exp(-dt / this.cfg.smoothingSeconds);
      sm.roll += (this.angles.roll - sm.roll) * k;
      sm.pitch += wrap180(this.angles.pitch - sm.pitch) * k;
    }
    this.lastMs = nowMs;
    if (this.calibratePending || this.neutral === null) {
      this.neutral = { roll: sm.roll, pitch: sm.pitch };
      this.calibratePending = false;
    }
    return this.shape();
  }

  /** 値を 0 にして中立を忘れる（方式を切り替えたとき） */
  reset(): void {
    this.value.x = 0;
    this.value.y = 0;
    this.neutral = null;
    this.lastMs = null;
    this.calibratePending = true;
  }

  private shape(): boolean {
    const n = this.neutral;
    if (!n) return false;
    const x = (this.smooth.roll - n.roll) / this.cfg.fullRollDeg;
    const y = wrap180(this.smooth.pitch - n.pitch) / this.cfg.fullPitchDeg;
    const px = this.value.x;
    const py = this.value.y;
    // スティックと同じ: 半径方向のデッドゾーン（長さ 1 で頭打ち）→ 感度のカーブ
    applyRadialDeadzone(x, y, this.options.deadzone, this.value);
    applyStickCurve(this.value, this.options.curve);
    return this.value.x !== px || this.value.y !== py;
  }
}

/**
 * ドラッグ操作（9-4）: 押さえた点と画面の中央のずれ → スティックの値（右・上が正。直線、合成の長さ 1 で頭打ち）。
 * roll は画面の傾き（rad。カメラが右へ傾いていると正）: 画面に見える向きを地平線の基準（「方向へ倒す」の約束）に戻す。
 * ±90° で頭打ち（背面の画面で上下が入れ替わらない）
 */
export function dragStick(
  x: number,
  y: number,
  width: number,
  height: number,
  radiusRatio: number,
  out: Vec2Out,
  roll = 0,
): Vec2Out {
  const r = Math.max(1, height * radiusRatio);
  const ox = (x - width / 2) / r;
  const oy = (height / 2 - y) / r;
  const b = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, roll));
  const c = Math.cos(b);
  const s = Math.sin(b);
  let sx = ox * c + oy * s;
  let sy = -ox * s + oy * c;
  const len = Math.hypot(sx, sy);
  if (len > 1) {
    sx /= len;
    sy /= len;
  }
  out.x = sx;
  out.y = sy;
  return out;
}
