// ホストの PvP の飛行（5-1）と戦闘の判定（5-3）。全機を固定ステップで計算する（ホストが正）: 自機は手元の操作、
// 参加者の機体は届いた入力（InputBuffer）で、参加者が選んだ機体・強化の数値で計算する。
// 機銃・ミサイル・フレア・撃墜・復帰は PvpArena が決め、結果を event で全員へ送る（自分にも同じものを渡す）。
// 4 ステップに 1 回（15Hz）全機とミサイルの状態を、撃墜のたびと 1 秒ごとに成績を配る。勝敗は PvpMatch。
// Three.js 非依存
import { NET_CONFIG } from '../data/net';
import { PVP_CONFIG } from '../data/pvp';
import { FLIGHT_CONFIG } from '../data/flight';
import { Aircraft, type AircraftControls, type GroundHeightFn } from '../entities/aircraft';
import { PvpArena, type ArenaEvent } from '../combat/pvp-arena';
import type { PvpFighter } from '../combat/pvp-fighter';
import { collectMissiles, fighterSpec, stateOf } from './host-state';
import { copyQuat, copyVec3 } from '../flight/math';
import { PvpMatch } from '../combat/pvp-rules';
import type { Rng } from '../combat/gun';
import { InputBuffer } from './input-buffer';
import { netLoadout } from './loadout';
import {
  createNetControls,
  eventMsg,
  type AircraftStateMsg,
  type EventMsg,
  type MissileStateMsg,
  type ScoreMsg,
} from './protocol';
import type { HostRoom } from './room';
import {
  NetGameEvents,
  RateCounter,
  SPAWN_ORIENTATION,
  applyCombat,
  createRemoteSample,
  spawnPosition,
  toNetControls,
  type LocalCombat,
  type NetGame,
  type NetStats,
  type RemoteSample,
} from './net-game';
import { slerp } from './sync';

interface HostRemote {
  readonly id: number;
  readonly fighter: PvpFighter;
  readonly input: InputBuffer;
  readonly sample: RemoteSample;
}

export interface HostGameDeps {
  /** 自機（FlightSession の機体。HUD・カメラはこれを見る） */
  readonly own: Aircraft;
  readonly groundHeight?: GroundHeightFn;
  readonly rng?: Rng;
}

const TICK_HZ = NET_CONFIG.rates.tickHz;

export class HostGame extends NetGameEvents implements NetGame {
  readonly localId = 0;
  tick = 0;
  readonly arena: PvpArena;
  readonly match: PvpMatch;
  readonly own: PvpFighter;
  missiles: MissileStateMsg[] = [];
  missileVersion = 0;
  private readonly remotes = new Map<number, HostRemote>();
  private readonly list: RemoteSample[] = [];
  private readonly sent = new RateCounter();
  private readonly stateEvery = Math.round(TICK_HZ / NET_CONFIG.rates.stateHz);
  private readonly scoreEvery = Math.round(PVP_CONFIG.scoreIntervalSeconds * TICK_HZ);
  private readonly ownControls = createNetControls();
  private readonly msgs: AircraftStateMsg[] = [];
  private readonly missilePool: MissileStateMsg[] = [];
  private scoreDirty = true;
  private over = false;

  constructor(
    private readonly room: HostRoom,
    private readonly deps: HostGameDeps,
    private readonly now: () => number = () => performance.now(),
  ) {
    super();
    this.arena = new PvpArena(this.handleArena, deps.groundHeight ?? null, deps.rng);
    this.match = new PvpMatch(room.settings);
    const p = room.hostProfile;
    deps.own.respawn(spawnPosition(0, { x: 0, y: 0, z: 0 }), SPAWN_ORIENTATION);
    this.own = this.arena.add(0, deps.own, fighterSpec(netLoadout(p.aircraftId, p.upgrades)));
    for (const pl of room.players) if (pl.id !== 0) this.addRemote(pl.id, pl.aircraftId);
    room.onPlayerLeave((id) => {
      this.remotes.delete(id);
      this.arena.remove(id);
      this.scoreDirty = true;
    });
    room.onMessage((id, msg) => {
      if (msg.type === 'input') this.remotes.get(id)?.input.receive(msg);
    });
  }

  private addRemote(id: number, aircraftId: string): void {
    const join = this.room.joinProfiles.get(id);
    const loadout = netLoadout(join?.aircraftId ?? aircraftId, join?.upgrades);
    const aircraft = new Aircraft(loadout.flight, {}, FLIGHT_CONFIG, this.deps.groundHeight);
    aircraft.respawn(spawnPosition(id, { x: 0, y: 0, z: 0 }), SPAWN_ORIENTATION);
    this.remotes.set(id, {
      id,
      fighter: this.arena.add(id, aircraft, fighterSpec(loadout)),
      input: new InputBuffer(),
      sample: createRemoteSample(id, aircraftId),
    });
  }

  get ownHp(): number {
    return this.own.hp;
  }

