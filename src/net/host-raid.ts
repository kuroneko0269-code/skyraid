// ホストのレイドの部品（6-6。host-game.ts から分けた）: 怪獣の用意と復帰の位置、開始前（ブリーフィングとスキップ）、
// 成績（部位別の与ダメージ）、壊れた建物の配り方。Three.js 非依存
import type { BuildingField } from '../combat/buildings';
import type { PvpArena } from '../combat/pvp-arena';
import type { PvpFighter } from '../combat/pvp-fighter';
import { RAID_CONFIG } from '../data/kaiju';
import { NET_CONFIG } from '../data/net';
import { PVP_CONFIG } from '../data/pvp';
import { RAID_RULES } from '../data/raid';
import type { GroundHeightFn } from '../entities/aircraft';
import { PreStart } from './briefing';
import { spawnPosition } from './net-game';
import { RaidHost } from './raid-host';
import type { EventMsg, GameSettings, PlayerInfo, RuinMsg, ScoreEntry, ScoreMsg } from './protocol';

/** 開始前: レイドはブリーフィング（省略は 5 秒）→ カウントダウン（省略は 3 秒）。PvP はカウントダウンだけ */
export function preStart(raid: boolean, briefing?: number, countdown?: number): PreStart {
  return new PreStart(
    raid ? (briefing ?? RAID_RULES.briefingSeconds) : 0,
    countdown ?? PVP_CONFIG.countdownSeconds,
    NET_CONFIG.rates.tickHz,
  );
}

/** id がスキップを押した。全員（名簿の今の人）がそろってブリーフィングを終わらせたら true */
export function allSkipped(c: PreStart, players: readonly PlayerInfo[], id: number): boolean {
  if (c.briefingRemaining <= 0) return false;
  c.skips.add(id);
  return players.every((p) => c.skips.has(p.id)) && c.endBriefing();
}

/** レイドの怪獣（ホストが動かし、街を壊す）を用意し、arena をレイドの復帰にする */
export function createRaidHost(
  arena: PvpArena,
  room: { readonly players: readonly unknown[]; readonly settings: GameSettings },
  deps: { readonly groundHeight?: GroundHeightFn; readonly buildings?: BuildingField | null },
  emit: (e: EventMsg) => void,
): RaidHost {
  useRaidRespawn(arena);
  return new RaidHost(arena, room.players.length, {
    groundHeight: deps.groundHeight,
    hard: room.settings.hard,
    buildings: deps.buildings ?? null,
    emit,
  });
}

/** 成績（全員）。レイドの残り時間は最終フェーズの残り */
export function scoreMsg(
  fighters: readonly PvpFighter[],
  raid: RaidHost | null,
  matchRemaining: number,
  over: boolean,
): ScoreMsg {
  return {
    type: 'score',
    remainingSeconds: raid ? (raid.kaiju.finalRemaining ?? 0) : matchRemaining,
    over,
    players: fighters.map((f) => scoreEntry(f, raid)),
  };
}

/** 成績の 1 人分 */
export function scoreEntry(f: PvpFighter, raid: RaidHost | null): ScoreEntry {
  return {
    id: f.id,
    kills: f.kills,
    deaths: f.deaths,
    shots: f.shots,
    hits: f.hits,
    bestStreak: f.bestStreak,
    ...raidScoreFields(raid, f.id),
  };
}

/** arena をレイドの復帰（5 秒・開始位置）にする */
export function useRaidRespawn(arena: PvpArena): void {
  arena.respawnSeconds = RAID_RULES.respawnSeconds;
  arena.respawnPoint = (id) => ({
    ...spawnPosition(id, { x: 0, y: 0, z: 0 }, true),
    headingDeg: RAID_CONFIG.start.headingDeg,
  });
}

/** 成績のレイドの欄（PvP は空） */
export function raidScoreFields(
  raid: RaidHost | null,
  id: number,
): Pick<ScoreEntry, 'partDamage' | 'breaks'> {
  if (!raid) return { partDamage: [], breaks: 0 };
  const s = raid.kaiju.stats;
  return { partDamage: s.damageOf(id).map((v) => Math.round(v)), breaks: s.breaks.get(id) ?? 0 };
}

/** まだ配っていない壊れた建物（なければ null。溜めは空にする） */
export function takeRuins(raid: RaidHost | null): RuinMsg | null {
  if (!raid || raid.ruins.length === 0) return null;
  const ids = raid.ruins.splice(0, raid.ruins.length);
  return { type: 'ruin', ids };
}

/** 再接続した人へ、壊れている建物をすべて送り直す */
export function resendRuins(
  room: { sendTo(id: number, msg: RuinMsg, channel: 'reliable'): void },
  id: number,
  field: BuildingField | null | undefined,
): void {
  const ruins = allRuins(field ?? null);
  if (ruins) room.sendTo(id, ruins, 'reliable');
}

/** 壊れている建物すべて（再接続した人へ送り直す） */
export function allRuins(field: BuildingField | null): RuinMsg | null {
  if (!field) return null;
  const ids: number[] = [];
  field.states.forEach((s, i) => {
    if (s !== 'intact') ids.push(i);
  });
  return ids.length > 0 ? { type: 'ruin', ids } : null;
}
