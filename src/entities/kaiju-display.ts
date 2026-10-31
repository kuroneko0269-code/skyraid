// 怪獣の表示に要るもの（6-1。Three.js 非依存）: 描画・HUD・音が読む口。シングルプレイ・ホストは本体（kaiju.ts）と AI、
// 協力のクライアントはホストの状態の写し（net/kaiju-mirror.ts）がこの形を満たす
import type { KaijuAttack } from '../data/kaiju';
import type { Vec3 } from '../flight/math';
import type { KaijuPose, KaijuPoseInput } from './kaiju-pose';

export interface KaijuPartView {
  readonly label: string;
  readonly broken: boolean;
  readonly hp: number;
  readonly maxHp: number;
  /** ブレイク中の残り秒数 */
  readonly breakTimer: number;
}

export interface KaijuBodyView extends KaijuPoseInput {
  readonly prevFeet: Readonly<Vec3>;
  readonly prevHeading: number;
  readonly walkPhase: number;
  readonly velocity: Readonly<Vec3>;
  readonly visible: boolean;
  readonly flashTimer: number;
  readonly pose: Readonly<KaijuPose>;
  readonly parts: readonly KaijuPartView[];
  readonly hp: number;
  readonly maxHp: number;
  readonly phase: number;
  /** 最終フェーズの残り秒数（null は始まっていない） */
  readonly finalRemaining: number | null;
  readonly attack: KaijuAttack | null;
}

/** 熱線と岩（描画） */
export interface KaijuEffectsView {
  readonly beam: {
    readonly on: boolean;
    readonly origin: Readonly<Vec3>;
    readonly direction: Readonly<Vec3>;
    readonly length: number;
  };
  readonly rocks: readonly {
    readonly position: Readonly<Vec3>;
    readonly prevPosition: Readonly<Vec3>;
    readonly active: boolean;
  }[];
}
