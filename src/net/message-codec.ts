// P2P のメッセージの直列化（5-1。5-3 で protocol.ts から分けた）。ArrayBuffer（ビッグエンディアン）、先頭 1 バイトが種類。
// 位置は float32、姿勢は smallest-three（6 バイト）、速度ベクトルは 1/16 m/s 単位の int16。Three.js 非依存
import { PVP_CONFIG } from '../data/pvp';
import { ByteReader, ByteWriter, readQuat, writeQuat } from './codec';
import {
  NO_TARGET as NO_TARGET_ID,
  readControls,
  writeControls,
  type NetControls,
} from './net-controls';
import {
  EVENT_KINDS,
  WELCOME_STATUS,
  type AircraftStateMsg,
  type MissileStateMsg,
  type NetMessage,
  type PlayerInfo,
  type ScoreEntry,
} from './protocol';

const TYPE_IDS = { join: 1, welcome: 2, input: 3, state: 4, event: 5, ping: 6, score: 7 } as const;
/** 速度ベクトルの単位（1/16 m/s。int16 で ±2047 m/s） */
const VELOCITY_SCALE = 16;
const FLAG_ALIVE = 1;
const FLAG_AB_STATE = 2;
const FLAG_INVULNERABLE = 4;
const MISSILE_STEP = PVP_CONFIG.missilePositionStep;

function packVelocity(v: number): number {
  return Math.round(Math.min(32767, Math.max(-32767, v * VELOCITY_SCALE)));
}

function packMissilePosition(v: number): number {
  return Math.round(Math.min(32767, Math.max(-32767, v / MISSILE_STEP)));
}

function clamp16(v: number): number {
  return Math.round(Math.min(65535, Math.max(0, v)));
}

export function encodeMessage(msg: NetMessage): ArrayBuffer {
  const w = new ByteWriter();
  w.u8(TYPE_IDS[msg.type]);
  switch (msg.type) {
    case 'join':
      w.u8(msg.version).str(msg.name).str(msg.aircraftId);
      w.u8(msg.upgrades.engine).u8(msg.upgrades.airframe);
      w.u8(msg.upgrades.weapons).u8(msg.upgrades.avionics);
      break;
    case 'welcome':
      w.u8(WELCOME_STATUS.indexOf(msg.status)).u8(msg.yourId);
      w.str(msg.settings.mapId).u16(msg.settings.timeLimitSeconds).u8(msg.settings.scoreLimit);
      w.u8(msg.players.length);
      for (const p of msg.players) w.u8(p.id).str(p.name).str(p.aircraftId).u16(clamp16(p.maxHp));
      break;
    case 'input':
      w.u32(msg.seq).u32(msg.viewTick).u8(msg.controls.length);
      for (const c of msg.controls) writeControls(w, c);
      break;
    case 'state':
      w.u32(msg.tick).u8(msg.aircraft.length);
      for (const a of msg.aircraft) {
        w.u8(a.id).u8(
          (a.alive ? FLAG_ALIVE : 0) |
            (a.afterburner ? FLAG_AB_STATE : 0) |
            (a.invulnerable ? FLAG_INVULNERABLE : 0),
        );
        w.u32(a.lastInputSeq);
        w.f32(a.position.x).f32(a.position.y).f32(a.position.z);
        writeQuat(w, a.orientation);
        w.i16(packVelocity(a.velocity.x));
        w.i16(packVelocity(a.velocity.y));
        w.i16(packVelocity(a.velocity.z));
        w.f32(a.speed);
        w.u8(Math.round(Math.min(1, Math.max(0, a.throttle)) * 255));
        w.u16(clamp16(a.hp));
      }
      // ミサイル 1 発 14 バイト: netId・撃った人（下位 2 ビット）と目標（上位。7 はなし）・位置・速度
      w.u8(msg.missiles.length);
      for (const m of msg.missiles) {
        const target = m.targetId === NO_TARGET_ID ? 7 : m.targetId & 3;
        w.u8(m.netId & 0xff).u8((m.owner & 3) | (target << 2));
        w.i16(packMissilePosition(m.position.x));
        w.i16(packMissilePosition(m.position.y));
        w.i16(packMissilePosition(m.position.z));
        w.i16(packVelocity(m.velocity.x));
        w.i16(packVelocity(m.velocity.y));
        w.i16(packVelocity(m.velocity.z));
      }
      break;
    case 'event':
      w.u8(EVENT_KINDS.indexOf(msg.kind)).u8(msg.a).u8(msg.b).u32(msg.tick).u32(msg.n);
      w.f32(msg.x).f32(msg.y).f32(msg.z);
      break;
    case 'score':
      w.u16(clamp16(msg.remainingSeconds * 10))
        .u8(msg.over ? 1 : 0)
        .u8(msg.players.length);
      for (const p of msg.players) {
        w.u8(p.id).u8(Math.min(255, p.kills)).u8(Math.min(255, p.deaths));
        w.u16(clamp16(p.shots)).u16(clamp16(p.hits));
      }
      break;
    case 'ping':
      w.u8(msg.pong ? 1 : 0)
        .u32(msg.nonce)
        .f64(msg.time);
      break;
  }
  return w.finish();
}

