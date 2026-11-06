// チュートリアルの章の一覧（9-5c）: モード選択の上に重ねるダイアログ。章ごとに番号・名前・目当てと、終えた章の ✓。
// 押した章から始める（どの章からでも・何度でも）。最後の章（補助の設定と練習場）は飛ばずに、この中で読む頁を出す。
// 今の利用者には一度だけ「チュートリアルが新しくなりました」も出す（showNotice）
import { noteScreenSwitch } from './screen-switch';
import './tutorial-list.css';
import { formatCredits } from '../core/format';
import {
  TUTORIAL_CHAPTER_DEFS,
  TUTORIAL_CHAPTERS,
  TUTORIAL_CONFIG,
  type TutorialChapter,
} from '../data/tutorial';
import { el } from './hud-dom';
import { createButton } from './screen';
import { tutorialChapterName, tutorialChapterNumber, tutorialStrings } from './tutorial-text';
import { AssistPresetChoice } from './assist-preset';
import type { ControlSettings } from '../core/control-settings';
import type { AssistPreset } from '../data/assist';

export interface TutorialListHandlers {
  /** 飛ぶ章を始める */
  readonly onStart: (chapter: TutorialChapter) => void;
  /** 補助の章の「設定を開く」「練習場へ」 */
  readonly onSettings: () => void;
  readonly onPractice: () => void;
  /** 補助の章を読み終えた（「読んだ」） */
  readonly onRead: () => void;
  /** 閉じた（モードの一覧にフォーカスを戻す） */
  readonly onClose: () => void;
  /** 9-5d: 補助の章で補助の組を選ぶ（今の値と、選んだとき） */
  readonly controls: () => Readonly<ControlSettings>;
  readonly onPreset: (preset: AssistPreset) => void;
}

export class TutorialList {
  private readonly wrap: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly listBox: HTMLDivElement;
  private readonly page: HTMLDivElement;
  private readonly noticeWrap: HTMLDivElement;
  private readonly noticeOpen: HTMLButtonElement;
  private readonly first: HTMLButtonElement;
  private readonly preset: AssistPresetChoice;
  private readonly rows = new Map<
    TutorialChapter,
    { button: HTMLButtonElement; mark: HTMLSpanElement }
  >();

