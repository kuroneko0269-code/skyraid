// 敵機の編隊（2-3、Three.js 非依存）: 敵機ごとに AI・機銃・ロック・ミサイルとフレアの残数を持ち、
// 固定ステップで「知覚 → AI → 飛行（プレイヤーと共通の物理）→ 武装」を進める。
// ミサイルとフレアは CombatSystem のものを共有する（プレイヤーのフレアが敵のミサイルに効く）
import type { CombatSystem } from '../combat/combat-system';
import type { Bullet, GunHit } from '../combat/gun';
import { Magazine } from '../combat/magazine';
import type { Pool } from '../combat/pool';
import { TEAM_ENEMY, type CombatTarget } from '../combat/target';
import {
  DIFFICULTY_PRESETS,
  FREE_FLIGHT_ENEMIES,
  type Difficulty,
  type EnemyForceConfig,
  type EnemySpawn,
  type PatrolPoint,
} from '../data/ai';
import { ENEMY_FIGHTER } from '../data/aircraft';
import { ENEMY_GUN_CONFIG } from '../data/weapons';
import type { GroundHeightFn } from '../entities/aircraft';
import { EnemyAircraft } from '../entities/enemy-aircraft';
import type { Vec3 } from '../flight/math';
import type { Rng } from './ai-types';
import { chooseTarget, createUnit, type Unit } from './squadron-unit';

export type SquadronConfig = EnemyForceConfig;

export class EnemySquadron {
  /** 敵機（maxCount 機。出撃するのは先頭から count 機） */
  readonly enemies: EnemyAircraft[];
  /** 敵の機銃の弾（描画用。機体ごとのプール） */
  readonly bulletPools: readonly Pool<Bullet>[];
  private readonly units: Unit[];
  /** 撃墜された機体を再出現させるか（フリーフライト true、ミッション false。2-4） */
  respawns = true;
  private enabledFlag = true;
  private countValue: number;
  private difficultyValue: Difficulty;
  /** 敵の機銃が当たるもの（プレイヤー機 + 味方の輸送機） */
  private readonly playerTargets: CombatTarget[];

  /**
   * enemies は CombatSystem に対象として渡したものと同じ配列（createEnemies で作る）。
   * combat.player が敵の狙う相手
   */
  constructor(
    private readonly combat: CombatSystem,
    enemies: EnemyAircraft[],
    private readonly groundHeight: GroundHeightFn = () => 0,
    rng: Rng = Math.random,
    private readonly config: SquadronConfig = FREE_FLIGHT_ENEMIES,
  ) {
    this.countValue = config.count;
    this.difficultyValue = config.defaultDifficulty;
    this.enemies = enemies;
    this.playerTargets = [...(combat.player ? [combat.player] : []), ...combat.allies];
    this.units = this.enemies.map((enemy, i) =>
      createUnit(
        enemy,
        config.patrols[i % config.patrols.length] ?? [],
        this.difficultyValue,
        combat,
        groundHeight,
        rng,
        (hit) => {
          this.onBulletHit(hit);
        },
      ),
    );
    this.bulletPools = this.units.map((u) => u.gun.bullets);
  }

  /** enemies[index] の機銃が撃った弾の数（音の演出。4-4） */
  gunShotCount(index: number): number {
    return this.units[index]?.gun.shotCount ?? 0;
  }

  get enabled(): boolean {
    return this.enabledFlag;
  }

  get count(): number {
    return this.countValue;
  }

  get difficulty(): Difficulty {
    return this.difficultyValue;
  }

  /** 敵の有無・難易度・機数を変えて出し直す（設定の変更・フリーフライト開始） */
  configure(enabled: boolean, difficulty: Difficulty, count = this.countValue): void {
    this.enabledFlag = enabled;
    this.difficultyValue = difficulty;
    this.countValue = Math.max(0, Math.min(count, this.enemies.length));
    // 出し直す前の敵のミサイル・フレアは残さない（OFF にした瞬間に消える）
    this.removeEnemyOrdnance();
    this.reset();
  }

  /** 全機を出し直す（無効なら全機引っ込める）。弾も消す。経路・難易度はフリーフライトの設定に戻す */
  reset(): void {
    this.units.forEach((u, i) => {
      u.gun.reset();
      u.targeting.reset();
      u.difficulty = this.difficultyValue;
      u.preferAllies = false;
      u.ai.setPatrol(this.config.patrols[i % this.config.patrols.length] ?? []);
      if (this.enabledFlag && i < this.countValue)
        this.spawn(u, this.config.spawns[i % this.config.spawns.length]);
      else u.enemy.withdraw();
    });
  }

  /** 全機を引っ込め、敵の弾・ミサイル・フレアも消す（ミッションの開始。2-4） */
  withdrawAll(): void {
    this.removeEnemyOrdnance();
    for (const u of this.units) {
      u.gun.reset();
      u.targeting.reset();
      u.enemy.withdraw();
    }
  }

  /**
   * 空いている機体（出撃していない・撃墜済み）を 1 機、at に出して patrol を巡回させる（ミッションの敵機。2-4）。
   * 出した機体の番号（enemies の添字）。空きがなければ -1
   */
  deploy(
    at: EnemySpawn,
    patrol: readonly PatrolPoint[],
    difficulty: Difficulty,
    /** true: 味方の輸送機を優先して狙う（M3。2-5） */
    preferAllies = false,
  ): number {
    const i = this.units.findIndex((u) => !u.enemy.active);
    const u = this.units[i];
    if (!u) return -1;
    u.gun.reset();
    u.difficulty = difficulty;
    u.preferAllies = preferAllies;
    u.playerAggro = false;
    u.ai.setPatrol(patrol);
    this.spawn(u, at);
    return i;
  }

