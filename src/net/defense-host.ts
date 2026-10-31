// 防衛戦（7-2）の協力のホスト側: 敵（戦闘機・爆撃機・巡航ミサイル）と基地の判定をホストだけの世界で動かす（ソロと同じ DefenseRunner）。
// 世界は MissionProps・敵機の編隊・敵のミサイルとフレアの CombatSystem。プレイヤーは PvpArena の機体で、敵からは代理（FighterProxy）
// を狙う（戦闘機は最も近いプレイヤーへ）。プレイヤーの機銃・ミサイルは PvpArena の対象に敵を入れて当てる（撃墜は撃った人に数える）。
// state に基地・波・戦闘機（半分ずつ）を入れ、爆撃機・巡航ミサイルは出現（dspawn）と消滅（dkill）の event で配る。Three.js 非依存
import { EnemySquadron, createEnemies } from '../ai/enemy-squadron';
import { CombatSystem, createCombatInput } from '../combat/combat-system';
import type { Rng } from '../combat/gun';
import type { PvpArena } from '../combat/pvp-arena';
import { TEAM_PLAYER, type CombatTarget } from '../combat/target';
import { FREE_FLIGHT_ENEMIES } from '../data/ai';
import { DEFENSE_CONFIG, findDefenseMap, type DefenseDifficulty } from '../data/defense';
import { MISSILE_CONFIG } from '../data/weapons';
import type { GroundHeightFn } from '../entities/aircraft';
import { TargetField } from '../entities/target-balloon';
import type { Vec3 } from '../flight/math';
import { FighterProxy, FAR } from './defense-proxy';
import { DefenseRunner, type DefensePhase } from '../missions/defense/runner';
import { MissionProps } from '../missions/mission-props';
import { configureDrones } from '../missions/session-spawn';
import {
  DEFENSE_KIND,
  DKILL_ESCAPE,
  DKILL_IMPACT,
  ENEMY_OWNER,
  KILLER_NONE,
  NO_TARGET,
  eventMsg,
  type DefenseFighterMsg,
  type DefenseStateMsg,
  type EventMsg,
  type MissileStateMsg,
} from './protocol';

export const DEFENSE_PHASES: readonly DefensePhase[] = [
  'intermission',
  'wave',
  'cleared',
  'failed',
];

/** 防衛戦の結果（over の event の b） */
export const DEFENSE_OUTCOME = { none: 0, cleared: 1, failed: 2 } as const;

export interface DefenseHostOptions {
  readonly mapId: string;
  readonly hard: boolean;
  readonly players: number;
  readonly groundHeight?: GroundHeightFn;
  readonly rng?: Rng;
  /** 出現・消滅・補給の event を全員へ（tick は呼び出し側が入れる） */
  readonly emit: (e: EventMsg) => void;
}

export class DefenseHost {
  readonly props: MissionProps;
  readonly enemies;
  readonly combat: CombatSystem;
  readonly squadron: EnemySquadron;
  readonly runner: DefenseRunner;
  /** 敵の通し番号（DEFENSE_ID_BASE からの添字。戦闘機・爆撃機・巡航ミサイルの順） */
  readonly targets: readonly CombatTarget[];
  private readonly proxies: FighterProxy[];
  private readonly defenders: { id: number; position: Vec3; speed: number; active: boolean }[] = [];
  /** 今のダメージを与えている人（撃墜を数える） */
  private shooter: number | null = null;
  /** 準備のスキップを押した人 */
  private readonly skips = new Set<number>();
  private readonly supplies = new Set<number>();
  private readonly noInput = createCombatInput();
  private readonly msg: DefenseStateMsg;
  private readonly fighterMsgs: DefenseFighterMsg[];
  private half = 0;
  private readonly emit: (e: EventMsg) => void;

