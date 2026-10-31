// 怪獣の姿勢（6-1。Three.js 非依存）: 攻撃の段階・ダウン・歩行から、体の上げ下げ（頭・尾・胴の沈み）と結晶の明るさを決め、
// 部位の当たり判定の球の位置を出す。本体（kaiju.ts）・協力のクライアントの表示（net/kaiju-mirror.ts）・描画で共通に使う
import { KAIJU_CONFIG, type KaijuAttack, type KaijuPartId } from '../data/kaiju';
import { clamp, smoothstep, type Vec3 } from '../flight/math';

/** 攻撃の段階: 予兆 → 攻撃 → 硬直 */
export const ATTACK_STEPS = ['windup', 'active', 'recover'] as const;
export type AttackStep = (typeof ATTACK_STEPS)[number];

/** 姿勢を決める入力（本体とクライアントの写しが持つ） */
export interface KaijuPoseInput {
  readonly feet: Readonly<Vec3>;
  /** 向き（ラジアン。0 で前方 -Z、Three.js の rotation.y と同じ向き） */
  readonly heading: number;
  /** 攻撃中の種類（null は攻撃していない） */
  readonly attack: KaijuAttack | null;
  readonly attackStep: AttackStep;
  /** 今の段階に入ってからの時間と、段階の長さ */
  readonly attackTime: number;
  readonly attackDuration: number;
  /** ダウンの残り秒数（0 は立っている） */
  readonly downTimer: number;
}

/** 体の動き（0〜1 の量。bodyDrop だけ m） */
export interface KaijuPose {
  /** 胴が沈む量（ダウン） */
  bodyDrop: number;
  /** 頭を上げる（咆哮の吸気・熱線の構え） */
  headLift: number;
  /** 尾を上げる（薙ぎ払いの予兆） */
  tailLift: number;
  /** 背中の結晶の明るさ（熱線の前に明るくなる。0.15 が常時） */
  crystalGlow: number;
  /** 腕を振り上げる（投擲） */
  armLift: number;
}

export function createPose(): KaijuPose {
  return { bodyDrop: 0, headLift: 0, tailLift: 0, crystalGlow: 0.15, armLift: 0 };
}

/** 段階の進み具合（0〜1） */
function progress(s: KaijuPoseInput): number {
  return s.attackDuration > 0 ? clamp(s.attackTime / s.attackDuration, 0, 1) : 1;
}

/** 攻撃・ダウンから体の動きを決める */
export function derivePose(s: KaijuPoseInput, out: KaijuPose): KaijuPose {
  const d = KAIJU_CONFIG.down;
  // ダウンは最初の 1 秒で沈み、最後の 1.5 秒で起き上がる
  const downIn = clamp((d.seconds - s.downTimer) / 1, 0, 1);
  const downOut = clamp(s.downTimer / 1.5, 0, 1);
  out.bodyDrop = s.downTimer > 0 ? d.bodyDrop * Math.min(downIn, downOut) : 0;
  out.headLift = 0;
  out.tailLift = 0;
  out.armLift = 0;
  out.crystalGlow = 0.15;
  const k = progress(s);
  const rise = smoothstep(0, 1, k);
  const fall = 1 - smoothstep(0, 1, k);
  const level = s.attackStep === 'windup' ? rise : s.attackStep === 'active' ? 1 : fall;
  switch (s.attack) {
    case 'sweep':
      out.tailLift = level;
      break;
    case 'roar':
      out.headLift = level;
      break;
    case 'beam':
      out.headLift = 0.45 * level;
      out.crystalGlow =
        s.attackStep === 'windup'
          ? 0.15 + 0.85 * rise
          : s.attackStep === 'active'
            ? 1
            : 0.15 + 0.85 * fall;
      break;
    case 'throw':
      out.armLift = s.attackStep === 'active' ? 1 - k : level;
      break;
    default:
      break;
  }
  return out;
}

/** 部位の当たり判定の中心（ワールド座標）を out に入れる */
export function partCenter(
  out: Vec3,
  id: KaijuPartId,
  feet: Readonly<Vec3>,
  heading: number,
  pose: Readonly<KaijuPose>,
): Vec3 {
  const c = KAIJU_CONFIG.parts[id].center;
  const x = c.x;
  let y = c.y;
  let z = c.z;
  switch (id) {
    case 'head':
      y += 24 * pose.headLift - pose.bodyDrop;
      z += 10 * pose.headLift;
      break;
    case 'crystal':
      y -= pose.bodyDrop;
      break;
    case 'tail':
      y += 40 * pose.tailLift - pose.bodyDrop * 0.5;
      z -= 12 * pose.tailLift;
      break;
    default:
      // 脚: ダウンでは膝をつく
      y -= pose.bodyDrop * 0.45;
      break;
  }
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  out.x = feet.x + x * cos + z * sin;
  out.y = feet.y + y;
  out.z = feet.z - x * sin + z * cos;
  return out;
}

/** 口（熱線の始点）のワールド座標 */
export function mouthPosition(
  out: Vec3,
  feet: Readonly<Vec3>,
  heading: number,
  pose: Readonly<KaijuPose>,
): Vec3 {
  partCenter(out, 'head', feet, heading, pose);
  out.x += -Math.sin(heading) * 18;
  out.z += -Math.cos(heading) * 18;
  out.y -= 4;
  return out;
}

/** heading の前方（水平の単位ベクトル） */
export function forwardOf(out: Vec3, heading: number): Vec3 {
  out.x = -Math.sin(heading);
  out.y = 0;
  out.z = -Math.cos(heading);
  return out;
}

/** (dx, dz) の向きの heading */
export function headingToward(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** 角度の差を -π〜π に */
export function wrapAngle(a: number): number {
  let v = a % (Math.PI * 2);
  if (v > Math.PI) v -= Math.PI * 2;
  if (v < -Math.PI) v += Math.PI * 2;
  return v;
}
