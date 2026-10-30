// ミッションランナーとゲームの世界（飛行セッション）の間の取り決め（Three.js 非依存）。
// ランナーは毎ステップこれを読む（ポーリング）だけで、機体・戦闘の中身を知らない。テストでは偽物を渡す
import type { Vec3 } from '../flight/math';
import type { DestroyableKind, SpawnDef } from './types';

export interface MissionWorld {
  /** 自機の位置と、前ステップの位置（リングの通過判定に使う） */
  readonly playerPosition: Readonly<Vec3>;
  readonly playerPrevPosition: Readonly<Vec3>;
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
  /** 護衛対象を失ったか（2-5 で実装。今は常に false） */
  readonly escortLost: boolean;
}
