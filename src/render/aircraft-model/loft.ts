// 断面（超楕円）を前後に並べてつなぐロフト。胴体・エアインテーク・ノズル・ナセルで使う。
// 断面の並びは折り返してよい（ノズルの外側 → 縁 → 内側 → 底）。法線は隣の断面・隣の点との差分から作る
import type { MeshAccumulator, Rgb } from './accumulator';

export interface Ring {
  /** 断面の中心 */
  readonly cx: number;
  readonly cy: number;
  readonly z: number;
  /** 横の半径、上・下の半径 */
  readonly a: number;
  readonly top: number;
  readonly bottom: number;
  /** 超楕円の指数（2 で楕円、大きいほど角ばる） */
  readonly n: number;
  readonly color: Rgb;
  /** 前の断面とつながない（ここから別の面。ふたの角を立てる） */
  readonly seam?: boolean;
  /** この断面の法線をすべてこの向きにする（平らなふた） */
  readonly normal?: readonly [number, number, number];
  /** UV の前後の値（胴体の前からの割合など） */
  readonly s?: number;
  /** 断面の上ほど前へずらす量（z += rake × (y − cy)。インテークの斜めの入口） */
  readonly rake?: number;
}

/** 断面の角度 t（0〜1。0 が上、0.25 が右）の点 */
export function ringPoint(r: Readonly<Ring>, t: number, out: number[]): void {
  const th = t * Math.PI * 2;
  const s = Math.sin(th);
  const c = Math.cos(th);
  const e = 2 / r.n;
  const x = r.cx + r.a * Math.sign(s) * Math.abs(s) ** e;
  const y = r.cy + (c >= 0 ? r.top : r.bottom) * Math.sign(c) * Math.abs(c) ** e;
  out[0] = x;
  out[1] = y;
  out[2] = r.z + (r.rake ?? 0) * (y - r.cy);
}

/** UV: (s, t) と位置から */
export type LoftUv = (s: number, t: number, x: number, y: number, z: number) => [number, number];

const tmp = [0, 0, 0];

/**
 * 断面をつないで acc に積む。radial は周方向の分割数（継ぎ目の点は UV のため 2 つ持つ）。
 * 面の表は「断面の並びの向き × 周の向き」が外を向く側（前から後ろへ並べると外向き）
 */
export function loft(
  acc: MeshAccumulator,
  rings: readonly Ring[],
  radial: number,
  uv: LoftUv,
  part: number,
): void {
  const count = rings.length;
  const pts: number[][] = [];
  for (const r of rings) {
    const ring: number[] = [];
    for (let j = 0; j < radial; j++) {
      ringPoint(r, j / radial, tmp);
      ring.push(tmp[0] ?? 0, tmp[1] ?? 0, tmp[2] ?? 0);
    }
    pts.push(ring);
  }
  // 面のまとまり（seam で切れる）ごとの範囲
  const stripStart: number[] = [];
  const stripEnd: number[] = [];
  let start = 0;
  for (let i = 0; i < count; i++) {
    if (i > 0 && rings[i]?.seam) start = i;
    stripStart[i] = start;
  }
  let end = count - 1;
  for (let i = count - 1; i >= 0; i--) {
    stripEnd[i] = end;
    if (rings[i]?.seam) end = i - 1;
  }
  const normals = pts.map((ring, i) => {
    const prev = pts[Math.max(stripStart[i] ?? 0, i - 1)] ?? ring;
    const next = pts[Math.min(stripEnd[i] ?? i, i + 1)] ?? ring;
    const out: number[] = [];
    for (let j = 0; j < radial; j++) {
      const jp = ((j + 1) % radial) * 3;
      const jm = ((j - 1 + radial) % radial) * 3;
      const k = j * 3;
      const lx = (next[k] ?? 0) - (prev[k] ?? 0);
      const ly = (next[k + 1] ?? 0) - (prev[k + 1] ?? 0);
      const lz = (next[k + 2] ?? 0) - (prev[k + 2] ?? 0);
      const rx = (ring[jp] ?? 0) - (ring[jm] ?? 0);
      const ry = (ring[jp + 1] ?? 0) - (ring[jm + 1] ?? 0);
      const rz = (ring[jp + 2] ?? 0) - (ring[jm + 2] ?? 0);
      out.push(ly * rz - lz * ry, lz * rx - lx * rz, lx * ry - ly * rx);
    }
    return out;
  });
  // 半径 0 の断面（機首の先端など）は隣の断面の法線の平均
  for (let i = 0; i < count; i++) {
    const n = normals[i] ?? [];
    let len = 0;
    for (let j = 0; j < radial * 3; j++) len += Math.abs(n[j] ?? 0);
    if (len > 1e-9) continue;
    const nb = normals[i === stripStart[i] ? i + 1 : i - 1] ?? [];
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let j = 0; j < radial; j++) {
      const k = j * 3;
      const l = Math.hypot(nb[k] ?? 0, nb[k + 1] ?? 0, nb[k + 2] ?? 0) || 1;
      sx += (nb[k] ?? 0) / l;
      sy += (nb[k + 1] ?? 0) / l;
      sz += (nb[k + 2] ?? 0) / l;
    }
    for (let j = 0; j < radial; j++) n.splice(j * 3, 3, sx, sy, sz);
  }

  const base: number[] = [];
  for (let i = 0; i < count; i++) {
    const r = rings[i];
    const ring = pts[i];
    const nr = normals[i];
    if (!r || !ring || !nr) continue;
    base.push(acc.vertexCount);
    for (let j = 0; j <= radial; j++) {
      const k = (j % radial) * 3;
      const x = ring[k] ?? 0;
      const y = ring[k + 1] ?? 0;
      const z = ring[k + 2] ?? 0;
      let nx = r.normal ? r.normal[0] : (nr[k] ?? 0);
      let ny = r.normal ? r.normal[1] : (nr[k + 1] ?? 0);
      let nz = r.normal ? r.normal[2] : (nr[k + 2] ?? 0);
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      const [u, v] = uv(r.s ?? i / (count - 1), j / radial, x, y, z);
      acc.vertex(x, y, z, nx, ny, nz, u, v, r.color, part);
    }
  }
  for (let i = 0; i + 1 < count; i++) {
    if (rings[i + 1]?.seam) continue;
    const a0 = base[i] ?? 0;
    const b0 = base[i + 1] ?? 0;
    for (let j = 0; j < radial; j++) {
      const a = a0 + j;
      const b = b0 + j;
      acc.triangle(a, b, a + 1);
      acc.triangle(a + 1, b, b + 1);
    }
  }
}
