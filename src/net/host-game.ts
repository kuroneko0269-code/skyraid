// ホストの PvP の飛行（5-1）と戦闘の判定（5-3）。全機を固定ステップで計算する（ホストが正）: 自機は手元の操作、
// 参加者の機体は届いた入力（InputBuffer）で、参加者が選んだ機体・強化の数値で計算する。
// 機銃・ミサイル・フレア・撃墜・復帰は PvpArena が決め、結果を event で全員へ送る（自分にも同じものを渡す）。
// 4 ステップに 1 回（15Hz）全機とミサイルの状態を、撃墜のたびと 1 秒ごとに成績を配る。勝敗は PvpMatch。
// 5-4: 開始前のカウントダウン（全機を止め操作を無視）、チーム戦、初心者保護、強化の無効、切断した人の機体を止めて
// 待ち（away）、戻ったら入力が届き直してから出現位置へ戻す（クライアントはその seq から計算し直す）。
// 6-2: レイド（全員が同じチーム）は怪獣をホストで動かし（RaidHost）、state に怪獣を入れ、倒すか街に到達されたら終わる。Three.js 非依存
import { NET_CONFIG } from '../data/net';
import { PVP_CONFIG } from '../data/pvp';
import { FLIGHT_CONFIG } from '../data/flight';
import { Aircraft, type AircraftControls, type GroundHeightFn } from '../entities/aircraft';
import { PvpArena, type ArenaEvent } from '../combat/pvp-arena';
import type { PvpFighter } from '../combat/pvp-fighter';
import {
  collectMissiles,
  fighterSpec,
  holdAircraft,
  hostStats,
  interpolateSample,
  stateOf,
} from './host-state';
import { Countdown, PvpMatch } from '../combat/pvp-rules';
import type { Rng } from '../combat/gun';
import { InputBuffer } from './input-buffer';
import { RAID_OUTCOME, RaidHost } from './raid-host';
import { netLoadout } from './loadout';
import {
  createNetControls,
  eventMsg,
  type AircraftStateMsg,
  type EventMsg,
  type KaijuStateMsg,
  type MissileStateMsg,
  type ScoreMsg,
  type UpgradeLevelsMsg,
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

interface HostRemote {
  readonly id: number;
  readonly fighter: PvpFighter;
  readonly input: InputBuffer;
  readonly sample: RemoteSample;
  /** 再接続した: 入力が届き直したら出現位置へ戻す */
  pendingResume: boolean;
}

export interface HostGameDeps {
  /** 自機（FlightSession の機体。HUD・カメラはこれを見る） */
  readonly own: Aircraft;
  readonly groundHeight?: GroundHeightFn;
  readonly rng?: Rng;
  /** 開始前のカウントダウンの秒数（省略は PVP_CONFIG.countdownSeconds。テストで 0 にする） */
  readonly countdownSeconds?: number;
}

const TICK_HZ = NET_CONFIG.rates.tickHz;

export class HostGame extends NetGameEvents implements NetGame {
  readonly localId = 0;
  tick = 0;
  readonly arena: PvpArena;
  readonly match: PvpMatch;
  readonly own: PvpFighter;
  /** 開始前のカウントダウン（5-4） */
  readonly countdown: Countdown;
  missiles: MissileStateMsg[] = [];
  /** レイドの怪獣（6-2。PvP は null） */
  readonly raid: RaidHost | null;
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
    this.countdown = new Countdown(deps.countdownSeconds ?? PVP_CONFIG.countdownSeconds, TICK_HZ);
    const settings = room.settings;
    this.arena = new PvpArena(this.handleArena, deps.groundHeight ?? null, deps.rng);
    // レイド（6-2）は全員を同じチームにする（味方の弾は当たらない）
    const teams =
      settings.mode === 'team'
        ? new Map(room.players.map((p) => [p.id, p.team]))
        : settings.mode === 'raid'
          ? new Map(room.players.map((p) => [p.id, 0]))
          : null;
    this.arena.setTeams(teams);
    this.arena.rookieGuard = settings.rookieGuard;
    this.match = new PvpMatch(settings, teams ? (id) => teams.get(id) : null);
    const p = room.hostProfile;
    deps.own.respawn(spawnPosition(0, { x: 0, y: 0, z: 0 }), SPAWN_ORIENTATION);
    this.own = this.arena.add(0, deps.own, fighterSpec(this.loadout(p.aircraftId, p.upgrades)));
    for (const pl of room.players) if (pl.id !== 0) this.addRemote(pl.id, pl.aircraftId);
    this.raid =
      settings.mode === 'raid'
        ? new RaidHost(this.arena, room.players.length, deps.groundHeight)
        : null;
    room.onPlayerLeave((id) => {
      this.remotes.delete(id);
      this.arena.remove(id);
      this.scoreDirty = true;
    });
    room.onPlayerAway((id, away) => {
      const r = this.remotes.get(id);
      if (!r) return;
      if (away) this.arena.setAway(id, true);
      else {
        // 古い seq の入力を捨てて溜め直す。届き直したら出現位置へ（step）
        r.input.reset();
        r.pendingResume = true;
      }
    });
    room.onMessage((id, msg) => {
      if (msg.type === 'input') this.remotes.get(id)?.input.receive(msg);
    });
  }

  /** 機体の数値（強化の無効なら Lv 0。5-4） */
  private loadout(aircraftId: string, upgrades: UpgradeLevelsMsg | undefined) {
    return netLoadout(aircraftId, this.room.settings.noUpgrades ? undefined : upgrades);
  }

  private addRemote(id: number, aircraftId: string): void {
    const join = this.room.joinProfiles.get(id);
    const loadout = this.loadout(join?.aircraftId ?? aircraftId, join?.upgrades);
    const aircraft = new Aircraft(loadout.flight, {}, FLIGHT_CONFIG, this.deps.groundHeight);
    aircraft.respawn(spawnPosition(id, { x: 0, y: 0, z: 0 }), SPAWN_ORIENTATION);
    this.remotes.set(id, {
      id,
      fighter: this.arena.add(id, aircraft, fighterSpec(loadout)),
      input: new InputBuffer(),
      sample: createRemoteSample(id, aircraftId),
      pendingResume: false,
    });
  }

  get ownHp(): number {
    return this.own.hp;
  }

  get countdownRemaining(): number {
    return this.countdown.remainingSeconds;
  }

  get inputBlocked(): boolean {
    return this.countdown.active;
  }

  step(controls: Readonly<AircraftControls>, combat: Readonly<LocalCombat>, dt: number): void {
    if (this.over) return;
    this.tick++;
    const arena = this.arena;
    arena.tick = this.tick;
    if (this.countdown.step()) {
      // カウントダウン中: 全機を開始位置で止め、操作は使わない（状態と残り時間だけ配る）
      for (const f of arena.all) holdAircraft(f.aircraft);
      if (this.tick % this.stateEvery === 0) this.broadcastState();
      if (this.scoreDirty || this.tick % this.scoreEvery === 0) this.sendScore(false);
      return;
    }
    const c = applyCombat(
      toNetControls(this.ownControls, controls, this.deps.own.flight.options),
      combat,
    );
    arena.stepFighter(0, c, dt, null);
    for (const r of this.remotes.values()) {
      const inputs = r.input.pull();
      const a = r.fighter.aircraft;
      // 入力が届いていなければ止める
      if (inputs.length === 0) holdAircraft(a);
      else if (r.pendingResume) {
        // 再接続した人の入力が届き直した: この tick の終わりに出現位置へ（復帰の event の seq から計算し直してもらう）
        r.pendingResume = false;
        arena.setAway(r.id, false);
      }
      // 各ステップでクライアントが見ていた tick（遅延補償）= seq + 届いた最新のメッセージのずれ
      const offset = r.input.viewOffset;
      const first = r.input.lastApplied - inputs.length + 1;
      inputs.forEach((input, i) => {
        arena.stepFighter(r.id, input, dt, offset === null ? null : first + i + offset);
      });
    }
    arena.endTick(dt);
    this.raid?.step(dt);
    this.collectMissiles();
    if (this.tick % this.stateEvery === 0) this.broadcastState();
    // レイドは怪獣を倒すか街に到達されたら終わり（撃墜数・制限時間は使わない）
    const outcome = this.raid?.outcome ?? RAID_OUTCOME.none;
    const ended = this.raid
      ? outcome !== RAID_OUTCOME.none
      : this.match.step(dt, arena.all) !== null;
    if (ended || this.scoreDirty || this.tick % this.scoreEvery === 0) this.sendScore(ended);
    if (ended) {
      this.over = true;
      this.room.endMatch(this.tick, outcome);
      this.emitEvent(eventMsg('over', 0, outcome, this.tick));
    }
  }

  /** レイドの怪獣の状態（6-2。表示は本体を直接読むので、ここはテスト・クライアントと同じ口のため） */
  get kaiju(): KaijuStateMsg | null {
    return this.raid?.state() ?? null;
  }

  get kaijuVersion(): number {
    return this.tick;
  }

  /** 対戦が終わったか */
  get finished(): boolean {
    return this.over;
  }

  /** 成績（全員） */
  score(over: boolean): ScoreMsg {
    return {
      type: 'score',
      remainingSeconds: this.raid
        ? (this.raid.kaiju.finalRemaining ?? 0)
        : this.match.remainingSeconds,
      over,
      players: this.arena.all.map((f) => ({
        id: f.id,
        kills: f.kills,
        deaths: f.deaths,
        shots: f.shots,
        hits: f.hits,
        bestStreak: f.bestStreak,
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
      {
        type: 'state',
        tick: this.tick,
        aircraft: msgs,
        missiles: this.missiles,
        kaiju: this.raid?.state() ?? null,
      },
      'unordered',
    );
    this.sent.hit(this.now());
  }

  /** 参加者の機体を固定ステップの間で補間する */
  samples(alpha: number): readonly RemoteSample[] {
    const list = this.list;
    list.length = 0;
    for (const r of this.remotes.values()) list.push(interpolateSample(r.fighter, r.sample, alpha));
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
    return hostStats(
      this.remotes.values(),
      (id) => this.room.rtt(id),
      this.tick,
      this.sent.rate(nowMs),
    );
  }
}
