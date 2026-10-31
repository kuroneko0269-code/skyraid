// 防衛戦（7-2。協力）のホストの世界で、敵から見たプレイヤーの代理（defense-host.ts から分けた）。
// 位置・速度・当たり判定は PvpArena の機体のもの、当たったダメージは PvpArena に入れる（撃墜の判定も PvpArena）。Three.js 非依存
import type { PvpArena } from '../combat/pvp-arena';
import type { PvpFighter } from '../combat/pvp-fighter';
import { TEAM_PLAYER, type CombatTarget } from '../combat/target';
import { vec3, type Vec3 } from '../flight/math';

export const FAR: Readonly<Vec3> = { x: 0, y: -100000, z: 0 };

/** 敵から見たプレイヤー（PvpArena の機体の代理。当たったダメージは PvpArena に入れる） */
export class FighterProxy implements CombatTarget {
  readonly team = TEAM_PLAYER;
  readonly prevPosition: Vec3 = vec3();
  fighter: PvpFighter | null = null;

  constructor(
    readonly id: number,
    private readonly arena: PvpArena,
  ) {}

  get position(): Readonly<Vec3> {
    return this.fighter?.position ?? FAR;
  }

  get velocity(): Readonly<Vec3> {
    return this.fighter?.velocity ?? FAR;
  }

  get hitRadius(): number {
    return this.fighter?.hitRadius ?? 0;
  }

  get visualRadius(): number {
    return this.fighter?.visualRadius ?? 0;
  }

  get active(): boolean {
    return this.fighter?.active ?? false;
  }

  get hp(): number {
    return this.fighter?.hp ?? 0;
  }

  get maxHp(): number {
    return this.fighter?.maxHp ?? 1;
  }

  get isDestroyed(): boolean {
    return !(this.fighter?.alive ?? false);
  }

  applyDamage(amount: number): boolean {
    return this.arena.enemyDamage(this.id, amount);
  }
}
