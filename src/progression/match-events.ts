// 協力・PvP の対戦の終わりの知らせ（9-10。Three.js・DOM 非依存）: PvP の遅延チャンク（ui/pvp-settle.ts）が流し、
// 勲章（ui/badge-link.ts。起動時のチャンク）が受ける。チャンクをまたいで直接読まないための小さな受け口
import type { MatchSummary } from '../missions/badges/sortie';

const listeners: ((m: MatchSummary) => void)[] = [];

export function onMatchEnd(fn: (m: MatchSummary) => void): void {
  listeners.push(fn);
}

export function emitMatchEnd(m: MatchSummary): void {
  for (const fn of listeners) fn(m);
}
