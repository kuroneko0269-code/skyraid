// 「情報」画面（7-D）: モード選択の「情報」から。モード選択の上に重ねる（ランキングと同じ）。
// タブは 版 / 更新履歴（docs/changelog.md）/ ライセンス（ビルド時に生成。scripts/vite-app-info.ts）/ データの扱い
import './info.css';
import { APP_VERSION, LICENSES } from 'virtual:app-info';
import changelogText from '../../docs/changelog.md?raw';
import { parseChangelog } from '../core/changelog';
import { APP_MANIFEST } from '../data/app';
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

/** データの扱い（セーブはブラウザ内、オンライン連携は任意） */
const DATA_POLICY: readonly (readonly [string, string])[] = [
  [
    'セーブはこのブラウザの中',
    '進み具合・クレジット・機体・設定はこのブラウザの localStorage に、リプレイは IndexedDB に保存します。外部のサーバーには送りません。ブラウザのデータを消すと消えるので、設定の「データ」→「セーブデータ」でコピーを取れます。',
  ],
  [
    'オンライン連携は任意',
    '設定の「データ」→「オンライン連携」でログインしたときだけ、メールアドレス（ログイン用）・表示名・セーブのバックアップ・レース / レイド / 防衛戦の記録をサーバー（Supabase）に送ります。連携を OFF にすると送信と同期を止めます。',
  ],
  [
    'マルチプレイ',
    'PvP・協力プレイは端末どうしの直接通信（WebRTC / PeerJS）でゲームの状態をやり取りします。接続の仲介に PeerJS の公開サーバー（0.peerjs.com）を使います。',
  ],
  ['フォント', '見出しのフォント（Rajdhani）を Google Fonts から読み込みます。'],
  ['広告・解析', '広告・アクセス解析は使っていません。'],
];

export class InfoScreen {
  readonly root: HTMLDivElement;
  private readonly panels = new Map<string, HTMLDivElement>();
  private readonly tabs: Segmented;
  private open = false;

  constructor(
    parent: HTMLElement,
    private readonly modeSelect: ModeSelectScreen,
    private readonly onClose: () => void,
  ) {
    const root = createScreen(parent, 'info-screen');
    const header = el('div', 'menu-header', root);
    createButton(header, 'ui-button is-ghost menu-back', '← モード選択へ', () => {
      this.close();
    });
    el('h2', 'ui-heading menu-heading', header, '情報');
    this.tabs = new Segmented(
      root,
      '',
      TABS,
      'version',
      (v) => {
        this.showTab(v);
      },
      'info-tabs',
    );
    const body = el('div', 'ui-panel info-body', root);
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

  /** モード選択の上に重ねる情報画面を作る（Esc で閉じる・閉じたらモード選択を出し直す） */
  static over(parent: HTMLElement, modeSelect: ModeSelectScreen, game: GameState): InfoScreen {
    const info = new InfoScreen(parent, modeSelect, () => {
      if (game.state === 'mode_select') modeSelect.reveal();
    });
    modeSelect.addOverlay(() => info.close());
    return info;
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
