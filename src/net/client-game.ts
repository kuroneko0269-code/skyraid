// クライアントの PvP の飛行（5-1）と戦闘（5-3）。自機は手元で先行計算し（OwnPrediction）、操作と戦闘の操作を
// 30Hz で送る（InputSender）。ホストの状態（15Hz）は他機の補間の並び（SnapshotBuffer）に入れ、自機はずれを補正する。
// 命中・撃墜・復帰はホストの event で知る（自分では判定しない）。撃墜されたら止まり、復帰の event の seq の後の操作を
// 出現位置からやり直して（記録した操作で計算し直す）ホストと同じ位置にそろえる。
// 5-4: 開始前のカウントダウン（止まって操作を無視し、入力も送らない）、つなぎ直している間と、戻ってからホストの
// 位置合わせの復帰が届くまでは止まる。初心者保護つきの復帰は最大 HP を増やす。Three.js 非依存
import { NET_CONFIG } from '../data/net';
import { PVP_CONFIG } from '../data/pvp';
import { PVP_SPAWN_POINTS } from '../data/pvp';
import { RESPAWN_BOOST } from '../combat/pvp-arena';
import { Countdown } from '../combat/pvp-rules';
import type { Aircraft, AircraftControls } from '../entities/aircraft';
import { headingQuat } from '../entities/enemy-aircraft';
import { copyQuat, copyVec3, quatIdentity, type Vec3 } from '../flight/math';
import {
  createNetControls,
  quantizeControls,
  type EventMsg,
  type KaijuStateMsg,
  type MissileStateMsg,
  type NetControls,
  type StateMsg,
} from './protocol';
import { OwnPrediction, type PredictedBody } from './prediction';
import type { ClientRoom } from './client-room';
import { InputSender, type SnapshotBuffer } from './sync';
import { RemoteInterpolation } from './client-remotes';
import {
  NetGameEvents,
  RateCounter,
  spawnOrientation,
  applyCombat,
  spawnPosition,
  toNetControls,
  type LocalCombat,
  type NetGame,
  type NetStats,
  type RemoteSample,
} from './net-game';

export interface ClientGameDeps {
  /** 自機（FlightSession の機体。HUD・カメラはこれを見る） */
  readonly own: Aircraft;
  /** 開始前のカウントダウンの秒数（省略は PVP_CONFIG.countdownSeconds。テストで 0 にする） */
  readonly countdownSeconds?: number;
  /** 高層の建物（6-4。ホストと同じ判定で先行計算の墜落を出す） */
  readonly obstacles?: (a: Readonly<Vec3>, b: Readonly<Vec3>) => boolean;
}

const TICK_HZ = NET_CONFIG.rates.tickHz;
const HISTORY = NET_CONFIG.prediction.historyTicks;

export class ClientGame extends NetGameEvents implements NetGame {
  readonly localId: number;
  /** 自機のステップ番号（1 から。入力の seq） */
  seq = 0;
  /** ホストが知らせた自機の HP */
  hp = 0;
  private readonly maxHp: number;
  /** 撃墜されて復帰を待っている */
  down = false;
  /** つなぎ直した後、ホストの位置合わせの復帰を待っている（5-4） */
  awaitingResync = false;
  /** 開始前のカウントダウン（5-4） */
  readonly countdown: Countdown;
  missiles: MissileStateMsg[] = [];
  missileVersion = 0;
  /** レイドの怪獣（6-2） */
  kaiju: KaijuStateMsg | null = null;
  kaijuVersion = 0;
  readonly prediction = new OwnPrediction();
  private readonly sender = new InputSender();
  private readonly view = new RemoteInterpolation();
  private readonly received = new RateCounter();
  private readonly raw = createNetControls();
  /** seq ごとの量子化した操作（復帰のやり直し用） */
  private readonly inputs: NetControls[] = [];
  private readonly body: PredictedBody;
  private readonly wreck = { x: 0, y: 0, z: 0 };
  private readonly wreckOrientation = quatIdentity();
  private readonly spawnOrientation = quatIdentity();
  /** 自分で墜落を計算した後、ホストの撃墜の知らせを待つ残り秒数 */
  private crashHold = 0;
  private lastStateTick = -1;
  /** 自機が最後に復帰した tick（それより前の状態の HP は使わない。復帰の event より遅れて届くことがある） */
  private respawnTick = -1;

