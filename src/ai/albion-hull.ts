// 10-3c: 白鯨アルビオンの体の形の当たり（Three.js 非依存・決まった計算）: 胴（前 → 半径の管）・背びれ（楕円体）・胸びれ・尾びれ
// （薄い板）。体の向き（方位・上下・傾き）と潮吹きの沈み、尾の上下（泳ぎ・叩きつけ）と胸びれのあおぎを、形の骨の動き
// （src/render/albion-model/skeleton.ts）と同じ式でなぞる。点がめり込んでいれば、いちばん浅い所への外向きの向きと深さを返す
import { ALBION_HULL as H } from '../data/albion';
import { ALBION_MODEL_CONFIG as M } from '../data/albion-model';
import type { Vec3 } from '../flight/math';
import type { AlbionBody } from '../entities/albion/albion-body';

/** めり込み（深さ m と、外向きの単位ベクトル。世界の向き） */
export interface HullHit {
  depth: number;
  readonly normal: Vec3;
  /** めり込んだ所（胴・背びれ・胸びれ・尾びれ） */
  shape: 'body' | 'dorsal' | 'fin' | 'flukes';
}

/** 体の中の座標（前・右・上。体の中心から） */
interface Local {
  f: number;
  r: number;
  u: number;
}

const loc: Local = { f: 0, r: 0, u: 0 };
/** 局所の外向き（前・右・上） */
const ln = { f: 0, r: 0, u: 0 };
const TAIL_START = H.tailBones[0] ?? 60;

/** 尾の骨の回転（ラジアン。正で下がる）。skeleton.ts の animateAlbion と同じ */
function tailAngle(body: AlbionBody, i: number): number {
  const pose = body.pose;
  const ph = pose.swimPhase * Math.PI * 2;
  const lift = pose.tailLift;
  const swim = (M.swim.tail[i] ?? 0) * Math.sin(ph - i * 0.7);
  const amt = lift >= 0 ? -(M.tailLift.up[i] ?? 0) * lift : (M.tailLift.down[i] ?? 0) * -lift;
  return swim * (1 - Math.abs(lift)) + amt;
}

const chain = { up: 0, angle: 0 };

/** 後ろへ back m（付け根からの尾の上）の中心線の上下のずれと、そこの傾き（ラジアン。正で後ろが下がる） */
function tailCenter(body: AlbionBody, back: number): { up: number; angle: number } {
  chain.up = 0;
  chain.angle = 0;
  if (back <= TAIL_START) return chain;
  const bones = H.tailBones;
  let up = 0;
  let angle = 0;
  for (let i = 0; i < bones.length; i++) {
    const z0 = bones[i] ?? 0;
    const z1 = bones[i + 1] ?? Infinity;
    angle += tailAngle(body, i);
    const seg = Math.min(back, z1) - z0;
    up -= Math.sin(angle) * seg;
    if (back <= z1) break;
  }
  chain.up = up;
  chain.angle = angle;
  return chain;
}

/** 世界の点 → 体の中の座標（方位 → 上下 → 傾きの逆。沈みも入れる） */
function toLocal(body: AlbionBody, p: Readonly<Vec3>, out: Local): Local {
  const h = body.heading;
  const fx = -Math.sin(h);
  const fz = -Math.cos(h);
  const dx = p.x - body.position.x;
  const dz = p.z - body.position.z;
  const dy = p.y - body.position.y + body.pose.sink;
  const f0 = dx * fx + dz * fz;
  const r0 = dx * -fz + dz * fx;
  const cp = Math.cos(body.pitch);
  const sp = Math.sin(body.pitch);
  const f1 = f0 * cp + dy * sp;
  const u1 = -f0 * sp + dy * cp;
  const cb = Math.cos(body.bank);
  const sb = Math.sin(body.bank);
  out.f = f1;
  out.r = r0 * cb - u1 * sb;
  out.u = r0 * sb + u1 * cb;
  return out;
}

/** 局所の向き → 世界の向き（toLocal の逆） */
function toWorld(body: AlbionBody, n: { f: number; r: number; u: number }, out: Vec3): Vec3 {
  const cb = Math.cos(body.bank);
  const sb = Math.sin(body.bank);
  const r0 = n.r * cb + n.u * sb;
  const u1 = -n.r * sb + n.u * cb;
  const cp = Math.cos(body.pitch);
  const sp = Math.sin(body.pitch);
  const f0 = n.f * cp - u1 * sp;
  const dy = n.f * sp + u1 * cp;
  const h = body.heading;
  const fx = -Math.sin(h);
  const fz = -Math.cos(h);
  out.x = fx * f0 + -fz * r0;
  out.y = dy;
  out.z = fz * f0 + fx * r0;
  const l = Math.hypot(out.x, out.y, out.z) || 1;
  out.x /= l;
  out.y /= l;
  out.z /= l;
  return out;
}

/** 折れ線（x の降順・昇順どちらでも）の x での値 */
function profile(table: readonly (readonly [number, number])[], x: number): number {
  for (let i = 0; i < table.length - 1; i++) {
    const a = table[i];
    const b = table[i + 1];
    if (!a || !b) continue;
    const lo = Math.min(a[0], b[0]);
    const hi = Math.max(a[0], b[0]);
    if (x < lo || x > hi) continue;
    const t = hi === lo ? 0 : (x - a[0]) / (b[0] - a[0]);
    return a[1] + (b[1] - a[1]) * t;
  }
  return -1;
}

