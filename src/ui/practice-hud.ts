// 練習場（9-5）の HUD: 上中央に課題の名前・残り時間・撃墜数・スコア、画面中央に数え（3・2・1・GO）と時間切れ（TIME UP）。
// 飛行中の一言（9-5c）の数えもここ（出すのは照準の近く: hud-tip.ts）。
// 見た目はリングレースの HUD（race.css）を使う。値が変わったときだけ DOM を書く
import { t } from '../core/i18n';
import './race.css';
import { PRACTICE_DRILL_LABELS } from '../data/practice';
import type { PracticeRunner } from '../missions/practice/runner';
import { FlightTips, type FlightTip } from '../missions/practice/tips';
import { el } from './hud-dom';

export class PracticeHud {
  readonly root: HTMLDivElement;
  private readonly time: HTMLDivElement;
  private readonly name: HTMLSpanElement;
  private readonly count: HTMLSpanElement;
  private readonly big: HTMLDivElement;
  private readonly bigMain: HTMLDivElement;
  private readonly bigSub: HTMLDivElement;
  /** 9-5c: 飛行中の一言（9-5d: 出すのは照準の近く = tipOptions.show） */
  private readonly tips = new FlightTips();
  private runner: PracticeRunner | null = null;
  private off: (() => void)[] = [];
  private bigUntil = 0;
  private last = { time: '', count: '', name: '' };

  constructor(
    parent: HTMLElement,
    /** 一言を出すか（設定）・出してよい一言（9-5d: 補助の組）・出す（照準の近く） */
    private readonly tipOptions: {
      readonly enabled: () => boolean;
      readonly allow: (tip: FlightTip) => boolean;
      readonly show: (tip: FlightTip) => void;
      readonly hide: () => void;
    } = { enabled: () => false, allow: () => false, show: () => undefined, hide: () => undefined },
    /**
     * 9-10 の事前修正: 課題名（日替わりは日替わりの課題名。null は練習場の課題名）。飛行の初期状態は練習場を付けた後に決まるので
     * 描画のたびに読む
     */
    private readonly title: () => string | null = () => null,
  ) {
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
    this.tipOptions.hide();
    this.tips.reset();
    this.last = { time: '', count: '', name: '' };
    if (!runner) return;
    this.updateName(runner);
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
    this.updateName(r);
    if (!this.big.hidden && performance.now() > this.bigUntil) this.big.hidden = true;
    const left = r.phase === 'countdown' ? r.duration : r.timeLeft;
    const time = left.toFixed(1);
    if (time !== this.last.time) this.time.textContent = this.last.time = time;
    const count = t('practice.hud.count', { kills: String(r.kills), score: String(r.liveScore) });
    if (count !== this.last.count) this.count.textContent = this.last.count = count;
    // 9-5c: 指標の数えの増え方から一言（判定には入れない）
    if (!r.running) return;
    const o = this.tipOptions;
    const tip = this.tips.update(r.elapsed, r.aim, o.allow);
    if (tip && o.enabled()) o.show(tip);
  }

  private updateName(r: PracticeRunner): void {
    const title = this.title() ?? PRACTICE_DRILL_LABELS[r.drill].name;
    const name = `${title} · ${t('practice.hud.gunOnly')}`;
    if (name !== this.last.name) this.name.textContent = this.last.name = name;
  }

  private showBig(main: string, sub: string, kind: string, seconds = 1): void {
    this.bigMain.textContent = main;
    this.bigSub.textContent = sub;
    this.big.className = `race-big ${kind}`;
    this.big.hidden = false;
    this.bigUntil = performance.now() + seconds * 1000;
  }
}
