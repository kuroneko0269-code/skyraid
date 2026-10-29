// フリーフライトの戦闘（2-1 / 2-2）: 機銃・ロックオン・ミサイル・フレア・的・ドローン・撃墜数を
// 固定ステップで進める（Three.js 非依存）
import { HUD_CONFIG } from '../data/hud';
import { GUN_CONFIG, MISSILE_CONFIG, type GunSpec } from '../data/weapons';
import { TargetField } from '../entities/target-balloon';
import { createDrones, type TargetDrone } from '../entities/target-drone';
import { vec3 } from '../flight/math';
import { FlareField } from './flare';
import { Gun, type GroundHeightFn, type GunHit, type Rng, type Shooter } from './gun';
import { leadPoint } from './lead';
import { Magazine } from './magazine';
import { MissileSystem, splashDamage, type Detonation } from './missile';
import type { CombatTarget } from './target';
import { Targeting } from './targeting';

export type ImpactListener = (x: number, y: number, z: number, onTarget: boolean) => void;
export type DestroyedListener = (target: CombatTarget) => void;
/** ミサイルの起爆。onTarget は信管が対象に反応したか（false なら地面） */
export type ExplosionListener = (x: number, y: number, z: number, onTarget: boolean) => void;

/** 1 ステップ分の戦闘の操作。missile / flare / targetNext は押した瞬間だけ true */
export interface CombatInput {
  trigger: boolean;
  missile: boolean;
  flare: boolean;
  targetNext: boolean;
}

/** プレイヤーの陣営（フレア・ミサイルの owner） */
const PLAYER = 0;

export class CombatSystem {
  readonly gun: Gun<CombatTarget>;
  readonly drones: TargetDrone[];
  /** 撃てる対象すべて（的 + ドローン）。順番は固定 */
  readonly allTargets: readonly CombatTarget[];
  readonly targeting = new Targeting<CombatTarget>();
  readonly missileAmmo = new Magazine(MISSILE_CONFIG.ammo, MISSILE_CONFIG.fireInterval);
  readonly missiles: MissileSystem<CombatTarget>;
  readonly flares = new FlareField();
  /** 選択中の対象の予測照準点（機銃の射程内のときだけ leadValid） */
  readonly lead = vec3();
  leadValid = false;
  /** 撃墜数 */
  kills = 0;
  /** ヒットマーカーの残り表示時間（秒） */
  hitMarkerTimer = 0;
  private readonly impactListeners: ImpactListener[] = [];
  private readonly destroyedListeners: DestroyedListener[] = [];
  private readonly explosionListeners: ExplosionListener[] = [];

  constructor(
    readonly targets: TargetField,
    groundHeight: GroundHeightFn | null = null,
    rng: Rng = Math.random,
    spec: GunSpec = GUN_CONFIG,
    private readonly hitMarkerSeconds: number = HUD_CONFIG.hitMarkerSeconds,
    drones: TargetDrone[] = createDrones(),
  ) {
    this.gun = new Gun<CombatTarget>(spec, this.handleHit, groundHeight, rng);
    this.missiles = new MissileSystem<CombatTarget>(
      MISSILE_CONFIG,
      this.handleDetonation,
      groundHeight,
      rng,
    );
    this.drones = drones;
    this.allTargets = [...targets.balloons, ...drones];
  }

  /** 命中（的・地面）ごとに呼ばれる。火花の演出用 */
  onImpact(fn: ImpactListener): void {
    this.impactListeners.push(fn);
  }

  /** 対象が撃墜されたときに呼ばれる。破片の演出用 */
  onDestroyed(fn: DestroyedListener): void {
    this.destroyedListeners.push(fn);
  }

  /** ミサイルが起爆したときに呼ばれる。閃光の演出用 */
  onExplosion(fn: ExplosionListener): void {
    this.explosionListeners.push(fn);
  }

  step(input: Readonly<CombatInput>, shooter: Shooter, dt: number): void {
    this.hitMarkerTimer = Math.max(0, this.hitMarkerTimer - dt);
    this.targets.step(dt);
    for (const d of this.drones) d.step(dt);
    this.targeting.step(shooter, this.allTargets, input.targetNext, dt);

    this.missileAmmo.step(dt);
    if (input.missile && this.missileAmmo.tryUse()) {
      // ロック完了なら誘導、未完了なら無誘導で直進
      const t = this.targeting.locked ? this.targeting.selected : null;
      this.missiles.launch(shooter, t, PLAYER);
    }
    if (input.flare) this.flares.tryRelease(shooter, PLAYER);
    this.flares.step(dt);
    this.missiles.step(this.allTargets, this.flares.flares, dt);
    this.gun.step(input.trigger, shooter, this.allTargets, dt);
    this.updateLead(shooter);
  }

  reset(): void {
    this.kills = 0;
    this.hitMarkerTimer = 0;
    this.gun.reset();
    this.targets.reset();
    for (const d of this.drones) d.reset();
    this.targeting.reset();
    this.missileAmmo.refill();
    this.missiles.reset();
    this.flares.reset();
    this.leadValid = false;
  }

  private updateLead(shooter: Shooter): void {
    const t = this.targeting.selected;
    if (!t) {
      this.leadValid = false;
      return;
    }
    const spec = this.gun.spec;
    const speed = shooter.speed + spec.muzzleSpeed;
    const time = leadPoint(
      this.lead,
      shooter.position,
      speed,
      t.position,
      t.velocity,
      spec.gravity,
      spec.range / speed,
    );
    this.leadValid = time >= 0;
  }

  private damage(target: CombatTarget, amount: number): void {
    if (target.applyDamage(amount)) {
      this.kills++;
      for (const fn of this.destroyedListeners) fn(target);
    }
  }

  private readonly handleHit = (hit: Readonly<GunHit<CombatTarget>>): void => {
    const target = hit.target;
    for (const fn of this.impactListeners) fn(hit.x, hit.y, hit.z, target !== null);
    if (!target) return;
    this.hitMarkerTimer = this.hitMarkerSeconds;
    this.damage(target, this.gun.spec.damage);
  };

  /** 範囲ダメージ: 爆心から各対象の表面までの距離で減衰 */
  private readonly handleDetonation = (d: Readonly<Detonation<CombatTarget>>): void => {
    for (const fn of this.explosionListeners) fn(d.x, d.y, d.z, d.target !== null);
    const spec = this.missiles.spec;
    for (const t of this.allTargets) {
      if (!t.active) continue;
      const p = t.position;
      const dist = Math.hypot(p.x - d.x, p.y - d.y, p.z - d.z) - t.hitRadius;
      const amount = splashDamage(spec, dist);
      if (amount <= 0) continue;
      this.hitMarkerTimer = this.hitMarkerSeconds;
      this.damage(t, amount);
    }
  };
}
