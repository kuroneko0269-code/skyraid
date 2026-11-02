// ロビーの部屋の画面の部品（6-6。lobby-room.ts から分けた）: 選択肢のセグメント・押すと切り替わるボタン・モードの表示名
import { t, tn } from '../core/i18n';
import type { PvpMode } from '../data/pvp';
import { RAID_DIFFICULTY_LABELS } from '../data/raid';
import type { GameSettings } from '../net/protocol';
import { createButton } from './screen';
import { Segmented } from './segmented';

/**
 * ホスト設定の選択肢（7-C で select からセグメントに。値は文字列、表示は text）。変えたら onChange。
 * extraClass は並び方の調整（天候は 4 個ずつ）
 */
export function ruleSegment(
  parent: HTMLElement,
  label: string,
  values: readonly (number | string)[],
  text: (v: number | string) => string,
  onChange: () => void,
  extraClass = '',
): Segmented {
  return new Segmented(
    parent,
    label,
    values.map((v) => ({ value: String(v), label: text(v) })),
    String(values[0] ?? ''),
    onChange,
    `lobby-rule ${extraClass}`.trim(),
  );
}

export function toggle(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
  const b = createButton(parent, 'ui-toggle lobby-toggle', label, onClick);
  b.setAttribute('aria-pressed', 'false');
  return b;
}

/** ロビーのモードの表示名（6-2 でレイドを足した） */
export const MODE_LABELS: Readonly<Record<PvpMode, string>> = {
  get ffa() {
    return t('lobby.mode.ffa');
  },
  get team() {
    return t('lobby.mode.team');
  },
  get raid() {
    return t('lobby.mode.raid');
  },
  get defense() {
    return t('lobby.mode.defense');
  },
};

export function parseMode(v: string): PvpMode {
  return v === 'team' || v === 'raid' || v === 'defense' ? v : 'ffa';
}

/** 制限時間の表示（秒 → 「5 分」） */
export const minutes = (s: number): string => tn('lobby.minutes', Math.round(s / 60));

/** ルールの 1 行（クライアントに出す。レイド・防衛戦は撃墜数・制限時間を使わない） */
export function rulesSummary(st: Readonly<GameSettings>): string {
  if (st.mode === 'raid')
    return t('lobby.rules.raid', {
      difficulty: RAID_DIFFICULTY_LABELS[st.hard ? 'hard' : 'normal'],
    });
  if (st.mode === 'defense')
    return t('lobby.rules.defense', {
      difficulty: st.hard ? t('defense.difficulty.hard') : t('defense.difficulty.normal'),
    });
  return t('lobby.rules.versus', {
    mode: st.mode === 'team' ? t('lobby.rules.team') : t('lobby.rules.ffa'),
    score: st.scoreLimit,
    time: minutes(st.timeLimitSeconds),
  });
}

/** 補正の 1 行（強化の有効・無効と初心者保護） */
export function optionsSummary(st: Readonly<GameSettings>): string {
  return t('lobby.options', {
    upgrades: st.noUpgrades ? t('lobby.upgradesOff') : t('lobby.upgradesOn'),
    rookie: st.rookieGuard ? 'ON' : 'OFF',
  });
}