  constructor(
    private readonly arena: PvpArena,
    o: DefenseHostOptions,
  ) {
    const ground = o.groundHeight ?? (() => 0);
    const rng = o.rng ?? Math.random;
    this.emit = o.emit;
    this.props = new MissionProps(ground, rng);
    const force = { ...FREE_FLIGHT_ENEMIES, maxCount: DEFENSE_CONFIG.hostFighterPool };
    this.enemies = createEnemies(ground, force);
    this.proxies = [0, 1, 2, 3].map((id) => new FighterProxy(id, arena));
    const field = new TargetField(ground, rng);
    field.configure(0, false);
    this.combat = new CombatSystem(
      field,
      ground,
      rng,
      undefined,
      undefined,
      [],
      this.enemies,
      null,
      this.props.hostileTargets,
      this.proxies,
    );
    configureDrones(this.combat.drones, 0, false);
    this.squadron = new EnemySquadron(this.combat, this.enemies, ground, rng, force);
    this.squadron.respawns = false;
    this.squadron.withdrawAll();
    const map = findDefenseMap(o.mapId);
    const difficulty: DefenseDifficulty = o.hard ? 'hard' : 'normal';
    this.runner = new DefenseRunner(
      {
        props: this.props,
        squadron: this.squadron,
        combat: this.combat,
        enemies: this.enemies,
        groundHeight: ground,
      },
      { map, difficulty, players: o.players, rng, preferAllies: true },
    );
    this.targets = this.runner.enemyTargets;
    arena.netIdMask = 0x7f;
    arena.setExtraTargets(this.targets, (shooter, t, amount) => {
      this.shooter = shooter;
      this.combat.dealDamage(t, amount, TEAM_PLAYER);
      this.shooter = null;
    });
    this.combat.onDestroyed((t) => {
      const i = this.targets.indexOf(t);
      if (i < 0) return;
      const killer = this.shooter;
      if (killer !== null) {
        const f = arena.fighters.get(killer);
        if (f) f.kills++;
      }
      this.sendKill(killer ?? KILLER_NONE, t);
    });
    this.wireRunner();
    this.msg = {
      phase: 0,
      wave: 1,
      remaining: 0,
      intermission: 0,
      hqHp: 0,
      hqMaxHp: 1,
      aliveBits: 0,
      approach: 0,
      fighters: 0,
      bombers: 0,
      cruise: 0,
      skipMask: 0,
      supplyMask: 0,
      enemies: [],
    };
    this.fighterMsgs = this.enemies.map((_, index) => ({
      index,
      firing: false,
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    }));
    this.runner.start();
  }

  private wireRunner(): void {
    const bus = this.runner.bus;
    bus.on('defense:spawn', ({ kind, index }) => {
      if (kind === 'fighter') return;
      const t = kind === 'bomber' ? this.props.bombers[index] : this.props.cruiseMissiles[index];
      if (!t) return;
      const n = kind === 'bomber' ? (this.props.bombers[index]?.targetIndex ?? 0) : 0;
      const p = t.from;
      this.emit(eventMsg('dspawn', DEFENSE_KIND[kind], index, 0, n, p.x, p.y, p.z));
    });
    bus.on('defense:cruiseImpact', ({ index }) => {
      const m = this.props.cruiseMissiles[index];
      const p = m?.position ?? FAR;
      this.emit(eventMsg('dkill', DKILL_IMPACT, DEFENSE_KIND.cruise, 0, index, p.x, p.y, p.z));
    });
    bus.on('defense:escape', ({ kind, index }) => {
      const t = kind === 'bomber' ? this.props.bombers[index] : this.enemies[index];
      const p = t?.position ?? FAR;
      this.emit(eventMsg('dkill', DKILL_ESCAPE, DEFENSE_KIND[kind], 0, index, p.x, p.y, p.z));
    });
    bus.on('defense:supply', ({ id, fraction }) => {
      const f = this.arena.fighters.get(id);
      if (f) {
        if (fraction >= 1) {
          f.missileAmmo.refill();
          f.flareAmmo.refill();
        } else {
          f.missileAmmo.refillPart(fraction);
          f.flareAmmo.refillPart(fraction);
        }
      }
      this.supplies.add(id);
      this.emit(eventMsg('dsupply', id, 0, 0, Math.round(fraction * 100)));
    });
    bus.on('defense:intermission', () => {
      this.skips.clear();
      this.supplies.clear();
    });
  }

  private sendKill(killer: number, t: CombatTarget): void {
    const i = this.targets.indexOf(t);
    const nf = this.enemies.length;
    const nb = this.props.bombers.length;
    const kind =
      i < nf ? DEFENSE_KIND.fighter : i < nf + nb ? DEFENSE_KIND.bomber : DEFENSE_KIND.cruise;
    const index = i < nf ? i : i < nf + nb ? i - nf : i - nf - nb;
    const p = t.position;
    this.emit(eventMsg('dkill', killer, kind, 0, index, p.x, p.y, p.z));
  }

  /** 準備のスキップ（全員がそろったら次の波） */
  skip(id: number, players: readonly { readonly id: number }[]): void {
    if (this.runner.phase !== 'intermission') return;
    this.skips.add(id);
    if (players.every((p) => this.skips.has(p.id))) this.runner.skip();
  }

