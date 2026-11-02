// ロビーの見出し（8-2 の事前修正。src/data/i18n/*.json の lobby）: PvP・協力レイド・協力防衛戦で見出しを変える。DOM 非依存の純関数
import type { Locale } from '../core/locale';
import en from '../data/i18n/en.json';
import ja from '../data/i18n/ja.json';

/** ロビーに入った遊び方（モード選択の PvP / レイドの協力 / 防衛戦の協力） */
export type LobbyMode = 'pvp' | 'raid' | 'defense';

export interface LobbyHeading {
  readonly kicker: string;
  readonly title: string;
  readonly note: string;
}

const STRINGS: Record<Locale, Record<LobbyMode, LobbyHeading>> = { ja: ja.lobby, en: en.lobby };

/** 見出しの小見出し・題・説明（説明の {max} は最大人数） */
export function lobbyHeading(mode: LobbyMode, locale: Locale, maxPlayers: number): LobbyHeading {
  const s = STRINGS[locale][mode];
  return { ...s, note: s.note.replace('{max}', String(maxPlayers)) };
}
