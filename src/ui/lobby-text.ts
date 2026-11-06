// ロビーの見出し（8-2 の事前修正。src/data/i18n/*.json の lobby）: PvP・協力レイド・協力防衛戦で見出しを変える。
// 9-10d: 部屋の画面の上の帯の題と、下の帯の「今何を待っているか」の文。DOM 非依存の純関数
import { t } from '../core/i18n';
import { findMap } from '../data/maps';
import { raidKaijuName, raidKaijuOf } from '../data/raid-kaiju';
import { isReady, startBlock } from '../net/lobby-rules';
import type { GameSettings, PlayerInfo } from '../net/protocol';
import { NET_CONFIG } from '../data/net';

/** ロビーに入った遊び方（モード選択の PvP / レイドの協力 / 防衛戦の協力） */
export type LobbyMode = 'pvp' | 'raid' | 'defense';

export interface LobbyHeading {
  readonly kicker: string;
  readonly title: string;
  readonly note: string;
}

/** 見出しの小見出し・題・説明（説明の {max} は最大人数） */
export function lobbyHeading(mode: LobbyMode, maxPlayers: number): LobbyHeading {
  return {
    kicker: t(`lobby.${mode}.kicker`),
    title: t(`lobby.${mode}.title`),
    note: t(`lobby.${mode}.note`, { max: maxPlayers }),
  };
}

/** 部屋の画面の上の帯の題（例: PvP · 個人戦 / 協力レイド · ヴォルガス / 協力防衛戦 · 島） */
export function roomTitle(st: Readonly<GameSettings>): string {
  const kind = st.mode === 'raid' ? 'raid' : st.mode === 'defense' ? 'defense' : 'pvp';
  const detail =
    st.mode === 'raid'
      ? raidKaijuName(raidKaijuOf(st.raidKaiju))
      : st.mode === 'defense'
        ? findMap(st.mapId).name
        : t(`lobby.mode.${st.mode}`);
  return t('lobby.room.title', { kind: t(`lobby.${kind}.title`), detail });
}

/** 下の帯の文: 今何を待っているか（ホストは開始できない理由と準備OKの数、参加者はホストの開始か自分の準備） */
export function waitText(v: {
  readonly isHost: boolean;
  readonly localId: number;
  readonly players: readonly Readonly<PlayerInfo>[];
  readonly settings: Readonly<GameSettings>;
}): string {
  const me = v.players.find((p) => p.id === v.localId);
  if (!v.isHost) return me?.ready ? t('lobby.wait.host') : t('lobby.wait.pick');
  const block = startBlock(v.players, v.settings.mode);
  if (block === null) return t('lobby.wait.allReady');
  if (block === 'ready')
    return t('lobby.room.readyCount', {
      ready: String(v.players.filter((p) => isReady(p) && !p.away).length),
      total: String(v.players.length),
    });
  return t(`lobby.block.${block}`);
}

/** 席の状態（表示の分け方。DOM 非依存の判定） */
export type SeatStatus = 'ready' | 'preparing' | 'away';

export function seatStatus(p: Readonly<PlayerInfo>): SeatStatus {
  if (p.away) return 'away';
  return isReady(p) ? 'ready' : 'preparing';
}

/**
 * 席の並び: チーム戦はチーム A・B のまとまり（各チーム maxPlayers / 2 席。足りない分は空き席）、それ以外は入った順に
 * maxPlayers 席（足りない分は空き席）。null は空き席
 */
export function seatGroups(
  players: readonly Readonly<PlayerInfo>[],
  team: boolean,
  max = NET_CONFIG.maxPlayers,
): { readonly team: number | null; readonly seats: readonly (Readonly<PlayerInfo> | null)[] }[] {
  const fill = (list: readonly Readonly<PlayerInfo>[], n: number) => [
    ...list,
    ...Array.from({ length: Math.max(0, n - list.length) }, () => null),
  ];
  if (!team) return [{ team: null, seats: fill(players, max) }];
  const per = Math.ceil(max / 2);
  return [0, 1].map((tm) => ({
    team: tm,
    seats: fill(
      players.filter((p) => (p.team === 1 ? 1 : 0) === tm),
      per,
    ),
  }));
}
