// 9-6a: ネフィルガの骨格: Bone の階層。原点は体の中心・前方 −Z・右 +X・上 +Y（静止姿勢 = 翼を水平に広げた姿）。
// 羽ばたき・翼をたたむ・掲げる・首・尾・脚は animateKaiju2() が骨を回して付ける（コードのアニメーション）
import { Bone, Skeleton, Vector3 } from 'three';
import { KAIJU2_MODEL_CONFIG } from '../../data/kaiju2-model';
import type { Kaiju2Pose } from '../../entities/kaiju2/sky-kaiju';

/** 骨の名前・親の番号・静止姿勢の位置 */
const BONE_DEFS = [
  ['root', -1, 0, 0, 0],
  ['chest', 0, 0, 2, -18],
  ['neck0', 1, 0, 5, -38],
  ['neck1', 2, 0, 9, -54],
  ['head', 3, 0, 11, -68],
  ['tail0', 0, 0, 0, 18],
  ['tail1', 5, 0, -1, 34],
  ['tail2', 6, 0, -2, 50],
  ['tail3', 7, 0, -2, 64],
  ['tail4', 8, 0, -2, 76],
  ['wingL0', 1, -12, 6, -20],
  ['wingL1', 10, -50, 9, -12],
  ['wingL2', 11, -84, 11, -24],
  ['wingR0', 1, 12, 6, -20],
  ['wingR1', 13, 50, 9, -12],
  ['wingR2', 14, 84, 11, -24],
  ['legL', 0, -8, -6, 12],
  ['legR', 0, 8, -6, 12],
] as const;

export type Kaiju2BoneName = (typeof BONE_DEFS)[number][0];

export const BONE2: Readonly<Record<Kaiju2BoneName, number>> = Object.fromEntries(
  BONE_DEFS.map((d, i) => [d[0], i]),
) as Record<Kaiju2BoneName, number>;

/** 翼の先（指の先）の静止姿勢の位置（右翼。左は x を反転）。翼開長 240m */
export const WING_TIP = new Vector3(120, 9, 8);

export function bone2Position(name: Kaiju2BoneName): Vector3 {
  const d = BONE_DEFS[BONE2[name]];
  return new Vector3(d?.[2] ?? 0, d?.[3] ?? 0, d?.[4] ?? 0);
}

export interface Kaiju2Skeleton {
  readonly root: Bone;
  readonly bones: readonly Bone[];
  readonly skeleton: Skeleton;
}

export function createKaiju2Skeleton(): Kaiju2Skeleton {
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
  if (!root) throw new Error('Missing root bone');
  root.updateMatrixWorld(true);
  return { root, bones, skeleton: new Skeleton(bones) };
}

const F = KAIJU2_MODEL_CONFIG.flap;

/** 骨を回して姿勢を付ける（静止姿勢からの回転だけ）。time は呼吸・揺れ */
export function animateKaiju2(s: Kaiju2Skeleton, p: Readonly<Kaiju2Pose>, time: number): void {
  const get = (n: Kaiju2BoneName): Bone => {
    const b = s.bones[BONE2[n]];
    if (!b) throw new Error(n);
    return b;
  };
  const ph = p.flapPhase * Math.PI * 2;
  // 羽ばたき: 打ち下ろしで肩が下がり、肘・手首は少し遅れて追う。たたむと肘を後ろへ折る
  const beat = Math.sin(ph) * F.amplitude * p.flapAmount;
  const lag = Math.sin(ph - 0.7) * F.amplitude * 0.5 * p.flapAmount;
  const raise = p.wingRaise * F.raise;
  const fold = p.wingFold;
  for (const side of [-1, 1] as const) {
    const n = side < 0 ? 'L' : 'R';
    // 右翼（side 1）は −Z 回りで下がる向きが正の beat
    get(`wing${n}0`).rotation.set(0, -side * fold * F.foldShoulder * 0.6, side * (beat + raise));
    get(`wing${n}1`).rotation.set(0, side * fold * F.foldElbow * 0.55, side * lag * 0.8);
    get(`wing${n}2`).rotation.set(0, -side * fold * F.foldElbow * 0.6, side * lag * 0.6);
  }
  // 胴: 羽ばたきで少し上下に揺れる
  get('chest').rotation.set(Math.sin(ph + 1.2) * 0.04 * p.flapAmount, 0, 0);
  const n0 = get('neck0');
  const n1 = get('neck1');
  const breathe = Math.sin(time * 1.1) * 0.03;
  n0.rotation.set(-p.neckPitch * 0.35 + breathe, Math.sin(time * 0.37) * 0.05, 0);
  n1.rotation.set(-p.neckPitch * 0.3, 0, 0);
  get('head').rotation.set(-p.neckPitch * 0.2 + p.throatGlow * 0.15, 0, 0);
  // 尾: ゆっくり揺れ、予兆で上へ巻き上げ、攻撃で左右に振る
  for (let i = 0; i < 5; i++) {
    const t = get(`tail${i}` as Kaiju2BoneName);
    t.rotation.set(
      p.tailCurl * 0.28 + Math.sin(time * 0.8 + i * 0.6) * 0.02,
      p.tailSwing * 0.22 + Math.sin(time * 0.5 + i * 0.9) * 0.05,
      0,
    );
  }
  // 脚: 飛ぶ間は後ろへたたみ、止まり木で下ろす
  const legs = -1.1 * (1 - p.legsDown);
  get('legL').rotation.set(legs, 0, 0);
  get('legR').rotation.set(legs, 0, 0);
}