  constructor(
    root: HTMLElement,
    private readonly done: () => ReadonlySet<TutorialChapter>,
    private readonly h: TutorialListHandlers,
  ) {
    const s = tutorialStrings();
    this.wrap = el('div', 'mode-prompt tutorial-list', root);
    this.wrap.hidden = true;
    this.listBox = el(
      'div',
      'ui-dialog mode-prompt-box mode-prompt-wide tutorial-list-box',
      this.wrap,
    );
    el('h3', 'ui-heading mode-prompt-title', this.listBox, s.list.heading);
    el('p', 'mode-prompt-text', this.listBox, s.list.body);
    this.list = el('div', 'tutorial-list-chapters', this.listBox);
    TUTORIAL_CHAPTERS.forEach((c, i) => {
      const name = tutorialChapterName(c);
      const button = createButton(this.list, 'ui-button ui-item tutorial-chapter', '', () => {
        this.choose(c);
      });
      button.dataset.chapter = c;
      el('span', 'tutorial-chapter-number', button, tutorialChapterNumber(i));
      el('span', 'tutorial-chapter-name', button, name.name);
      el('span', 'tutorial-chapter-goal', button, name.goal);
      const mark = el('span', 'tutorial-chapter-done', button, s.list.done);
      this.rows.set(c, { button, mark });
    });
    el(
      'p',
      'mode-prompt-text tutorial-list-reward',
      this.listBox,
      s.list.reward.replace('{credits}', formatCredits(TUTORIAL_CONFIG.rewardCredits)),
    );
    const buttons = el('div', 'campaign-buttons', this.listBox);
    createButton(buttons, 'ui-button is-ghost campaign-back', s.list.close, () => {
      this.close();
      h.onClose();
    });
    this.first = createButton(buttons, 'ui-button is-primary campaign-go', s.list.fromStart, () => {
      this.choose(TUTORIAL_CHAPTERS[0]);
    });

    // 補助の設定と練習場（飛ばない章）
    this.page = el('div', 'ui-dialog mode-prompt-box mode-prompt-wide tutorial-page', this.wrap);
    const a = s.chapters.assist;
    el('h3', 'ui-heading mode-prompt-title', this.page, a.name);
    for (const line of a.page) el('p', 'mode-prompt-text', this.page, line);
    // 9-5d: ここで補助の組を選べる（個別の設定は「設定を開く」）
    this.preset = new AssistPresetChoice(this.page, h.controls, (p) => {
      h.onPreset(p);
    });
    const pageButtons = el('div', 'campaign-buttons', this.page);
    createButton(pageButtons, 'ui-button is-ghost campaign-back', s.list.close, () => {
      this.showList();
    });
    createButton(pageButtons, 'ui-button campaign-go', a.settings, () => {
      this.read();
      this.close();
      h.onSettings();
    });
    createButton(pageButtons, 'ui-button campaign-go', a.practice, () => {
      this.read();
      this.close();
      h.onPractice();
    });
    createButton(pageButtons, 'ui-button is-primary campaign-go', a.done, () => {
      this.read();
      this.showList();
    });

    // 今の利用者への「新しくなりました」
    this.noticeWrap = el('div', 'mode-prompt', root);
    this.noticeWrap.hidden = true;
    const nb = el('div', 'ui-dialog mode-prompt-box', this.noticeWrap);
    el('h3', 'ui-heading mode-prompt-title', nb, s.notice.title);
    el('p', 'mode-prompt-text', nb, s.notice.body);
    const nbButtons = el('div', 'campaign-buttons', nb);
    createButton(nbButtons, 'ui-button is-ghost campaign-back', s.notice.later, () => {
      this.close();
      h.onClose();
    });
    this.noticeOpen = createButton(
      nbButtons,
      'ui-button is-primary campaign-go',
      s.notice.open,
      () => {
        this.show();
      },
    );
  }

  /** 章の一覧を出す（page: 補助の章の頁から） */
  show(page = false): void {
    // 9-11a: モード選択の「チュートリアル」を押したタップが、出た一覧の章のボタンへ押し抜けない（9-9b の対策をここにも）
    noteScreenSwitch();
    this.noticeWrap.hidden = true;
    this.wrap.hidden = false;
    this.wrap.scrollTop = 0;
    if (page) this.showPage();
    else this.showList();
  }

  showNotice(): void {
    this.close();
    noteScreenSwitch();
    this.noticeWrap.hidden = false;
    this.noticeOpen.focus({ preventScroll: true });
  }

  /** 開いていれば閉じて true（Esc） */
  close(): boolean {
    const open = !this.wrap.hidden || !this.noticeWrap.hidden;
    this.wrap.hidden = true;
    this.noticeWrap.hidden = true;
    // 9-11a: 閉じて出たモード選択のカード・タイルへ押し抜けない
    if (open) noteScreenSwitch();
    return open;
  }

  private showList(): void {
    // 頁 ↔ 一覧の切り替えも、押したボタンの下の章のボタンへ押し抜けない
    noteScreenSwitch();
    this.page.hidden = true;
    this.listBox.hidden = false;
    const done = this.done();
    for (const [c, row] of this.rows) {
      row.mark.hidden = !done.has(c);
      row.button.classList.toggle('is-done', done.has(c));
    }
    // まだ終えていない最初の章にフォーカス（Enter で始められる）
    const next = TUTORIAL_CHAPTERS.find((c) => !done.has(c));
    (next ? this.rows.get(next)?.button : this.first)?.focus({ preventScroll: true });
  }

  private showPage(): void {
    noteScreenSwitch();
    this.listBox.hidden = true;
    this.page.hidden = false;
    this.preset.sync();
  }

  private choose(c: TutorialChapter): void {
    if (TUTORIAL_CHAPTER_DEFS[c].mission === null) {
      this.showPage();
      return;
    }
    this.close();
    this.h.onStart(c);
  }

  private read(): void {
    this.h.onRead();
  }
}
