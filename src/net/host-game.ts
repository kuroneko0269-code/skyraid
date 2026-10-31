// ホストの PvP の飛行（5-1）と戦闘の判定（5-3）。全機を固定ステップで計算する（ホストが正）: 自機は手元の操作、
// 参加者の機体は届いた入力（InputBuffer）で、参加者が選んだ機体・強化の数値で計算する。
// 機銃・ミサイル・フレア・撃墜・復帰は PvpArena が決め、結果を event で全員へ送る（自分にも同じものを渡す）。
// 4 ステップに 1 回（15Hz）全機とミサイルの状態を、撃墜のたびと 1 秒ごとに成績を配る。勝敗は PvpMatch。
// 5-4: 開始前のカウントダウン（全機を止め操作を無視）、チーム戦、初心者保護、強化の無効、切断した人の機体を止めて
// 待ち（away）、戻ったら入力が届き直してから出現位置へ戻す（クライアントはその seq から計算し直す）。
// 6-2: レイド（全員が同じチーム）は怪獣をホストで動かし（RaidHost）、state に怪獣を入れ、倒すか街に到達されたら終わる。Three.js 非依存
import { quatIdentity, type Vec3 } from '../flight/math';
import { headingQuat } from '../entities/enemy-aircraft';
import { NET_CONFIG } from '../data/net';
import { PVP_CONFIG } from '../data/pvp';
import { FLIGHT_CONFIG } from '../data/flight';
import { Aircraft, type AircraftControls, type GroundHeightFn } from '../entities/aircraft';
import { PvpArena, type ArenaEvent } from '../combat/pvp-arena';
import type { PvpFighter } from '../combat/pvp-fighter';
import { fighterSpec, holdAircraft, hostStats, interpolateSample, stateMsg } from './host-state';
import { PvpMatch } from '../combat/pvp-rules';
import type { BuildingField } from '../combat/buildings';
import type { PreStart } from './briefing';
import {
  allSkipped,
  createRaidHost,
  preStart,
  resendRuins,
  scoreMsg,
  takeRuins,
} from './host-raid';
import type { Rng } from '../combat/gun';
import { InputBuffer } from './input-buffer';
import { RAID_OUTCOME, type RaidHost } from './raid-host';
import { DEFENSE_OUTCOME, type DefenseHost } from './defense-host';
import { collectAllMissiles, createDefenseHost, modeTeams, overEvent } from './host-defense';
import { netLoadout } from './loadout';
import {
  createNetControls,
  eventMsg,
  type AircraftStateMsg,
  type DefenseStateMsg,
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
  applyCombat,
  createRemoteSample,
  startPose,
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
  /** 高層の建物（6-4） */
  readonly obstacles?: (a: Readonly<Vec3>, b: Readonly<Vec3>) => boolean;
  readonly rng?: Rng;
  /** 開始前のカウントダウンの秒数（省略は PVP_CONFIG.countdownSeconds。テストで 0 にする） */
  readonly countdownSeconds?: number;
  /** 協力レイドのブリーフィングの秒数（6-6。省略は RAID_RULES.briefingSeconds。PvP は 0） */
  readonly briefingSeconds?: number;
  /** 街の建物（6-6。レイドはホストだけが壊し、壊れた番号を配る） */
  readonly buildings?: BuildingField | null;
}

const TICK_HZ = NET_CONFIG.rates.tickHz;

