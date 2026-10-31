// PvP の他プレイヤーの表示上の機体（5-3。pvp-mirror.ts から分けた）。Three.js 非依存
import { Gun, type Shooter } from '../combat/gun';
import { TEAM_ENEMY, type CombatTarget } from '../combat/target';
import { GUN_CONFIG } from '../data/weapons';
import { quatIdentity, vec3, type Quat, type Vec3 } from '../flight/math';
import { netLoadout } from './loadout';

/** 他プレイヤーの表示上の機体（索敵・レーダー・命中の火花と音の位置）。ダメージは受けない（判定はホスト） */
export class RivalProxy implements CombatTarget, Shooter {
  readonly position: Vec3 = vec3();
  readonly prevPosition: Vec3 = vec3();
  readonly velocity: Vec3 = vec3();
  readonly orientation: Quat = quatIdentity();
  readonly team = TEAM_ENEMY;
  readonly hitRadius: number;
  readonly visualRadius: number;
  speed = 0;
  active = false;
  hp: number;
  invulnerable = false;
  /** 機銃の引き金（発射の event） */
  firing = false;
  /** 見た目だけの機銃の弾（当たり判定なし） */
  readonly gun = new Gun<CombatTarget>(GUN_CONFIG);

  constructor(
    readonly id: number,
    readonly aircraftId: string,
    readonly maxHp: number,
  ) {
    const hull = netLoadout(aircraftId, undefined).flight.hull;
    this.hitRadius = hull.hitRadius;
    this.visualRadius = hull.visualRadius;
    this.hp = maxHp;
  }

  get isDestroyed(): boolean {
    return !this.active;
  }

  applyDamage(): boolean {
    return false;
  }
}
