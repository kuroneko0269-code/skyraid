// 10-6: 怪獣の体の当たりの骨組み（Three.js 非依存・決まった計算）。描画の骨（SkinnedMesh の Bone の階層）と同じ計算を数だけで行い、
// 静止姿勢の点を骨で動かす（頂点の混ぜ方も描画と同じ: 骨 2 本までの重み）。回転は Three.js の Euler の既定（XYZ: Rx・Ry・Rz の順に掛ける）。
// ヴォルガス（vorgas-hull.ts）とネフィルガ（kaiju2-hull.ts）が使う
import type { HullBoneDef } from '../../data/kaiju-hulls';

/** 点が付いている骨（b が無ければ a だけ。w は b の重み） */
export interface HullBind {
  readonly a: number;
  readonly b?: number;
  readonly w?: number;
}

/** 静止姿勢の点と付いている骨 */
export interface HullPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly bind: HullBind;
}

export class HullRig {
  /** 骨ごとの回転（x, y, z ラジアン）・一様な大きさ・静止姿勢からの位置のずれ（親の座標） */
  readonly rot: Float64Array;
  readonly scale: Float64Array;
  readonly shift: Float64Array;
  /** 解いた結果: 骨ごとの 3×3（行の順）と平行移動。点 p は t + M (p − 静止姿勢の骨の位置) へ */
  private readonly m: Float64Array;
  private readonly t: Float64Array;
  private readonly local = new Float64Array(9);

  constructor(private readonly defs: readonly HullBoneDef[]) {
    const n = defs.length;
    this.rot = new Float64Array(n * 3);
    this.scale = new Float64Array(n).fill(1);
    this.shift = new Float64Array(n * 3);
    this.m = new Float64Array(n * 9);
    this.t = new Float64Array(n * 3);
  }

  /** 姿勢を静止姿勢に戻す */
  rest(): void {
    this.rot.fill(0);
    this.scale.fill(1);
    this.shift.fill(0);
  }

  /** 親から順に骨の位置と向きを解く（親は自分より前に並んでいる） */
  solve(): void {
    const { defs, m, t, local, rot, scale, shift } = this;
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      if (!d) continue;
      eulerXyz(rot[i * 3] ?? 0, rot[i * 3 + 1] ?? 0, rot[i * 3 + 2] ?? 0, scale[i] ?? 1, local);
      const p = d[1];
      const parent = p >= 0 ? defs[p] : undefined;
      // 親の座標での位置（静止姿勢の差 + ずれ）
      const lx = d[2] - (parent?.[2] ?? 0) + (shift[i * 3] ?? 0);
      const ly = d[3] - (parent?.[3] ?? 0) + (shift[i * 3 + 1] ?? 0);
      const lz = d[4] - (parent?.[4] ?? 0) + (shift[i * 3 + 2] ?? 0);
      if (p < 0) {
        for (let k = 0; k < 9; k++) m[i * 9 + k] = local[k] ?? 0;
        t[i * 3] = lx;
        t[i * 3 + 1] = ly;
        t[i * 3 + 2] = lz;
        continue;
      }
      // 親の行列 × 自分
      const o = p * 9;
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) {
          let s = 0;
          for (let k = 0; k < 3; k++) s += (m[o + r * 3 + k] ?? 0) * (local[k * 3 + c] ?? 0);
          m[i * 9 + r * 3 + c] = s;
        }
      for (let r = 0; r < 3; r++)
        t[i * 3 + r] =
          (t[p * 3 + r] ?? 0) +
          (m[o + r * 3] ?? 0) * lx +
          (m[o + r * 3 + 1] ?? 0) * ly +
          (m[o + r * 3 + 2] ?? 0) * lz;
    }
  }

  /** 静止姿勢の点を骨 1 本で動かして out へ足す（重み w） */
  private add(
    bone: number,
    x: number,
    y: number,
    z: number,
    w: number,
    out: Float64Array,
    at: number,
  ): void {
    const d = this.defs[bone];
    if (!d) return;
    const px = x - d[2];
    const py = y - d[3];
    const pz = z - d[4];
    const m = this.m;
    const o = bone * 9;
    for (let r = 0; r < 3; r++)
      out[at + r] =
        (out[at + r] ?? 0) +
        w *
          ((this.t[bone * 3 + r] ?? 0) +
            (m[o + r * 3] ?? 0) * px +
            (m[o + r * 3 + 1] ?? 0) * py +
            (m[o + r * 3 + 2] ?? 0) * pz);
  }

  /** 静止姿勢の点 → 今の姿勢（体の座標）。out[at..at+2] に入れる */
  place(p: HullPoint, out: Float64Array, at: number): void {
    out[at] = out[at + 1] = out[at + 2] = 0;
    const w = p.bind.b === undefined ? 0 : Math.min(1, Math.max(0, p.bind.w ?? 0));
    this.add(p.bind.a, p.x, p.y, p.z, 1 - w, out, at);
    if (p.bind.b !== undefined && w > 0) this.add(p.bind.b, p.x, p.y, p.z, w, out, at);
  }
}

/** Three.js の Euler（XYZ）と同じ回転行列（× 一様な大きさ）を行の順で out へ */
function eulerXyz(x: number, y: number, z: number, s: number, out: Float64Array): void {
  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const e = Math.cos(z);
  const f = Math.sin(z);
  const ae = a * e;
  const af = a * f;
  const be = b * e;
  const bf = b * f;
  out[0] = c * e * s;
  out[1] = -c * f * s;
  out[2] = d * s;
  out[3] = (af + be * d) * s;
  out[4] = (ae - bf * d) * s;
  out[5] = -b * c * s;
  out[6] = (bf - ae * d) * s;
  out[7] = (be + af * d) * s;
  out[8] = a * c * s;
}
