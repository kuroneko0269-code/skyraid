// PvP のリザルト（5-3）: 順位・名前・撃墜・被撃墜・命中率の表。ロビーの画面の中に出す。文字は textContent だけで入れる。
// 5-4: ベストプレイヤー（最多撃墜）、最長連続撃墜、チーム戦の合計と勝ったチーム、「もう一度」を押した人の印
import { PVP_TEAM } from '../data/pvp';
import type { PlayerInfo } from '../net/protocol';
import type { RaidSummary } from '../net/raid-result';
import { renderRaidResult } from './raid-result';
import { el } from './hud-dom';
import { playerColorCss, teamColorCss } from './lobby-colors';

export interface ResultRow {
  rank: number;
  id: number;
  name: string;
  kills: number;
  deaths: number;
  /** 機銃の命中率（0〜1） */
  accuracy: number;
  /** 最長連続撃墜 */
  bestStreak: number;
  /** チーム戦のチーム（個人戦は null） */
  team: number | null;
}

export interface ResultView {
  /** 終わり方（撃墜数に達した / 時間切れ / レイドの成功・失敗。6-2） */
  reason: 'score' | 'time' | 'raidClear' | 'raidFail';
  localId: number;
  rows: readonly ResultRow[];
  /** ベストプレイヤー（誰も撃墜していなければ null） */
  best: { readonly id: number; readonly name: string; readonly kills: number } | null;
  /** チーム戦の合計（[A, B]）。個人戦は null */
  teamTotals: readonly [number, number] | null;
  /** 守れた建物の割合（%。街のあるマップのレイドだけ。6-4） */
  protectedBuildings?: number | null;
  /** 協力レイドの結果（6-6。PvP は省略） */
  raid?: RaidSummary | null;
}

const REASON_TEXT: Readonly<Record<ResultView['reason'], string>> = {
  score: '撃墜数に到達',
  time: '時間切れ',
  raidClear: '全員で怪獣を倒した（報酬は全員同じ）',
  raidFail: '怪獣が街に到達した（全員に 300 CR）',
};

function title(r: Readonly<ResultView>): string {
  if (r.reason === 'raidClear') return 'ヴォルガス撃破';
  if (r.reason === 'raidFail') return '作戦失敗';
  const t = r.teamTotals;
  if (t) {
    if (t[0] === t[1]) return '引き分け';
    const winner = t[0] > t[1] ? 0 : 1;
    const mine = r.rows.find((x) => x.id === r.localId)?.team;
    return mine === winner ? '勝利' : '敗北';
  }
  // 全員が 1 位なら引き分け、自分が 1 位（同率を含む）なら勝利
  const draw = r.rows.length > 1 && r.rows.every((x) => x.rank === 1);
  const won = r.rows.some((x) => x.rank === 1 && x.id === r.localId);
  return draw ? '引き分け' : won ? '勝利' : '終了';
}

export function renderResult(parent: HTMLElement, r: Readonly<ResultView>): void {
  parent.replaceChildren();
  el('div', 'ui-kicker campaign-kicker', parent, 'RESULT');
  el('h2', 'ui-title campaign-title', parent, title(r));
  el('p', 'briefing-text', parent, REASON_TEXT[r.reason]);
  if (r.raid) {
    const names = new Map(r.rows.map((x) => [x.id, x.name]));
    renderRaidResult(parent, r.raid, (id) => names.get(id) ?? `P${id + 1}`, r.localId);
    return;
  }
  if (r.protectedBuildings != null) {
    el('p', 'briefing-text', parent, `守れた建物 ${r.protectedBuildings}%`);
  }
  const t = r.teamTotals;
  if (t) {
    const line = el('div', 'pvp-result-teams', parent);
    [0, 1].forEach((team) => {
      const s = el(
        'span',
        'pvp-result-team',
        line,
        `チーム ${PVP_TEAM.names[team] ?? ''}  ${t[team] ?? 0}`,
      );
      s.style.color = teamColorCss(team);
      if (team === 0) el('span', 'pvp-feed-verb', line, ' − ');
    });
  }
  if (r.best) {
    const best = el('div', 'pvp-result-best', parent);
    el('span', 'campaign-fact-label', best, 'BEST PLAYER');
    const name = el('span', 'pvp-result-best-name', best, r.best.name);
    name.style.color = playerColorCss(r.best.id);
    el('span', 'pvp-result-best-kills', best, `${r.best.kills} 撃墜`);
  }
  const table = el('table', 'pvp-result-table', parent);
  const head = el('tr', '', el('thead', '', table));
  for (const h of ['順位', 'パイロット', '撃墜', '被撃墜', '命中率', '連続']) el('th', '', head, h);
  const body = el('tbody', '', table);
  for (const row of r.rows) {
    const tr = el('tr', row.id === r.localId ? 'is-you' : '', body);
    el('td', 'pvp-num', tr, String(row.rank));
    const name = el('td', 'pvp-name', tr);
    const dot = el('span', 'lobby-dot', name);
    dot.style.background = row.team === null ? playerColorCss(row.id) : teamColorCss(row.team);
    el('span', '', name, row.name);
    el('td', 'pvp-num', tr, String(row.kills));
    el('td', 'pvp-num', tr, String(row.deaths));
    el('td', 'pvp-num', tr, `${Math.round(row.accuracy * 100)}%`);
    el('td', 'pvp-num', tr, String(row.bestStreak));
  }
}

/** 「もう一度」の待ち: 押した人に ✓、全員そろうとロビーへ */
export function renderAgain(
  parent: HTMLElement,
  players: readonly Readonly<PlayerInfo>[],
  localId: number,
): void {
  parent.replaceChildren();
  const pressed = players.filter((p) => p.again).length;
  el(
    'p',
    'briefing-text',
    parent,
    `全員が「もう一度」を押すとロビーへ戻ります（${pressed} / ${players.length}）`,
  );
  const list = el('div', 'pvp-again', parent);
  for (const p of players) {
    const chip = el('span', p.again ? 'pvp-again-chip is-done' : 'pvp-again-chip', list);
    const mark = el('span', 'pvp-again-mark', chip, p.again ? '✓' : '…');
    mark.style.color = p.again ? playerColorCss(p.id) : '';
    el('span', '', chip, p.id === localId ? `${p.name}（あなた）` : p.name);
  }
}
