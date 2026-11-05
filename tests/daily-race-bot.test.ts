// 日替わりチャレンジ（9-9）の周回レース: 海岸周回を 2〜4 周つないだコースを、道筋を追うボット（Kestrel・未強化）と
// 「方向へ倒す」ボット（日替わりの機体 4 機種）が未通過・墜落なしで完走する（周回のつなぎ目が飛べる）。1 回の長さは 2〜5 分
import { describe, expect, it } from 'vitest';
import { DAILY_CONFIG } from '../src/data/daily';
import { dailyCourse } from '../src/missions/daily/setup';
import { runDirectRace } from './direct-race-bots';
import { runRaceBot } from './race-bots';

const course = (tier: 1 | 2 | 3) => {
  const c = dailyCourse({ kind: 'race', tier, weatherId: 'day-clear' });
  if (!c) throw new Error('course');
  return c;
};

describe('周回レースを完走できる', () => {
  for (const tier of [1, 2, 3] as const) {
    it(`★${String(tier)}（${String(DAILY_CONFIG.race.laps[tier])} 周）: 道筋のボットが完走し、2〜5 分`, () => {
      const { result, crashes } = runRaceBot(course(tier));
      expect(result.outcome).toBe('finished');
      expect(result.missed).toBe(0);
      expect(crashes).toBe(0);
      expect(result.time / 60).toBeGreaterThanOrEqual(1.8);
      expect(result.time / 60).toBeLessThanOrEqual(5);
    }, 120_000);
  }

  for (const id of DAILY_CONFIG.aircraft)
    it(`方向へ倒すボット（${id}）が 2 周を完走する`, () => {
      const { result, crashes } = runDirectRace(course(1), id);
      expect(result?.outcome).toBe('finished');
      expect(result?.missed).toBe(0);
      expect(crashes).toBe(0);
    }, 120_000);
});
