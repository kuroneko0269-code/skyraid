// プレイヤーの色（5-1 の lobby.ts から分けた。5-3 のリザルト・フィードでも使う）
import { NET_CONFIG } from '../data/net';
import { PVP_TEAM } from '../data/pvp';

/** CSS の色（#rrggbb） */
export function playerColorCss(id: number): string {
  const c = NET_CONFIG.playerColors[id % NET_CONFIG.playerColors.length] ?? 0xffffff;
  return `#${c.toString(16).padStart(6, '0')}`;
}

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** チーム戦のチームの色（5-4。0 = A、1 = B） */
export function teamColorCss(team: number): string {
  return hex(PVP_TEAM.colors[team === 1 ? 1 : 0]);
}

/** 飛行中の敵味方の色（5-4。名札） */
export function sideColorCss(ally: boolean): string {
  return hex(ally ? PVP_TEAM.allyColor : PVP_TEAM.enemyColor);
}