  /** プレイヤーのフレア（敵のミサイルを惑わす）。PvpArena の flare の event から */
  flare(id: number): void {
    const f = this.arena.fighters.get(id);
    if (f) this.combat.flares.release(f.aircraft.state, TEAM_PLAYER);
  }

  /** 固定ステップ 1 回分（全機を動かした後） */
  step(dt: number): void {
    for (const p of this.proxies) p.fighter = this.arena.fighters.get(p.id) ?? null;
    this.squadron.step(dt);
    this.props.step(dt, null, []);
    const shooter = this.proxies[0]?.fighter?.aircraft.state;
    if (shooter) this.combat.step(this.noInput, shooter, dt);
    const list = this.defenders;
    list.length = 0;
    for (const f of this.arena.all) {
      const s = f.aircraft.state;
      list.push({ id: f.id, position: s.position, speed: s.speed, active: f.active });
    }
    this.runner.step(dt, list);
  }

  get outcome(): number {
    const p = this.runner.phase;
    return p === 'cleared'
      ? DEFENSE_OUTCOME.cleared
      : p === 'failed'
        ? DEFENSE_OUTCOME.failed
        : DEFENSE_OUTCOME.none;
  }

  /** 敵のミサイル（state に入れる。netId は上のビットを立てて PvpArena のミサイルと分ける） */
  collectMissiles(out: MissileStateMsg[], spare: MissileStateMsg[], offset: number): void {
    const pool = this.combat.missiles.missiles;
    for (let i = 0; i < pool.count; i++) {
      const m = pool.get(i);
      const msg = spare[offset + i] ?? {
        netId: 0,
        owner: ENEMY_OWNER,
        targetId: NO_TARGET,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
      };
      spare[offset + i] = msg;
      msg.netId = 0x80 | (m.serial & 0x7f);
      msg.owner = ENEMY_OWNER;
      const t = m.target;
      msg.targetId = t instanceof FighterProxy ? t.id : NO_TARGET;
      msg.position.x = m.position.x;
      msg.position.y = m.position.y;
      msg.position.z = m.position.z;
      msg.velocity.x = m.velocity.x;
      msg.velocity.y = m.velocity.y;
      msg.velocity.z = m.velocity.z;
      out.push(msg);
    }
  }

  /** 敵のミサイルが起爆した（範囲ダメージの半径がミサイルのもの）を知らせる口（表示の爆発） */
  onMissileBlast(fn: (x: number, y: number, z: number) => void): void {
    this.combat.onExplosion((x, y, z, _on, radius) => {
      if (radius === MISSILE_CONFIG.blastRadius) fn(x, y, z);
    });
  }

  /**
   * state に入れる防衛戦の状態（入れ物は使い回す）。all なら戦闘機を全部（ホスト自身の表示）、
   * でなければ半分ずつ（送る分。呼ぶたびに入れ替わる）
   */
  state(all: boolean): DefenseStateMsg {
    const r = this.runner;
    const m = this.msg;
    m.phase = DEFENSE_PHASES.indexOf(r.phase);
    m.wave = r.wave;
    m.remaining = r.remaining;
    m.intermission = r.intermissionLeft;
    m.hqHp = r.base.hq.hp;
    m.hqMaxHp = r.base.hq.maxHp;
    m.aliveBits = r.base.aliveBits;
    m.approach = Math.max(0, r.map.approaches.indexOf(r.approach));
    m.fighters = r.counts.fighter;
    m.bombers = r.counts.bomber;
    m.cruise = r.counts.cruise;
    m.skipMask = [...this.skips].reduce((b, id) => b | (1 << (id & 7)), 0);
    m.supplyMask = [...this.supplies].reduce((b, id) => b | (1 << (id & 7)), 0);
    m.enemies.length = 0;
    if (!all) this.half ^= 1;
    this.enemies.forEach((e, i) => {
      if (!e.active || (!all && i % 2 !== this.half)) return;
      const f = this.fighterMsgs[i];
      if (!f) return;
      const s = e.aircraft.state;
      f.position.x = s.position.x;
      f.position.y = s.position.y;
      f.position.z = s.position.z;
      f.orientation.x = s.orientation.x;
      f.orientation.y = s.orientation.y;
      f.orientation.z = s.orientation.z;
      f.orientation.w = s.orientation.w;
      f.firing = this.squadron.isFiring(i);
      m.enemies.push(f);
    });
    return m;
  }
}