/** ひれの点の列を、横の位置 rr で補う（[上, 前, 翼弦の半分, 厚さの半分]。範囲外は null） */
const finAt = { up: 0, f: 0, chord: 0, thick: 0 };
function finSection(
  pts: readonly (readonly [number, number, number, number, number])[],
  rr: number,
): typeof finAt | null {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b || rr < a[0] || rr > b[0]) continue;
    const t = (rr - a[0]) / (b[0] - a[0]);
    finAt.up = a[1] + (b[1] - a[1]) * t;
    finAt.f = a[2] + (b[2] - a[2]) * t;
    finAt.chord = a[3] + (b[3] - a[3]) * t;
    finAt.thick = a[4] + (b[4] - a[4]) * t;
    return finAt;
  }
  return null;
}

/** 胸びれのあおぎ（ラジアン。正で両方の先が上がる）。skeleton.ts と同じ */
function finFlap(body: AlbionBody): number {
  return M.swim.fin * Math.sin(body.pose.swimPhase * Math.PI * 2 * 0.5 + 0.4);
}

/**
 * 点 p（世界）が体（+ margin m）にめり込んでいるか。めり込んでいれば out に深さと外向きを入れて true
 */
export function hullPenetration(
  body: AlbionBody,
  p: Readonly<Vec3>,
  margin: number,
  out: HullHit,
): boolean {
  const l = toLocal(body, p, loc);
  let best = 0;
  // 胴（尾の付け根から後ろは尾の上下に合わせる）
  const back = -l.f;
  const radius = profile(H.body, l.f);
  if (radius > 0) {
    const c = tailCenter(body, back);
    const du = l.u - c.up;
    const d = Math.hypot(l.r, du);
    const depth = radius + margin - d;
    if (depth > best) {
      best = depth;
      const inv = d > 1e-6 ? 1 / d : 0;
      ln.f = 0;
      ln.r = d > 1e-6 ? l.r * inv : 0;
      ln.u = d > 1e-6 ? du * inv : 1;
      out.shape = 'body';
    }
  }
  // 背びれ（楕円体）
  const D = H.dorsal;
  const ex = l.r / (D.rx + margin);
  const ey = (l.u - D.up) / (D.ry + margin);
  const ez = (l.f - D.forward) / (D.rz + margin);
  const e = Math.hypot(ex, ey, ez);
  if (e < 1) {
    const depth = (1 - e) * (D.ry + margin);
    if (depth > best) {
      best = depth;
      ln.f = ez / (D.rz + margin);
      ln.r = ex / (D.rx + margin);
      ln.u = ey / (D.ry + margin);
      const n = Math.hypot(ln.f, ln.r, ln.u) || 1;
      ln.f /= n;
      ln.r /= n;
      ln.u /= n;
      out.shape = 'dorsal';
    }
  }
  // 胸びれ（右に寄せて、付け根の周りのあおぎを戻す）
  const side = l.r >= 0 ? 1 : -1;
  const flap = finFlap(body);
  const [px, py] = H.pectoralPivot;
  const rx = Math.abs(l.r) - px;
  const ry = l.u - py;
  const cf = Math.cos(-flap);
  const sf = Math.sin(-flap);
  const rr = px + rx * cf - ry * sf;
  const ru = py + rx * sf + ry * cf;
  const fin = finSection(H.pectoral, rr);
  if (fin && Math.abs(l.f - fin.f) <= fin.chord + margin) {
    const du = ru - fin.up;
    const depth = fin.thick + margin - Math.abs(du);
    if (depth > best) {
      best = depth;
      const s = du >= 0 ? 1 : -1;
      // 板の上向き（あおぎで傾く）
      ln.f = 0;
      ln.r = -Math.sin(flap) * s * side;
      ln.u = Math.cos(flap) * s;
      out.shape = 'fin';
    }
  }
  // 尾びれ（尾の骨の上下に乗る薄い板）
  const fl = finSection(H.flukes, Math.abs(l.r));
  if (fl && Math.abs(l.f - fl.f) <= fl.chord + margin) {
    const c = tailCenter(body, -fl.f);
    const du = l.u - (c.up + fl.up);
    const depth = fl.thick + margin - Math.abs(du);
    if (depth > best) {
      best = depth;
      const s = du >= 0 ? 1 : -1;
      ln.f = -Math.sin(c.angle) * s;
      ln.r = 0;
      ln.u = Math.cos(c.angle) * s;
      out.shape = 'flukes';
    }
  }
  if (best <= 0) return false;
  out.depth = best;
  toWorld(body, ln, out.normal);
  return true;
}

/** めり込んだ点（線分の上の最初の点）。hullContact が入れる */
export interface HullContact extends HullHit {
  readonly point: Vec3;
}

/**
 * 移動の線分 a → b（世界）が体にめり込んだか。step m ごとに調べ、最初にめり込んだ点・深さ・外向きを out に入れて true
 */
export function hullContact(
  body: AlbionBody,
  a: Readonly<Vec3>,
  b: Readonly<Vec3>,
  margin: number,
  step: number,
  out: HullContact,
): boolean {
  // 遠ければ調べない（体の半分の長さ + 胸びれ + 余裕）
  const cx = body.position.x;
  const cy = body.position.y;
  const cz = body.position.z;
  const far = 420 + margin;
  if (
    Math.hypot(b.x - cx, b.y - cy, b.z - cz) > far &&
    Math.hypot(a.x - cx, a.y - cy, a.z - cz) > far
  )
    return false;
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / Math.max(0.5, step)));
  const q = out.point;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    q.x = a.x + (b.x - a.x) * t;
    q.y = a.y + (b.y - a.y) * t;
    q.z = a.z + (b.z - a.z) * t;
    if (hullPenetration(body, q, margin, out)) return true;
  }
  return false;
}

export function createHullContact(): HullContact {
  return { depth: 0, normal: { x: 0, y: 1, z: 0 }, shape: 'body', point: { x: 0, y: 0, z: 0 } };
}