  step(controls: Readonly<AircraftControls>, combat: Readonly<LocalCombat>, dt: number): void {
    if (this.over) return;
    this.tick++;
    const arena = this.arena;
    arena.tick = this.tick;
    const c = applyCombat(
      toNetControls(this.ownControls, controls, this.deps.own.flight.options),
      combat,
    );
    arena.stepFighter(0, c, dt, null);
    for (const r of this.remotes.values()) {
      const inputs = r.input.pull();
      const a = r.fighter.aircraft;
      // 入力が届いていなければ止める（前の位置のまま。補間の線が伸びないよう prev も合わせる）
      if (inputs.length === 0) {
        copyVec3(a.prevPosition, a.state.position);
        copyQuat(a.prevOrientation, a.state.orientation);
      }
      // 各ステップでクライアントが見ていた tick（遅延補償）= seq + 届いた最新のメッセージのずれ
      const offset = r.input.viewOffset;
      const first = r.input.lastApplied - inputs.length + 1;
      inputs.forEach((input, i) => {
        arena.stepFighter(r.id, input, dt, offset === null ? null : first + i + offset);
      });
    }
    arena.endTick(dt);
    this.collectMissiles();
    if (this.tick % this.stateEvery === 0) this.broadcastState();
    const ended = this.match.step(dt, arena.all);
    if (ended || this.scoreDirty || this.tick % this.scoreEvery === 0)
      this.sendScore(ended !== null);
    if (ended) {
      this.over = true;
      this.room.endMatch(this.tick);
      this.emitEvent(eventMsg('over', 0, 0, this.tick));
    }
  }

  /** 対戦が終わったか */
  get finished(): boolean {
    return this.over;
  }

  /** 成績（全員） */
  score(over: boolean): ScoreMsg {
    return {
      type: 'score',
      remainingSeconds: this.match.remainingSeconds,
      over,
      players: this.arena.all.map((f) => ({
        id: f.id,
        kills: f.kills,
        deaths: f.deaths,
        shots: f.shots,
        hits: f.hits,
      })),
    };
  }

  private sendScore(over: boolean): void {
    this.scoreDirty = false;
    const msg = this.score(over);
    this.room.broadcast(msg, 'reliable');
    this.emitScore(msg);
  }

  private readonly handleArena = (e: Readonly<ArenaEvent>): void => {
    // 復帰: その機体に最後に使った入力の seq（クライアントがそこから自機を計算し直す）
    const n = e.kind === 'respawn' ? (this.remotes.get(e.a)?.input.lastApplied ?? 0) : e.n;
    const msg: EventMsg = eventMsg(e.kind, e.a, e.b, this.tick, n, e.x, e.y, e.z);
    if (e.kind === 'kill') this.scoreDirty = true;
    this.room.broadcast(msg, 'reliable');
    this.emitEvent(msg);
  };

  private collectMissiles(): void {
    collectMissiles(this.arena.missiles.missiles, this.missiles, this.missilePool);
    this.missileVersion++;
  }

  private broadcastState(): void {
    const msgs = this.msgs;
    msgs.length = 0;
    for (const f of this.arena.all) {
      const seq = f.id === 0 ? 0 : (this.remotes.get(f.id)?.input.lastApplied ?? 0);
      msgs.push(stateOf(f, seq));
    }
    this.room.broadcast(
      { type: 'state', tick: this.tick, aircraft: msgs, missiles: this.missiles },
      'unordered',
    );
    this.sent.hit(this.now());
  }

  /** 参加者の機体を固定ステップの間で補間する */
  samples(alpha: number): readonly RemoteSample[] {
    const list = this.list;
    list.length = 0;
    for (const r of this.remotes.values()) {
      const f = r.fighter;
      const a = f.aircraft;
      const p = a.state.position;
      const q = a.prevPosition;
      const out = r.sample;
      out.position.x = q.x + (p.x - q.x) * alpha;
      out.position.y = q.y + (p.y - q.y) * alpha;
      out.position.z = q.z + (p.z - q.z) * alpha;
      slerp(out.orientation, a.prevOrientation, a.state.orientation, alpha);
      out.alive = f.alive;
      out.afterburner = a.state.afterburnerActive;
      out.throttle = a.throttle;
      out.velocity.x = f.velocity.x;
      out.velocity.y = f.velocity.y;
      out.velocity.z = f.velocity.z;
      out.speed = a.state.speed;
      out.hp = f.hp;
      out.invulnerable = f.invulnerable;
      list.push(out);
    }
    return list;
  }

  /** テスト用: 参加者の機体（ホストの正） */
  aircraftOf(id: number): Aircraft | null {
    return this.arena.fighters.get(id)?.aircraft ?? null;
  }

  /** テスト用: 参加者の機体に最後に使った入力の seq */
  lastInputSeq(id: number): number {
    return this.remotes.get(id)?.input.lastApplied ?? 0;
  }

  stats(nowMs: number): NetStats {
    let rtt = 0;
    let n = 0;
    let backlog = 0;
    let guessed = 0;
    let starved = 0;
    let resyncs = 0;
    let rewind = 0;
    for (const r of this.remotes.values()) {
      const v = this.room.rtt(r.id);
      if (v !== null) {
        rtt += v;
        n++;
      }
      backlog = Math.max(backlog, r.input.backlog);
      guessed += r.input.guessed;
      starved += r.input.starved;
      resyncs += r.input.resyncs;
      const off = r.input.viewOffset;
      if (off !== null) rewind = Math.max(rewind, this.tick - (r.input.lastApplied + off));
    }
    return {
      role: 'host',
      rttMs: n > 0 ? rtt / n : null,
      stateRate: this.sent.rate(nowMs),
      interpDelayMs: 0,
      bufferMarginMs: 0,
      extrapolating: 0,
      corrections: 0,
      inputBacklog: backlog,
      inputGuessed: guessed,
      inputStarved: starved,
      inputResyncs: resyncs,
      rewindMs: (rewind * 1000) / TICK_HZ,
    };
  }
}
