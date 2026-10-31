// PvP のリザルト（5-3）: 順位・名前・撃墜・被撃墜・命中率の表。ロビーの画面の中に出す。文字は textContent だけで入れる
import { el } from './hud-dom';
import { playerColorCss } from './lobby-colors';

export interface ResultRow {
  rank: number;
  id: number;
  name: string;
  kills: number;
  deaths: number;
  /** 機銃の命中率（0〜1） */
  accuracy: number;
}

export interface ResultView {
  /** 終わり方（撃墜数に達した / 時間切れ） */
  reason: 'score' | 'time';
  localId: number;
  rows: readonly ResultRow[];
}

export function renderResult(parent: HTMLElement, r: Readonly<ResultView>): void {
  parent.replaceChildren();
  el('div', 'ui-kicker campaign-kicker', parent, 'RESULT');
  // 全員が 1 位なら引き分け、自分が 1 位（同率を含む）なら勝利
  const draw = r.rows.length > 1 && r.rows.every((x) => x.rank === 1);
  const won = r.rows.some((x) => x.rank === 1 && x.id === r.localId);
  el('h2', 'ui-title campaign-title', parent, draw ? '引き分け' : won ? '勝利' : '終了');
  el('p', 'briefing-text', parent, r.reason === 'score' ? '撃墜数に到達' : '時間切れ');
  const table = el('table', 'pvp-result-table', parent);
  const head = el('tr', '', el('thead', '', table));
  for (const h of ['順位', 'パイロット', '撃墜', '被撃墜', '命中率']) el('th', '', head, h);
  const body = el('tbody', '', table);
  for (const row of r.rows) {
    const tr = el('tr', row.id === r.localId ? 'is-you' : '', body);
    el('td', 'pvp-num', tr, String(row.rank));
    const name = el('td', 'pvp-name', tr);
    const dot = el('span', 'lobby-dot', name);
    dot.style.background = playerColorCss(row.id);
    el('span', '', name, row.name);
    el('td', 'pvp-num', tr, String(row.kills));
    el('td', 'pvp-num', tr, String(row.deaths));
    el('td', 'pvp-num', tr, `${Math.round(row.accuracy * 100)}%`);
  }
}
