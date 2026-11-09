// 10-6: ヴォルガス・ネフィルガの体の当たり（src/ai/kaiju-hull/）。骨の静止姿勢が描画と同じ・姿勢を付けた点が描画の骨（Three.js の
// SkinnedMesh と同じ計算）と同じ・体を横切る線分は当たり、離れた線分は当たらない・ソロの衝突は最大 HP の約 8 割で跳ねない
import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Kaiju2Hull } from '../src/ai/kaiju-hull/kaiju2-hull';
import type { HullPoint } from '../src/ai/kaiju-hull/rig';
import { VorgasHull } from '../src/ai/kaiju-hull/vorgas-hull';
import { KAIJU2_HULL, VORGAS_HULL } from '../src/data/kaiju-hulls';
import { RAID_CONFIG } from '../src/data/kaiju';
import { Kaiju } from '../src/entities/kaiju';
import { createPose, type KaijuPose } from '../src/entities/kaiju-pose';
import type { Kaiju2Pose } from '../src/entities/kaiju2/sky-kaiju';
import { VorgasRam } from '../src/missions/vorgas-ram';
import {
  animate,
  bonePosition,
  createKaijuSkeleton,
  type BoneName,
} from '../src/render/kaiju-model/skeleton';
import {
  animateKaiju2,
  applyKaiju2Broken,
  bone2Position,
  createKaiju2Skeleton,
  WING_TIP,
  type Kaiju2BoneName,
} from '../src/render/kaiju2-model/skeleton';
import type { Bone, Skeleton } from 'three';

/** 描画の骨で静止姿勢の点を動かす（SkinnedMesh の頂点と同じ: 骨の行列 × 逆の結合行列、2 本まで混ぜる） */
function skinned(sk: { bones: readonly Bone[]; skeleton: Skeleton }, p: HullPoint): Vector3 {
  const m = new Matrix4();
  const one = (i: number): Vector3 => {
    const b = sk.bones[i];
    const inv = sk.skeleton.boneInverses[i];
    if (!b || !inv) throw new Error(String(i));
    m.multiplyMatrices(b.matrixWorld, inv);
    return new Vector3(p.x, p.y, p.z).applyMatrix4(m);
  };
  const w = p.bind.b === undefined ? 0 : (p.bind.w ?? 0);
  const out = one(p.bind.a).multiplyScalar(1 - w);
  if (p.bind.b !== undefined && w > 0) out.add(one(p.bind.b).multiplyScalar(w));
  return out;
}

const k2pose = (o: Partial<Kaiju2Pose> = {}): Kaiju2Pose => ({
  flapPhase: 0.3,
  flapAmount: 1,
  wingFold: 0,
  wingRaise: 0,
  throatGlow: 0,
  tailCurl: 0,
  tailSwing: 0,
  neckPitch: 0,
  legsDown: 0,
  ...o,
});
const NOT_BROKEN = { wingL: false, wingR: false, head: false, tail: false };

