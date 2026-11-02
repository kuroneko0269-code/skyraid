// ロビーの参加者の一覧（7-C で lobby-room.ts から分けた）: 色・名前と機体・印・吹き出し・チーム・準備
import { findAircraftModel } from '../data/aircraft';
import { PVP_TEAM } from '../data/pvp';
import { isReady } from '../net/lobby-rules';
import type { PlayerInfo } from '../net/protocol';
import { t } from '../core/i18n';
import { el } from './hud-dom';
import { playerColorCss, teamColorCss } from './lobby-colors';
import type { LobbyRoomView } from './lobby-room';
import { createButton } from './screen';

/** 一覧を描き直す。bubbles は定型文の吹き出し（プレイヤー ID → 文と消す時刻 ms） */
export function renderLobbyPlayers(
  list: HTMLElement,
  v: Readonly<LobbyRoomView>,
  bubbles: ReadonlyMap<number, { text: string; until: number }>,
  onTeam: (playerId: number, team: number) => void,
): void {
  const team = v.settings.mode === 'team';
  const now = performance.now();
  list.replaceChildren();
  for (const p of v.players) {
    const li = el('li', 'lobby-player', list);
    li.classList.toggle('is-away', p.away);
    const dot = el('span', 'lobby-dot', li);
    dot.style.background = playerColorCss(p.id);
    const who = el('span', 'lobby-who', li);
    el('span', 'lobby-name', who, p.name);
    el('span', 'lobby-craft', who, findAircraftModel(p.aircraftId)?.name ?? p.aircraftId);
    const tags = [
      p.id === 0 ? t('lobby.player.host') : '',
      p.id === v.localId ? t('lobby.player.you') : '',
    ].filter(Boolean);
    if (tags.length > 0) el('span', 'tag', li, tags.join(t('lobby.sep')));
    const bubble = bubbles.get(p.id);
    if (bubble && bubble.until > now) el('span', 'lobby-bubble', li, bubble.text);
    if (team) teamChip(li, p, v.isHost, onTeam);
    const status = p.away
      ? t('lobby.player.reconnecting')
      : p.id === 0
        ? 'HOST'
        : p.ready
          ? 'READY'
          : t('lobby.player.preparing');
    const s = el('span', 'lobby-status', li, status);
    s.classList.toggle('is-ready', isReady(p) && !p.away);
  }
}

/** チームの印。ホストは押すと A ⇄ B を入れ替える */
function teamChip(
  li: HTMLElement,
  p: Readonly<PlayerInfo>,
  isHost: boolean,
  onTeam: (playerId: number, team: number) => void,
): void {
  const name = PVP_TEAM.names[p.team === 1 ? 1 : 0];
  const label = t('lobby.team', { team: name });
  const chip = isHost
    ? createButton(li, 'ui-button lobby-team', label, () => {
        onTeam(p.id, p.team === 1 ? 0 : 1);
      })
    : el('span', 'lobby-team', li, label);
  chip.style.color = teamColorCss(p.team);
}
