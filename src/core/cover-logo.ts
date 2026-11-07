// 10-1b: 幕のロゴ（index.html の .viewport-cover-logo / .viewport-cover-text）を動かす。計算は cover-motion.ts。
// 測り直しの間はばねで幕の中央を追い（揺れ）、land でタイトルの文字の位置と大きさへ移ってぴたりと合わせる。
// 動かすのは transform だけ（ロゴの読み込み・文字への切り替え・幕の出し入れは viewport-cover.ts のまま）
// 10-1c: その上にグリッチ（cover-glitch.ts / cover-glitch-view.ts）。測り直しの試み（pulse）で強く、合間は弱く、
// land では peakMs だけその場で一番強く乱れてから移り、移る間に収まる。着く瞬間は乱れを消してから目標に合わせて測る
import { VIEWPORT_CONFIG } from '../data/app';
import { CoverGlitchView } from './cover-glitch-view';
import { CALM_FRAME, glitchFrame, glitchLevel, type GlitchFrame } from './cover-glitch';
import {
  boxError,
  coverLogoBox,
  landProgress,
  mixBox,
  stepSpring,
  visibleBox,
  type LogoBox,
  type SpringState,
} from './cover-motion';

const C = VIEWPORT_CONFIG.coverLogo;
const G = C.glitch;

/** 10-1c: 乱れの記録（点検。時刻は幕を出してからの ms） */
export interface GlitchStats {
  /** 乱れを変えた回数・帯に切った回数・ちらつき / 欠けの時刻・一番強かった強さ */
  steps: number;
  bandSteps: number;
  flickers: number[];
  maxLevel: number;
  /** on（幕）・pulse（測り直しの試み）・peak（外すと決めた）・land（移り始め）・landed（重なった） */
  timeline: { t: number; what: string }[];
}

/** 着いたときの結果（点検: ui-audit-device が読む） */
export interface LandingResult {
  /** 着いた先とロゴのずれ（px。中心の x・y と幅の差の大きい方） */
  readonly error: number;
  /** 移り始めてから着くまで（ms） */
  readonly ms: number;
  readonly kind: 'logo' | 'text';
  /** 10-1c: 乱れの記録 */
  readonly glitch: GlitchStats;
}

