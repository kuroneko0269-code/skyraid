import { t } from '../core/i18n';
import './campaign.css';
import { DEFAULT_RANK_MULTIPLIERS } from '../data/ranking';
import { missionWeather, weatherLabel } from '../data/weather';
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
  private aircraftName = '';
  private aircraftValue: HTMLSpanElement | null = null;

  constructor(
    parent: HTMLElement,
    handlers: { onLaunch: () => void; onBack: () => void; onHangar: () => void },
  ) {
    const root = createScreen(parent, 'campaign-screen briefing-screen');
    const panel = el('div', 'ui-panel campaign-panel', root);
    el('div', 'ui-kicker campaign-kicker', panel, 'BRIEFING');
    this.title = el('h2', 'ui-title campaign-title', panel);
    this.text = el('p', 'briefing-text', panel);
    el('div', 'campaign-label', panel, t('campaign.briefing.objectives'));
    this.objectives = el('ol', 'briefing-objectives', panel);
    this.facts = el('div', 'campaign-facts', panel);
    const buttons = el('div', 'campaign-buttons', panel);
    createButton(
      buttons,
      'ui-button is-ghost campaign-back',
      t('campaign.backToMissions'),
      handlers.onBack,
    );
    // 3-3: 出撃する機体を変える（ハンガーから戻るとこの画面）
    createButton(
      buttons,
      'ui-button is-ghost campaign-back',
      t('campaign.briefing.changeAircraft'),
      handlers.onHangar,
    );
    this.launch = createButton(
      buttons,
      'ui-button is-primary campaign-go',
      t('campaign.briefing.launch'),
      handlers.onLaunch,
    );
    this.root = root;
  }

  /** 表示するミッション */
  show(m: MissionDef): void {
    const text = missionStrings(m.id);
    this.title.textContent = text.title;
    this.text.textContent = text.briefing.join('\n');
    this.objectives.replaceChildren();
    m.objectives.forEach((o, i) => {
      const li = el('li', 'briefing-objective', this.objectives);
      // 順番に進む目標は「→」、同時に進む目標は「＋」を付ける
      const order =
        i === 0 ? '' : o.start === 'afterPrevious' ? '→ ' : t('campaign.briefing.withPrevious');
      li.textContent = `${order}${objectiveSummary(o)}`;
      el(
        'span',
        o.required ? 'tag is-required' : 'tag',
        li,
        o.required ? t('campaign.required') : t('campaign.optional'),
      );
    });
    const multipliers = m.reward.rankMultipliers ?? DEFAULT_RANK_MULTIPLIERS;
    this.facts.replaceChildren();
    const fact = (label: string, value: string): HTMLSpanElement => {
      const row = el('div', 'campaign-fact', this.facts);
      el('span', 'campaign-fact-label', row, label);
      return el('span', 'campaign-fact-value', row, value);
    };
    fact(
      t('campaign.briefing.timeLimit'),
      m.timeLimitSeconds === undefined
        ? t('campaign.briefing.none')
        : formatClock(m.timeLimitSeconds),
    );
    // 7-5: ミッションごとに固定の天候
    fact(t('campaign.briefing.weather'), weatherLabel(missionWeather(m.id)));
    fact(
      t('campaign.reward'),
      t('campaign.briefing.rewardValue', {
        credits: formatCredits(m.reward.baseCredits),
        scale: multipliers.S,
      }),
    );
    this.aircraftValue = fact(t('campaign.briefing.aircraft'), this.aircraftName);
  }

  /** 出撃する機体の名前（3-3。ハンガーから戻ったときも書き換える） */
  setAircraftName(name: string): void {
    this.aircraftName = name;
    if (this.aircraftValue) this.aircraftValue.textContent = name;
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (shown) this.launch.focus({ preventScroll: true });
  }
}
