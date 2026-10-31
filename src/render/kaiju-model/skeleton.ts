// 怪獣の簡易な骨格（6-1）: Bone（Object3D）の階層。静止姿勢の位置（ワールドと同じ、足元が原点・前方 -Z）を
// ここで決め、部位のメッシュはこの骨に貼り付ける（SkinnedMesh。1 頂点に骨 2 本まで）。
// 歩行・ダウン・攻撃の構えは animate() が骨を回して付ける（コードのアニメーション）
import { Bone, Skeleton, Vector3 } from 'three';
import type { KaijuPose } from '../../entities/kaiju-pose';

/** 骨の名前と、親・静止姿勢の位置 */
const BONE_DEFS = [
  ['root', -1, 0, 0, 0],
  ['pelvis', 0, 0, 58, 8],
  ['chest', 1, 0, 86, -22],
  ['neck', 2, 0, 94, -40],
  ['head', 3, 0, 97, -52],
  ['jaw', 4, 0, 92, -56],
  ['armLUpper', 2, -20, 80, -30],
  ['armLFore', 6, -25, 60, -38],
  ['armRUpper', 2, 20, 80, -30],
  ['armRFore', 8, 25, 60, -38],
  ['thighL', 1, -16, 54, 8],
  ['shinL', 10, -19, 28, 0],
  ['footL', 11, -19, 6, 2],
  ['thighR', 1, 16, 54, 8],
  ['shinR', 13, 19, 28, 0],
  ['footR', 14, 19, 6, 2],
  ['tail0', 1, 0, 54, 28],
  ['tail1', 16, 0, 46, 56],
  ['tail2', 17, 0, 36, 86],
  ['tail3', 18, 0, 24, 114],
  ['tail4', 19, 0, 14, 140],
] as const;

export type BoneName = (typeof BONE_DEFS)[number][0];

/** 骨の番号（skinIndex） */
export const BONE: Readonly<Record<BoneName, number>> = Object.fromEntries(
  BONE_DEFS.map((d, i) => [d[0], i]),
) as Record<BoneName, number>;

/** 骨の静止姿勢の位置（ワールド = 足元が原点） */
export function bonePosition(name: BoneName): Vector3 {
  const d = BONE_DEFS[BONE[name]];
  return new Vector3(d?.[2] ?? 0, d?.[3] ?? 0, d?.[4] ?? 0);
}

export interface KaijuSkeleton {
  readonly root: Bone;
  readonly bones: readonly Bone[];
  readonly skeleton: Skeleton;
}

/** 骨を作り、親子をつなぎ、静止姿勢で逆行列を計算する */
export function createKaijuSkeleton(): KaijuSkeleton {
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
  if (!root) throw new Error('骨がない');
  root.updateMatrixWorld(true);
  const skeleton = new Skeleton(bones);
  return { root, bones, skeleton };
}

/** アニメーションの入力（描画フレームごと） */
export interface KaijuAnimInput {
  readonly pose: Readonly<KaijuPose>;
  /** 歩いた歩数（小数） */
  readonly walkPhase: number;
  /** 歩いているか（足を上げる量。止まっていれば 0 へ） */
  readonly walking: number;
  /** 経過秒数（呼吸・揺れ） */
  readonly time: number;
  /** 咆哮の攻撃中（体を震わせる） */
  readonly roaring: boolean;
}

/** 骨を回して姿勢を付ける（静止姿勢からの回転だけ。位置は骨盤の上下だけ） */
export function animate(s: KaijuSkeleton, a: KaijuAnimInput): void {
  const b = s.bones;
  const get = (n: BoneName): Bone => {
    const bone = b[BONE[n]];
    if (!bone) throw new Error(n);
    return bone;
  };
  const p = a.pose;
  const drop = p.bodyDrop;
  const kneel = Math.min(1, drop / 38);
  // 歩行: 1 歩 = 位相 π。左右の脚を逆に振り、上げている脚の膝を曲げる
  const ph = a.walkPhase * Math.PI;
  const swing = Math.sin(ph) * 0.32 * a.walking;
  const liftL = Math.max(0, Math.cos(ph)) * a.walking;
  const liftR = Math.max(0, -Math.cos(ph)) * a.walking;
  const pelvis = get('pelvis');
  const rest = BONE_DEFS[BONE.pelvis];
  pelvis.position.y = (rest?.[3] ?? 0) - drop + Math.abs(Math.cos(ph)) * 1.8 * a.walking;
  pelvis.rotation.set(0.04 * kneel, 0, Math.sin(ph) * 0.03 * a.walking);
  const breathe = Math.sin(a.time * 1.3) * 0.015;
  get('chest').rotation.set(0.12 * kneel + breathe - 0.18 * p.headLift, 0, 0);
  const shake = a.roaring ? Math.sin(a.time * 47) * 0.03 : 0;
  get('neck').rotation.set(-0.55 * p.headLift + 0.1 * kneel + shake, 0, 0);
  get('head').rotation.set(-0.35 * p.headLift, shake, 0);
  get('jaw').rotation.set(0.5 * p.headLift + 0.08 * p.armLift, 0, 0);
  get('thighL').rotation.set(swing - 1.0 * kneel, 0, 0);
  get('thighR').rotation.set(-swing - 1.0 * kneel, 0, 0);
  get('shinL').rotation.set(-0.5 * liftL + 1.7 * kneel, 0, 0);
  get('shinR').rotation.set(-0.5 * liftR + 1.7 * kneel, 0, 0);
  get('footL').rotation.set(0.3 * liftL - 0.7 * kneel, 0, 0);
  get('footR').rotation.set(0.3 * liftR - 0.7 * kneel, 0, 0);
  // 腕: 歩行で少し振る。投擲は右腕を振り上げる
  get('armLUpper').rotation.set(0.35 - swing * 0.4 - 0.3 * kneel, 0, -0.15);
  get('armRUpper').rotation.set(
    0.35 + swing * 0.4 - 2.4 * p.armLift - 0.3 * kneel,
    0,
    0.15 + 0.3 * p.armLift,
  );
  get('armLFore').rotation.set(0.8, 0, 0);
  get('armRFore').rotation.set(0.8 - 0.6 * p.armLift, 0, 0);
  // 尾: 歩行で左右に揺れ、薙ぎ払いの予兆で持ち上がる
  const sway = Math.sin(ph * 0.5 + a.time * 0.4) * 0.07;
  for (let i = 0; i < 5; i++) {
    const t = get(`tail${i}` as BoneName);
    t.rotation.set(
      -0.16 * p.tailLift * (i === 0 ? 1.4 : 1) + 0.05 * kneel,
      sway * (0.6 + i * 0.25),
      0,
    );
  }
}
