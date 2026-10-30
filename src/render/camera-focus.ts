// ターゲットカメラ（4-12、Three.js 非依存）: 選択中の対象が画面の端に近づくと、追従カメラの視線を対象の側へ最大 maxShiftDeg 回す。
// 回した視線から自機が画面の端（aircraftMarginDeg 内側）より外に出るなら回す量を減らし、自機は常に画面に残す
import { TARGET_CAMERA_CONFIG } from '../data/assist';
import { approachFactor, clamp, crossVec3, smoothstep, vec3, type Vec3 } from '../flight/math';

const DEG = Math.PI / 180;

/** カメラの位置・注視点・上方向・垂直画角（CameraRig の pose と同じ形） */
export interface FocusPose {
  readonly position: Readonly<Vec3>;
  readonly lookAt: Vec3;
  readonly up: Readonly<Vec3>;
  readonly fov: number;
}

export class CameraFocus {
  /** 注視点に足すずれ（ワールド、m）。なめらかに追う */
  readonly shift = vec3();
  private readonly want = vec3();
  private readonly view = vec3();
  private readonly dir = vec3();
  private readonly axis = vec3();
  private readonly screen = { x: 0, y: 0 };

  constructor(private readonly config: typeof TARGET_CAMERA_CONFIG = TARGET_CAMERA_CONFIG) {}

  reset(): void {
    this.shift.x = this.shift.y = this.shift.z = 0;
  }

  /**
   * pose.lookAt を対象の側へずらす。focus は対象の位置（null なら寄せない = 戻していく）、aircraft は自機の位置、
   * aspect は画面の縦横比（横の画角を求める）、dt は実時間（秒）
   */
  apply(
    pose: FocusPose,
    aircraft: Readonly<Vec3>,
    focus: Readonly<Vec3> | null,
    aspect: number,
    dt: number,
  ): void {
    const c = this.config;
    const want = this.want;
    want.x = want.y = want.z = 0;
    const view = this.view;
    const distance = direction(view, pose.position, pose.lookAt);
    const halfV = (pose.fov * DEG) / 2;
    const half = Math.min(halfV, Math.atan(Math.tan(halfV) * Math.max(0.1, aspect)));
    if (focus && distance > 1e-6 && direction(this.dir, pose.position, focus) > 1e-6) {
      const f = this.dir;
      const angle = Math.acos(clamp(view.x * f.x + view.y * f.y + view.z * f.z, -1, 1));
      const k = smoothstep(half - c.startMarginDeg * DEG, half + c.fullMarginDeg * DEG, angle);
      const theta = Math.min(angle, c.maxShiftDeg * DEG) * k;
      // 回転軸 = 視線 × 対象の向き（真後ろ・真正面で潰れたら回さない）
      const axis = crossVec3(this.axis, view, f);
      const len = Math.hypot(axis.x, axis.y, axis.z);
      if (theta > 0 && len > 1e-4) {
        axis.x /= len;
        axis.y /= len;
        axis.z /= len;
        // 視線を軸まわりに theta 回した向き（軸は視線と直交）: view cos θ + (axis × view) sin θ
        const side = crossVec3(f, axis, view);
        const cs = Math.cos(theta) - 1;
        const sn = Math.sin(theta);
        want.x = (view.x * cs + side.x * sn) * distance;
        want.y = (view.y * cs + side.y * sn) * distance;
        want.z = (view.z * cs + side.z * sn) * distance;
      }
    }
    const shift = this.shift;
    const a = approachFactor(c.response, dt);
    shift.x += (want.x - shift.x) * a;
    shift.y += (want.y - shift.y) * a;
    shift.z += (want.z - shift.z) * a;
    if (Math.hypot(shift.x, shift.y, shift.z) < 1e-4) return;
    // 自機が画面の端から aircraftMarginDeg 内側に残るよう、ずれを縮める（二分法。縦・横の画角を別々に見る）
    const margin = c.aircraftMarginDeg * DEG;
    const limitV = Math.tan(Math.max(0, halfV - margin));
    const limitH = Math.tan(
      Math.max(0, Math.atan(Math.tan(halfV) * Math.max(0.1, aspect)) - margin),
    );
    const inside = (k: number): boolean => {
      const sp = aircraftOnScreen(pose, aircraft, shift, k, this.screen);
      return sp !== null && Math.abs(sp.x) <= limitH && Math.abs(sp.y) <= limitV;
    };
    let scale = 1;
    if (!inside(1)) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) / 2;
        if (inside(mid)) lo = mid;
        else hi = mid;
      }
      scale = lo;
    }
    pose.lookAt.x += shift.x * scale;
    pose.lookAt.y += shift.y * scale;
    pose.lookAt.z += shift.z * scale;
  }
}

/**
 * 注視点に shift × scale を足したときの、自機の画面上の位置（視線の正面からの tan。x は右、y は上）を out に書く。
 * カメラの後ろなら null
 */
export function aircraftOnScreen(
  pose: FocusPose,
  aircraft: Readonly<Vec3>,
  shift: Readonly<Vec3>,
  scale: number,
  out: { x: number; y: number },
): { x: number; y: number } | null {
  const p = pose.position;
  const l = pose.lookAt;
  let vx = l.x + shift.x * scale - p.x;
  let vy = l.y + shift.y * scale - p.y;
  let vz = l.z + shift.z * scale - p.z;
  const vl = Math.hypot(vx, vy, vz);
  if (vl < 1e-9) return null;
  vx /= vl;
  vy /= vl;
  vz /= vl;
  // 右 = 視線 × 上、上 = 右 × 視線
  const u = pose.up;
  let rx = vy * u.z - vz * u.y;
  let ry = vz * u.x - vx * u.z;
  let rz = vx * u.y - vy * u.x;
  const rl = Math.hypot(rx, ry, rz);
  if (rl < 1e-9) return null;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const ux = ry * vz - rz * vy;
  const uy = rz * vx - rx * vz;
  const uz = rx * vy - ry * vx;
  const ax = aircraft.x - p.x;
  const ay = aircraft.y - p.y;
  const az = aircraft.z - p.z;
  const depth = ax * vx + ay * vy + az * vz;
  if (depth <= 1e-6) return null;
  out.x = (ax * rx + ay * ry + az * rz) / depth;
  out.y = (ax * ux + ay * uy + az * uz) / depth;
  return out;
}

/** out = from → to の単位ベクトル。長さを返す（0 なら out は書かない） */
function direction(out: Vec3, from: Readonly<Vec3>, to: Readonly<Vec3>): number {
  const x = to.x - from.x;
  const y = to.y - from.y;
  const z = to.z - from.z;
  const len = Math.hypot(x, y, z);
  if (len < 1e-9) return 0;
  out.x = x / len;
  out.y = y / len;
  out.z = z / len;
  return len;
}
