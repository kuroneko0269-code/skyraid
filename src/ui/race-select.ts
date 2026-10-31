// リングレース（7-1）のコース一覧: 左にコース（難易度・ベストタイム・最高ランク）、右に選んだコースの詳細
// （マップ・天候・リング・ゴールドタイム・制限時間・ベスト 5）と機体の選択（所持機体。ハンガーの選択も変わる）と「スタート」
import './campaign.css';
import './race.css';
import { AIRCRAFT_MODELS } from '../data/aircraft';
import { findMap } from '../data/maps';
import { RACE_CONFIG } from '../data/race';
import { weatherLabel } from '../data/weather';
import type { CourseDef, RingKind } from '../missions/race/types';
import { formatRaceTime } from '../missions/race/score';
import type { Hangar } from '../progression/hangar';
import type { RaceRecord } from '../progression/save-races';
import { el } from './hud-dom';
import { formatCredits } from './mission-text';
import { createButton, createScreen, setScreenShown } from './screen';

const KIND_TEXT: Readonly<Record<RingKind, string>> = {
  normal: '通常',
  boost: `ブースト（AB ${RACE_CONFIG.boostSeconds} 秒無料）`,
  thin: `細い（−${RACE_CONFIG.thinBonusSeconds} 秒）`,
  checkpoint: 'チェックポイント（飛ばせない）',
};

interface Entry {
  readonly course: CourseDef;
  readonly button: HTMLButtonElement;
  readonly best: HTMLSpanElement;
}

export class RaceSelectScreen {
  readonly root: HTMLDivElement;
  private readonly entries: Entry[] = [];
  private readonly balance: HTMLSpanElement;
  private readonly title: HTMLHeadingElement;
  private readonly note: HTMLParagraphElement;
  private readonly facts: HTMLDivElement;
  private readonly times: HTMLTableElement;
  private readonly aircraft: HTMLDivElement;
  private readonly start: HTMLButtonElement;
  /** 選んでいるコース */
  selected: CourseDef;

  constructor(
    parent: HTMLElement,
    courses: readonly CourseDef[],
    private readonly record: (courseId: string) => Readonly<RaceRecord>,
    private readonly hangar: Hangar,
    handlers: { onStart: (course: CourseDef) => void; onBack: () => void },
  ) {
    const first = courses[0];
    if (!first) throw new Error('コースがない');
    this.selected = first;
    const root = createScreen(parent, 'campaign-screen race-screen');
    el('h2', 'ui-heading campaign-heading', root, 'リングレース');
    const balance = el('div', 'campaign-balance', root);
    el('span', '', balance, '残高');
    this.balance = el('span', 'campaign-balance-value', balance);
    const layout = el('div', 'race-layout', root);
    const list = el('div', 'race-course-list', layout);
    for (const course of courses) {
      const button = createButton(list, 'ui-button ui-item mission-entry race-course', '', () => {
        this.select(course);
      });
      const head = el('span', 'mission-entry-head', button);
      el('span', 'mission-entry-no', head, findMap(course.mapId).name);
      el('span', 'mission-entry-level', head, course.level);
      el('span', 'mission-entry-title', button, course.name);
      const best = el('span', 'race-course-best', button);
      this.entries.push({ course, button, best });
    }
    const detail = el('div', 'race-detail', layout);
    this.title = el('h3', 'ui-title race-detail-title', detail);
    this.note = el('p', 'campaign-text', detail);
    this.facts = el('div', 'race-facts', detail);
    const kinds = el('div', 'race-kinds', detail);
    for (const k of Object.keys(KIND_TEXT) as RingKind[]) {
      const span = el('span', 'race-kind', kinds, KIND_TEXT[k]);
      span.style.setProperty(
        '--race-kind-color',
        `#${RACE_CONFIG.colors[k].toString(16).padStart(6, '0')}`,
      );
    }
    el('div', 'campaign-label', detail, `ベスト ${RACE_CONFIG.bestTimes}`);
    this.times = el('table', 'race-times', detail);
    el('div', 'campaign-label', detail, '機体');
    this.aircraft = el('div', 'race-aircraft', detail);
    const buttons = el('div', 'campaign-buttons', root);
    createButton(buttons, 'ui-button is-ghost campaign-back', '← モード選択', handlers.onBack);
    this.start = createButton(buttons, 'ui-button is-primary campaign-go', 'スタート', () => {
      handlers.onStart(this.selected);
    });
    this.root = root;
    this.refresh();
  }

  select(course: CourseDef): void {
    this.selected = course;
    this.refresh();
  }

  /** 一覧のベスト・ランク、詳細、機体の選択をセーブに合わせる */
  refresh(): void {
    this.balance.textContent = formatCredits(this.hangar.credits);
    for (const { course, button, best } of this.entries) {
      const rec = this.record(course.id);
      const top = rec.times[0];
      best.textContent = top ? `BEST ${formatRaceTime(top.time)}  ${rec.bestRank ?? ''}` : '未走行';
      best.classList.toggle('race-rank-s', rec.bestRank === 'S');
      button.classList.toggle('is-selected', course === this.selected);
      button.setAttribute('aria-pressed', String(course === this.selected));
    }
    const c = this.selected;
    const rec = this.record(c.id);
    this.title.textContent = c.name;
    this.note.textContent = c.note;
    this.facts.replaceChildren();
    const fact = (label: string, value: string): void => {
      const row = el('div', 'campaign-fact', this.facts);
      el('span', 'campaign-fact-label', row, label);
      el('span', 'campaign-fact-value', row, value);
    };
    fact('マップ', findMap(c.mapId).name);
    fact('天候', weatherLabel(c.weatherId));
    fact('リング', `${c.rings.length} 個`);
    fact('ゴールド', formatRaceTime(c.goldTimeSeconds));
    fact('制限時間', formatRaceTime(c.timeLimitSeconds));
    fact('最高ランク', rec.bestRank ?? '—');
    fact('ゴースト', rec.ghost ? `あり（${formatRaceTime(rec.ghost.time)}）` : 'なし');
    this.times.replaceChildren();
    if (rec.times.length === 0) {
      el('td', '', el('tr', '', this.times), 'まだ記録がありません');
    }
    rec.times.forEach((t, i) => {
      const tr = el('tr', '', this.times);
      el('td', '', tr, `${i + 1}.`);
      el('td', '', tr, formatRaceTime(t.time));
      el('td', '', tr, t.aircraftName);
      el('td', '', tr, t.date);
    });
    this.renderAircraft();
  }

  /** 所持機体のボタン。押すとハンガーの選択も変える（3-3。セーブに保存） */
  private renderAircraft(): void {
    this.aircraft.replaceChildren();
    const selectedId = this.hangar.selectedId;
    for (const m of AIRCRAFT_MODELS) {
      if (this.hangar.status(m.id) !== 'owned') continue;
      const b = createButton(this.aircraft, 'ui-toggle', m.name, () => {
        this.hangar.select(m.id);
        this.renderAircraft();
      });
      b.setAttribute('aria-pressed', String(m.id === selectedId));
    }
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (!shown) return;
    this.refresh();
    this.start.focus({ preventScroll: true });
  }
}