  constructor(
    private readonly room: ClientRoom,
    private readonly deps: ClientGameDeps,
    private readonly now: () => number = () => performance.now(),
  ) {
    super();
    this.countdown = new Countdown(deps.countdownSeconds ?? PVP_CONFIG.countdownSeconds, TICK_HZ);
    this.localId = room.localPlayerId;
    const own = deps.own;
    const raid = room.settings.mode === 'raid';
    own.respawn(spawnPosition(this.localId, { x: 0, y: 0, z: 0 }, raid), spawnOrientation(raid));
    this.maxHp = room.players.find((p) => p.id === this.localId)?.maxHp ?? 0;
    this.hp = this.maxHp;
    for (let i = 0; i < HISTORY; i++) this.inputs.push(createNetControls());
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
    room.onReconnect((reconnecting) => {
      if (!reconnecting) this.awaitingResync = true;
    });
    room.onMessage((_id, msg) => {
      if (msg.type === 'state') this.onState(msg);
      else if (msg.type === 'event') this.handleEvent(msg);
      else if (msg.type === 'score') this.emitScore(msg);
    });
  }

  get ownHp(): number {
    return this.hp;
  }

  get countdownRemaining(): number {
    return this.countdown.remainingSeconds;
  }

  get inputBlocked(): boolean {
    return this.countdown.active || this.held;
  }

  /** 止まっている（撃墜・墜落の知らせ待ち・つなぎ直し・位置合わせ待ち） */
  private get held(): boolean {
    return this.down || this.crashHold > 0 || this.room.reconnecting || this.awaitingResync;
  }

  /** 名簿にいない機体を消し、新しい機体の入れ物を作る */
  private syncRoster(): void {
    this.view.syncRoster(this.room.players, this.localId);
  }

  step(controls: Readonly<AircraftControls>, combat: Readonly<LocalCombat>, dt: number): void {
    const own = this.deps.own;
    // カウントダウン中は開始位置で止まり、操作を記録も送信もしない（ホストも全機を止めている）
    if (this.countdown.step()) {
      this.hold();
      return;
    }
    this.seq++;
    toNetControls(this.raw, controls, own.flight.options);
    applyCombat(this.raw, combat);
    const q = quantizeControls(this.inputs[this.seq % HISTORY] ?? createNetControls(), this.raw);
    if (this.held) {
      // 撃墜（墜落）されている間・つなぎ直している間は止まる。撃てない
      q.fire = q.missile = q.flare = false;
      this.hold();
      if (this.crashHold > 0) this.crashHold = Math.max(0, this.crashHold - dt);
    } else this.fly(q, dt);
    this.prediction.record(this.seq, this.body);
    this.sender.viewTick =
      this.view.renderTime === null ? 0 : Math.round(this.view.renderTime * TICK_HZ);
    this.sender.record(this.seq, q);
    if (this.sender.ready()) this.room.send(this.sender.message(), 'unordered');
  }

  /** 1 ステップ飛ぶ。墜落したら残骸の位置で止まり、ホストの撃墜の知らせを待つ */
  private fly(c: Readonly<NetControls>, dt: number): void {
    const own = this.deps.own;
    const opts = own.flight.options;
    opts.autoLevel = c.autoLevel;
    opts.invertPitch = c.invertPitch;
    copyVec3(this.wreck, own.state.position);
    copyQuat(this.wreckOrientation, own.state.orientation);
    const crashes = own.crashCount;
    own.step(c, dt);
    const hit = this.deps.obstacles?.(this.wreck, own.state.position) ?? false;
    if (own.crashCount === crashes && !hit) return;
    own.respawn(this.wreck, this.wreckOrientation);
    this.crashHold = PVP_CONFIG.crashHoldSeconds;
  }

