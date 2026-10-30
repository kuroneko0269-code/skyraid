// P2P のメッセージ（5-1）の型と直列化。すべて ArrayBuffer（ビッグエンディアン）。先頭 1 バイトが種類。
// join / welcome / event は確実に届く経路、input / state / ping は順不同の経路で送る（transport.ts）。
// 位置は float32、姿勢は smallest-three（6 バイト）、速度ベクトルは 1/16 m/s 単位の int16。Three.js 非依存
import type { Quat, Vec3 } from '../flight/math';
import { ByteReader, ByteWriter, readQuat, writeQuat } from './codec';
import { readControls, writeControls, type NetControls } from './net-controls';

export { createNetControls, quantizeControls, type NetControls } from './net-controls';

/** ホストのゲーム設定（welcome で配る。時間と撃墜数の上限は 5-4 の勝敗で使う） */
export interface GameSettings {
  mapId: string;
  timeLimitSeconds: number;
  scoreLimit: number;
}

export interface PlayerInfo {
  /** 0〜3。ホストは 0。色もこれで決まる */
  id: number;
  name: string;
  aircraftId: string;
}

export interface UpgradeLevelsMsg {
  engine: number;
  airframe: number;
  weapons: number;
  avionics: number;
}

export interface JoinMsg {
  type: 'join';
  version: number;
  name: string;
  aircraftId: string;
  upgrades: UpgradeLevelsMsg;
}

export const WELCOME_STATUS = ['ok', 'full', 'started', 'version'] as const;
export type WelcomeStatus = (typeof WELCOME_STATUS)[number];

/** 参加の返事と、ロビーの名簿（名簿が変わるたびに全員へ送り直す） */
export interface WelcomeMsg {
  type: 'welcome';
  status: WelcomeStatus;
  /** 受け取った人の ID（status が ok でなければ 0） */
  yourId: number;
  settings: GameSettings;
  players: PlayerInfo[];
}

/** 入力（クライアント → ホスト、30Hz）。controls[0] が seq（最新）、controls[i] が seq - i のステップ */
export interface InputMsg {
  type: 'input';
  seq: number;
  controls: NetControls[];
}

export interface AircraftStateMsg {
  id: number;
  alive: boolean;
  afterburner: boolean;
  /** ホストがこの機体に使った最後の入力の seq（ホスト自身の機体は 0） */
  lastInputSeq: number;
  position: Vec3;
  orientation: Quat;
  velocity: Vec3;
  /** 進行方向の速さ（m/s。失速の沈下を含まない。自機の補正に使う） */
  speed: number;
  /** スロットル位置 0〜1 */
  throttle: number;
  hp: number;
}

/** 状態（ホスト → 全員、15Hz）。tick はホストの固定ステップの番号（60Hz） */
export interface StateMsg {
  type: 'state';
  tick: number;
  aircraft: AircraftStateMsg[];
}

export const EVENT_KINDS = ['start', 'end', 'fire', 'kill'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** できごと。start: 飛行開始 / end: セッション終了（a = 理由）/ fire: 発射（a = 撃った人）/ kill: 撃墜（a = 撃墜した人、b = された人） */
export interface EventMsg {
  type: 'event';
  kind: EventKind;
  a: number;
  b: number;
  /** できごとの時刻（ホストの tick） */
  tick: number;
}

/** 生存確認と RTT。pong は受け取った ping の nonce と time をそのまま返す */
export interface PingMsg {
  type: 'ping';
  pong: boolean;
  nonce: number;
  /** 送った側の時計（ms） */
  time: number;
}

export type NetMessage = JoinMsg | WelcomeMsg | InputMsg | StateMsg | EventMsg | PingMsg;

const TYPE_IDS = { join: 1, welcome: 2, input: 3, state: 4, event: 5, ping: 6 } as const;
/** 速度ベクトルの単位（1/16 m/s。int16 で ±2047 m/s） */
const VELOCITY_SCALE = 16;
const FLAG_ALIVE = 1;
const FLAG_AB_STATE = 2;

function packVelocity(v: number): number {
  return Math.round(Math.min(32767, Math.max(-32767, v * VELOCITY_SCALE)));
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
      for (const p of msg.players) w.u8(p.id).str(p.name).str(p.aircraftId);
      break;
    case 'input':
      w.u32(msg.seq).u8(msg.controls.length);
      for (const c of msg.controls) writeControls(w, c);
      break;
    case 'state':
      w.u32(msg.tick).u8(msg.aircraft.length);
      for (const a of msg.aircraft) {
        w.u8(a.id).u8((a.alive ? FLAG_ALIVE : 0) | (a.afterburner ? FLAG_AB_STATE : 0));
        w.u32(a.lastInputSeq);
        w.f32(a.position.x).f32(a.position.y).f32(a.position.z);
        writeQuat(w, a.orientation);
        w.i16(packVelocity(a.velocity.x));
        w.i16(packVelocity(a.velocity.y));
        w.i16(packVelocity(a.velocity.z));
        w.f32(a.speed);
        w.u8(Math.round(Math.min(1, Math.max(0, a.throttle)) * 255));
        w.u16(Math.round(Math.min(65535, Math.max(0, a.hp))));
      }
      break;
    case 'event':
      w.u8(EVENT_KINDS.indexOf(msg.kind)).u8(msg.a).u8(msg.b).u32(msg.tick);
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
      for (let i = 0; i < n; i++) players.push({ id: r.u8(), name: r.str(), aircraftId: r.str() });
      return { type: 'welcome', status, yourId, settings, players };
    }
    case TYPE_IDS.input: {
      const seq = r.u32();
      const n = r.u8();
      const controls: NetControls[] = [];
      for (let i = 0; i < n; i++) controls.push(readControls(r));
      return { type: 'input', seq, controls };
    }
    case TYPE_IDS.state: {
      const tick = r.u32();
      const n = r.u8();
      const aircraft: AircraftStateMsg[] = [];
      for (let i = 0; i < n; i++) aircraft.push(readAircraft(r));
      return { type: 'state', tick, aircraft };
    }
    case TYPE_IDS.event: {
      const kind = EVENT_KINDS[r.u8()];
      if (!kind) return null;
      return { type: 'event', kind, a: r.u8(), b: r.u8(), tick: r.u32() };
    }
    case TYPE_IDS.ping:
      return { type: 'ping', pong: r.u8() === 1, nonce: r.u32(), time: r.f64() };
    default:
      return null;
  }
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
    lastInputSeq,
    position,
    orientation,
    velocity,
    speed,
    throttle,
    hp,
  };
}