describe('10-6: ヴォルガスの体の当たり', () => {
  it('骨の静止姿勢は描画の骨と同じ', () => {
    for (const d of VORGAS_HULL.bones) {
      const p = bonePosition(d[0] as BoneName);
      expect([p.x, p.y, p.z]).toEqual([d[2], d[3], d[4]]);
    }
  });

  it('姿勢（頭・尾・腕・ダウン）を付けた管の端は、描画の骨で動かした点と同じ（1cm 以内）', () => {
    const hull = new VorgasHull();
    const sk = createKaijuSkeleton();
    const poses: KaijuPose[] = [
      createPose(),
      { ...createPose(), headLift: 1 },
      { ...createPose(), tailLift: 1 },
      { ...createPose(), armLift: 0.7 },
      { ...createPose(), bodyDrop: 38 },
      { ...createPose(), bodyDrop: 20, headLift: 0.45 },
    ];
    for (const pose of poses) {
      hull.pose(pose);
      animate(sk, { pose, walkPhase: 0, walking: 0, time: 0, roaring: false });
      sk.root.updateMatrixWorld(true);
      hull.shape.tubes.forEach((t, i) => {
        for (const [j, p] of [t.a, t.b].entries()) {
          const want = skinned(sk, p);
          const got = hull.shape.point(i * 2 + j);
          expect(Math.hypot(got.x - want.x, got.y - want.y, got.z - want.z)).toBeLessThan(0.01);
        }
      });
    }
  });

  it('胴・尾・脚を横切る線分は当たり、頭の上 40m・体の横 60m は当たらない（向きと位置も入れる）', () => {
    const hull = new VorgasHull();
    hull.pose(createPose());
    const k = {
      feet: { x: 500, y: 2, z: -300 },
      prevFeet: { x: 500, y: 2, z: -300 },
      heading: 0.7,
      prevHeading: 0.7,
      pose: createPose(),
    };
    // 体の座標 → 世界
    const w = (x: number, y: number, z: number): { x: number; y: number; z: number } => ({
      x: k.feet.x + x * Math.cos(k.heading) + z * Math.sin(k.heading),
      y: k.feet.y + y,
      z: k.feet.z - x * Math.sin(k.heading) + z * Math.cos(k.heading),
    });
    expect(hull.contact(k, w(-80, 70, -5), w(80, 70, -5))).toBe(true); // 胴
    expect(hull.contact(k, w(-60, 30, 100), w(60, 30, 100))).toBe(true); // 尾
    expect(hull.contact(k, w(-40, 20, 0), w(0, 20, 0))).toBe(true); // 左脚
    expect(hull.contact(k, w(-80, 150, -50), w(80, 150, -50))).toBe(false); // 頭と結晶の上
    expect(hull.contact(k, w(-80, 128, -27), w(80, 128, -27))).toBe(true); // 首の付け根の結晶
    expect(hull.contact(k, w(60, 0, -200), w(60, 0, 200))).toBe(false); // 体の横
    // ダウン（38m 沈む）なら胴の高さ 70m は上を通る
    const down = { ...createPose(), bodyDrop: 38 };
    hull.pose(down);
    expect(hull.contact({ ...k, pose: down }, w(-80, 110, -5), w(80, 110, -5))).toBe(false);
  });

  it('ソロ: レイドのヴォルガスにぶつかると 1 回だけ（1.5 秒は続けて当たらない）。キャンペーン（raid でない）は当たらない', () => {
    const kaiju = new Kaiju(() => 0);
    const f = RAID_CONFIG.kaijuFrom;
    kaiju.emerge(f.x, f.z, RAID_CONFIG.cityCenter.x, RAID_CONFIG.cityCenter.z, { raid: true });
    for (let i = 0; i < 60 * 9; i++) kaiju.step(1 / 60);
    expect(kaiju.targetable).toBe(true);
    const ram = new VorgasRam();
    const at = (dx: number): { x: number; y: number; z: number } => ({
      x: kaiju.feet.x + dx,
      y: kaiju.feet.y + 70,
      z: kaiju.feet.z,
    });
    let hits = 0;
    for (let i = 0; i < 40; i++) {
      kaiju.step(1 / 60);
      if (ram.step(1 / 60, kaiju, true, at(-60 + i * 3), at(-57 + i * 3))) hits++;
    }
    expect(hits).toBe(1);
    kaiju.raid = false;
    const other = new VorgasRam();
    expect(other.step(1 / 60, kaiju, true, at(-60), at(60))).toBe(false);
  });
});

