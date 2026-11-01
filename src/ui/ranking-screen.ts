// ランキング画面（7-4）: モード選択の「ランキング」（連携中で ON のときだけ出る）から。モード選択の上に重ねる。
// タブはレース（コース × 機体）/ レイド（難易度）/ 防衛戦（マップ × 難易度）。メンバーの表示名・記録・機体・日付、自分の行をハイライト。
// 読み込みは OnlineService.ranking（5 分キャッシュ）
import './online.css';
import { AIRCRAFT_MODELS } from '../data/aircraft';
import { COURSES } from '../data/courses';
import { DEFENSE_MAPS } from '../data/defense';
import { RECORD_KIND_LABELS, RECORD_KINDS, type RecordKind } from '../data/online';
import { RAID_DIFFICULTY_LABELS } from '../data/raid';
import type { RankingQuery, RankingRow } from '../online/backend';
import { rankingLines, selfPlaceText } from '../online/format';
import { errorMessage } from '../online/messages';
import { defenseKey, isRecordKind } from '../online/records';
import { el } from './hud-dom';
import { createButton, createScreen, setScreenShown } from './screen';
import { Segmented } from './segmented';

const DIFFICULTIES = [
  { value: 'normal', label: RAID_DIFFICULTY_LABELS.normal },
  { value: 'hard', label: RAID_DIFFICULTY_LABELS.hard },
] as const;

export interface RankingSource {
  ranking(q: RankingQuery): Promise<readonly RankingRow[]>;
  readonly selfId: string | null;
}

export class RankingScreen {
  readonly root: HTMLDivElement;
  private kind: RecordKind = 'race';
  private course: string = COURSES[0]?.id ?? 'coast';
  private aircraft: string = AIRCRAFT_MODELS[0]?.id ?? 'kestrel';
  private raidDiff = 'normal';
  private defenseMap: string = DEFENSE_MAPS[0]?.mapId ?? 'island';
  private defenseDiff = 'normal';
  private readonly raceRows: HTMLDivElement;
  private readonly raidRows: HTMLDivElement;
  private readonly defenseRows: HTMLDivElement;
  private readonly self: HTMLDivElement;
  private readonly table: HTMLTableSectionElement;
  private readonly message: HTMLDivElement;
  private readonly tabs: Segmented;
  private open = false;
  /** 読み込みの通し番号（タブを素早く切り替えたとき、古い結果を捨てる） */
  private request = 0;

  constructor(
    parent: HTMLElement,
    private readonly source: RankingSource,
    private readonly onClose: () => void,
  ) {
    const root = createScreen(parent, 'campaign-screen ranking-screen');
    el('h2', 'ui-heading campaign-heading', root, 'ランキング');
    const panel = el('div', 'ranking-panel', root);
    this.tabs = new Segmented(
      panel,
      '',
      RECORD_KINDS.map((k) => ({ value: k, label: RECORD_KIND_LABELS[k] })),
      this.kind,
      (v) => {
        if (isRecordKind(v)) this.kind = v;
        this.refresh();
      },
      'ranking-tabs',
    );
    const reload = (): void => {
      this.refresh();
    };
    this.raceRows = el('div', 'ranking-filters', panel);
    new Segmented(
      this.raceRows,
      'コース',
      COURSES.map((c) => ({ value: c.id, label: c.name })),
      this.course,
      (v) => {
        this.course = v;
        reload();
      },
    );
    new Segmented(
      this.raceRows,
      '機体',
      AIRCRAFT_MODELS.map((m) => ({ value: m.id, label: m.name })),
      this.aircraft,
      (v) => {
        this.aircraft = v;
        reload();
      },
    );
    this.raidRows = el('div', 'ranking-filters', panel);
    new Segmented(this.raidRows, '難易度', DIFFICULTIES, this.raidDiff, (v) => {
      this.raidDiff = v;
      reload();
    });
    this.defenseRows = el('div', 'ranking-filters', panel);
    new Segmented(
      this.defenseRows,
      'マップ',
      DEFENSE_MAPS.map((m) => ({ value: m.mapId, label: m.name })),
      this.defenseMap,
      (v) => {
        this.defenseMap = v;
        reload();
      },
    );
    new Segmented(this.defenseRows, '難易度', DIFFICULTIES, this.defenseDiff, (v) => {
      this.defenseDiff = v;
      reload();
    });
    this.self = el('div', 'ranking-self', panel);
    const scroller = el('div', 'ranking-scroll', panel);
    const t = el('table', 'ranking-table', scroller);
    this.table = el('tbody', '', t);
    this.message = el('div', 'ranking-message', panel);
    el(
      'div',
      'ranking-note',
      panel,
      'メンバー内のランキング（5 分ごとに更新）。P2P の協力は対象外の参考記録です',
    );
    const buttons = el('div', 'campaign-buttons', root);
    createButton(buttons, 'ui-button is-ghost campaign-back', '← モード選択', () => {
      this.close();
    });
    this.root = root;
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.open = true;
    setScreenShown(this.root, true);
    this.refresh();
    this.tabs.selectedButton?.focus({ preventScroll: true });
  }

  /** 閉じる（Esc・戻る）。開いていなければ false */
  close(): boolean {
    if (!this.open) return false;
    this.hide();
    this.onClose();
    return true;
  }

  /** 戻り先を出さずに隠す（モード選択から別の画面へ移ったとき） */
  hide(): void {
    this.open = false;
    setScreenShown(this.root, false);
  }

  private query(): RankingQuery {
    if (this.kind === 'race') return { kind: 'race', key: this.course, aircraftId: this.aircraft };
    if (this.kind === 'raid') return { kind: 'raid', key: this.raidDiff };
    return { kind: 'defense', key: defenseKey(this.defenseMap, this.defenseDiff) };
  }

  private refresh(): void {
    this.raceRows.hidden = this.kind !== 'race';
    this.raidRows.hidden = this.kind !== 'raid';
    this.defenseRows.hidden = this.kind !== 'defense';
    const q = this.query();
    const id = ++this.request;
    this.message.textContent = '読み込み中…';
    this.source.ranking(q).then(
      (rows) => {
        if (id === this.request) this.render(q.kind, rows);
      },
      (e: unknown) => {
        if (id !== this.request) return;
        this.table.replaceChildren();
        this.self.textContent = '';
        this.message.textContent = errorMessage(e);
      },
    );
  }

  private render(kind: RecordKind, rows: readonly RankingRow[]): void {
    const selfId = this.source.selfId;
    this.table.replaceChildren();
    for (const line of rankingLines(kind, rows, selfId)) {
      const tr = el('tr', line.self ? 'is-self' : '', this.table);
      el('td', 'ranking-place', tr, line.place);
      el('td', 'ranking-name', tr, line.name);
      el('td', 'ranking-value', tr, line.value);
      el('td', 'ranking-aircraft', tr, kind === 'race' ? '' : line.aircraft);
      el('td', 'ranking-date', tr, line.date);
    }
    this.self.textContent = selfPlaceText(rows, selfId);
    this.message.textContent = rows.length === 0 ? 'まだ記録がありません' : '';
  }
}
