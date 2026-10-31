// 防衛戦（7-2）の進行（Three.js 非依存）: 準備（20 秒・スキップ可）→ 波（敵を出す）→ 全滅（撃墜・離脱・着弾）で次の準備 … 10 波で完全クリア。
// 司令部の HP が 0 で失敗。ソロは FlightSession の部品、協力はホストの世界（src/net/defense-host.ts）で同じものを動かす。
// 敵: 戦闘機（既存の編隊 AI）・爆撃機（直進して爆弾）・巡航ミサイル（司令部へ直進）。3 方向のどれかから来る。
// 基地: 味方の対空砲が敵を撃つ。爆弾は施設と自機に範囲ダメージ、巡航ミサイルは司令部に 300。
// 補給: 準備の間に基地の上を低く遅く通ると、その人に 1 回（supply のイベント。弾を足すのは呼び出し側）
import type { EnemySquadron } from '../../ai/enemy-squadron';
import type { CombatSystem } from '../../combat/combat-system';
import type { GroundHeightFn, Rng } from '../../combat/gun';
import { TEAM_BASE, TEAM_ENEMY, type CombatTarget } from '../../combat/target';
import { EventBus } from '../../core/event-bus';
import {
  CRUISE_CONFIG,
  DEFENSE_CONFIG,
  ENEMY_BOMB_BLAST,
  type DefenseApproach,
  type DefenseDifficulty,
  type DefenseMapDef,
} from '../../data/defense';
import { AAA_CONFIG, FUEL_TANK_BLAST } from '../../data/ground-targets';
import type { EnemyAircraft } from '../../entities/enemy-aircraft';
import type { MissionProps } from '../mission-props';
import { DefenseBase } from './base';
import { canResupply, supplyFraction } from './supply';
import { DefenseSpawner } from './spawner';
import { buildWave, countWave, forecastText, type WaveCounts, type WaveSpawn } from './waves';

export type DefensePhase = 'intermission' | 'wave' | 'cleared' | 'failed';

/** ランナーが動かす世界の部品（ソロは FlightSession、協力はホストの世界） */
export interface DefenseWorld {
  readonly props: MissionProps;
  readonly squadron: EnemySquadron;
  readonly combat: CombatSystem;
  readonly enemies: readonly EnemyAircraft[];
  readonly groundHeight: GroundHeightFn;
}

/** 守る人（補給の判定） */
export interface Defender {
  readonly id: number;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly speed: number;
  readonly active: boolean;
}

export interface DefenseOptions {
  readonly map: DefenseMapDef;
  readonly difficulty: DefenseDifficulty;
  readonly players: number;
  readonly rng?: Rng;
  /** 戦闘機が最も近い味方（協力の各プレイヤー）を狙う。ソロは false（自機を狙う） */
  readonly preferAllies?: boolean;
}

export interface DefenseEvents extends Record<string, unknown> {
  /** 波が始まった（wave は 1 から） */
  'defense:wave': { wave: number };
  /** 波を全滅させた */
  'defense:waveClear': { wave: number };
  /** 次の波の準備が始まった（予告） */
  'defense:intermission': { wave: number };
  /** 敵が出た（index は種類ごとの入れ物の番号。協力のホストが event で配る） */
  'defense:spawn': { kind: 'fighter' | 'bomber' | 'cruise'; index: number };
  /** 巡航ミサイルが司令部に着いた */
  'defense:cruiseImpact': { index: number };
  /** 爆撃機が離脱した・戦闘機が撤退した */
  'defense:escape': { kind: 'fighter' | 'bomber'; index: number };
  /** 司令部が被弾した */
  'defense:hqHit': { amount: number };
  /** 施設が壊れた（FACILITY_KINDS の添字） */
  'defense:facilityLost': { index: number };
  /** 補給した（fraction は満タンに対する割合。1 は満タン） */
  'defense:supply': { id: number; fraction: number };
  'defense:end': { outcome: 'cleared' | 'failed' };
}

export class DefenseRunner {
  readonly bus = new EventBus<DefenseEvents>();
  readonly base: DefenseBase;
  phase: DefensePhase = 'intermission';
  /** 今の波（準備中は次の波）。1〜10 */
  wave = 1;
  /** クリアした波の数 */
  wavesCleared = 0;
  /** 準備の残り秒数 */
  intermissionLeft: number = DEFENSE_CONFIG.intermissionSeconds;
  /** 次の波（今の波）の来る方向と数（予告） */
  approach: DefenseApproach;
  counts: WaveCounts = { fighter: 0, bomber: 0, cruise: 0 };
  /** 波の始まりからの秒数と、飛行の始めからの秒数 */
  waveTime = 0;
  elapsed = 0;
  private spawns: WaveSpawn[] = [];
  private queue: WaveSpawn[] = [];
  /** 戦闘機（編隊の添字）が出た波（0 はこの防衛戦で出していない） */
  private readonly fighterWave: number[];
  /** 戦闘機が出た時刻（elapsed） */
  private readonly fighterBorn: number[];
  /** この準備の間に補給した人 */
  private readonly supplied = new Set<number>();
  /** 味方の対空砲が撃つ相手（戦闘機・爆撃機・巡航ミサイル） */
  readonly enemyTargets: readonly CombatTarget[];
  private readonly rng: Rng;
  private readonly spawner: DefenseSpawner;

