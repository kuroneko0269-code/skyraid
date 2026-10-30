import './campaign.css';
import type { Locale } from '../core/locale';
import { DEFAULT_RANK_MULTIPLIERS } from '../data/ranking';
import type { MissionDef } from '../missions/types';
import { el } from './hud-dom';
import { formatClock, formatCredits, missionStrings, objectiveSummary } from './mission-text';
import { createButton, createScreen, setScreenShown } from './screen';

/** ブリーフィング（2-4）: タイトル・説明・目標の一覧・制限時間・報酬と「出撃」ボタン */
export class BriefingScreen {
  readonly root: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly text: HTMLParagraphElement;
  private readonly objectives: HTMLOListElement;
  private readonly facts: HTMLDivElement;
  private readonly launch: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    private readonly locale: Locale,
    handlers: { onLaunch: () => void; onBack: () => void },
  ) {
    const root = createScreen(parent, 'campaign-screen briefing-screen');
    const panel = el('div', 'campaign-panel', root);
    el('div', 'campaign-kicker', panel, 'BRIEFING');
    this.title = el('h2', 'campaign-title', panel);
    this.text = el('p', 'briefing-text', panel);
    el('div', 'campaign-label', panel, '目標');
    this.objectives = el('ol', 'briefing-objectives', panel);
    this.facts = el('div', 'campaign-facts', panel);
    const buttons = el('div', 'campaign-buttons', panel);
    createButton(buttons, 'menu-button campaign-back', '← ミッション一覧', handlers.onBack);
    this.launch = createButton(buttons, 'menu-button campaign-go', '出撃', handlers.onLaunch);
    this.root = root;
  }

  /** 表示するミッション */
  show(m: MissionDef): void {
    const text = missionStrings(m.id, this.locale);
    this.title.textContent = text.title;
    this.text.textContent = text.briefing.join('\n');
    this.objectives.replaceChildren();
    m.objectives.forEach((o, i) => {
      const li = el('li', 'briefing-objective', this.objectives);
      // 順番に進む目標は「→」、同時に進む目標は「＋」を付ける
      const order = i === 0 ? '' : o.start === 'afterPrevious' ? '→ ' : '＋ ';
      li.textContent = `${order}${objectiveSummary(o)}`;
      el('span', o.required ? 'tag is-required' : 'tag', li, o.required ? '必須' : '任意');
    });
    const multipliers = m.reward.rankMultipliers ?? DEFAULT_RANK_MULTIPLIERS;
    this.facts.replaceChildren();
    const fact = (label: string, value: string): void => {
      const row = el('div', 'campaign-fact', this.facts);
      el('span', 'campaign-fact-label', row, label);
      el('span', 'campaign-fact-value', row, value);
    };
    fact('制限時間', m.timeLimitSeconds === undefined ? 'なし' : formatClock(m.timeLimitSeconds));
    fact('報酬', `${formatCredits(m.reward.baseCredits)}（S ×${multipliers.S}）`);
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (shown) this.launch.focus({ preventScroll: true });
  }
}
