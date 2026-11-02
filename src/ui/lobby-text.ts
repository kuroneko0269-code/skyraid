// ロビーの見出し（8-2 の事前修正。src/data/i18n/*.json の lobby）: PvP・協力レイド・協力防衛戦で見出しを変える。DOM 非依存の純関数
import { t } from '../core/i18n';

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
