// ネフィルガの AI が見る世界の形と攻撃の秒数（9-6d で kaiju2-ai.ts から分けた）。Three.js 非依存
import { KAIJU2_CONFIG as C, type Kaiju2Attack } from '../data/kaiju2';
import type { Vec3 } from '../flight/math';

const A = C.attacks;

/** 怪獣が見る世界（プレイヤー 1 機・フレア・当たったときの知らせ先） */
export interface Kaiju2Target {
  readonly position: Readonly<Vec3>;
  /** 速度（m/s。急降下・雷球の見越し） */
  readonly velocity: Readonly<Vec3>;
  readonly active: boolean;
  /** 9-6d: 機首の向き（単位。あれば狙われているかを決める: ソロ。協力はホストが body.aimed を決める） */
  readonly forward?: Readonly<Vec3>;
}

export interface Kaiju2Hooks {
  /** プレイヤーに当たった（数値は仮。stun は操作できない秒数） */
  hit(attack: Kaiju2Attack, damage: number, stun: number): void;
}

/** 攻撃の秒数（予兆 / 攻撃 / 硬直）。windupScale は難易度の予兆の倍率（9-6b。高難度で短い） */
export function attackTimes(
  a: Kaiju2Attack,
  windupScale = 1,
): { windup: number; active: number; recover: number } {
  const s = A[a];
  return { windup: s.windup * windupScale, active: s.active, recover: s.recover };
}
