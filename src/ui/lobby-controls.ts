// ロビーの部屋の画面の部品（6-6。lobby-room.ts から分けた）: 選択肢の select・押すと切り替わるボタン・モードの表示名
import type { PvpMode } from '../data/pvp';
import { el } from './hud-dom';
import { createButton } from './screen';

/** 選択肢の select（値は数、表示は label）。変えたら onChange */
export function numberSelect(
  parent: HTMLElement,
  label: string,
  values: readonly (number | string)[],
  text: (v: number | string) => string,
  onChange: () => void,
): HTMLSelectElement {
  const wrap = el('label', 'campaign-fact lobby-rule', parent);
  el('span', 'campaign-fact-label', wrap, label);
  const select = el('select', 'ui-field lobby-rule-select', wrap);
  for (const v of values) {
    const o = el('option', '', select, text(v));
    o.value = String(v);
  }
  select.addEventListener('change', onChange);
  return select;
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
};

export function parseMode(v: string): PvpMode {
  return v === 'team' || v === 'raid' ? v : 'ffa';
}
