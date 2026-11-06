// プレイヤーが落とした対象と武器の知らせ（9-10b: 勲章の武器別・種類別の撃墜の数え。Three.js 非依存）。
// 武器は判定に効かないので、リプレイの状態のハッシュ・キーフレームに入れない（transientKeys。リスナーも入らない）
import type { CombatTarget } from './target';

/** プレイヤーの武器 */
export type PlayerWeapon = 'gun' | 'missile' | 'rocket' | 'bomb';
/** プレイヤーが敵側を落としたとき（weapon は落とした武器。誘爆はもとの武器） */
export type PlayerKillListener = (target: CombatTarget, weapon: PlayerWeapon) => void;

export class PlayerKillFeed {
  static readonly transientKeys: readonly string[] = ['weapon'];
  /** 今入れているダメージの元の武器（CombatSystem が機銃・ミサイル・ロケット・爆弾の当たりの始めに入れる） */
  weapon: PlayerWeapon = 'gun';
  private readonly listeners: PlayerKillListener[] = [];

  on(fn: PlayerKillListener): void {
    this.listeners.push(fn);
  }

  emit(target: CombatTarget): void {
    for (const fn of this.listeners) fn(target, this.weapon);
  }
}
