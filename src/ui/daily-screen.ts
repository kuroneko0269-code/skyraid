// 日替わりチャレンジ（9-9）の画面: 左に今日の条件（種類・難しさ・機体・天候・長さ・数え方）と自分のその日の最高・補助の組・
// 挑戦の回数・連続日数（と、終えたばかりなら今回の結果）、右にメンバー内のその日のランキング（オンライン連携の連携中だけ）。
// 「挑戦する」で飛ぶ。見た目はリングレースのコース一覧（race.css）と同じ部品
import { t, tn } from '../core/i18n';
import './campaign.css';
import './race.css';
import './daily.css';
import { findAircraftModel } from '../data/aircraft';
import { dailyKindLabel, type DailyKind } from '../data/daily';
import { weatherLabel } from '../data/weather';
import type { DailySpec } from '../missions/daily/schedule';
import { dailyLaps, dailyMinutesHint } from '../missions/daily/setup';
import type { DailyEntry, DailyPreset } from '../progression/daily-records';
import type { DailyRankingRow } from '../online/daily-scores';
import { formatRaceTime } from '../replay/outcome';
import { el } from './hud-dom';
import { createButton, createScreen, setScreenShown } from './screen';

/** 終えたばかりの回（画面の上に出す） */
export interface DailyLastPlay {
  readonly value: number | null;
  readonly newBest: boolean;
}

export interface DailyScreenSource {
  spec(): DailySpec;
  entry(): Readonly<DailyEntry> | null;
  streak(): number;
  /** 今の補助の組（挑戦する前の表示） */
  preset(): DailyPreset;
  /** ランキングの欄: 'off'（連携していない = 欄を出さない）/ 'pending'（サーバーの準備中）/ 'on' */
  rankingState(): 'off' | 'pending' | 'on';
  ranking(): Promise<readonly DailyRankingRow[]>;
  selfId(): string | null;
}

/** 値の表示（的の課題はスコア、レースはタイム） */
export function formatDailyValue(kind: DailyKind, value: number | null): string {
  if (value === null) return '—';
  return kind === 'race' ? formatRaceTime(value / 1000) : String(value);
}

export function presetLabel(p: DailyPreset): string {
  return t(`controls.preset.${p}`);
}

export class DailyScreen {
  readonly root: HTMLDivElement;
  private readonly date: HTMLSpanElement;
  private readonly title: HTMLHeadingElement;
  private readonly note: HTMLParagraphElement;
  private readonly facts: HTMLDivElement;
  private readonly last: HTMLDivElement;
  /** 9-10 の事前修正: 今回の結果の下の追加の欄（リプレイを保存。ui/replay-link.ts が入れる） */
  readonly extras: HTMLDivElement;
  private readonly best: HTMLDivElement;
  private readonly side: HTMLDivElement;
  private readonly table: HTMLTableElement;
  private readonly rankNote: HTMLParagraphElement;
  private readonly start: HTMLButtonElement;
  private lastPlay: DailyLastPlay | null = null;
  /** ランキングの読み込みの番号（古い応答で書き換えない） */
  private loadId = 0;

  constructor(
    parent: HTMLElement,
    private readonly source: DailyScreenSource,
    handlers: { onStart: () => void; onBack: () => void },
  ) {
    const root = createScreen(parent, 'campaign-screen race-screen daily-screen');
    const top = el('div', 'daily-top', root);
    el('h2', 'ui-heading campaign-heading', top, t('daily.heading'));
    this.date = el('span', 'daily-date', top);
    const layout = el('div', 'race-layout daily-layout', root);
    const main = el('div', 'race-detail daily-main', layout);
    this.title = el('h3', 'ui-title race-detail-title', main);
    this.note = el('p', 'campaign-text daily-note', main);
    this.facts = el('div', 'race-facts daily-facts', main);
    this.last = el('div', 'daily-last', main);
    this.extras = el('div', 'daily-extras', main);
    this.best = el('div', 'daily-best', main);
    this.side = el('div', 'race-detail daily-side', layout);
    el('div', 'campaign-label', this.side, t('daily.ranking.heading'));
    this.rankNote = el('p', 'campaign-text daily-rank-note', this.side);
    this.table = el('table', 'race-times daily-ranking', this.side);
    const buttons = el('div', 'campaign-buttons', root);
    createButton(
      buttons,
      'ui-button is-ghost campaign-back',
      t('campaign.backToModes'),
      handlers.onBack,
    );
    this.start = createButton(
      buttons,
      'ui-button is-primary campaign-go',
      t('daily.start'),
      handlers.onStart,
    );
    this.root = root;
  }

