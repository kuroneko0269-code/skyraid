// 10-6: ネフィルガの体の当たり（Three.js 非依存・決まった計算）。胴・首・頭・くちばし・尾・脚・翼の骨の管と、翼の膜（厚みのある
// 三角形）。羽ばたき・翼をたたむ・掲げる・首・尾の巻き上げと振り・脚・壊れた翼の縮みと垂れを、描画の骨（src/render/kaiju2-model/
// skeleton.ts の animateKaiju2・applyKaiju2Broken）と同じ式で動かす。描画だけの動き（10-7a の翼のしなり・頭が追う・身じろぎ・
// 呼吸と尾の小さな揺れ）は入れない。体も速く動く（巡航 115・急降下 230 m/s）ので、前の体から見た前の自機 → 今の体から見た今の
// 自機の線分で調べる（ゼノリスと同じ考え）
import { KAIJU2_MODEL_CONFIG } from '../../data/kaiju2-model';
import { KAIJU_HULL_COLLISION as HC, KAIJU2_HULL as H } from '../../data/kaiju-hulls';
import type { Kaiju2Part } from '../../data/kaiju2';
import type { Kaiju2Pose } from '../../entities/kaiju2/sky-kaiju';
import type { Vec3 } from '../../flight/math';
import { HullRig, type HullBind, type HullPoint } from './rig';
import { HullShape, type HullTri, type HullTube } from './shapes';
import { hullPoint } from './vorgas-hull';

const F = KAIJU2_MODEL_CONFIG.flap;
const BR = KAIJU2_MODEL_CONFIG.broken;

const bone = (name: string): number => {
  const i = H.bones.findIndex((b) => b[0] === name);
  if (i < 0) throw new Error(`unknown hull bone: ${name}`);
  return i;
};
const one = (n: string): HullBind => ({ a: bone(n) });
const mix = (a: string, b: string, w: number): HullBind => ({ a: bone(a), b: bone(b), w });
const pt = (x: number, y: number, z: number, bind: HullBind): HullPoint => ({ x, y, z, bind });
const restOf = (n: string): [number, number, number] => {
  const d = H.bones[bone(n)];
  return [d?.[2] ?? 0, d?.[3] ?? 0, d?.[4] ?? 0];
};

/** 折れ線の上の割合 u（区間の長さで配分）の点（描画の parts.ts の alongPolyline と同じ） */
function alongPolyline(pts: readonly (readonly number[])[], u: number): [number, number, number] {
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i] ?? [0, 0, 0];
    const c = pts[i + 1] ?? a;
    const l = Math.hypot(
      (c[0] ?? 0) - (a[0] ?? 0),
      (c[1] ?? 0) - (a[1] ?? 0),
      (c[2] ?? 0) - (a[2] ?? 0),
    );
    lens.push(l);
    total += l;
  }
  let s = u * total;
  for (let i = 0; i < lens.length; i++) {
    const l = lens[i] ?? 0;
    const a = pts[i] ?? [0, 0, 0];
    const c = pts[i + 1] ?? a;
    if (s <= l || i === lens.length - 1) {
      const f = l > 0 ? Math.min(1, s / l) : 0;
      return [0, 1, 2].map((k) => (a[k] ?? 0) + ((c[k] ?? 0) - (a[k] ?? 0)) * f) as [
        number,
        number,
        number,
      ];
    }
    s -= l;
  }
  const last = pts[pts.length - 1] ?? [0, 0, 0];
  return [last[0] ?? 0, last[1] ?? 0, last[2] ?? 0];
}

/** 膜の付け根からの割合 u で付いている骨（描画の membraneBone と同じ） */
function membraneBone(n: 'L' | 'R', u: number): HullBind {
  if (u < 0.12) return mix('chest', `wing${n}0`, u / 0.12);
  if (u < 0.42) return mix(`wing${n}0`, `wing${n}1`, Math.max(0, (u - 0.3) / 0.12));
  if (u < 0.62) return mix(`wing${n}1`, `wing${n}2`, Math.max(0, (u - 0.5) / 0.12));
  return one(`wing${n}2`);
}

