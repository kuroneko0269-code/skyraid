// フリーフライトの戦闘（2-1 / 2-2 / 2-3）: 機銃・ロックオン・ミサイル・フレア・的・ドローン・撃墜数を
// 固定ステップで進める（Three.js 非依存）。ミサイルとフレアは敵機と共有し、陣営（team）で信管・ダメージを分ける。
// 無誘導ロケット・爆弾（2-6）はプレイヤーだけが持つ。壊れると範囲ダメージを出す対象（燃料タンク）の誘爆もここ
import type { BlastSpec } from '../data/ground-targets';
import { HUD_CONFIG } from '../data/hud';
import { BOMB_CONFIG, ROCKET_CONFIG } from '../data/ordnance';
import { GUN_CONFIG, MISSILE_CONFIG, MISSILE_POOL_SIZE, type GunSpec } from '../data/weapons';
import { TargetField } from '../entities/target-balloon';
import type { Loadout } from '../progression/loadout';
import { createDrones, type TargetDrone } from '../entities/target-drone';
import { vec3 } from '../flight/math';
import { blastDamage } from './blast';
import { BombBay } from './bomb';
import { FlareField } from './flare';
import { Gun, type GroundHeightFn, type GunHit, type Rng, type Shooter } from './gun';
import { leadPoint } from './lead';
import { Magazine } from './magazine';
import { MissileSystem, splashDamage, type Detonation } from './missile';
import type { Impact } from './projectile';
import { RocketPod } from './rocket';
import { TEAM_PLAYER, nearestPerGroup, teamOf, type CombatTarget } from './target';
import { Targeting } from './targeting';
import type { CombatInput } from './combat-input';

// 入力の型は combat-input.ts（300 行の目安で分けた）。既存の import 先を変えないよう再エクスポートする
export { createCombatInput, type CombatInput } from './combat-input';

export type ImpactListener = (x: number, y: number, z: number, onTarget: boolean) => void;
export type DestroyedListener = (target: CombatTarget) => void;
/** ミサイルの起爆。onTarget は信管が対象に反応したか（false なら地面）。radius は範囲ダメージの半径（爆発の規模。4-4） */
export type ExplosionListener = (
  x: number,
  y: number,
  z: number,
  onTarget: boolean,
  radius: number,
) => void;

/** プレイヤーの弾が当たる相手（プレイヤー側でない） */
const playerHostile = (t: CombatTarget): boolean => teamOf(t) !== TEAM_PLAYER;

