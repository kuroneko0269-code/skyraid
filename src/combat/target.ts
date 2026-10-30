// 撃てる対象の共通の形（Three.js 非依存）。的（風船）・ドローン・敵機（2-3）・プレイヤー機（2-3）
import type { BlastSpec } from '../data/ground-targets';
import type { Vec3 } from '../flight/math';
import type { Damageable } from './damage';
import type { GunTarget } from './gun';

/** 陣営。ミサイル・フレアの owner、対象の team に使う */
export const TEAM_PLAYER = 0;
export const TEAM_ENEMY = 1;

export interface CombatTarget extends GunTarget, Damageable {
  /** 前ステップの位置（描画の補間用） */
  readonly prevPosition: Readonly<Vec3>;
  /** 速度（m/s）。予測照準点と比例航法に使う */
  readonly velocity: Readonly<Vec3>;
  /** 見た目の大きさ（破片を散らす半径） */
  readonly visualRadius: number;
  /** 陣営。省略は TEAM_ENEMY（練習用の的・ドローンはプレイヤーの敵側） */
  readonly team?: number;
  /** 壊れたときに周囲へ出す範囲ダメージ（燃料タンク。2-6）。省略・null はなし */
  readonly deathBlast?: BlastSpec | null;
}

/** 対象の陣営（省略は敵側） */
export function teamOf(t: { readonly team?: number }): number {
  return t.team ?? TEAM_ENEMY;
}
