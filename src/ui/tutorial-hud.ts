import './tutorial-hud.css';
import type { SteerMode } from '../data/steer';
import type { InputDevice } from '../core/input';
import type { Action } from '../data/keybinds';
import {
  TUTORIAL_CHAPTER_DEFS,
  TUTORIAL_CHAPTERS,
  TUTORIAL_CONFIG,
  type TouchPart,
  type TutorialChapter,
} from '../data/tutorial';
import type { TutorialCoach, TutorialHint } from '../missions/tutorial/coach';
import type { MissionRunner } from '../missions/runner';
import { el } from './hud-dom';
import { createTutorialFigure } from './tutorial-figure';
import {
  tutorialChapterName,
  tutorialChapterNumber,
  tutorialLiveHint,
  tutorialStepHint,
  tutorialStepText,
  tutorialStrings,
  tutorialVariant,
  type TutorialVariant,
} from './tutorial-text';

/**
 * チュートリアルの章（9-5c）の指示: 画面上部の中央に「第 N 章 名前  段階 / 全体」と「中断」、短い指示と方式ごとの図、
 * できないときのヒント（黄色の行）。段階はランナーの目標（objective:activate）で進め、使うタッチの部品を光らせる。
 * 文と図は最後に操作した入力系統（タッチは操縦の方式）に合わせ、キーボードは今の割当のキー名を出す
 */
export class TutorialHud {
  readonly root: HTMLDivElement;
  private readonly count: HTMLSpanElement;
  private readonly body: HTMLDivElement;
  private readonly figure: HTMLDivElement;
  private readonly text: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly note: HTMLDivElement;
  private unsubscribe: (() => void)[] = [];
  private chapter: TutorialChapter | null = null;
  private steps: string[] = [];
  private step: string | null = null;
  private complete = false;
  private variant: TutorialVariant | null = null;
  /** 出しているヒント（段階のヒントか一言）と残りの秒数（段階のヒントは段階が変わるまで） */
  private hintKey: TutorialHint | null = null;
  private hintLeft = 0;

  constructor(
    parent: HTMLElement,
    private readonly keyName: (action: Action) => string,
    private readonly highlight: (parts: readonly TouchPart[]) => void,
    onAbort: () => void,
    /** タッチの操縦の方式（9-2・9-4。文と図を選ぶ） */
    private readonly steerTouch: () => SteerMode = () => 'direct',
  ) {
    const t = tutorialStrings();
    this.root = el('div', 'tutorial-hud', parent);
    const head = el('div', 'tutorial-hud-head', this.root);
    this.count = el('span', 'tutorial-hud-count', head);
    const abort = el('button', 'ui-button is-ghost tutorial-hud-abort', head, t.abort);
    abort.type = 'button';
    abort.addEventListener('click', () => {
      abort.blur();
      onAbort();
    });
    this.body = el('div', 'tutorial-hud-body', this.root);
    this.figure = el('div', 'tutorial-hud-figure', this.body);
    this.text = el('div', 'tutorial-hud-text', this.body);
    this.hint = el('div', 'tutorial-hud-hint', this.root);
    this.note = el('div', 'tutorial-hud-note', this.root, t.safety);
    this.root.hidden = true;
  }

  /** 章の進み具合を表示する。チュートリアルでなければ（null）隠す */
  attach(runner: MissionRunner | null, coach: TutorialCoach | null): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.step = null;
    this.complete = false;
    this.chapter = coach?.chapter ?? null;
    this.steps = runner ? runner.def.objectives.map((o) => o.id) : [];
    this.root.hidden = runner === null || coach === null;
    this.highlight([]);
    this.clearHint();
    if (!runner || !coach) return;
    this.unsubscribe.push(
      runner.bus.on('objective:activate', ({ id }) => {
        this.show(id);
      }),
      runner.bus.on('mission:end', ({ result }) => {
        if (result.outcome !== 'success') return;
        this.complete = true;
        this.clearHint();
        this.render();
        this.highlight([]);
      }),
      coach.bus.on('tutorial:hint', ({ hint }) => {
        this.hintKey = hint;
        this.hintLeft = hint === 'step' ? Infinity : TUTORIAL_CONFIG.tipSeconds;
        this.renderHint();
      }),
    );
    // start() で最初の目標はもう始まっている
    const active = runner.objectives.find((o) => o.status === 'active')?.def.id;
    if (active) this.show(active);
  }

  /** 描画フレームごと。入力系統・スティックの方式が変わったら文と図を書き直し、一言の残りの秒数を進める */
  update(device: InputDevice, dt: number): void {
    if (this.root.hidden) return;
    if (this.hintKey && this.hintLeft !== Infinity) {
      this.hintLeft -= dt;
      if (this.hintLeft <= 0) this.clearHint();
    }
    const variant = tutorialVariant(device, this.steerTouch());
    if (variant === this.variant) return;
    this.variant = variant;
    this.render();
    this.renderHint();
  }

  private show(step: string): void {
    this.step = step;
    this.clearHint();
    this.render();
    const view = this.chapter ? TUTORIAL_CHAPTER_DEFS[this.chapter].steps[step] : undefined;
    this.highlight(view?.highlight ?? []);
  }

  private clearHint(): void {
    this.hintKey = null;
    this.hintLeft = 0;
    this.hint.hidden = true;
  }

  private renderHint(): void {
    const key = this.hintKey;
    const c = this.chapter;
    if (!key || !c || !this.step) {
      this.hint.hidden = true;
      return;
    }
    const v = this.variant ?? 'keys';
    const text =
      key === 'step'
        ? tutorialStepHint(c, this.step, v, this.keyName)
        : tutorialLiveHint(key, v, this.keyName);
    this.hint.textContent = text;
    this.hint.hidden = text === '';
  }

  private render(): void {
    const c = this.chapter;
    if (!c) return;
    const index = this.step ? this.steps.indexOf(this.step) : -1;
    const head = `${tutorialChapterNumber(TUTORIAL_CHAPTERS.indexOf(c))}  ${tutorialChapterName(c).name}`;
    this.count.textContent = this.complete
      ? `${head}  ✓`
      : `${head}  ${index + 1} / ${this.steps.length}`;
    const v = this.variant ?? 'keys';
    const step = this.step;
    this.text.textContent =
      this.complete || !step ? '' : tutorialStepText(c, step, v, this.keyName);
    this.text.hidden = this.text.textContent === '';
    const view = step ? TUTORIAL_CHAPTER_DEFS[c].steps[step] : undefined;
    this.figure.replaceChildren();
    if (view && !this.complete)
      this.figure.appendChild(createTutorialFigure(view.figure, v, this.keyName));
    this.figure.hidden = this.complete || !view;
    // 練習の注意は最初の章の最初の段階だけ
    this.note.hidden = this.complete || index !== 0 || c !== TUTORIAL_CHAPTERS[0];
    this.root.classList.toggle('is-complete', this.complete);
  }
}