export class CombatSystem {
  readonly gun: Gun<CombatTarget>;
  readonly drones: TargetDrone[];
  /** プレイヤーが撃てる対象すべて（的 + ドローン + 敵機 + 怪獣・地上目標（2-5））。順番は固定 */
  readonly allTargets: readonly CombatTarget[];
  /** プレイヤー機以外の味方（輸送機。2-5）。敵の機銃・ミサイルの対象で、プレイヤーの弾は当たらない */
  readonly allies: readonly CombatTarget[];
  /** ミサイルの信管が反応しうるものすべて（allTargets + プレイヤー機 + 味方） */
  readonly fuseTargets: readonly CombatTarget[];
  readonly targeting = new Targeting<CombatTarget>();
  readonly missileAmmo = new Magazine(MISSILE_CONFIG.ammo, MISSILE_CONFIG.fireInterval);
  readonly missiles: MissileSystem<CombatTarget>;
  readonly flares: FlareField;
  readonly rockets: RocketPod;
  readonly bombs: BombBay;
  /** 選択中の対象の予測照準点（機銃の射程内のときだけ leadValid） */
  readonly lead = vec3();
  leadValid = false;
  /** プレイヤーの機銃 1 発のダメージ（3-3 から武装の強化で変わる。弾道は gun.spec のまま） */
  gunDamage: number;
  /** 撃墜数 */
  kills = 0;
  /** ヒットマーカーの残り表示時間（秒） */
  hitMarkerTimer = 0;
  private readonly impactListeners: ImpactListener[] = [];
  private readonly destroyedListeners: DestroyedListener[] = [];
  private readonly explosionListeners: ExplosionListener[] = [];
  private readonly ordnanceListeners: ((
    x: number,
    y: number,
    z: number,
    radius: number,
  ) => void)[] = [];
  /**
   * 爆弾・ロケットの着弾の高さ（6-4。街では立っている建物の屋根・壁でも起爆する）。null なら地表（groundHeight）。
   * 着弾の予測点も同じ関数
   */
  ordnanceGround: GroundHeightFn | null = null;

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
    /** 敵側のその他の対象（怪獣・地上目標。2-5）。出ていないときは active が false */
    hostiles: readonly CombatTarget[] = [],
    /** プレイヤー機以外の味方（輸送機。2-5） */
    allies: readonly CombatTarget[] = [],
  ) {
    this.gun = new Gun<CombatTarget>(spec, this.handleHit, groundHeight, rng);
    this.gunDamage = spec.damage;
    this.missiles = new MissileSystem<CombatTarget>(
      MISSILE_CONFIG,
      this.handleDetonation,
      groundHeight,
      rng,
      undefined,
      MISSILE_POOL_SIZE,
    );
    this.flares = new FlareField(undefined, 1 + enemies.length);
    const ground = groundHeight;
    const ordnance: GroundHeightFn | null = ground
      ? (x, z) => (this.ordnanceGround ?? ground)(x, z)
      : null;
    this.rockets = new RocketPod(this.handleRocketImpact, ordnance, rng);
    this.bombs = new BombBay(this.handleBombImpact, ordnance);
    this.drones = drones;
    this.allTargets = [...targets.balloons, ...drones, ...enemies, ...hostiles];
    this.allies = allies;
    this.fuseTargets = [...this.allTargets, ...(player ? [player] : []), ...allies];
  }

  /** 命中（的・地面）ごとに呼ばれる。火花の演出用 */
  onImpact(fn: ImpactListener): void {
    this.impactListeners.push(fn);
  }

  /** 対象が撃墜されたときに呼ばれる。破片の演出用 */
  onDestroyed(fn: DestroyedListener): void {
    this.destroyedListeners.push(fn);
  }

  /** 爆弾・ロケットが着弾したとき（6-4。建物を壊す）。radius は爆風の半径 */
  onOrdnance(fn: (x: number, y: number, z: number, radius: number) => void): void {
    this.ordnanceListeners.push(fn);
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
    if (input.rocket) this.rockets.tryFire(shooter);
    if (input.bomb || (input.bombHeld && this.bombs.predictionValid)) this.bombs.tryDrop(shooter);
    this.flares.step(dt);
    this.missiles.step(this.fuseTargets, this.flares.flares, dt);
    this.gun.step(input.trigger, shooter, this.allTargets, dt);
    this.rockets.step(this.allTargets, playerHostile, dt);
    this.bombs.step(shooter, this.allTargets, playerHostile, dt);
    this.updateLead(shooter);
  }

  /** ミサイルの起爆の演出を呼ぶ（PvP の表示。5-3。判定はホスト） */
  reportExplosion(x: number, y: number, z: number, onTarget: boolean, radius: number): void {
    for (const fn of this.explosionListeners) fn(x, y, z, onTarget, radius);
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
    this.rockets.reset();
    this.bombs.reset();
    this.leadValid = false;
  }

  /**
   * 機体と強化の装備に合わせる（3-3）: 機銃のダメージ、ミサイル・ロケット・爆弾・フレアの数（満タンにする）、
   * 索敵・ロック。飛行を始める前に呼ぶ
   */
  applyLoadout(l: Readonly<Loadout>): void {
    this.gunDamage = l.gunDamage;
    this.missileAmmo.setCapacity(l.missiles);
    this.rockets.setCapacity(l.rockets);
    this.bombs.magazine.setCapacity(l.bombs);
    this.flares.magazine.setCapacity(l.flares);
    this.targeting.spec = l.targeting;
    this.targeting.reset();
  }

  /** 補給（リスポーン）: ミサイル・フレア・ロケット・爆弾を満タンにし、機銃の熱とロックを戻す */
  resupply(): void {
    this.missileAmmo.refill();
    this.flares.magazine.refill();
    this.rockets.refill();
    this.bombs.magazine.refill();
    this.gun.heat.reset();
    this.targeting.reset();
  }

  /** 選択中の対象の予測照準点を更新する（step の中で呼ぶ。PvP の表示は索敵の後に呼ぶ。5-3） */
  updateLead(shooter: Shooter): void {
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

  /**
   * ダメージを与える。撃墜したら破片の演出を呼び、プレイヤーが敵側を落としたときだけ撃墜数を数える。
   * 壊れると範囲ダメージを出す対象（燃料タンク）は、その場で誘爆させる（陣営によらず自機にも入る）
   */
  dealDamage(target: CombatTarget, amount: number, attackerTeam: number): void {
    if (!target.applyDamage(amount)) return;
    if (attackerTeam === TEAM_PLAYER && teamOf(target) !== TEAM_PLAYER) this.kills++;
    this.notifyDestroyed(target);
    const blast = target.deathBlast;
    if (blast) {
      const p = target.position;
      this.applyBlast(p.x, p.y, p.z, blast, attackerTeam, null);
    }
  }

  /**
   * 範囲ダメージ（ロケット・爆弾・誘爆。2-6）: 爆心から各対象の表面までの距離で blastDamage。
   * spareTeam の陣営には入らない（null ならすべてに入る）。起爆の演出（閃光・火花）も呼ぶ
   */
  applyBlast(
    x: number,
    y: number,
    z: number,
    spec: BlastSpec,
    attackerTeam: number,
    spareTeam: number | null,
    onTarget = true,
  ): void {
    for (const fn of this.explosionListeners) fn(x, y, z, onTarget, spec.radius);
    for (const t of this.inBlast(x, y, z, spec.radius, spareTeam)) {
      const p = t.position;
      const dist = Math.hypot(p.x - x, p.y - y, p.z - z) - t.hitRadius;
      const amount = blastDamage(spec, dist);
      if (amount <= 0) continue;
      if (attackerTeam === TEAM_PLAYER && teamOf(t) !== TEAM_PLAYER)
        this.hitMarkerTimer = this.hitMarkerSeconds;
      this.dealDamage(t, amount, attackerTeam);
    }
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

  /** 爆心から半径 radius 以内（表面まで）の対象。spareTeam の陣営は除き、怪獣の部位は最も近い 1 つだけ（6-1） */
  private inBlast(
    x: number,
    y: number,
    z: number,
    radius: number,
    spareTeam: number | null,
  ): CombatTarget[] {
    const list: CombatTarget[] = [];
    const dist: number[] = [];
    for (const t of this.fuseTargets) {
      if (!t.active || (spareTeam !== null && teamOf(t) === spareTeam)) continue;
      const p = t.position;
      const d = Math.hypot(p.x - x, p.y - y, p.z - z) - t.hitRadius;
      if (d >= radius) continue;
      list.push(t);
      dist.push(d);
    }
    // 誘爆（dealDamage の中の applyBlast）で入れ物が書き換わらないよう、結果は新しい配列にする
    return nearestPerGroup(list, dist, []);
  }

  private readonly handleHit = (hit: Readonly<GunHit<CombatTarget>>): void => {
    const target = hit.target;
    this.reportImpact(hit.x, hit.y, hit.z, target !== null);
    if (!target) return;
    this.hitMarkerTimer = this.hitMarkerSeconds;
    this.dealDamage(target, this.gunDamage, TEAM_PLAYER);
  };

  private readonly handleRocketImpact = (i: Readonly<Impact>): void => {
    for (const fn of this.ordnanceListeners) fn(i.x, i.y, i.z, ROCKET_CONFIG.blast.radius);
    this.applyBlast(
      i.x,
      i.y,
      i.z,
      ROCKET_CONFIG.blast,
      TEAM_PLAYER,
      TEAM_PLAYER,
      i.target !== null,
    );
  };

  private readonly handleBombImpact = (i: Readonly<Impact>): void => {
    for (const fn of this.ordnanceListeners) fn(i.x, i.y, i.z, BOMB_CONFIG.blast.radius);
    this.applyBlast(i.x, i.y, i.z, BOMB_CONFIG.blast, TEAM_PLAYER, TEAM_PLAYER, i.target !== null);
  };

  /** 範囲ダメージ: 爆心から各対象の表面までの距離で減衰。撃った陣営には入らない */
  private readonly handleDetonation = (d: Readonly<Detonation<CombatTarget>>): void => {
    const spec = this.missiles.spec;
    for (const fn of this.explosionListeners)
      fn(d.x, d.y, d.z, d.target !== null, spec.blastRadius);
    for (const t of this.inBlast(d.x, d.y, d.z, spec.blastRadius, d.owner)) {
      const p = t.position;
      const dist = Math.hypot(p.x - d.x, p.y - d.y, p.z - d.z) - t.hitRadius;
      const amount = splashDamage(spec, dist);
      if (amount <= 0) continue;
      if (d.owner === TEAM_PLAYER) this.hitMarkerTimer = this.hitMarkerSeconds;
      this.dealDamage(t, amount, d.owner);
    }
  };
}
