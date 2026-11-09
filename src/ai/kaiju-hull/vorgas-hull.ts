// 10-6: ヴォルガスの体の当たり（Three.js 非依存・決まった計算）。胴・首・頭・腕・脚・尾の管を、描画の骨（src/render/kaiju-model/
// skeleton.ts の animate）と同じ式で姿勢（頭を上げる・尾を上げる・腕を振り上げる・ダウンの沈みと膝）に合わせて動かす。歩く脚の振り・
// 尾の揺れ・呼吸・咆哮の震えは描画だけの動き（判定の姿勢の値に無い）なので入れない（脚の振りは足の先で約 15m・尾は数 m）。
// 前のステップの体（足元・向き）から見た前の自機 → 今の体から見た今の自機の線分で調べ、すり抜けない
import { KAIJU_HULL_COLLISION as HC, VORGAS_HULL as H, type HullEnd } from '../../data/kaiju-hulls';
import type { KaijuPose } from '../../entities/kaiju-pose';
import type { Vec3 } from '../../flight/math';
import { HullRig, type HullPoint } from './rig';
import { HullShape } from './shapes';

/** 骨の名前 → 番号 */
function boneIndex(bones: readonly (readonly [string, ...unknown[]])[], name: string): number {
  const i = bones.findIndex((b) => b[0] === name);
  if (i < 0) throw new Error(`unknown hull bone: ${name}`);
  return i;
}

/** 管の端の定義 → 静止姿勢の点 */
export function hullPoint(
  bones: readonly (readonly [string, ...unknown[]])[],
  e: HullEnd,
): HullPoint {
  const b = e[4];
  return {
    x: e[0],
    y: e[1],
    z: e[2],
    bind:
      b === undefined
        ? { a: boneIndex(bones, e[3]) }
        : { a: boneIndex(bones, e[3]), b: boneIndex(bones, b), w: e[5] ?? 0 },
  };
}

const B = {
  pelvis: boneIndex(H.bones, 'pelvis'),
  chest: boneIndex(H.bones, 'chest'),
  neck: boneIndex(H.bones, 'neck'),
  head: boneIndex(H.bones, 'head'),
  jaw: boneIndex(H.bones, 'jaw'),
  armLUpper: boneIndex(H.bones, 'armLUpper'),
  armLFore: boneIndex(H.bones, 'armLFore'),
  armRUpper: boneIndex(H.bones, 'armRUpper'),
  armRFore: boneIndex(H.bones, 'armRFore'),
  thighL: boneIndex(H.bones, 'thighL'),
  shinL: boneIndex(H.bones, 'shinL'),
  footL: boneIndex(H.bones, 'footL'),
  thighR: boneIndex(H.bones, 'thighR'),
  shinR: boneIndex(H.bones, 'shinR'),
  footR: boneIndex(H.bones, 'footR'),
  tail0: boneIndex(H.bones, 'tail0'),
};

/** 体の当たりを調べる怪獣（Kaiju・協力の写し） */
export interface VorgasHullBody {
  readonly feet: Readonly<Vec3>;
  readonly prevFeet: Readonly<Vec3>;
  readonly heading: number;
  readonly prevHeading: number;
  readonly pose: Readonly<KaijuPose>;
}

export class VorgasHull {
  readonly rig = new HullRig(H.bones);
  readonly shape = new HullShape(
    H.tubes.map((t) => ({
      a: hullPoint(H.bones, t[0]),
      b: hullPoint(H.bones, t[1]),
      ra: t[2],
      rb: t[3],
    })),
    [],
  );
  /** めり込んだ所（世界の位置。contact が true のとき） */
  readonly point: Vec3 = { x: 0, y: 0, z: 0 };

  /** 姿勢の値から骨を動かして形を置き直す（描画の animate と同じ式。歩く・呼吸・震えは入れない） */
  pose(p: Readonly<KaijuPose>): void {
    const r = this.rig;
    r.rest();
    const drop = p.bodyDrop;
    const kneel = Math.min(1, drop / 38);
    const rx = (i: number, x: number, y = 0, z = 0): void => {
      r.rot[i * 3] = x;
      r.rot[i * 3 + 1] = y;
      r.rot[i * 3 + 2] = z;
    };
    r.shift[B.pelvis * 3 + 1] = -drop;
    rx(B.pelvis, 0.04 * kneel);
    rx(B.chest, 0.12 * kneel + 0.18 * p.headLift);
    rx(B.neck, 0.55 * p.headLift + 0.1 * kneel);
    rx(B.head, 0.35 * p.headLift);
    rx(B.jaw, -0.5 * p.headLift - 0.08 * p.armLift);
    rx(B.thighL, -1.0 * kneel);
    rx(B.thighR, -1.0 * kneel);
    rx(B.shinL, 1.7 * kneel);
    rx(B.shinR, 1.7 * kneel);
    rx(B.footL, -0.7 * kneel);
    rx(B.footR, -0.7 * kneel);
    rx(B.armLUpper, 0.35 - 0.3 * kneel, 0, -0.15);
    rx(B.armRUpper, 0.35 - 2.4 * p.armLift - 0.3 * kneel, 0, 0.15 + 0.3 * p.armLift);
    rx(B.armLFore, 0.8);
    rx(B.armRFore, 0.8 - 0.6 * p.armLift);
    for (let i = 0; i < 5; i++)
      rx(B.tail0 + i, -0.16 * p.tailLift * (i === 0 ? 1.4 : 1) + 0.05 * kneel);
    r.solve();
    this.shape.update(r);
  }

  /**
   * 自機の動き aPrev → aNow が体にめり込んだか（姿勢は pose() で置いた今のもの）。めり込んだら point に世界の位置を入れて true
   */
  contact(
    k: VorgasHullBody,
    aPrev: Readonly<Vec3>,
    aNow: Readonly<Vec3>,
    margin: number = HC.margin,
    step: number = HC.sampleStep,
  ): boolean {
    // 前の体から見た前の自機
    const c0 = Math.cos(k.prevHeading);
    const s0 = Math.sin(k.prevHeading);
    const dx0 = aPrev.x - k.prevFeet.x;
    const dz0 = aPrev.z - k.prevFeet.z;
    const x0 = dx0 * c0 - dz0 * s0;
    const y0 = aPrev.y - k.prevFeet.y;
    const z0 = dx0 * s0 + dz0 * c0;
    // 今の体から見た今の自機
    const c1 = Math.cos(k.heading);
    const s1 = Math.sin(k.heading);
    const dx1 = aNow.x - k.feet.x;
    const dz1 = aNow.z - k.feet.z;
    const x1 = dx1 * c1 - dz1 * s1;
    const y1 = aNow.y - k.feet.y;
    const z1 = dx1 * s1 + dz1 * c1;
    const t = this.shape.contact(x0, y0, z0, x1, y1, z1, margin, step);
    if (t < 0) return false;
    // 世界の位置（今の体に足す）
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const z = z0 + (z1 - z0) * t;
    this.point.x = k.feet.x + x * c1 + z * s1;
    this.point.y = k.feet.y + y;
    this.point.z = k.feet.z - x * s1 + z * c1;
    return true;
  }
}
