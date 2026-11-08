// 10-7d: 断面を縦の軸の周りに回した面（10-5a の parts.ts から分けた。円盤・ドーム・10-7d の浮かぶ光の輪で使う）
import { Vector3 } from 'three';
import type { BoneBind, KaijuMeshBuilder, Rgb } from '../kaiju-model/builder';

/** 回した面の断面の 1 点（半径・高さ・色・発光の番号） */
export interface ProfilePoint {
  readonly r: number;
  readonly y: number;
  readonly color: Rgb;
  readonly glow?: number;
}

const pa = new Vector3();
const nv = new Vector3();

/**
 * 断面を縦の軸の周りに回した面（下から上へ。断面の点ごとに 1 周）。法線は断面の接線から（なめらか）。cx, cz は軸の位置。
 * 隣り合う 2 点の色・発光が違う所は、同じ点を 2 つ置いて分ける（縁の帯をくっきり）
 */
export function lathe(
  b: KaijuMeshBuilder,
  profile: readonly ProfilePoint[],
  segments: number,
  bind: BoneBind,
  cx = 0,
  cz = 0,
): void {
  const n = profile.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = profile[i];
    const p1 = profile[i + 1];
    if (!p0 || !p1) continue;
    // 面の断面の向き（外向きの法線）: 接線 (dr, dy) を 90° 回す
    const dr = p1.r - p0.r;
    const dy = p1.y - p0.y;
    const l = Math.hypot(dr, dy) || 1;
    const nr = dy / l;
    const ny = -dr / l;
    const first: number[] = [];
    const second: number[] = [];
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const s = Math.sin(a);
      const c = Math.cos(a);
      nv.set(s * nr, ny, -c * nr).normalize();
      pa.set(cx + s * p0.r, p0.y, cz - c * p0.r);
      first.push(b.vertex(pa, nv, p0.color, bind, p0.glow ?? 0));
      pa.set(cx + s * p1.r, p1.y, cz - c * p1.r);
      second.push(b.vertex(pa, nv, p0.color, bind, p0.glow ?? 0));
    }
    for (let j = 0; j < segments; j++) {
      const a0 = first[j] ?? 0;
      const a1 = first[j + 1] ?? 0;
      const b0 = second[j] ?? 0;
      const b1 = second[j + 1] ?? 0;
      b.triangle(a0, b0, a1);
      b.triangle(a1, b0, b1);
    }
  }
}
