// ロビーの部分の直列化（5-4。message-codec.ts から分けた）: 設定・名簿の 1 人・強化 Lv。Three.js 非依存
import type { ByteReader, ByteWriter } from './codec';
import type { GameSettings, PlayerInfo, UpgradeLevelsMsg } from './protocol';
import { AIRCRAFT_MODELS } from '../data/aircraft';
import {
  PAINT_BYTES,
  decodePaint,
  defaultPaint,
  encodePaint,
  type Paint,
} from '../progression/paint';

// 設定・名簿・ロビーの真偽値のビット（5-4）
const SET_TEAM = 1;
const SET_NO_UPGRADES = 2;
const SET_ROOKIE = 4;
const SET_RAID = 8;
const SET_HARD = 16;
/** 防衛戦（7-2） */
const SET_DEFENSE = 32;
/** 補正の狙いの補助・自動射撃（9-3） */
const SET_AIM_ASSIST = 64;
const SET_AUTO_FIRE = 128;
export const PL_READY = 1;
export const PL_AGAIN = 2;
const PL_AWAY = 4;

export function writeUpgrades(w: ByteWriter, u: Readonly<UpgradeLevelsMsg>): void {
  w.u8(u.engine).u8(u.airframe).u8(u.weapons).u8(u.avionics);
}

export function readUpgrades(r: ByteReader): UpgradeLevelsMsg {
  return { engine: r.u8(), airframe: r.u8(), weapons: r.u8(), avionics: r.u8() };
}

/** 塗装（7-3）: 14 バイト（1 人 16 バイト以内）。壊れていれば初期機の初期の塗装 */
export function writePaint(w: ByteWriter, p: Readonly<Paint>): void {
  for (const b of encodePaint(p)) w.u8(b);
}

export function readPaint(r: ByteReader): Paint {
  const b = new Uint8Array(PAINT_BYTES);
  for (let i = 0; i < PAINT_BYTES; i++) b[i] = r.u8();
  const p = decodePaint(b);
  if (p) return p;
  const shape = AIRCRAFT_MODELS[0]?.shape;
  if (!shape) throw new Error('no aircraft definitions');
  return defaultPaint(shape, 0);
}

export function writeSettings(w: ByteWriter, s: Readonly<GameSettings>): void {
  w.str(s.mapId).u16(s.timeLimitSeconds).u8(s.scoreLimit);
  w.u8(
    (s.mode === 'team'
      ? SET_TEAM
      : s.mode === 'raid'
        ? SET_RAID
        : s.mode === 'defense'
          ? SET_DEFENSE
          : 0) |
      (s.noUpgrades ? SET_NO_UPGRADES : 0) |
      (s.rookieGuard ? SET_ROOKIE : 0) |
      (s.hard ? SET_HARD : 0) |
      (s.aimAssist ? SET_AIM_ASSIST : 0) |
      (s.autoFire ? SET_AUTO_FIRE : 0),
  );
  // 7-5: 天候
  w.str(s.weather);
}

export function readSettings(r: ByteReader): GameSettings {
  const mapId = r.str();
  const timeLimitSeconds = r.u16();
  const scoreLimit = r.u8();
  const f = r.u8();
  const weather = r.str();
  return {
    mapId,
    timeLimitSeconds,
    scoreLimit,
    mode: f & SET_TEAM ? 'team' : f & SET_RAID ? 'raid' : f & SET_DEFENSE ? 'defense' : 'ffa',
    noUpgrades: (f & SET_NO_UPGRADES) !== 0,
    rookieGuard: (f & SET_ROOKIE) !== 0,
    hard: (f & SET_HARD) !== 0,
    weather,
    aimAssist: (f & SET_AIM_ASSIST) !== 0,
    autoFire: (f & SET_AUTO_FIRE) !== 0,
  };
}

export function writePlayer(w: ByteWriter, p: Readonly<PlayerInfo>): void {
  w.u8(p.id).str(p.name).str(p.aircraftId);
  writePaint(w, p.paint);
  w.u16(Math.round(Math.min(65535, Math.max(0, p.maxHp)))).u8(p.team);
  w.u8((p.ready ? PL_READY : 0) | (p.again ? PL_AGAIN : 0) | (p.away ? PL_AWAY : 0));
}

export function readPlayer(r: ByteReader): PlayerInfo {
  const id = r.u8();
  const name = r.str();
  const aircraftId = r.str();
  const paint = readPaint(r);
  const maxHp = r.u16();
  const team = r.u8();
  const f = r.u8();
  return {
    id,
    name,
    aircraftId,
    paint,
    maxHp,
    team,
    ready: (f & PL_READY) !== 0,
    again: (f & PL_AGAIN) !== 0,
    away: (f & PL_AWAY) !== 0,
  };
}