/** 管と膜の三角形を作る（左右の翼・脚を足す） */
function buildShape(): HullShape {
  const tubes: HullTube[] = H.tubes.map((t) => ({
    a: hullPoint(H.bones, t[0]),
    b: hullPoint(H.bones, t[1]),
    ra: t[2],
    rb: t[3],
  }));
  const tris: HullTri[] = [];
  const [tx, ty, tz] = H.wingTip;
  const M = H.membrane;
  for (const side of [-1, 1] as const) {
    const n = side < 0 ? 'L' : 'R';
    // 翼の骨（肩 → 指の先）
    const w0 = restOf(`wing${n}0`);
    const w1 = restOf(`wing${n}1`);
    const w2 = restOf(`wing${n}2`);
    const arm = [
      pt(8 * side, 5, -20, one('chest')),
      pt(w0[0], w0[1], w0[2], one(`wing${n}0`)),
      pt(w1[0], w1[1], w1[2], mix(`wing${n}0`, `wing${n}1`, 0.6)),
      pt(w2[0], w2[1], w2[2], mix(`wing${n}1`, `wing${n}2`, 0.6)),
      pt(tx * side, ty, tz, one(`wing${n}2`)),
    ];
    for (let i = 0; i < arm.length - 1; i++) {
      const a = arm[i];
      const b = arm[i + 1];
      if (a && b) tubes.push({ a, b, ra: H.wingRadii[i] ?? 1, rb: H.wingRadii[i + 1] ?? 1 });
    }
    // 脚（たたんで後ろへ）
    const hip = restOf(`leg${n}`);
    const leg = one(`leg${n}`);
    const knee = pt(hip[0], hip[1] - 10, hip[2] + 4, leg);
    tubes.push({ a: pt(hip[0], hip[1], hip[2], leg), b: knee, ra: 4, rb: 2.6 });
    tubes.push({ a: knee, b: pt(hip[0], hip[1] - 18, hip[2] + 6, leg), ra: 2.6, rb: 1.8 });
    // 膜（描画の buildKaiju2Membrane と同じ前縁・後縁・えぐれ・たるみ）
    const lead = [[10 * side, 5, -20], w0, w1, w2, [tx * side, ty, tz]];
    const grid: HullPoint[][] = [];
    for (let i = 0; i <= M.span; i++) {
      const u = i / M.span;
      const L = alongPolyline(lead, u);
      // 後縁: 胴の脇（腰）→ 指の先。3 か所でえぐる（指の間）
      const T0 = 8 * side + (tx * side - 8 * side) * u;
      const T1 = -1 + ty * u;
      const T2 = 22 + (tz + 2 - 22) * u - Math.abs(Math.sin(u * Math.PI * 3)) * 16 * (1 - u * 0.4);
      const bind = membraneBone(n, u);
      const row: HullPoint[] = [];
      for (let j = 0; j <= M.chord; j++) {
        const t = j / M.chord;
        const x = L[0] + (T0 - L[0]) * t;
        const y = L[1] + (T1 - L[1]) * t - Math.sin(t * Math.PI) * 3 * (1 - u * 0.5);
        const z = L[2] + (T2 - L[2]) * t;
        const bb = u < 0.15 && t > 0.5 ? mix('root', `wing${n}0`, u / 0.15) : bind;
        row.push(pt(x, y, z, bb));
      }
      grid.push(row);
    }
    for (let i = 0; i < M.span; i++)
      for (let j = 0; j < M.chord; j++) {
        const a = grid[i]?.[j];
        const c = grid[i + 1]?.[j];
        const e = grid[i]?.[j + 1];
        const f = grid[i + 1]?.[j + 1];
        if (!a || !c || !e || !f) continue;
        tris.push({ p: [a, e, c], half: M.half });
        tris.push({ p: [c, e, f], half: M.half });
      }
  }
  return new HullShape(tubes, tris);
}

/** 体の当たりを調べる怪獣（SkyKaiju・協力の写し） */
export interface Kaiju2HullBody {
  readonly position: Readonly<Vec3>;
  readonly prevPosition: Readonly<Vec3>;
  readonly forward: Readonly<Vec3>;
  readonly prevForward: Readonly<Vec3>;
  readonly bank: number;
  readonly prevBank: number;
  readonly pose: Readonly<Kaiju2Pose>;
  readonly broken: Readonly<Record<Kaiju2Part, boolean>>;
}

/** 体の座標の軸（右・上・前。bodyToWorld と同じ: 向きと傾き） */
interface Axes {
  rx: number;
  ry: number;
  rz: number;
  ux: number;
  uy: number;
  uz: number;
}

function axesOf(f: Readonly<Vec3>, bank: number, out: Axes): Axes {
  let rx = -f.z;
  let rz = f.x;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-6) {
    rx = 1;
    rz = 0;
  } else {
    rx /= rl;
    rz /= rl;
  }
  const ux = -rz * f.y;
  const uy = rz * f.x - rx * f.z;
  const uz = rx * f.y;
  const c = Math.cos(bank);
  const s = Math.sin(bank);
  out.rx = rx * c - ux * s;
  out.ry = -uy * s;
  out.rz = rz * c - uz * s;
  out.ux = ux * c + rx * s;
  out.uy = uy * c;
  out.uz = uz * c + rz * s;
  return out;
}

