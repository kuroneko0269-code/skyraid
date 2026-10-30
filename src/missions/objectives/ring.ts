// リングのエンティティと通過判定（2-4、Three.js 非依存）。描画は src/render/ring-view.ts
import { RING_CONFIG } from '../../data/rings';
import { vec3, type Vec3 } from '../../flight/math';
import type { RingDef } from '../types';

const DEG = Math.PI / 180;

export interface Ring {
  readonly position: Readonly<Vec3>;
  /** 輪の面の法線（単位ベクトル）。この向きに通り抜けるのが「正しい向き」 */
  readonly normal: Readonly<Vec3>;
  /** 通過とみなす半径 */
  readonly passRadius: number;
}

/** 定義からリングを作る。法線は機首の向き（-Z から右回り）と上向きの角度から */
export function createRing(def: RingDef, passRadius: number = RING_CONFIG.passRadius): Ring {
  const h = def.headingDeg * DEG;
  const p = (def.pitchDeg ?? 0) * DEG;
  const c = Math.cos(p);
  return {
    position: vec3(def.x, def.y, def.z),
    normal: vec3(Math.sin(h) * c, Math.sin(p), -Math.cos(h) * c),
    passRadius,
  };
}

/**
 * 線分 from → to（前ステップ → 今の位置）がリングの面を輪の内側で横切ったか。
 * 向きはどちらからでもよい（逆向きに抜けても数える。アーケード寄り）。
 * 1 ステップで数 m 進むので、点ではなく線分と面の交点で判定する
 */
export function crossesRing(ring: Ring, from: Readonly<Vec3>, to: Readonly<Vec3>): boolean {
  const n = ring.normal;
  const c = ring.position;
  const d0 = (from.x - c.x) * n.x + (from.y - c.y) * n.y + (from.z - c.z) * n.z;
  const d1 = (to.x - c.x) * n.x + (to.y - c.y) * n.y + (to.z - c.z) * n.z;
  // 面の同じ側にいる（横切っていない）。面に沿って動く（面との距離が変わらない）のも数えない
  if ((d0 > 0 && d1 > 0) || (d0 < 0 && d1 < 0) || Math.abs(d0 - d1) < 1e-9) return false;
  const t = d0 / (d0 - d1);
  const x = from.x + (to.x - from.x) * t - c.x;
  const y = from.y + (to.y - from.y) * t - c.y;
  const z = from.z + (to.z - from.z) * t - c.z;
  return Math.hypot(x, y, z) <= ring.passRadius;
}
