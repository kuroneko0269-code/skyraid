// ホストの PvP の飛行（5-1）。全機を固定ステップで計算する（ホストが正）: 自機は手元の操作、参加者の機体は
// 届いた入力（InputBuffer）で、参加者が選んだ機体・強化の数値で計算する。4 ステップに 1 回（15Hz）全機の状態を配る。
// Three.js 非依存
import { NET_CONFIG } from '../data/net';
import { findAircraftModel, AIRCRAFT_MODELS } from '../data/aircraft';
import { FLIGHT_CONFIG } from '../data/flight';
import { Aircraft, type AircraftControls, type GroundHeightFn } from '../entities/aircraft';
import { copyQuat, copyVec3 } from '../flight/math';
import { resolveLoadout } from '../progression/loadout';
import { UPGRADE_LEVELS } from '../data/upgrades';
import { InputBuffer } from './input-buffer';
import type { AircraftStateMsg, JoinMsg } from './protocol';
import type { HostRoom } from './room';
import {
  RateCounter,
  SPAWN_ORIENTATION,
  createRemoteSample,
  spawnPosition,
  type NetGame,
  type NetStats,
  type RemoteSample,
} from './net-game';
import { slerp } from './sync';

interface HostRemote {
  readonly id: number;
  readonly aircraft: Aircraft;
  readonly input: InputBuffer;
  readonly sample: RemoteSample;
  hp: number;
}

export interface HostGameDeps {
  /** 自機（FlightSession の機体。HUD・カメラはこれを見る） */
  readonly own: Aircraft;
  readonly ownHp: () => number;
  readonly groundHeight?: GroundHeightFn;
}

function clampLevel(n: number): number {
  return Math.min(UPGRADE_LEVELS.max, Math.max(UPGRADE_LEVELS.min, Math.round(n)));
}

/** 参加者の機体の数値（join の機体と強化。知らない機体は最初の機体） */
function remoteLoadout(join: JoinMsg | undefined) {
  const model = (join && findAircraftModel(join.aircraftId)) ?? AIRCRAFT_MODELS[0];
  if (!model) throw new Error('機体の定義がありません');
  const u = join?.upgrades;
  return resolveLoadout(model, {
    engine: clampLevel(u?.engine ?? 0),
    airframe: clampLevel(u?.airframe ?? 0),
    weapons: clampLevel(u?.weapons ?? 0),
    avionics: clampLevel(u?.avionics ?? 0),
  });
}

export class HostGame implements NetGame {
  readonly localId = 0;
  tick = 0;
  private readonly remotes = new Map<number, HostRemote>();
  private readonly list: RemoteSample[] = [];
  private readonly sent = new RateCounter();
  private readonly stateEvery = Math.round(NET_CONFIG.rates.tickHz / NET_CONFIG.rates.stateHz);
  private readonly velocity = { x: 0, y: 0, z: 0 };
  private readonly spawn = { x: 0, y: 0, z: 0 };
  private readonly msgs: AircraftStateMsg[] = [];

  constructor(
    private readonly room: HostRoom,
    private readonly deps: HostGameDeps,
    private readonly now: () => number = () => performance.now(),
  ) {
    deps.own.respawn(spawnPosition(0, this.spawn), SPAWN_ORIENTATION);
    for (const p of room.players) if (p.id !== 0) this.addRemote(p.id, p.aircraftId);
    room.onPlayerLeave((id) => {
      this.remotes.delete(id);
    });
    room.onMessage((id, msg) => {
      if (msg.type === 'input') this.remotes.get(id)?.input.receive(msg);
    });
  }

  private addRemote(id: number, aircraftId: string): void {
    const loadout = remoteLoadout(this.room.joinProfiles.get(id));
    const aircraft = new Aircraft(loadout.flight, {}, FLIGHT_CONFIG, this.deps.groundHeight);
    aircraft.respawn(spawnPosition(id, this.spawn), SPAWN_ORIENTATION);
    this.remotes.set(id, {
      id,
      aircraft,
      input: new InputBuffer(),
      sample: createRemoteSample(id, aircraftId),
      hp: loadout.flight.hull.maxHp,
    });
  }

  step(controls: Readonly<AircraftControls>, dt: number): void {
    this.tick++;
    this.deps.own.step(controls, dt);
    for (const r of this.remotes.values()) {
      const inputs = r.input.pull();
      const opts = r.aircraft.flight.options;
      // 入力が届いていなければ止める（前の位置のまま。補間の線が伸びないよう prev も合わせる）
      if (inputs.length === 0) {
        copyVec3(r.aircraft.prevPosition, r.aircraft.state.position);
        copyQuat(r.aircraft.prevOrientation, r.aircraft.state.orientation);
      }
      for (const c of inputs) {
        opts.autoLevel = c.autoLevel;
        opts.invertPitch = c.invertPitch;
        r.aircraft.step(c, dt);
      }
    }
    if (this.tick % this.stateEvery === 0) this.broadcastState();
  }

  private broadcastState(): void {
    const msgs = this.msgs;
    msgs.length = 0;
    msgs.push(this.stateOf(0, this.deps.own, 0, this.deps.ownHp()));
    for (const r of this.remotes.values()) {
      msgs.push(this.stateOf(r.id, r.aircraft, r.input.lastApplied, r.hp));
    }
    this.room.broadcast({ type: 'state', tick: this.tick, aircraft: msgs }, 'unordered');
    this.sent.hit(this.now());
  }

  private stateOf(id: number, a: Aircraft, seq: number, hp: number): AircraftStateMsg {
    const s = a.state;
    a.velocity(this.velocity);
    return {
      id,
      alive: true,
      afterburner: s.afterburnerActive,
      lastInputSeq: seq,
      position: s.position,
      orientation: s.orientation,
      velocity: { ...this.velocity },
      speed: s.speed,
      throttle: a.throttle,
      hp,
    };
  }

  /** 参加者の機体を固定ステップの間で補間する */
  samples(alpha: number): readonly RemoteSample[] {
    const list = this.list;
    list.length = 0;
    for (const r of this.remotes.values()) {
      const a = r.aircraft;
      const p = a.state.position;
      const q = a.prevPosition;
      const out = r.sample;
      out.position.x = q.x + (p.x - q.x) * alpha;
      out.position.y = q.y + (p.y - q.y) * alpha;
      out.position.z = q.z + (p.z - q.z) * alpha;
      slerp(out.orientation, a.prevOrientation, a.state.orientation, alpha);
      out.afterburner = a.state.afterburnerActive;
      out.throttle = a.throttle;
      list.push(out);
    }
    return list;
  }

  /** テスト用: 参加者の機体（ホストの正） */
  aircraftOf(id: number): Aircraft | null {
    return id === 0 ? this.deps.own : (this.remotes.get(id)?.aircraft ?? null);
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
    };
  }
}
