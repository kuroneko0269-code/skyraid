// ロビーの操作（5-4。pvp-link.ts から分けた）: 開始・準備・ハンガー（所持機体）・ルール・チーム・定型文・「もう一度」を、
// ホストなら部屋を直接、クライアントならホストへのメッセージで変える。名簿の変化のお知らせ（切断・再接続・離脱）の文も作る
import { t } from '../core/i18n';
import { AIRCRAFT_MODELS } from '../data/aircraft';
import { ClientRoom } from '../net/client-room';
import { mapName, startBlock } from '../net/lobby-rules';
import type { LobbyRoomView } from './lobby-room';
import { buildJoinUrl } from './pvp-entry';
import type { PlayerInfo } from '../net/protocol';
import { HostRoom, type JoinError, type PlayerProfile } from '../net/room';
import type { Hangar } from '../progression/hangar';
import type { LobbyHandlers, LobbyScreen } from './lobby';

/** 参加の失敗の文 */
export const JOIN_ERRORS: Record<JoinError, string> = {
  get 'not-found'() {
    return t('net.joinError.notFound');
  },
  get full() {
    return t('net.joinError.full');
  },
  get started() {
    return t('net.joinError.started');
  },
  get version() {
    return t('net.joinError.version');
  },
  get expired() {
    return t('net.joinError.expired');
  },
  get timeout() {
    return t('net.joinError.timeout');
  },
  get network() {
    return t('net.joinError.network');
  },
  get unsupported() {
    return t('net.joinError.unsupported');
  },
};

export interface LobbyActionContext {
  readonly room: () => HostRoom | ClientRoom | null;
  readonly hangar: Hangar;
  readonly lobby: () => LobbyScreen;
  readonly profile: (aircraftId?: string) => PlayerProfile;
}

type Actions = Omit<LobbyHandlers, 'onCreate' | 'onJoin' | 'onLeave' | 'onBack'>;

export function lobbyActions(ctx: LobbyActionContext): Actions {
  const me = (): PlayerInfo | undefined => {
    const room = ctx.room();
    return room?.players.find((p) => p.id === room.localPlayerId);
  };
  return {
    onStart: () => {
      const room = ctx.room();
      if (room instanceof HostRoom && startBlock(room.players, room.settings.mode) === null)
        room.start();
    },
    onReady: (ready) => {
      const room = ctx.room();
      if (room instanceof ClientRoom) room.setLobby({ ready });
    },
    onHangar: () => {
      const room = ctx.room();
      const h = ctx.hangar;
      const current = me()?.aircraftId ?? h.selectedId;
      const entries = AIRCRAFT_MODELS.filter((m) => h.status(m.id) === 'owned').map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        stats: m.stats,
        selected: m.id === current,
      }));
      const note =
        (room?.settings.noUpgrades ?? true)
          ? t('lobby.hangar.noteNoUpgrades')
          : t('lobby.hangar.noteUpgrades');
      ctx.lobby().openHangar(entries, note);
    },
    onAircraft: (id) => {
      const room = ctx.room();
      if (!ctx.hangar.select(id)) return;
      const profile = ctx.profile(id);
      if (room instanceof HostRoom) room.updateHost({ profile });
      else if (room instanceof ClientRoom) room.setLobby({ profile });
    },
    onSettings: (settings) => {
      const room = ctx.room();
      if (room instanceof HostRoom) room.setSettings(settings);
    },
    onTeam: (playerId, team) => {
      const room = ctx.room();
      if (room instanceof HostRoom) room.setTeam(playerId, team);
    },
    onAutoTeams: () => {
      const room = ctx.room();
      if (room instanceof HostRoom) room.autoAssignTeams();
    },
    onChat: (phrase) => {
      ctx.room()?.chat(phrase);
    },
    onAgain: () => {
      const room = ctx.room();
      if (room instanceof HostRoom) room.updateHost({ again: true });
      // クライアントは「もう一度」で準備も済ませる（ロビーに戻ったらすぐ始められる）
      else if (room instanceof ClientRoom) room.setLobby({ again: true, ready: true });
    },
  };
}

/** 直前の名簿（ID → 名前・再接続待ち） */
export type RosterSnapshot = ReadonlyMap<number, { readonly name: string; readonly away: boolean }>;

/** 名簿の変化のお知らせ（自分以外の切断・再接続・離脱）。最初の名簿（prev が空）では出さない */
export function rosterNotices(
  prev: RosterSnapshot,
  next: readonly Readonly<PlayerInfo>[],
  localId: number,
): string[] {
  if (prev.size === 0) return [];
  const out: string[] = [];
  for (const p of next) {
    const before = prev.get(p.id);
    if (p.id === localId || !before) continue;
    if (p.away && !before.away) out.push(t('net.playerAway', { name: p.name }));
    else if (!p.away && before.away) out.push(t('net.playerBack', { name: p.name }));
  }
  for (const [id, before] of prev) {
    if (id !== localId && !next.some((p) => p.id === id))
      out.push(t('net.playerLeft', { name: before.name }));
  }
  return out;
}

/** ロビーの部屋の画面に出す値（pvp-link.ts から分けた） */
export function roomView(room: HostRoom | ClientRoom): LobbyRoomView {
  return {
    code: room.code,
    joinUrl: buildJoinUrl(window.location.href, room.code),
    isHost: room.isHost,
    localId: room.localPlayerId,
    players: room.players,
    mapName: mapName(room.settings.mapId),
    settings: room.settings,
  };
}
