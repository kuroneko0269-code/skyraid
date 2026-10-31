// PvP のロビー画面（5-1）: 「部屋を作る」「コードで参加」→ 接続中 → ロビー（部屋の画面は lobby-room.ts）→
// 対戦の後のリザルト（5-3）。5-4: 準備・ハンガー（lobby-hangar.ts）・共有・定型文・チーム、リザルトの「もう一度」の待ち。
// 見た目は 4-10 のデザインシステム。通信はしない（ui/pvp-link.ts が呼ぶ）。文字は textContent だけで入れる
import './lobby.css';
import { NET_CONFIG } from '../data/net';
import type { PlayerInfo } from '../net/protocol';
import { renderAgain, renderResult, type ResultView } from './pvp-result';
import { el } from './hud-dom';
import { LobbyHangar, type LobbyHangarEntry } from './lobby-hangar';
import { LobbyRoom, type LobbyRoomHandlers, type LobbyRoomView } from './lobby-room';
import { isolateKeys } from './pilot-name';
import { createButton, createScreen, setScreenShown } from './screen';

export type { LobbyRoomView };

export interface LobbyHandlers extends LobbyRoomHandlers {
  onCreate: () => void;
  onJoin: (code: string) => void;
  /** モード選択へ戻る */
  onBack: () => void;
  /** リザルトの「もう一度」（全員そろうとロビーへ。5-4） */
  onAgain: () => void;
  /** ハンガーで機体を選んだ（5-4） */
  onAircraft: (id: string) => void;
}

type View = 'menu' | 'connecting' | 'room' | 'result';

export class LobbyScreen {
  readonly root: HTMLDivElement;
  private view: View = 'menu';
  private readonly panel: HTMLDivElement;
  private readonly menu: HTMLDivElement;
  private readonly connecting: HTMLDivElement;
  private readonly connectingText: HTMLParagraphElement;
  private readonly room: LobbyRoom;
  private readonly codeInput: HTMLInputElement;
  private readonly error: HTMLParagraphElement;
  private readonly createButton: HTMLButtonElement;
  private readonly result: HTMLDivElement;
  private readonly resultBody: HTMLDivElement;
  private readonly againBody: HTMLDivElement;
  private readonly againButton: HTMLButtonElement;
  private readonly hangar: LobbyHangar;

  constructor(parent: HTMLElement, handlers: LobbyHandlers) {
    const root = createScreen(parent, 'campaign-screen lobby-screen');
    const panel = el('div', 'ui-panel campaign-panel lobby-panel', root);
    this.panel = panel;
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

    // ロビー（5-4 で lobby-room.ts に分けた）
    this.room = new LobbyRoom(panel, root, handlers);
    this.hangar = new LobbyHangar(root, handlers.onAircraft);

    // リザルト（5-3）と「もう一度」の待ち（5-4）
    this.result = el('div', 'lobby-view', panel);
    this.resultBody = el('div', 'lobby-result', this.result);
    this.againBody = el('div', 'lobby-again', this.result);
    const again = el('div', 'campaign-buttons', this.result);
    createButton(again, 'ui-button is-ghost campaign-back', '退出', handlers.onLeave);
    this.againButton = createButton(again, 'ui-button is-primary campaign-go', 'もう一度', () => {
      this.againButton.disabled = true;
      this.againButton.textContent = 'ほかの人を待っています';
      handlers.onAgain();
    });
    this.root = root;
    this.show('menu');
  }

  /** 対戦のリザルト（順位・撃墜・被撃墜・命中率・連続撃墜・ベストプレイヤー）と「もう一度」の待ち */
  showResult(r: Readonly<ResultView>, players: readonly Readonly<PlayerInfo>[]): void {
    renderResult(this.resultBody, r);
    this.againButton.disabled = false;
    this.againButton.textContent = 'もう一度';
    this.updateAgain(players, r.localId);
    this.hangar.close();
    this.show('result');
    this.againButton.focus({ preventScroll: true });
  }

  /** 「もう一度」を押した人の印を描き直す */
  updateAgain(players: readonly Readonly<PlayerInfo>[], localId: number): void {
    renderAgain(this.againBody, players, localId);
  }

  /** 部屋コードの入力欄に入れる（?room=XXXXXX） */
  setCode(code: string): void {
    this.codeInput.value = code;
  }

  showMenu(error = ''): void {
    this.error.textContent = error;
    this.error.hidden = error === '';
    this.hangar.close();
    this.show('menu');
  }

  showConnecting(text: string): void {
    this.connectingText.textContent = text;
    this.show('connecting');
  }

  showRoom(r: Readonly<LobbyRoomView>): void {
    this.room.render(r);
    const firstShow = this.view !== 'room';
    this.show('room');
    if (firstShow) this.room.focusMain();
  }

  /** 定型文（部屋の画面のその人の行に 3 秒） */
  showChat(from: number, phrase: number): void {
    this.room.showChat(from, phrase);
  }

  /** ハンガー（所持機体の一覧）を開く */
  openHangar(entries: readonly LobbyHangarEntry[], note: string): void {
    this.hangar.open(entries, note);
  }

  /** Esc: 開いているダイアログ（ハンガー・QR）を閉じたら true */
  closeDialog(): boolean {
    if (this.hangar.isOpen) {
      this.hangar.close();
      return true;
    }
    return this.room.closeDialogs();
  }

  get currentView(): View {
    return this.view;
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (!shown) {
      this.hangar.close();
      this.room.closeDialogs();
    }
    if (shown && this.view === 'menu') this.createButton.focus({ preventScroll: true });
  }

  private show(view: View): void {
    this.view = view;
    this.menu.hidden = view !== 'menu';
    this.connecting.hidden = view !== 'connecting';
    this.room.root.hidden = view !== 'room';
    this.result.hidden = view !== 'result';
    this.panel.classList.toggle('is-wide', view === 'room' || view === 'result');
  }
}
