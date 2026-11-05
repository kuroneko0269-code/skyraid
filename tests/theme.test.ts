import { describe, expect, it } from 'vitest';
import theme from '../src/ui/theme.css?raw';
import hud from '../src/ui/hud.css?raw';
import segmented from '../src/ui/segmented.css?raw';
import { inputKindOf, shouldBlurAfterTap } from '../src/ui/tap-focus';

// src/ui の CSS と TS の中身（Vite の ?raw）
const CSS_FILES = import.meta.glob<string>('../src/ui/**/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const TS_FILES = import.meta.glob<string>('../src/ui/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** コメントを除いた CSS */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** @media (hover: hover) のブロックの範囲（開き括弧から対応する閉じ括弧まで） */
function hoverMediaRanges(css: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const m of css.matchAll(/@media\s*\(hover:\s*hover\)\s*\{/g)) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
    }
    ranges.push([start, i]);
  }
  return ranges;
}

/** セレクタ → 宣言のブロック（一番外側の規則と @media の中の規則。入れ子は 1 段まで） */
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  for (const m of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g))
    out.push({ selector: (m[1] ?? '').trim(), body: m[2] ?? '' });
  return out;
}

/** :root で定義している --ui-* の変数名 */
function definedVariables(css: string): Set<string> {
  return new Set([...css.matchAll(/(--ui-[\w-]+)\s*:/g)].map((m) => m[1] ?? ''));
}

