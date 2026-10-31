// 怪獣の部位（6-1。Three.js 非依存）: 頭・背中の結晶・左脚・右脚・尾。1 つずつが撃てる・ロックできる対象（CombatTarget）で、
// 機銃・ミサイル・ロケット・爆弾の当たり判定と、ロック・Tab の切替（機首に近い順）は既存の仕組みがそのまま部位単位で動く。
// ダメージは本体（kaiju.ts）に渡し、部位 HP と全体 HP をまとめて減らす
import { TEAM_ENEMY, type CombatTarget } from '../combat/target';
import { KAIJU_CONFIG, type KaijuPartId } from '../data/kaiju';
import { vec3, type Vec3 } from '../flight/math';

/** 部位のダメージの受け口（本体） */
export interface KaijuPartOwner {
  readonly targetable: boolean;
  readonly isDestroyed: boolean;
  readonly velocity: Readonly<Vec3>;
  /** attacker はプレイヤー ID（シングルプレイは 0）。この被弾で倒れたら true */
  damagePart(part: KaijuPart, amount: number, attacker: number): boolean;
}

export class KaijuPart implements CombatTarget {
  readonly position: Vec3 = vec3();
  readonly prevPosition: Vec3 = vec3();
  readonly hitRadius: number;
  readonly visualRadius: number;
  readonly team = TEAM_ENEMY;
  readonly label: string;
  readonly maxHpShare: number;
  /** 範囲ダメージは体の部位のうち最も近い 1 つだけ（combat/target.ts の nearestPerGroup） */
  readonly blastGroup: object;
  /** 部位 HP（復活しない） */
  partHp = 1;
  partMaxHp = 1;
  /** ブレイク中の残り秒数と、次にブレイクできるまでの秒数 */
  breakTimer = 0;
  breakCooldown = 0;
  /** 攻撃した人ごとの最後に当てた時刻（ブレイクの判定） */
  readonly lastHitBy = new Map<number, number>();

  constructor(
    readonly id: KaijuPartId,
    readonly index: number,
    private readonly owner: KaijuPartOwner,
  ) {
    const spec = KAIJU_CONFIG.parts[id];
    this.hitRadius = spec.radius;
    this.visualRadius = spec.radius;
    this.label = spec.label;
    this.maxHpShare = spec.hpShare;
    this.blastGroup = owner;
  }

  /** 部位の番号（協力の入力の targetId。6-2） */
  get kaijuIndex(): number {
    return this.index;
  }

  get velocity(): Readonly<Vec3> {
    return this.owner.velocity;
  }

  get active(): boolean {
    return this.owner.targetable;
  }

  get broken(): boolean {
    return this.partHp <= 0;
  }

  /** 部位 HP（HUD・ロックの表示） */
  get hp(): number {
    return this.partHp;
  }

  get maxHp(): number {
    return this.partMaxHp;
  }

  get isDestroyed(): boolean {
    return this.owner.isDestroyed;
  }

  /** シングルプレイの武器（攻撃した人は 0） */
  applyDamage(amount: number): boolean {
    return this.owner.damagePart(this, amount, 0);
  }

  /** 協力（ホスト）: 攻撃した人の ID 付き */
  damageBy(amount: number, attacker: number): boolean {
    return this.owner.damagePart(this, amount, attacker);
  }

  reset(maxHp: number): void {
    this.partMaxHp = Math.max(1, Math.round(maxHp));
    this.partHp = this.partMaxHp;
    this.breakTimer = 0;
    this.breakCooldown = 0;
    this.lastHitBy.clear();
  }
}
