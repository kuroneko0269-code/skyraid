// クライアントの PvP の飛行（5-1）。自機は手元で先行計算し（OwnPrediction）、操作を 30Hz で送る（InputSender）。
// ホストの状態（15Hz）は他機の補間の並び（SnapshotBuffer）に入れ、自機はずれを補正する。Three.js 非依存
import { NET_CONFIG } from '../data/net';
import type { Aircraft, AircraftControls } from '../entities/aircraft';
import { createNetControls, quantizeControls, type StateMsg } from './protocol';
import { OwnPrediction, type PredictedBody } from './prediction';
import type { ClientRoom } from './client-room';
import {
  HostClock,
  InputSender,
  SnapshotBuffer,
  createSampledPose,
  type SampledPose,
} from './sync';
import {
  RateCounter,
  SPAWN_ORIENTATION,
  createRemoteSample,
  spawnPosition,
  toNetControls,
  type NetGame,
  type NetStats,
  type RemoteSample,
} from './net-game';

interface ClientRemote {
  readonly buffer: SnapshotBuffer;
  readonly sample: RemoteSample;
}

export interface ClientGameDeps {
  /** 自機（FlightSession の機体。HUD・カメラはこれを見る） */
  readonly own: Aircraft;
}

const TICK_HZ = NET_CONFIG.rates.tickHz;

export class ClientGame implements NetGame {
  readonly localId: number;
  /** 自機のステップ番号（1 から。入力の seq） */
  seq = 0;
  /** ホストが知らせた自機の HP */
  hp = 0;
  readonly prediction = new OwnPrediction();
  private readonly sender = new InputSender();
  private readonly clock = new HostClock();
  private readonly remotes = new Map<number, ClientRemote>();
  private readonly list: RemoteSample[] = [];
  private readonly received = new RateCounter();
  private readonly raw = createNetControls();
  private readonly quantized = createNetControls();
  private readonly pose: SampledPose = createSampledPose();
  private readonly body: PredictedBody;
  private lastStateTick = -1;
  private lastRenderTime: number | null = null;
  private lastHostNow: number | null = null;
  private extrapolating = 0;
  private margin = 0;

  constructor(
    private readonly room: ClientRoom,
    private readonly deps: ClientGameDeps,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.localId = room.localPlayerId;
    const own = deps.own;
    own.respawn(spawnPosition(this.localId, { x: 0, y: 0, z: 0 }), SPAWN_ORIENTATION);
    const state = own.state;
    this.body = {
      position: state.position,
      orientation: state.orientation,
      get speed() {
        return state.speed;
      },
      set speed(v: number) {
        state.speed = v;
      },
      prevPosition: own.prevPosition,
      prevOrientation: own.prevOrientation,
    };
    this.syncRoster();
    room.onRoster(() => {
      this.syncRoster();
    });
    room.onMessage((_id, msg) => {
      if (msg.type === 'state') this.onState(msg);
    });
  }

  /** 名簿にいない機体を消し、新しい機体の入れ物を作る */
  private syncRoster(): void {
    const ids = new Set<number>();
    for (const p of this.room.players) {
      if (p.id === this.localId) continue;
      ids.add(p.id);
      if (!this.remotes.has(p.id)) {
        this.remotes.set(p.id, {
          buffer: new SnapshotBuffer(),
          sample: createRemoteSample(p.id, p.aircraftId),
        });
      }
    }
    for (const id of [...this.remotes.keys()]) if (!ids.has(id)) this.remotes.delete(id);
  }

  step(controls: Readonly<AircraftControls>, dt: number): void {
    const own = this.deps.own;
    this.seq++;
    toNetControls(this.raw, controls, own.flight.options);
    quantizeControls(this.quantized, this.raw);
    own.step(this.quantized, dt);
    this.prediction.record(this.seq, this.body);
    this.sender.record(this.seq, this.quantized);
    if (this.sender.ready()) this.room.send(this.sender.message(), 'unordered');
  }

  private onState(msg: StateMsg): void {
    const t = this.now();
    this.received.hit(t);
    const hostTime = msg.tick / TICK_HZ;
    this.clock.observe(hostTime, t / 1000);
    const newer = msg.tick > this.lastStateTick;
    if (newer) this.lastStateTick = msg.tick;
    for (const a of msg.aircraft) {
      if (a.id === this.localId) {
        if (!newer) continue;
        this.hp = a.hp;
        this.prediction.reconcile(a, this.body, this.seq);
      } else this.remotes.get(a.id)?.buffer.push(hostTime, a);
    }
  }

  /** 他機をホストの時刻で 100ms 遅らせて補間する（途切れたら外挿） */
  samples(_alpha: number, nowMs: number): readonly RemoteSample[] {
    const list = this.list;
    list.length = 0;
    const local = nowMs / 1000;
    const hostNow = this.clock.hostNow(local);
    this.lastHostNow = hostNow;
    if (hostNow === null) return list;
    const t = hostNow - NET_CONFIG.sync.interpolationDelaySeconds;
    this.lastRenderTime = t;
    let extrapolating = 0;
    let margin = Infinity;
    for (const r of this.remotes.values()) {
      const mode = r.buffer.sample(t, this.pose);
      const latest = this.pose.latest;
      if (mode === 'empty' || !latest) continue;
      if (mode !== 'interpolated') extrapolating++;
      margin = Math.min(margin, latest.time - t);
      const out = r.sample;
      out.position.x = this.pose.position.x;
      out.position.y = this.pose.position.y;
      out.position.z = this.pose.position.z;
      out.orientation.x = this.pose.orientation.x;
      out.orientation.y = this.pose.orientation.y;
      out.orientation.z = this.pose.orientation.z;
      out.orientation.w = this.pose.orientation.w;
      out.alive = latest.alive;
      out.afterburner = latest.afterburner;
      out.throttle = latest.throttle;
      list.push(out);
    }
    this.extrapolating = extrapolating;
    this.margin = Number.isFinite(margin) ? margin * 1000 : 0;
    return list;
  }

  /** 直前の samples() で他機を表示した時刻（ホストの秒） */
  get renderTime(): number | null {
    return this.lastRenderTime;
  }

  /** テスト用: 他機の補間の並び */
  bufferOf(id: number): SnapshotBuffer | null {
    return this.remotes.get(id)?.buffer ?? null;
  }

  stats(nowMs: number): NetStats {
    const delay =
      this.lastHostNow !== null && this.lastRenderTime !== null
        ? (this.lastHostNow - this.lastRenderTime) * 1000
        : 0;
    return {
      role: 'client',
      rttMs: this.room.rtt(),
      stateRate: this.received.rate(nowMs),
      interpDelayMs: delay,
      bufferMarginMs: this.margin,
      extrapolating: this.extrapolating,
      corrections: this.prediction.corrections,
      inputBacklog: 0,
      inputGuessed: 0,
      inputStarved: 0,
      inputResyncs: 0,
    };
  }
}
