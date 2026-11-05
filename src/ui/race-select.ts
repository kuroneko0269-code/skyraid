// リングレース（7-1）のコース一覧: 左にコース（難易度・ベストタイム・最高ランク）、右に選んだコースの詳細
// （マップ・天候・リング・ゴールドタイム・制限時間・ベスト 5）と機体の選択（所持機体。ハンガーの選択も変わる）と「スタート」
import { formatDate } from '../core/format';
import { t, tn } from '../core/i18n';
import './campaign.css';
import './race.css';
import './segmented.css';
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
import { createToggleButton } from './mobile';
import { createButton, createScreen, setScreenShown } from './screen';

const KIND_TEXT: Readonly<Record<RingKind, string>> = {
  get normal() {
    return t('race.kind.normal');
  },
  get boost() {
    return t('race.kind.boost', { seconds: RACE_CONFIG.boostSeconds });
  },
  get thin() {
    return t('race.kind.thin', { seconds: RACE_CONFIG.thinBonusSeconds });
  },
  get checkpoint() {
    return t('race.kind.checkpoint');
  },
};

/** 記録の日付「YYYY-MM-DD」（ローカルの日付）を今の言語の表記に。読めなければそのまま */
function formatRecordDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? formatDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : date;
}

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
  /** 9-8: スタート前にコースを下見するか（コースを選ぶたびに「まだ見ていなければ ON」に戻す） */
  private readonly previewToggle: { button: HTMLButtonElement; sync: (on: boolean) => void };
  preview = true;
  /** 選んでいるコース */
  selected: CourseDef;

  constructor(
    parent: HTMLElement,
    courses: readonly CourseDef[],
    private readonly record: (courseId: string) => Readonly<RaceRecord>,
    private readonly hangar: Hangar,
    handlers: { onStart: (course: CourseDef, preview: boolean) => void; onBack: () => void },
  ) {
    const first = courses[0];
    if (!first) throw new Error('no courses');
    this.selected = first;
    const root = createScreen(parent, 'campaign-screen race-screen');
    el('h2', 'ui-heading campaign-heading', root, t('race.select.heading'));
    const balance = el('div', 'campaign-balance', root);
    el('span', '', balance, t('campaign.balance'));
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
    el(
      'div',
      'campaign-label',
      detail,
      t('race.select.bestTimes', { count: RACE_CONFIG.bestTimes }),
    );
    this.times = el('table', 'race-times', detail);
    el('div', 'campaign-label', detail, t('campaign.briefing.aircraft'));
    this.aircraft = el('div', 'race-aircraft', detail);
    this.aircraft.setAttribute('role', 'radiogroup');
    const buttons = el('div', 'campaign-buttons', root);
    createButton(
      buttons,
      'ui-button is-ghost campaign-back',
      t('campaign.backToModes'),
      handlers.onBack,
    );
    // 9-8: コースの下見（初めてのコースは ON。見たコースは OFF から。押すと切り替える）
    this.previewToggle = createToggleButton(buttons, t('race.select.preview'), true, () => {
      this.preview = !this.preview;
      return this.preview;
    });
    this.previewToggle.button.className = 'ui-button is-ghost race-preview-toggle';
    this.start = createButton(
      buttons,
      'ui-button is-primary campaign-go',
      t('race.select.start'),
      () => {
        handlers.onStart(this.selected, this.preview);
      },
    );
    this.root = root;
    this.refresh();
  }

  select(course: CourseDef): void {
    this.selected = course;
    this.resetPreview();
    this.refresh();
  }

  /** 9-8: 下見の初期値（まだ見ていないコースは ON） */
  private resetPreview(): void {
    this.preview = this.record(this.selected.id).previewed !== true;
    this.previewToggle.sync(this.preview);
  }

  /** 一覧のベスト・ランク、詳細、機体の選択をセーブに合わせる */
  refresh(): void {
    this.balance.textContent = formatCredits(this.hangar.credits);
    for (const { course, button, best } of this.entries) {
      const rec = this.record(course.id);
      const top = rec.times[0];
      best.textContent = top
        ? `BEST ${formatRaceTime(top.time)}  ${rec.bestRank ?? ''}`
        : t('race.select.notRun');
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
    fact(t('race.select.map'), findMap(c.mapId).name);
    fact(t('campaign.briefing.weather'), weatherLabel(c.weatherId));
    fact(t('race.select.rings'), tn('race.select.ringCount', c.rings.length));
    fact(t('race.result.gold'), formatRaceTime(c.goldTimeSeconds));
    fact(t('campaign.briefing.timeLimit'), formatRaceTime(c.timeLimitSeconds));
    fact(t('race.select.bestRank'), rec.bestRank ?? '—');
    fact(
      t('race.select.ghost'),
      rec.ghost
        ? t('race.select.ghostValue', { time: formatRaceTime(rec.ghost.time) })
        : t('campaign.briefing.none'),
    );
    this.times.replaceChildren();
    if (rec.times.length === 0) {
      el('td', '', el('tr', '', this.times), t('race.select.noRecords'));
    }
    rec.times.forEach((entry, i) => {
      const tr = el('tr', '', this.times);
      el('td', '', tr, `${i + 1}.`);
      el('td', '', tr, formatRaceTime(entry.time));
      el('td', '', tr, entry.aircraftName);
      el('td', '', tr, formatRecordDate(entry.date));
    });
    this.renderAircraft();
  }

  /** 所持機体のボタン。押すとハンガーの選択も変える（3-3。セーブに保存） */
  private renderAircraft(): void {
    this.aircraft.replaceChildren();
    const selectedId = this.hangar.selectedId;
    for (const m of AIRCRAFT_MODELS) {
      if (this.hangar.status(m.id) !== 'owned') continue;
      // 7-C: 選択はセグメント（theme.css の .ui-seg-item。高さ 48px・選択中は塗りつぶし）
      const b = createButton(this.aircraft, 'ui-seg-item', m.name, () => {
        this.hangar.select(m.id);
        this.renderAircraft();
      });
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(m.id === selectedId));
    }
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (!shown) return;
    this.resetPreview();
    this.refresh();
    this.start.focus({ preventScroll: true });
  }
}
