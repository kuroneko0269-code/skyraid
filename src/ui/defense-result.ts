// 防衛戦（7-2）のリザルト: 防衛成功 / 基地陥落、クリアした波・撃墜・司令部の残り HP・残った施設、報酬の内訳と残高。
// 協力は全員の撃墜数と MVP（撃墜数が最多。同じなら被撃墜の少ない方）の表も出す
import './campaign.css';
import './defense.css';
import { DEFENSE_CONFIG } from '../data/defense';
import type { DefenseRewardBreakdown, DefenseScore } from '../missions/defense/score';
import { el } from './hud-dom';
import { formatCredits } from './mission-text';
import { createButton, createScreen, setScreenShown } from './screen';

export interface DefensePlayerRow {
  readonly name: string;
  readonly kills: number;
  readonly deaths: number;
  readonly mvp: boolean;
  readonly self: boolean;
}

export interface DefenseResultExtras {
  readonly mapName: string;
  readonly hard: boolean;
  readonly balance: number;
  readonly pilotName: string | null;
  /** 協力の全員の成績（ソロは空） */
  readonly players: readonly DefensePlayerRow[];
}

export class DefenseResultScreen {
  readonly root: HTMLDivElement;
  private readonly info: HTMLDivElement;
  private readonly outcome: HTMLHeadingElement;
  private readonly facts: HTMLDivElement;
  private readonly table: HTMLDivElement;
  private readonly retry: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    handlers: { onRetry: () => void; onList: () => void },
    /** 協力は「もう一度」を出さない（ロビーへ戻る） */
    retryLabel = 'もう一度',
  ) {
    const root = createScreen(parent, 'campaign-screen result-screen defense-result-screen');
    const panel = el('div', 'ui-panel campaign-panel', root);
    el('div', 'ui-kicker campaign-kicker', panel, 'DEFENSE RESULT');
    this.info = el('div', 'result-pilot', panel);
    this.outcome = el('h2', 'ui-title campaign-title result-outcome', panel);
    this.facts = el('div', 'campaign-facts', panel);
    this.table = el('div', 'defense-result-table', panel);
    const buttons = el('div', 'campaign-buttons', panel);
    createButton(buttons, 'ui-button is-ghost campaign-back', 'モード選択へ', handlers.onList);
    this.retry = createButton(
      buttons,
      'ui-button is-primary campaign-go',
      retryLabel,
      handlers.onRetry,
    );
    this.root = root;
  }

  show(s: DefenseScore, reward: DefenseRewardBreakdown, x: DefenseResultExtras): void {
    const ok = s.outcome === 'cleared';
    this.root.classList.toggle('is-success', ok);
    this.info.textContent = `${x.mapName}・${x.hard ? '高難度' : '通常'}${x.pilotName ? `  /  PILOT ${x.pilotName}` : ''}`;
    this.outcome.textContent = ok ? '防衛成功' : '基地陥落';
    this.facts.replaceChildren();
    const fact = (label: string, value: string): void => {
      const row = el('div', 'campaign-fact', this.facts);
      el('span', 'campaign-fact-label', row, label);
      el('span', 'campaign-fact-value', row, value);
    };
    fact('クリアした波', `${s.wavesCleared} / ${DEFENSE_CONFIG.waves}`);
    fact('撃墜', String(s.kills));
    fact('司令部', `${Math.ceil(Math.max(0, s.hqHp))} / ${s.hqMaxHp}`);
    fact('残った施設', `${s.facilitiesAlive} / ${s.facilitiesTotal}`);
    const r = DEFENSE_CONFIG.reward;
    const parts = [`波 ${s.wavesCleared} × ${r.perWave}`];
    if (reward.fullClear > 0) parts.push(`完全クリア +${formatCredits(reward.fullClear)}`);
    if (reward.facilities > 0) parts.push(`施設全残存 +${formatCredits(reward.facilities)}`);
    fact('内訳', parts.join('・'));
    fact('報酬', `獲得 +${formatCredits(reward.total)} / 残高 ${formatCredits(x.balance)}`);
    this.table.replaceChildren();
    this.table.hidden = x.players.length === 0;
    for (const p of x.players) {
      const row = el('div', 'campaign-fact defense-result-row', this.table);
      row.classList.toggle('is-self', p.self);
      el('span', 'campaign-fact-label', row, `${p.mvp ? '★ MVP ' : ''}${p.name}`);
      el('span', 'campaign-fact-value', row, `撃墜 ${p.kills}・被撃墜 ${p.deaths}`);
    }
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (shown) this.retry.focus({ preventScroll: true });
  }
}
