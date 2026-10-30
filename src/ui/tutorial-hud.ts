import './tutorial-hud.css';
import type { InputDevice } from '../core/input';
import type { Locale } from '../core/locale';
import type { Action } from '../data/keybinds';
import {
  TUTORIAL_CONFIG,
  TUTORIAL_STEPS,
  type TouchPart,
  type TutorialStep,
} from '../data/tutorial';
import type { MissionRunner } from '../missions/runner';
import { el } from './hud-dom';
import { tutorialStepText, tutorialStrings } from './tutorial-text';

function isStep(id: string): id is TutorialStep {
  return (TUTORIAL_STEPS as readonly string[]).includes(id);
}

/**
 * チュートリアル（4-11）の指示: 画面上部の中央に「段階 / 全体」と短い指示、右に「中断」。
 * 段階はランナーの目標（objective:activate）で進め、使うタッチの部品を光らせる（highlight）。
 * 文は最後に操作した入力系統（タッチ / キーボード / パッド）に合わせ、キーボードは今の割当のキー名を出す
 */
export class TutorialHud {
  readonly root: HTMLDivElement;
  private readonly count: HTMLSpanElement;
  private readonly text: HTMLDivElement;
  private readonly note: HTMLDivElement;
  private unsubscribe: (() => void)[] = [];
  private step: TutorialStep | null = null;
  private complete = false;
  private device: InputDevice | null = null;

  constructor(
    parent: HTMLElement,
    private readonly locale: Locale,
    private readonly keyName: (action: Action) => string,
    private readonly highlight: (parts: readonly TouchPart[]) => void,
    onAbort: () => void,
  ) {
    const t = tutorialStrings(locale);
    this.root = el('div', 'tutorial-hud', parent);
    const head = el('div', 'tutorial-hud-head', this.root);
    this.count = el('span', 'tutorial-hud-count', head);
    const abort = el('button', 'ui-button is-ghost tutorial-hud-abort', head, t.abort);
    abort.type = 'button';
    abort.addEventListener('click', () => {
      abort.blur();
      onAbort();
    });
    this.text = el('div', 'tutorial-hud-text', this.root);
    this.note = el('div', 'tutorial-hud-note', this.root, t.safety);
    this.root.hidden = true;
  }

  /** ランナーの進み具合を表示する。チュートリアルでなければ（null）隠す */
  attach(runner: MissionRunner | null): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.step = null;
    this.complete = false;
    this.root.hidden = runner === null;
    this.highlight([]);
    if (!runner) return;
    this.unsubscribe.push(
      runner.bus.on('objective:activate', ({ id }) => {
        if (isStep(id)) this.show(id);
      }),
      runner.bus.on('mission:end', ({ result }) => {
        if (result.outcome !== 'success') return;
        this.complete = true;
        this.render();
        this.highlight([]);
      }),
    );
    // start() で最初の目標はもう始まっている
    const active = runner.objectives.find((o) => o.status === 'active')?.def.id;
    if (active && isStep(active)) this.show(active);
  }

  /** 描画フレームごと。入力系統が変わったら文を書き直す */
  update(device: InputDevice): void {
    if (this.root.hidden || device === this.device) return;
    this.device = device;
    this.render();
  }

  private show(step: TutorialStep): void {
    this.step = step;
    this.render();
    this.highlight(TUTORIAL_CONFIG.highlights[step]);
  }

  private render(): void {
    const t = tutorialStrings(this.locale);
    const index = this.step ? TUTORIAL_STEPS.indexOf(this.step) : -1;
    this.count.textContent = this.complete
      ? t.complete
      : `${t.title}  ${index + 1} / ${TUTORIAL_STEPS.length}`;
    this.text.textContent =
      this.complete || !this.step
        ? ''
        : tutorialStepText(this.step, this.device ?? 'keyboard', this.locale, this.keyName);
    this.text.hidden = this.text.textContent === '';
    // 練習の注意は最初の段階だけ
    this.note.hidden = this.complete || index !== 0;
    this.root.classList.toggle('is-complete', this.complete);
  }
}
