// 10-3a: 白鯨アルビオンの骨格: Bone の階層。原点は体の中心・前方 −Z・右 +X・上 +Y（全長 640m: 頭の先 z −321・尾びれの先 z +326）。
// 泳ぎ（尾を上下にあおぐ・胸びれをあおぐ）・尾を持ち上げる / 打ち下ろす・頭の上下・壊れた部位は animateAlbion() が骨で付ける。
// 10-7b: 下あごの骨（口を開けるのは描画だけの motion.ts）
import { Bone, Skeleton } from 'three';
import { ALBION_MODEL_CONFIG } from '../../data/albion-model';
import type { AlbionPose } from '../../entities/albion/albion-body';

/** 骨の名前・親の番号・静止姿勢の位置 */
const BONE_DEFS = [
  ['root', -1, 0, 0, 0],
  ['head', 0, 0, 2, -180],
  ['tail0', 0, 0, 1, 60],
  ['tail1', 2, 0, 1, 150],
  ['tail2', 3, 0, 0, 225],
  ['flukes', 4, 0, 0, 280],
  ['finL', 0, -40, -32, -125],
  ['finR', 0, 40, -32, -125],
  ['dorsal', 0, 0, 50, 40],
  // 10-7b: 下あご（口を開ける。頭の子）
  ['jaw', 1, 0, -20, -232],
] as const;

export type AlbionBoneName = (typeof BONE_DEFS)[number][0];

export const ALBION_BONE: Readonly<Record<AlbionBoneName, number>> = Object.fromEntries(
  BONE_DEFS.map((d, i) => [d[0], i]),
) as Record<AlbionBoneName, number>;

export interface AlbionSkeleton {
  readonly root: Bone;
  readonly bones: readonly Bone[];
  readonly skeleton: Skeleton;
}

export function createAlbionSkeleton(): AlbionSkeleton {
  const bones = BONE_DEFS.map((d) => {
    const b = new Bone();
    b.name = d[0];
    return b;
  });
  BONE_DEFS.forEach((d, i) => {
    const b = bones[i];
    if (!b) return;
    const pi: number = d[1];
    const parent = pi >= 0 ? BONE_DEFS[pi] : undefined;
    b.position.set(d[2] - (parent?.[2] ?? 0), d[3] - (parent?.[3] ?? 0), d[4] - (parent?.[4] ?? 0));
    if (pi >= 0) bones[pi]?.add(b);
  });
  const root = bones[0];
  if (!root) throw new Error('albion skeleton');
  root.updateMatrixWorld(true);
  return { root, bones, skeleton: new Skeleton(bones) };
}

const M = ALBION_MODEL_CONFIG;
const TAIL: readonly AlbionBoneName[] = ['tail0', 'tail1', 'tail2', 'flukes'];

/** 壊れた部位（骨の縮み）: 背びれは低く、尾びれは裂けて短く */
export interface AlbionBrokenLook {
  readonly dorsal: boolean;
  readonly tail: boolean;
}

/** 姿勢を骨に付ける（time は描画の経過秒。泳ぎの位相は固定ステップの pose.swimPhase） */
export function animateAlbion(
  rig: AlbionSkeleton,
  pose: AlbionPose,
  broken: AlbionBrokenLook,
): void {
  const ph = pose.swimPhase * Math.PI * 2;
  const lift = pose.tailLift;
  TAIL.forEach((name, i) => {
    const b = rig.bones[ALBION_BONE[name]];
    if (!b) return;
    // 尾の上下: 正の回転で下がる。付け根から先へ遅れて伝わる
    const swim = (M.swim.tail[i] ?? 0) * Math.sin(ph - i * 0.7);
    const amt = lift >= 0 ? -(M.tailLift.up[i] ?? 0) * lift : (M.tailLift.down[i] ?? 0) * -lift;
    // 持ち上げている間は泳ぎを止める
    b.rotation.x = swim * (1 - Math.abs(lift)) + amt;
  });
  const head = rig.bones[ALBION_BONE.head];
  if (head) head.rotation.x = M.swim.head * Math.sin(ph + 1.2) - 0.06 * pose.mouth;
  const fin = M.swim.fin * Math.sin(ph * 0.5 + 0.4);
  const finL = rig.bones[ALBION_BONE.finL];
  const finR = rig.bones[ALBION_BONE.finR];
  if (finL) finL.rotation.z = -fin;
  if (finR) finR.rotation.z = fin;
  const jaw = rig.bones[ALBION_BONE.jaw];
  if (jaw) jaw.rotation.set(0, 0, 0);
  const dorsal = rig.bones[ALBION_BONE.dorsal];
  if (dorsal) dorsal.scale.set(1, broken.dorsal ? 0.35 : 1, broken.dorsal ? 0.7 : 1);
  const flukes = rig.bones[ALBION_BONE.flukes];
  if (flukes) flukes.scale.set(broken.tail ? 0.55 : 1, 1, broken.tail ? 0.8 : 1);
}
