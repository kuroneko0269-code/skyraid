// 10-4b: メカ怪獣ゴウライの体の当たり（Three.js 非依存・決まった計算）: 胴と前の装甲の楔を、体の向き（方位）に合わせた箱
// （data/gourai.ts の GOURAI_HULL）でなぞる。浮いた体の傾き（数度）は見た目だけなので入れない。点がめり込んでいれば、
// いちばん浅い面への外向きの向きと深さを返す（アルビオンの albion-hull.ts と同じ形の結果。弾くのは entities/albion/albion-bounce.ts）
import { GOURAI_HULL, type GouraiHullBox } from '../data/gourai';
import type { Vec3 } from '../flight/math';
import type { HullContact, HullHit } from './albion-hull';
import type { BodyFrame } from './raid-kit/frame';

/** 体の半分の長さ・幅・高さより遠ければ調べない（m） */
const FAR = 120;

/** 箱 1 つへのめり込み（局所の座標。深さと外向きの軸） */
function boxDepth(
  b: GouraiHullBox,
  f: number,
  r: number,
  u: number,
  margin: number,
  out: { depth: number; f: number; r: number; u: number },
): boolean {
  const df0 = f - (b.forward[0] - margin);
  const df1 = b.forward[1] + margin - f;
  const dr0 = r - (b.right[0] - margin);
  const dr1 = b.right[1] + margin - r;
  const du0 = u - (b.up[0] - margin);
  const du1 = b.up[1] + margin - u;
  if (df0 <= 0 || df1 <= 0 || dr0 <= 0 || dr1 <= 0 || du0 <= 0 || du1 <= 0) return false;
  // いちばん浅い面から外へ
  let depth = df0;
  out.f = -1;
  out.r = 0;
  out.u = 0;
  const pick = (d: number, nf: number, nr: number, nu: number): void => {
    if (d >= depth) return;
    depth = d;
    out.f = nf;
    out.r = nr;
    out.u = nu;
  };
  pick(df1, 1, 0, 0);
  pick(dr0, 0, -1, 0);
  pick(dr1, 0, 1, 0);
  pick(du0, 0, 0, -1);
  pick(du1, 0, 0, 1);
  out.depth = depth;
  return true;
}

const one = { depth: 0, f: 0, r: 0, u: 0 };

/**
 * 点 p が体（余裕 margin m）にめり込んでいるか。armored は前の装甲がある（段階 1）。めり込んでいれば out に深さと外向き（世界）を入れる
 */
export function gouraiPenetration(
  body: BodyFrame,
  armored: boolean,
  p: Readonly<Vec3>,
  margin: number,
  out: HullHit,
): boolean {
  const b = body.position;
  const dx = p.x - b.x;
  const dy = p.y - b.y;
  const dz = p.z - b.z;
  const fx = -Math.sin(body.heading);
  const fz = -Math.cos(body.heading);
  // 右 = 前を上から見て時計回りに 90°（frame.ts と同じ）
  const rx = -fz;
  const rz = fx;
  const f = dx * fx + dz * fz;
  const r = dx * rx + dz * rz;
  let hit = false;
  let best = Infinity;
  for (const box of GOURAI_HULL) {
    if (box.armor && !armored) continue;
    if (!boxDepth(box, f, r, dy, margin, one) || one.depth >= best) continue;
    best = one.depth;
    hit = true;
    out.depth = one.depth;
    out.normal.x = fx * one.f + rx * one.r;
    out.normal.y = one.u;
    out.normal.z = fz * one.f + rz * one.r;
    out.shape = 'body';
  }
  return hit;
}

/**
 * 移動の線分 a → b（世界）が体にめり込んだか。step m ごとに調べ、最初にめり込んだ点・深さ・外向きを out に入れて true
 */
export function gouraiContact(
  body: BodyFrame,
  armored: boolean,
  a: Readonly<Vec3>,
  b: Readonly<Vec3>,
  margin: number,
  step: number,
  out: HullContact,
): boolean {
  const c = body.position;
  const far = FAR + margin;
  if (
    Math.hypot(b.x - c.x, b.y - c.y, b.z - c.z) > far &&
    Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z) > far
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
    if (gouraiPenetration(body, armored, q, margin, out)) return true;
  }
  return false;
}
