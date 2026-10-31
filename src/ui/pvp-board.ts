import './pvp.css';
// PvP の飛行中の成績の表示（5-3）: 撃墜のフィード（右上、4 件・5 秒）、スコアボード（Tab 長押し / レーダーをタップ）、
// 残り時間（上の中央）。文字は textContent だけで入れ、変わったときだけ書き換える
import { standings } from '../combat/pvp-rules';
import type { FeedItem } from '../net/pvp-mirror';
import type { PlayerInfo, ScoreMsg } from '../net/protocol';
import { el } from './hud-dom';
import { playerColorCss } from './lobby-colors';

function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class PvpBoard {
  private readonly feed: HTMLDivElement;
  private readonly timer: HTMLDivElement;
  private readonly board: HTMLDivElement;
  private readonly boardTime: HTMLSpanElement;
  private readonly rows: HTMLTableSectionElement;
  private feedKey = '';
  private boardKey = '';
  private lastClock = '';

  constructor(parent: HTMLElement) {
    this.feed = el('div', 'pvp-feed', parent);
    this.timer = el('div', 'pvp-timer', parent);
    this.board = el('div', 'ui-dialog pvp-board', parent);
    const head = el('div', 'pvp-board-head', this.board);
    el('span', 'ui-kicker', head, 'SCORE');
    this.boardTime = el('span', 'pvp-board-time', head);
    const table = el('table', 'pvp-result-table', this.board);
    const tr = el('tr', '', el('thead', '', table));
    for (const h of ['順位', 'パイロット', '撃墜', '被撃墜']) el('th', '', tr, h);
    this.rows = el('tbody', '', table);
    this.hide();
  }

  hide(): void {
    this.feed.hidden = true;
    this.timer.hidden = true;
    this.board.hidden = true;
    this.feed.replaceChildren();
    this.feedKey = '';
    this.boardKey = '';
    this.lastClock = '';
  }

  /** 描画フレームごと（飛行中） */
  update(
    items: readonly FeedItem[],
    score: Readonly<ScoreMsg> | null,
    remainingSeconds: number | null,
    players: ReadonlyMap<number, PlayerInfo>,
    localId: number,
    boardOpen: boolean,
  ): void {
    this.updateFeed(items, players);
    const c = remainingSeconds === null ? '' : clock(remainingSeconds);
    if (c !== this.lastClock) {
      this.lastClock = c;
      this.timer.textContent = c;
      this.boardTime.textContent = c === '' ? '' : `残り ${c}`;
    }
    this.timer.hidden = c === '';
    this.board.hidden = !boardOpen;
    if (boardOpen && score) this.updateBoard(score, players, localId);
  }

  private updateFeed(items: readonly FeedItem[], players: ReadonlyMap<number, PlayerInfo>): void {
    const key = items.map((i) => `${i.time}:${i.killer}:${i.victim}`).join('|');
    if (key === this.feedKey) return;
    this.feedKey = key;
    this.feed.replaceChildren();
    for (const i of items) {
      const line = el('div', 'pvp-feed-item', this.feed);
      if (i.killer !== null) {
        this.name(line, i.killer, players);
        el('span', 'pvp-feed-verb', line, ' が ');
        this.name(line, i.victim, players);
        el('span', 'pvp-feed-verb', line, ' を撃墜');
      } else {
        this.name(line, i.victim, players);
        el('span', 'pvp-feed-verb', line, ' が墜落');
      }
    }
    this.feed.hidden = items.length === 0;
  }

  private name(parent: HTMLElement, id: number, players: ReadonlyMap<number, PlayerInfo>): void {
    const span = el('span', 'pvp-feed-name', parent, players.get(id)?.name ?? `P${id + 1}`);
    span.style.color = playerColorCss(id);
  }

  private updateBoard(
    score: Readonly<ScoreMsg>,
    players: ReadonlyMap<number, PlayerInfo>,
    localId: number,
  ): void {
    const list = standings(score.players);
    const key = list.map((s) => `${s.score.id}:${s.score.kills}:${s.score.deaths}`).join('|');
    if (key === this.boardKey) return;
    this.boardKey = key;
    this.rows.replaceChildren();
    for (const s of list) {
      const tr = el('tr', s.score.id === localId ? 'is-you' : '', this.rows);
      el('td', 'pvp-num', tr, String(s.rank));
      const name = el('td', 'pvp-name', tr);
      const dot = el('span', 'lobby-dot', name);
      dot.style.background = playerColorCss(s.score.id);
      el('span', '', name, players.get(s.score.id)?.name ?? '');
      el('td', 'pvp-num', tr, String(s.score.kills));
      el('td', 'pvp-num', tr, String(s.score.deaths));
    }
  }
}

/**
 * レーダー（HUD）を押したとき fn を呼ぶ。HUD は押せない（pointer-events: none）うえタッチ操作が上にあるので、
 * 押した位置をレーダーの範囲と比べる（capture で先に見る。操作の邪魔はしない）
 */
export function onRadarTap(fn: () => void): void {
  document.addEventListener(
    'pointerdown',
    (e) => {
      const radar = document.querySelector('.hud-radar');
      if (!radar) return;
      const r = radar.getBoundingClientRect();
      if (r.width === 0) return;
      if (
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom
      )
        fn();
    },
    true,
  );
}