/** 動きを省く設定（視差効果を減らす） */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export class CoverLogoMotion {
  private readonly state: SpringState = { box: { cx: 0, cy: 0, w: 0 }, v: { cx: 0, cy: 0, w: 0 } };
  private started = false;
  private frame = 0;
  private last = 0;
  private landing: {
    from: LogoBox;
    to: () => LogoBox | null;
    start: number;
    done: (r: LandingResult | null) => void;
  } | null = null;
  // 10-1c: グリッチ
  private readonly view: CoverGlitchView;
  private startedAt = 0;
  private pulseAt: number | null = null;
  private peakAt: number | null = null;
  private landAt: number | null = null;
  private glitch: GlitchFrame = CALM_FRAME;
  private nextStepAt = 0;
  private lastFlickerAt: number | null = null;
  readonly stats: GlitchStats = { steps: 0, bandSteps: 0, flickers: [], maxLevel: 0, timeline: [] };

  constructor(private readonly cover: HTMLElement) {
    this.view = new CoverGlitchView(cover, G);
  }

  private note(what: string, now = performance.now()): void {
    this.stats.timeline.push({ t: Math.round(now - this.startedAt), what });
  }

  /** 10-1c: 測り直しを試みた（強く乱す） */
  pulse(): void {
    if (this.landing) return;
    const now = performance.now();
    this.pulseAt = now;
    this.nextStepAt = 0;
    this.note('pulse', now);
  }

  /** 今見えているロゴ（画像か、読めなかったときの文字） */
  private element(): HTMLElement | null {
    const text = this.cover.classList.contains('is-text');
    return this.cover.querySelector<HTMLElement>(
      text ? '.viewport-cover-text' : '.viewport-cover-logo',
    );
  }

  /** 画像の縦横比（文字・読み込み前は 0） */
  private aspect(el: HTMLElement): number {
    return el instanceof HTMLImageElement && el.naturalHeight > 0
      ? el.naturalWidth / el.naturalHeight
      : 0;
  }

  /** 幕の中の目標（幕の中央。画像はタイトルと同じ式の大きさ、文字は CSS の大きさのまま） */
  private coverTarget(el: HTMLElement): LogoBox {
    const r = this.cover.getBoundingClientRect();
    const aspect = this.aspect(el);
    if (aspect > 0) return coverLogoBox(r, aspect, C);
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: el.offsetWidth };
  }

  start(): void {
    this.startedAt = performance.now();
    this.note('on', this.startedAt);
    this.cover.classList.add('is-moving');
    // 最初の位置は次のフレームを待たずに置く（左上に出さない）。幕は fitRoot の途中（新しい大きさを body に書く前）に
    // 出るので、書き終えた後（マイクロタスク）の大きさで置く
    queueMicrotask(() => {
      const el = this.element();
      if (!el || this.started) return;
      this.state.box = this.coverTarget(el);
      this.started = true;
      this.apply(el, this.state.box);
    });
    this.frame = requestAnimationFrame(this.tick);
  }

  /** 見せる要素が変わった（ロゴが読めず文字にした）: 次のフレームを待たずに文字を幕の中央へ置く */
  refresh(): void {
    const el = this.element();
    if (!el || !this.started || this.landing) return;
    this.state.box = this.coverTarget(el);
    this.state.v = { cx: 0, cy: 0, w: 0 };
    this.apply(el, this.state.box);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.view.clear(this.element());
  }

  /** タイトルの文字（target が返す箱）へ移る。着いたら（ロゴが無ければすぐ）done */
  land(to: () => LogoBox | null, done: (r: LandingResult | null) => void): void {
    if (!this.started || !this.element()) {
      done(null);
      return;
    }
    // 10-1c: peakMs だけその場で一番強く乱れてから移る（start は移り始める時刻）
    const now = performance.now();
    this.peakAt = now;
    this.landAt = now + G.peakMs;
    this.nextStepAt = 0;
    this.note('peak', now);
    this.landing = { from: { ...this.state.box }, to, start: this.landAt, done };
    // 重い端末でフレームが peakMs より空いても、一番強い乱れは必ず 1 歩見せる
    const el = this.element();
    if (el) this.applyGlitched(el, this.state.box, now);
  }

  /** ロゴを置く transform と拡大率（大きさが読めなければ null） */
  private placement(el: HTMLElement, box: LogoBox): { base: string; s: number } | null {
    const baseW = el.offsetWidth;
    const baseH = el.offsetHeight;
    if (baseW <= 0) return null;
    const s = box.w / baseW;
    return {
      base: `translate(${box.cx - (baseW * s) / 2}px, ${box.cy - (baseH * s) / 2}px) scale(${s})`,
      s,
    };
  }

  private apply(el: HTMLElement, box: LogoBox): void {
    const p = this.placement(el, box);
    if (p) el.style.transform = p.base;
  }

  /** 10-1c: 乱れを重ねて置く（間隔ごとに乱れを変え、その間は同じ乱れのまま位置だけ追う） */
  private applyGlitched(el: HTMLElement, box: LogoBox, now: number): void {
    const p = this.placement(el, box);
    if (!p) return;
    if (now >= this.nextStepAt) {
      const level = glitchLevel(
        now,
        { pulseAt: this.pulseAt, peakAt: this.peakAt, landAt: this.landAt, landMs: C.landMs },
        G,
      );
      this.glitch = glitchFrame(level, now, this.lastFlickerAt, Math.random, G);
      this.nextStepAt = now + this.glitch.nextMs;
      const st = this.stats;
      st.steps++;
      st.maxLevel = Math.max(st.maxLevel, level);
      if (this.glitch.bands.length > 0) st.bandSteps++;
      if (this.glitch.flicker) {
        this.lastFlickerAt = now;
        st.flickers.push(Math.round(now - this.startedAt));
      }
    }
    this.view.render(el, p.base, p.s, this.glitch);
  }

  private readonly tick = (now: number): void => {
    const el = this.element();
    if (!el) return;
    const dt = this.last === 0 ? 0 : Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const land = this.landing;
    if (land) {
      const to = land.to();
      const ms = performance.now() - land.start;
      if (!to) {
        // 着く先が消えた（画面が変わった）: その場で終える
        this.landing = null;
        land.done(null);
        return;
      }
      const p = landProgress(ms, C.landMs, C);
      // 行き過ぎ（p > 1）も見せ、終わりの時刻で目標にぴたりと合わせる（10-1c: 移り始める前の ms < 0 はその場で乱れる）
      const end = ms >= C.landMs;
      const box = end ? to : mixBox(land.from, to, p);
      if (!end) this.applyGlitched(el, box, performance.now());
      else {
        // 10-1c: 乱れを消してから合わせて測る
        this.view.clear(el);
        this.apply(el, box);
      }
      if (ms >= 0 && this.stats.timeline.every((e) => e.what !== 'land'))
        this.note('land', land.start);
      if (end) {
        this.landing = null;
        this.note('landed');
        const error = boxError(visibleBox(el.getBoundingClientRect(), this.aspect(el)), to);
        land.done({
          error,
          ms: Math.round(ms),
          kind: el instanceof HTMLImageElement ? 'logo' : 'text',
          glitch: this.stats,
        });
        return;
      }
    } else {
      const target = this.coverTarget(el);
      if (!this.started) {
        this.state.box = { ...target };
        this.started = true;
      } else stepSpring(this.state, target, dt, C);
      this.applyGlitched(el, this.state.box, performance.now());
    }
    this.frame = requestAnimationFrame(this.tick);
  };
}
