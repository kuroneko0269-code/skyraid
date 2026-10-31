// 協力の防衛戦（7-2）のリザルト（Three.js・DOM 非依存）: 終わりの event（over）に入った結果（施設のビット・クリアした波・
// 司令部の HP）と全員の成績から作る。どの参加者が作っても同じになる（state の届く順に左右されない）
import { bestPlayer } from '../combat/pvp-rules';
import { findDefenseMap } from '../data/defense';
import { defenseReward, FACILITY_TOTAL, type DefenseScore } from '../missions/defense/score';
import { DEFENSE_OUTCOME } from './defense-host';
import type { EventMsg, ScoreEntry } from './protocol';

/** 協力の防衛戦のリザルト（全員同じ報酬） */
export interface DefenseSummary {
  readonly score: DefenseScore;
  readonly credits: number;
  readonly fullClear: number;
  readonly facilities: number;
  readonly mapName: string;
  readonly hard: boolean;
  /** MVP（撃墜数が最多。同じなら被撃墜の少ない方。誰も撃墜していなければ null） */
  readonly mvp: number | null;
}

export function defenseSummary(
  over: Readonly<EventMsg> | null,
  players: readonly ScoreEntry[],
  settings: { readonly mapId: string; readonly hard: boolean },
): DefenseSummary {
  const cleared = over?.b === DEFENSE_OUTCOME.cleared;
  const bits = over?.a ?? 0;
  let alive = 0;
  for (let i = 1; i <= FACILITY_TOTAL; i++) if (bits & (1 << i)) alive++;
  const score: DefenseScore = {
    outcome: cleared ? 'cleared' : 'failed',
    wavesCleared: over?.x ?? 0,
    hqHp: over?.y ?? 0,
    hqMaxHp: over?.z ?? 1,
    facilitiesAlive: alive,
    facilitiesTotal: FACILITY_TOTAL,
    kills: players.reduce((n, p) => n + p.kills, 0),
  };
  const r = defenseReward(score);
  const best = bestPlayer(players);
  return {
    score,
    credits: r.total,
    fullClear: r.fullClear,
    facilities: r.facilities,
    mapName: findDefenseMap(settings.mapId).name,
    hard: settings.hard,
    mvp: best && best.kills > 0 ? best.id : null,
  };
}
