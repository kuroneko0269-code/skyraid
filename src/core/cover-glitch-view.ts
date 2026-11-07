// 10-1c: 幕のロゴのグリッチを描く（計算は cover-glitch.ts）。描くのは transform・clip-path・CSS 変数だけ:
// 揺れは translate を前に足す、色ずれは drop-shadow の赤と青緑（index.html の .viewport-cover.is-moving の filter）、
// 帯ずれはロゴの複製を横の帯に切って（clip-path）帯ごとに左右へずらす（その間は元のロゴを隠す）、
// ちらつきは filter の opacity、走査線とノイズの帯は幕の疑似要素（::after・::before）。画像は足さない
import type { GlitchFrame } from './cover-glitch';

export interface GlitchColors {
  readonly red: string;
  readonly cyan: string;
}

export class CoverGlitchView {
  private readonly slices: HTMLElement[] = [];
  /** 複製の元（ロゴが読めず文字になったら作り直す） */
  private owner: HTMLElement | null = null;

  constructor(
    private readonly cover: HTMLElement,
    private readonly colors: GlitchColors,
  ) {}

  /** base はロゴを置く transform（cover-logo.ts）、scale はその拡大率（色ずれの px を画面の px にそろえる） */
  render(el: HTMLElement, base: string, scale: number, f: GlitchFrame): void {
    const st = this.cover.style;
    const s = scale > 0 ? scale : 1;
    const on = f.split > 0;
    st.setProperty('--glitch-split', `${(f.split / s).toFixed(2)}px`);
    st.setProperty('--glitch-red', on ? this.colors.red : 'transparent');
    st.setProperty('--glitch-cyan', on ? this.colors.cyan : 'transparent');
    st.setProperty('--glitch-alpha', String(f.alpha));
    st.setProperty('--glitch-scan', f.scanline.toFixed(3));
    st.setProperty('--glitch-noise', f.noise.toFixed(3));
    st.setProperty('--glitch-noise-y', `${(f.noiseY * 100).toFixed(1)}%`);
    st.setProperty('--glitch-noise-h', `${(f.noiseH * 100).toFixed(1)}%`);
    const shake = `translate(${f.dx.toFixed(2)}px, ${f.dy.toFixed(2)}px) `;
    el.style.transform = shake + base;
    const sliced = f.bands.length > 0;
    el.style.visibility = sliced ? 'hidden' : '';
    if (sliced) this.ensure(el, f.bands.length);
    this.slices.forEach((c, i) => {
      const b = f.bands[i];
      if (!b) {
        c.style.visibility = 'hidden';
        return;
      }
      c.className = `${el.className} is-slice`;
      // 左右は色ずれ・帯ずれの影が切れないように広げる
      c.style.clipPath = `inset(${(b.top * 100).toFixed(2)}% -40% ${((1 - b.bottom) * 100).toFixed(2)}% -40%)`;
      c.style.transform = `translate(${(f.dx + b.offset).toFixed(2)}px, ${f.dy.toFixed(2)}px) ${base}`;
      c.style.visibility = b.hidden ? 'hidden' : 'visible';
    });
  }

  /** 乱れを消す（着いたとき・止めたとき） */
  clear(el: HTMLElement | null): void {
    for (const k of [
      '--glitch-split',
      '--glitch-red',
      '--glitch-cyan',
      '--glitch-alpha',
      '--glitch-scan',
      '--glitch-noise',
      '--glitch-noise-y',
      '--glitch-noise-h',
    ])
      this.cover.style.removeProperty(k);
    if (el) el.style.visibility = '';
    for (const c of this.slices) c.style.visibility = 'hidden';
  }

  /** 帯の複製を n 本そろえる（元のロゴの次に置く: querySelector は元のロゴを先に見つける） */
  private ensure(el: HTMLElement, n: number): void {
    if (this.owner !== el) {
      for (const c of this.slices.splice(0)) c.remove();
      this.owner = el;
    }
    while (this.slices.length < n) {
      const c = el.cloneNode(true);
      if (!(c instanceof HTMLElement)) return;
      c.removeAttribute('style');
      c.style.visibility = 'hidden';
      this.cover.appendChild(c);
      this.slices.push(c);
    }
  }
}
