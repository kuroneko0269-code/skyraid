// ホストの送る状態の組み立て（5-3。host-game.ts から分けた）: 機体の数値、機体の状態、ミサイルの状態。Three.js 非依存
import type { Missile } from '../combat/missile';
import type { Pool } from '../combat/pool';
import { PvpFighter, type FighterSpec } from '../combat/pvp-fighter';
import type { Loadout } from '../progression/loadout';
import { NO_TARGET, type AircraftStateMsg, type MissileStateMsg } from './protocol';

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
    msg.netId = m.serial & 0xff;
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
    lastInputSeq: seq,
    position: s.position,
    orientation: s.orientation,
    velocity: { ...velocity },
    speed: s.speed,
    throttle: a.throttle,
    hp: f.hp,
  };
}
