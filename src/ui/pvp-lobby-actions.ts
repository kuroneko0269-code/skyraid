// ロビーの操作（5-4。pvp-link.ts から分けた）: 開始・準備・ハンガー（所持機体）・ルール・チーム・定型文・「もう一度」を、
// ホストなら部屋を直接、クライアントならホストへのメッセージで変える。名簿の変化のお知らせ（切断・再接続・離脱）の文も作る
import { AIRCRAFT_MODELS } from '../data/aircraft';
import { ClientRoom } from '../net/client-room';
import { startBlock } from '../net/lobby-rules';
import type { PlayerInfo } from '../net/protocol';
import { HostRoom, type JoinError, type PlayerProfile } from '../net/room';
import type { Hangar } from '../progression/hangar';
import type { LobbyHandlers, LobbyScreen } from './lobby';

/** 参加の失敗の文 */
export const JOIN_ERRORS: Record<JoinError, string> = {
  'not-found': 'その部屋は見つかりません（コードを確かめてください）',
  full: '満員です（最大 4 人）',
  started: 'すでに始まっています',
  version: 'ホストとバージョンが違います（両方とも再読み込みしてください）',
  expired: '再接続の期限が過ぎました',
  timeout: '応答がありません（時間切れ）',
  network: '接続できませんでした',
  unsupported: 'このブラウザは P2P 通信（WebRTC）に対応していません',
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
          ? '所持している機体から選べます。強化はホストの設定で無効（全員 Lv 0）です'
          : '所持している機体から選べます。強化はシングルプレイの値をそのまま使います';
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
    if (p.away && !before.away) out.push(`${p.name} の接続が切れました（再接続を待っています）`);
    else if (!p.away && before.away) out.push(`${p.name} が戻りました`);
  }
  for (const [id, before] of prev) {
    if (id !== localId && !next.some((p) => p.id === id)) out.push(`${before.name} が離脱しました`);
  }
  return out;
}
