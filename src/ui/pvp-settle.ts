// PvP の塗装と対戦の終わりの記録（7-3。pvp-link.ts が 300 行を超えないよう分けた）: 名簿の自分の塗装、
// 対戦の終わりにセーブへ足す報酬・撃墜の累計
import type { ClientRoom } from '../net/client-room';
import type { HostRoom } from '../net/room';
import type { Paint } from '../progression/paint';
import type { Paintshop } from '../progression/paintshop';
import type { ResultView } from './pvp-result';
import type { MatchSummary } from '../missions/badges/sortie';
import { emitMatchEnd } from '../progression/match-events';

/** 自分の塗装（7-3。名簿の値 = ホストが配った値。なければハンガーの塗装） */
export function rosterPaint(
  room: HostRoom | ClientRoom | null,
  paintshop: Paintshop,
  aircraftId: string,
): Paint {
  const me = room?.players.find((p) => p.id === room.localPlayerId);
  return me?.paint ?? paintshop.paint(aircraftId);
}

/**
 * 対戦の終わりにセーブへ足すもの: 協力レイド（6-6）・防衛戦（7-2）は報酬（全員同じ額）、
 * PvP（個人戦・チーム戦）は自分の撃墜数を累計へ（7-3。海洋迷彩の解放条件）
 */
export function settleMatch(
  result: Readonly<ResultView>,
  save: { readonly addCredits: (credits: number) => void; readonly paintshop: Paintshop },
): void {
  if (result.raid || result.defense)
    save.addCredits((result.raid?.credits ?? 0) + (result.defense?.credits ?? 0));
  else save.paintshop.addPvpKills(result.rows.find((r) => r.id === result.localId)?.kills ?? 0);
  // 9-10: 勲章（協力のクリア・4 人で・PvP の勝ち）
  emitMatchEnd(matchSummary(result));
}

/** 対戦の終わりの集計（9-10 の勲章）。チーム戦は自分のチームの合計が相手より多い、個人戦は 1 位で 1 機以上落とした */
export function matchSummary(result: Readonly<ResultView>): MatchSummary {
  const coop = Boolean(result.raid ?? result.defense);
  const me = result.rows.find((r) => r.id === result.localId);
  const totals = result.teamTotals;
  let pvpWin = false;
  if (me && totals && me.team !== null) {
    const mine = totals[me.team === 0 ? 0 : 1];
    const other = totals[me.team === 0 ? 1 : 0];
    pvpWin = mine > other;
  } else if (me && !totals) pvpWin = me.rank === 1 && me.kills > 0;
  return {
    coop,
    coopClear: result.reason === 'raidClear' || result.reason === 'defenseClear',
    players: result.rows.length,
    pvpWin,
    kills: me?.kills ?? 0,
  };
}
