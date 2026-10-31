// ホストの送る状態の組み立て（5-3。host-game.ts から分けた）: 機体の数値、機体の状態、ミサイルの状態。
// 5-4: 描画用の補間・止める・?netdebug の値も host-game.ts から分けた。Three.js 非依存
import type { Missile } from '../combat/missile';
import type { Pool } from '../combat/pool';
import { PvpFighter, type FighterSpec } from '../combat/pvp-fighter';
import type { Aircraft } from '../entities/aircraft';
import { copyQuat, copyVec3 } from '../flight/math';
import type { Loadout } from '../progression/loadout';
import type { InputBuffer } from './input-buffer';
import type { NetStats, RemoteSample } from './net-game';
import { slerp } from './sync';
import {
  NO_PART,
  NO_TARGET,
  type AircraftStateMsg,
  type DefenseStateMsg,
  type KaijuStateMsg,
  type MissileStateMsg,
  type StateMsg,
} from './protocol';

export function fighterSpec(l: Readonly<Loadout>): FighterSpec {
  const h = l.flight.hull;
  return {
    maxHp: h.maxHp,
    hitRadius: h.hitRadius,
    visualRadius: h.visualRadius,
    gunDamage: l.gunDamage,
    missiles: l.missiles,
    flares: l.flares,
    targeting: l.targeting,
  };
}

/** ホストのミサイルを状態のメッセージの形で out に並べる（入れ物は spare を使い回す） */
export function collectMissiles(
  pool: Pool<Missile>,
  out: MissileStateMsg[],
  spare: MissileStateMsg[],
  /** netId に使うビット（7-2: 防衛戦は 0x7f。上のビットは敵のミサイル） */
  netIdMask = 0xff,
): void {
  out.length = 0;
  for (let i = 0; i < pool.count; i++) {
    const m = pool.get(i);
    const msg = spare[i] ?? {
      netId: 0,
      owner: 0,
      targetId: NO_TARGET,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
    };
    spare[i] = msg;
    msg.netId = m.serial & netIdMask;
    msg.owner = m.owner;
    msg.targetId = m.target instanceof PvpFighter ? m.target.id : NO_TARGET;
    msg.position.x = m.position.x;
    msg.position.y = m.position.y;
    msg.position.z = m.position.z;
    msg.velocity.x = m.velocity.x;
    msg.velocity.y = m.velocity.y;
    msg.velocity.z = m.velocity.z;
    out.push(msg);
  }
}

const velocity = { x: 0, y: 0, z: 0 };

export function stateOf(f: PvpFighter, seq: number): AircraftStateMsg {
  const a = f.aircraft;
  const s = a.state;
  a.velocity(velocity);
  return {
    id: f.id,
    alive: f.alive,
    afterburner: s.afterburnerActive,
    invulnerable: f.invulnerable,
    lockPart: f.lockPart < 0 ? NO_PART : f.lockPart,
    lastInputSeq: seq,
    position: s.position,
    orientation: s.orientation,
    velocity: { ...velocity },
    speed: s.speed,
    throttle: a.throttle,
    hp: f.hp,
  };
}

/** 状態のメッセージ（全機・ミサイル・怪獣。機体の入れ物は msgs を使い回す。ホスト自身の seq は 0） */
export function stateMsg(
  tick: number,
  fighters: readonly PvpFighter[],
  seqOf: (id: number) => number,
  missiles: MissileStateMsg[],
  kaiju: KaijuStateMsg | null,
  msgs: AircraftStateMsg[],
  defense: DefenseStateMsg | null = null,
): StateMsg {
  msgs.length = 0;
  for (const f of fighters) msgs.push(stateOf(f, f.id === 0 ? 0 : seqOf(f.id)));
  return { type: 'state', tick, aircraft: msgs, missiles, kaiju, defense };
}

/** ホストの機体を固定ステップの間で補間して描画用の値に入れる */
export function interpolateSample(f: PvpFighter, out: RemoteSample, alpha: number): RemoteSample {
  const a = f.aircraft;
  const p = a.state.position;
  const q = a.prevPosition;
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
  return out;
}

/** 止める（前の位置のまま。補間の線が伸びないよう prev も合わせる） */
export function holdAircraft(a: Aircraft): void {
  copyVec3(a.prevPosition, a.state.position);
  copyQuat(a.prevOrientation, a.state.orientation);
}

/** ?netdebug のホストの値（参加者の入力の溜め・推測・遅延補償の巻き戻し） */
export function hostStats(
  remotes: Iterable<{ readonly id: number; readonly input: InputBuffer }>,
  rttOf: (id: number) => number | null,
  tick: number,
  stateRate: number,
): NetStats {
  let rtt = 0;
  let n = 0;
  let backlog = 0;
  let guessed = 0;
  let starved = 0;
  let resyncs = 0;
  let rewind = 0;
  for (const r of remotes) {
    const v = rttOf(r.id);
    if (v !== null) {
      rtt += v;
      n++;
    }
    backlog = Math.max(backlog, r.input.backlog);
    guessed += r.input.guessed;
    starved += r.input.starved;
    resyncs += r.input.resyncs;
    const off = r.input.viewOffset;
    if (off !== null) rewind = Math.max(rewind, tick - (r.input.lastApplied + off));
  }
  return {
    role: 'host',
    rttMs: n > 0 ? rtt / n : null,
    stateRate,
    interpDelayMs: 0,
    bufferMarginMs: 0,
    extrapolating: 0,
    corrections: 0,
    inputBacklog: backlog,
    inputGuessed: guessed,
    inputStarved: starved,
    inputResyncs: resyncs,
    rewindMs: (rewind * 1000) / 60,
  };
}