export class HostGame extends NetGameEvents implements NetGame {
  readonly localId = 0;
  tick = 0;
  readonly arena: PvpArena;
  readonly match: PvpMatch;
  readonly own: PvpFighter;
  /** 開始前のブリーフィング（6-6）とカウントダウン（5-4） */
  readonly countdown: PreStart;
  /** カウントダウンの後のステップ数（6-6。レイドのクリア時間） */
  playTicks = 0;
  missiles: MissileStateMsg[] = [];
  /** レイドの怪獣（6-2。PvP は null） */
  readonly raid: RaidHost | null;
  /** 防衛戦（7-2。ほかは null） */
  readonly defense: DefenseHost | null;
  missileVersion = 0;
  /** 防衛戦の状態の版・tick と、表示の時刻（ホストは今の tick。7-2） */
  defenseVersion = 0;
  defenseTick = 0;
  viewTick = 0;
  kaijuVersion = 0;
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
    const settings = room.settings;
    const raid = settings.mode === 'raid';
    this.countdown = preStart(raid, deps.briefingSeconds, deps.countdownSeconds);
    this.arena = new PvpArena(this.handleArena, deps.groundHeight ?? null, deps.rng);
    this.arena.obstacles = deps.obstacles ?? null;
    const teams = modeTeams(room);
    this.arena.setTeams(teams);
    this.arena.rookieGuard = settings.rookieGuard;
    this.match = new PvpMatch(settings, teams ? (id) => teams.get(id) : null);
    const p = room.hostProfile;
    const start = startPose(0, settings);
    deps.own.respawn(start, headingQuat(quatIdentity(), start.headingDeg));
    this.own = this.arena.add(0, deps.own, fighterSpec(this.loadout(p.aircraftId, p.upgrades)));
    for (const pl of room.players) if (pl.id !== 0) this.addRemote(pl.id, pl.aircraftId);
    this.raid = raid ? createRaidHost(this.arena, room, deps, this.sendEvent) : null;
    this.defense = createDefenseHost(this.arena, room, deps, this.sendEvent);
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
        // 6-6: 途切れている間に壊れた建物を含め、壊れている建物をすべて送り直す
        resendRuins(room, id, this.raid ? deps.buildings : null);
      }
    });
    room.onMessage((id, msg) => {
      if (msg.type === 'input') this.remotes.get(id)?.input.receive(msg);
      else if (msg.type === 'event' && msg.kind === 'skip') this.skip(id);
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
    const start = startPose(id, this.room.settings);
    aircraft.respawn(start, headingQuat(quatIdentity(), start.headingDeg));
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
    return this.countdown.countdownRemaining;
  }

  get briefingRemaining(): number {
    return this.countdown.briefingRemaining;
  }

  /** ブリーフィングのスキップ（ホスト自身。6-6） */
  skipBriefing(): void {
    this.skip(0);
  }

  /** 全員（名簿の今の人）がスキップを押したらブリーフィングを終わらせ、全員に brief を送る */
  private skip(id: number): void {
    // 7-2: 防衛戦の準備のスキップ（全員がそろったら次の波）
    const c = this.countdown;
    if (this.defense && !c.active) this.defense.skip(id, this.room.players);
    else if (allSkipped(c, this.room.players, id))
      this.sendEvent(eventMsg('brief', 0, 0, 0, c.remainingTicks));
  }

  /** できごとを全員へ送り、自分にも渡す（tick は今） */
  private readonly sendEvent = (e: EventMsg): void => {
    e.tick = this.tick;
    if (e.kind === 'dkill') this.scoreDirty = true;
    this.room.broadcast(e, 'reliable');
    this.emitEvent(e);
  };

  /** 攻撃の対象のプレイヤー（6-6。攻撃中だけ） */
  get kaijuTarget(): number | null {
    return this.raid?.targetId ?? null;
  }

  /** その人がロックしている怪獣の部位（6-6。-1 はなし） */
  lockPartOf(id: number): number {
    return this.arena.fighters.get(id)?.lockPart ?? -1;
  }

  get inputBlocked(): boolean {
    return this.countdown.active;
  }

  step(controls: Readonly<AircraftControls>, combat: Readonly<LocalCombat>, dt: number): void {
    if (this.over) return;
    this.tick++;
    this.kaijuVersion = this.defenseVersion = this.defenseTick = this.viewTick = this.tick;
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
    this.playTicks++;
    arena.endTick(dt);
    this.raid?.step(dt);
    this.defense?.step(dt);
    collectAllMissiles(this.arena, this.defense, this.missiles, this.missilePool);
    this.missileVersion++;
    if (this.tick % this.stateEvery === 0) this.broadcastState();
    // レイドは怪獣を倒すか街に到達されたら終わり（撃墜数・制限時間は使わない）
    const outcome = this.raid?.outcome ?? this.defense?.outcome ?? RAID_OUTCOME.none;
    const ended =
      this.raid || this.defense
        ? outcome !== RAID_OUTCOME.none && outcome !== DEFENSE_OUTCOME.none
        : this.match.step(dt, arena.all) !== null;
    if (ended || this.scoreDirty || this.tick % this.scoreEvery === 0) this.sendScore(ended);
    if (ended) {
      this.over = true;
      // 壊れた建物を配り切ってから終わりを知らせる（確実な経路は順番どおり。守れた建物 % が全員で一致する）
      this.sendRuins();
      // 7-2: 防衛戦は over に結果（施設のビット・クリアした波・司令部の HP）を入れる（state より後に届いても全員で一致する）
      const over = overEvent(this.defense, outcome, this.tick, this.playTicks);
      this.room.endMatch(this.tick, outcome, this.playTicks, over);
      this.emitEvent(over);
    }
  }

  /** レイドの怪獣の状態（6-2。表示は本体を直接読むので、ここはテスト・クライアントと同じ口のため） */
  get kaiju(): KaijuStateMsg | null {
    return this.raid?.state() ?? null;
  }

  /** 防衛戦の状態（7-2。ホスト自身の表示は戦闘機を全部） */
  get defenseState(): DefenseStateMsg | null {
    return this.defense?.state(true) ?? null;
  }

  /** 対戦が終わったか */
  get finished(): boolean {
    return this.over;
  }

  /** 成績（全員） */
  score(over: boolean): ScoreMsg {
    return scoreMsg(this.arena.all, this.raid, this.match.remainingSeconds, over);
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
    if (e.kind === 'kill') this.scoreDirty = true;
    if (e.kind === 'flare') this.defense?.flare(e.a);
    this.sendEvent(eventMsg(e.kind, e.a, e.b, this.tick, n, e.x, e.y, e.z));
  };

  private sendRuins(): void {
    const ruins = takeRuins(this.raid);
    if (ruins) this.room.broadcast(ruins, 'reliable');
  }

  private broadcastState(): void {
    this.sendRuins();
    const seqOf = (id: number): number => this.remotes.get(id)?.input.lastApplied ?? 0;
    const kaiju = this.raid?.state() ?? null;
    const defense = this.defense?.state(false) ?? null;
    const msg = stateMsg(
      this.tick,
      this.arena.all,
      seqOf,
      this.missiles,
      kaiju,
      this.msgs,
      defense,
    );
    this.room.broadcast(msg, 'unordered');
    this.sent.hit(this.now());
  }

  /** 参加者の機体を固定ステップの間で補間する */
  samples(alpha: number): readonly RemoteSample[] {
    const list = this.list;
    list.length = 0;
    for (const r of this.remotes.values()) list.push(interpolateSample(r.fighter, r.sample, alpha));
    return list;
  }

  /** テスト用: 参加者の機体（ホストの正）と最後に使った入力の seq */
  aircraftOf = (id: number): Aircraft | null => this.arena.fighters.get(id)?.aircraft ?? null;
  lastInputSeq = (id: number): number => this.remotes.get(id)?.input.lastApplied ?? 0;

  stats(nowMs: number): NetStats {
    return hostStats(
      this.remotes.values(),
      (id) => this.room.rtt(id),
      this.tick,
      this.sent.rate(nowMs),
    );
  }
}
