// 8-1 公開チェック: 版・更新履歴（v0.1〜v0.9・v1.0.0・v1.0.1・v1.0.2・v1.0.3・v1.0.4。8-7 で 1.0.0、v1.0.1 で 1.0.1、9-2 で 1.0.2、9-3 で 1.0.3、9-4 で 1.0.4。各版 3〜5 行）・情報画面の「データの扱い」の文面
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from 'virtual:app-info';
import changelogText from '../docs/changelog.md?raw';
import { parseChangelog } from '../src/core/changelog';
import { DATA_POLICY } from '../src/data/data-policy';

describe('版と更新履歴', () => {
  it('版は 1.0.8（9-6c ネフィルガの協力・調整・公開）', () => {
    expect(APP_VERSION).toBe('1.0.8');
  });

  it('更新履歴は新しい順に 1.0.8・1.0.7・1.0.6・1.0.5・1.0.4・1.0.3・1.0.2・1.0.1・1.0.0・0.9.0〜0.1.0、各版 3〜5 行', () => {
    const entries = parseChangelog(changelogText);
    const versions = entries.map((e) => /^(\d+\.\d+\.\d+)/.exec(e.title)?.[1]);
    expect(versions).toEqual([
      '1.0.8',
      '1.0.7',
      '1.0.6',
      '1.0.5',
      '1.0.4',
      '1.0.3',
      '1.0.2',
      '1.0.1',
      '1.0.0',
      '0.9.0',
      '0.8.0',
      '0.7.0',
      '0.6.0',
      '0.5.0',
      '0.4.0',
      '0.3.0',
      '0.2.0',
      '0.1.0',
    ]);
    for (const e of entries) {
      expect(e.items.length, e.title).toBeGreaterThanOrEqual(3);
      expect(e.items.length, e.title).toBeLessThanOrEqual(5);
    }
  });
});

describe('データの扱い（情報画面）', () => {
  const text = DATA_POLICY.map(([h, b]) => `${h}\n${b}`).join('\n');

  it('セーブはブラウザの中（localStorage / IndexedDB）', () => {
    expect(text).toContain('localStorage');
    expect(text).toContain('IndexedDB');
  });

  it('オンライン連携は任意で、個人の情報はメールアドレスと表示名だけ', () => {
    expect(text).toContain('オンライン連携は任意');
    expect(text).toMatch(/メールアドレス[^。]*と表示名[^。]*だけ/);
  });

  it('P2P では同じ部屋の相手に IP アドレスが見える', () => {
    expect(text).toMatch(/相手には[^。]*IP アドレス[^。]*見えます/);
  });
});
