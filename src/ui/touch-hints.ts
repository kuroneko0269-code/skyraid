import './touch-hints.css';
import { TUTORIAL_CONFIG } from '../data/tutorial';
import { el } from './hud-dom';
import type { TutorialStrings } from './tutorial-text';

type HintId = (typeof TUTORIAL_CONFIG.hints)[number]['id'];

/**
 * タッチ操作のヒント（4-11）: HUD の速度・高度・レーダー・残弾を順に吹き出しで指す（1 つ 3 秒）。
 * 時間は飛行中の描画フレームだけ進める（ポーズ中は止まる）。指す要素が見えなければ（HUD 非表示など）その吹き出しは飛ばす
 */
export class TouchHints {
  private readonly bubble: HTMLDivElement;
  private readonly text: HTMLSpanElement;
  /** 始めてからの秒数。止まっていれば null */
  private time: number | null = null;
  private shownIndex = -1;

  constructor(
    parent: HTMLElement,
    private readonly hud: HTMLElement,
    private readonly strings: TutorialStrings['hints'],
  ) {
    this.bubble = el('div', 'touch-hint', parent);
    this.text = el('span', 'touch-hint-text', this.bubble);
    this.bubble.hidden = true;
  }

  get running(): boolean {
    return this.time !== null;
  }

  start(): void {
    this.time = -TUTORIAL_CONFIG.hintDelaySeconds;
    this.shownIndex = -1;
  }

  stop(): void {
    this.time = null;
    this.shownIndex = -1;
    this.bubble.hidden = true;
  }

  /** 飛行中の描画フレームごと */
  update(dt: number): void {
    if (this.time === null) return;
    this.time += dt;
    const hints = TUTORIAL_CONFIG.hints;
    const index = this.time < 0 ? -1 : Math.floor(this.time / TUTORIAL_CONFIG.hintSeconds);
    if (index >= hints.length) {
      this.stop();
      return;
    }
    if (index === this.shownIndex) return;
    this.shownIndex = index;
    const hint = hints[index];
    if (!hint) {
      this.bubble.hidden = true;
      return;
    }
    this.place(hint.id, this.hud.querySelector(hint.selector));
  }

  /** 要素の下（画面の下半分にあれば上）に吹き出しを置き、矢印で指す */
  private place(id: HintId, target: Element | null): void {
    const rect = target?.getBoundingClientRect();
    if (!rect || rect.width === 0 || this.hud.hidden) {
      this.bubble.hidden = true;
      return;
    }
    this.text.textContent = this.strings[id];
    const below = rect.top + rect.height / 2 < window.innerHeight / 2;
    this.bubble.classList.toggle('is-below', below);
    this.bubble.classList.toggle('is-above', !below);
    const x = rect.left + rect.width / 2;
    this.bubble.style.setProperty('--hint-x', `${Math.round(x)}px`);
    this.bubble.style.setProperty(
      '--hint-y',
      `${Math.round(below ? rect.bottom + 12 : rect.top - 12)}px`,
    );
    this.bubble.hidden = false;
  }
}
