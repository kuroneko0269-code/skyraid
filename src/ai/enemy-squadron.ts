// 敵機の編隊（2-3、Three.js 非依存）: 敵機ごとに AI・機銃・ロック・ミサイルとフレアの残数を持ち、
// 固定ステップで「知覚 → AI → 飛行（プレイヤーと共通の物理）→ 武装」を進める。
// ミサイルとフレアは CombatSystem のものを共有する（プレイヤーのフレアが敵のミサイルに効く）
import type { CombatSystem } from '../combat/combat-system';
import { Gun, type Bullet, type GunHit } from '../combat/gun';
import { Magazine } from '../combat/magazine';
import type { Pool } from '../combat/pool';
import { TEAM_ENEMY, type CombatTarget } from '../combat/target';
import { Targeting } from '../combat/targeting';
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
import type { AircraftControls, GroundHeightFn } from '../entities/aircraft';
import { EnemyAircraft } from '../entities/enemy-aircraft';
import { vec3, type Vec3 } from '../flight/math';
import { createCommand, type AiCommand, type AiSelf, type AiSenses, type Rng } from './ai-types';
import { EnemyFighterAI } from './enemy-fighter';

export type SquadronConfig = EnemyForceConfig;

/** 1 機分の AI・武装と、毎ステップ書き換える知覚・出力 */
interface Unit {
  readonly enemy: EnemyAircraft;
  readonly ai: EnemyFighterAI;
  readonly gun: Gun<CombatTarget>;
  readonly targeting: Targeting<CombatTarget>;
  missiles: Magazine;
  flares: Magazine;
  readonly command: AiCommand;
  readonly controls: AircraftControls;
  readonly self: MutableSelf;
  readonly senses: MutableSenses;
  readonly threat: Vec3;
}

type MutableSelf = { -readonly [K in keyof AiSelf]: AiSelf[K] };
type MutableSenses = { -readonly [K in keyof AiSenses]: AiSenses[K] };

export class EnemySquadron {
  /** 敵機（maxCount 機。出撃するのは先頭から count 機） */
  readonly enemies: EnemyAircraft[];
  /** 敵の機銃の弾（描画用。機体ごとのプール） */
  readonly bulletPools: readonly Pool<Bullet>[];
  private readonly units: Unit[];
  private enabledFlag = true;
  private countValue: number;
  private difficultyValue: Difficulty;
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
    this.playerTargets = combat.player ? [combat.player] : [];
    const preset = DIFFICULTY_PRESETS[this.difficultyValue];
    this.units = this.enemies.map((enemy, i) => {
      const patrol: readonly PatrolPoint[] = config.patrols[i % config.patrols.length] ?? [];
      const self: MutableSelf = {
        position: enemy.aircraft.state.position,
        orientation: enemy.aircraft.state.orientation,
        angularRate: enemy.aircraft.state.angularRate,
        speed: 0,
        afterburnerGauge: 1,
        hpRatio: 1,
        agl: 0,
        verticalSpeed: 0,
      };
      return {
        enemy,
        ai: new EnemyFighterAI(enemy.spec, preset, patrol, rng),
        gun: new Gun<CombatTarget>(
          ENEMY_GUN_CONFIG,
          (hit) => {
            this.onBulletHit(hit);
          },
          groundHeight,
          rng,
        ),
        targeting: new Targeting<CombatTarget>(),
        missiles: new Magazine(preset.missileAmmo, 0),
        flares: new Magazine(preset.flareCharges, combat.flares.spec.cooldownSeconds),
        command: createCommand(),
        controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, afterburner: false, throttleTarget: 0 },
        self,
        senses: {
          self,
          target: combat.player,
          threat: null,
          damageTaken: 0,
          locked: false,
          missileReady: false,
          flareReady: false,
        },
        threat: vec3(),
      };
    });
    this.bulletPools = this.units.map((u) => u.gun.bullets);
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
    this.combat.missiles.removeOwnedBy(TEAM_ENEMY);
    this.combat.flares.removeOwnedBy(TEAM_ENEMY);
    this.reset();
  }

  /** 全機を出し直す（無効なら全機引っ込める）。弾も消す */
  reset(): void {
    const preset = DIFFICULTY_PRESETS[this.difficultyValue];
    this.units.forEach((u, i) => {
      u.gun.reset();
      u.targeting.reset();
      u.ai.difficulty = preset;
      u.missiles = new Magazine(preset.missileAmmo, 0);
      u.flares = new Magazine(preset.flareCharges, this.combat.flares.spec.cooldownSeconds);
      if (this.enabledFlag && i < this.countValue)
        this.spawn(u, this.config.spawns[i % this.config.spawns.length]);
      else u.enemy.withdraw();
    });
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
    const player = this.combat.player;
    u.targeting.step(state, this.playerTargets, false, dt);
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
    senses.target = player && player.active ? player : null;
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
    u.ai.reset();
    u.targeting.reset();
    const preset = DIFFICULTY_PRESETS[this.difficultyValue];
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
