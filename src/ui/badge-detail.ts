// 勲章の一覧（9-10c）の右の欄: 番号とカテゴリ、条件の文と補足、進み具合のバーと数、報酬と取得日、
// 「同じ段の勲章」（同じ種類の前後の段。取った・進み具合。押すとその勲章を出す）。隠し勲章は取るまで「？？？」（番号は見せる）
import { formatCredits, formatDate, formatInteger } from '../core/format';
import { t } from '../core/i18n';
import { badgeChain, badgeNote, badgeNumber, badgeStep } from '../data/badges';
import type { SaveData } from '../progression/save';
import { rowValue, type BadgeRow } from './badge-view';
import { el } from './hud-dom';

export function renderBadgeDetail(
  d: HTMLElement,
  row: BadgeRow | null,
  all: readonly BadgeRow[],
  data: Readonly<SaveData>,
  onPick: (id: string) => void,
): void {
  d.replaceChildren();
  if (!row) {
    el('div', 'badge-detail-pick', d, t('badges.pick'));
    return;
  }
  const def = row.def;
  const head = el('div', 'badge-detail-head', d);
  head.dataset.state = row.status;
  el('span', 'badge-mark is-large', head).setAttribute('aria-hidden', 'true');
  el('span', 'badge-detail-no', head, badgeNumber(def));
  el('span', 'badge-detail-group', head, t(`badges.groups.${def.group}`));
  if (def.skill && !row.masked) el('span', 'badge-tag is-skill', head, t('badges.skill'));
  el('h3', 'badge-detail-name', d, row.title);
  const note = row.masked ? t('badges.hiddenNote') : badgeNote(def.id);
  if (note !== '') el('p', 'badge-detail-note', d, note);
  if (row.status !== 'earned' && row.progress && !row.masked) {
    const p = row.progress;
    const bar = el('div', 'badge-progress', d);
    el('span', 'badge-progress-fill', bar).style.width =
      `${String(Math.round((p.current / Math.max(1, p.goal)) * 100))}%`;
    el(
      'span',
      'badge-progress-text',
      bar,
      t('badges.progress', { current: formatInteger(p.current), goal: formatInteger(p.goal) }),
    );
  }
  const facts = el('div', 'badge-facts', d);
  field(
    facts,
    t('badges.detail.reward'),
    t('badges.rewardOnce', { credits: formatCredits(def.reward) }),
  );
  field(
    facts,
    t('badges.detail.earned'),
    row.latest > 0 ? formatDate(row.latest) : t('badges.detail.notEarned'),
  );
  if (def.stat && !row.masked) {
    const since = data.stats.since;
    el(
      'div',
      'badge-since',
      d,
      since > 0 ? t('badges.since', { date: formatDate(since) }) : t('badges.sinceNone'),
    );
  }
  const chain = badgeChain(def);
  if (chain.length < 2) return;
  el('div', 'badge-chain-title', d, t('badges.detail.chain'));
  const list = el('div', 'badge-chain', d);
  const byId = new Map(all.map((r) => [r.id, r]));
  for (const c of chain) {
    const r = byId.get(c.id);
    if (!r) continue;
    const b = el('button', 'badge-chain-item', list);
    b.type = 'button';
    b.dataset.state = r.status;
    b.setAttribute('aria-current', String(c.id === def.id));
    el('span', 'badge-mark', b).setAttribute('aria-hidden', 'true');
    el('span', 'badge-chain-no', b, badgeNumber(c));
    el('span', 'badge-chain-step', b, r.masked ? t('badges.hidden') : badgeStep(c.id));
    el('span', 'badge-chain-value', b, rowValue(r));
    b.addEventListener('click', () => {
      onPick(c.id);
    });
  }
}

function field(parent: HTMLElement, label: string, value: string): void {
  const f = el('div', 'badge-field', parent);
  el('span', 'badge-field-label', f, label);
  el('span', 'badge-field-value', f, value);
}
