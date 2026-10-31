// PvP（5-3）のホストが計算する 1 機: 機体・HP・機銃・ミサイルとフレアの残り・位置の履歴（遅延補償）・成績。
// ミサイルの信管と誘導の対象（FuseTarget）。陣営（team）はプレイヤー ID（自分のミサイル・フレアには反応しない）。
// Three.js 非依存
import { FLARE_CONFIG, GUN_CONFIG, MISSILE_CONFIG, type TargetingSpec } from '../data/weapons';
import { PVP_CONFIG } from '../data/pvp';
import type { Aircraft } from '../entities/aircraft';
import { vec3, type Vec3 } from '../flight/math';
import { Health } from './damage';
import { Gun, type GroundHeightFn, type GunHit, type GunTarget, type Rng } from './gun';
import { LagHistory } from './lag-history';
import { Magazine } from './magazine';
import type { FuseTarget } from './missile';
import type { PlayerScore } from './pvp-rules';

/** 機体と強化で決まる数値（resolveLoadout の一部） */
export interface FighterSpec {
  readonly maxHp: number;
  readonly hitRadius: number;
  readonly visualRadius: number;
  readonly gunDamage: number;
  readonly missiles: number;
  readonly flares: number;
  readonly targeting: TargetingSpec;
}

/** 撃つ人から見た対象（遅延補償で巻き戻した位置）。機銃の当たり判定に使う */
export class RewoundTarget implements GunTarget {
  readonly position: Vec3 = vec3();
  constructor(readonly fighter: PvpFighter) {}
  get hitRadius(): number {
    return this.fighter.hitRadius;
  }
  get active(): boolean {
    return this.fighter.active;
  }
}

export class PvpFighter implements FuseTarget, PlayerScore {
  readonly velocity: Vec3 = vec3();
  readonly team: number;
  readonly hitRadius: number;
  readonly visualRadius: number;
  readonly gun: Gun<RewoundTarget>;
  readonly missileAmmo: Magazine;
  readonly flareAmmo: Magazine;
  readonly history: LagHistory;
  /** この人から見た他機（撃つたびに巻き戻した位置を入れる） */
  readonly others: RewoundTarget[] = [];
  /** 撃墜されてから復帰までの残り秒数（生きている間は 0） */
  respawnTimer = 0;
  /** 復帰後の無敵の残り秒数 */
  invulnerableTimer = 0;
  kills = 0;
  deaths = 0;
  /** 機銃の命中数（無敵の相手に当たった分も数える） */
  hits = 0;
  /** 直前のステップで引き金を引いていたか（発射の event を変わったときだけ送る） */
  firing = false;
  /** 今の連続撃墜（撃墜されると 0）と、その最大（5-4） */
  streak = 0;
  bestStreak = 0;
  /** 切断して再接続を待っている（5-4。止まったまま、当たり判定・誘導の対象外、無敵の表示） */
  away = false;
  /** 次の tick の終わりに出現位置へ戻す（再接続した人の位置合わせ。撃墜には数えない。5-4） */
  resync = false;
  /** 今の命が初心者保護つきか（5-4） */
  boosted = false;
  private health: Health;

  constructor(
    readonly id: number,
    readonly aircraft: Aircraft,
    readonly spec: FighterSpec,
    onGunHit: (shooter: PvpFighter, hit: Readonly<GunHit<RewoundTarget>>) => void,
    groundHeight: GroundHeightFn | null,
    rng: Rng,
  ) {
    this.team = id;
    this.hitRadius = spec.hitRadius;
    this.visualRadius = spec.visualRadius;
    this.health = new Health(spec.maxHp);
    const hit = (h: Readonly<GunHit<RewoundTarget>>): void => {
      onGunHit(this, h);
    };
    this.gun = new Gun<RewoundTarget>(GUN_CONFIG, hit, groundHeight, rng);
    this.missileAmmo = new Magazine(spec.missiles, MISSILE_CONFIG.fireInterval);
    this.flareAmmo = new Magazine(spec.flares, FLARE_CONFIG.cooldownSeconds);
    this.history = new LagHistory(Math.round(PVP_CONFIG.historySeconds * 60));
  }

  get position(): Readonly<Vec3> {
    return this.aircraft.state.position;
  }

  get hp(): number {
    return this.health.hp;
  }

  get maxHp(): number {
    return this.health.maxHp;
  }

  get alive(): boolean {
    return !this.health.isDestroyed;
  }

  /** 当たり判定・誘導の対象か（撃墜されている間・再接続待ちの間は false） */
  get active(): boolean {
    return this.alive && !this.away;
  }

  get invulnerable(): boolean {
    return this.invulnerableTimer > 0 || this.away;
  }

  get shots(): number {
    return this.gun.shotCount;
  }

  /** ダメージ（無敵中は 0）。この被弾で撃墜されたら true */
  applyDamage(amount: number): boolean {
    if (this.invulnerable) return false;
    return this.health.applyDamage(amount);
  }

  /** 墜落（地面・海面）: HP 0 */
  crash(): void {
    this.health.applyDamage(this.health.hp);
  }

  /**
   * 復帰: HP・弾・熱を戻し、無敵にする。位置の履歴は忘れる。
   * boost（初心者保護。5-4）なら最大 HP を hpScale 倍、ミサイルを extraMissiles 発増やす（次の復帰で元に戻る）
   */
  revive(invulnerableSeconds: number, boost = false): void {
    const r = PVP_CONFIG.rookie;
    this.boosted = boost;
    const maxHp = Math.round(this.spec.maxHp * (boost ? r.hpScale : 1));
    if (maxHp !== this.health.maxHp) this.health = new Health(maxHp);
    this.health.reset();
    this.respawnTimer = 0;
    this.invulnerableTimer = invulnerableSeconds;
    this.missileAmmo.setCapacity(this.spec.missiles + (boost ? r.extraMissiles : 0));
    this.flareAmmo.refill();
    this.gun.heat.reset();
    this.history.clear();
  }
}
