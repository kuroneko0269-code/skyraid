// ホストの防衛戦の部品（7-2。host-game.ts から分けた）: 防衛戦のホストの世界の用意と、復帰の位置（開始位置の一列・5 秒）。Three.js 非依存
import type { PvpArena } from '../combat/pvp-arena';
import type { Rng } from '../combat/gun';
import { RAID_RULES } from '../data/raid';
import type { GroundHeightFn } from '../entities/aircraft';
import { DefenseHost } from './defense-host';
import { startPose } from './net-game';
import {
  ENEMY_OWNER,
  eventMsg,
  type EventMsg,
  type GameSettings,
  type MissileStateMsg,
  type PlayerInfo,
} from './protocol';
import { NOBODY } from '../combat/pvp-arena';

/** 敵のミサイルの起爆の event の n（表示のミサイルの netId にない値: どれも消さない） */
const NO_NET_ID = 0xffff;
import { collectMissiles } from './host-state';

/** チーム（チーム戦は名簿のチーム、レイド（6-2）・防衛戦（7-2）は全員同じチーム、個人戦は null） */
export function modeTeams(room: {
  readonly players: readonly Readonly<PlayerInfo>[];
  readonly settings: GameSettings;
}): Map<number, number> | null {
  const mode = room.settings.mode;
  if (mode === 'team') return new Map(room.players.map((p) => [p.id, p.team]));
  if (mode === 'raid' || mode === 'defense') return new Map(room.players.map((p) => [p.id, 0]));
  return null;
}

/** 対戦の終わりの event（防衛戦は a = 施設のビット、xyz = クリアした波・司令部の HP・最大 HP） */
export function overEvent(
  defense: DefenseHost | null,
  outcome: number,
  tick: number,
  playTicks: number,
): EventMsg {
  if (!defense) return eventMsg('over', 0, outcome, tick, playTicks);
  const r = defense.runner;
  const hq = r.base.hq;
  return eventMsg(
    'over',
    r.base.aliveBits,
    outcome,
    tick,
    playTicks,
    r.wavesCleared,
    hq.hp,
    hq.maxHp,
  );
}

/** state に入れるミサイル: プレイヤーのもの（PvpArena）と、防衛戦の敵のもの */
export function collectAllMissiles(
  arena: PvpArena,
  defense: DefenseHost | null,
  out: MissileStateMsg[],
  spare: MissileStateMsg[],
): void {
  collectMissiles(arena.missiles.missiles, out, spare, arena.netIdMask);
  defense?.collectMissiles(out, spare, out.length);
}

/**
 * 防衛戦のホストの世界を用意し、arena を防衛戦の復帰（開始位置の一列へ 5 秒。レイドと同じ）にする。
 * 敵のミサイルの起爆は explode の event（表示の爆発）。防衛戦でなければ null
 */
export function createDefenseHost(
  arena: PvpArena,
  room: { readonly players: readonly unknown[]; readonly settings: GameSettings },
  deps: { readonly groundHeight?: GroundHeightFn; readonly rng?: Rng },
  emit: (e: EventMsg) => void,
): DefenseHost | null {
  const s = room.settings;
  if (s.mode !== 'defense') return null;
  arena.respawnSeconds = RAID_RULES.respawnSeconds;
  arena.respawnPoint = (id) => startPose(id, s);
  const host = new DefenseHost(arena, {
    mapId: s.mapId,
    hard: s.hard,
    players: room.players.length,
    groundHeight: deps.groundHeight,
    rng: deps.rng,
    emit,
  });
  host.onMissileBlast((x, y, z) => {
    emit(eventMsg('explode', ENEMY_OWNER, NOBODY, 0, NO_NET_ID, x, y, z));
  });
  return host;
}