  private hold(): void {
    const own = this.deps.own;
    copyVec3(own.prevPosition, own.state.position);
    copyQuat(own.prevOrientation, own.state.orientation);
  }

  private handleEvent(e: EventMsg): void {
    if (e.b === this.localId && e.kind === 'kill') {
      // 撃墜された位置で止める（先行計算で先へ進んでいた分を戻す）
      this.down = true;
      this.crashHold = 0;
      const own = this.deps.own;
      own.state.position.x = e.x;
      own.state.position.y = e.y;
      own.state.position.z = e.z;
      this.hold();
    } else if (e.a === this.localId && e.kind === 'respawn') {
      this.respawnTick = e.tick;
      this.awaitingResync = false;
      const boost = (e.b & RESPAWN_BOOST) !== 0;
      this.hp = Math.round(this.maxHp * (boost ? PVP_CONFIG.rookie.hpScale : 1));
      this.respawn(e.b & ~RESPAWN_BOOST, e.n);
    } else if (e.kind === 'respawn') this.view.bufferOf(e.a)?.clear();
    this.emitEvent(e);
  }

  /** 復帰: 出現位置に置き、ホストがそこから使った seq（afterSeq の次から今まで）の操作で計算し直す */
  private respawn(spawn: number, afterSeq: number): void {
    const s = PVP_SPAWN_POINTS[spawn] ?? PVP_SPAWN_POINTS[0];
    if (!s) return;
    const own = this.deps.own;
    own.respawn(s, headingQuat(this.spawnOrientation, s.headingDeg));
    this.down = false;
    this.crashHold = 0;
    this.prediction.reset();
    const from = Math.max(afterSeq + 1, this.seq - HISTORY + 1);
    for (let k = from; k <= this.seq; k++) {
      const c = this.inputs[k % HISTORY];
      if (c) this.fly(c, 1 / TICK_HZ);
      this.prediction.record(k, this.body);
    }
    copyVec3(own.prevPosition, own.state.position);
    copyQuat(own.prevOrientation, own.state.orientation);
  }

  private onState(msg: StateMsg): void {
    const t = this.now();
    this.received.hit(t);
    const hostTime = msg.tick / TICK_HZ;
    this.view.clock.observe(hostTime, t / 1000);
    const newer = msg.tick > this.lastStateTick;
    if (newer) {
      this.lastStateTick = msg.tick;
      this.missiles = msg.missiles;
      this.missileVersion++;
      this.kaiju = msg.kaiju;
      this.kaijuVersion++;
    }
    for (const a of msg.aircraft) {
      if (a.id === this.localId) {
        if (!newer) continue;
        if (a.alive && msg.tick >= this.respawnTick) this.hp = a.hp;
        if (a.alive && !this.down) this.prediction.reconcile(a, this.body, this.seq);
      } else this.view.bufferOf(a.id)?.push(hostTime, a);
    }
  }

  /** 他機をホストの時刻で 100ms 遅らせて補間する（途切れたら外挿） */
  samples(_alpha: number, nowMs: number): readonly RemoteSample[] {
    return this.view.samples(nowMs);
  }

  /** 直前の samples() で他機を表示した時刻（ホストの秒） */
  get renderTime(): number | null {
    return this.view.renderTime;
  }

  /** テスト用: 他機の補間の並び */
  bufferOf(id: number): SnapshotBuffer | null {
    return this.view.bufferOf(id);
  }

  stats(nowMs: number): NetStats {
    const v = this.view;
    return {
      role: 'client',
      rttMs: this.room.rtt(),
      stateRate: this.received.rate(nowMs),
      interpDelayMs: v.delayMs,
      bufferMarginMs: v.marginMs,
      extrapolating: v.extrapolating,
      corrections: this.prediction.corrections,
      inputBacklog: 0,
      inputGuessed: 0,
      inputStarved: 0,
      inputResyncs: 0,
      rewindMs: 0,
    };
  }
}
