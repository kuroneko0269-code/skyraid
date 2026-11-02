// 設定画面（7-D）: それまでポーズメニューの「設定 ▼」の中にあった設定を独立した画面にした。タイトルの歯車・モード選択の「設定」・
// ポーズの「すべての設定」から開き、「← 戻る」・Esc で開いた元へ戻る（戻り先は core/settings-route.ts）。
// タブは 表示 / 音 / 操作 / ゲーム / データ。部品（画質・HUD・音量など）は各モジュールが slot(...) に入れる。
// ポーズメニューには「画質・音量・操作補助・HUD」の 4 つを貸し出す（lend / reclaim。同じ部品を DOM ごと移すので、表示が食い違わない）
import './settings.css';
import { t } from '../core/i18n';
import { el } from './hud-dom';
import { createButton, createScreen, setScreenShown } from './screen';
import { Segmented } from './segmented';

export const SETTINGS_SLOTS = [
  'language',
  'quality',
  'hud',
  'display',
  'volume',
  'assist',
  'controls',
  'game',
  'data',
] as const;
export type SettingsSlot = (typeof SETTINGS_SLOTS)[number];

/** タブ。表示名は構築時に labelKey（settings.tab.<id>）で引く */
const TABS: readonly { id: string; labelKey: string; slots: readonly SettingsSlot[] }[] = [
  {
    id: 'display',
    labelKey: 'settings.tab.display',
    slots: ['language', 'quality', 'hud', 'display'],
  },
  { id: 'sound', labelKey: 'settings.tab.sound', slots: ['volume'] },
  { id: 'controls', labelKey: 'settings.tab.controls', slots: ['assist', 'controls'] },
  { id: 'game', labelKey: 'settings.tab.game', slots: ['game'] },
  { id: 'data', labelKey: 'settings.tab.data', slots: ['data'] },
];

/** ポーズメニューに残す 4 つ（この順に並べる）。HUD は画質の右に詰める（8-1 の事前修正。音量は 2 列ぶち抜き） */
export const QUICK_SLOTS: readonly SettingsSlot[] = ['quality', 'hud', 'volume', 'assist'];

export class SettingsScreen {
  readonly root: HTMLDivElement;
  private readonly slots = new Map<SettingsSlot, HTMLDivElement>();
  /** 各 slot の元の位置（貸し出した後に戻す目印） */
  private readonly anchors = new Map<SettingsSlot, Comment>();
  private readonly panels = new Map<string, HTMLDivElement>();
  private readonly back: HTMLButtonElement;
  private readonly scroller: HTMLDivElement;
  private readonly tabs: Segmented;
  private lent = false;

  constructor(parent: HTMLElement, onBack: () => void) {
    const root = createScreen(parent, 'settings-screen menu-fixed');
    // 見出し・戻る・タブは上に固定し、内容だけスクロールする（7-4c。タブの位置が内容の高さで動かない）
    const top = el('div', 'menu-top', root);
    const header = el('div', 'menu-header', top);
    this.back = createButton(
      header,
      'ui-button is-ghost menu-back',
      t('settings.back.default'),
      onBack,
    );
    el('h2', 'ui-heading menu-heading', header, t('settings.title'));
    this.tabs = new Segmented(
      top,
      '',
      TABS.map((tab) => ({ value: tab.id, label: t(tab.labelKey) })),
      TABS[0]?.id ?? 'display',
      (id) => {
        this.showTab(id);
      },
      'settings-tabs',
    );
    this.scroller = el('div', 'menu-scroll', root);
    const body = el('div', 'ui-panel settings-body', this.scroller);
    for (const tab of TABS) {
      const panel = el('div', 'settings-grid settings-tab', body);
      panel.dataset.tab = tab.id;
      for (const name of tab.slots) {
        const slot = el('div', 'settings-slot', panel);
        slot.dataset.slot = name;
        const anchor = document.createComment(name);
        panel.appendChild(anchor);
        this.slots.set(name, slot);
        this.anchors.set(name, anchor);
      }
      this.panels.set(tab.id, panel);
    }
    this.showTab(this.tabs.value);
    this.root = root;
  }

  /** 部品を入れる場所 */
  slot(name: SettingsSlot): HTMLDivElement {
    const s = this.slots.get(name);
    if (!s) throw new Error(`unknown settings slot: ${name}`);
    return s;
  }

  /** 設定画面を出す・隠す。backLabel は戻り先（「← ポーズへ」など） */
  setShown(shown: boolean, backLabel = t('settings.back.default')): void {
    if (shown) {
      this.reclaim();
      this.back.textContent = backLabel;
    }
    setScreenShown(this.root, shown);
    if (shown) (this.tabs.selectedButton ?? this.back).focus({ preventScroll: true });
  }

  get shown(): boolean {
    return this.root.classList.contains('is-shown');
  }

  /** ポーズメニューに 4 つ（画質・音量・操作補助・HUD）を貸す */
  lend(target: HTMLElement): void {
    for (const name of QUICK_SLOTS) target.appendChild(this.slot(name));
    this.lent = true;
  }

  /** 貸した部品を元の位置に戻す */
  reclaim(): void {
    if (!this.lent) return;
    for (const name of QUICK_SLOTS) {
      const anchor = this.anchors.get(name);
      anchor?.parentNode?.insertBefore(this.slot(name), anchor);
    }
    this.lent = false;
  }

  private showTab(id: string): void {
    for (const [tab, panel] of this.panels) panel.hidden = tab !== id;
    this.scroller.scrollTop = 0;
  }
}
