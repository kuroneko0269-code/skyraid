// PvP の飛行の共通部分（5-1）: 開始位置、他機の表示用の値、通信の計測値。
// ホストは host-game.ts、クライアントは client-game.ts。Three.js 非依存
import { NET_CONFIG } from '../data/net';
import { WORLD_CONFIG } from '../data/terrain';
import type { AircraftControls } from '../entities/aircraft';
import type { Quat, Vec3 } from '../flight/math';
import type { NetControls } from './protocol';

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
  };
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
}

/** PvP の飛行（ホスト・クライアント共通の口） */
export interface NetGame {
  readonly localId: number;
  /** 固定ステップ 1 回分（自機の操作） */
  step(controls: Readonly<AircraftControls>, dt: number): void;
  /** 他機の描画用の値。alpha は固定ステップの間の位置（ホスト）、nowMs は今の時刻（クライアントの補間） */
  samples(alpha: number, nowMs: number): readonly RemoteSample[];
  stats(nowMs: number): NetStats;
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