describe('デザインシステム（theme.css）', () => {
  const defined = definedVariables(theme);

  it('色・余白・角・影・フォントの変数がそろっている', () => {
    for (const name of [
      '--ui-bg',
      '--ui-text',
      '--ui-accent',
      '--ui-warn',
      '--ui-line',
      '--ui-space-1',
      '--ui-space-4',
      '--ui-cut',
      '--ui-cut-sm',
      '--ui-cut-lg',
      '--ui-shadow-text',
      '--ui-glow',
      '--ui-font-display',
      '--ui-font-body',
      '--ui-safe-top',
      '--ui-safe-bottom',
    ])
      expect(defined, name).toContain(name);
  });

  it('アクセントは HUD と同じシアン、見出しは Rajdhani でフォールバックは system-ui', () => {
    expect(theme).toMatch(/--ui-accent:\s*rgb\(110, 240, 255\)/);
    expect(hud).toContain('110, 240, 255');
    expect(theme).toMatch(/--ui-font-display:\s*'Rajdhani', system-ui/);
    expect(theme).toMatch(/--ui-font-body:[^;]*monospace;/);
  });

  it('共通部品のクラスを定義している', () => {
    for (const cls of ['ui-button', 'ui-panel', 'ui-dialog', 'ui-item', 'ui-toggle'])
      expect(theme).toMatch(new RegExp(`\\.${cls}[\\s,{.:)]`));
    // 角丸ではなくチャンファー
    expect(theme).toContain('clip-path: polygon(');
  });

  it('UI の CSS が使う --ui-* はすべて theme.css で定義されている', () => {
    expect(Object.keys(CSS_FILES).length).toBeGreaterThan(10);
    for (const [file, css] of Object.entries(CSS_FILES)) {
      expect(css.length, file).toBeGreaterThan(0);
      for (const m of css.matchAll(/var\((--ui-[\w-]+)/g))
        expect(defined, `${file}: ${m[1] ?? ''}`).toContain(m[1]);
    }
  });

  it('画面の TS はもう古いボタンのクラス（menu-button）を使わない', () => {
    expect(Object.keys(TS_FILES).length).toBeGreaterThan(10);
    for (const [file, ts] of Object.entries(TS_FILES))
      expect(ts, file).not.toContain('menu-button');
  });
});

// 7-C: 実機のスマホ（iPhone 横画面）の UI の不具合の対策
describe('タッチ端末とボタンの折り返し（7-C）', () => {
  it('ボタン・トグル・セグメントの文字は折り返さない（white-space: nowrap）', () => {
    const body = (css: string, sel: string): string =>
      rules(css).find((r) => r.selector === sel)?.body ?? '';
    for (const sel of [':where(.ui-button)', ':where(button.ui-toggle)'])
      expect(body(theme, sel), sel).toMatch(/white-space:\s*nowrap/);
    expect(body(segmented, '.ui-seg-item')).toMatch(/white-space:\s*nowrap/);
  });

  it('各画面の CSS はボタンの最小幅を 0 にせず、折り返しも戻さない', () => {
    for (const [file, css] of Object.entries(CSS_FILES)) {
      for (const r of rules(css)) {
        // 一覧の項目（.ui-item・.hangar-entry など、2 行を持つカード）は対象外
        const isButton = /(\.ui-button|-button\b|-btn\b|\.campaign-back|\.campaign-go)/.test(
          r.selector,
        );
        if (!isButton || /(ui-item|-entry|-list)/.test(r.selector)) continue;
        expect(r.body, `${file}: ${r.selector}`).not.toMatch(/min-width:\s*0\s*;/);
        expect(r.body, `${file}: ${r.selector}`).not.toMatch(/white-space:\s*(normal|pre-wrap)/);
      }
    }
  });

  it(':hover はすべて @media (hover: hover) の中だけ（タップした位置にホバーが残らない）', () => {
    let count = 0;
    for (const [file, raw] of Object.entries(CSS_FILES)) {
      const css = stripComments(raw);
      const ranges = hoverMediaRanges(css);
      for (const m of css.matchAll(/:hover/g)) {
        count++;
        const at = m.index;
        expect(
          ranges.some(([a, b]) => at > a && at < b),
          `${file}: ${css.slice(Math.max(0, at - 60), at + 10)}`,
        ).toBe(true);
      }
    }
    expect(count).toBeGreaterThan(3);
  });

  it(':focus-visible の見た目はタッチ中（data-input="touch"）には出さない', () => {
    for (const r of [...rules(theme), ...rules(segmented)]) {
      if (!r.selector.includes(':focus-visible')) continue;
      // outline を消すだけの規則は可
      if (/^\s*outline:\s*none;\s*$/.test(r.body)) continue;
      for (const part of r.selector.split(/,(?![^(]*\))/))
        if (part.includes(':focus-visible'))
          expect(part, r.selector).toContain(":root:not([data-input='touch'])");
    }
  });

  it('タップの後にフォーカスを外すのはボタン類だけ（入力欄・選択欄は外さない）', () => {
    expect(inputKindOf('touch')).toBe('touch');
    expect(inputKindOf('pen')).toBe('touch');
    expect(inputKindOf('mouse')).toBe('mouse');
    expect(shouldBlurAfterTap('BUTTON', null)).toBe(true);
    expect(shouldBlurAfterTap('button', 'button')).toBe(true);
    expect(shouldBlurAfterTap('INPUT', 'checkbox')).toBe(true);
    expect(shouldBlurAfterTap('INPUT', 'text')).toBe(false);
    expect(shouldBlurAfterTap('INPUT', 'range')).toBe(false);
    expect(shouldBlurAfterTap('SELECT', null)).toBe(false);
    expect(shouldBlurAfterTap('TEXTAREA', null)).toBe(false);
  });

  it('セグメントは高さ 48px 以上で、選択中（aria-checked）は塗りつぶし', () => {
    const item = rules(segmented).find((r) => r.selector === '.ui-seg-item')?.body ?? '';
    const h = /min-height:\s*(\d+)px/.exec(item);
    expect(Number(h?.[1])).toBeGreaterThanOrEqual(48);
    const on =
      rules(segmented).find((r) => r.selector === ".ui-seg-item[aria-checked='true']")?.body ?? '';
    expect(on).toMatch(/--fill:\s*var\(--ui-accent\)/);
  });

  it('HUD の上部パネルは上中央の帯（幅 50% 以内）に収める', () => {
    expect(theme).toMatch(/--ui-hud-band-width:\s*50cqw/);
    let found = 0;
    for (const [file, css] of Object.entries(CSS_FILES)) {
      for (const r of rules(css)) {
        // 位置を決める規則だけ（@media の中の詰める規則は対象外）
        if (!/^\.(defense-top|kaiju-top|race-top)$/.test(r.selector)) continue;
        if (!r.body.includes('position:')) continue;
        found++;
        expect(r.body, file).toMatch(/top:\s*var\(--ui-hud-band-top\)/);
        expect(r.body, file).toMatch(/(max-width|width):[^;]*var\(--ui-hud-band-width\)/);
      }
    }
    expect(found).toBe(3);
  });
});
