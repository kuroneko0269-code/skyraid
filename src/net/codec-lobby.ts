// ロビーの部分の直列化（5-4。message-codec.ts から分けた）: 設定・名簿の 1 人・強化 Lv。Three.js 非依存
import type { ByteReader, ByteWriter } from './codec';
import type { GameSettings, PlayerInfo, UpgradeLevelsMsg } from './protocol';

// 設定・名簿・ロビーの真偽値のビット（5-4）
const SET_TEAM = 1;
const SET_NO_UPGRADES = 2;
const SET_ROOKIE = 4;
const SET_RAID = 8;
const SET_HARD = 16;
export const PL_READY = 1;
export const PL_AGAIN = 2;
const PL_AWAY = 4;

export function writeUpgrades(w: ByteWriter, u: Readonly<UpgradeLevelsMsg>): void {
  w.u8(u.engine).u8(u.airframe).u8(u.weapons).u8(u.avionics);
}

export function readUpgrades(r: ByteReader): UpgradeLevelsMsg {
  return { engine: r.u8(), airframe: r.u8(), weapons: r.u8(), avionics: r.u8() };
}

export function writeSettings(w: ByteWriter, s: Readonly<GameSettings>): void {
  w.str(s.mapId).u16(s.timeLimitSeconds).u8(s.scoreLimit);
  w.u8(
    (s.mode === 'team' ? SET_TEAM : s.mode === 'raid' ? SET_RAID : 0) |
      (s.noUpgrades ? SET_NO_UPGRADES : 0) |
      (s.rookieGuard ? SET_ROOKIE : 0) |
      (s.hard ? SET_HARD : 0),
  );
}

export function readSettings(r: ByteReader): GameSettings {
  const mapId = r.str();
  const timeLimitSeconds = r.u16();
  const scoreLimit = r.u8();
  const f = r.u8();
  return {
    mapId,
    timeLimitSeconds,
    scoreLimit,
    mode: f & SET_TEAM ? 'team' : f & SET_RAID ? 'raid' : 'ffa',
    noUpgrades: (f & SET_NO_UPGRADES) !== 0,
    rookieGuard: (f & SET_ROOKIE) !== 0,
    hard: (f & SET_HARD) !== 0,
  };
}

export function writePlayer(w: ByteWriter, p: Readonly<PlayerInfo>): void {
  w.u8(p.id).str(p.name).str(p.aircraftId);
  w.u16(Math.round(Math.min(65535, Math.max(0, p.maxHp)))).u8(p.team);
  w.u8((p.ready ? PL_READY : 0) | (p.again ? PL_AGAIN : 0) | (p.away ? PL_AWAY : 0));
}

export function readPlayer(r: ByteReader): PlayerInfo {
  const id = r.u8();
  const name = r.str();
  const aircraftId = r.str();
  const maxHp = r.u16();
  const team = r.u8();
  const f = r.u8();
  return {
    id,
    name,
    aircraftId,
    maxHp,
    team,
    ready: (f & PL_READY) !== 0,
    again: (f & PL_AGAIN) !== 0,
    away: (f & PL_AWAY) !== 0,
  };
}
