// 敵機 AI のシミュレーション用の小道具: 島から離れた海の上で、プレイヤー役のボットと敵機を戦わせる。
// ボットは敵と同じ AI（EnemyFighterAI）に「人間の腕前」の数値を渡して、プレイヤー機を操縦させる
import { EnemyFighterAI, createCommand, type AiSelf, type AiSenses } from '../src/ai/enemy-fighter';
import type { CombatInput } from '../src/combat/combat-system';
import type { CombatTarget } from '../src/combat/target';
import { createRandom } from '../src/core/random';
import {
  DIFFICULTY_PRESETS,
  type DifficultySpec,
  type Difficulty,
  type EnemyForceConfig,
} from '../src/data/ai';
import { STARTER_AIRCRAFT } from '../src/data/aircraft';
import { GUN_CONFIG } from '../src/data/weapons';
import type { AircraftControls } from '../src/entities/aircraft';
import type { EnemyAircraft } from '../src/entities/enemy-aircraft';
import type { Vec3 } from '../src/flight/math';
import { FlightSession } from '../src/missions/flight-session';

export const SIM_DT = 1 / 60;
/** 島（半径 約 3km）・的・ドローン（島の中心から 5km 以内）から十分離れた沖合 */
const ARENA_X = 30000;

export function arenaForce(count: number, distance = 4000): EnemyForceConfig {
  const spawns = Array.from({ length: count }, (_, i) => ({
    x: ARENA_X + (i - (count - 1) / 2) * 600,
    y: 1500,
    z: -distance,
    headingDeg: 180,
  }));
  return {
    count,
    maxCount: count,
    defaultDifficulty: 'normal',
    respawnSeconds: 12,
    spawns,
    patrols: [
      [
        { x: ARENA_X - 2000, y: 1500, z: -2000 },
        { x: ARENA_X + 2000, y: 1500, z: -2000 },
      ],
    ],
  };
}

/**
 * プレイヤー役の腕前（AI の難易度と同じ形）。初心者は反応が遅く、狙いが粗く、引き切れず、
 * ミサイルに気づいても半分しか避けない。熟練者は初期機の性能（約 33G）を使い切る
 */
export const BEGINNER: DifficultySpec = {
  ...DIFFICULTY_PRESETS.easy,
  reactionSeconds: 0.7,
  aimErrorDeg: 1.6,
  gunConeDeg: 4,
  missileChance: 0.5,
  missileIntervalSeconds: 3,
  missileAmmo: 4,
  maxG: 18,
  evadeMissileChance: 0.5,
  evadeHitChance: 0.3,
  flareChance: 0.5,
  flareCharges: 6,
};

/** 平均的なプレイヤー（フリーフライトで数分練習した人） */
export const AVERAGE: DifficultySpec = {
  ...DIFFICULTY_PRESETS.normal,
  reactionSeconds: 0.4,
  aimErrorDeg: 1.0,
  leadAccelWeight: 0.5,
  missileChance: 0.6,
  missileIntervalSeconds: 3,
  missileAmmo: 4,
  maxG: 26,
  evadeMissileChance: 0.7,
  evadeHitChance: 0.5,
  flareChance: 0.6,
  flareCharges: 6,
};

export const VETERAN: DifficultySpec = {
  ...DIFFICULTY_PRESETS.hard,
  reactionSeconds: 0.25,
  aimErrorDeg: 0.6,
  missileChance: 0.8,
  missileIntervalSeconds: 2,
  missileAmmo: 4,
  maxG: 33,
  flareCharges: 6,
};

export interface SimResult {
  playerDowns: number;
  kills: number;
  firstDownAt: number;
  firstKillAt: number;
}

/** 敵 count 機（difficulty）とボットを seconds 秒戦わせる。撃墜されてもリスポーンして続ける */
export function simulate(
  seed: number,
  difficulty: Difficulty,
  count: number,
  seconds: number,
  skill: DifficultySpec,
  distance = 4000,
): SimResult {
  const ff = new FlightSession({
    rng: createRandom(seed),
    start: { x: ARENA_X, y: 1500, z: 0 },
    enemies: arenaForce(count, distance),
  });
  ff.configureEnemies(true, difficulty, count);
  ff.reset();
  const bot = new PilotBot(ff, skill, createRandom(seed + 1000));
  const steps = Math.round(seconds / SIM_DT);
  let firstDownAt = -1;
  let firstKillAt = -1;
  for (let i = 0; i < steps; i++) {
    bot.think(SIM_DT);
    ff.step(bot.controls, bot.input, SIM_DT);
    if (ff.player.downCount > 0 && firstDownAt < 0) firstDownAt = i * SIM_DT;
    if (ff.combat.kills > 0 && firstKillAt < 0) firstKillAt = i * SIM_DT;
  }
  return { playerDowns: ff.player.downCount, kills: ff.combat.kills, firstDownAt, firstKillAt };
}