describe('10-6: ネフィルガの体の当たり', () => {
  it('骨の静止姿勢と翼の先は描画の骨と同じ', () => {
    for (const d of KAIJU2_HULL.bones) {
      const p = bone2Position(d[0] as Kaiju2BoneName);
      expect([p.x, p.y, p.z]).toEqual([d[2], d[3], d[4]]);
    }
    expect([...KAIJU2_HULL.wingTip]).toEqual([WING_TIP.x, WING_TIP.y, WING_TIP.z]);
  });

  it('羽ばたき・たたむ・掲げる・首・尾・脚・壊れた翼と尾の点は、描画の骨で動かした点と同じ（尾は描画だけの小さな揺れの分、衝突の余裕 6m の中）', () => {
    const hull = new Kaiju2Hull();
    const sk = createKaiju2Skeleton();
    const cases: [Kaiju2Pose, typeof NOT_BROKEN][] = [
      [k2pose(), NOT_BROKEN],
      [k2pose({ flapPhase: 0.8, wingRaise: 1 }), NOT_BROKEN],
      [k2pose({ wingFold: 1, flapAmount: 0, legsDown: 1 }), NOT_BROKEN],
      [k2pose({ wingFold: 0.85, neckPitch: -0.6 }), NOT_BROKEN],
      [k2pose({ tailCurl: 1, tailSwing: 0.7, throatGlow: 1 }), NOT_BROKEN],
      [k2pose({ flapPhase: 0.55 }), { wingL: true, wingR: false, head: false, tail: true }],
    ];
    const tailBones = new Set(
      ['tail0', 'tail1', 'tail2', 'tail3', 'tail4'].map((n) =>
        KAIJU2_HULL.bones.findIndex((b) => b[0] === n),
      ),
    );
    const isTail = (p: HullPoint): boolean =>
      tailBones.has(p.bind.a) || (p.bind.b !== undefined && tailBones.has(p.bind.b));
    for (const [pose, broken] of cases) {
      hull.pose(pose, broken);
      animateKaiju2(sk, pose, 0);
      applyKaiju2Broken(sk, broken);
      sk.root.updateMatrixWorld(true);
      let i = 0;
      const check = (p: HullPoint): void => {
        const want = skinned(sk, p);
        const got = hull.shape.point(i++);
        const d = Math.hypot(got.x - want.x, got.y - want.y, got.z - want.z);
        expect(d).toBeLessThan(isTail(p) ? 6 : 0.01);
      };
      for (const t of hull.shape.tubes) {
        check(t.a);
        check(t.b);
      }
      for (const t of hull.shape.tris) for (const p of t.p) check(p);
    }
  });

  it('胴・翼の膜を横切る線分は当たり、翼の 40m 上・翼の先の外は当たらない（傾きと動きも入れる）', () => {
    const hull = new Kaiju2Hull();
    const pose = k2pose({ flapAmount: 0 });
    hull.pose(pose, NOT_BROKEN);
    const k = {
      position: { x: 0, y: 700, z: 0 },
      prevPosition: { x: 0, y: 700, z: 2 },
      forward: { x: 0, y: 0, z: -1 },
      prevForward: { x: 0, y: 0, z: -1 },
      bank: 0,
      prevBank: 0,
      pose,
      broken: NOT_BROKEN,
    };
    // 胴を横から
    expect(hull.contact(k, { x: -40, y: 700, z: 0 }, { x: 40, y: 700, z: 0 })).toBe(true);
    // 右翼の膜（付け根から 60m・前縁と後縁の間）を上から下へ
    expect(hull.contact(k, { x: 60, y: 730, z: 0 }, { x: 60, y: 680, z: 0 })).toBe(true);
    // 右翼の 40m 上を横へ
    expect(hull.contact(k, { x: -150, y: 745, z: 0 }, { x: 150, y: 745, z: 0 })).toBe(false);
    // 翼の先の外を上から下へ
    expect(hull.contact(k, { x: 140, y: 760, z: 0 }, { x: 140, y: 640, z: 0 })).toBe(false);
    // 右へ 90° 傾くと、右翼は真下へ: 体の真下 60m を横切る線分に当たる
    const banked = { ...k, bank: Math.PI / 2, prevBank: Math.PI / 2 };
    expect(hull.contact(banked, { x: -30, y: 640, z: 0 }, { x: 30, y: 640, z: 0 })).toBe(true);
    // 速く動く体: 自機は止まっていても、体が自機の所を通れば当たる
    const moving = {
      ...k,
      prevPosition: { x: 0, y: 700, z: 30 },
      position: { x: 0, y: 700, z: -30 },
    };
    expect(hull.contact(moving, { x: 0, y: 700, z: 0 }, { x: 0, y: 700, z: 0 })).toBe(true);
  });
});
