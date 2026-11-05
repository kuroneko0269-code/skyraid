// PvP のリザルト（5-3）: 順位・名前・撃墜・被撃墜・命中率の表。ロビーの画面の中に出す。文字は textContent だけで入れる。
// 5-4: ベストプレイヤー（最多撃墜）、最長連続撃墜、チーム戦の合計と勝ったチーム、「もう一度」を押した人の印
import { NEPHIRGA_ID } from '../data/raid-kaiju';
import { PVP_TEAM } from '../data/pvp';
import type { PlayerInfo } from '../net/protocol';
import type { RaidSummary } from '../net/raid-result';
import { renderRaidResult } from './raid-result';
import type { DefenseSummary } from '../net/defense-result';
import { DEFENSE_CONFIG } from '../data/defense';
import { formatCredits } from './mission-text';
import { t, tn } from '../core/i18n';
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
  reason:
    | 'score'
    | 'time'
    | 'raidClear'
    | 'raidFail'
    | 'raidStormFail'
    | 'raidTotalFail'
    | 'raidLivesFail'
    | 'defenseClear'
    | 'defenseFail';
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
  /** 協力の防衛戦の結果（7-2） */
  defense?: DefenseSummary | null;
}

const REASON_TEXT: Readonly<Record<ResultView['reason'], string>> = {
  get score() {
    return t('pvp.reason.score');
  },
  get time() {
    return t('pvp.reason.time');
  },
  get raidClear() {
    return t('pvp.reason.raidClear');
  },
  get raidFail() {
    return t('pvp.reason.raidFail');
  },
  // 9-6c: ネフィルガの失敗（嵐 / 全体の時間切れ）
  get raidStormFail() {
    return t('pvp.reason.raidStormFail');
  },
  get raidTotalFail() {
    return t('pvp.reason.raidTotalFail');
  },
  // 9-6d: 全員が残機を使い切った
  get raidLivesFail() {
    return t('pvp.reason.raidLivesFail');
  },
  get defenseClear() {
    return t('pvp.reason.defenseClear');
  },
  get defenseFail() {
    return t('pvp.reason.defenseFail');
  },
};

function title(r: Readonly<ResultView>): string {
  if (r.reason === 'raidClear')
    return r.raid?.kaiju === NEPHIRGA_ID ? t('pvp.title.raid2Clear') : t('pvp.title.raidClear');
  if (
    r.reason === 'raidFail' ||
    r.reason === 'raidStormFail' ||
    r.reason === 'raidTotalFail' ||
    r.reason === 'raidLivesFail'
  )
    return t('pvp.title.raidFail');
  if (r.reason === 'defenseClear') return t('defense.outcome.cleared');
  if (r.reason === 'defenseFail') return t('defense.outcome.fallen');
  const totals = r.teamTotals;
  if (totals) {
    if (totals[0] === totals[1]) return t('pvp.title.draw');
    const winner = totals[0] > totals[1] ? 0 : 1;
    const mine = r.rows.find((x) => x.id === r.localId)?.team;
    return mine === winner ? t('pvp.title.win') : t('pvp.title.lose');
  }
  // 全員が 1 位なら引き分け、自分が 1 位（同率を含む）なら勝利
  const draw = r.rows.length > 1 && r.rows.every((x) => x.rank === 1);
  const won = r.rows.some((x) => x.rank === 1 && x.id === r.localId);
  return draw ? t('pvp.title.draw') : won ? t('pvp.title.win') : t('pvp.title.over');
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
  if (r.defense) renderDefenseResult(parent, r.defense, r.rows);
  if (r.protectedBuildings != null) {
    el('p', 'briefing-text', parent, t('pvp.result.protected', { percent: r.protectedBuildings }));
  }
  const totals = r.teamTotals;
  if (totals) {
    const line = el('div', 'pvp-result-teams', parent);
    [0, 1].forEach((team) => {
      const s = el(
        'span',
        'pvp-result-team',
        line,
        t('pvp.result.team', { team: PVP_TEAM.names[team] ?? '', score: totals[team] ?? 0 }),
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
    el('span', 'pvp-result-best-kills', best, tn('pvp.result.kills', r.best.kills));
  }
  const table = el('table', 'pvp-result-table', parent);
  const head = el('tr', '', el('thead', '', table));
  for (const h of ['rank', 'pilot', 'kills', 'deaths', 'accuracy', 'streak'])
    el('th', '', head, t(`pvp.table.${h}`));
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

/** 協力の防衛戦（7-2）: 難易度・クリアした波・司令部・施設・報酬・MVP（表は PvP と同じ） */
function renderDefenseResult(
  parent: HTMLElement,
  d: Readonly<DefenseSummary>,
  rows: readonly ResultRow[],
): void {
  const s = d.score;
  const facts = el('div', 'campaign-facts', parent);
  const fact = (label: string, value: string): void => {
    const row = el('div', 'campaign-fact', facts);
    el('span', 'campaign-fact-label', row, label);
    el('span', 'campaign-fact-value', row, value);
  };
  fact(
    t('pvp.result.map'),
    t('defense.result.info', {
      map: d.mapName,
      difficulty: d.hard ? t('defense.difficulty.hard') : t('defense.difficulty.normal'),
    }),
  );
  fact(t('defense.result.wavesCleared'), `${s.wavesCleared} / ${DEFENSE_CONFIG.waves}`);
  fact(t('pvp.result.killsAll'), String(s.kills));
  fact(t('defense.result.hq'), `${Math.ceil(Math.max(0, s.hqHp))} / ${s.hqMaxHp}`);
  fact(t('defense.result.facilities'), `${s.facilitiesAlive} / ${s.facilitiesTotal}`);
  fact(t('pvp.result.rewardAll'), `+${formatCredits(d.credits)}`);
  const mvp = rows.find((x) => x.id === d.mvp);
  fact('MVP', mvp ? tn('pvp.result.mvp', mvp.kills, { name: mvp.name }) : t('pvp.result.none'));
}

/** 「もう一度」の待ち: 押した人に ✓、全員そろうとロビーへ */
export function renderAgain(
  parent: HTMLElement,
  players: readonly Readonly<PlayerInfo>[],
  localId: number,
): void {
  parent.replaceChildren();
  const pressed = players.filter((p) => p.again).length;
  el('p', 'briefing-text', parent, t('pvp.result.againWait', { pressed, total: players.length }));
  const list = el('div', 'pvp-again', parent);
  for (const p of players) {
    const chip = el('span', p.again ? 'pvp-again-chip is-done' : 'pvp-again-chip', list);
    const mark = el('span', 'pvp-again-mark', chip, p.again ? '✓' : '…');
    mark.style.color = p.again ? playerColorCss(p.id) : '';
    el('span', '', chip, p.id === localId ? t('pvp.result.you', { name: p.name }) : p.name);
  }
}
