import { describe, expect, it } from 'vitest';
import { lobbyHeading } from '../src/ui/lobby-text';
import { useLocale } from './i18n-helpers';

describe('ロビーの見出し（8-2 の事前修正）', () => {
  it('PvP は今までどおり', () => {
    expect(lobbyHeading('pvp', 4)).toEqual({
      kicker: 'PVP',
      title: 'PvP',
      note: '2〜4 人で同じ空を飛ぶ',
    });
  });

  it('協力レイド・協力防衛戦から入るとその名前', () => {
    expect(lobbyHeading('raid', 4).title).toBe('協力レイド');
    expect(lobbyHeading('defense', 4).title).toBe('協力防衛戦');
    expect(lobbyHeading('defense', 4).note).toContain('2〜4 人');
  });

  it('英語もそろっている', () => {
    for (const m of ['pvp', 'raid', 'defense'] as const) {
      useLocale('en');
      const h = lobbyHeading(m, 4);
      expect(h.title).not.toBe('');
      expect(h.note).toContain('4');
      expect(h.note).not.toContain('{max}');
    }
  });
});