  private removeEnemyOrdnance(): void {
    this.combat.missiles.removeOwnedBy(TEAM_ENEMY);
    this.combat.flares.removeOwnedBy(TEAM_ENEMY);
  }

  /** 固定ステップ 1 回分。CombatSystem.step より前に呼ぶ（撃ったミサイルは同じステップで動き出す） */
  step(dt: number): void {
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (!u) continue;
      // 弾は撃墜後も飛び続ける
      const e = u.enemy;
      if (!e.deployed) {
        u.gun.step(false, e.aircraft.state, this.playerTargets, dt);
        continue;
      }
      if (e.isDestroyed) {
        u.gun.step(false, e.aircraft.state, this.playerTargets, dt);
        if (!this.respawns) continue;
        e.respawnTimer -= dt;
        if (e.respawnTimer <= 1e-9) this.spawn(u, this.farthestSpawn());
        continue;
      }
      this.stepUnit(u, dt);
    }
  }

  private stepUnit(u: Unit, dt: number): void {
    const e = u.enemy;
    const state = e.aircraft.state;
    // 狙う相手: 輸送機を優先する機体は最も近い輸送機（いなければプレイヤー機）。ロックもその相手だけ
    const target = chooseTarget(u, this.combat.player, this.combat.allies);
    u.lockTargets.length = 0;
    if (target) u.lockTargets.push(target);
    u.targeting.step(state, u.lockTargets, false, dt);
    u.missiles.step(dt);
    u.flares.step(dt);

    const self = u.self;
    const p = state.position;
    self.speed = state.speed;
    self.afterburnerGauge = state.afterburnerGauge;
    self.hpRatio = e.hp / e.maxHp;
    self.agl = p.y - this.groundHeight(p.x, p.z);
    self.verticalSpeed = e.velocity.y;
    const senses = u.senses;
    senses.target = target;
    senses.threat = this.findThreat(e, u.threat);
    senses.damageTaken = e.takeDamage();
    senses.locked = u.targeting.locked;
    senses.missileReady = u.missiles.ready;
    senses.flareReady = u.flares.ready;

    const c = u.command;
    u.ai.step(senses, dt, c);
    const ctl = u.controls;
    ctl.pitch = c.pitch;
    ctl.roll = c.roll;
    ctl.yaw = c.yaw;
    ctl.afterburner = c.afterburner;
    ctl.throttleTarget = c.throttle;
    if (e.step(ctl, dt)) {
      // 地面に衝突: 撃墜扱い（撃墜数には数えない）
      this.combat.notifyDestroyed(e);
      return;
    }

    if (c.missile && senses.target && u.missiles.tryUse())
      this.combat.missiles.launch(state, u.targeting.selected, TEAM_ENEMY);
    if (c.flare && u.flares.tryUse()) this.combat.flares.release(state, TEAM_ENEMY);
    u.gun.step(c.trigger, state, this.playerTargets, dt);
  }

  /** 敵機 e を追っているプレイヤーのミサイルのうち最も近いものの位置。なければ null */
  private findThreat(e: EnemyAircraft, out: Vec3): Vec3 | null {
    const pool = this.combat.missiles.missiles;
    const p = e.position;
    let best = Infinity;
    for (let i = 0; i < pool.count; i++) {
      const m = pool.get(i);
      if (m.target !== e || m.owner === TEAM_ENEMY) continue;
      const d = Math.hypot(m.position.x - p.x, m.position.y - p.y, m.position.z - p.z);
      if (d < best) {
        best = d;
        out.x = m.position.x;
        out.y = m.position.y;
        out.z = m.position.z;
      }
    }
    return best < Infinity ? out : null;
  }

  private spawn(u: Unit, at: EnemySpawn | undefined): void {
    if (!at) return;
    u.enemy.spawn(at);
    const preset = DIFFICULTY_PRESETS[u.difficulty];
    u.ai.difficulty = preset;
    u.ai.reset();
    u.targeting.reset();
    u.missiles = new Magazine(preset.missileAmmo, 0);
    u.flares = new Magazine(preset.flareCharges, this.combat.flares.spec.cooldownSeconds);
  }

  /** 出現候補のうち、プレイヤーから最も遠い地点 */
  private farthestSpawn(): EnemySpawn | undefined {
    const player = this.combat.player;
    let best: EnemySpawn | undefined;
    let bestD = -1;
    for (const s of this.config.spawns) {
      const d = player ? Math.hypot(s.x - player.position.x, s.z - player.position.z) : 0;
      if (d > bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private onBulletHit(hit: Readonly<GunHit<CombatTarget>>): void {
    this.combat.reportImpact(hit.x, hit.y, hit.z, hit.target !== null);
    if (hit.target) this.combat.dealDamage(hit.target, ENEMY_GUN_CONFIG.damage, TEAM_ENEMY);
  }
}

/** 敵機を maxCount 機作る（CombatSystem と EnemySquadron に同じ配列を渡す） */
export function createEnemies(
  groundHeight?: GroundHeightFn,
  config: SquadronConfig = FREE_FLIGHT_ENEMIES,
): EnemyAircraft[] {
  return Array.from(
    { length: config.maxCount },
    () => new EnemyAircraft(ENEMY_FIGHTER, groundHeight, config.respawnSeconds),
  );
}
