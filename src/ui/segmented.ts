// セグメント（7-C）: 横並びのトグルで 1 つを選ぶ（高さ 48px 以上・選択中は塗りつぶし。見た目は segmented.css の .ui-seg）。
// 防衛戦・フリーフライト・レイドのダイアログと、ロビーのホスト設定で使う（それまでの select・小さいトグルの置き換え）
import { el } from './hud-dom';
import { createButton } from './screen';
import './segmented.css';

export interface SegmentOption {
  readonly value: string;
  readonly label: string;
}

export class Segmented {
  /** 行全体（見出し + ボタン）。hidden で行ごと隠す */
  readonly root: HTMLDivElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private current: string;

  /**
   * label が空なら見出しを出さない。onChange はタップで値が変わったときだけ呼ぶ（value を代入したときは呼ばない）。
   * extraClass は行に足すクラス（並び方の調整）
   */
  constructor(
    parent: HTMLElement,
    label: string,
    options: readonly SegmentOption[],
    initial: string,
    onChange: (value: string) => void,
    extraClass = '',
  ) {
    this.root = el('div', `ui-seg ${extraClass}`.trim(), parent);
    if (label) el('span', 'ui-seg-label', this.root, label);
    const items = el('div', 'ui-seg-items', this.root);
    items.setAttribute('role', 'radiogroup');
    if (label) items.setAttribute('aria-label', label);
    this.current = initial;
    for (const o of options) {
      const b = createButton(items, 'ui-seg-item', o.label, () => {
        if (this.current === o.value) return;
        this.value = o.value;
        onChange(o.value);
      });
      b.setAttribute('role', 'radio');
      b.dataset.value = o.value;
      this.buttons.push(b);
    }
    this.sync();
  }

  get value(): string {
    return this.current;
  }

  set value(v: string) {
    this.current = v;
    this.sync();
  }

  /** 選択中のボタン（キーボードで開いたときのフォーカス先） */
  get selectedButton(): HTMLButtonElement | null {
    return this.buttons.find((b) => b.dataset.value === this.current) ?? this.buttons[0] ?? null;
  }

  /** 10-5b: 選べない値（押せない・鍵の印。ロビーのホストがまだ解放していないレイドの怪獣） */
  setLocked(value: string, locked: boolean): void {
    const b = this.buttons.find((x) => x.dataset.value === value);
    if (!b || b.disabled === locked) return;
    b.disabled = locked;
    b.classList.toggle('is-locked', locked);
  }

  private sync(): void {
    for (const b of this.buttons)
      b.setAttribute('aria-checked', String(b.dataset.value === this.current));
  }
}
