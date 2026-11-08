// 10-5a: UFO ゼノリスの骨格: Bone の階層。原点は円盤の中心・前方 −Z・右 +X・上 +Y（直径 160m）。円盤の飾り（disc）がゆっくり回り、
// 縁の発光体の輪（ring）が判定と同じ角度で回る。砲口・発生器・ドームは体の向きに付く。壊れた部位（発光体・発生器・砲口）は
// 骨で縮める（体の皮は SkinnedMesh 1 つ。描画 1 回）。10-7d: 浮かぶ光の輪 2 つ（halo・underRing）が描画だけで回る
import { Bone, Skeleton } from 'three';
import { XENOLITH_TARGET_SPHERES } from '../../data/xenolith';

/** 判定の球の位置（前 = −Z、右 = +X） */
const sp = (part: string): readonly [number, number, number] => {
  const s = XENOLITH_TARGET_SPHERES.find((t) => t.part === part);
  return s ? [s.right, s.up, -s.forward] : [0, 0, 0];
};

/** 縁の発光体 i の静止姿勢の位置（輪が 0° のとき。判定の ring の方位と半径） */
const ep = (i: number): readonly [number, number, number] => {
  const s = XENOLITH_TARGET_SPHERES.find((t) => t.part === `emitter${String(i)}`);
  const a = ((s?.ring?.deg ?? 0) * Math.PI) / 180;
  const r = s?.ring?.r ?? 80;
  return [Math.sin(a) * r, s?.up ?? 0, -Math.cos(a) * r];
};

const BONE_DEFS: readonly (readonly [string, number, readonly [number, number, number]])[] = [
  ['root', -1, [0, 0, 0]],
  ['disc', 0, [0, 0, 0]],
  ['ring', 0, [0, 0, 0]],
  ['emitter0', 2, ep(0)],
  ['emitter1', 2, ep(1)],
  ['emitter2', 2, ep(2)],
  ['emitter3', 2, ep(3)],
  ['cannon', 0, [0, -14, 0]],
  ['gen0', 0, sp('gen0')],
  ['gen1', 0, sp('gen1')],
  ['gen2', 0, sp('gen2')],
  ['dome', 0, [0, 12, 0]],
  // 10-7d: 上の面に浮かぶ光の輪・下の面に浮かぶ光の輪（描画だけで回る）
  ['halo', 0, [0, 0, 0]],
  ['underRing', 0, [0, 0, 0]],
];

export type XenolithBoneName =
  | 'root'
  | 'disc'
  | 'ring'
  | 'emitter0'
  | 'emitter1'
  | 'emitter2'
  | 'emitter3'
  | 'cannon'
  | 'gen0'
  | 'gen1'
  | 'gen2'
  | 'dome'
  | 'halo'
  | 'underRing';

export const XENOLITH_BONE: Readonly<Record<XenolithBoneName, number>> = Object.fromEntries(
  BONE_DEFS.map((d, i) => [d[0], i]),
) as Record<XenolithBoneName, number>;

/** 骨の静止姿勢の位置（形を作るとき、骨の周りに置く） */
export function bonePosition(name: XenolithBoneName): readonly [number, number, number] {
  return BONE_DEFS[XENOLITH_BONE[name]]?.[2] ?? [0, 0, 0];
}

export interface XenolithSkeleton {
  readonly root: Bone;
  readonly bones: readonly Bone[];
  readonly skeleton: Skeleton;
}

export function createXenolithSkeleton(): XenolithSkeleton {
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
  if (!root) throw new Error('xenolith skeleton');
  root.updateMatrixWorld(true);
  return { root, bones, skeleton: new Skeleton(bones) };
}
