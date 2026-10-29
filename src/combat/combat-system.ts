// フリーフライトの戦闘（2-1 / 2-2 / 2-3）: 機銃・ロックオン・ミサイル・フレア・的・ドローン・撃墜数を
// 固定ステップで進める（Three.js 非依存）。ミサイルとフレアは敵機と共有し、陣営（team）で信管・ダメージを分ける
import { HUD_CONFIG } from '../data/hud';
import { GUN_CONFIG, MISSILE_CONFIG, MISSILE_POOL_SIZE, type GunSpec } from '../data/weapons';
import { TargetField } from '../entities/target-balloon';
import { createDrones, type TargetDrone } from '../entities/target-drone';
import { vec3 } from '../flight/math';
import { FlareField } from './flare';
import { Gun, type GroundHeightFn, type GunHit, type Rng, type Shooter } from './gun';
import { leadPoint } from './lead';
import { Magazine } from './magazine';
import { MissileSystem, splashDamage, type Detonation } from './missile';
import { TEAM_PLAYER, teamOf, type CombatTarget } from './target';
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

/** 何も押していない入力（毎ステップ書き換えて使う入れ物） */
export function createCombatInput(): CombatInput {
  return { trigger: false, missile: false, flare: false, targetNext: false };
}

export class CombatSystem {
  readonly gun: Gun<CombatTarget>;
  readonly drones: TargetDrone[];
  /** プレイヤーが撃てる対象すべて（的 + ドローン + 敵機）。順番は固定 */
  readonly allTargets: readonly CombatTarget[];
  /** ミサイルの信管が反応しうるものすべて（allTargets + プレイヤー機） */
  readonly fuseTargets: readonly CombatTarget[];
  readonly targeting = new Targeting<CombatTarget>();
  readonly missileAmmo = new Magazine(MISSILE_CONFIG.ammo, MISSILE_CONFIG.fireInterval);
  readonly missiles: MissileSystem<CombatTarget>;
  readonly flares: FlareField;
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
    /** 敵機（2-3）。出撃していないときは active が false */
    enemies: readonly CombatTarget[] = [],
    /** プレイヤー機（2-3）。敵のミサイル・機銃の対象 */
    readonly player: CombatTarget | null = null,
  ) {
    this.gun = new Gun<CombatTarget>(spec, this.handleHit, groundHeight, rng);
    this.missiles = new MissileSystem<CombatTarget>(
      MISSILE_CONFIG,
      this.handleDetonation,
      groundHeight,
      rng,
      undefined,
      MISSILE_POOL_SIZE,
    );
    this.flares = new FlareField(undefined, 1 + enemies.length);
    this.drones = drones;
    this.allTargets = [...targets.balloons, ...drones, ...enemies];
    this.fuseTargets = player ? [...this.allTargets, player] : this.allTargets;
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
      this.missiles.launch(shooter, t, TEAM_PLAYER);
    }
    if (input.flare) this.flares.tryRelease(shooter, TEAM_PLAYER);
    this.flares.step(dt);
    this.missiles.step(this.fuseTargets, this.flares.flares, dt);
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

  /** ダメージを与える。撃墜したら破片の演出を呼び、プレイヤーが敵側を落としたときだけ撃墜数を数える */
  dealDamage(target: CombatTarget, amount: number, attackerTeam: number): void {
    if (!target.applyDamage(amount)) return;
    if (attackerTeam === TEAM_PLAYER && teamOf(target) !== TEAM_PLAYER) this.kills++;
    this.notifyDestroyed(target);
  }

  /** 撃墜（地面への衝突も）を演出に知らせる */
  notifyDestroyed(target: CombatTarget): void {
    for (const fn of this.destroyedListeners) fn(target);
  }

  /** 命中（火花）を演出に知らせる。敵の機銃の弾から呼ぶ */
  reportImpact(x: number, y: number, z: number, onTarget: boolean): void {
    for (const fn of this.impactListeners) fn(x, y, z, onTarget);
  }

  /** target を追っている別陣営のミサイルの数（警告用） */
  incomingMissiles(target: CombatTarget): number {
    const pool = this.missiles.missiles;
    const team = teamOf(target);
    let n = 0;
    for (let i = 0; i < pool.count; i++) {
      const m = pool.get(i);
      if (m.target === target && m.owner !== team) n++;
    }
    return n;
  }

  private readonly handleHit = (hit: Readonly<GunHit<CombatTarget>>): void => {
    const target = hit.target;
    this.reportImpact(hit.x, hit.y, hit.z, target !== null);
    if (!target) return;
    this.hitMarkerTimer = this.hitMarkerSeconds;
    this.dealDamage(target, this.gun.spec.damage, TEAM_PLAYER);
  };

  /** 範囲ダメージ: 爆心から各対象の表面までの距離で減衰。撃った陣営には入らない */
  private readonly handleDetonation = (d: Readonly<Detonation<CombatTarget>>): void => {
    for (const fn of this.explosionListeners) fn(d.x, d.y, d.z, d.target !== null);
    const spec = this.missiles.spec;
    for (const t of this.fuseTargets) {
      if (!t.active || teamOf(t) === d.owner) continue;
      const p = t.position;
      const dist = Math.hypot(p.x - d.x, p.y - d.y, p.z - d.z) - t.hitRadius;
      const amount = splashDamage(spec, dist);
      if (amount <= 0) continue;
      if (d.owner === TEAM_PLAYER) this.hitMarkerTimer = this.hitMarkerSeconds;
      this.dealDamage(t, amount, d.owner);
    }
  };
}