/** プレイヤー機を AI で操縦する。目標は最も近い敵機（pick を渡せばその結果。ミッションの地上目標・怪獣など） */
export class PilotBot {
  readonly controls: AircraftControls = {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttle: 0,
    afterburner: false,
    throttleTarget: 1,
  };
  readonly input: CombatInput = {
    trigger: false,
    missile: false,
    flare: false,
    targetNext: false,
    rocket: false,
    bomb: false,
    bombHeld: false,
  };
  private readonly ai: EnemyFighterAI;
  private readonly command = createCommand();
  private readonly self: { -readonly [K in keyof AiSelf]: AiSelf[K] };
  private readonly senses: { -readonly [K in keyof AiSenses]: AiSenses[K] };
  private readonly threat: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly ff: FlightSession,
    skill: DifficultySpec,
    rng: () => number,
    private readonly pick: () => CombatTarget | null = () => this.nearestEnemy(),
    /** 地表の高さ（地面の回避に使う）。省略は海面 0（島から離れた海の上のシミュレーション） */
    private readonly groundHeight: (x: number, z: number) => number = () => 0,
  ) {
    this.ai = new EnemyFighterAI(STARTER_AIRCRAFT, skill, [], rng, undefined, GUN_CONFIG);
    const s = ff.aircraft.state;
    this.self = {
      position: s.position,
      orientation: s.orientation,
      angularRate: s.angularRate,
      speed: 0,
      afterburnerGauge: 1,
      hpRatio: 1,
      agl: 0,
      verticalSpeed: 0,
    };
    this.senses = {
      self: this.self,
      target: null,
      threat: null,
      damageTaken: 0,
      locked: false,
      missileReady: false,
      flareReady: false,
    };
  }

  private lastHp = 0;

  think(dt: number): void {
    const ff = this.ff;
    const s = ff.aircraft.state;
    const self = this.self;
    self.speed = s.speed;
    self.afterburnerGauge = s.afterburnerGauge;
    self.hpRatio = ff.player.hp / ff.player.maxHp;
    self.agl = s.position.y - Math.max(0, this.groundHeight(s.position.x, s.position.z));
    self.verticalSpeed = ff.player.velocity.y;
    const target = this.pick();
    // 選択中の対象を最も近い敵にそろえる（ロックはプレイヤーのロックの仕組みそのもの）
    if (target && ff.combat.targeting.selected !== target) ff.combat.targeting.select(target);
    this.senses.target = target;
    this.senses.threat = this.findThreat();
    this.senses.damageTaken = Math.max(0, this.lastHp - ff.player.hp);
    this.lastHp = ff.player.hp;
    this.senses.locked = ff.combat.targeting.locked;
    this.senses.missileReady = ff.combat.missileAmmo.ready;
    this.senses.flareReady = ff.combat.flares.magazine.ready;
    const c = this.command;
    this.ai.step(this.senses, dt, c);
    this.controls.pitch = c.pitch;
    this.controls.roll = c.roll;
    this.controls.yaw = c.yaw;
    this.controls.afterburner = c.afterburner;
    this.controls.throttleTarget = c.throttle;
    this.input.trigger = c.trigger;
    this.input.missile = c.missile;
    this.input.flare = c.flare;
    if (!ff.player.active) this.ai.reset();
  }

  private findThreat(): Vec3 | null {
    const pool = this.ff.combat.missiles.missiles;
    for (let i = 0; i < pool.count; i++) {
      const m = pool.get(i);
      if (m.target === this.ff.player) {
        this.threat.x = m.position.x;
        this.threat.y = m.position.y;
        this.threat.z = m.position.z;
        return this.threat;
      }
    }
    return null;
  }

  nearestEnemy(): EnemyAircraft | null {
    const p = this.ff.aircraft.state.position;
    let best: EnemyAircraft | null = null;
    let bestD = Infinity;
    for (const e of this.ff.enemies) {
      if (!e.active) continue;
      const d = Math.hypot(e.position.x - p.x, e.position.y - p.y, e.position.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }
}
