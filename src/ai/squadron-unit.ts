// 編隊（enemy-squadron.ts）の 1 機分: AI・機銃・ロック・ミサイルとフレアの残数と、毎ステップ書き換える知覚・出力
import type { CombatSystem } from '../combat/combat-system';
import { Gun, type GunHit } from '../combat/gun';
import { Magazine } from '../combat/magazine';
import type { CombatTarget } from '../combat/target';
import { Targeting } from '../combat/targeting';
import { DIFFICULTY_PRESETS, type Difficulty, type PatrolPoint } from '../data/ai';
import { ENEMY_GUN_CONFIG } from '../data/weapons';
import type { AircraftControls, GroundHeightFn } from '../entities/aircraft';
import type { EnemyAircraft } from '../entities/enemy-aircraft';
import { vec3, type Vec3 } from '../flight/math';
import { createCommand, type AiCommand, type AiSelf, type AiSenses, type Rng } from './ai-types';
import { EnemyFighterAI } from './enemy-fighter';

export type MutableSelf = { -readonly [K in keyof AiSelf]: AiSelf[K] };
export type MutableSenses = { -readonly [K in keyof AiSenses]: AiSenses[K] };

export interface Unit {
  readonly enemy: EnemyAircraft;
  readonly ai: EnemyFighterAI;
  readonly gun: Gun<CombatTarget>;
  readonly targeting: Targeting<CombatTarget>;
  missiles: Magazine;
  flares: Magazine;
  readonly command: AiCommand;
  readonly controls: AircraftControls;
  /** この機体の難易度（フリーフライトは全機共通、ミッションは出現物ごと） */
  difficulty: Difficulty;
  readonly self: MutableSelf;
  readonly senses: MutableSenses;
  readonly threat: Vec3;
}

export function createUnit(
  enemy: EnemyAircraft,
  patrol: readonly PatrolPoint[],
  difficulty: Difficulty,
  combat: CombatSystem,
  groundHeight: GroundHeightFn,
  rng: Rng,
  onBulletHit: (hit: Readonly<GunHit<CombatTarget>>) => void,
): Unit {
  const preset = DIFFICULTY_PRESETS[difficulty];
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
    gun: new Gun<CombatTarget>(ENEMY_GUN_CONFIG, onBulletHit, groundHeight, rng),
    targeting: new Targeting<CombatTarget>(),
    missiles: new Magazine(preset.missileAmmo, 0),
    flares: new Magazine(preset.flareCharges, combat.flares.spec.cooldownSeconds),
    command: createCommand(),
    controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, afterburner: false, throttleTarget: 0 },
    difficulty,
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
}
