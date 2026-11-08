// 10-7e: 背と尾の骨板（画質「中」「高」）。胴と尾の管の上の面のすぐ内側から生やす低い角錐で、高さは 4.5m まで
// （今の体の面 + 衝突の余裕 6m の中。tests/vorgas-visual.test.ts が頂点ごとに確かめる）。骨は下の管と同じ混ぜ方
import { Vector3 } from 'three';
import type { KaijuDetailSpec } from '../../data/kaiju-model';
import { KaijuMeshBuilder, rgb, type BoneBind } from './builder';
import { BONE, bonePosition } from './skeleton';

const HORN = rgb(0x3b352c);
const v = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

function blend(a: number, b: number, t: number): BoneBind {
  return { a, b, w: Math.min(1, Math.max(0, t)) };
}

function along(points: readonly Vector3[], t: number, out: Vector3): Vector3 {
  const seg = points.length - 1;
  const x = Math.min(seg - 1e-6, Math.max(0, t * seg));
  const i = Math.floor(x);
  const a = points[i] ?? points[0] ?? v(0, 0, 0);
  const b = points[i + 1] ?? a;
  return out.copy(a).lerp(b, x - i);
}

/** 管の上の向き（進む向きに垂直で、なるべく真上） */
function upOf(points: readonly Vector3[], t: number, out: Vector3): Vector3 {
  const a = along(points, Math.max(0, t - 0.02), new Vector3());
  const b = along(points, Math.min(1, t + 0.02), new Vector3());
  const dir = b.sub(a).normalize();
  return out.set(0, 1, 0).addScaledVector(dir, -dir.y).normalize();
}

const TORSO = [v(0, 52, 30), v(0, 60, 10), v(0, 78, -14), v(0, 90, -32), v(0, 95, -46)];

/** 骨板 1 枚: 管の中心 c・上の向き up・縦の半径 ry・横の半径 rx・横のずれ side・高さ h */
function plate(
  m: KaijuMeshBuilder,
  c: Vector3,
  up: Vector3,
  rx: number,
  ry: number,
  side: number,
  h: number,
  bone: BoneBind,
  sides: number,
): void {
  const lift = ry * 0.8 * Math.sqrt(Math.max(0, 1 - (side / rx) ** 2));
  const base = c.clone().addScaledVector(up, lift);
  base.x += side;
  // 先は少し後ろ・外へ倒す
  const tip = base.clone().addScaledVector(up, h);
  tip.x += Math.sign(side) * h * 0.25;
  tip.z += h * 0.35;
  m.spike(base, tip, h * 0.85, sides, HORN, bone);
}

/** 背と尾の骨板 */
export function buildScutes(d: KaijuDetailSpec): KaijuMeshBuilder {
  const m = new KaijuMeshBuilder();
  const sides = d.radial >= 30 ? 5 : 4;
  const c = new Vector3();
  const up = new Vector3();
  // 胴: 骨盤から首の手前まで、左右 2 列（互い違いに大小）
  for (let i = 0; i < 10; i++) {
    const t = 0.33 + i * 0.055;
    along(TORSO, t, c);
    upOf(TORSO, t, up);
    const girth = Math.sin(Math.PI * Math.min(1, 0.25 + t * 0.9));
    const rx = Math.max(7, 12 + 16 * girth - 9 * Math.max(0, t - 0.75) * 4);
    const ry = Math.max(7, 13 + 15 * girth - 8 * Math.max(0, t - 0.75) * 4);
    const bone =
      t < 0.45
        ? blend(BONE.pelvis, BONE.chest, (t - 0.25) / 0.2)
        : blend(BONE.chest, BONE.neck, (t - 0.75) / 0.25);
    const h = (i % 2 ? 2.8 : 3.8) * (1 - 0.3 * Math.max(0, t - 0.6));
    plate(m, c, up, rx, ry, -rx * 0.22, h, bone, sides);
    plate(m, c, up, rx, ry, rx * 0.22, h * (i % 2 ? 1.15 : 0.85), bone, sides);
  }
  // 尾: 真ん中に 1 列（先ほど小さく）
  const tailBones = [BONE.tail0, BONE.tail1, BONE.tail2, BONE.tail3, BONE.tail4];
  const pts = (['tail0', 'tail1', 'tail2', 'tail3', 'tail4'] as const).map((n) => bonePosition(n));
  pts.push(v(0, 8, 162));
  for (let i = 0; i < 14; i++) {
    const t = 0.03 + i * 0.05;
    along(pts, t, c);
    upOf(pts, t, up);
    const r = 17 * (1 - t) ** 1.1 + 1.2;
    const x = t * 5;
    const k = Math.min(4, Math.floor(x));
    const bone =
      k >= 4 ? { a: tailBones[4] ?? 0 } : blend(tailBones[k] ?? 0, tailBones[k + 1] ?? 0, x - k);
    plate(m, c, up, r, r * 1.15, 0.001, 3.6 * (1 - t * 0.9), bone, sides);
  }
  return m;
}
