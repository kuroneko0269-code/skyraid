// 練習場（9-5）の HUD: 上中央に課題の名前・残り時間・撃墜数・スコア、画面中央に数え（3・2・1・GO）と時間切れ（TIME UP）。
// 見た目はリングレースの HUD（race.css）を使う。値が変わったときだけ DOM を書く
import { t } from '../core/i18n';
import './race.css';
import { PRACTICE_DRILL_LABELS } from '../data/practice';
import type { PracticeRunner } from '../missions/practice/runner';
import { el } from './hud-dom';

export class PracticeHud {
  readonly root: HTMLDivElement;
  private readonly time: HTMLDivElement;
  private readonly name: HTMLSpanElement;
  private readonly count: HTMLSpanElement;
  private readonly big: HTMLDivElement;
  private readonly bigMain: HTMLDivElement;
  private readonly bigSub: HTMLDivElement;
  private runner: PracticeRunner | null = null;
  private off: (() => void)[] = [];
  private bigUntil = 0;
  private last = { time: '', count: '' };

  constructor(parent: HTMLElement) {
    const root = el('div', 'race-hud practice-hud', parent);
    root.hidden = true;
    this.root = root;
    const top = el('div', 'race-top', root);
    this.time = el('div', 'race-time', top);
    const sub = el('div', 'race-sub', top);
    this.name = el('span', 'race-rings', sub);
    this.count = el('span', 'race-ghost practice-hud-count', sub);
    this.big = el('div', 'race-big', root);
    this.bigMain = el('div', 'race-big-main', this.big);
    this.bigSub = el('div', 'race-big-sub', this.big);
    this.big.hidden = true;
  }

  /** 練習場を付け替える（null で隠す） */
  attach(runner: PracticeRunner | null): void {
    for (const f of this.off) f();
    this.off = [];
    this.runner = runner;
    this.root.hidden = runner === null;
    this.big.hidden = true;
    this.last = { time: '', count: '' };
    if (!runner) return;
    this.name.textContent = `${PRACTICE_DRILL_LABELS[runner.drill].name} · ${t('practice.hud.gunOnly')}`;
    const bus = runner.bus;
    this.off.push(
      bus.on('practice:countdown', ({ count }) => {
        this.showBig(String(count), '', 'is-count');
      }),
      bus.on('practice:start', () => {
        this.showBig('GO', '', 'is-go', 0.8);
      }),
      bus.on('practice:end', ({ result }) => {
        this.showBig(
          'TIME UP',
          t('practice.hud.final', { score: String(result.score), kills: String(result.kills) }),
          'is-finish',
          99,
        );
      }),
    );
  }

  /** 描画フレームごと（飛行中だけ） */
  update(): void {
    const r = this.runner;
    if (!r) return;
    if (!this.big.hidden && performance.now() > this.bigUntil) this.big.hidden = true;
    const left = r.phase === 'countdown' ? r.duration : r.timeLeft;
    const time = left.toFixed(1);
    if (time !== this.last.time) this.time.textContent = this.last.time = time;
    const count = t('practice.hud.count', { kills: String(r.kills), score: String(r.liveScore) });
    if (count !== this.last.count) this.count.textContent = this.last.count = count;
  }

  private showBig(main: string, sub: string, kind: string, seconds = 1): void {
    this.bigMain.textContent = main;
    this.bigSub.textContent = sub;
    this.big.className = `race-big ${kind}`;
    this.big.hidden = false;
    this.bigUntil = performance.now() + seconds * 1000;
  }
}
