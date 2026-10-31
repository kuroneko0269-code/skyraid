// PvP の飛行の共通部分（5-1）: 開始位置、他機の表示用の値、通信の計測値。
// ホストは host-game.ts、クライアントは client-game.ts。Three.js 非依存
import { NET_CONFIG } from '../data/net';
import { WORLD_CONFIG } from '../data/terrain';
import type { AircraftControls } from '../entities/aircraft';
import type { Quat, Vec3 } from '../flight/math';
import {
  NO_TARGET,
  type EventMsg,
  type MissileStateMsg,
  type NetControls,
  type ScoreMsg,
} from './protocol';

/** 開始位置（ID 0〜3 を島の沖合に横一列。機首は -Z） */
export function spawnPosition(id: number, out: Vec3): Vec3 {
  const s = WORLD_CONFIG.start;
  out.x = s.x + (id - (NET_CONFIG.maxPlayers - 1) / 2) * NET_CONFIG.spawn.spacing;
  out.y = s.y;
  out.z = s.z;
  return out;
}

export const SPAWN_ORIENTATION: Readonly<Quat> = { x: 0, y: 0, z: 0, w: 1 };

/** 他機 1 機の描画用の値（描画フレームごとに書き換える入れ物） */
export interface RemoteSample {
  id: number;
  aircraftId: string;
  readonly position: Vec3;
  readonly orientation: Quat;
  alive: boolean;
  afterburner: boolean;
  throttle: number;
  /** 速度（m/s）と速さ（見た目の機銃の弾・予測照準点。5-3） */
  readonly velocity: Vec3;
  speed: number;
  hp: number;
  /** 復帰後の無敵中（半透明） */
  invulnerable: boolean;
}

export function createRemoteSample(id: number, aircraftId: string): RemoteSample {
  return {
    id,
    aircraftId,
    position: { x: 0, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    alive: true,
    afterburner: false,
    throttle: 0,
    velocity: { x: 0, y: 0, z: 0 },
    speed: 0,
    hp: 0,
    invulnerable: false,
  };
}

/** 自機の戦闘の操作（5-3。ロックと対象は表示側 pvp-mirror.ts の索敵が決める） */
export interface LocalCombat {
  fire: boolean;
  missile: boolean;
  flare: boolean;
  targetNext: boolean;
  locked: boolean;
  /** 選んでいる対象の ID（NO_TARGET はなし） */
  targetId: number;
}

export function createLocalCombat(): LocalCombat {
  return {
    fire: false,
    missile: false,
    flare: false,
    targetNext: false,
    locked: false,
    targetId: NO_TARGET,
  };
}

/** 戦闘の結果の受け口（5-3）。ホストは自分の判定、クライアントは届いたメッセージ */
export class NetGameEvents {
  private readonly eventFns: ((e: Readonly<EventMsg>) => void)[] = [];
  private readonly scoreFns: ((s: Readonly<ScoreMsg>) => void)[] = [];

  onEvent(fn: (e: Readonly<EventMsg>) => void): void {
    this.eventFns.push(fn);
  }

  onScore(fn: (s: Readonly<ScoreMsg>) => void): void {
    this.scoreFns.push(fn);
  }

  protected emitEvent(e: Readonly<EventMsg>): void {
    for (const fn of this.eventFns) fn(e);
  }

  protected emitScore(s: Readonly<ScoreMsg>): void {
    for (const fn of this.scoreFns) fn(s);
  }
}

/** ?netdebug の値 */
export interface NetStats {
  role: 'host' | 'client';
  /** 往復時間（ms。ホストは参加者の平均） */
  rttMs: number | null;
  /** 状態の受信（クライアント）・送信（ホスト）の回数 / 秒 */
  stateRate: number;
  /** 他機の表示の遅れ（ms。推定したホストの今 − 表示している時刻。ホストは 0） */
  interpDelayMs: number;
  /** 他機の最新の状態の時刻 − 表示時刻（ms。負なら外挿。他機のうち最小。ホストは 0） */
  bufferMarginMs: number;
  /** 外挿している他機の数 */
  extrapolating: number;
  /** 自機の補正の回数（クライアント） */
  corrections: number;
  /** ホストが溜めている入力の最大ステップ数 / 推測で埋めた数（ホスト） */
  inputBacklog: number;
  inputGuessed: number;
  /** 入力が切れて参加者の機体を止めたステップ数（ホスト） */
  inputStarved: number;
  /** 入力を溜め直した回数（ホスト） */
  inputResyncs: number;
  /** 遅延補償で巻き戻している量（ms。ホストは参加者の最大） */
  rewindMs: number;
}

/** PvP の飛行（ホスト・クライアント共通の口） */
export interface NetGame extends NetGameEvents {
  readonly localId: number;
  /** 固定ステップ 1 回分（自機の操作と戦闘の操作） */
  step(controls: Readonly<AircraftControls>, combat: Readonly<LocalCombat>, dt: number): void;
  /** 他機の描画用の値。alpha は固定ステップの間の位置（ホスト）、nowMs は今の時刻（クライアントの補間） */
  samples(alpha: number, nowMs: number): readonly RemoteSample[];
  stats(nowMs: number): NetStats;
  /** 飛んでいるミサイル（ホストの最新。missileVersion が変わったら新しい） */
  readonly missiles: readonly MissileStateMsg[];
  readonly missileVersion: number;
  /** 自機の HP（ホストの判定） */
  readonly ownHp: number;
}

/** 自機の操作と飛行の設定 → 通信の操作 */
export function toNetControls(
  out: NetControls,
  c: Readonly<AircraftControls>,
  options: { autoLevel: boolean; invertPitch: boolean },
): NetControls {
  out.pitch = c.pitch;
  out.roll = c.roll;
  out.yaw = c.yaw;
  out.throttle = c.throttle;
  out.throttleTarget = c.throttleTarget ?? null;
  out.afterburner = c.afterburner;
  out.autoLevel = options.autoLevel;
  out.invertPitch = options.invertPitch;
  return out;
}

/** 戦闘の操作を通信の操作に入れる */
export function applyCombat(out: NetControls, c: Readonly<LocalCombat>): NetControls {
  out.fire = c.fire;
  out.missile = c.missile;
  out.flare = c.flare;
  out.targetNext = c.targetNext;
  out.locked = c.locked;
  out.targetId = c.targetId;
  return out;
}

/** 直近 1 秒の回数を数える */
export class RateCounter {
  private readonly times: number[] = [];

  hit(nowMs: number): void {
    this.times.push(nowMs);
    this.trim(nowMs);
  }

  rate(nowMs: number): number {
    this.trim(nowMs);
    return this.times.length;
  }

  private trim(nowMs: number): void {
    while (this.times.length > 0 && (this.times[0] ?? 0) < nowMs - 1000) this.times.shift();
  }
}
