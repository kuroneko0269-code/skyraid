// P2P のメッセージの直列化（5-1。5-3 で protocol.ts から分けた）。ArrayBuffer（ビッグエンディアン）、先頭 1 バイトが種類。
// 位置は float32、姿勢は smallest-three（6 バイト）、速度ベクトルは 1/16 m/s 単位の int16。Three.js 非依存
import { PVP_CONFIG } from '../data/pvp';
import { ByteReader, ByteWriter, readQuat, writeQuat } from './codec';
import { readKaiju, writeKaiju } from './codec-kaiju';
import { readDefense, writeDefense } from './codec-defense';
import { readScore, writeScore } from './codec-score';
import {
  PL_AGAIN,
  PL_READY,
  readPlayer,
  readSettings,
  readUpgrades,
  writePlayer,
  writeSettings,
  writeUpgrades,
} from './codec-lobby';
import {
  NO_TARGET as NO_TARGET_ID,
  readControls,
  writeControls,
  type NetControls,
} from './net-controls';
import {
  ENEMY_OWNER,
  EVENT_KINDS,
  WELCOME_STATUS,
  type AircraftStateMsg,
  type MissileStateMsg,
  type NetMessage,
  type PlayerInfo,
} from './protocol';

const TYPE_IDS = {
  join: 1,
  welcome: 2,
  input: 3,
  state: 4,
  event: 5,
  ping: 6,
  score: 7,
  lobby: 8,
  chat: 9,
  ruin: 10,
} as const;
/** 速度ベクトルの単位（1/16 m/s。int16 で ±2047 m/s） */
const VELOCITY_SCALE = 16;
const FLAG_ALIVE = 1;
const FLAG_AB_STATE = 2;
const FLAG_INVULNERABLE = 4;
/** 6-6: ロックしている部位（3 ビット。7 はなし） */
const LOCK_SHIFT = 3;
/** 1 回の ruin に入れる建物の最大数 */
const RUIN_MAX = 1024;
/** ミサイルの撃った人のバイトの、防衛戦の敵のミサイルの印（7-2） */
const ENEMY_BIT = 0x20;
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
      writeUpgrades(w, msg.upgrades);
      w.u8(msg.resumeId).u32(msg.token);
      break;
    case 'welcome':
      w.u8(WELCOME_STATUS.indexOf(msg.status)).u8(msg.yourId).u32(msg.yourToken);
      w.u8(msg.inMatch ? 1 : 0);
      writeSettings(w, msg.settings);
      w.u8(msg.players.length);
      for (const p of msg.players) writePlayer(w, p);
      break;
    case 'lobby':
      w.u8((msg.ready ? PL_READY : 0) | (msg.again ? PL_AGAIN : 0)).str(msg.aircraftId);
      writeUpgrades(w, msg.upgrades);
      break;
    case 'chat':
      w.u8(msg.from).u8(msg.phrase);
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
            (a.invulnerable ? FLAG_INVULNERABLE : 0) |
            ((a.lockPart & 7) << LOCK_SHIFT),
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
        // 7-2: 防衛戦の敵のミサイルは ENEMY_BIT
        const owner = m.owner === ENEMY_OWNER ? ENEMY_BIT : m.owner & 3;
        w.u8(m.netId & 0xff).u8(owner | (target << 2));
        w.i16(packMissilePosition(m.position.x));
        w.i16(packMissilePosition(m.position.y));
        w.i16(packMissilePosition(m.position.z));
        w.i16(packVelocity(m.velocity.x));
        w.i16(packVelocity(m.velocity.y));
        w.i16(packVelocity(m.velocity.z));
      }
      writeKaiju(w, msg.kaiju);
      writeDefense(w, msg.defense);
      break;
    case 'event':
      w.u8(EVENT_KINDS.indexOf(msg.kind)).u8(msg.a).u8(msg.b).u32(msg.tick).u32(msg.n);
      w.f32(msg.x).f32(msg.y).f32(msg.z);
      break;
    case 'score':
      writeScore(w, msg);
      break;
    case 'ruin': {
      const ids = msg.ids.slice(0, RUIN_MAX);
      w.u16(ids.length);
      for (const id of ids) w.u16(clamp16(id));
      break;
    }
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
      const upgrades = readUpgrades(r);
      const resumeId = r.u8();
      const token = r.u32();
      return { type: 'join', version, name, aircraftId, upgrades, resumeId, token };
    }
    case TYPE_IDS.welcome: {
      const status = WELCOME_STATUS[r.u8()];
      if (!status) return null;
      const yourId = r.u8();
      const yourToken = r.u32();
      const inMatch = r.u8() === 1;
      const settings = readSettings(r);
      const n = r.u8();
      const players: PlayerInfo[] = [];
      for (let i = 0; i < n; i++) players.push(readPlayer(r));
      return { type: 'welcome', status, yourId, yourToken, inMatch, settings, players };
    }
    case TYPE_IDS.lobby: {
      const f = r.u8();
      const aircraftId = r.str();
      const upgrades = readUpgrades(r);
      return {
        type: 'lobby',
        ready: (f & PL_READY) !== 0,
        again: (f & PL_AGAIN) !== 0,
        aircraftId,
        upgrades,
      };
    }
    case TYPE_IDS.chat:
      return { type: 'chat', from: r.u8(), phrase: r.u8() };
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
      const kaiju = readKaiju(r);
      return { type: 'state', tick, aircraft, missiles, kaiju, defense: readDefense(r) };
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
    case TYPE_IDS.score:
      return readScore(r);
    case TYPE_IDS.ruin: {
      const n = Math.min(RUIN_MAX, r.u16());
      const ids: number[] = [];
      for (let i = 0; i < n; i++) ids.push(r.u16());
      return { type: 'ruin', ids };
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
    owner: (packed & ENEMY_BIT) !== 0 ? ENEMY_OWNER : packed & 3,
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
    lockPart: (flags >> LOCK_SHIFT) & 7,
    lastInputSeq,
    position,
    orientation,
    velocity,
    speed,
    throttle,
    hp,
  };
}
