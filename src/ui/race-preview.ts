// 9-8 コースの下見の画面（DOM）: 下の帯に「コースの下見」・コース名・一言・進み・「タップで飛ばす」（上の帯は薄い影だけ）。
// 押す（タップ・クリック）か Space / Enter / Esc で飛ばす。カメラと進みは render/race-guide-link.ts
import { t } from '../core/i18n';
import './race.css';
import type { CourseDef } from '../missions/race/types';
import { el } from './hud-dom';

export class RacePreviewScreen {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly note: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private onSkip: (() => void) | null = null;
  private lastBar = -1;

  constructor(parent: HTMLElement) {
    const root = el('div', 'race-preview', parent);
    root.hidden = true;
    root.setAttribute('role', 'button');
    root.setAttribute('aria-label', t('race.preview.skip'));
    // 上の帯は空けておく（飛行の始めのお知らせ・トーストと重ねない）。文字は下の帯に
    el('div', 'race-preview-top', root);
    const bottom = el('div', 'race-preview-bottom', root);
    el('div', 'race-preview-label', bottom, t('race.preview.label'));
    this.title = el('div', 'race-preview-title', bottom);
    this.note = el('div', 'race-preview-note', bottom);
    const bar = el('div', 'race-preview-bar', bottom);
    this.bar = el('div', '', bar);
    el('div', 'race-preview-skip', bottom, t('race.preview.skip'));
    root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.skip();
    });
    window.addEventListener(
      'keydown',
      (e) => {
        if (root.hidden) return;
        if (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        this.skip();
      },
      true,
    );
    this.root = root;
  }

  get shown(): boolean {
    return !this.root.hidden;
  }

  show(course: CourseDef, onSkip: () => void): void {
    this.title.textContent = course.name;
    this.note.textContent = course.note;
    this.onSkip = onSkip;
    this.lastBar = -1;
    this.setProgress(0);
    this.root.hidden = false;
    // 下見の間は飛行の HUD・タッチ操作・ヒントを隠す（race.css の :root[data-race-preview]）
    document.documentElement.toggleAttribute('data-race-preview', true);
  }

  hide(): void {
    this.root.hidden = true;
    this.onSkip = null;
    document.documentElement.toggleAttribute('data-race-preview', false);
  }

  /** 進み（0〜1） */
  setProgress(u: number): void {
    const v = Math.round(Math.min(1, Math.max(0, u)) * 200) / 200;
    if (v === this.lastBar) return;
    this.lastBar = v;
    this.bar.style.transform = `scaleX(${v.toFixed(3)})`;
  }

  private skip(): void {
    const fn = this.onSkip;
    this.hide();
    fn?.();
  }
}
