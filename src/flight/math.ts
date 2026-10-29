// 飛行モデル用の最小限のベクトル・クォータニオン演算（Three.js 非依存）
// 毎ステップのアロケーションを避けるため、結果は out 引数に書き込む

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function quatIdentity(): Quat {
  return { x: 0, y: 0, z: 0, w: 1 };
}

export function copyVec3(out: Vec3, v: Readonly<Vec3>): Vec3 {
  out.x = v.x;
  out.y = v.y;
  out.z = v.z;
  return out;
}

export function copyQuat(out: Quat, q: Readonly<Quat>): Quat {
  out.x = q.x;
  out.y = q.y;
  out.z = q.z;
  out.w = q.w;
  return out;
}

export function lengthVec3(v: Readonly<Vec3>): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function crossVec3(out: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

/** v を q で回転する（out と v は同じでもよい） */
export function rotateVec3(out: Vec3, q: Readonly<Quat>, v: Readonly<Vec3>): Vec3 {
  // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  const x = v.x + q.w * tx + (q.y * tz - q.z * ty);
  const y = v.y + q.w * ty + (q.z * tx - q.x * tz);
  const z = v.z + q.w * tz + (q.x * ty - q.y * tx);
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

/** out = a * b（b を先に適用する回転） */
export function multiplyQuat(out: Quat, a: Readonly<Quat>, b: Readonly<Quat>): Quat {
  const x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
  const y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
  const z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
  const w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
  out.x = x;
  out.y = y;
  out.z = z;
  out.w = w;
  return out;
}

export function normalizeQuat(q: Quat): Quat {
  const len = Math.hypot(q.x, q.y, q.z, q.w);
  if (len === 0) {
    q.x = 0;
    q.y = 0;
    q.z = 0;
    q.w = 1;
    return q;
  }
  q.x /= len;
  q.y /= len;
  q.z /= len;
  q.w /= len;
  return q;
}

/**
 * 回転ベクトル（軸 × 角度[rad]）からクォータニオンを作る。
 * 角度 0 なら単位クォータニオン
 */
export function quatFromRotationVector(out: Quat, rx: number, ry: number, rz: number): Quat {
  const angle = Math.hypot(rx, ry, rz);
  if (angle < 1e-12) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    out.w = 1;
    return out;
  }
  const s = Math.sin(angle / 2) / angle;
  out.x = rx * s;
  out.y = ry * s;
  out.z = rz * s;
  out.w = Math.cos(angle / 2);
  return out;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** 0〜1 のなめらかな立ち上がり（smoothstep） */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** dt 秒で目標へ近づける指数補間の係数（rate は 1/秒） */
export function approachFactor(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}
