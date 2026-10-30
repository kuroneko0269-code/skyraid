// ハンガー画面（3-3）の部品: 4 パラメータのバー、強化の行、確認ダイアログ。画面の本体は src/ui/hangar.ts
import type { AircraftStats } from '../data/aircraft';
import { UPGRADE_INFO, UPGRADE_LEVELS, type UpgradeKind } from '../data/upgrades';
import { el } from './hud-dom';
import { formatCredits } from './mission-text';
import { createButton } from './screen';

export const STAT_KEYS = [
  'speed',
  'turn',
  'durability',
  'payload',
] as const satisfies readonly (keyof AircraftStats)[];

const STAT_LABELS: Readonly<Record<keyof AircraftStats, string>> = {
  speed: '速度',
  turn: '旋回',
  durability: '耐久',
  payload: '積載',
};

/** バーの右に出す値の文字列 */
export type StatTexts = Readonly<Record<keyof AircraftStats, string>>;

/** 4 パラメータのバー。下に強化後（明るい色）、上に機体そのまま（Lv0）の長さを重ねる */
export class StatBars {
  private readonly rows = new Map<
    keyof AircraftStats,
    { base: HTMLDivElement; upgraded: HTMLDivElement; value: HTMLSpanElement }
  >();

  constructor(
    parent: HTMLElement,
    /** バーの右端にあたる値（全機体の Lv5 の最大） */
    private readonly max: Readonly<AircraftStats>,
  ) {
    const wrap = el('div', 'hangar-stats', parent);
    for (const key of STAT_KEYS) {
      const row = el('div', 'hangar-stat', wrap);
      el('span', 'hangar-stat-label', row, STAT_LABELS[key]);
      const track = el('div', 'hangar-stat-track', row);
      const upgraded = el('div', 'hangar-stat-fill is-upgraded', track);
      const base = el('div', 'hangar-stat-fill', track);
      const value = el('span', 'hangar-stat-value', row);
      this.rows.set(key, { base, upgraded, value });
    }
  }

  update(base: Readonly<AircraftStats>, upgraded: Readonly<AircraftStats>, texts: StatTexts): void {
    for (const key of STAT_KEYS) {
      const row = this.rows.get(key);
      if (!row) continue;
      const max = this.max[key];
      row.base.style.transform = `scaleX(${ratio(base[key], max)})`;
      row.upgraded.style.transform = `scaleX(${ratio(upgraded[key], max)})`;
      row.value.textContent = texts[key];
    }
  }
}

function ratio(v: number, max: number): string {
  return (max > 0 ? Math.min(1, Math.max(0, v / max)) : 0).toFixed(3);
}

/** 強化 1 系統の行: 名前・効果・Lv の目盛り・「強化する（価格）」 */
export class UpgradeRow {
  private readonly pips: HTMLSpanElement[] = [];
  private readonly button: HTMLButtonElement;

  constructor(parent: HTMLElement, kind: UpgradeKind, onUpgrade: (kind: UpgradeKind) => void) {
    const row = el('div', 'hangar-upgrade', parent);
    const head = el('div', 'hangar-upgrade-head', row);
    el('span', 'hangar-upgrade-label', head, UPGRADE_INFO[kind].label);
    const pips = el('span', 'hangar-pips', head);
    for (let i = UPGRADE_LEVELS.min + 1; i <= UPGRADE_LEVELS.max; i++)
      this.pips.push(el('span', 'hangar-pip', pips));
    el('div', 'hangar-upgrade-effect', row, UPGRADE_INFO[kind].effect);
    this.button = createButton(row, 'ui-button hangar-upgrade-button', '', () => {
      onUpgrade(kind);
    });
  }

  /** price が null なら最大（MAX）。owned でなければ押せない */
  update(level: number, price: number | null, owned: boolean, credits: number): void {
    this.pips.forEach((p, i) => p.classList.toggle('is-on', i < level));
    if (price === null) {
      this.button.textContent = 'MAX';
      this.button.disabled = true;
      return;
    }
    this.button.textContent = `強化する ${formatCredits(price)}`;
    this.button.disabled = !owned || credits < price;
  }
}

/** 高額な購入の確認（「購入する」「やめる」）。開いている間は他のボタンを押せない */
export class ConfirmDialog {
  readonly root: HTMLDivElement;
  private readonly text: HTMLParagraphElement;
  private readonly ok: HTMLButtonElement;
  private action: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hangar-confirm', parent);
    this.root.hidden = true;
    const box = el('div', 'ui-dialog hangar-confirm-box', this.root);
    this.text = el('p', 'hangar-confirm-text', box);
    const buttons = el('div', 'campaign-buttons', box);
    createButton(buttons, 'ui-button is-ghost campaign-back', 'やめる', () => {
      this.close();
    });
    this.ok = createButton(buttons, 'ui-button is-primary campaign-go', '購入する', () => {
      const fn = this.action;
      this.close();
      fn?.();
    });
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(message: string, action: () => void): void {
    this.text.textContent = message;
    this.action = action;
    this.root.hidden = false;
    this.ok.focus({ preventScroll: true });
  }

  close(): void {
    this.root.hidden = true;
    this.action = null;
  }
}
