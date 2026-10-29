// 撃てる対象の共通の形（Three.js 非依存）。的（風船）・ドローン、2-3 以降は敵機もこれを満たす
import type { Vec3 } from '../flight/math';
import type { Damageable } from './damage';
import type { GunTarget } from './gun';

export interface CombatTarget extends GunTarget, Damageable {
  /** 前ステップの位置（描画の補間用） */
  readonly prevPosition: Readonly<Vec3>;
  /** 速度（m/s）。予測照準点と比例航法に使う */
  readonly velocity: Readonly<Vec3>;
  /** 見た目の大きさ（破片を散らす半径） */
  readonly visualRadius: number;
}