/** 壊れている・知らない種類なら null */
export function decodeMessage(data: ArrayBuffer): NetMessage | null {
  try {
    const r = new ByteReader(data);
    const msg = decodeBody(r);
    return msg && r.remaining === 0 ? msg : null;
  } catch {
    return null;
  }
}

function decodeBody(r: ByteReader): NetMessage | null {
  const type = r.u8();
  switch (type) {
    case TYPE_IDS.join: {
      const version = r.u8();
      const name = r.str();
      const aircraftId = r.str();
      const upgrades = { engine: r.u8(), airframe: r.u8(), weapons: r.u8(), avionics: r.u8() };
      return { type: 'join', version, name, aircraftId, upgrades };
    }
    case TYPE_IDS.welcome: {
      const status = WELCOME_STATUS[r.u8()];
      if (!status) return null;
      const yourId = r.u8();
      const settings = { mapId: r.str(), timeLimitSeconds: r.u16(), scoreLimit: r.u8() };
      const n = r.u8();
      const players: PlayerInfo[] = [];
      for (let i = 0; i < n; i++)
        players.push({ id: r.u8(), name: r.str(), aircraftId: r.str(), maxHp: r.u16() });
      return { type: 'welcome', status, yourId, settings, players };
    }
    case TYPE_IDS.input: {
      const seq = r.u32();
      const viewTick = r.u32();
      const n = r.u8();
      const controls: NetControls[] = [];
      for (let i = 0; i < n; i++) controls.push(readControls(r));
      return { type: 'input', seq, viewTick, controls };
    }
    case TYPE_IDS.state: {
      const tick = r.u32();
      const n = r.u8();
      const aircraft: AircraftStateMsg[] = [];
      for (let i = 0; i < n; i++) aircraft.push(readAircraft(r));
      const m = r.u8();
      const missiles: MissileStateMsg[] = [];
      for (let i = 0; i < m; i++) missiles.push(readMissile(r));
      return { type: 'state', tick, aircraft, missiles };
    }
    case TYPE_IDS.event: {
      const kind = EVENT_KINDS[r.u8()];
      if (!kind) return null;
      const a = r.u8();
      const b = r.u8();
      const tick = r.u32();
      const n = r.u32();
      return { type: 'event', kind, a, b, tick, n, x: r.f32(), y: r.f32(), z: r.f32() };
    }
    case TYPE_IDS.score: {
      const remainingSeconds = r.u16() / 10;
      const over = r.u8() === 1;
      const n = r.u8();
      const players: ScoreEntry[] = [];
      for (let i = 0; i < n; i++)
        players.push({ id: r.u8(), kills: r.u8(), deaths: r.u8(), shots: r.u16(), hits: r.u16() });
      return { type: 'score', remainingSeconds, over, players };
    }
    case TYPE_IDS.ping:
      return { type: 'ping', pong: r.u8() === 1, nonce: r.u32(), time: r.f64() };
    default:
      return null;
  }
}

function readMissile(r: ByteReader): MissileStateMsg {
  const netId = r.u8();
  const packed = r.u8();
  const target = packed >> 2;
  const position = {
    x: r.i16() * MISSILE_STEP,
    y: r.i16() * MISSILE_STEP,
    z: r.i16() * MISSILE_STEP,
  };
  const velocity = {
    x: r.i16() / VELOCITY_SCALE,
    y: r.i16() / VELOCITY_SCALE,
    z: r.i16() / VELOCITY_SCALE,
  };
  return {
    netId,
    owner: packed & 3,
    targetId: target === 7 ? NO_TARGET_ID : target,
    position,
    velocity,
  };
}

function readAircraft(r: ByteReader): AircraftStateMsg {
  const id = r.u8();
  const flags = r.u8();
  const lastInputSeq = r.u32();
  const position = { x: r.f32(), y: r.f32(), z: r.f32() };
  const orientation = readQuat(r, { x: 0, y: 0, z: 0, w: 1 });
  const velocity = {
    x: r.i16() / VELOCITY_SCALE,
    y: r.i16() / VELOCITY_SCALE,
    z: r.i16() / VELOCITY_SCALE,
  };
  const speed = r.f32();
  const throttle = r.u8() / 255;
  const hp = r.u16();
  return {
    id,
    alive: (flags & FLAG_ALIVE) !== 0,
    afterburner: (flags & FLAG_AB_STATE) !== 0,
    invulnerable: (flags & FLAG_INVULNERABLE) !== 0,
    lastInputSeq,
    position,
    orientation,
    velocity,
    speed,
    throttle,
    hp,
  };
}
