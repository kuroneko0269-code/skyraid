// ミッションランナーとゲームの世界（飛行セッション）の間の取り決め（Three.js 非依存）。
// ランナーは毎ステップこれを読む（ポーリング）だけで、機体・戦闘の中身を知らない。テストでは偽物を渡す
import type { Vec3 } from '../flight/math';
import type { EscortState } from './mission-props';
import type { DestroyableKind, SpawnDef } from './types';

export interface MissionWorld {
  /** 自機の位置と、前ステップの位置（リングの通過判定に使う） */
  readonly playerPosition: Readonly<Vec3>;
  readonly playerPrevPosition: Readonly<Vec3>;
  /** 自機の速度（m/s。4-11 の速度到達） */
  readonly playerSpeed: number;
  /** 自機が飛んでいるか（撃墜されてリスポーン待ちなら false） */
  readonly playerActive: boolean;
  /** 自機が撃墜された回数（地面への墜落も） */
  readonly playerDowns: number;
  /** 自機が受けたダメージの合計（評価に使う） */
  readonly playerDamageTaken: number;
  readonly playerMaxHp: number;
  /** 出現物を出す */
  spawn(def: SpawnDef): void;
  /** 撃墜・破壊された数（kind の種類、group を指定すればその出現物だけ）。数えはじめはミッション開始 */
  destroyedCount(kind: DestroyableKind, group?: string): number;
  /** 護衛対象（輸送機）のどれかを失ったか */
  readonly escortLost: boolean;
  /** group の護衛対象（出ていなければ null） */
  escort(group: string): EscortState | null;
  /** 怪獣に与えたダメージの割合（0〜1。出ていなければ 0） */
  readonly kaijuDamageRatio: number;
}
