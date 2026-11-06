// 枠の中のタブ（9-5d の練習場の課題の一覧の「概要・記録・設定」を 9-9c で共通の部品に。練習場の結果の「助言・指標・設定」、
// リングレースのコース一覧の「概要・記録・機体」、ハンガーの「性能・強化・塗装」、練習場のポーズの「設定・練習場」）。
// 見た目は panel-tabs.css（クラス名は 9-5d のまま .practice-tabs / .practice-tab / .practice-pane）
import { el } from './hud-dom';
import { createButton } from './screen';
import './panel-tabs.css';

export class PanelTabs<T extends string> {
  readonly bar: HTMLDivElement;
  private readonly buttons = new Map<T, HTMLButtonElement>();
  private readonly panes = new Map<T, HTMLDivElement>();

  /** bar をタブの列、各タブの中身を parent に（タブの列の後ろに順に）作る。label はタブの文 */
  constructor(parent: HTMLElement, tabs: readonly T[], label: (tab: T) => string) {
    this.bar = el('div', 'practice-tabs', parent);
    this.bar.setAttribute('role', 'tablist');
    for (const tab of tabs) {
      const b = createButton(this.bar, 'practice-tab', label(tab), () => {
        this.show(tab);
      });
      b.dataset.tab = tab;
      b.setAttribute('role', 'tab');
      this.buttons.set(tab, b);
      const pane = el('div', `practice-pane practice-pane-${tab}`, parent);
      pane.setAttribute('role', 'tabpanel');
      this.panes.set(tab, pane);
    }
  }

  pane(tab: T): HTMLDivElement {
    const p = this.panes.get(tab);
    if (!p) throw new Error(`no pane: ${tab}`);
    return p;
  }

  show(tab: T): void {
    for (const [k, b] of this.buttons) {
      b.setAttribute('aria-selected', String(k === tab));
      b.classList.toggle('is-selected', k === tab);
    }
    for (const [k, p] of this.panes) p.hidden = k !== tab;
  }
}
