// 10-6: 怪獣の体の当たりの形（Three.js 非依存・決まった計算）: 太さが変わる管（両端の半径。体・首・脚・尾・翼の骨）と、厚みのある
// 三角形（翼の膜）。どちらも静止姿勢の点を骨組み（rig.ts）で動かしてから調べる。座標は体の座標（怪獣ごとに決める）
import type { HullPoint, HullRig } from './rig';

/** 管: 端 a → b、半径 ra → rb */
export interface HullTube {
  readonly a: HullPoint;
  readonly b: HullPoint;
  readonly ra: number;
  readonly rb: number;
}

/** 厚みのある三角形（half は片側の厚み） */
export interface HullTri {
  readonly p: readonly [HullPoint, HullPoint, HullPoint];
  readonly half: number;
}

export class HullShape {
  /** 今の姿勢の点（管の端 2 つずつ → 三角形の 3 つずつの順） */
  private readonly at: Float64Array;
  /** 体の座標の原点から一番遠い所（点の距離 + 半径。遠ければ調べない） */
  reach = 0;

  constructor(
    readonly tubes: readonly HullTube[],
    readonly tris: readonly HullTri[],
  ) {
    this.at = new Float64Array((tubes.length * 2 + tris.length * 3) * 3);
  }

  /** 骨組みの今の姿勢で点を置き直す（rig.solve() の後） */
  update(rig: HullRig): void {
    let k = 0;
    let reach = 0;
    const at = this.at;
    const far = (r: number): void => {
      reach = Math.max(reach, Math.hypot(at[k] ?? 0, at[k + 1] ?? 0, at[k + 2] ?? 0) + r);
      k += 3;
    };
    for (const c of this.tubes) {
      rig.place(c.a, at, k);
      far(c.ra);
      rig.place(c.b, at, k);
      far(c.rb);
    }
    for (const t of this.tris) {
      for (const p of t.p) {
        rig.place(p, at, k);
        far(t.half);
      }
    }
    this.reach = reach;
  }

  /** 今の姿勢の i 番目の点（テスト・値の表示） */
  point(i: number): { x: number; y: number; z: number } {
    const a = this.at;
    return { x: a[i * 3] ?? 0, y: a[i * 3 + 1] ?? 0, z: a[i * 3 + 2] ?? 0 };
  }

  /** 体の座標の点が、余裕 margin を足した形の中か */
  inside(x: number, y: number, z: number, margin: number): boolean {
    if (x * x + y * y + z * z > (this.reach + margin) ** 2) return false;
    const a = this.at;
    let k = 0;
    for (const c of this.tubes) {
      const ax = a[k] ?? 0;
      const ay = a[k + 1] ?? 0;
      const az = a[k + 2] ?? 0;
      const bx = (a[k + 3] ?? 0) - ax;
      const by = (a[k + 4] ?? 0) - ay;
      const bz = (a[k + 5] ?? 0) - az;
      k += 6;
      const l2 = bx * bx + by * by + bz * bz;
      const px = x - ax;
      const py = y - ay;
      const pz = z - az;
      const t = l2 > 1e-9 ? Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / l2)) : 0;
      const r = c.ra + (c.rb - c.ra) * t + margin;
      const dx = px - bx * t;
      const dy = py - by * t;
      const dz = pz - bz * t;
      if (dx * dx + dy * dy + dz * dz < r * r) return true;
    }
    for (const t of this.tris) {
      const r = t.half + margin;
      if (triDistance2(a, k, x, y, z) < r * r) return true;
      k += 9;
    }
    return false;
  }

  /**
   * 体の座標の線分 p0 → p1（前のステップの自機 → 今の自機。体の動きを引いた相対）が形にめり込んだか。step m ごとに調べ、
   * 最初にめり込んだ割合（0〜1）を返す（めり込んでいなければ −1）
   */
  contact(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    margin: number,
    step: number,
  ): number {
    const far = this.reach + margin;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const l2 = dx * dx + dy * dy + dz * dz;
    // 線分の一番近い所が遠ければ調べない
    const tc = l2 > 0 ? Math.max(0, Math.min(1, -(x0 * dx + y0 * dy + z0 * dz) / l2)) : 0;
    if (Math.hypot(x0 + dx * tc, y0 + dy * tc, z0 + dz * tc) > far) return -1;
    const n = Math.max(1, Math.ceil(Math.sqrt(l2) / Math.max(0.5, step)));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (this.inside(x0 + dx * t, y0 + dy * t, z0 + dz * t, margin)) return t;
    }
    return -1;
  }
}

/** 点 (x, y, z) から三角形（a[k..k+8]）までの距離の 2 乗（一番近い点。Ericson の方法） */
function triDistance2(a: Float64Array, k: number, x: number, y: number, z: number): number {
  const ax = a[k] ?? 0;
  const ay = a[k + 1] ?? 0;
  const az = a[k + 2] ?? 0;
  const abx = (a[k + 3] ?? 0) - ax;
  const aby = (a[k + 4] ?? 0) - ay;
  const abz = (a[k + 5] ?? 0) - az;
  const acx = (a[k + 6] ?? 0) - ax;
  const acy = (a[k + 7] ?? 0) - ay;
  const acz = (a[k + 8] ?? 0) - az;
  const apx = x - ax;
  const apy = y - ay;
  const apz = z - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let u: number;
  let v: number;
  const bpx = x - ax - abx;
  const bpy = y - ay - aby;
  const bpz = z - az - abz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  const cpx = x - ax - acx;
  const cpy = y - ay - acy;
  const cpz = z - az - acz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  const vc = d1 * d4 - d3 * d2;
  const vb = d5 * d2 - d1 * d6;
  const va = d3 * d6 - d5 * d4;
  if (d1 <= 0 && d2 <= 0) {
    u = 0;
    v = 0;
  } else if (d3 >= 0 && d4 <= d3) {
    u = 1;
    v = 0;
  } else if (d6 >= 0 && d5 <= d6) {
    u = 0;
    v = 1;
  } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    u = d1 / (d1 - d3);
    v = 0;
  } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    u = 0;
    v = d2 / (d2 - d6);
  } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    v = (d4 - d3) / (d4 - d3 + (d5 - d6));
    u = 1 - v;
  } else {
    const den = 1 / (va + vb + vc);
    u = vb * den;
    v = vc * den;
  }
  const ex = x - (ax + abx * u + acx * v);
  const ey = y - (ay + aby * u + acy * v);
  const ez = z - (az + abz * u + acz * v);
  return ex * ex + ey * ey + ez * ez;
}
