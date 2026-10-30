// PvP のロビー画面（5-1。最小限）: 「部屋を作る」「コードで参加」→ 接続中 → ロビー（部屋コード・参加者・ホストの「開始」）。
// 見た目は 4-10 のデザインシステム。通信はしない（ui/pvp-link.ts が呼ぶ）。文字は textContent だけで入れる
import './lobby.css';
import { NET_CONFIG } from '../data/net';
import type { PlayerInfo } from '../net/protocol';
import { el } from './hud-dom';
import { isolateKeys } from './pilot-name';
import { createButton, createScreen, setScreenShown } from './screen';

export interface LobbyHandlers {
  onCreate: () => void;
  onJoin: (code: string) => void;
  onStart: () => void;
  /** 接続中の取り消し・ロビーからの退出 */
  onLeave: () => void;
  /** モード選択へ戻る */
  onBack: () => void;
}

export interface LobbyRoomView {
  code: string;
  isHost: boolean;
  localId: number;
  players: readonly PlayerInfo[];
  mapName: string;
}

type View = 'menu' | 'connecting' | 'room';

/** CSS の色（#rrggbb） */
export function playerColorCss(id: number): string {
  const c = NET_CONFIG.playerColors[id % NET_CONFIG.playerColors.length] ?? 0xffffff;
  return `#${c.toString(16).padStart(6, '0')}`;
}

export class LobbyScreen {
  readonly root: HTMLDivElement;
  private view: View = 'menu';
  private readonly menu: HTMLDivElement;
  private readonly connecting: HTMLDivElement;
  private readonly connectingText: HTMLParagraphElement;
  private readonly room: HTMLDivElement;
  private readonly codeInput: HTMLInputElement;
  private readonly error: HTMLParagraphElement;
  private readonly codeText: HTMLDivElement;
  private readonly mapText: HTMLSpanElement;
  private readonly list: HTMLUListElement;
  private readonly startButton: HTMLButtonElement;
  private readonly waitText: HTMLParagraphElement;
  private readonly createButton: HTMLButtonElement;

  constructor(parent: HTMLElement, handlers: LobbyHandlers) {
    const root = createScreen(parent, 'campaign-screen lobby-screen');
    const panel = el('div', 'ui-panel campaign-panel lobby-panel', root);
    el('div', 'ui-kicker campaign-kicker', panel, 'PVP');

    // 最初の選択: 部屋を作る / コードで参加
    this.menu = el('div', 'lobby-view', panel);
    el('h2', 'ui-title campaign-title', this.menu, 'PvP');
    el('p', 'briefing-text', this.menu, `2〜${NET_CONFIG.maxPlayers} 人で同じ空を飛ぶ`);
    this.createButton = createButton(
      this.menu,
      'ui-button is-primary lobby-wide',
      '部屋を作る',
      handlers.onCreate,
    );
    const form = el('form', 'lobby-join', this.menu);
    this.codeInput = el('input', 'ui-field lobby-code-input', form);
    this.codeInput.type = 'text';
    this.codeInput.placeholder = '部屋コード';
    this.codeInput.autocomplete = 'off';
    this.codeInput.spellcheck = false;
    this.codeInput.maxLength = NET_CONFIG.room.codeLength + 2;
    this.codeInput.setAttribute('autocapitalize', 'characters');
    this.codeInput.setAttribute('aria-label', '部屋コード');
    isolateKeys(this.codeInput);
    const join = createButton(form, 'ui-button lobby-join-button', 'コードで参加', () => undefined);
    join.type = 'submit';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.codeInput.blur();
      handlers.onJoin(this.codeInput.value);
    });
    this.error = el('p', 'lobby-error', this.menu);
    this.error.setAttribute('role', 'alert');
    const back = el('div', 'campaign-buttons', this.menu);
    createButton(back, 'ui-button is-ghost campaign-back', '← モード選択へ', handlers.onBack);

    // 接続中
    this.connecting = el('div', 'lobby-view', panel);
    this.connectingText = el('p', 'briefing-text lobby-connecting', this.connecting, '接続中…');
    const cancel = el('div', 'campaign-buttons', this.connecting);
    createButton(cancel, 'ui-button is-ghost campaign-back', '取り消し', handlers.onLeave);

    // ロビー
    this.room = el('div', 'lobby-view', panel);
    el('div', 'campaign-label', this.room, 'ROOM CODE');
    this.codeText = el('div', 'lobby-code', this.room);
    const facts = el('div', 'campaign-facts', this.room);
    const map = el('div', 'campaign-fact', facts);
    el('span', 'campaign-fact-label', map, 'マップ');
    this.mapText = el('span', 'campaign-fact-value', map);
    el('div', 'campaign-label', this.room, 'PILOTS');
    this.list = el('ul', 'lobby-players', this.room);
    this.waitText = el('p', 'briefing-text', this.room);
    const buttons = el('div', 'campaign-buttons', this.room);
    createButton(buttons, 'ui-button is-ghost campaign-back', '退出', handlers.onLeave);
    this.startButton = createButton(
      buttons,
      'ui-button is-primary campaign-go',
      '開始',
      handlers.onStart,
    );
    this.root = root;
    this.show('menu');
  }

  /** 部屋コードの入力欄に入れる（?room=XXXXXX） */
  setCode(code: string): void {
    this.codeInput.value = code;
  }

  showMenu(error = ''): void {
    this.error.textContent = error;
    this.error.hidden = error === '';
    this.show('menu');
  }

  showConnecting(text: string): void {
    this.connectingText.textContent = text;
    this.show('connecting');
  }

  showRoom(r: Readonly<LobbyRoomView>): void {
    this.codeText.textContent = r.code;
    this.mapText.textContent = r.mapName;
    this.list.replaceChildren();
    for (const p of r.players) {
      const li = el('li', 'lobby-player', this.list);
      const dot = el('span', 'lobby-dot', li);
      dot.style.background = playerColorCss(p.id);
      el('span', 'lobby-name', li, p.name);
      const tags = [p.id === 0 ? 'ホスト' : '', p.id === r.localId ? 'あなた' : ''].filter(Boolean);
      if (tags.length > 0) el('span', 'tag', li, tags.join('・'));
    }
    const enough = r.players.length >= 2;
    this.startButton.hidden = !r.isHost;
    this.startButton.disabled = !enough;
    this.waitText.textContent = r.isHost
      ? enough
        ? '全員そろったら「開始」'
        : 'ほかのプレイヤーに部屋コードを伝えてください'
      : 'ホストの開始を待っています';
    const firstShow = this.view !== 'room';
    this.show('room');
    if (firstShow && r.isHost) this.startButton.focus({ preventScroll: true });
  }

  get currentView(): View {
    return this.view;
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (shown && this.view === 'menu') this.createButton.focus({ preventScroll: true });
  }

  private show(view: View): void {
    this.view = view;
    this.menu.hidden = view !== 'menu';
    this.connecting.hidden = view !== 'connecting';
    this.room.hidden = view !== 'room';
  }
}
