// プレイヤーの色（5-1 の lobby.ts から分けた。5-3 のリザルト・フィードでも使う）
import { NET_CONFIG } from '../data/net';

/** CSS の色（#rrggbb） */
export function playerColorCss(id: number): string {
  const c = NET_CONFIG.playerColors[id % NET_CONFIG.playerColors.length] ?? 0xffffff;
  return `#${c.toString(16).padStart(6, '0')}`;
}
