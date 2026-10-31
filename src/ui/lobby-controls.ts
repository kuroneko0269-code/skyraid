// ロビーの部屋の画面の部品（6-6。lobby-room.ts から分けた）: 選択肢のセグメント・押すと切り替わるボタン・モードの表示名
import type { PvpMode } from '../data/pvp';
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
  ffa: '個人戦',
  team: 'チーム戦（2 対 2）',
  raid: 'レイド（協力・怪獣）',
  defense: '防衛戦（協力・基地）',
};

export function parseMode(v: string): PvpMode {
  return v === 'team' || v === 'raid' || v === 'defense' ? v : 'ffa';
}
