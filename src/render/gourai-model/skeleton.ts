// 10-4a: メカ怪獣ゴウライの骨格: Bone の階層。原点は体の中心・前方 −Z・右 +X・上 +Y（全長 180m: 前の装甲の先 z −96・排気口 z +92）。
// 装甲が開く（左右の板が横の蝶番で外へ）・装甲を捨てる（板が飛んで消える）・ハッチ・砲台の向き・壊れた砲台（うなだれる）を
// animateGourai() が骨で付ける（体の皮は SkinnedMesh 1 つ。描画 1 回）
import { Bone, Skeleton } from 'three';
import { GOURAI_TURRETS } from '../../data/gourai';

/** 骨の名前・親の番号・静止姿勢の位置（砲台は data/gourai.ts の砲台の位置。前 = −Z、右 = +X） */
const tp = (i: number): readonly [number, number, number] => {
  const o = GOURAI_TURRETS[i]?.offset ?? { forward: 0, right: 0, up: 0 };
  return [o.right, o.up, -o.forward];
};

const BONE_DEFS: readonly (readonly [string, number, readonly [number, number, number]])[] = [
  ['root', -1, [0, 0, 0]],
  ['armorL', 0, [-44, 0, -58]],
  ['armorR', 0, [44, 0, -58]],
  ['hatch', 0, [0, 50, 44]],
  ['gunL', 0, tp(0)],
  ['gunR', 0, tp(1)],
  ['podL', 0, tp(2)],
  ['podR', 0, tp(3)],
  ['hipL', 0, tp(4)],
  ['hipR', 0, tp(5)],
  ['core', 0, [0, 2, -74]],
];

export type GouraiBoneName =
  | 'root'
  | 'armorL'
  | 'armorR'
  | 'hatch'
  | 'gunL'
  | 'gunR'
  | 'podL'
  | 'podR'
  | 'hipL'
  | 'hipR'
  | 'core';

export const GOURAI_BONE: Readonly<Record<GouraiBoneName, number>> = Object.fromEntries(
  BONE_DEFS.map((d, i) => [d[0], i]),
) as Record<GouraiBoneName, number>;

/** 骨の静止姿勢の位置（形を作るとき、骨の周りに置く） */
export function bonePosition(name: GouraiBoneName): readonly [number, number, number] {
  return BONE_DEFS[GOURAI_BONE[name]]?.[2] ?? [0, 0, 0];
}

export interface GouraiSkeleton {
  readonly root: Bone;
  readonly bones: readonly Bone[];
  readonly skeleton: Skeleton;
}

export function createGouraiSkeleton(): GouraiSkeleton {
  const bones = BONE_DEFS.map((d) => {
    const b = new Bone();
    b.name = d[0];
    return b;
  });
  BONE_DEFS.forEach((d, i) => {
    const b = bones[i];
    if (!b) return;
    const parent = d[1] >= 0 ? BONE_DEFS[d[1]] : undefined;
    const pp = parent?.[2] ?? [0, 0, 0];
    b.position.set(d[2][0] - pp[0], d[2][1] - pp[1], d[2][2] - pp[2]);
    if (d[1] >= 0) bones[d[1]]?.add(b);
  });
  const root = bones[0];
  if (!root) throw new Error('gourai skeleton');
  root.updateMatrixWorld(true);
  return { root, bones, skeleton: new Skeleton(bones) };
}