const W = ['L', 'R'] as const;

export class Kaiju2Hull {
  readonly rig = new HullRig(H.bones);
  readonly shape = buildShape();
  /** めり込んだ所（世界の位置。contact が true のとき） */
  readonly point: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly a0: Axes = { rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0 };
  private readonly a1: Axes = { rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0 };

  /** 姿勢の値と壊れた部位から骨を動かして形を置き直す（描画の animateKaiju2・applyKaiju2Broken と同じ式） */
  pose(p: Readonly<Kaiju2Pose>, broken: Readonly<Record<Kaiju2Part, boolean>>): void {
    const r = this.rig;
    r.rest();
    const set = (n: string, x: number, y: number, z: number): void => {
      const i = bone(n) * 3;
      r.rot[i] = x;
      r.rot[i + 1] = y;
      r.rot[i + 2] = z;
    };
    const ph = p.flapPhase * Math.PI * 2;
    const beat = Math.sin(ph) * F.amplitude * p.flapAmount;
    const lag = Math.sin(ph - 0.7) * F.amplitude * 0.5 * p.flapAmount;
    const raise = p.wingRaise * F.raise;
    const fold = p.wingFold;
    const lift = fold * F.foldLift;
    for (const n of W) {
      const side = n === 'L' ? -1 : 1;
      set(`wing${n}0`, 0, -side * fold * F.foldShoulder, side * (beat + raise - lift));
      const droop = broken[n === 'L' ? 'wingL' : 'wingR'] ? side * BR.wingDroop : 0;
      set(`wing${n}1`, 0, side * fold * F.foldElbow, side * lag * 0.8 * (1 - fold) - droop);
      set(`wing${n}2`, 0, -side * fold * F.foldWrist, side * lag * 0.6 * (1 - fold));
      r.scale[bone(`wing${n}2`)] = broken[n === 'L' ? 'wingL' : 'wingR'] ? BR.wingScale : 1;
    }
    set('chest', Math.sin(ph + 1.2) * 0.04 * p.flapAmount, 0, 0);
    set('neck0', -p.neckPitch * 0.35, 0, 0);
    set('neck1', -p.neckPitch * 0.3, 0, 0);
    set('head', -p.neckPitch * 0.2 + p.throatGlow * 0.15, 0, 0);
    for (let i = 0; i < 5; i++) set(`tail${i}`, p.tailCurl * 0.28, p.tailSwing * 0.22, 0);
    const legs = -1.1 * (1 - p.legsDown);
    set('legL', legs, 0, 0);
    set('legR', legs, 0, 0);
    r.scale[bone('tail3')] = broken.tail ? BR.tailScale : 1;
    r.solve();
    this.shape.update(r);
  }

  /** 自機の動き aPrev → aNow が体にめり込んだか（姿勢は pose() で置いた今のもの）。めり込んだら point に世界の位置を入れて true */
  contact(
    k: Kaiju2HullBody,
    aPrev: Readonly<Vec3>,
    aNow: Readonly<Vec3>,
    margin: number = HC.margin,
    step: number = HC.sampleStep,
  ): boolean {
    const A0 = axesOf(k.prevForward, k.prevBank, this.a0);
    const A1 = axesOf(k.forward, k.bank, this.a1);
    const f0 = k.prevForward;
    const f1 = k.forward;
    const dx0 = aPrev.x - k.prevPosition.x;
    const dy0 = aPrev.y - k.prevPosition.y;
    const dz0 = aPrev.z - k.prevPosition.z;
    const x0 = dx0 * A0.rx + dy0 * A0.ry + dz0 * A0.rz;
    const y0 = dx0 * A0.ux + dy0 * A0.uy + dz0 * A0.uz;
    const z0 = -(dx0 * f0.x + dy0 * f0.y + dz0 * f0.z);
    const dx1 = aNow.x - k.position.x;
    const dy1 = aNow.y - k.position.y;
    const dz1 = aNow.z - k.position.z;
    const x1 = dx1 * A1.rx + dy1 * A1.ry + dz1 * A1.rz;
    const y1 = dx1 * A1.ux + dy1 * A1.uy + dz1 * A1.uz;
    const z1 = -(dx1 * f1.x + dy1 * f1.y + dz1 * f1.z);
    const t = this.shape.contact(x0, y0, z0, x1, y1, z1, margin, step);
    if (t < 0) return false;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const z = z0 + (z1 - z0) * t;
    const p = k.position;
    this.point.x = p.x + A1.rx * x + A1.ux * y - f1.x * z;
    this.point.y = p.y + A1.ry * x + A1.uy * y - f1.y * z;
    this.point.z = p.z + A1.rz * x + A1.uz * y - f1.z * z;
    return true;
  }
}
