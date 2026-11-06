// 勲章の並びと番号（9-10c）: 番号は No.001 から飛ばずに続く・id は重ならない・カテゴリは決めた順に続けて並ぶ・
// 同じ段のまとまりは続けて並び、数の段は小さい順・レイドの中は怪獣ごと・一覧の件数と「同じ段の勲章」
import { describe, expect, it } from 'vitest';
import {
  BADGE_GROUPS,
  BADGES,
  badgeChain,
  badgeNumber,
  badgeStep,
  findBadge,
} from '../src/data/badges';
import { REMOVED_BADGES, SPLIT_BADGES } from '../src/data/badges-catalog';
import { RAID_KAIJU_IDS } from '../src/data/raid-kaiju';
import { createInitialSave } from '../src/progression/save';
import { allBadgeRows, groupCounts, rowValue, statusCounts } from '../src/ui/badge-view';
import { useLocale } from './i18n-helpers';

const chainOf = (id: string): string[] => {
  const def = findBadge(id);
  if (!def) throw new Error(id);
  return badgeChain(def).map((b) => b.id);
};

describe('勲章の番号と並び', () => {
  it('番号は 1 から並びの順に飛ばずに続き、id は重ならない', () => {
    BADGES.forEach((b, i) => {
      expect(b.no).toBe(i + 1);
    });
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
    expect(badgeNumber(BADGES[0] ?? { no: 0 })).toBe('No.001');
    expect(badgeNumber({ no: 44 })).toBe('No.044');
  });

  it('カテゴリは 通算・操縦・戦闘・任務・レース・防衛・練習・日替わり・協力・対戦・レイド・収集 の順に続けて並ぶ', () => {
    expect(BADGE_GROUPS).toEqual([
      'career',
      'flight',
      'combat',
      'campaign',
      'race',
      'defense',
      'practice',
      'daily',
      'coop',
      'pvp',
      'raid',
      'collect',
    ]);
    const order = BADGES.map((b) => BADGE_GROUPS.indexOf(b.group));
    for (let i = 1; i < order.length; i++)
      expect(order[i] ?? 0).toBeGreaterThanOrEqual(order[i - 1] ?? 0);
    for (const g of BADGE_GROUPS) expect(BADGES.some((b) => b.group === g)).toBe(true);
  });

  it('同じ段のまとまりは続けて並び、数の段は小さい順', () => {
    const seen = new Set<string>();
    let prev = '';
    for (const b of BADGES) {
      if (b.chain !== prev) {
        expect(seen.has(b.chain), b.chain).toBe(false);
        seen.add(b.chain);
        prev = b.chain;
      }
    }
    for (const chain of seen) {
      const list = BADGES.filter((b) => b.chain === chain);
      const ns = list.map((b) => (b.step && 'n' in b.step ? b.step.n : null));
      if (ns.some((n) => n === null)) continue;
      const nums = ns.map((n) => n ?? 0);
      expect([...nums].sort((a, b) => a - b)).toEqual(nums);
    }
    // 9-10 の「1 回」の勲章は同じ機動・撃墜の数えの頭
    expect(chainOf('loop')).toEqual([
      'loop',
      'l.mvLoop.10',
      'l.mvLoop.50',
      'l.mvLoop.200',
      'l.mvLoop.1000',
    ]);
    expect(chainOf('firstKill')).toEqual([
      'firstKill',
      'l.killFighter.25',
      'l.killFighter.100',
      'l.killFighter.500',
    ]);
  });

  it('レイドは怪獣を問わないもの → 怪獣ごと（RAID_KAIJU_IDS の順）', () => {
    const raid = BADGES.filter((b) => b.group === 'raid');
    const kaijuOf = (id: string): number =>
      RAID_KAIJU_IDS.findIndex(
        (k) => id.includes(`.${k}.`) || (k === 'nephirga' && id === 'nephirgaParts'),
      );
    const idx = raid.map((b) => kaijuOf(b.id));
    for (let i = 1; i < idx.length; i++)
      expect(idx[i] ?? 0).toBeGreaterThanOrEqual(idx[i - 1] ?? 0);
    expect(idx[0]).toBe(-1);
    expect(raid.at(-1)?.id).toBe('nephirgaParts');
  });

  it('9-10c で分けた id・消した id', () => {
    for (const ids of Object.values(SPLIT_BADGES))
      for (const id of ids) expect(findBadge(id)).toBeDefined();
    for (const id of REMOVED_BADGES) expect(findBadge(id)).toBeUndefined();
  });

  it('段の短い名前（数・単位・難易度・機体）', () => {
    useLocale('ja');
    expect(badgeStep('l.time.5')).toBe('5 時間');
    expect(badgeStep('l.dist.1000')).toBe('1,000 km');
    expect(badgeStep('dailyStreak7')).toBe('7 日');
    expect(badgeStep('c.raidClear.vorgas.hard')).toBe('高難度');
    expect(badgeStep('collect.50')).toBe('50%');
    expect(badgeStep('campaignA')).toBe('A 以上');
    useLocale('en');
    expect(badgeStep('l.time.5')).toBe('5 h');
    useLocale('ja');
  });
});

describe('一覧の件数', () => {
  it('カテゴリごと・状態ごとの件数と、右端の進み具合', () => {
    const d = createInitialSave();
    d.stats.counts = { 'mv.loop': 20 };
    d.badges.earned = { loop: [500], 'l.mvLoop.10': [900], ace: [1] };
    const rows = allBadgeRows(d);
    const g = groupCounts(rows);
    expect(g.all).toEqual({ earned: 3, total: BADGES.length });
    expect(g.flight.earned).toBe(2);
    expect(g.combat.earned).toBe(1);
    const s = statusCounts(rows, 'flight');
    expect(s.earned).toBe(2);
    expect(s.progress).toBeGreaterThanOrEqual(1);
    expect(s.all).toBe(BADGES.filter((b) => b.group === 'flight').length);
    expect(s.earned + s.progress + s.none).toBe(s.all);
    useLocale('ja');
    const row = (id: string) => {
      const r = rows.find((x) => x.id === id);
      if (!r) throw new Error(id);
      return r;
    };
    expect(rowValue(row('loop'))).toBe('済');
    expect(rowValue(row('l.mvLoop.50'))).toBe('20 / 50');
  });
});
