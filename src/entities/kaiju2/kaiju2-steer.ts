// ネフィルガの向きの回し方と地形・戦域の避け方（9-6d で sky-kaiju.ts から分けた。中身は 9-6a のまま）。Three.js 非依存
import { KAIJU2_CONFIG as C } from '../../data/kaiju2';
import { clamp, vec3, type Vec3 } from '../../flight/math';

const axis = vec3();

/** 地形・戦域を避けるのに読む本体の値 */
interface SteerBody {
  readonly position: Readonly<Vec3>;
  readonly forward: Readonly<Vec3>;
  readonly speed: number;
  readonly center: { readonly x: number; readonly z: number };
  floorAt(x: number, z: number): number;
}

/** 向き f（単位）を want（単位でなくてよい）へ、maxRad まで回す */
export function rotateToward(f: Vec3, want: Readonly<Vec3>, maxRad: number): void {
  const len = Math.hypot(want.x, want.y, want.z);
  if (len < 1e-6) return;
  const wx = want.x / len;
  const wy = want.y / len;
  const wz = want.z / len;
  const dot = clamp(f.x * wx + f.y * wy + f.z * wz, -1, 1);
  const angle = Math.acos(dot);
  if (angle <= maxRad) {
    f.x = wx;
    f.y = wy;
    f.z = wz;
    return;
  }
  // 回転軸（f × w）。真後ろなら上を軸にする
  axis.x = f.y * wz - f.z * wy;
  axis.y = f.z * wx - f.x * wz;
  axis.z = f.x * wy - f.y * wx;
  let al = Math.hypot(axis.x, axis.y, axis.z);
  if (al < 1e-6) {
    axis.x = 0;
    axis.y = 1;
    axis.z = 0;
    al = 1;
  }
  axis.x /= al;
  axis.y /= al;
  axis.z /= al;
  // ロドリゲスの回転（f は axis に垂直なので項が 2 つ）
  const c = Math.cos(maxRad);
  const s = Math.sin(maxRad);
  const cx = axis.y * f.z - axis.z * f.y;
  const cy = axis.z * f.x - axis.x * f.z;
  const cz = axis.x * f.y - axis.y * f.x;
  f.x = f.x * c + cx * s;
  f.y = f.y * c + cy * s;
  f.z = f.z * c + cz * s;
  const fl = Math.hypot(f.x, f.y, f.z);
  f.x /= fl;
  f.y /= fl;
  f.z /= fl;
}

/** 先読みの点が地面・海面に近ければ上へ、戦域の外へ向かっていれば中へ（want を書き換える） */
export function avoidTerrain(k: SteerBody, want: Vec3): void {
  const a = C.avoid;
  const len = Math.hypot(want.x, want.y, want.z) || 1;
  let climb = -Infinity;
  for (const t of a.lookahead) {
    const d = k.speed * t;
    const px = k.position.x + k.forward.x * d;
    const pz = k.position.z + k.forward.z * d;
    const py = k.position.y + k.forward.y * d;
    const short = k.floorAt(px, pz) + a.clearance - py;
    if (short > 0) climb = Math.max(climb, short / Math.max(1, d));
  }
  if (climb > -Infinity) {
    const minY = Math.sin((a.climbDeg * Math.PI) / 180) * Math.min(1, 0.4 + climb);
    want.y = Math.max(want.y / len, minY) * len;
  }
  // 戦域: soft の外で外へ向かう分を中へ
  const dx = k.position.x - k.center.x;
  const dz = k.position.z - k.center.z;
  const r = Math.hypot(dx, dz);
  if (r > C.arena.soft) {
    const w = Math.min(1, (r - C.arena.soft) / (C.arena.hard - C.arena.soft));
    want.x = want.x * (1 - w) - (dx / r) * len * w * 1.5;
    want.z = want.z * (1 - w) - (dz / r) * len * w * 1.5;
  }
}
