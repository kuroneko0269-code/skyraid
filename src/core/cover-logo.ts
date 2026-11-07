// 10-1b: 幕のロゴ（index.html の .viewport-cover-logo / .viewport-cover-text）を動かす。計算は cover-motion.ts。
// 測り直しの間はばねで幕の中央を追い（揺れ）、land でタイトルの文字の位置と大きさへ移ってぴたりと合わせる。
// 動かすのは transform だけ（ロゴの読み込み・文字への切り替え・幕の出し入れは viewport-cover.ts のまま）
import { VIEWPORT_CONFIG } from '../data/app';
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

/** 着いたときの結果（点検: ui-audit-device が読む） */
export interface LandingResult {
  /** 着いた先とロゴのずれ（px。中心の x・y と幅の差の大きい方） */
  readonly error: number;
  /** 移り始めてから着くまで（ms） */
  readonly ms: number;
  readonly kind: 'logo' | 'text';
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

  constructor(private readonly cover: HTMLElement) {}

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
  }

  /** タイトルの文字（target が返す箱）へ移る。着いたら（ロゴが無ければすぐ）done */
  land(to: () => LogoBox | null, done: (r: LandingResult | null) => void): void {
    if (!this.started || !this.element()) {
      done(null);
      return;
    }
    this.landing = { from: { ...this.state.box }, to, start: performance.now(), done };
  }

  private apply(el: HTMLElement, box: LogoBox): void {
    const baseW = el.offsetWidth;
    const baseH = el.offsetHeight;
    if (baseW <= 0) return;
    const s = box.w / baseW;
    el.style.transform = `translate(${box.cx - (baseW * s) / 2}px, ${box.cy - (baseH * s) / 2}px) scale(${s})`;
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
      // 行き過ぎ（p > 1）も見せ、終わりの時刻で目標にぴたりと合わせる
      const end = ms >= C.landMs;
      const box = end ? to : mixBox(land.from, to, p);
      this.apply(el, box);
      if (end) {
        this.landing = null;
        const error = boxError(visibleBox(el.getBoundingClientRect(), this.aspect(el)), to);
        land.done({
          error,
          ms: Math.round(ms),
          kind: el instanceof HTMLImageElement ? 'logo' : 'text',
        });
        return;
      }
    } else {
      const target = this.coverTarget(el);
      if (!this.started) {
        this.state.box = { ...target };
        this.started = true;
      } else stepSpring(this.state, target, dt, C);
      this.apply(el, this.state.box);
    }
    this.frame = requestAnimationFrame(this.tick);
  };
}
