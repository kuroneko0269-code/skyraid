// 10-4a: メカ怪獣ゴウライの骨格: Bone の階層。原点は体の中心・前方 −Z・右 +X・上 +Y（全長 180m: 前の装甲の先 z −96・排気口 z +92）。
// 装甲が開く（左右の板が横の蝶番で外へ）・装甲を捨てる（板が飛んで消える）・ハッチ・砲台の向き・壊れた砲台（うなだれる）を
// animateGourai() が骨で付ける（体の皮は SkinnedMesh 1 つ。描画 1 回）。
// 10-7c: 生き物らしい形の骨を足した: 頭とあご・腕（肩・前腕・爪）左右・背の放熱板 3 枚ずつ左右・尾 3 節。動きは motion.ts（描画だけ）
import { Bone, Skeleton } from 'three';
import { GOURAI_TURRETS } from '../../data/gourai';

/** 骨の名前・親の番号・静止姿勢の位置（砲台は data/gourai.ts の砲台の位置。前 = −Z、右 = +X） */
const tp = (i: number): readonly [number, number, number] => {
  const o = GOURAI_TURRETS[i]?.offset ?? { forward: 0, right: 0, up: 0 };
  return [o.right, o.up, -o.forward];
};

/** 10-7c: 背の放熱板の蝶番（内側の縁。左右 3 枚ずつ。z は板の真ん中） */
export const GOURAI_FIN_Z: readonly number[] = [55, 67, 79];
export const GOURAI_FIN_HINGE = { x: 9, y: 26.5 } as const;

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
  // 10-7c: 頭（首の付け根）・あご（頭の子）
  ['head', 0, [0, 25.5, -38]],
  ['jaw', 11, [0, 20.5, -45]],
  // 腕: 肩 → 前腕（肘）→ 爪（手首。上の刃が開く）
  ['armL', 0, [-46, 8, -24]],
  ['foreL', 13, [-47, -11, -36]],
  ['clawL', 14, [-46, -23, -45]],
  ['armR', 0, [46, 8, -24]],
  ['foreR', 16, [47, -11, -36]],
  ['clawR', 17, [46, -23, -45]],
  // 背の放熱板（内側の縁の蝶番）
  ...GOURAI_FIN_Z.map((z, i): readonly [string, number, readonly [number, number, number]] => [
    `finL${String(i)}`,
    0,
    [-GOURAI_FIN_HINGE.x, GOURAI_FIN_HINGE.y, z],
  ]),
  ...GOURAI_FIN_Z.map((z, i): readonly [string, number, readonly [number, number, number]] => [
    `finR${String(i)}`,
    0,
    [GOURAI_FIN_HINGE.x, GOURAI_FIN_HINGE.y, z],
  ]),
  // 尾（後ろの下へ曲がる 3 節）
  ['tail1', 0, [0, -14, 77]],
  ['tail2', 25, [0, -20, 88]],
  ['tail3', 26, [0, -27, 96]],
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
  | 'core'
  | 'head'
  | 'jaw'
  | 'armL'
  | 'foreL'
  | 'clawL'
  | 'armR'
  | 'foreR'
  | 'clawR'
  | 'finL0'
  | 'finL1'
  | 'finL2'
  | 'finR0'
  | 'finR1'
  | 'finR2'
  | 'tail1'
  | 'tail2'
  | 'tail3';

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
