// 「情報」画面（7-D）: モード選択の「情報」から。モード選択の上に重ねる（ランキングと同じ）。
// タブは 版 / 更新履歴（docs/changelog.md）/ ライセンス（ビルド時に生成。scripts/vite-app-info.ts）/ データの扱い
import './info.css';
import { APP_VERSION } from 'virtual:app-info';
import { LICENSES } from 'virtual:app-licenses';
import changelogText from '../../docs/changelog.md?raw';
import { parseChangelog } from '../core/changelog';
import { APP_MANIFEST } from '../data/app';
import { DATA_POLICY } from '../data/data-policy';
import type { GameState } from '../core/game-state';
import { el } from './hud-dom';
import type { ModeSelectScreen } from './mode-select';
import { createButton, createScreen, setScreenShown } from './screen';
import { Segmented } from './segmented';

const TABS = [
  { value: 'version', label: '版' },
  { value: 'changes', label: '更新履歴' },
  { value: 'licenses', label: 'ライセンス' },
  { value: 'data', label: 'データの扱い' },
] as const;

/** npm 以外で使っているもの（Google Fonts から読む見出しのフォント） */
const EXTRA_LICENSES = [
  {
    name: 'Rajdhani（Google Fonts）',
    license: 'SIL Open Font License 1.1',
    url: 'https://fonts.google.com/specimen/Rajdhani',
  },
] as const;

export class InfoScreen {
  readonly root: HTMLDivElement;
  private readonly panels = new Map<string, HTMLDivElement>();
  private readonly tabs: Segmented;
  private readonly scroller: HTMLDivElement;
  private open = false;

  constructor(
    parent: HTMLElement,
    private readonly modeSelect: ModeSelectScreen,
    private readonly onClose: () => void,
  ) {
    const root = createScreen(parent, 'info-screen menu-fixed');
    // 見出し・戻る・タブは上に固定し、内容だけスクロールする（7-4c）
    const top = el('div', 'menu-top', root);
    const header = el('div', 'menu-header', top);
    createButton(header, 'ui-button is-ghost menu-back', '← モード選択へ', () => {
      this.close();
    });
    el('h2', 'ui-heading menu-heading', header, '情報');
    this.tabs = new Segmented(
      top,
      '',
      TABS,
      'version',
      (v) => {
        this.showTab(v);
      },
      'info-tabs',
    );
    this.scroller = el('div', 'menu-scroll', root);
    const body = el('div', 'ui-panel info-body', this.scroller);
    for (const t of TABS) {
      const panel = el('div', 'info-tab', body);
      this.panels.set(t.value, panel);
    }
    this.buildVersion(this.panel('version'));
    this.buildChanges(this.panel('changes'));
    this.buildLicenses(this.panel('licenses'));
    this.buildData(this.panel('data'));
    this.showTab('version');
    this.root = root;
  }

  /**
   * モード選択の上に重ねる情報画面を作る（閉じたらモード選択を出し直す）。8-2 から初めて開くときに読み込んで作る。
   * Esc で閉じるつなぎ（modeSelect.addOverlay）は起動時に Screens が付ける
   */
  static over(parent: HTMLElement, modeSelect: ModeSelectScreen, game: GameState): InfoScreen {
    return new InfoScreen(parent, modeSelect, () => {
      if (game.state === 'mode_select') modeSelect.reveal();
    });
  }

  show(): void {
    this.open = true;
    setScreenShown(this.modeSelect.root, false);
    setScreenShown(this.root, true);
    this.tabs.selectedButton?.focus({ preventScroll: true });
  }

  /** 開いていれば閉じて true（Esc・← モード選択へ） */
  close(): boolean {
    if (!this.open) return false;
    this.open = false;
    setScreenShown(this.root, false);
    this.onClose();
    return true;
  }

  private panel(id: string): HTMLDivElement {
    const p = this.panels.get(id);
    if (!p) throw new Error(`unknown info tab: ${id}`);
    return p;
  }

  private showTab(id: string): void {
    for (const [tab, p] of this.panels) p.hidden = tab !== id;
    this.scroller.scrollTop = 0;
  }

  private buildVersion(p: HTMLElement): void {
    el('div', 'info-app-name', p, APP_MANIFEST.name);
    el('div', 'info-version', p, `バージョン ${APP_VERSION}`);
    el('p', 'info-text', p, APP_MANIFEST.description);
    el('p', 'info-text', p, '更新は自動で届き、次に起動したときに入ります。');
  }

  private buildChanges(p: HTMLElement): void {
    for (const entry of parseChangelog(changelogText)) {
      el('h3', 'info-subheading', p, entry.title);
      const list = el('ul', 'info-list', p);
      for (const item of entry.items) el('li', '', list, item);
    }
  }

  private buildLicenses(p: HTMLElement): void {
    el(
      'p',
      'info-text',
      p,
      'このゲームは次のオープンソースのライブラリ・素材を使っています（ビルド時に集計）。',
    );
    for (const lib of LICENSES) {
      const d = el('details', 'info-license', p);
      el('summary', '', d, `${lib.name} ${lib.version} — ${lib.license || '不明'}`);
      if (lib.url) el('div', 'info-license-url', d, lib.url);
      if (lib.text) el('pre', 'info-license-text', d, lib.text);
    }
    for (const x of EXTRA_LICENSES) {
      const d = el('details', 'info-license', p);
      el('summary', '', d, `${x.name} — ${x.license}`);
      el('div', 'info-license-url', d, x.url);
    }
  }

  private buildData(p: HTMLElement): void {
    for (const [title, text] of DATA_POLICY) {
      el('h3', 'info-subheading', p, title);
      el('p', 'info-text', p, text);
    }
  }
}