  constructor(
    private readonly world: DefenseWorld,
    readonly options: DefenseOptions,
  ) {
    const props = world.props;
    this.base = new DefenseBase(props.baseTargets);
    this.rng = options.rng ?? Math.random;
    this.fighterWave = world.enemies.map(() => 0);
    this.fighterBorn = world.enemies.map(() => 0);
    this.enemyTargets = [...world.enemies, ...props.bombers, ...props.cruiseMissiles];
    this.approach = options.map.approaches[0] ?? { label: '東', bearingDeg: 90 };
    this.spawner = new DefenseSpawner(
      world,
      options.map,
      this.base,
      this.rng,
      options.preferAllies ?? false,
    );
    props.onEnemyBomb = (x, y, z) => {
      this.bombImpact(x, y, z);
    };
    props.onFriendlyAaaHit = (hit, target) => {
      const t = this.enemyTargets.find((e) => e === target);
      if (!t) return;
      world.combat.reportImpact(hit.x, hit.y, hit.z, true);
      world.combat.dealDamage(t, AAA_CONFIG.damage, TEAM_BASE);
    };
  }

  get map(): DefenseMapDef {
    return this.options.map;
  }

  get finished(): boolean {
    return this.phase === 'cleared' || this.phase === 'failed';
  }

  /** 基地を立てて、最初の波の準備から始める */
  start(): void {
    this.base.deploy(this.options.map, this.options.difficulty);
    this.wave = 1;
    this.wavesCleared = 0;
    this.elapsed = 0;
    this.fighterWave.fill(0);
    this.beginIntermission();
  }

  /** 次の波の予告の文（レーダーが壊れていれば null） */
  get forecast(): string | null {
    if (!this.base.alive('radar') || this.finished) return null;
    return forecastText(this.approach.label, this.counts);
  }

  /** 準備をスキップする（ソロのボタン・協力は全員がそろったとき） */
  skip(): void {
    if (this.phase === 'intermission') this.intermissionLeft = 0;
  }

  /** 今の波の残りの敵（まだ出ていない分を含む）。準備中は次の波の数 */
  get remaining(): number {
    if (this.phase === 'intermission') return this.spawns.length;
    if (this.phase !== 'wave') return 0;
    let n = this.queue.length;
    this.world.enemies.forEach((e, i) => {
      if (e.active && this.fighterWave[i] === this.wave) n++;
    });
    for (const b of this.world.props.bombers) if (b.active) n++;
    for (const c of this.world.props.cruiseMissiles) if (c.active) n++;
    return n;
  }

  /** 固定ステップ 1 回分（世界の後）。defenders は補給の判定に使う */
  step(dt: number, defenders: readonly Defender[]): void {
    const props = this.world.props;
    this.stepFlyers(dt);
    props.enemyBombs.step(dt);
    const aaa = props.friendlyAaa;
    aaa.stepFriendly(props.baseTargets, this.enemyTargets, dt);
    if (this.finished) return;
    this.elapsed += dt;
    if (!this.base.hq.active) {
      this.end('failed');
      return;
    }
    if (this.phase === 'intermission') {
      this.checkSupply(defenders);
      this.intermissionLeft = Math.max(0, this.intermissionLeft - dt);
      if (this.intermissionLeft <= 0) this.beginWave();
      return;
    }
    this.waveTime += dt;
    this.retreatFighters(defenders);
    this.spawnDue();
    if (this.queue.length === 0 && this.remaining === 0) this.clearWave();
  }

  private beginIntermission(): void {
    this.phase = 'intermission';
    this.intermissionLeft = DEFENSE_CONFIG.intermissionSeconds;
    this.supplied.clear();
    const list = this.options.map.approaches;
    this.approach = list[Math.floor(this.rng() * list.length) % list.length] ?? this.approach;
    this.spawns = buildWave(this.wave, this.options.players, this.options.difficulty);
    this.counts = countWave(this.spawns);
    this.bus.emit('defense:intermission', { wave: this.wave });
  }

  private beginWave(): void {
    this.phase = 'wave';
    this.waveTime = 0;
    this.queue = [...this.spawns];
    this.spawner.reset();
    this.bus.emit('defense:wave', { wave: this.wave });
    this.spawnDue();
  }

