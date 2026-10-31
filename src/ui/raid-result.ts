// 協力レイドのリザルト（6-6。pvp-result.ts の中に出す）: 難易度・クリア時間・守れた建物 %・報酬（全員同じ）、MVP、
// 全員の部位別の与ダメージ・合計・ブレイク回数・復帰回数の表。文字は textContent だけで入れる
import { KAIJU_CONFIG, KAIJU_PARTS } from '../data/kaiju';
import { RAID_DIFFICULTY_LABELS } from '../data/raid';
import type { RaidSummary } from '../net/raid-result';
import { el } from './hud-dom';
import { playerColorCss } from './lobby-colors';
import { formatClock } from './mission-text';

export function renderRaidResult(
  parent: HTMLElement,
  s: Readonly<RaidSummary>,
  nameOf: (id: number) => string,
  localId: number,
): void {
  const facts = el('div', 'campaign-facts raid-result-facts', parent);
  const fact = (label: string, value: string): void => {
    const f = el('div', 'campaign-fact', facts);
    el('span', 'campaign-fact-label', f, label);
    el('span', 'campaign-fact-value', f, value);
  };
  fact('難易度', RAID_DIFFICULTY_LABELS[s.difficulty]);
  fact(s.cleared ? 'クリア時間' : '経過時間', formatClock(s.seconds));
  if (s.protectedBuildings !== null) fact('守れた建物', `${s.protectedBuildings}%`);
  fact('報酬（全員）', `${s.credits.toLocaleString('ja-JP')} CR`);
  if (s.mvp !== null) {
    const row = s.rows.find((r) => r.id === s.mvp);
    const best = el('div', 'pvp-result-best', parent);
    el('span', 'campaign-fact-label', best, 'MVP');
    const name = el('span', 'pvp-result-best-name', best, nameOf(s.mvp));
    name.style.color = playerColorCss(s.mvp);
    el('span', 'pvp-result-best-kills', best, `与ダメージ ${Math.round(row?.total ?? 0)}`);
  }
  const wrap = el('div', 'raid-result-wrap', parent);
  const table = el('table', 'pvp-result-table raid-result-table', wrap);
  const head = el('tr', '', el('thead', '', table));
  el('th', '', head, 'パイロット');
  for (const id of KAIJU_PARTS) el('th', '', head, KAIJU_CONFIG.parts[id].label);
  for (const h of ['合計', 'ブレイク', '復帰']) el('th', '', head, h);
  const body = el('tbody', '', table);
  for (const r of s.rows) {
    const tr = el('tr', r.id === localId ? 'is-you' : '', body);
    const name = el('td', 'pvp-name', tr);
    const dot = el('span', 'lobby-dot', name);
    dot.style.background = playerColorCss(r.id);
    el('span', '', name, nameOf(r.id));
    KAIJU_PARTS.forEach((_, i) =>
      el('td', 'pvp-num', tr, String(Math.round(r.partDamage[i] ?? 0))),
    );
    el('td', 'pvp-num', tr, String(Math.round(r.total)));
    el('td', 'pvp-num', tr, String(r.breaks));
    el('td', 'pvp-num', tr, String(r.respawns));
  }
}
