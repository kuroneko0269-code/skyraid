import { describe, expect, it } from 'vitest';
import theme from '../src/ui/theme.css?raw';
import hud from '../src/ui/hud.css?raw';

// src/ui の CSS と TS の中身（Vite の ?raw）
const CSS_FILES = import.meta.glob<string>('../src/ui/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const TS_FILES = import.meta.glob<string>('../src/ui/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

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
