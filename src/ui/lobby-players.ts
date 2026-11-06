// ロビーの席の一覧（7-C で lobby-room.ts から分け、9-10d で席に作り直した）: 1 席は左の色の帯・名前（自分は「（あなた）」）・
// ホストや機体・状態（準備OK・準備中・再接続中）。定型文の吹き出しは席の上に 3 秒。空いた席は点線の枠で「部屋コードか QR で招待」。
// チーム戦はチームごとのまとまり（見出しはチームの色。ホストは席のチームの印を押すと入れ替え）に分け、各チームに空き席を出す
import { findAircraftModel } from '../data/aircraft';
import { PVP_TEAM } from '../data/pvp';
import type { PlayerInfo } from '../net/protocol';
import { t } from '../core/i18n';
import { el } from './hud-dom';
import { playerColorCss, teamColorCss } from './lobby-colors';
import type { LobbyRoomView } from './lobby-room';
import { createButton } from './screen';
import { seatGroups, seatStatus, type SeatStatus } from './lobby-text';

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
  list.classList.toggle('is-team', team);
  for (const g of seatGroups(v.players, team)) {
    const box = el('div', 'lobby-seat-group', list);
    if (g.team !== null) {
      const head = el(
        'div',
        'lobby-seat-team',
        box,
        t('lobby.team', { team: PVP_TEAM.names[g.team] ?? '' }),
      );
      head.style.color = teamColorCss(g.team);
      box.style.setProperty('--team-color', teamColorCss(g.team));
    }
    for (const p of g.seats) {
      if (!p) {
        el('div', 'lobby-seat is-empty', box, t('lobby.room.empty'));
        continue;
      }
      const seat = el('div', 'lobby-seat', box);
      seat.dataset.status = seatStatus(p);
      seat.classList.toggle('is-me', p.id === v.localId);
      seat.style.setProperty('--seat-color', playerColorCss(p.id));
      const who = el('div', 'lobby-seat-who', seat);
      const name = el('div', 'lobby-seat-name', who);
      el('span', 'lobby-seat-name-text', name, p.name);
      if (p.id === v.localId) el('span', 'lobby-seat-you', name, t('lobby.room.you'));
      const craft = findAircraftModel(p.aircraftId)?.name ?? p.aircraftId;
      el(
        'div',
        'lobby-seat-sub',
        who,
        p.id === 0 ? `${t('lobby.player.host')}${t('lobby.sep')}${craft}` : craft,
      );
      if (team) teamChip(seat, p, v.isHost, onTeam);
      el('span', 'lobby-seat-status', seat, statusText(seatStatus(p)));
      const bubble = bubbles.get(p.id);
      if (bubble && bubble.until > now) el('span', 'lobby-bubble', seat, bubble.text);
    }
  }
}

function statusText(s: SeatStatus): string {
  if (s === 'away') return t('lobby.player.reconnecting');
  return s === 'ready' ? t('lobby.room.statusReady') : t('lobby.player.preparing');
}

/** チームの印。ホストは押すと A ⇄ B を入れ替える */
function teamChip(
  seat: HTMLElement,
  p: Readonly<PlayerInfo>,
  isHost: boolean,
  onTeam: (playerId: number, team: number) => void,
): void {
  const other = p.team === 1 ? 0 : 1;
  if (!isHost) return;
  const chip = createButton(seat, 'ui-button lobby-team', `⇄ ${PVP_TEAM.names[other]}`, () => {
    onTeam(p.id, other);
  });
  chip.style.color = teamColorCss(other);
  chip.title = t('lobby.team', { team: PVP_TEAM.names[other] });
}