  /** 終えたばかりの回を出す（次に setShown(true) したとき。メニューから開き直すと消す） */
  setLastPlay(p: DailyLastPlay | null): void {
    this.lastPlay = p;
  }

  refresh(): void {
    const s = this.source.spec();
    const [, m, d] = s.day.split('-');
    this.date.textContent = t('daily.date', { month: Number(m), day: Number(d) });
    const kind = dailyKindLabel(s.kind);
    this.title.textContent = kind.name;
    this.note.textContent = kind.note;
    this.facts.replaceChildren();
    const fact = (name: string, value: string, wide = false): void => {
      const row = el('div', wide ? 'campaign-fact is-wide' : 'campaign-fact', this.facts);
      el('span', 'campaign-fact-label', row, name);
      el('span', 'campaign-fact-value', row, value);
    };
    fact(t('daily.tier'), '★'.repeat(s.tier) + '☆'.repeat(3 - s.tier));
    fact(t('campaign.briefing.aircraft'), findAircraftModel(s.aircraftId)?.name ?? s.aircraftId);
    fact(t('daily.weather'), weatherLabel(s.weatherId));
    const laps = dailyLaps(s);
    fact(
      t('daily.length'),
      laps > 0
        ? tn('daily.laps', laps)
        : t('daily.minutes', { minutes: dailyMinutesHint(s).toFixed(1).replace(/\.0$/, '') }),
    );
    fact(t('daily.preset'), presetLabel(this.source.preset()));
    fact(t('daily.rules'), t(`daily.rulesValue.${s.kind === 'race' ? 'race' : 'score'}`), true);
    this.renderLast(s.kind);
    this.renderBest(s.kind);
    void this.renderRanking(s);
  }

  private renderLast(kind: DailyKind): void {
    const p = this.lastPlay;
    this.last.hidden = p === null;
    this.extras.hidden = p === null;
    this.last.replaceChildren();
    if (!p) return;
    el('span', 'daily-last-label', this.last, t('daily.thisRun'));
    el('span', 'daily-last-value', this.last, formatDailyValue(kind, p.value));
    if (p.value === null) el('span', 'daily-last-badge', this.last, t('daily.notFinished'));
    else if (p.newBest) el('span', 'daily-last-badge is-best', this.last, t('daily.newBest'));
  }

  private renderBest(kind: DailyKind): void {
    const e = this.source.entry();
    this.best.replaceChildren();
    const cell = (label: string, value: string, cls = ''): void => {
      const box = el('div', `daily-stat ${cls}`, this.best);
      el('span', 'daily-stat-label', box, label);
      el('span', 'daily-stat-value', box, value);
    };
    cell(t('daily.best'), formatDailyValue(kind, e?.best ?? null), 'is-main');
    cell(t('daily.bestPreset'), e?.preset ? presetLabel(e.preset) : '—');
    cell(t('daily.attempts'), String(e?.attempts ?? 0));
    cell(t('daily.streak'), tn('daily.streakDays', this.source.streak()));
  }

  private async renderRanking(s: DailySpec): Promise<void> {
    const state = this.source.rankingState();
    this.side.hidden = state === 'off';
    this.root.classList.toggle('is-solo', state === 'off');
    this.table.replaceChildren();
    if (state === 'off') return;
    if (state === 'pending') {
      this.rankNote.textContent = t('daily.ranking.pending');
      return;
    }
    this.rankNote.textContent = t('daily.ranking.loading');
    const id = ++this.loadId;
    let rows: readonly DailyRankingRow[];
    try {
      rows = await this.source.ranking();
    } catch {
      if (id === this.loadId) this.rankNote.textContent = t('daily.ranking.failed');
      return;
    }
    if (id !== this.loadId) return;
    this.rankNote.textContent = rows.length === 0 ? t('daily.ranking.empty') : '';
    this.rankNote.hidden = rows.length > 0;
    const self = this.source.selfId();
    for (const r of rows) {
      const tr = el('tr', r.userId === self ? 'is-current' : '', this.table);
      el('td', '', tr, `${String(r.place)}.`);
      el('td', 'daily-ranking-value', tr, formatDailyValue(s.kind, r.value));
      el('td', 'daily-ranking-name', tr, r.displayName ?? '—');
      el('td', 'daily-ranking-preset', tr, presetLabel(r.preset));
    }
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (!shown) return;
    this.rankNote.hidden = false;
    this.refresh();
    this.start.focus({ preventScroll: true });
  }
}
