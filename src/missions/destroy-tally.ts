// 撃墜・破壊の数え上げ（2-4 で FlightSession に置いていたものを 2-5 で分けた。Three.js 非依存）。
// 種類ごと・「種類:グループ」ごと・any（すべて）に数え、撃墜数の目標・破壊の目標が読む
import type { CombatTarget } from '../combat/target';
import { EnemyAircraft } from '../entities/enemy-aircraft';
import { TargetBalloon } from '../entities/target-balloon';
import { TargetDrone } from '../entities/target-drone';
import type { MissionProps } from './mission-props';
import type { DestroyableKind } from './types';

export class DestroyTally {
  private readonly counts = new Map<string, number>();
  /** ミッションの敵機の出現物（enemies[i] がどのグループか） */
  private readonly enemyGroups: (string | null)[];

  constructor(
    private readonly enemies: readonly EnemyAircraft[],
    private readonly props: MissionProps,
  ) {
    this.enemyGroups = enemies.map(() => null);
  }

  /** 数えた数を 0 に戻す（フリーフライト・ミッションの開始） */
  clear(): void {
    this.counts.clear();
  }

  /** 敵機のグループを忘れる（ミッションの開始） */
  clearGroups(): void {
    this.enemyGroups.fill(null);
  }

  setEnemyGroup(index: number, group: string): void {
    this.enemyGroups[index] = group;
  }

  get(kind: DestroyableKind, group?: string): number {
    return this.counts.get(group === undefined ? kind : `${kind}:${group}`) ?? 0;
  }

  /** 撃墜・破壊（敵機の地面への衝突も）を 1 つ数える。数えないもの（プレイヤー機・輸送機など）は無視 */
  readonly count = (target: CombatTarget): void => {
    let kind: DestroyableKind;
    let group: string | null = null;
    if (target instanceof EnemyAircraft) {
      kind = 'enemyFighter';
      group = this.enemyGroups[this.enemies.indexOf(target)] ?? null;
    } else if (target instanceof TargetBalloon) kind = 'target';
    else if (target instanceof TargetDrone) kind = 'drone';
    else {
      const g = this.props.groundTargetGroup(target);
      if (g === undefined) return;
      kind = 'groundTarget';
      group = g;
    }
    const keys = group === null ? [kind, 'any'] : [kind, 'any', `${kind}:${group}`, `any:${group}`];
    for (const key of keys) this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  };
}
