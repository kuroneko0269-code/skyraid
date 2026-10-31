// ロビーの判定（5-4）: 開始できるか（全員 Ready・再接続待ちなし・チーム戦は両チームに 1 人以上）、
// チームの自動割当、全員が「もう一度」を押したか。ホストもクライアントも同じ判定で表示する。Three.js・DOM 非依存
import { RAID_CONFIG } from '../data/kaiju';
import { findMap, SELECTABLE_MAPS } from '../data/maps';
import type { PvpMode } from '../data/pvp';
import { NET_CONFIG } from '../data/net';
import { DEFAULT_WEATHER_ID, isWeatherId, RAID_COOP_DEFAULT_WEATHER } from '../data/weather';
import type { GameSettings, PlayerInfo, UpgradeLevelsMsg } from './protocol';
import type { PlayerProfile } from './room-code';

/** 開始できない理由（null は開始できる） */
export type StartBlock = 'players' | 'ready' | 'away' | 'teams' | null;

type Roster = readonly Readonly<PlayerInfo>[];

/** 準備できているか（ホストは Ready 不要） */
export function isReady(p: Readonly<PlayerInfo>): boolean {
  return p.id === 0 || p.ready;
}

/** ホストの「開始」を押せるか。押せなければ理由 */
export function startBlock(players: Roster, mode: PvpMode): StartBlock {
  if (players.length < 2) return 'players';
  if (players.some((p) => p.away)) return 'away';
  if (!players.every(isReady)) return 'ready';
  if (mode === 'team') {
    const a = players.filter((p) => p.team === 0).length;
    if (a === 0 || a === players.length) return 'teams';
  }
  return null;
}

/** チームの自動割当: ID 順に A・B・A・B（2 対 2。3 人なら 2 対 1） */
export function autoTeams(players: Roster): Map<number, number> {
  const out = new Map<number, number>();
  [...players]
    .sort((a, b) => a.id - b.id)
    .forEach((p, i) => {
      out.set(p.id, i % 2);
    });
  return out;
}

/** 新しく入った人のチーム: 人数の少ない方（同じなら A） */
export function teamForNewcomer(players: Roster): number {
  const a = players.filter((p) => p.team === 0).length;
  return a <= players.length - a ? 0 : 1;
}

/** 全員が「もう一度」を押したか（リザルト → ロビー） */
export function allAgain(players: Roster): boolean {
  return players.length > 0 && players.every((p) => p.again);
}

/** 同じ側か（個人戦は本人だけ、チーム戦は同じチーム） */
export function sameSide(
  a: number,
  b: number,
  mode: PvpMode,
  teamOf: (id: number) => number | undefined,
): boolean {
  if (a === b || mode === 'raid' || mode === 'defense') return true;
  if (mode !== 'team') return false;
  const ta = teamOf(a);
  return ta !== undefined && ta === teamOf(b);
}

/** 名簿の 1 人を作る（「もう一度」は押した扱い: 対戦の後のリザルトを見ている人を新しく入った人で待たせない） */
export function newPlayer(
  id: number,
  p: Readonly<PlayerProfile>,
  maxHp: number,
  team: number,
  ready: boolean,
): PlayerInfo {
  return {
    id,
    name: p.name,
    aircraftId: p.aircraftId,
    maxHp,
    team,
    ready,
    again: true,
    away: false,
  };
}

export function sameUpgrades(
  u: Readonly<UpgradeLevelsMsg>,
  v: Readonly<UpgradeLevelsMsg>,
): boolean {
  return (
    u.engine === v.engine &&
    u.airframe === v.airframe &&
    u.weapons === v.weapons &&
    u.avionics === v.avionics
  );
}

/** 定型文の間引き: 同じ人は intervalMs に 1 回まで */
export class ChatGate {
  private readonly last = new Map<number, number>();

  constructor(private readonly intervalMs: number) {}

  allow(from: number, nowMs: number): boolean {
    const t = this.last.get(from);
    if (t !== undefined && nowMs - t < this.intervalMs) return false;
    this.last.set(from, nowMs);
    return true;
  }
}

/**
 * 部屋を作るときの設定（6-2: モード選択の「レイド」の「協力」から作るならレイド。
 * 7-2: 「防衛戦」の「協力」ならマップと難易度もモード選択のもの。それ以外は既定）
 */
/** 防衛戦（7-2）の協力の部屋の初期設定（モード選択で選んだマップと難易度） */
export type DefensePreset = { readonly mapId: string; readonly hard: boolean } | null;

export function initialSettings(
  raid: boolean,
  defense: DefensePreset = null,
): GameSettings | undefined {
  if (defense)
    return {
      ...NET_CONFIG.defaultSettings,
      mode: 'defense',
      mapId: defense.mapId,
      hard: defense.hard,
    };
  return raid
    ? {
        ...NET_CONFIG.defaultSettings,
        mode: 'raid',
        mapId: RAID_CONFIG.mapId,
        weather: RAID_COOP_DEFAULT_WEATHER,
      }
    : undefined;
}

/**
 * ホストが選んだ設定をそろえる（6-4: レイドは港湾都市に固定、マップは選べるものだけ。
 * 7-5: 天候は知らない id なら初期値）
 */
export function normalizeSettings(s: GameSettings): GameSettings {
  const weather = isWeatherId(s.weather) ? s.weather : DEFAULT_WEATHER_ID;
  if (s.mode === 'raid') return { ...s, mapId: RAID_CONFIG.mapId, weather };
  // 7-2: 防衛戦は島か港湾都市（選べるマップと同じ）
  const ok = SELECTABLE_MAPS.some((m) => m.id === s.mapId);
  return ok ? { ...s, weather } : { ...s, mapId: NET_CONFIG.defaultSettings.mapId, weather };
}

/** ロビーに出すマップの名前（6-4） */
export function mapName(id: string): string {
  return findMap(id).name;
}