  private clearWave(): void {
    this.wavesCleared = this.wave;
    this.bus.emit('defense:waveClear', { wave: this.wave });
    if (this.wave >= DEFENSE_CONFIG.waves) {
      this.end('cleared');
      return;
    }
    this.wave++;
    this.beginIntermission();
  }

  private end(outcome: 'cleared' | 'failed'): void {
    this.phase = outcome;
    this.bus.emit('defense:end', { outcome });
  }

  /** 出す時刻になった敵を出す（戦闘機の空きがなければ待つ。巡航ミサイルは組ごとに間隔を空ける） */
  private spawnDue(): void {
    for (let i = 0; i < this.queue.length; ) {
      const s = this.queue[i];
      if (!s || s.delay > this.waveTime) break;
      const index = this.spawner.spawn(s, this.approach, this.wave, this.waveTime);
      if (index < 0) {
        i++;
        continue;
      }
      this.queue.splice(i, 1);
      if (s.kind === 'fighter') {
        this.fighterWave[index] = this.wave;
        this.fighterBorn[index] = this.elapsed;
      }
      this.bus.emit('defense:spawn', { kind: s.kind, index });
    }
  }

  /** 爆撃機・巡航ミサイルを進める（投下・離脱・着弾） */
  private stepFlyers(dt: number): void {
    const props = this.world.props;
    props.bombers.forEach((b, i) => {
      if (!b.deployed) return;
      b.step(dt);
      if (!b.active) {
        b.withdraw();
        return;
      }
      for (let n = b.takeDrops(); n > 0; n--) props.enemyBombs.drop(b.position, b.velocity);
      if (b.arrived) {
        b.withdraw();
        this.bus.emit('defense:escape', { kind: 'bomber', index: i });
      }
    });
    props.cruiseMissiles.forEach((m, i) => {
      if (!m.deployed) return;
      m.step(dt);
      if (!m.active) {
        m.withdraw();
        return;
      }
      if (!m.arrived) return;
      m.withdraw();
      this.bus.emit('defense:cruiseImpact', { index: i });
      const p = m.position;
      this.world.combat.reportExplosion(p.x, p.y, p.z, true, ENEMY_BOMB_BLAST.radius);
      this.hit(0, CRUISE_CONFIG.damage);
    });
  }

  private readonly lost = (index: number): void => {
    this.bus.emit('defense:facilityLost', { index });
  };

  private readonly fuel = (x: number, y: number, z: number): void => {
    this.world.combat.applyBlast(x, y, z, FUEL_TANK_BLAST, TEAM_BASE, null);
  };

  /** 施設にダメージ（司令部なら被弾のイベント） */
  private hit(index: number, amount: number): void {
    const before = this.base.hq.hp;
    this.base.damage(index, amount, this.lost, this.fuel);
    const d = before - this.base.hq.hp;
    if (d > 0) this.bus.emit('defense:hqHit', { amount: d });
  }

  /** 爆撃機の爆弾の着弾: 施設に範囲ダメージ、自機（協力は各プレイヤー）にも */
  private bombImpact(x: number, y: number, z: number): void {
    const before = this.base.hq.hp;
    this.base.applyBlast(x, y, z, ENEMY_BOMB_BLAST, this.lost, this.fuel);
    const d = before - this.base.hq.hp;
    if (d > 0) this.bus.emit('defense:hqHit', { amount: d });
    this.world.combat.applyBlast(x, y, z, ENEMY_BOMB_BLAST, TEAM_ENEMY, TEAM_ENEMY);
  }

  /** 出てから時間のたった戦闘機を、味方から離れていれば撤退させる（消す） */
  private retreatFighters(defenders: readonly Defender[]): void {
    const c = DEFENSE_CONFIG;
    this.world.enemies.forEach((e, i) => {
      const age = this.elapsed - (this.fighterBorn[i] ?? 0);
      if (!e.active || age < c.fighterRetreatSeconds) return;
      const p = e.position;
      for (const d of defenders) {
        if (age >= c.fighterRetreatHardSeconds) break;
        if (!d.active) continue;
        const q = d.position;
        if (Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) < c.fighterRetreatClearance) return;
      }
      e.withdraw();
      this.bus.emit('defense:escape', { kind: 'fighter', index: i });
    });
  }

  private checkSupply(defenders: readonly Defender[]): void {
    for (const d of defenders) {
      if (!d.active || this.supplied.has(d.id)) continue;
      const p = d.position;
      const agl = p.y - Math.max(0, this.world.groundHeight(p.x, p.z));
      if (!canResupply(p, agl, d.speed, this.options.map.center)) continue;
      this.supplied.add(d.id);
      this.bus.emit('defense:supply', { id: d.id, fraction: supplyFraction(this.base.alive('fuel')) });
    }
  }

  /** この準備の間に補給したか */
  hasSupplied(id: number): boolean {
    return this.supplied.has(id);
  }
}
